// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { opdsFeed } from "@/test/gutenberg";
import { bytesResponse, textResponse } from "@/test/standardEbooks";
import { downloadGutenberg, gutenbergPath, parseFeed, searchGutenberg } from "./gutenberg";
import { SourceError } from "./sources";

afterEach(() => vi.unstubAllGlobals());
const stubFetch = (impl: (url: string) => Promise<Response> | Response) => {
  const fetch = vi.fn(async (url: string) => impl(url));
  vi.stubGlobal("fetch", fetch);
  return fetch;
};

describe("Project Gutenberg", () => {
  it("reads books from the feed, skipping groupings, and names the download route", () => {
    const found = parseFeed(
      opdsFeed([
        [null, "Subjects", "One subject heading matches your search."],
        [1342, "Pride and Prejudice", "Jane Austen"],
        [10471, "The World's Greatest Books", "1,228 downloads"],
        [9, "", "Nobody"],
      ])
    );
    expect(found).toEqual([
      { source: "gutenberg", sourceId: "gutenberg:1342", title: "Pride and Prejudice", author: "Jane Austen", epubUrl: "/api/books/gutenberg/1342" },
      expect.objectContaining({ sourceId: "gutenberg:10471", author: "Unknown author" }),
    ]);
    expect(gutenbergPath("5")).toBe("/api/books/gutenberg/5");
  });

  it("reports a reply that isn't a feed", () => {
    expect(() => parseFeed("<html><body>Maintenance</body></html>")).toThrow(/unexpected/);
    expect(() => parseFeed("not xml <")).toThrow(SourceError);
  });

  it("searches the feed with the query encoded, and explains when it can't be reached", async () => {
    const fetch = stubFetch(() => textResponse(opdsFeed([[1, "A", "B"]])));
    expect(await searchGutenberg("pride & prejudice")).toHaveLength(1);
    expect(fetch.mock.calls[0][0]).toBe("https://www.gutenberg.org/ebooks/search.opds/?query=pride%20%26%20prejudice");

    stubFetch(() => Promise.reject(new Error("offline")));
    await expect(searchGutenberg("x")).rejects.toThrow("Couldn't reach Project Gutenberg");
    stubFetch(() => textResponse("", false));
    await expect(searchGutenberg("x")).rejects.toBeInstanceOf(SourceError);
  });

  it("downloads through our route, passing on its message when it refuses", async () => {
    stubFetch(() => bytesResponse(new Uint8Array([7, 8])));
    expect(new Uint8Array(await downloadGutenberg("/api/books/gutenberg/1342"))).toEqual(new Uint8Array([7, 8]));

    stubFetch(() => ({ ok: false, status: 413, json: async () => ({ error: "Too big for here." }) }) as Response);
    await expect(downloadGutenberg("/api/books/gutenberg/1342")).rejects.toThrow("Too big for here.");
    stubFetch(() => ({ ok: false, status: 500, json: async () => Promise.reject(new Error("no json")) }) as unknown as Response);
    await expect(downloadGutenberg("/api/books/gutenberg/1342")).rejects.toThrow("Couldn't reach Project Gutenberg");
    stubFetch(() => Promise.reject(new Error("offline")));
    await expect(downloadGutenberg("/api/books/gutenberg/1342")).rejects.toThrow("Couldn't reach Project Gutenberg");
  });

  it("only downloads from our own route, and not past the size limit", async () => {
    const fetch = stubFetch(() => bytesResponse(new Uint8Array(1)));
    await expect(downloadGutenberg("https://evil.example/x")).rejects.toBeInstanceOf(SourceError);
    await expect(downloadGutenberg("/api/books/gutenberg/12/../../x")).rejects.toBeInstanceOf(SourceError);
    expect(fetch).not.toHaveBeenCalled();
    stubFetch(() => bytesResponse(new Uint8Array(50_000_001)));
    await expect(downloadGutenberg("/api/books/gutenberg/1")).rejects.toThrow("too big");
  });
});
