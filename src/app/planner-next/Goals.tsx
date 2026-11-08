"use client";

import { useEffect, useMemo, useState } from "react";
import { computeGoalProgress } from "@/lib/plannerInsights";
import { addGoal, deleteGoal, setGoalDone, tagColor, tagLabel, updateGoal, useGoals, type Goal } from "@/lib/plannerSettings";
import { weekStart } from "@/lib/plannerStats";
import { parseQuickAdd } from "@/lib/quickAdd";
import { addTodo, getTodayDate, loadAllTodos, loadDailyTasks, moveTodoToDate, normalizeRepeat, shiftDate, syncAllPlanner, syncPlanner } from "@/lib/todos";
import { daysUntil } from "../todos/Deadlines";
import { fmtDuration, formatDate, formatShortDate } from "../todos/planner";
import { repeatLabel } from "../todos/RepeatPicker";

const FIELD = "rounded-lg bg-bf-s2 px-2.5 py-1.5 text-sm font-semibold text-bf-ink placeholder:font-normal placeholder:text-bf-muted focus:outline-none focus:ring-2 focus:ring-bf-ink";
const ON_TILE = "rounded-lg bg-black/15 px-2.5 py-1.5 text-sm font-semibold placeholder:font-normal placeholder:text-current placeholder:opacity-60 focus:outline-none focus:ring-2 focus:ring-current";

// "12 days left", "today", "3 days past".
function timeLeft(by: string, today: string): string {
  const left = daysUntil(by, today);
  if (left === 0) return "today";
  const n = Math.abs(left);
  return `${n} ${n === 1 ? "day" : "days"} ${left > 0 ? "left" : "past"}`;
}

