import { describe, expect, it } from "vitest";
import { dueReminders, fmtTime, missingDailyTasks, reminderBody, reminderKey, repeatsOn } from "./reminders";
import type { DailyTask, Todo } from "./todos";

const todo = (extra: Partial<Todo> = {}): Todo => ({ id: "t", text: "Gym", completed: false, createdAt: "", ...extra });
const MON = "2026-03-02";

describe("dueReminders", () => {
  it("covers the lead time up to the start, skipping done and unscheduled tasks", () => {
    const list = [todo({ start: 600 }), todo({ id: "done", start: 600, completed: true }), todo({ id: "free" })];
    expect(dueReminders(list, 594, 5)).toEqual([]);
    expect(dueReminders(list, 595, 5).map((t) => t.id)).toEqual(["t"]);
    expect(dueReminders(list, 600, 5).map((t) => t.id)).toEqual(["t"]);
    expect(dueReminders(list, 601, 5)).toEqual([]);
  });

  it("allows a late window, so a late run doesn't lose an at-start reminder", () => {
    const list = [todo({ start: 600 })];
    expect(dueReminders(list, 603, 0, 5)).toHaveLength(1);
    expect(dueReminders(list, 606, 0, 5)).toEqual([]);
  });
});

describe("reminder text", () => {
  it("says how far away the block is", () => {
    expect(reminderBody(todo({ start: 600, duration: 30 }), 595)).toBe("In 5 min · 10 AM–10:30 AM");
    expect(reminderBody(todo({ start: 600 }), 600)).toBe("Starting now · 10 AM–11 AM");
    expect(reminderBody(todo({ start: 600, note: "bring keys" }), 602)).toBe("Started 2 min ago · 10 AM–11 AM\nbring keys");
  });

  it("changes key when a task moves to a new time", () => {
    expect(reminderKey(MON, todo({ start: 600 }))).not.toBe(reminderKey(MON, todo({ start: 660 })));
  });

  it("formats times", () => {
    expect(fmtTime(0)).toBe("12 AM");
    expect(fmtTime(13 * 60 + 5)).toBe("1:05 PM");
  });
});

describe("missingDailyTasks", () => {
  const task: DailyTask = { id: "d", text: "Walk", startDate: MON };

  it("finds tasks due that day without a copy", () => {
    expect(missingDailyTasks([task], [], MON)).toEqual([task]);
    expect(missingDailyTasks([task], [todo({ dailyId: "d" })], MON)).toEqual([]);
  });

  it("respects the start date, weekdays and skipped days", () => {
    expect(missingDailyTasks([task], [], "2026-03-01")).toEqual([]);
    expect(missingDailyTasks([{ ...task, days: [2] }], [], MON)).toEqual([]);
    expect(repeatsOn({ ...task, days: [1] }, MON)).toBe(true);
    expect(missingDailyTasks([{ ...task, skipDates: [MON] }], [], MON)).toEqual([]);
  });
});
