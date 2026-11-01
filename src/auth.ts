import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { configDir } from "./config.ts";
import { CliError, EXIT } from "./errors.ts";

export type TokenSource = "BOOKMARK_TOKEN" | "keychain" | "config file";

// Read and write access to bookmarks, collections and tags. Extra scopes are opt-in with `login --scopes`.
export const DEFAULT_SCOPES = [
  "bookmarks:read",
  "bookmarks:write",
  "collections:read",
  "collections:write",
  "tags:read",
  "tags:write",
];

const SERVICE = "bookmark-land-cli";
const hostOf = (apiUrl: string) => new URL(apiUrl).host;
const credentialsPath = () => join(configDir(), "credentials.json");

interface KeychainEntry {
  getPassword(): string | null;
  setPassword(password: string): void;
  deletePassword(): boolean;
}

// Tokens are stored per API host, so a dev login never overwrites the production one.
async function keychain(apiUrl: string): Promise<KeychainEntry | undefined> {
  if (process.env.BOOKMARK_NO_KEYRING) return undefined;
  try {
    const { Entry } = await import("@napi-rs/keyring");
    // Pinned to Secret Service: the default Linux fallback (kernel keyring) is wiped on reboot.
    return new Entry(SERVICE, hostOf(apiUrl), {
      linux: { store: "secret-service" },
    });
  } catch {
    return undefined;
  }
}

async function readFileTokens(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await readFile(credentialsPath(), "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new CliError(
      `Could not read ${credentialsPath()}: ${(err as Error).message}`,
    );
  }
}

async function writeFileTokens(tokens: Record<string, string>): Promise<void> {
  await mkdir(configDir(), { recursive: true, mode: 0o700 });
  // Write a fresh file and rename it over the old one, so an interrupted write never leaves broken JSON.
  const tmp = `${credentialsPath()}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(tokens, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  await rename(tmp, credentialsPath());
}

async function removeFromFile(apiUrl: string): Promise<void> {
  const tokens = await readFileTokens();
  if (!(hostOf(apiUrl) in tokens)) return;
  delete tokens[hostOf(apiUrl)];
  await writeFileTokens(tokens);
}

export async function getToken(
  apiUrl: string,
): Promise<{ token: string; source: TokenSource } | undefined> {
  const env = process.env.BOOKMARK_TOKEN?.trim();
  if (env) return { token: env, source: "BOOKMARK_TOKEN" };
  try {
    const token = (await keychain(apiUrl))?.getPassword();
    if (token) return { token, source: "keychain" };
  } catch {
    // No usable keychain: fall through to the config file.
  }
  const token = (await readFileTokens())[hostOf(apiUrl)];
  return token ? { token, source: "config file" } : undefined;
}

export async function requireToken(apiUrl: string): Promise<string> {
  const found = await getToken(apiUrl);
  if (!found) throw notLoggedIn();
  return found.token;
}

export async function saveToken(
  apiUrl: string,
  token: string,
): Promise<TokenSource> {
  const entry = await keychain(apiUrl);
  if (entry) {
    try {
      entry.setPassword(token);
      await removeFromFile(apiUrl);
      return "keychain";
    } catch {
      // No usable keychain: fall back to the config file.
    }
  }
  const tokens = await readFileTokens();
  tokens[hostOf(apiUrl)] = token;
  await writeFileTokens(tokens);
  return "config file";
}

export async function deleteToken(apiUrl: string): Promise<void> {
  try {
    (await keychain(apiUrl))?.deletePassword();
  } catch {
    // Nothing stored in the keychain.
  }
  await removeFromFile(apiUrl);
}

export const notLoggedIn = () =>
  new CliError(
    "Not logged in. Run: bookmark login",
    EXIT.auth,
    "NOT_LOGGED_IN",
  );
