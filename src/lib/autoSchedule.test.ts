import { describe, expect, it } from "vitest";
import { canAutoSchedule, dayWindow, planDay } from "./autoSchedule";
import type { DayLog, Todo } from "./todos";

const todo = (id: string, extra: Partial<Todo> = {}): Todo => ({ id, text: id, completed: false, createdAt: "", ...extra });
const DAY = { from: 9 * 60, to: 17 * 60, usual: false };
const D = "2026-03-10";

describe("dayWindow", () => {
  it("uses the day's own wake and sleep times", () => {
    expect(dayWindow({ [D]: { wake: "07:30", sleep: "23:00" } }, D)).toEqual({ from: 450, to: 23 * 60, usual: false });
  });

  it("falls back to the usual times lately, then to 8 to 10", () => {
    const logs: Record<string, DayLog> = {
      "2026-03-09": { wake: "06:00", sleep: "22:30" },
      "2026-03-08": { wake: "07:00", sleep: "23:30" },
      "2026-03-07": { wake: "08:00", sleep: "22:30" },
    };
    expect(dayWindow(logs, D)).toEqual({ from: 7 * 60, to: 22.5 * 60, usual: true });
    expect(dayWindow({}, D)).toEqual({ from: 8 * 60, to: 22 * 60, usual: true });
    expect(dayWindow({ [D]: { wake: "10:00" } }, D)).toEqual({ from: 10 * 60, to: 22 * 60, usual: true });
  });

  it("ignores logs older than two weeks", () => {
    expect(dayWindow({ "2026-02-20": { wake: "05:00" } }, D).from).toBe(8 * 60);
  });

  it("ends the day at midnight for a bedtime after midnight", () => {
    expect(dayWindow({ [D]: { wake: "09:00", sleep: "01:30" } }, D).to).toBe(24 * 60);
  });
});

describe("canAutoSchedule", () => {
  it("takes only unfinished, untimed, one-off tasks", () => {
    expect(canAutoSchedule(todo("a"))).toBe(true);
    expect(canAutoSchedule(todo("a", { completed: true }))).toBe(false);
    expect(canAutoSchedule(todo("a", { start: 60 }))).toBe(false);
    expect(canAutoSchedule(todo("a", { dailyId: "d" }))).toBe(false);
  });
});

describe("planDay", () => {
  it("places by priority, keeping list order among equals", () => {
    const { placed } = planDay([todo("none"), todo("low", { priority: "low" }), todo("high", { priority: "high" }), todo("med", { priority: "medium" }), todo("none2")], DAY);
    expect(placed.map((b) => [b.id, b.start])).toEqual([
      ["high", 540], ["med", 600], ["none", 660], ["none2", 720], ["low", 780],
    ]);
  });

  it("uses each task's own length, defaulting to an hour", () => {
    const { placed } = planDay([todo("a", { duration: 30 }), todo("b")], DAY);
    expect(placed).toEqual([{ id: "a", text: "a", start: 540, duration: 30 }, { id: "b", text: "b", start: 570, duration: 60 }]);
  });

  it("works around existing blocks, finished ones too, and fills a gap that fits", () => {
    const { placed } = planDay(
      [todo("block", { start: 600, duration: 60 }), todo("done", { start: 660, duration: 30, completed: true }), todo("long", { duration: 90, priority: "high" }), todo("short", { duration: 30 })],
      DAY
    );
    expect(placed.find((b) => b.id === "long")!.start).toBe(690); // 9:00–10:00 is too short
    expect(placed.find((b) => b.id === "short")!.start).toBe(540); // but this fits there
  });

  it("snaps to the quarter hour after an uneven block", () => {
    expect(planDay([todo("block", { start: 540, duration: 50 }), todo("a")], DAY).placed[0].start).toBe(600);
  });

  it("reports what doesn't fit, and places smaller tasks that still do", () => {
    const { placed, unplaced } = planDay([todo("huge", { duration: 600, priority: "high" }), todo("small", { duration: 30 })], DAY);
    expect(unplaced.map((t) => t.id)).toEqual(["huge"]);
    expect(placed.map((b) => b.id)).toEqual(["small"]);
  });

  it("ends exactly at the end of the window, not past it", () => {
    const { placed, unplaced } = planDay([todo("a", { duration: 480 }), todo("b", { duration: 15 })], DAY);
    expect(placed.map((b) => b.id)).toEqual(["a"]);
    expect(unplaced.map((t) => t.id)).toEqual(["b"]);
  });

  it("starts after now, rounded up, when that's later than waking", () => {
    expect(planDay([todo("a")], DAY, 601).placed[0].start).toBe(615);
    expect(planDay([todo("a")], DAY, 100).placed[0].start).toBe(540);
    expect(planDay([todo("a")], DAY, 1000).unplaced).toHaveLength(1);
  });

  it("does nothing with nothing to place", () => {
    expect(planDay([], DAY)).toEqual({ placed: [], unplaced: [] });
  });
});
