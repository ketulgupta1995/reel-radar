"use client";

export type Priority = "high" | "medium" | "low";

export type Subtask = { id: string; text: string; done: boolean };

export type TagId = "work" | "home" | "health" | "personal" | "learning" | "errands";
export const TAGS: { id: TagId; label: string }[] = [
  { id: "work", label: "Work" },
  { id: "home", label: "Home" },
  { id: "health", label: "Health" },
  { id: "personal", label: "Personal" },
  { id: "learning", label: "Learning" },
  { id: "errands", label: "Errands" },
];

export type Todo = {
  id: string;
  text: string; // the task's title
  note?: string; // optional longer description
  completed: boolean;
  createdAt: string; // ISO string
  priority?: Priority;
  carriedFrom?: string; // YYYY-MM-DD the task was moved from
  start?: number; // planner start, minutes since midnight
  duration?: number; // planner length in minutes
  dailyId?: string; // set when this is one day's copy of a daily task
  subtasks?: Subtask[];
  tag?: TagId;
  spent?: number; // minutes recorded with the focus timer
};

// A task that repeats every day. Each day gets its own Todo copy, so completion is per day.
export type DailyTask = {
  id: string;
  text: string;
  note?: string;
  priority?: Priority;
  tag?: TagId;
  start?: number;
  duration?: number;
  startDate: string; // first day it appears
  days?: number[]; // weekdays it repeats on (0 = Sunday); unset means every day
  subtasks?: string[]; // checklist items each day's copy starts with, unticked
  skipDates?: string[]; // days the user removed it from
  doneDates?: string[]; // days whose finished copy was cleared, so streaks still count them
};

export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export const weekday = (date: string): number => new Date(date + "T00:00:00").getDay();

// Sorted, de-duplicated weekdays; no days or all seven means "every day" (undefined).
function normalizeDays(days?: number[]): number[] | undefined {
  const d = Array.from(new Set(days ?? [])).filter((n) => n >= 0 && n <= 6).sort((a, b) => a - b);
  return d.length === 0 || d.length === 7 ? undefined : d;
}

export function repeatsOn(task: DailyTask, date: string): boolean {
  return !task.days || task.days.includes(weekday(date));
}

export const DEFAULT_DURATION = 60;

export type Schedule = { start: number; duration?: number };

export type DayTodos = {
  date: string; // YYYY-MM-DD
  todos: Todo[];
};

const TODO_STORAGE_PREFIX = "reel-radar-todos-";
const DAILY_STORAGE_KEY = "reel-radar-daily-tasks";
const DAILY_SERVER_KEY = "daily"; // stored by /api/todos alongside the per-date files

function getStorageKey(date: string): string {
  return `${TODO_STORAGE_PREFIX}${date}`;
}

const toDateString = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Local date, not UTC: toISOString() would roll over at 5:30 AM in IST.
export function getTodayDate(): string {
  return toDateString(new Date());
}

export function shiftDate(date: string, days: number): string {
  const d = new Date(date + "T00:00:00");
  d.setDate(d.getDate() + days);
  return toDateString(d);
}

