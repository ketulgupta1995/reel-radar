// Reads a Google Pay "Transaction statement" or a Paytm statement PDF in the browser, with no PDF library.
//
// Both are plain PDFs: page content streams are Flate-compressed, and every word is drawn with a
// Type0 font whose ToUnicode map turns glyph codes back into text. So reading it means: split out
// the objects, inflate the content streams, decode each text-show operator through its font's map,
// then match transactions in the resulting text, which reads like
//   01 Oct, 2026 07:33 AM Paid to Vikram Sharma UPI Transaction ID: 627473653066 Paid by ICICI Bank 1234 ₹30,000
// for Google Pay (see paytmStatement.ts for Paytm's).

export type StatementRow = {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM, 24-hour
  direction: "out" | "in"; // "Paid to" or "Received from"
  name: string; // the other party
  upi: string; // UPI transaction id (Paytm calls it "UPI Ref No"), the same in both people's statements
  account: string; // the bank account it went through, e.g. "ICICI Bank 1234"
  amount: number; // rupees
};

export type Statement = {
  app: "gpay" | "paytm";
  rows: StatementRow[];
  period?: { from: string; to: string };
  sent?: number; // the totals printed on page 1 (they leave out self transfers)
  received?: number;
  email?: string; // the Google account it's for, printed at the top
  holder?: string; // the account holder's name, printed at the top of a Paytm statement
};

import { isPaytmText, parsePaytmText } from "./paytmStatement";

type PdfObject = { dict: string; data?: Uint8Array };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Bytes to a string with one char per byte, so offsets in the string are offsets in the file.
function latin1(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return out;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Response(data).body!.pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function parseObjects(bytes: Uint8Array): Map<number, PdfObject> {
  const s = latin1(bytes);
  const objs = new Map<number, PdfObject>();
  const re = /(\d+) \d+ obj\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const endobj = s.indexOf("endobj", start);
    const streamAt = s.indexOf("stream", start);
    if (streamAt < 0 || (endobj >= 0 && endobj < streamAt)) {
      objs.set(Number(m[1]), { dict: s.slice(start, endobj < 0 ? undefined : endobj) });
      if (endobj >= 0) re.lastIndex = endobj;
      continue;
    }
    const dict = s.slice(start, streamAt);
    let from = streamAt + 6;
    if (s[from] === "\r") from++;
    if (s[from] === "\n") from++;
    // Trust a direct /Length; fall back to searching for endstream.
    const len = dict.match(/\/Length (\d+)(?! \d+ R)/);
    let to = len ? from + Number(len[1]) : -1;
    if (to < 0 || !/^\s*endstream/.test(s.slice(to, to + 20))) to = s.indexOf("endstream", from);
    if (to < 0) break;
    objs.set(Number(m[1]), { dict, data: bytes.subarray(from, to) });
    re.lastIndex = to;
  }
  return objs;
}

const ref = (dict: string, name: string): number | undefined => {
  const m = dict.match(new RegExp(`/${name}\\s*(\\d+) \\d+ R`));
  return m ? Number(m[1]) : undefined;
};

const decodeHex = (hex: string): string => {
  let out = "";
  for (let i = 0; i + 4 <= hex.length; i += 4) out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
  return out;
};

// A ToUnicode CMap: glyph code (hex, upper case) to text.
function parseCMap(text: string): { width: number; map: Map<string, string> } {
  const map = new Map<string, string>();
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const [, code, uni] of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      map.set(code.toUpperCase(), decodeHex(uni));
    }
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const [, lo, hi, uni] of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      const start = parseInt(uni, 16);
      for (let c = parseInt(lo, 16); c <= parseInt(hi, 16); c++) {
        map.set(c.toString(16).toUpperCase().padStart(lo.length, "0"), String.fromCharCode(start + c - parseInt(lo, 16)));
      }
    }
  }
  const width = text.match(/begincodespacerange\s*<([0-9a-fA-F]+)>/)?.[1].length ?? 4;
  return { width, map };
}

type Font = { width: number; map: Map<string, string> } | null;

