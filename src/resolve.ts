import { request } from "./api.ts";
import { CliError, EXIT, usageError } from "./errors.ts";
import type { Collection, CollectionPage, Envelope } from "./types.ts";

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

// A Collection is named by its id or its exact name. Names are not unique, so an ambiguous name is a usage error.
export async function resolveCollection(
  apiUrl: string,
  token: string,
  nameOrId: string,
  trashed = false,
): Promise<string> {
  const collections = await listCollections(apiUrl, token, trashed);
  if (collections.some((c) => c.id === nameOrId)) return nameOrId;
  const matches = collections.filter((c) => c.name === nameOrId);
  if (matches.length === 1) return matches[0].id;
  const where = trashed ? " in the Trash" : "";
  if (matches.length === 0) {
    throw new CliError(
      `No Collection${where} is named "${nameOrId}"`,
      EXIT.notFound,
      "NOT_FOUND",
    );
  }
  const byId = new Map(collections.map((c) => [c.id, c.name]));
  const lines = matches.map((c) => {
    const parent = c.parentId
      ? `in ${byId.get(c.parentId) ?? c.parentId}`
      : "top level";
    return `  ${c.id}  ${c.name} (${parent})`;
  });
  throw usageError(
    `${matches.length} Collections${where} are named "${nameOrId}". Use an id instead:\n${lines.join("\n")}`,
  );
}
