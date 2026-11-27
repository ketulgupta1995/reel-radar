// Piano's timing engine (pure; no React, no browser APIs except the performance.now() default).
// Used by the metronome and meant for the rhythm drill, play-along and scales: all times are
// milliseconds on the performance.now() clock, the same clock as a MIDI event's `time`.
//
//   beatAt / beatInterval        the beat grid for a tempo and time signature (count-in first)
//   createScheduler              lookahead scheduler: emits each beat ~100 ms before it is due
//   scoreHit                     a hit against expected time(s) -> offset and early | on | late
//   scoreRun                     expected times against a list of hits -> one score each, misses too
//   offsetStats                  mean and spread of offsets (for "you play 35 ms late")

export const MIN_BPM = 40;
export const MAX_BPM = 200;
export const DEFAULT_WINDOW_MS = 100;

export type Beat = {
  index: number; // 0 is the first beat of the count-in (or of the bar, with no count-in)
  time: number;
  bar: number; // counts from 0 across the count-in
  beatInBar: number; // 0-based; 0 is the accented beat
  accent: boolean;
  countIn: boolean;
};
export type Meter = { beatsPerBar: number; countInBars: number };

export const clampBpm = (bpm: number) => Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm) || MIN_BPM));
export const beatInterval = (bpm: number) => 60000 / bpm;

// Beat `index` of a run that starts at `startMs`.
export function beatAt(startMs: number, bpm: number, meter: Meter, index: number): Beat {
  const beatInBar = index % meter.beatsPerBar;
  return {
    index,
    time: startMs + index * beatInterval(bpm),
    bar: Math.floor(index / meter.beatsPerBar),
    beatInBar,
    accent: beatInBar === 0,
    countIn: index < meter.countInBars * meter.beatsPerBar,
  };
}

export type Clock = {
  now: () => number;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
};
const realClock = (): Clock => ({
  now: () => performance.now(),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
});

export type SchedulerOpts = {
  onBeat: (beat: Beat) => void; // called lookaheadMs early; play it at beat.time
  clock?: Partial<Clock>; // injected in tests
  lookaheadMs?: number; // default 100
  tickMs?: number; // default 25
};
export type StartOpts = { bpm: number; beatsPerBar?: number; countInBars?: number; at?: number };

export type Scheduler = {
  start(o: StartOpts): void;
  stop(): void;
  running(): boolean;
  // Takes effect from the next beat not yet scheduled; beats already handed out keep their time.
  setBpm(bpm: number): void;
  // Recent beats handed out (about the last 64), oldest first.
  beats(): readonly Beat[];
  // The beat closest to `time` among those handed out and the next one due; `scorable` skips the count-in.
  nearest(time: number, scorable?: boolean): Beat | null;
};

export function createScheduler(opts: SchedulerOpts): Scheduler {
  const clock = { ...realClock(), ...opts.clock };
  const lookahead = opts.lookaheadMs ?? 100;
  const tick = opts.tickMs ?? 25;
  let timer: unknown = null;
  let meter: Meter = { beatsPerBar: 4, countInBars: 0 };
  let bpm = 100;
  let nextIndex = 0;
  let nextTime = 0;
  let log: Beat[] = [];

  const upcoming = (): Beat => ({ ...beatAt(0, bpm, meter, nextIndex), time: nextTime });

  function pump() {
    while (nextTime < clock.now() + lookahead) {
      const beat = upcoming();
      log.push(beat);
      if (log.length > 64) log = log.slice(-64);
      nextIndex++;
      nextTime += beatInterval(bpm);
      opts.onBeat(beat);
    }
  }

  return {
    start(o) {
      this.stop();
      bpm = clampBpm(o.bpm);
      meter = { beatsPerBar: o.beatsPerBar ?? 4, countInBars: o.countInBars ?? 0 };
      nextIndex = 0;
      nextTime = o.at ?? clock.now() + 60; // a short lead so the first click isn't late
      log = [];
      timer = clock.setInterval(pump, tick);
      pump();
    },
    stop() {
      if (timer !== null) clock.clearInterval(timer);
      timer = null;
    },
    running: () => timer !== null,
    setBpm(next) {
      const was = bpm;
      bpm = clampBpm(next);
      if (timer === null || bpm === was) return;
      // The next beat keeps its distance from the last one handed out, at the new tempo.
      const last = log[log.length - 1];
      if (last) nextTime = last.time + beatInterval(bpm);
    },
    beats: () => log,
    nearest(time, scorable = true) {
      const pool = [...log, ...(timer !== null ? [upcoming()] : [])].filter((b) => !scorable || !b.countIn);
      let best: Beat | null = null;
      for (const b of pool) if (!best || Math.abs(b.time - time) < Math.abs(best.time - time)) best = b;
      return best;
    },
  };
}

