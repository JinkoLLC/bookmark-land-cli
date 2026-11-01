import { readFile, stat, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { request } from "../api.ts";
import { requireToken } from "../auth.ts";
import type { Command, Context } from "../cli.ts";
import { CliError, EXIT, usageError } from "../errors.ts";
import { print, printFields, printJson, success } from "../output.ts";
import { resolveCollection } from "../resolve.ts";
import type { Envelope, Job } from "../types.ts";
import { downloadFile, uploadFile } from "../upload.ts";
import { oneOf } from "./bookmarks.ts";

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const FORMATS = ["json", "csv", "html"];

async function call<T>(
  ctx: Context,
  method: string,
  path: string,
  body?: unknown,
) {
  const token = await requireToken(ctx.apiUrl);
  return (await request<Envelope<T>>(ctx.apiUrl, path, { method, token, body }))
    .data;
}

const getJob = (ctx: Context, id: string) =>
  call<Job>(ctx, "GET", `/jobs/${encodeURIComponent(id)}`);

// Checks every 2 seconds at first, then every 5. A failed job exits 1 with the API's reason.
async function waitFor(ctx: Context, id: string): Promise<Job> {
  for (let polls = 0; ; polls++) {
    const job = await getJob(ctx, id);
    if (job.status === "completed") return job;
    if (job.status === "failed") {
      throw new CliError(
        `The job failed: ${job.error?.message ?? "no reason given"}`,
        EXIT.error,
        job.error?.code ?? "JOB_FAILED", // JOB_CANCELED, JOB_TIMED_OUT or JOB_FAILED
      );
    }
    await sleep(polls < 5 ? 2000 : 5000);
  }
}

async function readHtml(file: string) {
  const info = await stat(file).catch(() => {
    throw usageError(`No such file: ${file}`);
  });
  if (!info.isFile()) throw usageError(`Not a file: ${file}`);
  if (info.size > MAX_IMPORT_BYTES) {
    throw usageError(
      `${file} is ${(info.size / 1024 / 1024).toFixed(1)} MB; imports can be at most 5 MB`,
    );
  }
  const bytes = await readFile(file);
  // Browser bookmark exports start with a doctype or an HTML tag, after an optional BOM.
  const head = bytes
    .subarray(0, 1024)
    .toString("utf8")
    .replace(/^\uFEFF/, "");
  if (!/^\s*<(!doctype|html|head|meta|title|dl|h1)\b/i.test(head)) {
    throw usageError(
      `${file} isn't an HTML bookmarks file (export one from your browser)`,
    );
  }
  return bytes;
}

const noWait = {
  "no-wait": {
    type: "boolean",
    description:
      "Print the job id and return; check it with `bookmark jobs show`",
  },
} as const;

export const jobCommands: Command[] = [
  {
    name: "import",
    args: "<file.html>",
    summary: "Import a browser bookmarks file (HTML, up to 5 MB)",
    flags: {
      collection: {
        type: "string",
        description: "Import into this Collection (name or id)",
      },
      flatten: {
        type: "boolean",
        description:
          "Put everything in one Collection instead of recreating folders",
      },
      "skip-duplicates": {
        type: "boolean",
        description: "Don't import URLs you've already saved",
      },
      ...noWait,
    },
    async run(ctx, [file], flags) {
      const bytes = await readHtml(file);
      const collection = flags.collection as string | undefined;
      const targetCollectionId =
        collection === undefined
          ? undefined
          : await resolveCollection(
              ctx.apiUrl,
              await requireToken(ctx.apiUrl),
              collection,
            );
      // Each step has its own rate limit, so they run back to back. The reservation lasts 10 minutes.
      const { jobId } = await call<{ jobId: string }>(
        ctx,
        "POST",
        "/import/reserve",
        {
          targetCollectionId,
          flattenDeep: flags.flatten ? true : undefined,
          skipDuplicates: flags["skip-duplicates"] ? true : undefined,
        },
      );
      const { uploadUrl, reservationId } = await call<{
        uploadUrl: string;
        reservationId: string;
      }>(ctx, "POST", "/import/upload-url", { jobId });
      const storageId = await uploadFile(uploadUrl, bytes, "text/html");
      await call(ctx, "POST", "/import/claim-upload", {
        jobId,
        reservationId,
        storageId,
      });
      await call(ctx, "POST", "/import/start", { jobId, reservationId });
      if (flags["no-wait"])
        return ctx.json ? printJson({ jobId }) : print(jobId);

      const job = await waitFor(ctx, jobId);
      const r = job.result ?? {};
      if (ctx.json) printJson(job);
      else
        success(
          `Imported ${r.imported ?? 0} Bookmarks (${r.duplicates ?? 0} duplicates, ${r.skipped ?? 0} skipped)`,
        );
      if (r.quotaLimited) {
        throw new CliError(
          `Your plan's Bookmark limit was reached, so the rest of the file wasn't imported (${r.skipped ?? 0} skipped in all). Free up room or upgrade, then import again.`,
          EXIT.partial,
          "BOOKMARK_LIMIT_REACHED",
        );
      }
    },
  },
  {
    name: "export",
    summary: "Export your library to a file",
    flags: {
      format: { type: "string", description: "json, csv or html" },
      output: {
        type: "string",
        short: "o",
        description: "File to save to (default: bookmarks-<date>.<format>)",
      },
      force: {
        type: "boolean",
        description: "Overwrite the file if it exists",
      },
      ...noWait,
    },
    async run(ctx, _args, flags) {
      const format = oneOf("format", flags.format, FORMATS);
      if (!format)
        throw usageError(`Choose a format: --format ${FORMATS.join("|")}`);
      const date = new Date().toLocaleDateString("sv"); // YYYY-MM-DD, local time
      const output =
        (flags.output as string | undefined) ?? `bookmarks-${date}.${format}`;
      // Checked before the export starts, so a 2-a-minute export isn't wasted.
      if (
        !flags.force &&
        !flags["no-wait"] &&
        (await stat(output).catch(() => undefined))
      ) {
        throw usageError(
          `${output} already exists. Pass --force to overwrite it, or -o to pick another file.`,
        );
      }
      const { jobId } = await call<{ jobId: string }>(
        ctx,
        "POST",
        `/export/${format}`,
      );
      if (flags["no-wait"])
        return ctx.json ? printJson({ jobId }) : print(jobId);

      const job = await waitFor(ctx, jobId);
      const { url } = await call<{ url: string }>(
        ctx,
        "POST",
        `/jobs/${encodeURIComponent(jobId)}/download`,
      );
      await writeFile(output, await downloadFile(url), {
        flag: flags.force ? "w" : "wx",
      });
      if (ctx.json) return printJson(job);
      print(output);
      success(`Exported your library to ${output}`);
    },
  },
  {
    name: "jobs show",
    args: "<id>",
    summary: "Show an import or export job's status, progress and result",
    async run(ctx, [id]) {
      const job = await getJob(ctx, id);
      if (ctx.json) return printJson(job);
      const p = job.progress;
      const r = job.result;
      printFields(
        [
          ["Type", job.type],
          ["Status", job.status],
          [
            "Progress",
            p &&
              `${p.processed}${p.total === undefined ? "" : ` of ${p.total}`}`,
          ],
          [
            "Created",
            job.createdAt === undefined
              ? undefined
              : new Date(job.createdAt).toISOString(),
          ],
          ["Imported", r?.imported?.toString()],
          ["Duplicates", r?.duplicates?.toString()],
          ["Skipped", r?.skipped?.toString()],
          [
            "Limit",
            r?.quotaLimited
              ? "Bookmark limit reached; the rest wasn't imported"
              : undefined,
          ],
          ["Error", job.error?.message],
        ].filter(([, v]) => v !== undefined) as [string, string][],
      );
    },
  },
];
