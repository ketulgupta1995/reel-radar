import { describe, expect, it } from "vitest";
import { statsFrom } from "./pianoDrill";
import { GROUP_NAMES, PATTERNS, PASS_RATE, RhythmRound, WINDOW_STEPS, barMs, onsetSlots, patternOnsets } from "./pianoRhythm";

const byId = (id: string) => PATTERNS.find((p) => p.id === id)!;
const mk = (o: Partial<ConstructorParameters<typeof RhythmRound>[0]> = {}, rng = () => 0) => {
  let t = 1000;
  const clock = { now: () => t, set: (v: number) => (t = v) };
  const round = new RhythmRound({ settings: { unlocked: 1, slowStep: 0 }, now: clock.now, wall: () => 5_000_000 + t, rng, ...o });
  return { round, clock };
};
// Hits exactly on the expected onsets, shifted by `by` ms.
const play = (round: RhythmRound, start: number, bpm: number, by = 0) => round.expected(start, bpm).map((e) => e + by);

describe("patterns", () => {
  it("every pattern is one bar of eight slots with a note on the first non-rest slot, in five groups", () => {
    expect(GROUP_NAMES).toHaveLength(5);
    for (const p of PATTERNS) {
      expect(p.slots).toHaveLength(8);
      expect(p.slots).toMatch(/^[x\-.]+$/);
      expect(p.slots).not.toMatch(/(^|\.)-/); // a held slot always follows a note
      expect(onsetSlots(p).length).toBeGreaterThan(0);
    }
    expect(new Set(PATTERNS.map((p) => p.id)).size).toBe(PATTERNS.length);
    expect([...new Set(PATTERNS.map((p) => p.group))]).toEqual([0, 1, 2, 3, 4]);
  });

  it("puts onsets at the right times for a tempo, two bars", () => {
    // 60 BPM: a beat is 1000 ms, an eighth 500 ms, a bar 4000 ms.
    expect(barMs(60)).toBe(4000);
    expect(patternOnsets(byId("quarters"), 60, 10_000)).toEqual([10_000, 11_000, 12_000, 13_000, 14_000, 15_000, 16_000, 17_000]);
    expect(patternOnsets(byId("dotted-1"), 120, 0, 1)).toEqual([0, 750, 1000, 1750]);
    expect(patternOnsets(byId("eighths"), 60, 0, 1)).toEqual([0, 500, 1000, 1500, 2000, 2500, 3000, 3500]);
    expect(patternOnsets(byId("synco-3"), 60, 0, 1)).toEqual([500, 1500, 2500, 3500]);
  });
});

