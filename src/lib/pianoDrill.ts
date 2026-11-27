// Piano's drill engine: pure, no browser APIs. A drill (notes now; chords, five-finger positions and
// rhythm later) is a DrillDef; a DrillRound runs one 2-minute round of it. Time and randomness are
// injected, so tests are deterministic. Storage is lib/pianoData.ts; the UI is app/piano/DrillRunner.tsx.

export type DrillItem = { id: string; group: number }; // group = index into def.groupNames, in unlock order
export type Judgement = "correct" | "miss" | "pending";
export type Hint = { lit: ReadonlySet<number>; fingers?: Readonly<Record<number, number>> };
export type KeyRange = { low: number; high: number };
export type NoteHit = { note: number; time: number };

export type DrillDef<T extends DrillItem = DrillItem> = {
  id: string; // "notes", "chords", ... (keys the drill's settings and records)
  title: string;
  items: readonly T[];
  groupNames: readonly string[]; // one line per unlock group, e.g. "C D E"
  label(item: T): string; // what is shown large
  caption?(item: T): string; // small line above the label (five-finger: "Right hand · C position")
  // Finger numbers shown on the keyboard for the whole round, before any hint (five-finger: the position).
  setup?(item: T, range: KeyRange): Readonly<Record<number, number>>;
  // Called on every note-on, after `held` includes it. "pending" = not enough yet (a chord half held).
  judge(item: T, held: ReadonlySet<number>, hit: NoteHit): Judgement;
  hint(item: T, range: KeyRange): Hint;
  // Called on every note-off: true = the keys still held now answer the item (a chord whose stray
  // key was the last one lifted). Without it, only note-ons can answer.
  settle?(item: T, held: ReadonlySet<number>): boolean;
};

export type ItemTotals = { attempts: number; misses: number; slow: number; avgMs: number }; // avgMs: of correct answers
export type DrillRecord = {
  id: string;
  kind: "drill";
  drill: string;
  startedAt: number;
  durationMs: number;
  items: Record<string, ItemTotals>;
  updatedAt: number;
};
// Practice done away from the app: minutes (as durationMs) and a note. The only records that are edited or deleted.
export type ManualRecord = { id: string; kind: "manual"; startedAt: number; durationMs: number; note: string; updatedAt: number };
export type SessionRecord = DrillRecord | ManualRecord;
export type Stats = { attempts: number; misses: number; slow: number };
export type DrillSettings = { unlocked: number; slowStep: number }; // groups open (>= 1); index into SLOW_LIMITS

export const ROUND_MS = 120_000;
export const HINT_AFTER_MS = 2000;
export const SLOW_LIMITS = [2000, 1500, 1000] as const;
export const MIN_ATTEMPTS = 20; // attempts in the window before an unlock or a tighter limit is considered
export const UNLOCK_ACCURACY = 0.9;
export const MIN_WEIGHT = 0.1; // a mastered item still shows up about a tenth as often as a weak one
export const HISTORY_DAYS = 92; // "last ~3 months"

export const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// A slow correct answer counts as half a miss.
const errorRate = (s: Stats) => (s.attempts ? (s.misses + 0.5 * s.slow) / s.attempts : 0);
export const weightOf = (s: Stats | undefined) => (!s || !s.attempts ? 1 : Math.max(MIN_WEIGHT, errorRate(s)));

// Sums each item's attempts, misses and slow answers over session records (the caller picks the period).
export function statsFrom(records: readonly SessionRecord[], drill: string): Record<string, Stats> {
  const out: Record<string, Stats> = {};
  for (const r of records) {
    if (r.kind !== "drill" || r.drill !== drill) continue;
    for (const [id, t] of Object.entries(r.items)) {
      const s = (out[id] ??= { attempts: 0, misses: 0, slow: 0 });
      s.attempts += t.attempts;
      s.misses += t.misses;
      s.slow += t.slow;
    }
  }
  return out;
}

