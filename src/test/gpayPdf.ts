import { deflateSync } from "zlib";

// Builds small PDFs laid out like a Google Pay transaction statement (Flate-compressed pages, a
// Type0 font with a ToUnicode map, one hex string per word) or a Paytm statement (the same, with
// literal strings), for tests of lib/gpayStatement.ts and lib/paytmStatement.ts.

export type FakeRow = {
  day: string; // "01 Oct, 2026"
  time: string; // "07:33 AM"
  dir?: "Paid to" | "Received from";
  name: string;
  upi: string;
  amount: string; // "30,000"
};

export const rowText = (r: FakeRow) =>
  `${r.day} ${r.time} ${r.dir ?? "Paid to"} ${r.name} UPI Transaction ID: ${r.upi} ${r.dir === "Received from" ? "Paid to" : "Paid by"} ICICI Bank 1234 ₹${r.amount}`;

export const pageHeader = (page: number, of: number) =>
  `Transaction statement 9999999999, someone@example.com Note: This statement reflects payments made by you. Page ${page} of ${of}`;

export const firstPageHeader = (of: number, sent: string, received: string) =>
  `${pageHeader(1, of)} Transaction statement period 01 October 2026 - 31 October 2026 Sent ₹${sent} Received ₹${received} Date & time Transaction details Amount`;

export type PdfOptions = {
  cmap?: "bfchar" | "bfrange" | "none"; // how glyph codes map back to text; "bfrange" only maps A-Z
  compress?: boolean; // Flate the streams (default true)
  indirect?: boolean; // resources and font dict as their own objects, contents as an array
  pageTree?: boolean; // write a Pages root (default true)
  encrypt?: boolean;
  badLength?: boolean; // a /Length that doesn't land on endstream
  literal?: boolean; // draw words as escaped literal strings, (\000A), as Paytm does, not <0041>
};

// One PDF page per string; each space-separated word is drawn as its own string.
export function makePdf(pages: string[], opts: PdfOptions = {}): Uint8Array {
  const { cmap = "bfchar", compress = true, indirect = false, pageTree = true } = opts;
  const chars = [...new Set(pages.join(" ").replace(/ /g, ""))];
  // Codes start at 0x21 so a bfrange can cover them all in order.
  const code = (c: string) => (chars.indexOf(c) + 0x21).toString(16).padStart(4, "0");
  const objects: (string | { dict: string; data: Buffer })[] = [];
  const add = (o: string | { dict: string; data: Buffer }) => objects.push(o) && objects.length;
  const stream = (text: string) => {
    const raw = Buffer.from(text, "latin1");
    const data = compress ? deflateSync(raw) : raw;
    return { dict: `<<${compress ? "/Filter/FlateDecode" : ""}/Length ${data.length + (opts.badLength ? 5 : 0)}>>`, data };
  };
  const hex = (c: string) => c.charCodeAt(0).toString(16).padStart(4, "0");
  const cmapText =
    cmap === "bfrange"
      ? "begincodespacerange <0000> <FFFF> endcodespacerange 1 beginbfrange <0021> <003A> <0041> endbfrange"
      : `begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${chars.length} beginbfchar\n${chars.map((c) => `<${code(c)}> <${hex(c)}>`).join("\n")}\nendbfchar`;
  // The bfrange maps codes 0x21-0x3A to A-Z.
  // Two bytes per glyph code; the 0 high byte as an octal escape, parentheses and backslash escaped.
  const literal = (hexCodes: string) =>
    `(${hexCodes.replace(/(..)(..)/g, (_, hi: string, lo: string) => `\\${parseInt(hi, 16).toString(8).padStart(3, "0")}${String.fromCharCode(parseInt(lo, 16)).replace(/[()\\]/, "\\$&")}`)})`;
  const encode = (word: string) =>
    cmap === "bfrange" ? [...word].map((c) => (c.charCodeAt(0) - 0x41 + 0x21).toString(16).padStart(4, "0")).join("") : cmap === "none" ? [...word].map(hex).join("") : [...word].map(code).join("");

  const pagesId = add("PLACEHOLDER");
  add(`<</Type/Catalog/Pages ${pagesId} 0 R>>`);
  const cmapId = add(stream(cmapText));
  const fontId = add(`<</Type/Font/Subtype/Type0/Name/F1/Encoding/Identity-H${cmap === "none" ? "" : `/ToUnicode ${cmapId} 0 R`}>>`);
  const kids: number[] = [];
  for (const text of pages) {
    const ops = text
      .split(" ")
      .filter(Boolean)
      .map((w, i) => (opts.literal ? `BT /F1 8 Tf 1 0 0 1 ${i} 0 Tm ${literal(encode(w))}Tj ET` : `BT /F1 8 Tf 0 Tc ${i} 0 Td [<${encode(w)}>]TJ ET`))
      .join(" ");
    const contentId = add(stream(ops));
    const parent = pageTree ? `/Parent ${pagesId} 0 R` : "";
    if (indirect) {
      const fontsId = add(`<</F1 ${fontId} 0 R>>`);
      const resId = add(`<</Font ${fontsId} 0 R>>`);
      kids.push(add(`<</Type/Page${parent}/Resources ${resId} 0 R/Contents [${contentId} 0 R]>>`));
    } else {
      kids.push(add(`<</Type/Page${parent}/Resources<</Font<</F1 ${fontId} 0 R>>>>/Contents ${contentId} 0 R>>`));
    }
  }
  objects[pagesId - 1] = pageTree ? `<</Type/Pages/Kids[${kids.map((k) => `${k} 0 R`).join(" ")}]/Count ${kids.length}>>` : "<<>>";
  if (opts.encrypt) add(`<</Encrypt ${pagesId} 0 R>>`);

  const parts: Buffer[] = [Buffer.from("%PDF-1.5\n", "latin1")];
  objects.forEach((o, i) => {
    if (typeof o === "string") parts.push(Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, "latin1"));
    else parts.push(Buffer.from(`${i + 1} 0 obj\n${o.dict}\nstream\n`, "latin1"), o.data, Buffer.from("\nendstream\nendobj\n", "latin1"));
  });
  parts.push(Buffer.from("trailer\n<</Root 2 0 R>>\n%%EOF\n", "latin1"));
  return new Uint8Array(Buffer.concat(parts));
}

