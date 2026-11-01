"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { parseStatementPdf, type Statement } from "@/lib/gpayStatement";
import {
  ME,
  addAlias,
  guessOwner,
  importTxns,
  loadAllTxns,
  loadSettings,
  matchPerson,
  monthOf,
  peopleOf,
  planImport,
  reviewQueue,
  savePerson,
  setRule,
  syncMoney,
  type ImportRow,
  type Kind,
  type MoneySettings,
  type Txn,
} from "@/lib/money";
import { ReviewQueue } from "../ReviewQueue";
import { Avatar, CARD, CHIP, CategoryIcon, CategorySelect, FIELD, KindSelect, MoneyShell, PaidToSelect, chipState, formatDay, formatMonth, inr, personName } from "../shared";

function readBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

// `movedFrom`: already imported, but as someone else's; importing it again moves it to this owner.
type Draft = ImportRow & { include: boolean; movedFrom?: string };

export default function MoneyImportPage() {
  const [settings, setSettings] = useState<MoneySettings | null>(null);
  const [owner, setOwner] = useState(ME);
  const [newName, setNewName] = useState("");
  const [statement, setStatement] = useState<Statement | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ count: number; month: string; ids: Set<string> } | null>(null);
  const [imported, setImported] = useState<Txn[]>([]); // the last import's transactions, as saved
  const [dragging, setDragging] = useState(false);
  const [onlyOther, setOnlyOther] = useState(false);
  const [guessed, setGuessed] = useState("");

  useEffect(() => {
    setSettings(loadSettings());
    syncMoney().then((changed) => {
      if (changed) setSettings(loadSettings());
    });
  }, []);

  const people = useMemo(() => (settings ? peopleOf(settings) : []), [settings]);

  // (Re)build the review list whenever the statement or its owner changes.
  useEffect(() => {
    if (!statement || !settings) return;
    const existing = new Map(loadAllTxns().map((t) => [t.id, t]));
    setDrafts(
      planImport(statement.rows, owner, settings, new Set(existing.keys()), statement.app).map((r) => {
        const was = existing.get(r.txn.id);
        if (!was || was.personId === r.txn.personId) return { ...r, include: !r.duplicate };
        return { ...r, duplicate: false, include: true, movedFrom: was.personId };
      })
    );
    // Only a new statement or owner re-plans; edits to settings mid-review keep the user's choices.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statement, owner]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    setDone(null);
    setStatement(null);
    setDrafts([]);
    setBusy(true);
    try {
      await syncMoney(); // so duplicates are checked against every device's imports
      const latest = loadSettings();
      setSettings(latest);
      const parsed = await parseStatementPdf(await readBytes(file));
      // Pick whose it is from the email (or Paytm's name) at its top, so a sister's isn't imported as yours.
      const owns = guessOwner(parsed.email, peopleOf(latest), parsed.holder);
      setGuessed(owns ? `This is ${owns.id === ME ? "your" : `${owns.name}'s`} statement (${parsed.email ?? parsed.holder}).` : "");
      if (owns) setOwner(owns.id);
      setStatement(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read that file.");
    } finally {
      setBusy(false);
    }
  };

  const addPerson = () => {
    if (!newName.trim()) return;
    const p = savePerson({ name: newName, aliases: [newName] });
    setSettings(loadSettings());
    setOwner(p.id);
    setNewName("");
  };

  const setAll = (include: boolean) => setDrafts((ds) => ds.map((d) => ({ ...d, include: include && !d.duplicate })));

  const edit = (i: number, changes: Partial<Txn> | { include: boolean }) =>
    setDrafts((ds) => ds.map((d, j) => (j !== i ? d : "include" in changes ? { ...d, ...changes } : { ...d, txn: { ...d.txn, ...changes } })));

  // In your statement, "Paid back" needs a family member to be sent to; the first one, until picked.
  const family = people.filter((p) => p.id !== ME);
  const setKind = (i: number, kind: Kind) => {
    const { txn } = drafts[i];
    if (owner !== ME) return edit(i, { kind });
    if (kind !== "settlement") return edit(i, { kind, personId: ME });
    edit(i, { kind, personId: txn.personId !== ME ? txn.personId : (family[0]?.id ?? ME) });
  };

  const chosen = drafts.filter((d) => d.include);
  const sentFound = statement ? statement.rows.filter((r) => r.direction === "out").reduce((n, r) => n + r.amount, 0) : 0;
  const totalsMatch = statement?.sent === undefined || Math.abs(statement.sent - sentFound) < 0.01;
  const total = (kinds: Kind[]) => chosen.filter((d) => kinds.includes(d.txn.kind)).reduce((n, d) => n + (d.txn.kind === "refund" ? -d.txn.amount : d.txn.amount), 0);
  const others = drafts.filter((d) => d.txn.kind === "spend" && d.txn.category === "other").length;
  const step = statement ? 3 : 2;
  // A statement can't have a payment with its own owner.
  const ownerPerson = people.find((p) => p.id === owner);
  const mismatch = statement && ownerPerson ? statement.rows.find((r) => matchPerson(r.name, [ownerPerson]))?.name : undefined;

  const runImport = () => {
    const txns = chosen.map((d) => d.txn);
    const planned = new Map(planImport(statement!.rows, owner, settings!, new Set(), statement!.app).map((r) => [r.txn.id, r.txn]));
    // A category the user changed here is remembered for later imports, and so is who a payment
    // was sent to, as that person's name in the statement.
    for (const t of txns) {
      const plan = planned.get(t.id);
      if (plan?.category !== t.category) setRule(t.payee, t.category);
      if (owner === ME && t.kind === "settlement" && t.personId !== ME && plan?.personId !== t.personId) addAlias(t.personId, t.payee);
    }
    importTxns(txns);
    const months = txns.map((t) => monthOf(t.date)).sort();
    const ids = new Set(txns.map((t) => t.id));
    setDone({ count: txns.length, month: months[months.length - 1] ?? "", ids });
    setImported(loadAllTxns().filter((t) => ids.has(t.id)));
    setSettings(loadSettings());
    setStatement(null);
    setDrafts([]);
    setOnlyOther(false);
  };

  return (
    <MoneyShell active="import">
      <section className="relative overflow-hidden rounded-[2rem] border border-white/15 bg-gradient-to-br from-white/[.10] via-white/[.04] to-white/[.02] p-5 shadow-2xl shadow-black/40 sm:p-7">
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-sky-500/15 blur-3xl" />
        <h1 className="relative text-2xl font-bold sm:text-3xl">Import a Google Pay or Paytm statement</h1>
        <p className="relative mt-2 max-w-2xl text-sm leading-relaxed text-white/60">
          In Google Pay, open your profile → Statement; in Paytm, Balance &amp; History → Download Statement. Download the month as a
          PDF. For family: they send you theirs, you pick it here. Their payments count as their spending, which you owe them; what you send them shows as paid back.
        </p>
        <ol className="relative mt-4 flex gap-2 text-xs">
          {["Whose", "Pick the PDF", "Review"].map((label, i) => (
            <li key={label} className={`flex items-center gap-1.5 rounded-full border px-3 py-1 ${i + 1 <= step ? "border-gold/40 bg-gold/10 text-gold" : "border-white/10 text-white/40"}`}>
              <span className="font-semibold">{i + 1}</span> {label}
            </li>
          ))}
        </ol>
      </section>

      <section className={`${CARD} space-y-4`}>
        <div>
          <p className="mb-2 text-sm text-white/70">Whose statement is it?</p>
          <div role="radiogroup" aria-label="Whose statement" className="flex flex-wrap gap-2">
            {people.map((p) => (
              <button
                key={p.id}
                role="radio"
                aria-checked={owner === p.id}
                onClick={() => setOwner(p.id)}
                className={`${CHIP} flex items-center gap-2 py-1.5 pl-1.5 pr-3.5 text-sm ${chipState(owner === p.id)}`}
              >
                <Avatar person={p} people={people} size="sm" />
                {p.id === ME ? "Mine" : p.name}
              </button>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <input
              aria-label="New person's name"
              placeholder="Someone else? Name as in their statement"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addPerson()}
              className={`${FIELD} min-w-0 flex-1`}
            />
            <button onClick={addPerson} disabled={!newName.trim()} className="rounded-xl border border-white/15 px-3 py-2 text-sm text-white/80 hover:text-gold disabled:opacity-40">
              Add person
            </button>
          </div>
          {owner === ME && !people[0]?.aliases.length && people.length > 1 && (
            <p className="mt-2 text-xs text-amber-300/80">
              Add your own name in <Link href="/money/settings" className="underline">Settings</Link> so money your family receives from you is matched.
            </p>
          )}
        </div>

        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void onFile(e.dataTransfer.files[0]);
          }}
          className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-3xl border-2 border-dashed px-4 py-8 text-center transition ${dragging ? "border-gold bg-gold/10" : "border-white/15 bg-black/20 hover:border-gold/40"}`}
        >
          <span className="text-3xl">📄</span>
          <span className="text-sm font-medium">{busy ? "Reading…" : `Drop ${owner === ME ? "your" : `${personName(people, owner).split(" ")[0]}'s`} statement PDF, or tap to pick`}</span>
          <span className="text-xs text-white/40">Read on this device; the file isn&apos;t uploaded</span>
          <input
            aria-label="Statement PDF"
            type="file"
            accept="application/pdf,.pdf"
            disabled={busy}
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
            className="sr-only"
          />
        </label>
        {statement && guessed && <p className="text-sm text-sky-300">{guessed}</p>}
        {statement && mismatch && (
          <p className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            ⚠ This statement has a payment with {personName(people, owner)} ({mismatch}), so it&apos;s probably someone else&apos;s. Pick whose it is above.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}
        {done && (
          <p role="status" className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
            ✓ Imported {done.count} transaction{done.count === 1 ? "" : "s"}.{" "}
            {done.month && (
              <Link href={`/money?month=${done.month}`} className="font-medium text-gold underline">
                See {formatMonth(done.month)} →
              </Link>
            )}
          </p>
        )}
      </section>

      {done && settings && (
        <ReviewQueue
          items={reviewQueue(imported, settings.rules)}
          people={people}
          onSorted={() => {
            setSettings(loadSettings());
            setImported(loadAllTxns().filter((t) => done.ids.has(t.id)));
          }}
        />
      )}

      {statement && (
        <section className={CARD} aria-label="Review">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">
              {statement.rows.length} transactions for {personName(people, owner)}
              {statement.period && (
                <span className="ml-2 text-sm font-normal text-white/50">
                  {formatDay(statement.period.from)} – {formatDay(statement.period.to)}
                </span>
              )}
            </h2>
            <p className={`text-xs ${totalsMatch ? "text-emerald-400" : "text-amber-300"}`}>
              {totalsMatch ? "✓ Matches the statement's total" : `Statement says ${inr(statement.sent!)} sent; found ${inr(sentFound)}`}
            </p>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "Spending", value: total(["spend", "refund"]) },
              { label: "Paid to family", value: total(["settlement"]) },
              { label: "Income", value: total(["income"]) },
              { label: "Ignored", value: total(["transfer"]) },
            ].map((s) => (
              <div key={s.label} className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-white/45">{s.label}</p>
                <p className="font-semibold tabular-nums">{inr(s.value)}</p>
              </div>
            ))}
          </div>

          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <button onClick={() => setAll(true)} className={`${CHIP} ${chipState(false)}`}>
              Select all
            </button>
            <button onClick={() => setAll(false)} className={`${CHIP} ${chipState(false)}`}>
              Select none
            </button>
            {others > 0 && (
              <button onClick={() => setOnlyOther(!onlyOther)} aria-pressed={onlyOther} className={`${CHIP} ${chipState(onlyOther)}`}>
                📦 Needs a category ({others})
              </button>
            )}
          </div>

          <ul className="divide-y divide-white/5 overflow-hidden rounded-2xl border border-white/5 bg-black/15">
            {drafts.map((d, i) =>
              onlyOther && !(d.txn.kind === "spend" && d.txn.category === "other") ? null : (
                <li key={d.txn.id} className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 ${d.include ? "" : "opacity-45"}`}>
                  <input
                    type="checkbox"
                    aria-label={`Include ${d.txn.payee} ${inr(d.txn.amount)}`}
                    checked={d.include}
                    onChange={(e) => edit(i, { include: e.target.checked })}
                    className="h-4 w-4 accent-[#f6c453]"
                  />
                  <CategoryIcon id={d.txn.category} muted={d.txn.kind === "transfer" || d.txn.kind === "settlement"} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{d.txn.payee}</span>
                    <span className="block text-xs text-white/45">
                      {formatDay(d.txn.date)}
                      {d.duplicate && <span className="ml-2 text-amber-300/80">Already imported</span>}
                      {d.movedFrom && <span className="ml-2 text-sky-300/80">Imported as {personName(people, d.movedFrom)}&apos;s; moves to {personName(people, owner)}</span>}
                    </span>
                  </span>
                  <span className={`text-sm font-semibold tabular-nums ${d.txn.kind === "refund" || d.txn.kind === "income" ? "text-emerald-400" : ""}`}>
                    {d.txn.kind === "refund" || d.txn.kind === "income" ? "+" : ""}
                    {inr(d.txn.amount)}
                  </span>
                  <span className="flex w-full flex-wrap gap-2 pl-[4.75rem]">
                    <CategorySelect value={d.txn.category} label={`Category for ${d.txn.payee}`} onChange={(category) => edit(i, { category })} />
                    <KindSelect value={d.txn.kind} label={`Type for ${d.txn.payee}`} onChange={(kind) => setKind(i, kind)} />
                    {owner === ME && d.txn.kind === "settlement" && family.length > 0 && (
                      <PaidToSelect value={d.txn.personId} people={family} label={`Paid to for ${d.txn.payee}`} onChange={(personId) => edit(i, { personId })} />
                    )}
                  </span>
                </li>
              )
            )}
          </ul>
          <div className="sticky bottom-4 mt-4 flex justify-end">
            <button onClick={runImport} disabled={!chosen.length} className="w-full rounded-2xl bg-gold px-6 py-3 font-semibold text-ink shadow-xl shadow-black/40 transition hover:brightness-110 disabled:opacity-40 sm:w-auto">
              Import {chosen.length} transaction{chosen.length === 1 ? "" : "s"}
            </button>
          </div>
        </section>
      )}
    </MoneyShell>
  );
}
