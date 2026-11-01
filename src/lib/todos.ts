"use client";

import { useEffect } from "react";
import { merge3 } from "@/lib/syncDocs";
import { SYNC_EVENT, markDirty, registerDocs, syncKeys, watchKeys } from "@/lib/sync";

export type Priority = "high" | "medium" | "low";

export type Subtask = { id: string; text: string; done: boolean; doneAt?: number }; // doneAt: when it was ticked (ms since epoch)

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
  doneAt?: number; // when it was marked done (ms since epoch); the schedule marks that time
  createdAt: string; // ISO string
  priority?: Priority;
  carriedFrom?: string; // YYYY-MM-DD the task was moved from
  start?: number; // planner start, minutes since midnight
  duration?: number; // planner length in minutes
  dailyId?: string; // set when this is one day's copy of a daily task
  subtasks?: Subtask[];
  tag?: TagId;
  spent?: number; // minutes recorded with the focus timer
  order?: number; // place in the list after the user dragged tasks into their own order
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

// ---------------- Storage ----------------
// Each month's todos are one synced doc ("planner-2026-10") and the daily tasks another
// ("planner-daily"). localStorage keeps the same docs under "reel-radar-<doc key>", and
// lib/sync.ts keeps them in step across devices. Items carry `updatedAt` so that when two
// devices changed the same todo, the later edit wins.

type MonthItem = { date: string; pos: number; todo: Todo; updatedAt: number };
type MonthDoc = { items: MonthItem[] };
type DailyItem = { task: DailyTask; updatedAt: number };
type DailyDoc = { items: DailyItem[] };
type LogItem = { date: string; log: DayLog; updatedAt: number };
type LogDoc = { items: LogItem[] };

// A day's log: when you woke and slept (HH:MM), the water you drank (millilitres, and when each drink was
// logged as minutes after midnight), and a short review.
export type DayLog = { wake?: string; sleep?: string; water?: number; drinks?: { at: number; ml: number }[]; weight?: number; well?: string; bad?: string; improve?: string };

const DAILY_DOC = "planner-daily";
const LOG_DOC = "planner-log";
const MONTH_DOC = /^planner-(\d{4}-\d{2})$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STORAGE_PREFIX = "reel-radar-";
// The first month of the synced planner; the stats page pulls every month from here on.
export const PLANNER_EPOCH = "2026-10";

const monthOf = (date: string) => date.slice(0, 7);
const monthDocKey = (month: string) => `planner-${month}`;
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
// The same items, in any order: a save that changes nothing shouldn't trigger a push.
const sorted = (items: unknown[]) => items.map((x) => JSON.stringify(x)).sort();
const sameItems = (a: unknown[], b: unknown[]) => a.length === b.length && sameJson(sorted(a), sorted(b));

function readDoc<T extends { items: unknown[] }>(docKey: string): T {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_PREFIX + docKey) || "null");
    return parsed && Array.isArray(parsed.items) ? parsed : ({ items: [] } as unknown as T);
  } catch {
    return { items: [] } as unknown as T;
  }
}

const writeDoc = (docKey: string, doc: { items: unknown[] }) =>
  localStorage.setItem(STORAGE_PREFIX + docKey, JSON.stringify(doc));

const readMonth = (month: string) => readDoc<MonthDoc>(monthDocKey(month));
const readDaily = () => readDoc<DailyDoc>(DAILY_DOC);

const newer = <T extends { updatedAt: number }>(local: T, server: T) => (server.updatedAt > local.updatedAt ? server : local);

registerDocs((key) => {
  if (key !== DAILY_DOC && key !== LOG_DOC && !MONTH_DOC.test(key)) return undefined;
  const id =
    key === DAILY_DOC ? (i: DailyItem) => i.task.id : key === LOG_DOC ? (i: LogItem) => i.date : (i: MonthItem) => i.todo.id;
  return {
    read: () => readDoc(key),
    write: (doc: { items: never[] }) => writeDoc(key, doc),
    merge: (local: { items: never[] }, server: { items: never[] }, base?: { items: never[] }) => ({
      items: merge3(local.items, server.items, base?.items, id as (i: never) => string, newer),
    }),
    empty: () => ({ items: [] }),
    flushDelay: 3000,
  };
});

