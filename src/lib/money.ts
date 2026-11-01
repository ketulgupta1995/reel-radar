"use client";

import { useEffect } from "react";
import { merge3 } from "@/lib/syncDocs";
import { SYNC_EVENT, flush, markDirty, registerDocs, syncKeys, watchKeys } from "@/lib/sync";
import { getTodayDate, toDateString } from "@/lib/todos";
import type { StatementRow } from "@/lib/gpayStatement";

// The Money app: spending, income and limits, for you and the family members whose spending you pay
// back. A family member's spending is logged under their name; the money you send them is logged
// as a "settlement", so what you still owe them is their spending minus what you've sent.

export type CategoryId =
  | "food"
  | "groceries"
  | "shopping"
  | "health"
  | "transport"
  | "entertainment"
  | "bills"
  | "personal"
  | "education"
  | "family"
  | "other";

// Keywords match the start of a word in the payee's name. Earlier categories win, so a
// "Shri Devi Hospitality" is Food, not Health ("hospital"), and a "Bharati Vidyapeeth Medical
// Foundation" is Health, not Education.
export const CATEGORIES: { id: CategoryId; label: string; icon: string; keywords: string[] }[] = [
  { id: "food", label: "Food & dining", icon: "🍽️", keywords: ["hotel", "restaurant", "cafe", "chai", "tea", "canteen", "caterers", "bhel", "panipuri", "gola", "soda", "swiggy", "zomato", "pizza", "bakery", "sweets", "hospitality", "dhaba", "kitchen", "foods", "juice", "biryani", "bakers", "chitale", "flavours", "street food", "vada", "misal", "momos", "dosa"] },
  { id: "health", label: "Health", icon: "💊", keywords: ["medical", "medicos", "hospital", "pharma", "chemist", "clinic", "diagnostic", "doctor", "apollo", "netmeds", "ayurved", "dental", "pathology"] },
  { id: "groceries", label: "Groceries", icon: "🛒", keywords: ["blinkit", "zepto", "bigbasket", "instamart", "bazaar", "dmart", "supermarket", "super market", "kirana", "traders", "provision", "dairy", "milk", "vegetable", "vegitable", "fruit", "bazar", "andiwale", "more retail", "mart"] },
  { id: "shopping", label: "Shopping", icon: "🛍️", keywords: ["meesho", "amazon", "flipkart", "myntra", "ajio", "nykaa", "mall", "fashion", "craft", "artisan", "store", "decathlon", "jewel", "bangle", "garment", "cloth", "saree", "footwear", "shoe", "bag house", "bags", "cutlery", "sports", "shopee", "variety", "veriety", "electronics", "mobile"] },
  { id: "transport", label: "Transport", icon: "🚗", keywords: ["auto", "petrol", "fuel", "uber", "ola", "rapido", "metro", "irctc", "railway", "parking", "fastag", "motors"] },
  { id: "entertainment", label: "Entertainment", icon: "🎬", keywords: ["bookmyshow", "google play", "netflix", "spotify", "hotstar", "prime video", "pvr", "inox", "cinema", "youtube"] },
  { id: "bills", label: "Bills & recharge", icon: "💡", keywords: ["recharge", "electricity", "airtel", "jio", "vodafone", "broadband", "insurance", "rent", "bill", "mahavitaran", "gas", "uidai", "municipal"] },
  { id: "personal", label: "Personal care", icon: "💇", keywords: ["dry clean", "cleaners", "laundry", "salon", "parlour", "parlor", "spa", "beauty", "tailor"] },
  { id: "education", label: "Education", icon: "📚", keywords: ["school", "college", "university", "vidyapeeth", "academy", "classes", "course", "books"] },
  { id: "family", label: "Family & friends", icon: "👪", keywords: [] },
  { id: "other", label: "Other", icon: "📦", keywords: [] },
];
export const categoryOf = (id: CategoryId) => CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[CATEGORIES.length - 1];

