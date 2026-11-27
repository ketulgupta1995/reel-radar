import { describe, expect, it } from "vitest";
import { Beat, beatAt, beatInterval, clampBpm, createScheduler, describeOffset, offsetStats, scoreHit, scoreRun } from "./pianoTiming";

// A hand-driven clock: advance(ms) moves time and fires the interval every `ms` it passes.
function fakeClock() {
  let t = 1000;
  let fn: (() => void) | null = null;
  let every = 0;
  let nextFire = 0;
  return {
    clock: {
      now: () => t,
      setInterval: (f: () => void, ms: number) => {
        fn = f;
        every = ms;
        nextFire = t + ms;
        return 1;
      },
      clearInterval: () => void (fn = null),
    },
    advance(ms: number) {
      const end = t + ms;
      while (fn && nextFire <= end) {
        t = nextFire;
        nextFire += every;
        fn();
      }
      t = end;
    },
    active: () => fn !== null,
  };
}

describe("beat grid", () => {
  it("clamps tempo and converts it to an interval", () => {
    expect(clampBpm(10)).toBe(40);
    expect(clampBpm(500)).toBe(200);
    expect(clampBpm(NaN)).toBe(40);
    expect(clampBpm(99.6)).toBe(100);
    expect(beatInterval(120)).toBe(500);
  });

  it("numbers beats by bar, accents beat 1 and marks the count-in", () => {
    const m = { beatsPerBar: 3, countInBars: 1 };
    const b = [0, 2, 3, 4].map((i) => beatAt(1000, 60, m, i));
    expect(b.map((x) => x.time)).toEqual([1000, 3000, 4000, 5000]);
    expect(b.map((x) => [x.bar, x.beatInBar, x.accent, x.countIn])).toEqual([
      [0, 0, true, true],
      [0, 2, false, true],
      [1, 0, true, false],
      [1, 1, false, false],
    ]);
  });
});

describe("scheduler", () => {
  const setup = () => {
    const f = fakeClock();
    const beats: Beat[] = [];
    const s = createScheduler({ onBeat: (b) => beats.push(b), clock: f.clock });
    return { f, beats, s };
  };

  it("hands out beats ~100 ms ahead on a steady grid, with the count-in first", () => {
    const { f, beats, s } = setup();
    s.start({ bpm: 120, beatsPerBar: 2, countInBars: 1, at: 1050 });
    expect(beats.map((b) => b.time)).toEqual([1050]); // due within the lookahead of now (1000)
    f.advance(50);
    expect(beats).toHaveLength(1); // 1550 isn't within 100 ms of now (1050) yet
    f.advance(425); // now 1475: 1550 is inside the lookahead, handed out 75 ms early
    expect(beats.map((b) => b.time)).toEqual([1050, 1550]);
    // Every beat was handed out before it was due.
    f.advance(2000);
    expect(beats.slice(0, 4).map((b) => [b.countIn, b.accent])).toEqual([
      [true, true],
      [true, false],
      [false, true],
      [false, false],
    ]);
    expect(beats.map((b) => b.time)).toEqual(beats.map((_, i) => 1050 + i * 500));
    s.stop();
    const n = beats.length;
    f.advance(2000);
    expect(beats).toHaveLength(n);
    expect(f.active()).toBe(false);
    expect(s.running()).toBe(false);
  });

  it("defaults to a short lead, 4/4 and no count-in, and restarts cleanly", () => {
    const { beats, s } = setup();
    s.start({ bpm: 60 });
    expect(beats[0]).toMatchObject({ time: 1060, countIn: false, index: 0 });
    s.start({ bpm: 60, at: 1050 });
    expect(beats[beats.length - 1].time).toBe(1050);
    expect(s.beats()).toHaveLength(1); // the log restarted
  });

  it("a tempo change applies from the next unscheduled beat and keeps the grid even", () => {
    const { f, beats, s } = setup();
    s.start({ bpm: 120, at: 1000 });
    f.advance(1000);
    const before = beats.length;
    s.setBpm(60);
    f.advance(3000);
    const times = beats.map((b) => b.time);
    expect(times.slice(0, before).every((t, i) => t === 1000 + i * 500)).toBe(true);
    const last = times[before - 1];
    expect(times[before] - last).toBe(1000);
    expect(times[before + 1] - times[before]).toBe(1000);
    s.setBpm(60); // same tempo: nothing changes
    s.stop();
    s.setBpm(90); // stopped: just remembered
  });

  it("finds the nearest scorable beat, skipping the count-in", () => {
    const { f, s } = setup();
    expect(s.nearest(1000)).toBeNull();
    s.start({ bpm: 60, beatsPerBar: 2, countInBars: 1, at: 1000 });
    f.advance(4900);
    expect(s.nearest(1010, false)?.index).toBe(0);
    expect(s.nearest(1010)?.index).toBe(2); // count-in is beats 0 and 1
    expect(s.nearest(3100)?.index).toBe(2);
    expect(s.nearest(3600)?.index).toBe(3);
    const log = s.beats();
    expect(log.length).toBeGreaterThan(4);
    expect(s.nearest(99999)?.index).toBe(log[log.length - 1].index + 1); // the next one due
  });

  it("keeps only the last 64 beats", () => {
    const { f, s } = setup();
    s.start({ bpm: 200, at: 1000 });
    f.advance(30000);
    expect(s.beats()).toHaveLength(64);
  });

  it("uses the real clock and timers when none are injected", () => {
    const beats: Beat[] = [];
    const s = createScheduler({ onBeat: (b) => beats.push(b) });
    s.start({ bpm: 100 });
    s.stop();
    expect(beats).toHaveLength(1);
  });
});

