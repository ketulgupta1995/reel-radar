import { describe, expect, it } from "vitest";
import { dayMarks, dayProgress, todayCard } from "./plannerToday";
import type { Todo } from "./todos";

const t = (id: string, extra: Partial<Todo> = {}): Todo => ({ id, text: id, completed: false, createdAt: "2026-11-08T00:00:00.000Z", ...extra });

describe("todayCard", () => {
  const day = [
    t("gym", { start: 420, duration: 45, completed: true }),
    t("report", { start: 570, duration: 90 }),
    t("call", { start: 720, duration: 15 }),
    t("dentist"),
    t("photos"),
    t("bills"),
    t("plants"),
  ];

  it("shows nothing for an empty day, and all done when everything is", () => {
    expect(todayCard([], 600)).toBeNull();
    expect(todayCard([t("a", { completed: true }), t("b", { completed: true })], 600)).toEqual({ kind: "done", count: 2 });
  });

  it("shows the block under way, with when it ends", () => {
    expect(todayCard(day, 580)).toMatchObject({ kind: "block", end: 660, todo: { id: "report" } });
    expect(todayCard([t("x", { start: 600 })], 600)).toMatchObject({ kind: "block", end: 660 }); // the default hour
  });

  it("between blocks, shows the next one and up to three unscheduled tasks", () => {
    const card = todayCard(day, 675);
    expect(card).toMatchObject({ kind: "free", next: { id: "call" } });
    expect(card?.kind === "free" && card.anytime.map((x) => x.id)).toEqual(["dentist", "photos", "bills"]);
  });

  it("skips a finished block, and a day with no blocks is free time", () => {
    expect(todayCard([t("a", { start: 600, completed: true }), t("b", { start: 700 }), t("c", { start: 900 })], 610)).toMatchObject({ kind: "free", next: { id: "b" } });
    expect(todayCard([t("a"), t("b")], 600)).toMatchObject({ kind: "free", next: null, anytime: [{ id: "a" }, { id: "b" }] });
  });

  it("after the last block, asks to wrap up the day", () => {
    expect(todayCard(day, 1350)).toEqual({ kind: "wrap", open: 6 });
  });
});

describe("dayProgress", () => {
  it("counts tasks and scheduled minutes", () => {
    expect(dayProgress([t("a", { start: 60, duration: 45, completed: true }), t("b", { start: 200 }), t("c", { completed: true }), t("d")])).toEqual({
      done: 2,
      total: 4,
      doneMinutes: 45,
      plannedMinutes: 105,
    });
    expect(dayProgress([])).toEqual({ done: 0, total: 0, doneMinutes: 0, plannedMinutes: 0 });
  });
});

describe("dayMarks", () => {
  const D = "2026-11-08";
  const ms = (h: number, m: number, day = 8) => new Date(2026, 10, day, h, m).getTime();
  it("marks wake, sleep, water by the quarter hour, and what was ticked that day", () => {
    const marks = dayMarks(
      { wake: "06:40", sleep: "23:10", drinks: [{ at: 482, ml: 250 }, { at: 488, ml: 250 }, { at: 600, ml: 500 }] },
      [
        t("Gym", { completed: true, doneAt: ms(7, 50), subtasks: [{ id: "s", text: "Stretch", done: true, doneAt: ms(7, 20) }, { id: "u", text: "Run", done: false }] }),
        t("Old", { completed: true, doneAt: ms(9, 0, 7) }), // ticked the day before
        t("Open"),
      ],
      D
    );
    expect(marks.map((m) => [m.key, m.at, m.text])).toEqual([
      ["wake", 400, "🌅 Woke 6:40 AM"],
      ["sleep", 1390, "😴 Sleep 11:10 PM"],
      ["water-480", 480, "💧 250 ml · 8 AM"],
      ["water-495", 495, "💧 250 ml · 8:15 AM"],
      ["water-600", 600, "💧 500 ml · 10 AM"],
      ["done-Gym", 470, "✓ Gym"],
      ["done-Gym-s", 440, "✓ Stretch"],
    ]);
    expect(marks.find((m) => m.key === "done-Gym")).toMatchObject({ time: "7:50 AM", tone: "emerald", title: "Gym · done 7:50 AM" });
    expect(dayMarks({}, [], D)).toEqual([]);
  });
});
