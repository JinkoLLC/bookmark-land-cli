#!/usr/bin/env node
import { parseArgs } from "node:util";
import pkg from "../package.json" with { type: "json" };
import { authCommands } from "./commands/auth.ts";
import { bookmarkCommands } from "./commands/bookmarks.ts";
import { collectionCommands } from "./commands/collections.ts";
import { resolveApiUrl } from "./config.ts";
import { CliError, EXIT, usageError } from "./errors.ts";
import { print, printError } from "./output.ts";

export interface Flag {
  type: "string" | "boolean";
  short?: string;
  multiple?: boolean;
  description: string;
}

export type Flags = Record<string, string | boolean | string[] | undefined>;

export interface Context {
  apiUrl: string;
  json: boolean;
}

export interface Command {
  name: string; // "login", or "<group> <verb>" for grouped commands
  args?: string; // positional arguments for help, e.g. "<url>"
  summary: string;
  flags?: Record<string, Flag>;
  run(ctx: Context, args: string[], flags: Flags): Promise<void>;
}

const GLOBAL_FLAGS: Record<string, Flag> = {
  json: { type: "boolean", description: "Print the API's raw JSON data" },
  "api-url": {
    type: "string",
    description:
      "API base URL (default: $BOOKMARK_API_URL or https://api.bookmark.land/v1)",
  },
  help: { type: "boolean", short: "h", description: "Show help" },
};

const COMMANDS: Command[] = [
  ...bookmarkCommands,
  ...collectionCommands,
  ...authCommands,
];

function findCommand(argv: string[]): Command | undefined {
  const twoWords = argv.slice(0, 2).join(" ");
  return (
    COMMANDS.find((c) => c.name === twoWords) ??
    COMMANDS.find((c) => c.name === argv[0])
  );
}

function flagHelp(flags: Record<string, Flag>): string[] {
  return Object.entries(flags).map(([name, flag]) => {
    const short = flag.short ? `-${flag.short}, ` : "    ";
    const value = flag.type === "string" ? ` <${name}>` : "";
    return `  ${short}--${name}${value}\n        ${flag.description}`;
  });
}

function printOverview(): void {
  const width = Math.max(...COMMANDS.map((c) => c.name.length)) + 2;
  print(`bookmark ${pkg.version}: ${pkg.description}\n`);
  print("Usage: bookmark <command> [flags]\n");
  print("Commands:");
  for (const c of COMMANDS) print(`  ${c.name.padEnd(width)}${c.summary}`);
  print("\nGlobal flags:");
  for (const line of flagHelp(GLOBAL_FLAGS)) print(line);
  print("\nRun `bookmark <command> --help` for a command's flags.");
}

function printGroupHelp(group: Command[]): void {
  const width = Math.max(...group.map((c) => c.name.length)) + 2;
  print("Commands:");
  for (const c of group) print(`  ${c.name.padEnd(width)}${c.summary}`);
  print("\nRun `bookmark <command> --help` for a command's flags.");
}

function printCommandHelp(command: Command): void {
  print(`${command.summary}\n`);
  print(
    `Usage: bookmark ${command.name}${command.args ? ` ${command.args}` : ""} [flags]`,
  );
  if (command.flags) {
    print("\nFlags:");
    for (const line of flagHelp(command.flags)) print(line);
  }
  print("\nGlobal flags:");
  for (const line of flagHelp(GLOBAL_FLAGS)) print(line);
}

async function main(argv: string[]): Promise<void> {
  if (argv[0] === "--version" || argv[0] === "-v") return print(pkg.version);
  const command = findCommand(argv);
  if (!command) {
    if (argv.length === 0 || ["help", "--help", "-h"].includes(argv[0])) {
      return printOverview();
    }
    const group = COMMANDS.filter((c) => c.name.startsWith(`${argv[0]} `));
    if (group.length && (!argv[1] || ["--help", "-h"].includes(argv[1]))) {
      return printGroupHelp(group);
    }
    const name = group.length ? `${argv[0]} ${argv[1]}` : argv[0];
    const help = group.length
      ? `bookmark ${argv[0]} --help`
      : "bookmark --help";
    throw usageError(`Unknown command: ${name}. Run: ${help}`);
  }

  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv.slice(command.name.split(" ").length),
      options: { ...GLOBAL_FLAGS, ...command.flags },
      allowPositionals: true,
      strict: true,
    });
  } catch (err) {
    throw usageError(
      `${(err as Error).message}. Run: bookmark ${command.name} --help`,
    );
  }
  const flags = parsed.values as Flags;
  if (flags.help) return printCommandHelp(command);
  // `args` doubles as the arity: each <name> is required, and "…" takes one or more.
  const required = command.args?.match(/<[^>]+>/g)?.length ?? 0;
  const count = parsed.positionals.length;
  if (count < required || (count > required && !command.args?.includes("…"))) {
    throw usageError(
      `Usage: bookmark ${command.name}${command.args ? ` ${command.args}` : ""}. Run: bookmark ${command.name} --help`,
    );
  }
  const ctx: Context = {
    apiUrl: resolveApiUrl(flags["api-url"] as string | undefined),
    json: flags.json === true,
  };
  await command.run(ctx, parsed.positionals, flags);
}

const argv = process.argv.slice(2);
main(argv).catch((err: unknown) => {
  printError(err, argv.includes("--json"));
  process.exitCode = err instanceof CliError ? err.exitCode : EXIT.error;
});
