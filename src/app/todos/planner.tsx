"use client";

// Pieces shared by the day planner, the week view and the stats page.

import { useRef, useState } from "react";
import { DEFAULT_DURATION, getTodayDate, shiftDate, type Priority, type TagId, type Todo } from "@/lib/todos";

export const HOUR_PX = 64;
export const SNAP = 15; // minutes

export const PRIORITY_STYLE: Record<Priority, { dot: string; label: string; block: string }> = {
  high: { dot: "bg-red-500", label: "High", block: "border-red-400/60 bg-red-500/20" },
  medium: { dot: "bg-yellow-400", label: "Medium", block: "border-yellow-400/60 bg-yellow-400/15" },
  low: { dot: "bg-sky-400", label: "Low", block: "border-sky-400/60 bg-sky-400/15" },
};
export const NO_PRIORITY_BLOCK = "border-white/25 bg-white/10";

// Categorical colours in a fixed order, checked for colour-blind separation and 3:1 contrast on `panel`.
export const TAG_COLORS: Record<TagId, string> = {
  work: "#3987e5",
  home: "#d95926",
  health: "#199e70",
  personal: "#c98500",
  learning: "#d55181",
  errands: "#008300",
};

export const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

export function formatShortDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function getRelativeDateLabel(dateStr: string): string {
  const today = getTodayDate();
  if (dateStr === today) return "Today";
  if (dateStr === shiftDate(today, -1)) return "Yesterday";
  if (dateStr === shiftDate(today, 1)) return "Tomorrow";
  return formatDate(dateStr);
}

export const fmtTime = (mins: number): string => {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""} ${h < 12 ? "AM" : "PM"}`;
};
export const fmtDuration = (mins: number): string =>
  mins % 60 === 0 ? `${mins / 60}h` : mins > 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
export const snap = (mins: number) => Math.round(mins / SNAP) * SNAP;
export const clampStart = (start: number, duration: number) => Math.max(0, Math.min(start, 24 * 60 - duration));

// Side-by-side lanes for overlapping blocks.
export function layoutBlocks(blocks: Todo[]): Map<string, { lane: number; lanes: number }> {
  const sorted = [...blocks].sort((a, b) => a.start! - b.start! || (b.duration ?? 0) - (a.duration ?? 0));
  const result = new Map<string, { lane: number; lanes: number }>();
  let cluster: { id: string; lane: number }[] = [];
  let clusterEnd = -1;
  const laneEnds: number[] = [];
  const flush = () => {
    cluster.forEach((c) => result.set(c.id, { lane: c.lane, lanes: laneEnds.length }));
    cluster = [];
    laneEnds.length = 0;
  };
  for (const b of sorted) {
    const start = b.start!;
    const end = start + (b.duration ?? DEFAULT_DURATION);
    if (start >= clusterEnd) flush();
    let lane = laneEnds.findIndex((e) => e <= start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = end;
    cluster.push({ id: b.id, lane });
    clusterEnd = cluster.length === 1 ? end : Math.max(clusterEnd, end);
  }
  flush();
  return result;
}

export type BlockResize = ReturnType<typeof useBlockResize>;

// Drag a block's bottom edge to change its length. The block shows the preview while dragging;
// `onCommit` runs once on release, only if the length changed.
export function useBlockResize(onCommit: (todo: Todo, date: string, duration: number) => void) {
  const [preview, setPreview] = useState<{ id: string; duration: number } | null>(null);
  const active = useRef(false);

  const start = (e: React.PointerEvent, todo: Todo, date: string) => {
    e.stopPropagation();
    e.preventDefault(); // also keeps the block's native drag from starting
    active.current = true;
    const startY = e.clientY;
    const base = todo.duration ?? DEFAULT_DURATION;
    const max = 24 * 60 - todo.start!;
    let duration = base;
    const move = (ev: PointerEvent) => {
      duration = Math.max(SNAP, Math.min(max, snap(base + ((ev.clientY - startY) / HOUR_PX) * 60)));
      setPreview({ id: todo.id, duration });
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      setPreview(null);
      // Stay "active" through the click that follows pointerup, so it doesn't count as a block click.
      setTimeout(() => (active.current = false), 0);
      if (duration !== base) onCommit(todo, date, duration);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  return { preview, active, start };
}

export function TimeBlock({
  todo,
  date,
  lane,
  lanes,
  selected,
  compact,
  resize,
  onSelect,
  onToggle,
}: {
  todo: Todo;
  date: string;
  lane: number;
  lanes: number;
  selected?: boolean;
  compact?: boolean; // week view: narrower columns
  resize: BlockResize;
  onSelect: (todo: Todo) => void;
  onToggle: (todo: Todo) => void;
}) {
  const resizing = resize.preview?.id === todo.id;
  const duration = resizing ? resize.preview!.duration : todo.duration ?? DEFAULT_DURATION;
  const style = todo.priority ? PRIORITY_STYLE[todo.priority].block : NO_PRIORITY_BLOCK;
  const start = todo.start!;
  return (
    <div
      draggable
      onDragStart={(e) => {
        if (resize.active.current) return e.preventDefault();
        e.dataTransfer.setData("text/todo-id", todo.id);
        e.dataTransfer.setData("text/todo-date", date);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (!resize.active.current) onSelect(todo);
      }}
      className={`group absolute z-10 cursor-grab overflow-hidden rounded-lg border text-xs transition-[box-shadow,opacity] active:cursor-grabbing ${style} ${
        compact ? "px-1.5 py-0.5" : "px-2 py-1"
      } ${selected || resizing ? "z-20 ring-2 ring-gold" : ""} ${todo.completed ? "opacity-50" : ""}`}
      style={{
        top: (start / 60) * HOUR_PX + 1,
        height: Math.max((duration / 60) * HOUR_PX - 2, 22),
        left: `${(lane / lanes) * 100}%`,
        width: `calc(${100 / lanes}% - 3px)`,
        ...(todo.tag ? { borderLeftColor: TAG_COLORS[todo.tag], borderLeftWidth: 4 } : {}),
      }}
      title={`${todo.text} · ${fmtTime(start)}–${fmtTime(start + duration)}${todo.note ? `\n${todo.note}` : ""}`}
    >
      <div className="flex items-start gap-1.5">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle(todo);
          }}
          className={`mt-px flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border ${
            todo.completed ? "border-gold bg-gold text-black" : "border-white/50"
          }`}
          aria-label={todo.completed ? "Mark as incomplete" : "Mark as complete"}
        >
          {todo.completed && <span className="text-[9px] leading-none">✓</span>}
        </button>
        <span className={`min-w-0 flex-1 truncate font-medium ${todo.completed ? "line-through" : ""}`}>{todo.text}</span>
      </div>
      {(resizing || duration >= 45) && (
        <div className="mt-0.5 truncate text-[10px] text-white/55">
          {resizing
            ? `${fmtTime(start)} – ${fmtTime(start + duration)} · ${fmtDuration(duration)}`
            : compact
            ? fmtTime(start)
            : `${fmtTime(start)} – ${fmtTime(start + duration)}${todo.spent ? ` · ⏱ ${fmtDuration(todo.spent)}` : ""}`}
        </div>
      )}
      {/* resize handle */}
      <div
        onPointerDown={(e) => resize.start(e, todo, date)}
        className="absolute inset-x-0 bottom-0 flex h-2.5 cursor-ns-resize touch-none items-end justify-center"
        title="Drag to change length"
      >
        <span
          className={`mb-0.5 h-0.5 w-6 rounded-full bg-white/60 transition-opacity ${
            selected || resizing ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
        />
      </div>
    </div>
  );
}
