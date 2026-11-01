// Matches transactions in a Paytm statement's text (see readPdfText in gpayStatement.ts). Each row
// reads like
//   31 Oct 8:43 PM Paid to Rohit Kale UPI ID: paytm.s1tmuh0@pty on UPI Ref No: 630476696220
//   Note: Matki bhel Tag: # Food Kotak Mahindra Bank - 06 - Rs.50
// Rows have no year; it comes from the statement period ("1 OCT'26 - 31 OCT'26").

import { clock, isoDate, money, type Statement } from "./gpayStatement";

const AMOUNT = String.raw`Rs\.([\d,]+(?:\.\d+)?)`;
const PERIOD_DAY = String.raw`(\d{1,2}) ([A-Za-z]{3})['’](\d{2})`;
const ROW = new RegExp(
  String.raw`(\d{1,2}) ([A-Z][a-z]{2}) (\d{1,2}):(\d{2}) (AM|PM) (.+?) UPI ID: .*? UPI Ref No: (\d+) (.*?)([-+]) ${AMOUNT}`,
  "g"
);
// What comes before the other party's name; anything else ("Booking For HP Gas ...") is kept whole.
const LEAD = /^(?:Paid to|Money sent to|Sent to|Received from) /;

export const isPaytmText = (text: string) => /Paytm Statement for/.test(text);

export function parsePaytmText(text: string): Statement {
  const flat = text.replace(/\s+/g, " ");
  const statement: Statement = { app: "paytm", rows: [] };
  const period = flat.match(new RegExp(String.raw`Paytm Statement for ${PERIOD_DAY} - ${PERIOD_DAY}`));
  if (period) {
    statement.period = { from: isoDate(period[1], period[2], `20${period[3]}`), to: isoDate(period[4], period[5], `20${period[6]}`) };
  }
  const sent = flat.match(new RegExp(String.raw`Total Money Paid - ${AMOUNT}`));
  const received = flat.match(new RegExp(String.raw`Total Money Received \+ ${AMOUNT}`));
  if (sent) statement.sent = money(sent[1]);
  if (received) statement.received = money(received[1]);
  // "MEERA SHARMA ******5441, null Paytm Statement for": the name, masked phone, and email or "null".
  const who = flat.match(/(?:^|Contact Us )([A-Za-z][A-Za-z .']*?) [*\d]+, (\S+) Paytm Statement for/);
  if (who) {
    statement.holder = who[1];
    if (who[2].includes("@")) statement.email = who[2];
  }
  // The bank accounts, as listed in the summary, so a row's can be told apart from its tag.
  const summary = flat.match(/Payment made Payment received (.*?) Passbook Payments History/)?.[1] ?? "";
  const accounts = summary
    .split(/ ?Rs\.[\d,.]+ \(\d+ Payments?\)/)
    .map((a) => a.replace(/^[-\s]+/, "").trim())
    .filter(Boolean);

  // Each page repeats its footer and table header; drop them so a row split across pages still reads as one.
  const body = flat
    .replace(/Page \D{0,4}\d+ \D{0,4}\d+ For any queries, Contact Us ?/g, "")
    .replace(/Passbook Payments History .*?Your Account Amount ?/g, "");
  const to = statement.period?.to;
  for (const m of body.matchAll(ROW)) {
    const [, day, mon, hh, mm, ampm, details, upi, middle, sign, amount] = m;
    // A row from a month after the period's end is from the year before (a December row in a Dec–Jan statement).
    let year = to ? Number(to.slice(0, 4)) : new Date().getFullYear();
    if (to && isoDate(day, mon, String(year)).slice(5, 7) > to.slice(5, 7)) year--;
    statement.rows.push({
      date: isoDate(day, mon, String(year)),
      time: clock(hh, mm, ampm),
      direction: sign === "-" ? "out" : "in",
      name: details.replace(LEAD, "").trim(),
      upi,
      account: accounts.find((a) => middle.trim().endsWith(a)) ?? "",
      amount: money(amount),
    });
  }
  return statement;
}
