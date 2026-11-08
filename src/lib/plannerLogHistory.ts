import type { LogItemDef } from "./plannerSettings";
import { shiftDate, type DayLog } from "./todos";

// One day of one item: a tick (with its time, when it was made on the day) or a count.
export type LogCell = { date: string; done: boolean; at?: number; count?: number };
export type LogRow = {
  item: LogItemDef;
  cells: LogCell[];
  // Ticks: the share of days done. Numbers: the average over the days with a count.
  rate: number | null;
  average: number | null;
  // Days in a row done (or with a count), ending today, or yesterday while today is still open.
  streak: number;
};

export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = shiftDate(d, 1)) out.push(d);
  return out;
}

function cellOf(log: DayLog | undefined, item: LogItemDef, date: string): LogCell {
  if (item.kind === "number") {
    const count = log?.counts?.[item.id];
    return count ? { date, done: true, count } : { date, done: false };
  }
  const tick = log?.ticks?.[item.id];
  return tick ? { date, done: true, ...(tick.at !== undefined ? { at: tick.at } : {}) } : { date, done: false };
}

// Counts back from the last cell; an open last day (today, not done yet) doesn't break the run.
export function streakOf(cells: LogCell[]): number {
  let i = cells.length - 1;
  if (i >= 0 && !cells[i].done) i--;
  let n = 0;
  for (; i >= 0 && cells[i].done; i--) n++;
  return n;
}

// The history grid in Stats: one row per item, one cell per day from `from` to `today`.
export function logHistory(logs: Record<string, DayLog>, items: LogItemDef[], from: string, today: string): LogRow[] {
  const dates = datesBetween(from, today);
  return items.map((item) => {
    const cells = dates.map((d) => cellOf(logs[d], item, d));
    const done = cells.filter((c) => c.done);
    // Today only counts against the rate once it's done; until then the day isn't over.
    const counted = cells.length - (cells.length && !cells[cells.length - 1].done ? 1 : 0);
    const rate = item.kind === "tick" && counted > 0 ? Math.round((done.length / counted) * 100) : null;
    const average = item.kind === "number" && done.length ? Math.round(done.reduce((n, c) => n + c.count!, 0) / done.length) : null;
    return { item, cells, rate, average, streak: streakOf(cells) };
  });
}
