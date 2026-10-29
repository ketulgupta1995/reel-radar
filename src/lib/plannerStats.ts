import { DEFAULT_DURATION, shiftDate, type TagId, type Todo } from "./todos";

export type Bucket = { start: string; end: string; plannedMinutes: number; doneMinutes: number };

export type CarriedTask = { id: string; text: string; from: string; to: string; days: number; completed: boolean };

export type PlannerStats = {
  total: number;
  done: number;
  plannedMinutes: number; // all scheduled blocks
  doneMinutes: number; // scheduled blocks that were finished
  focusedMinutes: number; // focus-timer time
  byWeekday: { day: number; total: number; done: number }[]; // Monday first
  buckets: Bucket[]; // one per day, or per week (from Monday) for ranges longer than 31 days
  byTag: { tag: TagId | null; total: number; done: number }[]; // most tasks first
  carried: CarriedTask[]; // most-postponed first, at most 10
};

const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) / 86400000);

const weekdayOf = (date: string) => new Date(date + "T00:00:00").getDay();

export function weekStart(date: string): string {
  return shiftDate(date, -((weekdayOf(date) + 6) % 7));
}

// Stats for the days from `from` to `to` (inclusive, YYYY-MM-DD) in `days` (date -> todos).
export function computePlannerStats(days: Record<string, Todo[]>, from: string, to: string): PlannerStats {
  const weekly = daysBetween(from, to) >= 31;
  const byWeekday = [1, 2, 3, 4, 5, 6, 0].map((day) => ({ day, total: 0, done: 0 }));
  const tags = new Map<TagId | null, { total: number; done: number }>();
  const buckets: Bucket[] = [];
  const carried: CarriedTask[] = [];
  let total = 0;
  let done = 0;
  let plannedMinutes = 0;
  let doneMinutes = 0;
  let focusedMinutes = 0;

  for (let date = from; date <= to; date = shiftDate(date, 1)) {
    const bucketStart = weekly ? (weekStart(date) < from ? from : weekStart(date)) : date;
    let bucket = buckets[buckets.length - 1];
    if (!bucket || bucket.start !== bucketStart) {
      bucket = { start: bucketStart, end: date, plannedMinutes: 0, doneMinutes: 0 };
      buckets.push(bucket);
    }
    bucket.end = date;

    for (const t of days[date] ?? []) {
      total++;
      if (t.completed) done++;
      const wd = byWeekday[(weekdayOf(date) + 6) % 7];
      wd.total++;
      if (t.completed) wd.done++;
      const tag = tags.get(t.tag ?? null) ?? { total: 0, done: 0 };
      tag.total++;
      if (t.completed) tag.done++;
      tags.set(t.tag ?? null, tag);
      focusedMinutes += t.spent ?? 0;
      if (t.start !== undefined) {
        const mins = t.duration ?? DEFAULT_DURATION;
        plannedMinutes += mins;
        bucket.plannedMinutes += mins;
        if (t.completed) {
          doneMinutes += mins;
          bucket.doneMinutes += mins;
        }
      }
      if (t.carriedFrom && t.carriedFrom < date) {
        carried.push({
          id: t.id,
          text: t.text,
          from: t.carriedFrom,
          to: date,
          days: daysBetween(t.carriedFrom, date),
          completed: t.completed,
        });
      }
    }
  }

  return {
    total,
    done,
    plannedMinutes,
    doneMinutes,
    focusedMinutes,
    byWeekday,
    buckets,
    byTag: Array.from(tags, ([tag, v]) => ({ tag, ...v })).sort((a, b) => b.total - a.total),
    carried: carried.sort((a, b) => b.days - a.days || a.text.localeCompare(b.text)).slice(0, 10),
  };
}
