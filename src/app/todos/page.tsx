"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import WeekView from "./WeekView";
import {
  HOUR_PX,
  SNAP,
  PRIORITY_STYLE,
  TAG_COLORS,
  DAY_LETTERS,
  DAY_NAMES,
  TimeBlock,
  useBlockResize,
  formatDate,
  formatShortDate,
  getRelativeDateLabel,
  fmtTime,
  fmtDuration,
  snap,
  clampStart,
  layoutBlocks,
} from "./planner";
import { weekStart } from "@/lib/plannerStats";
import {
  loadTodos,
  addTodo,
  toggleTodo,
  deleteTodo,
  restoreTodo,
  setTodoPriority,
  scheduleTodo,
  updateTodo,
  clearCompletedTodos,
  getAllStoredDates,
  getUnfinishedFromYesterday,
  carryOverFromYesterday,
  loadTodosWithDaily,
  makeTodoDaily,
  stopTodoDaily,
  setTodoRepeatDays,
  loadDailyTasks,
  getDailyStreak,
  addSubtask,
  toggleSubtask,
  deleteSubtask,
  dueReminders,
  setTodoTag,
  getFocusSession,
  startFocus,
  stopFocus,
  syncDailyTasksWithServer,
  getTodayDate,
  shiftDate,
  exportTodos,
  importTodos,
  syncTodosWithServer,
  DEFAULT_DURATION,
  ALL_DAYS,
  TAGS,
  type DailyTask,
  type FocusSession,
  type TagId,
  type Priority,
  type Todo,
} from "@/lib/todos";

type Filter = "all" | "active" | "done";
type MobileView = "tasks" | "schedule";
type View = "day" | "week";

const TAG_LABEL = Object.fromEntries(TAGS.map((t) => [t.id, t.label])) as Record<TagId, string>;

// 5:07 / 1:02:30
function fmtClock(totalSeconds: number): string {
  const s = Math.floor(Math.abs(totalSeconds));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60));
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm.padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
}

const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240];

const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
const REMINDER_KEY = "reel-radar-reminder-lead"; // minutes before a block starts; unset = off
const REMINDER_LEADS = [0, 5, 10, 15];

function repeatLabel(days?: number[]): string {
  if (!days) return "Daily";
  if (days.join() === "1,2,3,4,5") return "Weekdays";
  if (days.join() === "0,6") return "Weekends";
  return days.map((d) => DAY_NAMES[d]).join(", ");
}

function loadReminderLead(): number | null {
  try {
    const v = localStorage.getItem(REMINDER_KEY);
    return v === null ? null : Number(v);
  } catch {
    return null;
  }
}

function saveReminderLead(lead: number | null): void {
  try {
    if (lead === null) localStorage.removeItem(REMINDER_KEY);
    else localStorage.setItem(REMINDER_KEY, String(lead));
  } catch {
    // Storage unavailable: the setting just won't persist.
  }
}

const NEXT_PRIORITY: Record<string, Priority | undefined> = {
  none: "high",
  high: "medium",
  medium: "low",
  low: undefined,
};

