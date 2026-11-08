import { describe, expect, it } from "vitest";
import { datesBetween, logHistory, streakEnding, streakOf, type LogCell } from "./plannerLogHistory";
import { BUILTIN_LOG_ITEMS } from "./plannerSettings";

const bath = BUILTIN_LOG_ITEMS.find((i) => i.id === "bath")!;
const walk = BUILTIN_LOG_ITEMS.find((i) => i.id === "walk")!;
const cells = (pattern: string): LogCell[] => [...pattern].map((c, i) => ({ date: `d${i}`, done: c === "x" }));

describe("datesBetween", () => {
  it("lists every day, across a month end", () => {
    expect(datesBetween("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(datesBetween("2026-11-02", "2026-11-01")).toEqual([]);
  });
});

describe("streakOf", () => {
  it("counts the run that ends on the last day", () => {
    expect(streakOf(cells("x.xxx"))).toBe(3);
  });
  it("keeps the run going while the last day is still open", () => {
    expect(streakOf(cells("xxx."))).toBe(3);
  });
  it("is broken by two open days in a row", () => {
    expect(streakOf(cells("xx.."))).toBe(0);
    expect(streakOf([])).toBe(0);
  });
});

describe("logHistory", () => {
  const logs = {
    "2026-11-05": { ticks: { bath: { at: 450 } }, counts: { walk: 8000 } },
    "2026-11-06": { ticks: { bath: {} } },
    "2026-11-07": { ticks: { bath: { at: 480 } }, counts: { walk: 4001 } },
  };

  it("gives a tick row its cells, rate and streak, leaving an open today out of the rate", () => {
    const [row] = logHistory(logs, [bath], "2026-11-04", "2026-11-08");
    expect(row.cells.map((c) => c.done)).toEqual([false, true, true, true, false]);
    expect(row.cells[1]).toEqual({ date: "2026-11-05", done: true, at: 450 });
    expect(row.cells[2]).toEqual({ date: "2026-11-06", done: true });
    expect(row.rate).toBe(75); // 3 of the 4 finished days
    expect(row.streak).toBe(3);
    expect(row.average).toBeNull();
  });

  it("counts today once it's done", () => {
    const [row] = logHistory({ ...logs, "2026-11-08": { ticks: { bath: {} } } }, [bath], "2026-11-04", "2026-11-08");
    expect(row.rate).toBe(80);
    expect(row.streak).toBe(4);
  });

  it("gives a number row its counts and average instead of a rate", () => {
    const [row] = logHistory(logs, [walk], "2026-11-05", "2026-11-08");
    expect(row.cells.map((c) => c.count)).toEqual([8000, undefined, 4001, undefined]);
    expect(row.average).toBe(6001);
    expect(row.rate).toBeNull();
    expect(row.streak).toBe(1);
  });

  it("has no rate or average with nothing to count", () => {
    const [b, w] = logHistory({}, [bath, walk], "2026-11-08", "2026-11-08");
    expect(b.rate).toBeNull();
    expect(w.average).toBeNull();
    expect(logHistory({}, [bath], "2026-11-09", "2026-11-08")[0].rate).toBeNull();
  });
});

describe("streakEnding", () => {
  const logs = {
    "2026-10-29": { ticks: { bath: {} } },
    "2026-10-30": { ticks: { bath: {} }, counts: { walk: 4000 } },
    "2026-10-31": { ticks: { bath: { at: 480 } }, counts: { walk: 6000 } },
    "2026-11-01": { counts: { walk: 0 } },
  };
  it("counts back from the day, across a month end", () => {
    expect(streakEnding(logs, bath, "2026-10-31")).toBe(3);
    expect(streakEnding(logs, walk, "2026-10-31")).toBe(2);
  });
  it("keeps the run going while the day itself is still open", () => {
    expect(streakEnding(logs, bath, "2026-11-01")).toBe(3);
  });
  it("is 0 after two open days, and stops at the limit", () => {
    expect(streakEnding(logs, bath, "2026-11-02")).toBe(0);
    expect(streakEnding(logs, bath, "2026-10-31", 2)).toBe(2);
  });
});
