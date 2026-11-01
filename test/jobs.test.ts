import assert from "node:assert/strict";
import {
  mkdtemp,
  readdir,
  readFile,
  truncate,
  writeFile,
} from "node:fs/promises";
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
const html = Buffer.from(
  '\uFEFF<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<TITLE>Bookmarks</TITLE>\n<DL><DT><A HREF="https://example.com">x</A></DL>\n',
);
const bookmarksFile = async (bytes = html) => {
  const path = join(configHome, `bookmarks-${Math.random()}.html`);
  await writeFile(path, bytes);
  return path;
};
const done = (result: object) =>
  ok({
    id: "job_1",
    type: "import_html",
    status: "completed",
    progress: { processed: 3, total: 3 },
    result,
  });

type Routes = Record<
  string,
  FakeResponse | FakeResponse[] | ((req: FakeRequest) => FakeResponse)
>;
// The fake server also plays the storage service that upload and download URLs point to.
const importFlow = (overrides: Routes = {}): Routes => ({
  "POST /import/reserve": ok({ jobId: "job_1" }),
  "POST /import/upload-url": (req) =>
    ok({
      uploadUrl: `http://${req.headers.host}/storage/upload?token=one-time`,
      reservationId: "res_1",
    }),
  "POST /storage/upload": { body: { storageId: "st_1" } },
  "POST /import/claim-upload": ok({ success: true }),
  "POST /import/start": ok({ jobId: "job_1", status: "running" }),
  "GET /jobs/job_1": done({ total: 3, imported: 2, duplicates: 1, skipped: 0 }),
  "GET /collections": ok({
    collections: [{ id: "col_r", name: "Reading", parentId: null }],
    nextCursor: null,
  }),
  ...overrides,
});
async function cli(routes: Routes, args: string[], cwd?: string) {
  const server = await startFakeServer(routes);
  try {
    return {
      ...(await run(args, { apiUrl: server.url, env, cwd })),
      requests: server.requests,
    };
  } finally {
    await server.close();
  }
}
const calls = (requests: FakeRequest[]) =>
  requests.map((r) => `${r.method} ${r.path}`);

test("import runs every step back to back, then reports the counts", async () => {
  const file = await bookmarksFile();
  const { code, stdout, stderr, requests } = await cli(importFlow(), [
    "import",
    file,
  ]);
  assert.equal(code, 0, stderr);
  assert.equal(stdout, "");
  assert.match(stderr, /Imported 2 Bookmarks \(1 duplicates, 0 skipped\)/);
  assert.deepEqual(calls(requests), [
    "POST /import/reserve",
    "POST /import/upload-url",
    "POST /storage/upload",
    "POST /import/claim-upload",
    "POST /import/start",
    "GET /jobs/job_1",
  ]);
  assert.deepEqual(requests[0].body, {});
  assert.deepEqual(requests[1].body, { jobId: "job_1" });
  const upload = requests[2];
  assert.equal(upload.headers["content-type"], "text/html");
  assert.equal(upload.headers.authorization, undefined);
  assert.deepEqual(upload.raw, html);
  assert.deepEqual(requests[3].body, {
    jobId: "job_1",
    reservationId: "res_1",
    storageId: "st_1",
  });
  assert.deepEqual(requests[4].body, {
    jobId: "job_1",
    reservationId: "res_1",
  });
});

test("import sends --collection (by name), --flatten and --skip-duplicates", async () => {
  const file = await bookmarksFile();
  const { code, requests } = await cli(importFlow(), [
    "import",
    file,
    "--collection",
    "Reading",
    "--flatten",
    "--skip-duplicates",
  ]);
  assert.equal(code, 0);
  assert.deepEqual(requests.find((r) => r.path === "/import/reserve")?.body, {
    targetCollectionId: "col_r",
    flattenDeep: true,
    skipDuplicates: true,
  });
});

test("import waits while the job runs", async () => {
  const file = await bookmarksFile();
  const running = ok({
    id: "job_1",
    type: "import_html",
    status: "running",
    progress: { processed: 1, total: 3 },
  });
  const { code, requests } = await cli(
    importFlow({
      "GET /jobs/job_1": [
        running,
        done({ total: 3, imported: 3, duplicates: 0, skipped: 0 }),
      ],
    }),
    ["import", file],
  );
  assert.equal(code, 0);
  assert.equal(requests.filter((r) => r.path === "/jobs/job_1").length, 2);
});

