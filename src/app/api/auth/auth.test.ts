import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as login } from "./login/route";
import { POST as logout } from "./logout/route";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";

const post = (body: unknown) =>
  new Request("http://localhost/api/auth/login", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

beforeEach(() => {
  vi.stubEnv("APP_USERNAME", "kay");
  vi.stubEnv("APP_PASSWORD", "s3cret");
  vi.stubEnv("AUTH_SECRET", "auth-secret");
});

describe("POST /api/auth/login", () => {
  it("sets a valid httpOnly session cookie on correct credentials", async () => {
    const res = await login(post({ username: "kay", password: "s3cret" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const cookie = res.cookies.get(SESSION_COOKIE)!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("lax");
    expect(cookie.path).toBe("/");
    expect(await verifySession(cookie.value, "auth-secret")).toBe(true);
  });

  // Skip the real brute-force delay but check it was requested.
  const instantTimeout = () =>
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => (fn(), 0)) as unknown as typeof setTimeout);

  it("rejects wrong credentials after a delay", async () => {
    const timeout = instantTimeout();
    const res = await login(post({ username: "kay", password: "wrong" }));
    expect(res.status).toBe(401);
    expect(timeout).toHaveBeenCalledWith(expect.any(Function), 800);
    expect(res.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it("rejects a wrong username even with the right password", async () => {
    instantTimeout();
    expect((await login(post({ username: "eve", password: "s3cret" }))).status).toBe(401);
  });

  it("rejects a malformed body", async () => {
    instantTimeout();
    expect((await login(post("not json"))).status).toBe(401);
  });

  it("returns 500 when login isn't configured", async () => {
    vi.stubEnv("AUTH_SECRET", "");
    const res = await login(post({ username: "kay", password: "s3cret" }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/not configured/);
  });
});

describe("POST /api/auth/logout", () => {
  it("expires the session cookie", async () => {
    const res = await logout();
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`${SESSION_COOKIE}=;.*Max-Age=0`));
  });
});
