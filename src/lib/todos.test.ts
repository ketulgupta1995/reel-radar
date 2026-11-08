// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  sortTodos,
  reorderTodo,
  loadDayLog,
  updateDayLog,
  addWater,
  setLogCount,
  setLogTick,
  DEFAULT_DURATION,
  Todo,
  addSpentTime,
  addSubtask,
  addTodo,
  carryOverFromYesterday,
  carryOverdueTo,
  applyTemplate,
  normalizeRepeat,
  saveDayAsTemplate,
  setTodoRepeat,
  timesDone,
  getOverdueTodos,
  postponeCount,
  syncTrayPlanner,
  copyTodoToDate,
  clearCompletedTodos,
  deleteSubtask,
  deleteTodo,
  dueReminders,
  getDailyStreak,
  getFocusSession,
  moveTodoToDate,
  setTodoTag,
  setTodoDue,
  setTodoGoal,
  getDueTodos,
  startFocus,
  stopFocus,
  getAllStoredDates,
  getTodayDate,
  getUnfinishedFromYesterday,
  loadAllTodos,
  loadDailyTasks,
  loadTodos,
  loadTodosWithDaily,
  makeTodoDaily,
  restoreTodo,
  saveTodos,
  scheduleTodo,
  setTodoPriority,
  setTodoRepeatDays,
  shiftDate,
  stopTodoDaily,
  syncPlanner,
  toggleSubtask,
  toggleTodo,
  updateTodo,
  updateTodoText,
} from "./todos";
import { flush } from "./sync";
import { loadTemplates } from "./plannerSettings";
import { jsonResponse } from "@/test/fixtures";

const D1 = "2026-03-01";
const D2 = "2026-03-02";
const D3 = "2026-03-03";

const todo = (id: string, extra: Partial<Todo> = {}): Todo => ({
  id,
  text: id,
  completed: false,
  createdAt: `2026-03-01T00:00:0${id.length}.000Z`,
  ...extra,
});

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => jsonResponse({ success: true }));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.useRealTimers());

describe("dates", () => {
  it("uses the local date for today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 5, 23, 59));
    expect(getTodayDate()).toBe("2026-01-05");
  });

  it("shifts across month and year boundaries", () => {
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDate("2025-12-31", 1)).toBe("2026-01-01");
  });
});

