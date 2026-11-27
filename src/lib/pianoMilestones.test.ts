import { describe, expect, it } from "vitest";
import type { PianoSettings } from "./pianoData";
import type { DrillRecord, ItemTotals } from "./pianoDrill";
import { MILESTONES, metNow, newlyMet } from "./pianoMilestones";

const NOW = new Date(2026, 10, 27, 20, 0).getTime();
const day = (back: number) => new Date(2026, 10, 27 - back, 9, 0).getTime();
const settings = (over: Partial<PianoSettings> = {}): PianoSettings => ({ unlocks: {}, slowSteps: {}, slowAt: {}, months: [], songs: {}, importedSongs: {}, milestones: {}, updatedAt: 0, ...over });
let n = 0;
const rec = (drill: string, startedAt: number, items: Record<string, ItemTotals>, durationMs = 11 * 60_000): DrillRecord => ({ id: `m${n++}`, kind: "drill", drill, startedAt, durationMs, items, updatedAt: startedAt });
const fast = (ms = 800): ItemTotals => ({ attempts: 5, misses: 0, slow: 0, avgMs: ms, ms: ms * 5 });
const mastered = { step: 3, tempo: 100, best: 95, mastered: true, at: 1 };

describe("milestones", () => {
  it("has eight, each with a title and a how-to", () => {
    expect(MILESTONES.map((m) => m.id)).toEqual(["first-step", "first-song", "five-songs", "naturals-1s", "all-notes-1s", "streak-7", "streak-30", "hours-10"]);
    expect(metNow([], settings(), NOW)).toEqual([]);
  });
  it("counts song steps and mastered songs", () => {
    expect(metNow([], settings({ songs: { a: { step: 1, tempo: 60, best: 0, at: 1 } } }), NOW)).toEqual(["first-step"]);
    const five = Object.fromEntries(["a", "b", "c", "d", "e"].map((id) => [id, mastered]));
    expect(metNow([], settings({ songs: five }), NOW)).toEqual(["first-step", "first-song", "five-songs"]);
  });
  it("checks note speed over the last 30 days: naturals, then every note", () => {
    const naturals = Object.fromEntries(["C", "D", "E", "F", "G", "A", "B"].map((k) => [k, fast()]));
    expect(metNow([rec("notes", day(2), naturals, 60_000)], settings(), NOW)).toEqual(["naturals-1s"]);
    expect(metNow([rec("notes", day(40), naturals, 60_000)], settings(), NOW)).toEqual([]); // too long ago
    expect(metNow([rec("notes", day(2), { ...naturals, B: fast(1500) }, 60_000)], settings(), NOW)).toEqual([]);
    const all = { ...naturals, ...Object.fromEntries(["C#", "D#", "F#", "G#", "A#"].map((k) => [k, fast()])) };
    expect(metNow([rec("notes", day(2), all, 60_000)], settings(), NOW)).toEqual(["naturals-1s", "all-notes-1s"]);
  });
  it("counts the streak and the hours", () => {
    const week = Array.from({ length: 7 }, (_, i) => rec("songs", day(i), {}));
    expect(metNow(week, settings(), NOW)).toEqual(["streak-7"]);
    const month = Array.from({ length: 30 }, (_, i) => rec("songs", day(i), {}, 21 * 60_000));
    expect(metNow(month, settings(), NOW)).toEqual(["streak-7", "streak-30", "hours-10"]);
  });
  it("reports only the ones not saved yet", () => {
    const s = settings({ songs: { a: mastered }, milestones: { "first-step": 5 } });
    expect(newlyMet([], s, NOW)).toEqual(["first-song"]);
    expect(newlyMet([], { ...s, milestones: undefined } as unknown as PianoSettings, NOW)).toEqual(["first-step", "first-song"]);
  });
});
