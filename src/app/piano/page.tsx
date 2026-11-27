"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { loadSettings, recentRecords, saveMilestones, usePianoSync } from "@/lib/pianoData";
import { MILESTONES, newlyMet } from "@/lib/pianoMilestones";
import { LibraryRow, libraryRows } from "@/lib/pianoLibrary";
import { minutesOf, streak, todayMs } from "@/lib/pianoLog";
import { swap } from "@/lib/pianoSession";
import { isDone, withSwap } from "@/lib/pianoSessionState";
import { KeyboardStatus } from "./KeyboardStatus";
import { TodayCard, useTodaySession } from "./practice/TodayCard";

const GOAL = 10; // minutes a day that count toward the streak (lib/pianoLog.ts)
const TOOLS = [
  { href: "/piano/play", title: "Free play", text: "Press keys and see their names" },
  { href: "/piano/metronome", title: "Metronome", text: "Click, count-in, tap-along" },
  { href: "/piano/songs#coordination", title: "Hand coordination", text: "Two-hand exercises" },
  { href: "/piano/log", title: "Practice log", text: "Minutes, streak, add practice done away" },
];

// The home: today's practice (Swap, Start or Resume), the minutes meter and streak, and the Library of every area.
// Landscape puts the Library beside the card, portrait below it.
export default function PianoHome() {
  const router = useRouter();
  const { state, update } = useTodaySession();
  // Read after the first render so it matches the server's.
  const [data, setData] = useState<{ min: number; streak: number; rows: LibraryRow[]; earned: Record<string, number>; fresh: string[] } | null>(null);
  const reload = () => {
    const now = Date.now();
    const rs = recentRecords(now, 400);
    const fresh = newlyMet(rs, loadSettings(), now);
    saveMilestones(fresh, now); // a write and a push only when one is new
    const settings = loadSettings();
    setData((d) => ({
      min: minutesOf(todayMs(rs, now)),
      streak: streak(rs, now),
      rows: libraryRows(rs, settings, now),
      earned: settings.milestones,
      fresh: [...new Set([...(d?.fresh ?? []), ...fresh])], // reached during this visit: marked new
    }));
  };
  useEffect(reload, []);
  usePianoSync(reload); // another device's sessions
  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-4 py-8 sm:px-6 landscape:grid-cols-[minmax(0,1fr)_320px]">
      <main className="min-w-0 space-y-5">
        <h1 className="font-pnd text-5xl font-semibold leading-none sm:text-6xl">Piano</h1>
        <KeyboardStatus />
        {data && <TodayKeys min={data.min} streak={data.streak} />}
        {state &&
          (isDone(state) ? (
            <div className="space-y-3">
              <TodayCard state={state} onSwap={() => {}} onStart={() => {}} />
              <Link href="/piano/practice" className="inline-block text-pn-brass underline-offset-4 hover:underline">
                Practice done today · see results
              </Link>
            </div>
          ) : (
            <TodayCard state={state} onSwap={(i) => update((s) => withSwap(s, swap(s.plan, i)))} onStart={() => router.push("/piano/practice?start=1")} />
          ))}
        {data && <Milestones earned={data.earned} fresh={data.fresh} />}
      </main>
      <aside aria-label="Library" className="min-w-0 space-y-2">
        <h2 className="font-pnd text-2xl font-semibold text-pn-brass">Library</h2>
        <ul className="divide-y divide-pn-line border-y border-pn-line">
          {data?.rows.map((r) => (
            <li key={r.key}>
              <RowLink href={r.href}>
                <span className="flex items-baseline justify-between gap-3 font-semibold">
                  <span>{r.title}</span>
                  <span className="text-xs font-medium text-pn-brass" title={r.levelHint}>
                    {r.level}
                  </span>
                </span>
                <span data-weak={r.weak} className={`block text-sm ${r.weak ? "text-pn-ivory/90" : "text-pn-ivory/55"}`}>
                  {r.note}
                </span>
              </RowLink>
            </li>
          ))}
        </ul>
        <ul className="divide-y divide-pn-line border-b border-pn-line" aria-label="Tools">
          {TOOLS.map((t) => (
            <li key={t.href}>
              <RowLink href={t.href}>
                <span className="block font-semibold">{t.title}</span>
                <span className="block text-sm text-pn-ivory/55">{t.text}</span>
              </RowLink>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

function RowLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="block py-2.5 outline-none transition-colors hover:bg-pn-felt/60 focus-visible:bg-pn-felt focus-visible:ring-2 focus-visible:ring-pn-brass sm:px-2">
      {children}
    </Link>
  );
}

// Milestones: earned ones in brass (a new one says so), the rest dimmed with what it takes.
function Milestones({ earned, fresh }: { earned: Record<string, number>; fresh: string[] }) {
  const count = MILESTONES.filter((m) => m.id in earned).length;
  return (
    <section aria-label="Milestones" className="space-y-2">
      <h2 className="flex items-baseline gap-3 font-pnd text-2xl font-semibold">
        Milestones <span className="font-pns text-sm font-normal text-pn-ivory/60">{count} of {MILESTONES.length}</span>
      </h2>
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {MILESTONES.map((m) => {
          const got = m.id in earned;
          return (
            <li
              key={m.id}
              data-testid={`milestone-${m.id}`}
              data-earned={got}
              title={m.text}
              className={`rounded-full border px-3 py-1 text-sm ${got ? "border-pn-brass bg-pn-brass/15 text-pn-ivory" : "border-pn-line text-pn-ivory/45"}`}
            >
              {got ? "★ " : ""}
              {m.title}
              {fresh.includes(m.id) && <b className="ml-1.5 text-xs uppercase text-pn-brass">New</b>}
              <span className="sr-only">{got ? " (earned)" : ` (not yet: ${m.text})`}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Today's minutes as ten small keys, one lit per minute up to the 10 that count for the streak.
function TodayKeys({ min, streak }: { min: number; streak: number }) {
  return (
    <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
      <div aria-hidden className="flex h-9 gap-[3px] rounded-sm border-t-[3px] border-pn-crimson bg-pn-ebony px-[3px] pb-[3px]">
        {Array.from({ length: GOAL }, (_, i) => (
          <span key={i} data-on={i < min} className={`w-[11px] rounded-b-[2px] ${i < min ? "bg-pn-brass" : "bg-pn-ivory/90"}`} />
        ))}
      </div>
      <p className="text-sm text-pn-ivory/80" data-testid="teaser">
        Today {min} min{min >= GOAL ? ", counts for the streak" : ` of ${GOAL}`}. Streak {streak} {streak === 1 ? "day" : "days"}.
      </p>
    </div>
  );
}
