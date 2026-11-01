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
const tags = [
  { id: "tag_dev", name: "dev", color: "blue", parentId: null, count: 42 },
  { id: "tag_js", name: "dev/js", color: null, parentId: "tag_dev", count: 15 },
  {
    id: "tag_ml",
    name: "machine learning",
    color: null,
    parentId: null,
    count: 3,
  },
];
const bk = (id: string) => ({
  id,
  url: `https://example.com/${id}`,
  title: id,
  tags: ["dev"],
});
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
  const server = await startFakeServer({ "GET /tags": ok(tags), ...routes });
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

test("tags list shows each Tag's name and count", async () => {
  const { code, stdout } = await cli({}, ["tags", "list"]);
  assert.equal(code, 0);
  assert.equal(stdout, "dev\t42\tblue\ndev/js\t15\t\nmachine learning\t3\t\n");
  const json = await cli({}, ["tags", "list", "--json"]);
  assert.deepEqual(JSON.parse(json.stdout), tags);
});

test("tags list shows a table on a terminal", { skip: noTty }, async () => {
  const { stdout } = await cli({}, ["tags", "list"], undefined, runTty);
  assert.match(stdout, /^NAME +BOOKMARKS +COLOR\ndev +42 +blue\n/);
});

test("tags add creates a Tag, including hierarchical names", async () => {
  const { code, stderr, requests } = await cli(
    { "POST /tags": ok({ id: "tag_new" }) },
    ["tags", "add", "dev/ts", "--color", "green"],
  );
  assert.equal(code, 0, stderr);
  assert.match(stderr, /Created Tag "dev\/ts"/);
  assert.deepEqual(requests[0].body, { name: "dev/ts", color: "green" });
  const long = await cli({}, ["tags", "add", "x".repeat(26)]);
  assert.equal(long.code, 2);
  assert.match(long.stderr, /can be at most 25 characters/);
  assert.equal(long.requests.length, 0);
});

test("tags rename looks the Tag up by name, case-insensitively", async () => {
  const { code, stderr, requests } = await cli(
    { "PATCH /tags/tag_js": ok({}) },
    ["tags", "rename", "DEV/JS", "dev/javascript"],
  );
  assert.equal(code, 0, stderr);
  assert.match(stderr, /Renamed Tag "dev\/js" to "dev\/javascript"/);
  assert.deepEqual(requests.at(-1)?.body, { newName: "dev/javascript" });
  const unknown = await cli({}, ["tags", "rename", "nope", "x"]);
  assert.equal(unknown.code, 4);
});

test("tags rm and tags merge need --yes without a terminal", async () => {
  for (const args of [
    ["tags", "rm", "dev"],
    ["tags", "merge", "dev/js", "dev"],
  ]) {
    const { code, stderr, requests } = await cli({}, args);
    assert.equal(code, 2, args.join(" "));
    assert.match(stderr, /pass --yes to confirm/);
    assert.deepEqual(calls(requests), [
      "GET /tags",
      ...(args[1] === "merge" ? ["GET /tags"] : []),
    ]);
  }
});

test("tags rm --yes deletes the Tag; tags merge --yes merges by id", async () => {
  const rm = await cli({ "DELETE /tags/tag_ml": ok({}) }, [
    "tags",
    "rm",
    "Machine Learning",
    "--yes",
  ]);
  assert.equal(rm.code, 0, rm.stderr);
  assert.match(
    rm.stderr,
    /Deleted Tag "machine learning"\. Its Bookmarks are untouched/,
  );
  assert.equal(calls(rm.requests).at(-1), "DELETE /tags/tag_ml");

  const merge = await cli({ "POST /tags/merge": ok({}) }, [
    "tags",
    "merge",
    "dev/js",
    "dev",
    "--yes",
  ]);
  assert.equal(merge.code, 0, merge.stderr);
  assert.deepEqual(merge.requests.at(-1)?.body, {
    sourceTagId: "tag_js",
    targetTagId: "tag_dev",
  });
});

test("tags rm asks on a terminal", { skip: noTty }, async () => {
  const { stdout, requests } = await cli(
    {},
    ["tags", "rm", "dev"],
    "n\n",
    runTty,
  );
  assert.match(
    stdout,
    /Delete the Tag "dev" from 42 Bookmarks\? This can't be undone\. \[y\/N\]/,
  );
  assert.deepEqual(calls(requests), ["GET /tags"]);
});

