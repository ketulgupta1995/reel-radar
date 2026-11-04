"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppSwitcher } from "@/components/AppSwitcher";
import { loadLists, searchItems, syncLists } from "@/lib/lists";
import { loadGoals } from "@/lib/plannerSettings";
import { MAX_TASK_HITS, searchNotes, searchTasks } from "@/lib/plannerSearch";
import { loadAllDayLogs, loadAllTodos, loadDailyTasks, syncAllPlanner } from "@/lib/todos";
import { formatDate, formatShortDate } from "../planner";

const ROW = "block rounded-xl border border-white/10 bg-panel/60 px-3 py-2.5 text-sm hover:border-gold/40";

// Everything in the planner, by words: every day's tasks, repeating tasks, day notes, goals and lists.
export default function PlannerSearchPage() {
  const [query, setQuery] = useState("");
  const [version, setVersion] = useState(0);
  const [offline, setOffline] = useState(false);

  // Pull everything once on open. After that, typing only reads this browser's copy.
  useEffect(() => {
    setQuery(new URLSearchParams(window.location.search).get("q") ?? "");
    setVersion(1);
    Promise.all([syncAllPlanner(), syncLists()]).then((pulled) => {
      setOffline(pulled.some((r) => r === null));
      setVersion(2);
    });
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const data = useMemo(() => ({ days: loadAllTodos(), daily: loadDailyTasks(), logs: loadAllDayLogs(), goals: loadGoals(), lists: loadLists() }), [version]);
  const q = query.trim();
  const results = useMemo(
    () => ({
      tasks: searchTasks(q, data.days, data.daily),
      notes: searchNotes(q, data.logs),
      goals: q ? data.goals.filter((g) => g.name.toLowerCase().includes(q.toLowerCase())) : [],
      items: searchItems(q),
    }),
    [q, data]
  );
  const count = results.tasks.length + results.notes.length + results.goals.length + results.items.length;
  const listOf = (id: string) => data.lists.find((l) => l.id === id);

  return (
    <main className="min-h-screen bg-[#090910] text-white">
      <header className="sticky top-0 z-40 border-b border-white/5 bg-black/20 backdrop-blur-md">
        <nav className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3 sm:px-6 sm:py-4">
          <AppSwitcher current="planner" />
          <Link href="/todos" className="text-sm text-white/70 transition hover:text-gold">
            ← Daily Planner
          </Link>
        </nav>
      </header>

      <div className="mx-auto max-w-3xl px-4 pb-24 pt-5 sm:px-6 sm:py-8">
        <h1 className="text-2xl font-bold sm:text-3xl">Search</h1>
        <input
          type="search"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tasks, notes, goals and lists"
          aria-label="Search the whole planner"
          className="mt-4 w-full rounded-full border border-white/15 bg-white/5 px-4 py-2.5 text-white placeholder-white/40 focus:border-gold/50 focus:outline-none"
        />
        {offline && <p className="mt-2 text-xs text-white/50">Couldn't reach the server, so this only searches what's on this device.</p>}

        {q && count === 0 && <p className="mt-6 rounded-2xl border border-white/10 bg-panel/60 p-8 text-center text-white/60">Nothing matches “{q}”.</p>}

        {results.tasks.length > 0 && (
          <Group title="Tasks" count={results.tasks.length}>
            {results.tasks.slice(0, MAX_TASK_HITS).map((t) => (
              <li key={t.key}>
                <Link href={`/todos?date=${t.date}`} className={ROW}>
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className={`min-w-0 break-words ${t.completed && !t.repeat ? "text-white/55" : "text-white/90"}`}>
                      {t.repeat ? "↻ " : t.completed ? "✓ " : ""}
                      {t.text}
                    </span>
                    <span className="shrink-0 text-xs text-white/50">
                      {t.repeat ? (t.repeat.last ? `Done ${t.repeat.done}× · last ${formatShortDate(t.repeat.last)}` : "Not done yet") : formatDate(t.date)}
                    </span>
                  </span>
                  {t.note && <span className="mt-0.5 block truncate text-xs text-white/50">{t.note}</span>}
                </Link>
              </li>
            ))}
            {results.tasks.length > MAX_TASK_HITS && <li className="px-1 text-xs text-white/50">Showing the latest {MAX_TASK_HITS}. Add a word to narrow it down.</li>}
          </Group>
        )}

        {results.goals.length > 0 && (
          <Group title="Goals" count={results.goals.length}>
            {results.goals.map((g) => (
              <li key={g.id}>
                <Link href="/todos/goals" className={ROW}>
                  <span className="break-words text-white/90">
                    {g.doneAt ? "✓ " : ""}
                    {g.name}
                  </span>
                </Link>
              </li>
            ))}
          </Group>
        )}

        {results.items.length > 0 && (
          <Group title="Lists" count={results.items.length}>
            {results.items.map((i) => (
              <li key={i.id}>
                <Link href={`/todos/lists?list=${i.listId}&item=${i.id}`} className={ROW}>
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className={`min-w-0 break-words ${i.done ? "text-white/55" : "text-white/90"}`}>
                      {i.done ? "✓ " : ""}
                      {i.text}
                    </span>
                    <span className="shrink-0 text-xs text-white/50">{listOf(i.listId)?.name}</span>
                  </span>
                </Link>
              </li>
            ))}
          </Group>
        )}

        {results.notes.length > 0 && (
          <Group title="Day notes" count={results.notes.length}>
            {results.notes.map((n) => (
              <li key={n.date + n.label}>
                <Link href={`/todos?date=${n.date}`} className={ROW}>
                  <span className="block text-xs text-white/50">
                    {formatDate(n.date)} · {n.label}
                  </span>
                  <span className="whitespace-pre-wrap break-words text-white/85">{n.text}</span>
                </Link>
              </li>
            ))}
          </Group>
        )}
      </div>
    </main>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 font-semibold">
        {title} <span className="text-sm font-normal text-white/45">{count}</span>
      </h2>
      <ul className="space-y-2">{children}</ul>
    </section>
  );
}
