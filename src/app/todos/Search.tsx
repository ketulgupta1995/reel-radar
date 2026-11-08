"use client";

import { useEffect, useMemo, useState } from "react";
import { loadLists, searchItems, syncLists } from "@/lib/lists";
import { loadGoals } from "@/lib/plannerSettings";
import { MAX_TASK_HITS, searchNotes, searchTasks } from "@/lib/plannerSearch";
import { loadAllDayLogs, loadAllTodos, loadDailyTasks, syncAllPlanner } from "@/lib/todos";
import { formatDate, formatShortDate } from "./planner";

const ROW = "block w-full rounded-[12px] bg-bf-s1 px-3 py-2.5 text-left text-sm hover:ring-2 hover:ring-bf-ink";

// Everything in the planner, by words: every day's tasks, repeating tasks, day notes, goals and lists.
// It pulls everything once when opened; typing only reads this browser's copy.
export function Search({ initialQuery = "", onOpenDay, onOpenGoals, onOpenItem, onClose }: { initialQuery?: string; onOpenDay: (date: string) => void; onOpenGoals: () => void; onOpenItem: (list: string, item: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState(initialQuery);
  const [version, setVersion] = useState(0);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
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
    <div className="mx-auto flex max-w-3xl flex-col gap-3 px-3 pb-36 pt-3 lg:px-6 lg:pb-12">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[26px] font-black uppercase [font-stretch:125%]">Search</h2>
        <button onClick={onClose} className="rounded-[10px] bg-bf-s1 px-3 py-2 text-xs font-extrabold uppercase">
          Close
        </button>
      </div>
      <input
        type="search"
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        placeholder="Tasks, notes, goals and lists"
        aria-label="Search the whole planner"
        className="w-full rounded-[14px] bg-bf-s1 px-4 py-3 text-base font-semibold text-bf-ink placeholder:font-normal placeholder:text-bf-muted focus:outline-none focus:ring-2 focus:ring-bf-ink"
      />
      {offline && <p className="font-bfm text-[11px] text-bf-muted">Couldn&apos;t reach the server, so this only searches what&apos;s on this device.</p>}

      {q && count === 0 && <p className="rounded-[16px] border-2 border-dashed border-bf-line p-8 text-center text-sm text-bf-muted">Nothing matches “{q}”.</p>}

      {results.tasks.length > 0 && (
        <Group title="Tasks" count={results.tasks.length}>
          {results.tasks.slice(0, MAX_TASK_HITS).map((t) => (
            <li key={t.key}>
              <button onClick={() => onOpenDay(t.date)} className={ROW}>
                <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className={`min-w-0 break-words font-bold ${t.completed && !t.repeat ? "text-bf-muted line-through" : ""}`}>
                    {t.repeat ? "↻ " : t.completed ? "✓ " : ""}
                    {t.text}
                  </span>
                  <span className="shrink-0 font-bfm text-[11px] text-bf-muted">
                    {t.repeat ? (t.repeat.last ? `Done ${t.repeat.done}× · last ${formatShortDate(t.repeat.last)}` : "Not done yet") : formatDate(t.date)}
                  </span>
                </span>
                {t.note && <span className="mt-0.5 block truncate text-xs text-bf-muted">{t.note}</span>}
              </button>
            </li>
          ))}
          {results.tasks.length > MAX_TASK_HITS && <li className="px-1 font-bfm text-[11px] text-bf-muted">Showing the latest {MAX_TASK_HITS}. Add a word to narrow it down.</li>}
        </Group>
      )}

      {results.goals.length > 0 && (
        <Group title="Goals" count={results.goals.length}>
          {results.goals.map((g) => (
            <li key={g.id}>
              <button onClick={onOpenGoals} className={ROW}>
                <span className="break-words font-bold">
                  {g.doneAt ? "✓ " : ""}
                  {g.name}
                </span>
              </button>
            </li>
          ))}
        </Group>
      )}

      {results.items.length > 0 && (
        <Group title="Lists" count={results.items.length}>
          {results.items.map((i) => (
            <li key={i.id}>
              <button onClick={() => onOpenItem(i.listId, i.id)} className={ROW}>
                <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className={`min-w-0 break-words font-bold ${i.done ? "text-bf-muted line-through" : ""}`}>
                    {i.done ? "✓ " : ""}
                    {i.text}
                  </span>
                  <span className="shrink-0 font-bfm text-[11px] text-bf-muted">{listOf(i.listId)?.name}</span>
                </span>
              </button>
            </li>
          ))}
        </Group>
      )}

      {results.notes.length > 0 && (
        <Group title="Day notes" count={results.notes.length}>
          {results.notes.map((n) => (
            <li key={n.date + n.label}>
              <button onClick={() => onOpenDay(n.date)} className={ROW}>
                <span className="block font-bfm text-[11px] text-bf-muted">
                  {formatDate(n.date)} · {n.label}
                </span>
                <span className="whitespace-pre-wrap break-words">{n.text}</span>
              </button>
            </li>
          ))}
        </Group>
      )}
    </div>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="mt-2">
      <h3 className="mb-1.5 px-0.5 font-bfm text-[11px] font-bold uppercase tracking-[.08em] text-bf-muted">
        {title} · {count}
      </h3>
      <ul className="flex flex-col gap-1.5">{children}</ul>
    </section>
  );
}