const toInputTime = (mins: number): string =>
  `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
const fromInputTime = (v: string): number | null => {
  const m = /^(\d{2}):(\d{2})$/.exec(v);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

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

export default function TodosPage() {
  const [selectedDate, setSelectedDate] = useState<string>(() => getTodayDate());
  const [todos, setTodos] = useState<Todo[]>([]);
  const [newTodoText, setNewTodoText] = useState("");
  const [newPriority, setNewPriority] = useState<Priority | "">("");
  const [newTime, setNewTime] = useState("");
  const [newDuration, setNewDuration] = useState(DEFAULT_DURATION);
  const [newDaily, setNewDaily] = useState(false);
  const [newRepeatDays, setNewRepeatDays] = useState<number[]>(ALL_DAYS);
  const [newTag, setNewTag] = useState<TagId | "">("");
  const [tagFilter, setTagFilter] = useState<TagId | "all">("all");
  const [view, setView] = useState<View>("day");
  const [focus, setFocus] = useState<FocusSession | null>(null);
  const [clockNow, setClockNow] = useState(0);
  const [dailyTasks, setDailyTasks] = useState<DailyTask[]>([]);
  const [reminderLead, setReminderLead] = useState<number | null>(null);
  const [newNote, setNewNote] = useState("");
  const [showNewNote, setShowNewNote] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editNote, setEditNote] = useState("");
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [yesterdayTodos, setYesterdayTodos] = useState<Todo[]>([]);
  const [showYesterday, setShowYesterday] = useState(false);
  const [mobileView, setMobileView] = useState<MobileView>("tasks");
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
  const firedReminders = useRef(new Set<string>());
  const focusAlerted = useRef<string | null>(null);
  const resize = useBlockResize((t, date, duration) => apply(scheduleTodo(t.id, { start: t.start!, duration }, date)));

  const refreshMeta = (date = selectedDate) => {
    setAvailableDates(getAllStoredDates());
    setYesterdayTodos(getUnfinishedFromYesterday(date));
    setDailyTasks(loadDailyTasks());
  };

  useEffect(() => {
    let cancelled = false;
    setDeleted(null);
    setSelectedBlock(null);
    setQuickAdd(null);
    setShowYesterday(false);
    const local = loadTodos(selectedDate);
    // Check the server before adding daily copies, or an empty day would never be pulled.
    (local.length === 0 ? syncTodosWithServer(selectedDate) : Promise.resolve(local)).then(() => {
      if (cancelled) return;
      setTodos(loadTodosWithDaily(selectedDate));
      refreshMeta(selectedDate);
    });
    setTodos(local);
    refreshMeta(selectedDate);
    return () => {
      cancelled = true;
    };
    // view: the week view may have changed this day.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, view]);

  // A new device has no daily tasks locally; pull them once.
  useEffect(() => {
    syncDailyTasksWithServer().then((tasks) => {
      if (tasks.length > 0) setTodos(loadTodosWithDaily(selectedDate));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
    setReminderLead(loadReminderLead());
    setFocus(getFocusSession());
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
    // Re-run on mobile view switch: a hidden planner can't be scrolled.
  }, [selectedDate, mobileView, view]);

  // Focus timer clock.
  useEffect(() => {
    if (!focus) return;
    setClockNow(Date.now());
    const id = setInterval(() => setClockNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [focus]);

  // Notify about today's blocks as they come up (only while this page is open).
  useEffect(() => {
    if (reminderLead === null || now === null) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const today = getTodayDate();
    for (const t of dueReminders(loadTodos(today), now, reminderLead)) {
      const key = `${today}:${t.id}:${t.start}`;
      if (firedReminders.current.has(key)) continue;
      firedReminders.current.add(key);
      const mins = t.start! - now;
      const when = `${mins > 0 ? `In ${mins} min` : "Starting now"} · ${fmtTime(t.start!)}–${fmtTime(t.start! + (t.duration ?? DEFAULT_DURATION))}`;
      try {
        new Notification(t.text, { body: t.note ? `${when}\n${t.note}` : when, tag: key });
      } catch {
        // Some mobile browsers only allow notifications from a service worker.
      }
    }
  }, [now, reminderLead]);

  const handleReminderChange = async (value: string) => {
    if (value === "") {
      setReminderLead(null);
      saveReminderLead(null);
      return;
    }
    if (typeof Notification === "undefined") {
      flash("This browser can't show notifications");
      return;
    }
    const permission =
      Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    if (permission !== "granted") {
      flash("Notifications are blocked for this site");
      return;
    }
    setReminderLead(Number(value));
    saveReminderLead(Number(value));
    flash("Reminders on while this page is open");
  };

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
        start !== null ? { start, duration: newDuration } : undefined,
        newDaily ? newRepeatDays : false,
        newNote,
        newTag || undefined
      )
    );
    setNewRepeatDays(ALL_DAYS);
    setNewTodoText("");
    setNewNote("");
    setShowNewNote(false);
    setNewDaily(false);
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
    else apply(updateTodo(id, { text: editText.trim(), note: editNote }, selectedDate));
    setEditingId(null);
    setEditText("");
    setEditNote("");
  };

  const handleCarryOver = (ids?: string[]) => {
    const count = ids ? ids.length : yesterdayTodos.length;
    apply(carryOverFromYesterday(selectedDate, ids));
    flash(`Added ${count} ${count === 1 ? "task" : "tasks"} from ${getRelativeDateLabel(shiftDate(selectedDate, -1))}`);
  };

  const handleToggleDaily = (t: Todo) => {
    if (t.dailyId) {
      apply(stopTodoDaily(t.id, selectedDate));
      flash("No longer repeats daily");
    } else {
      apply(makeTodoDaily(t.id, selectedDate));
      flash("Repeats every day from now on");
    }
  };

  const handleStartFocus = (t: Todo) => {
    setFocus(startFocus(t, selectedDate));
    focusAlerted.current = null;
    apply(loadTodos(selectedDate)); // a session stopped by this one has just been recorded
  };

  const handleStopFocus = (markDone: boolean) => {
    const session = focus;
    if (!session) return;
    const minutes = Math.round((Date.now() - session.startedAt) / 60000);
    const updated = stopFocus() ?? [];
    setFocus(null);
    if (markDone && updated.some((t) => t.id === session.todoId && !t.completed)) toggleTodo(session.todoId, session.date);
    apply(loadTodos(selectedDate));
    flash(minutes > 0 ? `Recorded ${fmtDuration(minutes)} on "${session.text}"` : "Under a minute, so nothing was recorded");
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
    flash(`Scheduled at ${fmtTime(clampStart(base, t.duration ?? DEFAULT_DURATION))}`);
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

  const repeatDaysById = useMemo(() => new Map(dailyTasks.map((d) => [d.id, d.days])), [dailyTasks]);
  const streaks = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of todos) if (t.dailyId) m.set(t.dailyId, getDailyStreak(t.dailyId, selectedDate));
    return m;
    // dailyTasks: clearing a finished copy changes a streak's doneDates without changing todos' completion.
  }, [todos, dailyTasks, selectedDate]);

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
        (tagFilter === "all" || t.tag === tagFilter) &&
        (!q || t.text.toLowerCase().includes(q) || t.note?.toLowerCase().includes(q))
    );
  }, [todos, filter, query, tagFilter]);

  const usedTags = TAGS.map((t) => t.id).filter((id) => id === tagFilter || todos.some((t) => t.tag === id));

  const otherDays = availableDates.filter((d) => d !== selectedDate && loadTodos(d).length > 0);
  const isToday = selectedDate === getTodayDate();
  const prevLabel = getRelativeDateLabel(shiftDate(selectedDate, -1));

  return (
    <main className="min-h-screen bg-[#090910] text-white">
      {/* Header */}
      <header className="border-b border-white/5 bg-black/20 backdrop-blur-md sticky top-0 z-40">
        <nav className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-3 sm:px-6 sm:py-4">
          <Link href="/" className="shrink-0 font-bold tracking-[.2em] text-gold">
            REEL RADAR
          </Link>
          <div className="flex min-w-0 items-center gap-4 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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

      <div className="mx-auto max-w-[1600px] px-4 pb-24 pt-5 sm:px-6 sm:py-8">
        {/* Title & Day Navigation */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="text-2xl font-bold sm:text-3xl">Daily Planner</h1>
              <Link
                href="/todos/stats"
                className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-xs text-white/80 hover:border-gold/40 hover:text-gold"
              >
                Stats →
              </Link>
            </div>
            <p className="mt-1 text-white/60">
              {view === "week"
                ? `Week of ${formatShortDate(weekStart(selectedDate))} – ${formatShortDate(shiftDate(weekStart(selectedDate), 6))}`
                : `${getRelativeDateLabel(selectedDate)} · ${formatDate(selectedDate)}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-full border border-white/15 bg-white/5 p-0.5 text-sm">
              {(["day", "week"] as View[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  aria-pressed={view === v}
                  className={`rounded-full px-3 py-1 capitalize transition ${
                    view === v ? "bg-gold font-semibold text-black" : "text-white/70 hover:text-white"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
            <button
              onClick={() => setSelectedDate(shiftDate(selectedDate, view === "week" ? -7 : -1))}
              className="rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-sm hover:border-gold/40 hover:text-gold"
              aria-label={view === "week" ? "Previous week" : "Previous day"}
            >
              ‹
            </button>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
              className="min-w-0 flex-1 rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-sm text-white [color-scheme:dark] focus:border-gold/50 focus:outline-none sm:flex-none"
              aria-label="Pick a date"
            />
            <button
              onClick={() => setSelectedDate(shiftDate(selectedDate, view === "week" ? 7 : 1))}
              className="rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-sm hover:border-gold/40 hover:text-gold"
              aria-label={view === "week" ? "Next week" : "Next day"}
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

        {view === "week" ? (
          <WeekView
            anchorDate={selectedDate}
            now={now}
            flash={flash}
            onOpenDay={(d) => {
              setSelectedDate(d);
              setView("day");
            }}
          />
        ) : (
        <>
        {/* Day summary */}
        <div className="mb-5 grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
          {[
            { label: "Done", value: `${completedCount}/${todos.length}`, sub: `${percent}% complete` },
            { label: "Still to do", value: String(activeCount), sub: `${unscheduledActive} not scheduled` },
            { label: "Planned time", value: plannedMinutes ? fmtDuration(plannedMinutes) : "–", sub: `${scheduled.length} time ${scheduled.length === 1 ? "block" : "blocks"}` },
            { label: "Unplanned in 24h", value: fmtDuration(Math.max(24 * 60 - plannedMinutes, 0)), sub: "drag tasks into the planner" },
          ].map((c) => (
            <div key={c.label} className="rounded-xl border border-white/10 bg-panel/60 px-3 py-2.5 sm:px-4 sm:py-3">
              <div className="truncate text-[11px] uppercase tracking-wider text-white/45 sm:text-xs">{c.label}</div>
              <div className="mt-1 text-xl font-semibold sm:text-2xl">{c.value}</div>
              <div className="truncate text-[11px] text-white/45 sm:text-xs">{c.sub}</div>
            </div>
          ))}
        </div>
        {todos.length > 0 && (
          <div className="mb-6 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gold transition-all" style={{ width: `${percent}%` }} />
          </div>
        )}

        {/* Carry-over from the previous day */}
        {yesterdayTodos.length > 0 && (
          <div className="mb-5 rounded-xl border border-gold/30 bg-gold/5 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <button
                onClick={() => setShowYesterday((v) => !v)}
                className="flex items-center gap-2 text-left text-white/80 hover:text-white"
                aria-expanded={showYesterday}
              >
                <span className={`text-gold transition ${showYesterday ? "rotate-90" : ""}`}>›</span>
                {yesterdayTodos.length} unfinished {yesterdayTodos.length === 1 ? "task" : "tasks"} from {prevLabel}
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowYesterday((v) => !v)}
                  className="rounded-full border border-gold/40 px-3 py-1 text-xs text-gold hover:bg-gold/10"
                >
                  {showYesterday ? "Hide" : "Choose"}
                </button>
                <button
                  onClick={() => handleCarryOver()}
                  className="rounded-full bg-gold px-3 py-1 text-xs font-semibold text-black hover:brightness-110"
                >
                  Add all
                </button>
              </div>
            </div>
            {showYesterday && (
              <ul className="divide-y divide-white/5 border-t border-gold/20">
                {sortTodos(yesterdayTodos).map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-4 py-2">
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${t.priority ? PRIORITY_STYLE[t.priority].dot : "border border-white/30"}`}
                    />
                    <span className="min-w-0 flex-1 break-words text-white/80">{t.text}</span>
                    <button
                      onClick={() => handleCarryOver([t.id])}
                      className="shrink-0 rounded-full border border-white/20 px-3 py-1 text-xs text-white/80 hover:border-gold/50 hover:text-gold"
                    >
                      + Add
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Mobile: one column at a time */}
        <div className="mb-4 flex rounded-full border border-white/15 bg-white/5 p-0.5 text-sm lg:hidden">
          {(["tasks", "schedule"] as MobileView[]).map((v) => (
            <button
              key={v}
              onClick={() => setMobileView(v)}
              className={`flex-1 rounded-full px-3 py-1.5 capitalize transition ${
                mobileView === v ? "bg-gold font-semibold text-black" : "text-white/70"
              }`}
            >
              {v}
              {v === "tasks" ? ` (${activeCount})` : scheduled.length ? ` (${scheduled.length})` : ""}
            </button>
          ))}
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-2 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          {/* ---------------- Tasks column ---------------- */}
          <section className={mobileView === "tasks" ? "" : "hidden lg:block"}>
            <form onSubmit={handleAddTodo} className="mb-4 flex flex-wrap gap-2 sm:gap-3">
              <input
                ref={inputRef}
                type="text"
                value={newTodoText}
                onChange={(e) => setNewTodoText(e.target.value)}
                placeholder={isToday ? "What needs to be done today?" : `Add a task for ${getRelativeDateLabel(selectedDate)}`}
                className="min-w-0 basis-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white sm:min-w-[12rem] sm:flex-1 sm:basis-auto placeholder-white/40 transition focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/50"
                autoComplete="off"
              />
              <select
                value={newPriority}
                onChange={(e) => setNewPriority(e.target.value as Priority | "")}
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-panel px-3 py-3 text-sm text-white focus:border-gold/50 focus:outline-none sm:flex-none"
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
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-panel px-3 py-3 text-sm text-white focus:border-gold/50 focus:outline-none sm:flex-none"
                aria-label="Tag"
              >
                <option value="">No tag</option>
                {TAGS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
              <input
                type="time"
                value={newTime}
                onChange={(e) => setNewTime(e.target.value)}
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-panel px-3 py-3 text-sm text-white [color-scheme:dark] focus:border-gold/50 focus:outline-none sm:flex-none"
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
                type="button"
                onClick={() => setShowNewNote((v) => !v)}
                aria-pressed={showNewNote}
                title="Add a description"
                className={`rounded-xl border px-3 py-3 text-sm transition ${
                  showNewNote || newNote.trim()
                    ? "border-gold/60 bg-gold/15 text-gold"
                    : "border-white/10 bg-panel text-white/60 hover:text-white"
                }`}
              >
                ✎ Note
              </button>
              <button
                type="button"
                onClick={() => setNewDaily((v) => !v)}
                aria-pressed={newDaily}
                title="Repeat this task every day"
                className={`rounded-xl border px-3 py-3 text-sm transition ${
                  newDaily
                    ? "border-gold/60 bg-gold/15 text-gold"
                    : "border-white/10 bg-panel text-white/60 hover:text-white"
                }`}
              >
                ↻ {newDaily ? repeatLabel(newRepeatDays.length === 7 ? undefined : newRepeatDays) : "Daily"}
              </button>
              <button
                type="submit"
                disabled={!newTodoText.trim()}
                className="flex-1 rounded-xl bg-gold px-6 py-3 sm:flex-none font-semibold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Add
              </button>
              {newDaily && (
                <div className="flex basis-full items-center gap-3 text-xs text-white/55">
                  Repeats on
                  <DayPicker value={newRepeatDays} onChange={setNewRepeatDays} />
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
                  className="basis-full resize-y rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-white/40 transition focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/50"
                />
              )}
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
                {usedTags.length > 0 && (
                  <div className="flex basis-full flex-wrap gap-1.5 text-xs">
                    {(["all", ...usedTags] as (TagId | "all")[]).map((tag) => (
                      <button
                        key={tag}
                        onClick={() => setTagFilter(tag)}
                        aria-pressed={tagFilter === tag}
                        className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition ${
                          tagFilter === tag
                            ? "border-gold/60 bg-gold/15 text-white"
                            : "border-white/15 text-white/60 hover:text-white"
                        }`}
                      >
                        {tag !== "all" && <span className="h-2 w-2 rounded-full" style={{ background: TAG_COLORS[tag] }} />}
                        {tag === "all" ? "All tags" : TAG_LABEL[tag]}
                      </button>
                    ))}
                  </div>
                )}
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
                    editNote={editNote}
                    onEditStart={(t) => {
                      setEditingId(t.id);
                      setEditText(t.text);
                      setEditNote(t.note ?? "");
                    }}
                    onEditSave={handleEditSave}
                    onEditCancel={() => {
                      setEditingId(null);
                      setEditText("");
                      setEditNote("");
                    }}
                    onEditTextChange={setEditText}
                    onEditNoteChange={setEditNote}
                    onToggle={(id) => apply(toggleTodo(id, selectedDate))}
                    onDelete={handleDelete}
                    onCyclePriority={(t) =>
                      apply(setTodoPriority(t.id, NEXT_PRIORITY[t.priority ?? "none"], selectedDate))
                    }
                    onSchedule={quickSchedule}
                    onToggleDaily={handleToggleDaily}
                    repeatDays={todo.dailyId ? repeatDaysById.get(todo.dailyId) : undefined}
                    streak={todo.dailyId ? streaks.get(todo.dailyId) ?? 0 : 0}
                    onSetRepeatDays={(t, days) => {
                      apply(setTodoRepeatDays(t.id, days.length === 7 ? undefined : days, selectedDate));
                    }}
                    onAddSubtask={(t, text) => apply(addSubtask(t.id, text, selectedDate))}
                    onToggleSubtask={(t, subId) => apply(toggleSubtask(t.id, subId, selectedDate))}
                    onDeleteSubtask={(t, subId) => apply(deleteSubtask(t.id, subId, selectedDate))}
                    onSetTag={(t, tag) => apply(setTodoTag(t.id, tag, selectedDate))}
                    focusing={focus?.todoId === todo.id}
                    onStartFocus={handleStartFocus}
                    onShowBlock={(t) => {
                      setSelectedBlock(t.id);
                      setMobileView("schedule");
                      // After the planner is shown (mobile) and its default scroll has run.
                      setTimeout(() => {
                        if (scrollRef.current && t.start !== undefined)
                          scrollRef.current.scrollTo({ top: Math.max(0, (t.start / 60 - 1) * HOUR_PX), behavior: "smooth" });
                      }, 0);
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

            {otherDays.length > 0 && (
              <div className="mt-8">
                <h2 className="mb-3 text-lg font-semibold">Other days</h2>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {otherDays
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
          <section
            className={`rounded-2xl border border-white/10 bg-panel/60 lg:sticky lg:top-20 ${
              mobileView === "schedule" ? "" : "hidden lg:block"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-white/10 px-4 py-3">
              <h2 className="font-semibold">Schedule</h2>
              <p className="hidden text-xs text-white/45 xl:block">Click a slot to add · drag tasks here to time-block</p>
              <p className="order-last basis-full text-xs text-white/45 sm:hidden">Tap a slot to add · tap a block to edit</p>
              <select
                value={reminderLead ?? ""}
                onChange={(e) => handleReminderChange(e.target.value)}
                className="rounded-lg border border-white/10 bg-panel px-2 py-1 text-xs text-white focus:border-gold/50 focus:outline-none"
                aria-label="Reminders"
                title="Browser notification before each block today (while this page is open)"
              >
                <option value="">🔕 No reminders</option>
                {REMINDER_LEADS.map((m) => (
                  <option key={m} value={m}>
                    🔔 {m === 0 ? "At start" : `${m} min before`}
                  </option>
                ))}
              </select>
            </div>

            {selected && (
              <div className="flex flex-wrap items-center gap-3 border-b border-white/10 bg-white/[.03] px-4 py-3 text-sm">
                <span className="w-full truncate font-medium sm:w-auto sm:max-w-[16rem]">{selected.text}</span>
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
                {!selected.completed && focus?.todoId !== selected.id && (
                  <button onClick={() => handleStartFocus(selected)} className="text-xs text-gold hover:brightness-110">
                    ▶ Focus
                  </button>
                )}
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
                {selected.note && (
                  <p className="w-full whitespace-pre-wrap break-words text-xs text-white/55">{selected.note}</p>
                )}
              </div>
            )}

            <div ref={scrollRef} className="relative h-[65vh] overflow-y-auto lg:h-auto lg:max-h-[calc(100vh-17rem)] lg:min-h-[24rem]">
              <div
                ref={gridRef}
                className="relative ml-12 mr-2 sm:ml-14 sm:mr-3"
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
                  const { lane, lanes: count } = lanes.get(t.id) ?? { lane: 0, lanes: 1 };
                  return (
                    <TimeBlock
                      key={t.id}
                      todo={t}
                      date={selectedDate}
                      lane={lane}
                      lanes={count}
                      selected={selectedBlock === t.id}
                      resize={resize}
                      onSelect={(b) => {
                        setSelectedBlock(b.id);
                        setQuickAdd(null);
                      }}
                      onToggle={(b) => apply(toggleTodo(b.id, selectedDate))}
                    />
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
        </>
        )}
      </div>

      {/* Toasts */}
      {focus && <FocusBar session={focus} nowMs={clockNow} selectedDate={selectedDate} onStop={handleStopFocus} alerted={focusAlerted} />}
      <div className={`fixed left-1/2 ${focus ? "bottom-[calc(6rem+env(safe-area-inset-bottom))]" : "bottom-[calc(1.5rem+env(safe-area-inset-bottom))]"} z-50 flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col items-center gap-2`}>
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
  repeatDays,
  streak,
  onSetRepeatDays,
  onAddSubtask,
  onToggleSubtask,
  onDeleteSubtask,
  onSetTag,
  focusing,
  onStartFocus,
}: {
  todo: Todo;
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
  repeatDays?: number[];
  streak: number;
  onSetRepeatDays: (todo: Todo, days: number[]) => void;
  onAddSubtask: (todo: Todo, text: string) => void;
  onToggleSubtask: (todo: Todo, subtaskId: string) => void;
  onDeleteSubtask: (todo: Todo, subtaskId: string) => void;
  onSetTag: (todo: Todo, tag: TagId | undefined) => void;
  focusing: boolean;
  onStartFocus: (todo: Todo) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [showRepeat, setShowRepeat] = useState(false);
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

  return (
    <div
      draggable={!todo.completed}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/todo-id", todo.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className="rounded-xl border border-white/10 bg-panel/60 p-3 pr-2 transition hover:border-white/20 sm:pr-3"
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
              {todo.tag && <span className="h-2 w-2 rounded-full" style={{ background: TAG_COLORS[todo.tag] }} />}
              {todo.tag ? TAG_LABEL[todo.tag] : "+ Tag"}
              <select
                value={todo.tag ?? ""}
                onChange={(e) => onSetTag(todo, (e.target.value || undefined) as TagId | undefined)}
                className="absolute inset-0 cursor-pointer opacity-0"
                aria-label="Tag"
              >
                <option value="">No tag</option>
                {TAGS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
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
                title="Choose which days it repeats"
              >
                ↻ {repeatLabel(repeatDays)}
              </button>
            )}
            {streak >= 2 && (
              <span className="rounded-full bg-orange-500/15 px-2 py-0.5 text-orange-300" title={`Done ${streak} times in a row`}>
                🔥 {streak}
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
          {showRepeat && todo.dailyId && (
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-white/55">
              Repeats on
              <DayPicker value={repeatDays ?? ALL_DAYS} onChange={(days) => onSetRepeatDays(todo, days)} />
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

// Weekday toggles; at least one day stays selected.
function DayPicker({ value, onChange }: { value: number[]; onChange: (days: number[]) => void }) {
  return (
    <div className="flex gap-1">
      {DAY_LETTERS.map((letter, d) => {
        const on = value.includes(d);
        return (
          <button
            key={d}
            type="button"
            onClick={() => {
              if (on && value.length === 1) return;
              onChange(on ? value.filter((x) => x !== d) : [...value, d].sort((a, b) => a - b));
            }}
            aria-pressed={on}
            aria-label={DAY_NAMES[d]}
            title={DAY_NAMES[d]}
            className={`h-7 w-7 rounded-full text-[11px] font-semibold transition ${
              on ? "bg-gold text-black" : "border border-white/20 text-white/55 hover:border-gold/50 hover:text-gold"
            }`}
          >
            {letter}
          </button>
        );
      })}
    </div>
  );
}

function FocusBar({
  session,
  nowMs,
  selectedDate,
  onStop,
  alerted,
}: {
  session: FocusSession;
  nowMs: number;
  selectedDate: string;
  onStop: (markDone: boolean) => void;
  alerted: React.MutableRefObject<string | null>;
}) {
  const todo = loadTodos(session.date).find((t) => t.id === session.todoId);
  const elapsed = Math.max(0, (nowMs - session.startedAt) / 1000);
  const spentBefore = (todo?.spent ?? 0) * 60;
  const planned = todo?.start !== undefined ? (todo.duration ?? DEFAULT_DURATION) * 60 : null;
  const remaining = planned === null ? null : planned - spentBefore - elapsed;
  const over = remaining !== null && remaining < 0;

  // Tell the user once when the planned time runs out.
  useEffect(() => {
    if (!over || alerted.current === session.todoId + session.startedAt) return;
    alerted.current = session.todoId + session.startedAt;
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        new Notification(`Time's up: ${session.text}`, { body: "Your planned time for this block is over." });
      } catch {
        // Some mobile browsers only allow notifications from a service worker.
      }
    }
  }, [over, session, alerted]);

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-gold/30 bg-panel/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:px-6">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2">
        <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-gold" />
        <span className="min-w-0 flex-1 truncate text-sm text-white/80">
          Focusing on <span className="font-semibold text-white">{session.text}</span>
          {session.date !== selectedDate && ` (${getRelativeDateLabel(session.date)})`}
        </span>
        <span className={`font-mono text-xl tabular-nums ${over ? "text-red-300" : "text-gold"}`} aria-live="off">
          {remaining === null ? fmtClock(spentBefore + elapsed) : `${over ? "+" : ""}${fmtClock(remaining)}`}
        </span>
        <span className="text-xs text-white/50">
          {remaining === null
            ? "spent so far"
            : over
            ? `over the ${fmtDuration(planned! / 60)} planned`
            : `left of ${fmtDuration(planned! / 60)} planned`}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => onStop(false)}
            className="rounded-full border border-white/20 px-3 py-1.5 text-sm text-white/80 hover:border-gold/40 hover:text-gold"
          >
            Stop
          </button>
          <button
            onClick={() => onStop(true)}
            className="rounded-full bg-gold px-3 py-1.5 text-sm font-semibold text-black hover:brightness-110"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
