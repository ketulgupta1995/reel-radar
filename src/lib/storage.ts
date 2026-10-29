import { useEffect } from "react";
import {
  HistoryDoc,
  LibraryDoc,
  State,
  empty,
  historyOf,
  libraryOf,
  mergeHistory,
  mergeLibrary,
  same,
  toStored,
} from "@/lib/syncDocs";
import { SYNC_EVENT, flush, markDirty, registerDocs, syncKeys, watchKeys } from "@/lib/sync";

export type { State };
export { empty };

const K = "reel-radar-v1";
const DOCS = ["library", "history"];

// Two-way merge for imports: nothing in either copy counts as deleted.
export function mergeStates(base: State, incoming: Partial<State>): State {
  return {
    ...mergeLibrary(libraryOf(base), libraryOf(incoming)),
    ...mergeHistory(historyOf(base), historyOf(incoming)),
  };
}

export const load = (): State => {
  if (typeof window === "undefined") return empty();
  try {
    const raw = localStorage.getItem(K);
    if (!raw) return empty();
    const value = JSON.parse(raw);
    return value ? { ...empty(), ...value } : empty();
  } catch {
    return empty();
  }
};

const writeLocal = (s: State) => localStorage.setItem(K, JSON.stringify(s));
const slim = (s: State): State => ({ ...s, watched: s.watched.map(toStored), watchlist: s.watchlist.map(toStored) });

registerDocs((key) => {
  if (key === "library")
    return {
      // Slimmed here too, for titles saved before toStored existed.
      read: () => libraryOf(slim(load())),
      write: (doc: LibraryDoc) => writeLocal({ ...load(), ...doc }),
      merge: mergeLibrary,
      empty: () => libraryOf(empty()),
      flushDelay: 5000,
    };
  if (key === "history")
    // Discover marks titles as displayed on every visit; those ride along with the next push.
    return {
      read: () => historyOf(load()),
      write: (doc: HistoryDoc) => writeLocal({ ...load(), ...doc }),
      merge: mergeHistory,
      empty: () => historyOf(empty()),
      flushDelay: null,
    };
});

// Save locally, then let the sync engine push whichever doc changed, a few seconds later.
export const save = (s: State) => {
  if (typeof window === "undefined") return;
  const prev = slim(load());
  const next = slim({ ...empty(), ...s });
  writeLocal(next);
  if (!same(libraryOf(prev), libraryOf(next))) markDirty("library");
  if (!same(historyOf(prev), historyOf(next))) markDirty("history");
};

// Clear everything, on every device: the sync merge reads the now-empty copy as deletions.
export const reset = (): Promise<void> => {
  if (typeof window === "undefined") return Promise.resolve();
  localStorage.removeItem(K);
  DOCS.forEach(markDirty);
  return flush(DOCS);
};

export const clearDiscoveryHistory = (): State => {
  const current = load();
  const newState: State = {
    ...current,
    displayed: [],
    shown: [],
    // dismissed is intentionally kept intact
  };
  save(newState);
  return newState;
};

// Merge in the server copy. Cheap to call on every page: it only hits the network when the last
// sync was a couple of minutes ago, and an unchanged copy transfers nothing.
export async function syncWithServer(): Promise<State> {
  await syncKeys(DOCS);
  return load();
}

// For pages showing Reel Radar data: sync on mount, and take in changes made on another device
// when this tab comes back into view.
export function useStorageSync(onState: (s: State) => void): void {
  useEffect(() => {
    const stop = watchKeys(DOCS);
    const onSync = (e: Event) => {
      if ((e as CustomEvent<{ keys: string[] }>).detail.keys.some((k) => DOCS.includes(k))) onState(load());
    };
    window.addEventListener(SYNC_EVENT, onSync);
    syncWithServer().then(onState);
    return () => {
      stop();
      window.removeEventListener(SYNC_EVENT, onSync);
    };
    // onState is a state setter; run once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export const exportData = () => {
  const state = load();
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const dateStr = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `reel-radar-backup-${dateStr}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

export const importData = (
  file: File,
  onSuccess: (mergedState: State) => void,
  onError?: (msg: string) => void
) => {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const content = e.target?.result as string;
      const parsed = JSON.parse(content);
      if (!parsed || typeof parsed !== "object") {
        throw new Error("Invalid backup format");
      }
      const current = load();
      const merged = mergeStates(current, parsed);
      save(merged);
      onSuccess(merged);
    } catch {
      if (onError) {
        onError("Invalid JSON backup file.");
      } else {
        alert("Could not import file: Invalid JSON format.");
      }
    }
  };
  reader.readAsText(file);
};
