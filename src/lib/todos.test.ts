// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  sortTodos,
  reorderTodo,
  loadDayLog,
  updateDayLog,
  addWater,
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
  exportPlanner,
  getDailyStreak,
  getFocusSession,
  moveTodoToDate,
  setTodoTag,
  startFocus,
  stopFocus,
  getAllStoredDates,
  getTodayDate,
  getUnfinishedFromYesterday,
  importPlanner,
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
    expect(decodeURIComponent(fetchMock.mock.calls[0][0])).toBe("/api/sync?keys=planner-daily,planner-log,planner-2026-03");
    expect(ids()).toEqual(["local", "server"]);
    expect(loadDailyTasks()).toEqual([task]);
    // The month gained "local", so it goes back up, against the etag just read.
    expect(postBodies()).toEqual([expect.objectContaining({ key: "planner-2026-03", baseEtag: '"e1"' })]);
  });

  it("asks only for changes after that, and skips docs synced in the last two minutes", async () => {
    fetchMock.mockResolvedValueOnce(
      docsResponse({ "planner-daily": null, "planner-log": null, "planner-2026-03": { etag: '"e1"', data: monthDoc(item(todo("a"))) } })
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

describe("export and import", () => {
  const task = { id: "d1", text: "Meditate", startDate: D1 };
  const backupFile = (backup: unknown) => new File([JSON.stringify(backup)], "planner.json");

  const captureExport = async () => {
    let blob: Blob | undefined;
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL: vi.fn((b: Blob) => ((blob = b), "blob:t")),
        revokeObjectURL: vi.fn(),
      })
    );
    let name = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      name = this.download;
    });
    exportPlanner();
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob!);
    });
    return { name, backup: JSON.parse(text) };
  };

  it("exports every day and the daily tasks as one dated file", async () => {
    saveTodos([todo("a")], D1);
    saveTodos([todo("b")], "2026-04-10");
    addTodo("Meditate", D2, undefined, undefined, true);
    const { name, backup } = await captureExport();
    expect(name).toBe(`planner-backup-${getTodayDate()}.json`);
    expect(backup).toMatchObject({ app: "planner", version: 2 });
    expect(Object.keys(backup.days).sort()).toEqual([D1, D2, "2026-04-10"]);
    expect(backup.days[D1]).toEqual([todo("a")]);
    expect(backup.daily).toEqual([expect.objectContaining({ text: "Meditate", startDate: D2 })]);
  });

  it("round-trips an export into an empty browser", async () => {
    saveTodos([todo("a"), todo("b", { completed: true })], D1);
    addTodo("Meditate", D2, undefined, undefined, true);
    const { backup } = await captureExport();
    localStorage.clear();
    await importPlanner(backupFile(backup));
    const { backup: again } = await captureExport();
    expect(again).toEqual(backup);
  });

  it("merges a backup in without deleting anything", async () => {
    saveTodos([todo("a"), todo("keep")], D1);
    const r = await importPlanner(
      backupFile({ app: "planner", version: 2, days: { [D1]: [todo("a", { text: "new" }), todo("b")], [D2]: [todo("x")] }, daily: [task] })
    );
    expect(r).toEqual({ todos: 3, days: 2, daily: 1 });
    expect(loadTodos(D1).map((t) => t.text)).toEqual(["new", "keep", "b"]);
    expect(ids(D2)).toEqual(["x"]);
    expect(loadDailyTasks()).toEqual([task]);
  });

  it("still imports an old single-day file", async () => {
    expect(await importPlanner(backupFile({ date: D2, todos: [todo("x")] }))).toEqual({ todos: 1, days: 1, daily: 0 });
    expect(ids(D2)).toEqual(["x"]);
  });

  it("rejects files that aren't planner backups", async () => {
    await expect(importPlanner(new File(["nope"], "t.json"))).rejects.toThrow("Invalid JSON backup file.");
    await expect(importPlanner(backupFile({ todos: [] }))).rejects.toThrow("Not a planner backup file.");
    await expect(importPlanner(backupFile({ date: D1, todos: "x" }))).rejects.toThrow("Not a planner backup file.");
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
