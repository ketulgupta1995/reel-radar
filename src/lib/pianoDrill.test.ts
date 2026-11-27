import { describe, expect, it } from "vitest";
import { DrillDef, DrillRound, MIN_ATTEMPTS, MIN_WEIGHT, SessionRecord, median, statsFrom, weightOf } from "./pianoDrill";
import { NOTE_DRILL } from "./pianoNoteDrill";

// Time stands still until a test moves it; randomness is a fixed number or a list.
function setup(over: { rng?: () => number; settings?: { unlocked: number; slowStep: number }; history?: Record<string, { attempts: number; misses: number; slow: number }>; def?: DrillDef<never> } = {}) {
  const clock = { t: 1000 };
  const round = new DrillRound({
    def: (over.def ?? NOTE_DRILL) as typeof NOTE_DRILL,
    settings: over.settings ?? { unlocked: 1, slowStep: 0 },
    history: over.history,
    now: () => clock.t,
    wall: () => 5_000_000 + clock.t,
    rng: over.rng ?? (() => 0),
  });
  // Answer the shown note correctly after `ms`, in octave 4 (or wrongly with a different pitch class).
  const answer = (ms: number, right = true) => {
    clock.t += ms;
    const pc = NOTE_DRILL.items.find((i) => i.id === round.current.id)!.pc;
    return round.handle({ type: "on", note: 60 + (right ? pc : (pc + 1) % 12), time: clock.t });
  };
  return { round, clock, answer };
}

describe("note drill judging", () => {
  it("accepts any octave of the shown pitch class and calls other notes a miss", () => {
    const { round, clock } = setup();
    expect(round.current.id).toBe("C");
    expect(round.handle({ type: "on", note: 36, time: clock.t + 400 }).outcome).toBe("correct");
    expect(round.current.id).not.toBe("C");
    const wanted = round.current.id;
    const wrong = wanted === "D" ? 60 : 62; // C or D
    expect(round.handle({ type: "on", note: wrong, time: clock.t + 400 })).toMatchObject({ outcome: "miss", advanced: false });
  });

  it("uses sharps and lights every octave of the target within the range", () => {
    expect(NOTE_DRILL.items.map((i) => i.id)).toEqual(["C", "D", "E", "F", "G", "A", "B", "C#", "D#", "F#", "G#", "A#"]);
    const hint = NOTE_DRILL.hint(NOTE_DRILL.items[7], { low: 48, high: 72 });
    expect([...hint.lit]).toEqual([49, 61]);
  });
});

describe("a round", () => {
  it("lasts two minutes, and the hint shows after a miss or 2 s", () => {
    const { round, clock, answer } = setup();
    expect(round.timeLeft()).toBe(120_000);
    expect(round.hintVisible()).toBe(false);
    clock.t += 1999;
    expect(round.hintVisible()).toBe(false);
    clock.t += 1;
    expect(round.hintVisible()).toBe(true);
    answer(100);
    expect(round.hintVisible()).toBe(false);
    answer(100, false);
    expect(round.hintVisible()).toBe(true);
    clock.t += 120_000;
    expect(round.over()).toBe(true);
    expect(round.timeLeft()).toBe(0);
  });

  it("counts the first answer only; a miss keeps the item until it is played right", () => {
    const { round, answer } = setup();
    const first = round.current.id;
    answer(300, false);
    answer(300, false);
    expect(round.current.id).toBe(first);
    answer(300);
    expect(round.current.id).not.toBe(first);
    const { record, summary } = round.finish("s1");
    expect(record!.items[first]).toEqual({ attempts: 1, misses: 1, slow: 0, avgMs: 0 });
    expect(summary.accuracy).toBe(0);
  });

  it("counts a correct answer over the slow limit as slow, not as a miss", () => {
    const { round, answer } = setup();
    const id = round.current.id;
    answer(2500);
    const { record, summary } = round.finish("s");
    expect(record!.items[id]).toEqual({ attempts: 1, misses: 0, slow: 1, avgMs: 2500 });
    expect(summary).toMatchObject({ accuracy: 1, avgMs: 2500, weakest: [{ id, slow: 1, misses: 0 }] });
    // exactly at the limit is not slow
    const b = setup();
    b.answer(2000);
    expect(b.round.finish("x").record!.items.C.slow).toBe(0);
  });

  it("saves a record with unique id, drill, start and duration; nothing for an empty round", () => {
    const { round, clock, answer } = setup();
    answer(500);
    clock.t += 1500;
    const { record } = round.finish("abc");
    expect(record).toMatchObject({ id: "abc", kind: "drill", drill: "notes", startedAt: 5_001_000, durationMs: 2000 });
    expect(setup().round.finish("e").record).toBeNull();
    expect(setup().round.finish("e").summary).toMatchObject({ attempts: 0, accuracy: 0, avgMs: 0, weakest: [] });
    // a long wait is capped at the round length
    const late = setup();
    late.answer(10);
    expect(late.round.finish("z", late.clock.t + 999_999).record!.durationMs).toBe(120_000);
  });

  it("lists the three weakest, worst first", () => {
    const { round, answer } = setup({ settings: { unlocked: 4, slowStep: 0 }, rng: (() => { let i = 0; return () => ((i++ * 0.37) % 1); })() });
    for (let i = 0; i < 40; i++) answer(300, i % 3 !== 0);
    const { summary } = round.finish("w");
    expect(summary.weakest.length).toBeLessThanOrEqual(3);
    const rates = summary.weakest.map((w) => (w.misses + w.slow / 2) / w.attempts);
    expect([...rates].sort((a, b) => b - a)).toEqual(rates);
  });
});

