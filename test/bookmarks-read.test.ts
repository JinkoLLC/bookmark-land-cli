import assert from "node:assert/strict";
import { test } from "node:test";
import {
  apiError,
  type FakeResponse,
  ok,
  startFakeServer,
} from "./fake-server.ts";
import { fakeBrowser, noTty, type RunResult, run, runTty } from "./helpers.ts";

const env = { BOOKMARK_TOKEN: "bkl_env" };
const long =
  "A very long title that will never fit in an eighty column terminal without being cut";
const bookmarks = [
  {
    id: "bk_1",
    url: "https://example.com/a",
    title: long,
    domain: "example.com",
    tags: ["dev", "reference"],
    isFavorite: true,
    note: "Read\tthis",
    siteRisk: { level: "endOfLife", findingCount: 1 },
    coverImage: null,
  },
  { id: "bk_2", url: "https://github.com/x", domain: "github.com", tags: [] },
];
const page = (extra = {}) =>
  ok({
    data: bookmarks,
    cursor: null,
    hasMore: false,
    truncated: false,
    ...extra,
  });

async function withServer(
  routes: Record<string, FakeResponse | FakeResponse[]>,
  args: string[],
  runner: (args: string[], options: object) => Promise<RunResult> = run,
  extraEnv: Record<string, string> = {},
) {
  const server = await startFakeServer(routes);
  try {
    const result = await runner(args, {
      apiUrl: server.url,
      env: { ...env, ...extraEnv },
    });
    return { ...result, requests: server.requests };
  } finally {
    await server.close();
  }
}

test("list prints tab-separated values when piped", async () => {
  const { code, stdout, stderr, requests } = await withServer(
    { "GET /bookmarks": page() },
    ["list"],
  );
  assert.equal(code, 0, stderr);
  assert.equal(
    stdout,
    `bk_1\t${long}\texample.com\tdev,reference\nbk_2\thttps://github.com/x\tgithub.com\t\n`,
  );
  assert.equal(stderr, "");
  assert.deepEqual(requests[0].query, {});
  assert.equal(requests[0].headers.authorization, "Bearer bkl_env");
});

test("list shows a table that fits the terminal", { skip: noTty }, async () => {
  const { stdout } = await withServer(
    { "GET /bookmarks": page() },
    ["list"],
    runTty,
  );
  const lines = stdout.trimEnd().split("\n");
  assert.match(lines[0], /^ID {4}TITLE +DOMAIN {7}TAGS$/);
  assert.match(
    lines[1],
    /^bk_1 {2}A very long title.*… {2}example\.com {2}dev,reference$/,
  );
  assert.match(lines[2], /^bk_2 {2}https:\/\/github\.com\/x +github\.com$/);
  for (const line of lines) assert.ok(line.length <= 80, `too wide: ${line}`);
  assert.ok(!stdout.includes("\x1b["), "no color with NO_COLOR");
});

test("list rows never overflow the terminal, even with long Tags", {
  skip: noTty,
}, async () => {
  const wide = {
    id: "bk_3",
    url: "https://developer.mozilla.org/x",
    title: "MDN",
    domain: "developer.mozilla.org",
    tags: ["javascript", "typescript", "web-development", "reference", "docs"],
  };
  const { stdout } = await withServer(
    {
      "GET /bookmarks": ok({
        data: [wide],
        cursor: null,
        hasMore: false,
        truncated: false,
      }),
    },
    ["list"],
    runTty,
  );
  const lines = stdout.trimEnd().split("\n");
  for (const line of lines) assert.ok(line.length <= 80, `too wide: ${line}`);
  assert.match(
    lines[1],
    /^bk_3 {2}MDN.*developer\.mozilla\.org {2}javascript,.*…$/,
  );
});

test("list uses color on a terminal unless NO_COLOR is set", {
  skip: noTty,
}, async () => {
  const { stdout } = await withServer(
    { "GET /bookmarks": page() },
    ["list"],
    runTty,
    { NO_COLOR: "" },
  );
  assert.ok(stdout.includes("\x1b[1mID"), stdout);
});

test("list --json prints the API's data unchanged", async () => {
  const data = {
    data: bookmarks,
    cursor: "c2",
    hasMore: true,
    truncated: false,
  };
  const { code, stdout, stderr } = await withServer(
    { "GET /bookmarks": ok(data) },
    ["list", "--json"],
  );
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(stdout), data);
  assert.equal(stderr, ""); // no cursor hint in JSON mode
});

test("list sends every filter as a query parameter", async () => {
  const { code, requests } = await withServer({ "GET /bookmarks": page() }, [
    "list",
    "--limit",
    "200",
    "--cursor",
    "c1",
    "--sort",
    "title",
    "--favorite",
    "--domain",
    "github.com",
    "--type",
    "article",
    "--collection",
    "col_1",
  ]);
  assert.equal(code, 0);
  assert.deepEqual(requests[0].query, {
    limit: "200",
    cursor: "c1",
    sortBy: "title",
    isFavorite: "true",
    domain: "github.com",
    type: "article",
    collectionId: "col_1",
  });
});

test("list checks --limit, --sort and --type before sending", async () => {
  for (const args of [
    ["--limit", "0"],
    ["--limit", "201"],
    ["--limit", "ten"],
    ["--sort", "random"],
    ["--type", "pdf"],
  ]) {
    const { code, stderr, requests } = await withServer(
      { "GET /bookmarks": page() },
      ["list", ...args],
    );
    assert.equal(code, 2, args.join(" "));
    assert.match(stderr, new RegExp(`--${args[0].slice(2)} must be`));
    assert.equal(requests.length, 0);
  }
});

