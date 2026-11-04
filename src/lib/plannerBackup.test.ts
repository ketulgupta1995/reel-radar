// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { exportPlanner, importPlanner } from "./plannerBackup";
import { addItem, addList, loadItems, loadLists } from "./lists";
import { addTodo, getTodayDate, loadDailyTasks, loadDayLog, loadTodos, saveTodos, updateDayLog, type Todo } from "./todos";
import { jsonResponse } from "@/test/fixtures";

const D1 = "2026-03-01";
const D2 = "2026-03-02";
const todo = (id: string, extra: Partial<Todo> = {}): Todo => ({
  id,
  text: id,
  completed: false,
  createdAt: `2026-03-01T00:00:0${id.length}.000Z`,
  ...extra,
});
const ids = (date = D1) => loadTodos(date).map((t) => t.id);
const task = { id: "d1", text: "Meditate", startDate: D1 };
const backupFile = (backup: unknown) => new File([JSON.stringify(backup)], "planner.json");

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => jsonResponse({ success: true }));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

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
  const result = await exportPlanner();
  const text = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob!);
  });
  return { name, result, backup: JSON.parse(text) };
};

describe("export", () => {
  it("exports every day and the daily tasks as one dated file", async () => {
    saveTodos([todo("a")], D1);
    saveTodos([todo("b")], "2026-04-10");
    addTodo("Meditate", D2, undefined, undefined, true);
    const { name, backup } = await captureExport();
    expect(name).toBe(`planner-backup-${getTodayDate()}.json`);
    expect(backup).toMatchObject({ app: "planner", version: 3 });
    expect(Object.keys(backup.days).sort()).toEqual([D1, D2, "2026-04-10"]);
    expect(backup.days[D1]).toEqual([todo("a")]);
    expect(backup.daily).toEqual([expect.objectContaining({ text: "Meditate", startDate: D2 })]);
  });

  it("includes the day log and the lists", async () => {
    updateDayLog(D1, { wake: "06:30", sleep: "23:00", weight: 72, water: 750, drinks: [{ at: 480, ml: 750 }], well: "Shipped it" });
    const list = addList("Gifts", "🎁");
    addItem(list.id, "Scarf", { price: 900, link: "https://example.com/scarf", note: "blue" });
    const { backup } = await captureExport();
    expect(backup.log).toEqual({ [D1]: { wake: "06:30", sleep: "23:00", weight: 72, water: 750, drinks: [{ at: 480, ml: 750 }], well: "Shipped it" } });
    expect(backup.lists.lists).toEqual([expect.objectContaining({ id: list.id, name: "Gifts", icon: "🎁" })]);
    expect(backup.lists.items).toEqual([expect.objectContaining({ text: "Scarf", price: 900, note: "blue" })]);
  });

  it("pulls from the server first, so a device that never opened the lists still backs them up", async () => {
    const remote = {
      lists: [{ value: { id: "l", name: "Remote", createdAt: 1 }, updatedAt: 1 }],
      items: [{ value: { id: "i", listId: "l", text: "From phone", done: false, createdAt: 1 }, updatedAt: 1 }],
    };
    fetchMock.mockImplementation(async (url: string) => {
      const asked = decodeURIComponent(String(url));
      return jsonResponse({ docs: asked.includes("planner-lists") ? { "planner-lists": { etag: '"e"', data: remote } } : {} });
    });
    const { backup, result } = await captureExport();
    expect(result.synced).toBe(true);
    expect(backup.lists.items.map((i: { text: string }) => i.text)).toEqual(["From phone"]);
  });

  it("still exports when offline, and says so", async () => {
    saveTodos([todo("a")], D1);
    fetchMock.mockRejectedValue(new Error("offline"));
    const { backup, result } = await captureExport();
    expect(result.synced).toBe(false);
    expect(backup.days[D1]).toHaveLength(1);
  });
});