describe("item selection", () => {
  it("weights by error and slow rate with a floor, and unseen items at 1", () => {
    expect(weightOf(undefined)).toBe(1);
    expect(weightOf({ attempts: 10, misses: 0, slow: 0 })).toBe(MIN_WEIGHT);
    expect(weightOf({ attempts: 10, misses: 2, slow: 2 })).toBeCloseTo(0.3);
    expect(weightOf({ attempts: 4, misses: 4, slow: 0 })).toBe(1);
  });

  it("draws weak items more often, never the same twice in a row, and only unlocked ones", () => {
    let seed = 7;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const history = { C: { attempts: 50, misses: 0, slow: 0 }, D: { attempts: 50, misses: 0, slow: 0 }, E: { attempts: 50, misses: 40, slow: 0 } };
    const { round, answer } = setup({ rng, history });
    const seen: Record<string, number> = { C: 0, D: 0, E: 0 };
    let prev = "";
    for (let i = 0; i < 300; i++) {
      expect(round.current.id).not.toBe(prev);
      prev = round.current.id;
      seen[prev]++;
      answer(2000); // exactly the limit: not slow, and no unlock
    }
    expect(Object.keys(seen).sort()).toEqual(["C", "D", "E"]);
    expect(seen.E).toBeGreaterThan(seen.C * 1.3); // it cannot repeat, so about half of all draws at most
    expect(seen.C).toBeGreaterThan(0);
  });

  it("uses this round's own misses too", () => {
    let seed = 3;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const { round, answer } = setup({ rng });
    const counts: Record<string, number> = {};
    for (let i = 0; i < 200; i++) {
      const id = round.current.id;
      counts[id] = (counts[id] ?? 0) + 1;
      if (id === "D") answer(2000, false);
      answer(2000);
    }
    expect(counts.D).toBeGreaterThan(counts.C);
  });

  it("builds stats from records of one drill", () => {
    const rec = (drill: string, t: Partial<{ attempts: number; misses: number; slow: number }>): SessionRecord => ({
      id: Math.random().toString(),
      kind: "drill",
      drill,
      startedAt: 0,
      durationMs: 1,
      updatedAt: 0,
      items: { C: { attempts: 2, misses: 1, slow: 0, avgMs: 500, ...t } },
    });
    expect(statsFrom([rec("notes", {}), rec("notes", { slow: 1 }), rec("chords", {})], "notes")).toEqual({ C: { attempts: 4, misses: 2, slow: 1 } });
    const manual: SessionRecord = { id: "m", kind: "manual", startedAt: 1, durationMs: 60_000, note: "", updatedAt: 1 };
    expect(statsFrom([manual, rec("notes", {})], "notes")).toEqual({ C: { attempts: 2, misses: 1, slow: 0 } });
  });
});

