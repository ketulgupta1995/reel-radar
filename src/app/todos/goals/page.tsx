"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppSwitcher } from "@/components/AppSwitcher";
import { computeGoalProgress } from "@/lib/plannerInsights";
import { addGoal, deleteGoal, setGoalDone, updateGoal, useGoals, type Goal } from "@/lib/plannerSettings";
import { weekStart } from "@/lib/plannerStats";
import { parseQuickAdd } from "@/lib/quickAdd";
import { addTodo, getTodayDate, loadAllTodos, loadDailyTasks, normalizeRepeat, shiftDate, syncAllPlanner, syncPlanner } from "@/lib/todos";
import { daysUntil } from "../Deadlines";
import { fmtDuration, formatDate, formatShortDate } from "../planner";
import { repeatLabel } from "../RepeatPicker";

const FIELD = "rounded-lg border border-white/10 bg-ink px-2.5 py-1.5 text-sm text-white placeholder-white/35 [color-scheme:dark] focus:border-gold/50 focus:outline-none";
const SMALL_BUTTON = "rounded-full border border-white/20 px-3 py-1 text-xs text-white/80 hover:border-gold/50 hover:text-gold";

// "12 days left", "today", "3 days past".
function timeLeft(by: string, today: string): string {
  const left = daysUntil(by, today);
  if (left === 0) return "today";
  const n = Math.abs(left);
  return `${n} ${n === 1 ? "day" : "days"} ${left > 0 ? "left" : "past"}`;
}

