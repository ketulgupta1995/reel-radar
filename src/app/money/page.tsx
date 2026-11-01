"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CATEGORIES,
  ME,
  addAlias,
  addTxn,
  balances,
  categorize,
  categoryOf,
  currentMonth,
  deleteTxn,
  lastPayments,
  loadAllTxns,
  loadSettings,
  matchPerson,
  monthOf,
  peopleOf,
  reviewQueue,
  seedFamily,
  setRule,
  shiftMonth,
  spentOf,
  summarize,
  syncMoney,
  updateTxn,
  useMoneySync,
  valueOf,
  type CategoryId,
  type Kind,
  type LastPayment,
  type MoneySettings,
  type Person,
  type Txn,
} from "@/lib/money";
import { getTodayDate } from "@/lib/todos";
import {
  Avatar,
  CARD,
  CHIP,
  CategoryIcon,
  CategorySelect,
  FIELD,
  KindSelect,
  Meter,
  MoneyShell,
  PaidToSelect,
  SMALL_SELECT,
  Sheet,
  chipState,
  formatDay,
  formatMonth,
  formatTime,
  formatWeekday,
  inr,
  personName,
} from "./shared";
import { ReviewQueue } from "./ReviewQueue";

const KIND_BADGE: Partial<Record<Kind, string>> = {
  refund: "Refund",
  income: "Income",
  settlement: "Paid back",
  transfer: "Ignored",
};
const INCOMING: Kind[] = ["refund", "income"];

export default function MoneyPage() {
  const [month, setMonth] = useState("");
  const [today, setToday] = useState("");
  const [settings, setSettings] = useState<MoneySettings | null>(null);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [adding, setAdding] = useState(false);
  const [addingCash, setAddingCash] = useState(false);

  const reload = useCallback(() => {
    setSettings(loadSettings());
    setTxns(loadAllTxns());
  }, []);

  // This browser's copy first, then the server's. The starter family is only added once the
  // server has been asked, so a new device doesn't add it before learning it's already there.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("month");
    setMonth(wanted && /^\d{4}-\d{2}$/.test(wanted) ? wanted : currentMonth());
    setToday(getTodayDate());
    reload();
    syncMoney().then(async (changed) => {
      if ((changed !== null && (await seedFamily())) || changed) reload();
    });
  }, [reload]);
  useMoneySync(reload);

  const people = useMemo(() => (settings ? peopleOf(settings) : []), [settings]);
  const summary = useMemo(() => (settings && month ? summarize(txns, month, settings) : null), [txns, month, settings]);
  const lastMonth = useMemo(() => (settings && month ? summarize(txns, shiftMonth(month, -1), settings) : null), [txns, month, settings]);
  const owed = useMemo(() => balances(txns), [txns]);
  const paid = useMemo(() => lastPayments(txns), [txns]);
  const inMonth = useMemo(() => txns.filter((t) => monthOf(t.date) === month), [txns, month]);
  const toSort = useMemo(() => (settings ? reviewQueue(txns, settings.rules) : []), [txns, settings]);

  if (!settings || !summary || !lastMonth) return <MoneyShell active="overview" />;

  const family = people.filter((p) => p.id !== ME);
  const owedTotal = family.reduce((n, p) => n + Math.max(0, owed[p.id] ?? 0), 0);

  const payBack = (personId: string, amount: number) => {
    addTxn({ date: getTodayDate(), amount, payee: personName(people, personId), category: "family", kind: "settlement", personId });
    reload();
  };
  const change = (t: Txn, changes: Partial<Txn>) => {
    // A hand-logged cash entry's name ("Cash") says nothing about later imports.
    if (changes.category && t.source !== "cash") setRule(t.payee, changes.category);
    // Paying back needs a family member to be sent to; the first one, until picked.
    if (changes.kind === "settlement" && t.personId === ME && family.length) changes = { ...changes, personId: family[0].id };
    // Picking who a payment was sent to remembers their name in the statement, for later imports.
    if (changes.personId && changes.personId !== ME && (changes.kind ?? t.kind) === "settlement" && t.source !== "manual") addAlias(changes.personId, t.payee);
    updateTxn(t, changes);
    reload();
  };
  const remove = (t: Txn) => {
    deleteTxn(t);
    reload();
  };

  return (
    <MoneyShell active="overview">
      <Hero
        month={month}
        today={today}
        settings={settings}
        spent={summary.spent}
        cash={summary.cash}
        income={summary.income}
        saved={summary.saved}
        owedTotal={owedTotal}
        lastMonthSpent={lastMonth.spent}
        txns={inMonth}
        onMonth={setMonth}
      />

      <ReviewQueue items={toSort} people={people} onSorted={reload} />

      <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
        <Categories month={month} settings={settings} byCategory={summary.byCategory} spent={summary.spent} />
        {family.length > 0 && (
          <section className={CARD} aria-label="Family balances">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="font-semibold">Family</h2>
              <Link href="/money/settings" className="text-xs text-white/45 hover:text-gold">
                Manage
              </Link>
            </div>
            <ul className="space-y-2.5">
              {family.map((p) => (
                <FamilyCard
                  key={p.id}
                  person={p}
                  people={people}
                  due={owed[p.id] ?? 0}
                  spent={summary.byPerson[p.id] ?? 0}
                  paidThisMonth={summary.paidTo[p.id] ?? 0}
                  last={paid[p.id]}
                  history={txns.filter((t) => t.personId === p.id || (t.personId === ME && !!matchPerson(t.payee, [p])))}
                  onPay={payBack}
                />
              ))}
            </ul>
          </section>
        )}
      </div>

      <Transactions txns={inMonth} people={people} onChange={change} onDelete={remove} onAdd={() => setAdding(true)} />

      <button
        onClick={() => setAddingCash(true)}
        aria-label="Add cash spending"
        className="fixed bottom-[5.5rem] right-6 z-30 flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-panel/90 text-xl shadow-xl shadow-black/40 backdrop-blur transition hover:scale-105 hover:border-gold/40 sm:bottom-[6.5rem] sm:right-9"
      >
        💵
      </button>
      <button
        onClick={() => setAdding(true)}
        aria-label="Add a transaction"
        className="fixed bottom-6 right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-gold text-3xl font-light text-ink shadow-2xl shadow-gold/30 transition hover:scale-105 sm:bottom-8 sm:right-8"
      >
        +
      </button>
      {adding && (
        <AddSheet
          people={people}
          settings={settings}
          defaultDate={month === currentMonth() ? getTodayDate() : `${month}-01`}
          onAdd={reload}
          onClose={() => setAdding(false)}
        />
      )}
      {addingCash && <CashSheet defaultDate={month === currentMonth() ? getTodayDate() : `${month}-01`} onAdd={reload} onClose={() => setAddingCash(false)} />}
    </MoneyShell>
  );
}

