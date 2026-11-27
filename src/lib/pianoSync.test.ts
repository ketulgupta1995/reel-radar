// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DOC_KEY } from "./docStore";
import { MonthDoc, PianoSettings, deleteImportedSong, loadImportedSong, loadImportedSongs, loadSettings, mergeMonth, mergeSettings, mergeSongDoc, openKeys, pullImportedSongs, pullSongDoc, saveDrillSettings, saveImportedSong, saveSession, saveSongProgress, syncPianoHistory, MAX_IMPORTED } from "./pianoData";
import { Song } from "./pianoSongs";
import { encodeSong } from "./pianoSongImport";
import { SessionRecord } from "./pianoDrill";
import { flush } from "./sync";
import { jsonResponse } from "@/test/fixtures";

const drill = (id: string, startedAt = 1000): SessionRecord => ({ id, kind: "drill", drill: "notes", startedAt, durationMs: 1000, updatedAt: startedAt, items: {} });
const manual = (id: string, updatedAt: number, note: string): SessionRecord => ({ id, kind: "manual", startedAt: 1000, durationMs: 60_000, note, updatedAt });
const month = (...rs: SessionRecord[]): MonthDoc => ({ items: Object.fromEntries(rs.map((r) => [r.id, r])) });
const settings = (p: Partial<PianoSettings>): PianoSettings => ({ unlocks: {}, slowSteps: {}, slowAt: {}, months: [], songs: {}, importedSongs: {}, updatedAt: 0, ...p });
const ids = (m: MonthDoc) => Object.keys(m.items).sort();

describe("piano month merge", () => {
  it("unions sessions recorded on two devices before they synced", () => {
    const base = month(drill("a"));
    const phone = month(drill("a"), drill("p"));
    const laptop = month(drill("a"), drill("l"));
    expect(ids(mergeMonth(phone, laptop, base))).toEqual(["a", "l", "p"]);
    expect(ids(mergeMonth(laptop, phone, base))).toEqual(["a", "l", "p"]);
    expect(ids(mergeMonth(phone, laptop))).toEqual(["a", "l", "p"]); // no base: still a union
  });

  it("lets the newest edit of a manual entry win, either way round", () => {
    const old = manual("m", 10, "old");
    const mid = manual("m", 20, "laptop");
    const newest = manual("m", 30, "phone");
    expect(mergeMonth(month(newest), month(mid), month(old)).items.m).toMatchObject({ note: "phone" });
    expect(mergeMonth(month(mid), month(newest), month(old)).items.m).toMatchObject({ note: "phone" });
    expect(mergeMonth(month(mid), month(old), month(old)).items.m).toMatchObject({ note: "laptop" }); // only one side edited
  });

  it("carries a delete through the base, and keeps an entry the other device edited", () => {
    const m = manual("m", 10, "x");
    expect(ids(mergeMonth(month(drill("a")), month(drill("a"), m), month(drill("a"), m)))).toEqual(["a"]);
    expect(ids(mergeMonth(month(drill("a")), month(drill("a"), manual("m", 20, "edited")), month(drill("a"), m)))).toEqual(["a", "m"]);
  });
});

