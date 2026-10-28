"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  loadTodos,
  addTodo,
  toggleTodo,
  deleteTodo,
  restoreTodo,
  setTodoPriority,
  scheduleTodo,
  updateTodoText,
  clearCompletedTodos,
  getAllStoredDates,
  getPendingBefore,
  carryOverPending,
  getTodayDate,
  shiftDate,
  exportTodos,
  importTodos,
  syncTodosWithServer,
  DEFAULT_DURATION,
  type Priority,
  type Todo,
} from "@/lib/todos";

type Filter = "all" | "active" | "done";

const HOUR_PX = 64;
const SNAP = 15; // minutes
const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240];

const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
const PRIORITY_STYLE: Record<Priority, { dot: string; label: string; block: string }> = {
  high: { dot: "bg-red-500", label: "High", block: "border-red-400/60 bg-red-500/20" },
  medium: { dot: "bg-yellow-400", label: "Medium", block: "border-yellow-400/60 bg-yellow-400/15" },
  low: { dot: "bg-sky-400", label: "Low", block: "border-sky-400/60 bg-sky-400/15" },
};
const NO_PRIORITY_BLOCK = "border-white/25 bg-white/10";
const NEXT_PRIORITY: Record<string, Priority | undefined> = {
  none: "high",
  high: "medium",
  medium: "low",
  low: undefined,
};

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function getRelativeDateLabel(dateStr: string): string {
  const today = getTodayDate();
  if (dateStr === today) return "Today";
  if (dateStr === shiftDate(today, -1)) return "Yesterday";
  if (dateStr === shiftDate(today, 1)) return "Tomorrow";
  return formatDate(dateStr);
}

const fmtTime = (mins: number): string => {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""} ${h < 12 ? "AM" : "PM"}`;
};
const fmtDuration = (mins: number): string =>
  mins % 60 === 0 ? `${mins / 60}h` : mins > 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
const toInputTime = (mins: number): string =>
  `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
