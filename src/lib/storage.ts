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

  // Asynchronous background sync with status logging
  fetch("/api/storage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(s),
  })
    .then((res) => {
      const backend = res.headers.get("x-storage-backend");
      if (backend === "local-file") {
        console.warn(
          "%c[Storage Save] ⚠️ Vercel Blob is not configured. Saved to local file (data/storage.json).",
          "color: #eab308; font-weight: bold;"
        );
      } else if (backend === "local-file-fallback") {
        console.error(
          "%c[Storage Save] ❌ Vercel Blob write failed! Saved to local file (data/storage.json) as fallback.",
          "color: #ef4444; font-weight: bold;"
        );
      }
    })
    .catch((err) => {
      console.error(
        "%c[Storage Save] ❌ Could not contact /api/storage. Saved only to browser localStorage.",
        "color: #ef4444; font-weight: bold;",
        err
      );
    });
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

export async function syncWithServer(): Promise<State> {
  const local = load();
  try {
    const res = await fetch("/api/storage");
    const backend = res.headers.get("x-storage-backend");

    if (backend === "vercel-blob") {
      console.log(
        "%c[Storage Sync] ☁️ Vercel Blob storage is ACTIVE and working.",
        "color: #10b981; font-weight: bold;"
      );
    } else if (backend === "local-file-fallback") {
      console.error(
        "%c[Storage Sync] ❌ Vercel Blob failed. Falling back to local storage (data/storage.json).",
        "color: #ef4444; font-weight: bold;"
      );
    } else {
      console.warn(
        "%c[Storage Sync] ⚠️ Vercel Blob is NOT working/configured (BLOB_READ_WRITE_TOKEN is missing). Using local storage (data/storage.json & browser localStorage).",
        "color: #eab308; font-weight: bold;"
      );
    }

    if (!res.ok) return local;

    const serverState: State = await res.json();
    const serverHasData =
      (serverState.watched && serverState.watched.length > 0) ||
      (serverState.watchlist && serverState.watchlist.length > 0);

    const localHasData =
      (local.watched && local.watched.length > 0) ||
      (local.watchlist && local.watchlist.length > 0);

    if (localHasData && !serverHasData) {
      save(local);
      return local;
    }

    const merged = mergeStates(local, serverState);
    save(merged);
    return merged;
  } catch (err) {
    console.error(
      "%c[Storage Sync] ❌ Server storage unreachable. Using browser localStorage only.",
      "color: #ef4444; font-weight: bold;",
      err
    );
    return local;
  }
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