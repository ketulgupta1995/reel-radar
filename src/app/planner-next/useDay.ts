"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  getDueTodos,
  getFocusSession,
  getOverdueTodos,
  getTodayDate,
  getUnfinishedFromYesterday,
  loadAllTodos,
  loadDailyTasks,
  loadDayLog,
  loadTodosWithDaily,
  restoreTodo,
  shiftDate,
  syncPlanner,
  syncTrayPlanner,
  usePlannerSync,
  weekday,
  type DayLog,
  type FocusSession,
  type OverdueTodo,
  type Todo,
} from "@/lib/todos";
import { computeGoalProgress } from "@/lib/plannerInsights";
import { weekStart } from "@/lib/plannerStats";
import { loadGoals, useGoals, useTags, type Goal } from "@/lib/plannerSettings";

export type Attention = { due: OverdueTodo[]; overdue: OverdueTodo[]; yesterday: Todo[]; stuck: Goal[] };
const NO_ATTENTION: Attention = { due: [], overdue: [], yesterday: [], stuck: [] };

// Active goals with nothing left to do: no open one-off step and no linked repeat.
function stuckGoals(today: string): Goal[] {
  const goals = loadGoals().filter((g) => !g.doneAt);
  if (!goals.length) return [];
  const days = loadAllTodos();
  const daily = loadDailyTasks();
  return goals.filter((g) => {
    const p = computeGoalProgress(g.id, days, daily, weekStart(today), shiftDate(weekStart(today), 6));
    return p.open.length === 0 && p.repeats.length === 0;
  });
}

// Everything the planner shows for one day, kept current with this device's storage and the server.
// `date` is null until mounted: today depends on the browser's clock, so it's read in an effect.
export function useDay() {
  const [date, setDate] = useState<string | null>(null);
  const [today, setToday] = useState<string | null>(null);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [log, setLog] = useState<DayLog>({});
  const [attention, setAttention] = useState<Attention>(NO_ATTENTION);
  const [reviewDue, setReviewDue] = useState(false);
  const [now, setNow] = useState(0);
  const [focus, setFocus] = useState<FocusSession | null>(null);
  const [message, setMessage] = useState<{ text: string; undo?: () => void } | null>(null);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "synced" | "error">("idle");
  const pastSynced = useRef(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useTags(); // redraw when a tag changes: rows read tagLabel()
  useGoals();

  useEffect(() => {
    const t = getTodayDate();
    setToday(t);
    setDate(t);
    setFocus(getFocusSession());
    const tick = () => {
      const d = new Date();
      setNow(d.getHours() * 60 + d.getMinutes());
      setToday(getTodayDate());
    };
    tick();
    const id = setInterval(tick, 60000);
    return () => {
      clearInterval(id);
      clearTimeout(flashTimer.current);
    };
  }, []);

  const refresh = (d = date) => {
    if (!d || !today) return;
    setTodos(loadTodosWithDaily(d));
    setLog(loadDayLog(d));
    const isToday = d === today;
    // A task with a deadline coming up shows there, not in both groups.
    const due = isToday ? getDueTodos(today) : [];
    setAttention({
      due,
      overdue: isToday ? getOverdueTodos(today).filter((o) => !due.some((x) => x.todo.id === o.todo.id)) : [],
      yesterday: isToday ? [] : getUnfinishedFromYesterday(d),
      stuck: isToday ? stuckGoals(today) : [],
    });
    setReviewDue(weekday(today) === 0 && !loadDayLog(today).reviewedAt);
  };

  // The day shown, and the day before for "add from yesterday".
  const dates = useMemo(() => (date ? [date, shiftDate(date, -1)] : []), [date]);

  useEffect(() => {
    if (!date || !today) return;
    let cancelled = false;
    refresh(date);
    // Sync before reading again, so repeating tasks are copied into the latest version of the day.
    syncPlanner(dates).then(() => {
      if (cancelled) return;
      refresh(date);
      // Overdue and due tasks can be in a month this device doesn't have yet. Once per visit.
      if (pastSynced.current) return;
      pastSynced.current = true;
      syncTrayPlanner().then((changed) => {
        if (changed && !cancelled) refresh(date);
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, today]);

  // Edits from another device, picked up when this tab comes back into view.
  usePlannerSync(dates, () => refresh());

  const flash = (text: string, undo?: () => void) => {
    setMessage({ text, undo });
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setMessage(null), undo ? 6000 : 3000);
  };

  // A task taken off a day can be put back from the message that says so.
  const removed = (todo: Todo, from: string, text: string) =>
    flash(text, () => {
      restoreTodo(todo, from);
      setMessage(null);
      refresh();
    });

  const sync = async () => {
    setSyncStatus("syncing");
    const result = await syncPlanner(dates, true);
    refresh();
    setSyncStatus(result === null ? "error" : "synced");
    setTimeout(() => setSyncStatus("idle"), 2000);
  };

  return { date, setDate, today, todos, log, setLog, attention, reviewDue, now, focus, setFocus, message, setMessage, flash, removed, refresh, sync, syncStatus };
}

export type Day = ReturnType<typeof useDay>;
