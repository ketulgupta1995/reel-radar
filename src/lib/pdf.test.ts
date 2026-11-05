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

  describe("cleaning the text", () => {
    const names = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"];
    const sentences = async (pageList: Parameters<typeof textPdf>[0]) => (await parsePdf(textPdf(pageList))).chapters.flatMap((c) => c.sentences);

    it("leaves out running headers, footers and page numbers", async () => {
      const pagesWithFurniture = names.map((name, i) => [
        { text: "THE STATION CLOCK", y: 750 },
        { text: `${name} walked in.`, y: 600 },
        { text: `${name} sat down.`, y: 584 },
        { text: `${name} left.`, y: 568 },
        { text: `Page ${i + 1}`, y: 40 },
      ]);
      expect(await sentences(pagesWithFurniture)).toEqual(names.flatMap((n) => [`${n} walked in.`, `${n} sat down.`, `${n} left.`]));
    });

    it("keeps a line repeated on only two pages of a short document", async () => {
      expect(await sentences([["Meanwhile, all was well."], ["Meanwhile, all was well."]])).toEqual(["Meanwhile, all was well.", "Meanwhile, all was well."]);
    });

    it("rejoins a word hyphenated across a line, but not a hyphen inside a line", async () => {
      expect(await sentences([["A well-known conver-", "sation went on."]])).toEqual(["A well-known conversation went on."]);
    });

    it("rejoins a word hyphenated across a page break", async () => {
      expect(await sentences([["A long conver-"], ["sation went on."]])).toEqual(["A long conversation went on."]);
    });

    it("keeps a heading apart from the text under it", async () => {
      expect(await sentences([[{ text: "Chapter One", y: 700 }, { text: "It was dark.", y: 650 }, { text: "Very dark.", y: 634 }]])).toEqual(["Chapter One", "It was dark.", "Very dark."]);
    });
  });

  describe("multiple columns", () => {
    const left = (i: number) => ({ text: `Left column line ${"a".repeat(i)}.`, y: 700 - i * 16, x: 72 });
    const right = (i: number) => ({ text: `Right column line ${"b".repeat(i)}.`, y: 700 - i * 16, x: 330 });
    const twoColumnPage = Array.from({ length: 14 }, (_, i) => [left(i), right(i)]).flat();
    const longLine = (i: number) => ({ text: `This single column line number ${i} runs right across the whole width of the page here.`, y: 700 - i * 16 });

    it("warns that a PDF with two columns may read out of order, and still reads it", async () => {
      const book = await parsePdf(textPdf([twoColumnPage, twoColumnPage, twoColumnPage]));
      expect(book.warning).toBe("This PDF looks like it has two columns, so it may read out of order.");
      expect(book.chapters.length).toBeGreaterThan(0);
    });

    it("does not warn about a single column", async () => {
      const page = Array.from({ length: 14 }, (_, i) => longLine(i));
      expect((await parsePdf(textPdf([page, page, page]))).warning).toBeUndefined();
    });
  });

  describe("with an outline", () => {
    const six = ["Alpha one.", "Alpha two.", "Beta one.", "Beta two.", "Gamma one.", "Gamma two."];
    const titles = (book: { chapters: { title: string }[] }) => book.chapters.map((c) => c.title);

    it("makes a chapter of each top-level entry, from its page to the next entry's", async () => {
      const book = await parsePdf(
        textPdf(six, {
          outline: [
            { title: "Alpha", page: 1 },
            { title: "Beta", page: 3 },
            { title: "Gamma", page: 5 },
          ],
        })
      );
      expect(titles(book)).toEqual(["Alpha", "Beta", "Gamma"]);
      expect(book.chapters.map((c) => c.sentences)).toEqual([
        ["Alpha one.", "Alpha two."],
        ["Beta one.", "Beta two."],
        ["Gamma one.", "Gamma two."],
      ]);
    });

    it("keeps the text before the first entry as an opening chapter", async () => {
      const book = await parsePdf(textPdf(six, { outline: [{ title: "Beta", page: 3 }] }));
      expect(titles(book)).toEqual(["Pages 1–2", "Beta"]);
      expect(book.chapters[0].sentences).toEqual(["Alpha one.", "Alpha two."]);
      expect(book.chapters[1].sentences).toHaveLength(4);
    });

    it("uses only the top level, and puts entries in page order", async () => {
      const book = await parsePdf(
        textPdf(six, {
          outline: [
            { title: "Gamma", page: 5 },
            { title: "Alpha", page: 1, children: [{ title: "Alpha sub", page: 2 }] },
          ],
        })
      );
      expect(titles(book)).toEqual(["Alpha", "Gamma"]);
    });

    it("keeps the first of two entries on the same page", async () => {
      const book = await parsePdf(
        textPdf(six, {
          outline: [
            { title: "Alpha", page: 1 },
            { title: "Also alpha", page: 1 },
            { title: "Beta", page: 3 },
          ],
        })
      );
      expect(titles(book)).toEqual(["Alpha", "Beta"]);
    });

    it("skips an entry that points nowhere", async () => {
      const book = await parsePdf(
        textPdf(six, {
          outline: [
            { title: "Alpha", page: 1 },
            { title: "No destination", page: null },
            { title: "Off the end", page: 40 },
            { title: "Gamma", page: 5 },
          ],
        })
      );
      expect(titles(book)).toEqual(["Alpha", "Gamma"]);
      expect(book.chapters[0].sentences).toHaveLength(4);
    });

    it("falls back to groups of 10 pages when no entry can be placed", async () => {
      const book = await parsePdf(textPdf(six, { outline: [{ title: "Lost", page: null }] }));
      expect(titles(book)).toEqual(["Pages 1–6"]);
    });

    it("leaves out a chapter whose pages have no text", async () => {
      const book = await parsePdf(textPdf(["Alpha one.", "", "", "Gamma one."], { outline: [{ title: "Alpha", page: 1 }, { title: "Blank", page: 2 }, { title: "Gamma", page: 4 }] }));
      expect(titles(book)).toEqual(["Alpha", "Gamma"]);
    });
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
