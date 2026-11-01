import { ApiError } from "./api.ts";
import { CliError } from "./errors.ts";

const useColor = (stream: NodeJS.WriteStream) =>
  stream.isTTY === true && !process.env.NO_COLOR;
const paint = (code: number, stream: NodeJS.WriteStream, text: string) =>
  useColor(stream) ? `\x1b[${code}m${text}\x1b[0m` : text;

// Data goes to stdout; messages for humans go to stderr, so piped output stays clean.
export function printJson(data: unknown): void {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

export function print(line = ""): void {
  process.stdout.write(`${line}\n`);
}

export function info(message: string): void {
  process.stderr.write(`${message}\n`);
}

export function success(message: string): void {
  info(`${paint(32, process.stderr, "✓")} ${message}`);
}

export function warn(message: string): void {
  info(`${paint(33, process.stderr, "!")} ${message}`);
}

export function printFields(
  fields: [string, string | null | undefined][],
): void {
  const width = Math.max(...fields.map(([label]) => label.length)) + 1;
  for (const [label, value] of fields) {
    print(
      `${paint(1, process.stdout, `${label}:`.padEnd(width))} ${value ?? "-"}`,
    );
  }
}

export function printError(err: unknown, json: boolean): void {
  const code = err instanceof CliError ? err.code : "INTERNAL_ERROR";
  const message = err instanceof Error ? err.message : String(err);
  const requestId = err instanceof ApiError ? err.requestId : undefined;
  if (json) {
    info(JSON.stringify({ error: { code, message, requestId } }));
    return;
  }
  const suffix = requestId ? ` (request id: ${requestId})` : "";
  info(`${paint(31, process.stderr, "error:")} ${message}${suffix}`);
}
