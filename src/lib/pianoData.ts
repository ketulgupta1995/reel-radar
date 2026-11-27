"use client";

// Piano's saved data: kept on this device and synced as docs (both in DOC_KEY, not encrypted):
//   piano-YYYY-MM  { items: { [sessionId]: SessionRecord } }   one doc per local month; a record is a drill round
//                  or a manual entry ({kind: "manual", startedAt, durationMs, note}), filed under its startedAt month
// Deleting a manual entry removes its key from the month's items: no tombstone. The sync merge (merge3 over the
// items as a list, three-way against the last synced copy) drops an item that is missing on one side and unchanged
// from base, so the removal carries across devices. Changing an entry's date to
// another month removes it from the old month doc and adds it to the new one (two docs, same id).
//   piano-settings { unlocks: { [drill]: groups open }, slowSteps: { [drill]: index into SLOW_LIMITS }, slowAt: { [drill]: when
//                  its slow step last changed }, months: ["2026-11", ...] months that have data, updatedAt }
// Settings merge: unlocks take the max per drill, a slow step is last-write-wins per drill (by slowAt), months are a union.
// `months` lets a new device know which month docs to pull for the log; `slowAt` and `months` are additive (older
// copies without them read as empty).
//   `songs` { [songId]: {step, tempo, best, mastered?, at} }: song progress; every field only goes up (max, mastered is an OR),
// so a merge never loses progress; written (and queued) only when a run changes it. Additive like the others.
//   `importedSongs` { [id]: {title, at, removed?} }: which imported MIDI songs exist, so another device knows which
// song docs to pull. Union by id; a `removed` marker is final (it wins over any copy without it), like Books.
//   piano-song-<12 hex> a SongDoc (pianoSongImport.ts): one imported song, compact. Never edited after it is
// saved. /api/sync has no delete, so deleting a song marks it removed in the settings and replaces its doc with the
// tiny `{removed: true}` (a normal push, merged with the same removal-wins rule), then no device lists or loads it.
// localStorage keys are "reel-radar-" + the doc key, like the other apps.
import { useEffect, useRef } from "react";
import { DrillRecord, DrillSettings, HISTORY_DAYS, ManualRecord, SessionRecord } from "./pianoDrill";
import { SYNC_EVENT, markDirty, registerDocs, syncKeys, watchKeys } from "./sync";
import { SongProgress, mergeProgress } from "./pianoSongLadder";
import { MAX_SONG_DOC_BYTES, SONG_ID, SongDoc, TombstoneDoc, cleanTitle, decodeSong, encodeSong } from "./pianoSongImport";
import { Song } from "./pianoSongs";
import { merge3 } from "./syncDocs";

export type MonthDoc = { items: Record<string, SessionRecord> };
export type PianoSettings = {
  unlocks: Record<string, number>;
  slowSteps: Record<string, number>;
  slowAt: Record<string, number>;
  months: string[];
  songs: Record<string, SongProgress>; // per song: hands step, tempo ladder, best on-time % (see pianoSongLadder)
  importedSongs: Record<string, ImportedEntry>; // imported MIDI songs by id (see the header)
  updatedAt: number;
};

export type ImportedEntry = { title: string; at: number; removed?: true };

export const SETTINGS_DOC = "piano-settings";
export const MAX_IMPORTED = 50; // songs kept at once (removed ones don't count)
const SONG_DOC = /^piano-song-[0-9a-f]{12}$/;
export const songDocKey = (id: string) => `piano-song-${id}`;
const MONTH_DOC = /^piano-\d{4}-\d{2}$/;
const PREFIX = "reel-radar-";

const read = <T>(doc: string, fallback: T): T => {
  try {
    const v = JSON.parse(localStorage.getItem(PREFIX + doc) || "null");
    return v && typeof v === "object" ? v : fallback;
  } catch {
    return fallback;
  }
};
const write = (doc: string, v: unknown) => localStorage.setItem(PREFIX + doc, JSON.stringify(v));

const p2 = (n: number) => String(n).padStart(2, "0");
export const monthDocKey = (ts: number) => {
  const d = new Date(ts); // the local month
  return `piano-${d.getFullYear()}-${p2(d.getMonth() + 1)}`;
};

export const newSessionId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

export const loadMonth = (doc: string): MonthDoc => {
  const m = read<Partial<MonthDoc>>(doc, {});
  return { items: m.items && typeof m.items === "object" ? m.items : {} };
};

export function saveSession(rec: SessionRecord) {
  const doc = monthDocKey(rec.startedAt);
  const m = loadMonth(doc);
  m.items[rec.id] = rec;
  write(doc, m);
  markDirty(doc);
  addMonth(doc);
}

