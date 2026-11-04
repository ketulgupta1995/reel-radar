// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { bytesResponse, resultsPage, textResponse } from "@/test/standardEbooks";
import { SourceError, downloadEpub, epubUrlOf, parseResults, searchStandardEbooks } from "./standardEbooks";

afterEach(() => vi.unstubAllGlobals());
const stubFetch = (impl: (url: string) => Promise<Response> | Response) => {
  const fetch = vi.fn(async (url: string) => impl(url));
  vi.stubGlobal("fetch", fetch);
  return fetch;
};

describe("Standard Ebooks", () => {
  it("reads title, authors and download address from a results page", () => {
    const found = parseResults(
      resultsPage([
        ["jane-austen/emma", "Emma", ["Jane Austen"]],
        ["homer/the-iliad/william-cullen-bryant", "The Iliad", ["Homer", "William Cullen Bryant"]],
      ])
    );
    expect(found).toEqual([
      {
        sourceId: "standard-ebooks:jane-austen/emma",
        title: "Emma",
        author: "Jane Austen",
        epubUrl: "https://standardebooks.org/ebooks/jane-austen/emma/downloads/jane-austen_emma.epub?source=download",
      },
      expect.objectContaining({
        sourceId: "standard-ebooks:homer/the-iliad/william-cullen-bryant",
        author: "Homer, William Cullen Bryant",
        epubUrl: epubUrlOf("homer/the-iliad/william-cullen-bryant"),
      }),
    ]);
    expect(epubUrlOf("homer/the-iliad/william-cullen-bryant")).toContain("/downloads/homer_the-iliad_william-cullen-bryant.epub");
  });

  it("skips entries with an odd address or no title, and fills in a missing author", () => {
    const html = resultsPage([
      ["jane-austen/emma", "Emma", []],
      ["../../etc/passwd", "Sneaky", ["X"]],
      ["a/b", "", ["Y"]],
    ]);
    expect(parseResults(html)).toEqual([expect.objectContaining({ title: "Emma", author: "Unknown author" })]);
  });

  it("treats a results page with no list as no results, but a changed layout as an error", () => {
    expect(parseResults(resultsPage([]))).toEqual([]);
    expect(() => parseResults("<html><body><p>Redesigned!</p></body></html>")).toThrow(/changed its search page/);
  });

  it("searches the site with the query encoded", async () => {
    const fetch = stubFetch(() => textResponse(resultsPage([["jane-austen/emma", "Emma", ["Jane Austen"]]])));
    expect(await searchStandardEbooks("jane austen & co")).toHaveLength(1);
    expect(fetch.mock.calls[0][0]).toBe("https://standardebooks.org/ebooks?query=jane%20austen%20%26%20co");
  });

  it("explains when the site can't be reached", async () => {
    stubFetch(() => Promise.reject(new Error("offline")));
    await expect(searchStandardEbooks("emma")).rejects.toThrow("Couldn't reach Standard Ebooks");
    stubFetch(() => textResponse("", false));
    await expect(searchStandardEbooks("emma")).rejects.toBeInstanceOf(SourceError);
  });

  it("downloads an EPUB, but only from Standard Ebooks and only up to the size limit", async () => {
    stubFetch(() => bytesResponse(new Uint8Array([1, 2, 3])));
    expect(new Uint8Array(await downloadEpub(epubUrlOf("jane-austen/emma")))).toEqual(new Uint8Array([1, 2, 3]));

    const fetch = stubFetch(() => bytesResponse(new Uint8Array(1)));
    await expect(downloadEpub("https://evil.example/ebooks/x.epub")).rejects.toBeInstanceOf(SourceError);
    expect(fetch).not.toHaveBeenCalled();

    stubFetch(() => bytesResponse(new Uint8Array(50_000_001)));
    await expect(downloadEpub(epubUrlOf("jane-austen/emma"))).rejects.toThrow("too big");
  });
});
