import { fmtTime } from "./reminders";
import { DEFAULT_DURATION, sortTodos, toDateString, type DayLog, type Todo } from "./todos";

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

// The schedule's Done column: wake and sleep, water (drinks within the same quarter hour together), and
// each task and checklist item ticked off on this day, at the time it was ticked. Both planners draw it.
export type DayMark = { key: string; at: number; text: string; time?: string; tone: "emerald" | "amber" | "violet" | "sky"; title?: string };
const snapMark = (mins: number) => Math.round(mins / 15) * 15;

export function dayMarks(log: DayLog, todos: Todo[], date: string): DayMark[] {
  const marks: DayMark[] = [];
  const clock = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
  if (log.wake) marks.push({ key: "wake", at: clock(log.wake), text: `🌅 Woke ${fmtTime(clock(log.wake))}`, tone: "amber" });
  if (log.sleep) marks.push({ key: "sleep", at: clock(log.sleep), text: `😴 Sleep ${fmtTime(clock(log.sleep))}`, tone: "violet" });
  const slots = new Map<number, number>();
  for (const d of log.drinks ?? []) slots.set(snapMark(d.at), (slots.get(snapMark(d.at)) ?? 0) + d.ml);
  slots.forEach((ml, at) => marks.push({ key: `water-${at}`, at, text: `💧 ${ml} ml · ${fmtTime(at)}`, tone: "sky" }));
  // Tasks and checklist items ticked off on this day, at the time they were ticked.
  const doneToday = (ms?: number) => ms !== undefined && toDateString(new Date(ms)) === date;
  const minuteOf = (ms: number) => new Date(ms).getHours() * 60 + new Date(ms).getMinutes();
  for (const t of todos) {
    if (t.completed && doneToday(t.doneAt)) {
      const time = fmtTime(minuteOf(t.doneAt!));
      marks.push({ key: `done-${t.id}`, at: minuteOf(t.doneAt!), text: `✓ ${t.text}`, time, tone: "emerald", title: `${t.text} · done ${time}` });
    }
    for (const st of t.subtasks ?? [])
      if (st.done && doneToday(st.doneAt)) {
        const time = fmtTime(minuteOf(st.doneAt!));
        marks.push({ key: `done-${t.id}-${st.id}`, at: minuteOf(st.doneAt!), text: `✓ ${st.text}`, time, tone: "emerald", title: `${st.text} (${t.text}) · done ${time}` });
      }
  }
  return marks;
}