// Drill sessions started in the last ~3 months (the month docs they can sit in, then the date cut).
export function recentSessions(now: number, days = HISTORY_DAYS): DrillRecord[] {
  return recentRecords(now, days).filter((r): r is DrillRecord => r.kind === "drill");
}

// Every record (drill rounds and manual entries) started in the last `days` days.
export function recentRecords(now: number, days = HISTORY_DAYS): SessionRecord[] {
  const cut = now - days * 86_400_000;
  const docs: string[] = [];
  for (const d = new Date(cut); d.setDate(1) <= now; d.setMonth(d.getMonth() + 1)) docs.push(monthDocKey(d.getTime()));
  const out: SessionRecord[] = [];
  for (const d of docs) for (const r of Object.values(loadMonth(d).items)) if (r.startedAt >= cut) out.push(r);
  return out;
}

export function deleteSession(rec: SessionRecord) {
  const doc = monthDocKey(rec.startedAt);
  const m = loadMonth(doc);
  delete m.items[rec.id];
  write(doc, m);
  markDirty(doc);
}

// Adds or edits a manual entry. `prev` is the saved entry being edited: if the date moved to another month
// it is removed from that month's doc first.
export function saveManual(rec: ManualRecord, prev?: ManualRecord) {
  if (prev && monthDocKey(prev.startedAt) !== monthDocKey(rec.startedAt)) deleteSession(prev);
  saveSession(rec);
}

const emptySettings = (): PianoSettings => ({ unlocks: {}, slowSteps: {}, slowAt: {}, months: [], songs: {}, importedSongs: {}, updatedAt: 0 });

export function loadSettings(): PianoSettings {
  const s = read<Partial<PianoSettings>>(SETTINGS_DOC, {});
  return {
    unlocks: s.unlocks ?? {},
    slowSteps: s.slowSteps ?? {},
    slowAt: s.slowAt ?? {},
    months: Array.isArray(s.months) ? s.months : [],
    songs: s.songs && typeof s.songs === "object" ? s.songs : {},
    importedSongs: cleanImported(s.importedSongs),
    updatedAt: s.updatedAt ?? 0,
  };
}

// The index of imported songs, keeping only well-formed entries (it can arrive from another device).
function cleanImported(x: unknown): Record<string, ImportedEntry> {
  const out: Record<string, ImportedEntry> = {};
  if (!x || typeof x !== "object") return out;
  for (const [id, e] of Object.entries(x as Record<string, Partial<ImportedEntry> | null>)) {
    if (!SONG_ID.test(id) || !e || typeof e !== "object") continue;
    out[id] = { title: cleanTitle(e.title) || "Imported song", at: typeof e.at === "number" && Number.isFinite(e.at) ? e.at : 0, ...(e.removed ? { removed: true as const } : {}) };
  }
  return out;
}

export const drillSettings = (s: PianoSettings, drill: string): DrillSettings => ({
  unlocked: Math.max(1, s.unlocks[drill] ?? 1),
  slowStep: Math.max(0, s.slowSteps[drill] ?? 0),
});

// Unlock levels only ever go up (the max of what is stored and what is given); the slow step is
// last-write-wins. Only a real change is written and queued for syncing, so a round that changes nothing costs no write.
export function saveDrillSettings(drill: string, v: DrillSettings, now: number) {
  const s = loadSettings();
  const unlocked = Math.max(s.unlocks[drill] ?? 1, v.unlocked);
  if (s.unlocks[drill] === unlocked && (s.slowSteps[drill] ?? 0) === v.slowStep && drill in s.slowSteps) return;
  s.unlocks[drill] = unlocked;
  if ((s.slowSteps[drill] ?? 0) !== v.slowStep || !(drill in s.slowSteps)) s.slowAt[drill] = now;
  s.slowSteps[drill] = v.slowStep;
  s.updatedAt = now;
  write(SETTINGS_DOC, s);
  markDirty(SETTINGS_DOC);
}

export const loadSongProgress = (id: string): SongProgress | undefined => loadSettings().songs[id];

// Stores a song's progress; the caller only passes a changed value, and an identical one is not rewritten.
export function saveSongProgress(id: string, p: SongProgress, now: number) {
  const s = loadSettings();
  const cur = s.songs[id];
  if (cur && cur.step === p.step && cur.tempo === p.tempo && cur.best === p.best && !!cur.mastered === !!p.mastered) return;
  s.songs[id] = mergeProgress(cur, p)!;
  s.updatedAt = now;
  write(SETTINGS_DOC, s);
  markDirty(SETTINGS_DOC);
}

