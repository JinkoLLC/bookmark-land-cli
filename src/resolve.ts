import { request } from "./api.ts";
import { CliError, EXIT, usageError } from "./errors.ts";
import type { Collection, CollectionPage, Envelope, Tag } from "./types.ts";

export async function listCollections(
  apiUrl: string,
  token: string,
  trashed = false,
): Promise<Collection[]> {
  const all: Collection[] = [];
  let cursor: string | undefined;
  do {
    const { data } = await request<Envelope<CollectionPage | Collection[]>>(
      apiUrl,
      trashed ? "/collections/trashed" : "/collections",
      { token, query: { cursor } },
    );
    // shortcut: the trashed list's shape isn't documented, so accept a plain array too.
    if (Array.isArray(data)) return [...all, ...data];
    all.push(...data.collections);
    cursor = data.nextCursor ?? undefined;
  } while (cursor);
  return all;
}

// Collections and Smart folders are named by their id or exact name. Names are not unique,
// so an ambiguous name is a usage error that lists each match.
export function pickByName<T extends { id: string; name: string }>(
  items: T[],
  nameOrId: string,
  kind: string,
  detail: (item: T) => string = () => "",
  where = "",
): string {
  if (items.some((item) => item.id === nameOrId)) return nameOrId;
  const matches = items.filter((item) => item.name === nameOrId);
  if (matches.length === 1) return matches[0].id;
  if (matches.length === 0) {
    throw new CliError(
      `No ${kind}${where} is named "${nameOrId}"`,
      EXIT.notFound,
      "NOT_FOUND",
    );
  }
  const lines = matches.map((m) => `  ${m.id}  ${m.name}${detail(m)}`);
  throw usageError(
    `${matches.length} ${kind}s${where} are named "${nameOrId}". Use an id instead:\n${lines.join("\n")}`,
  );
}

export async function resolveCollection(
  apiUrl: string,
  token: string,
  nameOrId: string,
  trashed = false,
): Promise<string> {
  const collections = await listCollections(apiUrl, token, trashed);
  const byId = new Map(collections.map((c) => [c.id, c.name]));
  return pickByName(
    collections,
    nameOrId,
    "Collection",
    (c) =>
      c.parentId
        ? ` (in ${byId.get(c.parentId) ?? c.parentId})`
        : " (top level)",
    trashed ? " in the Trash" : "",
  );
}

// Tags are named case-insensitively; the API needs their id for most changes.
export async function resolveTag(
  apiUrl: string,
  token: string,
  name: string,
): Promise<Tag> {
  const { data } = await request<Envelope<Tag[]>>(apiUrl, "/tags", { token });
  const tag = data.find((t) => t.name.toLowerCase() === name.toLowerCase());
  if (!tag) {
    throw new CliError(`No Tag is named "${name}"`, EXIT.notFound, "NOT_FOUND");
  }
  return tag;
}
