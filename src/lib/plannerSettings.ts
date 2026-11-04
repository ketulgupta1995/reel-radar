"use client";

import { useEffect, useState } from "react";
import { merge3, same } from "@/lib/syncDocs";
import { SYNC_EVENT, markDirty, registerDocs } from "@/lib/sync";
import type { Priority } from "@/lib/todos";

// The planner's own settings, one synced doc: changes to tags, saved day templates, and goals. Built-in
// tags have no entry until they're renamed or removed. A removed tag keeps its entry, so tasks and
// stats that use it still show its name and colour; it just isn't offered any more.

export type TagDef = { id: string; label: string; color: string; removed?: boolean };

// Categorical colours in a fixed order, checked for colour-blind separation and 3:1 contrast on `panel`.
export const TAG_PALETTE = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
export const MAX_TAGS = TAG_PALETTE.length; // past this, colours stop being tellable apart
const MAX_LABEL = 24;

export const BUILTIN_TAGS: TagDef[] = ["Work", "Home", "Health", "Personal", "Learning", "Errands"].map((label, i) => ({
  id: label.toLowerCase(),
  label,
  color: TAG_PALETTE[i],
}));

export type TemplateItem = { text: string; note?: string; priority?: Priority; tag?: string; start?: number; duration?: number; subtasks?: string[] };
export type DayTemplate = { id: string; name: string; items: TemplateItem[]; createdAt: number };

export type Goal = { id: string; name: string; by?: string; createdAt: number; doneAt?: number }; // by: YYYY-MM-DD; doneAt: when it was achieved

type Entry<T> = { value: T; updatedAt: number };
type SettingsDoc = { tags: Entry<TagDef>[]; templates: Entry<DayTemplate>[]; goals: Entry<Goal>[] };

export const SETTINGS_DOC = "planner-settings";
const STORAGE_KEY = "reel-radar-" + SETTINGS_DOC;
const TAGS_EVENT = "reel-radar-tags";

const emptyDoc = (): SettingsDoc => ({ tags: [], templates: [], goals: [] });

// Labels and colours are read for every row drawn, so the parsed doc is kept until it changes.
let cached: { raw: string | null; doc: SettingsDoc } = { raw: null, doc: emptyDoc() };

function readDoc(): SettingsDoc {
  if (typeof window === "undefined") return emptyDoc();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === cached.raw) return cached.doc;
  let doc = emptyDoc();
  try {
    const parsed = JSON.parse(raw || "null");
    if (parsed) doc = { tags: Array.isArray(parsed.tags) ? parsed.tags : [], templates: Array.isArray(parsed.templates) ? parsed.templates : [], goals: Array.isArray(parsed.goals) ? parsed.goals : [] };
  } catch {
    // Unreadable: treat it as empty.
  }
  cached = { raw, doc };
  return doc;
}

const writeDoc = (doc: SettingsDoc) => localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));

const idOf = <T extends { id: string }>(e: Entry<T>) => e.value.id;
const newer = <T>(local: Entry<T>, server: Entry<T>) => (server.updatedAt > local.updatedAt ? server : local);

export const mergeSettings = (local: SettingsDoc, server: SettingsDoc, base?: SettingsDoc): SettingsDoc => ({
  tags: merge3(local.tags || [], server.tags || [], base?.tags, idOf, newer),
  templates: merge3(local.templates || [], server.templates || [], base?.templates, idOf, newer),
  goals: merge3(local.goals || [], server.goals || [], base?.goals, idOf, newer),
});

registerDocs((key) =>
  key === SETTINGS_DOC ? { read: readDoc, write: writeDoc, merge: mergeSettings, empty: emptyDoc, flushDelay: 3000 } : undefined
);

function save(tags: TagDef[], templates: DayTemplate[], goals: Goal[] = allGoals()): void {
  const doc = readDoc();
  const now = Date.now();
  const stamp = <T extends { id: string }>(next: T[], before: Entry<T>[]): Entry<T>[] => {
    const old = new Map(before.map((e) => [e.value.id, e]));
    return next.map((value) => {
      const o = old.get(value.id);
      return o && same(o.value, value) ? o : { value, updatedAt: now };
    });
  };
  const next = { tags: stamp(tags, doc.tags), templates: stamp(templates, doc.templates), goals: stamp(goals, doc.goals) };
  if (same(next, doc)) return;
  writeDoc(next);
  markDirty(SETTINGS_DOC);
  window.dispatchEvent(new Event(TAGS_EVENT));
}

const storedTags = () => readDoc().tags.map((e) => e.value);
const allTemplates = () => readDoc().templates.map((e) => e.value);
const allGoals = () => readDoc().goals.map((e) => e.value);

// ---------------- Tags ----------------

const memo = { doc: null as SettingsDoc | null, tags: BUILTIN_TAGS, byId: new Map<string, TagDef>() };