function decodeShown(hex: string, font: Font): string {
  if (!font) return decodeHex(hex);
  let out = "";
  for (let i = 0; i + font.width <= hex.length; i += font.width) out += font.map.get(hex.slice(i, i + font.width).toUpperCase()) ?? "";
  return out;
}

const ESCAPES: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };

// A literal string's bytes (one char per byte), from its body between the parentheses.
const unescapeLiteral = (body: string): string =>
  body.replace(/\\(?:([0-7]{1,3})|(\r\n|\n|\r)|([\s\S]))/g, (_, oct?: string, eol?: string, ch?: string) =>
    oct ? String.fromCharCode(parseInt(oct, 8) & 255) : eol ? "" : ESCAPES[ch!] ?? ch!
  );

const toHex = (bytes: string) => [...bytes].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");

// A shown string, hex (`<0041>`) or literal (`(\000A)`). A literal with no font map is plain text.
function decodeString(s: string, font: Font): string {
  if (s[0] === "<") return decodeShown(s.slice(1, -1), font);
  const bytes = unescapeLiteral(s.slice(1, -1));
  return font ? decodeShown(toHex(bytes), font) : bytes;
}

const LITERAL = String.raw`\((?:\\[\s\S]|[^\\)])*\)`;
const SHOWN = new RegExp(String.raw`<[0-9a-fA-F]*>|${LITERAL}`, "g");
const TEXT_OPS = new RegExp(String.raw`\/([\w.+-]+)\s+[\d.]+\s+Tf|(<[0-9a-fA-F]*>|${LITERAL})\s*Tj|\[((?:${LITERAL}|[^\]])*)\]\s*TJ`, "g");

// The page objects in reading order: walk the page tree from its root, or fall back to object order.
function pageIds(objs: Map<number, PdfObject>): number[] {
  const isPages = (o: PdfObject) => /\/Type\s*\/Pages\b/.test(o.dict);
  const root = [...objs.entries()].find(([, o]) => isPages(o) && !/\/Parent\b/.test(o.dict));
  const out: number[] = [];
  const walk = (id: number, depth: number) => {
    const o = objs.get(id);
    if (!o || depth > 20) return;
    if (!isPages(o)) return void out.push(id);
    const kids = o.dict.match(/\/Kids\s*\[([^\]]*)\]/)?.[1] ?? "";
    for (const [, kid] of kids.matchAll(/(\d+) \d+ R/g)) walk(Number(kid), depth + 1);
  };
  if (root) walk(root[0], 0);
  if (out.length) return out;
  return [...objs.entries()].filter(([, o]) => /\/Type\s*\/Page(?!s)/.test(o.dict)).map(([id]) => id);
}

// All the text in a PDF, one space between drawn strings.
export async function readPdfText(bytes: Uint8Array): Promise<string> {
  const objs = parseObjects(bytes);
  if ([...objs.values()].some((o) => /\/Encrypt\b/.test(o.dict))) {
    throw new Error("This PDF is password protected. Export the statement again without a password.");
  }
  const streamText = async (id: number | undefined): Promise<string> => {
    const data = id === undefined ? undefined : objs.get(id)?.data;
    if (!data) return "";
    const filtered = /\/FlateDecode/.test(objs.get(id!)!.dict);
    try {
      return latin1(filtered ? await inflate(data) : data);
    } catch {
      return "";
    }
  };
  const cmaps = new Map<number, Font>();
  const fontOf = async (fontId: number): Promise<Font> => {
    if (!cmaps.has(fontId)) {
      const tu = ref(objs.get(fontId)?.dict ?? "", "ToUnicode");
      cmaps.set(fontId, tu === undefined ? null : parseCMap(await streamText(tu)));
    }
    return cmaps.get(fontId)!;
  };

  const words: string[] = [];
  for (const pageId of pageIds(objs)) {
    const page = objs.get(pageId)!.dict;
    const resId = ref(page, "Resources");
    const resources = resId === undefined ? page : objs.get(resId)?.dict ?? "";
    const fontDictId = ref(resources, "Font");
    const fontDict = fontDictId === undefined ? resources.match(/\/Font\s*<<([\s\S]*?)>>/)?.[1] ?? "" : objs.get(fontDictId)?.dict ?? "";
    const fonts = new Map<string, Font>();
    for (const [, name, id] of fontDict.matchAll(/\/([\w.+-]+)\s+(\d+) \d+ R/g)) fonts.set(name, await fontOf(Number(id)));

    const contents = page.match(/\/Contents\s*\[([^\]]*)\]/)?.[1] ?? page.match(/\/Contents\s*(\d+ \d+ R)/)?.[1] ?? "";
    for (const [, id] of contents.matchAll(/(\d+) \d+ R/g)) {
      const ops = await streamText(Number(id));
      let font: Font = null;
      for (const t of ops.matchAll(TEXT_OPS)) {
        if (t[1] !== undefined) font = fonts.get(t[1]) ?? null;
        else {
          const strings = t[2] !== undefined ? [t[2]] : [...t[3].matchAll(SHOWN)].map((x) => x[0]);
          const word = strings.map((s) => decodeString(s, font)).join("").trim();
          if (word) words.push(word);
        }
      }
    }
  }
  return words.join(" ");
}

