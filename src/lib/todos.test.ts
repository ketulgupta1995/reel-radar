// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DURATION,
  Todo,
  addSpentTime,
  addSubtask,
  addTodo,
  carryOverFromYesterday,
  copyTodoToDate,
  clearCompletedTodos,
  deleteSubtask,
  deleteTodo,
  dueReminders,
  exportTodos,
  getDailyStreak,
  getFocusSession,
  moveTodoToDate,
  setTodoTag,
  startFocus,
  stopFocus,
  getAllStoredDates,
  getTodayDate,
  getUnfinishedFromYesterday,
  importTodos,
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
  syncDailyTasksWithServer,
  syncTodosWithServer,
  toggleSubtask,
  toggleTodo,
  updateTodo,
  updateTodoText,
} from "./todos";
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
  it("adds a todo with priority and schedule, and syncs it", () => {
    const [t] = addTodo("Write tests", D1, "high", { start: 540 });
    expect(t).toMatchObject({ text: "Write tests", completed: false, priority: "high", start: 540, duration: DEFAULT_DURATION });
    expect(loadTodos(D1)).toEqual([t]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ date: D1, todos: [t] });
  });

  it("defaults to today's date", () => {
    addTodo("Today");
    expect(loadTodos(getTodayDate())).toHaveLength(1);
  });

  it("returns [] for missing or corrupt days", () => {
    expect(loadTodos(D1)).toEqual([]);
    localStorage.setItem(`reel-radar-todos-${D1}`, "{bad");
    expect(loadTodos(D1)).toEqual([]);
    localStorage.setItem(`reel-radar-todos-${D1}`, '{"not":"an array"}');
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
    localStorage.setItem("reel-radar-daily-tasks", "{bad");
    expect(loadDailyTasks()).toEqual([]);
  });
});

describe("stored dates", () => {
  it("lists only valid day keys, newest first", () => {
    saveTodos([todo("a")], D1);
    saveTodos([todo("b")], D3);
    localStorage.setItem("reel-radar-todos-daily", "[]");
    localStorage.setItem("other-key", "[]");
    expect(getAllStoredDates()).toEqual([D3, D1]);
    expect(Object.keys(loadAllTodos())).toEqual([D3, D1]);
    expect(loadAllTodos()[D1]).toEqual([todo("a")]);
  });
});

describe("server sync", () => {
  it("takes the server's todos for a day", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ date: D1, todos: [todo("server")] }));
    expect(await syncTodosWithServer(D1)).toEqual([todo("server")]);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/todos?date=${D1}`);
    expect(loadTodos(D1)).toEqual([todo("server")]);
  });

  it("falls back to local todos on error", async () => {
    saveTodos([todo("local")], D1);
    fetchMock.mockResolvedValueOnce(jsonResponse({}, { status: 500 }));
    expect(await syncTodosWithServer(D1)).toEqual([todo("local")]);
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(await syncTodosWithServer(D1)).toEqual([todo("local")]);
  });

  it("downloads daily tasks only when this browser has none", async () => {
    const task = { id: "d1", text: "Meditate", startDate: D1 };
    fetchMock.mockResolvedValueOnce(jsonResponse({ date: "daily", todos: [task] }));
    expect(await syncDailyTasksWithServer()).toEqual([task]);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/todos?date=daily");
    fetchMock.mockClear();
    expect(await syncDailyTasksWithServer()).toEqual([task]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("export and import", () => {
  it("exports a day as a JSON download", () => {
    saveTodos([todo("a")], D1);
    const createObjectURL = vi.fn(() => "blob:t");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe(`reel-radar-todos-${D1}.json`);
    });
    exportTodos(D1);
    expect(click).toHaveBeenCalled();
  });

  it("imports a day's backup", async () => {
    const onSuccess = vi.fn();
    const file = new File([JSON.stringify({ date: D2, todos: [todo("x")] })], "t.json");
    importTodos(file, onSuccess);
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledWith([todo("x")], D2));
    expect(loadTodos(D2)).toEqual([todo("x")]);
  });

  it("rejects backups without a date or todos array", async () => {
    const onError = vi.fn();
    importTodos(new File([JSON.stringify({ todos: [] })], "t.json"), vi.fn(), onError);
    importTodos(new File([JSON.stringify({ date: D1, todos: "x" })], "t.json"), vi.fn(), onError);
    importTodos(new File(["nope"], "t.json"), vi.fn(), onError);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(3));
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