describe("basic todo operations", () => {
  it("adds a todo with priority and schedule, and pushes its month a few seconds later", () => {
    vi.useFakeTimers();
    const [t] = addTodo("Write tests", D1, "high", { start: 540 });
    expect(t).toMatchObject({ text: "Write tests", completed: false, priority: "high", start: 540, duration: DEFAULT_DURATION });
    expect(loadTodos(D1)).toEqual([t]);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.key).toBe("planner-2026-03");
    expect(body.data.items).toEqual([expect.objectContaining({ date: D1, pos: 0, todo: t })]);
  });

  it("batches a burst of edits into one push", () => {
    vi.useFakeTimers();
    const [t] = addTodo("a", D1);
    toggleTodo(t.id, D1);
    updateTodoText(t.id, "b", D1);
    vi.advanceTimersByTime(3000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("doesn't push a save that changes nothing", () => {
    vi.useFakeTimers();
    saveTodos([todo("a"), todo("b")], D1);
    vi.advanceTimersByTime(3000);
    fetchMock.mockClear();
    saveTodos([todo("a"), todo("b")], D1);
    vi.advanceTimersByTime(3000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("defaults to today's date", () => {
    addTodo("Today");
    expect(loadTodos(getTodayDate())).toHaveLength(1);
  });

  it("returns [] for missing or corrupt days", () => {
    expect(loadTodos(D1)).toEqual([]);
    localStorage.setItem("reel-radar-planner-2026-03", "{bad");
    expect(loadTodos(D1)).toEqual([]);
    localStorage.setItem("reel-radar-planner-2026-03", '{"not":"an array"}');
    expect(loadTodos(D1)).toEqual([]);
  });

  it("toggles, edits, reprioritises and deletes", () => {
    saveTodos([todo("a"), todo("b")], D1);
    expect(toggleTodo("a", D1)[0].completed).toBe(true);
    expect(toggleTodo("a", D1)[0].completed).toBe(false);
    expect(updateTodoText("a", "renamed", D1)[0].text).toBe("renamed");
    expect(setTodoPriority("a", "low", D1)[0].priority).toBe("low");
    expect(setTodoPriority("a", undefined, D1)[0]).not.toHaveProperty("priority");
    expect(deleteTodo("a", D1).map((t) => t.id)).toEqual(["b"]);
  });

  it("adds, edits and removes a note, trimming it", () => {
    const [t] = addTodo("Call bank", D1, undefined, undefined, false, "  ask about the fee  ");
    expect(t.note).toBe("ask about the fee");
    expect(addTodo("No note", D1, undefined, undefined, false, "   ")[1]).not.toHaveProperty("note");

    const [edited] = updateTodo(t.id, { text: "Call the bank", note: "fee + card" }, D1);
    expect(edited).toMatchObject({ text: "Call the bank", note: "fee + card" });
    expect(updateTodoText(t.id, "Renamed", D1)[0].note).toBe("fee + card"); // title-only edit keeps it
    expect(updateTodo(t.id, { note: "" }, D1)[0]).not.toHaveProperty("note");
  });

  it("schedules and unschedules, keeping an existing duration", () => {
    saveTodos([todo("a", { duration: 30 })], D1);
    expect(scheduleTodo("a", { start: 600 }, D1)[0]).toMatchObject({ start: 600, duration: 30 });
    expect(scheduleTodo("a", { start: 600, duration: 90 }, D1)[0].duration).toBe(90);
    const [cleared] = scheduleTodo("a", undefined, D1);
    expect(cleared).not.toHaveProperty("start");
    expect(cleared).not.toHaveProperty("duration");
  });

  it("restores a deleted todo in creation order, once", () => {
    const a = todo("a");
    const b = todo("bb");
    saveTodos([b], D1);
    expect(restoreTodo(a, D1).map((t) => t.id)).toEqual(["a", "bb"]);
    expect(restoreTodo(a, D1)).toHaveLength(2);
  });

  it("clears completed todos", () => {
    saveTodos([todo("a", { completed: true }), todo("b")], D1);
    expect(clearCompletedTodos(D1).map((t) => t.id)).toEqual(["b"]);
  });
});

describe("flexible repeats", () => {
  const MON = "2026-03-02";
  const nth = (n: number) => `2026-03-${String(n).padStart(2, "0")}`;
  const copy = (date: string) => loadTodosWithDaily(date).filter((t) => t.dailyId);

  it("repeats every N days from its first day", () => {
    addTodo("Water plants", MON, undefined, undefined, { every: 3 });
    expect(copy(nth(2))).toHaveLength(1);
    expect(copy(nth(3))).toHaveLength(0);
    expect(copy(nth(5))).toHaveLength(1);
    expect(copy("2026-04-01")).toHaveLength(1); // 30 days on, across the month boundary
    expect(copy("2026-04-02")).toHaveLength(0);
    expect(copy("2026-02-27")).toHaveLength(0); // before it starts
  });

  it("keeps counting evenly across a clock change", () => {
    addTodo("Water", "2026-03-07", undefined, undefined, { every: 2 });
    expect(copy("2026-03-09")).toHaveLength(1); // US clocks change on the 8th
    expect(copy("2026-03-10")).toHaveLength(0);
  });

  it("repeats monthly, using the last day of shorter months", () => {
    const day = "2026-01-31";
    addTodo("Close books", day, undefined, undefined, { monthDay: 31 });
    expect(copy(day)).toHaveLength(1);
    expect(copy("2026-02-28")).toHaveLength(1);
    expect(copy("2026-02-27")).toHaveLength(0);
    expect(copy("2026-03-31")).toHaveLength(1);
    expect(copy("2026-04-30")).toHaveLength(1);
    expect(copy("2028-02-29")).toHaveLength(1); // a leap year
  });

  it("adds nothing today for a monthly task due another day", () => {
    const out = addTodo("Pay rent", "2026-03-15", undefined, undefined, { monthDay: 1 });
    expect(out).toEqual([]);
    expect(loadTodos("2026-03-15")).toEqual([]);
    expect(loadDailyTasks()[0]).toMatchObject({ text: "Pay rent", monthDay: 1, startDate: "2026-03-15" });
    expect(copy("2026-04-01").map((t) => t.text)).toEqual(["Pay rent"]);
    expect(copy("2026-03-01")).toEqual([]); // before it was added
  });

  it("shows a times-a-week task daily until the target is met, then stops for that week", () => {
    addTodo("Run", MON, undefined, undefined, { timesPerWeek: 2 });
    expect(copy(nth(2))).toHaveLength(1);
    toggleTodo(copy(nth(2))[0].id, nth(2));
    expect(copy(nth(3))).toHaveLength(1); // once so far
    expect(copy(nth(4))).toHaveLength(1);
    toggleTodo(copy(nth(4))[0].id, nth(4));
    expect(copy(nth(5))).toHaveLength(0); // met
    expect(copy(nth(8))).toHaveLength(0); // Sunday, the same week
    expect(copy(nth(9))).toHaveLength(1); // a new Monday
  });

  it("counts a cleared finished copy toward the target", () => {
    addTodo("Run", MON, undefined, undefined, { timesPerWeek: 1 });
    toggleTodo(copy(nth(2))[0].id, nth(2));
    clearCompletedTodos(nth(2));
    expect(copy(nth(3))).toHaveLength(0);
    expect(timesDone(loadDailyTasks()[0], nth(3))).toBe(1);
  });

  it("counts a streak in weeks for times-a-week tasks", () => {
    addTodo("Run", MON, undefined, undefined, { timesPerWeek: 1 });
    const id = loadDailyTasks()[0].id;
    const finish = (date: string) => toggleTodo(copy(date)[0].id, date);
    finish(nth(2));
    finish(nth(10));
    expect(getDailyStreak(id, nth(11))).toBe(2);
    expect(getDailyStreak(id, nth(16))).toBe(2); // this week isn't over
    expect(getDailyStreak(id, nth(23))).toBe(0); // a whole week was missed
  });

  it("changes the rule, removing later copies that no longer fall on it", () => {
    addTodo("Water", MON, undefined, undefined, true);
    const [t] = copy(MON);
    copy(nth(3));
    copy(nth(4));
    setTodoRepeat(t.id, { every: 2 }, MON);
    expect(loadDailyTasks()[0]).toMatchObject({ every: 2, startDate: MON });
    expect(loadDailyTasks()[0].days).toBeUndefined();
    expect(loadTodos(nth(3))).toEqual([]);
    expect(loadTodos(nth(4))).toHaveLength(1);
    setTodoRepeat(t.id, { monthDay: 2 }, MON);
    expect(loadDailyTasks()[0]).toMatchObject({ monthDay: 2 });
    expect(loadDailyTasks()[0].every).toBeUndefined();
    expect(setTodoRepeat("nope", {}, MON)).toHaveLength(1);
  });

  it("re-anchors every N days on the day it's changed", () => {
    addTodo("Water", MON, undefined, undefined, true);
    const [t] = copy(nth(4));
    setTodoRepeat(t.id, { every: 5 }, nth(4));
    expect(loadDailyTasks()[0].startDate).toBe(nth(4));
    expect(copy(nth(9))).toHaveLength(1);
  });

  it("turns an existing task into any kind of repeat", () => {
    saveTodos([todo("a")], MON);
    makeTodoDaily("a", MON, { timesPerWeek: 4 });
    expect(loadDailyTasks()[0]).toMatchObject({ timesPerWeek: 4 });
    saveTodos([todo("b")], D1);
    makeTodoDaily("b", D1, [1, 3]);
    expect(loadDailyTasks()[1]).toMatchObject({ days: [1, 3] });
  });

  it("cleans up rules: one kind at a time, sane numbers", () => {
    expect(normalizeRepeat()).toEqual({});
    expect(normalizeRepeat({ every: 1 })).toEqual({});
    expect(normalizeRepeat({ every: 0 })).toEqual({});
    expect(normalizeRepeat({ every: 400 })).toEqual({});
    expect(normalizeRepeat({ every: 2.5 })).toEqual({});
    expect(normalizeRepeat({ monthDay: 32 })).toEqual({});
    expect(normalizeRepeat({ timesPerWeek: 7 })).toEqual({});
    expect(normalizeRepeat({ monthDay: 5, every: 3 })).toEqual({ monthDay: 5 });
    expect(normalizeRepeat({ days: [0, 1, 2, 3, 4, 5, 6] })).toEqual({});
    expect(normalizeRepeat({ days: [3, 1, 1] })).toEqual({ days: [1, 3] });
  });
});

describe("day templates", () => {
  it("saves a day's one-off tasks and adds them to another day as new tasks", () => {
    saveTodos(
      [
        todo("Standup", { start: 570, duration: 15, tag: "work", priority: "high", note: "room 2", completed: true, subtasks: [{ id: "s", text: "Notes", done: true }] }),
        todo("Loose"),
        todo("Copy", { dailyId: "d" }),
      ],
      D1
    );
    expect(saveDayAsTemplate("Workday", D1)).toBe(2);
    const [t] = loadTemplates();
    const { todos, added } = applyTemplate(t.id, D2);
    expect(added).toBe(2);
    expect(todos[0]).toMatchObject({ text: "Standup", start: 570, duration: 15, tag: "work", priority: "high", note: "room 2", completed: false });
    expect(todos[0].subtasks![0]).toMatchObject({ text: "Notes", done: false });
    expect(todos[0].id).not.toBe("Standup");
    expect(todos[1].start).toBeUndefined();
    expect(ids(D1)).toEqual(["Standup", "Loose", "Copy"]); // the original day is untouched
  });

  it("doesn't double up when applied twice", () => {
    saveTodos([todo("Standup", { start: 570 })], D1);
    saveDayAsTemplate("Workday", D1);
    const [t] = loadTemplates();
    applyTemplate(t.id, D2);
    expect(applyTemplate(t.id, D2)).toMatchObject({ added: 0 });
    expect(loadTodos(D2)).toHaveLength(1);
    expect(applyTemplate("gone", D3)).toEqual({ todos: [], added: 0 });
  });

  it("saves nothing for a day with no one-off tasks", () => {
    expect(saveDayAsTemplate("Empty", D1)).toBe(0);
    expect(loadTemplates()).toEqual([]);
  });
});

describe("overdue and postponing", () => {
  it("lists every past day's unfinished one-offs, oldest first", () => {
    saveTodos([todo("recent"), todo("done", { completed: true })], D2);
    saveTodos([todo("old")], "2026-02-10");
    saveTodos([todo("copy", { dailyId: "x" })], D1);
    saveTodos([todo("current")], D3);
    expect(getOverdueTodos(D3).map((o) => [o.date, o.todo.id])).toEqual([["2026-02-10", "old"], [D2, "recent"]]);
  });

  it("moves overdue tasks across days, counting each postponement and dropping the slot", () => {
    saveTodos([todo("a", { start: 600, duration: 30, order: 1 }), todo("stay")], "2026-02-10");
    saveTodos([todo("b", { carriedFrom: "2026-01-01" })], D1);
    const out = carryOverdueTo(D3, getOverdueTodos(D3).filter((o) => o.todo.id !== "stay"));
    expect(out.map((t) => t.id)).toEqual(["a", "b"]);
    expect(out[0]).toMatchObject({ carriedFrom: "2026-02-10", postponed: 1 });
    expect(out[0].start).toBeUndefined();
    expect(out[0].duration).toBeUndefined();
    expect(out[0].order).toBeUndefined();
    expect(out[1]).toMatchObject({ carriedFrom: "2026-01-01", postponed: 2 }); // older tasks count once
    expect(ids("2026-02-10")).toEqual(["stay"]);
    expect(ids(D1)).toEqual([]);
  });

  it("counts carrying over from yesterday too", () => {
    saveTodos([todo("a", { postponed: 2, carriedFrom: "2026-02-01" })], D1);
    expect(carryOverFromYesterday(D2)[0]).toMatchObject({ postponed: 3, carriedFrom: "2026-02-01" });
  });

  it("counts a move off today or a past day to a later one, and nothing else", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 2, 12));
    saveTodos([todo("late"), todo("done", { completed: true })], D1);
    saveTodos([todo("today")], D2);
    saveTodos([todo("planned")], "2026-03-10");
    expect(moveTodoToDate("late", D1, D3)!.find((t) => t.id === "late")).toMatchObject({ postponed: 1, carriedFrom: D1 });
    expect(moveTodoToDate("today", D2, D3)!.find((t) => t.id === "today")).toMatchObject({ postponed: 1 });
    expect(moveTodoToDate("done", D1, D3)!.find((t) => t.id === "done")!.postponed).toBeUndefined();
    expect(moveTodoToDate("planned", "2026-03-10", "2026-03-11")!.find((t) => t.id === "planned")!.postponed).toBeUndefined(); // still ahead
    expect(moveTodoToDate("today", D3, D1)!.find((t) => t.id === "today")!.postponed).toBe(1); // brought forward
    expect(postponeCount(todo("x"))).toBe(0);
    expect(postponeCount(todo("x", { carriedFrom: D1 }))).toBe(1);
    expect(postponeCount(todo("x", { postponed: 4, carriedFrom: D1 }))).toBe(4);
  });

  it("pulls past months and the next one for the trays, but not further ahead", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 4, 12));
    fetchMock.mockImplementation(async () => docsResponse({}));
    expect(await syncTrayPlanner()).toBe(false);
    const asked = decodeURIComponent(String(fetchMock.mock.calls[0][0]));
    expect(asked).toContain("planner-2026-10");
    expect(asked).toContain("planner-2026-12");
    expect(asked).not.toContain("planner-2027-01");
  });

  it("pulls past months and reports offline", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    expect(await syncTrayPlanner()).toBeNull();
  });
});

