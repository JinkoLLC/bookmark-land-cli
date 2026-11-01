import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { ApiError, request } from "../api.ts";
import { requireToken } from "../auth.ts";
import type { Command, Context } from "../cli.ts";
import { usageError } from "../errors.ts";
import { print, printJson, success } from "../output.ts";
import type { Envelope } from "../types.ts";
import { uploadFile } from "../upload.ts";

const MAX_BYTES = 10 * 1024 * 1024;

// The file type from its first bytes, not its name.
function imageType(bytes: Uint8Array): string | undefined {
  const starts = (...b: number[]) => b.every((x, i) => bytes[i] === x);
  const ascii = (from: number, text: string) =>
    Buffer.from(bytes.subarray(from, from + text.length)).toString("latin1") ===
    text;
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))
    return "image/png";
  if (ascii(0, "GIF87a") || ascii(0, "GIF89a")) return "image/gif";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  return undefined;
}

// Clearer messages for the upload errors; the code, status and request id stay the API's.
const MESSAGES: Record<string, string> = {
  RESERVATION_EXPIRED:
    "The upload took longer than its 15-minute reservation. Run the command again.",
  RESERVATION_INVALID:
    "The upload reservation is no longer valid. Run the command again.",
  TOO_MANY_PENDING_UPLOADS:
    "You already have 5 uploads waiting to finish. Wait for them to expire (15 minutes) and try again.",
  STORAGE_LIMIT_REACHED:
    "Your 500 MB of storage is full. Delete other cover images to make room.",
  FILE_TOO_LARGE: "The image is over the 10 MB limit.",
  INVALID_FILE_TYPE: "The image must be JPEG, PNG, GIF or WebP.",
};

async function call<T>(
  ctx: Context,
  method: string,
  path: string,
  body?: unknown,
) {
  const token = await requireToken(ctx.apiUrl);
  try {
    return (
      await request<Envelope<T>>(ctx.apiUrl, path, { method, token, body })
    ).data;
  } catch (err) {
    const message = err instanceof ApiError && MESSAGES[err.code];
    if (message) {
      const retry = / Retry after \d\d:\d\d\./.exec(err.message)?.[0] ?? "";
      throw new ApiError(err.status, err.code, message + retry, err.requestId);
    }
    throw err;
  }
}

async function readImage(file: string) {
  const info = await stat(file).catch(() => {
    throw usageError(`No such file: ${file}`);
  });
  if (!info.isFile()) throw usageError(`Not a file: ${file}`);
  if (info.size > MAX_BYTES) {
    throw usageError(
      `${file} is ${(info.size / 1024 / 1024).toFixed(1)} MB; covers can be at most 10 MB`,
    );
  }
  const bytes = await readFile(file);
  const type = imageType(bytes);
  if (!type) throw usageError(`${file} isn't a JPEG, PNG, GIF or WebP image`);
  return { bytes, type };
}

const cover = (id: string, rest = "") =>
  `/bookmarks/${encodeURIComponent(id)}/cover${rest}`;

export const coverCommands: Command[] = [
  {
    name: "cover set",
    args: "<id> <image-file>",
    summary:
      "Upload a cover image for a Bookmark (JPEG, PNG, GIF or WebP, up to 10 MB)",
    async run(ctx, [id, file]) {
      const { bytes, type } = await readImage(file);
      const { uploadUrl, reservationId } = await call<{
        uploadUrl: string;
        reservationId: string;
      }>(ctx, "POST", cover(id, "/upload-url"));
      const storageId = await uploadFile(uploadUrl, bytes, type);
      await call(ctx, "POST", cover(id, "/claim"), {
        reservationId,
        storageId,
      });
      const data = await call<{ url: string }>(ctx, "POST", cover(id), {
        reservationId,
        fileName: basename(file),
      });
      if (ctx.json) return printJson(data);
      print(data.url);
      success(`Set the cover image of ${id}`);
    },
  },
  {
    name: "cover rm",
    args: "<id>",
    summary: "Delete a Bookmark's cover image",
    async run(ctx, [id]) {
      const data = await call<unknown>(ctx, "DELETE", cover(id));
      if (ctx.json) return printJson(data);
      success(`Deleted the cover image of ${id}`);
    },
  },
];