// spend and refund count toward spending; income toward savings; settlements (money you send a
// family member to cover their spending) pay down what you owe them; transfers count nowhere.
export type Kind = "spend" | "refund" | "income" | "settlement" | "transfer";
export const KINDS: { id: Kind; label: string }[] = [
  { id: "spend", label: "Spent" },
  { id: "refund", label: "Refund" },
  { id: "income", label: "Income" },
  { id: "settlement", label: "Paid back" },
  { id: "transfer", label: "Transfer (ignore)" },
];

export const ME = "me";

// `aliases` are the names this person shows up under in a Google Pay or Paytm statement.
export type Person = { id: string; name: string; aliases: string[]; updatedAt: number };

export type Txn = {
  id: string; // "gpay:<UPI transaction id>" for imported ones (Paytm's too), so an import never adds one twice
  date: string; // YYYY-MM-DD
  time?: string; // HH:MM
  amount: number; // rupees, always positive; `kind` says which way it went
  payee: string;
  category: CategoryId;
  kind: Kind;
  personId: string; // whose spending it is; for a settlement, who was paid back
  note?: string;
  source: "manual" | "cash" | "gpay" | "paytm"; // "cash": logged by hand as paid in cash
  updatedAt: number;
};

// Settings values: "limit:total", "limit:<category>", "income" (monthly) and "goal" (monthly savings).
type Value = { key: string; value: number; updatedAt: number };
type Rule = { payee: string; category: CategoryId; updatedAt: number }; // payee is normalized
export type MoneySettings = { people: Person[]; values: Value[]; rules: Rule[]; months: string[] };

// ---------------- Storage ----------------
// Transactions are synced one doc per month ("money-2026-10"); people, limits and learned payee
// categories are one more doc ("money-settings"), which also lists the months that have data so a
// new device knows which month docs to pull. localStorage keeps them under "reel-radar-<doc key>".

type MonthDoc = { items: Txn[] };

const SETTINGS_DOC = "money-settings";
const MONTH_DOC = /^money-(\d{4}-\d{2})$/;
const STORAGE_PREFIX = "reel-radar-";
const monthKey = (month: string) => `money-${month}`;
export const monthOf = (date: string) => date.slice(0, 7);

const emptySettings = (): MoneySettings => ({ people: [], values: [], rules: [], months: [] });

function readJson<T>(docKey: string, fallback: () => T): T {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_PREFIX + docKey) || "null");
    return parsed && typeof parsed === "object" ? { ...fallback(), ...parsed } : fallback();
  } catch {
    return fallback();
  }
}
const writeJson = (docKey: string, doc: unknown) => localStorage.setItem(STORAGE_PREFIX + docKey, JSON.stringify(doc));

const newer = <T extends { updatedAt: number }>(local: T, server: T) => (server.updatedAt > local.updatedAt ? server : local);
const same = <T>(x: T) => x;

export const mergeSettings = (l: MoneySettings, s: MoneySettings, b?: MoneySettings): MoneySettings => ({
  people: merge3(l.people, s.people, b?.people, (p) => p.id, newer),
  values: merge3(l.values, s.values, b?.values, (v) => v.key, newer),
  rules: merge3(l.rules, s.rules, b?.rules, (r) => r.payee, newer),
  months: merge3(l.months, s.months, b?.months, same, same).sort(),
});

registerDocs((key) => {
  if (key === SETTINGS_DOC) {
    return {
      read: () => readJson(SETTINGS_DOC, emptySettings),
      write: (doc: MoneySettings) => writeJson(SETTINGS_DOC, doc),
      merge: mergeSettings,
      empty: emptySettings,
      flushDelay: 3000,
    };
  }
  if (!MONTH_DOC.test(key)) return undefined;
  return {
    read: () => readJson<MonthDoc>(key, () => ({ items: [] })),
    write: (doc: MonthDoc) => writeJson(key, doc),
    merge: (l: MonthDoc, s: MonthDoc, b?: MonthDoc) => ({ items: merge3(l.items, s.items, b?.items, (t) => t.id, newer) }),
    empty: () => ({ items: [] }),
    flushDelay: 3000,
  };
});

export const loadSettings = (): MoneySettings => readJson(SETTINGS_DOC, emptySettings);

function saveSettings(settings: MoneySettings): MoneySettings {
  writeJson(SETTINGS_DOC, settings);
  markDirty(SETTINGS_DOC);
  return settings;
}

