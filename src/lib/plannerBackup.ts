"use client";

import { listsBackup, mergeById, restoreLists, syncLists, type ListsBackup } from "@/lib/lists";
import { restoreSettings, settingsBackup, type SettingsBackup } from "@/lib/plannerSettings";
import {
  getTodayDate,
  loadAllDayLogs,
  loadAllTodos,
  loadDailyTasks,
  loadTodos,
  saveDailyTasks,
  saveTodos,
  syncAllPlanner,
  updateDayLog,
  type DailyTask,
  type DayLog,
  type Todo,
} from "@/lib/todos";

// The planner's backup file: every day's tasks, the repeating tasks, the day log, the lists, and
// the tags and day templates.
// Photos and voice notes stay on the server; list items hold references to them.

export type PlannerBackup = {
  app: "planner";
  version: 4;
  days: Record<string, Todo[]>;
  daily: DailyTask[];
  log: Record<string, DayLog>;
  lists: ListsBackup;
  settings: SettingsBackup;
};
export type PlannerImport = { todos: number; days: number; daily: number; logs: number; lists: number; items: number; tags: number; templates: number };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Download a backup. Pulls everything first, because this browser only holds what its pages have
// loaded. `synced` is false when the server couldn't be reached, so the file has just this device's copy.
export async function exportPlanner(): Promise<{ synced: boolean }> {
  const pulled = await Promise.all([syncAllPlanner(), syncLists()]);
  const backup: PlannerBackup = {
    app: "planner",
    version: 4,
    days: loadAllTodos(),
    daily: loadDailyTasks(),
    log: loadAllDayLogs(),
    lists: listsBackup(),
    settings: settingsBackup(),
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `planner-backup-${getTodayDate()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  return { synced: pulled.every((r) => r !== null) };
}

const isTodo = (t: unknown): t is Todo =>
  !!t && typeof (t as Todo).id === "string" && typeof (t as Todo).text === "string";
const isDailyTask = (t: unknown): t is DailyTask =>
  !!t && typeof (t as DailyTask).id === "string" && typeof (t as DailyTask).startDate === "string";

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

// The well-formed fields of a day log from a backup; updateDayLog() checks their values.
function cleanDayLog(raw: unknown): DayLog {
  const l = (raw ?? {}) as Record<string, unknown>;
  const log: DayLog = {};
  for (const k of ["wake", "sleep", "well", "bad", "improve"] as const) {
    const v = l[k];
    if (typeof v === "string") log[k] = v;
  }
  for (const k of ["water", "weight", "reviewedAt"] as const) {
    const v = l[k];
    if (typeof v === "number" && Number.isFinite(v)) log[k] = v;
  }
  if (Array.isArray(l.drinks)) {
    log.drinks = l.drinks.filter((d) => typeof d?.at === "number" && typeof d?.ml === "number").map((d) => ({ at: d.at, ml: d.ml }));
  }
  return log;
}

// Import a planner backup from exportPlanner(), an older one without the log and lists, or an older
// single-day { date, todos } file. Pulls everything first, so the import merges into the latest copy.
// In a day log that's already here, the fields the backup has take its values.
export async function importPlanner(file: File): Promise<PlannerImport> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file));
  } catch {
    throw new Error("Invalid JSON backup file.");
  }
  const p = parsed as (Partial<Omit<PlannerBackup, "version">> & { date?: unknown; todos?: unknown }) | null;
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
  const logs = p.log && typeof p.log === "object" ? Object.entries(p.log).filter(([date]) => DATE_RE.test(date)) : [];

  await Promise.all([syncAllPlanner(), syncLists()]);
  for (const [date, todos] of Object.entries(days)) saveTodos(mergeById(loadTodos(date), todos), date);
  if (daily.length) saveDailyTasks(mergeById(loadDailyTasks(), daily));
  for (const [date, log] of logs) updateDayLog(date, cleanDayLog(log));
  const { lists, items } = restoreLists(p.lists);
  const { tags, templates } = restoreSettings(p.settings);
  return {
    todos: Object.values(days).reduce((n, t) => n + t.length, 0),
    days: Object.values(days).filter((t) => t.length > 0).length,
    daily: daily.length,
    logs: logs.length,
    lists,
    items,
    tags,
    templates,
  };
}
