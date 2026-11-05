// Reads a PDF in the browser into chapters of sentences (no "use client"; it only runs where it is called).
// pdf.js is imported on demand so it only loads on Books pages. A PDF is untrusted input: no scripts or
// embedded fonts are run, and its text only ever leaves here as plain strings.
import type { Chapter, ParsedBook } from "./epub";
import { splitSentences } from "./sentences";

export class PdfError extends Error {
  constructor(
    public code: "invalid",
    message: string
  ) {
    super(message);
  }
}

const PAGES_PER_CHAPTER = 10;
const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** True when the bytes start like a PDF (the header may follow up to 1 KB of junk, as readers allow). */
export function isPdf(bytes: ArrayBuffer | Uint8Array): boolean {
  const head = new Uint8Array(bytes instanceof Uint8Array ? bytes.subarray(0, 1024) : bytes.slice(0, 1024));
  return new TextDecoder("latin1").decode(head).includes("%PDF-");
}

const invalid = () => new PdfError("invalid", "That file isn't a valid PDF.");

async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // In a browser pdf.js reads on its own worker thread; without Worker (tests, Node) it falls back to a built-in one.
  if (typeof Worker !== "undefined" && !pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
  }
  return pdfjs;
}

const rangeTitle = (from: number, to: number) => (from === to ? `Page ${from}` : `Pages ${from}–${to}`);

// `fallbackTitle` names a PDF that has no title of its own (the caller knows the file name).
export async function parsePdf(bytes: ArrayBuffer | Uint8Array, fallbackTitle = "Untitled"): Promise<ParsedBook> {
  const pdfjs = await loadPdfjs();
  // pdf.js takes over the buffer it is given, so it gets a copy and the caller can still hash and store the file.
  const data = new Uint8Array(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).slice();
  const task = pdfjs.getDocument({ data, disableFontFace: true, enableXfa: false, verbosity: 0 });
  const doc = await task.promise.catch(async () => {
    await task.destroy();
    throw invalid();
  });

  try {
    const pageTexts: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      pageTexts.push(clean(content.items.map((item) => ("str" in item ? item.str + (item.hasEOL ? " " : "") : "")).join("")));
    }

    const chapters: Chapter[] = [];
    for (let from = 0; from < pageTexts.length; from += PAGES_PER_CHAPTER) {
      const group = pageTexts.slice(from, from + PAGES_PER_CHAPTER);
      const sentences = splitSentences(group.filter(Boolean).join(" "));
      if (sentences.length) chapters.push({ title: rangeTitle(from + 1, from + group.length), sentences });
    }
    if (!chapters.length) throw new PdfError("invalid", "No readable text was found in that PDF.");

    const info = ((await doc.getMetadata().catch(() => null))?.info ?? {}) as { Title?: unknown; Author?: unknown };
    const text = (v: unknown) => (typeof v === "string" ? clean(v) : "");
    return { title: text(info.Title) || fallbackTitle, author: text(info.Author) || "Unknown author", chapters };
  } finally {
    await task.destroy();
  }
}