describe("carry over from yesterday", () => {
  it("lists unfinished one-off todos only", () => {
    saveTodos([todo("open"), todo("done", { completed: true }), todo("daily", { dailyId: "d" })], D1);
    expect(getUnfinishedFromYesterday(D2).map((t) => t.id)).toEqual(["open"]);
  });

  it("moves all unfinished todos, dropping their time slot", () => {
    saveTodos([todo("a", { start: 540, duration: 60 }), todo("b")], D1);
    saveTodos([todo("today")], D2);
    const out = carryOverFromYesterday(D2);
    expect(out.map((t) => t.id)).toEqual(["today", "a", "b"]);
    expect(out[1]).toMatchObject({ carriedFrom: D1 });
    expect(out[1]).not.toHaveProperty("start");
    expect(loadTodos(D1)).toEqual([]);
  });

  it("keeps a carried task's note", () => {
    saveTodos([todo("a", { note: "details" })], D1);
    expect(carryOverFromYesterday(D2)[0].note).toBe("details");
  });

  it("moves only the chosen ids and keeps the original carriedFrom", () => {
    saveTodos([todo("a", { carriedFrom: "2026-02-20" }), todo("b")], D1);
    const out = carryOverFromYesterday(D2, ["a"]);
    expect(out.map((t) => t.id)).toEqual(["a"]);
    expect(out[0].carriedFrom).toBe("2026-02-20");
    expect(loadTodos(D1).map((t) => t.id)).toEqual(["b"]);
  });

  it("does nothing when there is nothing to move", () => {
    saveTodos([todo("x")], D2);
    fetchMock.mockClear();
    expect(carryOverFromYesterday(D2)).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("daily tasks", () => {
  it("creates a daily task and a copy on each later day", () => {
    const [t] = addTodo("Stretch", D1, "medium", { start: 420, duration: 15 }, true);
    const [task] = loadDailyTasks();
    expect(task).toMatchObject({ text: "Stretch", startDate: D1, priority: "medium", start: 420, duration: 15 });
    expect(t.dailyId).toBe(task.id);

    const d2 = loadTodosWithDaily(D2);
    expect(d2).toHaveLength(1);
    expect(d2[0]).toMatchObject({ text: "Stretch", dailyId: task.id, completed: false, start: 420 });
    expect(loadTodosWithDaily(D2)).toEqual(d2); // not duplicated on reload
    expect(loadTodosWithDaily("2026-02-28")).toEqual([]); // not before its start date
  });

  it("keeps completion per day", () => {
    addTodo("Read", D1, undefined, undefined, true);
    const [copy] = loadTodosWithDaily(D2);
    toggleTodo(copy.id, D2);
    expect(loadTodosWithDaily(D3)[0].completed).toBe(false);
  });

  it("carries edits to the template", () => {
    const [t] = addTodo("Old", D1, undefined, undefined, true);
    updateTodoText(t.id, "New", D1);
    setTodoPriority(t.id, "high", D1);
    scheduleTodo(t.id, { start: 60, duration: 20 }, D1);
    expect(loadDailyTasks()[0]).toMatchObject({ text: "New", priority: "high", start: 60, duration: 20 });
    expect(loadTodosWithDaily(D2)[0]).toMatchObject({ text: "New", priority: "high", start: 60 });
  });

  it("copies a daily task's note to later days and carries note edits", () => {
    const [t] = addTodo("Gym", D1, undefined, undefined, true, "legs");
    expect(loadDailyTasks()[0].note).toBe("legs");
    expect(loadTodosWithDaily(D2)[0].note).toBe("legs");
    updateTodo(t.id, { note: "" }, D1);
    expect(loadDailyTasks()[0]).not.toHaveProperty("note");
    expect(loadTodosWithDaily(D3)[0]).not.toHaveProperty("note");
  });

  it("skips a day when its copy is deleted, and undo restores it", () => {
    addTodo("Walk", D1, undefined, undefined, true);
    const [copy] = loadTodosWithDaily(D2);
    deleteTodo(copy.id, D2);
    expect(loadDailyTasks()[0].skipDates).toEqual([D2]);
    expect(loadTodosWithDaily(D2)).toEqual([]);
    restoreTodo(copy, D2);
    expect(loadDailyTasks()[0].skipDates).toEqual([]);
  });

  it("skips a day when a completed copy is cleared", () => {
    addTodo("Walk", D1, undefined, undefined, true);
    const [copy] = loadTodosWithDaily(D2);
    toggleTodo(copy.id, D2);
    clearCompletedTodos(D2);
    expect(loadTodosWithDaily(D2)).toEqual([]);
  });

  it("turns an existing todo into a daily task", () => {
    saveTodos([todo("a", { priority: "low" })], D1);
    const [t] = makeTodoDaily("a", D1);
    expect(t.dailyId).toBeTruthy();
    expect(loadDailyTasks()[0]).toMatchObject({ text: "a", startDate: D1, priority: "low" });
    expect(makeTodoDaily("a", D1)).toEqual([t]); // already daily
    expect(loadDailyTasks()).toHaveLength(1);
  });

  it("stops repeating and removes unfinished future copies", () => {
    const [t] = addTodo("Gym", D1, undefined, undefined, true);
    const [d2] = loadTodosWithDaily(D2);
    toggleTodo(d2.id, D2); // completed copies are history and stay
    loadTodosWithDaily(D3);
    const [today] = stopTodoDaily(t.id, D1);
    expect(today).not.toHaveProperty("dailyId");
    expect(loadDailyTasks()).toEqual([]);
    expect(loadTodos(D2)).toHaveLength(1);
    expect(loadTodos(D3)).toEqual([]);
  });

  it("ignores stop on a non-daily todo", () => {
    saveTodos([todo("a")], D1);
    expect(stopTodoDaily("a", D1)).toEqual([todo("a")]);
  });

  it("returns [] for corrupt daily task storage", () => {
    localStorage.setItem("reel-radar-planner-daily", "{bad");
    expect(loadDailyTasks()).toEqual([]);
  });
});

describe("task order", () => {
  const t = (id: string, extra: Partial<Todo> = {}): Todo => ({ ...todo(id), createdAt: `2026-01-01T00:00:0${id.length}.000Z`, ...extra });
  const names = (list: Todo[]) => list.map((x) => x.id);

  it("lists unfinished daily tasks first, then by priority, with done tasks last", () => {
    const list = [t("done", { completed: true, dailyId: "d" }), t("low", { priority: "low" }), t("high", { priority: "high" }), t("daily!", { dailyId: "d2" }), t("plain")];
    expect(names(sortTodos(list))).toEqual(["daily!", "high", "low", "plain", "done"]);
  });

  it("puts hand-arranged tasks first, in their order, and keeps done ones last", () => {
    const list = [t("a", { order: 1 }), t("b", { order: 0 }), t("new", { dailyId: "d" }), t("c", { order: 0, completed: true })];
    expect(names(sortTodos(list))).toEqual(["b", "a", "new", "c"]);
  });

  it("reorderTodo moves a task before another, or to the end, and the arrangement sticks", () => {
    saveTodos([t("daily!", { dailyId: "d" }), t("high", { priority: "high" }), t("plain"), t("done", { completed: true })], D1);
    reorderTodo("plain", "daily!", D1);
    expect(names(sortTodos(loadTodos(D1)))).toEqual(["plain", "daily!", "high", "done"]);
    reorderTodo("plain", "high", D1);
    expect(names(sortTodos(loadTodos(D1)))).toEqual(["daily!", "plain", "high", "done"]);
    reorderTodo("daily!", null, D1);
    expect(names(sortTodos(loadTodos(D1)))).toEqual(["plain", "high", "daily!", "done"]);
    const before = loadTodos(D1);
    expect(reorderTodo("plain", "plain", D1)).toEqual(before);
    expect(reorderTodo("plain", "high", D1)).toEqual(before); // already there
    expect(reorderTodo("plain", "done", D1)).toEqual(before);
    expect(reorderTodo("done", "plain", D1)).toEqual(before);
    expect(reorderTodo("nope", "plain", D1)).toEqual(before);
    expect(reorderTodo("plain", "nope", D1)).toEqual(before);
  });

  it("forgets the arrangement when a task moves to another day", () => {
    saveTodos([t("a"), t("b")], D1);
    reorderTodo("b", "a", D1);
    moveTodoToDate("b", D1, D2);
    copyTodoToDate("a", D1, D2);
    expect(loadTodos(D2).every((x) => x.order === undefined)).toBe(true);
  });
});

describe("day log", () => {
  it("starts empty and keeps wake, sleep and water per day", () => {
    expect(loadDayLog(D1)).toEqual({});
    expect(updateDayLog(D1, { wake: "06:30" })).toEqual({ wake: "06:30" });
    updateDayLog(D1, { sleep: "23:10" });
    addWater(D1, 250);
    addWater(D1, 500);
    expect(loadDayLog(D1)).toEqual({ wake: "06:30", sleep: "23:10", water: 750 });
    addWater(D1, 250, 600);
    addWater(D1, 250, 780);
    expect(loadDayLog(D1).drinks).toEqual([{ at: 600, ml: 250 }, { at: 780, ml: 250 }]);
    addWater(D1, -250);
    expect(loadDayLog(D1).drinks).toEqual([{ at: 600, ml: 250 }]);
    addWater(D1, -5000);
    expect(loadDayLog(D1).drinks).toBeUndefined();
    expect(loadDayLog(D2)).toEqual({});
  });

  it("clears fields, ignores bad times, never goes below zero water, and drops an empty log", () => {
    updateDayLog(D1, { weight: 72.4 });
    expect(loadDayLog(D1).weight).toBe(72.4);
    updateDayLog(D1, { weight: -3 });
    expect(loadDayLog(D1).weight).toBeUndefined();
    updateDayLog(D1, { wake: "25:99", water: -5 });
    expect(loadDayLog(D1)).toEqual({});
    addWater(D1, -250);
    expect(loadDayLog(D1)).toEqual({});
    updateDayLog(D1, { wake: "07:00" });
    expect(updateDayLog(D1, { wake: "07:00" })).toEqual({ wake: "07:00" });
    updateDayLog(D1, { well: "  ", bad: "" });
    expect(loadDayLog(D1)).toEqual({ wake: "07:00" });
    updateDayLog(D1, { improve: "Sleep earlier" });
    expect(loadDayLog(D1).improve).toBe("Sleep earlier");
    updateDayLog(D1, { improve: "" });
    updateDayLog(D1, { wake: undefined });
    expect(loadDayLog(D1)).toEqual({});
    expect(JSON.parse(localStorage.getItem("reel-radar-planner-log")!).items).toEqual([]);
  });

  it("ticks log items with the time, unticks them, and drops what's left empty", () => {
    setLogTick(D1, "bath", true, 475);
    setLogTick(D1, "yoga", true); // ticked later, for a past day: no time
    expect(loadDayLog(D1).ticks).toEqual({ bath: { at: 475 }, yoga: {} });
    setLogTick(D1, "bath", false);
    expect(loadDayLog(D1).ticks).toEqual({ yoga: {} });
    setLogTick(D1, "yoga", false);
    expect(loadDayLog(D1)).toEqual({});
  });

  it("counts items such as steps, rounding, and clears them with nothing or zero", () => {
    setLogCount(D1, "walk", 3240.6);
    setLogCount(D1, "pushups", 20);
    expect(loadDayLog(D1).counts).toEqual({ walk: 3241, pushups: 20 });
    setLogCount(D1, "walk", 0);
    setLogCount(D1, "pushups", undefined);
    expect(loadDayLog(D1)).toEqual({});
  });

  it("keeps only well-formed ticks and counts", () => {
    updateDayLog(D1, {
      ticks: { ok: { at: 60 }, late: { at: 99999 }, half: { at: 1.5 }, bad: 5 as never, none: null as never },
      counts: { walk: 5000, neg: -1, big: 1e12, nan: NaN, text: "9" as never },
    });
    expect(loadDayLog(D1)).toEqual({ ticks: { ok: { at: 60 }, late: {}, half: {} }, counts: { walk: 5000 } });
    updateDayLog(D1, { ticks: "x" as never, counts: [] as never });
    expect(loadDayLog(D1)).toEqual({});
  });

  it("keeps ticks and counts when another part of the day's log changes", () => {
    setLogTick(D1, "med1", true, 495);
    setLogCount(D1, "walk", 4000);
    updateDayLog(D1, { wake: "06:40" });
    addWater(D1, 250, 500);
    updateDayLog(D1, { weight: 71.4 });
    expect(loadDayLog(D1)).toMatchObject({ ticks: { med1: { at: 495 } }, counts: { walk: 4000 }, wake: "06:40", water: 250 });
  });

  it("reads a day log stored before log items existed", () => {
    localStorage.setItem("reel-radar-planner-log", JSON.stringify({ items: [{ date: D1, updatedAt: 1, log: { wake: "07:00", water: 500 } }] }));
    expect(loadDayLog(D1)).toEqual({ wake: "07:00", water: 500 });
    setLogTick(D1, "bath", true, 430);
    expect(loadDayLog(D1)).toEqual({ wake: "07:00", water: 500, ticks: { bath: { at: 430 } } });
  });
});

describe("stored dates", () => {
  it("lists only days that have todos, newest first", () => {
    saveTodos([todo("a")], D1);
    saveTodos([todo("b")], D3);
    saveTodos([todo("c")], "2026-04-10");
    saveTodos([], "2026-04-10");
    localStorage.setItem("reel-radar-planner-daily", '{"items":[]}');
    localStorage.setItem("other-key", "[]");
    expect(getAllStoredDates()).toEqual([D3, D1]);
    expect(Object.keys(loadAllTodos())).toEqual([D3, D1]);
    expect(loadAllTodos()[D1]).toEqual([todo("a")]);
  });
});

const item = (t: Todo, date = D1, pos = 0, updatedAt = 1) => ({ date, pos, todo: t, updatedAt });
const monthDoc = (...items: ReturnType<typeof item>[]) => ({ items });
const docsResponse = (docs: Record<string, unknown>) => jsonResponse({ docs });
const ids = (date = D1) => loadTodos(date).map((t) => t.id);
const postBodies = () =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(init.body));

describe("server sync", () => {
  it("pulls the day's month and the daily tasks in one request, and pushes what the server lacks", async () => {
    saveTodos([todo("local")], D1);
    const task = { id: "d1", text: "Meditate", startDate: D1 };
    fetchMock.mockResolvedValueOnce(
      docsResponse({
        "planner-2026-03": { etag: '"e1"', data: monthDoc(item(todo("server"), D1, 1)) },
        "planner-daily": { etag: '"e2"', data: { items: [{ task, updatedAt: 1 }] } },
      })
    );
    expect(await syncPlanner([D1, D2])).toBe(true);
    expect(decodeURIComponent(fetchMock.mock.calls[0][0])).toBe("/api/sync?keys=planner-daily,planner-log,planner-settings,planner-2026-03");
    expect(ids()).toEqual(["local", "server"]);
    expect(loadDailyTasks()).toEqual([task]);
    // The month gained "local", so it goes back up, against the etag just read.
    expect(postBodies()).toEqual([expect.objectContaining({ key: "planner-2026-03", baseEtag: '"e1"' })]);
  });

  it("asks only for changes after that, and skips docs synced in the last two minutes", async () => {
    fetchMock.mockResolvedValueOnce(
      docsResponse({ "planner-daily": null, "planner-log": null, "planner-settings": null, "planner-2026-03": { etag: '"e1"', data: monthDoc(item(todo("a"))) } })
    );
    await syncPlanner([D1], true);
    fetchMock.mockClear();
    expect(await syncPlanner([D1])).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(docsResponse({ "planner-2026-03": { etag: '"e1"', unchanged: true } }));
    expect(await syncPlanner([D1], true)).toBe(false);
    expect(decodeURIComponent(fetchMock.mock.calls[0][0])).toContain('planner-2026-03:"e1"');
    expect(ids()).toEqual(["a"]);
  });

  it("keeps this browser's todos when the server is unreachable", async () => {
    saveTodos([todo("local")], D1);
    fetchMock.mockResolvedValueOnce(jsonResponse({}, { status: 500 }));
    expect(await syncPlanner([D1], true)).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(await syncPlanner([D1], true)).toBeNull();
    expect(ids()).toEqual(["local"]);
  });

  it("applies a delete made on another device instead of bringing the todo back", async () => {
    fetchMock.mockResolvedValueOnce(
      docsResponse({ "planner-2026-03": { etag: '"e1"', data: monthDoc(item(todo("a")), item(todo("b"), D1, 1)) } })
    );
    await syncPlanner([D1], true);
    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(docsResponse({ "planner-2026-03": { etag: '"e2"', data: monthDoc(item(todo("a"))) } }));
    await syncPlanner([D1], true);
    expect(ids()).toEqual(["a"]);
    expect(postBodies()).toEqual([]);
  });

  it("keeps both devices' new todos when a push conflicts", async () => {
    fetchMock.mockResolvedValueOnce(docsResponse({ "planner-2026-03": { etag: '"e1"', data: monthDoc(item(todo("a"))) } }));
    await syncPlanner([D1], true);
    saveTodos([...loadTodos(D1), todo("mine")], D1);
    fetchMock.mockClear();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ etag: '"e2"', data: monthDoc(item(todo("a")), item(todo("theirs"), D2)) }, { status: 409 })
      )
      .mockResolvedValueOnce(jsonResponse({ etag: '"e3"' }));
    await flush(["planner-2026-03"]);
    expect(ids()).toEqual(["a", "mine"]);
    expect(ids(D2)).toEqual(["theirs"]);
    const [first, retry] = postBodies();
    expect(first.baseEtag).toBe('"e1"');
    expect(retry.baseEtag).toBe('"e2"');
    expect(retry.data.items.map((i: { todo: Todo }) => i.todo.id).sort()).toEqual(["a", "mine", "theirs"]);
  });

  it("takes the later edit when both devices changed the same todo", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    fetchMock.mockResolvedValueOnce(docsResponse({ "planner-2026-03": { etag: '"e1"', data: monthDoc(item(todo("a"))) } }));
    await syncPlanner([D1], true);
    updateTodoText("a", "mine", D1); // updatedAt 1000
    fetchMock.mockResolvedValueOnce(
      docsResponse({ "planner-2026-03": { etag: '"e2"', data: monthDoc(item(todo("a", { text: "theirs" }), D1, 0, 5000)) } })
    );
    await syncPlanner([D1], true);
    expect(loadTodos(D1)[0].text).toBe("theirs");
  });

  it("gives a daily task's copy the same id on every device", () => {
    const [t] = addTodo("Stretch", D1, undefined, undefined, true);
    const copy = loadTodosWithDaily(D2).find((x) => x.dailyId === t.dailyId)!;
    expect(copy.id).toBe(`${t.dailyId}:${D2}`);
  });

  it("drops the old per-day planner keys", async () => {
    localStorage.setItem(`reel-radar-todos-${D1}`, JSON.stringify([todo("old")]));
    localStorage.setItem("reel-radar-daily-tasks", "[]");
    localStorage.setItem("reel-radar-v1", "{}");
    vi.resetModules();
    await import("./todos");
    expect(localStorage.getItem(`reel-radar-todos-${D1}`)).toBeNull();
    expect(localStorage.getItem("reel-radar-daily-tasks")).toBeNull();
    expect(localStorage.getItem("reel-radar-v1")).toBe("{}");
  });
});

