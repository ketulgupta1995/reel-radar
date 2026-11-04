"use client";

// Books on this device: the library list lives in localStorage; the EPUB files live in IndexedDB and
// never leave the browser. A book's id is the start of its file's SHA-256, so the same file is the
// same book (uploading it twice adds it once, and later syncs can match it across devices).
import { EpubError, ParsedBook, parseEpub } from "./epub";

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

export const MAX_EPUB_BYTES = 50_000_000;
const LIBRARY_KEY = "books-library-v1";
const DB_NAME = "books";
const STORE = "files";

export function loadLibrary(): BookEntry[] {
  try {
    const list = JSON.parse(localStorage.getItem(LIBRARY_KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

const saveLibrary = (list: BookEntry[]) => localStorage.setItem(LIBRARY_KEY, JSON.stringify(list));

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

export type AddResult = { entry: BookEntry; existing: boolean };

// Add EPUB bytes to the library: read them, keep the file on this device and list the book. The same
// file is only added once. Throws EpubError for copy-protected or invalid files, and a plain Error for
// files that are too big.
export async function addBook(bytes: ArrayBuffer, source: BookSource, sourceId?: string): Promise<AddResult> {
  if (bytes.byteLength > MAX_EPUB_BYTES) throw new Error("That file is too big (max 50 MB).");
  const parsed = await parseEpub(bytes);
  const hash = hex(await crypto.subtle.digest("SHA-256", bytes));
  const id = hash.slice(0, 16);

  const library = loadLibrary();
  const existing = library.find((b) => b.id === id);
  if (existing) return { entry: existing, existing: true };

  await files("readwrite", (s) => s.put(bytes, id));
  const entry: BookEntry = { id, title: parsed.title, author: parsed.author, source, hash, addedAt: Date.now(), ...(sourceId && { sourceId }) };
  saveLibrary([entry, ...library]);
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

export const errorText = (err: unknown) => (err instanceof EpubError || err instanceof Error ? err.message : "That file couldn't be added.");

// Where you stopped in each book on this device, saved after every sentence.
export type Position = { chapter: number; sentence: number; updatedAt: number };
const POSITION_KEY = "books-position-v1";

function positions(): Record<string, Position> {
  try {
    const all = JSON.parse(localStorage.getItem(POSITION_KEY) || "{}");
    return all && typeof all === "object" && !Array.isArray(all) ? all : {};
  } catch {
    return {};
  }
}

export const loadPosition = (id: string): Position | undefined => positions()[id];

export function savePosition(id: string, chapter: number, sentence: number): void {
  localStorage.setItem(POSITION_KEY, JSON.stringify({ ...positions(), [id]: { chapter, sentence, updatedAt: Date.now() } }));
}

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
