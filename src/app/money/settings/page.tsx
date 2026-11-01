"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CATEGORIES,
  ME,
  deleteAllMoney,
  exportMoney,
  exportMoneyCsv,
  loadSettings,
  peopleOf,
  removePerson,
  restoreMoney,
  savePerson,
  setValue,
  syncMoney,
  useMoneySync,
  valueOf,
  type MoneySettings,
  type Person,
} from "@/lib/money";
import { Avatar, CARD, FIELD, MoneyShell } from "../shared";

const splitNames = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export default function MoneySettingsPage() {
  const [settings, setSettings] = useState<MoneySettings | null>(null);
  const reload = useCallback(() => setSettings(loadSettings()), []);

  useEffect(() => {
    reload();
    syncMoney().then((changed) => {
      if (changed) reload();
    });
  }, [reload]);
  useMoneySync(reload);

  if (!settings) {
    return <MoneyShell active="settings" />;
  }
  const people = peopleOf(settings);
  const [me, ...family] = people;

  return (
    <MoneyShell active="settings" wide={false}>
      <h1 className="text-2xl font-bold sm:text-3xl">Settings</h1>
      <section className={CARD}>
        <h2 className="flex items-center gap-2 font-semibold">
          <Avatar person={me} people={people} /> You
        </h2>
        <p className="mb-3 mt-1 text-sm text-white/60">
          Your name as it shows in Google Pay, so a payment a family member receives from you counts as paying them back. Separate several with commas.
        </p>
        <NamesField
          label="Your names in Google Pay"
          value={me.aliases.join(", ")}
          placeholder="Your full name"
          onSave={(v) => {
            savePerson({ id: ME, name: "Me", aliases: splitNames(v) });
            reload();
          }}
        />
      </section>

      <section className={CARD}>
        <h2 className="font-semibold">Family</h2>
        <p className="mb-3 mt-1 text-sm text-white/60">
          People whose spending you pay back. Add every name they show up under in a statement, so the money you send them is matched.
        </p>
        <ul className="space-y-3">
          {family.map((p) => (
            <FamilyRow key={p.id} person={p} people={people} onChange={reload} />
          ))}
        </ul>
        <AddPerson onAdd={reload} />
      </section>

      <section className={CARD}>
        <h2 className="font-semibold">Monthly money</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <AmountField label="Monthly income" value={valueOf(settings, "income")} onSave={(v) => setSettings(setValue("income", v))} />
          <AmountField label="Savings goal" value={valueOf(settings, "goal")} onSave={(v) => setSettings(setValue("goal", v))} />
          <AmountField label="Spending limit" value={valueOf(settings, "limit:total")} onSave={(v) => setSettings(setValue("limit:total", v))} />
        </div>
      </section>

      <section className={CARD}>
        <h2 className="font-semibold">Limits by category</h2>
        <p className="mb-3 mt-1 text-sm text-white/60">Leave blank for no limit. These count everyone&apos;s spending, sisters included.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {CATEGORIES.map((c) => (
            <AmountField
              key={c.id}
              label={`${c.icon} ${c.label}`}
              value={valueOf(settings, `limit:${c.id}`)}
              onSave={(v) => setSettings(setValue(`limit:${c.id}`, v))}
            />
          ))}
        </div>
      </section>

      <Backup onRestored={reload} />
      <DeleteAll onDeleted={reload} />
    </MoneyShell>
  );
}

const OUTLINE = "rounded-lg border border-white/15 px-4 py-2 text-sm text-white/80 hover:border-gold/40 hover:text-gold";

function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function Backup({ onRestored }: { onRestored: () => void }) {
  const [message, setMessage] = useState("");
  const restore = async (file: File | undefined) => {
    if (!file) return;
    try {
      const count = await restoreMoney(await readText(file));
      setMessage(`Restored ${count} transaction${count === 1 ? "" : "s"} and the settings from the backup.`);
      onRestored();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Couldn't read that file.");
    }
  };
  return (
    <section className={CARD}>
      <h2 className="font-semibold">Backup &amp; export</h2>
      <p className="mb-3 mt-1 text-sm text-white/60">
        A backup holds every transaction, family member, limit and learned category. The CSV lists every transaction, for Excel or Google Sheets.
      </p>
      <div className="flex flex-wrap gap-2">
        <button onClick={exportMoney} className={OUTLINE}>
          Download backup (JSON)
        </button>
        <button onClick={exportMoneyCsv} className={OUTLINE}>
          Download transactions (CSV)
        </button>
        <label className={`${OUTLINE} cursor-pointer`}>
          Restore from backup
          <input
            aria-label="Backup file"
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              void restore(e.target.files?.[0]);
              e.target.value = "";
            }}
            className="sr-only"
          />
        </label>
      </div>
      <p className="mt-2 text-xs text-white/40">Restoring adds to what&apos;s here; nothing is deleted.</p>
      {message && (
        <p role="status" className="mt-3 text-sm text-white/70">
          {message}
        </p>
      )}
    </section>
  );
}

