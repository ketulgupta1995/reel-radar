"use client";

import { useEffect } from "react";
import { merge3, same } from "@/lib/syncDocs";
import { SYNC_EVENT, markDirty, registerDocs, syncKeys, watchKeys } from "@/lib/sync";
import { addTodo, getTodayDate } from "@/lib/todos";
import { MAX_ITEM_MEDIA, MEDIA_ID, MEDIA_TYPES, type MediaRef } from "@/lib/media";

// The planner's lists: things to remember that don't belong to a day (a wishlist, gift ideas,
// books to read). Lists and their items are one synced doc, "planner-lists". Photos and voice
// notes are uploaded separately (lib/media.ts); items only keep references to them.

export type RememberList = { id: string; name: string; icon?: string; createdAt: number };

export type ListItem = {
  id: string;
  listId: string;
  text: string;
  note?: string;
  link?: string; // always http(s)
  price?: number; // rupees
  done: boolean;
  doneAt?: number;
  pinned?: boolean;
  media?: MediaRef[];
  createdAt: number;
};

export const STARTER_LISTS: { name: string; icon: string }[] = [
  { name: "Wishlist", icon: "🎁" },
  { name: "Things to remember", icon: "📌" },
  { name: "Books to read", icon: "📚" },
  { name: "Ideas", icon: "💡" },
];

export const LIST_ICONS = ["📌", "🎁", "🛒", "📚", "💡", "✈️", "🍽️", "🎬", "🏠", "💊", "🎵", "⭐"];

// ---------------- Storage ----------------
// Each list and item carries `updatedAt`, so when two devices changed the same one, the later
// edit wins; deletes carry across through the three-way merge.

type Entry<T> = { value: T; updatedAt: number };
type ListsDoc = { lists: Entry<RememberList>[]; items: Entry<ListItem>[] };

const LISTS_DOC = "planner-lists";
const STORAGE_KEY = "reel-radar-" + LISTS_DOC;

const emptyDoc = (): ListsDoc => ({ lists: [], items: [] });

function readListsDoc(): ListsDoc {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return parsed && Array.isArray(parsed.lists) && Array.isArray(parsed.items) ? parsed : emptyDoc();
  } catch {
    return emptyDoc();
  }
}

const writeListsDoc = (doc: ListsDoc) => localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));

const idOf = <T extends { id: string }>(e: Entry<T>) => e.value.id;
const newer = <T>(local: Entry<T>, server: Entry<T>) => (server.updatedAt > local.updatedAt ? server : local);

export const mergeLists = (local: ListsDoc, server: ListsDoc, base?: ListsDoc): ListsDoc => ({
  lists: merge3(local.lists || [], server.lists || [], base?.lists, idOf, newer),
  items: merge3(local.items || [], server.items || [], base?.items, idOf, newer),
});

registerDocs((key) =>
  key === LISTS_DOC
    ? { read: readListsDoc, write: writeListsDoc, merge: mergeLists, empty: emptyDoc, flushDelay: 3000 }
    : undefined
);

// Replace the lists and items. Only the ones that changed get a new `updatedAt`, and the doc is
// pushed a few seconds after the last change.
function save(lists: RememberList[], items: ListItem[]): void {
  const doc = readListsDoc();
  const now = Date.now();
  const stamp = <T extends { id: string }>(next: T[], before: Entry<T>[]): Entry<T>[] => {
    const old = new Map(before.map((e) => [e.value.id, e]));
    return next.map((value) => {
      const o = old.get(value.id);
      return o && same(o.value, value) ? o : { value, updatedAt: now };
    });
  };
  const next = { lists: stamp(lists, doc.lists), items: stamp(items, doc.items) };
  if (same(next, doc)) return;
  writeListsDoc(next);
  markDirty(LISTS_DOC);
}

const allLists = () => readListsDoc().lists.map((e) => e.value);
const allItems = () => readListsDoc().items.map((e) => e.value);

// Add `incoming` to `current`: the same id takes the incoming copy, and nothing is deleted.
export function mergeById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const byId = new Map(incoming.map((t) => [t.id, t]));
  const have = new Set(current.map((t) => t.id));
  return [...current.map((t) => byId.get(t.id) ?? t), ...incoming.filter((t) => !have.has(t.id))];
}

// Drop unset fields, so a cleared note doesn't linger as `note: undefined` in the synced copy.
const compact = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as T;

// ---------------- Lists ----------------

export function loadLists(): RememberList[] {
  if (typeof window === "undefined") return [];
  return allLists().sort((a, b) => a.createdAt - b.createdAt);
}

export function addList(name: string, icon?: string): RememberList {
  const list: RememberList = compact({ id: crypto.randomUUID(), name: name.trim() || "Untitled list", icon, createdAt: Date.now() });
  save([...allLists(), list], allItems());
  return list;
}

