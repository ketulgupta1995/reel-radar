// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse } from "@/test/fixtures";
import { BOOKS_DOC, BookEntry, addEntry, commitPosition, loadLibrary, loadPosition, loadRecording, mergeBooks, pushPosition, removeEntry, removedIds, savePosition, setRecording, syncBooks } from "./booksDoc";

const entry = (id: string, extra: Partial<BookEntry> = {}): BookEntry => ({ id, title: `Book ${id}`, author: "A. Writer", source: "upload", hash: id.repeat(4), addedAt: 100, ...extra });
const META = `reel-radar-sync:${BOOKS_DOC}`;
const dirty = () => JSON.parse(localStorage.getItem(META) || "{}").dirty === true;
const item = (id: string, updatedAt: number, extra: object = {}) => ({ entry: entry(id), updatedAt, ...extra });

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ etag: '"e"', docs: {} })));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("library and positions", () => {
  it("lists books newest first and marks the doc for syncing", () => {
    expect(loadLibrary()).toEqual([]);
    addEntry(entry("a", { addedAt: 100 }));
    addEntry(entry("b", { addedAt: 200 }));
    expect(loadLibrary().map((b) => b.id)).toEqual(["b", "a"]);
    expect(dirty()).toBe(true);
  });

  it("removes a book from the library but remembers that it was removed", () => {
    addEntry(entry("a"));
    savePosition("a", 1, 2);
    removeEntry("a");
    removeEntry("a"); // twice does nothing more
    removeEntry("nope");
    expect(loadLibrary()).toEqual([]);
    expect(removedIds()).toEqual(["a"]);
    expect(loadPosition("a")).toBeUndefined();
    savePosition("a", 3, 3); // a removed book keeps no place
    expect(loadPosition("a")).toBeUndefined();
  });

  it("adding a removed book again brings it back without its old place", () => {
    addEntry(entry("a"));
    savePosition("a", 1, 2);
    removeEntry("a");
    addEntry(entry("a"));
    expect(loadLibrary().map((b) => b.id)).toEqual(["a"]);
    expect(loadPosition("a")).toBeUndefined();
    expect(removedIds()).toEqual([]);
  });

  it("saves a position at once but only queues it for syncing when committed", () => {
    addEntry(entry("a"));
    localStorage.setItem(META, JSON.stringify({ etag: '"e"', dirty: false }));
    expect(loadPosition("a")).toBeUndefined();

    savePosition("a", 2, 14);
    savePosition("a", 2, 15);
    expect(loadPosition("a")).toMatchObject({ chapter: 2, sentence: 15 });
    expect(dirty()).toBe(false);

    commitPosition();
    expect(dirty()).toBe(true);
  });

  it("ignores a position that hasn't changed, a book that isn't there, and a commit with nothing to queue", () => {
    addEntry(entry("a"));
    commitPosition(); // the add already queued the doc; clear it to see what commits do
    localStorage.setItem(META, JSON.stringify({ dirty: false }));
    savePosition("a", 1, 1);
    commitPosition();
    localStorage.setItem(META, JSON.stringify({ dirty: false }));
    savePosition("a", 1, 1);
    savePosition("missing", 1, 1);
    commitPosition();
    expect(dirty()).toBe(false);
  });

  it("pushes at once when the page is going away", async () => {
    addEntry(entry("a"));
    savePosition("a", 1, 1);
    pushPosition();
    await vi.waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([, init]) => (init as RequestInit)?.method === "POST")).toBe(true));
  });

  it("starts empty when the saved doc is damaged", () => {
    localStorage.setItem("reel-radar-books", "{oops");
    expect(loadLibrary()).toEqual([]);
    localStorage.setItem("reel-radar-books", '{"items":5}');
    expect(loadLibrary()).toEqual([]);
  });
});

