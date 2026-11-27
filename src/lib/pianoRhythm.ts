// Piano's rhythm drill round: pure, no browser APIs. A pattern is one bar of 4/4 on an eighth-note
// grid; the learner plays it twice (after a one-bar count-in) on any key and each onset is scored by
// pianoTiming's scoreRun. This does not use DrillRound (one item answered by one note-on); it keeps
// the same shapes so the rest of Piano works unchanged:
//   items / groups     patterns with `group` indexes, unlocked in order (DrillSettings.unlocked)
//   weights            weightOf(statsFrom(...)) over the last ~3 months plus this round
//   record             a DrillRecord with drill id "rhythm"; one pattern run = one attempt:
//                      attempts = runs, misses = runs with on-time rate < PASS_RATE, slow = 0 (unused),
//                      avgMs = mean absolute offset (ms) of the notes played, so the log's accuracy and
//                      "reaction" columns read as "runs passed" and "timing error"
//   window step        DrillSettings.slowStep is the on-time window step (WINDOW_STEPS), saved in
//                      slowSteps["rhythm"], last-write-wins like the other drills' slow limit
import { Score, offsetStats, scoreRun } from "./pianoTiming";
import { DrillRecord, DrillSettings, ItemTotals, ROUND_MS, Stats, weightOf } from "./pianoDrill";

export const RHYTHM_ID = "rhythm";
export const BEATS_PER_BAR = 4;
export const SLOTS = 8; // eighth notes per bar
export const REPS = 2; // bars the learner plays per pattern
export const DEFAULT_BPM = 70;
export const WINDOW_STEPS = [100, 80, 60] as const; // on-time window (ms either side)
export const PASS_RATE = 0.75; // a run at or above this on-time rate is a pass
export const RUNS_WINDOW = 6; // last runs the unlock and narrowing checks look at
export const UNLOCK_PASS = 0.8; // share of those runs that passed
export const NARROW_RATE = 0.9; // mean on-time rate that tightens the window

export const GROUP_NAMES = ["Quarters, halves, whole", "Eighths", "Rests", "Dotted quarter + eighth", "Syncopation"] as const;

// slots: one char per eighth: "x" a note starts, "-" the previous note rings on, "." silence.
export type RhythmPattern = { id: string; group: number; name: string; slots: string };
const p = (id: string, group: number, name: string, slots: string): RhythmPattern => ({ id, group, name, slots });
export const PATTERNS: readonly RhythmPattern[] = [
  p("quarters", 0, "Four quarters", "x-x-x-x-"),
  p("half-quarters", 0, "Half, two quarters", "x---x-x-"),
  p("quarters-half", 0, "Two quarters, half", "x-x-x---"),
  p("whole", 0, "Whole note", "x-------"),
  p("eighths", 1, "Eight eighths", "xxxxxxxx"),
  p("quarter-eighths", 1, "Quarter, two eighths, half", "x-xxx---"),
  p("eighths-quarters", 1, "Four eighths, two quarters", "xxxxx-x-"),
  p("rest-beat-2", 2, "Rest on beat 2", "x-..x-x-"),
  p("rest-beat-4", 2, "Rest on beat 4", "x-x-x-.."),
  p("rest-half", 2, "Quarter, quarter, half rest", "x-x-...."),
  p("eighth-rests", 2, "Eighth, eighth rest", "x.x.x.x."),
  p("dotted-1", 3, "Dotted quarter, eighth", "x--xx--x"),
  p("dotted-2", 3, "Dotted quarter, eighth, two quarters", "x--xx-x-"),
  p("dotted-3", 3, "Two quarters, dotted quarter, eighth", "x-x-x--x"),
  p("synco-1", 4, "Eighth, then off-beat quarters", "xx-x-x--"),
  p("synco-2", 4, "3 + 3 + 2", "x--x--x-"),
  p("synco-3", 4, "Off-beats only", ".x.x.x.x"),
];

// Onsets as eighth-slot indexes.
export const onsetSlots = (pat: RhythmPattern): number[] => [...pat.slots].flatMap((c, i) => (c === "x" ? [i] : []));
export const beatMs = (bpm: number) => 60000 / bpm;
export const barMs = (bpm: number) => BEATS_PER_BAR * beatMs(bpm);

