"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AppSwitcher } from "@/components/AppSwitcher";
import { addList, loadLists, moveTodoToList, syncLists, STARTER_LISTS, type RememberList } from "@/lib/lists";
import { computePlannerStats } from "@/lib/plannerStats";
import { computeGoalProgress, reviewWeek } from "@/lib/plannerInsights";
import { useGoals } from "@/lib/plannerSettings";
import { parseQuickAdd } from "@/lib/quickAdd";
import { missingDailyTasks } from "@/lib/reminders";
import {
  DEFAULT_DURATION,
  addSubtask,
  addTodo,
  deleteTodo,
  getOverdueTodos,
  getTodayDate,
  loadAllDayLogs,
  loadAllTodos,
  loadDailyTasks,
  loadTodos,
  moveTodoToDate,
  postponeCount,
  restoreTodo,
  shiftDate,
  syncAllPlanner,
  syncPlanner,
  timesDone,
  updateDayLog,
  type OverdueTodo,
  type Todo,
} from "@/lib/todos";
import { DAY_NAMES, fmtDuration, formatShortDate } from "../planner";
import { SlippingHint } from "../Slipping";
import { dueLabel, dueTone } from "../Deadlines";

const STEPS = ["Look back", "Unfinished tasks", "Plan ahead"];
const NEW_LIST = "new";
const pct = (done: number, total: number) => (total ? Math.round((done / total) * 100) : 0);
const dayChip = (date: string) => `${DAY_NAMES[new Date(date + "T00:00:00").getDay()]} ${Number(date.slice(8))}`;

type Tally = { moved: number; dropped: number; listed: number; added: number };

