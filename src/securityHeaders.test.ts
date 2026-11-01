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
  });
});