describe("import", () => {
  it("round-trips an export into an empty browser, log and lists included", async () => {
    saveTodos([todo("a"), todo("b", { completed: true })], D1);
    addTodo("Meditate", D2, undefined, undefined, true);
    updateDayLog(D1, { wake: "06:30", weight: 72, drinks: [{ at: 480, ml: 250 }], water: 250, bad: "Slept late" });
    const list = addList("Gifts", "🎁");
    addItem(list.id, "Scarf", { price: 900, link: "https://example.com/scarf", pinned: true });
    const { backup } = await captureExport();
    localStorage.clear();
    const r = await importPlanner(backupFile(backup));
    expect(r).toEqual({ todos: 3, days: 2, daily: 1, logs: 1, lists: 1, items: 1 });
    const { backup: again } = await captureExport();
    expect(again).toEqual(backup);
  });

  it("merges a backup in without deleting anything", async () => {
    saveTodos([todo("a"), todo("keep")], D1);
    const r = await importPlanner(
      backupFile({ app: "planner", version: 2, days: { [D1]: [todo("a", { text: "new" }), todo("b")], [D2]: [todo("x")] }, daily: [task] })
    );
    expect(r).toEqual({ todos: 3, days: 2, daily: 1, logs: 0, lists: 0, items: 0 });
    expect(loadTodos(D1).map((t) => t.text)).toEqual(["new", "keep", "b"]);
    expect(ids(D2)).toEqual(["x"]);
    expect(loadDailyTasks()).toEqual([task]);
  });

  it("merges a day log field by field: the backup's fields win and the rest stay", async () => {
    updateDayLog(D1, { wake: "07:00", weight: 80, well: "Kept" });
    await importPlanner(backupFile({ app: "planner", days: {}, log: { [D1]: { wake: "06:00", water: 500 } } }));
    expect(loadDayLog(D1)).toEqual({ wake: "06:00", weight: 80, well: "Kept", water: 500 });
  });

  it("merges lists by id and keeps what's here", async () => {
    const list = addList("Mine");
    const mine = addItem(list.id, "Mine item");
    const r = await importPlanner(
      backupFile({
        app: "planner",
        days: {},
        lists: {
          lists: [{ id: "new", name: "Theirs", createdAt: 5 }],
          items: [
            { id: mine.id, listId: list.id, text: "Renamed", done: false, createdAt: 1 },
            { id: "n", listId: "new", text: "Added", done: true, createdAt: 2 },
          ],
        },
      })
    );
    expect(r).toMatchObject({ lists: 1, items: 2 });
    expect(loadLists().map((l) => l.name).sort()).toEqual(["Mine", "Theirs"]);
    expect(loadItems(list.id).map((i) => i.text)).toEqual(["Renamed"]);
    expect(loadItems("new").map((i) => i.text)).toEqual(["Added"]);
  });

  it("treats a backup as untrusted: dangerous links, bad media and wrong types are dropped", async () => {
    const r = await importPlanner(
      backupFile({
        app: "planner",
        days: {},
        log: { [D1]: { wake: 5, weight: "heavy", water: 500, drinks: [{ at: 1, ml: 2 }, { at: "x" }, null], well: { a: 1 } }, "not-a-date": { water: 1 } },
        lists: {
          lists: [{ id: "l", name: "L", icon: 7 }, { id: 5, name: "bad" }, null],
          items: [
            {
              id: "x",
              listId: "l",
              text: "Evil",
              link: "javascript:alert(1)",
              price: -5,
              note: 9,
              done: "yes",
              pinned: "yes",
              media: [
                { id: "good-media-id", kind: "image", mime: "image/png", size: 10 },
                { id: "../../secrets", kind: "image", mime: "image/png", size: 10 },
                { id: "svg-media-id", kind: "image", mime: "image/svg+xml", size: 10 },
                { id: "wrong-kind-id", kind: "voice", mime: "image/png", size: 10 },
                { id: "no-size-media", kind: "image", mime: "image/png" },
                null,
              ],
            },
            { id: "orphan", listId: "nowhere", text: "No list" },
            { id: "y", listId: "l" },
            null,
          ],
        },
      })
    );
    expect(r).toMatchObject({ logs: 1, lists: 1, items: 1 });
    expect(loadDayLog(D1)).toEqual({ water: 500, drinks: [{ at: 1, ml: 2 }] });
    expect(loadDayLog("not-a-date")).toEqual({});
    const [lst] = loadLists();
    expect(lst.icon).toBeUndefined();
    const [item] = loadItems("l");
    expect(item).toEqual({
      id: "x",
      listId: "l",
      text: "Evil",
      done: false,
      media: [{ id: "good-media-id", kind: "image", mime: "image/png", size: 10 }],
      createdAt: expect.any(Number),
    });
  });

  it("ignores a log or lists of the wrong shape", async () => {
    const r = await importPlanner(backupFile({ app: "planner", days: {}, log: "nope", lists: "nope" }));
    expect(r).toEqual({ todos: 0, days: 0, daily: 0, logs: 0, lists: 0, items: 0 });
    expect(await importPlanner(backupFile({ app: "planner", days: {}, log: { [D1]: null }, lists: { lists: 1, items: 2 } }))).toMatchObject({ logs: 1 });
  });

  it("pulls the latest first, so an import merges into it", async () => {
    await importPlanner(backupFile({ app: "planner", days: {} }));
    const asked = fetchMock.mock.calls.map(([url]) => decodeURIComponent(String(url))).join(" ");
    expect(asked).toContain("planner-lists");
    expect(asked).toContain("planner-log");
  });

  it("still imports an old single-day file", async () => {
    expect(await importPlanner(backupFile({ date: D2, todos: [todo("x")] }))).toMatchObject({ todos: 1, days: 1, daily: 0 });
    expect(ids(D2)).toEqual(["x"]);
  });

  it("rejects files that aren't planner backups", async () => {
    await expect(importPlanner(new File(["nope"], "t.json"))).rejects.toThrow("Invalid JSON backup file.");
    await expect(importPlanner(new File(["null"], "t.json"))).rejects.toThrow("Not a planner backup file.");
    await expect(importPlanner(backupFile({ todos: [] }))).rejects.toThrow("Not a planner backup file.");
    await expect(importPlanner(backupFile({ date: D1, todos: "x" }))).rejects.toThrow("Not a planner backup file.");
  });
});