// A guided look at the week: what got done, a decision on each unfinished task, then next week's plan.
export default function WeeklyReviewPage() {
  const [today, setToday] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [step, setStep] = useState(0);
  const [finished, setFinished] = useState(false);
  const [lists, setLists] = useState<RememberList[]>([]);
  const [tally, setTally] = useState<Tally>({ moved: 0, dropped: 0, listed: 0, added: 0 });
  const [dropped, setDropped] = useState<OverdueTodo | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const reload = () => {
    setLists(loadLists());
    setVersion((v) => v + 1);
  };

  // Today comes from the browser, so it's read after the first render.
  useEffect(() => {
    setToday(getTodayDate());
    reload();
    Promise.all([syncAllPlanner(), syncLists()]).then(reload);
    return () => clearTimeout(undoTimer.current);
  }, []);

  const count = (key: keyof Tally, by = 1) => setTally((t) => ({ ...t, [key]: t[key] + by }));

  const week = useMemo(() => (today ? reviewWeek(today) : null), [today]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // Everything before today, plus today's own tasks when the review closes the week on a Sunday.
  const open = useMemo(() => (week && today ? getOverdueTodos(week.end === today ? shiftDate(today, 1) : today) : []), [week, today, version]);
  if (!today || !week) return <main className="min-h-screen bg-ink" />;

  const reschedule = ({ todo, date }: OverdueTodo, to: string) => {
    moveTodoToDate(todo.id, date, to);
    count("moved");
    reload();
  };
  const drop = (item: OverdueTodo) => {
    deleteTodo(item.todo.id, item.date);
    count("dropped");
    setDropped(item);
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setDropped(null), 6000);
    reload();
  };
  const undoDrop = () => {
    if (!dropped) return;
    restoreTodo(dropped.todo, dropped.date);
    count("dropped", -1);
    setDropped(null);
    reload();
  };
  const toList = ({ todo, date }: OverdueTodo, listId: string) => {
    let id = listId;
    if (id === NEW_LIST) id = addList(STARTER_LISTS[1].name, STARTER_LISTS[1].icon).id;
    moveTodoToList(todo, date, id);
    count("listed");
    reload();
  };
  const addStep = ({ todo, date }: OverdueTodo, text: string) => {
    addSubtask(todo.id, text, date);
    reload();
  };
  const finish = () => {
    updateDayLog(week.end, { reviewedAt: Date.now() });
    setFinished(true);
  };

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
        <h1 className="text-2xl font-bold sm:text-3xl">Weekly review</h1>
        <p className="mt-1 text-white/60">
          {formatShortDate(week.start)} – {formatShortDate(week.end)}
        </p>

        {finished ? (
          <Finished tally={tally} />
        ) : (
          <>
            <ol className="mt-5 flex gap-1 text-xs" aria-label="Steps">
              {STEPS.map((s, i) => (
                <li key={s} className="min-w-0 flex-1" aria-current={i === step ? "step" : undefined}>
                  <button onClick={() => setStep(i)} className="w-full text-left">
                    <span className={`mb-1.5 block h-1 rounded-full ${i <= step ? "bg-gold" : "bg-white/15"}`} />
                    <span className={`block truncate ${i === step ? "font-semibold text-white" : "text-white/55"}`}>{s}</span>
                  </button>
                </li>
              ))}
            </ol>

            <div className="mt-6">
              {step === 0 && <LookBack start={week.start} end={week.end} version={version} />}
              {step === 1 && <Triage open={open} today={today} lists={lists} days={week.next} onMove={reschedule} onDrop={drop} onList={toList} onAddStep={addStep} />}
              {step === 2 && (
                <PlanNext
                  days={week.next}
                  version={version}
                  onAdd={() => {
                    count("added");
                    reload();
                  }}
                />
              )}
            </div>

            <div className="mt-6 flex items-center justify-between">
              {step > 0 ? (
                <button onClick={() => setStep(step - 1)} className="rounded-full border border-white/20 px-4 py-2 text-sm text-white/80 hover:border-gold/40 hover:text-gold">
                  Back
                </button>
              ) : (
                <span />
              )}
              {step < STEPS.length - 1 ? (
                <button onClick={() => setStep(step + 1)} className="rounded-full bg-gold px-4 py-2 text-sm font-semibold text-black hover:brightness-110">
                  Next
                </button>
              ) : (
                <button onClick={finish} className="rounded-full bg-gold px-4 py-2 text-sm font-semibold text-black hover:brightness-110">
                  Finish review
                </button>
              )}
            </div>
          </>
        )}

        {dropped && (
          <div className="fixed inset-x-4 bottom-16 z-50 mx-auto flex max-w-sm items-center justify-between gap-3 rounded-full border border-white/15 bg-panel px-4 py-2 text-sm shadow-xl">
            <span className="min-w-0 truncate">Dropped “{dropped.todo.text}”</span>
            <button onClick={undoDrop} className="font-semibold text-gold hover:brightness-110">
              Undo
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

function LookBack({ start, end, version }: { start: string; end: string; version: number }) {
  const goals = useGoals();
  const progress = useMemo(() => {
    const days = loadAllTodos();
    const daily = loadDailyTasks();
    return goals.filter((g) => !g.doneAt).map((goal) => ({ goal, ...computeGoalProgress(goal.id, days, daily, start, end) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goals, start, end, version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { stats, notes } = useMemo(() => {
    const logs = loadAllDayLogs();
    const dates = Object.keys(logs).filter((d) => d >= start && d <= end).sort();
    return {
      stats: computePlannerStats(loadAllTodos(), start, end),
      notes: dates.flatMap((d) =>
        ([["Went well", logs[d].well], ["Went badly", logs[d].bad], ["To improve", logs[d].improve]] as const).flatMap(([label, text]) => (text ? [{ date: d, label, text }] : []))
      ),
    };
  }, [start, end, version]);
  const tiles = [
    { label: "Finished", value: `${stats.done} of ${stats.total}`, sub: `${pct(stats.done, stats.total)}% of tasks` },
    { label: "Time blocks", value: fmtDuration(stats.doneMinutes || 0), sub: `of ${fmtDuration(stats.plannedMinutes || 0)} planned` },
    { label: "Focused", value: fmtDuration(stats.focusedMinutes || 0), sub: "with the timer" },
  ];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border border-white/10 bg-panel/60 px-3 py-2.5 sm:px-4 sm:py-3">
            <div className="truncate text-[11px] uppercase tracking-wider text-white/45">{t.label}</div>
            <div className="mt-1 text-lg font-semibold sm:text-2xl">{t.value}</div>
            <div className="text-[11px] text-white/45 sm:text-xs">{t.sub}</div>
          </div>
        ))}
      </div>
      {progress.length > 0 && (
        <section>
          <h2 className="font-semibold">Your goals</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {progress.map((p) => (
              <li key={p.goal.id} className="rounded-xl border border-white/10 bg-panel/60 px-3 py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="min-w-0 break-words font-medium">{p.goal.name}</span>
                  <span className="shrink-0 text-xs text-white/50">
                    {p.doneInRange} done this week · {p.open.length} open
                  </span>
                </div>
                {p.percent !== null && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label={`Progress on “${p.goal.name}”`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.percent}>
                    <div className="h-full rounded-full bg-gold" style={{ width: `${p.percent}%` }} />
                  </div>
                )}
                {p.open.length === 0 && p.repeats.length === 0 ? (
                  <p className="mt-1.5 text-xs text-gold">No next step planned. Add one in the Plan ahead step.</p>
                ) : (
                  p.doneInRange === 0 && <p className="mt-1.5 text-xs text-white/55">Nothing moved this week.</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {stats.carried.length > 0 && (
        <section>
          <h2 className="font-semibold">What kept slipping</h2>
          <ul className="mt-2 divide-y divide-white/5 text-sm">
            {stats.carried.map((c) => (
              <li key={c.id + c.to} className="flex items-center justify-between gap-3 py-1.5">
                <span className="min-w-0 break-words text-white/85">{c.text}</span>
                <span className="shrink-0 text-xs text-white/50">{c.completed ? "✓ Done" : `${c.days} ${c.days === 1 ? "day" : "days"} late`}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {notes.length > 0 && (
        <section>
          <h2 className="font-semibold">What you noted</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {notes.map((n) => (
              <li key={n.date + n.label}>
                <span className="text-xs text-white/50">
                  {formatShortDate(n.date)} · {n.label}
                </span>
                <p className="whitespace-pre-wrap break-words text-white/85">{n.text}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Triage({
  open,
  today,
  lists,
  days,
  onMove,
  onDrop,
  onList,
  onAddStep,
}: {
  open: OverdueTodo[];
  today: string;
  lists: RememberList[];
  days: string[];
  onMove: (item: OverdueTodo, to: string) => void;
  onDrop: (item: OverdueTodo) => void;
  onList: (item: OverdueTodo, listId: string) => void;
  onAddStep: (item: OverdueTodo, text: string) => void;
}) {
  if (!open.length) return <p className="rounded-2xl border border-white/10 bg-panel/60 p-8 text-center text-white/60">Nothing left unfinished. Nice.</p>;
  return (
    <div>
      <p className="mb-3 text-sm text-white/60">
        {open.length} unfinished {open.length === 1 ? "task" : "tasks"}. Pick a day, drop it, or move it to a list. Anything you leave stays overdue.
      </p>
      <ul className="space-y-3">
        {open.map((item) => (
          <li key={item.todo.id} className="rounded-xl border border-white/10 bg-panel/60 p-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="min-w-0 break-words font-medium">{item.todo.text}</span>
              <span className="text-xs text-white/50">
                {item.todo.due && <span className={`mr-1.5 rounded-full border px-2 py-0.5 ${dueTone(item.todo, item.date, today)}`}>{dueLabel(item.todo.due, today)}</span>}
                from {formatShortDate(item.date)}
                {postponeCount(item.todo) > 0 && ` · postponed ${postponeCount(item.todo)}×`}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={`Reschedule “${item.todo.text}”`}>
              {days.map((d) => (
                <button key={d} onClick={() => onMove(item, d)} className="rounded-full border border-white/15 px-2.5 py-1 text-xs text-white/80 hover:border-gold/50 hover:text-gold">
                  {dayChip(d)}
                </button>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
              <button onClick={() => onDrop(item)} className="text-white/60 hover:text-white">
                Drop
              </button>
              <select
                value=""
                onChange={(e) => e.target.value && onList(item, e.target.value)}
                aria-label={`Move “${item.todo.text}” to a list`}
                className="min-w-0 max-w-[12rem] rounded-lg border border-white/10 bg-panel px-2 py-1 text-white/80 focus:border-gold/50 focus:outline-none"
              >
                <option value="">Move to a list…</option>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.icon ? `${l.icon} ` : ""}
                    {l.name}
                  </option>
                ))}
                {!lists.length && <option value={NEW_LIST}>{STARTER_LISTS[1].icon} {STARTER_LISTS[1].name}</option>}
              </select>
            </div>
            <SlippingHint todo={item.todo} onDrop={() => onDrop(item)} onAddStep={(text) => onAddStep(item, text)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlanNext({ days, version, onAdd }: { days: string[]; version: number; onAdd: () => void }) {
  const goals = useGoals().filter((g) => !g.doneAt);
  const [goalId, setGoalId] = useState("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const plan = useMemo(() => {
    const daily = loadDailyTasks();
    return days.map((date) => {
      const todos = loadTodos(date);
      const repeating = missingDailyTasks(daily, todos, date, (d) => timesDone(d, date, date));
      const minutes = (list: { start?: number; duration?: number }[]) => list.reduce((n, t) => n + (t.start !== undefined ? t.duration ?? DEFAULT_DURATION : 0), 0);
      return { date, todos, repeating: repeating.length, minutes: minutes(todos) + minutes(repeating) };
    });
  }, [days, version]);
  return (
    <div>
      <p className="mb-3 text-sm text-white/60">Add what matters most. Shorthand works here too: Gym 6pm 45m #health</p>
      {goals.length > 0 && (
        <label className="mb-3 flex flex-wrap items-center gap-2 text-xs text-white/60">
          Tasks you add work towards
          <select value={goalId} onChange={(e) => setGoalId(e.target.value)} className="min-w-0 max-w-full rounded-lg border border-white/10 bg-panel px-2 py-1 text-white/80 focus:border-gold/50 focus:outline-none">
            <option value="">No goal</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <ul className="space-y-3">
        {plan.map((d) => (
          <DayPlan key={d.date} {...d} goalId={goalId} onAdd={onAdd} />
        ))}
      </ul>
      <Link href="/todos" className="mt-3 inline-block text-xs text-gold hover:underline">
        Arrange it in the week view →
      </Link>
    </div>
  );
}

function DayPlan({ date, todos, repeating, minutes, goalId, onAdd }: { date: string; todos: Todo[]; repeating: number; minutes: number; goalId: string; onAdd: () => void }) {
  const [text, setText] = useState("");
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = parseQuickAdd(text);
    if (!q.text) return;
    const schedule = q.start !== undefined ? { start: q.start, duration: q.duration } : undefined;
    setText("");
    // Typed for another day ("15 nov"), whose month this device may not have pulled yet.
    if (q.date && q.date !== date) await syncPlanner([q.date]);
    addTodo(q.text, q.date ?? date, q.priority, schedule, q.repeat ?? q.daily, undefined, q.tag, { due: q.due, goalId: goalId || undefined });
    onAdd();
  };
  return (
    <li className="rounded-xl border border-white/10 bg-panel/60 p-3 text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">
          {DAY_NAMES[new Date(date + "T00:00:00").getDay()]}, {formatShortDate(date)}
        </span>
        <span className="text-xs text-white/50">
          {repeating > 0 && `${repeating} repeating · `}
          {minutes ? `${fmtDuration(minutes)} scheduled` : "nothing scheduled"}
        </span>
      </div>
      {todos.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-white/75">
          {todos.map((t) => (
            <li key={t.id} className="break-words">
              · {t.text}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="mt-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a task"
          aria-label={`Add a task for ${formatShortDate(date)}`}
          className="w-full rounded-lg border border-white/10 bg-ink px-2 py-1.5 text-white placeholder-white/35 focus:border-gold/50 focus:outline-none"
        />
      </form>
    </li>
  );
}

function Finished({ tally }: { tally: Tally }) {
  const parts = [
    tally.moved && `${tally.moved} rescheduled`,
    tally.dropped && `${tally.dropped} dropped`,
    tally.listed && `${tally.listed} moved to a list`,
    tally.added && `${tally.added} added to your plan`,
  ].filter(Boolean);
  return (
    <div className="mt-6 rounded-2xl border border-gold/30 bg-gold/5 p-8 text-center">
      <p className="text-lg font-semibold">Review done</p>
      {parts.length > 0 && <p className="mt-1 text-sm text-white/70">{parts.join(" · ")}</p>}
      <Link href="/todos" className="mt-4 inline-block rounded-full bg-gold px-4 py-2 text-sm font-semibold text-black hover:brightness-110">
        Back to the planner
      </Link>
    </div>
  );
}
