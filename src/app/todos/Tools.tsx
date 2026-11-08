"use client";

import { useEffect, useRef, useState } from "react";
import { canAutoSchedule, dayWindow, planDay, type DayPlan, type DayWindow, type PlannedBlock } from "@/lib/autoSchedule";
import { disablePush, enablePush, loadReminderLead, notify, saveReminderLead } from "@/lib/push";
import { REMINDER_LEADS, reminderBody, reminderKey } from "@/lib/reminders";
import { applyTemplate, dueReminders, getTodayDate, loadAllDayLogs, loadTodos, saveDayAsTemplate, scheduleTodo, sortTodos, type FocusSession, type TagId, type Todo } from "@/lib/todos";
import { deleteTemplate, loadTemplates, tagColor, tagLabel, type DayTemplate } from "@/lib/plannerSettings";
import { SYNC_EVENT } from "@/lib/sync";
import { DURATIONS, clampStart, fmtDuration, fmtTime, fromInputTime, toInputTime } from "./planner";
import { focusClock } from "./CurrentCard";

const CHIP = "rounded-[10px] bg-bf-s1 px-2.5 py-1.5 text-xs font-bold";
const FIELD = "rounded-lg bg-bf-s2 px-2 py-1 text-xs font-bold text-bf-ink focus:outline-none focus:ring-2 focus:ring-bf-ink";
const PRIMARY = "rounded-[10px] bg-bf-ink px-3 py-1.5 text-xs font-bold text-bf-bg disabled:opacity-40";

