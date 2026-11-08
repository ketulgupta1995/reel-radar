"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addSubtask,
  copyTodoToDate,
  DEFAULT_DURATION,
  deleteSubtask,
  deleteTodo,
  getTodayDate,
  loadAllTodos,
  loadDailyTasks,
  makeTodoDaily,
  moveTodoToDate,
  normalizeRepeat,
  postponeCount,
  scheduleTodo,
  setTodoDue,
  setTodoGoal,
  setTodoPriority,
  setTodoRepeat,
  setTodoTag,
  shiftDate,
  SLIPPING_AFTER,
  stopTodoDaily,
  syncPlanner,
  timesDone,
  toggleSubtask,
  updateTodo,
  type Priority,
  type Todo,
} from "@/lib/todos";
import { computeTimeFit, suggestBlockLength } from "@/lib/plannerInsights";
import { allTags, loadGoals, tagColor, useTags } from "@/lib/plannerSettings";
import { ClockTimePicker } from "../todos/ClockTimePicker";
import { RepeatPicker } from "../todos/RepeatPicker";
import { DURATIONS, fmtDuration, formatShortDate, getRelativeDateLabel, toInputTime, fromInputTime } from "../todos/planner";

const LABEL = "font-bfm text-[11px] uppercase tracking-[.06em] text-bf-muted";
const FIELD = "min-w-0 rounded-lg bg-bf-s2 px-2 py-1.5 text-sm font-semibold text-bf-ink placeholder:font-normal placeholder:text-bf-muted focus:outline-none focus:ring-2 focus:ring-bf-ink";
const BTN = "rounded-[10px] bg-bf-s2 px-3 py-2 text-[13px] font-bold";
const PRIMARY = "rounded-[10px] bg-bf-ink px-3 py-2 text-[13px] font-bold text-bf-bg";
const PRIORITIES: { id: Priority | undefined; label: string }[] = [
  { id: undefined, label: "None" },
  { id: "high", label: "High" },
  { id: "medium", label: "Medium" },
  { id: "low", label: "Low" },
];

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-bf-s2 py-3">
      <span className={LABEL}>{label}</span>
      {children}
    </div>
  );
}