export function updateList(id: string, changes: { name?: string; icon?: string }): void {
  const name = changes.name?.trim();
  save(
    allLists().map((l) => (l.id === id ? compact({ ...l, ...changes, name: name || l.name }) : l)),
    allItems()
  );
}

// Delete a list and its items. Returns the media the items had, for the caller to delete.
export function deleteList(id: string): MediaRef[] {
  const items = allItems();
  save(
    allLists().filter((l) => l.id !== id),
    items.filter((i) => i.listId !== id)
  );
  return items.filter((i) => i.listId === id).flatMap((i) => i.media ?? []);
}

// ---------------- Items ----------------

// Pinned first, then what's still to do (newest first), then done ones (most recently done first).
export function sortItems(items: ListItem[]): ListItem[] {
  return [...items].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.done) return (b.doneAt ?? 0) - (a.doneAt ?? 0);
    if (!a.pinned !== !b.pinned) return a.pinned ? -1 : 1;
    return b.createdAt - a.createdAt;
  });
}

export function loadItems(listId: string): ListItem[] {
  if (typeof window === "undefined") return [];
  return sortItems(allItems().filter((i) => i.listId === listId));
}

export function getItem(id: string): ListItem | undefined {
  if (typeof window === "undefined") return undefined;
  return allItems().find((i) => i.id === id);
}

// Items still to do, per list.
export function openCounts(): Record<string, number> {
  if (typeof window === "undefined") return {};
  const counts: Record<string, number> = {};
  for (const i of allItems()) if (!i.done) counts[i.listId] = (counts[i.listId] ?? 0) + 1;
  return counts;
}

// Items in any list whose text, note or link contains `query`.
export function searchItems(query: string): ListItem[] {
  const q = query.trim().toLowerCase();
  if (!q || typeof window === "undefined") return [];
  return sortItems(allItems().filter((i) => [i.text, i.note, i.link].some((s) => s?.toLowerCase().includes(q))));
}

export const totalPrice = (items: ListItem[]) => items.reduce((n, i) => n + (i.done ? 0 : i.price ?? 0), 0);

// A link the page can safely put in an href: http(s) only, "https://" added when left out.
export function cleanLink(raw: string): string | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.includes(".") ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export const linkHost = (link: string) => {
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return link;
  }
};

// A price typed as "2500", "2,500", "₹2,500" or "Rs. 2500".
export function parsePrice(raw: string): number | undefined {
  const m = /^\s*(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)\s*$/i.exec(raw);
  if (!m) return undefined;
  const n = Number(m[1].replace(/,/g, ""));
  return n > 0 ? n : undefined;
}

// Read a link and a price out of what was typed in the add box: "Headphones ₹2,999 amazon.in/x"
// becomes { text: "Headphones", price: 2999, link: "https://amazon.in/x" }. A bare link is
// named after its site.
export function parseQuickItem(raw: string): { text: string; link?: string; price?: number } {
  let text = raw.trim();
  let link: string | undefined;
  let price: number | undefined;
  const url = /(?:^|\s)((?:https?:\/\/|www\.)\S+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|in|org|net|io|co|app|dev)(?:\/\S*)?)(?=\s|$)/i.exec(text);
  if (url) {
    link = cleanLink(url[1]);
    if (link) text = (text.slice(0, url.index) + " " + text.slice(url.index + url[0].length)).trim();
  }
  const money = /(?:^|\s)((?:₹|rs\.?\s?|inr\s?)\d[\d,]*(?:\.\d+)?)(?=\s|$)/i.exec(text);
  if (money) {
    price = parsePrice(money[1]);
    if (price) text = (text.slice(0, money.index) + " " + text.slice(money.index + money[0].length)).trim();
  }
  text = text.replace(/\s+/g, " ");
  if (!text && link) text = linkHost(link);
  return compact({ text, link, price });
}

export function addItem(listId: string, text: string, extra: Partial<Omit<ListItem, "id" | "listId" | "createdAt">> = {}): ListItem {
  const item: ListItem = compact({ done: false, ...extra, id: crypto.randomUUID(), listId, text: text.trim(), createdAt: Date.now() });
  save(allLists(), [...allItems(), item]);
  return item;
}

export type ItemChanges = Partial<Pick<ListItem, "text" | "note" | "link" | "price" | "pinned" | "listId" | "media">>;

// Change an item. A field set to undefined is cleared; an empty text keeps the old one.
export function updateItem(id: string, changes: ItemChanges): void {
  save(
    allLists(),
    allItems().map((i) => {
      if (i.id !== id) return i;
      const next = { ...i, ...changes, text: changes.text?.trim() || i.text };
      if (!next.media?.length) delete next.media;
      if (!next.pinned) delete next.pinned;
      return compact(next);
    })
  );
}