describe("chosen recording", () => {
  it("is remembered per book, can be cleared, and syncs", () => {
    addEntry(entry("a"));
    expect(loadRecording("a")).toBeNull();
    localStorage.setItem(META, JSON.stringify({ dirty: false }));
    setRecording("a", { id: "253", title: "Pride and Prejudice" });
    expect(loadRecording("a")).toEqual({ id: "253", title: "Pride and Prejudice" });
    expect(dirty()).toBe(true);
    setRecording("a", null);
    expect(loadRecording("a")).toBeNull();
    setRecording("missing", { id: "1", title: "x" }); // no such book: nothing happens
    expect(loadRecording("missing")).toBeNull();
    removeEntry("a");
    setRecording("a", { id: "1", title: "x" });
    expect(loadRecording("a")).toBeNull();
  });
});

describe("books saved before syncing existed", () => {
  it("moves the old library and places into the synced doc, once", () => {
    localStorage.setItem("books-library-v1", JSON.stringify([entry("a", { addedAt: 5 }), entry("b", { addedAt: 9 })]));
    localStorage.setItem("books-position-v1", JSON.stringify({ a: { chapter: 3, sentence: 7, updatedAt: 50 } }));
    expect(loadLibrary().map((b) => b.id)).toEqual(["b", "a"]);
    expect(loadPosition("a")).toMatchObject({ chapter: 3, sentence: 7 });
    expect(loadPosition("b")).toBeUndefined();
    expect(localStorage.getItem("books-library-v1")).toBeNull();
    expect(localStorage.getItem("books-position-v1")).toBeNull();
    expect(dirty()).toBe(true);
  });

  it("drops damaged or empty old data without queueing anything", () => {
    localStorage.setItem("books-library-v1", "{oops");
    localStorage.setItem("books-position-v1", "[]");
    expect(loadLibrary()).toEqual([]);
    expect(localStorage.getItem("books-library-v1")).toBeNull();
    expect(dirty()).toBe(false);
  });
});

describe("mergeBooks", () => {
  const doc = (...items: ReturnType<typeof item>[]) => ({ items });

  it("keeps the newest change to a book, so the latest position wins", () => {
    const local = doc(item("a", 10, { position: { chapter: 1, sentence: 1 } }));
    const server = doc(item("a", 20, { position: { chapter: 4, sentence: 9 } }));
    const base = doc(item("a", 5));
    expect(mergeBooks(local, server, base).items[0].position).toEqual({ chapter: 4, sentence: 9 });
    expect(mergeBooks(server, local, base).items[0].position).toEqual({ chapter: 4, sentence: 9 });
  });

  it("keeps a recording chosen on one device and a place saved later on another", () => {
    const chosen = item("a", 10, { recording: { id: "253", title: "P&P" }, recordingAt: 20 });
    const moved = item("a", 30, { position: { chapter: 4, sentence: 1 } });
    for (const merged of [mergeBooks(doc(chosen), doc(moved)), mergeBooks(doc(moved), doc(chosen))]) {
      expect(merged.items[0]).toMatchObject({ recording: { id: "253" }, position: { chapter: 4, sentence: 1 }, updatedAt: 30 });
    }
  });

  it("takes the later choice of recording, including clearing it", () => {
    const first = item("a", 10, { recording: { id: "1", title: "One" }, recordingAt: 20 });
    const later = item("a", 10, { recording: { id: "2", title: "Two" }, recordingAt: 40 });
    const cleared = item("a", 10, { recording: null, recordingAt: 50 });
    expect(mergeBooks(doc(first), doc(later)).items[0].recording).toEqual({ id: "2", title: "Two" });
    expect(mergeBooks(doc(later), doc(first)).items[0].recording).toEqual({ id: "2", title: "Two" });
    expect(mergeBooks(doc(later), doc(cleared)).items[0].recording).toBeNull();
    expect(mergeBooks(doc(item("a", 1)), doc(item("a", 2, { position: { chapter: 1, sentence: 1 } }))).items[0]).not.toHaveProperty("recordingAt");
  });

  it("keeps books that only one side has, and a removal can't be undone by an older or newer copy", () => {
    const removed = { entry: entry("a"), removed: true as const, updatedAt: 10 };
    const moved = item("a", 99, { position: { chapter: 2, sentence: 2 } });
    for (const merged of [mergeBooks(doc(moved), doc(removed), doc(item("a", 1))), mergeBooks(doc(removed), doc(moved), doc(item("a", 1)))]) {
      expect(merged.items).toHaveLength(1);
      expect(merged.items[0]).toMatchObject({ removed: true });
      expect(merged.items[0].position).toBeUndefined();
    }
    expect(mergeBooks(doc(item("a", 1)), doc(item("b", 2))).items.map((i) => i.entry.id).sort()).toEqual(["a", "b"]);
    expect(mergeBooks({ items: undefined } as never, { items: undefined } as never).items).toEqual([]);
  });
});

