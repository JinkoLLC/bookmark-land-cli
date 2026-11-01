import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type FakeRequest,
  type FakeResponse,
  ok,
  startFakeServer,
} from "./fake-server.ts";
import { run } from "./helpers.ts";

const env = { BOOKMARK_TOKEN: "bkl_env" };
const collections = {
  "GET /collections": ok({
    collections: [
      { id: "col_read", name: "Reading", parentId: null },
      { id: "col_w1", name: "Work", parentId: null },
      { id: "col_w2", name: "Work", parentId: "col_read" },
    ],
    nextCursor: null,
  }),
};
type Routes = Record<
  string,
  FakeResponse | ((req: FakeRequest) => FakeResponse)
>;
async function cli(routes: Routes, args: string[], input?: string) {
  const server = await startFakeServer({ ...collections, ...routes });
  try {
    return {
      ...(await run(args, { apiUrl: server.url, env, input })),
      requests: server.requests,
    };
  } finally {
    await server.close();
  }
}
const moves = (requests: FakeRequest[]) =>
  requests.filter((r) => r.path !== "/collections");

test("move with one id uses the single-Bookmark endpoint and a Collection name", async () => {
  const { code, stderr, requests } = await cli(
    { "POST /bookmarks/bk_1/move": ok({ success: true }) },
    ["move", "bk_1", "--to", "Reading"],
  );
  assert.equal(code, 0, stderr);
  assert.match(stderr, /Moved 1 Bookmark/);
  assert.deepEqual(
    moves(requests).map((r) => [r.path, r.body]),
    [["/bookmarks/bk_1/move", { collectionId: "col_read" }]],
  );
});

test("move --to unsorted moves to Unsorted without looking up Collections", async () => {
  const { code, requests } = await cli(
    { "POST /bookmarks/bk_1/move": ok({ success: true }) },
    ["move", "bk_1", "--to", "unsorted"],
  );
  assert.equal(code, 0);
  assert.deepEqual(
    requests.map((r) => [r.path, r.body]),
    [["/bookmarks/bk_1/move", { collectionId: null }]],
  );
});

test("move with several ids uses bulk move in batches of 50, with partial results", async () => {
  const ids = Array.from({ length: 60 }, (_, i) => `bk_${i}`);
  const { code, stdout, stderr, requests } = await cli(
    {
      "POST /bookmarks/bulk/move": (req) =>
        ok({ moved: (req.body as { ids: string[] }).ids.length - 1 }),
    },
    ["move", "-", "--to", "col_w1", "--json"],
    ids.join("\n"),
  );
  assert.equal(code, 0, stderr);
  const bulk = moves(requests);
  assert.deepEqual(
    bulk.map((r) => (r.body as { ids: string[] }).ids.length),
    [50, 10],
  );
  assert.equal(
    (bulk[0].body as { collectionId: string }).collectionId,
    "col_w1",
  );
  assert.deepEqual(JSON.parse(stdout), { requested: 60, affected: 58 });

  const text = await cli({ "POST /bookmarks/bulk/move": ok({ moved: 1 }) }, [
    "move",
    "bk_1",
    "bk_2",
    "--to",
    "unsorted",
  ]);
  assert.match(text.stderr, /1 of 2 moved \(1 not found or unchanged\)/);
});

test("an ambiguous Collection name exits 2 before moving anything", async () => {
  const { code, stderr, requests } = await cli({}, [
    "move",
    "bk_1",
    "--to",
    "Work",
  ]);
  assert.equal(code, 2);
  assert.match(stderr, /2 Collections are named "Work"/);
  assert.equal(moves(requests).length, 0);
});

test("move needs --to", async () => {
  const { code, stderr } = await cli({}, ["move", "bk_1"]);
  assert.equal(code, 2);
  assert.match(stderr, /--to <collection\|unsorted>/);
});
