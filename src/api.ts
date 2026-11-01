import pkg from "../package.json" with { type: "json" };
import { CliError, EXIT } from "./errors.ts";

export const USER_AGENT = `bookmark-land-cli/${pkg.version} (node ${process.versions.node}; ${process.platform})`;

export class ApiError extends CliError {
  readonly status: number;
  readonly requestId?: string;

  constructor(
    status: number,
    code: string,
    message: string,
    requestId?: string,
  ) {
    super(message, exitCodeFor(status), code);
    this.status = status;
    this.requestId = requestId;
  }
}

function exitCodeFor(status: number): number {
  if (status === 401 || status === 403) return EXIT.auth;
  if (status === 404) return EXIT.notFound;
  if (status === 429) return EXIT.rateLimited;
  return EXIT.error;
}

export interface RequestOptions {
  method?: string;
  token?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
}

// Returns the parsed response body; most endpoints wrap their payload in `data` (see Envelope).
export async function request<T>(
  apiUrl: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const url = new URL(apiUrl + path);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const headers: Record<string, string> = {
    "user-agent": USER_AGENT,
    accept: "application/json",
  };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers["content-type"] = "application/json";

  let res: Response;
  let text: string;
  try {
    res = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      signal: options.signal,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    text = await res.text(); // the body can fail or time out after the headers arrived
  } catch (err) {
    const cause = (err as { cause?: Error }).cause?.message;
    throw new CliError(
      `Could not reach ${url.origin}: ${cause ?? (err as Error).message}`,
      EXIT.error,
      "NETWORK_ERROR",
    );
  }

  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = undefined;
  }
  if (res.ok) {
    if (body !== undefined) return body as T;
    throw new ApiError(
      res.status,
      "INVALID_RESPONSE",
      "The API returned a response that isn't JSON",
    );
  }

  const { error, meta } = (body ?? {}) as {
    error?: { code?: unknown; message?: unknown } | string;
    meta?: { requestId?: string };
  };
  // Gateway errors use a plain string instead of { code, message }.
  const code =
    typeof error === "object" && typeof error.code === "string"
      ? error.code
      : `HTTP_${res.status}`;
  let message =
    typeof error === "object" && typeof error.message === "string"
      ? error.message
      : typeof error === "string"
        ? error
        : `${res.status} ${res.statusText}`;
  const at = res.status === 429 && retryAt(res.headers.get("retry-after"));
  if (at) message = `${sentence(message)} Retry after ${at}.`;
  if (code === "SCOPE_REQUIRED") {
    // The message names the scope: This endpoint requires the "destructive" scope
    const scope = /"([^"]+)"/.exec(message)?.[1] ?? "<scope>";
    message = `${sentence(message)} Run: bookmark login --scopes ${scope}`;
  }
  throw new ApiError(res.status, code, message, meta?.requestId);
}

const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);

// Retry-After is seconds or an HTTP date. Rounded up to the next minute, so it is never too early.
function retryAt(header: string | null): string | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds)
    ? Date.now() + seconds * 1000
    : Date.parse(header);
  if (Number.isNaN(ms)) return undefined;
  return new Date(Math.ceil(ms / 60_000) * 60_000).toTimeString().slice(0, 5);
}
