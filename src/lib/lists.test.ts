// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addItem,
  addList,
  moveTodoToList,
  cleanLink,
  clearDone,
  deleteItem,
  deleteList,
  getItem,
  linkHost,
  loadItems,
  loadLists,
  mergeLists,
  openCounts,
  parsePrice,
  parseQuickItem,
  planItem,
  searchItems,
  sortItems,
  syncLists,
  toggleItem,
  totalPrice,
  updateItem,
  updateList,
  type ListItem,
} from "./lists";
import { flush } from "./sync";
import { getTodayDate, loadTodos, saveTodos } from "./todos";
import { jsonResponse } from "@/test/fixtures";

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => jsonResponse({ etag: '"e1"' }));
  vi.stubGlobal("fetch", fetchMock);
});

const stored = () => JSON.parse(localStorage.getItem("reel-radar-planner-lists") || "null");
const photo = { id: "photo-0001", kind: "image" as const, mime: "image/jpeg", size: 10 };
const voice = { id: "voice-0001", kind: "voice" as const, mime: "audio/webm", size: 20, seconds: 4 };

describe("lists", () => {
  it("adds, renames and deletes lists, oldest first", () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(1000).mockReturnValueOnce(1000).mockReturnValueOnce(500).mockReturnValueOnce(500);
    const wish = addList("  Wishlist ", "🎁");
    const ideas = addList("", undefined);
    expect(wish).toMatchObject({ name: "Wishlist", icon: "🎁" });
    expect(ideas.name).toBe("Untitled list");
    expect("icon" in ideas).toBe(false);
    expect(loadLists().map((l) => l.id)).toEqual([ideas.id, wish.id]);

    updateList(ideas.id, { name: "Ideas", icon: "💡" });
    updateList(wish.id, { name: "   " }); // blank keeps the name
    expect(loadLists().map((l) => `${l.icon} ${l.name}`)).toEqual(["💡 Ideas", "🎁 Wishlist"]);

    addItem(wish.id, "Headphones", { media: [photo] });
    addItem(ideas.id, "App idea");
    expect(deleteList(wish.id)).toEqual([photo]);
    expect(loadLists().map((l) => l.name)).toEqual(["Ideas"]);
    expect(loadItems(wish.id)).toEqual([]);
    expect(loadItems(ideas.id).map((i) => i.text)).toEqual(["App idea"]);
  });

  it("keeps items with their details, and clears fields set to undefined", () => {
    const list = addList("Wishlist");
    const other = addList("Gifts");
    const item = addItem(list.id, " Shoes ", { price: 2500, link: "https://x.com/a", note: "" });
    expect(item).toMatchObject({ text: "Shoes", price: 2500, link: "https://x.com/a", done: false });
    expect("note" in item).toBe(false);
    expect(getItem(item.id)).toEqual(item);
    expect(getItem("nope")).toBeUndefined();

    updateItem(item.id, { note: "Size 9", pinned: true, media: [photo], text: "  " });
    expect(getItem(item.id)).toMatchObject({ text: "Shoes", note: "Size 9", pinned: true, media: [photo] });
    updateItem(item.id, { note: undefined, price: undefined, pinned: false, media: [], text: "Running shoes" });
    const after = getItem(item.id)!;
    expect(after.text).toBe("Running shoes");
    expect(["note", "price", "pinned", "media"].filter((k) => k in after)).toEqual([]);

    updateItem(item.id, { listId: other.id });
    expect(loadItems(list.id)).toEqual([]);
    expect(loadItems(other.id).map((i) => i.id)).toEqual([item.id]);
  });

  it("ticks items off and back, and clears done ones with their media", () => {
    const list = addList("Wishlist");
    const a = addItem(list.id, "A", { media: [voice] });
    const b = addItem(list.id, "B", { price: 100 });
    toggleItem(a.id);
    expect(getItem(a.id)).toMatchObject({ done: true });
    expect(getItem(a.id)!.doneAt).toBeGreaterThan(0);
    expect(openCounts()).toEqual({ [list.id]: 1 });
    toggleItem(b.id);
    toggleItem(b.id);
    expect(getItem(b.id)!.done).toBe(false);
    expect("doneAt" in getItem(b.id)!).toBe(false);

    expect(clearDone(list.id)).toEqual([voice]);
    expect(loadItems(list.id).map((i) => i.text)).toEqual(["B"]);
    expect(deleteItem(b.id)).toEqual([]);
    expect(deleteItem("gone")).toEqual([]);
    expect(loadItems(list.id)).toEqual([]);
  });

  it("sorts pinned first, then newest, then done ones most recent first", () => {
    const it = (id: string, extra: Partial<ListItem>): ListItem => ({ id, listId: "l", text: id, done: false, createdAt: 0, ...extra });
    const sorted = sortItems([
      it("old", { createdAt: 1 }),
      it("doneEarly", { done: true, doneAt: 5 }),
      it("new", { createdAt: 3 }),
      it("pinned", { createdAt: 0, pinned: true }),
      it("doneLate", { done: true, doneAt: 9 }),
      it("doneUnknown", { done: true }),
    ]);
    expect(sorted.map((i) => i.id)).toEqual(["pinned", "new", "old", "doneLate", "doneEarly", "doneUnknown"]);
  });

  it("searches every list's text, notes and links", () => {
    const a = addList("A");
    const b = addList("B");
    addItem(a.id, "Blue lamp");
    addItem(b.id, "Chair", { note: "the BLUE one" });
    addItem(b.id, "Desk", { link: "https://shop.in/blue-desk" });
    addItem(b.id, "Rug");
    expect(searchItems("blue").map((i) => i.text).sort()).toEqual(["Blue lamp", "Chair", "Desk"]);
    expect(searchItems("  ")).toEqual([]);
  });

  it("totals the prices of what's still to do", () => {
    const base = { listId: "l", createdAt: 0 };
    expect(
      totalPrice([
        { ...base, id: "a", text: "a", done: false, price: 100 },
        { ...base, id: "b", text: "b", done: true, price: 50 },
        { ...base, id: "c", text: "c", done: false },
      ])
    ).toBe(100);
  });

  it("adds an item to today's tasks with its note and link", () => {
    planItem({ id: "i", listId: "l", text: "Buy gift", note: "For Sam", link: "https://x.com/", done: false, createdAt: 0 });
    planItem({ id: "j", listId: "l", text: "Call", done: false, createdAt: 0 }, "2026-01-02");
    expect(loadTodos(getTodayDate())).toEqual([expect.objectContaining({ text: "Buy gift", note: "For Sam\nhttps://x.com/" })]);
    expect(loadTodos("2026-01-02")[0]).not.toHaveProperty("note");
  });

  it("starts empty when the saved copy is missing or broken", () => {
    localStorage.setItem("reel-radar-planner-lists", "{oops");
    expect(loadLists()).toEqual([]);
    localStorage.setItem("reel-radar-planner-lists", JSON.stringify({ lists: [] }));
    expect(loadLists()).toEqual([]);
  });
});

