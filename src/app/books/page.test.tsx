// @vitest-environment jsdom
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, configure, waitFor, within } from "@testing-library/react";
import { getApp } from "@/lib/apps";
import { epubFile, makeEpub } from "@/test/epub";
import { pdfFile } from "@/test/pdf";
import { opdsFeed } from "@/test/gutenberg";
import { jsonResponse } from "@/test/fixtures";
import { routeFetch } from "@/test/pages";
import { bytesResponse, resultsPage, textResponse } from "@/test/standardEbooks";
import { addUpload, loadLibrary, loadPosition, savePosition } from "@/lib/books";
import { addEntry, removeEntry } from "@/lib/booksDoc";

// parsePdf is the real one unless a test holds it part way, to look at the page while a PDF is being read.
const reading = vi.hoisted(() => ({ hold: null as null | ((opts: { onProgress?: (d: number, t: number) => void; signal?: AbortSignal }) => Promise<void>) }));
vi.mock("@/lib/pdf", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/pdf")>();
  return {
    ...real,
    parsePdf: async (bytes: ArrayBuffer, title?: string, opts: Parameters<typeof real.parsePdf>[2] = {}) => {
      const hold = reading.hold;
      reading.hold = null;
      await hold?.(opts);
      return real.parsePdf(bytes, title, opts);
    },
  };
});

import BooksPage from "./page";

// Reading an EPUB (build, hash, parse) is slow when the machine is busy, as it is under coverage.
configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 20_000 });

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  routeFetch(); // an empty sync server, unless a test stubs its own
});
afterEach(() => vi.unstubAllGlobals());

const upload = (file: File) => fireEvent.change(screen.getByLabelText("Upload an EPUB or PDF"), { target: { files: [file] } });

