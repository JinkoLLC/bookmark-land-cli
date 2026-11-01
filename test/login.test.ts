import assert from "node:assert/strict";
import { readFile, rm, stat } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { beforeEach, test } from "node:test";
import {
  apiError,
  type FakeResponse,
  ok,
  startFakeServer,
} from "./fake-server.ts";
import { configHome, run } from "./helpers.ts";

const me = {
  userId: "u1",
  name: "Ada",
  email: "ada@example.com",
  plan: "pro",
  status: "active",
};
const credentialsFile = join(configHome, "bookmark-land", "credentials.json");
const credentials = async () =>
  JSON.parse(await readFile(credentialsFile, "utf8"));
const hostOf = (url: string) => new URL(url).host;

const device = (expiresIn = 600) => ({
  body: {
    device_code: "d".repeat(64),
    user_code: "WDJB-MJHT",
    verification_uri: "https://app.example/cli",
    verification_uri_complete: "https://app.example/cli?code=WDJB-MJHT",
    expires_in: expiresIn,
    interval: 0,
  },
});
const granted = {
  body: { access_token: "bkl_device", token_type: "Bearer", scopes: [] },
};
const pending = apiError(400, "AUTHORIZATION_PENDING");

beforeEach(() => rm(credentialsFile, { force: true }));

async function login(
  tokenAnswers: FakeResponse[],
  args: string[] = [],
  options: { expiresIn?: number; env?: Record<string, string> } = {},
) {
  const server = await startFakeServer({
    "POST /auth/device": device(options.expiresIn),
    "POST /auth/device/token": tokenAnswers,
    "GET /auth/verify": ok(me),
  });
  try {
    const result = await run(["login", ...args], {
      apiUrl: server.url,
      env: options.env,
    });
    return { ...result, requests: server.requests, url: server.url };
  } finally {
    await server.close();
  }
}

test("login keeps waiting while approval is pending, then saves the Token", async () => {
  const { code, stdout, stderr, requests, url } = await login([
    pending,
    pending,
    granted,
  ]);
  assert.equal(code, 0, stderr);
  assert.equal(stdout, "");
  assert.match(stderr, /User code: WDJB-MJHT/);
  assert.match(
    stderr,
    /Open https:\/\/app\.example\/cli\?code=WDJB-MJHT in a browser/,
  );
  assert.match(stderr, /Logged in as Ada \(Token saved in config file\)/);
  assert.doesNotMatch(stderr, /Press Enter/); // stdin is not a TTY: never prompt

  const start = requests[0];
  assert.equal(start.path, "/auth/device");
  assert.deepEqual(start.body, { client_name: hostname() }); // no scopes: the server's defaults
  const polls = requests.filter((r) => r.path === "/auth/device/token");
  assert.equal(polls.length, 3);
  assert.deepEqual(polls[0].body, { device_code: "d".repeat(64) });
  assert.equal(requests.at(-1)?.headers.authorization, "Bearer bkl_device");

  assert.deepEqual(await credentials(), { [hostOf(url)]: "bkl_device" });
  if (process.platform !== "win32") {
    assert.equal((await stat(credentialsFile)).mode & 0o777, 0o600);
    assert.equal(
      (await stat(join(configHome, "bookmark-land"))).mode & 0o777,
      0o700,
    );
  }
});

test("login keeps waiting through rate limits", async () => {
  const { code, requests } = await login([
    apiError(429, "RATE_LIMITED"),
    granted,
  ]);
  assert.equal(code, 0);
  assert.equal(
    requests.filter((r) => r.path === "/auth/device/token").length,
    2,
  );
});

test("--scopes requests the default Scopes plus the extras, and --client-name names the login", async () => {
  const { code, requests } = await login(
    [granted],
    ["--scopes", "destructive,import,export", "--client-name", "work laptop"],
  );
  assert.equal(code, 0);
  assert.deepEqual(requests[0].body, {
    client_name: "work laptop",
    scopes: [
      "bookmarks:read",
      "bookmarks:write",
      "collections:read",
      "collections:write",
      "tags:read",
      "tags:write",
      "destructive",
      "import",
      "export",
    ],
  });
});

test("login exits 3 with the server's reason when approval is denied", async () => {
  const { code, stderr } = await login([
    pending,
    apiError(400, "ACCESS_DENIED", "API access requires a Pro plan"),
  ]);
  assert.equal(code, 3);
  assert.match(
    stderr,
    /Login was not approved: API access requires a Pro plan/,
  );
  await assert.rejects(credentials(), { code: "ENOENT" });
});

test("login exits 3 when the User code expires", async () => {
  const { code, stderr } = await login([
    pending,
    apiError(400, "EXPIRED_TOKEN"),
  ]);
  assert.equal(code, 3);
  assert.match(stderr, /The User code expired\. Run: bookmark login/);
  await assert.rejects(credentials(), { code: "ENOENT" });
});

test("login exits 3 when the code's lifetime runs out", async () => {
  const { code, stderr } = await login([pending], [], { expiresIn: 0.2 });
  assert.equal(code, 3);
  assert.match(stderr, /The User code expired/);
});

test("login stops waiting for a slow answer when the code's lifetime runs out", async () => {
  const server = await startFakeServer({
    "POST /auth/device": device(0.3),
    "POST /auth/device/token": async () => {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return pending;
    },
  });
  try {
    const started = Date.now();
    const { code, stderr } = await run(["login"], { apiUrl: server.url });
    assert.equal(code, 3);
    assert.match(stderr, /The User code expired/);
    assert.ok(Date.now() - started < 2500, "login waited for the slow answer");
  } finally {
    await server.close();
  }
});

