import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dirname, "..", "src", "cli.ts");

// One temporary config folder per test file; each file runs in its own process.
export const configHome = mkdtempSync(join(tmpdir(), "bookmark-cli-test-"));
process.on("exit", () => rmSync(configHome, { recursive: true, force: true }));

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

// Runs the real `bookmark` process. It is isolated from the user's machine only through env.
export function run(
  args: string[],
  options: {
    apiUrl?: string;
    input?: string;
    env?: Record<string, string>;
  } = {},
): Promise<RunResult> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    XDG_CONFIG_HOME: configHome,
    APPDATA: configHome,
    BOOKMARK_NO_KEYRING: "1",
    NO_COLOR: "1",
    BOOKMARK_TOKEN: undefined,
    BOOKMARK_API_URL: options.apiUrl,
    ...options.env,
  };
  for (const key of Object.keys(env))
    if (env[key] === undefined) delete env[key];
  const child = spawn(process.execPath, [CLI, ...args], { env });
  child.stdin.end(options.input ?? "");
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  return new Promise((resolve) =>
    child.on("close", (code) => resolve({ code, stdout, stderr })),
  );
}
