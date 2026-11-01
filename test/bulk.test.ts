import assert from "node:assert/strict";
import { test } from "node:test";
import {
  apiError,
  type FakeRequest,
  type FakeResponse,
  ok,
  startFakeServer,
} from "./fake-server.ts";
import { noTty, type RunResult, run, runTty } from "./helpers.ts";

const env = { BOOKMARK_TOKEN: "bkl_env" };
type Routes = Record<
  string,
  FakeResponse | FakeResponse[] | ((req: FakeRequest) => FakeResponse)
>;

async function cli(
  routes: Routes,
  args: string[],
  input?: string,
  runner: (a: string[], o: object) => Promise<RunResult> = run,
) {
  const server = await startFakeServer(routes);
  try {
    return {
      ...(await runner(args, { apiUrl: server.url, env, input })),
      requests: server.requests,
    };
  } finally {
    await server.close();
  }
}
const calls = (requests: FakeRequest[]) =>
  requests.map((r) => `${r.method} ${r.path}`);
const ids = (n: number) => Array.from({ length: n }, (_, i) => `bk_${i + 1}`);
// A bulk endpoint that changes every id it is given.
const all = (field: string) => (req: FakeRequest) =>
  ok({ [field]: (req.body as { ids: string[] }).ids.length });

test("rm with one id uses the single-Bookmark endpoint and prints the id", async () => {
  const { code, stdout, stderr, requests } = await cli(
    { "DELETE /bookmarks/bk_1": ok({ success: true }) },
    ["rm", "bk_1"],
  );
  assert.equal(code, 0, stderr);
  assert.equal(stdout, "bk_1\n");
  assert.match(stderr, /Removed 1 Bookmark$/m);
  assert.deepEqual(calls(requests), ["DELETE /bookmarks/bk_1"]);
});

test("rm with several ids uses the bulk endpoint", async () => {
  const { code, stdout, stderr, requests } = await cli(
    { "POST /bookmarks/bulk/trash": all("trashed") },
    ["rm", "bk_1", "bk_2", "bk_3"],
  );
  assert.equal(code, 0, stderr);
  assert.equal(stdout, "bk_1\nbk_2\nbk_3\n");
  assert.match(stderr, /Removed 3 Bookmarks/);
  assert.deepEqual(requests[0].body, { ids: ["bk_1", "bk_2", "bk_3"] });
});

test("ids can come from stdin with -, in batches of 50", async () => {
  const { code, stderr, requests } = await cli(
    { "POST /bookmarks/bulk/trash": all("trashed") },
    ["rm", "-", "--json"],
    `${ids(120).join("\n")}\n\n`,
  );
  assert.equal(code, 0, stderr);
  assert.deepEqual(
    requests.map((r) => (r.body as { ids: string[] }).ids.length),
    [50, 50, 20],
  );
  assert.deepEqual(
    (requests[2].body as { ids: string[] }).ids.at(-1),
    "bk_120",
  );
});

test("a partial result says how many were skipped, exits 0, and --json has the counts", async () => {
  const routes = { "POST /bookmarks/bulk/trash": ok({ trashed: 2 }) };
  const text = await cli(routes, ["rm", "bk_1", "bk_2", "bk_3"]);
  assert.equal(text.code, 0);
  assert.match(text.stderr, /2 of 3 removed \(1 not found or unchanged\)/);
  const json = await cli(routes, ["rm", "bk_1", "bk_2", "bk_3", "--json"]);
  assert.equal(json.code, 0);
  assert.deepEqual(JSON.parse(json.stdout), { requested: 3, affected: 2 });
});

const halfway = {
  "POST /bookmarks/bulk/trash": [
    ok({ trashed: 50 }),
    {
      status: 429,
      body: {
        error: { code: "RATE_LIMITED", message: "Rate limit exceeded" },
        meta: { requestId: "req_test" },
      },
      headers: { "retry-after": "30" },
    },
  ],
};

test("a rate limit halfway through says how far it got, and keeps the Removed ids", async () => {
  const { code, stdout, stderr, requests } = await cli(
    halfway,
    ["rm", "-"],
    ids(80).join("\n"),
  );
  assert.equal(code, 5);
  assert.equal(requests.length, 2);
  assert.equal(stdout, `${ids(50).join("\n")}\n`); // the first batch, so it can be Restored
  assert.match(
    stderr,
    /Retry after \d\d:\d\d\. Stopped after 50 of 80 ids \(50 changed\)/,
  );
});

