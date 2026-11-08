import { DEFAULT_DURATION, sortTodos, type Todo } from "./todos";

// What the top of Today shows, decided from the day's tasks and the time (minutes after midnight):
// the block under way, the free time before the next one, a wrap-up once the last block is over,
// or "all done". Pure, so the card's rules are tested on their own.
export type TodayCard =
  | { kind: "block"; todo: Todo; end: number }
  | { kind: "free"; next: Todo | null; anytime: Todo[] }
  | { kind: "wrap"; open: number }
  | { kind: "done"; count: number }
  | null; // nothing planned

const endOf = (t: Todo) => t.start! + (t.duration ?? DEFAULT_DURATION);
export const ANYTIME_SHOWN = 3;

export function todayCard(todos: Todo[], now: number): TodayCard {
  if (!todos.length) return null;
  const open = sortTodos(todos).filter((t) => !t.completed);
  if (!open.length) return { kind: "done", count: todos.length };
  const blocks = todos.filter((t) => t.start !== undefined);
  const live = open.find((t) => t.start !== undefined && t.start <= now && now < endOf(t));
  if (live) return { kind: "block", todo: live, end: endOf(live) };
  if (blocks.length && now >= Math.max(...blocks.map(endOf))) return { kind: "wrap", open: open.length };
  const next = open.filter((t) => t.start !== undefined && t.start > now).sort((a, b) => a.start! - b.start!)[0] ?? null;
  return { kind: "free", next, anytime: open.filter((t) => t.start === undefined).slice(0, ANYTIME_SHOWN) };
}

// "3 of 9 done · 2h 15m of 5h planned": tasks, and the scheduled minutes among them.
export type DayProgress = { done: number; total: number; doneMinutes: number; plannedMinutes: number };

export function dayProgress(todos: Todo[]): DayProgress {
  const blocks = todos.filter((t) => t.start !== undefined);
  const minutes = (ts: Todo[]) => ts.reduce((n, t) => n + (t.duration ?? DEFAULT_DURATION), 0);
  return {
    done: todos.filter((t) => t.completed).length,
    total: todos.length,
    doneMinutes: minutes(blocks.filter((t) => t.completed)),
    plannedMinutes: minutes(blocks),
  };
}