// 2026-03-02 is a Monday.
const MON = "2026-03-02";
const day = (offset: number) => shiftDate(MON, offset);

describe("subtasks", () => {
  it("adds, ticks and deletes checklist items", () => {
    saveTodos([todo("a")], D1);
    expect(addSubtask("a", "   ", D1)[0]).not.toHaveProperty("subtasks");
    const [withItems] = addSubtask("a", " milk ", D1);
    addSubtask("a", "eggs", D1);
    const [milk, eggs] = loadTodos(D1)[0].subtasks!;
    expect(withItems.subtasks).toEqual([{ id: milk.id, text: "milk", done: false }]);
    expect(toggleSubtask("a", milk.id, D1)[0].subtasks![0].done).toBe(true);
    expect(deleteSubtask("a", milk.id, D1)[0].subtasks).toEqual([eggs]);
    expect(deleteSubtask("a", eggs.id, D1)[0]).not.toHaveProperty("subtasks");
  });

  it("gives each day's copy of a daily task the checklist, unticked", () => {
    const [t] = addTodo("Morning", D1, undefined, undefined, true);
    addSubtask(t.id, "water", D1);
    toggleSubtask(t.id, loadTodos(D1)[0].subtasks![0].id, D1);
    expect(loadDailyTasks()[0].subtasks).toEqual(["water"]);
    expect(loadTodosWithDaily(D2)[0].subtasks).toEqual([{ id: expect.any(String), text: "water", done: false }]);
  });
});