const byDateDesc = (a: Txn, b: Txn) => b.date.localeCompare(a.date) || (b.time ?? "").localeCompare(a.time ?? "");

export const loadMonth = (month: string): Txn[] =>
  readJson<MonthDoc>(monthKey(month), () => ({ items: [] })).items.slice().sort(byDateDesc);

// Months with data: those the settings list, plus any only this browser has.
export function allMonths(): string[] {
  const months = new Set(loadSettings().months);
  for (let i = 0; i < localStorage.length; i++) {
    const m = localStorage.key(i)?.slice(STORAGE_PREFIX.length).match(MONTH_DOC);
    if (m) months.add(m[1]);
  }
  return [...months].sort();
}

export const loadAllTxns = (): Txn[] => allMonths().flatMap(loadMonth).sort(byDateDesc);

// Write `txns` into their month docs, replacing any with the same id, and drop `removed` ids.
function writeTxns(txns: Txn[], removed: { id: string; date: string }[] = []): void {
  const months = new Set([...txns, ...removed].map((t) => monthOf(t.date)));
  for (const month of months) {
    const drop = new Set(removed.filter((r) => monthOf(r.date) === month).map((r) => r.id));
    const incoming = txns.filter((t) => monthOf(t.date) === month);
    const ids = new Set(incoming.map((t) => t.id));
    const items = readJson<MonthDoc>(monthKey(month), () => ({ items: [] })).items.filter((t) => !drop.has(t.id) && !ids.has(t.id));
    writeJson(monthKey(month), { items: [...items, ...incoming] });
    markDirty(monthKey(month));
  }
  const settings = loadSettings();
  const added = [...new Set(txns.map((t) => monthOf(t.date)))].filter((m) => !settings.months.includes(m));
  if (added.length) saveSettings({ ...settings, months: [...settings.months, ...added].sort() });
}

export type TxnInput = Omit<Txn, "id" | "updatedAt" | "source"> & { id?: string; source?: Txn["source"] };

// One added for today is stamped with the time now; for another day the time isn't known.
export function addTxn(input: TxnInput): Txn {
  const now = new Date();
  const time = input.date === toDateString(now) ? `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}` : undefined;
  const txn: Txn = { source: "manual", ...(time && { time }), ...input, id: input.id ?? crypto.randomUUID(), updatedAt: Date.now() };
  writeTxns([txn]);
  return txn;
}

export function updateTxn(txn: Txn, changes: Partial<Omit<Txn, "id" | "source" | "updatedAt">>): Txn {
  const next = { ...txn, ...changes, updatedAt: Date.now() };
  writeTxns([next], monthOf(next.date) === monthOf(txn.date) ? [] : [txn]);
  return next;
}

export const deleteTxn = (txn: Txn): void => writeTxns([], [txn]);

// ---------------- People, limits, rules ----------------

const DEFAULT_ME: Person = { id: ME, name: "Me", aliases: [], updatedAt: 0 };

// You first, then everyone else in the order they were added.
export function peopleOf(settings: MoneySettings): Person[] {
  const me = settings.people.find((p) => p.id === ME) ?? DEFAULT_ME;
  return [me, ...settings.people.filter((p) => p.id !== ME)];
}

export function savePerson(person: { id?: string; name: string; aliases: string[] }): Person {
  const saved: Person = {
    id: person.id ?? crypto.randomUUID(),
    name: person.name.trim(),
    aliases: [...new Set(person.aliases.map((a) => a.trim()).filter(Boolean))],
    updatedAt: Date.now(),
  };
  const settings = loadSettings();
  saveSettings({ ...settings, people: [...settings.people.filter((p) => p.id !== saved.id), saved] });
  return saved;
}

// Remember that `name` (as it shows in a statement) is `personId`, for later imports. A name that
// already matches them, or you, is left alone.
export function addAlias(personId: string, name: string): void {
  const [me, ...others] = peopleOf(loadSettings());
  const person = others.find((p) => p.id === personId);
  if (!person || !normalizeName(name) || matchPerson(name, [me, person])) return;
  savePerson({ ...person, aliases: [...person.aliases, name] });
}

