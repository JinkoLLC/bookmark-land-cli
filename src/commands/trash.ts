import { request } from "../api.ts";
import { requireToken } from "../auth.ts";
import { confirm } from "../bulk.ts";
import type { Command } from "../cli.ts";
import { info, printJson, success, warn } from "../output.ts";
import type { BookmarkPage, Envelope } from "../types.ts";
import { intFlag, printBookmarks } from "./bookmarks.ts";

export const trashCommands: Command[] = [
  {
    name: "trash list",
    summary: "List the Bookmarks in the Trash, most recently Removed first",
    flags: {
      limit: {
        type: "string",
        description: "How many to show, 1–200 (default: 50)",
      },
      cursor: { type: "string", description: "Continue from a previous page" },
    },
    async run(ctx, _args, flags) {
      const { data } = await request<Envelope<BookmarkPage>>(
        ctx.apiUrl,
        "/bookmarks/trashed",
        {
          token: await requireToken(ctx.apiUrl),
          query: {
            limit: intFlag("limit", flags.limit, 1, 200),
            cursor: flags.cursor as string | undefined,
          },
        },
      );
      printBookmarks(ctx, data, data.data);
      if (!ctx.json && data.hasMore && data.cursor) {
        info(`More results. Next page: add --cursor ${data.cursor}`);
      }
    },
  },
  {
    name: "trash empty",
    summary: "Permanently delete every Bookmark in the Trash",
    flags: {
      yes: { type: "boolean", description: "Don't ask for confirmation" },
    },
    async run(ctx, _args, flags) {
      await confirm(
        "Permanently delete every Bookmark in the Trash?",
        flags.yes === true,
      );
      const { data } = await request<
        Envelope<{ deleted: number; hasMore?: boolean }>
      >(ctx.apiUrl, "/bookmarks/trash", {
        method: "DELETE",
        token: await requireToken(ctx.apiUrl),
      });
      if (ctx.json) return printJson(data);
      success(`Permanently deleted ${data.deleted} Bookmarks from the Trash`);
      // One call deletes up to 200; the API deletes the rest in the background.
      if (data.hasMore) {
        warn(
          "The rest of the Trash is being Permanently deleted in the background. Check again later with: bookmark trash list",
        );
      }
    },
  },
];