export function loadTodos(date?: string): Todo[] {
  if (typeof window === "undefined") return [];
  const targetDate = date || getTodayDate();
  try {
    const raw = localStorage.getItem(getStorageKey(targetDate));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveTodos(todos: Todo[], date?: string): void {
  if (typeof window === "undefined") return;
  const targetDate = date || getTodayDate();
  localStorage.setItem(getStorageKey(targetDate), JSON.stringify(todos, null, 2));
  
  // Also sync with server
  fetch("/api/todos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date: targetDate, todos }),
  }).catch((err) => {
    console.error("[Todos Save] Could not contact /api/todos. Saved only to browser localStorage.", err);
  });
}

export function addTodo(
  text: string,
  date?: string,
  priority?: Priority,
  schedule?: Schedule,
  daily?: boolean | number[], // true = every day, or the weekdays to repeat on
  note?: string,
  tag?: TagId
): Todo[] {
  const todos = loadTodos(date);
  const newTodo: Todo = {
    id: crypto.randomUUID(),
    text,
    completed: false,
    createdAt: new Date().toISOString(),
    ...(note?.trim() ? { note: note.trim() } : {}),
    ...(priority ? { priority } : {}),
    ...(tag ? { tag } : {}),
    ...(schedule ? { start: schedule.start, duration: schedule.duration ?? DEFAULT_DURATION } : {}),
  };
  if (daily) {
    const task = templateFrom(newTodo, date || getTodayDate(), Array.isArray(daily) ? daily : undefined);
    saveDailyTasks([...loadDailyTasks(), task]);
    newTodo.dailyId = task.id;
  }
  const updated = [...todos, newTodo];
  saveTodos(updated, date);
  return updated;
}

export function toggleTodo(id: string, date?: string): Todo[] {
  const todos = loadTodos(date);
  const updated = todos.map((t) =>
    t.id === id ? { ...t, completed: !t.completed } : t
  );
  saveTodos(updated, date);
  return updated;
}

export function setTodoTag(id: string, tag: TagId | undefined, date?: string): Todo[] {
  const todos = loadTodos(date);
  const updated = todos.map((t) => {
    if (t.id !== id) return t;
    const { tag: _old, ...rest } = t;
    return tag ? { ...rest, tag } : rest;
  });
  saveTodos(updated, date);
  syncDailyFrom(updated.find((t) => t.id === id));
  return updated;
}

export function setTodoPriority(id: string, priority: Priority | undefined, date?: string): Todo[] {
  const todos = loadTodos(date);
  const updated = todos.map((t) => {
    if (t.id !== id) return t;
    const { priority: _old, ...rest } = t;
    return priority ? { ...rest, priority } : rest;
  });
  saveTodos(updated, date);
  syncDailyFrom(updated.find((t) => t.id === id));
  return updated;
}

// Place a todo on the day's planner, or pass undefined to take it off.
export function scheduleTodo(id: string, schedule: Schedule | undefined, date?: string): Todo[] {
  const todos = loadTodos(date);
  const updated = todos.map((t) => {
    if (t.id !== id) return t;
    const { start: _s, duration: _d, ...rest } = t;
    return schedule
      ? { ...rest, start: schedule.start, duration: schedule.duration ?? t.duration ?? DEFAULT_DURATION }
      : rest;
  });
  saveTodos(updated, date);
  syncDailyFrom(updated.find((t) => t.id === id));
  return updated;
}

// Re-insert a deleted todo (undo), keeping its original position by creation time.
export function restoreTodo(todo: Todo, date?: string): Todo[] {
  const todos = loadTodos(date);
  if (todos.some((t) => t.id === todo.id)) return todos;
  const updated = [...todos, todo].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  saveTodos(updated, date);
  if (todo.dailyId) {
    const day = date || getTodayDate();
    updateDailyTask(todo.dailyId, (d) => ({ ...d, skipDates: d.skipDates?.filter((x) => x !== day) }));
  }
  return updated;
}

// Unfinished one-off todos from the day before `date`. Daily tasks are left out:
// today already gets its own copy of them.
export function getUnfinishedFromYesterday(date: string): Todo[] {
  return loadTodos(shiftDate(date, -1)).filter((t) => !t.completed && !t.dailyId);
}

// Move unfinished todos from the previous day onto `date` (all of them, or just `ids`).
export function carryOverFromYesterday(date: string, ids?: string[]): Todo[] {
  const yesterday = shiftDate(date, -1);
  const wanted = ids ? new Set(ids) : null;
  const moving = getUnfinishedFromYesterday(date).filter((t) => !wanted || wanted.has(t.id));
  if (moving.length === 0) return loadTodos(date);
  const movingIds = new Set(moving.map((t) => t.id));
  saveTodos(loadTodos(yesterday).filter((t) => !movingIds.has(t.id)), yesterday);
  // A carried task keeps no time slot: yesterday's 9 AM isn't today's 9 AM.
  const moved = moving.map((t) => {
    const { start: _s, duration: _d, ...rest } = t;
    return { ...rest, carriedFrom: t.carriedFrom ?? yesterday };
  });
  const updated = [...loadTodos(date), ...moved];
  saveTodos(updated, date);
  return updated;
}

// ---------------- Daily tasks ----------------

export function loadDailyTasks(): DailyTask[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(DAILY_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveDailyTasks(tasks: DailyTask[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(DAILY_STORAGE_KEY, JSON.stringify(tasks, null, 2));
  fetch("/api/todos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date: DAILY_SERVER_KEY, todos: tasks }),
  }).catch((err) => {
    console.error("[Daily Tasks Save] Could not contact /api/todos. Saved only to browser localStorage.", err);
  });
}

function updateDailyTask(id: string, change: (task: DailyTask) => DailyTask): void {
  const tasks = loadDailyTasks();
  if (!tasks.some((t) => t.id === id)) return;
  saveDailyTasks(tasks.map((t) => (t.id === id ? change(t) : t)));
}

function templateFrom(todo: Todo, startDate: string, days?: number[]): DailyTask {
  const repeatDays = normalizeDays(days);
  return {
    id: crypto.randomUUID(),
    text: todo.text,
    startDate,
    ...(repeatDays ? { days: repeatDays } : {}),
    ...(todo.note ? { note: todo.note } : {}),
    ...(todo.subtasks?.length ? { subtasks: todo.subtasks.map((st) => st.text) } : {}),
    ...(todo.priority ? { priority: todo.priority } : {}),
    ...(todo.tag ? { tag: todo.tag } : {}),
    ...(todo.start !== undefined ? { start: todo.start, duration: todo.duration ?? DEFAULT_DURATION } : {}),
  };
}

// Edits to a daily task's copy (text, note, checklist, priority, tag, time slot) carry over to future days.
function syncDailyFrom(todo: Todo | undefined): void {
  if (!todo?.dailyId) return;
  updateDailyTask(todo.dailyId, (d) => {
    const { note: _n, subtasks: _st, priority: _p, tag: _t, start: _s, duration: _d, ...rest } = d;
    return {
      ...rest,
      text: todo.text,
      ...(todo.note ? { note: todo.note } : {}),
      ...(todo.subtasks?.length ? { subtasks: todo.subtasks.map((st) => st.text) } : {}),
      ...(todo.priority ? { priority: todo.priority } : {}),
      ...(todo.tag ? { tag: todo.tag } : {}),
      ...(todo.start !== undefined ? { start: todo.start, duration: todo.duration ?? DEFAULT_DURATION } : {}),
    };
  });
}

// Load a day's todos, adding that day's copy of every daily task it is missing.
export function loadTodosWithDaily(date: string): Todo[] {
  const todos = loadTodos(date);
  const present = new Set(todos.map((t) => t.dailyId).filter(Boolean));
  const missing = loadDailyTasks().filter(
    (d) => d.startDate <= date && repeatsOn(d, date) && !present.has(d.id) && !d.skipDates?.includes(date)
  );
  if (missing.length === 0) return todos;
  const updated = [
    ...todos,
    ...missing.map((d) => ({
      id: crypto.randomUUID(),
      text: d.text,
      completed: false,
      createdAt: new Date(date + "T00:00:00").toISOString(),
      dailyId: d.id,
      ...(d.note ? { note: d.note } : {}),
      ...(d.subtasks?.length
        ? { subtasks: d.subtasks.map((text) => ({ id: crypto.randomUUID(), text, done: false })) }
        : {}),
      ...(d.priority ? { priority: d.priority } : {}),
      ...(d.tag ? { tag: d.tag } : {}),
      ...(d.start !== undefined ? { start: d.start, duration: d.duration ?? DEFAULT_DURATION } : {}),
    })),
  ];
  saveTodos(updated, date);
  return updated;
}

// Turn an existing todo into a daily task, starting on `date` (every day, or only on `days`).
export function makeTodoDaily(id: string, date: string, days?: number[]): Todo[] {
  const todos = loadTodos(date);
  const todo = todos.find((t) => t.id === id);
  if (!todo || todo.dailyId) return todos;
  const task = templateFrom(todo, date, days);
  saveDailyTasks([...loadDailyTasks(), task]);
  const updated = todos.map((t) => (t.id === id ? { ...t, dailyId: task.id } : t));
  saveTodos(updated, date);
  return updated;
}

// Stop a daily task from repeating. This day's copy stays as a normal task;
// unfinished copies already created for later days are removed.
export function stopTodoDaily(id: string, date: string): Todo[] {
  const todos = loadTodos(date);
  const dailyId = todos.find((t) => t.id === id)?.dailyId;
  if (!dailyId) return todos;
  saveDailyTasks(loadDailyTasks().filter((d) => d.id !== dailyId));
  removeFutureCopies(dailyId, date);
  const updated = todos.map((t) => {
    if (t.id !== id) return t;
    const { dailyId: _d, ...rest } = t;
    return rest;
  });
  saveTodos(updated, date);
  return updated;
}

// Change which weekdays a daily task repeats on (undefined or all seven = every day).
// Unfinished copies already created after `date` on days it no longer repeats on are removed.
export function setTodoRepeatDays(id: string, days: number[] | undefined, date: string): Todo[] {
  const todos = loadTodos(date);
  const dailyId = todos.find((t) => t.id === id)?.dailyId;
  if (!dailyId) return todos;
  const repeatDays = normalizeDays(days);
  updateDailyTask(dailyId, (d) => {
    const { days: _d, ...rest } = d;
    return repeatDays ? { ...rest, days: repeatDays } : rest;
  });
  if (repeatDays) removeFutureCopies(dailyId, date, (day) => repeatDays.includes(weekday(day)));
  return todos;
}

function removeFutureCopies(dailyId: string, date: string, keepOn: (day: string) => boolean = () => false): void {
  for (const d of getAllStoredDates().filter((d) => d > date && !keepOn(d))) {
    const day = loadTodos(d);
    const kept = day.filter((t) => t.dailyId !== dailyId || t.completed);
    if (kept.length !== day.length) saveTodos(kept, d);
  }
}

// Days in a row a daily task was done, counting back from `date`. Days it doesn't repeat on,
// or that the user removed it from, don't break the streak; nor does an unfinished `date`,
// since that day isn't over yet.
export function getDailyStreak(dailyId: string, date: string): number {
  const task = loadDailyTasks().find((d) => d.id === dailyId);
  if (!task) return 0;
  let streak = 0;
  for (let day = date; day >= task.startDate; day = shiftDate(day, -1)) {
    if (!repeatsOn(task, day)) continue;
    const done =
      task.doneDates?.includes(day) || loadTodos(day).some((t) => t.dailyId === dailyId && t.completed);
    if (done) streak++;
    else if (task.skipDates?.includes(day) || day === date) continue;
    else break;
  }
  return streak;
}

// ---------------- Subtasks ----------------

function updateSubtasks(id: string, date: string | undefined, change: (subtasks: Subtask[]) => Subtask[]): Todo[] {
  const todos = loadTodos(date);
  const updated = todos.map((t) => {
    if (t.id !== id) return t;
    const { subtasks: _s, ...rest } = t;
    const subtasks = change(t.subtasks ?? []);
    return subtasks.length ? { ...rest, subtasks } : rest;
  });
  saveTodos(updated, date);
  syncDailyFrom(updated.find((t) => t.id === id));
  return updated;
}

export function addSubtask(id: string, text: string, date?: string): Todo[] {
  if (!text.trim()) return loadTodos(date);
  return updateSubtasks(id, date, (s) => [...s, { id: crypto.randomUUID(), text: text.trim(), done: false }]);
}

export function toggleSubtask(id: string, subtaskId: string, date?: string): Todo[] {
  return updateSubtasks(id, date, (s) => s.map((st) => (st.id === subtaskId ? { ...st, done: !st.done } : st)));
}

export function deleteSubtask(id: string, subtaskId: string, date?: string): Todo[] {
  return updateSubtasks(id, date, (s) => s.filter((st) => st.id !== subtaskId));
}

// ---------------- Moving between days ----------------

// Move a one-off todo to another day, optionally into a time slot there (undefined = unscheduled).
// Returns the target day's todos, or null for a daily task's copy: each day has its own copy.
export function moveTodoToDate(id: string, from: string, to: string, schedule?: Schedule): Todo[] | null {
  const source = loadTodos(from);
  const todo = source.find((t) => t.id === id);
  if (!todo) return loadTodos(to);
  if (from === to) return scheduleTodo(id, schedule, to);
  if (todo.dailyId) return null;
  const { start: _s, duration: _d, ...rest } = todo;
  const moved: Todo = schedule
    ? { ...rest, start: schedule.start, duration: schedule.duration ?? todo.duration ?? DEFAULT_DURATION }
    : { ...rest, ...(todo.duration !== undefined ? { duration: todo.duration } : {}) };
  saveTodos(source.filter((t) => t.id !== id), from);
  const updated = [...loadTodos(to), moved];
  saveTodos(updated, to);
  return updated;
}

// Copy a todo to another day (or the same one), optionally into a time slot there.
// The copy starts fresh: not done, checklist unticked, no focus time, and it is always a
// one-off, even when copied from a daily task's copy. Returns the target day's todos.
export function copyTodoToDate(id: string, from: string, to: string, schedule?: Schedule): Todo[] {
  const todo = loadTodos(from).find((t) => t.id === id);
  if (!todo) return loadTodos(to);
  const { start: _s, duration: _d, dailyId: _id, carriedFrom: _c, spent: _sp, subtasks, ...rest } = todo;
  const copy: Todo = {
    ...rest,
    id: crypto.randomUUID(),
    completed: false,
    createdAt: new Date().toISOString(),
    ...(subtasks?.length
      ? { subtasks: subtasks.map((st) => ({ id: crypto.randomUUID(), text: st.text, done: false })) }
      : {}),
    ...(schedule
      ? { start: schedule.start, duration: schedule.duration ?? todo.duration ?? DEFAULT_DURATION }
      : todo.duration !== undefined
      ? { duration: todo.duration }
      : {}),
  };
  const updated = [...loadTodos(to), copy];
  saveTodos(updated, to);
  return updated;
}

// ---------------- Focus timer ----------------

export type FocusSession = { todoId: string; date: string; text: string; startedAt: number };

const FOCUS_STORAGE_KEY = "reel-radar-focus";

export function getFocusSession(): FocusSession | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(FOCUS_STORAGE_KEY) || "null");
    return parsed && typeof parsed.startedAt === "number" ? parsed : null;
  } catch {
    return null;
  }
}

