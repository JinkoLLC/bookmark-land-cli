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
const dev = {
  id: "col_dev",
  name: "Development",
  parentId: null,
  depth: 0,
  bookmarkCount: 24,
};
const fe = {
  id: "col_fe",
  name: "Frontend",
  parentId: "col_dev",
  depth: 1,
  bookmarkCount: 15,
};
const work1 = {
  id: "col_w1",
  name: "Work",
  parentId: null,
  depth: 0,
  bookmarkCount: 3,
};
const work2 = {
  id: "col_w2",
  name: "Work",
  parentId: "col_dev",
  depth: 1,
  bookmarkCount: 1,
};
const all = [fe, dev, work1, work2];
// Two pages, to check that every page is fetched.
const pages = {
  "GET /collections": (req: FakeRequest): FakeResponse =>
    req.query.cursor === "p2"
      ? ok({ collections: all.slice(2), nextCursor: null })
      : ok({ collections: all.slice(0, 2), nextCursor: "p2" }),
};

type Routes = Record<
  string,
  FakeResponse | FakeResponse[] | ((req: FakeRequest) => FakeResponse)
>;
async function withServer(
  routes: Routes,
  args: string[],
  runner: (args: string[], options: object) => Promise<RunResult> = run,
) {
  const server = await startFakeServer(routes);
  try {
    return {
      ...(await runner(args, { apiUrl: server.url, env })),
      requests: server.requests,
    };
  } finally {
    await server.close();
  }
}
const calls = (requests: FakeRequest[]) =>
  requests.map((r) => `${r.method} ${r.path}`);

test("collections list follows every page and prints TSV when piped", async () => {
  const { code, stdout, requests } = await withServer(pages, [
    "collections",
    "list",
  ]);
  assert.equal(code, 0);
  assert.equal(
    stdout,
    [
      "col_dev\tDevelopment\t24\t",
      "col_fe\tFrontend\t15\tcol_dev",
      "col_w2\tWork\t1\tcol_dev",
      "col_w1\tWork\t3\t",
      "",
    ].join("\n"),
  );
  assert.deepEqual(
    requests.map((r) => r.query),
    [{}, { cursor: "p2" }],
  );
});

test("collections list shows the nesting on a terminal", {
  skip: noTty,
}, async () => {
  const { stdout } = await withServer(pages, ["collections", "list"], runTty);
  const lines = stdout.trimEnd().split("\n");
  assert.match(lines[0], /^ID +NAME +BOOKMARKS +PARENT$/);
  assert.match(lines[1], /^col_dev {2}Development {2}/);
  assert.match(lines[2], /^col_fe {5}Frontend/);
});

test("collections list --json prints every Collection", async () => {
  const { stdout } = await withServer(pages, ["collections", "list", "--json"]);
  assert.deepEqual(JSON.parse(stdout), { collections: all, nextCursor: null });
});

test("collections list --trashed lists the Collections in the Trash", async () => {
  const { stdout, requests } = await withServer(
    {
      "GET /collections/trashed": ok({
        collections: [work1],
        nextCursor: null,
      }),
    },
    ["collections", "list", "--trashed"],
  );
  assert.equal(stdout, "col_w1\tWork\t3\t\n");
  assert.deepEqual(calls(requests), ["GET /collections/trashed"]);
});

test("a Collection can be named by its exact name or its id", async () => {
  const routes = {
    ...pages,
    "GET /collections/col_fe": ok({ ...fe, notes: "Frontend resources" }),
  };
  for (const name of ["Frontend", "col_fe"]) {
    const { code, stdout, requests } = await withServer(routes, [
      "collections",
      "show",
      name,
    ]);
    assert.equal(code, 0);
    assert.match(stdout, /^id: +col_fe$/m);
    assert.match(stdout, /^notes: +Frontend resources$/m);
    assert.equal(requests.at(-1)?.path, "/collections/col_fe");
  }
});

