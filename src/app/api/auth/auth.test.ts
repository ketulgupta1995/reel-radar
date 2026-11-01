import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { createClient, type Client } from "@libsql/client";
import { POST as logout } from "./logout/route";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";

// Login attempts are recorded through docStore: Turso is swapped for an in-memory libSQL database,
// and data/ resolves to a temp dir, so the real data/ is never touched.
let db: Client;
vi.mock("@libsql/client/web", () => ({ createClient: () => db }));

let tmp: string;
async function load(tursoUrl?: string) {
  vi.stubEnv("TURSO_DATABASE_URL", tursoUrl ?? "");
  vi.resetModules();
  return (await import("./login/route")).POST;
}

const post = (body: unknown) =>
  new Request("http://localhost/api/auth/login", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
const right = () => post({ username: "kay", password: "s3cret" });
const wrong = () => post({ username: "kay", password: "wrong" });

// Skip the real brute-force delay but check it was requested.
const instantTimeout = () =>
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => (fn(), 0)) as unknown as typeof setTimeout);

beforeEach(async () => {
  vi.stubEnv("APP_USERNAME", "kay");
  vi.stubEnv("APP_PASSWORD", "s3cret");
  vi.stubEnv("AUTH_SECRET", "auth-secret");
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "reel-radar-test-"));
  vi.spyOn(process, "cwd").mockReturnValue(tmp);
  vi.spyOn(console, "error").mockImplementation(() => {});
  db = createClient({ url: ":memory:" });
});
afterEach(async () => {
  vi.useRealTimers();
  db.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("POST /api/auth/login", () => {
  it("sets a valid httpOnly session cookie on correct credentials", async () => {
    const login = await load();
    const res = await login(right());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const cookie = res.cookies.get(SESSION_COOKIE)!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("lax");
    expect(cookie.path).toBe("/");
    expect(await verifySession(cookie.value, "auth-secret")).toBe(true);
  });

  it("rejects wrong credentials after a delay", async () => {
    const login = await load();
    const timeout = instantTimeout();
    const res = await login(wrong());
    expect(res.status).toBe(401);
    expect(timeout).toHaveBeenCalledWith(expect.any(Function), 800);
    expect(res.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it("rejects a wrong username even with the right password", async () => {
    const login = await load();
    instantTimeout();
    expect((await login(post({ username: "eve", password: "s3cret" }))).status).toBe(401);
  });

  it("rejects a malformed body", async () => {
    const login = await load();
    instantTimeout();
    expect((await login(post("not json"))).status).toBe(401);
  });

  it("returns 500 when login isn't configured", async () => {
    const login = await load();
    vi.stubEnv("AUTH_SECRET", "");
    const res = await login(right());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/not configured/);
  });
});

describe.each([
  ["local files", undefined],
  ["Turso", "libsql://test.turso.io"],
])("login lockout with %s", (_, tursoUrl) => {
  it("locks out after 10 failures, even for the right password, until the oldest is an hour old", async () => {
    const login = await load(tursoUrl);
    instantTimeout();
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-01T10:00:00Z") });
    await login(wrong());
    vi.setSystemTime(new Date("2026-11-01T10:20:00Z"));
    for (let i = 0; i < 9; i++) expect((await login(wrong())).status).toBe(401);

    const locked = await login(right());
    expect(locked.status).toBe(429);
    expect(locked.headers.get("Retry-After")).toBe(String(40 * 60));
    expect((await locked.json()).error).toBe("Too many failed logins. Try again in 40 minutes.");
    expect(locked.cookies.get(SESSION_COOKIE)).toBeUndefined();

    // Refused attempts aren't kept, so the lock lifts as the first failure expires.
    vi.setSystemTime(new Date("2026-11-01T11:00:01Z"));
    expect((await login(right())).status).toBe(200);
  });

  it("doesn't count successful logins", async () => {
    const login = await load(tursoUrl);
    instantTimeout();
    for (let i = 0; i < 9; i++) await login(wrong());
    for (let i = 0; i < 3; i++) expect((await login(right())).status).toBe(200);
    expect((await login(wrong())).status).toBe(401);
    expect((await login(right())).status).toBe(429);
  });

  it("counts guesses sent in parallel", async () => {
    const login = await load(tursoUrl);
    instantTimeout();
    const statuses = (await Promise.all(Array.from({ length: 25 }, () => login(wrong())))).map((r) => r.status);
    expect(statuses.filter((s) => s === 401)).toHaveLength(10);
    expect(statuses.filter((s) => s === 429)).toHaveLength(15);
  });
});

describe("login when attempts can't be recorded", () => {
  it("refuses with 503 instead of skipping the limit", async () => {
    const login = await load("libsql://test.turso.io");
    vi.spyOn(db, "batch").mockRejectedValue(new Error("network down"));
    const res = await login(right());
    expect(res.status).toBe(503);
    expect(res.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });
});

describe("POST /api/auth/logout", () => {
  it("expires the session cookie", async () => {
    const res = await logout();
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`${SESSION_COOKIE}=;.*Max-Age=0`));
  });
});
