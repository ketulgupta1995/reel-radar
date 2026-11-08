"use client";

import { useEffect, useState } from "react";
import { exportPlanner, importPlanner } from "@/lib/plannerBackup";
import { REMINDER_LEADS } from "@/lib/reminders";
import { BIN_DAYS, loadBin, restoreFromBin, syncBin, type BinItem } from "@/lib/todos";
import {
  MAX_LOG_ITEMS,
  MAX_TAGS,
  addLogItem,
  addTag,
  moveLogItem,
  removeLogItem,
  removeTag,
  renameLogItem,
  renameTag,
  useLogItems,
  useTags,
  type LogItemDef,
  type TagDef,
} from "@/lib/plannerSettings";
import { formatDate } from "./planner";
import { Stats } from "./Stats";
import { Templates, type Reminders } from "./Tools";
import type { Day } from "./useDay";

export type MoreView = "menu" | "stats" | "log" | "tags" | "templates" | "reminders" | "backup" | "bin" | "sync";

const SCREENS: { id: Exclude<MoreView, "menu">; title: string; sub: string }[] = [
  { id: "stats", title: "Stats", sub: "Day log history, trends, completion, time" },
  { id: "log", title: "Day log items", sub: "The ticks and counts on Today" },
  { id: "tags", title: "Tags", sub: "Names, up to 8" },
  { id: "templates", title: "Day templates", sub: "Save a day's layout, add it to another" },
  { id: "reminders", title: "Reminders", sub: "A notification before each block" },
  { id: "backup", title: "Backup", sub: "Export or import a file" },
  { id: "bin", title: "Bin", sub: `Deleted tasks, kept ${BIN_DAYS} days` },
  { id: "sync", title: "Sync", sub: "Your other devices" },
];

const FIELD = "min-w-0 rounded-lg bg-bf-s2 px-2.5 py-1.5 text-sm font-semibold text-bf-ink placeholder:font-normal placeholder:text-bf-muted focus:outline-none focus:ring-2 focus:ring-bf-ink";
const PRIMARY = "shrink-0 rounded-[10px] bg-bf-ink px-3.5 py-2 text-xs font-black uppercase text-bf-bg disabled:opacity-40";
const PANEL = "rounded-[16px] bg-bf-s1 p-3.5";
const NOTE = "mt-2.5 font-bfm text-[11px] text-bf-muted";

const SYNC_TEXT = { idle: "Up to date when this tab opens or comes back into view", syncing: "Syncing…", synced: "Synced", error: "Couldn't reach the server. Changes stay on this device until the next sync." };

