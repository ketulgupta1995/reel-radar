"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_DURATION, type Todo } from "@/lib/todos";
import { dayMarks, type DayMark } from "@/lib/plannerToday";
import { tagColor } from "@/lib/plannerSettings";
import type { DayLog } from "@/lib/todos";
import { HOUR_PX, SNAP, fmtDuration, fmtTime, layoutBlocks, snap, useBlockResize } from "./planner";

export type ScheduleActions = {
  onOpen: (t: Todo) => void;
  onTick: (t: Todo) => void;
  onPlace: (id: string, start: number) => void; // a block dropped at a time, or a task dropped onto the schedule
  onLength: (t: Todo, duration: number) => void;
  onQuickAdd: (start: number, text: string) => void;
};

const TONES: Record<DayMark["tone"], string> = {
  emerald: "bg-emerald-500/20 text-emerald-800 ring-emerald-600/40 dark:text-emerald-200",
  amber: "bg-amber-400/25 text-amber-800 ring-amber-600/40 dark:text-amber-200",
  violet: "bg-violet-400/25 text-violet-800 ring-violet-600/40 dark:text-violet-200",
  sky: "bg-bf-water text-bf-water-ink ring-transparent",
};
const MARK_PX = 22; // one pill plus a little air
const DONE_COL = "w-[clamp(6.5rem,34%,12rem)]";
const DONE_COL_RIGHT = "right-[clamp(6.5rem,34%,12rem)]";

// The id of a task being dragged, from a row or a block.
const draggedId = (e: React.DragEvent) => e.dataTransfer.getData("text/todo-id");

// A time slot to type a task into, opened by a tap on an empty part of the schedule.
function QuickAdd({ start, style, onDone }: { start: number; style: React.CSSProperties; onDone: (text: string | null) => void }) {
  const [text, setText] = useState("");
  const done = useRef(false);
  const finish = (value: string | null) => {
    if (done.current) return; // Enter and the blur after it must not both add
    done.current = true;
    onDone(value);
  };
  return (
    <div className="absolute z-30 rounded-[10px] bg-bf-s1 p-1 shadow-xl ring-2 ring-bf-ink" style={style} onClick={(e) => e.stopPropagation()}>
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") finish(text);
          else if (e.key === "Escape") finish(null);
        }}
        onBlur={() => finish(text)}
        aria-label={`What's planned at ${fmtTime(start)}?`}
        placeholder={`${fmtTime(start)} · what's planned?`}
        className="w-full bg-transparent px-1.5 py-1 text-sm font-bold text-bf-ink placeholder:font-normal placeholder:text-bf-muted focus:outline-none"
      />
    </div>
  );
}

