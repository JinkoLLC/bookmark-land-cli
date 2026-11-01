import { readFile } from "node:fs/promises";
import { ApiError, request } from "../api.ts";
import { requireToken } from "../auth.ts";
import type { Command, Context, Flags } from "../cli.ts";
import { usageError } from "../errors.ts";
import { printFields, printJson, printTable, success } from "../output.ts";
import { pickByName } from "../resolve.ts";
import { checkRulesJson, describeRules, parseRules } from "../rules.ts";
import { readStdin } from "../stdin.ts";
import type {
  Bookmark,
  Envelope,
  SmartFolder,
  SmartFolderPage,
  SmartFolderRules,
} from "../types.ts";
import { maxLength, printBookmarks } from "./bookmarks.ts";

const path = (id: string, rest = "") =>
  `/smart-folders/${encodeURIComponent(id)}${rest}`;

async function get<T>(
  ctx: Context,
  apiPath: string,
  query?: Record<string, string | undefined>,
) {
  const token = await requireToken(ctx.apiUrl);
  return (await request<Envelope<T>>(ctx.apiUrl, apiPath, { token, query }))
    .data;
}

async function send(
  ctx: Context,
  method: string,
  apiPath: string,
  body?: unknown,
) {
  const token = await requireToken(ctx.apiUrl);
  return (
    await request<Envelope<unknown>>(ctx.apiUrl, apiPath, {
      method,
      token,
      body,
    })
  ).data;
}

const resolve = async (ctx: Context, nameOrId: string) =>
  pickByName(
    await get<SmartFolder[]>(ctx, "/smart-folders"),
    nameOrId,
    "Smart folder",
  );

// Rules come either from --rule (readable) or --rules-json (the API's format), never both.
async function rulesFrom(flags: Flags): Promise<SmartFolderRules | undefined> {
  const rules = flags.rule as string[] | undefined;
  const json = flags["rules-json"] as string | undefined;
  if (rules && json !== undefined)
    throw usageError("Use --rule or --rules-json, not both");
  if (json !== undefined) {
    if (flags.match !== undefined)
      throw usageError("--match goes inside --rules-json");
    return checkRulesJson(
      json === "-"
        ? await readStdin()
        : await readFile(json, "utf8").catch(notReadable(json)),
    );
  }
  if (rules) return parseRules(rules, flags.match as string | undefined);
  if (flags.match !== undefined)
    throw usageError("--match needs at least one --rule");
  return undefined;
}

const notReadable = (file: string) => (err: Error) => {
  throw usageError(`Can't read ${file}: ${err.message}`);
};

const ruleFlags = {
  rule: {
    type: "string",
    multiple: true,
    description:
      'A rule, "<field> <operator> <value>", such as "tag contains ai" (repeat for more)',
  },
  match: {
    type: "string",
    description: "Match all rules or any rule (default: all)",
  },
  "rules-json": {
    type: "string",
    description:
      'Rules in the API\'s JSON format, from a file or - for stdin: {"match", "conditions"}',
  },
} as const;

export const smartFolderCommands: Command[] = [
  {
    name: "smart-folders list",
    summary: "List your Smart folders and their rules",
    async run(ctx) {
      const folders = await get<SmartFolder[]>(ctx, "/smart-folders");
      if (ctx.json) return printJson(folders);
      printTable(
        ["ID", "NAME", "RULES"],
        folders.map((f) => [f.id, f.name, describeRules(f.rules)]),
        2,
      );
    },
  },
  {
    name: "smart-folders show",
    args: "<folder>",
    summary: "Show a Smart folder and its rules",
    async run(ctx, [nameOrId]) {
      const folder = await get<SmartFolder>(
        ctx,
        path(await resolve(ctx, nameOrId)),
      );
      if (ctx.json) return printJson(folder);
      printFields([
        ["id", folder.id],
        ["name", folder.name],
        ["icon", folder.icon],
        ["color", folder.color],
        ["match", folder.rules.match],
        ...folder.rules.conditions.map((c): [string, string] => [
          "rule",
          describeRules({ match: "all", conditions: [c] }),
        ]),
        ["createdAt", folder.createdAt],
      ]);
    },
  },
  {
    name: "smart-folders add",
    args: "<name>",
    summary: "Create a Smart folder from rules",
    flags: ruleFlags,
    async run(ctx, [name], flags) {
      maxLength("A Smart folder name", name, 50);
      const rules = await rulesFrom(flags);
      if (!rules)
        throw usageError(
          "Give the Smart folder at least one --rule, or --rules-json",
        );
      const data = await send(ctx, "POST", "/smart-folders", { name, rules });
      if (ctx.json) return printJson(data);
      success(`Created Smart folder "${name}": ${describeRules(rules)}`);
    },
  },
  {
    name: "smart-folders edit",
    args: "<folder>",
    summary: "Change a Smart folder's name, icon, color or rules",
    flags: {
      name: { type: "string", description: "New name, up to 50 characters" },
      icon: { type: "string", description: "Lucide icon name or emoji" },
      color: { type: "string", description: "Color name, such as blue" },
      ...ruleFlags,
    },
    async run(ctx, [nameOrId], flags) {
      const body = {
        name: maxLength("A Smart folder name", flags.name, 50),
        icon: flags.icon,
        color: flags.color,
        rules: await rulesFrom(flags),
      };
      if (Object.values(body).every((v) => v === undefined)) {
        throw usageError(
          "Nothing to change. Pass --name, --icon, --color, --rule or --rules-json",
        );
      }
      const id = await resolve(ctx, nameOrId);
      const data = await send(ctx, "PATCH", path(id), body);
      if (ctx.json) return printJson(data);
      success(`Updated Smart folder ${id}`);
    },
  },
  {
    name: "smart-folders rm",
    args: "<folder>",
    summary: "Delete a Smart folder (its Bookmarks are untouched)",
    async run(ctx, [nameOrId]) {
      const id = await resolve(ctx, nameOrId);
      const data = await send(ctx, "DELETE", path(id));
      if (ctx.json) return printJson(data);
      success(`Deleted Smart folder ${id}. Its Bookmarks are untouched.`);
    },
  },
  {
    name: "smart-folders bookmarks",
    args: "<folder>",
    summary: "List the Bookmarks a Smart folder matches",
    async run(ctx, [nameOrId]) {
      const id = await resolve(ctx, nameOrId);
      const bookmarks: Bookmark[] = [];
      let cursor: string | undefined;
      let truncated = false;
      let restarted = false;
      for (;;) {
        let page: SmartFolderPage;
        try {
          page = await get<SmartFolderPage>(ctx, path(id, "/bookmarks"), {
            cursor,
          });
        } catch (err) {
          // The cursor stops working when the rules change: start over, once.
          if (
            !(
              err instanceof ApiError &&
              err.code === "SMART_FOLDER_CURSOR_INVALID"
            ) ||
            restarted
          )
            throw err;
          restarted = true;
          bookmarks.length = 0;
          truncated = false;
          cursor = undefined;
          continue;
        }
        bookmarks.push(...page.bookmarks);
        truncated ||= page.truncated === true;
        // A page can be empty while later pages still match, so follow every cursor.
        cursor = page.continueCursor ?? undefined;
        if (!cursor) break;
      }
      // All pages joined, in the shape of one page.
      printBookmarks(
        ctx,
        { bookmarks, continueCursor: null, truncated },
        bookmarks,
      );
    },
  },
];