// Deleting everything takes a second click, since it can't be undone.
function DeleteAll({ onDeleted }: { onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const run = async () => {
    setBusy(true);
    const ok = await deleteAllMoney();
    setBusy(false);
    setConfirming(false);
    setMessage(ok ? "All money data was deleted." : "Couldn't reach the server, so nothing was deleted. Try again when you're online.");
    onDeleted();
  };
  return (
    <section className={CARD}>
      <h2 className="font-semibold text-red-300">Delete all data</h2>
      <p className="mb-3 mt-1 text-sm text-white/60">
        Removes every transaction, family member, limit and learned category from the Money app, on all your devices. This can&apos;t be undone.
      </p>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-red-300">Delete everything?</span>
          <button onClick={run} disabled={busy} className="rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
            {busy ? "Deleting…" : "Yes, delete everything"}
          </button>
          <button onClick={() => setConfirming(false)} disabled={busy} className="rounded-lg px-4 py-2 text-sm text-white/70 hover:text-white disabled:opacity-40">
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => {
            setMessage("");
            setConfirming(true);
          }}
          className="rounded-lg border border-red-500/40 px-4 py-2 text-sm text-red-300 hover:bg-red-500/10"
        >
          Delete all money data
        </button>
      )}
      {message && (
        <p role="status" className="mt-3 text-sm text-white/70">
          {message}
        </p>
      )}
    </section>
  );
}

// A rupee amount, saved when the field loses focus.
function AmountField({ label, value, onSave }: { label: string; value: number | undefined; onSave: (v: number | undefined) => void }) {
  const [text, setText] = useState(value ? String(value) : "");
  useEffect(() => setText(value ? String(value) : ""), [value]);
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-white/70">{label}</span>
      <input
        aria-label={label}
        inputMode="decimal"
        placeholder="₹"
        value={text}
        onChange={(e) => setText(e.target.value.replace(/[^\d.]/g, ""))}
        onBlur={() => {
          const n = Number(text);
          if ((n || undefined) !== value) onSave(n > 0 ? n : undefined);
        }}
        className={`${FIELD} w-full`}
      />
    </label>
  );
}

function NamesField({ label, value, placeholder, onSave }: { label: string; value: string; placeholder: string; onSave: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      aria-label={label}
      placeholder={placeholder}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onSave(text)}
      className={`${FIELD} w-full`}
    />
  );
}

function FamilyRow({ person, people, onChange }: { person: Person; people: Person[]; onChange: () => void }) {
  return (
    <li className="space-y-2 rounded-2xl border border-white/5 bg-black/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2.5 font-medium">
          <Avatar person={person} people={people} />
          {person.name}
        </span>
        <button
          onClick={() => {
            removePerson(person.id);
            onChange();
          }}
          aria-label={`Remove ${person.name}`}
          className="text-xs text-white/45 hover:text-red-400"
        >
          Remove
        </button>
      </div>
      <NamesField
        label={`${person.name}'s names in Google Pay`}
        value={person.aliases.join(", ")}
        placeholder="Names in Google Pay, comma separated"
        onSave={(v) => {
          savePerson({ ...person, aliases: splitNames(v) });
          onChange();
        }}
      />
    </li>
  );
}

function AddPerson({ onAdd }: { onAdd: () => void }) {
  const [name, setName] = useState("");
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    savePerson({ name, aliases: [name] });
    setName("");
    onAdd();
  };
  return (
    <form onSubmit={add} className="mt-3 flex gap-2">
      <input aria-label="Name" placeholder="Name, e.g. Priya Sharma" value={name} onChange={(e) => setName(e.target.value)} className={`${FIELD} min-w-0 flex-1`} />
      <button type="submit" disabled={!name.trim()} className="rounded-xl bg-gold px-4 py-2 text-sm font-semibold text-ink disabled:opacity-40">
        Add
      </button>
    </form>
  );
}
