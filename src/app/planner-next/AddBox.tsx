"use client";

import { useEffect, useMemo, useState, type RefObject } from "react";
import { parseQuickAdd } from "@/lib/quickAdd";
import { addTodo, normalizeRepeat, repeatsOn, syncPlanner, weekday, type RepeatRule } from "@/lib/todos";
import { addItem, loadLists, parseQuickItem, useListsSync, type RememberList } from "@/lib/lists";
import { useGoals } from "@/lib/plannerSettings";
import { quickAddChips } from "../todos/AddTaskForm";
import { repeatLabel } from "../todos/RepeatPicker";
import { DAY_NAMES, formatShortDate, getRelativeDateLabel } from "../todos/planner";

// Where a new entry goes: the day shown (on its own, or as a step towards a goal), or a list.
export type Destination = { kind: "day" } | { kind: "goal"; id: string } | { kind: "list"; id: string };
const encode = (d: Destination) => (d.kind === "day" ? "day" : `${d.kind}:${d.id}`);
const decode = (v: string): Destination => {
  const [kind, id] = v.split(":") as ["goal" | "list", string];
  return v === "day" ? { kind: "day" } : { kind, id };
};

// The one add box: the shorthand and its preview as everywhere in the planner, plus where it goes.
export function AddBox({
  date,
  destination,
  onDestination,
  inputRef,
  onAdded,
  onMessage,
}: {
  date: string;
  destination: Destination;
  onDestination: (d: Destination) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  onAdded: () => void;
  onMessage: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const goals = useGoals().filter((g) => !g.doneAt);
  const [lists, setLists] = useState<RememberList[]>([]);
  useEffect(() => setLists(loadLists()), []);
  useListsSync(() => setLists(loadLists()));
  const toList = destination.kind === "list";
  const quick = useMemo(() => parseQuickAdd(text), [text]);
  const chips = toList ? [] : quickAddChips(quick);
  const item = toList ? parseQuickItem(text) : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setText("");
    inputRef.current?.focus();
    if (destination.kind === "list") {
      const list = lists.find((l) => l.id === destination.id);
      const { text: name, link, price } = parseQuickItem(text);
      addItem(destination.id, name || text.trim(), { ...(link ? { link } : {}), ...(price !== undefined ? { price } : {}) });
      onMessage(`Added to ${list?.name ?? "the list"}`);
      return;
    }
    const q = parseQuickAdd(text);
    const to = q.date ?? date;
    const repeat: RepeatRule | false = q.repeat ?? (q.daily ? {} : false);
    const schedule = q.start !== undefined ? { start: q.start, duration: q.duration } : undefined;
    // Another day's month may not be on this device yet: pull it, so the task lands in its latest copy.
    if (to !== date) await syncPlanner([to]);
    addTodo(q.text || text.trim(), to, q.priority, schedule, repeat, undefined, q.tag, { due: q.due, goalId: destination.kind === "goal" ? destination.id : undefined });
    onAdded();
    const rule = repeat ? normalizeRepeat(repeat) : null;
    if (rule?.monthDay && !repeatsOn({ ...rule, id: "", text: "", startDate: to }, to)) onMessage(`${repeatLabel(rule)}. Nothing to do until then.`);
    else if (to !== date) onMessage(`Added to ${DAY_NAMES[weekday(to)]}, ${formatShortDate(to)}`);
    else if (destination.kind === "goal") onMessage(`Added a step for ${goals.find((g) => g.id === destination.id)?.name ?? "the goal"}`);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex gap-1.5">
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Add a task"
          placeholder={toList ? "Add to the list, e.g. Headphones ₹2,999" : `Add to ${getRelativeDateLabel(date)}, e.g. Gym 6pm 45m #health`}
          autoComplete="off"
          className="min-w-0 flex-1 rounded-[14px] border-2 border-bf-s2 bg-bf-bg px-3.5 py-3 text-base font-bold text-bf-ink placeholder:font-medium placeholder:text-bf-muted focus:border-bf-ink focus:outline-none"
        />
        <button type="submit" className="shrink-0 rounded-[14px] bg-bf-ink px-4 font-black uppercase text-bf-bg [font-stretch:115%]">
          Add
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
        <label className="flex items-center gap-1.5 font-bfm text-bf-muted">
          to
          <select
            value={encode(destination)}
            onChange={(e) => onDestination(decode(e.target.value))}
            aria-label="Add to"
            className="max-w-[14rem] rounded-lg bg-bf-s2 px-2 py-1 font-bfd text-xs font-bold text-bf-ink focus:outline-none"
          >
            <option value="day">{getRelativeDateLabel(date)}</option>
            {goals.length > 0 && (
              <optgroup label="A step towards a goal">
                {goals.map((g) => (
                  <option key={g.id} value={`goal:${g.id}`}>
                    Goal · {g.name}
                  </option>
                ))}
              </optgroup>
            )}
            {lists.length > 0 && (
              <optgroup label="A list">
                {lists.map((l) => (
                  <option key={l.id} value={`list:${l.id}`}>
                    List · {l.icon ? `${l.icon} ` : ""}
                    {l.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <span data-testid="quick-add-preview" className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <span key={c} className="rounded-lg bg-gold px-2 py-0.5 font-bfm font-bold text-bf-ontag">
              {c}
            </span>
          ))}
          {item && (item.price !== undefined || item.link) && (
            <span className="rounded-lg bg-gold px-2 py-0.5 font-bfm font-bold text-bf-ontag">
              {item.price !== undefined ? `₹${item.price.toLocaleString("en-IN")}` : ""}
              {item.price !== undefined && item.link ? " · " : ""}
              {item.link ? "🔗 link" : ""}
            </span>
          )}
          {!text.trim() && !toList && <span className="font-bfm text-bf-muted">6pm · 45m · #work · !high · fri · by fri · daily</span>}
        </span>
      </div>
    </form>
  );
}
