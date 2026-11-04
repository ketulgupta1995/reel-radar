"use client";

// The synced part of Books: your library and where you stopped in each book, as one doc ("books").
// The EPUB files are not in it; they stay on each device (lib/books.ts).
//
// A removed book stays in the doc as a marker, so other devices can delete their copy of the file, and
// so an older position from another device can't bring the book back.
import { useEffect, useRef } from "react";
import { SYNC_EVENT, flush, markDirty, registerDocs, syncKeys, watchKeys } from "./sync";
import { merge3 } from "./syncDocs";

export type BookSource = "upload" | "standard-ebooks" | "gutenberg";
export type BookEntry = {
  id: string;
  title: string;
  author: string;
  source: BookSource;
  sourceId?: string; // the catalogue's own id for a downloaded book, e.g. "standard-ebooks:jane-austen/emma"
  hash: string;
  addedAt: number;
};
export type Position = { chapter: number; sentence: number; updatedAt: number };

type Item = { entry: BookEntry; removed?: true; position?: { chapter: number; sentence: number }; updatedAt: number };
export type BooksDoc = { items: Item[] };

export const BOOKS_DOC = "books";
const STORAGE_KEY = "reel-radar-books";
const LEGACY_LIBRARY = "books-library-v1";
const LEGACY_POSITIONS = "books-position-v1";

const emptyDoc = (): BooksDoc => ({ items: [] });

const parse = <T>(raw: string | null, fallback: T): T => {
  try {
    return JSON.parse(raw || "null") ?? fallback;
  } catch {
    return fallback;
  }
};

// Before the library synced, it lived in two other keys. Copy it over once, then drop them.
function migrateLegacy(): BooksDoc | null {
  const library = parse<BookEntry[]>(localStorage.getItem(LEGACY_LIBRARY), []);
  const positions = parse<Record<string, Position>>(localStorage.getItem(LEGACY_POSITIONS), {});
  if (!Array.isArray(library) || !library.length) {
    localStorage.removeItem(LEGACY_LIBRARY);
    localStorage.removeItem(LEGACY_POSITIONS);
    return null;
  }
  const items = library.map((entry) => {
    const p = positions[entry.id];
    return { entry, ...(p && { position: { chapter: p.chapter, sentence: p.sentence } }), updatedAt: p?.updatedAt ?? entry.addedAt };
  });
  localStorage.removeItem(LEGACY_LIBRARY);
  localStorage.removeItem(LEGACY_POSITIONS);
  return { items };
}

function readDoc(): BooksDoc {
  if (typeof window === "undefined") return emptyDoc();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) {
    const migrated = migrateLegacy();
    if (!migrated) return emptyDoc();
    writeDoc(migrated);
    markDirty(BOOKS_DOC);
    return migrated;
  }
  const doc = parse<Partial<BooksDoc>>(raw, {});
  return { items: Array.isArray(doc.items) ? doc.items : [] };
}

const writeDoc = (doc: BooksDoc) => localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));

// The newest change wins, but a removal is final: it can't be undone by an older copy of the book.
const both = (local: Item, server: Item): Item => {
  const winner = server.updatedAt > local.updatedAt ? server : local;
  return local.removed || server.removed ? { entry: winner.entry, removed: true, updatedAt: winner.updatedAt } : winner;
};

export const mergeBooks = (local: BooksDoc, server: BooksDoc, base?: BooksDoc): BooksDoc => ({
  items: merge3(local.items || [], server.items || [], base?.items, (i) => i.entry.id, both),
});

registerDocs((key) => (key === BOOKS_DOC ? { read: readDoc, write: writeDoc, merge: mergeBooks, empty: emptyDoc, flushDelay: 5000 } : undefined));

/** Your library, newest first. */
export const loadLibrary = (): BookEntry[] =>
  readDoc()
    .items.filter((i) => !i.removed)
    .map((i) => i.entry)
    .sort((a, b) => b.addedAt - a.addedAt);

/** Books removed on some device, whose files can now be deleted here. */
export const removedIds = (): string[] => readDoc().items.filter((i) => i.removed).map((i) => i.entry.id);

export function addEntry(entry: BookEntry): void {
  const doc = readDoc();
  writeDoc({ items: [{ entry, updatedAt: Date.now() }, ...doc.items.filter((i) => i.entry.id !== entry.id)] });
  markDirty(BOOKS_DOC);
}

export function removeEntry(id: string): void {
  const doc = readDoc();
  const item = doc.items.find((i) => i.entry.id === id);
  if (!item || item.removed) return;
  writeDoc({ items: doc.items.map((i) => (i === item ? { entry: i.entry, removed: true, updatedAt: Date.now() } : i)) });
  markDirty(BOOKS_DOC);
}

export const loadPosition = (id: string): Position | undefined => {
  const item = readDoc().items.find((i) => i.entry.id === id);
  return item && !item.removed && item.position ? { ...item.position, updatedAt: item.updatedAt } : undefined;
};

let pending = false; // a position changed here that hasn't been queued for syncing yet

// Saved on this device after every sentence. It is only queued for syncing by commitPosition().
export function savePosition(id: string, chapter: number, sentence: number): void {
  const doc = readDoc();
  const item = doc.items.find((i) => i.entry.id === id);
  if (!item || item.removed || (item.position?.chapter === chapter && item.position.sentence === sentence)) return;
  writeDoc({ items: doc.items.map((i) => (i === item ? { ...i, position: { chapter, sentence }, updatedAt: Date.now() } : i)) });
  pending = true;
}

/** Queue the saved position for syncing: when you pause, change chapter or leave the page. */
export function commitPosition(): void {
  if (!pending) return;
  pending = false;
  markDirty(BOOKS_DOC);
}

/** Queue and push right away, for when the page is going away. */
export function pushPosition(): void {
  commitPosition();
  void flush([BOOKS_DOC]);
}

export const syncBooks = (force = false) => syncKeys([BOOKS_DOC], { force });

// While a page shows the library or a position, keep it fresh and call `onChange` when another device's
// changes arrive.
export function useBooksSync(onChange: () => void): void {
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => {
    const stop = watchKeys([BOOKS_DOC]);
    const onSync = (e: Event) => {
      if ((e as CustomEvent<{ keys: string[] }>).detail.keys.includes(BOOKS_DOC)) latest.current();
    };
    window.addEventListener(SYNC_EVENT, onSync);
    return () => {
      stop();
      window.removeEventListener(SYNC_EVENT, onSync);
    };
  }, []);
}