// The planner before synced docs kept one key per day; it started over empty.
if (typeof window !== "undefined") {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && (k.startsWith("reel-radar-todos-") || k === "reel-radar-daily-tasks")) localStorage.removeItem(k);
  }
}

export const toDateString = (d: Date): string =>
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
  return readMonth(monthOf(targetDate))
    .items.filter((i) => i.date === targetDate)
    .sort((a, b) => a.pos - b.pos)
    .map((i) => i.todo);
}

// Replace a day's list. Only todos that actually changed get a new `updatedAt`, and the month's
// doc is pushed to the server a few seconds after the last change.
export function saveTodos(todos: Todo[], date?: string): void {
  if (typeof window === "undefined") return;
  const targetDate = date || getTodayDate();
  const month = monthOf(targetDate);
  const doc = readMonth(month);
  const now = Date.now();
  const before = new Map(doc.items.map((i) => [i.todo.id, i]));
  const ids = new Set(todos.map((t) => t.id));
  const items = todos.map((todo, pos) => {
    const old = before.get(todo.id);
    return old && old.date === targetDate && old.pos === pos && sameJson(old.todo, todo)
      ? old
      : { date: targetDate, pos, todo, updatedAt: now };
  });
  // Other days of the month stay; a todo moved here from one of them is taken off it.
  const next: MonthDoc = { items: [...doc.items.filter((i) => i.date !== targetDate && !ids.has(i.todo.id)), ...items] };
  if (sameItems(next.items, doc.items)) return;
  writeDoc(monthDocKey(month), next);
  markDirty(monthDocKey(month));
}

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

// The order tasks are listed in. Unfinished ones come first, then done ones. Among unfinished
// tasks, any the user has arranged by hand (`order`) lead, in that order. The rest follow with
// daily tasks first, then by priority, then oldest first.
export function sortTodos(todos: Todo[]): Todo[] {
  return [...todos].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    if ((a.order !== undefined) !== (b.order !== undefined)) return a.order !== undefined ? -1 : 1;
    if (a.order !== undefined && b.order !== undefined && a.order !== b.order) return a.order - b.order;
    if (!a.dailyId !== !b.dailyId) return a.dailyId ? -1 : 1;
    const pa = a.priority ? PRIORITY_RANK[a.priority] : 3;
    const pb = b.priority ? PRIORITY_RANK[b.priority] : 3;
    if (pa !== pb) return pa - pb;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

// Move `id` to just before `beforeId` in the day's list (null = after the last unfinished task).
// Every task then keeps the place it has on screen, so the arrangement sticks. Done tasks always
// stay below unfinished ones, so they can't be moved or moved before.
export function reorderTodo(id: string, beforeId: string | null, date?: string): Todo[] {
  const todos = loadTodos(date);
  const list = sortTodos(todos);
  const moving = list.find((t) => t.id === id);
  const before = beforeId === null ? null : list.find((t) => t.id === beforeId);
  if (!moving || moving.completed || before === undefined || before?.completed || id === beforeId) return todos;
  const rest = list.filter((t) => t.id !== id);
  const at = before ? rest.indexOf(before) : rest.filter((t) => !t.completed).length;
  rest.splice(at, 0, moving);
  if (rest.every((t, i) => t.id === list[i].id)) return todos;
  const place = new Map(rest.map((t, i) => [t.id, i]));
  const updated = todos.map((t) => ({ ...t, order: place.get(t.id)! }));
  saveTodos(updated, date);
  return updated;
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
  const updated = todos.map((t) => {
    if (t.id !== id) return t;
    const { doneAt: _d, ...rest } = t;
    return t.completed ? { ...rest, completed: false } : { ...rest, completed: true, doneAt: Date.now() };
  });
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
    const { start: _s, duration: _d, order: _o, ...rest } = t;
    return { ...rest, carriedFrom: t.carriedFrom ?? yesterday };
  });
  const updated = [...loadTodos(date), ...moved];
  saveTodos(updated, date);
  return updated;
}

// ---------------- Day log (wake, sleep, weight, water, review) ----------------

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const WATER_STEP = 250; // one glass
export const WATER_GOAL = 2500; // the daily target the progress bar fills toward

export function loadDayLog(date: string): DayLog {
  if (typeof window === "undefined") return {};
  return readDoc<LogDoc>(LOG_DOC).items.find((i) => i.date === date)?.log ?? {};
}

