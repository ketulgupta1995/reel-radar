"use client";

import Link from "next/link";
import { useEffect, useState, useMemo } from "react";
import { Title, keyOf, MediaType } from "@/types/title";
import { load, save, syncWithServer, State } from "@/lib/storage";
import { TitleCard } from "@/components/TitleCard";
import { StorageControls } from "@/components/StorageControls";

type Rec = Title & { why: string };

type ThematicShelf = {
  id: string;
  title: string;
  subtitle: string;
  badge: string;
  items: Rec[];
};

type CategorizedData = {
  indianMovies: Rec[];
  globalMovies: Rec[];
  indianSeries: Rec[];
  globalSeries: Rec[];
  thematicShelves: ThematicShelf[];
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
    thematicShelves: [],
  });

  const [formatFilter, setFormatFilter] = useState<"all" | MediaType>("all");
  const [regionFilter, setRegionFilter] = useState<"all" | "in" | "global">("all");
  const [discoveryStyle, setDiscoveryStyle] = useState<"balanced" | "popular" | "deepcuts">("balanced");
  const [eraFilter, setEraFilter] = useState<"all" | "classic" | "modern" | "recent">("all");
  const [moodFilter, setMoodFilter] = useState<"all" | "dark" | "adrenaline" | "feelgood" | "mindbending">("all");

  const [summary, setSummary] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const persist = (fn: (s: State) => State) =>
    setState((s) => {
      const n = fn(s);
      save(n);
      return n;
    });

  const get = async (
    style = discoveryStyle,
    era = eraFilter,
    mood = moodFilter
  ) => {
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
          discoveryStyle: style,
          era,
          mood,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);

      setCategories({
        indianMovies: d.categories.indianMovies || [],
        globalMovies: d.categories.globalMovies || [],
        indianSeries: d.categories.indianSeries || [],
        globalSeries: d.categories.globalSeries || [],
        thematicShelves: d.categories.thematicShelves || [],
      });
      setSummary(d.summary || []);

      const allFetched: Rec[] = [
        ...(d.categories.indianMovies || []),
        ...(d.categories.globalMovies || []),
        ...(d.categories.indianSeries || []),
        ...(d.categories.globalSeries || []),
        ...(d.categories.thematicShelves || []).flatMap((sh: ThematicShelf) => sh.items || []),
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

  const handleStyleChange = (style: "balanced" | "popular" | "deepcuts") => {
    setDiscoveryStyle(style);
    get(style, eraFilter, moodFilter);
  };

  const handleEraChange = (era: "all" | "classic" | "modern" | "recent") => {
    setEraFilter(era);
    get(discoveryStyle, era, moodFilter);
  };

  const handleMoodChange = (mood: "all" | "dark" | "adrenaline" | "feelgood" | "mindbending") => {
    setMoodFilter(mood);
    get(discoveryStyle, eraFilter, mood);
  };

  const toggleWatched = (title: Title) => {
    persist((s) => {
      const isAlreadyWatched = s.watched.some((x) => keyOf(x) === keyOf(title));
      return {
        ...s,
        watched: isAlreadyWatched
          ? s.watched.filter((x) => keyOf(x) !== keyOf(title))
          : [...s.watched, title],
        watchlist: isAlreadyWatched
          ? s.watchlist
          : s.watchlist.filter((x) => keyOf(x) !== keyOf(title)),
      };
    });
  };

  const toggleWatchlist = (title: Title) => {
    persist((s) => {
      const inWatchlist = s.watchlist.some((x) => keyOf(x) === keyOf(title));
      return {
        ...s,
        watchlist: inWatchlist
          ? s.watchlist.filter((x) => keyOf(x) !== keyOf(title))
          : [...s.watchlist, title],
      };
    });
  };

  const dismiss = (title: Title) => {
    const k = keyOf(title);
    persist((s) => ({
      ...s,
      dismissed: s.dismissed ? [...new Set([...s.dismissed, k])] : [k],
      watchlist: s.watchlist.filter((x) => keyOf(x) !== k),
    }));
  };

  const watchedKeys = useMemo(() => new Set(state.watched.map(keyOf)), [state.watched]);
  const watchlistKeys = useMemo(() => new Set(state.watchlist.map(keyOf)), [state.watchlist]);
  const dismissedKeys = useMemo(() => new Set(state.dismissed || []), [state.dismissed]);

  const cleanCategory = (items: Rec[]) =>
    items.filter((r) => !watchlistKeys.has(keyOf(r)) && !dismissedKeys.has(keyOf(r)));

  const cleanIndianMovies = useMemo(() => cleanCategory(categories.indianMovies), [categories, state]);
  const cleanGlobalMovies = useMemo(() => cleanCategory(categories.globalMovies), [categories, state]);
  const cleanIndianSeries = useMemo(() => cleanCategory(categories.indianSeries), [categories, state]);
  const cleanGlobalSeries = useMemo(() => cleanCategory(categories.globalSeries), [categories, state]);
  const cleanThematicShelves = useMemo(
    () =>
      categories.thematicShelves.map((shelf) => ({
        ...shelf,
        items: cleanCategory(shelf.items),
      })).filter((shelf) => shelf.items.length > 0),
    [categories, state]
  );

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

  const renderSection = (title: string, badge: string, items: Rec[], subtitle?: string) => {
    if (items.length === 0) return null;
    return (
      <section className="mt-10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold text-white">{title}</h2>
              <span className="rounded-full bg-gold/15 px-3 py-0.5 text-xs font-semibold text-gold border border-gold/30">
                {badge} ({items.length})
              </span>
            </div>
            {subtitle && <p className="text-xs text-white/55 mt-0.5">{subtitle}</p>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-5">
          {items.map((r) => {
            const isWatched = watchedKeys.has(keyOf(r));
            const inWatchlist = watchlistKeys.has(keyOf(r));
            return (
              <div key={keyOf(r)} className="flex flex-col">
                <TitleCard
                  title={r}
                  why={r.why}
                  selected={isWatched}
                  onToggle={() => toggleWatched(r)}
                />
                <div className="mt-2 flex flex-col gap-1.5">
                  <div className="flex gap-2">
                    <button
                      onClick={() => toggleWatched(r)}
                      title={isWatched ? "Remove from watched" : "Mark as watched"}
                      className={`flex-1 rounded-lg px-2 py-2 text-xs font-semibold transition ${
                        isWatched
                          ? "bg-gold text-black shadow-sm font-bold"
                          : "bg-white/10 text-white hover:bg-white/20"
                      }`}
                    >
                      {isWatched ? "✓ Seen" : "Mark seen"}
                    </button>
                    <button
                      onClick={() => toggleWatchlist(r)}
                      title={inWatchlist ? "Remove from watchlist" : "Add to watchlist"}
                      className={`flex-1 rounded-lg border px-2 py-2 text-xs font-semibold transition ${
                        inWatchlist
                          ? "border-gold/50 bg-gold/20 text-gold"
                          : "border-gold/30 bg-gold/10 text-gold hover:bg-gold hover:text-black"
                      }`}
                    >
                      {inWatchlist ? "✓ Watchlist" : "+ Watchlist"}
                    </button>
                  </div>

                  <Link
                    href={`/similar?type=${r.mediaType}&id=${r.id}`}
                    className="w-full text-center rounded-lg border border-white/10 bg-white/5 py-1.5 text-[11px] font-medium text-white/80 transition hover:border-gold/40 hover:bg-gold/10 hover:text-gold"
                  >
                    Find Similar
                  </Link>

                  <button
                    onClick={() => dismiss(r)}
                    title="Remove and don't recommend again"
                    className="w-full rounded-lg border border-white/10 py-1.5 text-[11px] text-white/45 transition hover:border-red-400/30 hover:bg-red-500/10 hover:text-red-300"
                  >
                    Not interested
                  </button>
                </div>
              </div>
            );
          })}
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
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <div>
              <h1 className="text-4xl font-bold">Recommended for You</h1>
              <p className="mt-2 text-sm text-white/65">
                Calibrated against {state.watched.length} viewed titles with recency & genre TF-IDF tuning
                {summary.length ? ` (Core: ${summary.join(", ")})` : ""}.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex rounded-full bg-white/5 p-1 border border-white/10 text-xs">
                <button
                  onClick={() => setFormatFilter("all")}
                  className={`rounded-full px-3 py-1.5 transition ${
                    formatFilter === "all" ? "bg-gold text-black font-semibold" : "text-white/70 hover:text-white"
                  }`}
                >
                  All Formats
                </button>
                <button
                  onClick={() => setFormatFilter("movie")}
                  className={`rounded-full px-3 py-1.5 transition ${
                    formatFilter === "movie" ? "bg-gold text-black font-semibold" : "text-white/70 hover:text-white"
                  }`}
                >
                  Movies
                </button>
                <button
                  onClick={() => setFormatFilter("tv")}
                  className={`rounded-full px-3 py-1.5 transition ${
                    formatFilter === "tv" ? "bg-gold text-black font-semibold" : "text-white/70 hover:text-white"
                  }`}
                >
                  Series
                </button>
              </div>

              <div className="flex rounded-full bg-white/5 p-1 border border-white/10 text-xs">
                <button
                  onClick={() => setRegionFilter("all")}
                  className={`rounded-full px-3 py-1.5 transition ${
                    regionFilter === "all" ? "bg-gold text-black font-semibold" : "text-white/70 hover:text-white"
                  }`}
                >
                  All Regions
                </button>
                <button
                  onClick={() => setRegionFilter("in")}
                  className={`rounded-full px-3 py-1.5 transition ${
                    regionFilter === "in" ? "bg-gold text-black font-semibold" : "text-white/70 hover:text-white"
                  }`}
                >
                  Indian
                </button>
                <button
                  onClick={() => setRegionFilter("global")}
                  className={`rounded-full px-3 py-1.5 transition ${
                    regionFilter === "global" ? "bg-gold text-black font-semibold" : "text-white/70 hover:text-white"
                  }`}
                >
                  Global
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-md">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-gold block mb-2">
                  Discovery Depth
                </label>
                <div className="flex rounded-xl bg-black/40 p-1 border border-white/10 text-xs">
                  <button
                    onClick={() => handleStyleChange("popular")}
                    className={`flex-1 py-1.5 rounded-lg transition ${
                      discoveryStyle === "popular"
                        ? "bg-gold text-black font-bold shadow"
                        : "text-white/60 hover:text-white"
                    }`}
                  >
                    Mainstream Hits
                  </button>
                  <button
                    onClick={() => handleStyleChange("balanced")}
                    className={`flex-1 py-1.5 rounded-lg transition ${
                      discoveryStyle === "balanced"
                        ? "bg-gold text-black font-bold shadow"
                        : "text-white/60 hover:text-white"
                    }`}
                  >
                    Balanced
                  </button>
                  <button
                    onClick={() => handleStyleChange("deepcuts")}
                    className={`flex-1 py-1.5 rounded-lg transition ${
                      discoveryStyle === "deepcuts"
                        ? "bg-gold text-black font-bold shadow"
                        : "text-white/60 hover:text-white"
                    }`}
                  >
                    ★ Hidden Gems
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-gold block mb-2">
                  Cinematic Era
                </label>
                <div className="flex rounded-xl bg-black/40 p-1 border border-white/10 text-xs">
                  {(
                    [
                      { id: "all", label: "All Eras" },
                      { id: "classic", label: "Pre-2005" },
                      { id: "modern", label: "2005-2019" },
                      { id: "recent", label: "2020s" },
                    ] as const
                  ).map((era) => (
                    <button
                      key={era.id}
                      onClick={() => handleEraChange(era.id)}
                      className={`flex-1 py-1.5 rounded-lg transition ${
                        eraFilter === era.id
                          ? "bg-gold text-black font-bold shadow"
                          : "text-white/60 hover:text-white"
                      }`}
                    >
                      {era.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-gold block mb-2">
                  Taste / Mood Focus
                </label>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {(
                    [
                      { id: "all", label: "All Moods" },
                      { id: "mindbending", label: "🌀 Mind-Bending" },
                      { id: "dark", label: "🕯️ Dark & Gritty" },
                      { id: "adrenaline", label: "⚡ High Adrenaline" },
                      { id: "feelgood", label: "✨ Feel-Good" },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      onClick={() => handleMoodChange(m.id)}
                      className={`px-2.5 py-1 rounded-lg border transition ${
                        moodFilter === m.id
                          ? "bg-gold text-black border-gold font-bold shadow"
                          : "bg-black/30 border-white/10 text-white/70 hover:border-white/30 hover:text-white"
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-8 rounded-xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-200">
            {error}
          </div>
        )}

        {loading ? (
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="poster aspect-[2/3] animate-pulse rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="space-y-6 mt-6">
            {cleanThematicShelves.map((shelf) =>
              renderSection(shelf.title, shelf.badge, shelf.items, shelf.subtitle)
            )}
            {showIndianMovies && renderSection("Indian Movies", "Cinema", cleanIndianMovies)}
            {showGlobalMovies && renderSection("Global & Hollywood Movies", "Movies", cleanGlobalMovies)}
            {showIndianSeries && renderSection("Indian Web Series & Shows", "Indian TV", cleanIndianSeries)}
            {showGlobalSeries && renderSection("Global & International Series", "TV Shows", cleanGlobalSeries)}
          </div>
        )}

        <div className="mt-12 flex flex-wrap gap-3">
          <button
            onClick={() => get(discoveryStyle, eraFilter, moodFilter)}
            className="rounded-full border border-white/20 px-6 py-3 text-sm hover:bg-white/10 transition"
          >
            Refresh recommendations
          </button>
          <Link href="/discover" className="rounded-full bg-gold px-6 py-3 font-bold text-black text-sm shadow hover:brightness-110 transition">
            Discover more titles
          </Link>
        </div>
      </div>
    </main>
  );
}