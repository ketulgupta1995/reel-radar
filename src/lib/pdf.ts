// Reads a PDF in the browser into chapters of sentences (no "use client"; it only runs where it is called).
// pdf.js is imported on demand so it only loads on Books pages. A PDF is untrusted input: no scripts or
// embedded fonts are run, and its text only ever leaves here as plain strings.
import type { Chapter, ParsedBook } from "./epub";
import { PdfLine, joinPages, paragraphsOfPage, stripPageFurniture } from "./pdfText";
import { splitSentences } from "./sentences";

export class PdfError extends Error {
  constructor(
    public code: "invalid" | "scan" | "encrypted" | "limit",
    message: string
  ) {
    super(message);
  }
}

const PAGES_PER_CHAPTER = 10;
// Bounds on what one PDF may cost, so a huge or hostile file can't exhaust the tab's memory.
export const MAX_PDF_PAGES = 3000;
export const MAX_PDF_CHARS = 5_000_000;
export type PdfOptions = {
  maxPages?: number;
  maxChars?: number;
  onProgress?: (pagesRead: number, pages: number) => void; // after every page
  signal?: AbortSignal; // reading stops with an AbortError once this is aborted
};
const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** True when the bytes start like a PDF (the header may follow up to 1 KB of junk, as readers allow). */
export function isPdf(bytes: ArrayBuffer | Uint8Array): boolean {
  const head = new Uint8Array(bytes instanceof Uint8Array ? bytes.subarray(0, 1024) : bytes.slice(0, 1024));
  return new TextDecoder("latin1").decode(head).includes("%PDF-");
}

const invalid = () => new PdfError("invalid", "That file isn't a valid PDF.");
const encrypted = () => new PdfError("encrypted", "This PDF is protected with a password or copy protection, so it can't be read aloud. Use an unprotected copy.");

async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // In a browser pdf.js reads on its own worker thread; without Worker (tests, Node) it falls back to a built-in one.
  if (typeof Worker !== "undefined" && !pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
  }
  return pdfjs;
}

type PdfDoc = Awaited<ReturnType<Awaited<ReturnType<typeof loadPdfjs>>["getDocument"]>["promise"]>;

// The top-level outline entries (bookmarks) that point at a page, in page order. An entry with no
// destination or a destination that can't be found is skipped, and of two entries on the same page the
// first is kept. Returns [] when the PDF has no outline, so the caller falls back to groups of pages.
async function outlineStarts(doc: PdfDoc): Promise<{ title: string; page: number }[]> {
  const outline = await doc.getOutline().catch(() => null);
  const found: { title: string; page: number }[] = [];
  for (const entry of outline ?? []) {
    try {
      const dest = typeof entry.dest === "string" ? await doc.getDestination(entry.dest) : entry.dest;
      const target = dest?.[0];
      const page = typeof target === "number" ? target : target ? await doc.getPageIndex(target) : -1;
      const title = clean(entry.title);
      if (title && page >= 0 && page < doc.numPages) found.push({ title, page });
    } catch {
      // an entry that points nowhere is left out
    }
  }
  found.sort((a, b) => a.page - b.page);
  return found.filter((e, i) => i === 0 || e.page !== found[i - 1].page);
}

type TextItem = { str: string; hasEOL: boolean; transform: number[]; height: number };

// The lines of a page, in drawing order: pdf.js flags the item that ends each one.
function linesOf(items: unknown[]): PdfLine[] {
  const lines: PdfLine[] = [];
  let text = "";
  let y = 0;
  let height = 0;
  for (const item of items as Partial<TextItem>[]) {
    if (typeof item.str !== "string") continue;
    if (!text.trim() && item.str.trim()) [y, height] = [item.transform?.[5] ?? 0, item.height ?? 0];
    text += item.str;
    if (item.hasEOL) {
      if (clean(text)) lines.push({ text: clean(text), y, height });
      text = "";
    }
  }
  if (clean(text)) lines.push({ text: clean(text), y, height });
  return lines;
}

const rangeTitle = (from: number, to: number) => (from === to ? `Page ${from}` : `Pages ${from}–${to}`);

// `fallbackTitle` names a PDF that has no title of its own (the caller knows the file name).
export async function parsePdf(bytes: ArrayBuffer | Uint8Array, fallbackTitle = "Untitled", options: PdfOptions = {}): Promise<ParsedBook> {
  const { maxPages = MAX_PDF_PAGES, maxChars = MAX_PDF_CHARS, onProgress, signal } = options;
  signal?.throwIfAborted();
  const pdfjs = await loadPdfjs();
  // pdf.js takes over the buffer it is given, so it gets a copy and the caller can still hash and store the file.
  const data = new Uint8Array(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).slice();
  const task = pdfjs.getDocument({ data, disableFontFace: true, enableXfa: false, verbosity: 0 });
  const doc = await task.promise.catch(async (err: unknown) => {
    await task.destroy();
    if ((err as { name?: string } | null)?.name === "PasswordException") throw encrypted();
    throw invalid();
  });

  try {
    if (doc.numPages > maxPages) throw new PdfError("limit", `That PDF is too long to read here (over ${maxPages} pages).`);
    const pageLines: PdfLine[][] = [];
    let chars = 0;
    for (let n = 1; n <= doc.numPages; n++) {
      signal?.throwIfAborted();
      const lines = linesOf((await (await doc.getPage(n)).getTextContent()).items);
      chars += lines.reduce((sum, line) => sum + line.text.length, 0);
      if (chars > maxChars) throw new PdfError("limit", `That PDF has more text than can be read here (over ${maxChars.toLocaleString("en-US")} characters).`);
      pageLines.push(lines);
      onProgress?.(n, doc.numPages);
    }
    const pageParagraphs = stripPageFurniture(pageLines).map(paragraphsOfPage);

    // Chapters are the outline's top-level entries, with any text before the first one kept as an opening
    // chapter; a PDF without a usable outline is cut into groups of pages instead.
    const starts = await outlineStarts(doc);
    const ranges: { title: string; from: number; to: number }[] = [];
    if (starts.length) {
      if (starts[0].page > 0) ranges.push({ title: rangeTitle(1, starts[0].page), from: 0, to: starts[0].page });
      starts.forEach((e, i) => ranges.push({ title: e.title, from: e.page, to: starts[i + 1]?.page ?? pageParagraphs.length }));
    } else {
      for (let from = 0; from < pageParagraphs.length; from += PAGES_PER_CHAPTER) {
        const to = Math.min(from + PAGES_PER_CHAPTER, pageParagraphs.length);
        ranges.push({ title: rangeTitle(from + 1, to), from, to });
      }
    }
    const chapters: Chapter[] = [];
    for (const { title, from, to } of ranges) {
      const sentences = joinPages(pageParagraphs.slice(from, to)).flatMap(splitSentences);
      if (sentences.length) chapters.push({ title, sentences });
    }
    if (!chapters.length) throw new PdfError("scan", "This PDF is a scan, so there is no text to read. Use a PDF with selectable text.");

    const info = ((await doc.getMetadata().catch(() => null))?.info ?? {}) as { Title?: unknown; Author?: unknown };
    const text = (v: unknown) => (typeof v === "string" ? clean(v) : "");
    return { title: text(info.Title) || fallbackTitle, author: text(info.Author) || "Unknown author", chapters };
  } finally {
    await task.destroy();
  }
}
