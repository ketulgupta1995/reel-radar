"use client";

// Pieces shared by the planner's screens: dates, lengths, block layout and resizing.

import { useRef, useState } from "react";
import { DEFAULT_DURATION, getTodayDate, shiftDate, type Todo } from "@/lib/todos";
import { fmtTime } from "@/lib/reminders";

export { fmtTime };

export const HOUR_PX = 64;
export const SNAP = 15; // minutes
const MIN_BLOCK_PX = 22; // shortest a block is drawn, so its text stays readable
const MIN_BLOCK_MINUTES = (MIN_BLOCK_PX / HOUR_PX) * 60;

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

export const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240];
export const toInputTime = (mins: number): string =>
  `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
export const fromInputTime = (v: string): number | null => {
  const m = /^(\d{2}):(\d{2})$/.exec(v);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
// The same day of a month `n` months away, or that month's last day if it's shorter.
export function shiftMonth(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const last = new Date(y, m - 1 + n + 1, 0);
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(Math.min(d, last.getDate())).padStart(2, "0")}`;
}
export const fmtDuration = (mins: number): string =>
  mins % 60 === 0 ? `${mins / 60}h` : mins > 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
export const snap = (mins: number) => Math.round(mins / SNAP) * SNAP;
export const clampStart = (start: number, duration: number) => Math.max(0, Math.min(start, 24 * 60 - duration));

// Blocks never share space: one that would overlap the block before it is drawn right below it
// (`shift` minutes later than its start) so they read one after another. `lane`/`lanes` stay 0/1.
export function layoutBlocks(blocks: Todo[]): Map<string, { lane: number; lanes: number; shift: number }> {
  const sorted = [...blocks].sort((a, b) => a.start! - b.start! || (b.duration ?? 0) - (a.duration ?? 0));
  const result = new Map<string, { lane: number; lanes: number; shift: number }>();
  let bottom = 0; // where the previous block ends, as drawn
  for (const b of sorted) {
    const top = Math.max(b.start!, bottom);
    // A short block is drawn taller than its duration.
    bottom = top + Math.max(b.duration ?? DEFAULT_DURATION, MIN_BLOCK_MINUTES);
    result.set(b.id, { lane: 0, lanes: 1, shift: top - b.start! });
  }
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