// The phone's timeline: the whole day by the hour, blocks in their tag colours, the time now, and the
// Done column (wake, sleep, water and what was ticked). Tap a gap to add; drag a block to move it, or its
// bottom edge to change its length.
export function Timeline({ todos, log, date, now, actions }: { todos: Todo[]; log: DayLog; date: string; now: number | null; actions: ScheduleActions }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [adding, setAdding] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const resize = useBlockResize((t, _date, duration) => actions.onLength(t, duration));
  const blocks = todos.filter((t) => t.start !== undefined);
  const lanes = layoutBlocks(blocks);
  const marks = dayMarks(log, todos, date);

  // Open on the first block, the time now, or 8 AM.
  useEffect(() => {
    const starts = todos.filter((t) => t.start !== undefined).map((t) => t.start!);
    const target = starts.length ? Math.min(...starts) : now ?? 8 * 60;
    if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, (target / 60 - 1) * HOUR_PX);
    // Only when the day changes, not on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const minutesAt = (clientY: number) => {
    const rect = gridRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(snap(((clientY - rect.top) / HOUR_PX) * 60), 24 * 60 - SNAP));
  };
  const shifts = new Map<string, number>();
  let bottom = -Infinity;
  for (const m of [...marks].sort((a, b) => a.at - b.at)) {
    const y = Math.max((m.at / 60) * HOUR_PX, bottom + MARK_PX);
    shifts.set(m.key, y - (m.at / 60) * HOUR_PX);
    bottom = y;
  }

  return (
    <section aria-label="Timeline" ref={scrollRef} className="relative h-[65vh] overflow-y-auto rounded-[14px] bg-bf-s1">
      <div
        ref={gridRef}
        data-testid="timeline-grid"
        className="relative ml-12 mr-2"
        style={{ height: 24 * HOUR_PX }}
        onClick={(e) => {
          if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.slot) return;
          setAdding(Math.floor(minutesAt(e.clientY) / 30) * 30);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(minutesAt(e.clientY));
        }}
        onDragLeave={() => setOver(null)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(null);
          const id = draggedId(e);
          if (id) actions.onPlace(id, minutesAt(e.clientY));
        }}
      >
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} data-slot="1" className="absolute inset-x-0 border-t border-bf-s2" style={{ top: h * HOUR_PX, height: HOUR_PX }}>
            <span className="pointer-events-none absolute -left-12 -top-2 w-10 text-right font-bfm text-[10.5px] text-bf-muted">{h === 0 ? "" : fmtTime(h * 60).replace(" ", "")}</span>
          </div>
        ))}
        {over !== null && (
          <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-gold" style={{ top: (over / 60) * HOUR_PX }}>
            <span className="absolute -top-2.5 right-0 rounded bg-gold px-1.5 font-bfm text-[10px] font-bold text-bf-ontag">{fmtTime(over)}</span>
          </div>
        )}
        {now !== null && <div aria-label={`Now, ${fmtTime(now)}`} className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-bf-ink" style={{ top: (now / 60) * HOUR_PX }} />}

        {marks.length > 0 && (
          <div className={`pointer-events-none absolute inset-y-0 right-0 border-l border-bf-s2 ${DONE_COL}`}>
            <div className="sticky top-0 bg-bf-s1 px-2 py-0.5 font-bfm text-[10px] uppercase tracking-[.08em] text-bf-muted">Done</div>
          </div>
        )}
        {marks.map((m) => (
          <span
            key={m.key}
            data-testid="day-mark"
            title={m.title}
            style={{ top: (m.at / 60) * HOUR_PX + (shifts.get(m.key) ?? 0) }}
            className={`pointer-events-none absolute right-0 z-[15] flex -translate-y-1/2 justify-between gap-1 rounded-full px-2 py-0.5 font-bfm text-[10px] ring-1 ${DONE_COL} ${TONES[m.tone]}`}
          >
            <span className="min-w-0 truncate">{m.text}</span>
            {m.time && <span className="shrink-0 opacity-70">{m.time}</span>}
          </span>
        ))}

        <div data-slot="1" className={`absolute inset-y-0 left-0 ${marks.length ? DONE_COL_RIGHT : "right-0"}`}>
          {blocks.map((t) => {
            const resizing = resize.preview?.id === t.id;
            const duration = resizing ? resize.preview!.duration : t.duration ?? DEFAULT_DURATION;
            const shift = lanes.get(t.id)?.shift ?? 0;
            return (
              <div
                key={t.id}
                data-block={t.id}
                draggable
                onDragStart={(e) => {
                  if (resize.active.current) return e.preventDefault();
                  e.dataTransfer.setData("text/todo-id", t.id);
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!resize.active.current) actions.onOpen(t);
                }}
                className={`group absolute inset-x-0 z-10 mr-1 cursor-grab overflow-hidden rounded-[9px] px-2 py-1 text-[12.5px] font-extrabold text-bf-ontag ${t.completed ? "opacity-40" : ""} ${resizing ? "ring-2 ring-bf-ink" : ""}`}
                style={{ top: ((t.start! + shift) / 60) * HOUR_PX + 1, height: Math.max((duration / 60) * HOUR_PX - 2, 22), background: tagColor(t.tag ?? "") }}
              >
                <div className="flex items-start gap-1.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      actions.onTick(t);
                    }}
                    aria-label={t.completed ? `Mark “${t.text}” not done` : `Mark “${t.text}” done`}
                    className="mt-px grid h-3.5 w-3.5 shrink-0 place-items-center rounded-sm border border-bf-ontag text-[9px]"
                  >
                    {t.completed ? "✓" : ""}
                  </button>
                  <span className={`min-w-0 flex-1 truncate ${t.completed ? "line-through" : ""}`}>{t.text}</span>
                </div>
                {(resizing || duration >= 45) && (
                  <div className="truncate font-bfm text-[10.5px] font-medium opacity-75">
                    {fmtTime(t.start!)} – {fmtTime(t.start! + duration)}
                    {resizing ? ` · ${fmtDuration(duration)}` : t.spent ? ` · ⏱ ${fmtDuration(t.spent)}` : ""}
                  </div>
                )}
                <div onPointerDown={(e) => resize.start(e, t, date)} data-testid="resize-handle" title="Drag to change length" className="absolute inset-x-0 bottom-0 h-2.5 cursor-ns-resize touch-none" />
              </div>
            );
          })}
        </div>

        {adding !== null && (
          <QuickAdd
            start={adding}
            style={{ top: (adding / 60) * HOUR_PX + 2, left: 0, right: 0 }}
            onDone={(text) => {
              setAdding(null);
              if (text?.trim()) actions.onQuickAdd(adding, text.trim());
            }}
          />
        )}
      </div>
    </section>
  );
}

