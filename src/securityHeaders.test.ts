import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS config without type declarations
import nextConfig from "../next.config.mjs";

describe("security headers", () => {
  it("are sent on every path and forbid framing", async () => {
    const rules = await nextConfig.headers();
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe("/:path*");
    const headers = Object.fromEntries(rules[0].headers.map((h: { key: string; value: string }) => [h.key, h.value]));
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    // The microphone is for this site's voice notes only; the camera and location stay off.
    expect(headers["Permissions-Policy"]).toBe("camera=(), microphone=(self), geolocation=()");
  });
});

describe("planner redirects", () => {
  it("send the old planner pages to /todos, for now only (not cached as permanent)", async () => {
    const rules: { source: string; destination: string; permanent: boolean }[] = await nextConfig.redirects();
    expect(rules.map((r) => r.source).sort()).toEqual(["/planner-next", "/todos/goals", "/todos/lists", "/todos/review", "/todos/search", "/todos/stats"]);
    expect(rules.every((r) => r.destination === "/todos" && !r.permanent)).toBe(true);
  });
});
