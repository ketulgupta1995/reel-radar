"use client";

import { AppSwitcher } from "@/components/AppSwitcher";
import { ReelNavLinks } from "@/components/ReelNavLinks";
import { useEffect, useState } from "react";
import { Title } from "@/types/title";
import { load, save, useStorageSync, State, empty } from "@/lib/storage";
import { TitleCard } from "@/components/TitleCard";
import { StorageControls } from "@/components/StorageControls";

export default function DismissedPage() {
  const [state, setState] = useState<State>(empty());
  const [titles, setTitles] = useState<Record<string, Title>>({});
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setState(load());
    setIsLoaded(true);
  }, []);

  useStorageSync(setState);

  // Dismissals are stored as bare keys, so fetch metadata for any we haven't loaded yet.
  useEffect(() => {
    const missing = state.dismissed.filter((k) => !titles[k]);
    missing.forEach((k) => {
      const [type, id] = k.split(":");
      fetch(`/api/title?type=${type}&id=${id}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((t: Title | null) => {
          if (t) setTitles((prev) => ({ ...prev, [k]: t }));
        })
        .catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.dismissed]);

  const restore = (k: string) => {
    setState((prev) => {
      const next: State = { ...prev, dismissed: prev.dismissed.filter((x) => x !== k) };
      save(next);
      return next;
    });
  };

  const restoreAll = () => {
    if (confirm("Restore all titles you marked as not interested?")) {
      setState((prev) => {
        const next: State = { ...prev, dismissed: [] };
        save(next);
        return next;
      });
    }
  };

  if (!isLoaded) return null;

  // Newest first
  const keys = [...state.dismissed].reverse();

  return (
    <main className="min-h-screen px-4 py-8 md:px-10">
      <header className="mx-auto flex max-w-7xl items-center justify-between gap-4">
        <AppSwitcher current="reel-radar" />
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <ReelNavLinks counts={{ watchlist: state.watchlist.length, watched: state.watched.length, dismissed: state.dismissed.length }} />
          <StorageControls onStateChange={(s) => setState(s)} />
        </div>
      </header>

      <section className="mx-auto max-w-7xl py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold md:text-4xl">Not interested</h1>
            <p className="mt-2 text-white/65">
              {keys.length} title{keys.length === 1 ? "" : "s"} hidden from your recommendations.
              Restore one to let it show up again.
            </p>
          </div>
          {keys.length > 0 && (
            <button
              onClick={restoreAll}
              className="text-xs text-red-400/80 hover:text-red-400 underline"
            >
              Restore all
            </button>
          )}
        </div>

        {keys.length === 0 ? (
          <div className="mt-12 rounded-xl border border-white/10 p-12 text-center">
            <h2 className="text-xl font-bold">Nothing here</h2>
            <p className="mt-2 text-sm text-white/60">
              Titles you mark as &quot;Not interested&quot; will appear here.
            </p>
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-5">
            {keys.map((k) => {
              const t = titles[k];
              return (
                <div key={k} className="flex flex-col">
                  {t ? (
                    <TitleCard title={t} />
                  ) : (
                    <div className="flex h-full min-h-48 items-center justify-center rounded-xl border border-white/10 text-xs text-white/40">
                      Loading…
                    </div>
                  )}
                  <div className="mt-2 flex flex-col gap-1.5">
                    <button
                      onClick={() => restore(k)}
                      title={`Restore ${t?.title ?? k}`}
                      className="w-full rounded-lg bg-white/10 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20"
                    >
                      Restore
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
