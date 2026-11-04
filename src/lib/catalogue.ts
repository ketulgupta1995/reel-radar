// One search across the book catalogues. Standard Ebooks comes first, so when both have the same book
// its better-formatted edition is the one listed.
import { downloadGutenberg, searchGutenberg } from "./gutenberg";
import { Found, SOURCE_NAMES, SourceError } from "./sources";
import { downloadEpub, searchStandardEbooks } from "./standardEbooks";

const words = (s: string) => s.toLowerCase().replaceAll("&", " and ").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
const titleKey = (t: string) => words(t).filter((w, i) => !(i === 0 && w === "the")).join(" ");

// The same title, and at least one name in common: "Austen, Jane" and "Jane Austen" match, as do
// "Homer" and "Homer, William Cullen Bryant".
function sameBook(a: Found, b: Found): boolean {
  if (titleKey(a.title) !== titleKey(b.title)) return false;
  const names = new Set(words(a.author).filter((w) => w.length > 2));
  return words(b.author).some((w) => names.has(w));
}

export function mergeResults(...lists: Found[][]): Found[] {
  const out: Found[] = [];
  for (const found of lists.flat()) if (!out.some((kept) => sameBook(kept, found))) out.push(found);
  return out;
}

export type CatalogueResult = { results: Found[]; problems: string[] };

// Both sources are asked at once. If one fails, the other's results are still shown with a note about it;
// if both fail, the search fails.
export async function searchCatalogue(query: string): Promise<CatalogueResult> {
  const settled = await Promise.allSettled([searchStandardEbooks(query), searchGutenberg(query)]);
  const problems = settled.flatMap((r) => (r.status === "rejected" ? [r.reason instanceof Error ? r.reason.message : "A source failed."] : []));
  const ok = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (!ok.length) throw new SourceError(problems[0]);
  return { results: mergeResults(...ok), problems };
}

export const downloadFound = (found: Found) => (found.source === "gutenberg" ? downloadGutenberg(found.epubUrl) : downloadEpub(found.epubUrl));
export const sourceName = (found: Found) => SOURCE_NAMES[found.source];
