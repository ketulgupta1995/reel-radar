import { describe, expect, it } from "vitest";
import type { DrillRecord, ItemTotals } from "./pianoDrill";
import type { PianoSettings } from "./pianoData";
import { MAX_ITEMS, Plan, REVIEW_DAYS, SONG_MIN, SongTarget, DrillTarget, WARMUP_MIN, WEAK_MIN, canSwap, plan, swap } from "./pianoSession";
import { SONGS } from "./pianoSongLibrary";

const NOW = new Date(2026, 10, 27, 10, 0).getTime();
const day = (back: number, h = 9) => new Date(2026, 10, 27 - back, h, 0).getTime();
const t = (attempts: number, misses = 0, slow = 0): ItemTotals => ({ attempts, misses, slow, avgMs: 900 });
let n = 0;
const rec = (drill: string, startedAt: number, items: Record<string, ItemTotals>): DrillRecord => ({ id: `r${n++}`, kind: "drill", drill, startedAt, durationMs: 120_000, items, updatedAt: startedAt });
const settings = (over: Partial<PianoSettings> = {}): PianoSettings => ({ unlocks: {}, slowSteps: {}, slowAt: {}, months: [], songs: {}, importedSongs: {}, milestones: {}, updatedAt: 0, ...over });
const drillOf = (p: Plan, i: 0 | 1 | 2) => p.steps[i].target as DrillTarget;
const songOf = (p: Plan) => p.steps[2].target as SongTarget;

describe("empty history", () => {
  it("gives the default plan", () => {
    const p = plan([], settings(), NOW);
    expect(p.steps.map((s) => s.id)).toEqual(["warmup", "weak", "song"]);
    expect(drillOf(p, 0)).toEqual({ kind: "drill", drill: "fingers", items: ["RH-C-1", "RH-C-2", "RH-C-3", "RH-C-4", "RH-C-5"], minutes: WARMUP_MIN });
    expect(drillOf(p, 1)).toEqual({ kind: "drill", drill: "notes", minutes: WEAK_MIN });
    expect(songOf(p)).toEqual({ kind: "song", song: "mary-had-a-little-lamb", hands: "R", mode: "wait", tempo: 60, minutes: SONG_MIN });
    for (const s of p.steps) expect(s.label && s.why).toBeTruthy();
  });
  it("is deterministic", () => {
    const rs = [rec("notes", day(0), { C: t(10, 3) })];
    expect(plan(rs, settings(), NOW)).toEqual(plan(rs, settings(), NOW));
  });
});

describe("warm-up", () => {
  const bg = rec("chords", day(0), { C: t(20, 20) }); // makes the weak spot chords, so it does not collide with the warm-up
  it("uses yesterday's missed or slow items, worst first, capped", () => {
    const items: Record<string, ItemTotals> = { C: t(10), D: t(10, 2), E: t(10, 0, 4), F: t(10, 1), G: t(10, 3), A: t(10, 1, 1), B: t(10, 5) };
    const p = plan([rec("notes", day(1), items), bg], settings(), NOW);
    const w = drillOf(p, 0);
    expect(w.drill).toBe("notes");
    expect(w.items).toHaveLength(MAX_ITEMS);
    expect(w.items![0]).toBe("B");
    expect(w.items).not.toContain("C");
    expect(w.minutes).toBe(2);
    expect(p.steps[0].why).toBe("Slow or missed 6 notes yesterday");
  });
  it("ignores other days, including today and two days ago", () => {
    const p = plan([rec("notes", day(0), { C: t(5, 5) }), rec("notes", day(2), { D: t(5, 5) })], settings(), NOW);
    expect(drillOf(p, 0).drill).toBe("fingers");
  });
  it("counts the local day edges", () => {
    const p = plan([rec("notes", new Date(2026, 10, 26, 0, 1).getTime(), { C: t(5, 1) }), rec("notes", new Date(2026, 10, 26, 23, 59).getTime(), { D: t(5, 1) }), bg], settings(), NOW);
    expect(drillOf(p, 0).items).toEqual(["C", "D"]);
  });
  it("picks the drill with more trouble and offers the other as an alternate", () => {
    const p = plan([rec("notes", day(1), { C: t(10, 1) }), rec("fingers", day(1), { "RH-C-2": t(10, 4), "RH-C-3": t(10, 2) }), bg], settings(), NOW);
    expect(drillOf(p, 0)).toMatchObject({ drill: "fingers", items: ["RH-C-2", "RH-C-3"] });
    expect((p.alternates[0][0].target as DrillTarget)).toMatchObject({ drill: "notes", items: ["C"] });
  });
  it("falls back to five-finger at the unlocked level (whole pool above level 1)", () => {
    const p = plan([], settings({ unlocks: { fingers: 3 } }), NOW);
    expect(drillOf(p, 0)).toEqual({ kind: "drill", drill: "fingers", minutes: 2 });
    expect(p.steps[0].why).toContain("3 of 4");
  });
  it("ignores yesterday's perfect rounds", () => {
    const p = plan([rec("notes", day(1), { C: t(10) })], settings(), NOW);
    expect(drillOf(p, 0).drill).toBe("fingers");
  });
  it("ignores manual entries", () => {
    const manual = { id: "m1", kind: "manual" as const, startedAt: day(1), durationMs: 600_000, note: "scales", updatedAt: day(1) };
    expect(plan([manual], settings(), NOW)).toEqual(plan([], settings(), NOW));
  });
  it("does not repeat the weak spot when yesterday was the only practice", () => {
    const p = plan([rec("notes", day(1), { C: t(10, 3), D: t(10, 1) })], settings(), NOW);
    expect(drillOf(p, 1)).toMatchObject({ drill: "notes", items: ["C", "D"] });
    expect(drillOf(p, 0)).toMatchObject({ drill: "fingers", items: ["RH-C-1", "RH-C-2", "RH-C-3", "RH-C-4", "RH-C-5"] });
    expect(p.alternates[0].map((s) => (s.target as DrillTarget).items)).toEqual([["C", "D"], undefined]); // still swappable to
  });
  it("alternates end with the plain note drill, and do not repeat the main step", () => {
    const p = plan([], settings(), NOW);
    expect(p.alternates[0].map((s) => drillOf({ ...p, steps: [s, s, s] }, 0).drill)).toEqual(["notes"]);
  });
});