// Change part of a day's log; `undefined` clears that field. A log left empty is removed.
export function updateDayLog(date: string, change: { [K in keyof DayLog]?: DayLog[K] | undefined }): DayLog {
  if (typeof window === "undefined") return {};
  const doc = readDoc<LogDoc>(LOG_DOC);
  const old = doc.items.find((i) => i.date === date)?.log ?? {};
  const log: DayLog = { ...old, ...change };
  if (log.wake !== undefined && !TIME_RE.test(log.wake)) delete log.wake;
  if (log.sleep !== undefined && !TIME_RE.test(log.sleep)) delete log.sleep;
  if (log.water !== undefined && !(log.water > 0)) delete log.water;
  if (log.drinks && !log.drinks.length) delete log.drinks;
  if (log.weight !== undefined && !(log.weight > 0 && log.weight < 1000)) delete log.weight;
  for (const k of ["well", "bad", "improve"] as const) if (!log[k]?.trim()) delete log[k];
  (Object.keys(log) as (keyof DayLog)[]).forEach((k) => log[k] === undefined && delete log[k]);
  if (sameJson(old, log)) return old;
  const rest = doc.items.filter((i) => i.date !== date);
  writeDoc(LOG_DOC, { items: Object.keys(log).length ? [...rest, { date, log, updatedAt: Date.now() }] : rest });
  markDirty(LOG_DOC);
  return log;
}

// Add (or, with a negative amount, remove) water; never below zero. `at` (minutes after midnight) records
// when the drink happened so the schedule can mark it; removing water drops the latest recorded drink.
export function addWater(date: string, ml: number, at?: number): DayLog {
  const old = loadDayLog(date);
  const water = Math.max(0, (old.water ?? 0) + ml);
  let drinks = old.drinks;
  if (ml > 0 && at !== undefined) drinks = [...(drinks ?? []), { at, ml }];
  else if (ml < 0 && drinks) drinks = drinks.slice(0, -1);
  return updateDayLog(date, { water, drinks: water > 0 ? drinks : undefined });
}

// ---------------- Daily tasks ----------------

export function loadDailyTasks(): DailyTask[] {
  if (typeof window === "undefined") return [];
  return readDaily().items.map((i) => i.task);
}

function saveDailyTasks(tasks: DailyTask[]): void {
  if (typeof window === "undefined") return;
  const doc = readDaily();
  const now = Date.now();
  const before = new Map(doc.items.map((i) => [i.task.id, i]));
  const next: DailyDoc = {
    items: tasks.map((task) => {
      const old = before.get(task.id);
      return old && sameJson(old.task, task) ? old : { task, updatedAt: now };
    }),
  };
  if (sameItems(next.items, doc.items)) return;
  writeDoc(DAILY_DOC, next);
  markDirty(DAILY_DOC);
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
      // Fixed per task and day, so two devices adding the same day's copy agree on one todo.
      id: `${d.id}:${date}`,
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
  return updateSubtasks(id, date, (s) =>
    s.map((st) => {
      if (st.id !== subtaskId) return st;
      const { doneAt: _d, ...rest } = st;
      return st.done ? { ...rest, done: false } : { ...rest, done: true, doneAt: Date.now() };
    })
  );
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
  const { start: _s, duration: _d, order: _o, ...rest } = todo;
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
  const { start: _s, duration: _d, dailyId: _id, carriedFrom: _c, spent: _sp, order: _o, doneAt: _da, subtasks, ...rest } = todo;
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

// Days that have todos, most recent first.
export function getAllStoredDates(): string[] {
  if (typeof window === "undefined") return [];
  const dates = new Set<string>();
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    const m = key?.startsWith(STORAGE_PREFIX) ? MONTH_DOC.exec(key.slice(STORAGE_PREFIX.length)) : null;
    if (m) readMonth(m[1]).items.forEach((item) => dates.add(item.date));
  }
  return Array.from(dates).sort().reverse();
}

export function loadAllTodos(): Record<string, Todo[]> {
  return Object.fromEntries(getAllStoredDates().map((date) => [date, loadTodos(date)]));
}

// ---------------- Sync ----------------

const plannerKeys = (months: string[]) => [DAILY_DOC, LOG_DOC, ...Array.from(new Set(months)).map(monthDocKey)];

