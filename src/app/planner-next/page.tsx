"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AppSwitcher } from "@/components/AppSwitcher";
import { getTodayDate, shiftDate, weekday } from "@/lib/todos";
import { DAY_NAMES, shiftMonth } from "../todos/planner";
import { Calendar, type CalendarView } from "./Calendar";
import { Plans, type PlansView } from "./Plans";
import { Today } from "./Today";
import { useDay } from "./useDay";

type Tab = "today" | "calendar" | "plans" | "more";
const TABS: { id: Tab; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "calendar", label: "Calendar" },
  { id: "plans", label: "Plans" },
  { id: "more", label: "More" },
];

// Until each tab is rebuilt, it points to the current planner's pages for the same things.
const LATER: Record<"more", { what: string; links: [string, string][] }> = {
  more: { what: "Stats, tags, templates, reminders and backup", links: [["Stats", "/todos/stats"], ["Tags, templates and log items", "/todos"]] },
};

function Later({ tab }: { tab: "more" }) {
  const { what, links } = LATER[tab];
  return (
    <div className="mx-auto max-w-xl px-4 py-10 text-center">
      <h2 className="text-2xl font-black uppercase [font-stretch:125%]">{TABS.find((t) => t.id === tab)!.label}</h2>
      <p className="mt-2 text-sm text-bf-muted">This tab will hold {what}. Until it&apos;s built, they&apos;re in the current planner:</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {links.map(([label, href]) => (
          <Link key={href + label} href={href} className="rounded-xl bg-bf-s1 px-4 py-2.5 text-sm font-bold">
            {label} →
          </Link>
        ))}
      </div>
    </div>
  );
}

