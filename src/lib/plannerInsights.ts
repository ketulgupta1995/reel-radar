import { DEFAULT_DURATION, WATER_GOAL, shiftDate, toDateString, weekday, type DailyTask, type DayLog, type TagId, type Todo } from "./todos";
import { weekStart } from "./plannerStats";

// What the day log and the focus timer say when set against the tasks. Pure, like plannerStats.

type Days = Record<string, Todo[]>;
type Logs = Record<string, DayLog>;

const clock = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const average = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = shiftDate(d, 1)) out.push(d);
  return out;
}

// ---------------- Sleep ----------------

const NOON = 12 * 60;
const DAY = 24 * 60;
const MIN_SLEEP = 3 * 60; // shorter or longer than these means a time was mistyped
const MAX_SLEEP = 14 * 60;

// Hours slept the night before `date`: from the bedtime logged on the day before to this day's wake
// time. A bedtime before noon was after midnight, whichever of the two days it was logged on.
export function sleepHours(logs: Logs, date: string): number | null {
  const wake = logs[date]?.wake;
  if (!wake) return null;
  const before = logs[shiftDate(date, -1)]?.sleep;
  const sameDay = logs[date]?.sleep;
  let bedtime: number;
  if (before) bedtime = clock(before) < NOON ? clock(before) : clock(before) - DAY;
  else if (sameDay && clock(sameDay) < clock(wake)) bedtime = clock(sameDay);
  else return null;
  const mins = clock(wake) - bedtime;
  return mins >= MIN_SLEEP && mins <= MAX_SLEEP ? mins / 60 : null;
}

// ---------------- Trends ----------------

export type TrendPoint = { start: string; end: string; value: number | null };
export type Trend = {
  points: TrendPoint[]; // one per day, or per week (averaged) for ranges longer than 31 days
  average: number | null;
  previous: number | null; // the same measure over the period just before, when asked for
};
export type LogTrends = { sleep: Trend; water: Trend; weight: Trend; weightChange: number | null };

type Metric = (date: string) => number | null;

function trendOf(metric: Metric, from: string, to: string, compare: boolean, partialLast = false): Trend {
  const dates = dateRange(from, to);
  const weekly = dates.length > 31;
  const groups = new Map<string, string[]>();
  for (const date of dates) {
    const key = weekly ? (weekStart(date) < from ? from : weekStart(date)) : date;
    groups.set(key, [...(groups.get(key) ?? []), date]);
  }
  const known = (list: string[]) => list.map(metric).filter((v): v is number => v !== null);
  // A day still under way would drag a daily total down, so it's left out of the average.
  const counted = partialLast && dates.length > 1 ? dates.slice(0, -1) : dates;
  const before = dateRange(shiftDate(from, -dates.length), shiftDate(from, -1));
  return {
    points: Array.from(groups, ([start, list]) => ({ start, end: list[list.length - 1], value: average(known(list)) })),
    average: average(known(counted)),
    previous: compare ? average(known(before)) : null,
  };
}

export function computeLogTrends(logs: Logs, from: string, to: string, compare: boolean): LogTrends {
  const weight: Metric = (d) => logs[d]?.weight ?? null;
  const weights = dateRange(from, to).map(weight).filter((v): v is number => v !== null);
  return {
    sleep: trendOf((d) => sleepHours(logs, d), from, to, compare),
    water: trendOf((d) => logs[d]?.water ?? null, from, to, compare, true),
    weight: trendOf(weight, from, to, false),
    weightChange: weights.length > 1 ? weights[weights.length - 1] - weights[0] : null,
  };
}

// ---------------- Patterns ----------------

export const SLEEP_TARGET = 7; // hours
export const MIN_PATTERN_DAYS = 5; // on each side, or a difference is mostly chance
export const MIN_PATTERN_GAP = 5; // percentage points worth mentioning

export type PatternSide = { days: number; total: number; done: number; rate: number };
export type Pattern = { id: "sleep" | "water"; met: PatternSide; missed: PatternSide; enough: boolean; gap: number };

