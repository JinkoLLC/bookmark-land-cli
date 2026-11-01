import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import {
  apiError,
  type FakeRequest,
  type FakeResponse,
  ok,
  startFakeServer,
} from "./fake-server.ts";
import { configHome, run } from "./helpers.ts";

const env = { BOOKMARK_TOKEN: "bkl_env" };
const ai = {
  id: "sf_ai",
  name: "AI reading",
  rules: {
    match: "all",
    conditions: [
      { field: "tag", operator: "contains", value: "ai" },
      { field: "createdAfter", operator: "equals", value: "1767225600000" },
    ],
  },
};
const gh = {
  id: "sf_gh",
  name: "GitHub",
  rules: {
    match: "any",
    conditions: [{ field: "domain", operator: "equals", value: "github.com" }],
  },
};
const folders = { "GET /smart-folders": ok([ai, gh]) };
const bk = (id: string) => ({
  id,
  url: `https://example.com/${id}`,
  title: id,
  tags: [],
});

type Routes = Record<
  string,
  FakeResponse | FakeResponse[] | ((req: FakeRequest) => FakeResponse)
>;
async function withServer(routes: Routes, args: string[], input?: string) {
  const server = await startFakeServer(routes);
  try {
    return {
      ...(await run(args, { apiUrl: server.url, env, input })),
      requests: server.requests,
    };
  } finally {
    await server.close();
  }
}

test("smart-folders list shows each Smart folder's rules", async () => {
  const { code, stdout } = await withServer(folders, ["smart-folders", "list"]);
  assert.equal(code, 0);
  assert.equal(
    stdout,
    "sf_ai\tAI reading\ttag contains ai and created-after equals 2026-01-01\nsf_gh\tGitHub\tdomain equals github.com\n",
  );
  const json = await withServer(folders, ["smart-folders", "list", "--json"]);
  assert.deepEqual(JSON.parse(json.stdout), [ai, gh]);
});

test("smart-folders list shows a date it can't read as it is", async () => {
  const odd = {
    ...gh,
    rules: {
      match: "all",
      conditions: [
        { field: "createdAfter", operator: "equals", value: "soon" },
      ],
    },
  };
  const { code, stdout, stderr } = await withServer(
    { "GET /smart-folders": ok([odd, ai]) },
    ["smart-folders", "list"],
  );
  assert.equal(code, 0, stderr);
  assert.match(stdout, /^sf_gh\tGitHub\tcreated-after equals soon$/m);
  assert.match(stdout, /created-after equals 2026-01-01$/m);
});

test("smart-folders show finds a Smart folder by name or id", async () => {
  const routes = { ...folders, "GET /smart-folders/sf_ai": ok(ai) };
  for (const name of ["AI reading", "sf_ai"]) {
    const { code, stdout, requests } = await withServer(routes, [
      "smart-folders",
      "show",
      name,
    ]);
    assert.equal(code, 0);
    assert.match(stdout, /^match: +all$/m);
    assert.match(stdout, /^rule: +tag contains ai$/m);
    assert.match(stdout, /^rule: +created-after equals 2026-01-01$/m);
    assert.equal(requests.at(-1)?.path, "/smart-folders/sf_ai");
  }
  const ambiguous = await withServer(
    { "GET /smart-folders": ok([ai, { ...gh, name: "AI reading" }]) },
    ["smart-folders", "show", "AI reading"],
  );
  assert.equal(ambiguous.code, 2);
  assert.match(ambiguous.stderr, /2 Smart folders are named "AI reading"/);
});

test("smart-folders add turns readable rules into the API's format", async () => {
  const { code, stderr, requests } = await withServer(
    { "POST /smart-folders": ok({ id: "sf_new" }) },
    [
      "smart-folders",
      "add",
      "Recent AI",
      "--rule",
      "tag contains machine learning",
      "--rule",
      "created-after equals 2026-01-01",
      "--rule",
      "created-before equals 2026-02-01T12:00:00Z",
      "--rule",
      "is-favorite equals true",
      "--rule",
      "click-count gte 5",
      "--rule",
      "type equals article",
      "--match",
      "any",
    ],
  );
  assert.equal(code, 0, stderr);
  assert.match(stderr, /Created Smart folder "Recent AI"/);
  assert.deepEqual(requests[0].body, {
    name: "Recent AI",
    rules: {
      match: "any",
      conditions: [
        { field: "tag", operator: "contains", value: "machine learning" },
        {
          field: "createdAfter",
          operator: "equals",
          value: String(Date.UTC(2026, 0, 1)),
        },
        {
          field: "createdBefore",
          operator: "equals",
          value: String(Date.UTC(2026, 1, 1, 12)),
        },
        { field: "isFavorite", operator: "equals", value: "true" },
        { field: "clickCount", operator: "gte", value: "5" },
        { field: "type", operator: "equals", value: "article" },
      ],
    },
  });
});

