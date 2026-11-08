"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AppSwitcher } from "@/components/AppSwitcher";
import WeekView from "./WeekView";
import { ClockTimePicker } from "./ClockTimePicker";
import {
  HOUR_PX,
  SNAP,
  DURATIONS,
  fromInputTime,
  shiftMonth,
  toInputTime,
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
  weekday,
  toggleTodo,
  deleteTodo,
  restoreTodo,
  setTodoPriority,
  scheduleTodo,
  updateTodo,
  clearCompletedTodos,
  getUnfinishedFromYesterday,
  getOverdueTodos,
  carryOverdueTo,
  loadAllTodos,
  syncTrayPlanner,
  type OverdueTodo,
  carryOverFromYesterday,
  loadTodosWithDaily,
  makeTodoDaily,
  stopTodoDaily,
  loadDailyTasks,
  getDailyStreak,
  addSubtask,
  toggleSubtask,
  deleteSubtask,
  dueReminders,
  setTodoTag,
  setTodoDue,
  setTodoGoal,
  getDueTodos,
  moveTodoToDate,
  copyTodoToDate,
  getFocusSession,
  startFocus,
  stopFocus,
  getTodayDate,
  toDateString,
  shiftDate,
  loadDayLog,
  sortTodos,
  reorderTodo,
  updateDayLog,
  setLogCount,
  setLogTick,
  addWater,
  WATER_STEP,
  WATER_GOAL,
  type DayLog,
  syncPlanner,
  usePlannerSync,
  DEFAULT_DURATION,
  loadAllDayLogs,
  normalizeRepeat,
  setTodoRepeat,
  timesDone,
  type DailyTask,
  type FocusSession,
  type TagId,
  type Priority,
  type Todo,
} from "@/lib/todos";
import { exportPlanner, importPlanner } from "@/lib/plannerBackup";
import { computeTimeFit, suggestBlockLength } from "@/lib/plannerInsights";
import { DueTray } from "./Deadlines";
import { AddTaskForm, useTaskDraft } from "./AddTaskForm";
import { DropLine, TodoItem, useListReorder } from "./TodoItem";
import { NextUpCard } from "./NextUp";
import { CarryOverTray, OverdueTray } from "./TaskTrays";
import { AutoSchedulePanel } from "./AutoSchedule";
import MonthView from "./MonthView";
import { PlannerTools } from "./PlannerTools";
import { canAutoSchedule, dayWindow, planDay, type DayPlan, type DayWindow, type PlannedBlock } from "@/lib/autoSchedule";
import { allTags, loadGoals, tagColor, tagLabel, useGoals, useLogItems, useTags } from "@/lib/plannerSettings";
import { REMINDER_LEADS, reminderBody, reminderKey } from "@/lib/reminders";
import { disablePush, enablePush, notify } from "@/lib/push";

type Filter = "all" | "active" | "done";
type MobileView = "tasks" | "schedule";
type View = "day" | "week" | "month";


// 5:07 / 1:02:30
function fmtClock(totalSeconds: number): string {
  const s = Math.floor(Math.abs(totalSeconds));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60));
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm.padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
}

