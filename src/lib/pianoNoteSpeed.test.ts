import { describe, expect, it } from "vitest";
import { DrillRecord, Stats } from "./pianoDrill";
import { noteSpeed, todayNoteSpeed } from "./pianoNoteSpeed";

const st = (attempts: number, misses: number, ms?: number, msN?: number): Stats => ({ attempts, misses, slow: 0, ...(ms === undefined ? {} : { ms, msN }) });

describe("noteSpeed", () => {
  it("gives twelve keys, all no data for empty stats", () => {
    const r = noteSpeed({});
    expect(r.keys.map((k) => k.name)).toEqual(["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]);
    expect(r.keys.every((k) => k.band === "none" && k.avgMs === null)).toBe(true);
    expect(r.slow).toEqual([]);
  });

  it("bands by average: under 1 s fast, 1 to 2 s ok, over 2 s slow", () => {
    const r = noteSpeed({ C: st(4, 0, 2400, 4), D: st(2, 0, 2000, 2), E: st(2, 0, 4000, 2), "F#": st(2, 0, 4400, 2) });
    const band = (n: string) => r.keys.find((k) => k.name === n)!;
    expect(band("C")).toMatchObject({ band: "fast", avgMs: 600 });
    expect(band("D")).toMatchObject({ band: "ok", avgMs: 1000 }); // exactly 1 s is ok
    expect(band("E")).toMatchObject({ band: "ok", avgMs: 2000 }); // exactly 2 s is ok
    expect(band("F#")).toMatchObject({ band: "slow", avgMs: 2200 });
    expect(r.slow).toEqual(["F#"]);
  });

  it("calls a key with a high miss rate slow even when fast, or with no time at all", () => {
    const r = noteSpeed({ G: st(10, 3, 3500, 7), A: st(10, 2, 7000, 8), B: st(2, 2, 0, 0) });
    const band = (n: string) => r.keys.find((k) => k.name === n)!;
    expect(band("G").band).toBe("slow"); // 30% missed
    expect(band("A").band).toBe("fast"); // 20% missed, 0.875 s
    expect(band("B")).toMatchObject({ band: "slow", avgMs: null }); // only misses
    expect(r.slow).toEqual(["B", "G"]); // missed-only first, then by time
  });

  it("shows no data for old records (no ms) unless the key was missed", () => {
    const r = noteSpeed({ C: st(10, 0), D: st(10, 5) });
    expect(r.keys[0]).toMatchObject({ band: "none", avgMs: null, attempts: 10 });
    expect(r.keys[2].band).toBe("slow");
  });
});

describe("todayNoteSpeed", () => {
  const rec = (startedAt: number, drill: string, ms: number): DrillRecord => ({ id: `${drill}${startedAt}`, kind: "drill", drill, startedAt, durationMs: 1, updatedAt: startedAt, items: { C: { attempts: 1, misses: 0, slow: 0, avgMs: ms, ms } } });

  it("uses only the note drill's rounds since local midnight", () => {
    const now = new Date(2026, 10, 27, 9, 0).getTime();
    const yesterday = new Date(2026, 10, 26, 23, 59).getTime();
    const morning = new Date(2026, 10, 27, 0, 1).getTime();
    const r = todayNoteSpeed([rec(yesterday, "notes", 5000), rec(morning, "notes", 500), rec(morning + 1, "chords", 9000)], now);
    expect(r.keys[0]).toMatchObject({ name: "C", avgMs: 500, band: "fast", attempts: 1 });
  });
});