export function removePerson(id: string): void {
  if (id === ME) return;
  const settings = loadSettings();
  saveSettings({ ...settings, people: settings.people.filter((p) => p.id !== id) });
}

export const valueOf = (settings: MoneySettings, key: string): number | undefined =>
  settings.values.find((v) => v.key === key)?.value;

// Set a limit, income or goal; undefined (or 0) clears it.
export function setValue(key: string, value: number | undefined): MoneySettings {
  const settings = loadSettings();
  const values = settings.values.filter((v) => v.key !== key);
  if (value && value > 0) values.push({ key, value, updatedAt: Date.now() });
  return saveSettings({ ...settings, values });
}

export const normalizeName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Remember that `payee` belongs in `category`, for later imports.
export function setRule(payee: string, category: CategoryId): void {
  const key = normalizeName(payee);
  if (!key) return;
  const settings = loadSettings();
  if (settings.rules.some((r) => r.payee === key && r.category === category)) return;
  saveSettings({ ...settings, rules: [...settings.rules.filter((r) => r.payee !== key), { payee: key, category, updatedAt: Date.now() }] });
}

// Every category whose keywords the payee's name matches, in order; the first is the guess.
export function categoryMatches(payee: string): CategoryId[] {
  const padded = ` ${normalizeName(payee)}`;
  return CATEGORIES.filter((c) => c.keywords.some((k) => padded.includes(` ${k}`))).map((c) => c.id);
}

export function categorize(payee: string, rules: Rule[]): CategoryId {
  const name = normalizeName(payee);
  return rules.find((r) => r.payee === name)?.category ?? categoryMatches(payee)[0] ?? "other";
}

// ---------------- Review ----------------

export type ReviewItem = { payee: string; txns: Txn[]; total: number; choices: CategoryId[] };

// Imported spending whose category nobody has confirmed: no learned rule for the payee, and either
// still "Other" or matching more than one category's keywords (a "Shri Devi Hospitality" is
// guessed Food but also matches Health's "hospital"). One item per payee, biggest total first.
export function reviewQueue(txns: Txn[], rules: Rule[]): ReviewItem[] {
  const ruled = new Set(rules.map((r) => r.payee));
  const items = new Map<string, ReviewItem>();
  for (const t of txns) {
    const key = normalizeName(t.payee);
    if ((t.source !== "gpay" && t.source !== "paytm") || !spentOf(t) || !key || ruled.has(key)) continue;
    const choices = categoryMatches(t.payee);
    if (t.category !== "other" && choices.length < 2) continue;
    const item = items.get(key) ?? { payee: t.payee, txns: [], total: 0, choices };
    item.txns.push(t);
    item.total = round(item.total + spentOf(t));
    items.set(key, item);
  }
  return [...items.values()].sort((a, b) => b.total - a.total);
}

// Answer a review item: remember the payee's category for later imports and file its spending under it.
export function fileUnder(item: ReviewItem, category: CategoryId): void {
  setRule(item.payee, category);
  const now = Date.now();
  const changed = item.txns.filter((t) => t.category !== category).map((t) => ({ ...t, category, updatedAt: now }));
  if (changed.length) writeTxns(changed);
}

// The person whose name or alias `name` is: every word of the alias appears in it, so
// "Priya Sharma" matches "PRIYA R SHARMA". You are matched by your aliases only, not "Me". When
// several match, the longest alias wins, so "MEERA VIKRAM SHARMA" is Meera (alias "Meera
// Vikram Sharma"), not her father (alias "Vikram Sharma").
export function matchPerson(name: string, people: Person[]): Person | undefined {
  const words = new Set(normalizeName(name).split(" "));
  let best: Person | undefined;
  let bestLength = 0;
  for (const p of people) {
    for (const alias of [...(p.id === ME ? [] : [p.name]), ...p.aliases]) {
      const want = normalizeName(alias).split(" ").filter(Boolean);
      if (want.length > bestLength && want.every((w) => words.has(w))) {
        best = p;
        bestLength = want.length;
      }
    }
  }
  return best;
}

