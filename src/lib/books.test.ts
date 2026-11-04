// @vitest-environment jsdom
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { epubFile } from "@/test/epub";
import { MAX_EPUB_BYTES, addUpload, errorText, loadLibrary, openBook } from "./books";
import { EpubError } from "./epub";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe("books on this device", () => {
  it("adds an uploaded EPUB to the library and keeps its text readable", async () => {
    const { entry, existing } = await addUpload(await epubFile());
    expect(existing).toBe(false);
    expect(entry).toMatchObject({ title: "The Station Clock", author: "A. Writer", source: "upload" });
    expect(entry.id).toBe(entry.hash.slice(0, 16));
    expect(loadLibrary()).toEqual([entry]);

    const book = await openBook(entry.id);
    expect(book?.chapters.map((c) => c.title)).toEqual(["Chapter One", "Chapter Two"]);
  });

  it("adds the same file only once, and puts newer books first", async () => {
    const first = await addUpload(await epubFile());
    const again = await addUpload(await epubFile());
    expect(again).toEqual({ entry: first.entry, existing: true });

    const other = await addUpload(await epubFile({ title: "Another Book", chapters: [["One", ["Different text."]]] }));
    expect(loadLibrary().map((b) => b.id)).toEqual([other.entry.id, first.entry.id]);
  });

  it("refuses copy-protected, invalid and oversized files without adding them", async () => {
    await expect(addUpload(await epubFile({ rights: true }))).rejects.toMatchObject({ code: "drm" });
    await expect(addUpload(new File(["not an epub"], "x.epub"))).rejects.toBeInstanceOf(EpubError);
    const big = new File([new Uint8Array(10)], "big.epub");
    Object.defineProperty(big, "size", { value: MAX_EPUB_BYTES + 1 });
    await expect(addUpload(big)).rejects.toThrow("too big");
    expect(loadLibrary()).toEqual([]);
  });

  it("reports a book whose file isn't on this device as missing", async () => {
    expect(await openBook("0123456789abcdef")).toBeNull();
  });

  it("ignores a damaged library entry in storage", () => {
    localStorage.setItem("books-library-v1", "{oops");
    expect(loadLibrary()).toEqual([]);
    localStorage.setItem("books-library-v1", '{"a":1}');
    expect(loadLibrary()).toEqual([]);
  });

  it("words errors for the reader", () => {
    expect(errorText(new EpubError("drm", "Copy protected."))).toBe("Copy protected.");
    expect(errorText("weird")).toBe("That file couldn't be added.");
  });
});