// Everything about one task, in one place: a sheet from the bottom on a phone, a panel on the right on a laptop.
// Each change saves at once, as in the current planner.
export function TaskDetails({
  todo,
  date,
  onClose,
  onChanged,
  onFocus,
  onMessage,
  onRemoved,
}: {
  todo: Todo;
  date: string;
  onClose: () => void;
  onChanged: () => void;
  onFocus: (t: Todo) => void;
  onMessage: (text: string) => void;
  onRemoved: (todo: Todo, from: string, text: string) => void;
}) {
  const [text, setText] = useState(todo.text);
  const [note, setNote] = useState(todo.note ?? "");
  const [step, setStep] = useState("");
  const [sendTo, setSendTo] = useState(shiftDate(date, 1));
  const tags = useTags();
  useEffect(() => {
    setText(todo.text);
    setNote(todo.note ?? "");
  }, [todo.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A clock picker open inside closes first.
      if (e.key === "Escape" && document.querySelectorAll("[role=dialog]").length === 1) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const change = (fn: () => unknown) => {
    fn();
    onChanged();
  };
  const daily = todo.dailyId ? loadDailyTasks().find((d) => d.id === todo.dailyId) : undefined;
  const repeat = daily ? normalizeRepeat(daily) : undefined;
  const goals = loadGoals().filter((g) => !g.doneAt || g.id === todo.goalId);
  const tagChoices = todo.tag && !tags.some((t) => t.id === todo.tag) ? [...tags, allTags().find((t) => t.id === todo.tag)!].filter(Boolean) : tags;
  const duration = todo.duration ?? DEFAULT_DURATION;
  // The last 90 days' blocks say how long this kind of block really takes.
  const hint = useMemo(() => {
    if (todo.start === undefined || todo.completed) return null;
    const today = getTodayDate();
    return suggestBlockLength(computeTimeFit(loadAllTodos(), shiftDate(today, -90), today), todo.tag, duration);
  }, [todo.start, todo.completed, todo.tag, duration]);

  const saveText = () => {
    if (!text.trim()) {
      deleteTodo(todo.id, date);
      onChanged();
      onRemoved(todo, date, `Deleted “${todo.text}”`);
      onClose();
    } else if (text.trim() !== todo.text) change(() => updateTodo(todo.id, { text: text.trim() }, date));
  };
  const remove = () => {
    deleteTodo(todo.id, date);
    onChanged();
    onRemoved(todo, date, `Deleted “${todo.text}”`);
    onClose();
  };
  const send = async (mode: "move" | "copy") => {
    // Pull the target day first, so the task lands in its latest copy.
    await syncPlanner([sendTo]);
    const schedule = todo.start !== undefined ? { start: todo.start, duration: todo.duration } : undefined;
    if (mode === "copy") copyTodoToDate(todo.id, date, sendTo, schedule);
    else if (moveTodoToDate(todo.id, date, sendTo, schedule) === null) {
      onMessage("Repeating tasks stay on their own day. Copy it instead.");
      return;
    }
    onChanged();
    const late = mode === "move" && todo.due && sendTo > todo.due ? `, past its ${formatShortDate(todo.due)} deadline` : "";
    onMessage(`${mode === "copy" ? "Copied" : "Moved"} to ${getRelativeDateLabel(sendTo)}${late}`);
    if (mode === "move") onClose();
  };

  return (
    <div role="dialog" aria-label="Task details" className="fixed inset-0 z-50 flex">
      <button aria-label="Close details" onClick={onClose} className="absolute inset-0 bg-black/45" />
      <div className="relative mt-auto max-h-[88vh] w-full overflow-y-auto rounded-t-[20px] bg-bf-bg px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-4 text-bf-ink lg:ml-auto lg:mt-0 lg:h-full lg:max-h-none lg:w-[420px] lg:rounded-none lg:pt-6">
        <div className="flex items-start gap-2">
          <span aria-hidden className="mt-2 h-3 w-3 shrink-0 rounded-full" style={{ background: tagColor(todo.tag ?? "") }} />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={saveText}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            aria-label="Title"
            className="min-w-0 flex-1 bg-transparent text-2xl font-black leading-tight [font-stretch:110%] focus:outline-none"
          />
          <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-bf-s2">
            ✕
          </button>
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note.trim() !== (todo.note ?? "") && change(() => updateTodo(todo.id, { note }, date))}
          placeholder="Add a note"
          aria-label="Note"
          rows={2}
          className={`${FIELD} mt-2 w-full resize-y font-normal`}
        />

        {!todo.completed && postponeCount(todo) >= SLIPPING_AFTER && (
          <div className="mt-3 rounded-[12px] bg-gold px-3 py-2.5 text-sm font-semibold text-bf-ontag">
            Postponed {postponeCount(todo)} times. Drop it, or break it down into a smaller first step below.
            <button onClick={remove} className="ml-2 underline">
              Drop it
            </button>
          </div>
        )}

        <Section label="Checklist">
          {todo.subtasks?.map((s) => (
            <div key={s.id} className="flex items-center gap-2">
              <button onClick={() => change(() => toggleSubtask(todo.id, s.id, date))} aria-pressed={s.done} aria-label={`${s.done ? "Untick" : "Tick"} “${s.text}”`} className="text-lg leading-none">
                {s.done ? "☑" : "☐"}
              </button>
              <span className={`min-w-0 flex-1 break-words text-sm ${s.done ? "text-bf-muted line-through" : ""}`}>{s.text}</span>
              <button onClick={() => change(() => deleteSubtask(todo.id, s.id, date))} aria-label={`Remove “${s.text}”`} className="px-1 text-bf-muted">
                ✕
              </button>
            </div>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!step.trim()) return;
              change(() => addSubtask(todo.id, step.trim(), date));
              setStep("");
            }}
            className="flex gap-1.5"
          >
            <input value={step} onChange={(e) => setStep(e.target.value)} placeholder="Add a step" aria-label="New checklist item" className={`${FIELD} flex-1`} />
            <button type="submit" className={BTN}>
              Add
            </button>
          </form>
        </Section>

        <Section label="Time">
          <div className="grid grid-cols-2 gap-2">
            <ClockTimePicker
              tone="bf"
              label="Starts"
              value={todo.start !== undefined ? toInputTime(todo.start) : ""}
              fallback="09:00"
              onChange={(v) => {
                const start = fromInputTime(v);
                change(() => scheduleTodo(todo.id, start === null ? undefined : { start, duration }, date));
              }}
            />
            <label className="flex flex-col gap-0.5 rounded-xl bg-bf-s1 px-3 py-2">
              <span className="font-bfm text-xs uppercase tracking-wide text-bf-muted">Length</span>
              <select
                value={duration}
                disabled={todo.start === undefined}
                onChange={(e) => change(() => scheduleTodo(todo.id, { start: todo.start!, duration: Number(e.target.value) }, date))}
                aria-label="Length"
                className="bg-transparent text-sm font-semibold focus:outline-none disabled:text-bf-muted"
              >
                {[...new Set([...DURATIONS, duration])].sort((a, b) => a - b).map((d) => (
                  <option key={d} value={d}>
                    {fmtDuration(d)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {hint && (
            <p className="text-xs text-bf-muted">
              Blocks like this {hint.overBy > 0 ? "usually run over" : "usually finish early"}: about {fmtDuration(hint.minutes)}.{" "}
              <button onClick={() => change(() => scheduleTodo(todo.id, { start: todo.start!, duration: hint.minutes }, date))} className="font-bold text-bf-ink underline">
                Use {fmtDuration(hint.minutes)}
              </button>
            </p>
          )}
        </Section>

        <Section label="Priority">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Priority">
            {PRIORITIES.map((p) => (
              <button key={p.label} aria-pressed={todo.priority === p.id} onClick={() => change(() => setTodoPriority(todo.id, p.id, date))} className={todo.priority === p.id ? PRIMARY : BTN}>
                {p.label}
              </button>
            ))}
          </div>
        </Section>

        <Section label="Tag">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tag">
            <button aria-pressed={!todo.tag} onClick={() => change(() => setTodoTag(todo.id, undefined, date))} className={!todo.tag ? PRIMARY : BTN}>
              None
            </button>
            {tagChoices.map((t) => (
              <button key={t.id} aria-pressed={todo.tag === t.id} onClick={() => change(() => setTodoTag(todo.id, t.id, date))} className={`flex items-center gap-1.5 ${todo.tag === t.id ? PRIMARY : BTN}`}>
                <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: t.color }} />
                {t.label}
              </button>
            ))}
          </div>
        </Section>

        <Section label="Repeat">
          {repeat ? (
            <>
              <RepeatPicker tone="bf" value={repeat} date={date} onChange={(rule) => change(() => setTodoRepeat(todo.id, rule, date))} />
              {daily?.timesPerWeek && (
                <p className="font-bfm text-xs text-bf-muted">
                  {timesDone(daily, date)} of {daily.timesPerWeek} this week
                </p>
              )}
              <button
                onClick={() => {
                  change(() => stopTodoDaily(todo.id, date));
                  onMessage("No longer repeats");
                }}
                className={`${BTN} self-start`}
              >
                Stop repeating
              </button>
            </>
          ) : (
            <button
              onClick={() => {
                change(() => makeTodoDaily(todo.id, date));
                onMessage("Repeats every day from now on");
              }}
              className={`${BTN} self-start`}
            >
              Make it repeat
            </button>
          )}
        </Section>

        {!todo.dailyId && (
          <Section label="Deadline">
            <div className="flex gap-1.5">
              <input type="date" value={todo.due ?? ""} onChange={(e) => change(() => setTodoDue(todo.id, e.target.value || undefined, date))} aria-label="Deadline" className={FIELD} />
              {todo.due && (
                <button onClick={() => change(() => setTodoDue(todo.id, undefined, date))} className={BTN}>
                  Clear
                </button>
              )}
            </div>
            {todo.due && date > todo.due && <p className="text-xs font-semibold text-bf-late">Planned after its deadline.</p>}
          </Section>
        )}

        <Section label="Goal">
          <select value={todo.goalId ?? ""} onChange={(e) => change(() => setTodoGoal(todo.id, e.target.value || undefined, date))} aria-label="Goal" className={`${FIELD} self-start`}>
            <option value="">No goal</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </Section>

        <Section label="Move or copy">
          <div className="flex flex-wrap gap-1.5">
            <input type="date" value={sendTo} onChange={(e) => setSendTo(e.target.value)} aria-label="Day to move or copy to" className={FIELD} />
            <button onClick={() => send("move")} disabled={!sendTo || sendTo === date} className={`${BTN} disabled:opacity-40`}>
              Move
            </button>
            <button onClick={() => send("copy")} disabled={!sendTo} className={`${BTN} disabled:opacity-40`}>
              Copy
            </button>
          </div>
        </Section>

        <div className="flex flex-wrap gap-2 border-t border-bf-s2 pt-3">
          {!todo.completed && (
            <button
              onClick={() => {
                onFocus(todo);
                onClose();
              }}
              className={PRIMARY}
            >
              ▶ Start focus
            </button>
          )}
          <button onClick={remove} className={`${BTN} text-bf-late`}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