test("login stops waiting for a slow body when the code's lifetime runs out", async () => {
  const started = Date.now();
  const { code, stderr } = await login(
    [{ ...pending, bodyDelayMs: 3000 }],
    [],
    {
      expiresIn: 0.3,
    },
  );
  assert.equal(code, 3);
  assert.match(stderr, /The User code expired/);
  assert.ok(Date.now() - started < 2500, "login waited for the slow body");
});

test("login backs off on slow_down instead of polling again right away", async () => {
  const { code, requests } = await login([apiError(400, "slow_down")], [], {
    expiresIn: 0.5,
  });
  assert.equal(code, 3); // the 5 extra seconds outlast the code's lifetime
  assert.equal(
    requests.filter((r) => r.path === "/auth/device/token").length,
    1,
  );
});

test("login --with-token checks the Token before storing it", async () => {
  const server = await startFakeServer({
    "GET /auth/verify": (req) =>
      req.headers.authorization === "Bearer bkl_good"
        ? ok(me)
        : apiError(401, "INVALID_TOKEN", "Invalid token"),
  });
  try {
    const bad = await run(["login", "--with-token"], {
      apiUrl: server.url,
      input: "bkl_bad\n",
    });
    assert.equal(bad.code, 3);
    await assert.rejects(credentials(), { code: "ENOENT" });

    const good = await run(["login", "--with-token"], {
      apiUrl: server.url,
      input: "bkl_good\n",
    });
    assert.equal(good.code, 0, good.stderr);
    assert.deepEqual(await credentials(), { [hostOf(server.url)]: "bkl_good" });
    assert.equal(
      server.requests.some((r) => r.path.startsWith("/auth/device")),
      false,
    );

    const empty = await run(["login", "--with-token"], {
      apiUrl: server.url,
      input: "",
    });
    assert.equal(empty.code, 2);
  } finally {
    await server.close();
  }
});

test("logins to different API hosts don't overwrite each other", async () => {
  const a = await startFakeServer({
    "GET /auth/verify": ok(me),
    "DELETE /auth/token": ok({ revoked: true }),
  });
  const b = await startFakeServer({ "GET /auth/verify": ok(me) });
  try {
    await run(["login", "--with-token"], { apiUrl: a.url, input: "bkl_a" });
    await run(["login", "--with-token"], { apiUrl: b.url, input: "bkl_b" });
    assert.deepEqual(await credentials(), {
      [hostOf(a.url)]: "bkl_a",
      [hostOf(b.url)]: "bkl_b",
    });
    assert.equal((await run(["logout"], { apiUrl: a.url })).code, 0);
    assert.deepEqual(await credentials(), { [hostOf(b.url)]: "bkl_b" });
  } finally {
    await a.close();
    await b.close();
  }
});

test("whoami reports a stored Token's source, and logout revokes and forgets it", async () => {
  const server = await startFakeServer({
    "GET /auth/verify": ok(me),
    "DELETE /auth/token": ok({ revoked: true }),
  });
  try {
    await run(["login", "--with-token"], {
      apiUrl: server.url,
      input: "bkl_saved",
    });
    const whoami = await run(["whoami"], { apiUrl: server.url });
    assert.match(whoami.stdout, /Token: +config file/);

    const logout = await run(["logout", "--json"], { apiUrl: server.url });
    assert.equal(logout.code, 0, logout.stderr);
    assert.deepEqual(JSON.parse(logout.stdout), { revoked: true });
    const revoke = server.requests.at(-1);
    assert.equal(revoke?.method, "DELETE");
    assert.equal(revoke?.path, "/auth/token");
    assert.equal(revoke?.headers.authorization, "Bearer bkl_saved");
    assert.deepEqual(await credentials(), {});

    const again = await run(["logout"], { apiUrl: server.url });
    assert.equal(again.code, 3);
    assert.match(again.stderr, /Not logged in\. Run: bookmark login/);
  } finally {
    await server.close();
  }
});

test("logout treats a Token that is already revoked as logged out", async () => {
  const server = await startFakeServer({
    "GET /auth/verify": ok(me),
    "DELETE /auth/token": apiError(401, "TOKEN_REVOKED"),
  });
  try {
    await run(["login", "--with-token"], {
      apiUrl: server.url,
      input: "bkl_old",
    });
    const logout = await run(["logout"], { apiUrl: server.url });
    assert.equal(logout.code, 0, logout.stderr);
    assert.deepEqual(await credentials(), {});
  } finally {
    await server.close();
  }
});

test("BOOKMARK_TOKEN takes precedence over a stored Token, and logout refuses to touch it", async () => {
  const server = await startFakeServer({ "GET /auth/verify": ok(me) });
  try {
    await run(["login", "--with-token"], {
      apiUrl: server.url,
      input: "bkl_saved",
    });
    const env = { BOOKMARK_TOKEN: "bkl_env" };
    const whoami = await run(["whoami"], { apiUrl: server.url, env });
    assert.match(whoami.stdout, /Token: +BOOKMARK_TOKEN/);
    assert.equal(
      server.requests.at(-1)?.headers.authorization,
      "Bearer bkl_env",
    );

    const logout = await run(["logout"], { apiUrl: server.url, env });
    assert.equal(logout.code, 2);
    assert.deepEqual(await credentials(), {
      [hostOf(server.url)]: "bkl_saved",
    });

    const relogin = await run(["login", "--with-token"], {
      apiUrl: server.url,
      input: "bkl_new",
      env,
    });
    assert.equal(relogin.code, 0);
    assert.match(
      relogin.stderr,
      /BOOKMARK_TOKEN is set, so it is used instead of this login/,
    );
  } finally {
    await server.close();
  }
});
