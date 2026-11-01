import assert from "node:assert/strict";
import { truncate, writeFile } from "node:fs/promises";
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
const png = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);
const webp = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.alloc(4),
  Buffer.from("WEBPVP8 "),
]);
const file = async (name: string, bytes: Buffer) => {
  const path = join(configHome, name);
  await writeFile(path, bytes);
  return path;
};

type Routes = Record<
  string,
  FakeResponse | ((req: FakeRequest) => FakeResponse)
>;
// The upload URL points back at the fake server, which plays the storage service too.
const flow = (overrides: Routes = {}): Routes => ({
  "POST /bookmarks/bk_1/cover/upload-url": (req) =>
    ok({
      uploadUrl: `http://${req.headers.host}/storage/upload?token=one-time`,
      reservationId: "res_1",
    }),
  "POST /storage/upload": { body: { storageId: "st_1" } },
  "POST /bookmarks/bk_1/cover/claim": ok({ success: true }),
  "POST /bookmarks/bk_1/cover": ok({ url: "https://cdn.example/covers/abc" }),
  ...overrides,
});
async function cli(routes: Routes, args: string[]) {
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
const calls = (requests: FakeRequest[]) =>
  requests.map((r) => `${r.method} ${r.path}`);

test("cover set runs the whole upload flow and prints the cover's URL", async () => {
  const path = await file("cover.png", png);
  const { code, stdout, stderr, requests } = await cli(flow(), [
    "cover",
    "set",
    "bk_1",
    path,
  ]);
  assert.equal(code, 0, stderr);
  assert.equal(stdout, "https://cdn.example/covers/abc\n");
  assert.deepEqual(calls(requests), [
    "POST /bookmarks/bk_1/cover/upload-url",
    "POST /storage/upload",
    "POST /bookmarks/bk_1/cover/claim",
    "POST /bookmarks/bk_1/cover",
  ]);
  const upload = requests[1];
  assert.equal(upload.query.token, "one-time");
  assert.equal(upload.headers["content-type"], "image/png");
  assert.deepEqual(upload.raw, png);
  assert.equal(upload.headers.authorization, undefined); // the Token never goes to storage
  assert.deepEqual(requests[2].body, {
    reservationId: "res_1",
    storageId: "st_1",
  });
  assert.deepEqual(requests[3].body, {
    reservationId: "res_1",
    fileName: "cover.png",
  });
});

test("cover set --json prints the API's data, and detects the type from the bytes", async () => {
  const path = await file("photo.jpg", webp); // named .jpg, but it's WebP
  const { code, stdout, requests } = await cli(flow(), [
    "cover",
    "set",
    "bk_1",
    path,
    "--json",
  ]);
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(stdout), {
    url: "https://cdn.example/covers/abc",
  });
  assert.equal(requests[1].headers["content-type"], "image/webp");
});

test("cover set checks the file before uploading", async () => {
  const text = await file("notes.png", Buffer.from("just text"));
  const big = await file("big.png", png);
  await truncate(big, 10 * 1024 * 1024 + 1);
  for (const [path, message] of [
    [join(configHome, "missing.png"), /No such file/],
    [configHome, /Not a file/],
    [text, /isn't a JPEG, PNG, GIF or WebP image/],
    [big, /10\.0 MB; covers can be at most 10 MB/],
  ] as const) {
    const { code, stderr, requests } = await cli(flow(), [
      "cover",
      "set",
      "bk_1",
      path,
    ]);
    assert.equal(code, 2, path);
    assert.match(stderr, message);
    assert.equal(requests.length, 0);
  }
});

test("an expired reservation gets a clear message", async () => {
  const path = await file("cover.png", png);
  const { code, stderr } = await cli(
    flow({
      "POST /bookmarks/bk_1/cover/claim": apiError(
        400,
        "RESERVATION_EXPIRED",
        "Reservation expired",
      ),
    }),
    ["cover", "set", "bk_1", path],
  );
  assert.equal(code, 1);
  assert.match(
    stderr,
    /longer than its 15-minute reservation\. Run the command again\. \(request id: req_test\)/,
  );
});

test("upload errors get clear messages and the right exit codes", async () => {
  const path = await file("cover.png", png);
  for (const [route, answer, exitCode, message] of [
    [
      "POST /bookmarks/bk_1/cover/upload-url",
      apiError(429, "TOO_MANY_PENDING_UPLOADS"),
      5,
      /5 uploads waiting/,
    ],
    [
      "POST /bookmarks/bk_1/cover",
      apiError(422, "STORAGE_LIMIT_REACHED"),
      1,
      /500 MB of storage is full/,
    ],
    [
      "POST /bookmarks/bk_1/cover",
      apiError(422, "FILE_TOO_LARGE"),
      1,
      /over the 10 MB limit/,
    ],
    [
      "POST /bookmarks/bk_1/cover",
      apiError(422, "INVALID_FILE_TYPE"),
      1,
      /must be JPEG, PNG, GIF or WebP/,
    ],
    [
      "POST /bookmarks/bk_1/cover/upload-url",
      apiError(403, "PRO_REQUIRED", "Covers need Pro"),
      3,
      /Covers need Pro/,
    ],
    [
      "POST /storage/upload",
      { status: 500, body: "nope" },
      1,
      /The upload failed \(500/,
    ],
  ] as const) {
    const { code, stderr } = await cli(flow({ [route]: answer }), [
      "cover",
      "set",
      "bk_1",
      path,
    ]);
    assert.equal(code, exitCode, route);
    assert.match(stderr, message);
  }
});

test("too many pending uploads keeps the time to retry", async () => {
  const path = await file("cover.png", png);
  const { code, stderr } = await cli(
    flow({
      "POST /bookmarks/bk_1/cover/upload-url": {
        ...apiError(429, "TOO_MANY_PENDING_UPLOADS"),
        headers: { "retry-after": "30" },
      },
    }),
    ["cover", "set", "bk_1", path],
  );
  assert.equal(code, 5);
  assert.match(stderr, /5 uploads waiting.* Retry after \d\d:\d\d\./);
});

test("cover rm deletes the cover", async () => {
  const { code, stderr, requests } = await cli(
    { "DELETE /bookmarks/bk_1/cover": ok({ success: true }) },
    ["cover", "rm", "bk_1"],
  );
  assert.equal(code, 0, stderr);
  assert.match(stderr, /Deleted the cover image of bk_1/);
  assert.deepEqual(calls(requests), ["DELETE /bookmarks/bk_1/cover"]);
  const missing = await cli(
    { "DELETE /bookmarks/nope/cover": apiError(404, "NOT_FOUND") },
    ["cover", "rm", "nope"],
  );
  assert.equal(missing.code, 4);
});