function stepDate(date: string, view: View, n: number): string {
  return view === "month" ? shiftMonth(date, n) : shiftDate(date, view === "week" ? 7 * n : n);
}
const formatMonth = (date: string) => new Date(date + "T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });

const REMINDER_KEY = "reel-radar-reminder-lead"; // minutes before a block starts; unset = off

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


export default function TodosPage() {
  const [selectedDate, setSelectedDate] = useState<string>(() => getTodayDate());
  const [todos, setTodos] = useState<Todo[]>([]);
  const draft = useTaskDraft();
  useTags(); // redraw when a tag changes: task rows read tagLabel()
  const [plan, setPlan] = useState<{ plan: DayPlan; window: DayWindow } | null>(null);
  useGoals(); // and when a goal does: task rows read loadGoals()
  const [tagFilter, setTagFilter] = useState<TagId | "all">("all");
  const [view, setView] = useState<View>("day");
  const [focus, setFocus] = useState<FocusSession | null>(null);
  const [dailyTasks, setDailyTasks] = useState<DailyTask[]>([]);
  const [reminderLead, setReminderLead] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editNote, setEditNote] = useState("");
  const [yesterdayTodos, setYesterdayTodos] = useState<Todo[]>([]);
  const [overdue, setOverdue] = useState<OverdueTodo[]>([]);
  const [dueSoon, setDueSoon] = useState<OverdueTodo[]>([]);
  const [reviewDue, setReviewDue] = useState(false);
  const [deletedFrom, setDeletedFrom] = useState<string | null>(null);
  const pastSynced = useRef(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [mobileView, setMobileView] = useState<MobileView>("tasks");
  const [deleted, setDeleted] = useState<Todo | null>(null);
  const [message, setMessage] = useState("");
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "synced" | "error">("idle");
  const [selectedBlock, setSelectedBlock] = useState<string | null>(null);
  const [quickAdd, setQuickAdd] = useState<{ start: number; text: string } | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [logVersion, setLogVersion] = useState(0);
  const [dayLog, setDayLog] = useState<DayLog>({});
  const [dragOver, setDragOver] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const quickRef = useRef(quickAdd);
  quickRef.current = quickAdd;
  const gridRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const firedReminders = useRef(new Set<string>());
  const focusAlerted = useRef<string | null>(null);
  const resize = useBlockResize((t, date, duration) => apply(scheduleTodo(t.id, { start: t.start!, duration }, date)));

  useEffect(
    () => () => {
      clearTimeout(flashTimer.current);
      clearTimeout(undoTimer.current);
    },
    []
  );

  const refreshMeta = (date = selectedDate) => {
    const today = getTodayDate();
    setYesterdayTodos(date === today ? [] : getUnfinishedFromYesterday(date));
    // A task with a deadline coming up shows there, not in both trays.
    const due = date === today ? getDueTodos(today) : [];
    setDueSoon(due);
    setOverdue(date === today ? getOverdueTodos(today).filter((o) => !due.some((d) => d.todo.id === o.todo.id)) : []);
    setReviewDue(weekday(today) === 0 && !loadDayLog(today).reviewedAt);
    setDailyTasks(loadDailyTasks());
  };

  // The day shown, and the day before for "add from yesterday".
  const syncedDates = useMemo(() => [selectedDate, shiftDate(selectedDate, -1)], [selectedDate]);

  useEffect(() => {
    let cancelled = false;
    setDeleted(null);
    setSelectedBlock(null);
    setQuickAdd(null);
    setPlan(null);
    const local = loadTodos(selectedDate);
    // Sync before adding daily copies, so they're added to the latest copy of the day.
    syncPlanner(syncedDates).then(() => {
      if (cancelled) return;
      setTodos(loadTodosWithDaily(selectedDate));
      refreshMeta(selectedDate);
      setLogVersion((v) => v + 1);
      // Overdue and due-soon tasks can be in a month this device doesn't have yet. Once per visit.
      if (pastSynced.current) return;
      pastSynced.current = true;
      syncTrayPlanner().then((changed) => {
        if (changed && !cancelled) refreshMeta(selectedDate);
      });
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
    // Search and Goals link straight to a day.
    const linked = new URLSearchParams(window.location.search).get("date");
    if (linked && /^\d{4}-\d{2}-\d{2}$/.test(linked) && !Number.isNaN(new Date(linked + "T00:00:00").getTime())) setSelectedDate(linked);
    if (linked) window.history.replaceState(null, "", "/todos"); // a later reload goes back to today
    inputRef.current?.focus();
    const lead = loadReminderLead();
    setReminderLead(lead);
    // Keeps the server's copy current: this device's time zone, or a subscription the browser replaced.
    if (lead !== null && typeof Notification !== "undefined" && Notification.permission === "granted") void enablePush(lead);
    setFocus(getFocusSession());
  }, []);

  // Shortcuts: N or / to add a task, ← → to change day (or week, or month), T for today, W and M to switch view.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || el.closest("input, textarea, select, [contenteditable], [role=dialog]")) return;
      if (e.key === "n" || e.key === "/") {
        e.preventDefault();
        if (view !== "day") setView("day");
        setMobileView("tasks");
        setTimeout(() => inputRef.current?.focus(), 0);
      } else if (e.key === "ArrowLeft") setSelectedDate((d) => stepDate(d, view, -1));
      else if (e.key === "ArrowRight") setSelectedDate((d) => stepDate(d, view, 1));
      else if (e.key === "t") setSelectedDate(getTodayDate());
      else if (e.key === "w") setView((v) => (v === "week" ? "day" : "week"));
      else if (e.key === "m") setView((v) => (v === "month" ? "day" : "month"));
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

  // A drink just logged is marked at the current time, which may be off-screen: bring it into view.
  const drinkCount = useRef(0);
  useEffect(() => {
    const drinks = dayLog.drinks ?? [];
    const added = drinks.length > drinkCount.current;
    drinkCount.current = drinks.length;
    const box = scrollRef.current;
    const last = drinks[drinks.length - 1];
    const d = new Date();
    if (!added || !box || !last || last.at < d.getHours() * 60 + d.getMinutes() - 1) return;
    const y = (last.at / 60) * HOUR_PX;
    if (y < box.scrollTop + 24 || y > box.scrollTop + box.clientHeight - 24)
      box.scrollTo({ top: Math.max(0, y - box.clientHeight / 2), behavior: "smooth" });
  }, [dayLog]);

  // Notify about today's blocks as they come up while this page is open. Pushes from the server
  // cover the rest; they share a tag, so a block that gets both only shows once.
  useEffect(() => {
    if (reminderLead === null || now === null) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const today = getTodayDate();
    for (const t of dueReminders(loadTodos(today), now, reminderLead)) {
      const key = reminderKey(today, t);
      if (firedReminders.current.has(key)) continue;
      firedReminders.current.add(key);
      notify(t.text, { body: reminderBody(t, now), tag: key });
    }
  }, [now, reminderLead]);

  const handleReminderChange = async (value: string) => {
    if (value === "") {
      setReminderLead(null);
      saveReminderLead(null);
      void disablePush();
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
    const everywhere = await enablePush(Number(value));
    flash(everywhere ? "Reminders on, even with the app closed" : "Reminders on while this page is open");
  };

  const flash = (text: string) => {
    setMessage(text);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setMessage(""), 3000);
  };

  const apply = (updated: Todo[]) => {
    setTodos(updated);
    refreshMeta();
  };

  const startAutoSchedule = () => {
    const window = dayWindow(loadAllDayLogs(), selectedDate);
    setPlan({ plan: planDay(sortTodos(todos), window, isToday && now !== null ? now : undefined), window });
  };

  const applyPlan = () => {
    if (!plan) return;
    let updated = todos;
    for (const b of plan.plan.placed) updated = scheduleTodo(b.id, { start: b.start, duration: b.duration }, selectedDate);
    apply(updated);
    flash(`Scheduled ${plan.plan.placed.length} ${plan.plan.placed.length === 1 ? "task" : "tasks"}`);
    setPlan(null);
  };

  const handleDelete = (id: string) => {
    const target = todos.find((t) => t.id === id);
    apply(deleteTodo(id, selectedDate));
    if (selectedBlock === id) setSelectedBlock(null);
    if (target) {
      setDeleted(target);
      setDeletedFrom(null);
      clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setDeleted(null), 6000);
    }
  };

  const handleUndo = () => {
    if (!deleted) return;
    restoreTodo(deleted, deletedFrom ?? selectedDate);
    apply(loadTodos(selectedDate));
    setDeleted(null);
  };

  const handleEditSave = (id: string) => {
    if (!editText.trim()) handleDelete(id);
    else apply(updateTodo(id, { text: editText.trim(), note: editNote }, selectedDate));
    setEditingId(null);
    setEditText("");
    setEditNote("");
  };

  const handleMoveOverdue = (items: OverdueTodo[]) => {
    apply(carryOverdueTo(selectedDate, items));
    flash(`Moved ${items.length} ${items.length === 1 ? "task" : "tasks"} to today`);
  };

  const handleDropOverdue = ({ todo, date }: OverdueTodo) => {
    deleteTodo(todo.id, date);
    apply(loadTodos(selectedDate));
    setDeleted(todo);
    setDeletedFrom(date);
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setDeleted(null), 6000);
  };

  const handleDueDone = ({ todo, date }: OverdueTodo) => {
    toggleTodo(todo.id, date);
    apply(loadTodos(selectedDate));
    flash(`Done: ${todo.text}`);
  };

  const handleDueToday = ({ todo, date }: OverdueTodo) => {
    moveTodoToDate(todo.id, date, selectedDate);
    apply(loadTodos(selectedDate));
    flash("Moved to today");
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
    const late = mode === "move" && t.due && to > t.due ? `, past its ${formatShortDate(t.due)} deadline` : "";
    flash(`${mode === "copy" ? "Copied" : "Moved"} to ${getRelativeDateLabel(to)}${late}`);
  };

  const handleExport = async () => {
    const { synced } = await exportPlanner();
    flash(synced ? "Backup saved" : "Couldn't reach the server, so the backup only has this device's copy");
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const r = await importPlanner(file);
      setTodos(loadTodosWithDaily(selectedDate));
      refreshMeta();
      setLogVersion((v) => v + 1);
      flash(
        `Imported ${r.todos} ${r.todos === 1 ? "todo" : "todos"} across ${r.days} ${r.days === 1 ? "day" : "days"}` +
          (r.daily ? ` + ${r.daily} daily ${r.daily === 1 ? "task" : "tasks"}` : "") +
          (r.logs ? ` + ${r.logs} day ${r.logs === 1 ? "log" : "logs"}` : "") +
          (r.lists || r.items ? ` + ${r.items} list ${r.items === 1 ? "item" : "items"}` : "") +
          (r.templates ? ` + ${r.templates} ${r.templates === 1 ? "template" : "templates"}` : "") +
          (r.goals ? ` + ${r.goals} ${r.goals === 1 ? "goal" : "goals"}` : "")
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

  const repeatById = useMemo(() => new Map(dailyTasks.map((d) => [d.id, normalizeRepeat(d)])), [dailyTasks]);
  // This week's count for "times a week" tasks, shown beside the target.
  const weekCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of dailyTasks) if (d.timesPerWeek && todos.some((t) => t.dailyId === d.id)) m.set(d.id, timesDone(d, selectedDate));
    return m;
  }, [todos, dailyTasks, selectedDate]);
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
  const marks = dayMarks(dayLog, todos, selectedDate);
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

  const reorder = useListReorder((id, before) => apply(reorderTodo(id, before, selectedDate)));
  // Keyboard: move a task one place up or down among the unfinished ones.
  const moveBy = (t: Todo, delta: -1 | 1) => {
    const ids = sortTodos(todos).filter((x) => !x.completed).map((x) => x.id);
    const at = ids.indexOf(t.id);
    const before = delta < 0 ? ids[at - 1] : ids[at + 2] ?? null;
    if (at + delta < 0 || at + delta >= ids.length) return;
    apply(reorderTodo(t.id, before, selectedDate));
  };

  const usedTags = allTags().map((t) => t.id).filter((id) => id === tagFilter || todos.some((t) => t.tag === id));

  const isToday = selectedDate === getTodayDate();
  const selectedForHint = todos.find((t) => t.id === selectedBlock && t.start !== undefined && !t.completed);
  // The last 90 days' blocks say how long this kind of block really takes.
  const lengthHint = useMemo(() => {
    if (!selectedForHint) return null;
    const today = getTodayDate();
    return suggestBlockLength(computeTimeFit(loadAllTodos(), shiftDate(today, -90), today), selectedForHint.tag, selectedForHint.duration ?? DEFAULT_DURATION);
  }, [selectedForHint?.id, selectedForHint?.tag, selectedForHint?.duration]);
  const prevLabel = getRelativeDateLabel(shiftDate(selectedDate, -1));

  return (
    <main className="relative min-h-screen overflow-x-clip bg-[#090910] text-white">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-0 bg-[radial-gradient(ellipse_at_top_left,rgba(246,196,83,0.10),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(139,92,246,0.14),transparent_55%),radial-gradient(ellipse_at_top_right,rgba(56,189,248,0.07),transparent_50%)]" />
      {/* Header */}
      <header className="z-40 border-b border-white/10 bg-white/[.03] backdrop-blur-xl lg:sticky lg:top-0">
        <nav className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6 sm:py-4">
          <AppSwitcher current="planner" />
          <div className="flex w-full items-center gap-2 overflow-x-auto whitespace-nowrap text-xs [scrollbar-width:none] sm:w-auto sm:flex-wrap sm:overflow-visible">
            {view === "day" && completedCount > 0 && (
              <button
                onClick={() => apply(clearCompletedTodos(selectedDate))}
                className="text-red-400 transition hover:text-red-300"
              >
                Clear completed
              </button>
            )}
            <Link
              href="/todos/search"
              className="rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-white/80 hover:border-gold/40 hover:text-gold"
            >
              Search →
            </Link>
            <Link
              href="/todos/goals"
              className="rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-white/80 hover:border-gold/40 hover:text-gold"
            >
              Goals →
            </Link>
            <Link
              href="/todos/lists"
              className="rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-white/80 hover:border-gold/40 hover:text-gold"
            >
              Lists →
            </Link>
            <Link
              href="/todos/stats"
              className="rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-white/80 hover:border-gold/40 hover:text-gold"
            >
              Stats →
            </Link>
            <Link
              href="/todos/review"
              className="rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-white/80 hover:border-gold/40 hover:text-gold"
            >
              Review →
            </Link>
            <button
              onClick={handleExport}
              title="Download a backup of every day, daily task, day log and list (photos and voice notes stay on the server)"
              className="rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-white/80 hover:border-gold/40 hover:text-gold"
            >
              Export
            </button>
            <input type="file" accept=".json" onChange={handleImport} className="hidden" id="import-file" />
            <label
              htmlFor="import-file"
              title="Add what's in a planner backup; nothing here is deleted"
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
        </nav>
      </header>

      <div className="relative mx-auto max-w-6xl px-4 pb-24 pt-5 sm:px-6 sm:py-8">
        {/* Hero: greeting, progress, day navigation */}
        <section className="relative mb-6 overflow-hidden rounded-[2rem] border border-white/15 bg-gradient-to-br from-white/[.12] via-white/[.05] to-white/[.02] p-5 shadow-2xl shadow-black/40 backdrop-blur-xl sm:p-8">
          <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-gold/20 blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -bottom-32 left-1/3 h-64 w-64 rounded-full bg-violet-500/20 blur-3xl" />
          <div className="relative flex items-center gap-4 sm:items-start sm:justify-between sm:gap-5">
            <div className="min-w-0 flex-1">
              <h1 className="bg-gradient-to-r from-white via-white to-gold/80 bg-clip-text text-3xl font-bold text-transparent sm:text-5xl">
                {view === "week" ? "This week at a glance" : view === "month" ? formatMonth(selectedDate) : formatDate(selectedDate)}
              </h1>
              {view === "week" && (
                <p className="mt-1 text-white/60">
                  {`Week of ${formatShortDate(weekStart(selectedDate))} – ${formatShortDate(shiftDate(weekStart(selectedDate), 6))}`}
                </p>
              )}
              {view === "day" && <p className="mt-3 text-sm text-white/75">{moodLine(todos.length, activeCount, percent)}</p>}
            </div>
            {view === "day" && (
              <div className="flex items-center gap-4 self-start">
                <ProgressRing percent={percent} label={`${completedCount}/${todos.length}`} />
                <dl className="hidden grid-cols-2 gap-x-5 gap-y-2 text-sm sm:grid">
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
              {(["day", "week", "month"] as View[]).map((v) => (
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
              onClick={() => setSelectedDate(stepDate(selectedDate, view, -1))}
              className="h-8 w-8 rounded-full border border-white/20 bg-black/20 text-sm hover:border-gold/40 hover:text-gold"
              aria-label={`Previous ${view}`}
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
              onClick={() => setSelectedDate(stepDate(selectedDate, view, 1))}
              className="h-8 w-8 rounded-full border border-white/20 bg-black/20 text-sm hover:border-gold/40 hover:text-gold"
              aria-label={`Next ${view}`}
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

        {view === "month" ? (
          <MonthView
            selectedDate={selectedDate}
            onPick={(date) => {
              setSelectedDate(date);
              setView("day");
              setMobileView("tasks");
            }}
          />
        ) : view === "week" ? (
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
        {isToday && now !== null && !focus && (
          <NextUpCard todos={todos} now={now} onDone={(t) => apply(toggleTodo(t.id, selectedDate))} onFocus={handleStartFocus} />
        )}

        {reviewDue && isToday && (
          <Link href="/todos/review" className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-gold/30 bg-gold/5 px-4 py-3 text-sm text-white/85 hover:border-gold/60">
            It's Sunday: look back on the week and plan the next one.
            <span className="shrink-0 font-semibold text-gold">Start review →</span>
          </Link>
        )}

        {dueSoon.length > 0 && <DueTray items={dueSoon} today={selectedDate} onDone={handleDueDone} onToday={handleDueToday} onOpen={setSelectedDate} />}

        {/* Overdue: unfinished tasks from every past day */}
        <OverdueTray
          key={`overdue-${selectedDate}`}
          items={overdue}
          today={selectedDate}
          onMove={handleMoveOverdue}
          onDrop={handleDropOverdue}
          onAddStep={({ todo, date }, text) => {
            addSubtask(todo.id, text, date);
            refreshMeta();
          }}
        />

        {/* Carry-over from the previous day, on other days than today */}
        <CarryOverTray key={`carry-${selectedDate}`} items={yesterdayTodos} fromLabel={prevLabel} onAdd={handleCarryOver} />

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

        <div className="grid items-start gap-6 lg:grid-cols-2 xl:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]">
          {/* ---------------- Tasks column ---------------- */}
          <section className={`min-w-0 ${mobileView === "tasks" ? "" : "hidden lg:block"}`}>
            <AddTaskForm
              draft={draft}
              selectedDate={selectedDate}
              isToday={isToday}
              inputRef={inputRef}
              onAdded={(updated) => (updated ? apply(updated) : refreshMeta())}
              onMessage={flash}
            />
            <DayLogCard date={selectedDate} version={logVersion} onChange={setDayLog} />
            <PlannerTools
              date={selectedDate}
              onApplied={(updated) => apply(updated)}
              onMessage={flash}
            />

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
                  placeholder="Filter this day"
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
                        {tag !== "all" && <span className="h-2 w-2 rounded-full" style={{ background: tagColor(tag) }} />}
                        {tag === "all" ? "All tags" : tagLabel(tag)}
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
              <div className="rounded-3xl border border-dashed border-white/20 bg-white/[.03] p-10 text-center backdrop-blur-xl">
                <div aria-hidden className="mb-3 text-4xl">🗒️</div>
                <h3 className="text-lg font-semibold text-white/80">Nothing planned for {getRelativeDateLabel(selectedDate)}</h3>
                <p className="mt-1 text-white/50">Add a task above, or click a time slot in the planner.</p>
                <p className="mt-3 text-xs text-white/40">
                  Try typing <span className="rounded bg-white/10 px-1.5 py-0.5 text-white/70">Gym 6pm 45m #health !high</span>
                </p>
              </div>
            ) : visible.length === 0 ? (
              <p className="rounded-2xl border border-white/10 bg-white/[.04] p-6 text-center text-sm text-white/50">
                No tasks match this filter.
                {query.trim() && (
                  <>
                    {" "}
                    <Link href={`/todos/search?q=${encodeURIComponent(query.trim())}`} className="text-gold hover:underline">
                      Search every day →
                    </Link>
                  </>
                )}
              </p>
            ) : (
              <div ref={reorder.listRef} className="space-y-2">
                {visible.map((todo, i) => (
                  <Fragment key={todo.id}>
                  {filter === "all" && (i === 0 || visible[i - 1].completed !== todo.completed) && (
                    <div className={`flex items-center gap-3 px-1 text-[11px] uppercase tracking-[0.2em] text-white/40 ${i > 0 ? "pt-3" : ""}`}>
                      <span>{todo.completed ? `Completed · ${completedCount}` : `To do · ${activeCount}`}</span>
                      <span aria-hidden className="h-px flex-1 bg-gradient-to-r from-white/15 to-transparent" />
                    </div>
                  )}
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
                    repeat={todo.dailyId ? repeatById.get(todo.dailyId) : undefined}
                    weekCount={todo.dailyId ? weekCounts.get(todo.dailyId) : undefined}
                    streak={todo.dailyId ? streaks.get(todo.dailyId) ?? 0 : 0}
                    onSetRepeat={(t, rule) => apply(setTodoRepeat(t.id, rule, selectedDate))}
                    onAddSubtask={(t, text) => apply(addSubtask(t.id, text, selectedDate))}
                    onToggleSubtask={(t, subId) => apply(toggleSubtask(t.id, subId, selectedDate))}
                    onDeleteSubtask={(t, subId) => apply(deleteSubtask(t.id, subId, selectedDate))}
                    onSetTag={(t, tag) => apply(setTodoTag(t.id, tag, selectedDate))}
                    onSetDue={(t, due) => apply(setTodoDue(t.id, due, selectedDate))}
                    onSetGoal={(t, goalId) => apply(setTodoGoal(t.id, goalId, selectedDate))}
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
          </section>

          {/* ---------------- Planner column ---------------- */}
          <section
            className={`min-w-0 overflow-hidden rounded-3xl border border-white/15 bg-white/[.05] shadow-xl shadow-black/30 backdrop-blur-xl lg:sticky lg:top-20 ${
              mobileView === "schedule" ? "" : "hidden lg:block"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-white/10 px-4 py-3">
              <h2 className="font-semibold">Schedule</h2>
              <p className="hidden text-xs text-white/45 xl:block">Click a slot to add · drag tasks here to time-block</p>
              <p className="order-last basis-full text-xs text-white/45 sm:hidden">Tap a slot to add · tap a block to edit</p>
              {todos.some(canAutoSchedule) && !plan && (
                <button
                  onClick={startAutoSchedule}
                  title="Place unscheduled tasks in your free time. You can change the plan before it's saved."
                  className="rounded-lg border border-white/10 bg-panel px-2 py-1 text-xs text-white/80 hover:border-gold/50 hover:text-gold"
                >
                  ✨ Auto-schedule
                </button>
              )}
              <select
                value={reminderLead ?? ""}
                onChange={(e) => handleReminderChange(e.target.value)}
                className="rounded-lg border border-white/10 bg-panel px-2 py-1 text-xs text-white focus:border-gold/50 focus:outline-none"
                aria-label="Reminders"
                title="Notification on this device before each block"
              >
                <option value="">🔕 No reminders</option>
                {REMINDER_LEADS.map((m) => (
                  <option key={m} value={m}>
                    🔔 {m === 0 ? "At start" : `${m} min before`}
                  </option>
                ))}
              </select>
            </div>

            {plan && (
              <AutoSchedulePanel
                plan={plan.plan}
                window={plan.window}
                repeating={todos.filter((t) => t.dailyId && !t.completed && t.start === undefined).length}
                onChange={(placed: PlannedBlock[]) => setPlan({ ...plan, plan: { ...plan.plan, placed } })}
                onApply={applyPlan}
                onCancel={() => setPlan(null)}
              />
            )}

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
                {lengthHint && (
                  <p className="w-full text-xs text-white/60">
                    {selected.tag ? tagLabel(selected.tag) : "Untagged"} blocks usually run {Math.abs(lengthHint.overBy)}% {lengthHint.overBy > 0 ? "over" : "under"}.{" "}
                    <button
                      onClick={() =>
                        apply(scheduleTodo(selected.id, { start: clampStart(selected.start!, lengthHint.minutes), duration: lengthHint.minutes }, selectedDate))
                      }
                      className="font-medium text-gold hover:brightness-110"
                    >
                      Use {fmtDuration(lengthHint.minutes)}
                    </button>
                  </p>
                )}
                {selected.note && (
                  <p className="w-full whitespace-pre-wrap break-words text-xs text-white/55">{selected.note}</p>
                )}
              </div>
            )}

            <div ref={scrollRef} className="relative h-[65vh] overflow-y-auto [color-scheme:dark] lg:h-auto lg:max-h-[calc(100vh-17rem)] lg:min-h-[24rem]">
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

                {/* the Done column: what was ticked off, plus wake, sleep and water */}
                <DayMarkers marks={marks} />

                {/* blocks, left of the Done column when there is one */}
                <div data-slot="1" data-testid="plan-column" className={`absolute inset-y-0 left-0 ${marks.length ? MARK_COLUMN_RIGHT : "right-0"}`}>
                {scheduled.map((t) => {
                  const { lane, lanes: count, shift } = lanes.get(t.id) ?? { lane: 0, lanes: 1, shift: 0 };
                  return (
                    <TimeBlock
                      key={t.id}
                      todo={t}
                      date={selectedDate}
                      lane={lane}
                      lanes={count}
                      shift={shift}
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
                </div>

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
      {focus && <FocusBar session={focus} selectedDate={selectedDate} onStop={handleStopFocus} alerted={focusAlerted} />}
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

// Weekday toggles; at least one day stays selected.
function FocusBar({
  session,
  selectedDate,
  onStop,
  alerted,
}: {
  session: FocusSession;
  selectedDate: string;
  onStop: (markDone: boolean) => void;
  alerted: React.MutableRefObject<string | null>;
}) {
  // The clock lives here so that each tick redraws this bar, not the whole page.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [session]);

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
      notify(`Time's up: ${session.text}`, { body: "Your planned time for this block is over." });
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

const MARK_PX = 22; // height of one mark pill plus a little air

// The Done column's width, and the same width kept clear of blocks. Written out in full for Tailwind.
const MARK_COLUMN = "w-[clamp(7.5rem,38%,13rem)]";
const MARK_COLUMN_RIGHT = "right-[clamp(7.5rem,38%,13rem)]";

type DayMark = { key: string; at: number; text: string; time?: string; tone: string; title?: string };

// Wake, sleep and water marks on the schedule. Drinks within the same quarter hour are added together.
function dayMarks(log: DayLog, todos: Todo[], date: string): DayMark[] {
  const marks: DayMark[] = [];
  const clock = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
  if (log.wake) marks.push({ key: "wake", at: clock(log.wake), text: `🌅 Woke ${fmtTime(clock(log.wake))}`, tone: "amber" });
  if (log.sleep) marks.push({ key: "sleep", at: clock(log.sleep), text: `😴 Sleep ${fmtTime(clock(log.sleep))}`, tone: "violet" });
  const slots = new Map<number, number>();
  for (const d of log.drinks ?? []) slots.set(snap(d.at), (slots.get(snap(d.at)) ?? 0) + d.ml);
  slots.forEach((ml, at) => marks.push({ key: `water-${at}`, at, text: `💧 ${ml} ml · ${fmtTime(at)}`, tone: "sky" }));
  // Tasks and checklist items ticked off on this day, at the time they were ticked.
  const doneToday = (ms?: number) => ms !== undefined && toDateString(new Date(ms)) === date;
  const minuteOf = (ms: number) => new Date(ms).getHours() * 60 + new Date(ms).getMinutes();
  for (const t of todos) {
    if (t.completed && doneToday(t.doneAt)) {
      const time = fmtTime(minuteOf(t.doneAt!));
      marks.push({ key: `done-${t.id}`, at: minuteOf(t.doneAt!), text: `✓ ${t.text}`, time, tone: "emerald", title: `${t.text} · done ${time}` });
    }
    for (const st of t.subtasks ?? [])
      if (st.done && doneToday(st.doneAt)) {
        const time = fmtTime(minuteOf(st.doneAt!));
        marks.push({ key: `done-${t.id}-${st.id}`, at: minuteOf(st.doneAt!), text: `✓ ${st.text}`, time, tone: "emerald", title: `${st.text} (${t.text}) · done ${time}` });
      }
  }
  return marks;
}

function DayMarkers({ marks }: { marks: DayMark[] }) {
  const tones: Record<string, string> = {
    emerald: "border-emerald-300/60 bg-emerald-400/20 text-emerald-100",
    amber: "border-amber-300/60 bg-amber-400/20 text-amber-100",
    violet: "border-violet-300/60 bg-violet-400/20 text-violet-100",
    sky: "border-sky-300/60 bg-sky-400/20 text-sky-100",
  };
  // Pills never share space: one that would land on the one above it is drawn just below it. It can
  // end up below its real time, which is why each done pill shows its own.
  const shifts = new Map<string, number>();
  let bottom = -Infinity;
  for (const m of [...marks].sort((a, b) => a.at - b.at)) {
    const y = Math.max((m.at / 60) * HOUR_PX, bottom + MARK_PX);
    shifts.set(m.key, y - (m.at / 60) * HOUR_PX);
    bottom = y;
  }
  if (!marks.length) return null;
  return (
    <>
      <div className={`pointer-events-none absolute inset-y-0 right-0 border-l border-white/10 ${MARK_COLUMN}`}>
        <div className="sticky top-0 z-[16] bg-panel px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white/45">Done</div>
      </div>
      {marks.map((m) => (
        <div
          key={m.key}
          data-testid="day-mark"
          className="pointer-events-none absolute inset-x-0 z-[15]"
          style={{ top: (m.at / 60) * HOUR_PX }}
        >
          {m.tone !== "emerald" && (
            <div className={`border-t border-dashed ${m.tone === "sky" ? "border-sky-300/40" : m.tone === "amber" ? "border-amber-300/60" : "border-violet-300/60"}`} />
          )}
          <span
            title={m.title}
            style={{ top: shifts.get(m.key) }}
            className={`absolute right-0 flex -translate-y-1/2 items-center justify-between gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium backdrop-blur ${MARK_COLUMN} ${
              m.tone === "emerald" ? "pointer-events-auto" : ""
            } ${tones[m.tone]}`}
          >
            <span className="min-w-0 truncate">{m.text}</span>
            {m.time && <span className="shrink-0 opacity-70">{m.time}</span>}
          </span>
        </div>
      ))}
    </>
  );
}

// How the day went: wake and sleep times on a clock, body weight, water against a daily goal, and a short review.
function DayLogCard({ date, version, onChange }: { date: string; version: number; onChange?: (log: DayLog) => void }) {
  const [log, setLog] = useState<DayLog>({});
  const [open, setOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [weightText, setWeightText] = useState("");
  useEffect(() => {
    const loaded = loadDayLog(date);
    setLog(loaded);
    setWeightText(loaded.weight !== undefined ? String(loaded.weight) : "");
    setNotesOpen(Boolean(loaded.well || loaded.bad || loaded.improve));
  }, [date, version]);
  useEffect(() => onChange?.(log), [log, onChange]);
  const water = log.water ?? 0;
  const litres = (ml: number) => `${(ml / 1000).toFixed(2).replace(/\.?0+$/, "")} L`;
  const hasNotes = Boolean(log.well || log.bad || log.improve);
  const waterButton = (label: string, ml: number, text: string) => (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        const d = new Date();
        setLog(addWater(date, ml, date === getTodayDate() ? d.getHours() * 60 + d.getMinutes() : undefined));
      }}
      className="flex-1 whitespace-nowrap rounded-lg border border-white/10 px-1.5 py-1 text-[11px] text-white/80 transition hover:border-gold/50 hover:text-white"
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
  const toggle = (
    <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm text-white/70 transition hover:text-white">
      <span aria-hidden className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>
        ›
      </span>
      <span className="shrink-0">Day log</span>
      {!open && (
        <span className="truncate text-xs text-white/50">
          {log.wake ? `Woke ${fmtTime(fromInputTime(log.wake)!)} · ` : ""}
          {log.weight !== undefined ? `${log.weight} kg · ` : ""}
          {litres(water)}
        </span>
      )}
      {hasNotes && !open && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold" aria-label="has notes" />}
    </button>
  );
  const items = <LogItemChips date={date} log={log} onChange={setLog} />;
  if (!open)
    return (
      <div className="mb-4 space-y-2 rounded-2xl border border-white/15 bg-white/[.05] px-3 py-2">
        <div className="flex items-center gap-2">
          {toggle}
          <div className="shrink-0">{waterButton("More water", WATER_STEP, "+ Glass")}</div>
        </div>
        {items}
      </div>
    );
  return (
    <div className="relative z-[35] mb-4 space-y-3 rounded-3xl border border-white/15 bg-white/[.05] p-3 backdrop-blur-xl sm:p-4">
      {toggle}
      {items}
      <TickTimes log={log} />
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
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
          popoverRight
          onChange={(v) => setLog(updateDayLog(date, { sleep: v || undefined }))}
        />
        <label className="flex flex-col gap-0.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 transition focus-within:border-gold/60 hover:border-white/25">
          <span className="text-xs uppercase tracking-wide text-white/50">Weight</span>
          <span className="flex items-baseline gap-1.5 text-sm font-semibold tabular-nums">
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
              className="w-full min-w-0 bg-transparent text-white placeholder-white/30 focus:outline-none"
            />
            <span className="font-normal text-white/50">kg</span>
          </span>
        </label>
        <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-x-2">
            <span className="text-xs uppercase tracking-wide text-white/50">Water</span>
            <span className="text-sm tabular-nums">
              <span className="font-semibold text-white" data-testid="water-total">
                {litres(water)}
              </span>
              <span className="text-white/40"> / {litres(WATER_GOAL)}</span>
            </span>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-white/10"
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
          <div className="flex flex-wrap gap-1.5">
            {waterButton("Less water", -WATER_STEP, "− Glass")}
            {waterButton("More water", WATER_STEP, "+ Glass")}
            {waterButton("Add a bottle", WATER_STEP * 2, "+ Bottle")}
          </div>
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

// The day's log items as one row of chips: tap to tick, or to type a number such as steps walked.
function LogItemChips({ date, log, onChange }: { date: string; log: DayLog; onChange: (log: DayLog) => void }) {
  const items = useLogItems();
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState("");
  if (!items.length) return null;
  const done = items.filter((i) => (i.kind === "tick" ? log.ticks?.[i.id] : log.counts?.[i.id])).length;
  const chip = "shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs transition";
  const off = `${chip} border-white/15 text-white/70 hover:border-gold/50 hover:text-gold`;
  const on = `${chip} border-gold/50 bg-gold/15 text-gold`;
  const save = (id: string) => {
    const n = parseInt(text.replace(/[^\d]/g, ""), 10);
    onChange(setLogCount(date, id, Number.isFinite(n) ? n : undefined));
    setEditing(null);
  };
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]" role="group" aria-label="Log items">
      <span className="shrink-0 text-xs tabular-nums text-white/50" aria-label={`${done} of ${items.length} logged`}>
        {done}/{items.length}
      </span>
      {items.map((i) => {
        if (i.kind === "tick") {
          const ticked = !!log.ticks?.[i.id];
          return (
            <button
              key={i.id}
              type="button"
              aria-pressed={ticked}
              onClick={() => {
                const d = new Date();
                onChange(setLogTick(date, i.id, !ticked, date === getTodayDate() ? d.getHours() * 60 + d.getMinutes() : undefined));
              }}
              className={ticked ? on : off}
            >
              {ticked ? "✓" : "○"} {i.label}
            </button>
          );
        }
        const n = log.counts?.[i.id];
        if (editing === i.id)
          return (
            <input
              key={i.id}
              autoFocus
              type="text"
              inputMode="numeric"
              aria-label={`${i.label}${i.unit ? `, ${i.unit}` : ""}`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => save(i.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save(i.id);
                if (e.key === "Escape") setEditing(null);
              }}
              className="w-24 shrink-0 rounded-full border border-gold/50 bg-panel px-2.5 py-1 text-xs text-white focus:outline-none"
            />
          );
        return (
          <button
            key={i.id}
            type="button"
            onClick={() => {
              setText(n ? String(n) : "");
              setEditing(i.id);
            }}
            className={n ? on : off}
          >
            {i.label}
            {n ? ` · ${n.toLocaleString("en-IN")}${i.unit ? ` ${i.unit}` : ""}` : ""}
          </button>
        );
      })}
    </div>
  );
}

// When each item was ticked, for the opened log. Ticks made after the day have no time.
function TickTimes({ log }: { log: DayLog }) {
  const items = useLogItems();
  const timed = items.filter((i) => log.ticks?.[i.id]?.at !== undefined);
  if (!timed.length) return null;
  return <p className="text-xs text-white/50">Ticked: {timed.map((i) => `${i.label} ${fmtTime(log.ticks![i.id].at!)}`).join(" · ")}</p>;
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
    <div className="relative h-28 w-28 shrink-0 drop-shadow-[0_0_18px_rgba(246,196,83,0.25)]" role="img" aria-label={`${percent}% done`}>
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

// The days around the selected one as tappable days, each with a bar for how much of it got done.
// Counts and "today" come from this browser (localStorage, local clock), so they're filled in after
// mount: the server render can't know them, and rendering them there breaks hydration.
function WeekStrip({ selectedDate, todos, onPick }: { selectedDate: string; todos: Todo[]; onPick: (date: string) => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const today = mounted ? getTodayDate() : "";
  // Three days either side, so the selected day (today, to begin with) sits in the middle.
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = shiftDate(selectedDate, i - 3);
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