describe("links and prices", () => {
  it("accepts only web links, adding https:// when left out", () => {
    expect(cleanLink("amazon.in/dp/1")).toBe("https://amazon.in/dp/1");
    expect(cleanLink(" http://a.com ")).toBe("http://a.com/");
    expect(cleanLink("javascript:alert(1)")).toBeUndefined();
    expect(cleanLink("ftp://a.com")).toBeUndefined();
    expect(cleanLink("not a link")).toBeUndefined();
    expect(cleanLink("localhost")).toBeUndefined();
    expect(cleanLink("")).toBeUndefined();
    expect(linkHost("https://www.flipkart.com/x")).toBe("flipkart.com");
    expect(linkHost("garbage")).toBe("garbage");
  });

  it("reads prices written several ways", () => {
    expect(parsePrice("2500")).toBe(2500);
    expect(parsePrice("₹2,500")).toBe(2500);
    expect(parsePrice("Rs. 99.5")).toBe(99.5);
    expect(parsePrice("INR 10")).toBe(10);
    expect(parsePrice("0")).toBeUndefined();
    expect(parsePrice("ten")).toBeUndefined();
    expect(parsePrice("")).toBeUndefined();
  });

  it("pulls a link and a price out of the add box", () => {
    expect(parseQuickItem("Headphones ₹2,999 amazon.in/x")).toEqual({ text: "Headphones", price: 2999, link: "https://amazon.in/x" });
    expect(parseQuickItem("Book rs 450")).toEqual({ text: "Book", price: 450 });
    expect(parseQuickItem("https://www.myntra.com/shoes")).toEqual({ text: "myntra.com", link: "https://www.myntra.com/shoes" });
    expect(parseQuickItem("  Call   mum  ")).toEqual({ text: "Call mum" });
    expect(parseQuickItem("Pay ₹0 later")).toEqual({ text: "Pay ₹0 later" });
  });
});

