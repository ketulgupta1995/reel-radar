import { DEFAULT_DURATION, type DayLog, type Priority, type Todo, shiftDate } from "./todos";

// Places a day's unscheduled tasks into the free time between waking and going to bed. Pure: it
// proposes a plan, and nothing changes until the user applies it.

const SNAP = 15; // minutes
const NOON = 12 * 60;
const DAY_END = 24 * 60;
const DEFAULT_WAKE = 8 * 60;
const DEFAULT_SLEEP = 22 * 60;
const LOOK_BACK = 14; // days of the log that say what's usual

const clock = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) / 2)];
// A bedtime after midnight can't be drawn on this day's schedule, which ends at midnight.
const bedtime = (hhmm: string) => (clock(hhmm) < NOON ? DAY_END : clock(hhmm));

export type DayWindow = { from: number; to: number; usual: boolean }; // usual: not this day's own log

// The day's own wake and sleep times where logged; otherwise what's usual lately; otherwise 8 to 10.
export function dayWindow(logs: Record<string, DayLog>, date: string): DayWindow {
  const recent = Array.from({ length: LOOK_BACK }, (_, i) => logs[shiftDate(date, -(i + 1))]).filter(Boolean);
  const wakes = recent.flatMap((l) => (l.wake ? [clock(l.wake)] : []));
  const sleeps = recent.flatMap((l) => (l.sleep ? [bedtime(l.sleep)] : []));
  const own = logs[date];
  return {
    from: own?.wake ? clock(own.wake) : wakes.length ? median(wakes) : DEFAULT_WAKE,
    to: own?.sleep ? bedtime(own.sleep) : sleeps.length ? median(sleeps) : DEFAULT_SLEEP,
    usual: !own?.wake || !own?.sleep,
  };
}

export type PlannedBlock = { id: string; text: string; start: number; duration: number };
export type DayPlan = { placed: PlannedBlock[]; unplaced: Todo[] };

// Low is a choice to put something off, so it comes after tasks with no priority set.
const RANK: Record<Priority, number> = { high: 0, medium: 1, low: 3 };
const rank = (t: Todo) => (t.priority ? RANK[t.priority] : 2);

// Can this task be placed? Not when done or already timed. A repeating task's time also sets every
// later day's, so a one-day plan leaves those alone.
export const canAutoSchedule = (t: Todo) => !t.completed && t.start === undefined && !t.dailyId;

// Highest priority first, each into the earliest gap it fits, never overlapping a block or running
// past `window.to`. `now` (minutes since midnight, for today) keeps it from planning in the past.
export function planDay(todos: Todo[], window: DayWindow, now?: number): DayPlan {
  const busy = todos.filter((t) => t.start !== undefined).map((t) => ({ from: t.start!, to: t.start! + (t.duration ?? DEFAULT_DURATION) }));
  const earliest = Math.ceil(Math.max(window.from, now ?? 0) / SNAP) * SNAP;
  const placed: PlannedBlock[] = [];
  const unplaced: Todo[] = [];
  const queue = todos.filter(canAutoSchedule).map((t, i) => ({ t, i })).sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i);
  for (const { t } of queue) {
    const duration = t.duration ?? DEFAULT_DURATION;
    let start = earliest;
    for (const b of [...busy].sort((x, y) => x.from - y.from)) {
      if (start + duration <= b.from) break;
      if (b.to > start) start = Math.ceil(b.to / SNAP) * SNAP;
    }
    if (start + duration > window.to) {
      unplaced.push(t);
      continue;
    }
    placed.push({ id: t.id, text: t.text, start, duration });
    busy.push({ from: start, to: start + duration });
  }
  return { placed, unplaced };
}
