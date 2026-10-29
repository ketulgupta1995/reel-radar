"use client";

export type Priority = "high" | "medium" | "low";

export type Todo = {
  id: string;
  text: string;
  completed: boolean;
  createdAt: string; // ISO string
  priority?: Priority;
  carriedFrom?: string; // YYYY-MM-DD the task was moved from
  start?: number; // planner start, minutes since midnight
  duration?: number; // planner length in minutes
  dailyId?: string; // set when this is one day's copy of a daily task
};

// A task that repeats every day. Each day gets its own Todo copy, so completion is per day.
export type DailyTask = {
  id: string;
  text: string;
  priority?: Priority;
  start?: number;
  duration?: number;
  startDate: string; // first day it appears
  skipDates?: string[]; // days the user removed it from
};

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
  daily?: boolean
): Todo[] {
  const todos = loadTodos(date);
  const newTodo: Todo = {
    id: crypto.randomUUID(),
    text,
    completed: false,
    createdAt: new Date().toISOString(),
    ...(priority ? { priority } : {}),
    ...(schedule ? { start: schedule.start, duration: schedule.duration ?? DEFAULT_DURATION } : {}),
  };
  if (daily) {
    const task = templateFrom(newTodo, date || getTodayDate());
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

function templateFrom(todo: Todo, startDate: string): DailyTask {
  return {
    id: crypto.randomUUID(),
    text: todo.text,
    startDate,
    ...(todo.priority ? { priority: todo.priority } : {}),
    ...(todo.start !== undefined ? { start: todo.start, duration: todo.duration ?? DEFAULT_DURATION } : {}),
  };
}

// Edits to a daily task's copy (text, priority, time slot) carry over to future days.
function syncDailyFrom(todo: Todo | undefined): void {
  if (!todo?.dailyId) return;
  updateDailyTask(todo.dailyId, (d) => {
    const { priority: _p, start: _s, duration: _d, ...rest } = d;
    return {
      ...rest,
      text: todo.text,
      ...(todo.priority ? { priority: todo.priority } : {}),
      ...(todo.start !== undefined ? { start: todo.start, duration: todo.duration ?? DEFAULT_DURATION } : {}),
    };
  });
}

// Load a day's todos, adding that day's copy of every daily task it is missing.
export function loadTodosWithDaily(date: string): Todo[] {
  const todos = loadTodos(date);
  const present = new Set(todos.map((t) => t.dailyId).filter(Boolean));
  const missing = loadDailyTasks().filter(
    (d) => d.startDate <= date && !present.has(d.id) && !d.skipDates?.includes(date)
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
      ...(d.priority ? { priority: d.priority } : {}),
      ...(d.start !== undefined ? { start: d.start, duration: d.duration ?? DEFAULT_DURATION } : {}),
    })),
  ];
  saveTodos(updated, date);
  return updated;
}

// Turn an existing todo into a daily task, starting on `date`.
export function makeTodoDaily(id: string, date: string): Todo[] {
  const todos = loadTodos(date);
  const todo = todos.find((t) => t.id === id);
  if (!todo || todo.dailyId) return todos;
  const task = templateFrom(todo, date);
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
  for (const d of getAllStoredDates().filter((d) => d > date)) {
    const day = loadTodos(d);
    const kept = day.filter((t) => t.dailyId !== dailyId || t.completed);
    if (kept.length !== day.length) saveTodos(kept, d);
  }
  const updated = todos.map((t) => {
    if (t.id !== id) return t;
    const { dailyId: _d, ...rest } = t;
    return rest;
  });
  saveTodos(updated, date);
  return updated;
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
  const todos = loadTodos(date);
  const updated = todos.map((t) =>
    t.id === id ? { ...t, text } : t
  );
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
      updateDailyTask(t.dailyId, (d) => ({ ...d, skipDates: [...(d.skipDates ?? []), day] }));
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