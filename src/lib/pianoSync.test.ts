// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DOC_KEY } from "./docStore";
import { MonthDoc, PianoSettings, loadSettings, mergeMonth, mergeSettings, openKeys, saveDrillSettings, saveSession, syncPianoHistory } from "./pianoData";
import { SessionRecord } from "./pianoDrill";
import { flush } from "./sync";
import { jsonResponse } from "@/test/fixtures";

const drill = (id: string, startedAt = 1000): SessionRecord => ({ id, kind: "drill", drill: "notes", startedAt, durationMs: 1000, updatedAt: startedAt, items: {} });
const manual = (id: string, updatedAt: number, note: string): SessionRecord => ({ id, kind: "manual", startedAt: 1000, durationMs: 60_000, note, updatedAt });
const month = (...rs: SessionRecord[]): MonthDoc => ({ items: Object.fromEntries(rs.map((r) => [r.id, r])) });
const settings = (p: Partial<PianoSettings>): PianoSettings => ({ unlocks: {}, slowSteps: {}, slowAt: {}, months: [], updatedAt: 0, ...p });
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

  it("unions months, sorted", () => {
    expect(mergeSettings(settings({ months: ["2026-10", "2026-11"] }), settings({ months: ["2026-09", "2026-11"] })).months).toEqual(["2026-09", "2026-10", "2026-11"]);
  });

  it("reads old settings without months or slowAt (and malformed ones) and keeps their values", () => {
    const old = { unlocks: { notes: 2 }, slowSteps: { notes: 1 }, updatedAt: 5 } as unknown as PianoSettings;
    expect(mergeSettings(old, settings({ months: ["2026-11"] }))).toEqual({ unlocks: { notes: 2 }, slowSteps: { notes: 1 }, slowAt: { notes: 5 }, months: ["2026-11"], updatedAt: 5 });
    expect(mergeSettings(settings({ slowSteps: { notes: 0 }, slowAt: { notes: 1 } }), old).slowSteps).toEqual({ notes: 1 }); // old copy counts as changed at its updatedAt
    localStorage.clear();
    localStorage.setItem("reel-radar-piano-settings", JSON.stringify({ unlocks: { notes: 2 }, months: "x" }));
    expect(loadSettings()).toMatchObject({ unlocks: { notes: 2 }, months: [] });
  });
});

describe("piano docs on the sync route", () => {
  it("are allowed by the doc-key allowlist, and nothing near them is", () => {
    for (const k of ["piano-settings", "piano-2026-11"]) expect(DOC_KEY.test(k)).toBe(true);
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