describe("piano settings merge", () => {
  it("takes the highest unlock level per drill", () => {
    const m = mergeSettings(settings({ unlocks: { notes: 3, chords: 1 } }), settings({ unlocks: { notes: 2, chords: 4, fingers: 2 } }));
    expect(m.unlocks).toEqual({ notes: 3, chords: 4, fingers: 2 });
  });

  it("is last-write-wins per drill for slow steps, by when each changed", () => {
    const local = settings({ slowSteps: { notes: 1, chords: 0 }, slowAt: { notes: 50, chords: 10 }, updatedAt: 50 });
    const server = settings({ slowSteps: { notes: 2, chords: 1 }, slowAt: { notes: 40, chords: 20 }, updatedAt: 40 });
    const m = mergeSettings(local, server);
    expect(m.slowSteps).toEqual({ notes: 1, chords: 1 });
    expect(m.slowAt).toEqual({ notes: 50, chords: 20 });
    expect(m.updatedAt).toBe(50);
    expect(mergeSettings(server, local).slowSteps).toEqual({ notes: 1, chords: 1 });
  });

  it("merges song progress per song: step, tempo and best only go up, mastered sticks", () => {
    const a = { step: 2, tempo: 70, best: 80, at: 5 };
    const b = { step: 1, tempo: 90, best: 60, mastered: true, at: 9 };
    const m = mergeSettings(settings({ songs: { mary: a, ode: { step: 1, tempo: 60, best: 0, at: 1 } } }), settings({ songs: { mary: b, twinkle: { step: 3, tempo: 100, best: 95, at: 2 } } }));
    expect(m.songs).toEqual({ mary: { step: 2, tempo: 90, best: 80, mastered: true, at: 9 }, ode: { step: 1, tempo: 60, best: 0, at: 1 }, twinkle: { step: 3, tempo: 100, best: 95, at: 2 } });
    expect(mergeSettings(settings({ songs: { mary: b } }), settings({ songs: { mary: a } })).songs.mary).toEqual(m.songs.mary);
  });

  it("reads settings from before song progress existed", () => {
    const old = { unlocks: { notes: 2 }, slowSteps: {}, months: [], updatedAt: 3 } as unknown as PianoSettings;
    expect(mergeSettings(old, settings({ songs: { mary: { step: 1, tempo: 60, best: 0, at: 1 } } })).songs.mary.step).toBe(1);
    expect(mergeSettings(old, old).songs).toEqual({});
    localStorage.setItem("reel-radar-piano-settings", JSON.stringify(old));
    expect(loadSettings().songs).toEqual({});
  });

  it("unions months, sorted", () => {
    expect(mergeSettings(settings({ months: ["2026-10", "2026-11"] }), settings({ months: ["2026-09", "2026-11"] })).months).toEqual(["2026-09", "2026-10", "2026-11"]);
  });

  it("reads old settings without months or slowAt (and malformed ones) and keeps their values", () => {
    const old = { unlocks: { notes: 2 }, slowSteps: { notes: 1 }, updatedAt: 5 } as unknown as PianoSettings;
    expect(mergeSettings(old, settings({ months: ["2026-11"] }))).toEqual({ unlocks: { notes: 2 }, slowSteps: { notes: 1 }, slowAt: { notes: 5 }, songs: {}, importedSongs: {}, months: ["2026-11"], updatedAt: 5 });
    expect(mergeSettings(settings({ slowSteps: { notes: 0 }, slowAt: { notes: 1 } }), old).slowSteps).toEqual({ notes: 1 }); // old copy counts as changed at its updatedAt
    localStorage.clear();
    localStorage.setItem("reel-radar-piano-settings", JSON.stringify({ unlocks: { notes: 2 }, months: "x" }));
    expect(loadSettings()).toMatchObject({ unlocks: { notes: 2 }, months: [] });
  });
});

describe("piano docs on the sync route", () => {
  it("are allowed by the doc-key allowlist, and nothing near them is", () => {
    for (const k of ["piano-settings", "piano-2026-11", "piano-song-0123456789ab"]) expect(DOC_KEY.test(k)).toBe(true);
    for (const k of ["piano-song-", "piano-song-0123456789a", "piano-song-0123456789abc", "piano-song-0123456789AB", "piano-song-0123456789ag", "piano-song-0123456789ab\n", "piano-song-0123456789ab/..", "piano-songs-0123456789ab", "xpiano-song-0123456789ab"]) expect(DOC_KEY.test(k)).toBe(false);
    for (const k of ["piano", "piano-26-11", "piano-2026-1", "piano-settings2", "xpiano-2026-11", "piano-2026-11/../x", "piano-"]) expect(DOC_KEY.test(k)).toBe(false);
  });
});