test("import --json prints the finished job unchanged", async () => {
  const file = await bookmarksFile();
  const { stdout } = await cli(importFlow(), ["import", file, "--json"]);
  assert.deepEqual(JSON.parse(stdout).result, {
    total: 3,
    imported: 2,
    duplicates: 1,
    skipped: 0,
  });
});

test("an import cut short by the plan's Bookmark limit warns and exits 6", async () => {
  const file = await bookmarksFile();
  const result = {
    total: 10,
    imported: 4,
    duplicates: 0,
    skipped: 6,
    quotaLimited: true,
  };
  const text = await cli(importFlow({ "GET /jobs/job_1": done(result) }), [
    "import",
    file,
  ]);
  assert.equal(text.code, 6);
  assert.match(text.stderr, /Imported 4 Bookmarks \(0 duplicates, 6 skipped\)/);
  assert.match(
    text.stderr,
    /Bookmark limit was reached, so the rest of the file wasn't imported/,
  );
  const json = await cli(importFlow({ "GET /jobs/job_1": done(result) }), [
    "import",
    file,
    "--json",
  ]);
  assert.equal(json.code, 6);
  assert.deepEqual(JSON.parse(json.stdout).result, result);
  assert.equal(JSON.parse(json.stderr).error.code, "BOOKMARK_LIMIT_REACHED");
});

test("a failed import shows the API's message and exits 1", async () => {
  const file = await bookmarksFile();
  const failed = ok({
    id: "job_1",
    type: "import_html",
    status: "failed",
    error: { code: "JOB_TIMED_OUT", message: "Job timed out" },
  });
  const { code, stderr } = await cli(
    importFlow({ "GET /jobs/job_1": failed }),
    ["import", file],
  );
  assert.equal(code, 1);
  assert.match(stderr, /The job failed: Job timed out/);
  const json = await cli(importFlow({ "GET /jobs/job_1": failed }), [
    "import",
    file,
    "--json",
  ]);
  assert.equal(JSON.parse(json.stderr).error.code, "JOB_TIMED_OUT");
});

test("import --no-wait prints the job id without waiting", async () => {
  const file = await bookmarksFile();
  const { code, stdout, requests } = await cli(importFlow(), [
    "import",
    file,
    "--no-wait",
  ]);
  assert.equal(code, 0);
  assert.equal(stdout, "job_1\n");
  assert.equal(calls(requests).includes("GET /jobs/job_1"), false);
});

