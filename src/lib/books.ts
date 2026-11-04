"use client";

// Books on this device: the EPUB files live in IndexedDB and never leave the browser (the library list
// and your places are the synced doc in lib/booksDoc.ts). A book's id is the start of its file's SHA-256, so the same file is the
// same book (uploading it twice adds it once, and later syncs can match it across devices).
import { BookEntry, BookSource, addEntry, loadLibrary, removeEntry, removedIds } from "./booksDoc";
import { EpubError, ParsedBook, parseEpub } from "./epub";

export { loadLibrary, loadPosition, savePosition } from "./booksDoc";
export type { BookEntry, BookSource } from "./booksDoc";

export const MAX_EPUB_BYTES = 50_000_000;
const DB_NAME = "books";
const STORE = "files";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function files<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");

export type AddResult = {
  entry: BookEntry;
  existing: boolean; // the book and its file were already here
  restored?: boolean; // the book was already in the library (from another device), and now its file is here too
};

/** Ids of the books whose file is kept on this device. */
export async function localIds(): Promise<Set<string>> {
  return new Set((await files("readonly", (s) => s.getAllKeys())).map(String));
}

// Add EPUB bytes to the library: read them, keep the file on this device and list the book. The same
// file is only added once. A book that is already in the library without its file here (it came from
// another device) gets the file, and keeps its place. A catalogue book whose edition changed since the
// other device downloaded it is matched by its catalogue id instead. Throws EpubError for
// copy-protected or invalid files, and a plain Error for files that are too big.
export async function addBook(bytes: ArrayBuffer, source: BookSource, sourceId?: string): Promise<AddResult> {
  if (bytes.byteLength > MAX_EPUB_BYTES) throw new Error("That file is too big (max 50 MB).");
  const parsed = await parseEpub(bytes);
  const hash = hex(await crypto.subtle.digest("SHA-256", bytes));
  const id = hash.slice(0, 16);

  const known = loadLibrary().find((b) => b.id === id || (sourceId !== undefined && b.sourceId === sourceId));
  if (known) {
    if ((await localIds()).has(known.id)) return { entry: known, existing: true };
    await files("readwrite", (s) => s.put(bytes, known.id));
    return { entry: known, existing: false, restored: true };
  }

  await files("readwrite", (s) => s.put(bytes, id));
  const entry: BookEntry = { id, title: parsed.title, author: parsed.author, source, hash, addedAt: Date.now(), ...(sourceId && { sourceId }) };
  addEntry(entry);
  return { entry, existing: false };
}

export async function addUpload(file: File): Promise<AddResult> {
  if (file.size > MAX_EPUB_BYTES) throw new Error("That file is too big (max 50 MB).");
  return addBook(await file.arrayBuffer(), "upload");
}

// The parsed text of a book kept on this device, or null when its file isn't here.
export async function openBook(id: string): Promise<ParsedBook | null> {
  const bytes = await files<ArrayBuffer | undefined>("readonly", (s) => s.get(id));
  return bytes ? parseEpub(bytes) : null;
}

/** Take a book out of the library on every device, and delete its file from this one. */
export async function removeBook(id: string): Promise<void> {
  removeEntry(id);
  await files("readwrite", (s) => s.delete(id));
}

/** Delete the files of books that were removed on another device. */
export async function purgeRemoved(): Promise<void> {
  const gone = removedIds();
  if (!gone.length) return;
  const here = await localIds();
  for (const id of gone) if (here.has(id)) await files("readwrite", (s) => s.delete(id));
}

export const errorText = (err: unknown) => (err instanceof EpubError || err instanceof Error ? err.message : "That file couldn't be added.");

// The voice and speed you chose, kept on this device.
export type VoicePrefs = { voiceURI: string | null; rate: number };

export function loadVoicePrefs(): VoicePrefs {
  try {
    const p = JSON.parse(localStorage.getItem("books-voice-v1") || "{}");
    return { voiceURI: typeof p?.voiceURI === "string" ? p.voiceURI : null, rate: typeof p?.rate === "number" ? p.rate : 1 };
  } catch {
    return { voiceURI: null, rate: 1 };
  }
}

export const saveVoicePrefs = (prefs: VoicePrefs) => localStorage.setItem("books-voice-v1", JSON.stringify(prefs));