export function toggleItem(id: string): void {
  save(
    allLists(),
    allItems().map((i) => {
      if (i.id !== id) return i;
      const { doneAt: _d, ...rest } = i;
      return i.done ? { ...rest, done: false } : { ...rest, done: true, doneAt: Date.now() };
    })
  );
}

// Delete an item. Returns its media, for the caller to delete.
export function deleteItem(id: string): MediaRef[] {
  const items = allItems();
  save(allLists(), items.filter((i) => i.id !== id));
  return items.find((i) => i.id === id)?.media ?? [];
}

// Delete a list's done items. Returns their media.
export function clearDone(listId: string): MediaRef[] {
  const items = allItems();
  const gone = items.filter((i) => i.listId === listId && i.done);
  save(allLists(), items.filter((i) => !gone.includes(i)));
  return gone.flatMap((i) => i.media ?? []);
}

// Add an item to a day's tasks (today by default); the list item stays.
export function planItem(item: ListItem, date = getTodayDate()): void {
  const note = [item.note, item.link].filter(Boolean).join("\n");
  addTodo(item.text, date, undefined, undefined, undefined, note || undefined);
}

// ---------------- Backup ----------------

export type ListsBackup = { lists: RememberList[]; items: ListItem[] };

export const listsBackup = (): ListsBackup => ({ lists: allLists(), items: allItems() });

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

const isMediaRef = (m: unknown): m is MediaRef => {
  const r = m as MediaRef | null;
  return !!r && typeof r.id === "string" && MEDIA_ID.test(r.id) && MEDIA_TYPES[r.mime] === r.kind && typeof r.size === "number";
};

// Backups are untrusted: keep only well-formed fields, and links that pass cleanLink().
function cleanBackupList(raw: unknown): RememberList | null {
  const l = raw as Partial<RememberList> | null;
  if (typeof l?.id !== "string" || typeof l.name !== "string") return null;
  return compact({ id: l.id, name: l.name, icon: str(l.icon), createdAt: num(l.createdAt) ?? Date.now() });
}

function cleanBackupItem(raw: unknown): ListItem | null {
  const i = raw as Partial<ListItem> | null;
  if (typeof i?.id !== "string" || typeof i.listId !== "string" || typeof i.text !== "string") return null;
  const media = Array.isArray(i.media) ? i.media.filter(isMediaRef).slice(0, MAX_ITEM_MEDIA) : [];
  const price = num(i.price);
  return compact({
    id: i.id,
    listId: i.listId,
    text: i.text,
    note: str(i.note),
    link: typeof i.link === "string" ? cleanLink(i.link) : undefined,
    price: price !== undefined && price >= 0 ? price : undefined,
    done: i.done === true,
    doneAt: num(i.doneAt),
    pinned: i.pinned === true ? true : undefined,
    media: media.length ? media : undefined,
    createdAt: num(i.createdAt) ?? Date.now(),
  });
}

// Add lists and items from a backup to what's here: the same id takes the backup's copy, and
// nothing is deleted. An item whose list is in neither place is left out.
export function restoreLists(backup: unknown): { lists: number; items: number } {
  const b = (backup ?? {}) as { lists?: unknown; items?: unknown };
  const lists = (Array.isArray(b.lists) ? b.lists : []).map(cleanBackupList).filter((l): l is RememberList => !!l);
  const items = (Array.isArray(b.items) ? b.items : []).map(cleanBackupItem).filter((i): i is ListItem => !!i);
  const mergedLists = mergeById(allLists(), lists);
  const known = new Set(mergedLists.map((l) => l.id));
  const usable = items.filter((i) => known.has(i.listId));
  save(mergedLists, mergeById(allItems(), usable));
  return { lists: lists.length, items: usable.length };
}

// ---------------- Sync ----------------

export async function syncLists(force = false): Promise<boolean | null> {
  const changed = await syncKeys([LISTS_DOC], { force });
  return changed && changed.length > 0;
}

// While the page is open, re-sync when the tab comes back into view and call `onChange` when
// another device's edits arrive.
export function useListsSync(onChange: () => void): void {
  useEffect(() => {
    const stop = watchKeys([LISTS_DOC]);
    const onSync = (e: Event) => {
      if ((e as CustomEvent<{ keys: string[] }>).detail.keys.includes(LISTS_DOC)) onChange();
    };
    window.addEventListener(SYNC_EVENT, onSync);
    return () => {
      stop();
      window.removeEventListener(SYNC_EVENT, onSync);
    };
    // onChange reloads from localStorage; subscribe once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