describe("weak spot", () => {
  it("picks the worst error rate over 7 days with its weakest items", () => {
    const rs = [
      rec("notes", day(0), { C: t(20, 1), D: t(20, 1) }),
      rec("chords", day(3), { C: t(10, 3), G: t(10, 4, 2), F: t(10) }),
      rec("fingers", day(6), { "RH-C-1": t(30, 2) }),
    ];
    const p = plan(rs, settings(), NOW);
    expect(drillOf(p, 1)).toEqual({ kind: "drill", drill: "chords", items: ["G", "C"], minutes: 3 });
    expect(p.steps[1].why).toBe("Error rate 27% over the last 7 days");
    expect(p.alternates[1].map((s) => (s.target as DrillTarget).drill).slice(0, 2)).toEqual(["fingers", "notes"]);
  });
  it("counts slow answers as half a miss", () => {
    const rs = [rec("notes", day(0), { C: t(10, 0, 10) }), rec("chords", day(0), { C: t(10, 6) })];
    expect(drillOf(plan(rs, settings(), NOW), 1).drill).toBe("chords");
    const rs2 = [rec("notes", day(0), { C: t(10, 0, 10) }), rec("chords", day(0), { C: t(10, 4) })];
    expect(drillOf(plan(rs2, settings(), NOW), 1).drill).toBe("notes");
  });
  it("ignores records older than 7 days and drills with too few attempts", () => {
    const rs = [rec("chords", day(7), { C: t(20, 20) }), rec("fingers", day(1), { "RH-C-1": t(5, 5) }), rec("notes", day(2), { C: t(20, 1) })];
    const p = plan(rs, settings(), NOW);
    expect(drillOf(p, 1)).toMatchObject({ drill: "notes", items: ["C"] });
  });
  it("uses whole local days: from midnight six days back", () => {
    const rs = [rec("chords", new Date(2026, 10, 20, 23, 59).getTime(), { C: t(20, 20) }), rec("fingers", new Date(2026, 10, 21, 0, 0).getTime(), { "RH-C-1": t(10, 5) }), rec("notes", day(0), { C: t(20, 1) })];
    const p = plan(rs, settings(), NOW);
    expect(drillOf(p, 1)).toMatchObject({ drill: "fingers", items: ["RH-C-1"] });
    expect(p.alternates[1].some((s) => (s.target as DrillTarget).drill === "chords" && s.why.startsWith("Error"))).toBe(false);
  });
  it("breaks ties in the fixed drill order", () => {
    const rs = [rec("fingers", day(0), { "RH-C-1": t(10, 2) }), rec("chords", day(0), { C: t(10, 2) })];
    expect(drillOf(plan(rs, settings(), NOW), 1).drill).toBe("chords");
  });
  it("has no filter when the drill has no misses, and offers rhythm only once played", () => {
    const p = plan([rec("notes", day(0), { C: t(20) })], settings(), NOW);
    expect(drillOf(p, 1)).toEqual({ kind: "drill", drill: "notes", minutes: 3 });
    expect(p.alternates[1].some((s) => (s.target as DrillTarget).drill === "rhythm")).toBe(false);
    const p2 = plan([rec("rhythm", day(0), { r1: t(4, 4) })], settings(), NOW);
    expect(p2.alternates[1].some((s) => (s.target as DrillTarget).drill === "rhythm")).toBe(true);
    expect(drillOf(p2, 1).drill).toBe("notes");
  });
  it("includes rhythm in the ranking when it has enough attempts", () => {
    const rs = [rec("rhythm", day(0), { r1: t(10, 5) }), rec("notes", day(0), { C: t(10, 1) })];
    expect(drillOf(plan(rs, settings(), NOW), 1)).toMatchObject({ drill: "rhythm", items: ["r1"] });
  });
});