// The family the app starts with, as they show up in the statements, from the server's env (see
// lib/moneyFamily.ts). They're added once, after a sync shows there's no family yet; the
// "seeded:family" value (synced like the rest of the settings) keeps someone you remove from
// coming back. Nothing is marked while none is configured, so setting the env later still works.
const SEEDED = "seeded:family";
type StarterFamily = { me: string[]; family: { id: string; name: string; aliases: string[] }[] };

const unseeded = (settings: MoneySettings) => !valueOf(settings, SEEDED) && !settings.people.some((p) => p.id !== ME);

// Returns whether it added anyone.
export async function seedFamily(): Promise<boolean> {
  if (!unseeded(loadSettings())) return false;
  let starter: StarterFamily;
  try {
    const res = await fetch("/api/money/family", { cache: "no-store" });
    if (!res.ok) return false;
    starter = await res.json();
  } catch {
    return false;
  }
  if (!Array.isArray(starter?.family) || !starter.family.length) return false;
  const settings = loadSettings(); // again: it may have changed while asking
  if (!unseeded(settings)) return false;
  const now = Date.now();
  const me = settings.people.find((p) => p.id === ME) ?? DEFAULT_ME;
  const myNames = Array.isArray(starter.me) ? starter.me.map(String) : [];
  saveSettings({
    ...settings,
    people: [
      { ...me, aliases: me.aliases.length ? me.aliases : myNames, updatedAt: now },
      ...starter.family.map((p) => ({ id: String(p.id), name: String(p.name), aliases: (p.aliases ?? []).map(String), updatedAt: now })),
    ],
    values: [...settings.values, { key: SEEDED, value: 1, updatedAt: now }],
  });
  return true;
}

// ---------------- Import ----------------

export type ImportRow = { txn: Txn; duplicate: boolean };

// Turn statement rows into transactions for `ownerId`'s statement.
//  - A payment to a family member from your statement pays them back (settlement); in theirs, the
//    same payment shows as received from you. Both have the same UPI id, so it is kept once.
//  - Money received from someone you also paid in this statement is a refund; otherwise income.
// The UPI id is the same whichever app shows the payment, so a Paytm and a Google Pay statement dedupe too.
export function planImport(rows: StatementRow[], ownerId: string, settings: MoneySettings, existing: Set<string>, source: Txn["source"] = "gpay"): ImportRow[] {
  const people = peopleOf(settings);
  const paidTo = new Set(rows.filter((r) => r.direction === "out").map((r) => normalizeName(r.name)));
  return rows.map((r) => {
    const other = matchPerson(r.name, people);
    let kind: Kind;
    let personId = ownerId;
    if (r.direction === "out") {
      if (other && other.id !== ownerId && ownerId === ME) {
        kind = "settlement";
        personId = other.id;
      } else kind = other ? "transfer" : "spend";
    } else if (other) {
      kind = other.id === ME && ownerId !== ME ? "settlement" : "transfer";
    } else kind = paidTo.has(normalizeName(r.name)) ? "refund" : "income";
    const category = kind === "spend" || kind === "refund" ? categorize(r.name, settings.rules) : kind === "income" ? "other" : "family";
    const txn: Txn = {
      id: `gpay:${r.upi}`,
      date: r.date,
      time: r.time,
      amount: r.amount,
      payee: r.name,
      category,
      kind,
      personId,
      source,
      updatedAt: Date.now(),
    };
    return { txn, duplicate: existing.has(txn.id) };
  });
}

export const importTxns = (txns: Txn[]): void => writeTxns(txns);

// ---------------- Summaries ----------------

// What a transaction adds to spending: refunds take it back off.
export const spentOf = (t: Txn) => (t.kind === "spend" ? t.amount : t.kind === "refund" ? -t.amount : 0);
const round = (n: number) => Math.round(n * 100) / 100;

export type MonthSummary = {
  spent: number;
  income: number; // the monthly income setting plus income logged for you this month
  saved: number;
  cash: number; // the part of `spent` paid in cash
  byCategory: Partial<Record<CategoryId, number>>;
  byPerson: Record<string, number>;
  paidTo: Record<string, number>; // what you paid back each family member this month
};