export type Weakest = { id: string; label: string; attempts: number; misses: number; slow: number };
export type Summary = {
  attempts: number;
  accuracy: number; // first answers that were right (slow ones included), 0..1
  avgMs: number; // average reaction time of the right answers
  weakest: Weakest[]; // up to three items with misses or slow answers, worst first
  unlockedNow: string[]; // names of groups that opened during the round
  slowLimit: number;
};

type Acc = { attempts: number; misses: number; slow: number; sumMs: number; right: number };
type Attempt = { ok: boolean; ms: number };

export type RoundOpts<T extends DrillItem> = {
  def: DrillDef<T>;
  settings: DrillSettings;
  history?: Record<string, Stats>; // from statsFrom(...) over the last ~3 months
  now: () => number; // a monotonic clock in ms: the one note events' time is on (performance.now())
  wall?: () => number; // wall-clock ms for the saved record (Date.now()); defaults to now
  rng: () => number; // [0, 1)
  durationMs?: number;
};

export class DrillRound<T extends DrillItem = DrillItem> {
  readonly startedAt: number; // on the `now` clock
  readonly endsAt: number;
  current!: T;
  shownAt = 0;
  closed = false; // finish() has run: the UI must not save the round twice
  missed = false; // the current item has been answered wrongly (it stays until answered right)
  settings: DrillSettings;
  private readonly startSettings: DrillSettings;
  private readonly wallStart: number;
  private held = new Set<number>();
  private acc = new Map<string, Acc>();
  private window: Attempt[] = [];

  constructor(private o: RoundOpts<T>) {
    this.settings = { ...o.settings, unlocked: Math.max(1, Math.min(o.settings.unlocked, o.def.groupNames.length)) };
    this.startSettings = { ...this.settings };
    this.startedAt = o.now();
    this.wallStart = (o.wall ?? o.now)();
    this.endsAt = this.startedAt + (o.durationMs ?? ROUND_MS);
    this.next();
  }

  get slowLimit() {
    return SLOW_LIMITS[this.settings.slowStep];
  }
  get pool() {
    return this.o.def.items.filter((i) => i.group < this.settings.unlocked);
  }
  timeLeft(at = this.o.now()) {
    return Math.max(0, this.endsAt - at);
  }
  over(at = this.o.now()) {
    return at >= this.endsAt;
  }
  // Light the target after a miss, or after 2 s with no answer.
  hintVisible(at = this.o.now()) {
    return this.missed || at - this.shownAt >= HINT_AFTER_MS;
  }
  hint(range: KeyRange) {
    return this.o.def.hint(this.current, range);
  }
  get totalAttempts() {
    let n = 0;
    for (const a of this.acc.values()) n += a.attempts;
    return n;
  }

  private weight(item: T) {
    const h = this.o.history?.[item.id];
    const a = this.acc.get(item.id);
    return weightOf({
      attempts: (h?.attempts ?? 0) + (a?.attempts ?? 0),
      misses: (h?.misses ?? 0) + (a?.misses ?? 0),
      slow: (h?.slow ?? 0) + (a?.slow ?? 0),
    });
  }

  private next() {
    let pool = this.pool;
    if (pool.length > 1 && this.current) pool = pool.filter((i) => i.id !== this.current.id);
    const weights = pool.map((i) => this.weight(i));
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
    this.shownAt = this.o.now();
    this.missed = false;
  }

  private total(id: string) {
    let a = this.acc.get(id);
    if (!a) this.acc.set(id, (a = { attempts: 0, misses: 0, slow: 0, sumMs: 0, right: 0 }));
    return a;
  }

