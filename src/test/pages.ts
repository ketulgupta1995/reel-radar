import { vi } from "vitest";
import { State, empty } from "@/lib/syncDocs";
import { jsonResponse } from "./fixtures";

// Helpers for page render tests. Pages run against the real lib/ code and localStorage; only
// fetch is replaced.

type Handler = (url: URL, init?: RequestInit) => unknown;

// Stub fetch, answering by path ("/api/title") or prefix ("/api/person/*"). A handler returns a
// body (sent as JSON) or a Response. /api/sync defaults to an empty server; anything else gets {}.
export function routeFetch(routes: Record<string, Handler | object> = {}) {
  const fn = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, "http://localhost");
    const match =
      routes[url.pathname] ??
      Object.entries(routes).find(([p]) => p.endsWith("*") && url.pathname.startsWith(p.slice(0, -1)))?.[1];
    if (match !== undefined) {
      const out = typeof match === "function" ? await (match as Handler)(url, init) : match;
      return out instanceof Response ? out : jsonResponse(out);
    }
    if (url.pathname === "/api/sync") return init?.method === "POST" ? jsonResponse({ etag: '"e"' }) : jsonResponse({ docs: {} });
    return jsonResponse({});
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

// Requests made to `path`, with their parsed URL and init.
export const requests = (fn: ReturnType<typeof routeFetch>, path: string) =>
  fn.mock.calls
    .map(([input, init]) => ({ url: new URL(input as string, "http://localhost"), init: init as RequestInit | undefined }))
    .filter((r) => r.url.pathname === path);

export const seed = (s: Partial<State>) => localStorage.setItem("reel-radar-v1", JSON.stringify({ ...empty(), ...s }));
export const stored = (): State => ({ ...empty(), ...JSON.parse(localStorage.getItem("reel-radar-v1") || "{}") });

// jsdom can't navigate; swap in a plain object so redirects and reloads can be asserted.
export function stubLocation(search = "") {
  const loc = { href: "", search, reload: vi.fn() };
  Object.defineProperty(window, "location", { value: loc, configurable: true, writable: true });
  return loc;
}
