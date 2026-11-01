import { request } from "../api.ts";
import { requireToken } from "../auth.ts";
import { acrossIds, confirm, readIds, report } from "../bulk.ts";
import type { Command, Context } from "../cli.ts";
import { printJson, printTable, success } from "../output.ts";
import { resolveTag } from "../resolve.ts";
import type { Envelope, Tag } from "../types.ts";
import { maxLength } from "./bookmarks.ts";

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

const tagName = (name: string) =>
  maxLength(`The Tag name "${name}"`, name, 25) as string;
const resolve = async (ctx: Context, name: string) =>
  resolveTag(ctx.apiUrl, await requireToken(ctx.apiUrl), name);
const bookmark = (id: string) => `/bookmarks/${encodeURIComponent(id)}`;

// `tag <id…> <name>`: the last argument is the Tag, the rest are ids (or "-").
const split = async (args: string[]) => ({
  ids: await readIds(args.slice(0, -1)),
  name: args.at(-1) as string,
});

export const tagCommands: Command[] = [
  {
    name: "tag",
    args: "<id…> <name>",
    summary: "Add a Tag to Bookmarks (it's created if needed)",
    async run(ctx, args) {
      const { ids, name } = await split(args);
      tagName(name);
      const affected = await acrossIds(ids, {
        single: (id) => call(ctx, "POST", `${bookmark(id)}/tags`, { name }),
        batch: async (batch) =>
          (
            await call<{ addedCount: number }>(
              ctx,
              "POST",
              "/bookmarks/bulk/tag",
              { ids: batch, name },
            )
          ).addedCount,
      });
      report(ctx, "tagged", ids.length, affected, ` with "${name}"`);
    },
  },
  {
    name: "untag",
    args: "<id…> <name>",
    summary: "Remove a Tag from Bookmarks",
    async run(ctx, args) {
      const { ids, name } = await split(args);
      const tag = await resolve(ctx, name);
      const affected = await acrossIds(ids, {
        single: (id) =>
          call(
            ctx,
            "DELETE",
            `${bookmark(id)}/tags/${encodeURIComponent(tag.id)}`,
          ),
        batch: async (batch) =>
          (
            await call<{ removedCount: number }>(
              ctx,
              "DELETE",
              "/bookmarks/bulk/tag",
              { ids: batch, tagId: tag.id },
            )
          ).removedCount,
      });
      report(ctx, "untagged", ids.length, affected, ` from "${tag.name}"`);
    },
  },
  {
    name: "tags list",
    summary: "List your Tags with how many Bookmarks have each",
    async run(ctx) {
      const tags = await call<Tag[]>(ctx, "GET", "/tags");
      if (ctx.json) return printJson(tags);
      printTable(
        ["NAME", "BOOKMARKS", "COLOR"],
        tags.map((t) => [t.name, String(t.count ?? ""), t.color ?? ""]),
        0,
      );
    },
  },
  {
    name: "tags add",
    args: "<name>",
    summary: "Create a Tag (use / for hierarchy, such as dev/js)",
    flags: {
      color: { type: "string", description: "Color name, such as blue" },
    },
    async run(ctx, [name], flags) {
      const data = await call<unknown>(ctx, "POST", "/tags", {
        name: tagName(name),
        color: flags.color,
      });
      if (ctx.json) return printJson(data);
      success(`Created Tag "${name}"`);
    },
  },
  {
    name: "tags rename",
    args: "<old> <new>",
    summary: "Rename a Tag on every Bookmark that has it",
    async run(ctx, [from, to]) {
      tagName(to);
      const tag = await resolve(ctx, from);
      const data = await call<unknown>(
        ctx,
        "PATCH",
        `/tags/${encodeURIComponent(tag.id)}`,
        { newName: to },
      );
      if (ctx.json) return printJson(data);
      success(`Renamed Tag "${tag.name}" to "${to}"`);
    },
  },
  {
    name: "tags rm",
    args: "<name>",
    summary: "Delete a Tag (its Bookmarks are untouched)",
    flags: {
      yes: { type: "boolean", description: "Don't ask for confirmation" },
    },
    async run(ctx, [name], flags) {
      const tag = await resolve(ctx, name);
      await confirm(
        `Delete the Tag "${tag.name}" from ${tag.count ?? "all its"} Bookmarks?`,
        flags.yes === true,
      );
      const data = await call<unknown>(
        ctx,
        "DELETE",
        `/tags/${encodeURIComponent(tag.id)}`,
      );
      if (ctx.json) return printJson(data);
      success(`Deleted Tag "${tag.name}". Its Bookmarks are untouched.`);
    },
  },
  {
    name: "tags merge",
    args: "<from> <into>",
    summary: "Merge one Tag into another; the first is deleted",
    flags: {
      yes: { type: "boolean", description: "Don't ask for confirmation" },
    },
    async run(ctx, [from, into], flags) {
      const source = await resolve(ctx, from);
      const target = await resolve(ctx, into);
      await confirm(
        `Merge "${source.name}" into "${target.name}" and delete "${source.name}"?`,
        flags.yes === true,
      );
      const data = await call<unknown>(ctx, "POST", "/tags/merge", {
        sourceTagId: source.id,
        targetTagId: target.id,
      });
      if (ctx.json) return printJson(data);
      success(`Merged "${source.name}" into "${target.name}"`);
    },
  },
];
