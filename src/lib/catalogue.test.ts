// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { opdsFeed } from "@/test/gutenberg";
import { bytesResponse, resultsPage, textResponse } from "@/test/standardEbooks";
import { downloadFound, mergeResults, searchCatalogue, sourceName } from "./catalogue";
import { Found, SourceError } from "./sources";

afterEach(() => vi.unstubAllGlobals());

const f = (source: Found["source"], title: string, author: string, n = 1): Found => ({ source, sourceId: `${source}:${n}`, title, author, epubUrl: "x" });

describe("mergeResults", () => {
  it("lists a book once, keeping the Standard Ebooks edition when it comes first", () => {
    const merged = mergeResults(
      [f("standard-ebooks", "Pride and Prejudice", "Jane Austen")],
      [f("gutenberg", "Pride and Prejudice", "Austen, Jane", 2), f("gutenberg", "Pride & Prejudice", "Jane Austen", 3), f("gutenberg", "Emma", "Jane Austen", 4)]
    );
    expect(merged.map((m) => m.sourceId)).toEqual(["standard-ebooks:1", "gutenberg:4"]);
  });

  it("ignores a leading The and punctuation, and needs a name in common", () => {
    expect(mergeResults([f("standard-ebooks", "The Iliad", "Homer, William Cullen Bryant")], [f("gutenberg", "Iliad", "Homer", 2)])).toHaveLength(1);
    expect(mergeResults([f("standard-ebooks", "Emma", "Jane Austen")], [f("gutenberg", "Emma", "Someone Else", 2)])).toHaveLength(2);
  });
});

describe("searchCatalogue", () => {
  const stub = (se: () => Promise<Response> | Response, pg: () => Promise<Response> | Response) =>
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.includes("gutenberg.org") ? pg() : se())));
  const sePage = () => textResponse(resultsPage([["jane-austen/emma", "Emma", ["Jane Austen"]]]));
  const pgFeed = () => textResponse(opdsFeed([[158, "Emma", "Jane Austen"], [1342, "Pride and Prejudice", "Jane Austen"]]));

  it("asks both sources and merges their results", async () => {
    stub(sePage, pgFeed);
    const { results, problems } = await searchCatalogue("austen");
    expect(results.map((r) => r.sourceId)).toEqual(["standard-ebooks:jane-austen/emma", "gutenberg:1342"]);
    expect(problems).toEqual([]);
  });

  it("still shows one source's results, with a note, when the other fails", async () => {
    stub(sePage, () => Promise.reject(new Error("slow")));
    const { results, problems } = await searchCatalogue("austen");
    expect(results).toHaveLength(1);
    expect(problems).toEqual([expect.stringContaining("Project Gutenberg")]);

    stub(() => textResponse("", false), pgFeed);
    expect((await searchCatalogue("austen")).problems[0]).toContain("Standard Ebooks");
  });

  it("fails when both sources fail", async () => {
    stub(() => Promise.reject(new Error("a")), () => Promise.reject(new Error("b")));
    await expect(searchCatalogue("austen")).rejects.toBeInstanceOf(SourceError);
  });

  it("names the right download for each source", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => bytesResponse(new Uint8Array([1]))));
    const se = { ...f("standard-ebooks", "A", "B"), epubUrl: "https://standardebooks.org/ebooks/a/b/downloads/a_b.epub" };
    const pg = { ...f("gutenberg", "A", "B"), epubUrl: "/api/books/gutenberg/5" };
    expect((await downloadFound(se)).byteLength).toBe(1);
    expect((await downloadFound(pg)).byteLength).toBe(1);
    expect([sourceName(se), sourceName(pg)]).toEqual(["Standard Ebooks", "Project Gutenberg"]);
  });
});
