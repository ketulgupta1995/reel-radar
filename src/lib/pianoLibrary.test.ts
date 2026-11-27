import { describe, expect, it } from "vitest";
import type { PianoSettings } from "./pianoData";
import type { DrillRecord } from "./pianoDrill";
import { lastPlayed, libraryRows, weakSpot } from "./pianoLibrary";
import { EXERCISES } from "./pianoExercises";
import { SONGS } from "./pianoSongLibrary";

const NOW = new Date(2026, 10, 27, 10).getTime();
const DAY = 86_400_000;
const rec = (drill: string, daysAgo: number, items: Record<string, [number, number, number]>): DrillRecord => ({
  id: `${drill}-${daysAgo}-${Object.keys(items)[0]}`,
  kind: "drill",
  drill,
  startedAt: NOW - daysAgo * DAY,
  durationMs: 120_000,
  items: Object.fromEntries(Object.entries(items).map(([id, [attempts, misses, slow]]) => [id, { attempts, misses, slow, avgMs: 900 }])),
  updatedAt: 0,
});
const settings = (over: Partial<PianoSettings> = {}): PianoSettings => ({ unlocks: {}, slowSteps: {}, slowAt: {}, months: [], songs: {}, importedSongs: {}, milestones: {}, updatedAt: 0, ...over });
const id = (s: string) => s;

describe("weakSpot", () => {
  it("lists slow items worst first when slow answers dominate", () => {
    const r = [rec("notes", 0, { "F#": [10, 0, 6], Bb: [10, 0, 4], C: [10, 0, 0], E: [10, 0, 2], A: [10, 0, 1] })];
    expect(weakSpot(r, "notes", NOW, id)).toBe("Slow: F#, Bb, E");
  });
  it("says Missed when misses dominate, and sums records of the window", () => {
    const r = [rec("chords", 1, { G7: [5, 3, 0] }), rec("chords", 2, { G7: [5, 2, 0], F: [4, 3, 0] })];
    expect(weakSpot(r, "chords", NOW, id, 2)).toBe("Missed: F, G7");
  });
  it("ignores records older than 7 days, other drills and clean items", () => {
    const r = [rec("notes", 7, { F: [10, 5, 0] }), rec("chords", 0, { G: [10, 5, 0] }), rec("notes", 0, { C: [10, 0, 0] })];
    expect(weakSpot(r, "notes", NOW, id)).toBeNull();
    expect(weakSpot([rec("notes", 6, { F: [10, 5, 0] })], "notes", NOW, id)).toBe("Missed: F");
  });
});

describe("lastPlayed", () => {
  it("names the days since the latest round", () => {
    expect(lastPlayed([], "notes", NOW)).toBe("Not started");
    expect(lastPlayed([rec("notes", 0, { C: [1, 0, 0] })], "notes", NOW)).toBe("Practised today");
    expect(lastPlayed([rec("notes", 1, { C: [1, 0, 0] })], "notes", NOW)).toBe("Practised yesterday");
    expect(lastPlayed([rec("notes", 9, { C: [1, 0, 0] }), rec("notes", 3, { C: [1, 0, 0] })], "notes", NOW)).toBe("3 days ago");
  });
});

describe("libraryRows", () => {
  it("gives levels, readable labels and the fallback notes", () => {
    const rows = libraryRows(
      [rec("chords", 0, { Bbm: [5, 4, 0], Eb7: [5, 2, 0] }), rec("fingers", 1, { "LH-Bb-4": [5, 0, 5], "RH-C-2": [5, 0, 3] }), rec("rhythm", 20, { "rest-beat-2": [4, 1, 0] })],
      settings({ unlocks: { notes: 3, chords: 9, rhythm: 2 } }),
      NOW,
    );
    expect(rows.map((r) => [r.key, r.level])).toEqual([["notes", "L3"], ["chords", "L4"], ["fingers", "L1"], ["rhythm", "L2"], ["ear", "L1"], ["songs", `0/${SONGS.length}`], ["scales", "new"]]);
    expect(rows[0]).toMatchObject({ note: "Not started", weak: false, levelHint: "Level 3 of 4" });
    expect(rows[1]).toMatchObject({ note: "Missed: B♭m, E♭7", weak: true, href: "/piano/chords" });
    expect(rows[2].note).toBe("Slow: LH finger 4 in B♭, RH finger 2 in C");
    expect(rows[3].note).toBe("20 days ago");
  });
  it("summarises songs and scales from the saved progress", () => {
    const [a, b, c] = SONGS;
    const rows = libraryRows(
      [],
      settings({
        songs: {
          [a.id]: { step: 3, tempo: 90, best: 95, mastered: true, at: 1 },
          [b.id]: { step: 1, tempo: 60, best: 80, at: 5 },
          [c.id]: { step: 0, tempo: 60, best: 0, at: 9 },
          "scale-c-major": { step: 1, tempo: 80, best: 70, at: 2 },
          [EXERCISES[0].id]: { step: 0, tempo: 60, best: 0, at: 3 },
        },
      }),
      NOW,
    );
    expect(rows[5]).toMatchObject({ level: `1/${SONGS.length}` });
    expect(rows[5].note).toContain(`${c.title} · Step 1 of 4`);
    expect(rows[6].level).toMatch(/^\d+\/\d+$/);
    expect(rows[6].note).toContain(`coordination 1/${EXERCISES.length}`);
  });
  it("shows a pick-next line when every started song is mastered", () => {
    const rows = libraryRows([], settings({ songs: { [SONGS[0].id]: { step: 3, tempo: 90, best: 95, mastered: true, at: 1 } } }), NOW);
    expect(rows[5].note).toBe("Pick the next song");
  });
});