describe("repeat on chosen days", () => {
  it("creates copies only on the chosen weekdays", () => {
    addTodo("Gym", MON, undefined, undefined, [1, 3, 5]);
    expect(loadDailyTasks()[0].days).toEqual([1, 3, 5]);
    expect(loadTodosWithDaily(day(1))).toEqual([]); // Tuesday
    expect(loadTodosWithDaily(day(2))).toHaveLength(1); // Wednesday
  });

  it("treats all seven days as every day", () => {
    addTodo("Read", MON, undefined, undefined, [0, 1, 2, 3, 4, 5, 6]);
    expect(loadDailyTasks()[0]).not.toHaveProperty("days");
  });

  it("changes the days, removing unfinished copies on days it no longer repeats", () => {
    const [t] = addTodo("Walk", MON, undefined, undefined, true);
    loadTodosWithDaily(day(1));
    loadTodosWithDaily(day(2));
    toggleTodo(loadTodos(day(1))[0].id, day(1));
    setTodoRepeatDays(t.id, [1, 2], MON);
    expect(loadDailyTasks()[0].days).toEqual([1, 2]);
    expect(loadTodos(day(1))).toHaveLength(1); // Tuesday is kept
    expect(loadTodos(day(2))).toEqual([]); // Wednesday copy removed
    setTodoRepeatDays(t.id, undefined, MON);
    expect(loadDailyTasks()[0]).not.toHaveProperty("days");
  });

  it("makes an existing todo repeat on chosen days", () => {
    saveTodos([todo("a")], MON);
    makeTodoDaily("a", MON, [6]);
    expect(loadDailyTasks()[0].days).toEqual([6]);
  });
});

