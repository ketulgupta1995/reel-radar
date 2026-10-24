"use client";

import Link from "next/link";
import { useEffect, useState, useMemo } from "react";
import { Title, keyOf, MediaType } from "@/types/title";
import { load, save, syncWithServer, State } from "@/lib/storage";
import { TitleCard } from "@/components/TitleCard";
import { StorageControls } from "@/components/StorageControls";
import { isIndianTitle } from "@/lib/recommend";

type Rec = Title & { why: string };

type CategorizedData = {
  indianMovies: Rec[];
  globalMovies: Rec[];
  indianSeries: Rec[];
  globalSeries: Rec[];
};

export default function Recommendations() {
  const [state, setState] = useState<State>({
    watched: [],
    displayed: [],
    shown: [],
    watchlist: [],
    dismissed: [],
  });

  const [categories, setCategories] = useState<CategorizedData>({
    indianMovies: [],
    globalMovies: [],
    indianSeries: [],
    globalSeries: [],
  });

  const [formatFilter, setFormatFilter] = useState<"all" | MediaType>("all");
  const [regionFilter, setRegionFilter] = useState<"all" | "in" | "global">("all");
  const [summary, setSummary] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const persist = (fn: (s: State) => State) =>
    setState((s) => {
      const n = fn(s);
      save(n);
      return n;
    });

  const get = async () => {
    const s = load();
    setState(s);
    if (s.watched.length < 10) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const r = await fetch("/api/recommendations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          watched: s.watched,
          seen: s.shown,
          dismissed: s.dismissed || [],
          watchlist: s.watchlist || [],
        }),
      });

      const d = await r.json();
      if (!r.ok) throw new Error(d.error);

      setCategories(d.categories);
      setSummary(d.summary);

      const allFetched: Rec[] = [
        ...d.categories.indianMovies,
        ...d.categories.globalMovies,
        ...d.categories.indianSeries,
        ...d.categories.globalSeries,
      ];

      save({
        ...s,
        shown: [...new Set([...s.shown, ...allFetched.map(keyOf)])],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to recommend");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    get();
    syncWithServer().then(setState);
  }, []);

  const seen = (title: Title) => {
    persist((s) => ({
      ...s,
      watched: s.watched.some((x) => keyOf(x) === keyOf(title))
        ? s.watched
        : [...s.watched, title],
      watchlist: s.watchlist.filter((x) => keyOf(x) !== keyOf(title)),
    }));
  };

  const addToWatchlist = (title: Title) => {
    persist((s) => ({
      ...s,
      watchlist: s.watchlist.some((x) => keyOf(x) === keyOf(title))
        ? s.watchlist
        : [...s.watchlist, title],
    }));
  };

  const dismiss = (title: Title) => {
    const k = keyOf(title);
    persist((s) => ({
      ...s,
      dismissed: s.dismissed ? [...new Set([...s.dismissed, k])] : [k],
      watchlist: s.watchlist.filter((x) => keyOf(x) !== k),
    }));
  };

  const watchlistKeys = new Set(state.watchlist.map(keyOf));
  const dismissedKeys = new Set(state.dismissed || []);

  const cleanCategory = (items: Rec[]) =>
    items.filter((r) => !watchlistKeys.has(keyOf(r)) && !dismissedKeys.has(keyOf(r)));

  const cleanIndianMovies = useMemo(() => cleanCategory(categories.indianMovies), [categories, state]);
  const cleanGlobalMovies = useMemo(() => cleanCategory(categories.globalMovies), [categories, state]);
  const cleanIndianSeries = useMemo(() => cleanCategory(categories.indianSeries), [categories, state]);
  const cleanGlobalSeries = useMemo(() => cleanCategory(categories.globalSeries), [categories, state]);

  // Determine which sections to render based on user filter selections
  const showIndianMovies =
    (regionFilter === "all" || regionFilter === "in") &&
    (formatFilter === "all" || formatFilter === "movie");

  const showGlobalMovies =
    (regionFilter === "all" || regionFilter === "global") &&
    (formatFilter === "all" || formatFilter === "movie");

  const showIndianSeries =
    (regionFilter === "all" || regionFilter === "in") &&
    (formatFilter === "all" || formatFilter === "tv");

  const showGlobalSeries =
    (regionFilter === "all" || regionFilter === "global") &&
    (formatFilter === "all" || formatFilter === "tv");

  const renderSection = (title: string, badge: string, items: Rec[]) => {
    if (items.length === 0) return null;
    return (
      <section className="mt-10">
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-2xl font-bold text-white">{title}</h2>
          <span className="rounded-full bg-gold/15 px-3 py-0.5 text-xs font-semibold text-gold border border-gold/30">
            {badge} ({items.length})
          </span>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-5">
          {items.map((r) => (
            <div key={keyOf(r)} className="flex flex-col">
              <TitleCard title={r} why={r.why} />
              <div className="mt-2 flex flex-col gap-1.5">
                <div className="flex gap-2">
                  <button
                    onClick={() => seen(r)}
                    className="flex-1 rounded-lg bg-white/10 px-2 py-2 text-xs hover:bg-white/20"
                  >
                    Mark seen
                  </button>
                  <button
                    onClick={() => addToWatchlist(r)}
                    className="flex-1 rounded-lg bg-gold/20 text-gold border border-gold/30 px-2 py-2 text-xs font-semibold hover:bg-gold hover:text-black transition"
                  >
                    + Watchlist
                  </button>
                </div>
                <button
                  onClick={() => dismiss(r)}
                  title="Remove and don't recommend again"
                  className="w-full rounded-lg border border-white/10 py-1.5 text-[11px] text-white/45 transition hover:border-red-400/30 hover:bg-red-500/10 hover:text-red-300"
                >
                  Not interested
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  };

  return (
    <main className="min-h-screen px-4 py-8 md:px-10 pb-16">
      <header className="mx-auto flex max-w-7xl items-center justify-between gap-4">
        <Link href="/" className="font-bold tracking-[.2em] text-gold">
          REEL RADAR
        </Link>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <Link href="/discover" className="text-white/70 hover:text-white">
            Discover
          </Link>
          <Link href="/search" className="text-white/70 hover:text-white">
            Search
          </Link>
          <Link href="/watchlist" className="text-white/70 hover:text-white">
            Watchlist ({state.watchlist.length})
          </Link>
          <Link href="/watched" className="text-white/70 hover:text-white">
            Viewed titles ({state.watched.length})
          </Link>
          <Link href="/analysis" className="text-white/70 hover:text-white">
            Analysis
          </Link>
          <StorageControls onStateChange={(s) => setState(s)} />
        </div>
      </header>

      <div className="mx-auto max-w-7xl py-10">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold">Recommended for You</h1>
            <p className="mt-2 text-sm text-white/65">
              Personalized from your taste history
              {summary.length ? `: ${summary.join(", ")}` : ""}.
            </p>
          </div>

          {/* Interactive Filters: Format & Region */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Format Filter */}
            <div className="flex rounded-full bg-white/5 p-1 border border-white/10 text-xs">
              <button
                onClick={() => setFormatFilter("all")}
                className={`rounded-full px-3 py-1.5 ${
                  formatFilter === "all" ? "bg-gold text-black font-semibold" : "text-white/70"
                }`}
              >
                All Formats
              </button>
              <button
                onClick={() => setFormatFilter("movie")}
                className={`rounded-full px-3 py-1.5 ${
                  formatFilter === "movie" ? "bg-gold text-black font-semibold" : "text-white/70"
                }`}
              >
                Movies
              </button>
              <button
                onClick={() => setFormatFilter("tv")}
                className={`rounded-full px-3 py-1.5 ${
                  formatFilter === "tv" ? "bg-gold text-black font-semibold" : "text-white/70"
                }`}
              >
                Series
              </button>
            </div>

            {/* Region Filter */}
            <div className="flex rounded-full bg-white/5 p-1 border border-white/10 text-xs">
              <button
                onClick={() => setRegionFilter("all")}
                className={`rounded-full px-3 py-1.5 ${
                  regionFilter === "all" ? "bg-gold text-black font-semibold" : "text-white/70"
                }`}
              >
                All Regions
              </button>
              <button
                onClick={() => setRegionFilter("in")}
                className={`rounded-full px-3 py-1.5 ${
                  regionFilter === "in" ? "bg-gold text-black font-semibold" : "text-white/70"
                }`}
              >
                Indian
              </button>
              <button
                onClick={() => setRegionFilter("global")}
                className={`rounded-full px-3 py-1.5 ${
                  regionFilter === "global" ? "bg-gold text-black font-semibold" : "text-white/70"
                }`}
              >
                Global
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="poster aspect-[2/3] animate-pulse rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            {showIndianMovies && renderSection("Indian Movies", "Cinema", cleanIndianMovies)}
            {showGlobalMovies && renderSection("Global & Hollywood Movies", "Movies", cleanGlobalMovies)}
            {showIndianSeries && renderSection("Indian Web Series & Shows", "Indian TV", cleanIndianSeries)}
            {showGlobalSeries && renderSection("Global & International Series", "TV Shows", cleanGlobalSeries)}
          </div>
        )}

        <div className="mt-12 flex flex-wrap gap-3">
          <button onClick={get} className="rounded-full border border-white/20 px-6 py-3 text-sm">
            Refresh recommendations
          </button>
          <Link href="/discover" className="rounded-full bg-gold px-6 py-3 font-bold text-black text-sm">
            Discover more titles
          </Link>
        </div>
      </div>
    </main>
  );
}