test("an ambiguous name exits 2 and lists each match with its id and parent", async () => {
  const { code, stdout, stderr, requests } = await withServer(pages, [
    "collections",
    "show",
    "Work",
  ]);
  assert.equal(code, 2);
  assert.equal(stdout, "");
  assert.match(stderr, /2 Collections are named "Work"\. Use an id instead:/);
  assert.match(stderr, /col_w1 {2}Work \(top level\)/);
  assert.match(stderr, /col_w2 {2}Work \(in Development\)/);
  assert.equal(requests.filter((r) => r.path !== "/collections").length, 0);
});

test("an unknown name exits 4", async () => {
  const { code, stderr } = await withServer(pages, [
    "collections",
    "show",
    "Nope",
  ]);
  assert.equal(code, 4);
  assert.match(stderr, /No Collection is named "Nope"/);
});

test("collections show --json prints the API's data unchanged", async () => {
  const { stdout } = await withServer(
    { ...pages, "GET /collections/col_fe": ok(fe) },
    ["collections", "show", "col_fe", "--json"],
  );
  assert.deepEqual(JSON.parse(stdout), fe);
});

test("collections add creates a Collection under a named parent", async () => {
  const created = { id: "col_new", name: "React" };
  const { code, stderr, stdout, requests } = await withServer(
    { ...pages, "POST /collections": ok(created) },
    [
      "collections",
      "add",
      "React",
      "--parent",
      "Frontend",
      "--icon",
      "atom",
      "--color",
      "blue",
    ],
  );
  assert.equal(code, 0, stderr);
  assert.match(stderr, /Created Collection "React"/);
  assert.match(stdout, /^id: +col_new$/m);
  assert.deepEqual(requests.at(-1)?.body, {
    name: "React",
    icon: "atom",
    color: "blue",
    parentId: "col_fe",
  });

  const json = await withServer({ "POST /collections": ok(created) }, [
    "collections",
    "add",
    "React",
    "--json",
  ]);
  assert.deepEqual(JSON.parse(json.stdout), created);
  assert.deepEqual(json.requests[0].body, { name: "React" });
});

test("collections edit changes the given fields", async () => {
  const { code, stderr, requests } = await withServer(
    { ...pages, "PATCH /collections/col_fe": ok({ ...fe, name: "Web" }) },
    [
      "collections",
      "edit",
      "Frontend",
      "--name",
      "Web",
      "--notes",
      "All things web",
    ],
  );
  assert.equal(code, 0, stderr);
  assert.match(stderr, /Updated Collection col_fe/);
  assert.deepEqual(requests.at(-1)?.body, {
    name: "Web",
    notes: "All things web",
  });
});

for (const [args, message] of [
  [
    ["collections", "add", "x".repeat(51)],
    /A Collection name can be at most 50 characters/,
  ],
  [
    ["collections", "edit", "col_fe", "--name", "x".repeat(51)],
    /at most 50 characters/,
  ],
  [
    ["collections", "edit", "col_fe", "--notes", "x".repeat(20_001)],
    /Collection notes can be at most 20000/,
  ],
  [["collections", "edit", "col_fe"], /Nothing to change/],
] as const) {
  test(`${args.slice(0, 3).join(" ")} with bad input exits 2 before sending`, async () => {
    const { code, stderr, requests } = await withServer(pages, [...args]);
    assert.equal(code, 2);
    assert.match(stderr, message);
    assert.equal(requests.length, 0);
  });
}

test("collections rm Removes the Collection and says how to Restore it", async () => {
  const { code, stdout, stderr, requests } = await withServer(
    { ...pages, "DELETE /collections/col_fe": ok({ success: true }) },
    ["collections", "rm", "Frontend"],
  );
  assert.equal(code, 0);
  assert.equal(stdout, "col_fe\n");
  assert.match(
    stderr,
    /Removed Collection col_fe\. Restore it with: bookmark collections restore col_fe/,
  );
  assert.equal(calls(requests).at(-1), "DELETE /collections/col_fe");
});