// Expected hit times (ms on the performance clock) for `reps` bars, the first bar starting at startMs
// (the first beat after the count-in).
export function patternOnsets(pat: RhythmPattern, bpm: number, startMs: number, reps = REPS): number[] {
  const out: number[] = [];
  for (let r = 0; r < reps; r++) for (const s of onsetSlots(pat)) out.push(startMs + r * barMs(bpm) + (s * beatMs(bpm)) / 2);
  return out;
}

export type RunResult = {
  pattern: RhythmPattern;
  expected: number[];
  scores: Score[];
  extra: number[]; // stray hits
  windowMs: number;
  onTime: number; // notes graded "on"
  rate: number; // on / (expected + stray hits), 0..1
  pass: boolean;
  meanOffsetMs: number | null; // signed mean over the notes played (negative = early)
};

type Acc = { attempts: number; misses: number; sumMs: number; measured: number };
export type RhythmSummary = {
  attempts: number; // pattern runs
  accuracy: number; // share of runs that passed, 0..1
  onTimeRate: number; // mean on-time rate over the runs, 0..1
  avgMs: number; // mean absolute offset of the notes played
  weakest: { id: string; label: string; attempts: number; misses: number }[];
  unlockedNow: string[];
  windowMs: number;
};

export type RhythmOpts = {
  settings: DrillSettings;
  history?: Record<string, Stats>; // statsFrom(recentSessions(...), "rhythm")
  now: () => number; // performance.now()
  wall?: () => number;
  rng: () => number;
  durationMs?: number;
};

export class RhythmRound {
  readonly startedAt: number;
  readonly endsAt: number;
  current!: RhythmPattern;
  closed = false;
  settings: DrillSettings;
  private readonly startSettings: DrillSettings;
  private readonly wallStart: number;
  private acc = new Map<string, Acc>();
  private rates: number[] = [];
  private recent: { rate: number; pass: boolean }[] = [];

  constructor(private o: RhythmOpts) {
    this.settings = {
      unlocked: Math.max(1, Math.min(o.settings.unlocked, GROUP_NAMES.length)),
      slowStep: Math.max(0, Math.min(o.settings.slowStep, WINDOW_STEPS.length - 1)),
    };
    this.startSettings = { ...this.settings };
    this.startedAt = o.now();
    this.wallStart = (o.wall ?? o.now)();
    this.endsAt = this.startedAt + (o.durationMs ?? ROUND_MS);
    this.next();
  }

  get windowMs() {
    return WINDOW_STEPS[this.settings.slowStep];
  }
  get pool() {
    return PATTERNS.filter((x) => x.group < this.settings.unlocked);
  }
  get runs() {
    let n = 0;
    for (const a of this.acc.values()) n += a.attempts;
    return n;
  }
  timeLeft(at = this.o.now()) {
    return Math.max(0, this.endsAt - at);
  }
  over(at = this.o.now()) {
    return at >= this.endsAt;
  }

  private weight(item: RhythmPattern) {
    const h = this.o.history?.[item.id];
    const a = this.acc.get(item.id);
    return weightOf({ attempts: (h?.attempts ?? 0) + (a?.attempts ?? 0), misses: (h?.misses ?? 0) + (a?.misses ?? 0), slow: h?.slow ?? 0 });
  }

