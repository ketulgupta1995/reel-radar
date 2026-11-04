"use client";

import { useEffect, useRef, useState } from "react";
import { PRIORITY_STYLE, formatShortDate, getRelativeDateLabel, fmtTime, fmtDuration } from "./planner";
import { getTodayDate, shiftDate, DEFAULT_DURATION, type RepeatRule, type TagId, type Priority, type Todo } from "@/lib/todos";
import { SlippingHint } from "./Slipping";
import { dueLabel, dueTone } from "./Deadlines";
import { RepeatPicker, repeatLabel } from "./RepeatPicker";
import { activeTags, loadGoals, tagColor, tagLabel } from "@/lib/plannerSettings";

export function TodoItem({
  todo,
  reorder,
  onMoveBy,
  isEditing,
  editText,
  editNote,
  onEditStart,
  onEditSave,
  onEditCancel,
  onEditTextChange,
  onEditNoteChange,
  onToggle,
  onDelete,
  onCyclePriority,
  onSchedule,
  onShowBlock,
  onToggleDaily,
  repeat,
  weekCount,
  streak,
  onSetRepeat,
  onAddSubtask,
  onToggleSubtask,
  onDeleteSubtask,
  onSetTag,
  onSetDue,
  onSetGoal,
  focusing,
  onStartFocus,
  date,
  onSendToDay,
}: {
  todo: Todo;
  reorder: ListReorder;
  onMoveBy: (todo: Todo, delta: -1 | 1) => void;
  isEditing: boolean;
  editText: string;
  editNote: string;
  onEditStart: (todo: Todo) => void;
  onEditSave: (id: string) => void;
  onEditCancel: () => void;
  onEditTextChange: (text: string) => void;
  onEditNoteChange: (note: string) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onCyclePriority: (todo: Todo) => void;
  onSchedule: (todo: Todo) => void;
  onShowBlock: (todo: Todo) => void;
  onToggleDaily: (todo: Todo) => void;
  repeat?: RepeatRule;
  weekCount?: number;
  streak: number;
  onSetRepeat: (todo: Todo, rule: RepeatRule) => void;
  onAddSubtask: (todo: Todo, text: string) => void;
  onToggleSubtask: (todo: Todo, subtaskId: string) => void;
  onDeleteSubtask: (todo: Todo, subtaskId: string) => void;
  onSetTag: (todo: Todo, tag: TagId | undefined) => void;
  onSetDue: (todo: Todo, due: string | undefined) => void;
  onSetGoal: (todo: Todo, goalId: string | undefined) => void;
  focusing: boolean;
  onStartFocus: (todo: Todo) => void;
  date: string;
  onSendToDay: (todo: Todo, to: string, mode: "move" | "copy") => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [showRepeat, setShowRepeat] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [showDue, setShowDue] = useState(false);
  const [sendDate, setSendDate] = useState("");
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [subtaskText, setSubtaskText] = useState("");

  const submitSubtask = () => {
    if (subtaskText.trim()) onAddSubtask(todo, subtaskText);
    setSubtaskText("");
  };

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  if (isEditing) {
    return (
      <div
        className="rounded-xl border border-gold/30 bg-gold/5 p-3"
        // Save when focus leaves the editor, not when it moves between title and note.
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onEditSave(todo.id);
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={editText}
          onChange={(e) => onEditTextChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onEditSave(todo.id);
            else if (e.key === "Escape") onEditCancel();
          }}
          placeholder="Title"
          className="w-full bg-transparent px-2 py-1.5 text-white focus:outline-none"
          autoComplete="off"
        />
        <textarea
          value={editNote}
          onChange={(e) => onEditNoteChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onEditSave(todo.id);
            else if (e.key === "Escape") onEditCancel();
          }}
          placeholder="Description (optional)"
          rows={3}
          className="mt-1 w-full resize-y rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white/80 placeholder-white/40 focus:border-gold/40 focus:outline-none"
        />
        <p className="mt-1 px-2 text-[11px] text-white/40">Enter saves the title · Ctrl+Enter saves from the note · Esc cancels</p>
      </div>
    );
  }

  const pri = todo.priority ? PRIORITY_STYLE[todo.priority] : null;
  const duration = todo.duration ?? DEFAULT_DURATION;
  const subtasks = todo.subtasks ?? [];
  const subtasksDone = subtasks.filter((st) => st.done).length;
  const lifted = reorder.drag?.id === todo.id;
  const today = getTodayDate();
  const goalChoices = loadGoals().filter((g) => !g.doneAt || g.id === todo.goalId);
  const goal = goalChoices.find((g) => g.id === todo.goalId);

  return (
    <div
      draggable={!todo.completed && !reorder.drag}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/todo-id", todo.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      data-reorder-id={todo.completed ? undefined : todo.id}
      style={{
        ...(lifted ? { transform: `translateY(${reorder.drag!.dy}px)` } : {}),
        ...(todo.tag && !todo.completed ? { borderLeftColor: tagColor(todo.tag), borderLeftWidth: 3 } : {}),
      }}
      className={`relative rounded-2xl border p-3.5 pr-2 backdrop-blur-xl sm:pr-3.5 ${
        lifted
          ? "z-20 border-gold/60 bg-white/[.12] opacity-90 shadow-2xl shadow-black/60"
          : todo.completed
          ? "border-emerald-400/15 bg-emerald-400/[.04] transition"
          : "border-white/10 bg-white/[.06] transition hover:border-white/25 hover:bg-white/[.09]"
      }`}
    >
      <div className="flex items-start gap-2">
        {!todo.completed && (
          <button
            type="button"
            aria-label={`Drag to reorder ${todo.text}`}
            title="Drag to reorder (or use ↑ ↓ on the keyboard)"
            onPointerDown={(e) => reorder.start(e, todo.id)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
              e.preventDefault();
              onMoveBy(todo, e.key === "ArrowUp" ? -1 : 1);
            }}
            className={`-ml-1 mt-0.5 flex h-6 w-6 shrink-0 touch-none select-none items-center justify-center rounded-md text-white/30 transition hover:bg-white/10 hover:text-white/70 focus:text-white/80 focus:outline-none focus:ring-1 focus:ring-gold/50 ${
              lifted ? "cursor-grabbing text-gold" : "cursor-grab"
            }`}
          >
            <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor" aria-hidden>
              {[3, 8, 13].map((y) => (
                <g key={y}>
                  <circle cx="3" cy={y} r="1.4" />
                  <circle cx="9" cy={y} r="1.4" />
                </g>
              ))}
            </svg>
          </button>
        )}
        <button
          onClick={() => onToggle(todo.id)}
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition ${
            todo.completed
              ? "border-gold bg-gold text-black"
              : "border-white/30 text-white/50 hover:border-gold/50 hover:text-gold"
          }`}
          aria-label={todo.completed ? "Mark as incomplete" : "Mark as complete"}
        >
          {todo.completed && (
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </button>

        <div className="min-w-0 flex-1">
          <p
            onDoubleClick={() => onEditStart(todo)}
            className={`break-words text-sm leading-relaxed transition ${
              todo.completed ? "text-white/40 line-through" : "text-white/90"
            }`}
          >
            {todo.text}
          </p>
          {todo.note && (
            <p
              onDoubleClick={() => onEditStart(todo)}
              className={`mt-0.5 whitespace-pre-wrap break-words text-xs leading-relaxed ${
                todo.completed ? "text-white/30" : "text-white/55"
              }`}
            >
              {todo.note}
            </p>
          )}
          {(subtasks.length > 0 || addingSubtask) && (
            <ul className="mt-2 space-y-1">
              {subtasks.map((st) => (
                <li key={st.id} className="group flex items-start gap-2 text-xs">
                  <button
                    onClick={() => onToggleSubtask(todo, st.id)}
                    className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border ${
                      st.done ? "border-gold bg-gold text-black" : "border-white/40 hover:border-gold/60"
                    }`}
                    aria-label={st.done ? `Mark "${st.text}" as not done` : `Mark "${st.text}" as done`}
                  >
                    {st.done && <span className="text-[9px] leading-none">✓</span>}
                  </button>
                  <span className={`min-w-0 flex-1 break-words ${st.done ? "text-white/35 line-through" : "text-white/75"}`}>
                    {st.text}
                  </span>
                  <button
                    onClick={() => onDeleteSubtask(todo, st.id)}
                    className="shrink-0 px-1 text-white/30 hover:text-red-400 focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                    aria-label={`Delete "${st.text}"`}
                  >
                    ✕
                  </button>
                </li>
              ))}
              <li>
                {addingSubtask ? (
                  <input
                    autoFocus
                    value={subtaskText}
                    onChange={(e) => setSubtaskText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitSubtask();
                      else if (e.key === "Escape") {
                        setSubtaskText("");
                        setAddingSubtask(false);
                      }
                    }}
                    onBlur={() => {
                      submitSubtask();
                      setAddingSubtask(false);
                    }}
                    placeholder="Add an item, Enter for the next"
                    className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-white placeholder-white/40 focus:border-gold/40 focus:outline-none"
                    autoComplete="off"
                  />
                ) : (
                  <button onClick={() => setAddingSubtask(true)} className="text-[11px] text-white/45 hover:text-gold">
                    + Add item
                  </button>
                )}
              </li>
            </ul>
          )}
          <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-white/40">
            {todo.start !== undefined ? (
              <button
                onClick={() => onShowBlock(todo)}
                className="rounded-full bg-gold/15 px-2 py-0.5 text-gold hover:bg-gold/25"
                title="Show in schedule"
              >
                {fmtTime(todo.start)} – {fmtTime(todo.start + duration)}
              </button>
            ) : (
              <button
                onClick={() => onSchedule(todo)}
                className="rounded-full border border-dashed border-white/25 px-2 py-0.5 text-white/55 hover:border-gold/50 hover:text-gold"
                title="Add to schedule (or drag onto the planner)"
              >
                + Schedule
              </button>
            )}
            <label
              className="relative inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-white/15 px-2 py-0.5 text-white/60 focus-within:border-gold/50 hover:border-white/30 hover:text-white"
              title="Tag"
            >
              {todo.tag && <span className="h-2 w-2 rounded-full" style={{ background: tagColor(todo.tag) }} />}
              {todo.tag ? tagLabel(todo.tag) : "+ Tag"}
              <select
                value={todo.tag ?? ""}
                onChange={(e) => onSetTag(todo, (e.target.value || undefined) as TagId | undefined)}
                className="absolute inset-0 cursor-pointer opacity-0"
                aria-label="Tag"
              >
                <option value="">No tag</option>
                {activeTags().map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            {goalChoices.length > 0 && (
              <label
                className="relative inline-flex cursor-pointer items-center gap-1 rounded-full border border-white/15 px-2 py-0.5 text-white/60 focus-within:border-gold/50 hover:border-white/30 hover:text-white"
                title="The goal this task works towards"
              >
                🎯 {goal ? goal.name : "+ Goal"}
                <select
                  value={goal?.id ?? ""}
                  onChange={(e) => onSetGoal(todo, e.target.value || undefined)}
                  className="absolute inset-0 cursor-pointer opacity-0"
                  aria-label="Goal"
                >
                  <option value="">No goal</option>
                  {goalChoices.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!todo.dailyId && (
              <button
                onClick={() => setShowDue((v) => !v)}
                aria-expanded={showDue}
                title="The day it must be done by, however often the task moves"
                className={`rounded-full border px-2 py-0.5 hover:border-gold/50 ${todo.due ? dueTone(todo, date, today) : "border-dashed border-white/25 text-white/55 hover:text-gold"}`}
              >
                {todo.due ? `🏁 ${todo.completed ? `Due ${formatShortDate(todo.due)}` : dueLabel(todo.due, today)}${!todo.completed && date > todo.due && todo.due >= today ? " · planned after it" : ""}` : "+ Due"}
              </button>
            )}
            {focusing ? (
              <span className="flex items-center gap-1.5 rounded-full bg-gold/15 px-2 py-0.5 text-gold">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold" /> Focusing
              </span>
            ) : (
              !todo.completed && (
                <button
                  onClick={() => onStartFocus(todo)}
                  className="rounded-full border border-white/15 px-2 py-0.5 text-white/60 hover:border-gold/50 hover:text-gold"
                  title="Start a focus timer for this task"
                >
                  ▶ Focus
                </button>
              )
            )}
            {todo.spent ? (
              <span title="Time spent (focus timer) / time planned">
                ⏱ {fmtDuration(todo.spent)}
                {todo.start !== undefined && ` / ${fmtDuration(duration)}`}
              </span>
            ) : null}
            {todo.dailyId && (
              <button
                onClick={() => setShowRepeat((v) => !v)}
                aria-expanded={showRepeat}
                className="rounded-full bg-gold/10 px-2 py-0.5 text-gold/80 hover:bg-gold/20"
                title="Choose how it repeats"
              >
                ↻ {repeatLabel(repeat)}
                {repeat?.timesPerWeek ? ` · ${weekCount ?? 0}/${repeat.timesPerWeek}` : ""}
              </button>
            )}
            {streak >= 2 && (
              <span className="rounded-full bg-orange-500/15 px-2 py-0.5 text-orange-300" title={repeat?.timesPerWeek ? `Target met ${streak} weeks in a row` : `Done ${streak} times in a row`}>
                🔥 {streak}
                {repeat?.timesPerWeek ? " wk" : ""}
              </span>
            )}
            {subtasks.length > 0 ? (
              <span className={subtasksDone === subtasks.length ? "text-gold/80" : ""}>
                ☑ {subtasksDone}/{subtasks.length}
              </span>
            ) : (
              !addingSubtask && (
                <button onClick={() => setAddingSubtask(true)} className="text-white/45 hover:text-gold">
                  + Checklist
                </button>
              )
            )}
            {todo.carriedFrom && (
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-white/60">from {getRelativeDateLabel(todo.carriedFrom)}</span>
            )}
          </p>
          <SlippingHint todo={todo} onDrop={() => onDelete(todo.id)} onAddStep={(text) => onAddSubtask(todo, text)} />
          {showDue && !todo.dailyId && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-white/55">
              <input
                type="date"
                value={todo.due ?? ""}
                onChange={(e) => onSetDue(todo, e.target.value || undefined)}
                className="rounded-lg border border-white/10 bg-panel px-2 py-1 text-white [color-scheme:dark] focus:border-gold/50 focus:outline-none"
                aria-label={`Deadline for “${todo.text}”`}
              />
              {todo.due && (
                <button onClick={() => onSetDue(todo, undefined)} className="text-white/45 hover:text-white">
                  Remove deadline
                </button>
              )}
              <button onClick={() => setShowDue(false)} className="text-white/45 hover:text-white">
                Close
              </button>
              <span className="basis-full text-white/40">Stays the same when the task moves to another day.</span>
            </div>
          )}
          {showSend && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-white/55">
              <input
                type="date"
                value={sendDate}
                onChange={(e) => setSendDate(e.target.value)}
                className="rounded-lg border border-white/10 bg-panel px-2 py-1 text-white [color-scheme:dark] focus:border-gold/50 focus:outline-none"
                aria-label="Day to move or copy to"
              />
              <button
                onClick={() => {
                  setShowSend(false);
                  onSendToDay(todo, sendDate, "move");
                }}
                disabled={!sendDate || sendDate === date || Boolean(todo.dailyId)}
                title={todo.dailyId ? "Repeating tasks stay on their own day. Copy it instead." : undefined}
                className="rounded-full border border-white/20 px-3 py-1 text-white/80 hover:border-gold/50 hover:text-gold disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-white/20 disabled:hover:text-white/80"
              >
                Move
              </button>
              <button
                onClick={() => {
                  setShowSend(false);
                  onSendToDay(todo, sendDate, "copy");
                }}
                disabled={!sendDate}
                className="rounded-full bg-gold px-3 py-1 font-semibold text-black hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Copy
              </button>
              <button onClick={() => setShowSend(false)} className="text-white/45 hover:text-white">
                Cancel
              </button>
              {todo.start !== undefined && <span className="basis-full text-white/40">Keeps the {fmtTime(todo.start)} time slot</span>}
            </div>
          )}
          {showRepeat && todo.dailyId && (
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-white/55">
              <RepeatPicker value={repeat ?? {}} onChange={(rule) => onSetRepeat(todo, rule)} date={date} />
              <button
                onClick={() => {
                  setShowRepeat(false);
                  onToggleDaily(todo);
                }}
                className="text-white/45 hover:text-red-400"
              >
                Stop repeating
              </button>
            </div>
          )}
        </div>

        <div className="-mr-1 flex shrink-0 items-center sm:mr-0 sm:gap-1">
          <button
            onClick={() => onCyclePriority(todo)}
            className="flex items-center gap-1.5 rounded-lg p-2 text-[11px] text-white/50 transition hover:bg-white/10 hover:text-white sm:px-2 sm:py-1.5"
            aria-label="Change priority"
            title="Click to change priority"
          >
            <span className={`h-2.5 w-2.5 rounded-full ${pri ? pri.dot : "border border-white/30"}`} />
            <span className="hidden sm:inline">{pri ? pri.label : "Priority"}</span>
          </button>
          <button
            onClick={() => onToggleDaily(todo)}
            className={`rounded-lg p-2 text-sm leading-4 transition hover:bg-white/10 sm:p-1.5 ${
              todo.dailyId ? "text-gold" : "text-white/50 hover:text-white"
            }`}
            aria-label={todo.dailyId ? "Stop repeating daily" : "Repeat daily"}
            aria-pressed={Boolean(todo.dailyId)}
            title={todo.dailyId ? "Repeats daily - click to stop" : "Repeat every day"}
          >
            <span className="inline-block h-4 w-4 text-center">↻</span>
          </button>
          <button
            onClick={() => {
              setSendDate(shiftDate(date, 1));
              setShowSend((v) => !v);
            }}
            className={`rounded-lg p-2 text-sm leading-4 transition hover:bg-white/10 sm:p-1.5 ${
              showSend ? "text-gold" : "text-white/50 hover:text-white"
            }`}
            aria-label="Move or copy to another day"
            aria-expanded={showSend}
            title="Move or copy to another day"
          >
            <span className="inline-block h-4 w-4 text-center">⇄</span>
          </button>
          <button
            onClick={() => onEditStart(todo)}
            className="rounded-lg p-2 sm:p-1.5 text-white/50 transition hover:bg-white/10 hover:text-white"
            aria-label="Edit todo"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            onClick={() => onDelete(todo.id)}
            className="rounded-lg p-2 sm:p-1.5 text-white/50 transition hover:bg-red-500/10 hover:text-red-400"
            aria-label="Delete todo"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// Reordering the task list by dragging a row's handle with a mouse, finger or pen. Rows that can
// move carry data-reorder-id; the one being dragged follows the pointer and a line shows where it
// will land. `onCommit` gets the task and the one it goes before (null = the end).
export type ListReorder = ReturnType<typeof useListReorder>;
export function useListReorder(onCommit: (id: string, before: string | null) => void) {
  const [drag, setDrag] = useState<{ id: string; dy: number; before: string | null } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const start = (e: React.PointerEvent, id: string) => {
    if (e.button > 0) return;
    e.preventDefault(); // keeps the row's native drag (to the planner) from starting
    const startY = e.clientY;
    let before: string | null | undefined;
    const move = (ev: PointerEvent) => {
      // Near the top or bottom edge, scroll the page so a long list can be dragged through.
      if (ev.clientY < 80) window.scrollBy(0, -14);
      else if (ev.clientY > window.innerHeight - 80) window.scrollBy(0, 14);
      const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-reorder-id]") ?? []).filter(
        (r) => r.dataset.reorderId !== id
      );
      const next = rows.find((r) => {
        const box = r.getBoundingClientRect();
        return ev.clientY < box.top + box.height / 2;
      });
      before = next?.dataset.reorderId ?? null;
      setDrag({ id, dy: ev.clientY - startY, before });
    };
    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", drop);
      window.removeEventListener("pointercancel", cancel);
      setDrag(null);
      if (commit && before !== undefined) onCommit(id, before);
    };
    const drop = () => finish(true);
    const cancel = () => finish(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", drop);
    window.addEventListener("pointercancel", cancel);
  };

  return { drag, listRef, start };
}

export function DropLine() {
  return <div className="-my-1 h-0.5 rounded-full bg-gold" aria-hidden data-testid="drop-line" />;
}
