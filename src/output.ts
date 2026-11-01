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

// On a terminal: aligned columns with a header, and the `flex` column truncated to fit the width.
// Piped: tab-separated values with no header, no truncation and no color.
export function printTable(
  headers: string[],
  rows: string[][],
  flex?: number,
): void {
  const cells = rows.map((row) => row.map((v) => v.replace(/[\t\r\n]+/g, " ")));
  if (!process.stdout.isTTY) {
    for (const row of cells) print(row.join("\t"));
    return;
  }
  // shortcut: widths count UTF-16 units, so wide characters (CJK, emoji) can misalign columns.
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...cells.map((row) => row[i].length)),
  );
  const width = process.stdout.columns || 80;
  if (flex !== undefined) {
    const others = widths.reduce(
      (sum, w, i) => (i === flex ? sum : sum + w + 2),
      0,
    );
    const room = width - others;
    widths[flex] = Math.max(10, Math.min(widths[flex], room));
  }
  const line = (row: string[]) =>
    row
      .map((cell, i) => {
        const fit =
          cell.length > widths[i] ? `${cell.slice(0, widths[i] - 1)}…` : cell;
        return fit.padEnd(widths[i]);
      })
      .join("  ")
      .trimEnd();
  // When the other columns alone are too wide, cut the row at the edge of the terminal.
  const fit = (text: string) =>
    text.length > width ? `${text.slice(0, width - 1)}…` : text;
  print(paint(1, process.stdout, fit(line(headers))));
  for (const row of cells) print(fit(line(row)));
}

// Key/value lines for one object: every field present, in the API's order.
export function printObject(object: Record<string, unknown>): void {
  printFields(
    Object.entries(object)
      .filter(
        ([, value]) => value !== null && value !== undefined && value !== "",
      )
      .map(([key, value]) => [key, formatValue(value)]),
  );
}

const formatValue = (value: unknown): string =>
  Array.isArray(value)
    ? value.map(formatValue).join(", ")
    : typeof value === "object" && value !== null
      ? Object.entries(value)
          .map(([k, v]) => `${k}: ${formatValue(v)}`)
          .join(", ")
      : String(value);
