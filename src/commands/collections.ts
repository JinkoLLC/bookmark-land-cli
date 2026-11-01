import { ApiError, request } from "../api.ts";
import { requireToken } from "../auth.ts";
import type { Command, Context } from "../cli.ts";
import { usageError } from "../errors.ts";
import {
  print,
  printFields,
  printJson,
  printObject,
  printTable,
  success,
} from "../output.ts";
import { listCollections, resolveCollection } from "../resolve.ts";
import type { Collection, Envelope } from "../types.ts";
import { maxLength } from "./bookmarks.ts";

const path = (id: string, rest = "") =>
  `/collections/${encodeURIComponent(id)}${rest}`;

async function call<T>(
  ctx: Context,
  method: string,
  apiPath: string,
  body?: unknown,
) {
  const token = await requireToken(ctx.apiUrl);
  try {
    return (
      await request<Envelope<T>>(ctx.apiUrl, apiPath, { method, token, body })
    ).data;
  } catch (err) {
    if (err instanceof ApiError && err.code === "COLLECTION_TOO_LARGE") {
      throw new ApiError(
        err.status,
        err.code,
        "This Collection holds more than 1,000 Collections and Bookmarks (Bookmarks in the Trash count too), " +
          "so it can't be Removed or Restored in one go, and nothing was changed. " +
          "Do it in parts: Remove or Restore its child Collections first, or move some of its Bookmarks out, then retry.",
        err.requestId,
      );
    }
    throw err;
  }
}

const resolve = async (ctx: Context, nameOrId: string, trashed = false) =>
  resolveCollection(
    ctx.apiUrl,
    await requireToken(ctx.apiUrl),
    nameOrId,
    trashed,
  );

// Parents before their children, so the table shows the nesting.
function asTree(collections: Collection[]): [Collection, number][] {
  const ids = new Set(collections.map((c) => c.id));
  const tree: [Collection, number][] = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const c of collections) {
      const isTop = !c.parentId || !ids.has(c.parentId);
      if (parentId === null ? isTop : c.parentId === parentId) {
        tree.push([c, depth]);
        visit(c.id, depth + 1);
      }
    }
  };
  visit(null, 0);
  return tree;
}

const styleFlags = {
  icon: { type: "string", description: "Lucide icon name or emoji" },
  color: { type: "string", description: "Color name, such as blue" },
} as const;

export const collectionCommands: Command[] = [
  {
    name: "collections list",
    summary: "List your Collections with their nesting and Bookmark counts",
    flags: {
      trashed: {
        type: "boolean",
        description: "List the Collections in the Trash instead",
      },
    },
    async run(ctx, _args, flags) {
      const collections = await listCollections(
        ctx.apiUrl,
        await requireToken(ctx.apiUrl),
        flags.trashed === true,
      );
      // All pages joined, in the shape of one page.
      if (ctx.json) return printJson({ collections, nextCursor: null });
      const indent = process.stdout.isTTY === true;
      printTable(
        ["ID", "NAME", "BOOKMARKS", "PARENT"],
        asTree(collections).map(([c, depth]) => [
          c.id,
          `${indent ? "  ".repeat(depth) : ""}${c.name}`,
          String(c.bookmarkCount ?? ""),
          c.parentId ?? "",
        ]),
        1,
      );
    },
  },
  {
    name: "collections show",
    args: "<collection>",
    summary: "Show a Collection's details, including its notes",
    async run(ctx, [nameOrId]) {
      const collection = await call<Collection>(
        ctx,
        "GET",
        path(await resolve(ctx, nameOrId)),
      );
      if (ctx.json) return printJson(collection);
      printObject({ ...collection });
    },
  },
  {
    name: "collections add",
    args: "<name>",
    summary: "Create a Collection",
    flags: {
      parent: {
        type: "string",
        description: "Parent Collection (name or id), up to five levels deep",
      },
      ...styleFlags,
    },
    async run(ctx, [collectionName], flags) {
      const body = {
        name: maxLength("A Collection name", collectionName, 50),
        icon: flags.icon,
        color: flags.color,
        parentId:
          flags.parent === undefined
            ? undefined
            : await resolve(ctx, flags.parent as string),
      };
      const data = await call<Record<string, unknown>>(
        ctx,
        "POST",
        "/collections",
        body,
      );
      if (ctx.json) return printJson(data);
      success(`Created Collection "${collectionName}"`);
      printObject(data);
    },
  },
  {
    name: "collections edit",
    args: "<collection>",
    summary: "Change a Collection's name, icon, color or notes",
    flags: {
      name: { type: "string", description: "New name, up to 50 characters" },
      ...styleFlags,
      notes: { type: "string", description: "Notes, up to 20,000 characters" },
    },
    async run(ctx, [nameOrId], flags) {
      const body = {
        name: maxLength("A Collection name", flags.name, 50),
        icon: flags.icon,
        color: flags.color,
        notes: maxLength("Collection notes", flags.notes, 20_000),
      };
      if (Object.values(body).every((v) => v === undefined)) {
        throw usageError(
          "Nothing to change. Pass at least one of --name, --icon, --color or --notes",
        );
      }
      const id = await resolve(ctx, nameOrId);
      const data = await call<unknown>(ctx, "PATCH", path(id), body);
      if (ctx.json) return printJson(data);
      success(`Updated Collection ${id}`);
    },
  },
  {
    name: "collections rm",
    args: "<collection>",
    summary:
      "Remove a Collection, its child Collections and their Bookmarks (move them to the Trash)",
    async run(ctx, [nameOrId]) {
      const id = await resolve(ctx, nameOrId);
      const data = await call<unknown>(ctx, "DELETE", path(id));
      if (ctx.json) return printJson(data);
      print(id);
      success(
        `Removed Collection ${id}. Restore it with: bookmark collections restore ${id}`,
      );
    },
  },
  {
    name: "collections restore",
    args: "<collection>",
    summary:
      "Restore a Collection, its child Collections and their Bookmarks from the Trash",
    async run(ctx, [nameOrId]) {
      const id = await resolve(ctx, nameOrId, true);
      const data = await call<unknown>(ctx, "POST", path(id, "/restore"));
      if (ctx.json) return printJson(data);
      success(`Restored Collection ${id}`);
    },
  },
  {
    name: "collections share",
    args: "<collection>",
    summary: "Show whether a Collection is shared, and its public link",
    async run(ctx, [nameOrId]) {
      const data = await call<{ shared: boolean; publicUrl?: string | null }>(
        ctx,
        "GET",
        path(await resolve(ctx, nameOrId), "/share"),
      );
      if (ctx.json) return printJson(data);
      printFields([
        ["Shared", data.shared ? "yes" : "no"],
        ["Link", data.publicUrl],
      ]);
    },
  },
];
