import assert from "node:assert/strict";
import { test } from "node:test";
import pkg from "../package.json" with { type: "json" };
import { ok, startFakeServer } from "./fake-server.ts";
import { run } from "./helpers.ts";

const me = {
  userId: "u1",
  name: "Ada",
  email: "ada@example.com",
  plan: "pro",
  status: "active",
};
const env = { BOOKMARK_TOKEN: "bkl_env" };

test("--version prints the package version", async () => {
  const { code, stdout } = await run(["--version"]);
  assert.equal(code, 0);
  assert.equal(stdout, `${pkg.version}\n`);
});

test("--help lists the commands and the global flags", async () => {
  for (const args of [[], ["--help"], ["help"]]) {
    const { code, stdout } = await run(args);
    assert.equal(code, 0);
    assert.match(stdout, /Usage: bookmark <command> \[flags\]/);
    assert.match(stdout, /whoami +Show the account you are logged in as/);
    assert.match(stdout, /--json/);
    assert.match(stdout, /--api-url <api-url>/);
  }
});

test("<command> --help shows the command's usage and flags", async () => {
  const { code, stdout } = await run(["whoami", "--help"]);
  assert.equal(code, 0);
  assert.match(stdout, /Usage: bookmark whoami \[flags\]/);
  assert.match(stdout, /Global flags:/);
});

test("an unknown command exits 2 with a hint", async () => {
  const { code, stdout, stderr } = await run(["frobnicate"]);
  assert.equal(code, 2);
  assert.equal(stdout, "");
  assert.match(stderr, /Unknown command: frobnicate\. Run: bookmark --help/);
});

test("an unknown flag exits 2 with a hint", async () => {
  const { code, stderr } = await run(["whoami", "--nope"], { env });
  assert.equal(code, 2);
  assert.match(stderr, /--nope/);
  assert.match(stderr, /Run: bookmark whoami --help/);
});

test("an invalid API URL exits 2 before anything is sent", async () => {
  for (const url of [
    "not a url",
    "ftp://example.com/v1",
    "http://api.example.com/v1",
    "http://localhost.evil.com/v1",
    "http://127.0.0.1.evil.com/v1",
  ]) {
    const flag = await run(["whoami", "--api-url", url], { env });
    assert.equal(flag.code, 2);
    assert.match(flag.stderr, /API URL/);
    const fromEnv = await run(["whoami"], {
      env: { ...env, BOOKMARK_API_URL: url },
    });
    assert.equal(fromEnv.code, 2);
  }
});

test("http is accepted for loopback hosts", async () => {
  const server = await startFakeServer({ "GET /auth/verify": ok(me) });
  try {
    const { port } = new URL(server.url);
    const ok127 = await run(["whoami"], {
      apiUrl: `http://127.0.0.1:${port}/v1`,
      env,
    });
    assert.equal(ok127.code, 0, ok127.stderr);
  } finally {
    await server.close();
  }
  // Nothing listens on port 1: a network error (1), not a usage error (2), means the URL was accepted.
  for (const host of ["localhost", "[::1]"]) {
    const { code } = await run(["whoami"], {
      apiUrl: `http://${host}:1/v1`,
      env,
    });
    assert.equal(code, 1, host);
  }
});

test("--api-url overrides BOOKMARK_API_URL", async () => {
  const flagServer = await startFakeServer({ "GET /auth/verify": ok(me) });
  const envServer = await startFakeServer({ "GET /auth/verify": ok(me) });
  try {
    const { code, stdout } = await run(
      ["whoami", "--api-url", flagServer.url],
      {
        apiUrl: envServer.url,
        env,
      },
    );
    assert.equal(code, 0);
    assert.match(stdout, new RegExp(`API: +${flagServer.url}`));
    assert.equal(flagServer.requests.length, 1);
    assert.equal(envServer.requests.length, 0);
  } finally {
    await flagServer.close();
    await envServer.close();
  }
});

test("unexpected arguments exit 2 before anything is sent", async () => {
  const server = await startFakeServer({ "GET /auth/verify": ok(me) });
  try {
    const { code, stderr } = await run(["whoami", "extra"], {
      apiUrl: server.url,
      env,
    });
    assert.equal(code, 2);
    assert.match(
      stderr,
      /Usage: bookmark whoami\. Run: bookmark whoami --help/,
    );
    assert.equal(server.requests.length, 0);
  } finally {
    await server.close();
  }
});
