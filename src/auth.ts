import { CliError, EXIT } from "./errors.ts";

export type TokenSource = "BOOKMARK_TOKEN";

export function getToken(): { token: string; source: TokenSource } | undefined {
  const env = process.env.BOOKMARK_TOKEN?.trim();
  return env ? { token: env, source: "BOOKMARK_TOKEN" } : undefined;
}

export function requireToken(): string {
  const found = getToken();
  if (!found) throw notLoggedIn();
  return found.token;
}

export const notLoggedIn = () =>
  new CliError(
    "Not logged in. Run: bookmark login",
    EXIT.auth,
    "NOT_LOGGED_IN",
  );