describe("unlocking and tightening", () => {
  const run = (n: number, ms: number, setupOver = {}) => {
    const s = setup(setupOver);
    let changed = false;
    for (let i = 0; i < n; i++) changed = s.answer(ms).changed || changed;
    return { ...s, changed };
  };

  it("opens the next group at 90% accuracy and a median under the limit over the minimum attempts", () => {
    const early = run(MIN_ATTEMPTS - 1, 800);
    expect(early.round.settings.unlocked).toBe(1);
    const ok = run(MIN_ATTEMPTS, 1800);
    expect(ok.round.settings.unlocked).toBe(2);
    expect(ok.round.finish("u").summary.unlockedNow).toEqual(["F G"]);
    expect(ok.round.pool.map((i) => i.id)).toEqual(["C", "D", "E", "F", "G"]);
  });

  it("does not unlock when too inaccurate or too slow", () => {
    const s = setup();
    for (let i = 0; i < 30; i++) s.answer(500, i % 5 !== 0); // 80%
    expect(s.round.settings.unlocked).toBe(1);
    expect(run(30, 2100).round.settings.unlocked).toBe(1);
  });

  it("tightens the slow limit one step at a time when the median is under the next step", () => {
    const a = run(MIN_ATTEMPTS, 1400);
    expect(a.round.settings).toEqual({ unlocked: 2, slowStep: 1 });
    expect(a.round.slowLimit).toBe(1500);
    const b = run(MIN_ATTEMPTS, 900, { settings: { unlocked: 4, slowStep: 1 } });
    expect(b.round.slowLimit).toBe(1000);
    expect(b.round.settings.unlocked).toBe(4); // already everything open
    const c = run(60, 400, { settings: { unlocked: 4, slowStep: 2 } });
    expect(c.round.slowLimit).toBe(1000);
    expect(c.changed).toBe(false);
  });

  it("judges slow answers against the tightened limit", () => {
    const s = setup({ settings: { unlocked: 4, slowStep: 2 } });
    s.answer(1200);
    expect(s.round.finish("t").record!.items[Object.keys(s.round.finish("t").record!.items)[0]].slow).toBe(1);
  });

  it("starts from stored levels, clamped to the groups that exist", () => {
    expect(setup({ settings: { unlocked: 99, slowStep: 0 } }).round.settings.unlocked).toBe(4);
    expect(setup({ settings: { unlocked: 0, slowStep: 0 } }).round.settings.unlocked).toBe(1);
  });

  it("ignores note-offs for judging", () => {
    const { round, clock } = setup();
    expect(round.handle({ type: "off", note: 60, time: clock.t })).toEqual({ outcome: "pending", advanced: false, changed: false });
  });
});

describe("a drill with chords' needs", () => {
  it("pending answers neither advance nor count", () => {
    const def: DrillDef = {
      id: "pair",
      title: "Pair",
      items: [{ id: "X", group: 0 }],
      groupNames: ["X"],
      label: (i) => i.id,
      judge: (_i, held) => (held.has(60) && held.has(64) ? "correct" : held.size > 2 ? "miss" : "pending"),
      hint: () => ({ lit: new Set([60, 64]), fingers: { 60: 1, 64: 3 } }),
    };
    const { round, clock } = setup({ def: def as never });
    expect(round.handle({ type: "on", note: 60, time: clock.t + 100 }).outcome).toBe("pending");
    expect(round.totalAttempts).toBe(0);
    expect(round.handle({ type: "on", note: 64, time: clock.t + 200 })).toMatchObject({ outcome: "correct", advanced: true });
    expect(round.totalAttempts).toBe(1);
    expect(round.hint({ low: 48, high: 72 }).fingers).toEqual({ 60: 1, 64: 3 });
  });
});

describe("median", () => {
  it("handles empty, odd and even lists", () => {
    expect([median([]), median([3, 1, 2]), median([4, 1, 3, 2])]).toEqual([0, 2, 2.5]);
  });
});
