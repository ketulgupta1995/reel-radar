import type { DailyTask, DayLog, Todo } from "./todos";

// Finds text across every day of the planner. Pure, and run in the browser on what's already synced,
// so typing costs no requests.

export const MAX_TASK_HITS = 100;

export type TaskHit = {
  key: string;
  text: string;
  note?: string;
  date: string; // a one-off's day; for a repeating task, when it was last done, or its latest day
  completed: boolean;
  repeat?: { done: number; last: string | null }; // set on a repeating task, whose copies are one hit
};
export type NoteHit = { date: string; label: string; text: string };

const matches = (q: string, ...texts: (string | undefined)[]) => texts.some((s) => s?.toLowerCase().includes(q));
const todoMatches = (q: string, t: Todo) => matches(q, t.text, t.note, ...(t.subtasks ?? []).map((s) => s.text));

// Tasks whose title, note or checklist contains `query`, latest day first. A repeating task is one
// hit, saying how often it was done, or there'd be a row for every day it ran.
export function searchTasks(query: string, days: Record<string, Todo[]>, daily: DailyTask[]): TaskHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: TaskHit[] = [];
  const copies = new Map<string, { date: string; todo: Todo }[]>();
  for (const [date, todos] of Object.entries(days)) {
    for (const t of todos) {
      if (t.dailyId) copies.set(t.dailyId, [...(copies.get(t.dailyId) ?? []), { date, todo: t }]);
      else if (todoMatches(q, t)) hits.push({ key: t.id, text: t.text, ...(t.note ? { note: t.note } : {}), date, completed: t.completed });
    }
  }
  const tasks = new Map(daily.map((d) => [d.id, d]));
  const ids = new Set([...Array.from(copies.keys()), ...Array.from(tasks.keys())]);
  ids.forEach((id) => {
    const list = (copies.get(id) ?? []).sort((a, b) => b.date.localeCompare(a.date));
    const task = tasks.get(id);
    if (!list.some((c) => todoMatches(q, c.todo)) && !(task && matches(q, task.text, task.note, ...(task.subtasks ?? [])))) return;
    const doneDays = [...list.filter((c) => c.todo.completed).map((c) => c.date), ...(task?.doneDates ?? [])].sort().reverse();
    const last = doneDays[0] ?? null;
    const note = list[0]?.todo.note ?? task?.note;
    hits.push({
      key: id,
      text: list[0]?.todo.text ?? task!.text,
      ...(note ? { note } : {}),
      date: last ?? list[0]?.date ?? task!.startDate,
      completed: last !== null,
      repeat: { done: doneDays.length, last },
    });
  });
  return hits.sort((a, b) => b.date.localeCompare(a.date));
}

// Day log reviews containing `query`, latest first.
export function searchNotes(query: string, logs: Record<string, DayLog>): NoteHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return Object.keys(logs)
    .sort()
    .reverse()
    .flatMap((date) =>
      ([["Went well", logs[date].well], ["Went badly", logs[date].bad], ["To improve", logs[date].improve]] as const).flatMap(([label, text]) =>
        text && matches(q, text) ? [{ date, label, text }] : []
      )
    );
}