// A statement with `rows`, `perPage` rows to a page, and the page 1 totals worked out from them.
export function gpayPdf(rows: FakeRow[], perPage = 10, opts: PdfOptions = {}): Uint8Array {
  const total = (dir: "out" | "in") =>
    rows
      .filter((r) => (r.dir === "Received from") === (dir === "in"))
      .reduce((n, r) => n + Number(r.amount.replace(/,/g, "")), 0)
      .toLocaleString("en-IN");
  const pages: string[] = [];
  const count = Math.max(1, Math.ceil(rows.length / perPage));
  for (let p = 0; p < count; p++) {
    const head = p === 0 ? firstPageHeader(count, total("out"), total("in")) : `${pageHeader(p + 1, count)} Date & time Transaction details Amount`;
    pages.push(`${head} ${rows.slice(p * perPage, (p + 1) * perPage).map(rowText).join(" ")}`);
  }
  return makePdf(pages, opts);
}

export type PaytmRow = {
  day: string; // "31 Oct"
  time: string; // "8:43 PM"
  details: string; // "Paid to Rohit Kale", "Received from Meesho", "Booking For HP Gas 9000000001"
  ref: string; // UPI Ref No
  amount: string; // "3,300"
  sign?: "-" | "+"; // paid or received; default paid
  note?: string;
};

export const paytmRowText = (r: PaytmRow) =>
  `${r.day} ${r.time} ${r.details} UPI ID: shop@pty on UPI Ref No: ${r.ref}${r.note ? ` Note: ${r.note}` : ""} Tag: # Food Kotak Mahindra Bank - 06 ${r.sign ?? "-"} Rs.${r.amount}`;

const paytmChrome = (page: number, of: number) =>
  `Page of ${page} ${of} For any queries, Contact Us`;
const paytmTableHeader =
  "Passbook Payments History All payments done by you on Paytm App are reflected in this statement Date & Time Transaction Details Notes & Tags Your Account Amount";

export const paytmFirstPage = (of: number, paid: string, received: string, who = "MEERA VIKRAM SHARMA ******5441, null", period = "1 OCT'26 - 31 OCT'26") =>
  `${paytmChrome(1, of)} ${who} Paytm Statement for ${period} Total Money Paid - Rs.${paid} 2 Payments made Total Money Received + Rs.${received} 1 Payments received ` +
  `Note: Self transfer payments are not included Accounts Payment made Payment received Kotak Mahindra Bank - 06 Rs.${paid} (2 Payments) Rs.${received} (1 Payment) ${paytmTableHeader}`;

// A Paytm statement with `rows`, `perPage` rows to a page, and the page 1 totals worked out from them.
export function paytmPdf(rows: PaytmRow[], perPage = 10, opts: PdfOptions = {}): Uint8Array {
  const total = (sign: "-" | "+") =>
    rows
      .filter((r) => (r.sign ?? "-") === sign)
      .reduce((n, r) => n + Number(r.amount.replace(/,/g, "")), 0)
      .toLocaleString("en-IN");
  const pages: string[] = [];
  const count = Math.max(1, Math.ceil(rows.length / perPage));
  for (let p = 0; p < count; p++) {
    const head = p === 0 ? paytmFirstPage(count, total("-"), total("+")) : `${paytmChrome(p + 1, count)} ${paytmTableHeader}`;
    pages.push(`${head} ${rows.slice(p * perPage, (p + 1) * perPage).map(paytmRowText).join(" ")}`);
  }
  return makePdf(pages, { literal: true, ...opts });
}