// "Sun · Today" over "8 Nov"; a day further off shows its year when it isn't this one.
const dayLabel = (date: string, today: string) => {
  const near = date === today ? "Today" : date === shiftDate(today, -1) ? "Yesterday" : date === shiftDate(today, 1) ? "Tomorrow" : null;
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  const title = new Date(date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
  return { kicker: `${DAY_NAMES[weekday(date)]}${near ? ` · ${near}` : ""}`, title };
};

// The new planner (Bold focus): four tabs, a bar along the bottom on a phone and in the header on a laptop.
export default function PlannerNextPage() {
  const day = useDay();
  const [tab, setTab] = useState<Tab>("today");
  const [calView, setCalView] = useState<CalendarView>("week");
  const [plansView, setPlansView] = useState<PlansView>("goals");
  const [linked, setLinked] = useState<{ list?: string; item?: string }>({});

  // Search and Goals link straight to a day (?date=) or a list item (?list=&item=). The parameters are
  // cleared, so a later reload opens on today.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const list = q.get("list") ?? undefined;
    const item = q.get("item") ?? undefined;
    if (list || item) {
      setLinked({ list, item });
      setPlansView("lists");
      setTab("plans");
    }
    if ([...q.keys()].length) window.history.replaceState(null, "", window.location.pathname);
  }, []);
  const tabRef = useRef({ tab, calView });
  tabRef.current = { tab, calView };
  const { date, setDate, today, reviewDue, message, setMessage, sync, syncStatus } = day;

  // ← → change the day (or the week or month in Calendar), T goes back to today, W and M open the
  // week and month and, pressed again, go back to the day.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable], [role=dialog]"))) return;
      const { tab, calView } = tabRef.current;
      const step = (n: number) => setDate((d) => d && (tab !== "calendar" ? shiftDate(d, n) : calView === "week" ? shiftDate(d, 7 * n) : shiftMonth(d, n)));
      const open = (v: CalendarView) => {
        if (tab === "calendar" && calView === v) return setTab("today");
        setCalView(v);
        setTab("calendar");
      };
      if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "t") setDate(getTodayDate());
      else if (e.key === "w") open("week");
      else if (e.key === "m") open("month");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setDate]);

  const label = date && today ? dayLabel(date, today) : null;
  const tabButton = (t: (typeof TABS)[number], place: "bar" | "header") => (
    <button
      key={t.id}
      onClick={() => setTab(t.id)}
      aria-current={tab === t.id ? "page" : undefined}
      className={`relative rounded-xl px-3 py-2 text-xs font-extrabold uppercase [font-stretch:110%] ${
        tab === t.id ? (place === "bar" ? "bg-bf-s2 text-bf-ink" : "bg-white/15 text-white") : place === "bar" ? "text-bf-muted" : "text-white/60 hover:text-white"
      }`}
    >
      {t.label}
      {t.id === "plans" && reviewDue && <span aria-label="Weekly review is ready" className="absolute right-2 top-1 h-[7px] w-[7px] rounded-full bg-gold" />}
    </button>
  );

  return (
    <main>
      <header className="sticky top-0 z-40 bg-ink text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 lg:px-6">
          <AppSwitcher current="planner" />
          <nav aria-label="Planner" className="ml-auto hidden gap-1 lg:flex">
            {TABS.map((t) => tabButton(t, "header"))}
          </nav>
          <Link href="/todos/search" aria-label="Search the planner" className="ml-auto grid h-9 w-9 place-items-center rounded-[10px] bg-white/10 lg:ml-0">
            ⌕
          </Link>
          <button
            onClick={sync}
            disabled={syncStatus === "syncing"}
            aria-label={syncStatus === "syncing" ? "Syncing" : syncStatus === "error" ? "Sync failed, try again" : syncStatus === "synced" ? "Synced" : "Sync now"}
            title="Sync with your other devices now"
            className="grid h-9 w-9 place-items-center rounded-[10px] bg-white/10"
          >
            <span className={`h-2 w-2 rounded-full ${syncStatus === "error" ? "bg-red-400" : syncStatus === "syncing" ? "animate-pulse bg-gold" : "bg-emerald-400"}`} />
          </button>
        </div>
        {tab === "today" && label && (
          <div className="mx-auto flex max-w-6xl items-center gap-2 px-3 pb-3 lg:px-6">
            <div className="min-w-0 flex-1">
              <div className="font-bfm text-[11px] uppercase text-white/60">{label.kicker}</div>
              <h1 className="text-[22px] font-black uppercase leading-tight [font-stretch:125%]">{label.title}</h1>
            </div>
            {date !== today && (
              <button onClick={() => setDate(getTodayDate())} aria-label="Go to today" className="rounded-[10px] bg-white/10 px-3 py-2 text-xs font-extrabold uppercase">
                Today
              </button>
            )}
            <button onClick={() => setDate((d) => d && shiftDate(d, -1))} aria-label="Previous day" className="grid h-9 w-9 place-items-center rounded-[10px] bg-white/10">
              ‹
            </button>
            <button onClick={() => setDate((d) => d && shiftDate(d, 1))} aria-label="Next day" className="grid h-9 w-9 place-items-center rounded-[10px] bg-white/10">
              ›
            </button>
          </div>
        )}
      </header>

      {tab === "today" ? (
        <Today day={day} />
      ) : tab === "calendar" && date ? (
        <Calendar
          anchor={date}
          view={calView}
          now={day.now}
          onView={setCalView}
          onAnchor={setDate}
          onOpenDay={(d) => {
            setDate(d);
            setTab("today");
          }}
          flash={day.flash}
        />
      ) : tab === "plans" ? (
        <Plans
          view={plansView}
          onView={(v) => {
            setPlansView(v);
            day.refresh(); // a finished review clears the dot on the tab
          }}
          onOpenDay={(d) => {
            setDate(d);
            setTab("today");
          }}
          onOpenWeek={() => {
            setDate(getTodayDate());
            setCalView("week");
            setTab("calendar");
          }}
          onMessage={day.flash}
          initialList={linked.list}
          initialItem={linked.item}
        />
      ) : (
        <Later tab="more" />
      )}

      <nav aria-label="Planner tabs" className="fixed inset-x-2 bottom-[calc(0.5rem+env(safe-area-inset-bottom))] z-40 grid grid-cols-4 gap-1 rounded-[18px] bg-bf-s1 p-1.5 shadow-lg ring-1 ring-bf-s2 lg:hidden">
        {TABS.map((t) => tabButton(t, "bar"))}
      </nav>

      {message && (
        <div role="status" className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-full bg-bf-ink px-4 py-2.5 text-sm font-bold text-bf-bg shadow-xl lg:bottom-6">
          <span className="min-w-0 truncate">{message.text}</span>
          {message.undo && (
            <button onClick={message.undo} className="shrink-0 font-black uppercase text-gold underline">
              Undo
            </button>
          )}
          <button onClick={() => setMessage(null)} aria-label="Dismiss" className="shrink-0 opacity-70">
            ✕
          </button>
        </div>
      )}
    </main>
  );
}