  // Feed every note event. `changed` = unlock level or slow limit moved (save the settings);
  // `advanced` = a new item is on show.
  handle(e: { type: "on" | "off"; note: number; time: number }): { outcome: Judgement; advanced: boolean; changed: boolean } {
    if (e.type === "off") {
      this.held.delete(e.note);
      if (this.held.size && this.o.def.settle?.(this.current, this.held)) return this.right(e.time);
      return { outcome: "pending", advanced: false, changed: false };
    }
    this.held.add(e.note);
    const outcome = this.o.def.judge(this.current, this.held, { note: e.note, time: e.time });
    let changed = false;
    if (outcome === "miss") {
      if (!this.missed) {
        this.missed = true;
        this.total(this.current.id).attempts++;
        this.total(this.current.id).misses++;
        changed = this.record({ ok: false, ms: 0 });
      }
    } else if (outcome === "correct") {
      return this.right(e.time);
    }
    return { outcome, advanced: false, changed };
  }

  private right(time: number): { outcome: Judgement; advanced: boolean; changed: boolean } {
    let changed = false;
    if (!this.missed) {
      const ms = Math.max(0, time - this.shownAt);
      const a = this.total(this.current.id);
      a.attempts++;
      a.right++;
      a.sumMs += ms;
      if (ms > this.slowLimit) a.slow++;
      changed = this.record({ ok: true, ms });
    }
    this.next();
    return { outcome: "correct", advanced: true, changed };
  }

  // Unlock and tighten checks over the last MIN_ATTEMPTS first answers; the window restarts after a change.
  private record(a: Attempt) {
    this.window.push(a);
    if (this.window.length > MIN_ATTEMPTS) this.window.shift();
    if (this.window.length < MIN_ATTEMPTS) return false;
    const right = this.window.filter((x) => x.ok);
    const med = median(right.map((x) => x.ms));
    let changed = false;
    if (
      this.settings.unlocked < this.o.def.groupNames.length &&
      right.length / this.window.length >= UNLOCK_ACCURACY &&
      med < this.slowLimit
    ) {
      this.settings = { ...this.settings, unlocked: this.settings.unlocked + 1 };
      changed = true;
    }
    if (right.length >= MIN_ATTEMPTS / 2 && this.settings.slowStep < SLOW_LIMITS.length - 1 && med < SLOW_LIMITS[this.settings.slowStep + 1]) {
      this.settings = { ...this.settings, slowStep: this.settings.slowStep + 1 };
      changed = true;
    }
    if (changed) this.window = [];
    return changed;
  }

  // The round's session record (null when nothing was answered) and its summary.
  finish(id: string, at = this.o.now()): { record: DrillRecord | null; summary: Summary } {
    this.closed = true;
    const items: Record<string, ItemTotals> = {};
    let attempts = 0;
    let misses = 0;
    let sumMs = 0;
    let right = 0;
    const weakest: Weakest[] = [];
    for (const [key, a] of this.acc) {
      items[key] = { attempts: a.attempts, misses: a.misses, slow: a.slow, avgMs: a.right ? Math.round(a.sumMs / a.right) : 0 };
      attempts += a.attempts;
      misses += a.misses;
      sumMs += a.sumMs;
      right += a.right;
      if (a.misses || a.slow) {
        const item = this.o.def.items.find((i) => i.id === key)!;
        weakest.push({ id: key, label: this.o.def.label(item), attempts: a.attempts, misses: a.misses, slow: a.slow });
      }
    }
    const rate = (w: Weakest) => errorRate(w);
    weakest.sort((x, y) => rate(y) - rate(x) || y.attempts - x.attempts);
    const summary: Summary = {
      attempts,
      accuracy: attempts ? (attempts - misses) / attempts : 0,
      avgMs: right ? Math.round(sumMs / right) : 0,
      weakest: weakest.slice(0, 3),
      unlockedNow: this.o.def.groupNames.slice(this.startSettings.unlocked, this.settings.unlocked),
      slowLimit: this.slowLimit,
    };
    const record: DrillRecord | null = attempts
      ? { id, kind: "drill", drill: this.o.def.id, startedAt: this.wallStart, durationMs: Math.min(at, this.endsAt) - this.startedAt, items, updatedAt: this.wallStart + Math.min(at, this.endsAt) - this.startedAt }
      : null;
    return { record, summary };
  }
}
