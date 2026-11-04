// Standard Ebooks (standardebooks.org): search and download straight from the browser. The site allows
// cross-origin requests, so this costs no Vercel usage. It has no search API, so results are read from
// its search page; if that page's layout changes, search fails with a clear message instead of
// showing an empty list.

import { Found, MAX_DOWNLOAD_BYTES, SEARCH_TIMEOUT_MS, SourceError } from "./sources";

const SITE = "https://standardebooks.org";
const PATH = /^[a-z0-9-]+(\/[a-z0-9-]+)+$/;
const DOWN = "Couldn't reach Standard Ebooks. Check your connection and try again.";

async function get(url: string): Promise<Response> {
  const res = await fetch(url, { signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) }).catch(() => null);
  if (!res?.ok) throw new SourceError(DOWN);
  return res;
}

export const epubUrlOf = (path: string) => `${SITE}/ebooks/${path}/downloads/${path.replaceAll("/", "_")}.epub?source=download`;

export function parseResults(html: string): Found[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc.querySelector("main.ebooks")) {
    throw new SourceError("Standard Ebooks changed its search page, so results can't be read right now. Try the other source.");
  }
  const found: Found[] = [];
  for (const li of Array.from(doc.querySelectorAll('li[typeof="schema:Book"]'))) {
    const path = li.getAttribute("about")?.replace(/^\/ebooks\//, "") ?? "";
    const title = li.querySelector("p > a [property='schema:name']")?.textContent?.trim();
    if (!PATH.test(path) || !title) continue;
    const author = Array.from(li.querySelectorAll(".author [property='schema:name']"))
      .map((a) => a.textContent?.trim())
      .filter(Boolean)
      .join(", ");
    found.push({ source: "standard-ebooks", sourceId: `standard-ebooks:${path}`, title, author: author || "Unknown author", epubUrl: epubUrlOf(path) });
  }
  return found;
}

export async function searchStandardEbooks(query: string): Promise<Found[]> {
  const res = await get(`${SITE}/ebooks?query=${encodeURIComponent(query)}`);
  return parseResults(await res.text());
}

export async function downloadEpub(url: string): Promise<ArrayBuffer> {
  if (!url.startsWith(`${SITE}/ebooks/`)) throw new SourceError(DOWN);
  const res = await get(url);
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_DOWNLOAD_BYTES) throw new SourceError("That book is too big to download (max 50 MB).");
  return bytes;
}