// Start timing a todo. A session already running for another todo is stopped and recorded first.
export function startFocus(todo: Todo, date: string, now = Date.now()): FocusSession {
  if (getFocusSession()) stopFocus(now);
  const session = { todoId: todo.id, date, text: todo.text, startedAt: now };
  localStorage.setItem(FOCUS_STORAGE_KEY, JSON.stringify(session));
  return session;
}

// End the running session and add its length (rounded to whole minutes) to the todo's time spent.
// Returns that day's todos, or null when nothing was running.
export function stopFocus(now = Date.now()): Todo[] | null {
  const session = getFocusSession();
  if (!session) return null;
  localStorage.removeItem(FOCUS_STORAGE_KEY);
  return addSpentTime(session.todoId, Math.round((now - session.startedAt) / 60000), session.date);
}

export function addSpentTime(id: string, minutes: number, date?: string): Todo[] {
  const todos = loadTodos(date);
  if (minutes <= 0) return todos;
  const updated = todos.map((t) => (t.id === id ? { ...t, spent: (t.spent ?? 0) + minutes } : t));
  saveTodos(updated, date);
  return updated;
}

// ---------------- Reminders ----------------

// Unfinished scheduled todos starting within the next `lead` minutes of `now` (minutes since midnight).
export function dueReminders(todos: Todo[], now: number, lead: number): Todo[] {
  return todos.filter((t) => !t.completed && t.start !== undefined && now >= t.start - lead && now <= t.start);
}

