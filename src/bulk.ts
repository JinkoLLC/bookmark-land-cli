import { createInterface } from "node:readline/promises";
import { ApiError } from "./api.ts";
import type { Context } from "./cli.ts";
import { CliError, EXIT, usageError } from "./errors.ts";
import { printJson, success, warn } from "./output.ts";
import { readStdin } from "./stdin.ts";

const BATCH = 50; // the API's bulk limit

// Ids from the arguments, or one per line from stdin when the only argument is "-".
export async function readIds(args: string[]): Promise<string[]> {
  if (args.includes("-") && args.length > 1) {
    throw usageError('Use "-" on its own to read ids from stdin');
  }
  const ids = args[0] === "-" ? (await readStdin()).split(/\s+/) : args;
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) throw usageError("No ids given");
  return unique;
}

interface Endpoints {
  single(id: string): Promise<unknown>; // used for one id
  batch?(ids: string[]): Promise<number>; // the bulk endpoint, returning how many changed
  sent?(ids: string[]): void; // called as soon as ids have gone through, even if a later batch fails
}

// One id uses the single-Bookmark endpoint. Several use the bulk endpoint in batches of 50,
// or, where there is no bulk endpoint, one call each, counting unknown ids as skipped.
export async function acrossIds(
  ids: string[],
  endpoints: Endpoints,
): Promise<number> {
  if (ids.length === 1) {
    await endpoints.single(ids[0]);
    endpoints.sent?.(ids);
    return 1;
  }
  let affected = 0;
  let done = 0;
  try {
    if (endpoints.batch) {
      for (let i = 0; i < ids.length; i += BATCH) {
        const batch = ids.slice(i, i + BATCH);
        affected += await endpoints.batch(batch);
        done += batch.length;
        endpoints.sent?.(batch);
      }
    } else {
      for (const id of ids) {
        try {
          await endpoints.single(id);
          affected++;
          endpoints.sent?.([id]);
        } catch (err) {
          if (!(err instanceof ApiError && err.status === 404)) throw err;
        }
        done++;
      }
    }
  } catch (err) {
    // Say how far it got, so a rate limit halfway through a long list isn't a mystery. It goes in
    // the error itself, so --json still prints one JSON error.
    if (done > 0 && err instanceof Error) {
      err.message += ` Stopped after ${done} of ${ids.length} ids (${affected} changed).`;
    }
    throw err;
  }
  return affected;
}

// "3 Bookmarks removed", or "2 of 3 removed (1 not found or unchanged)". A partial result is not an error.
export function report(
  ctx: Context,
  verb: string,
  requested: number,
  affected: number,
  detail = "", // such as ` with "reading"`
): void {
  if (ctx.json) {
    printJson({ requested, affected });
    return;
  }
  if (affected >= requested) {
    success(
      `${verb[0].toUpperCase()}${verb.slice(1)} ${requested} Bookmark${requested === 1 ? "" : "s"}${detail}`,
    );
  } else {
    warn(
      `${affected} of ${requested} ${verb}${detail} (${requested - affected} not found or unchanged)`,
    );
  }
}

// Anything that can't be undone asks "[y/N]" on a terminal, and needs --yes everywhere else.
export async function confirm(question: string, yes: boolean): Promise<void> {
  if (yes) return;
  if (!(process.stdin.isTTY && process.stderr.isTTY)) {
    throw usageError(
      `${question} This can't be undone: pass --yes to confirm.`,
    );
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  // stdin ending (Ctrl-D) closes the prompt: that counts as no.
  const answer = await new Promise<string>((resolve) => {
    rl.once("close", () => resolve(""));
    rl.question(`${question} This can't be undone. [y/N] `).then(resolve, () =>
      resolve(""),
    );
  });
  rl.close();
  if (!/^y(es)?$/i.test(answer.trim())) {
    throw new CliError(
      "Cancelled. Nothing was changed.",
      EXIT.error,
      "CANCELLED",
    );
  }
}