export const money = (s: string) => Number(s.replace(/,/g, ""));

export function isoDate(day: string, mon: string, year: string): string {
  const m = MONTHS.findIndex((x) => x.toLowerCase() === mon.slice(0, 3).toLowerCase()) + 1;
  return `${year}-${String(m).padStart(2, "0")}-${day.padStart(2, "0")}`;
}

const DAY = String.raw`(\d{1,2}) ([A-Z][a-z]{2,8}),? (\d{4})`;
const ROW = new RegExp(
  String.raw`${DAY} (\d{1,2}):(\d{2}) (AM|PM) (Paid to|Received from) (.+?) UPI Transaction ID:? (\d+) Paid (?:by|to) (.+?) ₹ ?([\d,]+(?:\.\d+)?)`,
  "g"
);

// Match transactions in a statement's text (see readPdfText).
export function parseStatementText(text: string): Statement {
  const flat = text.replace(/\s+/g, " ");
  const statement: Statement = { app: "gpay", rows: [] };
  const period = flat.match(new RegExp(String.raw`statement period ${DAY} - ${DAY}`));
  if (period) {
    statement.period = { from: isoDate(period[1], period[2], period[3]), to: isoDate(period[4], period[5], period[6]) };
  }
  const sent = flat.match(/Sent ₹ ?([\d,]+(?:\.\d+)?)/);
  const received = flat.match(/Received ₹ ?([\d,]+(?:\.\d+)?)/);
  if (sent) statement.sent = money(sent[1]);
  if (received) statement.received = money(received[1]);
  const email = flat.match(/Transaction statement [\d ,]*?([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/);
  if (email) statement.email = email[1];

  // Each page repeats a header; drop it so a transaction split across pages still reads as one.
  const body = flat.replace(/Transaction statement .*?Date & time Transaction details Amount ?/g, "");
  for (const m of body.matchAll(ROW)) {
    const [, day, mon, year, hh, mm, ampm, dir, name, upi, account, amount] = m;
    statement.rows.push({
      date: isoDate(day, mon, year),
      time: clock(hh, mm, ampm),
      direction: dir === "Paid to" ? "out" : "in",
      name: name.trim(),
      upi,
      account: account.trim(),
      amount: money(amount),
    });
  }
  return statement;
}

// "8:43", "PM" to "20:43".
export const clock = (hh: string, mm: string, ampm: string) => `${String((Number(hh) % 12) + (ampm === "PM" ? 12 : 0)).padStart(2, "0")}:${mm}`;

// A Google Pay or Paytm statement, whichever it is.
export async function parseStatementPdf(bytes: Uint8Array): Promise<Statement> {
  if (latin1(bytes.subarray(0, 5)) !== "%PDF-") throw new Error("That file isn't a PDF.");
  const text = await readPdfText(bytes);
  const statement = isPaytmText(text) ? parsePaytmText(text) : parseStatementText(text);
  if (!statement.rows.length) throw new Error("No transactions found. Is this a Google Pay or Paytm statement?");
  return statement;
}
