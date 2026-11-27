import { describe, expect, it } from "vitest";
import { DrillDef, DrillRecord, DrillRound, MIN_ATTEMPTS, MIN_WEIGHT, SessionRecord, lastRoundAvgMs, median, recordAvgMs, statsFrom, weightOf } from "./pianoDrill";
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
    expect(record!.items[first]).toEqual({ attempts: 1, misses: 1, slow: 0, avgMs: 0, ms: 0 });
    expect(summary.accuracy).toBe(0);
  });

  it("counts a correct answer over the slow limit as slow, not as a miss", () => {
    const { round, answer } = setup();
    const id = round.current.id;
    answer(2500);
    const { record, summary } = round.finish("s");
    expect(record!.items[id]).toEqual({ attempts: 1, misses: 0, slow: 1, avgMs: 2500, ms: 2500 });
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

describe("peeking the next item", () => {
  const seq = (xs: number[]) => {
    let i = 0;
    return () => xs[i++ % xs.length];
  };

  it("is stable, never the current item, and becomes the current item", () => {
    const { round, answer } = setup({ rng: seq([0, 0.5, 0.99, 0.2, 0.7]), settings: { unlocked: 4, slowStep: 0 } });
    for (let i = 0; i < 8; i++) {
      const next = round.peek();
      expect(round.peek()).toBe(next);
      expect(next.id).not.toBe(round.current.id);
      answer(300);
      expect(round.current).toBe(next);
    }
  });

  it("keeps the peeked item through a miss, and previous is only set by a right answer", () => {
    const { round, answer } = setup({ rng: seq([0.1, 0.6, 0.3]), settings: { unlocked: 4, slowStep: 0 } });
    const shown = round.current;
    const next = round.peek();
    answer(200, false);
    expect(round.current).toBe(shown);
    expect(round.peek()).toBe(next);
    expect(round.previous).toBeNull();
    answer(300);
    expect(round.current).toBe(next);
    expect(round.previous).toEqual({ item: shown, ms: 500 });
  });

  it("keeps the previous item with its time", () => {
    const { round, answer } = setup();
    expect(round.previous).toBeNull();
    const first = round.current;
    answer(450);
    expect(round.previous).toEqual({ item: first, ms: 450 });
  });

  it("still picks by weight", () => {
    const history = { C: { attempts: 40, misses: 0, slow: 0 }, D: { attempts: 40, misses: 0, slow: 0 }, E: { attempts: 40, misses: 40, slow: 0 } };
    let seed = 5;
    const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const { round, answer } = setup({ rng, history, settings: { unlocked: 1, slowStep: 0 } });
    const counts: Record<string, number> = { C: 0, D: 0, E: 0 };
    for (let i = 0; i < 300; i++) {
      counts[round.peek().id]++;
      answer(100);
    }
    expect(counts.E).toBeGreaterThan(counts.C * 2);
  });
});

describe("round length and item filter", () => {
  const make = (o: { items?: string[]; lengthMs?: number; unlocked?: number; history?: Record<string, { attempts: number; misses: number; slow: number }> }) => {
    const clock = { t: 0 };
    let seed = 3;
    const round = new DrillRound({ def: NOTE_DRILL, settings: { unlocked: o.unlocked ?? 4, slowStep: 0 }, history: o.history, now: () => clock.t, rng: () => (seed = (seed * 16807) % 2147483647) / 2147483647, items: o.items, lengthMs: o.lengthMs });
    return { round, clock };
  };

  it("lasts lengthMs, default two minutes", () => {
    expect(make({}).round.timeLeft()).toBe(120_000);
    const { round, clock } = make({ lengthMs: 30_000 });
    expect(round.timeLeft()).toBe(30_000);
    clock.t = 30_000;
    expect(round.over()).toBe(true);
  });

  it("restricts the pool to the chosen items and pads to three with the weakest open others", () => {
    const history = { D: { attempts: 10, misses: 0, slow: 0 }, E: { attempts: 10, misses: 1, slow: 0 }, F: { attempts: 10, misses: 5, slow: 0 }, G: { attempts: 10, misses: 3, slow: 0 } };
    const { round } = make({ items: ["C", "D", "E", "F"] });
    expect(round.pool.map((i) => i.id)).toEqual(["C", "D", "E", "F"]);
    const two = make({ items: ["C"], history, unlocked: 2 }).round;
    expect(two.pool.map((i) => i.id).sort()).toEqual(["C", "F", "G"]);
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) seen.add(two.peek().id);
    expect([...seen].every((id) => ["C", "F", "G"].includes(id))).toBe(true);
  });

  it("ignores locked ids, an empty filter and one that matches nothing", () => {
    expect(make({ items: ["C#"], unlocked: 1 }).round.pool).toHaveLength(3);
    expect(make({ items: [] }).round.filtered).toBe(false);
    expect(make({ items: ["nope"] }).round.filtered).toBe(false);
    expect(make({ items: ["nope"] }).round.pool).toHaveLength(12);
  });

  it("never unlocks or tightens during a filtered round", () => {
    const { round, clock } = make({ items: ["C", "D", "E"], unlocked: 1 });
    for (let i = 0; i < 30; i++) {
      clock.t += 300;
      const pc = NOTE_DRILL.items.find((x) => x.id === round.current.id)!.pc;
      expect(round.handle({ type: "on", note: 60 + pc, time: clock.t }).changed).toBe(false);
    }
    expect(round.settings).toEqual({ unlocked: 1, slowStep: 0 });
    expect(round.finish("x").summary.unlockedNow).toEqual([]);
  });

  describe("reaction sums (ms)", () => {
    const rec = (startedAt: number, t: { attempts: number; misses: number; slow?: number; avgMs?: number; ms?: number }, drill = "notes"): DrillRecord => ({
      id: `r${startedAt}`,
      kind: "drill",
      drill,
      startedAt,
      durationMs: 1,
      updatedAt: startedAt,
      items: { C: { slow: 0, avgMs: 0, ...t } },
    });

    it("sums ms and the answers behind it, ignoring old records without ms", () => {
      const old = rec(1, { attempts: 10, misses: 0, avgMs: 5000 });
      const a = rec(2, { attempts: 3, misses: 1, ms: 1000 }); // 2 correct answers
      const b = rec(3, { attempts: 2, misses: 0, ms: 3000 }); // 2 correct answers
      expect(statsFrom([old, a, b], "notes").C).toEqual({ attempts: 15, misses: 1, slow: 0, ms: 4000, msN: 4 });
      expect(statsFrom([old], "notes").C).toEqual({ attempts: 10, misses: 0, slow: 0 });
    });

    it("a round saves the sum of correct first answers only", () => {
      const { round, answer } = setup();
      answer(400);
      answer(600);
      answer(300, false); // a miss adds attempts and misses but no ms
      const { record } = round.finish("x");
      const total = Object.values(record!.items).reduce((n, t) => n + (t.ms ?? 0), 0);
      expect(total).toBe(1000);
    });

    it("recordAvgMs and lastRoundAvgMs use ms, fall back to avgMs and skip rounds with no right answers", () => {
      const withMs = rec(5, { attempts: 4, misses: 0, ms: 4000 });
      const oldOne = rec(3, { attempts: 2, misses: 0, avgMs: 900 });
      const allMissed = rec(7, { attempts: 2, misses: 2 });
      expect(recordAvgMs(withMs)).toBe(1000);
      expect(recordAvgMs(oldOne)).toBe(900);
      expect(recordAvgMs(allMissed)).toBeNull();
      expect(lastRoundAvgMs([oldOne, withMs, allMissed, rec(9, { attempts: 1, misses: 0, ms: 1 }, "chords")], "notes")).toBe(1000);
      expect(lastRoundAvgMs([oldOne, withMs], "notes", 5)).toBe(900);
      expect(lastRoundAvgMs([], "notes")).toBeNull();
    });
  });
});