// The More tab: a plain menu, each item its own screen with today's behaviour.
export function More({ day, reminders, view, onView, onOpenDay, onOpenReview }: { day: Day; reminders: Reminders; view: MoreView; onView: (v: MoreView) => void; onOpenDay: (date: string) => void; onOpenReview: () => void }) {
  const screen = SCREENS.find((s) => s.id === view);
  return (
    <div className={`mx-auto flex flex-col gap-3 px-3 pb-36 pt-3 lg:px-6 lg:pb-12 ${view === "stats" ? "max-w-6xl" : "max-w-2xl"}`}>
      {!screen ? (
        <>
          <h2 className="text-[26px] font-black uppercase [font-stretch:125%]">More</h2>
          <ul aria-label="More screens" className="flex flex-col gap-1.5">
            {SCREENS.map((s) => (
              <li key={s.id}>
                <button onClick={() => onView(s.id)} className="flex w-full items-center gap-3 rounded-[14px] bg-bf-s1 px-3.5 py-3 text-left">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-extrabold">{s.title}</span>
                    <span className="block font-bfm text-[11px] text-bf-muted">{s.id === "sync" ? SYNC_TEXT[day.syncStatus] : s.sub}</span>
                  </span>
                  {s.id === "sync" && <SyncDot status={day.syncStatus} />}
                  {s.id === "reminders" && <span className="font-bfm text-[11px] font-bold">{reminders.lead === null ? "Off" : leadLabel(reminders.lead)}</span>}
                  <span aria-hidden className="text-bf-muted">
                    ›
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <button onClick={() => onView("menu")} className="self-start font-bfm text-xs text-bf-muted">
            ‹ More
          </button>
          <h2 className="text-[26px] font-black uppercase [font-stretch:125%]">{screen.title}</h2>
          {view === "stats" && <Stats onOpenReview={onOpenReview} onOpenToday={() => onOpenDay(day.today ?? "")} />}
          {view === "log" && <LogItems onMessage={day.flash} />}
          {view === "tags" && <Tags onMessage={day.flash} />}
          {view === "templates" && day.date && (
            <>
              <p className="font-bfm text-[11px] text-bf-muted">Saving and applying use the day open on Today: {formatDate(day.date)}.</p>
              <Templates date={day.date} onApplied={() => day.refresh()} onMessage={day.flash} />
            </>
          )}
          {view === "reminders" && <ReminderScreen reminders={reminders} />}
          {view === "backup" && <Backup day={day} />}
          {view === "bin" && <Bin day={day} />}
          {view === "sync" && <SyncScreen day={day} />}
        </>
      )}
    </div>
  );
}

function SyncDot({ status }: { status: Day["syncStatus"] }) {
  return <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${status === "error" ? "bg-bf-late" : status === "syncing" ? "animate-pulse bg-gold" : "bg-emerald-500"}`} />;
}

const leadLabel = (m: number) => (m === 0 ? "At start" : `${m} min before`);

function ReminderScreen({ reminders }: { reminders: Reminders }) {
  const options: [string, string][] = [["", "Off"], ...REMINDER_LEADS.map((m): [string, string] => [String(m), leadLabel(m)])];
  return (
    <section className={PANEL}>
      <div role="group" aria-label="Reminders" className="flex flex-wrap gap-1.5">
        {options.map(([value, label]) => {
          const on = (reminders.lead === null ? "" : String(reminders.lead)) === value;
          return (
            <button key={label} onClick={() => reminders.change(value)} aria-pressed={on} className={`rounded-[10px] px-3 py-2 text-xs font-extrabold ${on ? "bg-bf-ink text-bf-bg" : "bg-bf-s2"}`}>
              {label}
            </button>
          );
        })}
      </div>
      <p className={NOTE}>A notification on this device before each time block. Once push is set up on the server, it arrives even with the app closed; otherwise only while the planner is open. It&apos;s set per device.</p>
    </section>
  );
}

function Backup({ day }: { day: Day }) {
  const exportNow = async () => {
    const { synced } = await exportPlanner();
    day.flash(synced ? "Backup saved" : "Couldn't reach the server, so the backup only has this device's copy");
  };
  const importFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const r = await importPlanner(file);
      day.refresh();
      day.flash(
        `Imported ${r.todos} ${r.todos === 1 ? "todo" : "todos"} across ${r.days} ${r.days === 1 ? "day" : "days"}` +
          (r.daily ? ` + ${r.daily} daily ${r.daily === 1 ? "task" : "tasks"}` : "") +
          (r.logs ? ` + ${r.logs} day ${r.logs === 1 ? "log" : "logs"}` : "") +
          (r.lists || r.items ? ` + ${r.items} list ${r.items === 1 ? "item" : "items"}` : "") +
          (r.templates ? ` + ${r.templates} ${r.templates === 1 ? "template" : "templates"}` : "") +
          (r.goals ? ` + ${r.goals} ${r.goals === 1 ? "goal" : "goals"}` : "")
      );
    } catch (err) {
      day.flash(err instanceof Error ? err.message : "Could not import that file");
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <section className={PANEL}>
        <button onClick={exportNow} className={PRIMARY}>
          Export
        </button>
        <p className={NOTE}>Downloads every day, daily task, day log, list, tag, template and goal. It pulls the latest from the server first. Photos and voice notes stay on the server.</p>
      </section>
      <section className={PANEL}>
        <input type="file" accept=".json" onChange={importFile} className="hidden" id="bf-import-file" aria-label="Backup file to import" />
        <label htmlFor="bf-import-file" className={`${PRIMARY} inline-block cursor-pointer`}>
          Import
        </label>
        <p className={NOTE}>Adds what&apos;s in a planner backup, older ones included. Nothing here is deleted.</p>
      </section>
    </div>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;
const ago = (ms: number) => {
  const days = Math.floor(ms / DAY_MS);
  if (days >= 1) return `${days}d ago`;
  const hours = Math.floor(ms / 3600000);
  return hours >= 1 ? `${hours}h ago` : "just now";
};

// Tasks deleted in the last BIN_DAYS days, newest first, each with a Restore button. The bin is
// pulled from the server on opening, so tasks deleted on another device show up too.
function Bin({ day }: { day: Day }) {
  const [items, setItems] = useState<BinItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setItems(loadBin());
    syncBin().then((changed) => {
      if (changed && !cancelled) setItems(loadBin());
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const restore = async (item: BinItem) => {
    setBusy(item.todo.id);
    const back = await restoreFromBin(item.todo.id);
    setBusy(null);
    setItems(loadBin());
    day.refresh();
    if (back) day.flash(`Restored “${back.todo.text}” to ${formatDate(back.date)}`);
  };
  const now = Date.now();
  return (
    <section className={PANEL}>
      {items.length ? (
        <ul aria-label="Deleted tasks" className="flex flex-col gap-1.5">
          {items.map((item) => {
            const left = Math.max(1, Math.ceil((item.deletedAt + BIN_DAYS * DAY_MS - now) / DAY_MS));
            return (
              <li key={item.todo.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm font-bold ${item.todo.completed ? "text-bf-muted line-through" : ""}`}>{item.todo.text}</span>
                  <span className="block font-bfm text-[11px] text-bf-muted">
                    {formatDate(item.date)} · deleted {ago(now - item.deletedAt)} · gone in {left}d
                  </span>
                </span>
                <button onClick={() => restore(item)} disabled={busy !== null} aria-label={`Restore ${item.todo.text}`} className={PRIMARY}>
                  Restore
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm font-bold text-bf-muted">The bin is empty.</p>
      )}
      <p className={NOTE}>Deleted, dropped and cleared tasks wait here for {BIN_DAYS} days, then go for good. Restore puts a task back on its day.</p>
    </section>
  );
}

