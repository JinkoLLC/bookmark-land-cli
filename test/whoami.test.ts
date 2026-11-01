import assert from "node:assert/strict";
import { test } from "node:test";
import pkg from "../package.json" with { type: "json" };
import {
  apiError,
  type FakeResponse,
  ok,
  startFakeServer,
} from "./fake-server.ts";
import { run } from "./helpers.ts";

const me = {
  userId: "u1",
  name: "Ada",
  email: "ada@example.com",
  plan: "pro",
  status: "active",
};
const env = { BOOKMARK_TOKEN: "bkl_env" };

async function whoami(answer: FakeResponse, args: string[] = []) {
  const server = await startFakeServer({ "GET /auth/verify": answer });
  try {
    const result = await run(["whoami", ...args], { apiUrl: server.url, env });
    return { ...result, requests: server.requests, url: server.url };
  } finally {
    await server.close();
  }
}

test("whoami shows the account, the Token source and the API URL", async () => {
  const { code, stdout, stderr, requests, url } = await whoami(ok(me));
  assert.equal(code, 0, stderr);
  assert.equal(
    stdout,
    `Name:  Ada\nEmail: ada@example.com\nPlan:  pro\nToken: BOOKMARK_TOKEN\nAPI:   ${url}\n`,
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[0].headers.authorization, "Bearer bkl_env");
  assert.equal(
    requests[0].headers["user-agent"],
    `bookmark-land-cli/${pkg.version} (node ${process.versions.node}; ${process.platform})`,
  );
});

test("whoami --json prints the API's data unchanged", async () => {
  const { code, stdout } = await whoami(ok(me), ["--json"]);
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(stdout), me);
});

test("whoami without a Token exits 3", async () => {
  const { code, stdout, stderr } = await run(["whoami"], {
    apiUrl: "http://127.0.0.1:1/v1",
  });
  assert.equal(code, 3);
  assert.equal(stdout, "");
  assert.match(stderr, /Not logged in\. Run: bookmark login/);
});

for (const [status, codeName, exitCode] of [
  [401, "INVALID_TOKEN", 3],
  [403, "API_ACCESS_PRO_REQUIRED", 3],
  [404, "NOT_FOUND", 4],
  [500, "INTERNAL_ERROR", 1],
  [502, "BAD_GATEWAY", 1],
] as const) {
  test(`an API ${status} exits ${exitCode} and shows the message and request id`, async () => {
    const { code, stdout, stderr } = await whoami(
      apiError(status, codeName, `Failed: ${codeName}`),
    );
    assert.equal(code, exitCode);
    assert.equal(stdout, "");
    assert.equal(stderr, `error: Failed: ${codeName} (request id: req_test)\n`);
  });
}

test("a 429 exits 5 and says when to retry", async () => {
  const { code, stderr } = await whoami({
    status: 429,
    body: {
      error: { code: "RATE_LIMITED", message: "Rate limit exceeded" },
      meta: { requestId: "req_test" },
    },
    headers: { "retry-after": "30" },
  });
  assert.equal(code, 5);
  assert.match(
    stderr,
    /Rate limit exceeded\. Retry after \d\d:\d\d\. \(request id: req_test\)/,
  );
});

test("a gateway error with a plain-string error is shown", async () => {
  const { code, stderr } = await whoami({
    status: 429,
    body: { error: "Rate limit exceeded", meta: { requestId: "0f1c2d3e" } },
    headers: { "retry-after": "60" },
  });
  assert.equal(code, 5);
  assert.match(
    stderr,
    /error: Rate limit exceeded\. Retry after \d\d:\d\d\. \(request id: 0f1c2d3e\)/,
  );
});

test("a response that isn't JSON exits 1", async () => {
  const proxy = await whoami({ status: 502, body: "<html>Bad gateway</html>" });
  assert.equal(proxy.code, 1);
  assert.match(proxy.stderr, /error: 502 Bad Gateway/);
  const garbled = await whoami({ body: "<html>hello</html>" });
  assert.equal(garbled.code, 1);
  assert.match(garbled.stderr, /isn't JSON/);
});

test("a missing Scope tells the user which login command to run", async () => {
  const { code, stderr } = await whoami(
    apiError(
      403,
      "SCOPE_REQUIRED",
      'This endpoint requires the "destructive" scope',
    ),
  );
  assert.equal(code, 3);
  assert.match(
    stderr,
    /requires the "destructive" scope\. Run: bookmark login --scopes destructive/,
  );
});

test("with --json, errors are JSON on stderr and stdout stays empty", async () => {
  const { code, stdout, stderr } = await whoami(
    apiError(403, "API_ACCESS_PRO_REQUIRED", "API access requires Pro"),
    ["--json"],
  );
  assert.equal(code, 3);
  assert.equal(stdout, "");
  assert.deepEqual(JSON.parse(stderr), {
    error: {
      code: "API_ACCESS_PRO_REQUIRED",
      message: "API access requires Pro",
      requestId: "req_test",
    },
  });
});

test("a network failure exits 1 with a readable message", async () => {
  const server = await startFakeServer({});
  await server.close(); // nothing listens on this port any more
  const { code, stderr } = await run(["whoami"], { apiUrl: server.url, env });
  assert.equal(code, 1);
  assert.match(stderr, /^error: Could not reach http:\/\/127\.0\.0\.1:\d+: /);
});