test("with --json, a failure halfway is still one JSON error", async () => {
  const { code, stdout, stderr } = await cli(
    halfway,
    ["rm", "-", "--json"],
    ids(80).join("\n"),
  );
  assert.equal(code, 5);
  assert.equal(stdout, "");
  const { error } = JSON.parse(stderr);
  assert.equal(error.code, "RATE_LIMITED");
  assert.match(error.message, /Stopped after 50 of 80 ids \(50 changed\)/);
});

test("restore has no bulk endpoint: one call per id, unknown ids counted as skipped", async () => {
  const { code, stderr, requests } = await cli(
    {
      "POST /bookmarks/bk_1/restore": ok({ success: true }),
      "POST /bookmarks/bk_2/restore": apiError(404, "NOT_FOUND"),
    },
    ["restore", "bk_1", "bk_2"],
  );
  assert.equal(code, 0, stderr);
  assert.deepEqual(calls(requests), [
    "POST /bookmarks/bk_1/restore",
    "POST /bookmarks/bk_2/restore",
  ]);
  assert.match(stderr, /1 of 2 restored \(1 not found or unchanged\)/);
  const single = await cli(
    { "POST /bookmarks/nope/restore": apiError(404, "NOT_FOUND") },
    ["restore", "nope"],
  );
  assert.equal(single.code, 4);
});

test("favorite and unfavorite use the single and bulk endpoints", async () => {
  const one = await cli(
    { "PUT /bookmarks/bk_1/favorite": ok({ success: true }) },
    ["favorite", "bk_1"],
  );
  assert.equal(one.code, 0);
  assert.deepEqual(one.requests[0].body, { isFavorite: true });
  assert.match(one.stderr, /Favorited 1 Bookmark/);

  const many = await cli(
    { "POST /bookmarks/bulk/favorite": ok({ updated: 1 }) },
    ["unfavorite", "bk_1", "bk_2"],
  );
  assert.equal(many.code, 0);
  assert.deepEqual(many.requests[0].body, {
    ids: ["bk_1", "bk_2"],
    isFavorite: false,
  });
  assert.match(many.stderr, /1 of 2 unfavorited/);
});

test("Remove and Restore never ask for confirmation", async () => {
  const { code } = await cli({ "DELETE /bookmarks/bk_1": ok({}) }, [
    "rm",
    "bk_1",
  ]);
  assert.equal(code, 0);
});

test("rm --permanent without a terminal needs --yes", async () => {
  const { code, stderr, requests } = await cli({}, [
    "rm",
    "--permanent",
    "bk_1",
  ]);
  assert.equal(code, 2);
  assert.match(
    stderr,
    /Permanently delete this Bookmark\? This can't be undone: pass --yes to confirm/,
  );
  assert.equal(requests.length, 0);
});

test("rm --permanent --yes Permanently deletes each Bookmark", async () => {
  const { code, stdout, stderr, requests } = await cli(
    {
      "DELETE /bookmarks/bk_1/permanent": ok({}),
      "DELETE /bookmarks/bk_2/permanent": ok({}),
    },
    ["rm", "--permanent", "--yes", "bk_1", "bk_2"],
  );
  assert.equal(code, 0, stderr);
  assert.equal(stdout, "");
  assert.match(stderr, /Permanently deleted 2 Bookmarks/);
  assert.deepEqual(calls(requests), [
    "DELETE /bookmarks/bk_1/permanent",
    "DELETE /bookmarks/bk_2/permanent",
  ]);
});

test("rm --permanent asks on a terminal, and anything but yes cancels", {
  skip: noTty,
}, async () => {
  const { stdout, requests } = await cli(
    {},
    ["rm", "--permanent", "bk_1", "bk_2"],
    "n\n",
    runTty,
  );
  assert.match(
    stdout,
    /Permanently delete these 2 Bookmarks\? This can't be undone\. \[y\/N\]/,
  );
  assert.match(stdout, /Cancelled\. Nothing was changed\./);
  assert.equal(requests.length, 0);
});

// Only Linux `script` can pass an answer to the prompt.
test("answering y on a terminal Permanently deletes", {
  skip: noTty || process.platform === "darwin",
}, async () => {
  const { stdout, requests } = await cli(
    { "DELETE /bookmarks/bk_1/permanent": ok({}) },
    ["rm", "--permanent", "bk_1"],
    "y\n",
    runTty,
  );
  assert.match(stdout, /Permanently deleted 1 Bookmark/);
  assert.deepEqual(calls(requests), ["DELETE /bookmarks/bk_1/permanent"]);
});

