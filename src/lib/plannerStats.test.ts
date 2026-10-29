import { describe, expect, it } from "vitest";
import { computePlannerStats, weekStart } from "./plannerStats";
import type { Todo } from "./todos";

const todo = (id: string, extra: Partial<Todo> = {}): Todo => ({
  id,
  text: id,
  completed: false,
  createdAt: "2026-03-01T00:00:00.000Z",
  ...extra,
});

// 2026-03-02 is a Monday.
describe("computePlannerStats", () => {
  const days: Record<string, Todo[]> = {
    "2026-03-02": [
      todo("a", { completed: true, start: 540, duration: 60, tag: "work", spent: 50 }),
      todo("b", { start: 600, duration: 30, tag: "work" }),
    ],
    "2026-03-03": [todo("c", { completed: true, tag: "home" }), todo("d")],
    "2026-03-05": [todo("e", { carriedFrom: "2026-03-02" }), todo("f", { completed: true, carriedFrom: "2026-03-04" })],
    "2026-02-01": [todo("outside", { completed: true })],
  };

  it("totals tasks, planned, done and focused time in the range", () => {
    const s = computePlannerStats(days, "2026-03-02", "2026-03-08");
    expect(s).toMatchObject({ total: 6, done: 3, plannedMinutes: 90, doneMinutes: 60, focusedMinutes: 50 });
  });

  it("splits completion by weekday, Monday first", () => {
    const s = computePlannerStats(days, "2026-03-02", "2026-03-08");
    expect(s.byWeekday.map((w) => w.day)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(s.byWeekday[0]).toEqual({ day: 1, total: 2, done: 1 });
    expect(s.byWeekday[3]).toEqual({ day: 4, total: 2, done: 1 });
    expect(s.byWeekday[6]).toEqual({ day: 0, total: 0, done: 0 });
  });

  it("groups by tag, most tasks first", () => {
    const s = computePlannerStats(days, "2026-03-02", "2026-03-08");
    expect(s.byTag).toEqual([
      { tag: null, total: 3, done: 1 },
      { tag: "work", total: 2, done: 1 },
      { tag: "home", total: 1, done: 1 },
    ]);
  });

  it("lists carried-over tasks by days pushed", () => {
    const s = computePlannerStats(days, "2026-03-02", "2026-03-08");
    expect(s.carried.map((c) => [c.text, c.days, c.completed])).toEqual([
      ["e", 3, false],
      ["f", 1, true],
    ]);
  });

  it("has one bucket per day, including empty days", () => {
    const s = computePlannerStats(days, "2026-03-02", "2026-03-04");
    expect(s.buckets).toEqual([
      { start: "2026-03-02", end: "2026-03-02", plannedMinutes: 90, doneMinutes: 60 },
      { start: "2026-03-03", end: "2026-03-03", plannedMinutes: 0, doneMinutes: 0 },
      { start: "2026-03-04", end: "2026-03-04", plannedMinutes: 0, doneMinutes: 0 },
    ]);
  });

  it("uses weekly buckets from Monday for long ranges", () => {
    const s = computePlannerStats(days, "2026-02-01", "2026-03-08");
    expect(s.buckets[0]).toMatchObject({ start: "2026-02-01", end: "2026-02-01" }); // a Sunday: partial first week
    expect(s.buckets[1]).toMatchObject({ start: "2026-02-02", end: "2026-02-08" });
    expect(s.buckets.at(-1)).toMatchObject({ start: "2026-03-02", end: "2026-03-08", plannedMinutes: 90 });
    expect(s.total).toBe(7);
  });

  it("finds the Monday of a week", () => {
    expect(weekStart("2026-03-08")).toBe("2026-03-02");
    expect(weekStart("2026-03-02")).toBe("2026-03-02");
  });
});