describe("song", () => {
  const prog = (step: number, at: number, extra = {}) => ({ step, tempo: 70, best: 50, at, ...extra });
  it("takes the most recently practised unmastered song at its next step and ladder tempo", () => {
    const [a, b] = [SONGS[0], SONGS[2]];
    const p = plan([], settings({ songs: { [a.id]: prog(1, 100), [b.id]: prog(2, 200) } }), NOW);
    expect(songOf(p)).toEqual({ kind: "song", song: b.id, hands: "both", mode: "wait", tempo: 70, minutes: 5 });
    expect((p.alternates[2][0].target as SongTarget)).toMatchObject({ song: a.id, hands: "L", mode: "wait" });
  });
  it("skips mastered songs and clamps tempo to the song's bpm", () => {
    const [a, b] = [SONGS[0], SONGS[1]];
    const p = plan([], settings({ songs: { [a.id]: prog(3, day(2), { mastered: true }), [b.id]: prog(3, 100, { tempo: 999 }) } }), NOW);
    expect(songOf(p)).toMatchObject({ song: b.id, hands: "both", mode: "play", tempo: b.bpm });
  });
  it("starts the next easiest song when everything started is mastered", () => {
    const p = plan([], settings({ songs: { [SONGS[0].id]: prog(3, day(2), { mastered: true }) } }), NOW);
    expect(songOf(p)).toMatchObject({ song: SONGS[1].id, hands: "R", mode: "wait" });
  });
  it("brings back the mastered song unplayed longest, about once a week, ahead of the song in progress", () => {
    const [a, b, c] = [SONGS[0], SONGS[1], SONGS[2]];
    const songs = { [a.id]: prog(3, day(20), { mastered: true }), [b.id]: prog(3, day(40), { mastered: true }), [c.id]: prog(1, day(1)) };
    // b's progress is older, but it was played 12 days ago (a "songs" record), so a (20 days) is the one due
    const played = [rec("songs", day(12), { [b.id]: t(1) })];
    const p = plan(played, settings({ songs }), NOW);
    expect(songOf(p)).toMatchObject({ song: a.id, hands: "both", mode: "play", tempo: a.bpm });
    expect(p.steps[2].label).toBe(`Review: ${a.title}`);
    expect(p.steps[2].why).toBe("Mastered, not played for 20 days: keep it fresh");
    expect((p.alternates[2][0].target as SongTarget).song).toBe(c.id); // the song in progress is one Swap away
    expect(p.alternates[2].filter((x) => (x.target as SongTarget).song === a.id)).toHaveLength(0); // listed once
  });
  it("skips the review when a mastered song was played this week or none is due yet", () => {
    const [a, b] = [SONGS[0], SONGS[1]];
    const songs = { [a.id]: prog(3, day(30), { mastered: true }), [b.id]: prog(3, day(30), { mastered: true }) };
    expect(songOf(plan([rec("songs", day(3), { [b.id]: t(1) })], settings({ songs }), NOW)).song).not.toBe(a.id);
    const fresh = { [a.id]: prog(3, day(REVIEW_DAYS - 2), { mastered: true }) };
    expect(plan([], settings({ songs: fresh }), NOW).steps[2].label).not.toMatch(/^Review/);
  });
  it("replays mastered songs last, and ignores progress of songs that are not built in", () => {
    const songs: Record<string, ReturnType<typeof prog>> = { "scale-c": prog(1, 5), "imported-x": prog(1, 5) };
    for (const s of SONGS) songs[s.id] = prog(3, 1, { mastered: true });
    const p = plan([], settings({ songs }), NOW);
    expect(songOf(p)).toMatchObject({ song: SONGS[0].id, hands: "both", mode: "play", tempo: SONGS[0].bpm });
    expect(p.alternates[2]).toHaveLength(SONGS.length - 1);
  });
  it("breaks 'at' ties by library order", () => {
    const p = plan([], settings({ songs: { [SONGS[3].id]: prog(0, 5), [SONGS[1].id]: prog(0, 5) } }), NOW);
    expect((p.steps[2].target as SongTarget).song).toBe(SONGS[1].id);
  });
});

describe("swap", () => {
  it("replaces one step with its next alternate and leaves the rest", () => {
    const p = plan([], settings(), NOW);
    const q = swap(p, 2);
    expect(q.steps[0]).toBe(p.steps[0]);
    expect(q.steps[2]).toBe(p.alternates[2][0]);
    expect(q.alternates[2]).toHaveLength(p.alternates[2].length - 1);
    expect(p.alternates[2]).toHaveLength(SONGS.length - 1); // input untouched
    expect(swap(q, 2).steps[2]).toBe(p.alternates[2][1]);
  });
  it("does nothing once alternates run out", () => {
    let p = plan([], settings(), NOW);
    while (canSwap(p, 0)) p = swap(p, 0);
    expect(p.alternates[0]).toEqual([]);
    expect(swap(p, 0)).toBe(p);
    expect(canSwap(p, 0)).toBe(false);
  });
});
