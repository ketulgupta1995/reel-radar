// @vitest-environment jsdom
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, configure } from "@testing-library/react";
import { getApp } from "@/lib/apps";
import { epubFile } from "@/test/epub";
import { loadLibrary } from "@/lib/books";

import BooksPage from "./page";

// Reading an EPUB (build, hash, parse) is slow when the machine is busy, as it is under coverage.
configure({ asyncUtilTimeout: 5000 });

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

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