export function summarize(txns: Txn[], month: string, settings: MoneySettings): MonthSummary {
  const inMonth = txns.filter((t) => monthOf(t.date) === month);
  const byCategory: Partial<Record<CategoryId, number>> = {};
  const byPerson: Record<string, number> = {};
  const paidTo: Record<string, number> = {};
  let spent = 0;
  let cash = 0;
  let income = valueOf(settings, "income") ?? 0;
  for (const t of inMonth) {
    const s = spentOf(t);
    if (s) {
      spent += s;
      if (t.source === "cash") cash += s;
      byCategory[t.category] = round((byCategory[t.category] ?? 0) + s);
      byPerson[t.personId] = round((byPerson[t.personId] ?? 0) + s);
    }
    if (t.kind === "income" && t.personId === ME) income += t.amount;
    if (t.kind === "settlement" && t.personId !== ME) paidTo[t.personId] = round((paidTo[t.personId] ?? 0) + t.amount);
  }
  return { spent: round(spent), cash: round(cash), income: round(income), saved: round(income - spent), byCategory, byPerson, paidTo };
}

export type LastPayment = { date: string; time?: string; amount: number; spentSince: number };

// The day you last paid each family member back, what you paid them that day, and what they've
// spent after it. Spending that day before the payment (or with no time) counts as covered by it.
export function lastPayments(txns: Txn[]): Record<string, LastPayment> {
  const at = (t: Txn) => `${t.date} ${t.time ?? ""}`;
  const last: Record<string, Txn> = {};
  for (const t of txns) {
    if (t.kind !== "settlement" || t.personId === ME) continue;
    if (!last[t.personId] || at(t) > at(last[t.personId])) last[t.personId] = t;
  }
  const out: Record<string, LastPayment> = {};
  for (const [personId, payment] of Object.entries(last)) {
    let amount = 0;
    let spentSince = 0;
    for (const t of txns) {
      if (t.personId !== personId) continue;
      if (t.kind === "settlement" && t.date === payment.date) amount += t.amount;
      else if (at(t) > at(payment)) spentSince += spentOf(t);
    }
    out[personId] = { date: payment.date, time: payment.time, amount: round(amount), spentSince: round(spentSince) };
  }
  return out;
}

// What you owe each family member: what they've spent since you last paid them, since each
// payment covers what they'd spent up to then (see lastPayments), or all they've spent if you
// never have. Earlier months you never imported don't matter that way.
export function balances(txns: Txn[]): Record<string, number> {
  const paid = lastPayments(txns);
  const owed: Record<string, number> = {};
  for (const t of txns) {
    if (t.personId === ME || paid[t.personId]) continue;
    const s = spentOf(t);
    if (s) owed[t.personId] = round((owed[t.personId] ?? 0) + s);
  }
  for (const [personId, p] of Object.entries(paid)) owed[personId] = p.spentSince;
  return owed;
}

// Whose statement it looks like, from the email printed at its top: the person whose first name
// is in it ("priyasharmapune@gmail.com" is Priya's). You're matched by your statement names.
// A Paytm statement may only print the holder's name, which is matched like a payee's.
export function guessOwner(email: string | undefined, people: Person[], holder?: string): Person | undefined {
  const local = (email ?? "").split("@")[0].toLowerCase().replace(/[^a-z]/g, "");
  const byEmail =
    local &&
    people.find((p) =>
      [...(p.id === ME ? [] : [p.name]), ...p.aliases].some((alias) => {
        const first = normalizeName(alias).split(" ")[0];
        return first.length >= 3 && local.includes(first);
      })
    );
  return byEmail || (holder ? matchPerson(holder, people) : undefined);
}

// ---------------- Backup ----------------

export type MoneyBackup = { app: "money"; version: 1; settings: MoneySettings; txns: Txn[] };

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export const moneyBackup = (): MoneyBackup => ({ app: "money", version: 1, settings: loadSettings(), txns: loadAllTxns() });

export const exportMoney = (): void =>
  download(`money-backup-${getTodayDate()}.json`, JSON.stringify(moneyBackup(), null, 2), "application/json");

const csvCell = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

