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
  // Called on every note-on, after `held` includes it. "pending" = not enough yet (a chord half held, a phrase half
  // played). `hits` = the note-ons since the item was shown or last missed, this one last (an ear phrase's order).
  judge(item: T, held: ReadonlySet<number>, hit: NoteHit, hits?: readonly NoteHit[]): Judgement;
  hint(item: T, range: KeyRange): Hint;
  // Called on every note-off: true = the keys still held now answer the item (a chord whose stray
  // key was the last one lifted). Without it, only note-ons can answer.
  settle?(item: T, held: ReadonlySet<number>): boolean;
  // Ear training: what the app plays when the item comes up (and on "Hear again"): groups of notes, each group
  // struck together, `gapMs` apart. Without it the drill is silent.
  sound?(item: T): { groups: number[][]; gapMs: number; velocity?: number[] };
  // What is shown large while the item is current, when it differs from the label (ear training hides the answer
  // behind "Listen"; the label names it in "Last" and the summary).
  prompt?(item: T): string;
  // Time (ms) the item needs before an answer can start (the ear prompt playing, the extra notes of a phrase). It is
  // taken off the reaction time and delays the 2-second hint.
  leadMs?(item: T): number;
  hintAfterMs?: number; // default HINT_AFTER_MS; Infinity = only after a miss
  // The finger that plays `note` for this item (five-finger drill), for the evenness-of-touch summary.
  fingerOf?(item: T, note: number): number | undefined;
};

// One item's totals in a saved round. avgMs: mean reaction of the correct first answers. ms (new records only; older
// ones lack it): the SUM of the reaction times (ms, rounded) of the item's CORRECT FIRST answers, i.e. an answer given
// before any miss on that item. Misses and answers that came after a miss add nothing, so the number of answers behind
// ms is attempts - misses. Optional and additive: older clients ignore it and the month merge (union by id) never looks at it.
export type ItemTotals = { attempts: number; misses: number; slow: number; avgMs: number; ms?: number };
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
// Summed over records. ms/msN: reaction-time sum and the number of correct first answers it covers, counted only from
// records that carry ms, so old records never dilute an average (avg = ms / msN; absent = no data).
export type Stats = { attempts: number; misses: number; slow: number; ms?: number; msN?: number };
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
      if (typeof t.ms === "number") {
        s.ms = (s.ms ?? 0) + t.ms;
        s.msN = (s.msN ?? 0) + Math.max(0, t.attempts - t.misses);
      }
    }
  }
  return out;
}

// A round's mean reaction time (ms) over its correct first answers, or null when it has none. Uses ms when the
// record has it, else avgMs weighted by the number of correct answers (attempts - misses).
export function recordAvgMs(r: DrillRecord): number | null {
  let sum = 0;
  let n = 0;
  for (const t of Object.values(r.items)) {
    const right = Math.max(0, t.attempts - t.misses);
    if (!right) continue;
    sum += typeof t.ms === "number" ? t.ms : t.avgMs * right;
    n += right;
  }
  return n ? Math.round(sum / n) : null;
}