describe("piano sync keys and queued pushes", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    localStorage.clear();
    fetchMock = vi.fn(async (_u: string, init?: RequestInit) => (init?.method === "POST" ? jsonResponse({ etag: '"e"' }) : jsonResponse({ docs: {} })));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.useRealTimers());
  const posts = () => fetchMock.mock.calls.filter(([, i]) => i?.method === "POST").map(([, i]) => JSON.parse(i.body).key as string).sort();

  it("opens with settings, this month and last month (across a year end)", () => {
    expect(openKeys(new Date(2026, 0, 15).getTime())).toEqual(["piano-settings", "piano-2026-01", "piano-2025-12"]);
  });

  it("a saved session queues its month and the settings (first of the month only), and only a real settings change queues settings", async () => {
    const t = new Date(2026, 10, 27, 10).getTime();
    saveSession(drill("a", t));
    await flush();
    expect(posts()).toEqual(["piano-2026-11", "piano-settings"]);
    expect(loadSettings().months).toEqual(["2026-11"]);
    fetchMock.mockClear();
    saveSession(drill("b", t + 1));
    await flush();
    expect(posts()).toEqual(["piano-2026-11"]); // no second settings write

    fetchMock.mockClear();
    saveDrillSettings("notes", { unlocked: 1, slowStep: 0 }, 5); // first save for this drill
    saveDrillSettings("notes", { unlocked: 1, slowStep: 0 }, 6); // nothing changed
    await flush();
    expect(posts()).toEqual(["piano-settings"]);
    expect(loadSettings().updatedAt).toBe(5);
    fetchMock.mockClear();
    saveDrillSettings("notes", { unlocked: 2, slowStep: 0 }, 7);
    await flush();
    expect(posts()).toEqual(["piano-settings"]);
    expect(loadSettings()).toMatchObject({ unlocks: { notes: 2 }, slowAt: { notes: 5 } });
  });

  it("song progress queues the settings only when it changes, and never lowers what is stored", async () => {
    saveSongProgress("mary", { step: 1, tempo: 65, best: 90, at: 5 }, 5);
    await flush();
    expect(posts()).toEqual(["piano-settings"]);
    fetchMock.mockClear();
    saveSongProgress("mary", { step: 1, tempo: 65, best: 90, at: 6 }, 6); // same values
    await flush();
    expect(posts()).toEqual([]);
    expect(loadSettings().updatedAt).toBe(5);
    saveSongProgress("mary", { step: 0, tempo: 60, best: 95, at: 7 }, 7); // a stale copy with one better score
    await flush();
    expect(posts()).toEqual(["piano-settings"]);
    expect(loadSettings().songs.mary).toEqual({ step: 1, tempo: 65, best: 95, at: 7 });
  });

  it("the history pull fetches every month the settings list, including ones the first pull revealed", async () => {
    localStorage.setItem("reel-radar-piano-settings", JSON.stringify(settings({ months: ["2026-03", "2026-11"] })));
    fetchMock.mockImplementation(async (u: string) => {
      const keys = decodeURIComponent(new URL(u, "http://x").searchParams.get("keys") ?? "");
      const docs: Record<string, unknown> = {};
      for (const k of keys.split(",")) {
        const key = k.split(":")[0];
        if (key === "piano-settings") docs[key] = { etag: '"s"', data: settings({ months: ["2026-01"] }) };
        else docs[key] = null;
      }
      return jsonResponse({ docs });
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 27, 10));
    await syncPianoHistory();
    const asked = fetchMock.mock.calls.filter(([u]) => String(u).startsWith("/api/sync?")).flatMap(([u]) => decodeURIComponent(String(u).split("keys=")[1]).split(","));
    expect(asked).toEqual(expect.arrayContaining(["piano-2026-03", "piano-2026-01", "piano-2026-11", "piano-2026-10", "piano-settings"]));
    expect(loadSettings().months).toEqual(["2026-01", "2026-03", "2026-11"]);
  });
});

const song = (id: string, title = "Tune", notes = 1): Song => ({
  id,
  title,
  bpm: 100,
  beatsPerBar: 4,
  level: 0,
  imported: true,
  notes: Array.from({ length: notes }, (_, i) => ({ start: i, dur: 1, pitch: 60, hand: "R" as const, finger: 3, suggested: true })),
});
const A = "aaaaaaaaaaaa";
const B = "bbbbbbbbbbbb";