// Fetch daily tasks from the server when this browser has none (e.g. a new device).
export async function syncDailyTasksWithServer(): Promise<DailyTask[]> {
  const local = loadDailyTasks();
  if (local.length > 0 || typeof window === "undefined") return local;
  try {
    const res = await fetch(`/api/todos?date=${DAILY_SERVER_KEY}`);
    if (!res.ok) return local;
    const data = await res.json();
    if (Array.isArray(data.todos) && data.todos.length > 0) {
      localStorage.setItem(DAILY_STORAGE_KEY, JSON.stringify(data.todos, null, 2));
      return data.todos;
    }
  } catch (err) {
    console.error("[Daily Tasks Sync] Server storage unreachable.", err);
  }
  return local;
}

export function deleteTodo(id: string, date?: string): Todo[] {
  const todos = loadTodos(date);
  const updated = todos.filter((t) => t.id !== id);
  saveTodos(updated, date);
  // Deleting a daily task's copy skips it for this day only, so it isn't re-added on reload.
  const dailyId = todos.find((t) => t.id === id)?.dailyId;
  if (dailyId) {
    const day = date || getTodayDate();
    updateDailyTask(dailyId, (d) => ({ ...d, skipDates: [...(d.skipDates ?? []), day] }));
  }
  return updated;
}

