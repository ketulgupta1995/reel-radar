import type { DailyTask, Todo } from "@/lib/todos";

// Rules shared by the planner page and the server that sends reminders. lib/todos.ts is client-only,
// so anything the server also needs lives here and is re-exported from there.

export const DEFAULT_DURATION = 60;
export const REMINDER_LEADS = [0, 5, 10, 15]; // minutes before a block starts

export const weekday = (date: string): number => new Date(date + "T00:00:00").getDay();

export function repeatsOn(task: DailyTask, date: string): boolean {
  return !task.days || task.days.includes(weekday(date));
}

// Daily tasks that belong on `date` but have no copy in `todos` yet.
export function missingDailyTasks(tasks: DailyTask[], todos: Todo[], date: string): DailyTask[] {
  const present = new Set(todos.map((t) => t.dailyId).filter(Boolean));
  return tasks.filter((d) => d.startDate <= date && repeatsOn(d, date) && !present.has(d.id) && !d.skipDates?.includes(date));
}

export const fmtTime = (mins: number): string => {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""} ${h < 12 ? "AM" : "PM"}`;
};

// Unfinished scheduled todos starting within the next `lead` minutes of `now` (minutes since midnight),
// or that started up to `late` minutes ago.
export function dueReminders(todos: Todo[], now: number, lead: number, late = 0): Todo[] {
  return todos.filter((t) => !t.completed && t.start !== undefined && now >= t.start - lead && now <= t.start + late);
}

// Identifies one reminder. The page and the server use it as the notification's tag, so when both
// fire, the second replaces the first; a task moved to a new time gets a new reminder.
export const reminderKey = (date: string, t: Todo) => `${date}:${t.id}:${t.start}`;

export function reminderBody(t: Todo, now: number): string {
  const mins = t.start! - now;
  const lead = mins > 0 ? `In ${mins} min` : mins < 0 ? `Started ${-mins} min ago` : "Starting now";
  const when = `${lead} · ${fmtTime(t.start!)}–${fmtTime(t.start! + (t.duration ?? DEFAULT_DURATION))}`;
  return t.note ? `${when}\n${t.note}` : when;
}
