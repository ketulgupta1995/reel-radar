// Reads an EPUB in the browser into chapters of sentences (pure apart from DOMParser; no "use client").
// jszip is imported on demand so it only loads on Books pages.
import { splitSentences } from "./sentences";

export type Chapter = { title: string; sentences: string[] };
export type ParsedBook = { title: string; author: string; chapters: Chapter[]; warning?: string }; // a warning is shown with the book, not an error

export class EpubError extends Error {
  constructor(
    public code: "invalid" | "drm",
    message: string
  ) {
    super(message);
  }
}

// Font obfuscation is not copy protection; any other encryption is.
const FONT_ALGORITHMS = ["http://www.idpf.org/2008/embedding", "http://ns.adobe.com/pdf/enc#RC"];
const MAX_CHAPTERS = 2000;
const BLOCKS = "p,h1,h2,h3,h4,h5,h6,li,blockquote,dt,dd,pre,figcaption,td,th";

const xml = (text: string, type: DOMParserSupportedType = "application/xml") => new DOMParser().parseFromString(text, type);
const tags = (root: Document | Element, name: string) => Array.from(root.getElementsByTagNameNS("*", name));
const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

// "OEBPS/content.opf" + "text/ch1.xhtml#a" -> "OEBPS/text/ch1.xhtml"
function resolve(from: string, href: string): string {
  const parts = from.split("/").slice(0, -1);
  for (const part of decodeURIComponent(href.split("#")[0]).split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
}

function paragraphsOf(html: string): { heading: string; paragraphs: string[] } {
  let doc = xml(html, "application/xhtml+xml");
  if (doc.getElementsByTagName("parsererror").length) doc = xml(html, "text/html");
  doc.querySelectorAll("script,style,nav").forEach((el) => el.remove());
  const body = doc.body ?? doc.documentElement;
  // Only the innermost blocks, so nested ones aren't read twice.
  const blocks = Array.from(body.querySelectorAll(BLOCKS)).filter((el) => !el.querySelector(BLOCKS));
  const paragraphs = blocks.map((el) => clean(el.textContent)).filter(Boolean);
  const heading = clean(body.querySelector("h1,h2,h3")?.textContent);
  return { heading, paragraphs };
}

export async function parseEpub(bytes: ArrayBuffer | Uint8Array): Promise<ParsedBook> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(bytes).catch(() => {
    throw new EpubError("invalid", "That file isn't a valid EPUB.");
  });
  const read = (path: string) => zip.file(path)?.async("string");

  const encryption = await read("META-INF/encryption.xml");
  const protectedBy = encryption && tags(xml(encryption), "EncryptionMethod").some((m) => !FONT_ALGORITHMS.includes(m.getAttribute("Algorithm") ?? ""));
  if (protectedBy || zip.file("META-INF/rights.xml")) {
    throw new EpubError("drm", "This book has copy protection (DRM), so it can't be read aloud. Use a DRM-free copy.");
  }

  const container = await read("META-INF/container.xml");
  const opfPath = container && tags(xml(container), "rootfile")[0]?.getAttribute("full-path");
  const opfText = opfPath ? await read(opfPath) : undefined;
  if (!opfPath || !opfText) throw new EpubError("invalid", "That file isn't a valid EPUB.");

  const opf = xml(opfText);
  const hrefs = new Map(tags(opf, "item").map((i) => [i.getAttribute("id"), i.getAttribute("href")]));
  const spine = tags(opf, "itemref")
    .map((r) => hrefs.get(r.getAttribute("idref")))
    .filter((h): h is string => !!h)
    .slice(0, MAX_CHAPTERS);

  const chapters: Chapter[] = [];
  for (const href of spine) {
    const html = await read(resolve(opfPath, href));
    if (!html) continue;
    const { heading, paragraphs } = paragraphsOf(html);
    const sentences = paragraphs.flatMap(splitSentences);
    if (sentences.length) chapters.push({ title: heading || `Section ${chapters.length + 1}`, sentences });
  }
  if (!chapters.length) throw new EpubError("invalid", "No readable text was found in that EPUB.");

  return {
    title: clean(tags(opf, "title")[0]?.textContent) || "Untitled",
    author: clean(tags(opf, "creator")[0]?.textContent) || "Unknown author",
    chapters,
  };
}