// Bigger aims as tiles, in the colour of the tag their tasks use most, with what's been done and the next step.
export function Goals({ onOpenDay, onMessage }: { onOpenDay: (date: string) => void; onMessage: (text: string) => void }) {
  const goals = useGoals();
  const [today, setToday] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [name, setName] = useState("");
  const [by, setBy] = useState("");
  const [problem, setProblem] = useState("");
  const [showAchieved, setShowAchieved] = useState(false);

  // Today comes from the browser, so it's read after the first render. Steps can be on any day: pull them all.
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
    <div className="flex flex-col gap-3">
      <form onSubmit={add} className="flex flex-wrap items-center gap-1.5 rounded-[14px] bg-bf-s1 p-2.5">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New goal, e.g. Run a 10K" aria-label="New goal" className={`${FIELD} min-w-0 flex-1 basis-40`} />
        <label className="flex items-center gap-1.5 font-bfm text-[11px] text-bf-muted">
          by
          <input type="date" value={by} onChange={(e) => setBy(e.target.value)} aria-label="Goal date (optional)" className={FIELD} />
        </label>
        <button type="submit" className="rounded-[10px] bg-bf-ink px-3.5 py-2 text-xs font-black uppercase text-bf-bg">
          Add goal
        </button>
        {problem && <p className="basis-full text-xs font-semibold text-bf-late">{problem}</p>}
      </form>

      {today && active.length === 0 && <p className="rounded-[14px] border-2 border-dashed border-bf-line p-6 text-center text-sm text-bf-muted">No goals yet. Add one, then link tasks and repeats to it.</p>}
      {today && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {active.map((g) => (
            <GoalTile key={g.id} goal={g} today={today} version={version} onChange={() => setVersion((v) => v + 1)} onOpenDay={onOpenDay} onMessage={onMessage} />
          ))}
        </ul>
      )}

      {achieved.length > 0 && (
        <section>
          <button onClick={() => setShowAchieved((v) => !v)} aria-expanded={showAchieved} className="px-0.5 py-1.5 font-bfm text-[11px] uppercase tracking-[.08em] text-bf-muted">
            Achieved · {achieved.length} {showAchieved ? "▴" : "▾"}
          </button>
          {showAchieved && (
            <ul className="flex flex-col gap-1">
              {achieved.map((g) => (
                <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] bg-bf-s1 px-3 py-2 text-sm">
                  <span className="min-w-0 break-words font-bold">✓ {g.name}</span>
                  <button onClick={() => setGoalDone(g.id, false)} aria-label={`Reopen “${g.name}”`} className="rounded-lg bg-bf-s2 px-2.5 py-1 text-xs font-bold">
                    Reopen
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function GoalTile({ goal, today, version, onChange, onOpenDay, onMessage }: { goal: Goal; today: string; version: number; onChange: () => void; onOpenDay: (date: string) => void; onMessage: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [step, setStep] = useState("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const progress = useMemo(() => computeGoalProgress(goal.id, loadAllTodos(), loadDailyTasks(), weekStart(today), shiftDate(weekStart(today), 6)), [goal.id, today, version]);
  // The tag its open steps and repeats use most gives the tile its colour.
  const tag = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of [...progress.open.map((s) => s.todo.tag), ...progress.repeats.map((d) => d.tag)]) if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  }, [progress]);

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
  const toToday = async () => {
    await syncPlanner([today]);
    moveTodoToDate(next!.todo.id, next!.date, today);
    onChange();
    onMessage(`Moved “${next!.todo.text}” to today`);
  };
  const coloured = Boolean(tag) && !stuck;
  const muted = coloured ? "opacity-75" : "text-bf-muted";
  const chip = coloured ? "rounded-lg bg-bf-ontag px-2.5 py-1 text-xs font-extrabold text-white" : "rounded-lg bg-bf-ink px-2.5 py-1 text-xs font-extrabold text-bf-bg";

  return (
    <li
      aria-label={goal.name}
      className={`flex flex-col gap-2 rounded-[16px] p-3.5 ${coloured ? "text-bf-ontag" : "bg-bf-s1"} ${stuck ? "ring-2 ring-bf-late" : ""}`}
      style={coloured ? { background: tagColor(tag!) } : undefined}
    >
      <div className={`flex justify-between gap-2 font-bfm text-[10.5px] font-bold uppercase ${muted}`}>
        <span>{tag ? tagLabel(tag) : "Goal"}</span>
        {goal.by && (
          <span className={daysUntil(goal.by, today) < 0 ? "text-bf-late opacity-100" : ""}>
            By {formatShortDate(goal.by)} · {timeLeft(goal.by, today)}
          </span>
        )}
      </div>
      {editing ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <input defaultValue={goal.name} onBlur={(e) => updateGoal(goal.id, { name: e.target.value })} aria-label={`Name of “${goal.name}”`} className={`${coloured ? ON_TILE : FIELD} min-w-0 flex-1 basis-40`} />
          <input type="date" defaultValue={goal.by ?? ""} onChange={(e) => updateGoal(goal.id, { by: e.target.value })} aria-label={`Date of “${goal.name}”`} className={coloured ? ON_TILE : FIELD} />
          <button onClick={() => setEditing(false)} className={chip}>
            Done editing
          </button>
        </div>
      ) : (
        <h3 className="break-words text-[19px] font-black leading-tight [font-stretch:110%]">{goal.name}</h3>
      )}
      {progress.percent !== null && (
        <div className={`h-1.5 overflow-hidden rounded-full ${coloured ? "bg-black/15" : "bg-bf-s2"}`} role="progressbar" aria-label={`Progress on “${goal.name}”`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}>
          <div className={`h-full rounded-full ${coloured ? "bg-bf-ontag" : "bg-bf-ink"}`} style={{ width: `${progress.percent}%` }} />
        </div>
      )}
      <p className={`font-bfm text-[11.5px] ${muted}`}>
        {progress.done} done · {progress.doneInRange} this week · {progress.open.length} still open
        {progress.focused > 0 && ` · ${fmtDuration(progress.focused)} focused`}
        {progress.lastDone && ` · last ${formatShortDate(progress.lastDone)}`}
      </p>
      {progress.repeats.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-sm font-semibold">
          {progress.repeats.map((d) => (
            <li key={d.id} className="break-words">
              ↻ {d.text} <span className={`font-bfm text-[11px] font-normal ${muted}`}>{repeatLabel(normalizeRepeat(d))}</span>
            </li>
          ))}
        </ul>
      )}
      {next && (
        <div className={`flex items-center gap-2 rounded-[10px] px-2.5 py-2 text-[13px] font-bold ${coloured ? "bg-black/10" : "bg-bf-s2"}`}>
          <button onClick={() => onOpenDay(next.date)} className="min-w-0 flex-1 break-words text-left underline-offset-2 hover:underline">
            Next: {next.todo.text} <span className={`font-bfm text-[11px] font-normal ${muted}`}>{formatDate(next.date)}</span>
          </button>
          {next.date !== today && (
            <button onClick={toToday} aria-label={`Move “${next.todo.text}” to today`} className={chip}>
              → Today
            </button>
          )}
        </div>
      )}
      {stuck && <p className="text-sm font-bold text-bf-late">No next step planned. What&apos;s the smallest thing you could do?</p>}
      <form onSubmit={addStep}>
        <input value={step} onChange={(e) => setStep(e.target.value)} placeholder="Add a step: Book a race sat 9am, or Run 3x week" aria-label={`Add a step to “${goal.name}”`} className={`${coloured ? ON_TILE : FIELD} w-full`} />
      </form>
      <div className="flex flex-wrap items-center gap-3 text-xs font-bold">
        <button onClick={() => setGoalDone(goal.id, true)} className="underline">
          Mark achieved
        </button>
        <button onClick={() => setEditing((v) => !v)} className={muted}>
          Edit
        </button>
        {confirming ? (
          <button onClick={() => deleteGoal(goal.id)} className="text-bf-late">
            Really delete? Its tasks stay
          </button>
        ) : (
          <button onClick={() => setConfirming(true)} className={muted}>
            Delete
          </button>
        )}
      </div>
    </li>
  );
}
