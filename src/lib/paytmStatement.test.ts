import { describe, expect, it } from "vitest";
import { parseStatementPdf } from "./gpayStatement";
import { parsePaytmText } from "./paytmStatement";
import { PaytmRow, makePdf, paytmFirstPage, paytmPdf, paytmRowText } from "@/test/gpayPdf";

const rows: PaytmRow[] = [
  { day: "31 Oct", time: "8:43 PM", details: "Paid to Nitin Madhukar Hande", ref: "630476696220", amount: "50", note: "Matki bhel" },
  { day: "17 Oct", time: "12:21 PM", details: "Booking For HP Gas 9000000001", ref: "218281503418", amount: "944.50" },
  { day: "03 Oct", time: "6:35 AM", details: "Received from Arjun Vikram Sharma", ref: "664323793383", amount: "36,000", sign: "+" },
  { day: "01 Oct", time: "12:05 AM", details: "Money sent to Mr VIJAYKUMAR GEJGE", ref: "616281093077", amount: "1,22,050" },
];

describe("parsePaytmText", () => {
  it("reads every transaction, the period, the totals and the holder", async () => {
    const st = await parseStatementPdf(paytmPdf(rows, 2));
    expect(st.app).toBe("paytm");
    expect(st.period).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(st.holder).toBe("MEERA VIKRAM SHARMA");
    expect(st.email).toBeUndefined();
    expect(st.sent).toBe(50 + 944.5 + 122050);
    expect(st.received).toBe(36000);
    const account = "Kotak Mahindra Bank - 06";
    expect(st.rows).toEqual([
      { date: "2026-10-31", time: "20:43", direction: "out", name: "Nitin Madhukar Hande", upi: "630476696220", account, amount: 50 },
      { date: "2026-10-17", time: "12:21", direction: "out", name: "Booking For HP Gas 9000000001", upi: "218281503418", account, amount: 944.5 },
      { date: "2026-10-03", time: "06:35", direction: "in", name: "Arjun Vikram Sharma", upi: "664323793383", account, amount: 36000 },
      { date: "2026-10-01", time: "00:05", direction: "out", name: "Mr VIJAYKUMAR GEJGE", upi: "616281093077", account, amount: 122050 },
    ]);
  });

  it("joins a row split across a page break", async () => {
    const [a, b] = paytmRowText(rows[0]).split(" UPI Ref No: ");
    const pdf = makePdf([`${paytmFirstPage(2, "50", "0")} ${a}`, `Page of 2 2 For any queries, Contact Us Passbook Payments History x Your Account Amount UPI Ref No: ${b}`], { literal: true });
    expect((await parseStatementPdf(pdf)).rows.map((r) => [r.name, r.amount])).toEqual([["Nitin Madhukar Hande", 50]]);
  });

  it("dates rows across a new year, and takes an email when there is one", () => {
    const st = parsePaytmText(
      `${paytmFirstPage(1, "30", "0", "PRIYA SHARMA ******1234, priya@example.com", "15 DEC’26 - 14 JAN’27")} ` +
        `${paytmRowText({ ...rows[0], day: "05 Jan", ref: "1" })} ${paytmRowText({ ...rows[0], day: "20 Dec", ref: "2" })}`
    );
    expect(st.period).toEqual({ from: "2026-12-15", to: "2027-01-14" });
    expect(st.rows.map((r) => r.date)).toEqual(["2027-01-05", "2026-12-20"]);
    expect([st.holder, st.email]).toEqual(["PRIYA SHARMA", "priya@example.com"]);
  });

  it("copes with a statement missing its summary", () => {
    const st = parsePaytmText(`Paytm Statement for ${paytmRowText(rows[0])}`);
    expect(st.rows).toMatchObject([{ date: `${new Date().getFullYear()}-10-31`, account: "" }]);
    expect([st.period, st.sent, st.received, st.holder]).toEqual([undefined, undefined, undefined, undefined]);
  });
});
