// Tidies the text a PDF gives back so it reads aloud well (pure; no "use client"): page furniture such as
// running headers and page numbers is dropped, lines are joined into paragraphs, and words hyphenated across
// a line or page break are made whole again. The rules are heuristics: they can miss and can over-reach.

/** One line of a page, in the order the PDF draws them. `y` counts up from the bottom of the page. */
export type PdfLine = { text: string; y: number; height: number };

const EDGE_LINES = 2; // a header or footer is among the first or last couple of lines of a page
const MIN_PAGES = 3; // fewer pages than this and a repeated line is more likely text than a header
const MIN_LINES = 2 * EDGE_LINES + 1; // on a page shorter than this every line is an edge line, so a repeat means little
const MAX_FURNITURE_CHARS = 80;
const BARE_PAGE_NUMBER = /^\W*(page\s*)?\d{1,5}(\s*(of|\/)\s*\d{1,5})?\W*$/i;
const PARAGRAPH_GAP = 1.6; // a gap above this many line heights starts a new paragraph

// "Chapter One — 12" and "Chapter One — 13" are the same running header.
const shape = (text: string) => text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();

// The first and last lines of a page by position, as indexes into its lines.
function edgeIndexes(lines: PdfLine[]): Set<number> {
  const byHeight = lines.map((_, i) => i).sort((a, b) => lines[b].y - lines[a].y);
  return new Set([...byHeight.slice(0, EDGE_LINES), ...byHeight.slice(-EDGE_LINES)]);
}

/** Drops lines that repeat at the top or bottom of most pages (running headers and footers), and bare page numbers there. */
export function stripPageFurniture(pages: PdfLine[][]): PdfLine[][] {
  const edges = pages.map(edgeIndexes);
  const seen = new Map<string, number>(); // pages each shape turns up on, at an edge
  pages.forEach((lines, p) => {
    const onThisPage = new Set<string>();
    if (lines.length < MIN_LINES) return;
    for (const i of edges[p]) {
      const key = shape(lines[i].text);
      if (key && lines[i].text.length <= MAX_FURNITURE_CHARS) onThisPage.add(key);
    }
    for (const key of onThisPage) seen.set(key, (seen.get(key) ?? 0) + 1);
  });
  const needed = Math.max(MIN_PAGES, Math.ceil(pages.length / 2));
  return pages.map((lines, p) =>
    lines.filter((line, i) => {
      if (!edges[p].has(i)) return true;
      if (BARE_PAGE_NUMBER.test(line.text)) return false;
      return lines.length < MIN_LINES || line.text.length > MAX_FURNITURE_CHARS || (seen.get(shape(line.text)) ?? 0) < needed || pages.length < MIN_PAGES;
    })
  );
}

const HYPHENATED = /\p{L}[-­]$/u;

// Adds `next` after `text`. A word cut by a hyphen at the end of `text` is made whole again: the hyphen goes
// when the word goes on in lower case ("conver-" "sation"), and stays when it doesn't ("Anglo-" "Saxon").
function attach(text: string, next: string): string {
  if (!HYPHENATED.test(text)) return `${text} ${next}`;
  const kept = text.endsWith("­") || /^\p{Ll}/u.test(next) ? text.slice(0, -1) : text;
  return kept + next;
}

/** The paragraphs of one page: lines joined, with a new paragraph at a larger gap or where the text jumps back up the page. */
export function paragraphsOfPage(lines: PdfLine[]): string[] {
  const out: string[] = [];
  lines.forEach((line, i) => {
    const prev = lines[i - 1];
    const gap = prev ? prev.y - line.y : 0;
    const newParagraph = !prev || gap <= 0 || gap > PARAGRAPH_GAP * Math.max(prev.height, line.height, 1);
    if (newParagraph) out.push(line.text);
    else out[out.length - 1] = attach(out[out.length - 1], line.text);
  });
  return out;
}

const ENDED = /[.!?…"”’')\]:]$/;

/** The paragraphs of consecutive pages, where one still open at the bottom of a page carries on at the top of the next. */
export function joinPages(pages: string[][]): string[] {
  const out: string[] = [];
  let open = false;
  for (const paragraphs of pages) {
    paragraphs.forEach((paragraph, i) => {
      if (i === 0 && open) out[out.length - 1] = attach(out[out.length - 1], paragraph);
      else out.push(paragraph);
    });
    if (paragraphs.length) open = !ENDED.test(out[out.length - 1]);
  }
  return out;
}

/** The horizontal extent of one piece of text on a page. */
export type Span = { x0: number; x1: number };

const MIN_SPANS = 10; // a page with less text than this says nothing about its layout
const GUTTER_STEP = 2;
const MIN_GUTTER = 12; // points of clear space between columns
const CROSSING_SHARE = 0.1; // a title or caption may run across the gap
const SIDE_SHARE = 0.25; // each side of the gap holds at least this much of the text
const MIN_SIDE_SPANS = 5;
const COLUMN_PAGES_SHARE = 0.3; // of the pages that have text

// Is there a clear strip in the middle of the page with plenty of text on both sides of it?
function hasGutter({ width, spans }: { width: number; spans: Span[] }): boolean {
  const limit = CROSSING_SHARE * spans.length;
  let runStart: number | null = null;
  const closes = (end: number) => {
    if (runStart === null || end - runStart < MIN_GUTTER) return false;
    const mid = (runStart + end) / 2;
    const left = spans.filter((s) => s.x1 <= mid).length;
    const right = spans.filter((s) => s.x0 >= mid).length;
    const enough = (n: number) => n >= MIN_SIDE_SPANS && n >= SIDE_SHARE * spans.length;
    return enough(left) && enough(right);
  };
  for (let c = 0.3 * width; c <= 0.7 * width; c += GUTTER_STEP) {
    const crossing = spans.filter((s) => s.x0 < c && s.x1 > c).length;
    if (crossing <= limit) runStart ??= c;
    else {
      if (closes(c)) return true;
      runStart = null;
    }
  }
  return closes(0.7 * width);
}

/** Does the document look like it is set in columns? Only a guess from where the text sits; it is not reordered. */
export function looksMultiColumn(pages: { width: number; spans: Span[] }[]): boolean {
  const withText = pages.filter((p) => p.spans.length >= MIN_SPANS);
  const columns = withText.filter(hasGutter).length;
  return columns > 0 && columns >= COLUMN_PAGES_SHARE * withText.length;
}
