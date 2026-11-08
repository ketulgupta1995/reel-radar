"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { getTodayDate, syncPlanner } from "@/lib/todos";
import { getRelativeDateLabel } from "./planner";
import { MAX_ITEM_MEDIA, deleteMedia, shrinkImage, uploadMedia, type MediaRef } from "@/lib/media";
import { MediaStrip, VoiceButton } from "./media";

const SELECTED_KEY = "reel-radar-lists-selected";
const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const dropMedia = (media: MediaRef[]) => {
  if (media.length) void deleteMedia(media.map((m) => m.id));
};

// The planner's lists as tiles (icon, name, what's open and still to get); a tile opens its list. Same
// behaviour as the current Lists page: notes, links, prices, photos and voice notes, pins, a Done section,
// moving between lists, searching them all, and adding an item to a day.
export function Lists({ initialList, initialItem, startOn = "tiles" }: { initialList?: string; initialItem?: string; startOn?: "tiles" | "list" }) {
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
  const [browsing, setBrowsing] = useState(startOn === "tiles" && !initialList && !initialItem); // the tiles, before a list is opened
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
    // A search result opens straight to its list and item.
    refresh(initialList ?? saved);
    const item = getItem(initialItem ?? "");
    if (item) {
      setOpenId(item.id);
      setShowDone(item.done);
    }
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
    setBrowsing(false);
    refresh(id);
  };

  function createList(name: string, icon?: string) {
    const list = addList(name, icon);
    setCreating(false);
    setBrowsing(false);
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
    onPlan: async (item: ListItem, date: string) => {
      // Another day's month may not be on this device yet: pull it first.
      if (date !== getTodayDate()) await syncPlanner([date]);
      planItem(item, date);
      setNotice(`Added “${item.text}” to ${date === getTodayDate() ? "today's tasks" : getRelativeDateLabel(date)}`);
    },
  };

  return (
    <div className="flex flex-col gap-3">
      <input ref={photoInput} type="file" accept="image/*" onChange={onPhotoChosen} className="hidden" data-testid="photo-input" />

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-bf-muted">Things to remember that don&apos;t belong to a day.</p>
          {mounted && lists.length > 0 && (
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search all lists"
              aria-label="Search all lists"
              className="h-9 w-full rounded-full border border-bf-s2 bg-bf-s1 px-4 text-sm outline-none placeholder:text-bf-muted focus:border-bf-ink sm:w-56"
            />
          )}
        </div>

        {!mounted ? null : lists.length === 0 ? (
          <section className="rounded-2xl border border-bf-s2 bg-bf-s1 p-6 text-center">
            <p className="text-lg font-semibold">Start a list</p>
            <p className="mt-1 text-sm text-bf-muted">Pick one to begin, or name your own.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {STARTER_LISTS.map((s) => (
                <button
                  key={s.name}
                  onClick={() => createList(s.name, s.icon)}
                  className="rounded-full border border-bf-s2 bg-bf-s1 px-4 py-2 text-sm"
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
            {browsing && !results ? (
              <ul aria-label="All lists" className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {lists.map((l) => {
                  const left = totalPrice(loadItems(l.id));
                  return (
                    <li key={l.id}>
                      <button onClick={() => pick(l.id)} className="flex min-h-[120px] w-full flex-col gap-1.5 rounded-[16px] bg-bf-s1 p-3.5 text-left">
                        <span className="text-2xl">{l.icon ?? "📌"}</span>
                        <b className="break-words text-base font-black [font-stretch:110%]">{l.name}</b>
                        <small className="font-bfm text-[11px] text-bf-muted">
                          {counts[l.id] ?? 0} open{left ? ` · ${rupees(left)} still to get` : ""}
                        </small>
                      </button>
                    </li>
                  );
                })}
                <li>
                  <button onClick={() => setCreating((c) => !c)} aria-expanded={creating} className="grid min-h-[120px] w-full place-items-center rounded-[16px] border-2 border-dashed border-bf-line font-extrabold text-bf-muted">
                    + New list
                  </button>
                </li>
              </ul>
            ) : (
              !results && (
                <button onClick={() => setBrowsing(true)} className="mb-2 self-start font-bfm text-xs text-bf-muted">
                  ‹ All lists
                </button>
              )
            )}
            {creating && (
              <div className="mb-4 rounded-2xl border border-bf-s2 bg-bf-s1 p-4">
                <NewListForm onCreate={createList} onCancel={() => setCreating(false)} />
              </div>
            )}

            {results ? (
              <p className="mb-3 text-sm text-bf-muted">
                {results.length ? `${results.length} found in all lists` : "Nothing matches."}
              </p>
            ) : (
              selected &&
              !browsing && (
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
                      className="h-10 min-w-0 flex-1 rounded-xl border border-bf-s2 bg-bf-s1 px-3 text-sm outline-none placeholder:text-bf-muted focus:border-bf-ink"
                    />
                    <button
                      type="button"
                      onClick={() => choosePhoto(null)}
                      disabled={!!busy}
                      title="Add a photo"
                      aria-label="Add a photo"
                      className="h-10 rounded-xl border border-bf-s2 bg-bf-s1 px-3 text-sm text-bf-ink disabled:opacity-40"
                    >
                      📷
                    </button>
                    <VoiceButton disabled={!!busy} onRecorded={(blob, s) => attach(null, blob, s)} />
                    <button
                      type="submit"
                      disabled={!draft.trim()}
                      className="h-10 rounded-xl bg-bf-ink px-4 text-sm font-black uppercase text-bf-bg disabled:opacity-40"
                    >
                      Add
                    </button>
                  </form>
                </>
              )
            )}

            {(busy || error || notice) && (
              <p role="status" className={`mb-3 text-sm ${error ? "text-bf-late" : busy ? "text-bf-muted" : "text-bf-ink"}`}>
                {error || busy || notice}
              </p>
            )}

            {!results && !browsing && !open.length && !done.length && (
              <p className="py-10 text-center text-sm text-bf-muted">Nothing here yet. Type above, snap a photo, or record a voice note.</p>
            )}

            {(results || !browsing) && (
              <ul className="space-y-2">
                {open.map((item) => (
                  <ItemRow key={item.id} item={item} open={openId === item.id} listName={results ? listName(item.listId) : undefined} {...rowProps} />
                ))}
              </ul>
            )}

            {(results || !browsing) && done.length > 0 && (
              <div className="mt-6">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <button onClick={() => setShowDone((s) => !s)} className="text-bf-muted">
                    {showDone ? "▾" : "▸"} Done ({done.length})
                  </button>
                  {!results && selected && (
                    <button
                      onClick={() => {
                        dropMedia(clearDone(selected.id));
                        refresh();
                      }}
                      className="text-bf-late"
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
    </div>
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
          className="h-10 min-w-0 flex-1 rounded-xl border border-bf-s2 bg-bf-s1 px-3 text-sm outline-none placeholder:text-bf-muted focus:border-bf-ink"
        />
        <button type="submit" disabled={!name.trim()} className="h-10 rounded-xl bg-bf-ink px-4 text-sm font-black uppercase text-bf-bg disabled:opacity-40">
          Create
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="h-10 px-2 text-sm text-bf-muted">
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
          className={`h-8 w-8 rounded-lg text-base ${value === i ? "bg-bf-s2 ring-2 ring-bf-ink" : ""}`}
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
        className="mb-4 space-y-3 rounded-2xl border border-bf-s2 bg-bf-s1 p-4"
      >
        <div className="flex gap-2">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Rename list"
            className="h-10 min-w-0 flex-1 rounded-xl border border-bf-s2 bg-bf-s1 px-3 text-sm outline-none focus:border-bf-ink"
          />
          <button type="submit" className="h-10 rounded-xl bg-bf-ink px-4 text-sm font-black uppercase text-bf-bg">
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
              <span className="text-bf-muted">Delete this list and everything in it?</span>
              <button type="button" onClick={onDelete} className="font-semibold text-bf-late">
                Delete
              </button>
              <button type="button" onClick={() => setConfirming(false)} className="text-bf-muted">
                Keep
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} className="text-sm text-bf-late">
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
        <button onClick={() => setEditing(true)} aria-label="Edit list" className="text-sm text-bf-muted">
          ✏️
        </button>
      </h2>
      {total > 0 && <span className="text-sm text-bf-muted">Total {rupees(total)}</span>}
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
  onPlan: (item: ListItem, date: string) => void;
};

function ItemRow({ item, open, listName, ...a }: RowProps) {
  const photos = item.media?.filter((m) => m.kind === "image").length ?? 0;
  const voices = item.media?.filter((m) => m.kind === "voice").length ?? 0;
  const [confirming, setConfirming] = useState(false);
  return (
    <li className={`rounded-xl border bg-bf-s1 transition ${open ? "border-bf-ink" : "border-bf-s2"}`}>
      <div className="flex items-start gap-3 px-3 py-2.5">
        <input
          type="checkbox"
          checked={item.done}
          onChange={() => a.onToggle(item.id)}
          aria-label={item.done ? `Mark “${item.text}” not done` : `Mark “${item.text}” done`}
          className="mt-1 h-4 w-4 shrink-0 accent-gold"
        />
        <button onClick={() => a.onOpen(item.id)} className="min-w-0 flex-1 text-left" aria-expanded={open}>
          <span className={`block break-words ${item.done ? "text-bf-muted line-through" : ""}`}>
            {item.pinned && <span className="mr-1">⭐</span>}
            {item.text}
          </span>
          <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-bf-muted">
            {listName && <span>{listName}</span>}
            {item.price !== undefined && <span className="font-bold text-bf-ink">{rupees(item.price)}</span>}
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
              className="font-semibold text-bf-late"
            >
              Delete
            </button>
            <button onClick={() => setConfirming(false)} className="text-bf-muted">
              Keep
            </button>
          </span>
        ) : (
          <button
            onClick={() => (item.media?.length ? setConfirming(true) : a.onDelete(item.id))}
            aria-label={`Delete “${item.text}”`}
            title="Delete"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-bf-muted transition"
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
  const [planDate, setPlanDate] = useState(getTodayDate);
  const media = item.media ?? [];
  const full = media.length >= MAX_ITEM_MEDIA;

  const save = (changes: Parameters<typeof updateItem>[1]) => {
    updateItem(item.id, changes);
    onChange();
  };

  const field = "w-full rounded-lg border border-bf-s2 bg-bf-s1 px-3 py-2 text-sm outline-none placeholder:text-bf-muted focus:border-bf-ink";

  return (
    <div className="space-y-3 border-t border-bf-s2 px-3 pb-3 pt-3">
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
          {linkError && <p className="mt-1 text-xs text-bf-late">That isn&apos;t a web link.</p>}
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
        <a href={item.link} target="_blank" rel="noopener noreferrer" className="inline-block text-sm font-bold text-bf-ink hover:underline">
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
          className="flex h-10 items-center rounded-xl border border-bf-s2 bg-bf-s1 px-3 text-bf-ink disabled:opacity-40"
        >
          📷 Photo
        </button>
        <VoiceButton disabled={busy || full} onRecorded={(blob, s) => onVoice(item.id, blob, s)} />
        <button
          type="button"
          onClick={() => save({ pinned: !item.pinned })}
          className="h-10 rounded-xl border border-bf-s2 bg-bf-s1 px-3 text-bf-ink"
        >
          {item.pinned ? "Unpin" : "⭐ Pin"}
        </button>
        <input type="date" value={planDate} onChange={(e) => setPlanDate(e.target.value)} aria-label="Day to add it to" className="h-10 rounded-xl bg-bf-s2 px-2 text-sm font-bold text-bf-ink focus:outline-none" />
        <button
          type="button"
          onClick={() => planDate && onPlan(item, planDate)}
          className="h-10 rounded-xl border border-bf-s2 bg-bf-s1 px-3 text-bf-ink"
        >
          + Add to {planDate === getTodayDate() ? "today" : "that day"}
        </button>
        {lists.length > 1 && (
          <select
            value={item.listId}
            onChange={(e) => save({ listId: e.target.value })}
            aria-label="Move to list"
            className="h-10 rounded-xl border border-bf-s2 bg-bf-s2 px-2 text-bf-ink"
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
              <button type="button" onClick={() => onDelete(item.id)} className="font-semibold text-bf-late">
                Delete
              </button>
              <button type="button" onClick={() => setConfirming(false)} className="text-bf-muted">
                Keep
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => (media.length ? setConfirming(true) : onDelete(item.id))}
              className="text-bf-late"
            >
              Delete
            </button>
          )}
        </span>
      </div>
      {full && <p className="text-xs text-bf-muted">Up to {MAX_ITEM_MEDIA} photos and voice notes per item.</p>}
    </div>
  );
}