describe("sync", () => {
  it("pushes changes as one planner-lists doc", async () => {
    addList("Wishlist");
    await flush();
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(1);
    const body = JSON.parse(posts[0][1].body);
    expect(body.key).toBe("planner-lists");
    expect(body.data.lists[0].value.name).toBe("Wishlist");
  });

  it("doesn't mark anything dirty when nothing changed", async () => {
    const list = addList("A");
    await flush();
    fetchMock.mockClear();
    updateList(list.id, { name: "A" });
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pulls other devices' lists in", async () => {
    const server = { lists: [{ value: { id: "s", name: "From phone", createdAt: 1 }, updatedAt: 1 }], items: [] };
    fetchMock.mockResolvedValueOnce(jsonResponse({ docs: { "planner-lists": { etag: '"s1"', data: server } } }));
    expect(await syncLists(true)).toBe(true);
    expect(decodeURIComponent(fetchMock.mock.calls[0][0])).toBe("/api/sync?keys=planner-lists");
    expect(loadLists().map((l) => l.name)).toEqual(["From phone"]);
    expect(stored().lists).toHaveLength(1);
  });

  it("merges three ways: the later edit wins and deletes carry across", () => {
    const entry = (id: string, name: string, updatedAt: number) => ({ value: { id, name, createdAt: 0 }, updatedAt });
    const base = { lists: [entry("a", "A", 1), entry("b", "B", 1)], items: [] };
    const local = { lists: [entry("a", "A local", 3)], items: [] }; // deleted b
    const server = { lists: [entry("a", "A server", 2), entry("b", "B", 1), entry("c", "C", 2)], items: [] };
    expect(mergeLists(local, server, base).lists.map((e) => e.value.name)).toEqual(["A local", "C"]);
    expect(mergeLists({ lists: [], items: [] }, server).lists).toHaveLength(3);
    expect(mergeLists({} as never, {} as never)).toEqual({ lists: [], items: [] });
  });
});

describe("moving a task to a list", () => {
  it("keeps its note and open steps, and takes it off the day", () => {
    const day = "2026-03-01";
    const list = addList("Someday");
    const task = { id: "t", text: "Learn piano", completed: false, createdAt: "", note: "Buy keyboard", subtasks: [{ id: "1", text: "Find teacher", done: false }, { id: "2", text: "Done bit", done: true }] };
    saveTodos([task], day);
    const item = moveTodoToList(task, day, list.id);
    expect(item).toMatchObject({ text: "Learn piano", note: "Buy keyboard\n- Find teacher", listId: list.id });
    expect(loadTodos(day)).toEqual([]);
    const plain = { id: "p", text: "Plain", completed: false, createdAt: "" };
    saveTodos([plain], day);
    expect(moveTodoToList(plain, day, list.id).note).toBeUndefined();
  });
});
