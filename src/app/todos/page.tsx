"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AppSwitcher } from "@/components/AppSwitcher";
import WeekView from "./WeekView";
import { ClockTimePicker } from "./ClockTimePicker";
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
import { parseQuickAdd, type QuickAdd } from "@/lib/quickAdd";
import {
  loadTodos,
  addTodo,
  weekday,
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
  moveTodoToDate,
  copyTodoToDate,
  getFocusSession,
  startFocus,
  stopFocus,
  getTodayDate,
  shiftDate,
  loadDayLog,
  sortTodos,
  reorderTodo,
  updateDayLog,
  addWater,
  WATER_STEP,
  WATER_GOAL,
  type DayLog,
  exportPlanner,
  importPlanner,
  syncPlanner,
  usePlannerSync,
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
  const [logVersion, setLogVersion] = useState(0);
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

  // The day shown, and the day before for "add from yesterday".
  const syncedDates = useMemo(() => [selectedDate, shiftDate(selectedDate, -1)], [selectedDate]);

  useEffect(() => {
    let cancelled = false;
    setDeleted(null);
    setSelectedBlock(null);
    setQuickAdd(null);
    setShowYesterday(false);
    const local = loadTodos(selectedDate);
    // Sync before adding daily copies, so they're added to the latest copy of the day.
    syncPlanner(syncedDates).then(() => {
      if (cancelled) return;
      setTodos(loadTodosWithDaily(selectedDate));
      refreshMeta(selectedDate);
      setLogVersion((v) => v + 1);
    });
    setTodos(local);
    refreshMeta(selectedDate);
    return () => {
      cancelled = true;
    };
    // view: the week view may have changed this day.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, view]);

  // Edits from another device, picked up when this tab comes back into view.
  usePlannerSync(syncedDates, () => {
    setTodos(loadTodosWithDaily(selectedDate));
    refreshMeta(selectedDate);
    setLogVersion((v) => v + 1);
  });

  useEffect(() => {
    inputRef.current?.focus();
    setReminderLead(loadReminderLead());
    setFocus(getFocusSession());
  }, []);

  // Shortcuts: N or / to add a task, ← → to change day (or week), T for today, W to switch view.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || el.closest("input, textarea, select, [contenteditable], [role=dialog]")) return;
      const step = view === "week" ? 7 : 1;
      if (e.key === "n" || e.key === "/") {
        e.preventDefault();
        if (view === "week") setView("day");
        setMobileView("tasks");
        setTimeout(() => inputRef.current?.focus(), 0);
      } else if (e.key === "ArrowLeft") setSelectedDate((d) => shiftDate(d, -step));
      else if (e.key === "ArrowRight") setSelectedDate((d) => shiftDate(d, step));
      else if (e.key === "t") setSelectedDate(getTodayDate());
      else if (e.key === "w") setView((v) => (v === "week" ? "day" : "week"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view]);

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
    // Shorthand in the title ("6pm", "45m", "#work", "!high", "daily") wins over the form controls.
    const quick = parseQuickAdd(newTodoText);
    const start = quick.start ?? fromInputTime(newTime);
    apply(
      addTodo(
        quick.text || newTodoText.trim(),
        selectedDate,
        quick.priority ?? (newPriority || undefined),
        start !== null ? { start, duration: quick.duration ?? newDuration } : undefined,
        newDaily ? newRepeatDays : quick.daily ?? false,
        newNote,
        quick.tag ?? (newTag || undefined)
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

  const handleSendToDay = async (t: Todo, to: string, mode: "move" | "copy") => {
    // Pull the target day first, so the todo lands in its latest copy.
    await syncPlanner([to]);
    const schedule = t.start !== undefined ? { start: t.start, duration: t.duration } : undefined;
    if (mode === "copy") copyTodoToDate(t.id, selectedDate, to, schedule);
    else if (moveTodoToDate(t.id, selectedDate, to, schedule) === null) {
      flash("Repeating tasks stay on their own day. Copy it instead.");
      return;
    }
    if (mode === "move" && selectedBlock === t.id) setSelectedBlock(null);
    apply(loadTodos(selectedDate));
    flash(`${mode === "copy" ? "Copied" : "Moved"} to ${getRelativeDateLabel(to)}`);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const r = await importPlanner(file);
      setTodos(loadTodosWithDaily(selectedDate));
      refreshMeta();
      flash(
        `Imported ${r.todos} ${r.todos === 1 ? "todo" : "todos"} across ${r.days} ${r.days === 1 ? "day" : "days"}` +
          (r.daily ? ` + ${r.daily} daily ${r.daily === 1 ? "task" : "tasks"}` : "")
      );
    } catch (err) {
      flash(err instanceof Error ? err.message : "Could not import that file");
    }
  };

  const handleSync = async () => {
    setSyncStatus("syncing");
    const result = await syncPlanner(syncedDates, true);
    if (result !== null) setTodos(loadTodosWithDaily(selectedDate));
    refreshMeta();
    setSyncStatus(result === null ? "error" : "synced");
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
  const focusedMinutes = todos.reduce((n, t) => n + (t.spent ?? 0), 0);
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

  const quickPreview = useMemo(() => parseQuickAdd(newTodoText), [newTodoText]);

  const reorder = useListReorder((id, before) => apply(reorderTodo(id, before, selectedDate)));
  // Keyboard: move a task one place up or down among the unfinished ones.
  const moveBy = (t: Todo, delta: -1 | 1) => {
    const ids = sortTodos(todos).filter((x) => !x.completed).map((x) => x.id);
    const at = ids.indexOf(t.id);
    const before = delta < 0 ? ids[at - 1] : ids[at + 2] ?? null;
    if (at + delta < 0 || at + delta >= ids.length) return;
    apply(reorderTodo(t.id, before, selectedDate));
  };

  const usedTags = TAGS.map((t) => t.id).filter((id) => id === tagFilter || todos.some((t) => t.tag === id));

  const otherDays = availableDates.filter((d) => d !== selectedDate && loadTodos(d).length > 0);
  const isToday = selectedDate === getTodayDate();
  const prevLabel = getRelativeDateLabel(shiftDate(selectedDate, -1));

  return (
    <main className="min-h-screen bg-[#090910] bg-[radial-gradient(ellipse_at_top,rgba(246,196,83,0.06),transparent_60%)] text-white">
      {/* Header */}
      <header className="border-b border-white/5 bg-black/20 backdrop-blur-md sticky top-0 z-40">
        <nav className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-3 sm:px-6 sm:py-4">
          <AppSwitcher current="planner" />
        </nav>
      </header>

      <div className="mx-auto max-w-[1600px] px-4 pb-24 pt-5 sm:px-6 sm:py-8">
        {/* Hero: greeting, progress, day navigation */}
        <section className="relative mb-6 overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[.07] via-white/[.03] to-transparent p-4 sm:p-6">
          <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-gold/10 blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -bottom-32 left-1/3 h-64 w-64 rounded-full bg-violet-500/10 blur-3xl" />
          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs uppercase tracking-[0.2em] text-white/45">
                <h1>Daily Planner</h1>
                <Link
                  href="/todos/stats"
                  className="rounded-full border border-white/15 px-2.5 py-0.5 normal-case tracking-normal text-white/70 hover:border-gold/40 hover:text-gold"
                >
                  Stats →
                </Link>
              </div>
              <p className="mt-2 text-2xl font-bold sm:text-4xl">
                {view === "week" ? "This week at a glance" : greeting(isToday, now, selectedDate)}
              </p>
              <p className="mt-1 text-white/60">
                {view === "week"
                  ? `Week of ${formatShortDate(weekStart(selectedDate))} – ${formatShortDate(shiftDate(weekStart(selectedDate), 6))}`
                  : `${getRelativeDateLabel(selectedDate)} · ${formatDate(selectedDate)}`}
              </p>
              {view === "day" && <p className="mt-3 text-sm text-white/75">{moodLine(todos.length, activeCount, percent)}</p>}
            </div>
            {view === "day" && (
              <div className="flex items-center gap-4 self-start">
                <ProgressRing percent={percent} label={`${completedCount}/${todos.length}`} />
                <dl className="grid grid-cols-2 gap-x-5 gap-y-2 text-sm">
                  {[
                    { label: "Still to do", value: String(activeCount) },
                    { label: "Not scheduled", value: String(unscheduledActive) },
                    { label: "Planned time", value: plannedMinutes ? fmtDuration(plannedMinutes) : "–" },
                    { label: "Focused", value: focusedMinutes ? fmtDuration(focusedMinutes) : "–" },
                  ].map((c) => (
                    <div key={c.label}>
                      <dt className="text-[11px] uppercase tracking-wider text-white/45">{c.label}</dt>
                      <dd className="text-lg font-semibold tabular-nums">{c.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>

          <div className="relative mt-5 flex flex-wrap items-center gap-2">
            <div className="flex rounded-full border border-white/15 bg-black/20 p-0.5 text-sm">
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
              className="h-8 w-8 rounded-full border border-white/20 bg-black/20 text-sm hover:border-gold/40 hover:text-gold"
              aria-label={view === "week" ? "Previous week" : "Previous day"}
            >
              ‹
            </button>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
              className="min-w-0 flex-1 rounded-full border border-white/20 bg-black/20 px-3 py-1 text-sm text-white [color-scheme:dark] focus:border-gold/50 focus:outline-none sm:flex-none"
              aria-label="Pick a date"
            />
            <button
              onClick={() => setSelectedDate(shiftDate(selectedDate, view === "week" ? 7 : 1))}
              className="h-8 w-8 rounded-full border border-white/20 bg-black/20 text-sm hover:border-gold/40 hover:text-gold"
              aria-label={view === "week" ? "Next week" : "Next day"}
            >
              ›
            </button>
            {!isToday && (
              <button
                onClick={() => setSelectedDate(getTodayDate())}
                className="rounded-full bg-gold px-3 py-1 text-sm font-semibold text-black hover:brightness-110"
              >
                Today
              </button>
            )}
          </div>

          {view === "day" && <WeekStrip selectedDate={selectedDate} todos={todos} onPick={setSelectedDate} />}
        </section>

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
            <DayLogCard date={selectedDate} version={logVersion} />
            <form
              onSubmit={handleAddTodo}
              className="mb-4 flex flex-wrap gap-2 rounded-2xl border border-white/10 bg-panel/70 p-3 shadow-lg shadow-black/30 transition focus-within:border-gold/40"
            >
              <div className="flex basis-full items-center gap-2">
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
              </div>
              <QuickAddHint quick={quickPreview} typed={newTodoText.trim() !== ""} />
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
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-ink px-2.5 py-1.5 text-xs text-white [color-scheme:dark] focus:border-gold/50 focus:outline-none sm:flex-none"
                aria-label="Start time (optional)"
                title="Start time (optional) - places it in the planner"
              />
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
                title="Repeat this task every day"
                className={`rounded-lg border px-2.5 py-1.5 text-xs transition ${
                  newDaily
                    ? "border-gold/60 bg-gold/15 text-gold"
                    : "border-white/10 bg-ink text-white/60 hover:text-white"
                }`}
              >
                ↻ {newDaily ? repeatLabel(newRepeatDays.length === 7 ? undefined : newRepeatDays) : "Daily"}
              </button>
              <button
                type="submit"
                disabled={!newTodoText.trim()}
                className="ml-auto rounded-lg bg-gold px-5 py-1.5 text-sm font-semibold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
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
                  className="basis-full resize-y rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/40 transition focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/50"
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

            {todos.length > 0 && activeCount === 0 && (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-400/30 bg-gradient-to-r from-emerald-500/15 via-gold/10 to-transparent px-4 py-3">
                <div>
                  <p className="font-semibold text-white">All done for {getRelativeDateLabel(selectedDate)} 🎉</p>
                  <p className="text-sm text-white/60">Every task is ticked off. Take a breath, or get a head start.</p>
                </div>
                <button
                  onClick={() => setSelectedDate(shiftDate(selectedDate, 1))}
                  className="rounded-full border border-white/20 px-3 py-1 text-sm text-white/80 hover:border-gold/50 hover:text-gold"
                >
                  Plan {getRelativeDateLabel(shiftDate(selectedDate, 1)).toLowerCase()} →
                </button>
              </div>
            )}

            {todos.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/15 bg-panel/40 p-10 text-center">
                <div aria-hidden className="mb-3 text-4xl">🗒️</div>
                <h3 className="text-lg font-semibold text-white/80">Nothing planned for {getRelativeDateLabel(selectedDate)}</h3>
                <p className="mt-1 text-white/50">Add a task above, or click a time slot in the planner.</p>
                <p className="mt-3 text-xs text-white/40">
                  Try typing <span className="rounded bg-white/10 px-1.5 py-0.5 text-white/70">Gym 6pm 45m #health !high</span>
                </p>
              </div>
            ) : visible.length === 0 ? (
              <p className="rounded-xl border border-white/10 bg-panel/60 p-6 text-center text-sm text-white/50">
                No tasks match this filter.
              </p>
            ) : (
              <div ref={reorder.listRef} className="space-y-2">
                {visible.map((todo) => (
                  <Fragment key={todo.id}>
                  {reorder.drag?.before === todo.id && <DropLine />}
                  <TodoItem
                    todo={todo}
                    reorder={reorder}
                    onMoveBy={moveBy}
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
                    date={selectedDate}
                    onSendToDay={handleSendToDay}
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
                  </Fragment>
                ))}
                {reorder.drag && reorder.drag.before === null && <DropLine />}
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
                  onClick={exportPlanner}
                  title="Download a backup of every day and daily task"
                  className="rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-white/80 hover:border-gold/40 hover:text-gold"
                >
                  Export
                </button>
                <input type="file" accept=".json" onChange={handleImport} className="hidden" id="import-file" />
                <label
                  htmlFor="import-file"
                  title="Add todos from a planner backup; nothing here is deleted"
                  className="cursor-pointer rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-white/80 hover:border-gold/40 hover:text-gold"
                >
                  Import
                </label>
                <button
                  onClick={handleSync}
                  disabled={syncStatus === "syncing"}
                  title="Sync with your other devices now"
                  className={`rounded-full border px-3 py-1.5 transition ${
                    syncStatus === "synced"
                      ? "border-green-400/50 bg-green-500/10 text-green-300"
                      : syncStatus === "error"
                      ? "border-red-400/50 bg-red-500/10 text-red-300"
                      : "border-white/20 bg-white/5 text-white/80 hover:border-gold/40 hover:text-gold"
                  }`}
                >
                  {syncStatus === "syncing" ? "Syncing..." : syncStatus === "synced" ? "Synced" : syncStatus === "error" ? "Failed" : "Sync now"}
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
  repeatDays,
  streak,
  onSetRepeatDays,
  onAddSubtask,
  onToggleSubtask,
  onDeleteSubtask,
  onSetTag,
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
  repeatDays?: number[];
  streak: number;
  onSetRepeatDays: (todo: Todo, days: number[]) => void;
  onAddSubtask: (todo: Todo, text: string) => void;
  onToggleSubtask: (todo: Todo, subtaskId: string) => void;
  onDeleteSubtask: (todo: Todo, subtaskId: string) => void;
  onSetTag: (todo: Todo, tag: TagId | undefined) => void;
  focusing: boolean;
  onStartFocus: (todo: Todo) => void;
  date: string;
  onSendToDay: (todo: Todo, to: string, mode: "move" | "copy") => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [showRepeat, setShowRepeat] = useState(false);
  const [showSend, setShowSend] = useState(false);
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
        ...(todo.tag && !todo.completed ? { borderLeftColor: TAG_COLORS[todo.tag], borderLeftWidth: 3 } : {}),
      }}
      className={`relative rounded-xl border bg-panel/60 p-3 pr-2 sm:pr-3 ${
        lifted
          ? "z-20 border-gold/60 opacity-90 shadow-2xl shadow-black/60"
          : "border-white/10 transition hover:border-white/20"
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

// How the day went: wake and sleep times on a clock, body weight, water against a daily goal, and a short review.
function DayLogCard({ date, version }: { date: string; version: number }) {
  const [log, setLog] = useState<DayLog>({});
  const [notesOpen, setNotesOpen] = useState(false);
  const [weightText, setWeightText] = useState("");
  useEffect(() => {
    const loaded = loadDayLog(date);
    setLog(loaded);
    setWeightText(loaded.weight !== undefined ? String(loaded.weight) : "");
    setNotesOpen(Boolean(loaded.well || loaded.bad || loaded.improve));
  }, [date, version]);
  const water = log.water ?? 0;
  const litres = (ml: number) => `${(ml / 1000).toFixed(2).replace(/\.?0+$/, "")} L`;
  const hasNotes = Boolean(log.well || log.bad || log.improve);
  const waterButton = (label: string, ml: number, text: string) => (
    <button
      type="button"
      aria-label={label}
      onClick={() => setLog(addWater(date, ml))}
      className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-white/80 transition hover:border-gold/50 hover:text-white"
    >
      {text}
    </button>
  );
  const note = (field: "well" | "bad" | "improve", label: string, hint: string) => (
    <label className="flex flex-col gap-1 text-sm text-white/70">
      {label}
      <textarea
        aria-label={label}
        rows={3}
        placeholder={hint}
        value={log[field] ?? ""}
        onChange={(e) => setLog(updateDayLog(date, { [field]: e.target.value }))}
        className="resize-y rounded-lg border border-white/10 bg-panel px-2.5 py-1.5 text-white placeholder-white/30 focus:border-gold/50 focus:outline-none"
      />
    </label>
  );
  return (
    <div className="mb-4 space-y-3 rounded-xl border border-white/10 bg-white/5 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <ClockTimePicker
          label="Woke up"
          value={log.wake ?? ""}
          fallback="07:00"
          onChange={(v) => setLog(updateDayLog(date, { wake: v || undefined }))}
        />
        <ClockTimePicker
          label="Went to sleep"
          value={log.sleep ?? ""}
          fallback="22:30"
          onChange={(v) => setLog(updateDayLog(date, { sleep: v || undefined }))}
        />
        <label className="flex items-center gap-2 text-sm text-white/70">
          Weight
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.1"
            aria-label="Weight in kg"
            placeholder="0.0"
            value={weightText}
            onChange={(e) => {
              setWeightText(e.target.value);
              const kg = parseFloat(e.target.value);
              setLog(updateDayLog(date, { weight: Number.isFinite(kg) ? kg : undefined }));
            }}
            className="w-20 rounded-lg border border-white/10 bg-panel px-2.5 py-1 text-white placeholder-white/30 focus:border-gold/50 focus:outline-none"
          />
          kg
        </label>
      </div>

      <div>
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-white/70">
            Water{" "}
            <span className="font-semibold text-white" data-testid="water-total">
              {litres(water)}
            </span>
            <span className="text-white/40"> of {litres(WATER_GOAL)}</span>
          </span>
          <div className="flex items-center gap-1.5">
            {waterButton("Less water", -WATER_STEP, "− Glass")}
            {waterButton("More water", WATER_STEP, "+ Glass")}
            {waterButton("Add a bottle", WATER_STEP * 2, "+ Bottle")}
          </div>
        </div>
        <div
          className="h-2 overflow-hidden rounded-full bg-white/10"
          role="progressbar"
          aria-label="Water goal"
          aria-valuemin={0}
          aria-valuemax={WATER_GOAL}
          aria-valuenow={Math.min(water, WATER_GOAL)}
        >
          <div
            className={`h-full rounded-full transition-all ${water >= WATER_GOAL ? "bg-emerald-400" : "bg-sky-400"}`}
            style={{ width: `${Math.min(100, (water / WATER_GOAL) * 100)}%` }}
          />
        </div>
      </div>

      <div>
        <button
          type="button"
          onClick={() => setNotesOpen(!notesOpen)}
          aria-expanded={notesOpen}
          className="flex items-center gap-1.5 text-sm text-white/70 transition hover:text-white"
        >
          <span aria-hidden className={`inline-block transition-transform ${notesOpen ? "rotate-90" : ""}`}>
            ›
          </span>
          How did the day go?
          {hasNotes && !notesOpen && <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-label="has notes" />}
        </button>
        {notesOpen && (
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            {note("well", "What went well", "Wins, however small")}
            {note("bad", "What went badly", "What got in the way")}
            {note("improve", "What to improve", "One thing for tomorrow")}
          </div>
        )}
      </div>
    </div>
  );
}

// Reordering the task list by dragging a row's handle with a mouse, finger or pen. Rows that can
// move carry data-reorder-id; the one being dragged follows the pointer and a line shows where it
// will land. `onCommit` gets the task and the one it goes before (null = the end).
type ListReorder = ReturnType<typeof useListReorder>;
function useListReorder(onCommit: (id: string, before: string | null) => void) {
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

function DropLine() {
  return <div className="-my-1 h-0.5 rounded-full bg-gold" aria-hidden data-testid="drop-line" />;
}

function greeting(isToday: boolean, now: number | null, date: string): string {
  if (!isToday) return getRelativeDateLabel(date);
  if (now === null) return "Hello";
  if (now < 5 * 60) return "Up late? 🌙";
  if (now < 12 * 60) return "Good morning ☀️";
  if (now < 17 * 60) return "Good afternoon";
  return "Good evening 🌆";
}

function moodLine(total: number, active: number, percent: number): string {
  if (total === 0) return "A blank page. What matters most today?";
  if (active === 0) return "Everything's done. Nicely handled.";
  if (percent >= 50) return `Over halfway there. ${active} to go.`;
  if (percent > 0) return `Good start. ${active} to go, one at a time.`;
  return `${active} ${active === 1 ? "thing" : "things"} on the list. Pick one and begin.`;
}

function ProgressRing({ percent, label }: { percent: number; label: string }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-24 w-24 shrink-0" role="img" aria-label={`${percent}% done`}>
      <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="7" />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke={percent === 100 ? "#34d399" : "#f6c453"}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - percent / 100)}
          className="transition-[stroke-dashoffset] duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-bold tabular-nums">{label}</span>
        <span className="text-[10px] uppercase tracking-wider text-white/45">done</span>
      </div>
    </div>
  );
}

// The selected day's week as tappable days, each with a bar for how much of it got done.
// Counts and "today" come from this browser (localStorage, local clock), so they're filled in after
// mount: the server render can't know them, and rendering them there breaks hydration.
function WeekStrip({ selectedDate, todos, onPick }: { selectedDate: string; todos: Todo[]; onPick: (date: string) => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const today = mounted ? getTodayDate() : "";
  const start = weekStart(selectedDate);
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = shiftDate(start, i);
    const list = !mounted ? [] : date === selectedDate ? todos : loadTodos(date);
    return { date, total: list.length, done: list.filter((t) => t.completed).length };
  });
  return (
    <div className="relative mt-4 grid grid-cols-7 gap-1 sm:gap-2">
      {days.map((d) => {
        const selected = d.date === selectedDate;
        const label = `${formatDate(d.date)}: ${d.total ? `${d.done} of ${d.total} done` : "nothing planned"}`;
        return (
          <button
            key={d.date}
            onClick={() => onPick(d.date)}
            aria-label={label}
            aria-current={selected ? "date" : undefined}
            title={label}
            className={`flex flex-col items-center rounded-xl px-1 py-2 transition ${
              selected ? "bg-gold text-black" : "bg-black/20 text-white/75 hover:bg-white/10"
            }`}
          >
            <span className={`text-[10px] uppercase tracking-wider ${selected ? "text-black/70" : "text-white/45"}`}>
              {DAY_NAMES[weekday(d.date)]}
            </span>
            <span className="text-base font-semibold tabular-nums">
              {Number(d.date.slice(8))}
              {d.date === today && !selected && <span className="ml-0.5 inline-block h-1.5 w-1.5 rounded-full bg-gold align-top" />}
            </span>
            <span className={`mt-1 h-1 w-6 overflow-hidden rounded-full ${selected ? "bg-black/20" : "bg-white/10"}`}>
              {d.total > 0 && (
                <span
                  className={`block h-full rounded-full ${selected ? "bg-black/70" : d.done === d.total ? "bg-emerald-400" : "bg-gold"}`}
                  style={{ width: `${Math.max(8, (d.done / d.total) * 100)}%` }}
                />
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// What the shorthand in the add box will set, or a tip when there's none.
function QuickAddHint({ quick, typed }: { quick: QuickAdd; typed: boolean }) {
  const chips: string[] = [];
  if (quick.start !== undefined) chips.push(`⏰ ${fmtTime(quick.start)}${quick.duration ? ` · ${fmtDuration(quick.duration)}` : ""}`);
  else if (quick.duration) chips.push(`⏱ ${fmtDuration(quick.duration)} (add a time to schedule it)`);
  if (quick.priority) chips.push(`⚑ ${quick.priority[0].toUpperCase()}${quick.priority.slice(1)}`);
  if (quick.tag) chips.push(`# ${TAG_LABEL[quick.tag]}`);
  if (quick.daily) chips.push("↻ Every day");
  if (!chips.length)
    return typed ? null : (
      <p className="basis-full px-1 text-[11px] text-white/35">
        Shorthand: <span className="text-white/55">6pm</span> · <span className="text-white/55">45m</span> ·{" "}
        <span className="text-white/55">#work</span> · <span className="text-white/55">!high</span> ·{" "}
        <span className="text-white/55">daily</span>
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
