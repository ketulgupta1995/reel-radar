import { describe, expect, it } from "vitest";
import { parseStatementPdf, parseStatementText, readPdfText } from "./gpayStatement";
import { FakeRow, gpayPdf, makePdf, pageHeader, rowText } from "@/test/gpayPdf";

const rows: FakeRow[] = [
  { day: "01 Oct, 2026", time: "07:33 AM", name: "Swaraj Dry Cleaners", upi: "111", amount: "207" },
  { day: "03 Oct, 2026", time: "12:05 AM", name: "BLINKIT", upi: "222", amount: "1,797.30" },
  { day: "28 Oct, 2026", time: "12:16 PM", dir: "Received from", name: "Meesho Technologies Private Limited", upi: "333", amount: "498" },
  { day: "31 Oct, 2026", time: "11:46 PM", name: "Mahalaxmi Ice Gola and Soda", upi: "444", amount: "1,22,050" },
];

describe("parseStatementPdf", () => {
  it("reads every transaction, the period and the totals", async () => {
    const st = await parseStatementPdf(gpayPdf(rows, 2));
    expect(st.period).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(st.email).toBe("someone@example.com");
    expect(st.sent).toBe(207 + 1797.3 + 122050);
    expect(st.received).toBe(498);
    expect(st.rows).toEqual([
      { date: "2026-10-01", time: "07:33", direction: "out", name: "Swaraj Dry Cleaners", upi: "111", account: "ICICI Bank 1234", amount: 207 },
      { date: "2026-10-03", time: "00:05", direction: "out", name: "BLINKIT", upi: "222", account: "ICICI Bank 1234", amount: 1797.3 },
      { date: "2026-10-28", time: "12:16", direction: "in", name: "Meesho Technologies Private Limited", upi: "333", account: "ICICI Bank 1234", amount: 498 },
      { date: "2026-10-31", time: "23:46", direction: "out", name: "Mahalaxmi Ice Gola and Soda", upi: "444", account: "ICICI Bank 1234", amount: 122050 },
    ]);
  });

  it("joins a transaction split across a page break", async () => {
    const [a, b] = [rowText(rows[0]).split(" Paid by "), rowText(rows[1])];
    const pdf = makePdf([`${a[0]}`, `${pageHeader(2, 2)} Date & time Transaction details Amount Paid by ${a[1]} ${b}`]);
    const st = await parseStatementPdf(pdf);
    expect(st.rows.map((r) => [r.name, r.amount])).toEqual([
      ["Swaraj Dry Cleaners", 207],
      ["BLINKIT", 1797.3],
    ]);
    expect(st.period).toBeUndefined();
  });

  it("copes with other ways a PDF can be laid out", async () => {
    // Indirect resources, a contents array, uncompressed streams and no page tree.
    for (const opts of [{ indirect: true }, { compress: false }, { pageTree: false }, { cmap: "none" as const }, { badLength: true }]) {
      expect((await parseStatementPdf(gpayPdf(rows.slice(0, 1), 10, opts))).rows).toHaveLength(1);
    }
    expect(await readPdfText(makePdf(["HELLO WORLD"], { cmap: "bfrange" }))).toBe("HELLO WORLD");
    expect(await readPdfText(makePdf(["A (B) C\\D"], { literal: true }))).toBe("A (B) C\\D");
  });

  it("reads literal strings and their escapes", async () => {
    // No font, so the bytes are the text: octal, named and line-continuation escapes, and a TJ array of literals.
    const ops = String.raw`BT (Hello\040W\157rld) Tj [(A\(B) -20 (C\)\\)] TJ (x\ty\q) Tj (line\
cont) Tj (\n) Tj ET`;
    const pdf = `%PDF-1.5\n1 0 obj\n<</Type/Page/Contents 2 0 R>>\nendobj\n2 0 obj\n<</Length ${ops.length}>>\nstream\n${ops}\nendstream\nendobj\n`;
    expect(await readPdfText(new TextEncoder().encode(pdf))).toBe("Hello World A(BC)\\ x\tyq linecont");
  });

  it("explains files it can't read", async () => {
    await expect(parseStatementPdf(new TextEncoder().encode("hello"))).rejects.toThrow("isn't a PDF");
    await expect(parseStatementPdf(makePdf(["Nothing to see"]))).rejects.toThrow("No transactions found");
    await expect(parseStatementPdf(gpayPdf(rows, 10, { encrypt: true }))).rejects.toThrow("password protected");
  });

  it("skips streams that don't inflate and objects without an end", async () => {
    const bad = new TextEncoder().encode(
      "%PDF-1.5\n1 0 obj\n<</Type/Page/Contents 2 0 R>>\nendobj\n2 0 obj\n<</Filter/FlateDecode/Length 3>>\nstream\nabc\nendstream\nendobj\n3 0 obj\n<<>>"
    );
    expect(await readPdfText(bad)).toBe("");
    expect(await readPdfText(new TextEncoder().encode("%PDF-1.5\n1 0 obj\n<</Length 9>>\nstream\nno end"))).toBe("");
  });
});

describe("parseStatementText", () => {
  it("finds nothing in unrelated text", () => {
    expect(parseStatementText("Hello there")).toEqual({ app: "gpay", rows: [] });
  });
});
