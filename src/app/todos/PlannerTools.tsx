"use client";

import { useEffect, useState } from "react";
import {
  MAX_LOG_ITEMS,
  MAX_TAGS,
  addLogItem,
  addTag,
  deleteTemplate,
  loadTemplates,
  moveLogItem,
  removeLogItem,
  removeTag,
  renameLogItem,
  renameTag,
  useLogItems,
  useTags,
  type DayTemplate,
  type LogItemDef,
  type TagDef,
} from "@/lib/plannerSettings";
import { SYNC_EVENT } from "@/lib/sync";
import { applyTemplate, saveDayAsTemplate, type Todo } from "@/lib/todos";

const FIELD = "min-w-0 rounded-lg border border-white/10 bg-panel px-2 py-1 text-white placeholder-white/35 focus:border-gold/50 focus:outline-none";
const SMALL_BUTTON = "shrink-0 rounded-full border border-white/20 px-3 py-1 text-white/80 hover:border-gold/50 hover:text-gold disabled:cursor-not-allowed disabled:opacity-40";

type Panel = "templates" | "tags" | "log items";

// Day templates, tag editing and the day log's items, tucked behind small buttons under the add box.
export function PlannerTools({ date, onApplied, onMessage }: { date: string; onApplied: (todos: Todo[]) => void; onMessage: (text: string) => void }) {
  const [open, setOpen] = useState<Panel | null>(null);
  const toggle = (panel: Panel) => setOpen((o) => (o === panel ? null : panel));
  return (
    <div className="mb-4 text-xs">
      <div className="flex gap-3 px-1 text-white/55">
        {(["templates", "tags", "log items"] as const).map((panel) => (
          <button key={panel} onClick={() => toggle(panel)} aria-expanded={open === panel} className="capitalize hover:text-gold">
            {panel} {open === panel ? "▴" : "▾"}
          </button>
        ))}
      </div>
      {open === "templates" && <Templates date={date} onApplied={onApplied} onMessage={onMessage} />}
      {open === "tags" && <Tags onMessage={onMessage} />}
      {open === "log items" && <LogItems onMessage={onMessage} />}
    </div>
  );
}

function Templates({ date, onApplied, onMessage }: { date: string; onApplied: (todos: Todo[]) => void; onMessage: (text: string) => void }) {
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
    if (!saved) {
      onMessage("This day has no one-off tasks to save");
      return;
    }
    onMessage(`Saved “${name.trim()}” with ${saved} ${saved === 1 ? "task" : "tasks"}`);
    setName("");
    reload();
  };

  const apply = (t: DayTemplate) => {
    const { todos, added } = applyTemplate(t.id, date);
    onApplied(todos);
    onMessage(added ? `Added ${added} ${added === 1 ? "task" : "tasks"} from “${t.name}”` : `Everything in “${t.name}” is already on this day`);
  };

  return (
    <div className="mt-2 rounded-xl border border-white/10 bg-panel/60 p-3">
      {templates.length === 0 ? (
        <p className="text-white/50">Save a day&apos;s tasks and times as a layout, then add them to any other day. Repeating tasks stay out, since they arrive on their own.</p>
      ) : (
        <ul className="divide-y divide-white/5">
          {templates.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-2 py-1.5">
              <span className="min-w-0 flex-1 basis-24 break-words text-sm text-white/85">{t.name}</span>
              <span className="text-white/45">
                {t.items.length} {t.items.length === 1 ? "task" : "tasks"}
              </span>
              {confirming === t.id ? (
                <button
                  onClick={() => {
                    deleteTemplate(t.id);
                    setConfirming(null);
                    reload();
                  }}
                  className="text-red-300 hover:text-red-200"
                >
                  Delete it?
                </button>
              ) : (
                <button onClick={() => setConfirming(t.id)} aria-label={`Delete “${t.name}”`} className="text-white/45 hover:text-white">
                  Delete
                </button>
              )}
              <button onClick={() => apply(t)} aria-label={`Apply “${t.name}”`} className={SMALL_BUTTON}>
                Apply
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={save} className="mt-2 flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Save this day as… (Workday)" aria-label="Template name" className={`${FIELD} flex-1`} />
        <button type="submit" disabled={!name.trim()} className={SMALL_BUTTON}>
          Save
        </button>
      </form>
    </div>
  );
}

function Tags({ onMessage }: { onMessage: (text: string) => void }) {
  const tags = useTags();
  const [name, setName] = useState("");
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const problem = addTag(name);
    if (problem) onMessage(problem);
    else setName("");
  };
  return (
    <div className="mt-2 rounded-xl border border-white/10 bg-panel/60 p-3">
      <ul className="space-y-1.5">
        {tags.map((t) => (
          <TagRow key={t.id + t.label} tag={t} onMessage={onMessage} />
        ))}
      </ul>
      <form onSubmit={add} className="mt-2 flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New tag" aria-label="New tag" className={`${FIELD} flex-1`} />
        <button type="submit" disabled={tags.length >= MAX_TAGS} className={SMALL_BUTTON}>
          Add
        </button>
      </form>
      <p className="mt-2 text-white/45">
        Up to {MAX_TAGS} tags, so their colours stay easy to tell apart. A removed tag stays on old tasks and in stats. In the add box, type it as #{(tags[0]?.label ?? "work").toLowerCase().replace(/\s+/g, "")}.
      </p>
    </div>
  );
}

function TagRow({ tag, onMessage }: { tag: TagDef; onMessage: (text: string) => void }) {
  const [label, setLabel] = useState(tag.label);
  const commit = () => {
    if (label.trim() === tag.label) return;
    const problem = renameTag(tag.id, label);
    if (problem) {
      onMessage(problem);
      setLabel(tag.label);
    }
  };
  return (
    <li className="flex items-center gap-2">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: tag.color }} />
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        aria-label={`Rename ${tag.label}`}
        className={`${FIELD} flex-1`}
      />
      <button onClick={() => removeTag(tag.id)} aria-label={`Remove ${tag.label}`} className="shrink-0 text-white/45 hover:text-white">
        Remove
      </button>
    </li>
  );
}