// Months from PLANNER_EPOCH through a few months ahead, for views that need every day.
function allMonths(): string[] {
  const months: string[] = [];
  const end = new Date();
  end.setMonth(end.getMonth() + 3);
  const last = monthOf(toDateString(end));
  for (let d = new Date(PLANNER_EPOCH + "-01T00:00:00"); monthOf(toDateString(d)) <= last; d.setMonth(d.getMonth() + 1)) {
    months.push(monthOf(toDateString(d)));
  }
  return months;
}

// Pull the months holding `dates`, and the daily tasks, from the server. Recently synced docs are
// skipped unless `force`. Resolves to whether anything changed here, or null when offline.
export async function syncPlanner(dates: string[], force = false): Promise<boolean | null> {
  const changed = await syncKeys(plannerKeys(dates.map(monthOf)), { force });
  return changed && changed.length > 0;
}

export async function syncAllPlanner(force = false): Promise<boolean | null> {
  const changed = await syncKeys(plannerKeys(allMonths()), { force });
  return changed && changed.length > 0;
}

// While a view shows `dates`, re-sync them when the tab comes back into view, and call
// `onChange` when another device's edits arrive.
export function usePlannerSync(dates: string[], onChange: () => void): void {
  const keys = plannerKeys(dates.map(monthOf)).join(",");
  useEffect(() => {
    const list = keys.split(",");
    const stop = watchKeys(list);
    const onSync = (e: Event) => {
      if ((e as CustomEvent<{ keys: string[] }>).detail.keys.some((k) => list.includes(k))) onChange();
    };
    window.addEventListener(SYNC_EVENT, onSync);
    return () => {
      stop();
      window.removeEventListener(SYNC_EVENT, onSync);
    };
    // onChange reloads from localStorage; re-subscribe only when the months change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);
}

// ---------------- Backup ----------------

export type PlannerBackup = { app: "planner"; version: 2; days: Record<string, Todo[]>; daily: DailyTask[] };
export type PlannerImport = { todos: number; days: number; daily: number };

export function exportPlanner(): void {
  const backup: PlannerBackup = { app: "planner", version: 2, days: loadAllTodos(), daily: loadDailyTasks() };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `planner-backup-${getTodayDate()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

const isTodo = (t: unknown): t is Todo =>
  !!t && typeof (t as Todo).id === "string" && typeof (t as Todo).text === "string";
const isDailyTask = (t: unknown): t is DailyTask =>
  !!t && typeof (t as DailyTask).id === "string" && typeof (t as DailyTask).startDate === "string";

// Add imported items to what's here: a todo or task with the same id takes the imported version,
// and nothing is deleted.
function mergeById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const byId = new Map(incoming.map((t) => [t.id, t]));
  const have = new Set(current.map((t) => t.id));
  return [...current.map((t) => byId.get(t.id) ?? t), ...incoming.filter((t) => !have.has(t.id))];
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

// Import a planner backup from exportPlanner(), or an older single-day { date, todos } file.
// Pulls every month first, so the import merges into the latest copy.
export async function importPlanner(file: File): Promise<PlannerImport> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file));
  } catch {
    throw new Error("Invalid JSON backup file.");
  }
  const p = parsed as Partial<PlannerBackup> & { date?: unknown; todos?: unknown };
  const days: Record<string, Todo[]> = {};
  if (p && p.app === "planner" && p.days && typeof p.days === "object") {
    for (const [date, todos] of Object.entries(p.days)) {
      if (DATE_RE.test(date) && Array.isArray(todos)) days[date] = todos.filter(isTodo);
    }
  } else if (p && typeof p.date === "string" && DATE_RE.test(p.date) && Array.isArray(p.todos)) {
    days[p.date] = p.todos.filter(isTodo);
  } else {
    throw new Error("Not a planner backup file.");
  }
  const daily = Array.isArray(p.daily) ? p.daily.filter(isDailyTask) : [];

  await syncAllPlanner();
  for (const [date, todos] of Object.entries(days)) saveTodos(mergeById(loadTodos(date), todos), date);
  if (daily.length) saveDailyTasks(mergeById(loadDailyTasks(), daily));
  return {
    todos: Object.values(days).reduce((n, t) => n + t.length, 0),
    days: Object.values(days).filter((t) => t.length > 0).length,
    daily: daily.length,
  };
}