// Every tag, removed ones too: built-ins first (with any changes), then the user's.
export function allTags(): TagDef[] {
  const doc = readDoc();
  if (memo.doc !== doc) {
    const stored = doc.tags.map((e) => e.value);
    const changed = new Map(stored.map((t) => [t.id, t]));
    const builtin = new Set(BUILTIN_TAGS.map((t) => t.id));
    memo.doc = doc;
    memo.tags = [...BUILTIN_TAGS.map((t) => changed.get(t.id) ?? t), ...stored.filter((t) => !builtin.has(t.id))];
    memo.byId = new Map(memo.tags.map((t) => [t.id, t]));
  }
  return memo.tags;
}

export const activeTags = (): TagDef[] => allTags().filter((t) => !t.removed);

const findTag = (id: string) => {
  allTags();
  return memo.byId.get(id);
};

// A tag id from elsewhere (an old backup) may be unknown: it reads as a plain, neutral tag.
export const tagLabel = (id: string): string => findTag(id)?.label ?? "Other";
export const tagColor = (id: string): string => findTag(id)?.color ?? "rgba(255,255,255,0.35)";

const cleanLabel = (label: string) => label.trim().replace(/^#+/, "").slice(0, MAX_LABEL).trim();
const sameLabel = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function storeTag(tag: TagDef): void {
  const rest = storedTags().filter((t) => t.id !== tag.id);
  save([...rest, tag], allTemplates());
}

// Add a tag with the next free colour. A removed tag of the same name comes back. Returns why it
// couldn't, or null when it worked.
export function addTag(label: string): string | null {
  const name = cleanLabel(label);
  if (!name) return "Give the tag a name";
  const active = activeTags();
  if (active.some((t) => sameLabel(t.label, name))) return `There's already a ${name} tag`;
  if (active.length >= MAX_TAGS) return `You can have up to ${MAX_TAGS} tags. Remove one first.`;
  const color = TAG_PALETTE.find((c) => !active.some((t) => t.color === c))!;
  const old = allTags().find((t) => t.removed && sameLabel(t.label, name));
  storeTag(old ? { id: old.id, label: name, color } : { id: crypto.randomUUID(), label: name, color });
  return null;
}

export function renameTag(id: string, label: string): string | null {
  const tag = findTag(id);
  const name = cleanLabel(label);
  if (!tag) return "That tag is gone";
  if (!name) return "Give the tag a name";
  if (activeTags().some((t) => t.id !== id && sameLabel(t.label, name))) return `There's already a ${name} tag`;
  storeTag({ ...tag, label: name });
  return null;
}

export function removeTag(id: string): void {
  const tag = findTag(id);
  if (tag) storeTag({ ...tag, removed: true });
}

// The tags to offer, for React: the built-ins on the first render (pages are prerendered, and the
// browser's copy isn't known then), then the real ones, kept up to date.
export function useTags(): TagDef[] {
  const [tags, setTags] = useState(BUILTIN_TAGS);
  useEffect(() => {
    const refresh = () => setTags(activeTags());
    refresh();
    window.addEventListener(SYNC_EVENT, refresh);
    window.addEventListener(TAGS_EVENT, refresh);
    return () => {
      window.removeEventListener(SYNC_EVENT, refresh);
      window.removeEventListener(TAGS_EVENT, refresh);
    };
  }, []);
  return tags;
}

// ---------------- Day templates ----------------

export const loadTemplates = (): DayTemplate[] => (typeof window === "undefined" ? [] : allTemplates().sort((a, b) => a.createdAt - b.createdAt));

// Save under this name, replacing a template that already has it.
export function saveTemplate(name: string, items: TemplateItem[]): void {
  const clean = name.trim().slice(0, 40) || "Untitled day";
  const all = allTemplates();
  const old = all.find((t) => sameLabel(t.name, clean));
  const template: DayTemplate = { id: old?.id ?? crypto.randomUUID(), name: clean, items, createdAt: old?.createdAt ?? Date.now() };
  save(storedTags(), [...all.filter((t) => t.id !== template.id), template]);
}

export function deleteTemplate(id: string): void {
  save(storedTags(), allTemplates().filter((t) => t.id !== id));
}

// ---------------- Goals ----------------

const MAX_GOAL_NAME = 80;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Every goal, achieved ones too, oldest first. Tasks keep the id of a deleted goal, and it just stops matching.
export const loadGoals = (): Goal[] => (typeof window === "undefined" ? [] : allGoals().sort((a, b) => a.createdAt - b.createdAt));

function storeGoals(goals: Goal[]): void {
  save(storedTags(), allTemplates(), goals);
}

// Add a goal. Returns why it couldn't, or null when it worked.
export function addGoal(name: string, by?: string): string | null {
  const clean = name.trim().slice(0, MAX_GOAL_NAME);
  if (!clean) return "Give the goal a name";
  if (allGoals().some((g) => !g.doneAt && sameLabel(g.name, clean))) return `There's already a goal called ${clean}`;
  storeGoals([...allGoals(), { id: crypto.randomUUID(), name: clean, createdAt: Date.now(), ...(by ? { by } : {}) }]);
  return null;
}

// Change a goal's name or date; an empty date removes it, and an empty name is ignored.
export function updateGoal(id: string, changes: { name?: string; by?: string }): void {
  storeGoals(
    allGoals().map((g) => {
      if (g.id !== id) return g;
      const { by: _by, ...rest } = g;
      const by = changes.by === undefined ? g.by : changes.by;
      return { ...rest, name: changes.name?.trim().slice(0, MAX_GOAL_NAME) || g.name, ...(by ? { by } : {}) };
    })
  );
}

export function setGoalDone(id: string, done: boolean): void {
  storeGoals(
    allGoals().map((g) => {
      if (g.id !== id) return g;
      const { doneAt: _d, ...rest } = g;
      return done ? { ...rest, doneAt: Date.now() } : rest;
    })
  );
}

export function deleteGoal(id: string): void {
  storeGoals(allGoals().filter((g) => g.id !== id));
}

// The goals, for React: none on the first render (pages are prerendered, and the browser's copy
// isn't known then), then the real ones, kept up to date.
export function useGoals(): Goal[] {
  const [goals, setGoals] = useState<Goal[]>([]);
  useEffect(() => {
    const refresh = () => setGoals(loadGoals());
    refresh();
    window.addEventListener(SYNC_EVENT, refresh);
    window.addEventListener(TAGS_EVENT, refresh);
    return () => {
      window.removeEventListener(SYNC_EVENT, refresh);
      window.removeEventListener(TAGS_EVENT, refresh);
    };
  }, []);
  return goals;
}

// ---------------- Backup ----------------

export type SettingsBackup = { tags: TagDef[]; templates: DayTemplate[]; goals: Goal[] };

export const settingsBackup = (): SettingsBackup => ({ tags: storedTags(), templates: allTemplates(), goals: allGoals() });

const cleanItem = (raw: unknown): TemplateItem | null => {
  const i = raw as Partial<TemplateItem> | null;
  if (typeof i?.text !== "string" || !i.text) return null;
  const whole = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n >= 0 && n < 24 * 60 ? n : undefined);
  const start = whole(i.start);
  return {
    text: i.text,
    ...(typeof i.note === "string" && i.note ? { note: i.note } : {}),
    ...(i.priority === "high" || i.priority === "medium" || i.priority === "low" ? { priority: i.priority } : {}),
    ...(typeof i.tag === "string" ? { tag: i.tag } : {}),
    ...(start !== undefined ? { start, duration: whole(i.duration) || 60 } : {}),
    ...(Array.isArray(i.subtasks) && i.subtasks.length ? { subtasks: i.subtasks.filter((s): s is string => typeof s === "string") } : {}),
  };
};