const fromInputTime = (v: string): number | null => {
  const m = /^(\d{2}):(\d{2})$/.exec(v);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const snap = (mins: number) => Math.round(mins / SNAP) * SNAP;
const clampStart = (start: number, duration: number) => Math.max(0, Math.min(start, 24 * 60 - duration));

// Active first, then by priority, then oldest first; done items sink to the bottom.
function sortTodos(todos: Todo[]): Todo[] {
  return [...todos].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    const pa = a.priority ? PRIORITY_ORDER[a.priority] : 3;
    const pb = b.priority ? PRIORITY_ORDER[b.priority] : 3;
    if (pa !== pb) return pa - pb;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

// Side-by-side lanes for overlapping blocks.
function layoutBlocks(blocks: Todo[]): Map<string, { lane: number; lanes: number }> {
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

export default function TodosPage() {
  const [selectedDate, setSelectedDate] = useState<string>(() => getTodayDate());
  const [todos, setTodos] = useState<Todo[]>([]);
  const [newTodoText, setNewTodoText] = useState("");
  const [newPriority, setNewPriority] = useState<Priority | "">("");
  const [newTime, setNewTime] = useState("");
  const [newDuration, setNewDuration] = useState(DEFAULT_DURATION);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [deleted, setDeleted] = useState<Todo | null>(null);
  const [message, setMessage] = useState("");
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "synced" | "error">("idle");
  const [selectedBlock, setSelectedBlock] = useState<string | null>(null);
  const [quickAdd, setQuickAdd] = useState<{ start: number; text: string } | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout>>();
  const quickRef = useRef(quickAdd);
  quickRef.current = quickAdd;
  const gridRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const refreshMeta = (date = selectedDate) => {
    setAvailableDates(getAllStoredDates());
    setPendingCount(getPendingBefore(date).reduce((n, d) => n + d.todos.length, 0));
  };

  useEffect(() => {
    const local = loadTodos(selectedDate);
    setTodos(local);
    refreshMeta(selectedDate);
    setDeleted(null);
    setSelectedBlock(null);
    setQuickAdd(null);
    if (local.length === 0) {
      syncTodosWithServer(selectedDate).then((remote) => {
        setTodos(remote);
        refreshMeta(selectedDate);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Current-time marker, updated every minute.
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNow(d.getHours() * 60 + d.getMinutes());
    };
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, []);

  // Scroll the planner to the first block, the current time, or 8 AM.
  useEffect(() => {
    const starts = loadTodos(selectedDate).filter((t) => t.start !== undefined).map((t) => t.start!);
    const d = new Date();
    const target =
      starts.length > 0
        ? Math.min(...starts)
        : selectedDate === getTodayDate()
        ? d.getHours() * 60
        : 8 * 60;
    if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, (target / 60 - 1) * HOUR_PX);
  }, [selectedDate]);

  const flash = (text: string) => {
    setMessage(text);
    setTimeout(() => setMessage(""), 3000);
  };

  const apply = (updated: Todo[]) => {
    setTodos(updated);
    refreshMeta();
  };

  const handleAddTodo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTodoText.trim()) return;
    const start = fromInputTime(newTime);
    apply(
      addTodo(
        newTodoText.trim(),
        selectedDate,
        newPriority || undefined,
        start !== null ? { start, duration: newDuration } : undefined
      )
    );
    setNewTodoText("");
    setNewTime("");
    inputRef.current?.focus();
  };

  const handleDelete = (id: string) => {
    const target = todos.find((t) => t.id === id);
    apply(deleteTodo(id, selectedDate));
    if (selectedBlock === id) setSelectedBlock(null);
    if (target) {
      setDeleted(target);
      clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setDeleted(null), 6000);
    }
  };

  const handleUndo = () => {
    if (!deleted) return;
    apply(restoreTodo(deleted, selectedDate));
    setDeleted(null);
  };

  const handleEditSave = (id: string) => {
    if (!editText.trim()) handleDelete(id);
    else apply(updateTodoText(id, editText.trim(), selectedDate));
    setEditingId(null);
    setEditText("");
  };

  const handleCarryOver = () => {
    const before = pendingCount;
    apply(carryOverPending(selectedDate));
    flash(`Moved ${before} unfinished ${before === 1 ? "task" : "tasks"} to ${getRelativeDateLabel(selectedDate)}`);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    importTodos(
      file,
      (importedTodos, date) => {
        if (date === selectedDate) setTodos(importedTodos);
        refreshMeta();
        flash(`Imported ${importedTodos.length} todos for ${date}`);
      },
      (msg) => flash(msg)
    );
    e.target.value = "";
  };

  const handleSync = async () => {
    setSyncStatus("syncing");
    try {
      apply(await syncTodosWithServer(selectedDate));
      setSyncStatus("synced");
    } catch {
      setSyncStatus("error");
    }
    setTimeout(() => setSyncStatus("idle"), 2000);
  };

  // Planner actions
  const placeTodo = (id: string, start: number) => {
    const t = todos.find((x) => x.id === id);
    if (!t) return;
    const duration = t.duration ?? DEFAULT_DURATION;
    apply(scheduleTodo(id, { start: clampStart(start, duration), duration }, selectedDate));
    setSelectedBlock(id);
  };

  const quickSchedule = (t: Todo) => {
    const d = new Date();
    const base = selectedDate === getTodayDate() ? Math.ceil((d.getHours() * 60 + d.getMinutes()) / 30) * 30 : 9 * 60;
    placeTodo(t.id, base);
  };

  const minutesFromEvent = (e: React.MouseEvent | React.DragEvent) => {
    const rect = gridRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(snap(((e.clientY - rect.top) / HOUR_PX) * 60), 24 * 60 - SNAP));
  };

  const handleGridClick = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.slot) return;
    setSelectedBlock(null);
    setQuickAdd({ start: Math.floor(minutesFromEvent(e) / 30) * 30, text: "" });
  };

  const handleGridDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData("text/todo-id");
    if (id) placeTodo(id, minutesFromEvent(e));
  };

  const submitQuickAdd = () => {
    // Read from the ref and clear it first: Enter and the resulting blur must not both save.
    const q = quickRef.current;
    quickRef.current = null;
    if (q && q.text.trim()) {
      apply(addTodo(q.text.trim(), selectedDate, undefined, { start: q.start, duration: DEFAULT_DURATION }));
    }
    setQuickAdd(null);
  };

  const activeCount = todos.filter((t) => !t.completed).length;
  const completedCount = todos.length - activeCount;
  const percent = todos.length ? Math.round((completedCount / todos.length) * 100) : 0;

  const scheduled = useMemo(() => todos.filter((t) => t.start !== undefined), [todos]);
  const unscheduledActive = todos.filter((t) => t.start === undefined && !t.completed).length;
  const plannedMinutes = scheduled.reduce((n, t) => n + (t.duration ?? DEFAULT_DURATION), 0);
  const lanes = useMemo(() => layoutBlocks(scheduled), [scheduled]);
  const selected = scheduled.find((t) => t.id === selectedBlock) ?? null;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sortTodos(todos).filter(
      (t) =>
        (filter === "all" || (filter === "active" ? !t.completed : t.completed)) &&
        (!q || t.text.toLowerCase().includes(q))
    );
  }, [todos, filter, query]);

  const isToday = selectedDate === getTodayDate();

  return (
    <main className="min-h-screen bg-[#090910] text-white">
      {/* Header */}
      <header className="border-b border-white/5 bg-black/20 backdrop-blur-md sticky top-0 z-40">
        <nav className="mx-auto flex max-w-[1600px] items-center justify-between px-6 py-4">
          <Link href="/" className="font-bold tracking-[.2em] text-gold">
            REEL RADAR
          </Link>
          <div className="flex items-center gap-4">
            <Link
              href="/discover"
              className="text-white/70 transition hover:text-gold text-sm"
            >
              Discover
            </Link>
            <Link
              href="/search"
              className="text-white/70 transition hover:text-gold text-sm"
            >
              Search
            </Link>
            <Link
              href="/watchlist"
              className="text-white/70 transition hover:text-gold text-sm"
            >
              Watchlist
            </Link>
            <Link
              href="/watched"
              className="text-white/70 transition hover:text-gold text-sm"
            >
              Viewed
            </Link>
            <Link
              href="/analysis"
              className="text-white/70 transition hover:text-gold text-sm"
            >
              Analysis
            </Link>
            <Link
              href="/recommendations"
              className="text-white/70 transition hover:text-gold text-sm"
            >
              Recommendations
            </Link>
            <Link
              href="/similar"
              className="text-white/70 transition hover:text-gold text-sm"
            >
              Similar
            </Link>
          </div>
        </nav>
      </header>

      <div className="mx-auto max-w-[1600px] px-6 py-8">
        {/* Title & Day Navigation */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold">Daily Planner</h1>
            <p className="mt-1 text-white/60">
              {getRelativeDateLabel(selectedDate)} · {formatDate(selectedDate)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedDate(shiftDate(selectedDate, -1))}
              className="rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-sm hover:border-gold/40 hover:text-gold"
              aria-label="Previous day"
            >
              ‹
            </button>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
              className="rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-sm text-white [color-scheme:dark] focus:border-gold/50 focus:outline-none"
              aria-label="Pick a date"
            />
            <button
              onClick={() => setSelectedDate(shiftDate(selectedDate, 1))}
              className="rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-sm hover:border-gold/40 hover:text-gold"
              aria-label="Next day"
            >
              ›
            </button>
            {!isToday && (
              <button
                onClick={() => setSelectedDate(getTodayDate())}
                className="rounded-full bg-gold px-3 py-1.5 text-sm font-semibold text-black hover:brightness-110"
              >
                Today
              </button>
            )}
          </div>
        </div>

        {/* Day summary */}
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: "Done", value: `${completedCount}/${todos.length}`, sub: `${percent}% complete` },
            { label: "Still to do", value: String(activeCount), sub: `${unscheduledActive} not scheduled` },
            { label: "Planned time", value: plannedMinutes ? fmtDuration(plannedMinutes) : "–", sub: `${scheduled.length} time ${scheduled.length === 1 ? "block" : "blocks"}` },
            { label: "Unplanned in 24h", value: fmtDuration(Math.max(24 * 60 - plannedMinutes, 0)), sub: "drag tasks into the planner" },
          ].map((c) => (
            <div key={c.label} className="rounded-xl border border-white/10 bg-panel/60 px-4 py-3">
              <div className="text-xs uppercase tracking-wider text-white/45">{c.label}</div>
              <div className="mt-1 text-2xl font-semibold">{c.value}</div>
              <div className="text-xs text-white/45">{c.sub}</div>
            </div>
          ))}
        </div>
        {todos.length > 0 && (
          <div className="mb-6 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gold transition-all" style={{ width: `${percent}%` }} />
          </div>
        )}

        {/* Carry-over banner */}
        {pendingCount > 0 && (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gold/30 bg-gold/5 px-4 py-3 text-sm">
            <span className="text-white/80">
              {pendingCount} unfinished {pendingCount === 1 ? "task" : "tasks"} from earlier days
            </span>
            <button
              onClick={handleCarryOver}
              className="rounded-full bg-gold px-3 py-1 text-xs font-semibold text-black hover:brightness-110"
            >
              Bring to {getRelativeDateLabel(selectedDate)}
            </button>
          </div>
        )}

        <div className="grid items-start gap-6 lg:grid-cols-2 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          {/* ---------------- Tasks column ---------------- */}
          <section>
            <form onSubmit={handleAddTodo} className="mb-4 flex flex-wrap gap-3">
              <input
                ref={inputRef}
                type="text"
                value={newTodoText}
                onChange={(e) => setNewTodoText(e.target.value)}
                placeholder={isToday ? "What needs to be done today?" : `Add a task for ${getRelativeDateLabel(selectedDate)}`}
                className="min-w-[12rem] flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-white/40 transition focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/50"
                autoComplete="off"
              />
              <select
                value={newPriority}
                onChange={(e) => setNewPriority(e.target.value as Priority | "")}
                className="rounded-xl border border-white/10 bg-panel px-3 py-3 text-sm text-white focus:border-gold/50 focus:outline-none"
                aria-label="Priority"
              >
                <option value="">No priority</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
              <input
                type="time"
                value={newTime}
                onChange={(e) => setNewTime(e.target.value)}
                className="rounded-xl border border-white/10 bg-panel px-3 py-3 text-sm text-white [color-scheme:dark] focus:border-gold/50 focus:outline-none"
                aria-label="Start time (optional)"
                title="Start time (optional) - places it in the planner"
              />
              {newTime && (
                <select
                  value={newDuration}
                  onChange={(e) => setNewDuration(Number(e.target.value))}
                  className="rounded-xl border border-white/10 bg-panel px-3 py-3 text-sm text-white focus:border-gold/50 focus:outline-none"
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
                type="submit"
                disabled={!newTodoText.trim()}
                className="rounded-xl bg-gold px-6 py-3 font-semibold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Add
              </button>
            </form>

            {todos.length > 0 && (
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <div className="flex rounded-full border border-white/15 bg-white/5 p-0.5 text-xs">
                  {(["all", "active", "done"] as Filter[]).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={`rounded-full px-3 py-1 capitalize transition ${
                        filter === f ? "bg-gold font-semibold text-black" : "text-white/70 hover:text-white"
                      }`}
                    >
                      {f}
                      {f === "active" ? ` (${activeCount})` : f === "done" ? ` (${completedCount})` : ""}
                    </button>
                  ))}
                </div>
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search tasks"
                  className="min-w-0 flex-1 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-sm text-white placeholder-white/40 focus:border-gold/50 focus:outline-none"
                />
              </div>
            )}

            {todos.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-panel/60 p-12 text-center">
                <h3 className="text-lg font-semibold text-white/80">Nothing planned for {getRelativeDateLabel(selectedDate)}</h3>
                <p className="mt-1 text-white/50">Add a task above, or click a time slot in the planner.</p>
              </div>
            ) : visible.length === 0 ? (
              <p className="rounded-xl border border-white/10 bg-panel/60 p-6 text-center text-sm text-white/50">
                No tasks match this filter.
              </p>
            ) : (
              <div className="space-y-2">
                {visible.map((todo) => (
                  <TodoItem
                    key={todo.id}
                    todo={todo}
                    isEditing={editingId === todo.id}
                    editText={editText}
                    onEditStart={(t) => {
                      setEditingId(t.id);
                      setEditText(t.text);
                    }}
                    onEditSave={handleEditSave}
                    onEditCancel={() => {
                      setEditingId(null);
                      setEditText("");
                    }}
                    onEditTextChange={setEditText}
                    onToggle={(id) => apply(toggleTodo(id, selectedDate))}
                    onDelete={handleDelete}
                    onCyclePriority={(t) =>
                      apply(setTodoPriority(t.id, NEXT_PRIORITY[t.priority ?? "none"], selectedDate))
                    }
                    onSchedule={quickSchedule}
                    onShowBlock={(t) => {
                      setSelectedBlock(t.id);
                      if (scrollRef.current && t.start !== undefined)
                        scrollRef.current.scrollTo({ top: Math.max(0, (t.start / 60 - 1) * HOUR_PX), behavior: "smooth" });
                    }}
                  />
                ))}
              </div>
            )}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-panel/60 p-4 text-sm">
              <span className="text-white/60">
                {activeCount} {activeCount === 1 ? "item" : "items"} left
              </span>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {completedCount > 0 && (
                  <button
                    onClick={() => apply(clearCompletedTodos(selectedDate))}
                    className="text-red-400 transition hover:text-red-300"
                  >
                    Clear completed
                  </button>
                )}
                <button
                  onClick={() => exportTodos(selectedDate)}
                  className="rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-white/80 hover:border-gold/40 hover:text-gold"
                >
                  Export
                </button>
                <input type="file" accept=".json" onChange={handleImport} className="hidden" id="import-file" />
                <label
                  htmlFor="import-file"
                  className="cursor-pointer rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-white/80 hover:border-gold/40 hover:text-gold"
                >
                  Import
                </label>
                <button
                  onClick={handleSync}
                  disabled={syncStatus === "syncing"}
                  title="Replace this day with the cloud copy"
                  className={`rounded-full border px-3 py-1.5 transition ${
                    syncStatus === "synced"
                      ? "border-green-400/50 bg-green-500/10 text-green-300"
                      : syncStatus === "error"
                      ? "border-red-400/50 bg-red-500/10 text-red-300"
                      : "border-white/20 bg-white/5 text-white/80 hover:border-gold/40 hover:text-gold"
                  }`}
                >
                  {syncStatus === "syncing" ? "Syncing..." : syncStatus === "synced" ? "Synced" : syncStatus === "error" ? "Failed" : "Pull from cloud"}
                </button>
              </div>
            </div>

            {availableDates.filter((d) => d !== selectedDate).length > 0 && (
              <div className="mt-8">
                <h2 className="mb-3 text-lg font-semibold">Other days</h2>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {availableDates
                    .filter((d) => d !== selectedDate)
                    .slice(0, 6)
                    .map((date) => {
                      const day = loadTodos(date);
                      const done = day.filter((t) => t.completed).length;
                      return (
                        <button
                          key={date}
                          onClick={() => setSelectedDate(date)}
                          className="rounded-xl border border-white/10 bg-panel/60 p-4 text-left transition hover:-translate-y-0.5 hover:border-gold/40"
                        >
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <span className="font-medium">{getRelativeDateLabel(date)}</span>
                            <span className="text-xs text-white/50">{formatDate(date)}</span>
                          </div>
                          <div className="text-sm text-white/60">
                            {day.length === 0 ? "No todos" : `${done}/${day.length} done`}
                            {day.length > done && <span className="text-yellow-400"> · {day.length - done} pending</span>}
                          </div>
                        </button>
                      );
                    })}
                </div>
              </div>
            )}
          </section>

          {/* ---------------- Planner column ---------------- */}
          <section className="rounded-2xl border border-white/10 bg-panel/60 lg:sticky lg:top-20">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <h2 className="font-semibold">Schedule</h2>
              <p className="text-xs text-white/45">Click a slot to add · drag tasks here to time-block</p>
            </div>

            {selected && (
              <div className="flex flex-wrap items-center gap-3 border-b border-white/10 bg-white/[.03] px-4 py-3 text-sm">
                <span className="max-w-[16rem] truncate font-medium">{selected.text}</span>
                <input
                  type="time"
                  step={SNAP * 60}
                  value={toInputTime(selected.start!)}
                  onChange={(e) => {
                    const v = fromInputTime(e.target.value);
                    if (v !== null)
                      apply(scheduleTodo(selected.id, { start: clampStart(v, selected.duration ?? DEFAULT_DURATION) }, selectedDate));
                  }}
                  className="rounded-lg border border-white/10 bg-panel px-2 py-1 text-white [color-scheme:dark]"
                  aria-label="Start time"
                />
                <select
                  value={selected.duration ?? DEFAULT_DURATION}
                  onChange={(e) => {
                    const d = Number(e.target.value);
                    apply(scheduleTodo(selected.id, { start: clampStart(selected.start!, d), duration: d }, selectedDate));
                  }}
                  className="rounded-lg border border-white/10 bg-panel px-2 py-1 text-white"
                  aria-label="Duration"
                >
                  {Array.from(new Set([...DURATIONS, selected.duration ?? DEFAULT_DURATION]))
                    .sort((a, b) => a - b)
                    .map((d) => (
                      <option key={d} value={d}>
                        {fmtDuration(d)}
                      </option>
                    ))}
                </select>
                <button onClick={() => apply(toggleTodo(selected.id, selectedDate))} className="text-xs text-gold hover:brightness-110">
                  {selected.completed ? "Mark not done" : "Mark done"}
                </button>
                <button
                  onClick={() => {
                    apply(scheduleTodo(selected.id, undefined, selectedDate));
                    setSelectedBlock(null);
                  }}
                  className="text-xs text-white/60 hover:text-white"
                >
                  Remove from schedule
                </button>
                <button onClick={() => setSelectedBlock(null)} className="ml-auto text-xs text-white/40 hover:text-white" aria-label="Close">
                  ✕
                </button>
              </div>
            )}

            <div ref={scrollRef} className="relative max-h-[calc(100vh-17rem)] min-h-[24rem] overflow-y-auto">
              <div
                ref={gridRef}
                className="relative ml-14 mr-3"
                style={{ height: 24 * HOUR_PX }}
                onClick={handleGridClick}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(minutesFromEvent(e));
                }}
                onDragLeave={() => setDragOver(null)}
                onDrop={handleGridDrop}
              >
                {/* hour lines */}
                {Array.from({ length: 24 }, (_, h) => (
                  <div
                    key={h}
                    data-slot="1"
                    className="absolute inset-x-0 border-t border-white/10"
                    style={{ top: h * HOUR_PX, height: HOUR_PX }}
                  >
                    <span className="pointer-events-none absolute -left-14 -top-2 w-12 pr-2 text-right text-[11px] text-white/40">
                      {h === 0 ? "" : fmtTime(h * 60)}
                    </span>
                    <div data-slot="1" className="absolute inset-x-0 top-1/2 border-t border-dashed border-white/5" />
                  </div>
                ))}

                {/* drop indicator */}
                {dragOver !== null && (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-gold"
                    style={{ top: (dragOver / 60) * HOUR_PX }}
                  >
                    <span className="absolute -top-2.5 right-0 rounded bg-gold px-1.5 text-[10px] font-semibold text-black">
                      {fmtTime(dragOver)}
                    </span>
                  </div>
                )}

                {/* now marker */}
                {isToday && now !== null && (
                  <div className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-red-500" style={{ top: (now / 60) * HOUR_PX }}>
                    <span className="absolute -left-1.5 -top-[5px] h-2.5 w-2.5 rounded-full bg-red-500" />
                  </div>
                )}

                {/* blocks */}
                {scheduled.map((t) => {
                  const duration = t.duration ?? DEFAULT_DURATION;
                  const { lane, lanes: count } = lanes.get(t.id) ?? { lane: 0, lanes: 1 };
                  const style = t.priority ? PRIORITY_STYLE[t.priority].block : NO_PRIORITY_BLOCK;
                  return (
                    <div
                      key={t.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/todo-id", t.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => setDragOver(null)}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedBlock(t.id);
                        setQuickAdd(null);
                      }}
                      className={`absolute z-10 cursor-grab overflow-hidden rounded-lg border px-2 py-1 text-xs transition active:cursor-grabbing ${style} ${
                        selectedBlock === t.id ? "ring-2 ring-gold" : ""
                      } ${t.completed ? "opacity-50" : ""}`}
                      style={{
                        top: (t.start! / 60) * HOUR_PX + 1,
                        height: Math.max((duration / 60) * HOUR_PX - 2, 22),
                        left: `${(lane / count) * 100}%`,
                        width: `calc(${100 / count}% - 3px)`,
                      }}
                      title={`${t.text} · ${fmtTime(t.start!)}–${fmtTime(t.start! + duration)}`}
                    >
                      <div className="flex items-start gap-1.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            apply(toggleTodo(t.id, selectedDate));
                          }}
                          className={`mt-px flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border ${
                            t.completed ? "border-gold bg-gold text-black" : "border-white/50"
                          }`}
                          aria-label={t.completed ? "Mark as incomplete" : "Mark as complete"}
                        >
                          {t.completed && <span className="text-[9px] leading-none">✓</span>}
                        </button>
                        <span className={`min-w-0 flex-1 truncate font-medium ${t.completed ? "line-through" : ""}`}>{t.text}</span>
                      </div>
                      {duration >= 45 && (
                        <div className="mt-0.5 text-[10px] text-white/55">
                          {fmtTime(t.start!)} – {fmtTime(t.start! + duration)}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* quick add */}
                {quickAdd && (
                  <div
                    className="absolute inset-x-0 z-30 rounded-lg border border-gold bg-[#14141f] p-1.5 shadow-2xl"
                    style={{ top: (quickAdd.start / 60) * HOUR_PX + 2 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      autoFocus
                      value={quickAdd.text}
                      onChange={(e) => setQuickAdd({ ...quickAdd, text: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") submitQuickAdd();
                        else if (e.key === "Escape") setQuickAdd(null);
                      }}
                      onBlur={submitQuickAdd}
                      placeholder={`${fmtTime(quickAdd.start)} - what's planned?`}
                      className="w-full bg-transparent px-1.5 py-1 text-sm text-white placeholder-white/40 focus:outline-none"
                    />
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* Toasts */}
      <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
        {deleted && (
          <div className="flex items-center gap-4 rounded-full border border-white/15 bg-panel px-4 py-2 text-sm shadow-2xl">
            <span className="text-white/80">Task deleted</span>
            <button onClick={handleUndo} className="font-semibold text-gold hover:brightness-110">
              Undo
            </button>
          </div>
        )}
        {message && (
          <div className="rounded-full border border-white/15 bg-panel px-4 py-2 text-sm text-white/80 shadow-2xl">{message}</div>
        )}
      </div>
    </main>
  );
}

function TodoItem({
  todo,
  isEditing,
  editText,
  onEditStart,
  onEditSave,
  onEditCancel,
  onEditTextChange,
  onToggle,
  onDelete,
  onCyclePriority,
  onSchedule,
  onShowBlock,
}: {
  todo: Todo;
  isEditing: boolean;
  editText: string;
  onEditStart: (todo: Todo) => void;
  onEditSave: (id: string) => void;
  onEditCancel: () => void;
  onEditTextChange: (text: string) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onCyclePriority: (todo: Todo) => void;
  onSchedule: (todo: Todo) => void;
  onShowBlock: (todo: Todo) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  if (isEditing) {
    return (
      <div className="rounded-xl border border-gold/30 bg-gold/5 p-3">
        <input
          ref={inputRef}
          type="text"
          value={editText}
          onChange={(e) => onEditTextChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onEditSave(todo.id);
            else if (e.key === "Escape") onEditCancel();
          }}
          onBlur={() => onEditSave(todo.id)}
          className="w-full bg-transparent px-2 py-1.5 text-white focus:outline-none"
          autoComplete="off"
        />
      </div>
    );
  }

  const pri = todo.priority ? PRIORITY_STYLE[todo.priority] : null;
  const duration = todo.duration ?? DEFAULT_DURATION;

  return (
    <div
      draggable={!todo.completed}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/todo-id", todo.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className="rounded-xl border border-white/10 bg-panel/60 p-3 transition hover:border-white/20"
    >
      <div className="flex items-start gap-3">
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
            {todo.carriedFrom && (
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-white/60">from {getRelativeDateLabel(todo.carriedFrom)}</span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => onCyclePriority(todo)}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] text-white/50 transition hover:bg-white/10 hover:text-white"
            aria-label="Change priority"
            title="Click to change priority"
          >
            <span className={`h-2.5 w-2.5 rounded-full ${pri ? pri.dot : "border border-white/30"}`} />
            {pri ? pri.label : "Priority"}
          </button>
          <button
            onClick={() => onEditStart(todo)}
            className="rounded-lg p-1.5 text-white/50 transition hover:bg-white/10 hover:text-white"
            aria-label="Edit todo"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            onClick={() => onDelete(todo.id)}
            className="rounded-lg p-1.5 text-white/50 transition hover:bg-red-500/10 hover:text-red-400"
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