describe("streaks", () => {
  const complete = (date: string) => {
    const copy = loadTodosWithDaily(date).find((t) => t.dailyId)!;
    toggleTodo(copy.id, date);
  };

  it("counts consecutive done days and ignores an unfinished today", () => {
    const [t] = addTodo("Stretch", MON, undefined, undefined, true);
    [0, 1, 2].forEach((i) => complete(day(i)));
    loadTodosWithDaily(day(3));
    expect(getDailyStreak(t.dailyId!, day(2))).toBe(3);
    expect(getDailyStreak(t.dailyId!, day(3))).toBe(3);
  });

  it("breaks on a missed day", () => {
    const [t] = addTodo("Stretch", MON, undefined, undefined, true);
    complete(day(0));
    loadTodosWithDaily(day(1)); // missed
    complete(day(2));
    expect(getDailyStreak(t.dailyId!, day(2))).toBe(1);
  });

  it("skips days it doesn't repeat on and days the user removed it", () => {
    const [t] = addTodo("Run", MON, undefined, undefined, [1, 3]);
    complete(MON);
    complete(day(2)); // Wednesday; Tuesday isn't a repeat day
    complete(day(7));
    const [skipped] = loadTodosWithDaily(day(9));
    deleteTodo(skipped.id, day(9)); // removed for that day
    complete(day(14));
    expect(getDailyStreak(t.dailyId!, day(14))).toBe(4);
  });

  it("still counts a done day after its copy is cleared", () => {
    const [t] = addTodo("Floss", MON, undefined, undefined, true);
    complete(MON);
    clearCompletedTodos(MON);
    complete(day(1));
    expect(getDailyStreak(t.dailyId!, day(1))).toBe(2);
  });

  it("is 0 for an unknown daily task", () => {
    expect(getDailyStreak("nope", MON)).toBe(0);
  });
});