function compareDays(id: Pattern["id"], days: Days, from: string, to: string, met: (date: string) => boolean | null): Pattern {
  const side = (): PatternSide => ({ days: 0, total: 0, done: 0, rate: 0 });
  const sides = { met: side(), missed: side() };
  for (const date of dateRange(from, to)) {
    const tasks = days[date] ?? [];
    const answer = met(date);
    if (answer === null || !tasks.length) continue;
    const s = answer ? sides.met : sides.missed;
    s.days++;
    s.total += tasks.length;
    s.done += tasks.filter((t) => t.completed).length;
  }
  for (const s of [sides.met, sides.missed]) s.rate = s.total ? Math.round((s.done / s.total) * 100) : 0;
  return { id, ...sides, enough: sides.met.days >= MIN_PATTERN_DAYS && sides.missed.days >= MIN_PATTERN_DAYS, gap: sides.met.rate - sides.missed.rate };
}

// Task completion on days that met a habit against days that didn't. Only days with both a log
// entry and tasks count. Leave today out of the range: its tasks aren't finished yet.
export function computePatterns(days: Days, logs: Logs, from: string, to: string): Pattern[] {
  return [
    compareDays("sleep", days, from, to, (d) => {
      const h = sleepHours(logs, d);
      return h === null ? null : h >= SLEEP_TARGET;
    }),
    compareDays("water", days, from, to, (d) => {
      const ml = logs[d]?.water;
      return ml === undefined ? null : ml >= WATER_GOAL;
    }),
  ];
}

// ---------------- Planned vs. actual time ----------------

export const MIN_FIT_TASKS = 3;
export const FIT_TOLERANCE = 10; // percent over or under that still counts as about right
const MAX_BLOCK = 12 * 60;

export type TimeFit = {
  tag: TagId | null;
  tasks: number;
  planned: number; // minutes
  actual: number;
  overBy: number; // percent; negative means under
  typical: number; // the usual planned length (median)
  suggested: number; // that length, adjusted by how far off these tasks run
};

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) / 2)];
const toFive = (mins: number) => Math.min(MAX_BLOCK, Math.max(5, Math.round(mins / 5) * 5));

// Finished tasks that had a planned length and focus-timer time, by tag, most tasks first. Sessions
// under a quarter of the plan or over 4 times it are left out: the timer was started late or left on.
export function computeTimeFit(days: Days, from: string, to: string): TimeFit[] {
  const byTag = new Map<TagId | null, { planned: number; actual: number }[]>();
  for (const date of dateRange(from, to)) {
    for (const t of days[date] ?? []) {
      if (!t.completed || !t.spent || t.start === undefined) continue;
      const planned = t.duration ?? DEFAULT_DURATION;
      if (t.spent < planned / 4 || t.spent > planned * 4) continue;
      const key = t.tag ?? null;
      byTag.set(key, [...(byTag.get(key) ?? []), { planned, actual: t.spent }]);
    }
  }
  const fits: TimeFit[] = [];
  byTag.forEach((samples, tag) => {
    if (samples.length < MIN_FIT_TASKS) return;
    const planned = samples.reduce((n, s) => n + s.planned, 0);
    const actual = samples.reduce((n, s) => n + s.actual, 0);
    const typical = median(samples.map((s) => s.planned));
    fits.push({
      tag,
      tasks: samples.length,
      planned,
      actual,
      overBy: Math.round(((actual - planned) / planned) * 100),
      typical,
      suggested: toFive((typical * actual) / planned),
    });
  });
  return fits.sort((a, b) => b.tasks - a.tasks);
}

// A realistic length for a block of `duration` with this tag, or null when what's planned is fine or
// there's too little to go on.
export function suggestBlockLength(fits: TimeFit[], tag: TagId | undefined, duration: number): { overBy: number; minutes: number } | null {
  const fit = fits.find((f) => f.tag === (tag ?? null));
  if (!fit || Math.abs(fit.overBy) < FIT_TOLERANCE) return null;
  const minutes = toFive((duration * fit.actual) / fit.planned);
  return minutes === duration ? null : { overBy: fit.overBy, minutes };
}