export function updateTodoText(id: string, text: string, date?: string): Todo[] {
  return updateTodo(id, { text }, date);
}

// Change a todo's title and/or note. An empty note removes it.
export function updateTodo(id: string, changes: { text?: string; note?: string }, date?: string): Todo[] {
  const todos = loadTodos(date);
  const updated = todos.map((t) => {
    if (t.id !== id) return t;
    const next = { ...t, ...(changes.text !== undefined ? { text: changes.text } : {}) };
    if (changes.note === undefined) return next;
    const { note: _n, ...rest } = next;
    return changes.note.trim() ? { ...rest, note: changes.note.trim() } : rest;
  });
  saveTodos(updated, date);
  syncDailyFrom(updated.find((t) => t.id === id));
  return updated;
}

export function clearCompletedTodos(date?: string): Todo[] {
  const todos = loadTodos(date);
  const updated = todos.filter((t) => !t.completed);
  saveTodos(updated, date);
  const day = date || getTodayDate();
  for (const t of todos) {
    if (t.completed && t.dailyId)
      updateDailyTask(t.dailyId, (d) => ({
        ...d,
        skipDates: [...(d.skipDates ?? []), day],
        doneDates: [...(d.doneDates ?? []), day],
      }));
  }
  return updated;
}

export function getAllStoredDates(): string[] {
  if (typeof window === "undefined") return [];
  const dates: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(TODO_STORAGE_PREFIX)) {
      const date = key.replace(TODO_STORAGE_PREFIX, "");
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        dates.push(date);
      }
    }
  }
  return dates.sort().reverse(); // Most recent first
}