// Remember that a month has data (so a new device pulls it), queuing the settings only when it is new.
function addMonth(doc: string) {
  const month = doc.slice("piano-".length);
  const s = loadSettings();
  if (s.months.includes(month)) return;
  s.months = [...s.months, month].sort();
  write(SETTINGS_DOC, s);
  markDirty(SETTINGS_DOC);
}

// ---------------- Sync ----------------

const newest = <T extends { updatedAt: number }>(local: T, server: T) => (server.updatedAt > local.updatedAt ? server : local);

export const mergeMonth = (local: MonthDoc, server: MonthDoc, base?: MonthDoc): MonthDoc => {
  const list = (d?: MonthDoc) => Object.values(d?.items ?? {});
  const items = merge3(list(local), list(server), base && list(base), (r) => r.id, newest);
  return { items: Object.fromEntries(items.map((r) => [r.id, r])) };
};

const maxBy = (l: Record<string, number> = {}, s: Record<string, number> = {}) => {
  const out = { ...l };
  for (const [k, v] of Object.entries(s)) out[k] = Math.max(out[k] ?? v, v);
  return out;
};

export const mergeSettings = (local: PianoSettings, server: PianoSettings): PianoSettings => {
  const l = { ...emptySettings(), ...local };
  const s = { ...emptySettings(), ...server };
  const slowSteps: Record<string, number> = {};
  const slowAt: Record<string, number> = {};
  for (const d of new Set([...Object.keys(l.slowSteps), ...Object.keys(s.slowSteps)])) {
    // A copy from before slowAt existed counts as changed when the whole doc last was.
    const at = (x: PianoSettings) => x.slowAt[d] ?? x.updatedAt;
    const win = d in s.slowSteps && (!(d in l.slowSteps) || at(s) > at(l)) ? s : l;
    slowSteps[d] = win.slowSteps[d];
    slowAt[d] = at(win);
  }
  const songs: Record<string, SongProgress> = {};
  for (const id of new Set([...Object.keys(l.songs), ...Object.keys(s.songs)])) songs[id] = mergeProgress(l.songs[id], s.songs[id])!;
  const importedSongs: Record<string, ImportedEntry> = {};
  const li = cleanImported(l.importedSongs);
  const si = cleanImported(s.importedSongs);
  for (const id of new Set([...Object.keys(li), ...Object.keys(si)])) {
    const a = li[id];
    const b = si[id];
    const win = !a ? b : !b ? a : b.at > a.at ? b : a;
    importedSongs[id] = { title: win.title, at: Math.max(a?.at ?? 0, b?.at ?? 0), ...(a?.removed || b?.removed ? { removed: true as const } : {}) };
  }
  return {
    unlocks: maxBy(l.unlocks, s.unlocks),
    songs,
    importedSongs,
    slowSteps,
    slowAt,
    months: [...new Set([...l.months, ...s.months])].sort(),
    updatedAt: Math.max(l.updatedAt, s.updatedAt),
  };
};

// A song doc: the song, or the tombstone left by a delete. Removal wins; otherwise the stored copy (songs never change).
type StoredSong = SongDoc | TombstoneDoc | Record<string, never>;
export const mergeSongDoc = (local: StoredSong, server: StoredSong): StoredSong => {
  if (local.removed || server.removed) return { removed: true };
  return "notes" in local ? local : "notes" in server ? server : {};
};

registerDocs((key) => {
  if (SONG_DOC.test(key)) {
    return { read: () => read<StoredSong>(key, {}), write: (d: StoredSong) => write(key, d), merge: mergeSongDoc, empty: (): StoredSong => ({}), flushDelay: 3000 };
  }
  if (key === SETTINGS_DOC) {
    return { read: loadSettings, write: (d: PianoSettings) => write(SETTINGS_DOC, d), merge: mergeSettings, empty: emptySettings, flushDelay: 3000 };
  }
  if (!MONTH_DOC.test(key)) return undefined;
  return { read: () => loadMonth(key), write: (d: MonthDoc) => write(key, d), merge: mergeMonth, empty: () => ({ items: {} }), flushDelay: 3000 };
});

// The docs Piano pulls when it opens: settings, this month and last month (what the drills and the hub teaser read).
export function openKeys(now = Date.now()): string[] {
  const d = new Date(now);
  return [SETTINGS_DOC, monthDocKey(now), monthDocKey(new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime())];
}

export const syncPiano = () => syncKeys(openKeys());

