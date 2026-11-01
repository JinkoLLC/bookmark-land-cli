import { spawn } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const CLI = join(import.meta.dirname, "..", "src", "cli.ts");

// One temporary config folder per test file; each file runs in its own process.
export const configHome = mkdtempSync(join(tmpdir(), "bookmark-cli-test-"));
process.on("exit", () => rmSync(configHome, { recursive: true, force: true }));

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface RunOptions {
  apiUrl?: string;
  input?: string;
  env?: Record<string, string>;
}

// Runs the real `bookmark` process. It is isolated from the user's machine only through env.
export function run(
  args: string[],
  options: RunOptions = {},
): Promise<RunResult> {
  return spawnWith(process.execPath, [CLI, ...args], options);
}

// Table output needs a terminal, so this runs `bookmark` in a pty from `script`. The pty merges
// stderr into stdout and reports 0 columns, so the CLI falls back to 80. Windows has no `script`.
export const noTty =
  process.platform === "win32" && "Windows has no `script` for a pty";
export async function runTty(
  args: string[],
  options: RunOptions = {},
): Promise<RunResult> {
  const argv = [process.execPath, CLI, ...args];
  const scriptArgs =
    process.platform === "darwin"
      ? ["-q", "/dev/null", ...argv]
      : [
          "-qec",
          argv.map((a) => `'${a.replaceAll("'", `'\\''`)}'`).join(" "),
          "/dev/null",
        ];
  // macOS `script` exits at once when stdin is a socket (Node's pipes are), so it gets /dev/null,
  // whose end it passes on as Ctrl-D. Linux `script` doesn't pass the end on, so answers go through a pipe.
  const darwin = process.platform === "darwin";
  const stdin = darwin || options.input === undefined ? "ignore" : "pipe";
  const result = await spawnWith("script", scriptArgs, options, stdin);
  if (!result.stdout)
    throw new Error(`script printed nothing: ${result.stderr}`);
  // macOS `script` echoes ^D and two backspaces when stdin ends.
  const stdout = result.stdout.replaceAll("\r\n", "\n").replace("^D\b\b", "");
  return { ...result, stdout };
}

// A stand-in for `open` and `xdg-open` on PATH that records the URL it was asked to open.
// On Windows nothing is found on PATH, so no browser starts and nothing is recorded.
export function fakeBrowser() {
  const dir = mkdtempSync(join(tmpdir(), "bookmark-cli-browser-"));
  const log = join(dir, "opened.txt");
  for (const name of ["open", "xdg-open"]) {
    writeFileSync(join(dir, name), `#!/bin/sh\necho "$1" > '${log}'\n`);
    chmodSync(join(dir, name), 0o755);
  }
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  return {
    env: { PATH: dir },
    // The browser starts detached, so wait a little for it to record the URL.
    async opened(): Promise<string | undefined> {
      for (let i = 0; i < 50; i++) {
        try {
          const url = readFileSync(log, "utf8").trim();
          if (url) return url; // empty: the shell created the file but hasn't written it yet
        } catch {}
        await sleep(50);
      }
      return undefined;
    },
  };
}

function spawnWith(
  command: string,
  args: string[],
  options: RunOptions,
  stdin: "pipe" | "ignore" = "pipe",
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
  const child = spawn(command, args, { env, stdio: [stdin, "pipe", "pipe"] });
  child.stdin?.end(options.input ?? "");
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => (stdout += chunk));
  child.stderr?.on("data", (chunk) => (stderr += chunk));
  return new Promise((resolve) =>
    child.on("close", (code) => resolve({ code, stdout, stderr })),
  );
}
