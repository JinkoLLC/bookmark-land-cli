import { request } from "../api.ts";
import { requireToken } from "../auth.ts";
import type { Command, Context } from "../cli.ts";
import { printFields, printJson, printTable } from "../output.ts";
import { resolveCollection } from "../resolve.ts";
import type {
  Bookmark,
  Envelope,
  SiteSecurity,
  Stats,
  Usage,
} from "../types.ts";
import { BOOKMARK_TYPES, intFlag, oneOf, printBookmarks } from "./bookmarks.ts";

async function get<T>(
  ctx: Context,
  path: string,
  query?: Record<string, string | number | undefined>,
) {
  const token = await requireToken(ctx.apiUrl);
  return (await request<Envelope<T>>(ctx.apiUrl, path, { token, query })).data;
}

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export const insightCommands: Command[] = [
  {
    name: "stats",
    summary:
      "Show totals, favorites, Unsorted, counts by type, and Bookmarks without Tags",
    async run(ctx) {
      const stats = await get<Stats>(ctx, "/bookmarks/stats");
      if (ctx.json) return printJson(stats);
      printFields([
        ["Total", String(stats.total)],
        ["Favorites", String(stats.favorites)],
        ["Unsorted", String(stats.unsorted)],
        ...Object.entries(stats.typeCounts).map(
          ([type, n]): [string, string] => [`Type ${type}`, String(n)],
        ),
        ["Without Tags", String(stats.noTags)],
      ]);
    },
  },
  {
    name: "domains",
    summary: "List domains by how many Bookmarks you have from each",
    async run(ctx) {
      const domains = await get<{ domain: string; count: number }[]>(
        ctx,
        "/bookmarks/domains",
      );
      if (ctx.json) return printJson(domains);
      const sorted = [...domains].sort((a, b) => b.count - a.count);
      printTable(
        ["DOMAIN", "BOOKMARKS"],
        sorted.map((d) => [d.domain, String(d.count)]),
      );
    },
  },
  {
    name: "vulnerable",
    summary: "List Bookmarks whose sites have known security issues",
    flags: {
      limit: {
        type: "string",
        description: "How many to show, 1–100 (default: 100)",
      },
      collection: {
        type: "string",
        description: "Only Bookmarks in this Collection (name or id)",
      },
      domain: {
        type: "string",
        description: "Only Bookmarks from this domain",
      },
      type: {
        type: "string",
        description: `Only this type: ${BOOKMARK_TYPES.join(", ")}`,
      },
    },
    async run(ctx, _args, flags) {
      const query = {
        limit: intFlag("limit", flags.limit, 1, 100),
        domain: flags.domain as string | undefined,
        type: oneOf("type", flags.type, BOOKMARK_TYPES),
      };
      const collection = flags.collection as string | undefined;
      const collectionId =
        collection === undefined
          ? undefined
          : await resolveCollection(
              ctx.apiUrl,
              await requireToken(ctx.apiUrl),
              collection,
            );
      const bookmarks = await get<Bookmark[]>(ctx, "/bookmarks/vulnerable", {
        ...query,
        collectionId,
      });
      printBookmarks(ctx, bookmarks, bookmarks);
    },
  },
  {
    name: "security",
    args: "<id>",
    summary: "Show a Bookmark's site security scan",
    async run(ctx, [id]) {
      const scan = await get<SiteSecurity>(
        ctx,
        `/bookmarks/${encodeURIComponent(id)}/site-security`,
      );
      if (ctx.json) return printJson(scan);
      const version = (s: { product: string; version?: string }) =>
        [s.product, s.version].filter(Boolean).join(" ");
      printFields([
        ["Site", scan.site],
        ["Risk", scan.riskLevel],
        ["Scan", scan.scanOutcome],
        ["Scanned at", scan.lastScannedAt],
        [
          "Software",
          scan.detectedSoftware.map(version).join(", ") || undefined,
        ],
        ...scan.findings.map((f): [string, string] => {
          const details = [
            f.cveId,
            f.cvss === undefined ? undefined : `CVSS ${f.cvss}`,
            f.kev ? "known exploited" : undefined,
            f.cycle && `release line ${f.cycle}`,
            f.eolDate && `end of life ${f.eolDate}`,
          ].filter(Boolean);
          return [
            "Finding",
            `${f.level}: ${version(f)}${details.length ? ` (${details.join(", ")})` : ""}`,
          ];
        }),
      ]);
    },
  },
  {
    name: "usage",
    summary: "Show your plan, Bookmark count and storage against your limits",
    async run(ctx) {
      const usage = await get<Usage>(ctx, "/subscription/usage");
      if (ctx.json) return printJson(usage);
      printFields([
        ["Plan", usage.plan],
        ["Bookmarks", `${usage.bookmarkCount} of ${usage.bookmarkLimit}`],
        ["In the Trash", String(usage.trashedCount)],
        [
          "Storage",
          `${megabytes(usage.storage.usedBytes)} of ${megabytes(usage.storage.limitBytes)}`,
        ],
      ]);
    },
  },
];