// Bigger aims, what's been done towards them, and the next step for each.
export default function GoalsPage() {
  const goals = useGoals();
  const [today, setToday] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [name, setName] = useState("");
  const [by, setBy] = useState("");
  const [problem, setProblem] = useState("");

  // Today comes from the browser, so it's read after the first render.
  useEffect(() => {
    setToday(getTodayDate());
    syncAllPlanner().then(() => setVersion((v) => v + 1));
  }, []);

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const why = addGoal(name, by || undefined);
    setProblem(why ?? "");
    if (why) return;
    setName("");
    setBy("");
  };

  const active = goals.filter((g) => !g.doneAt);
  const achieved = goals.filter((g) => g.doneAt);

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
        <h1 className="text-2xl font-bold sm:text-3xl">Goals</h1>
        <p className="mt-1 text-white/60">What your days are building towards.</p>

        <form onSubmit={add} className="mt-5 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-panel/60 p-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Run 10K" aria-label="New goal" className={`${FIELD} min-w-0 flex-1 basis-40`} />
          <label className="flex items-center gap-2 text-xs text-white/60">
            By
            <input type="date" value={by} onChange={(e) => setBy(e.target.value)} aria-label="Goal date (optional)" className={FIELD} />
          </label>
          <button type="submit" className="rounded-full bg-gold px-4 py-1.5 text-sm font-semibold text-black hover:brightness-110">
            Add goal
          </button>
          {problem && <p className="basis-full text-xs text-red-300">{problem}</p>}
        </form>

        {today && active.length === 0 && (
          <p className="mt-6 rounded-2xl border border-dashed border-white/20 p-8 text-center text-white/60">No goals yet. Add one, then link tasks and repeats to it from the planner.</p>
        )}

        {today && (
          <ul className="mt-5 space-y-4">
            {active.map((g) => (
              <GoalCard key={g.id} goal={g} today={today} version={version} onChange={() => setVersion((v) => v + 1)} />
            ))}
          </ul>
        )}

        {achieved.length > 0 && (
          <section className="mt-8">
            <h2 className="font-semibold">Achieved</h2>
            <ul className="mt-2 divide-y divide-white/5 text-sm">
              {achieved.map((g) => (
                <li key={g.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <span className="min-w-0 break-words text-white/70">✓ {g.name}</span>
                  <button onClick={() => setGoalDone(g.id, false)} aria-label={`Reopen “${g.name}”`} className={SMALL_BUTTON}>
                    Reopen
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}

function GoalCard({ goal, today, version, onChange }: { goal: Goal; today: string; version: number; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [step, setStep] = useState("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const progress = useMemo(() => computeGoalProgress(goal.id, loadAllTodos(), loadDailyTasks(), weekStart(today), shiftDate(weekStart(today), 6)), [goal.id, today, version]);

  const addStep = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = parseQuickAdd(step);
    if (!q.text) return;
    setStep("");
    const schedule = q.start !== undefined ? { start: q.start, duration: q.duration } : undefined;
    // Typed for another day ("15 nov"), whose month this device may not have pulled yet.
    if (q.date) await syncPlanner([q.date]);
    addTodo(q.text, q.date ?? today, q.priority, schedule, q.repeat ?? q.daily, undefined, q.tag, { due: q.due, goalId: goal.id });
    onChange();
  };

  const next = progress.open.find((s) => s.date >= today) ?? progress.open[0];
  const stuck = progress.open.length === 0 && progress.repeats.length === 0;

  return (
    <li className="rounded-2xl border border-white/10 bg-panel/60 p-4">
      {editing ? (
        <div className="flex flex-wrap items-center gap-2">
          <input defaultValue={goal.name} onBlur={(e) => updateGoal(goal.id, { name: e.target.value })} aria-label={`Name of “${goal.name}”`} className={`${FIELD} min-w-0 flex-1 basis-40`} />
          <input type="date" defaultValue={goal.by ?? ""} onChange={(e) => updateGoal(goal.id, { by: e.target.value })} aria-label={`Date of “${goal.name}”`} className={FIELD} />
          <button onClick={() => setEditing(false)} className={SMALL_BUTTON}>
            Done editing
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h2 className="min-w-0 break-words font-semibold">{goal.name}</h2>
          {goal.by && (
            <span className={`text-xs ${daysUntil(goal.by, today) < 0 ? "text-red-300" : "text-white/55"}`}>
              By {formatShortDate(goal.by)} · {timeLeft(goal.by, today)}
            </span>
          )}
        </div>
      )}

      {progress.percent !== null && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label={`Progress on “${goal.name}”`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}>
          <div className="h-full rounded-full bg-gold" style={{ width: `${progress.percent}%` }} />
        </div>
      )}
      <p className="mt-2 text-xs text-white/60">
        {progress.done} done · {progress.doneInRange} this week · {progress.open.length} still open
        {progress.focused > 0 && ` · ${fmtDuration(progress.focused)} focused`}
        {progress.lastDone && ` · last ${formatShortDate(progress.lastDone)}`}
      </p>

      {progress.repeats.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-sm text-white/80">
          {progress.repeats.map((d) => (
            <li key={d.id} className="break-words">
              ↻ {d.text} <span className="text-xs text-white/50">{repeatLabel(normalizeRepeat(d))}</span>
            </li>
          ))}
        </ul>
      )}
      {next && (
        <p className="mt-2 text-sm text-white/80">
          Next:{" "}
          <Link href={`/todos?date=${next.date}`} className="break-words text-gold hover:underline">
            {next.todo.text}
          </Link>{" "}
          <span className="text-xs text-white/50">{formatDate(next.date)}</span>
        </p>
      )}
      {stuck && <p className="mt-2 text-sm text-gold">No next step planned. What's the smallest thing you could do?</p>}

      <form onSubmit={addStep} className="mt-3">
        <input
          value={step}
          onChange={(e) => setStep(e.target.value)}
          placeholder="Add a step: Book a race sat 9am, or Run 3x week"
          aria-label={`Add a step to “${goal.name}”`}
          className={`${FIELD} w-full`}
        />
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
        <button onClick={() => setGoalDone(goal.id, true)} className="font-semibold text-gold hover:brightness-110">
          Mark achieved
        </button>
        <button onClick={() => setEditing((v) => !v)} className="text-white/60 hover:text-white">
          Edit
        </button>
        {confirming ? (
          <button onClick={() => deleteGoal(goal.id)} className="text-red-400 hover:text-red-300">
            Really delete? Its tasks stay
          </button>
        ) : (
          <button onClick={() => setConfirming(true)} className="text-white/60 hover:text-white">
            Delete
          </button>
        )}
      </div>
    </li>
  );
}