describe("reminders", () => {
  it("returns unfinished blocks starting within the lead time", () => {
    const todos = [
      todo("soon", { start: 600 }),
      todo("now", { start: 590 }),
      todo("later", { start: 620 }),
      todo("past", { start: 580 }),
      todo("done", { start: 595, completed: true }),
      todo("unscheduled"),
    ];
    expect(dueReminders(todos, 590, 10).map((t) => t.id)).toEqual(["soon", "now"]);
    expect(dueReminders(todos, 590, 0).map((t) => t.id)).toEqual(["now"]);
  });
});

describe("tags", () => {
  it("adds, changes and clears a tag", () => {
    const [t] = addTodo("Report", D1, undefined, undefined, false, undefined, "work");
    expect(t.tag).toBe("work");
    expect(setTodoTag(t.id, "home", D1)[0].tag).toBe("home");
    expect(setTodoTag(t.id, undefined, D1)[0]).not.toHaveProperty("tag");
  });

  it("copies a daily task's tag to later days", () => {
    const [t] = addTodo("Run", D1, undefined, undefined, true, undefined, "health");
    expect(loadTodosWithDaily(D2)[0].tag).toBe("health");
    setTodoTag(t.id, "personal", D1);
    expect(loadTodosWithDaily(D3)[0].tag).toBe("personal");
  });
});

describe("moving between days", () => {
  it("moves a todo into a time slot on another day", () => {
    saveTodos([todo("a", { start: 540, duration: 30, note: "n" }), todo("b")], D1);
    const target = moveTodoToDate("a", D1, D2, { start: 600 })!;
    expect(target).toEqual([expect.objectContaining({ id: "a", note: "n", start: 600, duration: 30 })]);
    expect(loadTodos(D1).map((t) => t.id)).toEqual(["b"]);
  });

  it("moves to another day unscheduled, keeping the length", () => {
    saveTodos([todo("a", { start: 540, duration: 30 })], D1);
    const [moved] = moveTodoToDate("a", D1, D2)!;
    expect(moved).not.toHaveProperty("start");
    expect(moved.duration).toBe(30);
  });

  it("only reschedules within the same day", () => {
    saveTodos([todo("a")], D1);
    expect(moveTodoToDate("a", D1, D1, { start: 60, duration: 15 })![0]).toMatchObject({ start: 60, duration: 15 });
  });

  it("refuses to move a daily task's copy to another day", () => {
    const [t] = addTodo("Daily", D1, undefined, undefined, true);
    expect(moveTodoToDate(t.id, D1, D2)).toBeNull();
    expect(loadTodos(D1)).toHaveLength(1);
  });
});

describe("copying to another day", () => {
  it("copies a todo fresh, leaving the original in place", () => {
    saveTodos(
      [
        todo("a", {
          completed: true,
          note: "n",
          tag: "work",
          priority: "high",
          spent: 20,
          carriedFrom: "2026-02-28",
          start: 540,
          duration: 30,
          subtasks: [{ id: "s1", text: "step", done: true }],
        }),
      ],
      D1
    );
    const [copy] = copyTodoToDate("a", D1, D2, { start: 600 });
    expect(copy).toMatchObject({ text: "a", note: "n", tag: "work", priority: "high", completed: false, start: 600, duration: 30 });
    expect(copy.id).not.toBe("a");
    expect(copy).not.toHaveProperty("spent");
    expect(copy).not.toHaveProperty("carriedFrom");
    expect(copy.subtasks).toEqual([{ id: expect.any(String), text: "step", done: false }]);
    expect(copy.subtasks![0].id).not.toBe("s1");
    expect(loadTodos(D1)).toHaveLength(1);
  });

  it("copies unscheduled, keeping the length, and can duplicate on the same day", () => {
    saveTodos([todo("a", { start: 540, duration: 45 })], D1);
    const [, dup] = copyTodoToDate("a", D1, D1);
    expect(dup).not.toHaveProperty("start");
    expect(dup.duration).toBe(45);
  });

  it("turns a copy of a daily task into a one-off", () => {
    const [t] = addTodo("Daily", D1, undefined, undefined, true);
    const [copy] = copyTodoToDate(t.id, D1, D2);
    expect(copy).not.toHaveProperty("dailyId");
    expect(loadDailyTasks()).toHaveLength(1);
  });
});