test("tag with one id uses the single endpoint; several use bulk tag in batches of 50", async () => {
  const one = await cli({ "POST /bookmarks/bk_1/tags": ok({}) }, [
    "tag",
    "bk_1",
    "reading",
  ]);
  assert.equal(one.code, 0, one.stderr);
  assert.deepEqual(one.requests[0].body, { name: "reading" });
  assert.match(one.stderr, /Tagged 1 Bookmark with "reading"/);

  const ids = Array.from({ length: 55 }, (_, i) => `bk_${i}`);
  const many = await cli(
    {
      "POST /bookmarks/bulk/tag": (req) =>
        ok({
          tagId: "tag_r",
          addedCount: (req.body as { ids: string[] }).ids.length - 1,
        }),
    },
    ["tag", "-", "machine learning", "--json"],
    ids.join("\n"),
  );
  assert.equal(many.code, 0, many.stderr);
  assert.deepEqual(
    many.requests.map((r) => [
      (r.body as { ids: string[] }).ids.length,
      (r.body as { name: string }).name,
    ]),
    [
      [50, "machine learning"],
      [5, "machine learning"],
    ],
  );
  assert.deepEqual(JSON.parse(many.stdout), { requested: 55, affected: 53 });
});

test("untag looks up the Tag's id and reports partial results", async () => {
  const one = await cli({ "DELETE /bookmarks/bk_1/tags/tag_js": ok({}) }, [
    "untag",
    "bk_1",
    "dev/js",
  ]);
  assert.equal(one.code, 0, one.stderr);
  assert.deepEqual(calls(one.requests), [
    "GET /tags",
    "DELETE /bookmarks/bk_1/tags/tag_js",
  ]);

  const many = await cli(
    { "DELETE /bookmarks/bulk/tag": ok({ removedCount: 1 }) },
    ["untag", "bk_1", "bk_2", "dev"],
  );
  assert.equal(many.code, 0);
  assert.deepEqual(many.requests.at(-1)?.body, {
    ids: ["bk_1", "bk_2"],
    tagId: "tag_dev",
  });
  assert.match(
    many.stderr,
    /1 of 2 untagged from "dev" \(1 not found or unchanged\)/,
  );
});

test("untag with an unknown Tag exits 4 before changing anything", async () => {
  const { code, stderr, requests } = await cli({}, ["untag", "bk_1", "nope"]);
  assert.equal(code, 4);
  assert.match(stderr, /No Tag is named "nope"/);
  assert.deepEqual(calls(requests), ["GET /tags"]);
});

const page = (extra = {}) =>
  ok({
    data: [bk("bk_1")],
    cursor: null,
    hasMore: false,
    truncated: false,
    ...extra,
  });

test("list --tag lists the Tag's Bookmarks in the usual output, with paging", async () => {
  const { code, stdout, stderr, requests } = await cli(
    { "GET /bookmarks": page({ cursor: "c2", hasMore: true }) },
    ["list", "--tag", "machine learning", "--limit", "10", "--cursor", "c1"],
  );
  assert.equal(code, 0);
  assert.equal(stdout, "bk_1\tbk_1\t\tdev\n");
  assert.equal(stderr, "More results. Next page: add --cursor c2\n");
  assert.deepEqual(calls(requests), ["GET /bookmarks"]);
  assert.deepEqual(requests[0].query, {
    tag: "machine learning",
    limit: "10",
    cursor: "c1",
  });
  const json = await cli({ "GET /bookmarks": page() }, [
    "list",
    "--tag",
    "dev",
    "--json",
  ]);
  assert.deepEqual(JSON.parse(json.stdout), {
    data: [bk("bk_1")],
    cursor: null,
    hasMore: false,
    truncated: false,
  });
});

test("list --tag combines with the other filters and a date sort", async () => {
  const { code, requests } = await cli(
    {
      "GET /bookmarks": page(),
      "GET /collections": ok({
        collections: [{ id: "col_r", name: "Reading", parentId: null }],
        nextCursor: null,
      }),
    },
    [
      "list",
      "--tag",
      "dev/js",
      "--collection",
      "Reading",
      "--domain",
      "github.com",
      "--type",
      "link",
      "--favorite",
      "--sort",
      "oldest",
    ],
  );
  assert.equal(code, 0);
  assert.deepEqual(requests.at(-1)?.query, {
    tag: "dev/js",
    collectionId: "col_r",
    domain: "github.com",
    type: "link",
    isFavorite: "true",
    sortBy: "oldest",
  });
});

test("list --tag rejects title and domain sorts before sending", async () => {
  for (const sort of ["title", "domain"]) {
    const { code, stderr, requests } = await cli({}, [
      "list",
      "--tag",
      "dev",
      "--sort",
      sort,
    ]);
    assert.equal(code, 2);
    assert.match(stderr, /--tag sorts by newest or oldest only/);
    assert.equal(requests.length, 0);
  }
});

test("a Tag name over 25 characters on tag exits 2", async () => {
  const { code, requests } = await cli({}, ["tag", "bk_1", "x".repeat(26)]);
  assert.equal(code, 2);
  assert.equal(requests.length, 0);
});

test("a missing Scope on tag shows the login command", async () => {
  const { code, stderr } = await cli(
    {
      "POST /bookmarks/bk_1/tags": apiError(
        403,
        "SCOPE_REQUIRED",
        'This endpoint requires the "tags:write" scope',
      ),
    },
    ["tag", "bk_1", "x"],
  );
  assert.equal(code, 3);
  assert.match(stderr, /bookmark login --scopes tags:write/);
});
