import assert from "node:assert/strict";
import { test } from "node:test";
import {
  apiError,
  type FakeResponse,
  ok,
  startFakeServer,
} from "./fake-server.ts";
import { run } from "./helpers.ts";

const env = { BOOKMARK_TOKEN: "bkl_env" };
const collections = {
  "GET /collections": ok({
    collections: [{ id: "col_1", name: "Reading", parentId: null }],
    nextCursor: null,
  }),
};
const created = (extra = {}) =>
  ok({ bookmarkId: "bk_new", duplicate: false, restored: false, ...extra });

async function withServer(
  routes: Record<string, FakeResponse>,
  args: string[],
) {
  const server = await startFakeServer(routes);
  try {
    return {
      ...(await run(args, { apiUrl: server.url, env })),
      requests: server.requests,
    };
  } finally {
    await server.close();
  }
}

test("add saves a Bookmark with every detail and prints the new id", async () => {
  const { code, stdout, stderr, requests } = await withServer(
    { ...collections, "POST /bookmarks": created() },
    [
      "add",
      "https://example.com/a",
      "--title",
      "Example",
      "--description",
      "About it",
      "--note",
      "Mine",
      "--tag",
      "dev",
      "--tag",
      "dev/js",
      "--collection",
      "col_1",
      "--type",
      "article",
      "--favorite",
    ],
  );
  assert.equal(code, 0, stderr);
  assert.equal(stdout, "bk_new\n");
  assert.equal(stderr, "");
  assert.deepEqual(requests[1].body, {
    url: "https://example.com/a",
    title: "Example",
    description: "About it",
    note: "Mine",
    tags: ["dev", "dev/js"],
    collectionId: "col_1",
    type: "article",
    isFavorite: true,
  });
});

test("add sends only the URL when no details are given", async () => {
  const { requests } = await withServer({ "POST /bookmarks": created() }, [
    "add",
    "https://example.com",
  ]);
  assert.deepEqual(requests[0].body, { url: "https://example.com" });
});

test("add --json prints the API's data unchanged", async () => {
  const { stdout } = await withServer(
    { "POST /bookmarks": created({ duplicate: true }) },
    ["add", "https://example.com", "--json"],
  );
  assert.deepEqual(JSON.parse(stdout), {
    bookmarkId: "bk_new",
    duplicate: true,
    restored: false,
  });
});

test("add says when the Bookmark was Restored from the Trash", async () => {
  const { code, stdout, stderr } = await withServer(
    { "POST /bookmarks": created({ restored: true }) },
    ["add", "https://example.com"],
  );
  assert.equal(code, 0);
  assert.equal(stdout, "bk_new\n");
  assert.match(stderr, /Restored from the Trash: bk_new/);
});

test("add warns when a duplicate was created", async () => {
  const { stdout, stderr } = await withServer(
    { "POST /bookmarks": created({ duplicate: true }) },
    ["add", "https://example.com"],
  );
  assert.equal(stdout, "bk_new\n");
  assert.match(stderr, /already saved, so a duplicate was created: bk_new/);
});

const long = (n: number) => "x".repeat(n);
const tags = (n: number) =>
  Array.from({ length: n }, (_, i) => ["--tag", `t${i}`]).flat();
for (const [args, message] of [
  [["add", "example.com"], /Not a valid http or https URL: example\.com/],
  [["add", "ftp://example.com"], /Not a valid http or https URL/],
  [
    ["add", `https://example.com/${long(2030)}`],
    /The URL can be at most 2048 characters/,
  ],
  [
    ["add", "https://e.com", "--title", long(101)],
    /The title can be at most 100 characters \(got 101\)/,
  ],
  [
    ["add", "https://e.com", "--description", long(501)],
    /The description can be at most 500/,
  ],
  [
    ["add", "https://e.com", "--note", long(501)],
    /The note can be at most 500/,
  ],
  [["add", "https://e.com", ...tags(11)], /at most 10 Tags \(got 11\)/],
  [
    ["add", "https://e.com", "--tag", long(26)],
    /The Tag name "x+" can be at most 25/,
  ],
  [["add", "https://e.com", "--tag", " "], /Tag names can't be empty/],
  [
    ["add", "https://e.com", "--type", "pdf"],
    /--type must be one of: link, article, image, video, document/,
  ],
  [["edit", "bk_1"], /Nothing to change/],
  [["edit", "bk_1", "--url", "nope"], /Not a valid http or https URL/],
  [["edit", "bk_1", "--title", long(101)], /The title can be at most 100/],
] as const) {
  test(`${args.slice(0, 3).join(" ").slice(0, 40)}… exits 2 before sending`, async () => {
    const { code, stderr, requests } = await withServer(
      { "POST /bookmarks": created(), "PATCH /bookmarks/bk_1": ok({}) },
      [...args],
    );
    assert.equal(code, 2);
    assert.match(stderr, message);
    assert.equal(requests.length, 0);
  });
}

test("the limits themselves are accepted", async () => {
  const { code, stderr } = await withServer({ "POST /bookmarks": created() }, [
    "add",
    `https://example.com/${long(2048 - 20)}`,
    "--title",
    long(100),
    "--note",
    long(500),
    "--tag",
    long(25),
    ...tags(9),
  ]);
  assert.equal(code, 0, stderr);
});

test("edit sends only the fields given", async () => {
  const { code, stderr, requests } = await withServer(
    { "PATCH /bookmarks/bk_1": ok({ id: "bk_1" }) },
    [
      "edit",
      "bk_1",
      "--title",
      "New",
      "--url",
      "https://example.org",
      "--description",
      "D",
      "--note",
      "N",
    ],
  );
  assert.equal(code, 0, stderr);
  assert.match(stderr, /Updated bk_1/);
  assert.equal(requests[0].method, "PATCH");
  assert.deepEqual(requests[0].body, {
    title: "New",
    description: "D",
    note: "N",
    url: "https://example.org",
  });
});

test("edit --json prints the API's data unchanged", async () => {
  const { stdout } = await withServer(
    { "PATCH /bookmarks/bk_1": ok({ id: "bk_1", title: "New" }) },
    ["edit", "bk_1", "--title", "New", "--json"],
  );
  assert.deepEqual(JSON.parse(stdout), { id: "bk_1", title: "New" });
});

test("edit exits 4 for an unknown id", async () => {
  const { code, stderr } = await withServer(
    {
      "PATCH /bookmarks/nope": apiError(404, "NOT_FOUND", "Bookmark not found"),
    },
    ["edit", "nope", "--title", "x"],
  );
  assert.equal(code, 4);
  assert.match(stderr, /Bookmark not found/);
});
