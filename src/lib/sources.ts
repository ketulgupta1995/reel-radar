// Types shared by the book catalogues (pure; no imports, so every catalogue can use it).

export type CatalogueSource = "standard-ebooks" | "gutenberg";

export type Found = {
  sourceId: string; // "standard-ebooks:<author>/<title>" or "gutenberg:<number>"
  source: CatalogueSource;
  title: string;
  author: string;
  epubUrl: string; // where the EPUB comes from: the site itself, or our own route for Gutenberg
};

// A problem the reader can act on (a site that's down, a book that's too big); the message is shown as is.
export class SourceError extends Error {}

export const SOURCE_NAMES: Record<CatalogueSource, string> = { "standard-ebooks": "Standard Ebooks", gutenberg: "Project Gutenberg" };

export const SEARCH_TIMEOUT_MS = 15_000;
export const MAX_DOWNLOAD_BYTES = 50_000_000;
