// Piano's practice log maths (pure): minutes per local day, the streak and weekly drill trends.
// A record belongs to the local day it started on, and its whole duration counts there.
import { SessionRecord } from "./pianoDrill";

export const STREAK_MIN_MS = 10 * 60_000; // a day counts toward the streak from 10 minutes (drill + manual)

const p2 = (n: number) => String(n).padStart(2, "0");
export const dayKey = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
// Local calendar arithmetic (not 24 h steps), so daylight-saving changes don't skip or repeat a day.
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export function msByDay(records: readonly SessionRecord[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of records) {
    const k = dayKey(new Date(r.startedAt));
    out[k] = (out[k] ?? 0) + r.durationMs;
  }
  return out;
}

export const minutesOf = (ms: number) => Math.round(ms / 60_000);

export function todayMs(records: readonly SessionRecord[], now: number): number {
  return msByDay(records)[dayKey(new Date(now))] ?? 0;
}

// Consecutive counting days ending today, or ending yesterday while today doesn't count yet.
export function streak(records: readonly SessionRecord[], now: number): number {
  const by = msByDay(records);
  const counts = (d: Date) => (by[dayKey(d)] ?? 0) >= STREAK_MIN_MS;
  let d = new Date(now);
  if (!counts(d)) d = addDays(d, -1);
  let n = 0;
  for (; counts(d); d = addDays(d, -1)) n++;
  return n;
}

export type DayRow = { key: string; date: Date; ms: number; counts: boolean };
// The last `n` days, today first.
export function lastDays(records: readonly SessionRecord[], now: number, n = 14): DayRow[] {
  const by = msByDay(records);
  const t = new Date(now);
  return Array.from({ length: n }, (_, i) => {
    const date = addDays(t, -i);
    const key = dayKey(date);
    const ms = by[key] ?? 0;
    return { key, date, ms, counts: ms >= STREAK_MIN_MS };
  });
}

export type WeekTrend = { start: Date; end: Date; attempts: number; accuracy: number | null; avgMs: number | null };
// Seven-day buckets ending today, oldest first. Accuracy = answers without a miss / attempts; avgMs is the
// correct answers' average reaction time, weighted by how many correct answers each round had. null = no data.
export function weeklyTrend(records: readonly SessionRecord[], drill: string, now: number, weeks = 6): WeekTrend[] {
  const t = new Date(now);
  return Array.from({ length: weeks }, (_, i) => {
    const w = weeks - 1 - i;
    const start = addDays(t, -7 * w - 6);
    const end = addDays(t, -7 * w);
    const from = start.getTime();
    const to = addDays(end, 1).getTime();
    let attempts = 0, misses = 0, correct = 0, sumMs = 0;
    for (const r of records) {
      if (r.kind !== "drill" || r.drill !== drill || r.startedAt < from || r.startedAt >= to) continue;
      for (const it of Object.values(r.items)) {
        const c = it.attempts - it.misses;
        attempts += it.attempts;
        misses += it.misses;
        correct += c;
        sumMs += c * it.avgMs;
      }
    }
    return { start, end, attempts, accuracy: attempts ? (attempts - misses) / attempts : null, avgMs: correct ? sumMs / correct : null };
  });
}

export const drillsIn = (records: readonly SessionRecord[]): string[] => [...new Set(records.flatMap((r) => (r.kind === "drill" ? [r.drill] : [])))].sort();
