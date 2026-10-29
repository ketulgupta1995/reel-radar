import { same } from "@/lib/syncDocs";

// Client side of /api/sync, shared by Reel Radar (lib/storage.ts) and the planner (lib/todos.ts).
//
// Each synced doc keeps, in localStorage: its server etag, a dirty flag, when it was last synced,
// and `base`, the last copy this device and the server agreed on. Base makes merges three-way,
// so a delete on one device isn't undone by another device's older copy.
//
// Writes are batched: a change marks its doc dirty and pushes after the doc's idle delay, or when
// the tab is hidden. Reads are conditional (unchanged docs cost no transfer) and throttled, and
// the docs that open pages show are re-synced when the tab comes back into view.

export type DocAdapter<T = unknown> = {
  read(): T; // the local copy
  write(doc: T): void; // replace the local copy; must not mark it dirty
  merge(local: T, server: T, base: T | undefined): T;
  empty(): T;
  flushDelay: number | null; // ms idle before pushing; null = only alongside other pushes or on hide
};

type Meta = { etag?: string; dirty?: boolean; syncedAt?: number };

const META_PREFIX = "reel-radar-sync:";
const BASE_PREFIX = "reel-radar-sync-base:";
export const SYNC_EVENT = "reel-radar-sync";
export const RESYNC_AFTER = 2 * 60 * 1000;

const resolvers: ((key: string) => DocAdapter | undefined)[] = [];
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const versions = new Map<string, number>(); // bumped on every local change, to spot edits made mid-push
const inFlight = new Map<string, Promise<void>>();
const active = new Map<string, number>(); // keys on screen right now, with a count of who watches them

export function registerDocs(resolve: (key: string) => DocAdapter<any> | undefined): void {
  resolvers.push(resolve);
}

function adapterFor(key: string): DocAdapter | undefined {
  for (const resolve of resolvers) {
    const adapter = resolve(key);
    if (adapter) return adapter;
  }
  return undefined;
}

function readJson<T>(storageKey: string): T | undefined {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

const getMeta = (key: string): Meta => readJson<Meta>(META_PREFIX + key) ?? {};
const setMeta = (key: string, meta: Meta) => localStorage.setItem(META_PREFIX + key, JSON.stringify(meta));
const getBase = (key: string) => readJson<unknown>(BASE_PREFIX + key);
const setBase = (key: string, doc: unknown) => localStorage.setItem(BASE_PREFIX + key, JSON.stringify(doc));

function setDirty(key: string): void {
  versions.set(key, (versions.get(key) ?? 0) + 1);
  const meta = getMeta(key);
  if (!meta.dirty) setMeta(key, { ...meta, dirty: true });
}

// Record a local change to `key` and schedule a push.
export function markDirty(key: string): void {
  if (typeof window === "undefined") return;
  setDirty(key);
  const delay = adapterFor(key)?.flushDelay;
  if (delay === null || delay === undefined) return;
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => void flush(), delay));
}

function dirtyKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(META_PREFIX)) keys.push(k.slice(META_PREFIX.length));
  }
  return keys.filter((k) => getMeta(k).dirty && adapterFor(k));
}

// Push every dirty doc (or just `keys`) to the server.
export async function flush(keys?: string[]): Promise<void> {
  if (typeof window === "undefined") return;
  await Promise.all((keys ?? dirtyKeys()).filter((k) => getMeta(k).dirty).map(push));
}

