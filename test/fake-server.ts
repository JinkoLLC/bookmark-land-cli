import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

export interface FakeResponse {
  status?: number;
  body?: unknown; // sent as JSON, or as is when it is a string
  headers?: Record<string, string>;
  bodyDelayMs?: number; // send the headers, then wait this long before the body
}

type Handler = (req: FakeRequest) => FakeResponse | Promise<FakeResponse>;

// A local stand-in for the bookmark.land API. Routes are "METHOD /path" (without /v1); a route given
// an array answers with each response in turn and repeats the last one.
export async function startFakeServer(
  routes: Record<string, Handler | FakeResponse | FakeResponse[]>,
) {
  const requests: FakeRequest[] = [];
  const calls = new Map<string, number>();
  const server = createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/^\/v1/, "");
    const fake: FakeRequest = {
      method: req.method ?? "GET",
      path,
      query: Object.fromEntries(url.searchParams),
      headers: req.headers,
      body: text ? JSON.parse(text) : undefined,
    };
    requests.push(fake);
    const key = `${fake.method} ${path}`;
    const route = routes[key];
    const n = calls.get(key) ?? 0;
    calls.set(key, n + 1);
    const answer: FakeResponse =
      route === undefined
        ? {
            status: 404,
            body: {
              error: { code: "NOT_FOUND", message: `No fake route for ${key}` },
            },
          }
        : typeof route === "function"
          ? await route(fake)
          : Array.isArray(route)
            ? route[Math.min(n, route.length - 1)]
            : route;
    const raw = typeof answer.body === "string";
    res.writeHead(answer.status ?? 200, {
      "content-type": raw ? "text/html" : "application/json",
      ...answer.headers,
    });
    res.flushHeaders();
    if (answer.bodyDelayMs)
      await new Promise((r) => setTimeout(r, answer.bodyDelayMs));
    res.end(raw ? answer.body : JSON.stringify(answer.body ?? {}));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections(); // don't wait for slow answers nobody reads any more
      }),
  };
}

export const apiError = (
  status: number,
  code: string,
  message = code,
): FakeResponse => ({
  status,
  body: { error: { code, message }, meta: { requestId: "req_test" } },
});

export const ok = (data: unknown): FakeResponse => ({
  body: { data, meta: { requestId: "req_test" } },
});