test("collections restore looks the name up in the Trash", async () => {
  const { code, stderr, requests } = await withServer(
    {
      "GET /collections/trashed": ok({
        collections: [work1],
        nextCursor: null,
      }),
      "POST /collections/col_w1/restore": ok({ success: true }),
    },
    ["collections", "restore", "Work"],
  );
  assert.equal(code, 0, stderr);
  assert.match(stderr, /Restored Collection col_w1/);
  assert.deepEqual(calls(requests), [
    "GET /collections/trashed",
    "POST /collections/col_w1/restore",
  ]);
});

test("a Collection that is too large to Remove gets a clear message", async () => {
  const { code, stderr } = await withServer(
    {
      ...pages,
      "DELETE /collections/col_dev": apiError(
        422,
        "COLLECTION_TOO_LARGE",
        "Collection too large",
      ),
    },
    ["collections", "rm", "Development"],
  );
  assert.equal(code, 1);
  assert.match(
    stderr,
    /more than 1,000 Collections and Bookmarks .* nothing was changed/,
  );
  assert.match(stderr, /\(request id: req_test\)/);
});

test("collections restore keeps the request id on COLLECTION_TOO_LARGE with --json", async () => {
  const { code, stderr } = await withServer(
    {
      "GET /collections/trashed": ok({
        collections: [work1],
        nextCursor: null,
      }),
      "POST /collections/col_w1/restore": apiError(422, "COLLECTION_TOO_LARGE"),
    },
    ["collections", "restore", "col_w1", "--json"],
  );
  assert.equal(code, 1);
  const { error } = JSON.parse(stderr);
  assert.equal(error.code, "COLLECTION_TOO_LARGE");
  assert.equal(error.requestId, "req_test");
  assert.match(error.message, /more than 1,000/);
});

test("collections share shows whether it is shared, and its link", async () => {
  const share = { shared: true, publicUrl: "/shared/frontend-resources" };
  const routes = { ...pages, "GET /collections/col_fe/share": ok(share) };
  const { stdout } = await withServer(routes, [
    "collections",
    "share",
    "Frontend",
  ]);
  assert.equal(stdout, "Shared: yes\nLink:   /shared/frontend-resources\n");
  const json = await withServer(routes, [
    "collections",
    "share",
    "Frontend",
    "--json",
  ]);
  assert.deepEqual(JSON.parse(json.stdout), share);
});

test("list --collection and add --collection accept names", async () => {
  const page = ok({ data: [], cursor: null, hasMore: false, truncated: false });
  const list = await withServer({ ...pages, "GET /bookmarks": page }, [
    "list",
    "--collection",
    "Frontend",
  ]);
  assert.equal(list.code, 0);
  assert.deepEqual(list.requests.at(-1)?.query, { collectionId: "col_fe" });

  const add = await withServer(
    {
      ...pages,
      "POST /bookmarks": ok({
        bookmarkId: "bk_1",
        duplicate: false,
        restored: false,
      }),
    },
    ["add", "https://example.com", "--collection", "Development"],
  );
  assert.equal(add.code, 0);
  assert.deepEqual(add.requests.at(-1)?.body, {
    url: "https://example.com",
    collectionId: "col_dev",
  });

  const ambiguous = await withServer(pages, ["list", "--collection", "Work"]);
  assert.equal(ambiguous.code, 2);
});

test("add --collection unsorted is rejected with a hint", async () => {
  const { code, stderr, requests } = await withServer(pages, [
    "add",
    "https://example.com",
    "--collection",
    "Unsorted",
  ]);
  assert.equal(code, 2);
  assert.match(stderr, /go to Unsorted by default: leave out --collection/);
  assert.equal(requests.length, 0);
});

test("bookmark collections lists the group's commands", async () => {
  const { code, stdout } = await run(["collections"]);
  assert.equal(code, 0);
  assert.match(stdout, /collections list +List your Collections/);
  assert.match(stdout, /collections share/);
  const unknown = await run(["collections", "frob"]);
  assert.equal(unknown.code, 2);
  assert.match(
    unknown.stderr,
    /Unknown command: collections frob\. Run: bookmark collections --help/,
  );
});
