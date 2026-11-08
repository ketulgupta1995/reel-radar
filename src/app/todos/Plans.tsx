"use client";

import { useEffect, useState } from "react";
import { getTodayDate, loadDayLog, weekday } from "@/lib/todos";
import { reviewWeek } from "@/lib/plannerInsights";
import { formatShortDate } from "./planner";
import { Goals } from "./Goals";
import { Lists } from "./Lists";
import { Review } from "./Review";

export type PlansView = "goals" | "lists" | "review";

// The Plans tab: everything bigger than a day. On a Sunday, until the week is reviewed, the weekly
// review waits at the top; it can be opened any day from the link underneath.
export function Plans({
  view,
  onView,
  onOpenDay,
  onOpenWeek,
  onMessage,
  initialList,
  initialItem,
}: {
  view: PlansView;
  onView: (v: PlansView) => void;
  onOpenDay: (date: string) => void;
  onOpenWeek: () => void;
  onMessage: (text: string) => void;
  initialList?: string;
  initialItem?: string;
}) {
  const [reviewDue, setReviewDue] = useState(false);
  const [week, setWeek] = useState<{ start: string; end: string } | null>(null);
  useEffect(() => {
    const today = getTodayDate();
    setReviewDue(weekday(today) === 0 && !loadDayLog(today).reviewedAt);
    setWeek(reviewWeek(today));
  }, [view]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-3 px-3 pb-36 pt-3 lg:px-6 lg:pb-12">
      {view === "review" ? (
        <>
          <button onClick={() => onView("goals")} className="self-start font-bfm text-xs text-bf-muted">
            ‹ Plans
          </button>
          <Review onDone={() => onView("goals")} onOpenWeek={onOpenWeek} />
        </>
      ) : (
        <>
          <h2 className="text-[26px] font-black uppercase [font-stretch:125%]">Plans</h2>
          {reviewDue && week ? (
            <section aria-label="Weekly review" className="flex flex-wrap items-center gap-3.5 rounded-[16px] bg-gold p-3.5 text-bf-ontag">
              <div className="min-w-[180px] flex-1">
                <div className="font-bfm text-[10.5px] font-bold uppercase tracking-[.08em] opacity-70">Sunday · weekly review</div>
                <h3 className="mt-0.5 text-xl font-black [font-stretch:115%]">
                  Look back on {formatShortDate(week.start)} – {formatShortDate(week.end)}
                </h3>
                <div className="mt-0.5 font-bfm text-[11.5px]">3 steps · about 10 minutes</div>
              </div>
              <button onClick={() => onView("review")} className="rounded-[10px] bg-bf-ontag px-4 py-2.5 text-sm font-extrabold text-white">
                Start review
              </button>
            </section>
          ) : (
            <button onClick={() => onView("review")} className="self-start font-bfm text-xs font-bold underline">
              Weekly review →
            </button>
          )}
          <div role="group" aria-label="Plans view" className="flex max-w-sm gap-1.5">
            {(["goals", "lists"] as const).map((v) => (
              <button key={v} onClick={() => onView(v)} aria-pressed={view === v} className={`flex-1 rounded-xl py-2.5 text-[13px] font-extrabold uppercase [font-stretch:115%] ${view === v ? "bg-bf-ink text-bf-bg" : "bg-bf-s1 text-bf-muted"}`}>
                {v}
              </button>
            ))}
          </div>
          {view === "goals" ? <Goals onOpenDay={onOpenDay} onMessage={onMessage} /> : <Lists initialList={initialList} initialItem={initialItem} />}
        </>
      )}
    </div>
  );
}
