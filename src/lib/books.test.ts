// @vitest-environment jsdom
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { epubFile } from "@/test/epub";
import { pdfFile } from "@/test/pdf";
import { MAX_EPUB_BYTES, addBook, addUpload, errorText, loadLibrary, loadPosition, loadVoicePrefs, localIds, openBook, purgeRemoved, removeBook, savePosition, saveVoicePrefs } from "./books";
import { removeEntry } from "./booksDoc";
import { EpubError } from "./epub";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

// What another device sees: the book in the library, without its file.
async function removeFileOnly(id: string) {
  const db = await new Promise<IDBDatabase>((resolve) => {
    const req = indexedDB.open("books", 1);
    req.onsuccess = () => resolve(req.result);
  });
  await new Promise((resolve) => (db.transaction("files", "readwrite").objectStore("files").delete(id).onsuccess = resolve));
  db.close();
}

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
    await expect(addUpload(new File(["not an epub"], "x.epub"))).rejects.toMatchObject({ code: "invalid", message: "That file isn't an EPUB or a PDF." });
    await expect(addUpload(new File(["not an epub"], "x.epub"))).rejects.toBeInstanceOf(EpubError);
    await expect(addUpload(pdfFile([""]))).rejects.toMatchObject({ code: "scan" });
    await expect(addUpload(pdfFile(["Secret."], { encrypt: true }))).rejects.toMatchObject({ code: "encrypted" });
    const bigPdf = pdfFile(["Hello there."]);
    Object.defineProperty(bigPdf, "size", { value: MAX_EPUB_BYTES + 1 });
    await expect(addUpload(bigPdf)).rejects.toThrow("That file is too big (max 50 MB).");
    const big = new File([new Uint8Array(10)], "big.epub");
    Object.defineProperty(big, "size", { value: MAX_EPUB_BYTES + 1 });
    await expect(addUpload(big)).rejects.toThrow("too big");
    expect(loadLibrary()).toEqual([]);
  });

  it("adds nothing when reading is stopped part way", async () => {
    const stop = new AbortController();
    const file = pdfFile(Array.from({ length: 5 }, (_, i) => `Page ${i + 1}.`));
    const err = await addUpload(file, { signal: stop.signal, onProgress: (done) => done === 2 && stop.abort() }).catch((e) => e);
    expect(err.name).toBe("AbortError");
    expect(loadLibrary()).toEqual([]);
    expect([...(await localIds())]).toEqual([]);
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

describe("books that arrive from another device", () => {
  it("lists the book without its file, and adding the same file restores it with its place", async () => {
    const { entry } = await addUpload(await epubFile());
    savePosition(entry.id, 1, 2);
    await removeFileOnly(entry.id);
    expect((await localIds()).has(entry.id)).toBe(false);
    expect(loadLibrary()).toHaveLength(1);

    const again = await addUpload(await epubFile());
    expect(again).toEqual({ entry, existing: false, restored: true });
    expect((await localIds()).has(entry.id)).toBe(true);
    expect(loadPosition(entry.id)).toMatchObject({ chapter: 1, sentence: 2 });
    expect(loadLibrary()).toHaveLength(1);
  });

  it("treats a different edition as a new book with no place", async () => {
    const { entry } = await addUpload(await epubFile());
    savePosition(entry.id, 1, 2);
    const other = await addUpload(await epubFile({ chapters: [["One", ["Another edition entirely."]]] }));
    expect(other.entry.id).not.toBe(entry.id);
    expect(loadPosition(other.entry.id)).toBeUndefined();
    expect(loadLibrary()).toHaveLength(2);
  });

  it("matches a downloaded book by its catalogue id when the edition has changed", async () => {
    const first = await addBook(await (await epubFile()).arrayBuffer(), "standard-ebooks", "standard-ebooks:a/b");
    await removeFileOnly(first.entry.id);
    const newer = await epubFile({ chapters: [["One", ["A corrected edition."]]] });
    const again = await addBook(await newer.arrayBuffer(), "standard-ebooks", "standard-ebooks:a/b");
    expect(again).toMatchObject({ restored: true, entry: { id: first.entry.id } });
    expect(loadLibrary()).toHaveLength(1);
    expect((await openBook(first.entry.id))?.chapters[0].sentences).toContain("A corrected edition.");
  });
});

describe("removing books", () => {
  it("takes the book out of the library and deletes its file here", async () => {
    const { entry } = await addUpload(await epubFile());
    await removeBook(entry.id);
    expect(loadLibrary()).toEqual([]);
    expect(await openBook(entry.id)).toBeNull();
  });

  it("deletes the files of books removed on another device, and only those", async () => {
    const keep = await addUpload(await epubFile());
    const gone = await addUpload(await epubFile({ chapters: [["One", ["Other book."]]] }));
    removeEntry(gone.entry.id); // as if the removal had arrived from another device
    await purgeRemoved();
    expect(await openBook(gone.entry.id)).toBeNull();
    expect(await openBook(keep.entry.id)).not.toBeNull();
    await purgeRemoved(); // nothing left to do
  });

  it("does nothing when nothing was removed", async () => {
    const { entry } = await addUpload(await epubFile());
    await purgeRemoved();
    expect(await openBook(entry.id)).not.toBeNull();
  });
});

describe("voice choice", () => {
  it("defaults to the phone's voice at normal speed, and remembers what you pick", () => {
    expect(loadVoicePrefs()).toEqual({ voiceURI: null, rate: 1 });
    saveVoicePrefs({ voiceURI: "English India", rate: 1.5 });
    expect(loadVoicePrefs()).toEqual({ voiceURI: "English India", rate: 1.5 });
  });

  it("ignores damaged saved choices", () => {
    localStorage.setItem("books-voice-v1", "{oops");
    expect(loadVoicePrefs()).toEqual({ voiceURI: null, rate: 1 });
    localStorage.setItem("books-voice-v1", '{"voiceURI":5,"rate":"fast"}');
    expect(loadVoicePrefs()).toEqual({ voiceURI: null, rate: 1 });
  });
});