describe("Books page", () => {
  it("is registered as an app and opens at its own address", () => {
    const app = getApp("books");
    expect(app.name).toBe("Books");
    expect(app.href).toBe("/books");
  });

  it("starts with an empty library that names the two ways to add a book", () => {
    render(<BooksPage />);
    expect(screen.getByRole("heading", { name: "Your library is empty" })).toBeTruthy();
    expect(screen.getByText(/search/i, { selector: "li" })).toBeTruthy();
    expect(screen.getByText(/upload/i, { selector: "li" })).toBeTruthy();
  });

  it("has the app switcher header, leading to the other apps", () => {
    render(<BooksPage />);
    expect(screen.getByRole("link", { name: "Books" }).getAttribute("href")).toBe("/books");
    fireEvent.click(screen.getByRole("button", { name: "Switch app" }));
    expect(screen.getByRole("link", { name: "🎬 Reel Radar" }).getAttribute("href")).toBe("/reel-radar");
  });

  it("adds an uploaded EPUB to the library, and says so when it's uploaded again", async () => {
    render(<BooksPage />);
    upload(await epubFile());
    await screen.findByText("Added “The Station Clock”.");
    const link = screen.getByRole("link", { name: /The Station Clock/ });
    expect(link.getAttribute("href")).toBe(`/books/${loadLibrary()[0].id}`);
    expect(screen.queryByText("Your library is empty")).toBeNull();

    upload(await epubFile());
    await screen.findByText("“The Station Clock” is already in your library.");
    expect(loadLibrary()).toHaveLength(1);
  });

  it("shows a plain message for a copy-protected file and adds nothing", async () => {
    render(<BooksPage />);
    upload(await epubFile({ rights: true }));
    await screen.findByText(/copy protection/);
    expect(loadLibrary()).toEqual([]);
    expect(screen.getByText("Your library is empty")).toBeTruthy();
  });

  it("adds an uploaded PDF marked as one, named from its metadata, and only once", async () => {
    render(<BooksPage />);
    upload(pdfFile([["Mr. Rao kept the clock fast."]], { title: "Station Notes", author: "I. Rao" }));
    await screen.findByText("Added “Station Notes”.");
    const link = await screen.findByRole("link", { name: /Station Notes/ });
    expect(link.getAttribute("href")).toBe(`/books/${loadLibrary()[0].id}`);
    expect(loadLibrary()[0]).toMatchObject({ title: "Station Notes", author: "I. Rao", source: "upload", format: "pdf" });
    expect(within(screen.getByLabelText("Your library")).getByText("PDF")).toBeTruthy();

    upload(pdfFile([["Mr. Rao kept the clock fast."]], { title: "Station Notes", author: "I. Rao" }));
    await screen.findByText("“Station Notes” is already in your library.");
    expect(loadLibrary()).toHaveLength(1);
  });

  it("names a PDF with no title after its file", async () => {
    render(<BooksPage />);
    upload(pdfFile(["Hello there."], {}, "my-notes.pdf"));
    await screen.findByText("Added “my-notes”.");
    expect(loadLibrary()[0].title).toBe("my-notes");
  });

  it("does not mark an EPUB as a PDF", async () => {
    render(<BooksPage />);
    upload(await epubFile());
    await screen.findByText("Added “The Station Clock”.");
    expect(loadLibrary()[0].format).toBeUndefined();
    expect(within(screen.getByLabelText("Your library")).queryByText("PDF")).toBeNull();
  });

  it("recognises a PDF by its contents, not its name", async () => {
    render(<BooksPage />);
    upload(pdfFile(["Hello there."], { title: "Disguised" }, "book.epub"));
    await screen.findByText("Added “Disguised”.");
    expect(loadLibrary()[0].format).toBe("pdf");
  });

  it.each([
    ["a scan", () => pdfFile([""]), /scan, so there is no text to read/],
    ["a password-protected PDF", () => pdfFile(["Secret."], { encrypt: true }), /password or copy protection/],
    ["a damaged PDF", () => new File([new TextEncoder().encode("%PDF-1.4 broken") as BlobPart], "x.pdf"), /isn't a valid PDF/],
    ["a file that is not a book", () => new File(["hello"], "notes.txt"), /isn't an EPUB or a PDF/],
  ])("shows a plain message for %s and adds nothing", async (_name, file, message) => {
    render(<BooksPage />);
    upload(file());
    await screen.findByText(message);
    expect(loadLibrary()).toEqual([]);
    expect(screen.getByText("Your library is empty")).toBeTruthy();
  });

  it("shows text from a PDF only as text", async () => {
    render(<BooksPage />);
    upload(pdfFile(["<img src=x onerror=alert(1)> Hello."], { title: "<b>Bold</b> title" }));
    const link = await screen.findByRole("link", { name: /Bold/ });
    expect(link.textContent).toContain("<b>Bold</b> title");
    expect(document.querySelector("img, b")).toBeNull();
  });

  it("shows how far a PDF has been read, and finishes", async () => {
    let release = () => {};
    reading.hold = async (opts) => {
      opts.onProgress?.(3, 12);
      await new Promise<void>((resolve) => (release = resolve));
    };
    render(<BooksPage />);
    upload(pdfFile([["Mr. Rao kept the clock fast."]], { title: "Station Notes" }));
    const bar = await screen.findByRole("progressbar", { name: "Reading the PDF" });
    expect(bar.getAttribute("value")).toBe("3");
    expect(bar.getAttribute("max")).toBe("12");
    expect(screen.getByText("Reading page 3 of 12…")).toBeTruthy();
    expect((screen.getByLabelText("Adding…") as HTMLInputElement).disabled).toBe(true);

    release();
    await screen.findByText("Added “Station Notes”.");
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("stops reading a PDF when the page is left, and adds nothing", async () => {
    let release = () => {};
    let signal: AbortSignal | undefined;
    reading.hold = async (opts) => {
      signal = opts.signal;
      opts.onProgress?.(1, 12);
      await new Promise<void>((resolve) => (release = resolve));
    };
    const view = render(<BooksPage />);
    upload(pdfFile([["Mr. Rao kept the clock fast."]], { title: "Station Notes" }));
    await screen.findByRole("progressbar");
    view.unmount();
    expect(signal?.aborted).toBe(true);
    release();
    await new Promise((r) => setTimeout(r, 50));
    expect(loadLibrary()).toEqual([]);
  });

  it("ignores choosing no file", () => {
    render(<BooksPage />);
    fireEvent.change(screen.getByLabelText("Upload an EPUB or PDF"), { target: { files: [] } });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("lists the books already saved on this device, newest first", async () => {
    await addUpload(await epubFile({ title: "First Book" }));
    await new Promise((r) => setTimeout(r, 5));
    await addUpload(await epubFile({ title: "Second Book", chapters: [["One", ["Different text."]]] }));
    render(<BooksPage />);
    const list = await screen.findByLabelText("Your library");
    expect(within(list).getAllByRole("link").map((l) => l.textContent)).toEqual(["Second BookA. Writer", "First BookA. Writer"]);
  });
});

describe("Searching for books", () => {
  const page = resultsPage([
    ["jane-austen/emma", "Emma", ["Jane Austen"]],
    ["jane-austen/persuasion", "Persuasion", ["Jane Austen"]],
  ]);
  const search = (text: string) => {
    fireEvent.change(screen.getByLabelText("Search for a book"), { target: { value: text } });
    fireEvent.submit(screen.getByRole("search"));
  };
  // Standard Ebooks is `handler`; Gutenberg answers with an empty feed unless `gutenberg` says otherwise.
  const stub = (handler: (url: string) => Response | Promise<Response>, gutenberg: (url: string) => Response | Promise<Response> = () => textResponse(opdsFeed([]))) => {
    const fetch = vi.fn(async (url: string) => (url.includes("gutenberg.org/ebooks/search") || url.startsWith("/api/books/gutenberg/") ? gutenberg(url) : handler(url)));
    vi.stubGlobal("fetch", fetch);
    return fetch;
  };

  it("lists results with their author and source, and adds a book to the library", async () => {
    const epub = await makeEpub({ title: "Emma", author: "Jane Austen" });
    const fetch = stub((url) => (url.includes("/downloads/") ? bytesResponse(epub) : textResponse(page)));
    render(<BooksPage />);
    search("austen");
    await screen.findByText("Results for “austen”");
    expect(screen.getAllByText("Jane Austen · Standard Ebooks")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Add Emma" }));
    await screen.findByText("Added “Emma”.");
    expect(fetch.mock.calls.at(-1)![0]).toContain("jane-austen_emma.epub");
    expect(loadLibrary()[0]).toMatchObject({ title: "Emma", source: "standard-ebooks", sourceId: "standard-ebooks:jane-austen/emma" });
    expect(screen.getByText("In your library")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add Emma" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add Persuasion" })).toBeTruthy();
  });

  it("says when nothing matches", async () => {
    stub(() => textResponse(resultsPage([])));
    render(<BooksPage />);
    search("zzzz");
    await screen.findByText(/No books found/);
  });

  it("shows a plain message when the sources are down, and a search can be retried", async () => {
    stub(() => Promise.reject(new Error("offline")), () => Promise.reject(new Error("offline")));
    render(<BooksPage />);
    search("austen");
    await screen.findByText(/Couldn't reach Standard Ebooks/);
    expect(screen.queryByLabelText("Search results")).toBeNull();

    stub(() => textResponse(page));
    search("austen");
    await screen.findByText("Results for “austen”");
    expect(screen.queryByText(/Couldn't reach/)).toBeNull();
  });

  it("shows a plain message when a download fails or the book is copy-protected", async () => {
    const protectedEpub = await makeEpub({ rights: true });
    let fail = true;
    stub((url) => (url.includes("/downloads/") ? (fail ? bytesResponse(new Uint8Array(1), false) : bytesResponse(protectedEpub)) : textResponse(page)));
    render(<BooksPage />);
    search("austen");
    await screen.findByText("Results for “austen”");
    fireEvent.click(screen.getByRole("button", { name: "Add Emma" }));
    await screen.findByText(/Couldn't reach Standard Ebooks/);
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Add Emma" }));
    await screen.findByText(/copy protection/);
    expect(loadLibrary()).toEqual([]);
  });

  it("ignores a blank search", () => {
    const fetch = stub(() => textResponse(page));
    render(<BooksPage />);
    search("   ");
    expect(fetch.mock.calls.filter(([url]) => !String(url).startsWith("/api/sync"))).toEqual([]);
  });

  const pgFeed = () => textResponse(opdsFeed([[1342, "Pride and Prejudice", "Jane Austen"], [158, "Emma", "Jane Austen"]]));

  it("lists both sources together, with duplicates left out and Standard Ebooks first", async () => {
    stub(() => textResponse(page), pgFeed);
    render(<BooksPage />);
    search("austen");
    await screen.findByText("Results for “austen”");
    const rows = within(screen.getByLabelText("Search results")).getAllByText(/ · /).map((r) => r.textContent);
    expect(rows).toEqual(["Jane Austen · Standard Ebooks", "Jane Austen · Standard Ebooks", "Jane Austen · Project Gutenberg"]);
    expect(screen.getAllByText("Emma")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Add Pride and Prejudice" })).toBeTruthy();
  });

  it("adds a Gutenberg book through our download route", async () => {
    const epub = await makeEpub({ title: "Pride and Prejudice", author: "Jane Austen" });
    const fetch = stub(() => textResponse(resultsPage([])), (url) => (url.startsWith("/api/books/gutenberg/") ? bytesResponse(epub) : pgFeed()));
    render(<BooksPage />);
    search("pride");
    await screen.findByText("Results for “pride”");
    fireEvent.click(screen.getByRole("button", { name: "Add Pride and Prejudice" }));
    await screen.findByText("Added “Pride and Prejudice”.");
    expect(fetch.mock.calls.at(-1)![0]).toBe("/api/books/gutenberg/1342");
    expect(loadLibrary()[0]).toMatchObject({ source: "gutenberg", sourceId: "gutenberg:1342" });
  });

  it("explains a Gutenberg book that is too big, and adds nothing", async () => {
    stub(
      () => textResponse(resultsPage([])),
      (url) => (url.startsWith("/api/books/gutenberg/") ? ({ ok: false, status: 413, json: async () => ({ error: "That book is too big to download here (over 4.5 MB)." }) } as Response) : pgFeed())
    );
    render(<BooksPage />);
    search("pride");
    await screen.findByText("Results for “pride”");
    fireEvent.click(screen.getByRole("button", { name: "Add Emma" }));
    await screen.findByText(/over 4.5 MB/);
    expect(loadLibrary()).toEqual([]);
  });

  it("still shows one source when the other is down, and says so", async () => {
    stub(() => textResponse(page), () => Promise.reject(new Error("slow")));
    render(<BooksPage />);
    search("austen");
    await screen.findByText("Results for “austen”");
    expect(screen.getByText(/Couldn't reach Project Gutenberg\. Check your connection and try again\. Showing the other source only\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add Emma" })).toBeTruthy();
  });

  it("fails with one message when both sources are down", async () => {
    stub(() => Promise.reject(new Error("a")), () => Promise.reject(new Error("b")));
    render(<BooksPage />);
    search("austen");
    await screen.findByText(/Couldn't reach/);
    expect(screen.queryByLabelText("Search results")).toBeNull();
  });
});

describe("A library shared between devices", () => {
  const entry = (id: string, extra = {}) => ({ id, title: `Book ${id}`, author: "A. Writer", source: "upload" as const, hash: id, addedAt: Date.now(), ...extra });
  const serverWith = (items: object[]) => {
    const fetch = vi.fn(async (url: string) =>
      String(url).startsWith("/api/sync") ? jsonResponse({ docs: { books: { etag: '"s1"', data: { items } } } }) : jsonResponse({})
    );
    vi.stubGlobal("fetch", fetch);
    return fetch;
  };

  it("shows a book from another device and asks for its file", async () => {
    serverWith([{ entry: entry("abc", { title: "From The Laptop" }), updatedAt: 5 }]);
    render(<BooksPage />);
    await screen.findByText("From The Laptop");
    await screen.findByText("The file isn't on this device.");
    expect(screen.getByText("Add the file on this device")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /From The Laptop/ })).toBeNull();
  });

  it("restores the file and keeps your place when you add the same file", async () => {
    const file = await epubFile();
    const { entry: made } = await addUpload(file);
    savePosition(made.id, 1, 2);
    // This device has the library entry and place, but not the file.
    const db = await new Promise<IDBDatabase>((r) => (indexedDB.open("books", 1).onsuccess = (e) => r((e.target as IDBOpenDBRequest).result)));
    await new Promise((r) => (db.transaction("files", "readwrite").objectStore("files").delete(made.id).onsuccess = r));
    db.close();

    render(<BooksPage />);
    await screen.findByText("The file isn't on this device.");
    fireEvent.change(screen.getByLabelText(`Add the file for ${made.title}`), { target: { files: [await epubFile()] } });
    await screen.findByText(`Added the file for “${made.title}”. Your place is kept.`);
    await waitFor(() => expect(screen.getByRole("link", { name: new RegExp(made.title) })).toBeTruthy());
    expect(loadPosition(made.id)).toMatchObject({ chapter: 1, sentence: 2 });
  });

  it("says when the file added is a different edition, which becomes a new book", async () => {
    serverWith([{ entry: entry("abc", { title: "Old Edition" }), updatedAt: 5 }]);
    render(<BooksPage />);
    await screen.findByText("The file isn't on this device.");
    fireEvent.change(screen.getByLabelText("Add the file for Old Edition"), { target: { files: [await epubFile()] } });
    await screen.findByText(/different edition/);
    expect(loadLibrary()).toHaveLength(2);
  });

  describe("with a PDF", () => {
    const station = () => pdfFile([["Mr. Rao kept the clock fast."]], { title: "Station Notes" });
    const dropFile = async (id: string) => {
      const db = await new Promise<IDBDatabase>((r) => (indexedDB.open("books", 1).onsuccess = (e) => r((e.target as IDBOpenDBRequest).result)));
      await new Promise((r) => (db.transaction("files", "readwrite").objectStore("files").delete(id).onsuccess = r));
      db.close();
    };

    it("shows a PDF from another device with its badge, and asks for its file", async () => {
      serverWith([{ entry: entry("abc", { title: "From The Laptop", format: "pdf" }), updatedAt: 5 }]);
      render(<BooksPage />);
      await screen.findByText("The file isn't on this device.");
      expect(within(screen.getByLabelText("Your library")).getByText("PDF")).toBeTruthy();
      expect(screen.getByText("Add the file on this device")).toBeTruthy();
      expect(screen.queryByRole("link", { name: /From The Laptop/ })).toBeNull();
    });

    it("restores the file and keeps your place when you add the same PDF", async () => {
      const { entry: made } = await addUpload(station());
      savePosition(made.id, 0, 0);
      await dropFile(made.id);

      render(<BooksPage />);
      await screen.findByText("The file isn't on this device.");
      fireEvent.change(screen.getByLabelText(`Add the file for ${made.title}`), { target: { files: [station()] } });
      await screen.findByText(`Added the file for “${made.title}”. Your place is kept.`);
      await waitFor(() => expect(screen.getByRole("link", { name: new RegExp(made.title) })).toBeTruthy());
      expect(loadLibrary()).toHaveLength(1);
      expect(loadLibrary()[0].format).toBe("pdf");
      expect(loadPosition(made.id)).toMatchObject({ chapter: 0, sentence: 0 });
    });

    it("says when the PDF added is a different edition, which becomes a new book without the old place", async () => {
      serverWith([{ entry: entry("abc", { title: "Old Edition", format: "pdf" }), position: { chapter: 3, sentence: 9 }, updatedAt: 5 }]);
      render(<BooksPage />);
      await screen.findByText("The file isn't on this device.");
      fireEvent.change(screen.getByLabelText("Add the file for Old Edition"), { target: { files: [station()] } });
      await screen.findByText(/different edition/);
      expect(loadLibrary()).toHaveLength(2);
      const added = loadLibrary().find((b) => b.id !== "abc")!;
      expect(loadPosition(added.id)).toBeUndefined();
    });

    it("removes a PDF everywhere, deleting its file here", async () => {
      const { entry: made } = await addUpload(station());
      render(<BooksPage />);
      fireEvent.click(await screen.findByRole("button", { name: `Remove ${made.title}` }));
      fireEvent.click(screen.getByText("Yes, remove"));
      await screen.findByText("Your library is empty");
      const { localIds } = await import("@/lib/books");
      expect((await localIds()).has(made.id)).toBe(false);
    });

    it("deletes the file of a PDF that was removed on another device", async () => {
      const { entry: made } = await addUpload(station());
      serverWith([{ entry: made, removed: true, updatedAt: Date.now() + 1000 }]);
      render(<BooksPage />);
      await screen.findByText("Your library is empty");
      const { localIds } = await import("@/lib/books");
      await waitFor(async () => expect((await localIds()).has(made.id)).toBe(false));
    });
  });

  it("downloads a catalogue book again with one tap", async () => {
    const epub = await makeEpub({ title: "Emma", author: "Jane Austen" });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (String(url).includes("/downloads/") ? bytesResponse(epub) : jsonResponse({ docs: {} }))));
    addEntry(entry("zzz", { title: "Emma", source: "standard-ebooks", sourceId: "standard-ebooks:jane-austen/emma" }));
    render(<BooksPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Download Emma" }));
    await screen.findByText(/Added the file for “Emma”/);
    await waitFor(() => expect(screen.getByRole("link", { name: /Emma/ })).toBeTruthy());
    expect(loadLibrary()).toHaveLength(1);
  });

  it("removes a book after asking, from the library and this device", async () => {
    const { entry: made } = await addUpload(await epubFile());
    render(<BooksPage />);
    fireEvent.click(await screen.findByRole("button", { name: `Remove ${made.title}` }));
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.getByRole("link", { name: new RegExp(made.title) })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: `Remove ${made.title}` }));
    expect(screen.getByText("Remove it from every device?")).toBeTruthy();
    fireEvent.click(screen.getByText("Yes, remove"));
    await screen.findByText("Your library is empty");
    expect(screen.getByText("Removed from your library on every device.")).toBeTruthy();
    expect(loadLibrary()).toEqual([]);
  });

  it("deletes the file of a book that was removed on another device", async () => {
    const { entry: made } = await addUpload(await epubFile());
    serverWith([{ entry: made, removed: true, updatedAt: Date.now() + 1000 }]);
    render(<BooksPage />);
    await screen.findByText("Your library is empty");
    const { localIds } = await import("@/lib/books");
    await waitFor(async () => expect((await localIds()).has(made.id)).toBe(false));
  });

  it("updates when another device's changes arrive while the page is open", async () => {
    render(<BooksPage />);
    await screen.findByText("Your library is empty");
    addEntry(entry("new", { title: "Just Arrived" }));
    act(() => void window.dispatchEvent(new CustomEvent("reel-radar-sync", { detail: { keys: ["books"] } })));
    await screen.findByText("Just Arrived");
    removeEntry("new");
  });
});
