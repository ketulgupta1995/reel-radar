"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AppSwitcher } from "@/components/AppSwitcher";
import {
  LIST_ICONS,
  STARTER_LISTS,
  addItem,
  addList,
  cleanLink,
  clearDone,
  deleteItem,
  deleteList,
  getItem,
  linkHost,
  loadItems,
  loadLists,
  openCounts,
  parsePrice,
  parseQuickItem,
  planItem,
  searchItems,
  syncLists,
  toggleItem,
  totalPrice,
  updateItem,
  updateList,
  useListsSync,
  type ListItem,
  type RememberList,
} from "@/lib/lists";
import { MAX_ITEM_MEDIA, deleteMedia, shrinkImage, uploadMedia, type MediaRef } from "@/lib/media";
import { MediaStrip, VoiceButton } from "./media";

const SELECTED_KEY = "reel-radar-lists-selected";
const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const dropMedia = (media: MediaRef[]) => {
  if (media.length) void deleteMedia(media.map((m) => m.id));
};

export default function ListsPage() {
  const [mounted, setMounted] = useState(false);
  const [lists, setLists] = useState<RememberList[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [items, setItems] = useState<ListItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [creating, setCreating] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const photoTarget = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null);

  const selected = lists.find((l) => l.id === selectedId);

  // Read everything from localStorage again (after a change here or a sync). `pick` switches list.
  const refresh = useCallback((pick?: string) => {
    const all = loadLists();
    const want = pick ?? selectedRef.current;
    const id = all.find((l) => l.id === want)?.id ?? all[0]?.id ?? null;
    selectedRef.current = id;
    setLists(all);
    setCounts(openCounts());
    setSelectedId(id);
    setItems(id ? loadItems(id) : []);
  }, []);

  useEffect(() => {
    let saved: string | undefined;
    try {
      saved = localStorage.getItem(SELECTED_KEY) ?? undefined;
    } catch {}
    refresh(saved);
    setMounted(true);
    syncLists().then((changed) => {
      if (changed) refresh();
    });
  }, [refresh]);

  useListsSync(() => refresh());

  useEffect(() => {
    if (!mounted || !selectedId) return;
    try {
      localStorage.setItem(SELECTED_KEY, selectedId);
    } catch {}
  }, [mounted, selectedId]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 2500);
    return () => clearTimeout(t);
  }, [notice]);

  const pick = (id: string) => {
    setOpenId(null);
    setQuery("");
    refresh(id);
  };

  function createList(name: string, icon?: string) {
    const list = addList(name, icon);
    setCreating(false);
    refresh(list.id);
  }

  function addFromDraft(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !draft.trim()) return;
    const { text, ...extra } = parseQuickItem(draft);
    addItem(selected.id, text, extra);
    setDraft("");
    refresh();
  }

  // Upload a photo or voice note, then attach it to `itemId`, or to a new item named after the
  // add box (or "Photo"/"Voice note") when there's no item yet. Nothing is added if the upload fails.
  async function attach(itemId: string | null, blob: Blob, seconds?: number) {
    if (!selected) return;
    setError("");
    setBusy(seconds ? "Saving voice note…" : "Uploading photo…");
    try {
      const ref = await uploadMedia(seconds ? blob : await shrinkImage(blob), seconds);
      const current = itemId ? getItem(itemId) : undefined;
      if (current) {
        updateItem(current.id, { media: [...(current.media ?? []), ref] });
      } else {
        const typed = parseQuickItem(draft);
        const { text, ...extra } = typed.text ? typed : { ...typed, text: ref.kind === "image" ? "Photo" : "Voice note" };
        const item = addItem(selected.id, text, { ...extra, media: [ref] });
        setDraft("");
        setOpenId(item.id);
      }
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy("");
    }
  }

  function choosePhoto(itemId: string | null) {
    photoTarget.current = itemId;
    photoInput.current?.click();
  }

  async function onPhotoChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) await attach(photoTarget.current, file);
  }

  const results = query.trim() ? searchItems(query) : null;
  const shown = results ?? items;
  const open = shown.filter((i) => !i.done);
  const done = shown.filter((i) => i.done);
  const total = totalPrice(items);
  const listName = (id: string) => {
    const l = lists.find((x) => x.id === id);
    return l ? `${l.icon ?? ""} ${l.name}`.trim() : "";
  };

  const rowProps = {
    lists,
    busy: !!busy,
    onToggle: (id: string) => {
      toggleItem(id);
      refresh();
    },
    onOpen: (id: string) => setOpenId((cur) => (cur === id ? null : id)),
    onChange: () => refresh(),
    onDelete: (id: string) => {
      dropMedia(deleteItem(id));
      setOpenId(null);
      refresh();
    },
    onPhoto: choosePhoto,
    onVoice: (id: string, blob: Blob, seconds: number) => attach(id, blob, seconds),
    onPlan: (item: ListItem) => {
      planItem(item);
      setNotice(`Added “${item.text}” to today's tasks`);
    },
  };

  return (
    <main className="relative min-h-screen overflow-x-clip bg-[#090910] text-white">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-0 bg-[radial-gradient(ellipse_at_top_left,rgba(246,196,83,0.10),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(139,92,246,0.14),transparent_55%)]" />
      <header className="sticky top-0 z-40 border-b border-white/10 bg-white/[.03] backdrop-blur-xl">
        <nav className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3 sm:px-6 sm:py-4">
          <AppSwitcher current="planner" />
          <Link href="/todos" className="text-sm text-white/70 transition hover:text-gold">
            ← Daily Planner
          </Link>
        </nav>
      </header>

      <input ref={photoInput} type="file" accept="image/*" onChange={onPhotoChosen} className="hidden" data-testid="photo-input" />

      <div className="relative mx-auto max-w-3xl px-4 pb-24 pt-5 sm:px-6 sm:py-8">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold sm:text-3xl">Lists</h1>
            <p className="mt-1 text-sm text-white/60">Things to remember that don&apos;t belong to a day.</p>
          </div>
          {mounted && lists.length > 0 && (
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search all lists"
              aria-label="Search all lists"
              className="h-9 w-full rounded-full border border-white/15 bg-white/5 px-4 text-sm outline-none placeholder:text-white/40 focus:border-gold/50 sm:w-56"
            />
          )}
        </div>

        {!mounted ? null : lists.length === 0 ? (
          <section className="rounded-2xl border border-white/10 bg-white/[.04] p-6 text-center">
            <p className="text-lg font-semibold">Start a list</p>
            <p className="mt-1 text-sm text-white/60">Pick one to begin, or name your own.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {STARTER_LISTS.map((s) => (
                <button
                  key={s.name}
                  onClick={() => createList(s.name, s.icon)}
                  className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm hover:border-gold/50 hover:text-gold"
                >
                  {s.icon} {s.name}
                </button>
              ))}
            </div>
            <div className="mx-auto mt-4 max-w-sm">
              <NewListForm onCreate={createList} />
            </div>
          </section>
        ) : (
          <>
            {/* List chips */}
            <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
              {lists.map((l) => (
                <button
                  key={l.id}
                  onClick={() => pick(l.id)}
                  aria-pressed={!results && l.id === selected?.id}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm transition ${
                    !results && l.id === selected?.id
                      ? "border-gold/60 bg-gold font-semibold text-black"
                      : "border-white/15 bg-white/5 text-white/80 hover:border-white/30"
                  }`}
                >
                  {l.icon && <span>{l.icon}</span>}
                  {l.name}
                  {counts[l.id] ? <span className="text-xs opacity-70">{counts[l.id]}</span> : null}
                </button>
              ))}
              <button
                onClick={() => setCreating((c) => !c)}
                className="shrink-0 rounded-full border border-dashed border-white/25 px-3.5 py-1.5 text-sm text-white/70 hover:border-gold/50 hover:text-gold"
              >
                + New list
              </button>
            </div>
            {creating && (
              <div className="mb-4 rounded-2xl border border-white/10 bg-white/[.04] p-4">
                <NewListForm onCreate={createList} onCancel={() => setCreating(false)} />
              </div>
            )}

            {results ? (
              <p className="mb-3 text-sm text-white/60">
                {results.length ? `${results.length} found in all lists` : "Nothing matches."}
              </p>
            ) : (
              selected && (
                <>
                  <ListHeader
                    key={selected.id}
                    list={selected}
                    total={total}
                    onChange={() => refresh()}
                    onDelete={() => {
                      dropMedia(deleteList(selected.id));
                      refresh();
                    }}
                  />
                  <form onSubmit={addFromDraft} className="mb-4 flex gap-2">
                    <input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="Add something… (a price like ₹999 or a link works too)"
                      aria-label="New item"
                      className="h-10 min-w-0 flex-1 rounded-xl border border-white/15 bg-white/5 px-3 text-sm outline-none placeholder:text-white/40 focus:border-gold/50"
                    />
                    <button
                      type="button"
                      onClick={() => choosePhoto(null)}
                      disabled={!!busy}
                      title="Add a photo"
                      aria-label="Add a photo"
                      className="h-10 rounded-xl border border-white/15 bg-white/5 px-3 text-sm text-white/80 hover:border-gold/40 hover:text-gold disabled:opacity-40"
                    >
                      📷
                    </button>
                    <VoiceButton disabled={!!busy} onRecorded={(blob, s) => attach(null, blob, s)} />
                    <button
                      type="submit"
                      disabled={!draft.trim()}
                      className="h-10 rounded-xl bg-gold px-4 text-sm font-semibold text-black disabled:opacity-40"
                    >
                      Add
                    </button>
                  </form>
                </>
              )
            )}

            {(busy || error || notice) && (
              <p role="status" className={`mb-3 text-sm ${error ? "text-red-300" : busy ? "text-white/60" : "text-green-300"}`}>
                {error || busy || notice}
              </p>
            )}

            {!results && !open.length && !done.length && (
              <p className="py-10 text-center text-sm text-white/50">Nothing here yet. Type above, snap a photo, or record a voice note.</p>
            )}

            <ul className="space-y-2">
              {open.map((item) => (
                <ItemRow key={item.id} item={item} open={openId === item.id} listName={results ? listName(item.listId) : undefined} {...rowProps} />
              ))}
            </ul>

            {done.length > 0 && (
              <div className="mt-6">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <button onClick={() => setShowDone((s) => !s)} className="text-white/60 hover:text-white">
                    {showDone ? "▾" : "▸"} Done ({done.length})
                  </button>
                  {!results && selected && (
                    <button
                      onClick={() => {
                        dropMedia(clearDone(selected.id));
                        refresh();
                      }}
                      className="text-red-400 hover:text-red-300"
                    >
                      Clear done
                    </button>
                  )}
                </div>
                {showDone && (
                  <ul className="space-y-2 opacity-70">
                    {done.map((item) => (
                      <ItemRow key={item.id} item={item} open={openId === item.id} listName={results ? listName(item.listId) : undefined} {...rowProps} />
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function NewListForm({ onCreate, onCancel }: { onCreate: (name: string, icon?: string) => void; onCancel?: () => void }) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState(LIST_ICONS[0]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onCreate(name, icon);
      }}
      className="space-y-3 text-left"
    >
      <div className="flex gap-2">
        <input
          autoFocus={!!onCancel}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="List name, e.g. Gift ideas"
          aria-label="List name"
          className="h-10 min-w-0 flex-1 rounded-xl border border-white/15 bg-white/5 px-3 text-sm outline-none placeholder:text-white/40 focus:border-gold/50"
        />
        <button type="submit" disabled={!name.trim()} className="h-10 rounded-xl bg-gold px-4 text-sm font-semibold text-black disabled:opacity-40">
          Create
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="h-10 px-2 text-sm text-white/60 hover:text-white">
            Cancel
          </button>
        )}
      </div>
      <IconPicker value={icon} onPick={setIcon} />
    </form>
  );
}

function IconPicker({ value, onPick }: { value?: string; onPick: (icon: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="List icon">
      {LIST_ICONS.map((i) => (
        <button
          key={i}
          type="button"
          onClick={() => onPick(i)}
          aria-pressed={value === i}
          className={`h-8 w-8 rounded-lg text-base ${value === i ? "bg-gold/25 ring-1 ring-gold/60" : "hover:bg-white/10"}`}
        >
          {i}
        </button>
      ))}
    </div>
  );
}

function ListHeader({ list, total, onChange, onDelete }: { list: RememberList; total: number; onChange: () => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(list.name);
  const [confirming, setConfirming] = useState(false);

  if (editing) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          updateList(list.id, { name });
          setEditing(false);
          onChange();
        }}
        className="mb-4 space-y-3 rounded-2xl border border-white/10 bg-white/[.04] p-4"
      >
        <div className="flex gap-2">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Rename list"
            className="h-10 min-w-0 flex-1 rounded-xl border border-white/15 bg-white/5 px-3 text-sm outline-none focus:border-gold/50"
          />
          <button type="submit" className="h-10 rounded-xl bg-gold px-4 text-sm font-semibold text-black">
            Save
          </button>
        </div>
        <IconPicker
          value={list.icon}
          onPick={(icon) => {
            updateList(list.id, { icon });
            onChange();
          }}
        />
        <div className="flex justify-end">
          {confirming ? (
            <span className="flex items-center gap-3 text-sm">
              <span className="text-white/70">Delete this list and everything in it?</span>
              <button type="button" onClick={onDelete} className="font-semibold text-red-400 hover:text-red-300">
                Delete
              </button>
              <button type="button" onClick={() => setConfirming(false)} className="text-white/60 hover:text-white">
                Keep
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} className="text-sm text-red-400 hover:text-red-300">
              Delete list
            </button>
          )}
        </div>
      </form>
    );
  }

  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        {list.icon && <span>{list.icon}</span>}
        {list.name}
        <button onClick={() => setEditing(true)} aria-label="Edit list" className="text-sm text-white/40 hover:text-gold">
          ✏️
        </button>
      </h2>
      {total > 0 && <span className="text-sm text-white/60">Total {rupees(total)}</span>}
    </div>
  );
}

type RowProps = {
  item: ListItem;
  open: boolean;
  listName?: string;
  lists: RememberList[];
  busy: boolean;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onChange: () => void;
  onDelete: (id: string) => void;
  onPhoto: (id: string) => void;
  onVoice: (id: string, blob: Blob, seconds: number) => void;
  onPlan: (item: ListItem) => void;
};

function ItemRow({ item, open, listName, ...a }: RowProps) {
  const photos = item.media?.filter((m) => m.kind === "image").length ?? 0;
  const voices = item.media?.filter((m) => m.kind === "voice").length ?? 0;
  const [confirming, setConfirming] = useState(false);
  return (
    <li className={`rounded-xl border bg-white/[.04] transition ${open ? "border-gold/30" : "border-white/10"}`}>
      <div className="flex items-start gap-3 px-3 py-2.5">
        <input
          type="checkbox"
          checked={item.done}
          onChange={() => a.onToggle(item.id)}
          aria-label={item.done ? `Mark “${item.text}” not done` : `Mark “${item.text}” done`}
          className="mt-1 h-4 w-4 shrink-0 accent-gold"
        />
        <button onClick={() => a.onOpen(item.id)} className="min-w-0 flex-1 text-left" aria-expanded={open}>
          <span className={`block break-words ${item.done ? "text-white/50 line-through" : ""}`}>
            {item.pinned && <span className="mr-1">⭐</span>}
            {item.text}
          </span>
          <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-white/50">
            {listName && <span>{listName}</span>}
            {item.price !== undefined && <span className="text-gold/90">{rupees(item.price)}</span>}
            {item.link && <span>🔗 {linkHost(item.link)}</span>}
            {photos > 0 && <span>📷 {photos}</span>}
            {voices > 0 && <span>🎙 {voices}</span>}
            {item.note && !open && <span className="truncate">{item.note.split("\n")[0]}</span>}
          </span>
        </button>
        {/* Items with photos or voice notes ask first, since those can't be brought back. */}
        {confirming ? (
          <span className="flex shrink-0 items-center gap-2 text-sm">
            <button
              onClick={() => a.onDelete(item.id)}
              aria-label={`Confirm delete “${item.text}”`}
              className="font-semibold text-red-400 hover:text-red-300"
            >
              Delete
            </button>
            <button onClick={() => setConfirming(false)} className="text-white/60 hover:text-white">
              Keep
            </button>
          </span>
        ) : (
          <button
            onClick={() => (item.media?.length ? setConfirming(true) : a.onDelete(item.id))}
            aria-label={`Delete “${item.text}”`}
            title="Delete"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white/40 transition hover:bg-red-500/10 hover:text-red-300"
          >
            🗑
          </button>
        )}
      </div>
      {open && <ItemDetails key={item.id} item={item} {...a} />}
    </li>
  );
}

function ItemDetails({ item, lists, busy, onChange, onDelete, onPhoto, onVoice, onPlan }: Omit<RowProps, "open" | "listName" | "onToggle" | "onOpen">) {
  const [text, setText] = useState(item.text);
  const [note, setNote] = useState(item.note ?? "");
  const [link, setLink] = useState(item.link ?? "");
  const [price, setPrice] = useState(item.price !== undefined ? String(item.price) : "");
  const [linkError, setLinkError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const media = item.media ?? [];
  const full = media.length >= MAX_ITEM_MEDIA;

  const save = (changes: Parameters<typeof updateItem>[1]) => {
    updateItem(item.id, changes);
    onChange();
  };

  const field = "w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm outline-none placeholder:text-white/30 focus:border-gold/50";

  return (
    <div className="space-y-3 border-t border-white/10 px-3 pb-3 pt-3">
      <input value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text.trim() !== item.text && save({ text })} aria-label="Item text" className={field} />
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => note.trim() !== (item.note ?? "") && save({ note: note.trim() || undefined })}
        placeholder="Notes: size, colour, where you saw it, who recommended it…"
        aria-label="Notes"
        rows={2}
        className={field}
      />
      <div className="grid gap-2 sm:grid-cols-[1fr_9rem]">
        <div>
          <input
            value={link}
            onChange={(e) => {
              setLink(e.target.value);
              setLinkError(false);
            }}
            onBlur={() => {
              const clean = cleanLink(link);
              if (link.trim() && !clean) return setLinkError(true);
              if (clean !== item.link) save({ link: clean });
              setLink(clean ?? "");
            }}
            placeholder="Link"
            aria-label="Link"
            inputMode="url"
            className={field}
          />
          {linkError && <p className="mt-1 text-xs text-red-300">That isn&apos;t a web link.</p>}
        </div>
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          onBlur={() => {
            const n = parsePrice(price);
            if (n !== item.price) save({ price: n });
            setPrice(n !== undefined ? String(n) : "");
          }}
          placeholder="Price ₹"
          aria-label="Price"
          inputMode="decimal"
          className={field}
        />
      </div>
      {item.link && (
        <a href={item.link} target="_blank" rel="noopener noreferrer" className="inline-block text-sm text-gold hover:underline">
          Open {linkHost(item.link)} ↗
        </a>
      )}

      {media.length > 0 && (
        <MediaStrip
          media={media}
          onRemove={(m) => {
            save({ media: media.filter((x) => x.id !== m.id) });
            dropMedia([m]);
          }}
        />
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button
          type="button"
          onClick={() => onPhoto(item.id)}
          disabled={busy || full}
          className="flex h-10 items-center rounded-xl border border-white/15 bg-white/5 px-3 text-white/80 hover:border-gold/40 hover:text-gold disabled:opacity-40"
        >
          📷 Photo
        </button>
        <VoiceButton disabled={busy || full} onRecorded={(blob, s) => onVoice(item.id, blob, s)} />
        <button
          type="button"
          onClick={() => save({ pinned: !item.pinned })}
          className="h-10 rounded-xl border border-white/15 bg-white/5 px-3 text-white/80 hover:border-gold/40 hover:text-gold"
        >
          {item.pinned ? "Unpin" : "⭐ Pin"}
        </button>
        <button
          type="button"
          onClick={() => onPlan(item)}
          className="h-10 rounded-xl border border-white/15 bg-white/5 px-3 text-white/80 hover:border-gold/40 hover:text-gold"
        >
          + Today&apos;s tasks
        </button>
        {lists.length > 1 && (
          <select
            value={item.listId}
            onChange={(e) => save({ listId: e.target.value })}
            aria-label="Move to list"
            className="h-10 rounded-xl border border-white/15 bg-panel px-2 text-white/80"
          >
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.id === item.listId ? `In ${l.name}` : `Move to ${l.name}`}
              </option>
            ))}
          </select>
        )}
        <span className="ml-auto">
          {confirming ? (
            <span className="flex items-center gap-3">
              <button type="button" onClick={() => onDelete(item.id)} className="font-semibold text-red-400 hover:text-red-300">
                Delete
              </button>
              <button type="button" onClick={() => setConfirming(false)} className="text-white/60 hover:text-white">
                Keep
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => (media.length ? setConfirming(true) : onDelete(item.id))}
              className="text-red-400 hover:text-red-300"
            >
              Delete
            </button>
          )}
        </span>
      </div>
      {full && <p className="text-xs text-white/50">Up to {MAX_ITEM_MEDIA} photos and voice notes per item.</p>}
    </div>
  );
}