test("list ends with the next --cursor when there are more results", async () => {
  const { stdout, stderr } = await withServer(
    { "GET /bookmarks": page({ cursor: "eyJwb3MiOjUwfQ", hasMore: true }) },
    ["list"],
  );
  assert.equal(stdout.split("\n").length, 3);
  assert.equal(
    stderr,
    "More results. Next page: add --cursor eyJwb3MiOjUwfQ\n",
  );
});

test("list warns when a favorites sort could not cover every favorite", async () => {
  const { code, stderr } = await withServer(
    { "GET /bookmarks": page({ truncated: true }) },
    ["list", "--favorite", "--sort", "title"],
  );
  assert.equal(code, 0);
  assert.match(
    stderr,
    /Only your most recently saved favorites were sorted\. Use --sort newest or --sort oldest/,
  );
});

test("list and show drop terminal control sequences from API text", async () => {
  const evil = { ...bookmarks[1], title: "Hi\x1b]0;pwned\x07\x1b[2J there" };
  const list = await withServer(
    {
      "GET /bookmarks": ok({
        data: [evil],
        cursor: null,
        hasMore: false,
        truncated: false,
      }),
    },
    ["list"],
  );
  const show = await withServer({ "GET /bookmarks/bk_2": ok(evil) }, [
    "show",
    "bk_2",
  ]);
  for (const { stdout } of [list, show]) {
    assert.match(stdout, /Hi \]0;pwned \[2J there/);
    assert.ok(!stdout.includes("\x1b") && !stdout.includes("\x07"), stdout);
  }
});

test("search lists the matches; --json prints the array", async () => {
  const routes = { "GET /bookmarks/search": ok(bookmarks) };
  const piped = await withServer(routes, ["search", "react", "hooks"]);
  assert.equal(piped.code, 0);
  assert.equal(
    piped.stdout.split("\n")[0],
    `bk_1\t${long}\texample.com\tdev,reference`,
  );
  assert.deepEqual(piped.requests[0].query, { q: "react hooks" });

  const json = await withServer(routes, ["search", "react", "--json"]);
  assert.deepEqual(JSON.parse(json.stdout), bookmarks);

  assert.equal((await run(["search"], { env })).code, 2);
});

test("search shows a table on a terminal", { skip: noTty }, async () => {
  const { stdout } = await withServer(
    { "GET /bookmarks/search": ok(bookmarks) },
    ["search", "x"],
    runTty,
  );
  assert.match(stdout, /^ID {4}TITLE/);
});

test("show prints every field the API returns, skipping missing ones", async () => {
  const { code, stdout, requests } = await withServer(
    { "GET /bookmarks/bk_1": ok(bookmarks[0]) },
    ["show", "bk_1"],
  );
  assert.equal(code, 0);
  assert.equal(
    stdout,
    [
      "id:         bk_1",
      "url:        https://example.com/a",
      `title:      ${long}`,
      "domain:     example.com",
      "tags:       dev, reference",
      "isFavorite: true",
      "note:       Read this", // the tab is dropped like any control character
      "siteRisk:   level: endOfLife, findingCount: 1",
      "",
    ].join("\n"),
  );
  assert.equal(requests[0].path, "/bookmarks/bk_1");

  const json = await withServer({ "GET /bookmarks/bk_1": ok(bookmarks[0]) }, [
    "show",
    "bk_1",
    "--json",
  ]);
  assert.deepEqual(JSON.parse(json.stdout), bookmarks[0]);
});

test("show and open exit 4 for an unknown id", async () => {
  for (const command of ["show", "open"]) {
    const { code, stdout, stderr } = await withServer(
      {
        "GET /bookmarks/nope": apiError(404, "NOT_FOUND", "Bookmark not found"),
      },
      [command, "nope"],
    );
    assert.equal(code, 4);
    assert.equal(stdout, "");
    assert.match(stderr, /Bookmark not found/);
  }
});

test("show and open need exactly one id", async () => {
  for (const args of [["show"], ["open", "a", "b"]]) {
    const { code, stderr } = await run(args, { env });
    assert.equal(code, 2);
    assert.match(stderr, /Usage: bookmark (show|open) <id>/);
  }
});

test("open prints the URL and opens it in the browser", async () => {
  const browser = fakeBrowser();
  const url = "https://example.com/a?x=1&y='2'";
  const { code, stdout, stderr } = await withServer(
    { "GET /bookmarks/bk_1": ok({ ...bookmarks[0], url }) },
    ["open", "bk_1"],
    run,
    browser.env,
  );
  assert.equal(code, 0, stderr);
  assert.equal(stdout, `${url}\n`);
  if (process.platform !== "win32") assert.equal(await browser.opened(), url);
});

test("open refuses URLs that aren't http or https", async () => {
  const browser = fakeBrowser();
  const { code, stdout } = await withServer(
    {
      "GET /bookmarks/bk_1": ok({ ...bookmarks[0], url: "file:///etc/passwd" }),
    },
    ["open", "bk_1"],
    run,
    browser.env,
  );
  assert.equal(code, 1);
  assert.equal(stdout, "file:///etc/passwd\n");
  if (process.platform !== "win32")
    assert.equal(await browser.opened(), undefined);
});