describe("scoring", () => {
  it("grades by the window and signs the offset", () => {
    expect(scoreHit(1000, 1000)).toEqual({ grade: "on", offsetMs: 0, expected: 1000 });
    expect(scoreHit(1100, 1000).grade).toBe("on"); // the edge counts
    expect(scoreHit(1101, 1000)).toMatchObject({ grade: "late", offsetMs: 101 });
    expect(scoreHit(880, 1000)).toMatchObject({ grade: "early", offsetMs: -120 });
    expect(scoreHit(1101, 1000, { windowMs: 150 }).grade).toBe("on");
    expect(scoreHit(1060, 1000, { windowMs: 40 }).grade).toBe("late");
  });

  it("takes the nearest of several expected times", () => {
    expect(scoreHit(1480, [1000, 1500, 2000])).toMatchObject({ expected: 1500, offsetMs: -20 });
    expect(scoreHit(1480, 1500)).toMatchObject({ expected: 1500 });
  });

  it("subtracts the device latency from the hit time", () => {
    expect(scoreHit(1135, 1000, { latencyMs: 35 })).toMatchObject({ grade: "on", offsetMs: 100 });
    expect(scoreHit(1135, 1000, { latencyMs: 35, windowMs: 50 }).grade).toBe("late");
    expect(scoreHit(1135, 1000, { latencyMs: 135 })).toMatchObject({ offsetMs: 0 });
  });

  it("says missed when there is nothing to compare against", () => {
    expect(scoreHit(1000, [])).toEqual({ grade: "missed", offsetMs: null, expected: null });
  });

  it("scores a run: each note takes its nearest unused hit, none left is missed, the rest are extra", () => {
    const expected = [1000, 1500, 2000, 2500];
    const hits = [990, 1620, 2490, 3500];
    const { scores, extra } = scoreRun(expected, hits);
    expect(scores.map((s) => s.grade)).toEqual(["on", "late", "missed", "on"]);
    expect(scores[1].offsetMs).toBe(120);
    expect(extra).toEqual([3500]);
  });

  it("does not let one hit answer two notes, and applies latency and reach", () => {
    expect(scoreRun([1000, 1100], [1050]).scores.map((s) => s.grade)).toEqual(["on", "missed"]);
    expect(scoreRun([1000, 1100], [1050, 1060]).scores.map((s) => s.grade)).toEqual(["on", "on"]);
    expect(scoreRun([1000], [1090], { latencyMs: 90 }).scores[0].offsetMs).toBe(0);
    expect(scoreRun([1000], [1300], { windowMs: 100 }).scores[0].grade).toBe("missed"); // beyond 2.5 x window
    expect(scoreRun([1000], [1300], { matchMs: 400 }).scores[0].grade).toBe("late");
  });

  it("averages offsets and measures their spread", () => {
    expect(offsetStats([])).toEqual({ n: 0, mean: 0, spread: 0 });
    expect(offsetStats([null])).toEqual({ n: 0, mean: 0, spread: 0 });
    const s = offsetStats([30, 40, null, 50]);
    expect(s).toMatchObject({ n: 3, mean: 40 });
    expect(s.spread).toBeCloseTo(8.16, 2);
  });

  it("describes the average in words", () => {
    expect(describeOffset(offsetStats([]))).toMatch(/Play along/);
    expect(describeOffset({ n: 16, mean: 35.4, spread: 12 })).toBe("You play 35 ms late on average (spread 12 ms, last 16 hits).");
    expect(describeOffset({ n: 1, mean: -20, spread: 0 })).toBe("You play 20 ms early on average (spread 0 ms, last 1 hit).");
    expect(describeOffset({ n: 2, mean: 0.2, spread: 3 })).toContain("right on the click");
  });
});
