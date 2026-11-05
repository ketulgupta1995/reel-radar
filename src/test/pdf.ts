// Builds small text PDFs that pdf.js can read, for tests of lib/pdf.ts. (gpayPdf.ts draws statements with a
// stand-in font that only its own reader understands; these use the standard Helvetica font.)

// A line is drawn 16 points below the one before it, unless it says where (`y` counts up from the page's bottom, 0 to 792).
export type FakeLine = string | { text: string; y: number };
export type FakePage = FakeLine | FakeLine[]; // one string is one line; an array is lines from the top down

// A bookmark. `page` is 1-based; null leaves out the destination, and a page past the end points at nothing.
export type FakeOutline = { title: string; page: number | null; children?: FakeOutline[] };

export type FakePdfOptions = {
  outline?: FakeOutline[];
  title?: string;
  author?: string;
  encrypt?: boolean; // a Standard security handler whose user password isn't empty, so the file can't be opened
};

const escape = (s: string) => s.replace(/[\\()]/g, "\\$&");

export function textPdf(pages: FakePage[], opts: FakePdfOptions = {}): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body);

  // 1 catalog, 2 page tree, 3 font, 4 info; then a page and a content stream for each page.
  add("<</Type/Catalog/Pages 2 0 R>>");
  const first = 5;
  add(`<</Type/Pages/Kids[${pages.map((_, i) => `${first + i * 2} 0 R`).join(" ")}]/Count ${pages.length}>>`);
  add("<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>");
  const info = [opts.title && `/Title(${escape(opts.title)})`, opts.author && `/Author(${escape(opts.author)})`].filter(Boolean).join("");
  add(`<<${info}>>`);
  for (const page of pages) {
    const lines = Array.isArray(page) ? page : [page];
    const stream = lines
      .map((line, i) => (typeof line === "string" ? `BT /F1 12 Tf 72 ${720 - i * 16} Td (${escape(line)}) Tj ET` : `BT /F1 12 Tf 72 ${line.y} Td (${escape(line.text)}) Tj ET`))
      .join("\n");
    const contentId = objects.length + 2;
    add(`<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 3 0 R>>>>/Contents ${contentId} 0 R>>`);
    add(`<</Length ${stream.length}>>\nstream\n${stream}\nendstream`);
  }

  if (opts.outline?.length) {
    const rootId = add("");
    const build = (entries: FakeOutline[], parentId: number): { first: number; last: number; count: number } => {
      const ids = entries.map(() => add(""));
      entries.forEach((e, i) => {
        const dest = e.page === null ? "" : `/Dest[${first + (e.page - 1) * 2} 0 R/Fit]`;
        const kids = e.children?.length ? build(e.children, ids[i]) : null;
        const links = `${i > 0 ? `/Prev ${ids[i - 1]} 0 R` : ""}${i < ids.length - 1 ? `/Next ${ids[i + 1]} 0 R` : ""}`;
        const sub = kids ? `/First ${kids.first} 0 R/Last ${kids.last} 0 R/Count ${kids.count}` : "";
        objects[ids[i] - 1] = `<</Title(${escape(e.title)})/Parent ${parentId} 0 R${links}${dest}${sub}>>`;
      });
      return { first: ids[0], last: ids[ids.length - 1], count: ids.length };
    };
    const top = build(opts.outline, rootId);
    objects[rootId - 1] = `<</Type/Outlines/First ${top.first} 0 R/Last ${top.last} 0 R/Count ${top.count}>>`;
    objects[0] = `<</Type/Catalog/Pages 2 0 R/Outlines ${rootId} 0 R>>`;
  }

  // The user password check fails for these made-up keys, which is what an encrypted PDF looks like to a reader.
  if (opts.encrypt) add(`<</Filter/Standard/V 1/R 2/P -4/O<${"ab".repeat(32)}>/U<${"cd".repeat(32)}>>>`);

  let out = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  const encrypt = opts.encrypt ? `/Encrypt ${objects.length} 0 R/ID[<${"01".repeat(16)}><${"01".repeat(16)}>]` : "";
  out += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R/Info 4 0 R${encrypt}>>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

export const pdfFile = (pages: FakePage[], opts?: FakePdfOptions, name = "book.pdf"): File =>
  new File([textPdf(pages, opts) as BlobPart], name, { type: "application/pdf" });
