"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AppSwitcher } from "@/components/AppSwitcher";
import { Title, keyOf } from "@/types/title";
import { load, save, useStorageSync, State } from "@/lib/storage";
import { TitleCard } from "@/components/TitleCard";

export default function PersonPage() {
  const params = useParams();
  const personId = params.id as string;
  const [state, setState] = useState<State>({ watched: [], displayed: [], shown: [], watchlist: [], dismissed: [] });
  const [name, setName] = useState("");
  const [titles, setTitles] = useState<Title[]>([]);
  const [loading, setLoading] = useState(true);

  useStorageSync(setState);

  useEffect(() => {
    setState(load());
    fetch(`/api/person/${personId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.name) setName(d.name);
        if (d.titles) setTitles(d.titles);
      })
      .finally(() => setLoading(false));
  }, [personId]);

  const persist = (fn: (s: State) => State) =>
    setState((s) => {
      const n = fn(s);
      save(n);
      return n;
    });

  const toggleWatched = (t: Title) => {
    persist((s) => {
      const k = keyOf(t);
      const has = s.watched.some((x) => keyOf(x) === k);
      return {
        ...s,
        watched: has ? s.watched.filter((x) => keyOf(x) !== k) : [...s.watched, t],
        watchlist: has ? s.watchlist : s.watchlist.filter((x) => keyOf(x) !== k),
      };
    });
  };

  const toggleWatchlist = (t: Title) => {
    persist((s) => {
      const k = keyOf(t);
      const has = s.watchlist.some((x) => keyOf(x) === k);
      return { ...s, watchlist: has ? s.watchlist.filter((x) => keyOf(x) !== k) : [...s.watchlist, t] };
    });
  };

  const watchedKeys = new Set(state.watched.map(keyOf));
  const watchlistKeys = new Set(state.watchlist.map(keyOf));

  return (
    <main className="min-h-screen px-4 py-8 md:px-10">
      <header className="mx-auto flex max-w-7xl items-center justify-between gap-4 mb-8">
        <AppSwitcher current="reel-radar" />
        <Link href="/search" className="text-white/70 hover:text-white text-sm">Back to Search</Link>
      </header>

      <section className="mx-auto max-w-7xl py-6">
        <h1 className="text-3xl font-bold mb-2">{loading ? "Loading..." : name}</h1>
        <p className="text-white/50 mb-10">Discover titles involving this creator</p>

        {titles.length > 0 && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-5">
            {titles.map((t) => (
              <div key={keyOf(t)} className="flex flex-col">
                <TitleCard title={t} />
                <div className="mt-2 flex flex-col gap-1.5">
                  <div className="flex gap-2">
                    <button
                      onClick={() => toggleWatched(t)}
                      className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition ${
                        watchedKeys.has(keyOf(t))
                          ? "bg-gold text-black hover:bg-gold/80 font-bold"
                          : "bg-white/10 text-white hover:bg-white/20"
                      }`}
                    >
                      {watchedKeys.has(keyOf(t)) ? "✓ Watched" : "+ Mark Seen"}
                    </button>
                    <button
                      onClick={() => toggleWatchlist(t)}
                      className={`flex-1 rounded-lg border py-1.5 text-xs font-semibold transition ${
                        watchlistKeys.has(keyOf(t))
                          ? "border-gold/30 bg-gold/20 text-gold"
                          : "border-white/10 text-white/80 hover:bg-white/10"
                      }`}
                    >
                      {watchlistKeys.has(keyOf(t)) ? "✓ Saved" : "+ Watchlist"}
                    </button>
                  </div>
                  <Link
                    href={`/similar?type=${t.mediaType}&id=${t.id}`}
                    className="w-full text-center rounded-lg border border-white/10 bg-white/5 py-1.5 text-xs font-medium text-white/80 transition hover:border-gold/40 hover:bg-gold/10 hover:text-gold"
                  >
                    Find Similar
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}