test("smart-folders add --rules-json takes the API's format from a file or stdin", async () => {
  const file = join(configHome, "rules.json");
  await writeFile(file, JSON.stringify(gh.rules));
  const routes = { "POST /smart-folders": ok({ id: "sf_new" }) };
  const fromFile = await withServer(routes, [
    "smart-folders",
    "add",
    "GitHub",
    "--rules-json",
    file,
    "--json",
  ]);
  assert.equal(fromFile.code, 0, fromFile.stderr);
  assert.deepEqual(fromFile.requests[0].body, {
    name: "GitHub",
    rules: gh.rules,
  });
  assert.deepEqual(JSON.parse(fromFile.stdout), { id: "sf_new" });

  const fromStdin = await withServer(
    routes,
    ["smart-folders", "add", "AI", "--rules-json", "-"],
    JSON.stringify(ai.rules),
  );
  assert.equal(fromStdin.code, 0, fromStdin.stderr);
  assert.deepEqual(fromStdin.requests[0].body, { name: "AI", rules: ai.rules });
});

const elevenRules = Array.from({ length: 11 }, () => [
  "--rule",
  "tag equals x",
]).flat();
for (const [args, message, input] of [
  [
    ["--rule", "color equals red"],
    /Can't read the rule "color equals red"\. Valid rules:\n {2}tag equals\|contains/,
  ],
  [["--rule", "tag"], /Can't read the rule/],
  [["--rule", "constructor equals x"], /Can't read the rule/],
  [["--rule", "tag gte 5"], /"tag" rules use equals or contains, not "gte"/],
  [
    ["--rule", "type equals pdf"],
    /must be link, article, image, video or document/,
  ],
  [["--rule", "is-favorite equals yes"], /must be true or false/],
  [["--rule", "click-count gte many"], /must be a whole number/],
  [
    ["--rule", "created-after equals someday"],
    /must be a date, such as 2026-01-01/,
  ],
  [["--rule", `tag equals ${"x".repeat(501)}`], /at most 500 characters/],
  [elevenRules, /1 to 10 rules \(got 11\)/],
  [[], /at least one --rule, or --rules-json/],
  [["--rule", "tag equals x", "--match", "some"], /--match must be all or any/],
  [
    ["--rule", "tag equals x", "--rules-json", "-"],
    /Use --rule or --rules-json, not both/,
  ],
  [["--rules-json", "-"], /isn't valid JSON/, "nope"],
  [["--rules-json", "-"], /must look like/, '{"conditions": []}'],
  [
    ["--rules-json", "-"],
    /Unknown rule field/,
    '{"match":"all","conditions":[{"field":"color","operator":"equals","value":"x"}]}',
  ],
  [
    ["--rules-json", "-"],
    /must be milliseconds since 1970/,
    '{"match":"all","conditions":[{"field":"createdAfter","operator":"equals","value":"2026-01-01"}]}',
  ],
  [
    ["--rules-json", "-"],
    /1 to 10 rules \(got 0\)/,
    '{"match":"all","conditions":[]}',
  ],
  [
    ["--rules-json", "-"],
    /Unknown rule field/,
    '{"match":"all","conditions":[{"field":["tag"],"operator":"equals","value":"x"}]}',
  ],
  [["--rules-json", "missing.json"], /Can't read missing\.json/],
] as const) {
  test(`smart-folders add ${args.slice(0, 2).join(" ").slice(0, 40)} exits 2 before sending`, async () => {
    const { code, stderr, requests } = await withServer(
      { "POST /smart-folders": ok({}) },
      ["smart-folders", "add", "Name", ...args],
      input,
    );
    assert.equal(code, 2, stderr);
    assert.match(stderr, message);
    assert.equal(requests.length, 0);
  });
}

test("smart-folders add checks the name length", async () => {
  const { code, stderr } = await withServer({}, [
    "smart-folders",
    "add",
    "x".repeat(51),
    "--rule",
    "tag equals x",
  ]);
  assert.equal(code, 2);
  assert.match(stderr, /A Smart folder name can be at most 50 characters/);
});

test("smart-folders edit changes the name, icon, color or rules", async () => {
  const routes = { ...folders, "PATCH /smart-folders/sf_gh": ok(gh) };
  const { code, stderr, requests } = await withServer(routes, [
    "smart-folders",
    "edit",
    "GitHub",
    "--name",
    "Code",
    "--icon",
    "github",
    "--color",
    "gray",
    "--rule",
    "domain contains github",
  ]);
  assert.equal(code, 0, stderr);
  assert.match(stderr, /Updated Smart folder sf_gh/);
  assert.deepEqual(requests.at(-1)?.body, {
    name: "Code",
    icon: "github",
    color: "gray",
    rules: {
      match: "all",
      conditions: [{ field: "domain", operator: "contains", value: "github" }],
    },
  });
  const nothing = await withServer(routes, ["smart-folders", "edit", "GitHub"]);
  assert.equal(nothing.code, 2);
  const matchOnly = await withServer(routes, [
    "smart-folders",
    "edit",
    "GitHub",
    "--match",
    "any",
  ]);
  assert.equal(matchOnly.code, 2);
  assert.match(matchOnly.stderr, /--match needs at least one --rule/);
});

test("smart-folders rm deletes the Smart folder and leaves its Bookmarks alone", async () => {
  const { code, stderr, requests } = await withServer(
    { ...folders, "DELETE /smart-folders/sf_gh": ok({ success: true }) },
    ["smart-folders", "rm", "GitHub"],
  );
  assert.equal(code, 0);
  assert.match(
    stderr,
    /Deleted Smart folder sf_gh\. Its Bookmarks are untouched/,
  );
  assert.deepEqual(
    requests.map((r) => `${r.method} ${r.path}`),
    ["GET /smart-folders", "DELETE /smart-folders/sf_gh"],
  );
});

test("smart-folders bookmarks follows the cursor through empty pages", async () => {
  const pages: Record<string, FakeResponse> = {
    "": ok({ bookmarks: [bk("bk_1")], continueCursor: "c1", truncated: false }),
    c1: ok({ bookmarks: [], continueCursor: "c2", truncated: false }),
    c2: ok({ bookmarks: [bk("bk_2")], continueCursor: null, truncated: true }),
  };
  const routes = {
    ...folders,
    "GET /smart-folders/sf_ai/bookmarks": (req: FakeRequest) =>
      pages[req.query.cursor ?? ""],
  };
  const { code, stdout, requests } = await withServer(routes, [
    "smart-folders",
    "bookmarks",
    "AI reading",
  ]);
  assert.equal(code, 0);
  assert.equal(stdout, "bk_1\tbk_1\t\t\nbk_2\tbk_2\t\t\n");
  assert.deepEqual(
    requests.slice(1).map((r) => r.query),
    [{}, { cursor: "c1" }, { cursor: "c2" }],
  );
  const json = await withServer(routes, [
    "smart-folders",
    "bookmarks",
    "sf_ai",
    "--json",
  ]);
  assert.deepEqual(JSON.parse(json.stdout), {
    bookmarks: [bk("bk_1"), bk("bk_2")],
    continueCursor: null,
    truncated: true,
  });
});

test("a restart forgets what the discarded pages said", async () => {
  let restarted = false;
  const routes = {
    ...folders,
    "GET /smart-folders/sf_ai/bookmarks": (req: FakeRequest) => {
      if (!req.query.cursor)
        return ok({
          bookmarks: [bk("bk_1")],
          continueCursor: "c1",
          truncated: !restarted,
        });
      if (restarted)
        return ok({ bookmarks: [], continueCursor: null, truncated: false });
      restarted = true;
      return apiError(400, "SMART_FOLDER_CURSOR_INVALID", "Cursor invalid");
    },
  };
  const { code, stdout } = await withServer(routes, [
    "smart-folders",
    "bookmarks",
    "sf_ai",
    "--json",
  ]);
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(stdout), {
    bookmarks: [bk("bk_1")],
    continueCursor: null,
    truncated: false,
  });
});

test("smart-folders bookmarks starts over once when the cursor is invalid", async () => {
  let restarted = false;
  const routes = {
    ...folders,
    "GET /smart-folders/sf_ai/bookmarks": (req: FakeRequest) => {
      if (!req.query.cursor)
        return ok({
          bookmarks: [bk(restarted ? "bk_new" : "bk_old")],
          continueCursor: "c1",
        });
      if (!restarted) {
        restarted = true;
        return apiError(400, "SMART_FOLDER_CURSOR_INVALID", "Cursor invalid");
      }
      return ok({ bookmarks: [bk("bk_2")], continueCursor: null });
    },
  };
  const { code, stdout, requests } = await withServer(routes, [
    "smart-folders",
    "bookmarks",
    "sf_ai",
  ]);
  assert.equal(code, 0);
  assert.equal(stdout, "bk_new\tbk_new\t\t\nbk_2\tbk_2\t\t\n");
  assert.equal(requests.length, 1 + 4);

  const always = await withServer(
    {
      ...folders,
      "GET /smart-folders/sf_ai/bookmarks": (req: FakeRequest) =>
        req.query.cursor
          ? apiError(400, "SMART_FOLDER_CURSOR_INVALID", "Cursor invalid")
          : ok({ bookmarks: [], continueCursor: "c1" }),
    },
    ["smart-folders", "bookmarks", "sf_ai"],
  );
  assert.equal(always.code, 1); // only one restart
  assert.match(always.stderr, /Cursor invalid/);
});

test("smart-folders bookmarks exits 5 when rate limited", async () => {
  const { code, stderr } = await withServer(
    {
      ...folders,
      "GET /smart-folders/sf_ai/bookmarks": {
        status: 429,
        body: {
          error: { code: "RATE_LIMITED", message: "Rate limit exceeded" },
        },
        headers: { "retry-after": "60" },
      },
    },
    ["smart-folders", "bookmarks", "sf_ai"],
  );
  assert.equal(code, 5);
  assert.match(stderr, /Retry after \d\d:\d\d/);
});