// ---------------- Weekly review ----------------

// The week to look back on: on a Sunday, the one ending today; on other days, the one that ended
// last Sunday. `next` is what's still ahead of the seven days after it.
export function reviewWeek(today: string): { start: string; end: string; next: string[] } {
  const end = shiftDate(today, -weekday(today));
  return {
    start: shiftDate(end, -6),
    end,
    next: dateRange(shiftDate(end, 1), shiftDate(end, 7)).filter((d) => d >= today),
  };
}

// ---------------- Month view ----------------

export type MonthDay = { date: string; done: number; total: number };
export type MonthSummary = { days: MonthDay[]; done: number; activeDays: number; best: MonthDay | null };

// Each day of a month (YYYY-MM): tasks finished and planned. A repeating task's finished copy that
// was cleared away still counts, through its doneDates.
export function computeMonth(days: Days, daily: DailyTask[], month: string): MonthSummary {
  const [y, m] = month.split("-").map(Number);
  const count = new Date(y, m, 0).getDate();
  const list = Array.from({ length: count }, (_, i): MonthDay => {
    const date = `${month}-${String(i + 1).padStart(2, "0")}`;
    const tasks = days[date] ?? [];
    const cleared = daily.filter((d) => d.doneDates?.includes(date) && !tasks.some((t) => t.dailyId === d.id)).length;
    const done = tasks.filter((t) => t.completed).length + cleared;
    return { date, done, total: tasks.length + cleared };
  });
  const active = list.filter((d) => d.done > 0);
  return {
    days: list,
    done: list.reduce((n, d) => n + d.done, 0),
    activeDays: active.length,
    best: active.reduce<MonthDay | null>((top, d) => (!top || d.done > top.done ? d : top), null),
  };
}

// How a count of finished tasks shows on the heatmap: fixed steps, so months can be compared.
export function heatLevel(done: number): 0 | 1 | 2 | 3 | 4 {
  return done <= 0 ? 0 : done <= 2 ? 1 : done <= 4 ? 2 : done <= 7 ? 3 : 4;
}

// ---------------- Goals ----------------

export type GoalStep = { date: string; todo: Todo };

export type GoalProgress = {
  done: number; // tasks and repeats finished, all time
  doneInRange: number; // of those, finished from `from` to `to`
  percent: number | null; // one-off tasks finished out of all of them; null when there are none, as repeats have no end
  open: GoalStep[]; // unfinished one-off tasks, earliest first; a missed repeat isn't owed, so those don't count
  repeats: DailyTask[]; // repeating tasks still running
  focused: number; // focus-timer minutes
  lastDone: string | null;
};

// How a goal is going. A repeating task's past copies count from before it was linked.
export function computeGoalProgress(goalId: string, days: Days, daily: DailyTask[], from: string, to: string): GoalProgress {
  const repeats = daily.filter((d) => d.goalId === goalId);
  const linked = new Set(repeats.map((d) => d.id));
  const open: GoalStep[] = [];
  const finished: string[] = repeats.flatMap((d) => d.doneDates ?? []); // cleared copies are gone from `days`
  let oneOffsDone = 0;
  let focused = 0;
  for (const [date, todos] of Object.entries(days)) {
    for (const t of todos) {
      if (t.goalId !== goalId && !(t.dailyId && linked.has(t.dailyId))) continue;
      focused += t.spent ?? 0;
      if (t.completed) {
        finished.push(t.doneAt ? toDateString(new Date(t.doneAt)) : date);
        if (!t.dailyId) oneOffsDone++;
      } else if (!t.dailyId) open.push({ date, todo: t });
    }
  }
  open.sort((a, b) => a.date.localeCompare(b.date));
  const oneOffs = oneOffsDone + open.length;
  return {
    done: finished.length,
    doneInRange: finished.filter((d) => d >= from && d <= to).length,
    percent: oneOffs ? Math.round((oneOffsDone / oneOffs) * 100) : null,
    open,
    repeats,
    focused,
    lastDone: finished.length ? finished.reduce((a, b) => (a > b ? a : b)) : null,
  };
}
