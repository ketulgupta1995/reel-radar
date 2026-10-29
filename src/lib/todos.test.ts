// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DURATION,
  Todo,
  addTodo,
  carryOverFromYesterday,
  clearCompletedTodos,
  deleteTodo,
  exportTodos,
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
  shiftDate,
  stopTodoDaily,
  syncDailyTasksWithServer,
  syncTodosWithServer,
  toggleTodo,
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