describe("RhythmRound", () => {
  it("scores a perfect run, a late run and a skipped note, with the window and latency", () => {
    const { round } = mk();
    expect(round.current.id).toBe("quarters");
    expect(round.windowMs).toBe(WINDOW_STEPS[0]);
    const perfect = round.score(10_000, 60, play(round, 10_000, 60));
    expect(perfect.result.rate).toBe(1);
    expect(perfect.result.pass).toBe(true);
    expect(perfect.result.meanOffsetMs).toBe(0);
    // 120 ms late is outside +-100 but inside the match reach: "late"; latency 120 puts it back on time.
    const late = round.score(10_000, 60, play(round, 10_000, 60, 120));
    expect(late.result.scores.every((s) => s.grade === "late")).toBe(true);
    expect(late.result.rate).toBe(0);
    expect(round.score(10_000, 60, play(round, 10_000, 60, 120), 120).result.rate).toBe(1);
    // One note skipped, one stray hit: 7 on time out of 8 + 1 stray = 7/9.
    const hits = play(round, 10_000, 60);
    hits.shift();
    hits.push(13_000 + 400);
    const r = round.score(10_000, 60, hits).result;
    expect(r.scores[0].grade).toBe("missed");
    expect(r.extra).toHaveLength(1);
    expect(r.onTime).toBe(7);
    expect(r.rate).toBeCloseTo(7 / 9);
    expect(r.pass).toBe(r.rate >= PASS_RATE);
  });

  it("saves one drill record: attempts = runs, misses = failed runs, slow 0, avgMs = mean absolute offset", () => {
    const { round, clock } = mk();
    round.score(0, 60, play(round, 0, 60, 30)); // pass, 30 ms off
    round.score(0, 60, play(round, 0, 60, -50).slice(0, 2)); // two of eight: fail
    clock.set(61_000);
    const { record, summary } = round.finish("s1", 61_000);
    expect(record).toMatchObject({ id: "s1", kind: "drill", drill: "rhythm", startedAt: 5_001_000, durationMs: 60_000 });
    expect(record!.items.quarters).toEqual({ attempts: 2, misses: 1, slow: 0, avgMs: 40 });
    expect(summary).toMatchObject({ attempts: 2, accuracy: 0.5, avgMs: 40, windowMs: 100 });
    expect(summary.weakest).toEqual([{ id: "quarters", label: "Four quarters", attempts: 2, misses: 1 }]);
    expect(round.closed).toBe(true);
    expect(statsFrom([record!], "rhythm").quarters).toEqual({ attempts: 2, misses: 1, slow: 0 });
  });

  it("saves nothing for a round with no finished pattern, and caps the duration at the round end", () => {
    const { round } = mk();
    expect(round.finish("x").record).toBeNull();
    const b = mk();
    b.round.score(0, 60, []);
    expect(b.round.finish("y", 1_000_000).record!.durationMs).toBe(120_000);
    expect(b.round.timeLeft(1000 + 100_000)).toBe(20_000);
    expect(b.round.over(1000 + 120_000)).toBe(true);
  });

  it("unlocks the next group after 5 of the last 6 runs pass, only once the window is full", () => {
    const { round } = mk();
    const good = () => round.score(0, 60, play(round, 0, 60, 10));
    for (let i = 0; i < 5; i++) expect(good().changed).toBe(false);
    expect(round.settings.unlocked).toBe(1);
    expect(good().changed).toBe(true); // 6 runs, all pass; the mean rate also narrows the window
    expect(round.settings).toEqual({ unlocked: 2, slowStep: 1 });
    expect(round.pool.some((p) => p.group === 1)).toBe(true);
    // The window restarts after a change.
    for (let i = 0; i < 5; i++) expect(good().changed).toBe(false);
    // Failing runs never unlock.
    const c = mk();
    for (let i = 0; i < 12; i++) c.round.score(0, 60, []);
    expect(c.round.settings).toEqual({ unlocked: 1, slowStep: 0 });
  });

  it("narrows 100 -> 80 -> 60 while the on-time rate stays high, and stops at the last step", () => {
    const { round } = mk({ settings: { unlocked: 5, slowStep: 0 } });
    const steps: number[] = [];
    for (let i = 0; i < 20; i++) {
      round.score(0, 60, play(round, 0, 60, 5));
      steps.push(round.windowMs);
    }
    expect(steps[5]).toBe(80);
    expect(steps[11]).toBe(60);
    expect(steps[19]).toBe(60);
    expect(round.settings.unlocked).toBe(5); // already everything
    // A run that is on time at 100 ms but not at 60 stays put: mean rate below 0.9.
    const slow = mk({ settings: { unlocked: 5, slowStep: 0 } });
    for (let i = 0; i < 12; i++) slow.round.score(0, 60, play(slow.round, 0, 60, 90));
    expect(slow.round.windowMs).toBeGreaterThanOrEqual(80);
  });

  it("clamps saved settings and picks only from open groups, never the same pattern twice, weakest more often", () => {
    const { round } = mk({ settings: { unlocked: 99, slowStep: 99 } });
    expect(round.settings).toEqual({ unlocked: 5, slowStep: 2 });
    const open = mk({ settings: { unlocked: 1, slowStep: 0 } }, () => 0.99);
    for (let i = 0; i < 20; i++) {
      const was = open.round.current.id;
      open.round.next();
      expect(open.round.current.group).toBe(0);
      expect(open.round.current.id).not.toBe(was);
    }
    // History says "whole" is always missed and the others are mastered: it is picked far more.
    const history = { quarters: { attempts: 50, misses: 0, slow: 0 }, "half-quarters": { attempts: 50, misses: 0, slow: 0 }, "quarters-half": { attempts: 50, misses: 0, slow: 0 }, whole: { attempts: 10, misses: 10, slow: 0 } };
    let seed = 7;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const w = mk({ history, settings: { unlocked: 1, slowStep: 0 } }, rng);
    let whole = 0;
    for (let i = 0; i < 300; i++) {
      w.round.next();
      if (w.round.current.id === "whole") whole++;
    }
    expect(whole).toBeGreaterThan(100); // never twice in a row caps it near 150
  });

  it("reports groups unlocked during the round", () => {
    const { round } = mk();
    for (let i = 0; i < 6; i++) round.score(0, 60, play(round, 0, 60));
    expect(round.finish("z").summary.unlockedNow).toEqual(["Eighths"]);
  });
});