  // A weighted pick from the open groups, never the same pattern twice in a row.
  next() {
    let pool = this.pool;
    if (pool.length > 1 && this.current) pool = pool.filter((x) => x.id !== this.current.id);
    const weights = pool.map((x) => this.weight(x));
    let r = this.o.rng() * weights.reduce((a, b) => a + b, 0);
    let pick = pool[pool.length - 1];
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r < 0) {
        pick = pool[i];
        break;
      }
    }
    this.current = pick;
  }

  expected(startMs: number, bpm: number) {
    return patternOnsets(this.current, bpm, startMs);
  }

  // Scores the current pattern's run (hit times on the performance clock; latencyMs from
  // loadLatencyMs()), counts it, and checks unlock and window narrowing. `changed` = save the settings.
  score(startMs: number, bpm: number, hits: readonly number[], latencyMs = 0): { result: RunResult; changed: boolean } {
    const expected = this.expected(startMs, bpm);
    const windowMs = this.windowMs;
    const { scores, extra } = scoreRun(expected, hits, { windowMs, latencyMs });
    const onTime = scores.filter((s) => s.grade === "on").length;
    const rate = onTime / (expected.length + extra.length);
    const pass = rate >= PASS_RATE;
    const played = scores.map((s) => s.offsetMs);
    const stats = offsetStats(played);
    const result: RunResult = { pattern: this.current, expected, scores, extra, windowMs, onTime, rate, pass, meanOffsetMs: stats.n ? stats.mean : null };
    const a = this.acc.get(this.current.id) ?? { attempts: 0, misses: 0, sumMs: 0, measured: 0 };
    this.acc.set(this.current.id, a);
    a.attempts++;
    if (!pass) a.misses++;
    const abs = played.filter((x): x is number => x !== null).map(Math.abs);
    if (abs.length) {
      a.sumMs += abs.reduce((x, y) => x + y, 0) / abs.length;
      a.measured++;
    }
    this.rates.push(rate);
    return { result, changed: this.record({ rate, pass }) };
  }

  private record(r: { rate: number; pass: boolean }) {
    this.recent.push(r);
    if (this.recent.length > RUNS_WINDOW) this.recent.shift();
    if (this.recent.length < RUNS_WINDOW) return false;
    const passed = this.recent.filter((x) => x.pass).length / RUNS_WINDOW;
    const mean = this.recent.reduce((s, x) => s + x.rate, 0) / RUNS_WINDOW;
    let changed = false;
    if (this.settings.unlocked < GROUP_NAMES.length && passed >= UNLOCK_PASS) {
      this.settings = { ...this.settings, unlocked: this.settings.unlocked + 1 };
      changed = true;
    }
    if (this.settings.slowStep < WINDOW_STEPS.length - 1 && mean >= NARROW_RATE) {
      this.settings = { ...this.settings, slowStep: this.settings.slowStep + 1 };
      changed = true;
    }
    if (changed) this.recent = [];
    return changed;
  }

  finish(id: string, at = this.o.now()): { record: DrillRecord | null; summary: RhythmSummary } {
    this.closed = true;
    const items: Record<string, ItemTotals> = {};
    let attempts = 0, misses = 0, sumMs = 0, measured = 0;
    const weakest: RhythmSummary["weakest"] = [];
    for (const [key, a] of this.acc) {
      items[key] = { attempts: a.attempts, misses: a.misses, slow: 0, avgMs: a.measured ? Math.round(a.sumMs / a.measured) : 0 };
      attempts += a.attempts;
      misses += a.misses;
      sumMs += a.sumMs;
      measured += a.measured;
      if (a.misses) weakest.push({ id: key, label: PATTERNS.find((x) => x.id === key)!.name, attempts: a.attempts, misses: a.misses });
    }
    weakest.sort((x, y) => y.misses / y.attempts - x.misses / x.attempts || y.attempts - x.attempts);
    const rates = this.rates;
    const summary: RhythmSummary = {
      attempts,
      accuracy: attempts ? (attempts - misses) / attempts : 0,
      onTimeRate: rates.length ? rates.reduce((x, y) => x + y, 0) / rates.length : 0,
      avgMs: measured ? Math.round(sumMs / measured) : 0,
      weakest: weakest.slice(0, 3),
      unlockedNow: GROUP_NAMES.slice(this.startSettings.unlocked, this.settings.unlocked),
      windowMs: this.windowMs,
    };
    const span = Math.min(at, this.endsAt) - this.startedAt;
    const record: DrillRecord | null = attempts
      ? { id, kind: "drill", drill: RHYTHM_ID, startedAt: this.wallStart, durationMs: span, items, updatedAt: this.wallStart + span }
      : null;
    return { record, summary };
  }

}

