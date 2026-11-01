// Exit codes are part of the public interface (see README): never renumber them.
export const EXIT = {
  ok: 0,
  error: 1,
  usage: 2,
  auth: 3,
  notFound: 4,
  rateLimited: 5,
  partial: 6, // completed partially: some data was not saved
} as const;

export class CliError extends Error {
  readonly exitCode: number;
  readonly code: string;

  constructor(message: string, exitCode: number = EXIT.error, code = "ERROR") {
    super(message);
    this.exitCode = exitCode;
    this.code = code;
  }
}

export const usageError = (message: string) =>
  new CliError(message, EXIT.usage, "USAGE");