// Add tags, templates and goals from a backup: the same id takes the backup's copy, and nothing is deleted.
// Backups are untrusted, so a colour must be one of the palette's; any other becomes the first.
export function restoreSettings(backup: unknown): { tags: number; templates: number; goals: number } {
  const b = (backup ?? {}) as { tags?: unknown; templates?: unknown; goals?: unknown };
  const tags = (Array.isArray(b.tags) ? b.tags : []).flatMap((raw): TagDef[] => {
    const t = raw as Partial<TagDef> | null;
    if (typeof t?.id !== "string" || typeof t.label !== "string" || !cleanLabel(t.label)) return [];
    const color = typeof t.color === "string" && TAG_PALETTE.includes(t.color) ? t.color : TAG_PALETTE[0];
    return [{ id: t.id, label: cleanLabel(t.label), color, ...(t.removed === true ? { removed: true } : {}) }];
  });
  const templates = (Array.isArray(b.templates) ? b.templates : []).flatMap((raw): DayTemplate[] => {
    const t = raw as Partial<DayTemplate> | null;
    if (typeof t?.id !== "string" || typeof t.name !== "string" || !Array.isArray(t.items)) return [];
    const items = t.items.map(cleanItem).filter((i): i is TemplateItem => !!i);
    return [{ id: t.id, name: t.name.slice(0, 40), items, createdAt: typeof t.createdAt === "number" ? t.createdAt : Date.now() }];
  });
  const goals = (Array.isArray(b.goals) ? b.goals : []).flatMap((raw): Goal[] => {
    const g = raw as Partial<Goal> | null;
    if (typeof g?.id !== "string" || typeof g.name !== "string" || !g.name.trim()) return [];
    return [{
      id: g.id,
      name: g.name.trim().slice(0, MAX_GOAL_NAME),
      createdAt: typeof g.createdAt === "number" ? g.createdAt : Date.now(),
      ...(typeof g.by === "string" && DATE_RE.test(g.by) ? { by: g.by } : {}),
      ...(typeof g.doneAt === "number" ? { doneAt: g.doneAt } : {}),
    }];
  });
  const byId = <T extends { id: string }>(current: T[], incoming: T[]) => [...current.filter((c) => !incoming.some((i) => i.id === c.id)), ...incoming];
  save(byId(storedTags(), tags), byId(allTemplates(), templates), byId(allGoals(), goals));
  return { tags: tags.length, templates: templates.length, goals: goals.length };
}
