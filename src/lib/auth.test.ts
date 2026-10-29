import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_MAX_AGE, createSession, credentialsMatch, verifySession } from "./auth";

const SECRET = "test-secret";

describe("credentialsMatch", () => {
  it("accepts identical values and rejects different ones", async () => {
    expect(await credentialsMatch("admin", "admin", SECRET)).toBe(true);
    expect(await credentialsMatch("admin", "Admin", SECRET)).toBe(false);
    expect(await credentialsMatch("", "admin", SECRET)).toBe(false);
  });
});

describe("sessions", () => {
  afterEach(() => vi.useRealTimers());

  it("verifies a freshly created session", async () => {
    const token = await createSession(SECRET);
    expect(token).toMatch(/^\d+\.[0-9a-f]{64}$/);
    expect(await verifySession(token, SECRET)).toBe(true);
  });

  it("rejects a session signed with another secret", async () => {
    const token = await createSession(SECRET);
    expect(await verifySession(token, "other-secret")).toBe(false);
  });

  it("rejects a tampered expiry", async () => {
    const [expires, sig] = (await createSession(SECRET)).split(".");
    expect(await verifySession(`${Number(expires) + 1000}.${sig}`, SECRET)).toBe(false);
  });

  it("rejects an expired session", async () => {
    vi.useFakeTimers();
    const token = await createSession(SECRET);
    vi.setSystemTime(Date.now() + SESSION_MAX_AGE * 1000 + 1);
    expect(await verifySession(token, SECRET)).toBe(false);
  });

  it("rejects missing or malformed input", async () => {
    expect(await verifySession(undefined, SECRET)).toBe(false);
    expect(await verifySession(await createSession(SECRET), undefined)).toBe(false);
    expect(await verifySession("garbage", SECRET)).toBe(false);
    expect(await verifySession(".", SECRET)).toBe(false);
  });
});