test("import checks the file before sending anything", async () => {
  const text = await bookmarksFile(Buffer.from("just some text"));
  const big = await bookmarksFile();
  await truncate(big, 5 * 1024 * 1024 + 1);
  for (const [path, message] of [
    [join(configHome, "missing.html"), /No such file/],
    [text, /isn't an HTML bookmarks file/],
    [big, /imports can be at most 5 MB/],
  ] as const) {
    const { code, stderr, requests } = await cli(importFlow(), [
      "import",
      path,
    ]);
    assert.equal(code, 2, path);
    assert.match(stderr, message);
    assert.equal(requests.length, 0);
  }
});

test("a rate-limited import step exits 5 with the time to retry", async () => {
  const file = await bookmarksFile();
  const { code, stderr } = await cli(
    importFlow({
      "POST /import/reserve": {
        ...apiError(429, "RATE_LIMITED", "Rate limit exceeded"),
        headers: { "retry-after": "30" },
      },
    }),
    ["import", file],
  );
  assert.equal(code, 5);
  assert.match(stderr, /Retry after \d\d:\d\d/);
});

const exportFlow = (overrides: Routes = {}): Routes => ({
  "POST /export/csv": ok({ jobId: "job_e" }),
  "GET /jobs/job_e": ok({
    id: "job_e",
    type: "export_csv",
    status: "completed",
    artifactExpiresAt: 1,
  }),
  "POST /jobs/job_e/download": (req) =>
    ok({
      url: `http://${req.headers.host}/storage/files/secret-link`,
      contentType: "text/csv",
      filename: "bookmark-land-export.csv",
    }),
  "GET /storage/files/secret-link": {
    body: "url,title\nhttps://example.com,x\n",
  },
  ...overrides,
});

test("export waits, downloads the file without the Token, and saves it", async () => {
  const dir = await mkdtemp(join(configHome, "export-"));
  const out = join(dir, "lib.csv");
  const { code, stdout, stderr, requests } = await cli(exportFlow(), [
    "export",
    "--format",
    "csv",
    "-o",
    out,
  ]);
  assert.equal(code, 0, stderr);
  assert.equal(stdout, `${out}\n`);
  assert.equal(
    await readFile(out, "utf8"),
    "url,title\nhttps://example.com,x\n",
  );
  assert.deepEqual(calls(requests), [
    "POST /export/csv",
    "GET /jobs/job_e",
    "POST /jobs/job_e/download",
    "GET /storage/files/secret-link",
  ]);
  assert.equal(requests[2].headers.authorization, "Bearer bkl_env");
  assert.equal(requests[3].headers.authorization, undefined);
  assert.doesNotMatch(stdout + stderr, /secret-link/); // anyone with the link can download the file
});

test("export saves to bookmarks-<date>.<format> by default, and never overwrites without --force", async () => {
  const dir = await mkdtemp(join(configHome, "export-"));
  const first = await cli(exportFlow(), ["export", "--format", "csv"], dir);
  assert.equal(first.code, 0, first.stderr);
  const [name] = await readdir(dir);
  assert.match(name, /^bookmarks-\d{4}-\d\d-\d\d\.csv$/);

  const again = await cli(exportFlow(), ["export", "--format", "csv"], dir);
  assert.equal(again.code, 2);
  assert.match(again.stderr, /already exists\. Pass --force/);
  assert.equal(again.requests.length, 0); // checked before the export starts

  await writeFile(join(dir, name), "old");
  const forced = await cli(
    exportFlow(),
    ["export", "--format", "csv", "--force"],
    dir,
  );
  assert.equal(forced.code, 0);
  assert.match(await readFile(join(dir, name), "utf8"), /^url,title/);
});

test("export --no-wait prints the job id; --json prints the finished job", async () => {
  const noWait = await cli(exportFlow(), [
    "export",
    "--format",
    "csv",
    "--no-wait",
  ]);
  assert.equal(noWait.code, 0);
  assert.equal(noWait.stdout, "job_e\n");
  assert.deepEqual(calls(noWait.requests), ["POST /export/csv"]);

  const out = join(await mkdtemp(join(configHome, "export-")), "lib.csv");
  const json = await cli(exportFlow(), [
    "export",
    "--format",
    "csv",
    "-o",
    out,
    "--json",
  ]);
  assert.equal(JSON.parse(json.stdout).type, "export_csv");
});

test("export needs a valid --format", async () => {
  for (const args of [["export"], ["export", "--format", "xml"]]) {
    const { code, requests } = await cli(exportFlow(), args);
    assert.equal(code, 2);
    assert.equal(requests.length, 0);
  }
});

test("a failed export shows the API's message", async () => {
  const out = join(await mkdtemp(join(configHome, "export-")), "lib.csv");
  const { code, stderr } = await cli(
    exportFlow({
      "GET /jobs/job_e": ok({
        id: "job_e",
        type: "export_csv",
        status: "failed",
        error: { message: "Job canceled" },
      }),
    }),
    ["export", "--format", "csv", "-o", out],
  );
  assert.equal(code, 1);
  assert.match(stderr, /The job failed: Job canceled/);
});

test("jobs show shows the type, status, progress and result or error", async () => {
  const job = {
    id: "job_1",
    type: "import_html",
    status: "completed",
    progress: { processed: 3, total: 3 },
    createdAt: Date.UTC(2026, 0, 2, 3, 4, 5),
    result: { total: 3, imported: 2, duplicates: 1, skipped: 0 },
  };
  const { code, stdout } = await cli({ "GET /jobs/job_1": ok(job) }, [
    "jobs",
    "show",
    "job_1",
  ]);
  assert.equal(code, 0);
  assert.equal(
    stdout,
    [
      "Type:       import_html",
      "Status:     completed",
      "Progress:   3 of 3",
      "Created:    2026-01-02T03:04:05.000Z",
      "Imported:   2",
      "Duplicates: 1",
      "Skipped:    0",
      "",
    ].join("\n"),
  );
  const json = await cli({ "GET /jobs/job_1": ok(job) }, [
    "jobs",
    "show",
    "job_1",
    "--json",
  ]);
  assert.deepEqual(JSON.parse(json.stdout), job);

  const failed = await cli(
    {
      "GET /jobs/job_2": ok({
        id: "job_2",
        type: "export_json",
        status: "failed",
        error: { message: "Job canceled" },
      }),
    },
    ["jobs", "show", "job_2"],
  );
  assert.match(failed.stdout, /Status: +failed\nError: +Job canceled/);
  const missing = await cli(
    { "GET /jobs/nope": apiError(404, "NOT_FOUND", "Job not found") },
    ["jobs", "show", "nope"],
  );
  assert.equal(missing.code, 4);
});
