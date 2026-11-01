import { request } from "../api.ts";
import { requireToken } from "../auth.ts";
import { openBrowser } from "../browser.ts";
import type { Command, Context, Flags } from "../cli.ts";
import { usageError } from "../errors.ts";
import { info, print, printJson, printObject, printTable } from "../output.ts";
import type { Bookmark, BookmarkPage, Envelope } from "../types.ts";

export const BOOKMARK_TYPES = ["link", "article", "image", "video", "document"];
const SORTS = ["newest", "oldest", "title", "domain"];

export function oneOf(flag: string, value: unknown, allowed: string[]) {
  if (value !== undefined && !allowed.includes(value as string)) {
    throw usageError(`--${flag} must be one of: ${allowed.join(", ")}`);
  }
  return value as string | undefined;
}

export function intFlag(
  flag: string,
  value: unknown,
  min: number,
  max: number,
) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw usageError(`--${flag} must be a whole number from ${min} to ${max}`);
  }
  return n;
}

// The same table everywhere Bookmarks are listed; --json prints `data` as the API returned it.
export function printBookmarks(
  ctx: Context,
  data: unknown,
  bookmarks: Bookmark[],
) {
  if (ctx.json) return printJson(data);
  printTable(
    ["ID", "TITLE", "DOMAIN", "TAGS"],
    bookmarks.map((b) => [
      b.id,
      b.title || b.url,
      b.domain ?? "",
      (b.tags ?? []).join(","),
    ]),
    1,
  );
}

export const getBookmark = async (ctx: Context, id: string) =>
  (
    await request<Envelope<Bookmark>>(
      ctx.apiUrl,
      `/bookmarks/${encodeURIComponent(id)}`,
      {
        token: await requireToken(ctx.apiUrl),
      },
    )
  ).data;

export const bookmarkCommands: Command[] = [
  {
    name: "list",
    summary: "List your Bookmarks, newest first",
    flags: {
      limit: {
        type: "string",
        description: "How many to show, 1–200 (default: 50)",
      },
      cursor: { type: "string", description: "Continue from a previous page" },
      sort: {
        type: "string",
        description: "newest, oldest, title or domain (default: newest)",
      },
      favorite: { type: "boolean", description: "Only favorites" },
      domain: {
        type: "string",
        description: "Only Bookmarks from this domain, such as github.com",
      },
      type: {
        type: "string",
        description: `Only this type: ${BOOKMARK_TYPES.join(", ")}`,
      },
      collection: {
        type: "string",
        description: "Only Bookmarks in this Collection (id)",
      },
    },
    async run(ctx, _args, flags: Flags) {
      const query = {
        limit: intFlag("limit", flags.limit, 1, 200),
        cursor: flags.cursor as string | undefined,
        sortBy: oneOf("sort", flags.sort, SORTS),
        isFavorite: flags.favorite ? true : undefined,
        domain: flags.domain as string | undefined,
        type: oneOf("type", flags.type, BOOKMARK_TYPES),
        collectionId: flags.collection as string | undefined,
      };
      const { data } = await request<Envelope<BookmarkPage>>(
        ctx.apiUrl,
        "/bookmarks",
        {
          token: await requireToken(ctx.apiUrl),
          query,
        },
      );
      printBookmarks(ctx, data, data.data);
      if (!ctx.json && data.hasMore && data.cursor) {
        info(`More results. Next page: add --cursor ${data.cursor}`);
      }
    },
  },
  {
    name: "search",
    args: "<query…>",
    summary: "Find Bookmarks whose title, description or URL match every word",
    async run(ctx, args) {
      const { data } = await request<Envelope<Bookmark[]>>(
        ctx.apiUrl,
        "/bookmarks/search",
        {
          token: await requireToken(ctx.apiUrl),
          query: { q: args.join(" ") },
        },
      );
      printBookmarks(ctx, data, data);
    },
  },
  {
    name: "show",
    args: "<id>",
    summary: "Show every field of a Bookmark",
    async run(ctx, [id]) {
      const bookmark = await getBookmark(ctx, id);
      if (ctx.json) return printJson(bookmark);
      printObject({ ...bookmark });
    },
  },
  {
    name: "open",
    args: "<id>",
    summary: "Open a Bookmark in your browser and print its URL",
    async run(ctx, [id]) {
      const bookmark = await getBookmark(ctx, id);
      if (ctx.json) printJson(bookmark);
      else print(bookmark.url);
      openBrowser(bookmark.url);
    },
  },
];