function Hero({
  month,
  today,
  settings,
  spent,
  cash,
  income,
  saved,
  owedTotal,
  lastMonthSpent,
  txns,
  onMonth,
}: {
  month: string;
  today: string;
  settings: MoneySettings;
  spent: number;
  cash: number;
  income: number;
  saved: number;
  owedTotal: number;
  lastMonthSpent: number;
  txns: Txn[];
  onMonth: (m: string) => void;
}) {
  const limit = valueOf(settings, "limit:total");
  const goal = valueOf(settings, "goal");
  const [y, m] = month.split("-").map(Number);
  const days = new Date(y, m, 0).getDate();
  const isCurrent = monthOf(today) === month;
  const daysLeft = isCurrent ? days - Number(today.slice(8)) + 1 : 0;
  const diff = lastMonthSpent > 0 ? Math.round(((spent - lastMonthSpent) / lastMonthSpent) * 100) : null;

  return (
    <section className="relative overflow-hidden rounded-[2rem] border border-white/15 bg-gradient-to-br from-white/[.10] via-white/[.04] to-white/[.02] p-5 shadow-2xl shadow-black/40 backdrop-blur-xl sm:p-7" aria-label="Month totals">
      <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-emerald-500/15 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-28 left-1/4 h-64 w-64 rounded-full bg-gold/15 blur-3xl" />

      <div className="relative flex items-center justify-between gap-3">
        <button onClick={() => onMonth(shiftMonth(month, -1))} aria-label="Previous month" className="h-9 w-9 rounded-full border border-white/15 bg-black/20 text-white/70 hover:border-gold/40 hover:text-gold">
          ‹
        </button>
        <h1 className="text-base font-semibold text-white/85 sm:text-lg">{formatMonth(month)}</h1>
        <button onClick={() => onMonth(shiftMonth(month, 1))} aria-label="Next month" className="h-9 w-9 rounded-full border border-white/15 bg-black/20 text-white/70 hover:border-gold/40 hover:text-gold">
          ›
        </button>
      </div>

      <div className="relative mt-5 grid gap-6 md:grid-cols-[1fr_1.2fr] md:items-end">
        <div>
          <p className="text-xs uppercase tracking-[.2em] text-white/50">Spent</p>
          <p className="mt-1 bg-gradient-to-r from-white via-white to-gold/80 bg-clip-text text-4xl font-bold tabular-nums text-transparent sm:text-5xl" data-testid="spent">
            {inr(spent)}
          </p>
          {cash > 0 && (
            <p className="text-xs text-white/50" data-testid="cash">
              💵 {inr(cash)} of it in cash
            </p>
          )}
          {diff !== null && (
            <p className={`mt-1 text-xs ${diff > 0 ? "text-rose-300" : "text-emerald-300"}`}>
              {diff > 0 ? "▲" : "▼"} {Math.abs(diff)}% vs {formatMonth(shiftMonth(month, -1)).split(" ")[0]} ({inr(lastMonthSpent)})
            </p>
          )}
          {limit ? (
            <div className="mt-4 space-y-1.5">
              <Meter value={spent} limit={limit} label="Spent of monthly limit" thick />
              <p className={`text-xs ${spent > limit ? "text-red-400" : "text-white/55"}`}>
                {spent > limit ? `${inr(spent - limit)} over` : `${inr(limit - spent)} left`} of {inr(limit)}
                {isCurrent && spent < limit && daysLeft > 0 && <span className="text-white/40"> · about {inr(Math.floor((limit - spent) / daysLeft))} a day</span>}
              </p>
            </div>
          ) : (
            <Link href="/money/settings" className="mt-3 inline-block text-xs text-white/50 hover:text-gold">
              Set a monthly limit →
            </Link>
          )}
        </div>
        <DailyChart txns={txns} month={month} days={days} today={isCurrent ? today : ""} />
      </div>

      <div className="relative mt-6 grid grid-cols-3 gap-2 sm:gap-3">
        <Stat label="Income" testId="income" value={inr(income)}>
          {!valueOf(settings, "income") && (
            <Link href="/money/settings" className="text-[11px] text-white/45 hover:text-gold">
              Add your monthly income →
            </Link>
          )}
        </Stat>
        <Stat label="Saved" testId="saved" value={inr(saved)} tone={saved < 0 ? "text-red-400" : "text-emerald-400"}>
          {goal ? (
            <div className="space-y-1">
              <Meter value={Math.max(0, saved)} limit={goal} label="Saved of savings goal" />
              <p className="text-[11px] text-white/45">Goal {inr(goal)}</p>
            </div>
          ) : null}
        </Stat>
        <Stat label="You owe family" testId="owed" value={inr(owedTotal)}>
          <p className="text-[11px] text-white/45">Since you last paid</p>
        </Stat>
      </div>
    </section>
  );
}