// One row per transaction, oldest first, for a spreadsheet. "Spending" is what it adds to spending
// (a refund is negative; income, paying back and transfers are 0).
export function moneyCsv(txns: Txn[], people: Person[]): string {
  const header = ["Date", "Time", "Type", "Amount", "Spending", "Category", "Payee", "Whose", "Note", "Source"];
  const rows = txns
    .slice()
    .reverse()
    .map((t) => [
      t.date,
      t.time ?? "",
      KINDS.find((k) => k.id === t.kind)?.label ?? t.kind,
      t.amount,
      spentOf(t),
      categoryOf(t.category).label,
      t.payee,
      t.personId === ME ? "Me" : people.find((p) => p.id === t.personId)?.name ?? "Removed person",
      t.note ?? "",
      t.source,
    ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}

// With a byte-order mark, so Excel reads names and ₹ correctly.
export const exportMoneyCsv = (): void =>
  download(`money-transactions-${getTodayDate()}.csv`, "\uFEFF" + moneyCsv(loadAllTxns(), peopleOf(loadSettings())), "text/csv");

const isTxn = (t: unknown): t is Txn =>
  !!t &&
  typeof (t as Txn).id === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(String((t as Txn).date)) &&
  typeof (t as Txn).amount === "number" &&
  KINDS.some((k) => k.id === (t as Txn).kind);

// Add a backup from exportMoney() to what's here: a transaction with the same id takes the
// backup's copy, settings merge by newest, and nothing is deleted. Pulls the latest first.
export async function restoreMoney(text: string): Promise<number> {
  let parsed: Partial<MoneyBackup>;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  if (parsed?.app !== "money" || !Array.isArray(parsed.txns)) throw new Error("Not a Money backup file.");
  const txns = parsed.txns.filter(isTxn);
  await syncMoney();
  const s = parsed.settings;
  if (s && typeof s === "object") {
    const backup = { ...emptySettings(), ...s };
    if ([backup.people, backup.values, backup.rules, backup.months].every(Array.isArray)) saveSettings(mergeSettings(loadSettings(), backup));
  }
  writeTxns(txns);
  return txns.length;
}

// ---------------- Dates ----------------

export const currentMonth = () => monthOf(getTodayDate());

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ---------------- Sync ----------------

// Pull the settings, then every month they list, and push what the server lacks.
// Resolves to whether anything changed here, or null when offline.
export async function syncMoney(force = false): Promise<boolean | null> {
  const before = allMonths();
  const first = await syncKeys([SETTINGS_DOC, ...before.map(monthKey)], { force });
  if (first === null) return null;
  // Another device may have added months; pull those too.
  const added = allMonths().filter((m) => !before.includes(m)).map(monthKey);
  const second = added.length ? (await syncKeys(added, { force: true })) ?? [] : [];
  return first.length + second.length > 0;
}

// Delete every transaction, person, limit and learned category, on every device: pull the latest
// first so nothing another device added is missed, then push the emptied docs. The three-way merge
// carries the deletes to other devices. Resolves to false, deleting nothing, when offline.
export async function deleteAllMoney(): Promise<boolean> {
  if ((await syncMoney(true)) === null) return false;
  const keys = [SETTINGS_DOC, ...allMonths().map(monthKey)];
  for (const key of keys.slice(1)) {
    writeJson(key, { items: [] });
    markDirty(key);
  }
  saveSettings(emptySettings());
  await flush(keys);
  return true;
}

// While a page is open, re-sync when the tab comes back into view, and call `onChange` when
// another device's edits arrive.
export function useMoneySync(onChange: () => void): void {
  useEffect(() => {
    const keys = [SETTINGS_DOC, ...allMonths().map(monthKey)];
    const stop = watchKeys(keys);
    const onSync = (e: Event) => {
      if ((e as CustomEvent<{ keys: string[] }>).detail.keys.some((k) => k === SETTINGS_DOC || MONTH_DOC.test(k))) onChange();
    };
    window.addEventListener(SYNC_EVENT, onSync);
    return () => {
      stop();
      window.removeEventListener(SYNC_EVENT, onSync);
    };
    // onChange reloads from localStorage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
