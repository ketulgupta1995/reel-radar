// @vitest-environment jsdom
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { makeEpub } from "./epub";

describe("makeEpub", () => {
  it("gives the same bytes for the same options, whatever the time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-04T10:00:00Z"));
    const first = await makeEpub();
    vi.setSystemTime(new Date("2026-11-04T10:00:05Z"));
    const later = await makeEpub();
    vi.useRealTimers();
    expect(Buffer.compare(Buffer.from(first), Buffer.from(later))).toBe(0);
  });

  it("holds only dated-once files, with no folder entries", async () => {
    const zip = await JSZip.loadAsync(await makeEpub());
    expect(Object.values(zip.files).filter((f) => f.dir)).toEqual([]);
    expect(new Set(Object.values(zip.files).map((f) => f.date.getTime())).size).toBe(1);
  });
});