function Stat({ label, value, testId, tone = "", children }: { label: string; value: string; testId: string; tone?: string; children?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/10 bg-black/20 p-3 sm:p-4">
      <p className="truncate text-[10px] uppercase tracking-wider text-white/50 sm:text-xs">{label}</p>
      <p className={`mt-0.5 truncate text-base font-bold tabular-nums sm:text-xl ${tone}`} data-testid={testId}>
        {value}
      </p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

// One bar per day of the month, with a dashed line at the daily average. Hover or tap a bar to see
// the day's total.
function DailyChart({ txns, month, days, today }: { txns: Txn[]; month: string; days: number; today: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const net = useMemo(() => {
    const out = Array<number>(days).fill(0);
    for (const t of txns) out[Number(t.date.slice(8)) - 1] += spentOf(t);
    return out;
  }, [txns, days]);
  const perDay = net.map((n) => Math.max(0, n)); // a day of refunds shows as nothing, not below zero
  const max = Math.max(...perDay);
  const elapsed = today ? Number(today.slice(8)) : days;
  const avg = net.slice(0, elapsed).reduce((a, b) => a + b, 0) / Math.max(1, elapsed);
  const shown = hover ?? (max > 0 ? perDay.indexOf(max) : null);
  const dateOf = (i: number) => `${month}-${String(i + 1).padStart(2, "0")}`;

  return (
    <figure aria-label="Spending by day" className="min-w-0">
      <figcaption className="mb-2 flex items-baseline justify-between gap-2 text-xs">
        <span className="text-white/50">Daily average {inr(Math.round(avg))}</span>
        {shown !== null && (
          <span className="tabular-nums text-white/80" data-testid="day-tip">
            {formatDay(dateOf(shown))} · {inr(perDay[shown])}
            {hover === null && <span className="text-white/40"> (most)</span>}
          </span>
        )}
      </figcaption>
      <div className="relative flex h-24 items-end gap-[2px]" onMouseLeave={() => setHover(null)}>
        {max > 0 && avg > 0 && (
          <div aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-dashed border-white/25" style={{ bottom: `${(avg / max) * 100}%` }} />
        )}
        {perDay.map((n, i) => (
          <button
            key={i}
            type="button"
            aria-label={`${formatDay(dateOf(i))}: ${inr(n)}`}
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onClick={() => setHover(i)}
            className="group flex h-full min-w-0 flex-1 items-end"
          >
            <span
              className={`block w-full rounded-t-[3px] transition ${i === shown ? "bg-gold" : dateOf(i) === today ? "bg-white/50" : i < elapsed ? "bg-gold/45 group-hover:bg-gold/70" : "bg-white/10"}`}
              style={{ height: n > 0 ? `${Math.max(4, (n / max) * 100)}%` : "2px" }}
            />
          </button>
        ))}
      </div>
      <div aria-hidden className="mt-1 flex justify-between text-[10px] text-white/35">
        <span>1</span>
        <span>{Math.ceil(days / 2)}</span>
        <span>{days}</span>
      </div>
    </figure>
  );
}

function Categories({ month, settings, byCategory, spent }: { month: string; settings: MoneySettings; byCategory: Partial<Record<CategoryId, number>>; spent: number }) {
  const categories = CATEGORIES.map((c) => ({ ...c, spent: byCategory[c.id] ?? 0, limit: valueOf(settings, `limit:${c.id}`) }))
    .filter((c) => c.spent !== 0 || c.limit)
    .sort((a, b) => b.spent - a.spent);
  const maxCategory = Math.max(1, ...categories.map((c) => c.spent));
  return (
    <section className={CARD} aria-label="Spending by category">
      <h2 className="mb-3 font-semibold">Where it went</h2>
      {categories.length === 0 ? (
        <p className="text-sm text-white/55">
          Nothing spent in {formatMonth(month)} yet. Tap + to add an expense, or{" "}
          <Link href="/money/import" className="text-gold hover:underline">
            import a Google Pay statement
          </Link>
          .
        </p>
      ) : (
        <ul className="space-y-3">
          {categories.map((c) => {
            const over = c.limit !== undefined && c.spent > c.limit;
            return (
              <li key={c.id} className="flex items-center gap-3">
                <CategoryIcon id={c.id} />
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate">{c.label}</span>
                    <span className="shrink-0 tabular-nums">
                      <span className={over ? "text-red-400" : "text-white/85"}>{inr(c.spent)}</span>
                      {c.limit ? <span className="text-white/40"> / {inr(c.limit)}</span> : spent > 0 && <span className="ml-1.5 text-xs text-white/35">{Math.round((c.spent / spent) * 100)}%</span>}
                    </span>
                  </div>
                  <Meter value={c.spent} limit={c.limit ?? maxCategory} label={c.label} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// Where a transaction with a family member stands: a payment to them, spending that counts toward
// what you owe (after your last payment), spending a payment already covered, or not counted.
type Standing = "paid" | "counted" | "covered" | "ignored";
const STANDING: Record<Standing, { label: string; tone: string }> = {
  paid: { label: "You paid", tone: "border-gold/30 bg-gold/10 text-gold" },
  counted: { label: "Owed", tone: "border-rose-400/30 bg-rose-400/10 text-rose-200" },
  covered: { label: "Covered", tone: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300" },
  ignored: { label: "Not counted", tone: "border-white/10 text-white/45" },
};

function FamilyCard({
  person,
  people,
  due,
  spent,
  paidThisMonth,
  last,
  history,
  onPay,
}: {
  person: Person;
  people: Person[];
  due: number;
  spent: number;
  paidThisMonth: number;
  last?: LastPayment;
  history: Txn[]; // everything with them: their spending, your payments, and money between you
  onPay: (personId: string, amount: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const thisMonth = [spent ? `spent ${inr(spent)}` : "", paidThisMonth ? `you paid ${inr(paidThisMonth)}` : ""].filter(Boolean).join(" · ");
  const at = (date: string, time?: string) => `${date} ${time ?? ""}`;
  const standing = (t: Txn): Standing => {
    if (t.personId === ME || !spentOf(t)) return t.kind === "settlement" && t.personId !== ME ? "paid" : "ignored";
    return last && at(t.date, t.time) <= at(last.date, last.time) ? "covered" : "counted";
  };
  const payments = history.filter((t) => t.kind === "settlement" && t.personId === person.id);
  const lastDay = last ? payments.filter((t) => t.date === last.date).length : 0;
  const paidTotal = payments.reduce((n, t) => n + t.amount, 0);
  const spentTotal = history.reduce((n, t) => n + (t.personId === person.id ? spentOf(t) : 0), 0);

  return (
    <li className="rounded-2xl border border-white/5 bg-black/20">
      <div className="flex items-center gap-3 p-3">
        <Avatar person={person} people={people} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <span className="truncate font-medium">{person.name}</span>
            <span className={`text-sm font-semibold tabular-nums ${due > 0 ? "text-gold" : "text-white/45"}`}>{due > 0 ? `you owe ${inr(due)}` : "all settled"}</span>
          </div>
          {thisMonth && <p className="text-xs text-white/60">{thisMonth} this month</p>}
          <p className="text-[11px] text-white/40">
            {last
              ? `Spent since you paid ${inr(last.amount)} on ${formatDay(last.date)}${lastDay > 1 ? ` (${lastDay} payments, last` : ""}${last.time ? `${lastDay > 1 ? " at" : ","} ${formatTime(last.time)}` : ""}${lastDay > 1 ? ")" : ""}`
              : "Everything they've spent; not paid back yet"}
          </p>
          {history.length > 0 && (
            <button onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} transactions with ${person.name}`} className="mt-1 text-[11px] text-gold/80 hover:text-gold">
              {open ? "Hide transactions ▴" : `Show transactions (${history.length}) ▾`}
            </button>
          )}
        </div>
        {due > 0 && (
          <button onClick={() => onPay(person.id, due)} aria-label={`Mark ${inr(due)} paid to ${person.name}`} className="shrink-0 rounded-full bg-gold px-3 py-1.5 text-xs font-semibold text-ink hover:brightness-110">
            Paid ✓
          </button>
        )}
      </div>
      {open && (
        <div className="border-t border-white/5 px-3 pb-3 pt-2">
          <p className="mb-2 text-[11px] text-white/50">
            You paid {inr(paidTotal)} in {payments.length} payment{payments.length === 1 ? "" : "s"} · they spent {inr(spentTotal)} · {inr(Math.max(0, due))} owed since your last payment
          </p>
          <ul aria-label={`Transactions with ${person.name}`} className="max-h-80 space-y-1 overflow-y-auto pr-1">
            {history.map((t) => {
              const st = STANDING[standing(t)];
              return (
                <li key={t.id} className="flex items-center gap-2 rounded-xl bg-white/[.03] px-2.5 py-1.5 text-xs">
                  <span className="w-[4.5rem] shrink-0 text-white/45">
                    {formatDay(t.date)}
                    {t.time && <span className="block text-[10px] text-white/30">{formatTime(t.time)}</span>}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {t.payee}
                    {t.kind === "refund" && <span className="text-white/40"> · Refund</span>}
                  </span>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${st.tone}`}>{st.label}</span>
                  <span className="w-[4.75rem] shrink-0 text-right font-semibold tabular-nums">
                    {t.kind === "refund" ? "−" : ""}
                    {inr(t.amount)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </li>
  );
}

function Transactions({
  txns,
  people,
  onChange,
  onDelete,
  onAdd,
}: {
  txns: Txn[];
  people: Person[];
  onChange: (t: Txn, changes: Partial<Txn>) => void;
  onDelete: (t: Txn) => void;
  onAdd: () => void;
}) {
  const [who, setWho] = useState("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const shown = txns.filter(
    (t) => (who === "all" || t.personId === who) && (!q || t.payee.toLowerCase().includes(q) || t.note?.toLowerCase().includes(q) || categoryOf(t.category).label.toLowerCase().includes(q))
  );
  const days: { date: string; items: Txn[] }[] = [];
  for (const t of shown) {
    if (days[days.length - 1]?.date !== t.date) days.push({ date: t.date, items: [] });
    days[days.length - 1].items.push(t);
  }

  return (
    <section className={CARD} aria-label="Transactions">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">
          Transactions <span className="text-sm font-normal text-white/40">{shown.length}</span>
        </h2>
        <button onClick={onAdd} className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/75 hover:border-gold/40 hover:text-gold">
          + Add
        </button>
      </div>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input aria-label="Search transactions" placeholder="Search payee, note or category" value={query} onChange={(e) => setQuery(e.target.value)} className={`${FIELD} w-full sm:max-w-xs`} />
        {people.length > 1 && (
          <div className="scrollbar-hide -mx-1 flex gap-1.5 overflow-x-auto px-1">
            {[{ id: "all", name: "Everyone" }, ...people].map((p) => (
              <button key={p.id} onClick={() => setWho(p.id)} aria-pressed={who === p.id} className={`${CHIP} shrink-0 ${chipState(who === p.id)}`}>
                {p.id === ME ? "Me" : p.name.split(" ")[0]}
              </button>
            ))}
          </div>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-white/50">No transactions.</p>
      ) : (
        <div className="space-y-4">
          {days.map((d) => {
            const total = d.items.reduce((n, t) => n + spentOf(t), 0);
            return (
              <div key={d.date}>
                <h3 className="mb-1 flex justify-between px-1 text-[11px] uppercase tracking-wider text-white/40">
                  <span>{formatWeekday(d.date)}</span>
                  {total !== 0 && <span className="tabular-nums">{inr(total)}</span>}
                </h3>
                <ul className="divide-y divide-white/5 overflow-hidden rounded-2xl border border-white/5 bg-black/15">
                  {d.items.map((t) => (
                    <TxnRow
                      key={t.id}
                      txn={t}
                      people={people}
                      open={open === t.id}
                      onToggle={() => setOpen(open === t.id ? null : t.id)}
                      onChange={(changes) => onChange(t, changes)}
                      onDelete={() => onDelete(t)}
                    />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function TxnRow({
  txn: t,
  people,
  open,
  onToggle,
  onChange,
  onDelete,
}: {
  txn: Txn;
  people: Person[];
  open: boolean;
  onToggle: () => void;
  onChange: (changes: Partial<Txn>) => void;
  onDelete: () => void;
}) {
  const family = people.filter((p) => p.id !== ME);
  const muted = t.kind === "transfer" || t.kind === "settlement";
  const [note, setNote] = useState(t.note ?? "");
  useEffect(() => setNote(t.note ?? ""), [t.note]);
  return (
    <li className={open ? "bg-white/[.04]" : ""}>
      <button onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-white/[.03]">
        <CategoryIcon id={t.category} muted={muted} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{t.payee}</span>
          <span className="block truncate text-xs text-white/45">
            {personName(people, t.personId)}
            {KIND_BADGE[t.kind] ? ` · ${KIND_BADGE[t.kind]}` : ""}
            {t.source === "cash" ? " · 💵 Cash" : ""}
            {t.note ? ` · ${t.note}` : ""}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className={`block text-sm font-semibold tabular-nums ${INCOMING.includes(t.kind) ? "text-emerald-400" : muted ? "text-white/45" : ""}`}>
            {INCOMING.includes(t.kind) ? "+" : ""}
            {inr(t.amount)}
          </span>
          {t.time && <span className="block text-[11px] text-white/35">{formatTime(t.time)}</span>}
        </span>
      </button>
      {open && (
        <div className="flex flex-wrap items-center gap-2 px-3 pb-3 pl-[3.75rem]">
          <CategorySelect value={t.category} label={`Category for ${t.payee}`} onChange={(category) => onChange({ category })} />
          <KindSelect value={t.kind} label={`Type for ${t.payee}`} onChange={(kind) => onChange({ kind })} />
          {t.kind === "settlement"
            ? family.length > 0 && <PaidToSelect value={t.personId} people={family} label={`Paid to for ${t.payee}`} onChange={(personId) => onChange({ personId })} />
            : people.length > 1 && (
                <select aria-label={`Whose for ${t.payee}`} value={t.personId} onChange={(e) => onChange({ personId: e.target.value })} className={SMALL_SELECT}>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id === ME ? "Mine" : p.name}
                    </option>
                  ))}
                </select>
              )}
          <input
            aria-label={`Note for ${t.payee}`}
            placeholder="Add a note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => note.trim() !== (t.note ?? "") && onChange({ note: note.trim() || undefined })}
            className={`${SMALL_SELECT} min-w-0 flex-1 placeholder:text-white/30`}
          />
          <button onClick={onDelete} aria-label={`Delete ${t.payee}`} className="rounded-lg px-2.5 py-1.5 text-xs text-red-300/80 hover:bg-red-500/15 hover:text-red-300">
            Delete
          </button>
        </div>
      )}
    </li>
  );
}

const ADD_KINDS: { id: Kind; label: string }[] = [
  { id: "spend", label: "Spent" },
  { id: "income", label: "Income" },
  { id: "refund", label: "Refund" },
  { id: "settlement", label: "Paid back" },
];

function AddSheet({
  people,
  settings,
  defaultDate,
  onAdd,
  onClose,
}: {
  people: Person[];
  settings: MoneySettings;
  defaultDate: string;
  onAdd: () => void;
  onClose: () => void;
}) {
  const family = people.filter((p) => p.id !== ME);
  const [amount, setAmount] = useState("");
  const [payee, setPayee] = useState("");
  const [note, setNote] = useState("");
  const [category, setCategory] = useState<CategoryId | "">("");
  const [personId, setPersonId] = useState(ME);
  const [kind, setKind] = useState<Kind>("spend");
  const [date, setDate] = useState(defaultDate);
  const [added, setAdded] = useState("");

  const value = Number(amount);
  const guess = kind === "settlement" ? "family" : categorize(payee, settings.rules);
  const settling = kind === "settlement";
  const whose = settling ? family : people;
  const ready = value > 0 && (settling ? personId !== ME : !!payee.trim());

  const pickKind = (k: Kind) => {
    setKind(k);
    if (k === "settlement") setPersonId(family.some((p) => p.id === personId) ? personId : (family[0]?.id ?? ME));
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    const name = payee.trim() || personName(people, personId);
    addTxn({ date, amount: value, payee: name, category: category || guess, kind, personId, ...(note.trim() && { note: note.trim() }) });
    setAdded(`Added ${inr(value)} · ${name}`);
    setAmount("");
    setPayee("");
    setNote("");
    setCategory("");
    onAdd();
  };

  return (
    <Sheet title="Add a transaction" onClose={onClose}>
      <form onSubmit={submit} aria-label="Add a transaction" className="space-y-4">
        <div className="grid grid-cols-4 gap-1 rounded-2xl border border-white/10 bg-black/30 p-1 text-xs">
          {ADD_KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              aria-pressed={kind === k.id}
              onClick={() => pickKind(k.id)}
              disabled={k.id === "settlement" && !family.length}
              className={`rounded-xl px-2 py-2 transition disabled:opacity-30 ${kind === k.id ? "bg-gold font-semibold text-ink" : "text-white/70 hover:text-white"}`}
            >
              {k.label}
            </button>
          ))}
        </div>

        <label className="flex items-baseline justify-center gap-1 border-b border-white/10 pb-3">
          <span className="text-3xl text-white/40">₹</span>
          <input
            aria-label="Amount"
            inputMode="decimal"
            autoFocus
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
            className="w-48 bg-transparent text-center text-5xl font-bold tabular-nums text-white outline-none placeholder:text-white/20"
          />
        </label>

        {whose.length > 1 || settling ? (
          <div>
            <p className="mb-1.5 text-xs text-white/50">{settling ? "Paid to" : "Whose spending"}</p>
            <div role="group" aria-label="Whose" className="flex flex-wrap gap-1.5">
              {whose.map((p) => (
                <button key={p.id} type="button" aria-pressed={personId === p.id} onClick={() => setPersonId(p.id)} className={`${CHIP} flex items-center gap-1.5 py-1 pl-1 ${chipState(personId === p.id)}`}>
                  <Avatar person={p} people={people} size="sm" />
                  {p.id === ME ? "Me" : p.name.split(" ")[0]}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <input aria-label="What for" placeholder={settling ? "What for? (optional)" : "What for? (e.g. Swiggy)"} value={payee} onChange={(e) => setPayee(e.target.value)} className={`${FIELD} w-full`} />

        {!settling && (
          <div>
            <p className="mb-1.5 text-xs text-white/50">Category {!category && payee.trim() && <span className="text-white/35">· guessed</span>}</p>
            <div role="group" aria-label="Category" className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={(category || guess) === c.id}
                  aria-label={c.label}
                  onClick={() => setCategory(c.id)}
                  className={`flex flex-col items-center gap-0.5 rounded-xl border px-1 py-2 text-[10px] leading-tight transition ${(category || guess) === c.id ? "border-gold/50 bg-gold/15 text-gold" : "border-white/10 text-white/55 hover:border-white/25"}`}
                >
                  <span className="text-lg">{c.icon}</span>
                  <span className="w-full truncate text-center">{c.label.split(" ")[0]}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <input aria-label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value || defaultDate)} className={FIELD} />
          <input aria-label="Note" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} className={FIELD} />
        </div>

        {added && (
          <p role="status" className="text-center text-xs text-emerald-400">
            ✓ {added}
          </p>
        )}
        <button type="submit" disabled={!ready} className="w-full rounded-2xl bg-gold py-3 font-semibold text-ink transition hover:brightness-110 disabled:opacity-40">
          Add {value > 0 ? inr(value) : ""} {settling ? "" : categoryOf(category || guess).icon}
        </button>
      </form>
    </Sheet>
  );
}

// Cash spending in two taps: type the amount, tap a category, and it's saved as yours. It stays
// open for the next one.
function CashSheet({ defaultDate, onAdd, onClose }: { defaultDate: string; onAdd: () => void; onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const [what, setWhat] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [added, setAdded] = useState("");
  const value = Number(amount);

  const save = (category: CategoryId) => {
    if (!(value > 0)) return;
    addTxn({ date, amount: value, payee: what.trim() || "Cash", category, kind: "spend", personId: ME, source: "cash" });
    setAdded(`${inr(value)} cash · ${categoryOf(category).label}`);
    setAmount("");
    setWhat("");
    onAdd();
  };

  return (
    <Sheet title="Cash spent" onClose={onClose}>
      <div className="space-y-4">
        <label className="flex items-baseline justify-center gap-1 border-b border-white/10 pb-3">
          <span className="text-3xl text-white/40">₹</span>
          <input
            aria-label="Cash amount"
            inputMode="decimal"
            autoFocus
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
            className="w-48 bg-transparent text-center text-5xl font-bold tabular-nums text-white outline-none placeholder:text-white/20"
          />
        </label>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <input aria-label="What for (cash)" placeholder="What for? (optional)" value={what} onChange={(e) => setWhat(e.target.value)} className={FIELD} />
          <input aria-label="Cash date" type="date" value={date} onChange={(e) => setDate(e.target.value || defaultDate)} className={FIELD} />
        </div>
        <div>
          <p className="mb-1.5 text-xs text-white/50">Tap a category to save</p>
          <div role="group" aria-label="Save cash as" className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-label={`Save as ${c.label}`}
                disabled={!(value > 0)}
                onClick={() => save(c.id)}
                className="flex flex-col items-center gap-0.5 rounded-xl border border-white/10 px-1 py-2 text-[10px] leading-tight text-white/65 transition hover:border-gold/50 hover:text-gold disabled:opacity-35"
              >
                <span className="text-lg">{c.icon}</span>
                <span className="w-full truncate text-center">{c.label.split(" ")[0]}</span>
              </button>
            ))}
          </div>
        </div>
        {added && (
          <p role="status" className="text-center text-xs text-emerald-400">
            ✓ Added {added}
          </p>
        )}
      </div>
    </Sheet>
  );
}