function LogItems({ onMessage }: { onMessage: (text: string) => void }) {
  const items = useLogItems();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<LogItemDef["kind"]>("tick");
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const problem = addLogItem(name, kind);
    if (problem) onMessage(problem);
    else setName("");
  };
  return (
    <div className="mt-2 rounded-xl border border-white/10 bg-panel/60 p-3">
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <LogItemRow key={item.id + item.label} item={item} first={i === 0} last={i === items.length - 1} onMessage={onMessage} />
        ))}
      </ul>
      <form onSubmit={add} className="mt-2 flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New item" aria-label="New log item" className={`${FIELD} flex-1`} />
        <select value={kind} onChange={(e) => setKind(e.target.value as LogItemDef["kind"])} aria-label="Kind of item" className={FIELD}>
          <option value="tick">Tick</option>
          <option value="number">Number</option>
        </select>
        <button type="submit" disabled={items.length >= MAX_LOG_ITEMS} className={SMALL_BUTTON}>
          Add
        </button>
      </form>
      <p className="mt-2 text-white/45">Tick items are done or not each day; number items take a count, such as steps. A removed item keeps its history.</p>
    </div>
  );
}

function LogItemRow({ item, first, last, onMessage }: { item: LogItemDef; first: boolean; last: boolean; onMessage: (text: string) => void }) {
  const [label, setLabel] = useState(item.label);
  const commit = () => {
    if (label.trim() === item.label) return;
    const problem = renameLogItem(item.id, label);
    if (problem) {
      onMessage(problem);
      setLabel(item.label);
    }
  };
  const arrow = "shrink-0 px-1 text-white/45 hover:text-white disabled:opacity-25";
  return (
    <li className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-white/45">{item.kind === "tick" ? "Tick" : item.unit ?? "Number"}</span>
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        aria-label={`Rename ${item.label}`}
        className={`${FIELD} flex-1`}
      />
      <button onClick={() => moveLogItem(item.id, -1)} disabled={first} aria-label={`Move ${item.label} up`} className={arrow}>
        ↑
      </button>
      <button onClick={() => moveLogItem(item.id, 1)} disabled={last} aria-label={`Move ${item.label} down`} className={arrow}>
        ↓
      </button>
      <button onClick={() => removeLogItem(item.id)} aria-label={`Remove ${item.label}`} className="shrink-0 text-white/45 hover:text-white">
        Remove
      </button>
    </li>
  );
}
