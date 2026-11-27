// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { ManualRecord, SessionRecord } from "./pianoDrill";
import { drillSettings, loadMonth, loadSettings, monthDocKey, deleteSession, newSessionId, recentRecords, recentSessions, saveManual, saveDrillSettings, saveSession } from "./pianoData";

const DAY = 86_400_000;
const rec = (id: string, startedAt: number, kind: "drill" | "manual" = "drill"): SessionRecord =>
  ({ id, kind, drill: "notes", startedAt, durationMs: 1000, updatedAt: startedAt, items: { C: { attempts: 1, misses: 0, slow: 0, avgMs: 500 } } }) as SessionRecord;

beforeEach(() => localStorage.clear());

describe("piano data", () => {
  it("keys a month doc by the local month", () => {
    expect(monthDocKey(new Date(2026, 10, 30, 23, 59).getTime())).toBe("piano-2026-11");
    expect(monthDocKey(new Date(2026, 11, 1, 0, 1).getTime())).toBe("piano-2026-12");
  });

  it("stores sessions by id in the month doc under the app's key prefix", () => {
    const t = new Date(2026, 10, 27, 10).getTime();
    saveSession(rec("a", t));
    saveSession(rec("b", t + 1));
    saveSession(rec("a", t));
    expect(Object.keys(JSON.parse(localStorage.getItem("reel-radar-piano-2026-11")!).items)).toEqual(["a", "b"]);
    expect(loadMonth("piano-2026-11").items.b.startedAt).toBe(t + 1);
    expect(loadMonth("piano-2026-10")).toEqual({ items: {} });
  });

  it("reads the last ~3 months, across month docs, and only drill sessions", () => {
    const now = new Date(2026, 10, 27, 12).getTime();
    saveSession(rec("now", now));
    saveSession(rec("2mo", now - 60 * DAY));
    saveSession(rec("old", now - 120 * DAY));
    saveSession(rec("manual", now - DAY, "manual"));
    expect(recentSessions(now).map((r) => r.id).sort()).toEqual(["2mo", "now"]);
  });

  it("reads every record kind, and edits and deletes manual entries by removing the key", () => {
    const now = new Date(2026, 11, 2, 12).getTime();
    const m = (id: string, startedAt: number): ManualRecord => ({ id, kind: "manual", startedAt, durationMs: 600_000, note: "Minuet", updatedAt: startedAt });
    const nov = new Date(2026, 10, 30, 12).getTime();
    saveManual(m("m", nov));
    saveSession(rec("d", now));
    expect(recentRecords(now, 10).map((r) => r.id).sort()).toEqual(["d", "m"]);
    saveManual({ ...m("m", nov), note: "Edited" }, m("m", nov));
    expect(loadMonth("piano-2026-11").items.m).toMatchObject({ note: "Edited" });
    saveManual(m("m", now), m("m", nov)); // moved to December: leaves the November doc
    expect(Object.keys(loadMonth("piano-2026-11").items)).toEqual([]);
    expect(Object.keys(loadMonth("piano-2026-12").items).sort()).toEqual(["d", "m"]);
    deleteSession(m("m", now));
    expect(Object.keys(loadMonth("piano-2026-12").items)).toEqual(["d"]);
  });

  it("survives broken stored data", () => {
    localStorage.setItem("reel-radar-piano-2026-11", "{nope");
    localStorage.setItem("reel-radar-piano-settings", "[1");
    expect(loadMonth("piano-2026-11")).toEqual({ items: {} });
    expect(loadSettings()).toEqual({ unlocks: {}, slowSteps: {}, slowAt: {}, songs: {}, importedSongs: {}, milestones: {}, months: [], updatedAt: 0 });
    localStorage.setItem("reel-radar-piano-2026-11", JSON.stringify({ items: 5 }));
    expect(loadMonth("piano-2026-11")).toEqual({ items: {} });
  });

  it("starts at one group and the first limit, and unlock levels only go up", () => {
    expect(drillSettings(loadSettings(), "notes")).toEqual({ unlocked: 1, slowStep: 0 });
    saveDrillSettings("notes", { unlocked: 3, slowStep: 1 }, 100);
    saveDrillSettings("notes", { unlocked: 2, slowStep: 0 }, 200);
    expect(drillSettings(loadSettings(), "notes")).toEqual({ unlocked: 3, slowStep: 0 });
    expect(loadSettings().updatedAt).toBe(200);
    expect(drillSettings(loadSettings(), "chords")).toEqual({ unlocked: 1, slowStep: 0 });
  });

  it("makes distinct session ids, with or without crypto.randomUUID", () => {
    expect(newSessionId()).not.toBe(newSessionId());
    const orig = Object.getOwnPropertyDescriptor(globalThis, "crypto")!;
    Object.defineProperty(globalThis, "crypto", { value: {}, configurable: true });
    expect(newSessionId()).not.toBe(newSessionId());
    Object.defineProperty(globalThis, "crypto", orig);
  });
});
