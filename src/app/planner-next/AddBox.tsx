"use client";

import { useEffect, useMemo, useState, type RefObject } from "react";
import { parseQuickAdd } from "@/lib/quickAdd";
import { addTodo, DEFAULT_DURATION, normalizeRepeat, repeatsOn, syncPlanner, weekday, type Priority, type RepeatRule } from "@/lib/todos";
import { addItem, loadLists, parseQuickItem, useListsSync, type RememberList } from "@/lib/lists";
import { useGoals, useTags, type TagDef } from "@/lib/plannerSettings";
import { quickAddChips } from "../todos/AddTaskForm";
import { RepeatPicker, repeatLabel } from "../todos/RepeatPicker";
import { DAY_NAMES, DURATIONS, fmtDuration, formatShortDate, fromInputTime, getRelativeDateLabel } from "../todos/planner";

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
  const [more, setMore] = useState(false);
  const [opts, setOpts] = useState<Options>(NO_OPTIONS);
  const tags = useTags();
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
    // Shorthand in the text wins over the options, as in the current add box.
    const q = parseQuickAdd(text);
    const to = q.date ?? date;
    const repeat: RepeatRule | false = q.repeat ?? (q.daily ? {} : opts.repeat ?? false);
    const start = q.start ?? fromInputTime(opts.time);
    const schedule = start !== null ? { start, duration: q.duration ?? opts.duration } : undefined;
    const { priority, tag, due, note } = opts;
    setOpts((o) => ({ ...NO_OPTIONS, priority: o.priority, tag: o.tag, duration: o.duration })); // priority, tag and length stay
    // Another day's month may not be on this device yet: pull it, so the task lands in its latest copy.
    if (to !== date) await syncPlanner([to]);
    addTodo(q.text || text.trim(), to, q.priority ?? priority, schedule, repeat, note, q.tag ?? tag, { due: q.due ?? (due || undefined), goalId: destination.kind === "goal" ? destination.id : undefined });
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
        {!toList && (
          <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className="rounded-lg px-1.5 py-1 font-bfm text-bf-ink underline">
            More options
          </button>
        )}
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
      {more && !toList && <MoreOptions date={date} opts={opts} onChange={setOpts} tags={tags} />}
    </form>
  );
}

type Options = { priority?: Priority; tag?: string; time: string; duration: number; repeat?: RepeatRule; due: string; note: string };
const NO_OPTIONS: Options = { time: "", duration: DEFAULT_DURATION, due: "", note: "" };
const OPT = "rounded-lg bg-bf-s2 px-2 py-1.5 text-xs font-bold text-bf-ink focus:outline-none focus:ring-2 focus:ring-bf-ink";

// The add box's options, for what the shorthand doesn't cover or for anyone who'd rather pick.
function MoreOptions({ date, opts, onChange, tags }: { date: string; opts: Options; onChange: (o: Options) => void; tags: TagDef[] }) {
  const set = (o: Partial<Options>) => onChange({ ...opts, ...o });
  return (
    <div className="flex flex-col gap-2 rounded-[14px] bg-bf-s1 p-2.5">
      <div className="flex flex-wrap gap-1.5">
        <select value={opts.priority ?? ""} onChange={(e) => set({ priority: (e.target.value || undefined) as Priority | undefined })} aria-label="Priority" className={OPT}>
          <option value="">No priority</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select value={opts.tag ?? ""} onChange={(e) => set({ tag: e.target.value || undefined })} aria-label="Tag" className={OPT}>
          <option value="">No tag</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <input type="time" value={opts.time} onChange={(e) => set({ time: e.target.value })} aria-label="Start time" className={OPT} />
        <select value={opts.duration} onChange={(e) => set({ duration: Number(e.target.value) })} aria-label="Length" className={OPT}>
          {DURATIONS.map((d) => (
            <option key={d} value={d}>
              {fmtDuration(d)}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 font-bfm text-[11px] text-bf-muted">
          due
          <input type="date" value={opts.due} disabled={!!opts.repeat} onChange={(e) => set({ due: e.target.value })} aria-label="Deadline" className={`${OPT} disabled:opacity-40`} />
        </label>
        <button type="button" aria-pressed={!!opts.repeat} onClick={() => set({ repeat: opts.repeat ? undefined : {}, due: "" })} className={opts.repeat ? `${OPT} bg-bf-ink text-bf-bg` : OPT}>
          ↻ Repeat
        </button>
      </div>
      {opts.repeat && <RepeatPicker tone="bf" value={opts.repeat} date={date} onChange={(repeat) => set({ repeat })} />}
      <textarea value={opts.note} onChange={(e) => set({ note: e.target.value })} placeholder="A note (optional)" aria-label="Note" rows={2} className={`${OPT} resize-y font-normal`} />
    </div>
  );
}
