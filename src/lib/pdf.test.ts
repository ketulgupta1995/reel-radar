// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { textPdf } from "@/test/pdf";
import { PdfError, isPdf, parsePdf } from "./pdf";

const pages = (n: number) => Array.from({ length: n }, (_, i) => `This is page ${i + 1}.`);

describe("isPdf", () => {
  it("recognises a PDF by its first bytes, whatever the file is called", () => {
    expect(isPdf(textPdf(["Hello."]))).toBe(true);
    expect(isPdf(textPdf(["Hello."]).buffer as ArrayBuffer)).toBe(true);
  });

  it("does not take a zip (an EPUB) or an empty file for a PDF", () => {
    expect(isPdf(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]))).toBe(false);
    expect(isPdf(new Uint8Array())).toBe(false);
  });
});

describe("parsePdf", () => {
  it("reads the text into sentences, keeping 'Mr.' inside its sentence", async () => {
    const book = await parsePdf(textPdf([["Mr. Smith went home.", "He was tired."]]));
    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0].sentences).toEqual(["Mr. Smith went home.", "He was tired."]);
  });

  it("takes the title and author from the PDF's metadata", async () => {
    const book = await parsePdf(textPdf(["Hello there."], { title: "A Study in Scarlet", author: "A. C. Doyle" }));
    expect(book.title).toBe("A Study in Scarlet");
    expect(book.author).toBe("A. C. Doyle");
  });

  it("falls back to the given title, then to a plain one, and to an unknown author", async () => {
    expect((await parsePdf(textPdf(["Hello there."]), "my-notes")).title).toBe("my-notes");
    const book = await parsePdf(textPdf(["Hello there."]));
    expect(book.title).toBe("Untitled");
    expect(book.author).toBe("Unknown author");
  });

  it("makes a chapter of every 10 pages, titled by page range", async () => {
    const book = await parsePdf(textPdf(pages(23)));
    expect(book.chapters.map((c) => c.title)).toEqual(["Pages 1–10", "Pages 11–20", "Pages 21–23"]);
    expect(book.chapters[0].sentences).toHaveLength(10);
    expect(book.chapters[2].sentences).toEqual(["This is page 21.", "This is page 22.", "This is page 23."]);
  });

  it("titles a group of one page 'Page n'", async () => {
    const book = await parsePdf(textPdf(pages(11)));
    expect(book.chapters.map((c) => c.title)).toEqual(["Pages 1–10", "Page 11"]);
  });

  it("keeps a sentence that runs across a page break whole", async () => {
    const book = await parsePdf(textPdf(["The long walk home was", "tiring for everyone."]));
    expect(book.chapters[0].sentences).toEqual(["The long walk home was tiring for everyone."]);
  });

  it("leaves out pages without text", async () => {
    const book = await parsePdf(textPdf(["First page.", "", "Third page."]));
    expect(book.chapters[0].sentences).toEqual(["First page.", "Third page."]);
  });

  it("reads the same bytes twice, so the caller can still hash and store them", async () => {
    const bytes = textPdf(["Hello there."]);
    await parsePdf(bytes);
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect((await parsePdf(bytes)).chapters).toHaveLength(1);
  });

  it("refuses a file that is not a readable PDF", async () => {
    await expect(parsePdf(new TextEncoder().encode("%PDF-1.4 this is not really a pdf"))).rejects.toThrow(PdfError);
    await expect(parsePdf(new Uint8Array([1, 2, 3]))).rejects.toThrow("That file isn't a valid PDF.");
  });

  it("refuses a scan, which has no text to read, and says so", async () => {
    const err = await parsePdf(textPdf(["", ""])).catch((e) => e);
    expect(err).toBeInstanceOf(PdfError);
    expect(err.code).toBe("scan");
    expect(err.message).toBe("This PDF is a scan, so there is no text to read. Use a PDF with selectable text.");
  });

  it("reads a mostly scanned PDF from the pages that have text", async () => {
    const book = await parsePdf(textPdf(["", "", "Only this page has text.", "", ""]));
    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0].sentences).toEqual(["Only this page has text."]);
  });

  it("refuses a password-protected PDF", async () => {
    const err = await parsePdf(textPdf(["Secret text."], { encrypt: true })).catch((e) => e);
    expect(err).toBeInstanceOf(PdfError);
    expect(err.code).toBe("encrypted");
    expect(err.message).toBe("This PDF is protected with a password or copy protection, so it can't be read aloud. Use an unprotected copy.");
  });

  it("refuses a file cut off in the middle as invalid", async () => {
    const err = await parsePdf(textPdf(["Hello there."]).slice(0, 40)).catch((e) => e);
    expect(err).toMatchObject({ code: "invalid", message: "That file isn't a valid PDF." });
  });

  it("reports its progress after every page, in order", async () => {
    const seen: [number, number][] = [];
    await parsePdf(textPdf(pages(4)), "x", { onProgress: (done, total) => seen.push([done, total]) });
    expect(seen).toEqual([[1, 4], [2, 4], [3, 4], [4, 4]]);
  });

  it("stops without reading further when it is told to", async () => {
    const seen: number[] = [];
    const stop = new AbortController();
    const err = await parsePdf(textPdf(pages(6)), "x", {
      signal: stop.signal,
      onProgress: (done) => {
        seen.push(done);
        if (done === 2) stop.abort();
      },
    }).catch((e) => e);
    expect(err.name).toBe("AbortError");
    expect(seen).toEqual([1, 2]);
  });

  it("does not start when it is already told to stop", async () => {
    const stop = new AbortController();
    stop.abort();
    await expect(parsePdf(textPdf(pages(2)), "x", { signal: stop.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("refuses a PDF with more pages than it will read, naming the limit", async () => {
    const err = await parsePdf(textPdf(pages(5)), "x", { maxPages: 3 }).catch((e) => e);
    expect(err).toMatchObject({ code: "limit", message: "That PDF is too long to read here (over 3 pages)." });
    expect((await parsePdf(textPdf(pages(3)), "x", { maxPages: 3 })).chapters).toHaveLength(1);
  });

  it("stops at a PDF with more text than it will read, naming the limit", async () => {
    const err = await parsePdf(textPdf(pages(5)), "x", { maxChars: 40 }).catch((e) => e);
    expect(err).toMatchObject({ code: "limit", message: "That PDF has more text than can be read here (over 40 characters)." });
  });
});