describe("focus timer", () => {
  it("records the session length on the todo, adding to earlier sessions", () => {
    saveTodos([todo("a", { spent: 10 })], D1);
    startFocus(loadTodos(D1)[0], D1, 0);
    expect(getFocusSession()).toMatchObject({ todoId: "a", date: D1, text: "a", startedAt: 0 });
    expect(stopFocus(25 * 60000 + 20000)![0].spent).toBe(35);
    expect(getFocusSession()).toBeNull();
    expect(stopFocus()).toBeNull();
  });

  it("stops and records a running session when another starts", () => {
    saveTodos([todo("a"), todo("bb")], D1);
    startFocus(loadTodos(D1)[0], D1, 0);
    startFocus(loadTodos(D1)[1], D1, 5 * 60000);
    expect(loadTodos(D1)[0].spent).toBe(5);
    expect(getFocusSession()!.todoId).toBe("bb");
  });

  it("ignores sessions under a minute", () => {
    saveTodos([todo("a")], D1);
    expect(addSpentTime("a", 0, D1)[0]).not.toHaveProperty("spent");
  });
});

describe("done times", () => {
  it("records when a task or checklist item is ticked, clears it when undone, and starts copies fresh", () => {
    const t = addTodo("Report", D1);
    const [todo] = addSubtask(t[t.length - 1].id, "Draft", D1).slice(-1);
    expect(todo.completed).toBe(false);
    const id = todo.id;
    const after = toggleTodo(id, D1).find((x) => x.id === id)!;
    expect(after.completed).toBe(true);
    expect(after.doneAt).toBeGreaterThan(0);
    expect(toggleTodo(id, D1).find((x) => x.id === id)!.doneAt).toBeUndefined();
    const sub = loadTodos(D1).find((x) => x.id === id)!.subtasks![0];
    const ticked = toggleSubtask(id, sub.id, D1).find((x) => x.id === id)!.subtasks![0];
    expect(ticked.done).toBe(true);
    expect(ticked.doneAt).toBeGreaterThan(0);
    expect(toggleSubtask(id, sub.id, D1).find((x) => x.id === id)!.subtasks![0].doneAt).toBeUndefined();
    toggleTodo(id, D1);
    const copy = copyTodoToDate(id, D1, D2).find((x) => x.text === "Report")!;
    expect(copy.completed).toBe(false);
    expect(copy.doneAt).toBeUndefined();
  });
});

describe("deadlines", () => {
  const A = "2026-03-02";
  const B = "2026-03-05";
  const add = (date = A, extra: { due?: string; goalId?: string } = { due: "2026-03-10" }) => addTodo("Tax", date, undefined, undefined, undefined, undefined, undefined, extra)[0];

  it("sets and clears a deadline", () => {
    const t = add(A, {});
    expect(t.due).toBeUndefined();
    expect(setTodoDue(t.id, "2026-03-09", A)[0].due).toBe("2026-03-09");
    expect(setTodoDue(t.id, undefined, A)[0]).not.toHaveProperty("due");
  });

  it("keeps the deadline when the task moves or is carried over, but not on a copy", () => {
    const t = add();
    expect(moveTodoToDate(t.id, A, B)![0].due).toBe("2026-03-10");
    carryOverdueTo("2026-03-06", [{ date: B, todo: t }]);
    expect(loadTodos("2026-03-06")[0].due).toBe("2026-03-10");
    expect(copyTodoToDate(t.id, "2026-03-06", "2026-03-07")[0]).not.toHaveProperty("due");
  });

  it("doesn't give repeating tasks one", () => {
    const repeating = addTodo("Gym", A, undefined, undefined, true, undefined, undefined, { due: "2026-03-10" })[0];
    expect(repeating.due).toBeUndefined();
    expect(setTodoDue(repeating.id, "2026-03-10", A)[0].due).toBeUndefined();
    const t = add(B);
    expect(makeTodoDaily(t.id, B).find((x) => x.id === t.id)).not.toHaveProperty("due");
  });

  it("lists late and coming deadlines, soonest first, wherever they're planned", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 2, 5, 12));
    const today = "2026-03-05";
    addTodo("Late", "2026-03-01", undefined, undefined, undefined, undefined, undefined, { due: "2026-03-04" });
    addTodo("Next week", "2026-03-20", undefined, undefined, undefined, undefined, undefined, { due: "2026-03-12" });
    addTodo("Too far", today, undefined, undefined, undefined, undefined, undefined, { due: "2026-03-13" });
    addTodo("No deadline", today);
    const done = addTodo("Done", today, undefined, undefined, undefined, undefined, undefined, { due: today }).find((t) => t.text === "Done")!;
    toggleTodo(done.id, today);
    expect(getDueTodos(today).map((d) => [d.todo.text, d.date])).toEqual([
      ["Late", "2026-03-01"],
      ["Next week", "2026-03-20"],
    ]);
    addTodo("Same day", "2026-03-01", undefined, undefined, undefined, undefined, undefined, { due: "2026-03-12" });
    expect(getDueTodos(today).map((d) => d.todo.text)).toEqual(["Late", "Same day", "Next week"]);
    vi.useRealTimers();
  });
});

describe("goal links", () => {
  const A = "2026-03-02";

  it("sets and clears a task's goal", () => {
    const t = addTodo("Run", A, undefined, undefined, undefined, undefined, undefined, { goalId: "g" })[0];
    expect(t.goalId).toBe("g");
    expect(setTodoGoal(t.id, undefined, A)[0]).not.toHaveProperty("goalId");
    expect(setTodoGoal(t.id, "h", A)[0].goalId).toBe("h");
  });

  it("carries a repeating task's goal to later days, and changes it there too", () => {
    const t = addTodo("Run", A, undefined, undefined, true, undefined, undefined, { goalId: "g" })[0];
    expect(loadDailyTasks()[0].goalId).toBe("g");
    expect(loadTodosWithDaily("2026-03-03")[0].goalId).toBe("g");
    setTodoGoal(t.id, "h", A);
    expect(loadDailyTasks()[0].goalId).toBe("h");
    setTodoGoal(t.id, undefined, A);
    expect(loadDailyTasks()[0]).not.toHaveProperty("goalId");
  });

  it("keeps the goal when a task becomes repeating, or is copied", () => {
    const t = addTodo("Run", A, undefined, undefined, undefined, undefined, undefined, { goalId: "g" })[0];
    expect(copyTodoToDate(t.id, A, "2026-03-03")[0].goalId).toBe("g");
    makeTodoDaily(t.id, A);
    expect(loadDailyTasks()[0].goalId).toBe("g");
  });
});