// The mean reaction of the latest round of `drill` that has one, or null. `before` skips records started at or after it.
export function lastRoundAvgMs(records: readonly SessionRecord[], drill: string, before = Infinity): number | null {
  let best: DrillRecord | null = null;
  for (const r of records) {
    if (r.kind !== "drill" || r.drill !== drill || r.startedAt >= before) continue;
    if (recordAvgMs(r) === null) continue;
    if (!best || r.startedAt > best.startedAt) best = r;
  }
  return best ? recordAvgMs(best) : null;
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
  lengthMs?: number; // round length; default ROUND_MS
  durationMs?: number; // older name for lengthMs
  // Restrict the round to these item ids (a session's weak items). Only open items count. Fewer than 3 left:
  // padded with the weakest other open items up to 3 (or all open items if fewer). Empty or matching nothing:
  // ignored. A filtered round never unlocks groups or moves the slow limit: a few chosen items say nothing
  // about the whole drill, so it only records attempts (history, weights) and leaves the levels alone.
  items?: readonly string[];
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
  private hits: NoteHit[] = []; // note-ons on the current item since it was shown or last missed
  private acc = new Map<string, Acc>();
  private window: Attempt[] = [];
  private queued: T | null = null; // the next item, once peeked (it becomes the current item)
  private fixedPool: T[] | null = null; // set by a usable item filter
  previous: { item: T; ms: number } | null = null; // the last item answered right, and its time

  constructor(private o: RoundOpts<T>) {
    this.settings = { ...o.settings, unlocked: Math.max(1, Math.min(o.settings.unlocked, o.def.groupNames.length)) };
    this.startSettings = { ...this.settings };
    this.startedAt = o.now();
    this.wallStart = (o.wall ?? o.now)();
    this.endsAt = this.startedAt + (o.lengthMs ?? o.durationMs ?? ROUND_MS);
    this.fixedPool = this.filterPool();
    this.next();
  }

  get slowLimit() {
    return SLOW_LIMITS[this.settings.slowStep];
  }
  get pool() {
    return this.fixedPool ?? this.openItems();
  }
  get filtered() {
    return this.fixedPool !== null;
  }
  private openItems() {
    return this.o.def.items.filter((i) => i.group < this.settings.unlocked);
  }
  private filterPool(): T[] | null {
    const ids = new Set(this.o.items ?? []);
    if (!ids.size) return null;
    const open = this.openItems();
    const chosen = open.filter((i) => ids.has(i.id));
    if (!chosen.length) return null;
    const need = Math.min(3, open.length);
    if (chosen.length < need) {
      const rest = open.filter((i) => !ids.has(i.id)).sort((a, b) => this.weight(b) - this.weight(a));
      chosen.push(...rest.slice(0, need - chosen.length));
    }
    return chosen;
  }
  timeLeft(at = this.o.now()) {
    return Math.max(0, this.endsAt - at);
  }
  over(at = this.o.now()) {
    return at >= this.endsAt;
  }
  private get lead() {
    return this.o.def.leadMs?.(this.current) ?? 0;
  }
  // Light the target after a miss, or after 2 s (the def's hintAfterMs, after its lead) with no answer.
  hintVisible(at = this.o.now()) {
    return this.missed || at - this.shownAt - this.lead >= (this.o.def.hintAfterMs ?? HINT_AFTER_MS);
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

  // The item that will follow the current one. Picked once and kept, so peeking changes nothing:
  // the peeked item is the one next() makes current.
  peek(): T {
    return (this.queued ??= this.pick());
  }

  private pick(): T {
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
    return pick;
  }

  private next() {
    this.current = this.queued ?? this.pick();
    this.queued = null;
    this.shownAt = this.o.now();
    this.missed = false;
    this.hits = [];
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
    const hit = { note: e.note, time: e.time };
    this.hits.push(hit);
    const outcome = this.o.def.judge(this.current, this.held, hit, this.hits);
    let changed = false;
    if (outcome === "miss") {
      this.hits = []; // a phrase starts again from its first note
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
    const ms = Math.max(0, time - this.shownAt - this.lead);
    if (!this.missed) {
      const a = this.total(this.current.id);
      a.attempts++;
      a.right++;
      a.sumMs += ms;
      if (ms > this.slowLimit) a.slow++;
      changed = this.record({ ok: true, ms });
    }
    this.previous = { item: this.current, ms };
    this.next();
    return { outcome: "correct", advanced: true, changed };
  }

  // Unlock and tighten checks over the last MIN_ATTEMPTS first answers; the window restarts after a change.
  private record(a: Attempt) {
    if (this.fixedPool) return false; // filtered round: levels stay put
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
      items[key] = { attempts: a.attempts, misses: a.misses, slow: a.slow, avgMs: a.right ? Math.round(a.sumMs / a.right) : 0, ms: Math.round(a.sumMs) };
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