describe("imported song index merge", () => {
  it("is a union of both devices' songs, either way round", () => {
    const l = settings({ importedSongs: { [A]: { title: "A", at: 1 } } });
    const s = settings({ importedSongs: { [B]: { title: "B", at: 2 } } });
    expect(Object.keys(mergeSettings(l, s).importedSongs).sort()).toEqual([A, B]);
    expect(Object.keys(mergeSettings(s, l).importedSongs).sort()).toEqual([A, B]);
  });
  it("makes a removal final, whichever copy is newer", () => {
    const live = settings({ importedSongs: { [A]: { title: "A", at: 9 } } });
    const gone = settings({ importedSongs: { [A]: { title: "A", at: 2, removed: true } } });
    expect(mergeSettings(live, gone).importedSongs[A]).toEqual({ title: "A", at: 9, removed: true });
    expect(mergeSettings(gone, live).importedSongs[A]).toEqual({ title: "A", at: 9, removed: true });
    expect(mergeSettings(gone, gone).importedSongs[A].removed).toBe(true);
  });
  it("takes the newer title, treats an older copy without the field as empty, and drops malformed entries", () => {
    const l = settings({ importedSongs: { [A]: { title: "old", at: 1 } } });
    const s = settings({ importedSongs: { [A]: { title: "new", at: 5 } } });
    expect(mergeSettings(l, s).importedSongs[A].title).toBe("new");
    expect(mergeSettings(s, l).importedSongs[A].title).toBe("new");
    const old = { unlocks: {}, slowSteps: {}, slowAt: {}, months: [], songs: {}, updatedAt: 1 } as unknown as PianoSettings;
    expect(mergeSettings(old, old).importedSongs).toEqual({});
    const evil = settings({ importedSongs: { "../x": { title: "x", at: 1 }, [B]: null as never, cccccccccccc: { title: 5 as never, at: "no" as never } } });
    expect(mergeSettings(evil, evil).importedSongs).toEqual({ cccccccccccc: { title: "Imported song", at: 0 } });
    localStorage.setItem("reel-radar-piano-settings", JSON.stringify({ importedSongs: "x" }));
    expect(loadSettings().importedSongs).toEqual({});
  });
});

describe("imported song docs", () => {
  it("merge: a tombstone wins, otherwise the copy that has the notes", () => {
    const doc = encodeSong(song(A));
    expect(mergeSongDoc(doc, { removed: true })).toEqual({ removed: true });
    expect(mergeSongDoc({ removed: true }, doc)).toEqual({ removed: true });
    expect(mergeSongDoc(doc, {})).toBe(doc);
    expect(mergeSongDoc({}, doc)).toBe(doc);
    expect(mergeSongDoc({}, {})).toEqual({});
  });
});

