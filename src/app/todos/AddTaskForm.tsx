"use client";

import { useMemo, useState, type RefObject } from "react";
import { parseQuickAdd, type QuickAdd } from "@/lib/quickAdd";
import { addTodo, DEFAULT_DURATION, normalizeRepeat, repeatsOn, syncPlanner, weekday, type Priority, type RepeatRule, type TagId, type Todo } from "@/lib/todos";
import { tagLabel, useGoals, useTags } from "@/lib/plannerSettings";
import { DAY_NAMES, DURATIONS, fmtDuration, fmtTime, formatShortDate, fromInputTime, getRelativeDateLabel } from "./planner";
import { RepeatPicker, repeatLabel } from "./RepeatPicker";

const longDay = (date: string) => `${DAY_NAMES[weekday(date)]}, ${formatShortDate(date)}`;

// The task being written. The page holds it, because the form is only there in the day view and a
// half-written task should survive a look at the week.
export function useTaskDraft() {
  const [newTodoText, setNewTodoText] = useState("");
  const [newPriority, setNewPriority] = useState<Priority | "">("");
  const [newTime, setNewTime] = useState("");
  const [newDuration, setNewDuration] = useState(DEFAULT_DURATION);
  const [newDaily, setNewDaily] = useState(false);
  const [newRepeat, setNewRepeat] = useState<RepeatRule>({});
  const [newTag, setNewTag] = useState<TagId | "">("");
  const [newDue, setNewDue] = useState("");
  const [newGoal, setNewGoal] = useState("");
  const [newNote, setNewNote] = useState("");
  const [showNewNote, setShowNewNote] = useState(false);
  const [showOptions, setShowOptions] = useState(false);

  // After adding. Priority, tag and length stay as they were.
  const clear = () => {
    setNewDue("");
    setNewGoal("");
    setNewRepeat({});
    setNewTodoText("");
    setNewNote("");
    setShowNewNote(false);
    setNewDaily(false);
    setNewTime("");
  };

  return {
    newTodoText, setNewTodoText,
    newPriority, setNewPriority,
    newTime, setNewTime,
    newDuration, setNewDuration,
    newDaily, setNewDaily,
    newRepeat, setNewRepeat,
    newTag, setNewTag,
    newDue, setNewDue,
    newGoal, setNewGoal,
    newNote, setNewNote,
    showNewNote, setShowNewNote,
    showOptions, setShowOptions,
    clear,
  };
}

