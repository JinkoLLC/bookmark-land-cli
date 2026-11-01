import { request } from "../api.ts";
import { requireToken } from "../auth.ts";
import { openBrowser } from "../browser.ts";
import { acrossIds, confirm, readIds, report } from "../bulk.ts";
import type { Command, Context, Flags } from "../cli.ts";
import { usageError } from "../errors.ts";
import {
  info,
  print,
  printJson,
  printObject,
  printTable,
  success,
  warn,
} from "../output.ts";
import { resolveCollection } from "../resolve.ts";
import type {
  Bookmark,
  BookmarkPage,
  CreatedBookmark,
  Envelope,
} from "../types.ts";

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

export function maxLength(what: string, value: unknown, max: number) {
  if (typeof value === "string" && value.length > max) {
    throw usageError(
      `${what} can be at most ${max} characters (got ${value.length})`,
    );
  }
  return value as string | undefined;
}

function webUrl(value: unknown) {
  if (value === undefined) return undefined;
  let url: URL | undefined;
  try {
    url = new URL(value as string);
  } catch {}
  if (url?.protocol !== "http:" && url?.protocol !== "https:") {
    throw usageError(`Not a valid http or https URL: ${value}`);
  }
  return maxLength("The URL", value, 2048);
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

const textFlags = {
  title: { type: "string", description: "Title, up to 100 characters" },
  description: {
    type: "string",
    description: "Description, up to 500 characters",
  },
  note: { type: "string", description: "Personal note, up to 500 characters" },
} as const;

// The API answers every invalid request with the same "Request rejected", so check the documented limits first.
const textFields = (flags: Flags) => ({
  title: maxLength("The title", flags.title, 100),
  description: maxLength("The description", flags.description, 500),
  note: maxLength("The note", flags.note, 500),
});

export const bookmarkCommands: Command[] = [
  {
    name: "add",
    args: "<url>",
    summary: "Save a Bookmark and print its id",
    flags: {
      ...textFlags,
      tag: {
        type: "string",
        multiple: true,
        description: "Tag, up to 25 characters (repeat for more, up to 10)",
      },
      collection: {
        type: "string",
        description:
          "Collection to save it in, by name or id (default: Unsorted)",
      },
      type: {
        type: "string",
        description: `Type: ${BOOKMARK_TYPES.join(", ")}`,
      },
      favorite: { type: "boolean", description: "Mark it as a favorite" },
    },
    async run(ctx, [url], flags) {
      const tags = flags.tag as string[] | undefined;
      if (tags && tags.length > 10)
        throw usageError(
          `A Bookmark can have at most 10 Tags (got ${tags.length})`,
        );
      for (const tag of tags ?? []) {
        if (!tag.trim()) throw usageError("Tag names can't be empty");
        maxLength(`The Tag name "${tag}"`, tag, 25);
      }
      const body = {
        url: webUrl(url),
        ...textFields(flags),
        tags,
        type: oneOf("type", flags.type, BOOKMARK_TYPES),
        isFavorite: flags.favorite ? true : undefined,
      };
      const collection = flags.collection as string | undefined;
      if (collection?.toLowerCase() === "unsorted") {
        throw usageError(
          "New Bookmarks go to Unsorted by default: leave out --collection",
        );
      }
      const token = await requireToken(ctx.apiUrl);
      const collectionId =
        collection === undefined
          ? undefined
          : await resolveCollection(ctx.apiUrl, token, collection);
      const { data } = await request<Envelope<CreatedBookmark>>(
        ctx.apiUrl,
        "/bookmarks",
        { method: "POST", token, body: { ...body, collectionId } },
      );
      if (ctx.json) return printJson(data);
      print(data.bookmarkId);
      if (data.restored) success(`Restored from the Trash: ${data.bookmarkId}`);
      else if (data.duplicate)
        warn(
          `This URL was already saved, so a duplicate was created: ${data.bookmarkId}`,
        );
    },
  },
  {
    name: "edit",
    args: "<id>",
    summary: "Change a Bookmark's title, description, URL or note",
    flags: {
      ...textFlags,
      url: { type: "string", description: "New URL, up to 2,048 characters" },
    },
    async run(ctx, [id], flags) {
      const body = { ...textFields(flags), url: webUrl(flags.url) };
      if (Object.values(body).every((v) => v === undefined)) {
        throw usageError(
          "Nothing to change. Pass at least one of --title, --description, --url or --note",
        );
      }
      const { data } = await request<Envelope<unknown>>(
        ctx.apiUrl,
        `/bookmarks/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          token: await requireToken(ctx.apiUrl),
          body,
        },
      );
      if (ctx.json) return printJson(data);
      success(`Updated ${id}`);
    },
  },
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
        description: "Only Bookmarks in this Collection (name or id)",
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
      };
      const token = await requireToken(ctx.apiUrl);
      const collection = flags.collection as string | undefined;
      const collectionId =
        collection === undefined
          ? undefined
          : await resolveCollection(ctx.apiUrl, token, collection);
      const { data } = await request<Envelope<BookmarkPage>>(
        ctx.apiUrl,
        "/bookmarks",
        { token, query: { ...query, collectionId } },
      );
      printBookmarks(ctx, data, data.data);
      if (!ctx.json && data.hasMore && data.cursor) {
        info(`More results. Next page: add --cursor ${data.cursor}`);
      }
      if (!ctx.json && data.truncated) {
        warn(
          "Only your most recently saved favorites were sorted. Use --sort newest or --sort oldest to page through all of them.",
        );
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

const call = async (
  ctx: Context,
  method: string,
  path: string,
  body?: unknown,
) =>
  (
    await request<Envelope<Record<string, number>>>(ctx.apiUrl, path, {
      method,
      token: await requireToken(ctx.apiUrl),
      body,
    })
  ).data;
const one = (id: string, rest = "") =>
  `/bookmarks/${encodeURIComponent(id)}${rest}`;

const favoriteCommand = (name: string, isFavorite: boolean): Command => ({
  name,
  args: "<id…>",
  summary: isFavorite
    ? "Mark Bookmarks as favorites"
    : "Unmark favorite Bookmarks",
  async run(ctx, args) {
    const ids = await readIds(args);
    const affected = await acrossIds(ids, {
      single: (id) => call(ctx, "PUT", one(id, "/favorite"), { isFavorite }),
      batch: async (batch) =>
        (
          await call(ctx, "POST", "/bookmarks/bulk/favorite", {
            ids: batch,
            isFavorite,
          })
        ).updated,
    });
    report(ctx, isFavorite ? "favorited" : "unfavorited", ids.length, affected);
  },
});

export const idCommands: Command[] = [
  {
    name: "rm",
    args: "<id…>",
    summary:
      "Remove Bookmarks (move them to the Trash), or Permanently delete them",
    flags: {
      permanent: {
        type: "boolean",
        description: "Permanently delete instead (needs the destructive Scope)",
      },
      yes: {
        type: "boolean",
        description: "Don't ask before Permanently deleting",
      },
    },
    async run(ctx, args, flags) {
      const ids = await readIds(args);
      if (flags.permanent) {
        const what =
          ids.length === 1 ? "this Bookmark" : `these ${ids.length} Bookmarks`;
        await confirm(`Permanently delete ${what}?`, flags.yes === true);
        // There is no bulk endpoint for this, so one call per id.
        const affected = await acrossIds(ids, {
          single: (id) => call(ctx, "DELETE", one(id, "/permanent")),
        });
        return report(ctx, "permanently deleted", ids.length, affected);
      }
      const affected = await acrossIds(ids, {
        single: (id) => call(ctx, "DELETE", one(id)),
        batch: async (batch) =>
          (await call(ctx, "POST", "/bookmarks/bulk/trash", { ids: batch }))
            .trashed,
        // The ids, so they can be Restored later (the API doesn't say which ones it skipped).
        // Printed per batch, so a failure halfway still leaves the ones already sent.
        sent: (batch) => {
          if (!ctx.json) for (const id of batch) print(id);
        },
      });
      report(ctx, "removed", ids.length, affected);
    },
  },
  {
    name: "restore",
    args: "<id…>",
    summary: "Restore Bookmarks from the Trash",
    async run(ctx, args) {
      const ids = await readIds(args);
      // There is no bulk endpoint for this, so one call per id.
      const affected = await acrossIds(ids, {
        single: (id) => call(ctx, "POST", one(id, "/restore")),
      });
      report(ctx, "restored", ids.length, affected);
    },
  },
  favoriteCommand("favorite", true),
  favoriteCommand("unfavorite", false),
];