// Reminders before each block: kept on this device, pushed by the server when the app is closed (once
// push is set up), and shown here while the page is open. The server's and these share a tag, so a block
// that gets both shows once.
export function useReminders(todayTodos: Todo[], now: number, flash: (text: string) => void) {
  const [lead, setLead] = useState<number | null>(null);
  const fired = useRef(new Set<string>());
  useEffect(() => {
    const saved = loadReminderLead();
    setLead(saved);
    // Keeps the server's copy current: this device's time zone, or a subscription the browser replaced.
    if (saved !== null && typeof Notification !== "undefined" && Notification.permission === "granted") void enablePush(saved);
  }, []);
  useEffect(() => {
    if (lead === null || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const today = getTodayDate();
    for (const t of dueReminders(loadTodos(today), now, lead)) {
      const key = reminderKey(today, t);
      if (fired.current.has(key)) continue;
      fired.current.add(key);
      notify(t.text, { body: reminderBody(t, now), tag: key });
    }
  }, [now, lead, todayTodos]);

  const change = async (value: string) => {
    if (value === "") {
      setLead(null);
      saveReminderLead(null);
      void disablePush();
      return;
    }
    if (typeof Notification === "undefined") return flash("This browser can't show notifications");
    const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    if (permission !== "granted") return flash("Notifications are blocked for this site");
    setLead(Number(value));
    saveReminderLead(Number(value));
    const everywhere = await enablePush(Number(value));
    flash(everywhere ? "Reminders on, even with the app closed" : "Reminders on while this page is open");
  };
  return { lead, change };
}
export type Reminders = ReturnType<typeof useReminders>;

// Tells you once when a focus session's planned time runs out.
export function useFocusAlert(focus: FocusSession | null) {
  const alerted = useRef<string | null>(null);
  useEffect(() => {
    if (!focus) return;
    const check = () => {
      if (!focusClock(focus, Date.now()).over || alerted.current === focus.todoId + focus.startedAt) return;
      alerted.current = focus.todoId + focus.startedAt;
      if (typeof Notification !== "undefined" && Notification.permission === "granted") notify(`Time's up: ${focus.text}`, { body: "Your planned time for this block is over." });
    };
    check();
    const id = setInterval(check, 15000);
    return () => clearInterval(id);
  }, [focus]);
}

// A proposed plan for the day's unscheduled tasks. Nothing is saved until it's applied.
function AutoPlan({ todos, date, onApplied, onMessage, onClose }: { todos: Todo[]; date: string; onApplied: () => void; onMessage: (text: string) => void; onClose: () => void }) {
  const [plan, setPlan] = useState<{ plan: DayPlan; window: DayWindow } | null>(null);
  useEffect(() => {
    const window = dayWindow(loadAllDayLogs(), date);
    const d = new Date();
    setPlan({ plan: planDay(sortTodos(todos), window, date === getTodayDate() ? d.getHours() * 60 + d.getMinutes() : undefined), window });
    // Planned once, when opened: later edits are the user's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!plan) return null;
  const placed = plan.plan.placed;
  const update = (id: string, change: Partial<PlannedBlock>) => setPlan({ ...plan, plan: { ...plan.plan, placed: placed.map((b) => (b.id === id ? { ...b, ...change } : b)) } });
  const repeating = todos.filter((t) => t.dailyId && !t.completed && t.start === undefined).length;
  const apply = () => {
    for (const b of placed) scheduleTodo(b.id, { start: b.start, duration: b.duration }, date);
    onApplied();
    onMessage(`Scheduled ${placed.length} ${placed.length === 1 ? "task" : "tasks"}`);
    onClose();
  };
  return (
    <section aria-label="Proposed schedule" className="rounded-[14px] bg-bf-s1 p-3 text-sm">
      <p className="text-xs text-bf-muted">
        {placed.length ? "Proposed" : "No free time"} between {fmtTime(plan.window.from)} and {fmtTime(plan.window.to)}
        {plan.window.usual ? " (your usual times)" : ""}, most important first. Change anything, then apply.
      </p>
      {placed.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {[...placed].sort((a, b) => a.start - b.start).map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-1.5">
              <span className="min-w-0 flex-1 basis-32 break-words font-bold">{b.text}</span>
              <input
                type="time"
                step={900}
                value={toInputTime(b.start)}
                onChange={(e) => {
                  const v = fromInputTime(e.target.value);
                  if (v !== null) update(b.id, { start: clampStart(v, b.duration) });
                }}
                aria-label={`Start time for “${b.text}”`}
                className={FIELD}
              />
              <select value={b.duration} onChange={(e) => update(b.id, { duration: Number(e.target.value), start: clampStart(b.start, Number(e.target.value)) })} aria-label={`Length of “${b.text}”`} className={FIELD}>
                {[...new Set([...DURATIONS, b.duration])].sort((x, y) => x - y).map((d) => (
                  <option key={d} value={d}>
                    {fmtDuration(d)}
                  </option>
                ))}
              </select>
              <button onClick={() => setPlan({ ...plan, plan: { ...plan.plan, placed: placed.filter((x) => x.id !== b.id) } })} aria-label={`Leave “${b.text}” out`} className="px-1 text-bf-muted">
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {plan.plan.unplaced.length > 0 && <p className="mt-2 text-xs text-bf-muted">Didn&apos;t fit: {plan.plan.unplaced.map((t) => t.text).join(", ")}</p>}
      {repeating > 0 && (
        <p className="mt-2 text-xs text-bf-muted">
          Left out {repeating} repeating {repeating === 1 ? "task" : "tasks"}: giving one a time sets it for every later day too.
        </p>
      )}
      <div className="mt-2.5 flex gap-1.5">
        <button onClick={apply} disabled={!placed.length} className={PRIMARY}>
          Apply
        </button>
        <button onClick={onClose} className={CHIP}>
          Cancel
        </button>
      </div>
    </section>
  );
}

// Save a day's one-off tasks and times as a layout, and add a saved one to this day.
export function Templates({ date, onApplied, onMessage }: { date: string; onApplied: () => void; onMessage: (text: string) => void }) {
  const [templates, setTemplates] = useState<DayTemplate[]>([]);
  const [name, setName] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const reload = () => setTemplates(loadTemplates());
  useEffect(() => {
    reload();
    window.addEventListener(SYNC_EVENT, reload);
    return () => window.removeEventListener(SYNC_EVENT, reload);
  }, []);
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const saved = saveDayAsTemplate(name, date);
    if (!saved) return onMessage("This day has no one-off tasks to save");
    onMessage(`Saved “${name.trim()}” with ${saved} ${saved === 1 ? "task" : "tasks"}`);
    setName("");
    reload();
  };
  const apply = (t: DayTemplate) => {
    const { added } = applyTemplate(t.id, date);
    onApplied();
    onMessage(added ? `Added ${added} ${added === 1 ? "task" : "tasks"} from “${t.name}”` : `Everything in “${t.name}” is already on this day`);
  };
  return (
    <section aria-label="Day templates" className="rounded-[14px] bg-bf-s1 p-3 text-sm">
      {templates.length === 0 ? (
        <p className="text-xs text-bf-muted">Save a day&apos;s tasks and times as a layout, then add them to any other day. Repeating tasks stay out, since they arrive on their own.</p>
      ) : (
        <ul className="flex flex-col">
          {templates.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-2 border-b border-bf-s2 py-1.5 last:border-0">
              <span className="min-w-0 flex-1 basis-24 break-words font-bold">{t.name}</span>
              <span className="font-bfm text-[11px] text-bf-muted">
                {t.items.length} {t.items.length === 1 ? "task" : "tasks"}
              </span>
              {confirming === t.id ? (
                <button
                  onClick={() => {
                    deleteTemplate(t.id);
                    setConfirming(null);
                    reload();
                  }}
                  className="text-xs font-bold text-bf-late"
                >
                  Delete it?
                </button>
              ) : (
                <button onClick={() => setConfirming(t.id)} aria-label={`Delete “${t.name}”`} className="text-xs text-bf-muted">
                  Delete
                </button>
              )}
              <button onClick={() => apply(t)} aria-label={`Apply “${t.name}”`} className={PRIMARY}>
                Apply
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={save} className="mt-2 flex gap-1.5">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Save this day as… (Workday)" aria-label="Template name" className={`${FIELD} min-w-0 flex-1 py-1.5`} />
        <button type="submit" disabled={!name.trim()} className={PRIMARY}>
          Save
        </button>
      </form>
    </section>
  );
}

// The tools above the list: auto-schedule, day templates and reminders.
export function DayTools({ todos, date, reminders, onApplied, onMessage }: { todos: Todo[]; date: string; reminders: Reminders; onApplied: () => void; onMessage: (text: string) => void }) {
  const [open, setOpen] = useState<"plan" | "templates" | null>(null);
  const toggle = (p: "plan" | "templates") => setOpen((o) => (o === p ? null : p));
  useEffect(() => setOpen(null), [date]);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {todos.some(canAutoSchedule) && (
          <button onClick={() => toggle("plan")} aria-expanded={open === "plan"} title="Place unscheduled tasks in your free time. You can change the plan before it's saved." className={CHIP}>
            ✨ Auto-schedule
          </button>
        )}
        <button onClick={() => toggle("templates")} aria-expanded={open === "templates"} className={CHIP}>
          Templates {open === "templates" ? "▴" : "▾"}
        </button>
        <select value={reminders.lead ?? ""} onChange={(e) => reminders.change(e.target.value)} aria-label="Reminders" title="Notification on this device before each block" className={`${CHIP} focus:outline-none`}>
          <option value="">🔕 No reminders</option>
          {REMINDER_LEADS.map((m) => (
            <option key={m} value={m}>
              🔔 {m === 0 ? "At start" : `${m} min before`}
            </option>
          ))}
        </select>
      </div>
      {open === "plan" && <AutoPlan todos={todos} date={date} onApplied={onApplied} onMessage={onMessage} onClose={() => setOpen(null)} />}
      {open === "templates" && <Templates date={date} onApplied={onApplied} onMessage={onMessage} />}
    </div>
  );
}

export type Filter = { show: "all" | "active" | "done"; query: string; tag: TagId | "all" };
export const NO_FILTER: Filter = { show: "all", query: "", tag: "all" };

export function filterTodos(todos: Todo[], f: Filter): Todo[] {
  const q = f.query.trim().toLowerCase();
  return todos.filter(
    (t) =>
      (f.show === "all" || (f.show === "active" ? !t.completed : t.completed)) &&
      (f.tag === "all" || t.tag === f.tag) &&
      (!q || t.text.toLowerCase().includes(q) || t.note?.toLowerCase().includes(q))
  );
}

// Narrow the day's list: all, still to do or done; words in a title or note; one tag.
export function Filters({ todos, filter, onChange }: { todos: Todo[]; filter: Filter; onChange: (f: Filter) => void }) {
  const active = todos.filter((t) => !t.completed).length;
  const tags = [...new Set(todos.map((t) => t.tag).filter((t): t is string => !!t))];
  if (filter.tag !== "all" && !tags.includes(filter.tag)) tags.push(filter.tag);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <div role="group" aria-label="Show" className="flex rounded-[10px] bg-bf-s1 p-0.5 text-xs font-bold">
        {(["all", "active", "done"] as const).map((s) => (
          <button key={s} aria-pressed={filter.show === s} onClick={() => onChange({ ...filter, show: s })} className={`rounded-lg px-2.5 py-1 capitalize ${filter.show === s ? "bg-bf-ink text-bf-bg" : "text-bf-muted"}`}>
            {s}
            {s === "active" ? ` (${active})` : s === "done" ? ` (${todos.length - active})` : ""}
          </button>
        ))}
      </div>
      <input type="search" value={filter.query} onChange={(e) => onChange({ ...filter, query: e.target.value })} placeholder="Filter this day" aria-label="Filter this day" className={`${FIELD} min-w-0 flex-1 py-1.5`} />
      {tags.length > 0 && (
        <div className="flex basis-full flex-wrap gap-1">
          {(["all", ...tags] as const).map((tag) => (
            <button
              key={tag}
              aria-pressed={filter.tag === tag}
              onClick={() => onChange({ ...filter, tag })}
              className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-bold ${filter.tag === tag ? "bg-bf-ink text-bf-bg" : "bg-bf-s1 text-bf-muted"}`}
            >
              {tag !== "all" && <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: tagColor(tag) }} />}
              {tag === "all" ? "All tags" : tagLabel(tag)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function NoMatches({ query, onSearch }: { query: string; onSearch: (q: string) => void }) {
  return (
    <p className="rounded-[14px] bg-bf-s1 p-5 text-center text-sm text-bf-muted">
      No tasks match this filter.
      {query.trim() && (
        <>
          {" "}
          <button onClick={() => onSearch(query.trim())} className="font-bold text-bf-ink underline">
            Search every day →
          </button>
        </>
      )}
    </p>
  );
}