describe("saving, loading, deleting and pulling imported songs", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let server: Record<string, unknown>;
  beforeEach(() => {
    localStorage.clear();
    server = {};
    fetchMock = vi.fn(async (u: string, init?: RequestInit) => {
      if (init?.method === "POST") return jsonResponse({ etag: '"e"' });
      const keys = decodeURIComponent(new URL(u, "http://x").searchParams.get("keys") ?? "").split(",").map((k) => k.split(":")[0]);
      return jsonResponse({ docs: Object.fromEntries(keys.map((k) => [k, k in server ? { etag: '"s"', data: server[k] } : null])) });
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  const posts = () => fetchMock.mock.calls.filter(([, i]) => i?.method === "POST").map(([, i]) => JSON.parse(i.body).key as string).sort();
  const gets = () => fetchMock.mock.calls.filter(([, i]) => !i?.method);

  it("saves a song as its own doc plus an index entry, with a random id, and queues exactly those two pushes", async () => {
    const out = saveImportedSong((id) => ({ song: song(id, "My tune", 3), split: 60 }), 100);
    if (!("song" in out)) throw new Error("not saved");
    expect(out.song.id).toMatch(/^[0-9a-f]{12}$/);
    expect(loadImportedSong(out.song.id)).toEqual(out.song);
    expect(loadSettings().importedSongs[out.song.id]).toEqual({ title: "My tune", at: 100 });
    expect(JSON.parse(localStorage.getItem(`reel-radar-piano-song-${out.song.id}`)!).split).toBe(60);
    await flush();
    expect(posts()).toEqual([`piano-song-${out.song.id}`, "piano-settings"].sort());
    const other = saveImportedSong((id) => ({ song: song(id) }), 200);
    expect("song" in other && other.song.id !== out.song.id).toBe(true);
    expect(loadImportedSongs().map((s) => s.title)).toEqual(["Tune", "My tune"]); // newest first
  });

  it("refuses a song whose doc is over the size cap, too many songs, and a full storage, saving nothing", () => {
    expect(saveImportedSong((id) => ({ song: song(id, "Big", 20000) }), 1)).toEqual({ error: "too-big" });
    expect(loadSettings().importedSongs).toEqual({});
    const entries = Object.fromEntries(Array.from({ length: MAX_IMPORTED }, (_, i) => [i.toString(16).padStart(12, "0"), { title: "x", at: 1 }]));
    localStorage.setItem("reel-radar-piano-settings", JSON.stringify(settings({ importedSongs: entries })));
    expect(saveImportedSong((id) => ({ song: song(id) }), 1)).toEqual({ error: "too-many" });
    const first = Object.keys(entries)[0];
    localStorage.setItem("reel-radar-piano-settings", JSON.stringify(settings({ importedSongs: { ...entries, [first]: { title: "x", at: 1, removed: true } } })));
    expect("song" in saveImportedSong((id) => ({ song: song(id) }), 1)).toBe(true); // a removed song doesn't count
    localStorage.setItem("reel-radar-piano-settings", JSON.stringify(settings({})));
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(saveImportedSong((id) => ({ song: song(id) }), 1)).toEqual({ error: "storage" });
    spy.mockRestore();
  });

  it("deleting marks it removed, empties the doc into a tombstone, queues both, and hides it", async () => {
    const out = saveImportedSong((id) => ({ song: song(id) }), 1) as { song: Song };
    await flush();
    fetchMock.mockClear();
    deleteImportedSong(out.song.id, 50);
    expect(loadSettings().importedSongs[out.song.id]).toEqual({ title: "Tune", at: 50, removed: true });
    expect(JSON.parse(localStorage.getItem(`reel-radar-piano-song-${out.song.id}`)!)).toEqual({ removed: true });
    expect(loadImportedSong(out.song.id)).toBeUndefined();
    expect(loadImportedSongs()).toEqual([]);
    await flush();
    expect(posts()).toEqual([`piano-song-${out.song.id}`, "piano-settings"].sort());
    fetchMock.mockClear();
    deleteImportedSong(out.song.id, 60); // already removed: nothing more
    deleteImportedSong(B, 60); // unknown
    await flush();
    expect(posts()).toEqual([]);
  });

  it("pulls the docs another device's index lists, once, and not removed ones", async () => {
    server[`piano-song-${A}`] = encodeSong(song(A, "From laptop", 2));
    localStorage.setItem("reel-radar-piano-settings", JSON.stringify(settings({ importedSongs: { [A]: { title: "From laptop", at: 1 }, [B]: { title: "Gone", at: 1, removed: true } } })));
    await pullImportedSongs();
    expect(gets().map(([u]) => decodeURIComponent(String(u)))).toEqual([`/api/sync?keys=piano-song-${A}`]);
    expect(loadImportedSong(A)?.title).toBe("From laptop");
    fetchMock.mockClear();
    await pullImportedSongs(); // everything is here now: no request
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clears the local copy of a song another device removed, and a tombstone from the server wins over a local song", async () => {
    const out = saveImportedSong((id) => ({ song: song(id) }), 1) as { song: Song };
    const key = `piano-song-${out.song.id}`;
    await flush();
    localStorage.setItem("reel-radar-piano-settings", JSON.stringify(settings({ importedSongs: { [out.song.id]: { title: "Tune", at: 9, removed: true } } })));
    await pullImportedSongs();
    expect(JSON.parse(localStorage.getItem(`reel-radar-${key}`)!)).toEqual({ removed: true });
    // a device that still has the song learns of the removal from the doc itself
    const other = saveImportedSong((id) => ({ song: song(id) }), 2) as { song: Song };
    server[`piano-song-${other.song.id}`] = { removed: true };
    await pullSongDoc(other.song.id);
    await flush();
    expect(JSON.parse(localStorage.getItem(`reel-radar-piano-song-${other.song.id}`)!)).toEqual({ removed: true });
  });

  it("pulls one song by id, and ignores an id that isn't one", async () => {
    server[`piano-song-${A}`] = encodeSong(song(A, "Linked"));
    await pullSongDoc(A);
    expect(loadImportedSong(A)?.title).toBe("Linked"); // opens even before the settings index arrives
    expect(loadImportedSongs()).toEqual([]); // but the list only shows what the index names
    fetchMock.mockClear();
    await pullSongDoc("../etc");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(loadImportedSong("../etc")).toBeUndefined();
  });

  it("ignores a synced doc that isn't a valid song", async () => {
    server[`piano-song-${A}`] = { v: 1, id: A, title: "x", bpm: 100, beatsPerBar: 4, notes: [[0, 1, 999, 1, 1]] };
    localStorage.setItem("reel-radar-piano-settings", JSON.stringify(settings({ importedSongs: { [A]: { title: "x", at: 1 } } })));
    await pullImportedSongs();
    expect(loadImportedSong(A)).toBeUndefined();
    expect(loadImportedSongs()).toEqual([]);
  });
});
