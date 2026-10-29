import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { config, middleware } from "./middleware";
import { SESSION_COOKIE, createSession } from "@/lib/auth";

const SECRET = "mw-secret";
const req = (path: string, cookie?: string) =>
  new NextRequest(`http://localhost${path}`, cookie ? { headers: { cookie: `${SESSION_COOKIE}=${cookie}` } } : undefined);
const passedThrough = (res: Response) => res.headers.get("x-middleware-next") === "1";

beforeEach(() => vi.stubEnv("AUTH_SECRET", SECRET));

describe("middleware", () => {
  it("lets the login page and auth API through without a session", async () => {
    expect(passedThrough(await middleware(req("/login")))).toBe(true);
    expect(passedThrough(await middleware(req("/api/auth/login")))).toBe(true);
  });

  it("lets requests with a valid session through", async () => {
    const token = await createSession(SECRET);
    expect(passedThrough(await middleware(req("/discover", token)))).toBe(true);
    expect(passedThrough(await middleware(req("/api/storage", token)))).toBe(true);
  });

  it("returns 401 JSON for unauthenticated API calls", async () => {
    const res = await middleware(req("/api/storage", "forged.token"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("redirects pages to /login, remembering where the user was going", async () => {
    const res = await middleware(req("/watched?tab=tv"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/watched?tab=tv");
  });

  it("redirects the home page without a next param", async () => {
    const location = new URL((await middleware(req("/"))).headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.search).toBe("");
  });

  it("rejects every session when AUTH_SECRET is missing", async () => {
    const token = await createSession(SECRET);
    vi.stubEnv("AUTH_SECRET", "");
    expect((await middleware(req("/api/storage", token))).status).toBe(401);
  });
});

describe("matcher", () => {
  // Next compiles the matcher with path-to-regexp; as a plain regex the group behaves the same.
  const matches = (path: string) => new RegExp(`^${config.matcher[0]}$`).test(path);

  it("runs on pages and API routes but skips static files", () => {
    for (const path of ["/", "/discover", "/api/sync", "/api/title", "/person/12"]) expect(matches(path)).toBe(true);
    for (const path of ["/_next/static/chunk.js", "/_next/image", "/favicon.ico", "/logo.png", "/robots.txt", "/site.webmanifest"])
      expect(matches(path)).toBe(false);
  });
});