function push(key: string): Promise<void> {
  const running = inFlight.get(key);
  if (running) return running.then(() => (getMeta(key).dirty ? push(key) : undefined));
  const p = pushNow(key).finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

async function pushNow(key: string, retry = true): Promise<void> {
  const adapter = adapterFor(key);
  if (!adapter) return;
  clearTimeout(timers.get(key));
  const version = versions.get(key) ?? 0;
  const data = adapter.read();
  const body = JSON.stringify({ key, data, baseEtag: getMeta(key).etag });
  let res: Response;
  try {
    // keepalive lets a small push finish while the tab closes; browsers cap it at 64 KB.
    res = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: body.length < 60000,
    });
  } catch (err) {
    console.error(`[Sync] Could not reach /api/sync; ${key} stays saved in this browser.`, err);
    return; // still dirty: the next flush or sync retries
  }

  if (res.ok) {
    const { etag } = await res.json();
    setBase(key, data);
    // An edit made while the request was out keeps the doc dirty; its own timer pushes it.
    setMeta(key, { ...getMeta(key), etag, dirty: (versions.get(key) ?? 0) !== version, syncedAt: Date.now() });
    return;
  }

  if (res.status === 409 && retry) {
    const server: { etag: string | null; data: unknown } = await res.json();
    if (server.data === null) {
      // The doc is gone from the server: push ours as new, and don't read that as "all deleted".
      localStorage.removeItem(BASE_PREFIX + key);
      setMeta(key, { ...getMeta(key), etag: undefined });
    } else {
      const merged = adapter.merge(adapter.read(), server.data, getBase(key));
      adapter.write(merged);
      setBase(key, server.data);
      setMeta(key, { ...getMeta(key), etag: server.etag ?? undefined });
      notify([key]);
    }
    return pushNow(key, false);
  }
  console.error(`[Sync] Saving ${key} failed (${res.status}); it stays saved in this browser.`);
}

function notify(keys: string[]): void {
  if (keys.length) window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: { keys } }));
}

// Pull `keys` from the server and merge them in, then push whatever the server lacks.
// Keys synced in the last couple of minutes are skipped unless `force` or dirty.
// Returns the keys whose local copy changed, or null when the server couldn't be reached.
export async function syncKeys(keys: string[], { force = false } = {}): Promise<string[] | null> {
  if (typeof window === "undefined") return [];
  const now = Date.now();
  const due = keys.filter((k) => {
    const meta = getMeta(k);
    return adapterFor(k) && (force || meta.dirty || now - (meta.syncedAt ?? 0) >= RESYNC_AFTER);
  });
  if (!due.length) return [];

  const param = due.map((k) => {
    const etag = getMeta(k).etag;
    return etag ? `${k}:${etag}` : k;
  });
  let docs: Record<string, { etag: string; data?: unknown; unchanged?: true } | null>;
  try {
    const res = await fetch(`/api/sync?keys=${encodeURIComponent(param.join(","))}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    docs = (await res.json()).docs ?? {};
  } catch (err) {
    console.error("[Sync] Server storage unreachable. Using this browser's copy.", err);
    return null;
  }

  const changed: string[] = [];
  for (const key of due) {
    const adapter = adapterFor(key)!;
    const result = docs[key];
    if (result === undefined) continue;
    if (result === null) {
      // Not on the server yet: push this device's copy, if it has anything.
      localStorage.removeItem(BASE_PREFIX + key);
      setMeta(key, { ...getMeta(key), etag: undefined, syncedAt: now });
      if (!same(adapter.read(), adapter.empty())) setDirty(key);
      continue;
    }
    if (result.unchanged) {
      setMeta(key, { ...getMeta(key), syncedAt: now });
      continue;
    }
    const local = adapter.read();
    const merged = adapter.merge(local, result.data, getBase(key));
    if (!same(merged, local)) {
      adapter.write(merged);
      changed.push(key);
    }
    setBase(key, result.data);
    setMeta(key, { ...getMeta(key), etag: result.etag, syncedAt: now });
    if (same(merged, result.data)) setMeta(key, { ...getMeta(key), dirty: false });
    else setDirty(key);
  }

  notify(changed);
  await flush(due);
  return changed;
}

// Keep `keys` fresh while a page shows them: they are re-synced when the tab comes back into view.
// Returns the function that stops watching.
export function watchKeys(keys: string[]): () => void {
  keys.forEach((k) => active.set(k, (active.get(k) ?? 0) + 1));
  return () =>
    keys.forEach((k) => {
      const n = (active.get(k) ?? 1) - 1;
      if (n > 0) active.set(k, n);
      else active.delete(k);
    });
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush();
    else if (active.size) void syncKeys([...active.keys()]);
  });
}