export type Grade = "early" | "on" | "late" | "missed";
export type Score = { grade: Grade; offsetMs: number | null; expected: number | null };
export type ScoreOpts = {
  windowMs?: number; // within this either side is "on" (default 100)
  latencyMs?: number; // this device's input latency, subtracted from the hit time (default 0)
};

// A hit against the closest expected time. offsetMs is negative when early. Nothing to compare
// against gives "missed".
export function scoreHit(hit: number, expected: number | readonly number[], o: ScoreOpts = {}): Score {
  const list = typeof expected === "number" ? [expected] : expected;
  const t = hit - (o.latencyMs ?? 0);
  let best: number | null = null;
  for (const e of list) if (best === null || Math.abs(t - e) < Math.abs(t - best)) best = e;
  if (best === null) return { grade: "missed", offsetMs: null, expected: null };
  const offsetMs = t - best;
  const w = o.windowMs ?? DEFAULT_WINDOW_MS;
  return { grade: Math.abs(offsetMs) <= w ? "on" : offsetMs < 0 ? "early" : "late", offsetMs, expected: best };
}

export type RunOpts = ScoreOpts & { matchMs?: number }; // matchMs: farthest a hit may be and still answer a note (default 2.5 x window)

// Each expected time takes the nearest unused hit within matchMs, in order; none is "missed".
// Hits that answered nothing come back as `extra` (stray notes).
export function scoreRun(expected: readonly number[], hits: readonly number[], o: RunOpts = {}): { scores: Score[]; extra: number[] } {
  const reach = o.matchMs ?? (o.windowMs ?? DEFAULT_WINDOW_MS) * 2.5;
  const lat = o.latencyMs ?? 0;
  const used = new Set<number>();
  const scores = expected.map((e): Score => {
    let pick = -1;
    hits.forEach((h, i) => {
      if (used.has(i) || Math.abs(h - lat - e) > reach) return;
      if (pick < 0 || Math.abs(h - lat - e) < Math.abs(hits[pick] - lat - e)) pick = i;
    });
    if (pick < 0) return { grade: "missed", offsetMs: null, expected: e };
    used.add(pick);
    return scoreHit(hits[pick], e, o);
  });
  return { scores, extra: hits.filter((_, i) => !used.has(i)) };
}

// Mean offset (negative: early) and spread (standard deviation) of the scored hits.
export function offsetStats(offsets: readonly (number | null)[]): { n: number; mean: number; spread: number } {
  const xs = offsets.filter((x): x is number => x !== null);
  if (!xs.length) return { n: 0, mean: 0, spread: 0 };
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const spread = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  return { n: xs.length, mean, spread };
}

// "You play 35 ms late on average (spread 12 ms)."
export function describeOffset(s: { n: number; mean: number; spread: number }): string {
  if (!s.n) return "Play along with the click to see how early or late you are.";
  const ms = Math.round(Math.abs(s.mean));
  const how = ms === 0 ? "right on the click" : `${ms} ms ${s.mean < 0 ? "early" : "late"}`;
  return `You play ${how} on average (spread ${Math.round(s.spread)} ms, last ${s.n} ${s.n === 1 ? "hit" : "hits"}).`;
}