export function loadAllTodos(): Record<string, Todo[]> {
  if (typeof window === "undefined") return {};
  const dates = getAllStoredDates();
  const result: Record<string, Todo[]> = {};
  for (const date of dates) {
    result[date] = loadTodos(date);
  }
  return result;
}

export function exportTodos(date?: string): void {
  const targetDate = date || getTodayDate();
  const todos = loadTodos(targetDate);
  const blob = new Blob([JSON.stringify({ date: targetDate, todos }, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `reel-radar-todos-${targetDate}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importTodos(
  file: File,
  onSuccess: (todos: Todo[], date: string) => void,
  onError?: (msg: string) => void
): void {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const content = e.target?.result as string;
      const parsed = JSON.parse(content);
      if (!parsed || typeof parsed !== "object") {
        throw new Error("Invalid backup format");
      }
      const { date, todos } = parsed;
      if (!date || !Array.isArray(todos)) {
        throw new Error("Invalid backup format: missing date or todos");
      }
      saveTodos(todos, date);
      onSuccess(todos, date);
    } catch {
      if (onError) {
        onError("Invalid JSON backup file.");
      } else {
        alert("Could not import file: Invalid JSON format.");
      }
    }
  };
  reader.readAsText(file);
}

export async function syncTodosWithServer(date?: string): Promise<Todo[]> {
  const targetDate = date || getTodayDate();
  try {
    const res = await fetch(`/api/todos?date=${targetDate}`);
    if (!res.ok) return loadTodos(targetDate);
    
    const data = await res.json();
    if (data.todos) {
      saveTodos(data.todos, targetDate);
      return data.todos;
    }
    return loadTodos(targetDate);
  } catch (err) {
    console.error("[Todos Sync] Server storage unreachable. Using browser localStorage only.", err);
    return loadTodos(targetDate);
  }
}