// The laptop's day bar: the day from 6 AM (earlier if something starts before) to midnight, across the
// page. Drop a task on it to schedule it, drag a block to move it, drag its right edge to change its
// length, tap a gap to add one. What was done shows underneath.
export function DayBar({ todos, log, date, now, actions }: { todos: Todo[]; log: DayLog; date: string; now: number | null; actions: ScheduleActions }) {
  const barRef = useRef<HTMLDivElement>(null);
  const [adding, setAdding] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ id: string; duration: number } | null>(null);
  const resizing = useRef(false);
  const blocks = todos.filter((t) => t.start !== undefined);
  const from = Math.min(6 * 60, ...blocks.map((t) => Math.floor(t.start! / 60) * 60));
  const span = 24 * 60 - from;
  const pct = (m: number) => ((m - from) / span) * 100;
  const marks = dayMarks(log, todos, date).sort((a, b) => a.at - b.at);
  const minutesAt = (clientX: number) => {
    const rect = barRef.current!.getBoundingClientRect();
    return Math.max(from, Math.min(snap(from + ((clientX - rect.left) / rect.width) * span), 24 * 60 - SNAP));
  };

  const startResize = (e: React.PointerEvent, t: Todo) => {
    e.stopPropagation();
    e.preventDefault();
    resizing.current = true;
    const x0 = e.clientX;
    const base = t.duration ?? DEFAULT_DURATION;
    const perPx = span / barRef.current!.getBoundingClientRect().width;
    let duration = base;
    const move = (ev: PointerEvent) => {
      duration = Math.max(SNAP, Math.min(24 * 60 - t.start!, snap(base + (ev.clientX - x0) * perPx)));
      setPreview({ id: t.id, duration });
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      setPreview(null);
      setTimeout(() => (resizing.current = false), 0); // the click after pointerup isn't a tap on the block
      if (duration !== base) actions.onLength(t, duration);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  // Marks close together go on the next of three rows, so they don't cover each other.
  const rows: number[] = [];
  const rowOf = new Map<string, number>();
  for (const m of marks) {
    const row = [0, 1, 2].find((r) => rows[r] === undefined || pct(m.at) - rows[r] > 9) ?? 0;
    rows[row] = pct(m.at);
    rowOf.set(m.key, row);
  }

  return (
    <section aria-label="Day bar" className="relative">
      <div
        ref={barRef}
        data-testid="day-bar"
        className="relative h-[78px] rounded-[14px] bg-bf-s1"
        onClick={(e) => {
          if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.slot) return;
          setAdding(Math.floor(minutesAt(e.clientX) / 30) * 30);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(minutesAt(e.clientX));
        }}
        onDragLeave={() => setOver(null)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(null);
          const id = draggedId(e);
          if (id) actions.onPlace(id, minutesAt(e.clientX));
        }}
      >
        {Array.from({ length: Math.floor(span / 120) + 1 }, (_, i) => from + i * 120).map((m) => (
          <div key={m} data-slot="1" className="absolute inset-y-0 border-l border-bf-s2" style={{ left: `${pct(m)}%` }}>
            <span className="absolute -left-2 -top-[17px] font-bfm text-[10px] text-bf-muted">{(m / 60) % 24}</span>
          </div>
        ))}
        {blocks.map((t) => {
          const duration = preview?.id === t.id ? preview.duration : t.duration ?? DEFAULT_DURATION;
          return (
            <div
              key={t.id}
              data-block={t.id}
              draggable
              onDragStart={(e) => {
                if (resizing.current) return e.preventDefault();
                e.dataTransfer.setData("text/todo-id", t.id);
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (!resizing.current) actions.onOpen(t);
              }}
              title={`${t.text} · ${fmtTime(t.start!)}–${fmtTime(t.start! + duration)}`}
              className={`absolute bottom-2 top-2 cursor-grab overflow-hidden rounded-[9px] px-1.5 py-1 text-left text-xs font-extrabold leading-tight text-bf-ontag ${t.completed ? "opacity-40" : ""} ${preview?.id === t.id ? "ring-2 ring-bf-ink" : ""}`}
              style={{ left: `${pct(t.start!)}%`, width: `calc(${(duration / span) * 100}% - 2px)`, background: tagColor(t.tag ?? "") }}
            >
              {duration >= 45 && <span className="block truncate">{t.text}</span>}
              {duration >= 30 && <small className="block truncate font-bfm text-[10px] font-medium opacity-75">{fmtTime(t.start!)}</small>}
              <span onPointerDown={(e) => startResize(e, t)} data-testid="resize-edge" title="Drag to change length" className="absolute inset-y-0 right-0 w-2 cursor-ew-resize touch-none" />
            </div>
          );
        })}
        {over !== null && (
          <div className="pointer-events-none absolute -bottom-1 -top-1 z-10 border-l-2 border-gold" style={{ left: `${pct(over)}%` }}>
            <span className="absolute -top-4 left-1 rounded bg-gold px-1 font-bfm text-[10px] font-bold text-bf-ontag">{fmtTime(over)}</span>
          </div>
        )}
        {now !== null && now >= from && <div aria-label={`Now, ${fmtTime(now)}`} className="pointer-events-none absolute -bottom-1 -top-1 z-20 border-l-2 border-bf-ink" style={{ left: `${pct(now)}%` }} />}
        {adding !== null && (
          <QuickAdd
            start={adding}
            style={{ left: `${Math.min(pct(adding), 70)}%`, top: 8, width: "30%" }}
            onDone={(text) => {
              setAdding(null);
              if (text?.trim()) actions.onQuickAdd(adding, text.trim());
            }}
          />
        )}
      </div>
      {marks.length > 0 && (
        <div className="relative mt-1.5" style={{ height: 22 * (Math.max(...rowOf.values()) + 1) }}>
          {marks.map((m) => (
            <span
              key={m.key}
              data-testid="day-mark"
              title={m.title}
              className={`absolute max-w-[11rem] -translate-x-1/2 truncate whitespace-nowrap rounded-full px-2 py-0.5 font-bfm text-[10.5px] ring-1 ${TONES[m.tone]}`}
              style={{ left: `${Math.max(4, Math.min(96, pct(m.at)))}%`, top: rowOf.get(m.key)! * 22 }}
            >
              {m.text}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
