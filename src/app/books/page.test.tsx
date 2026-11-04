// @vitest-environment jsdom
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, configure, within } from "@testing-library/react";
import { getApp } from "@/lib/apps";
import { epubFile, makeEpub } from "@/test/epub";
import { opdsFeed } from "@/test/gutenberg";
import { bytesResponse, resultsPage, textResponse } from "@/test/standardEbooks";
import { loadLibrary } from "@/lib/books";

import BooksPage from "./page";

// Reading an EPUB (build, hash, parse) is slow when the machine is busy, as it is under coverage.
configure({ asyncUtilTimeout: 5000 });

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});
afterEach(() => vi.unstubAllGlobals());

const upload = (file: File) => fireEvent.change(screen.getByLabelText("Upload an EPUB"), { target: { files: [file] } });

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

  it("ignores choosing no file", () => {
    render(<BooksPage />);
    fireEvent.change(screen.getByLabelText("Upload an EPUB"), { target: { files: [] } });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("lists the books already saved on this device", () => {
    localStorage.setItem(
      "books-library-v1",
      JSON.stringify([{ id: "abc", title: "Saved Book", author: "Someone", source: "upload", hash: "abc", addedAt: 1 }])
    );
    render(<BooksPage />);
    expect(screen.getByRole("link", { name: /Saved Book/ }).getAttribute("href")).toBe("/books/abc");
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
    expect(fetch).not.toHaveBeenCalled();
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