test("a missing destructive Scope shows the login command to run", async () => {
  const { code, stderr } = await cli(
    {
      "DELETE /bookmarks/bk_1/permanent": apiError(
        403,
        "SCOPE_REQUIRED",
        'This endpoint requires the "destructive" scope',
      ),
    },
    ["rm", "--permanent", "--yes", "bk_1"],
  );
  assert.equal(code, 3);
  assert.match(stderr, /Run: bookmark login --scopes destructive/);
});

test("trash empty needs --yes without a terminal, and reports what was deleted", async () => {
  const refused = await cli({}, ["trash", "empty"]);
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /pass --yes to confirm/);

  const some = await cli(
    { "DELETE /bookmarks/trash": ok({ deleted: 12, hasMore: false }) },
    ["trash", "empty", "--yes"],
  );
  assert.equal(some.code, 0);
  assert.match(some.stderr, /Permanently deleted 12 Bookmarks from the Trash/);
  assert.doesNotMatch(some.stderr, /background/);

  const more = await cli(
    { "DELETE /bookmarks/trash": ok({ deleted: 200, hasMore: true }) },
    ["trash", "empty", "--yes"],
  );
  assert.match(
    more.stderr,
    /being Permanently deleted in the background\. Check again later with: bookmark trash list/,
  );

  const json = await cli(
    { "DELETE /bookmarks/trash": ok({ deleted: 200, hasMore: true }) },
    ["trash", "empty", "--yes", "--json"],
  );
  assert.deepEqual(JSON.parse(json.stdout), { deleted: 200, hasMore: true });

  // Exactly 200 with nothing left is not "more in the background".
  const exact = await cli(
    { "DELETE /bookmarks/trash": ok({ deleted: 200, hasMore: false }) },
    ["trash", "empty", "--yes"],
  );
  assert.doesNotMatch(exact.stderr, /background/);
});

test("trash empty asks on a terminal", { skip: noTty }, async () => {
  const { stdout, requests } = await cli({}, ["trash", "empty"], "\n", runTty);
  assert.match(
    stdout,
    /Permanently delete every Bookmark in the Trash\? This can't be undone\. \[y\/N\]/,
  );
  assert.equal(requests.length, 0);
});

test("- must be the only id, and some id is required", async () => {
  assert.equal((await cli({}, ["rm", "-", "bk_1"])).code, 2);
  assert.equal((await cli({}, ["rm", "-"], "\n\n")).code, 2);
  assert.equal((await cli({}, ["rm"])).code, 2);
});

const trashed = {
  data: [
    {
      id: "bk_9",
      url: "https://old.example.com",
      title: "Old",
      domain: "old.example.com",
      tags: [],
      trashedAt: "2026-10-20T09:00:00Z",
      deletesAt: "2026-11-19T09:00:00Z",
    },
  ],
  cursor: "c2",
  hasMore: true,
  truncated: false,
};

test("trash list lists the Trash with --limit and --cursor, and the next-page hint", async () => {
  const { code, stdout, stderr, requests } = await cli(
    { "GET /bookmarks/trashed": ok(trashed) },
    ["trash", "list", "--limit", "200", "--cursor", "c1"],
  );
  assert.equal(code, 0, stderr);
  assert.equal(stdout, "bk_9\tOld\told.example.com\t\n");
  assert.equal(stderr, "More results. Next page: add --cursor c2\n");
  assert.deepEqual(requests[0].query, { limit: "200", cursor: "c1" });
  const json = await cli({ "GET /bookmarks/trashed": ok(trashed) }, [
    "trash",
    "list",
    "--json",
  ]);
  assert.deepEqual(JSON.parse(json.stdout), trashed);
  const bad = await cli({}, ["trash", "list", "--limit", "201"]);
  assert.equal(bad.code, 2);
  assert.equal(bad.requests.length, 0);
});

test("trash list shows a table on a terminal", { skip: noTty }, async () => {
  const { stdout } = await cli(
    { "GET /bookmarks/trashed": ok(trashed) },
    ["trash", "list"],
    undefined,
    runTty,
  );
  assert.match(stdout, /^ID {4}TITLE +DOMAIN +TAGS\nbk_9 {2}Old/);
});
