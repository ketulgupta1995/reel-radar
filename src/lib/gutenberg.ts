// Project Gutenberg: search from the browser through its own OPDS feed (it allows cross-origin requests,
// so a search costs no function call), and download through our /api/books/gutenberg/<number> route,
// because the EPUB files themselves don't. The route sends the small no-illustrations edition.
import { Found, MAX_DOWNLOAD_BYTES, SEARCH_TIMEOUT_MS, SourceError } from "./sources";

const FEED = "https://www.gutenberg.org/ebooks/search.opds/";
const BOOK_ID = /\/ebooks\/(\d{1,7})\.opds$/;
const DOWNLOADS = /^[\d,]+ downloads?$/;
const DOWN = "Couldn't reach Project Gutenberg. Check your connection and try again.";

export const gutenbergPath = (number: string) => `/api/books/gutenberg/${number}`;

export function parseFeed(xml: string): Found[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length || !doc.getElementsByTagNameNS("*", "feed").length) {
    throw new SourceError("Project Gutenberg sent something unexpected, so results can't be read right now. Try the other source.");
  }
  const found: Found[] = [];
  for (const entry of Array.from(doc.getElementsByTagNameNS("*", "entry"))) {
    const text = (name: string) => entry.getElementsByTagNameNS("*", name)[0]?.textContent?.trim() ?? "";
    const number = BOOK_ID.exec(text("id"))?.[1]; // other entries are groupings, such as subjects
    const title = text("title");
    if (!number || !title) continue;
    const author = text("content");
    found.push({
      source: "gutenberg",
      sourceId: `gutenberg:${number}`,
      title,
      author: !author || DOWNLOADS.test(author) ? "Unknown author" : author,
      epubUrl: gutenbergPath(number),
    });
  }
  return found;
}

export async function searchGutenberg(query: string): Promise<Found[]> {
  const res = await fetch(`${FEED}?query=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) }).catch(() => null);
  if (!res?.ok) throw new SourceError(DOWN);
  return parseFeed(await res.text());
}

export async function downloadGutenberg(path: string): Promise<ArrayBuffer> {
  if (!/^\/api\/books\/gutenberg\/\d{1,7}$/.test(path)) throw new SourceError(DOWN);
  const res = await fetch(path, { signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) }).catch(() => null);
  if (!res) throw new SourceError(DOWN);
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: "" }));
    throw new SourceError(error || DOWN);
  }
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_DOWNLOAD_BYTES) throw new SourceError("That book is too big to download (max 50 MB).");
  return bytes;
}
