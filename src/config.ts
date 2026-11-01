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
  // Plain http only for this machine (the tests' fake server); the Token must never travel in the clear.
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw usageError(
      `API URL must start with https:// (http:// only for localhost): ${raw}`,
    );
  }
  return url.href.replace(/\/+$/, "");
}