// The log's charts reach back about a year: pull every month the settings list (once, when the log opens).
export async function syncPianoHistory(): Promise<void> {
  const open = openKeys();
  const months = () => loadSettings().months.map((m) => `piano-${m}`).filter((k) => !open.includes(k));
  if ((await syncKeys([SETTINGS_DOC, ...open, ...months()])) === null) return;
  // The settings may have just told this device about more months.
  await syncKeys(months());
}

// Keep Piano's docs fresh while a page is open (re-synced when the tab is shown again) and call `onChange`
// when another device's data arrives. `keys` is evaluated once, on mount.
export function usePianoSync(onChange: () => void, keys: () => string[] = openKeys): void {
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => {
    const mine = keys();
    const stop = watchKeys(mine);
    const onSync = (e: Event) => {
      if ((e as CustomEvent<{ keys: string[] }>).detail.keys.some((k) => k === SETTINGS_DOC || MONTH_DOC.test(k) || SONG_DOC.test(k))) latest.current();
    };
    window.addEventListener(SYNC_EVENT, onSync);
    return () => {
      stop();
      window.removeEventListener(SYNC_EVENT, onSync);
    };
    // keys is read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

// ---------------- Imported songs ----------------

export type ImportError = "too-many" | "too-big" | "storage";

const newSongId = () => {
  const bytes = new Uint8Array(6);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else bytes.forEach((_, i) => (bytes[i] = Math.floor(Math.random() * 256)));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
};

const liveCount = (s: PianoSettings) => Object.values(s.importedSongs).filter((e) => !e.removed).length;

// Saves a new imported song: its doc plus an entry in the settings index (2 queued pushes). `build` gets the new id.
// Returns the song, or why it could not be saved.
export function saveImportedSong(build: (id: string) => { song: Song; split?: number }, now: number): { song: Song } | { error: ImportError } {
  const s = loadSettings();
  if (liveCount(s) >= MAX_IMPORTED) return { error: "too-many" };
  const id = newSongId();
  const { song, split } = build(id);
  const doc = encodeSong(song, split);
  if (JSON.stringify(doc).length > MAX_SONG_DOC_BYTES) return { error: "too-big" };
  try {
    write(songDocKey(id), doc);
    s.importedSongs[id] = { title: song.title, at: now };
    s.updatedAt = now;
    write(SETTINGS_DOC, s);
  } catch {
    try {
      localStorage.removeItem(PREFIX + songDocKey(id));
    } catch {
      // nothing more to undo
    }
    return { error: "storage" };
  }
  markDirty(songDocKey(id));
  markDirty(SETTINGS_DOC);
  return { song };
}

// One imported song from this device's copy (undefined when it is missing, removed or invalid).
export function loadImportedSong(id: string): Song | undefined {
  if (!SONG_ID.test(id) || loadSettings().importedSongs[id]?.removed) return undefined;
  return decodeSong(read<unknown>(songDocKey(id), null), id);
}

// Every imported song this device has, newest first.
export function loadImportedSongs(): Song[] {
  const entries = Object.entries(loadSettings().importedSongs).filter(([, e]) => !e.removed);
  return entries
    .sort((a, b) => b[1].at - a[1].at)
    .flatMap(([id]) => decodeSong(read<unknown>(songDocKey(id), null), id) ?? []);
}

// Deletes an imported song everywhere: a removal marker in the settings and a tombstone in place of its doc.
export function deleteImportedSong(id: string, now: number) {
  const s = loadSettings();
  const e = s.importedSongs[id];
  if (!e || e.removed) return;
  s.importedSongs[id] = { ...e, at: now, removed: true };
  s.updatedAt = now;
  write(SETTINGS_DOC, s);
  write(songDocKey(id), { removed: true });
  markDirty(SETTINGS_DOC);
  markDirty(songDocKey(id));
}

// Fetches the song docs the settings list that this device doesn't have yet, and clears the
// local copy of songs another device removed. One read per missing song, once per device; none when nothing is missing.
export async function pullImportedSongs(): Promise<void> {
  const s = loadSettings();
  const missing: string[] = [];
  for (const [id, e] of Object.entries(s.importedSongs)) {
    if (e.removed) {
      if (read<{ notes?: unknown }>(songDocKey(id), {}).notes) write(songDocKey(id), { removed: true });
    } else if (!decodeSong(read<unknown>(songDocKey(id), null), id)) missing.push(songDocKey(id));
  }
  for (let i = 0; i < missing.length; i += 30) await syncKeys(missing.slice(i, i + 30));
}

// One song doc by id (a link to a song this device hasn't pulled yet).
export const pullSongDoc = (id: string) => (SONG_ID.test(id) ? syncKeys([songDocKey(id)]) : Promise.resolve([]));
