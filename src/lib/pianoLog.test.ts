import { describe, expect, it } from "vitest";
import { DrillRecord, ManualRecord, SessionRecord } from "./pianoDrill";
import { dayKey, drillsIn, lastDays, minutesOf, msByDay, streak, todayMs, weeklyTrend } from "./pianoLog";

const MIN = 60_000;
const at = (y: number, m: number, d: number, h = 12, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
const man = (id: string, startedAt: number, minutes: number): ManualRecord => ({ id, kind: "manual", startedAt, durationMs: minutes * MIN, note: "", updatedAt: startedAt });
const drill = (id: string, startedAt: number, minutes: number, items: DrillRecord["items"] = {}, d = "notes"): DrillRecord => ({ id, kind: "drill", drill: d, startedAt, durationMs: minutes * MIN, items, updatedAt: startedAt });

describe("minutes per day and the streak", () => {
  it("adds drill and manual time on the local day, and counts at 10 minutes", () => {
    const rs: SessionRecord[] = [drill("a", at(2026, 11, 27, 9), 4), man("b", at(2026, 11, 27, 20), 6)];
    expect(msByDay(rs)).toEqual({ "2026-11-27": 10 * MIN });
    expect(todayMs(rs, at(2026, 11, 27, 22))).toBe(10 * MIN);
    expect(minutesOf(10 * MIN)).toBe(10);
    expect(streak(rs, at(2026, 11, 27, 22))).toBe(1);
    expect(streak([man("c", at(2026, 11, 27), 9)], at(2026, 11, 27))).toBe(0);
  });

  it("ends yesterday while today does not count yet, and breaks on a gap", () => {
    const rs = [man("1", at(2026, 11, 26), 10), man("2", at(2026, 11, 25), 15), man("3", at(2026, 11, 23), 30), man("t", at(2026, 11, 27), 3)];
    expect(streak(rs, at(2026, 11, 27))).toBe(2);
    expect(streak(rs, at(2026, 11, 28))).toBe(0); // yesterday (27th) is 3 min and today has nothing
  });

  it("handles midnight edges", () => {
    const rs = [man("a", at(2026, 11, 26, 23, 59), 10), man("b", at(2026, 11, 27, 0, 0), 10)];
    expect(msByDay(rs)).toEqual({ "2026-11-26": 10 * MIN, "2026-11-27": 10 * MIN });
    expect(streak(rs, at(2026, 11, 27, 0, 0))).toBe(2);
    expect(streak(rs, at(2026, 11, 26, 23, 59))).toBe(1);
  });

  it("runs across a month and a year boundary (two month docs)", () => {
    const rs = [man("a", at(2026, 12, 30), 10), man("b", at(2026, 12, 31), 10), man("c", at(2027, 1, 1), 10), man("d", at(2027, 3, 1), 10)];
    expect(streak(rs, at(2027, 1, 1, 8))).toBe(3);
    expect(streak(rs, at(2027, 1, 2, 8))).toBe(3);
    expect(streak([man("x", at(2026, 2, 28), 10), man("y", at(2026, 3, 1), 10)], at(2026, 3, 1))).toBe(2); // not a leap year
  });

  it("does not skip or repeat a day over a clock change", () => {
    const rs = [man("a", at(2026, 3, 28), 10), man("b", at(2026, 3, 29), 10), man("c", at(2026, 3, 30), 10)];
    expect(streak(rs, at(2026, 3, 30))).toBe(3);
  });

  it("lists the last days, today first, marking counting days", () => {
    const rows = lastDays([man("a", at(2026, 11, 1), 12), man("b", at(2026, 10, 31), 3)], at(2026, 11, 2, 9), 3);
    expect(rows.map((r) => [r.key, minutesOf(r.ms), r.counts])).toEqual([
      ["2026-11-02", 0, false],
      ["2026-11-01", 12, true],
      ["2026-10-31", 3, false],
    ]);
    expect(lastDays([], at(2026, 11, 2)).length).toBe(14);
    expect(dayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("weekly trend", () => {
  const now = at(2026, 11, 27);
  it("buckets seven days ending today, oldest first, with weighted reaction time", () => {
    const rs: SessionRecord[] = [
      drill("a", at(2026, 11, 27), 2, { C: { attempts: 10, misses: 2, slow: 0, avgMs: 1000 } }),
      drill("b", at(2026, 11, 21), 2, { D: { attempts: 3, misses: 0, slow: 0, avgMs: 2000 } }), // 6 days back: same week
      drill("c", at(2026, 11, 20), 2, { C: { attempts: 4, misses: 1, slow: 0, avgMs: 500 } }), // previous week
      drill("d", at(2026, 11, 27), 2, { C: { attempts: 5, misses: 0, slow: 0, avgMs: 100 } }, "chords"),
      man("m", at(2026, 11, 27), 20),
    ];
    const w = weeklyTrend(rs, "notes", now, 3);
    expect(w.length).toBe(3);
    expect(w[0]).toMatchObject({ attempts: 0, accuracy: null, avgMs: null });
    expect(w[1]).toMatchObject({ attempts: 4, accuracy: 0.75, avgMs: 500 });
    expect(w[2].attempts).toBe(13);
    expect(w[2].accuracy).toBeCloseTo(11 / 13);
    expect(w[2].avgMs).toBeCloseTo((8 * 1000 + 3 * 2000) / 11);
    expect(drillsIn(rs)).toEqual(["chords", "notes"]);
  });

  it("gives null speed when every answer was a miss", () => {
    const w = weeklyTrend([drill("a", now, 1, { C: { attempts: 2, misses: 2, slow: 0, avgMs: 0 } })], "notes", now, 1);
    expect(w[0]).toMatchObject({ accuracy: 0, avgMs: null });
  });
});
