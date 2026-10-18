import { Title, keyOf } from "@/types/title";

const K = "reel-radar-v1";

export type State = {
  watched: Title[];
  displayed: string[];
  shown: string[];
  watchlist: Title[];
  dismissed: string[];
};

export const empty = (): State => ({
  watched: [],
  displayed: [],
  shown: [],
  watchlist: [],
  dismissed: [],
});

/**
 * Combines two states without deleting titles or progress.
 */
export function mergeStates(base: State, incoming: Partial<State>): State {
  const watchedMap = new Map<string, Title>();
  (base.watched || []).forEach((t) => watchedMap.set(keyOf(t), t));

  (incoming.watched || []).forEach((t) => {
    const k = keyOf(t);
    const existing = watchedMap.get(k);
    if (!existing) {
      watchedMap.set(k, t);
    } else {
      const combinedSeasons = Array.from(
        new Set([...(existing.watchedSeasons || []), ...(t.watchedSeasons || [])])
      ).sort((a, b) => a - b);
      watchedMap.set(k, { ...existing, ...t, watchedSeasons: combinedSeasons });
    }
  });

  const watchlistMap = new Map<string, Title>();
  (base.watchlist || []).forEach((t) => watchlistMap.set(keyOf(t), t));
  (incoming.watchlist || []).forEach((t) => watchlistMap.set(keyOf(t), t));

  return {
    watched: Array.from(watchedMap.values()),
    watchlist: Array.from(watchlistMap.values()),
    dismissed: Array.from(new Set([...(base.dismissed || []), ...(incoming.dismissed || [])])),
    shown: Array.from(new Set([...(base.shown || []), ...(incoming.shown || [])])),
    displayed: Array.from(new Set([...(base.displayed || []), ...(incoming.displayed || [])])),
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

export const save = (s: State) => {
  if (typeof window === "undefined") return;
  localStorage.setItem(K, JSON.stringify(s));

  // Asynchronous background sync to file storage
  fetch("/api/storage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(s),
  }).catch(() => {});
};

export const reset = () => {
  if (typeof window === "undefined") return;
  localStorage.removeItem(K);
  fetch("/api/storage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(empty()),
  }).catch(() => {});
};

/**
 * Syncs localStorage with the server JSON file on startup.
 * Guarantees existing browser history is never wiped.
 */
export async function syncWithServer(): Promise<State> {
  const local = load();
  try {
    const res = await fetch("/api/storage");
    if (!res.ok) return local;

    const serverState: State = await res.json();
    const serverHasData =
      (serverState.watched && serverState.watched.length > 0) ||
      (serverState.watchlist && serverState.watchlist.length > 0);

    const localHasData =
      (local.watched && local.watched.length > 0) ||
      (local.watchlist && local.watchlist.length > 0);

    // If local has data and server is empty, push local data to the server file
    if (localHasData && !serverHasData) {
      save(local);
      return local;
    }

    // Merge both states to preserve all titles across devices
    const merged = mergeStates(local, serverState);
    save(merged);
    return merged;
  } catch {
    return local;
  }
}

/**
 * Downloads a JSON backup file to the user's computer.
 */
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

/**
 * Reads an uploaded JSON file and merges it safely into state.
 */
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