function SyncScreen({ day }: { day: Day }) {
  return (
    <section className={PANEL}>
      <div role="status" className="flex items-center gap-2 text-sm font-bold">
        <SyncDot status={day.syncStatus} />
        {SYNC_TEXT[day.syncStatus]}
      </div>
      <button onClick={day.sync} disabled={day.syncStatus === "syncing"} className={`${PRIMARY} mt-3`}>
        Sync now
      </button>
      <p className={NOTE}>Changes are saved on this device at once and sent in small batches. The planner also picks up other devices&apos; changes when this tab comes back into view.</p>
    </section>
  );
}

function RenameField({ label, name, onRename }: { label: string; name: string; onRename: (value: string) => string | null }) {
  const [value, setValue] = useState(label);
  const commit = () => {
    if (value.trim() === label) return;
    if (onRename(value)) setValue(label);
  };
  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      aria-label={name}
      className={`${FIELD} flex-1`}
    />
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
  const rename = (t: TagDef) => (value: string) => {
    const problem = renameTag(t.id, value);
    if (problem) onMessage(problem);
    return problem;
  };
  return (
    <section className={PANEL}>
      <ul className="flex flex-col gap-1.5">
        {tags.map((t) => (
          <li key={t.id + t.label} className="flex items-center gap-2">
            <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: t.color }} />
            <RenameField label={t.label} name={`Rename ${t.label}`} onRename={rename(t)} />
            <button onClick={() => removeTag(t.id)} aria-label={`Remove ${t.label}`} className="shrink-0 text-xs font-bold text-bf-muted">
              Remove
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="mt-2.5 flex gap-1.5">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New tag" aria-label="New tag" className={`${FIELD} flex-1`} />
        <button type="submit" disabled={tags.length >= MAX_TAGS} className={PRIMARY}>
          Add
        </button>
      </form>
      <p className={NOTE}>
        Up to {MAX_TAGS} tags, so their colours stay easy to tell apart. A removed tag stays on old tasks and in stats. In the add box, type it as #{(tags[0]?.label ?? "work").toLowerCase().replace(/\s+/g, "")}.
      </p>
    </section>
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
  const rename = (item: LogItemDef) => (value: string) => {
    const problem = renameLogItem(item.id, value);
    if (problem) onMessage(problem);
    return problem;
  };
  const arrow = "grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-bf-s2 text-sm font-bold disabled:opacity-25";
  return (
    <section className={PANEL}>
      <ul className="flex flex-col gap-1.5">
        {items.map((item, i) => (
          <li key={item.id + item.label} className="flex items-center gap-1.5">
            <span className="w-12 shrink-0 font-bfm text-[10.5px] font-bold uppercase text-bf-muted">{item.kind === "tick" ? "Tick" : (item.unit ?? "Number")}</span>
            <RenameField label={item.label} name={`Rename ${item.label}`} onRename={rename(item)} />
            <button onClick={() => moveLogItem(item.id, -1)} disabled={i === 0} aria-label={`Move ${item.label} up`} className={arrow}>
              ↑
            </button>
            <button onClick={() => moveLogItem(item.id, 1)} disabled={i === items.length - 1} aria-label={`Move ${item.label} down`} className={arrow}>
              ↓
            </button>
            <button onClick={() => removeLogItem(item.id)} aria-label={`Remove ${item.label}`} className="shrink-0 px-1 text-xs font-bold text-bf-muted">
              Remove
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="mt-2.5 flex flex-wrap gap-1.5">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New item" aria-label="New log item" className={`${FIELD} flex-1 basis-32`} />
        <select value={kind} onChange={(e) => setKind(e.target.value as LogItemDef["kind"])} aria-label="Kind of item" className={FIELD}>
          <option value="tick">Tick</option>
          <option value="number">Number</option>
        </select>
        <button type="submit" disabled={items.length >= MAX_LOG_ITEMS} className={PRIMARY}>
          Add
        </button>
      </form>
      <p className={NOTE}>Tick items are done or not each day; number items take a count, such as steps. A removed item leaves Today but keeps its history in Stats.</p>
    </section>
  );
}
