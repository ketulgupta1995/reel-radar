"use client";

import { useState } from "react";
import { CATEGORIES, ME, categoryOf, fileUnder, type CategoryId, type Person, type ReviewItem } from "@/lib/money";
import { CARD, formatDay, inr, personName } from "./shared";

// Imported spending that needs a category, one payee at a time: a tap files every payment to them
// under it and remembers it for later imports. Renders nothing when there's nothing to sort.
export function ReviewQueue({ items, people, onSorted }: { items: ReviewItem[]; people: Person[]; onSorted: () => void }) {
  const [skipped, setSkipped] = useState<string[]>([]);
  const [last, setLast] = useState("");
  const left = items.filter((i) => !skipped.includes(i.payee));
  const item = left[0];
  if (!items.length && !last) return null;

  const answer = (category: CategoryId) => {
    fileUnder(item, category);
    setLast(`${item.payee} → ${categoryOf(category).label}`);
    onSorted();
  };
  // The payee's matching categories first, so the likely answer is under your thumb.
  const choices = [...item?.choices ?? [], ...CATEGORIES.map((c) => c.id).filter((id) => id !== "other" && !item?.choices.includes(id))];
  const dates = item ? [...new Set(item.txns.map((t) => t.date))].sort() : [];
  const whose = item ? [...new Set(item.txns.map((t) => t.personId))].filter((id) => id !== ME) : [];

  return (
    <section className={`${CARD} border-gold/25`} aria-label="Sort your spending">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Sort your spending</h2>
        {left.length > 0 && (
          <span className="text-xs text-white/50">
            {left.length} payee{left.length === 1 ? "" : "s"} to go · {inr(left.reduce((n, i) => n + i.total, 0))}
          </span>
        )}
      </div>
      {last && (
        <p role="status" className="mb-3 text-xs text-emerald-400">
          ✓ {last}, now and in later imports
        </p>
      )}
      {!item ? (
        items.length ? (
          <p className="text-sm text-white/55">
            Skipped {items.length} for now.{" "}
            <button onClick={() => setSkipped([])} className="text-gold hover:underline">
              Show them again
            </button>
          </p>
        ) : (
          <p className="text-sm text-white/55">All sorted. Your category totals are complete.</p>
        )
      ) : (
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="truncate text-lg font-semibold">{item.payee}</p>
          <p className="text-xs text-white/50">
            {item.txns.length} payment{item.txns.length === 1 ? "" : "s"} · {inr(item.total)} · {formatDay(dates[0])}
            {dates.length > 1 && ` – ${formatDay(dates[dates.length - 1])}`}
            {whose.length > 0 && ` · ${whose.map((id) => personName(people, id).split(" ")[0]).join(", ")}`}
          </p>
          <p className="mt-2 text-xs text-white/60">
            {item.choices.length > 1 ? `Looks like ${item.choices.map((id) => categoryOf(id).label).join(" or ")}. Which is it?` : "What was this?"}
          </p>
          <div role="group" aria-label={`Category for ${item.payee}`} className="mt-3 grid grid-cols-4 gap-1.5 sm:grid-cols-5">
            {choices.map((id) => {
              const c = categoryOf(id);
              const likely = item.choices.includes(id);
              return (
                <button
                  key={id}
                  onClick={() => answer(id)}
                  aria-label={c.label}
                  className={`flex flex-col items-center gap-0.5 rounded-xl border px-1 py-2 text-[10px] leading-tight transition hover:border-gold/50 hover:text-gold ${likely ? "border-gold/40 bg-gold/10 text-gold" : "border-white/10 text-white/65"}`}
                >
                  <span className="text-lg">{c.icon}</span>
                  <span className="w-full truncate text-center">{c.label.split(" ")[0]}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex justify-between gap-2 text-xs">
            <button onClick={() => answer("other")} className="rounded-lg px-2.5 py-1.5 text-white/55 hover:bg-white/10 hover:text-white">
              Keep as Other
            </button>
            <button onClick={() => setSkipped([...skipped, item.payee])} className="rounded-lg px-2.5 py-1.5 text-white/55 hover:bg-white/10 hover:text-white">
              Skip for now →
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
