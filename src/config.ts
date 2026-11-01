import { usageError } from "./errors.ts";

export const DEFAULT_API_URL = "https://api.bookmark.land/v1";

export function resolveApiUrl(flag?: string): string {
  const raw = flag ?? process.env.BOOKMARK_API_URL ?? DEFAULT_API_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw usageError(`Invalid API URL: ${raw}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw usageError(`API URL must start with https:// or http://: ${raw}`);
  }
  return url.href.replace(/\/+$/, "");
}
