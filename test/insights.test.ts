import assert from "node:assert/strict";
import { test } from "node:test";
import {
  apiError,
  type FakeResponse,
  ok,
  startFakeServer,
} from "./fake-server.ts";
import { noTty, type RunResult, run, runTty } from "./helpers.ts";

const env = { BOOKMARK_TOKEN: "bkl_env" };
const stats = {
  total: 1234,
  favorites: 89,
  unsorted: 45,
  typeCounts: { link: 800, article: 300 },
  noTags: 200,
};
const domains = [
  { domain: "stackoverflow.com", count: 15 },
  { domain: "github.com", count: 42 },
];
const risky = [
  {
    id: "bk_1",
    url: "https://old.example.com",
    title: "Old site",
    domain: "old.example.com",
    tags: ["legacy"],
    siteRisk: { level: "endOfLife", findingCount: 1 },
  },
];
const scan = {
  site: "old.example.com",
  riskLevel: "vulnerable",
  scanOutcome: "ok",
  lastScannedAt: "2026-10-30T08:00:00.000Z",
  detectedSoftware: [
    { product: "PHP", version: "7.4.33" },
    { product: "nginx" },
  ],
  findings: [
    {
      product: "PHP",
      version: "7.4.33",
      level: "endOfLife",
      cycle: "7.4",
      eolDate: "2022-11-28",
    },
    {
      product: "PHP",
      version: "7.4.33",
      level: "vulnerable",
      cveId: "CVE-2024-4577",
      cvss: 9.8,
      kev: true,
    },
  ],
};
const usage = {
  bookmarkCount: 1234,
  trashedCount: 12,
  bookmarkLimit: 50000,
  plan: "pro",
  storage: {
    usedBytes: 52428800,
    limitBytes: 524288000,
    maxFileBytes: 10485760,
  },
};
const routes: Record<string, FakeResponse> = {
  "GET /bookmarks/stats": ok(stats),
  "GET /bookmarks/domains": ok(domains),
  "GET /bookmarks/vulnerable": ok(risky),
  "GET /bookmarks/bk_1/site-security": ok(scan),
  "GET /subscription/usage": ok(usage),
  "GET /collections": ok({
    collections: [{ id: "col_1", name: "Work", parentId: null }],
    nextCursor: null,
  }),
};

async function cli(
  args: string[],
  runner: (a: string[], o: object) => Promise<RunResult> = run,
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

test("stats shows totals, counts by type and Bookmarks without Tags", async () => {
  const { code, stdout } = await cli(["stats"]);
  assert.equal(code, 0);
  assert.equal(
    stdout,
    [
      "Total:        1234",
      "Favorites:    89",
      "Unsorted:     45",
      "Type link:    800",
      "Type article: 300",
      "Without Tags: 200",
      "",
    ].join("\n"),
  );
});

test("domains lists domains with the most Bookmarks first", async () => {
  const { code, stdout } = await cli(["domains"]);
  assert.equal(code, 0);
  assert.equal(stdout, "github.com\t42\nstackoverflow.com\t15\n");
});

test("domains shows a table on a terminal", { skip: noTty }, async () => {
  const { stdout } = await cli(["domains"], runTty);
  assert.equal(
    stdout,
    "DOMAIN             BOOKMARKS\ngithub.com         42\nstackoverflow.com  15\n",
  );
});

test("vulnerable lists Bookmarks in the usual output, with its filters", async () => {
  const { code, stdout, requests } = await cli([
    "vulnerable",
    "--limit",
    "100",
    "--collection",
    "Work",
    "--domain",
    "old.example.com",
    "--type",
    "link",
  ]);
  assert.equal(code, 0);
  assert.equal(stdout, "bk_1\tOld site\told.example.com\tlegacy\n");
  assert.deepEqual(requests.at(-1)?.query, {
    limit: "100",
    collectionId: "col_1",
    domain: "old.example.com",
    type: "link",
  });
});

test("vulnerable shows a table on a terminal", { skip: noTty }, async () => {
  const { stdout } = await cli(["vulnerable"], runTty);
  assert.match(stdout, /^ID {4}TITLE +DOMAIN +TAGS\nbk_1 {2}Old site/);
});

test("vulnerable checks --limit and --type before sending", async () => {
  for (const args of [
    ["--limit", "101"],
    ["--limit", "0"],
    ["--type", "pdf"],
  ]) {
    const { code, requests } = await cli(["vulnerable", ...args]);
    assert.equal(code, 2);
    assert.equal(requests.length, 0);
  }
});

test("security shows the risk level, scan outcome, software and findings", async () => {
  const { code, stdout, requests } = await cli(["security", "bk_1"]);
  assert.equal(code, 0);
  assert.equal(requests[0].path, "/bookmarks/bk_1/site-security");
  assert.equal(
    stdout,
    [
      "Site:       old.example.com",
      "Risk:       vulnerable",
      "Scan:       ok",
      "Scanned at: 2026-10-30T08:00:00.000Z",
      "Software:   PHP 7.4.33, nginx",
      "Finding:    endOfLife: PHP 7.4.33 (release line 7.4, end of life 2022-11-28)",
      "Finding:    vulnerable: PHP 7.4.33 (CVE-2024-4577, CVSS 9.8, known exploited)",
      "",
    ].join("\n"),
  );
});

test("security exits 4 for an unknown Bookmark", async () => {
  const server = await startFakeServer({
    "GET /bookmarks/nope/site-security": apiError(404, "NOT_FOUND"),
  });
  try {
    assert.equal(
      (await run(["security", "nope"], { apiUrl: server.url, env })).code,
      4,
    );
  } finally {
    await server.close();
  }
});

test("usage shows the plan, Bookmarks and storage against the limits", async () => {
  const { code, stdout } = await cli(["usage"]);
  assert.equal(code, 0);
  assert.equal(
    stdout,
    "Plan:         pro\nBookmarks:    1234 of 50000\nIn the Trash: 12\nStorage:      50.0 MB of 500.0 MB\n",
  );
});

test("key/value output is the same on a terminal", {
  skip: noTty,
}, async () => {
  const { stdout } = await cli(["usage"], runTty);
  assert.match(stdout, /^Plan: {9}pro\n/);
});

test("--json prints the API's data unchanged for every insight", async () => {
  for (const [args, data] of [
    [["stats"], stats],
    [["domains"], domains],
    [["vulnerable"], risky],
    [["security", "bk_1"], scan],
    [["usage"], usage],
  ] as const) {
    const { code, stdout } = await cli([...args, "--json"]);
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(stdout), data);
  }
});
