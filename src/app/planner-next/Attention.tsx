"use client";

import { useState, type ReactNode } from "react";
import { carryOverFromYesterday, carryOverdueTo, deleteTodo, moveTodoToDate, postponeCount, SLIPPING_AFTER, toggleTodo, type OverdueTodo } from "@/lib/todos";
import type { Goal } from "@/lib/plannerSettings";
import { dueLabel } from "../todos/Deadlines";
import { formatShortDate } from "../todos/planner";
import type { Day } from "./useDay";

const SMALL = "rounded-[9px] bg-bf-s2 px-2.5 py-1.5 text-xs font-bold";
const PRIMARY = "rounded-[9px] bg-gold px-2.5 py-1.5 text-xs font-bold text-bf-ontag";

function Group({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="mt-2.5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="font-bfm text-[11px] uppercase tracking-[.08em] text-bf-muted">{title}</h3>
        {action}
      </div>
      <ul>{children}</ul>
    </div>
  );
}

function Item({ text, info, late, children }: { text: string; info: string; late?: boolean; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2 border-t border-bf-s2 py-2">
      <div className={`min-w-0 flex-1 break-words text-sm font-semibold ${late ? "text-bf-late" : ""}`}>
        {text}
        <small className="block text-[11.5px] font-normal text-bf-muted">{info}</small>
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-1">{children}</div>
    </li>
  );
}

// One row for everything that needs a decision: late and due-soon deadlines, overdue tasks, yesterday's
// unfinished ones (on another day than today) and goals with no next step. Red when something is late.
export function Attention({ day, onAddStep }: { day: Day; onAddStep: (goal: Goal) => void }) {
  const [open, setOpen] = useState(false);
  const { attention, date, today, refresh, flash, removed } = day;
  if (!date || !today) return null;
  const late = attention.due.filter((d) => d.todo.due! < today);
  const soon = attention.due.filter((d) => d.todo.due! >= today);
  const count = attention.due.length + attention.overdue.length + attention.yesterday.length + attention.stuck.length;
  if (!count) return null;

  const done = ({ todo, date: from }: OverdueTodo) => {
    toggleTodo(todo.id, from);
    refresh();
    flash(`Done: ${todo.text}`);
  };
  const toToday = ({ todo, date: from }: OverdueTodo) => {
    moveTodoToDate(todo.id, from, date);
    refresh();
    flash("Moved to today");
  };
  const carry = (items: OverdueTodo[]) => {
    carryOverdueTo(date, items);
    refresh();
    flash(`Moved ${items.length} ${items.length === 1 ? "task" : "tasks"} to today`);
  };
  const drop = ({ todo, date: from }: OverdueTodo) => {
    deleteTodo(todo.id, from);
    refresh();
    removed(todo, from, `Dropped “${todo.text}”`);
  };
  const fromYesterday = (ids?: string[]) => {
    const n = ids ? ids.length : attention.yesterday.length;
    carryOverFromYesterday(date, ids);
    refresh();
    flash(`Added ${n} ${n === 1 ? "task" : "tasks"} from the day before`);
  };
  const deadline = (d: OverdueTodo) => (
    <Item key={d.todo.id} text={d.todo.text} info={`${dueLabel(d.todo.due!, today)}${d.date !== date ? ` · planned ${formatShortDate(d.date)}` : ""}`} late={d.todo.due! < today}>
      <button onClick={() => done(d)} className={PRIMARY}>
        Done
      </button>
      {d.date !== date && (
        <button onClick={() => toToday(d)} className={SMALL}>
          Today
        </button>
      )}
    </Item>
  );

  return (
    <section aria-label="Needs attention" className={open ? "rounded-[14px] bg-bf-s1 px-3.5 pb-2.5" : ""}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`flex w-full items-center gap-2.5 rounded-[14px] px-3.5 py-3 text-left font-bold ${late.length ? "bg-bf-late text-white" : "bg-bf-s1"} ${open ? "-mx-3.5 w-[calc(100%+1.75rem)]" : ""}`}
      >
        <span className="font-bfm text-xl tabular-nums">{count}</span>
        <span className="flex-1">
          {late.length ? `${late.length} late · ` : ""}
          {count === 1 ? "needs" : "need"} attention
        </span>
        <span aria-hidden>{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <>
          {late.length > 0 && <Group title="Late">{late.map(deadline)}</Group>}
          {soon.length > 0 && <Group title="Due soon">{soon.map(deadline)}</Group>}
          {attention.overdue.length > 0 && (
            <Group
              title="Overdue"
              action={
                <button onClick={() => carry(attention.overdue)} className={SMALL}>
                  All to today
                </button>
              }
            >
              {attention.overdue.map((o) => (
                <Item
                  key={o.todo.id}
                  text={o.todo.text}
                  info={postponeCount(o.todo) >= SLIPPING_AFTER ? `Postponed ${postponeCount(o.todo)} times. Drop it or break it down?` : `Planned for ${formatShortDate(o.date)}`}
                >
                  <button onClick={() => carry([o])} className={PRIMARY}>
                    Today
                  </button>
                  <button onClick={() => drop(o)} className={SMALL}>
                    Drop
                  </button>
                </Item>
              ))}
            </Group>
          )}
          {attention.yesterday.length > 0 && (
            <Group
              title="From the day before"
              action={
                <button onClick={() => fromYesterday()} className={SMALL}>
                  Add all
                </button>
              }
            >
              {attention.yesterday.map((t) => (
                <Item key={t.id} text={t.text} info="Not done the day before">
                  <button onClick={() => fromYesterday([t.id])} className={PRIMARY}>
                    Add
                  </button>
                </Item>
              ))}
            </Group>
          )}
          {attention.stuck.length > 0 && (
            <Group title="Goals with no next step">
              {attention.stuck.map((g) => (
                <Item key={g.id} text={g.name} info="Add a step to keep it moving">
                  <button onClick={() => onAddStep(g)} className={PRIMARY}>
                    Add a step
                  </button>
                </Item>
              ))}
            </Group>
          )}
        </>
      )}
    </section>
  );
}
