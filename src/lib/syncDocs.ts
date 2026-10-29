import { Title, keyOf } from "@/types/title";

// Shared by the browser (lib/storage.ts), the sync route and scripts/upload-storage.ts.

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

// Reel Radar state is synced as two docs: what the user chose, and what the app already showed
// them. History changes on every Discover visit, so keeping it apart keeps those writes small.
export type LibraryDoc = { watched: Title[]; watchlist: Title[]; dismissed: string[] };
export type HistoryDoc = { displayed: string[]; shown: string[] };

export const libraryOf = (s: Partial<State>): LibraryDoc => ({
  watched: s.watched || [],
  watchlist: s.watchlist || [],
  dismissed: s.dismissed || [],
});

export const historyOf = (s: Partial<State>): HistoryDoc => ({
  displayed: s.displayed || [],
  shown: s.shown || [],
});

// Fields worth keeping on a saved title. Keywords and the trailer are only read from fresh
// /api/title or detail() responses, and `why` belongs to one recommendations run.
export function toStored(t: Title): Title {
  const { keywords: _k, trailerYoutubeId: _t, why: _w, ...rest } = t;
  return rest;
}

export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// Three-way merge of two keyed lists. `base` is the last copy both sides agreed on: an item
// missing on one side but unchanged from base was deleted there, so it goes. Without a base
// (first sync, or a backup import) nothing is treated as deleted. An item changed on both sides
// goes through `both`. Order: local items first, then ones only the server has.
export function merge3<T>(
  local: T[],
  server: T[],
  base: T[] | undefined,
  key: (x: T) => string,
  both: (local: T, server: T) => T
): T[] {
  const l = new Map(local.map((x) => [key(x), x]));
  const s = new Map(server.map((x) => [key(x), x]));
  const b = base ? new Map(base.map((x) => [key(x), x])) : undefined;
  const out: T[] = [];
  for (const k of new Set([...l.keys(), ...s.keys()])) {
    const lv = l.get(k);
    const sv = s.get(k);
    const bv = b?.get(k);
    if (lv !== undefined && sv !== undefined) {
      if (same(lv, sv) || (bv !== undefined && same(sv, bv))) out.push(lv);
      else if (bv !== undefined && same(lv, bv)) out.push(sv);
      else out.push(both(lv, sv));
    } else {
      const only = (lv ?? sv) as T;
      if (bv === undefined || !same(only, bv)) out.push(only);
    }
  }
  return out;
}

const id = (k: string) => k;

// The server copy wins field by field, but watched seasons from both sides are kept.
const mergeTitle = (l: Title, s: Title): Title => ({
  ...l,
  ...s,
  watchedSeasons: Array.from(new Set([...(l.watchedSeasons || []), ...(s.watchedSeasons || [])])).sort(
    (a, b) => a - b
  ),
});

export const mergeLibrary = (local: LibraryDoc, server: LibraryDoc, base?: LibraryDoc): LibraryDoc => ({
  watched: merge3(local.watched || [], server.watched || [], base?.watched, keyOf, mergeTitle),
  watchlist: merge3(local.watchlist || [], server.watchlist || [], base?.watchlist, keyOf, (_l, s) => s),
  dismissed: merge3(local.dismissed || [], server.dismissed || [], base?.dismissed, id, id),
});

export const mergeHistory = (local: HistoryDoc, server: HistoryDoc, base?: HistoryDoc): HistoryDoc => ({
  displayed: merge3(local.displayed || [], server.displayed || [], base?.displayed, id, id),
  shown: merge3(local.shown || [], server.shown || [], base?.shown, id, id),
});