// Two devices (each with its own browser storage) and one server, to see a library follow you.
describe("two devices", () => {
  let server: { etag: string; data: unknown } | null;
  let version: number;
  const devices: Record<string, Record<string, string>> = { phone: {}, laptop: {} };

  beforeEach(() => {
    server = null;
    version = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = new URL(input, "http://localhost");
        if (init?.method === "POST") {
          const { data, baseEtag } = JSON.parse(init.body as string);
          if (server && baseEtag !== server.etag) return jsonResponse(server, { status: 409 });
          if (!server && baseEtag) return jsonResponse({ etag: null, data: null }, { status: 409 });
          server = { etag: `"v${++version}"`, data };
          return jsonResponse({ etag: server.etag });
        }
        const sent = url.searchParams.get("keys")!.split(":")[1];
        const doc = !server ? null : sent === server.etag ? { etag: server.etag, unchanged: true } : server;
        return jsonResponse({ docs: { [BOOKS_DOC]: doc } });
      })
    );
    devices.phone = {};
    devices.laptop = {};
  });

  // Run `fn` as one device: its storage is swapped in, and saved again afterwards.
  async function on<T>(name: keyof typeof devices, fn: () => Promise<T> | T): Promise<T> {
    localStorage.clear();
    Object.entries(devices[name]).forEach(([k, v]) => localStorage.setItem(k, v));
    try {
      return await fn();
    } finally {
      devices[name] = Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)!]));
    }
  }
  const push = async () => {
    commitPosition();
    const { flush } = await import("./sync");
    await flush([BOOKS_DOC]);
  };

  it("shows a book and your place on another device, and follows a move back", async () => {
    await on("phone", async () => {
      addEntry(entry("a"));
      savePosition("a", 2, 30);
      await push();
    });

    await on("laptop", async () => {
      expect(loadLibrary()).toEqual([]);
      await syncBooks(true);
      expect(loadLibrary().map((b) => b.id)).toEqual(["a"]);
      expect(loadPosition("a")).toMatchObject({ chapter: 2, sentence: 30 });
      await new Promise((r) => setTimeout(r, 5));
      savePosition("a", 3, 4); // later than the phone's
      await push();
    });

    await on("phone", async () => {
      await syncBooks(true);
      expect(loadPosition("a")).toMatchObject({ chapter: 3, sentence: 4 });
    });
  });

  it("removes a book everywhere, even if the other device moved on after", async () => {
    await on("phone", async () => {
      addEntry(entry("a"));
      await push();
    });
    await on("laptop", async () => {
      await syncBooks(true);
      await new Promise((r) => setTimeout(r, 5));
      removeEntry("a");
      await push();
    });
    await on("phone", async () => {
      await new Promise((r) => setTimeout(r, 5));
      savePosition("a", 5, 5); // moves on without having seen the removal
      commitPosition();
      await syncBooks(true);
      expect(loadLibrary()).toEqual([]);
      expect(removedIds()).toEqual(["a"]);
    });
  });
});