export function AddTaskForm({
  draft,
  selectedDate,
  isToday,
  inputRef,
  onAdded,
  onMessage,
}: {
  draft: ReturnType<typeof useTaskDraft>;
  selectedDate: string;
  isToday: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onAdded: (updated: Todo[] | null) => void; // the day's list, or null when the task went to another day
  onMessage: (text: string) => void;
}) {
  const {
    newTodoText, setNewTodoText,
    newPriority, setNewPriority,
    newTime, setNewTime,
    newDuration, setNewDuration,
    newDaily, setNewDaily,
    newRepeat, setNewRepeat,
    newTag, setNewTag,
    newDue, setNewDue,
    newGoal, setNewGoal,
    newNote, setNewNote,
    showNewNote, setShowNewNote,
    showOptions, setShowOptions,
  } = draft;
  const tags = useTags();
  const activeGoals = useGoals().filter((g) => !g.doneAt);
  const hasOptions = Boolean(newPriority || newTag || newTime || newDue || newGoal || newNote.trim() || newDaily);
  const optionsOpen = showOptions || hasOptions;
  const quickPreview = useMemo(() => parseQuickAdd(newTodoText), [newTodoText]);

  const handleAddTodo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTodoText.trim()) return;
    // Shorthand in the title ("6pm", "45m", "#work", "!high", "daily", "fri") wins over the form controls.
    const quick = parseQuickAdd(newTodoText);
    const start = quick.start ?? fromInputTime(newTime);
    const date = quick.date ?? selectedDate;
    const repeat: RepeatRule | false = newDaily ? newRepeat : quick.repeat ?? (quick.daily ? {} : false);
    const text = quick.text || newTodoText.trim();
    const note = newNote;
    const priority = quick.priority ?? (newPriority || undefined);
    const tag = quick.tag ?? (newTag || undefined);
    const schedule = start !== null ? { start, duration: quick.duration ?? newDuration } : undefined;
    const extra = { due: quick.due ?? (newDue || undefined), goalId: newGoal || undefined };
    draft.clear();
    inputRef.current?.focus();
    // Another day's month may not be on this device yet: pull it, so the new task lands in its latest copy.
    if (date !== selectedDate) await syncPlanner([date]);
    const updated = addTodo(text, date, priority, schedule, repeat, note, tag, extra);
    onAdded(date === selectedDate ? updated : null);
    const stored = repeat ? normalizeRepeat(repeat) : null;
    if (stored?.monthDay && !repeatsOn({ ...stored, id: "", text: "", startDate: date }, date)) onMessage(`${repeatLabel(stored)}. Nothing to do until then.`);
    else if (date !== selectedDate) onMessage(`Added to ${longDay(date)}`);
  };

  return (
    <form
      onSubmit={handleAddTodo}
      className="sticky top-2 z-30 mb-4 flex flex-wrap gap-2 rounded-3xl border border-white/15 bg-white/[.07] p-3 shadow-xl shadow-black/30 backdrop-blur-xl transition focus-within:border-gold/50 focus-within:shadow-gold/10 lg:top-[4.25rem]"
    >
      <div className="flex min-w-0 basis-full items-center gap-2">
        <span aria-hidden className="pl-1 text-xl text-gold">+</span>
        <input
          ref={inputRef}
          type="text"
          value={newTodoText}
          onChange={(e) => setNewTodoText(e.target.value)}
          placeholder={isToday ? "What needs to be done today?" : `Add a task for ${getRelativeDateLabel(selectedDate)}`}
          className="min-w-0 flex-1 bg-transparent py-2 text-base text-white placeholder-white/40 focus:outline-none"
          autoComplete="off"
        />
        <kbd className="hidden rounded border border-white/15 px-1.5 text-[10px] text-white/40 sm:block" title="Press N anywhere to jump here">
          N
        </kbd>
        <button
          type="button"
          onClick={() => setShowOptions((v) => !v)}
          aria-expanded={optionsOpen}
          title="Priority, tag, time, deadline, goal, note, repeat"
          className={`shrink-0 rounded-full border px-3 py-1.5 text-xs transition ${
            optionsOpen || hasOptions ? "border-gold/60 bg-gold/15 text-gold" : "border-white/15 text-white/60 hover:text-white"
          }`}
        >
          ⋯ Options
        </button>
        <button
          type="submit"
          disabled={!newTodoText.trim()}
          className="shrink-0 rounded-full bg-gold px-5 py-1.5 text-sm font-semibold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Add
        </button>
      </div>
      <QuickAddHint quick={quickPreview} typed={newTodoText.trim() !== ""} />
      <div className={`basis-full flex-wrap items-center gap-2 ${optionsOpen ? "flex" : "hidden"}`}>
        <select
          value={newPriority}
          onChange={(e) => setNewPriority(e.target.value as Priority | "")}
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-ink px-2.5 py-1.5 text-xs text-white focus:border-gold/50 focus:outline-none sm:flex-none"
          aria-label="Priority"
        >
          <option value="">No priority</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select
          value={newTag}
          onChange={(e) => setNewTag(e.target.value as TagId | "")}
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-ink px-2.5 py-1.5 text-xs text-white focus:border-gold/50 focus:outline-none sm:flex-none"
          aria-label="Tag"
        >
          <option value="">No tag</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <input
          type="time"
          value={newTime}
          onChange={(e) => setNewTime(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-ink px-2.5 py-1.5 text-xs text-white [color-scheme:dark] focus:border-gold/50 focus:outline-none sm:flex-none"
          aria-label="Start time (optional)"
          title="Start time (optional) - places it in the planner"
        />
        <label className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-white/60 sm:flex-none" title="The day it must be done by, however often the task moves">
          Due
          <input
            type="date"
            value={newDue}
            onChange={(e) => setNewDue(e.target.value)}
            disabled={newDaily}
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-ink px-2.5 py-1.5 text-xs text-white [color-scheme:dark] focus:border-gold/50 focus:outline-none disabled:opacity-40"
            aria-label="Deadline (optional)"
          />
        </label>
        {activeGoals.length > 0 && (
          <select
            value={newGoal}
            onChange={(e) => setNewGoal(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-ink px-2.5 py-1.5 text-xs text-white focus:border-gold/50 focus:outline-none sm:flex-none"
            aria-label="Goal"
          >
            <option value="">No goal</option>
            {activeGoals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        )}
        {newTime && (
          <select
            value={newDuration}
            onChange={(e) => setNewDuration(Number(e.target.value))}
            className="rounded-lg border border-white/10 bg-ink px-2.5 py-1.5 text-xs text-white focus:border-gold/50 focus:outline-none"
            aria-label="Duration"
          >
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {fmtDuration(d)}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={() => setShowNewNote((v) => !v)}
          aria-pressed={showNewNote}
          title="Add a description"
          className={`rounded-lg border px-2.5 py-1.5 text-xs transition ${
            showNewNote || newNote.trim()
              ? "border-gold/60 bg-gold/15 text-gold"
              : "border-white/10 bg-ink text-white/60 hover:text-white"
          }`}
        >
          ✎ Note
        </button>
        <button
          type="button"
          onClick={() => setNewDaily((v) => !v)}
          aria-pressed={newDaily}
          title="Repeat this task"
          className={`rounded-lg border px-2.5 py-1.5 text-xs transition ${
            newDaily
              ? "border-gold/60 bg-gold/15 text-gold"
              : "border-white/10 bg-ink text-white/60 hover:text-white"
          }`}
        >
          ↻ {newDaily ? repeatLabel(newRepeat) : "Repeat"}
        </button>
      </div>
      {newDaily && (
        <div className="basis-full">
          <RepeatPicker value={newRepeat} onChange={setNewRepeat} date={selectedDate} />
        </div>
      )}
      {showNewNote && (
        <textarea
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleAddTodo(e);
          }}
          placeholder="Description (optional)"
          rows={3}
          className="basis-full resize-y rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/40 transition focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/50"
        />
      )}
    </form>
  );
}

// What the shorthand in an add box will set, one chip each. The new planner's add box shows them too.
export function quickAddChips(quick: QuickAdd): string[] {
  const chips: string[] = [];
  if (quick.start !== undefined) chips.push(`⏰ ${fmtTime(quick.start)}${quick.duration ? ` · ${fmtDuration(quick.duration)}` : ""}`);
  else if (quick.duration) chips.push(`⏱ ${fmtDuration(quick.duration)} (add a time to schedule it)`);
  if (quick.priority) chips.push(`⚑ ${quick.priority[0].toUpperCase()}${quick.priority.slice(1)}`);
  if (quick.tag) chips.push(`# ${tagLabel(quick.tag)}`);
  if (quick.date) chips.push(`📅 ${longDay(quick.date)}`);
  if (quick.due && !quick.repeat && !quick.daily) chips.push(`🏁 Due ${longDay(quick.due)}`);
  if (quick.repeat) chips.push(`↻ ${repeatLabel(quick.repeat)}`);
  else if (quick.daily) chips.push("↻ Every day");
  return chips;
}

// What the shorthand in the add box will set, or a tip when there's none.
function QuickAddHint({ quick, typed }: { quick: QuickAdd; typed: boolean }) {
  const chips = quickAddChips(quick);
  if (!chips.length)
    return typed ? null : (
      <p className="basis-full px-1 text-[11px] text-white/35">
        Shorthand: <span className="text-white/55">6pm</span> · <span className="text-white/55">45m</span> ·{" "}
        <span className="text-white/55">#work</span> · <span className="text-white/55">!high</span> ·{" "}
        <span className="text-white/55">fri</span> · <span className="text-white/55">by fri</span> · <span className="text-white/55">daily</span>
      </p>
    );
  return (
    <div className="flex basis-full flex-wrap items-center gap-1.5 px-1" data-testid="quick-add-preview">
      {chips.map((c) => (
        <span key={c} className="rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 text-[11px] text-gold">
          {c}
        </span>
      ))}
      {quick.text && <span className="text-[11px] text-white/40">→ “{quick.text}”</span>}
    </div>
  );
}
