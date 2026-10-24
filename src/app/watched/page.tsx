"use client";

import Link from "next/link";
import { useEffect, useState, useMemo, useCallback } from "react";
import { Title, keyOf, MediaType } from "@/types/title";
import { load, save, syncWithServer, State } from "@/lib/storage";
import { TitleCard } from "@/components/TitleCard";
import { StorageControls } from "@/components/StorageControls";
import { poster } from "@/lib/tmdb";

type Filter = "all" | MediaType;
type Sort = "alphabetical" | "genre" | "rating" | "year-new" | "year-old";
type ViewMode = "grid" | "list";

const sortOptions: { label: string; value: Sort }[] = [
  { label: "Alphabetical", value: "alphabetical" },
  { label: "Genre", value: "genre" },
  { label: "Rating (High → Low)", value: "rating" },
  { label: "Year (Newest)", value: "year-new" },
  { label: "Year (Oldest)", value: "year-old" },
];

const genreColors: Record<string, string> = {
  Action: "from-red-500/30 to-red-600/10 border-red-500/30 text-red-300",
  Adventure: "from-orange-500/30 to-orange-600/10 border-orange-500/30 text-orange-300",
  Animation: "from-pink-500/30 to-pink-600/10 border-pink-500/30 text-pink-300",
  Comedy: "from-yellow-500/30 to-yellow-600/10 border-yellow-500/30 text-yellow-300",
  Crime: "from-slate-500/30 to-slate-600/10 border-slate-500/30 text-slate-300",
  Documentary: "from-teal-500/30 to-teal-600/10 border-teal-500/30 text-teal-300",
  Drama: "from-blue-500/30 to-blue-600/10 border-blue-500/30 text-blue-300",
  Family: "from-green-500/30 to-green-600/10 border-green-500/30 text-green-300",
  Fantasy: "from-violet-500/30 to-violet-600/10 border-violet-500/30 text-violet-300",
  History: "from-amber-500/30 to-amber-600/10 border-amber-500/30 text-amber-300",
  Horror: "from-rose-500/30 to-rose-600/10 border-rose-500/30 text-rose-300",
  Music: "from-fuchsia-500/30 to-fuchsia-600/10 border-fuchsia-500/30 text-fuchsia-300",
  Mystery: "from-indigo-500/30 to-indigo-600/10 border-indigo-500/30 text-indigo-300",
  Romance: "from-pink-400/30 to-pink-500/10 border-pink-400/30 text-pink-300",
  "Science Fiction": "from-cyan-500/30 to-cyan-600/10 border-cyan-500/30 text-cyan-300",
  "Sci-Fi & Fantasy": "from-cyan-500/30 to-cyan-600/10 border-cyan-500/30 text-cyan-300",
  Thriller: "from-emerald-500/30 to-emerald-600/10 border-emerald-500/30 text-emerald-300",
  War: "from-stone-500/30 to-stone-600/10 border-stone-500/30 text-stone-300",
  Western: "from-amber-600/30 to-amber-700/10 border-amber-600/30 text-amber-200",
  "Action & Adventure": "from-red-500/30 to-orange-600/10 border-red-500/30 text-red-300",
  "War & Politics": "from-stone-500/30 to-stone-600/10 border-stone-500/30 text-stone-300",
};

const defaultGenreColor = "from-white/10 to-white/5 border-white/20 text-white/80";

export default function WatchedPage() {
  const [state, setState] = useState<State>({
    watched: [],
    displayed: [],
    shown: [],
    watchlist: [],
    dismissed: [],
  });
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("alphabetical");
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoaded, setIsLoaded] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [genreFilter, setGenreFilter] = useState<string | null>(null);

  useEffect(() => {
    setState(load());
    setIsLoaded(true);
    syncWithServer().then((synced) => {
      setState(synced);
    });
  }, []);

  const removeTitle = useCallback(
    (title: Title) => {
      const k = keyOf(title);
      setState((prev) => {
        const nextState: State = {
          ...prev,
          watched: prev.watched.filter((item) => keyOf(item) !== k),
          displayed: prev.displayed.filter((id) => id !== k),
        };
        save(nextState);
        return nextState;
      });
    },
    []
  );

  const moveToWatchlist = useCallback(
    (title: Title) => {
      const k = keyOf(title);
      setState((prev) => {
        const alreadyInWatchlist = prev.watchlist.some((item) => keyOf(item) === k);
        const nextState: State = {
          ...prev,
          watched: prev.watched.filter((item) => keyOf(item) !== k),
          displayed: prev.displayed.filter((id) => id !== k),
          watchlist: alreadyInWatchlist ? prev.watchlist : [...prev.watchlist, title],
        };
        save(nextState);
        return nextState;
      });
    },
    []
  );

  const removeAll = () => {
    if (confirm("Are you sure you want to clear your entire watched history?")) {
      setState((prev) => {
        const nextState: State = { ...prev, watched: [] };
        save(nextState);
        return nextState;
      });
    }
  };

  const movieCount = state.watched.filter((t) => t.mediaType === "movie").length;
  const tvCount = state.watched.filter((t) => t.mediaType === "tv").length;

  const avgRating = useMemo(() => {
    if (state.watched.length === 0) return 0;
    const sum = state.watched.reduce((acc, t) => acc + (t.rating ?? 0), 0);
    return sum / state.watched.length;
  }, [state.watched]);

  const estimatedHours = useMemo(() => {
    return state.watched.reduce((acc, t) => {
      if (t.mediaType === "movie") return acc + 2;
      const seasons = t.watchedSeasons?.length || 1;
      return acc + seasons * 8;
    }, 0);
  }, [state.watched]);

  const highestRated = useMemo(() => {
    if (state.watched.length === 0) return null;
    return state.watched.reduce((best, t) => (t.rating > best.rating ? t : best), state.watched[0]);
  }, [state.watched]);

  const genreDistribution = useMemo(() => {
    const map = new Map<string, number>();
    state.watched.forEach((t) => {
      (t.genreNames || []).forEach((g) => {
        map.set(g, (map.get(g) || 0) + 1);
      });
    });
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12);
  }, [state.watched]);

  const decadeDistribution = useMemo(() => {
    const map = new Map<string, number>();
    state.watched.forEach((t) => {
      if (t.year) {
        const decade = `${Math.floor(t.year / 10) * 10}s`;
        map.set(decade, (map.get(decade) || 0) + 1);
      }
    });
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [state.watched]);

  const recentlyAdded = useMemo(() => {
    return state.watched.slice(-6).reverse();
  }, [state.watched]);

  const filteredWatched = useMemo(() => {
    return state.watched.filter((t) => {
      const matchesType = filter === "all" || t.mediaType === filter;
      const matchesSearch = t.title
        .toLowerCase()
        .includes(searchQuery.trim().toLowerCase());
      const matchesGenre =
        !genreFilter || (t.genreNames || []).includes(genreFilter);
      return matchesType && matchesSearch && matchesGenre;
    });
  }, [state.watched, filter, searchQuery, genreFilter]);

  const sortedWatched = useMemo(() => {
    const getGenreName = (t: Title): string => {
      if (!t.genres || t.genres.length === 0) return "";
      const first = t.genres[0];
      return typeof first === "string" ? first : (first as { name?: string }).name || "";
    };

    return [...filteredWatched].sort((a: Title, b: Title): number => {
      if (sort === "alphabetical") return a.title.localeCompare(b.title);
      if (sort === "genre") return getGenreName(a).localeCompare(getGenreName(b));
      if (sort === "rating") return (b.rating ?? 0) - (a.rating ?? 0);
      if (sort === "year-new") return (b.year ?? 0) - (a.year ?? 0);
      if (sort === "year-old") return (a.year ?? 0) - (b.year ?? 0);
      return 0;
    });
  }, [filteredWatched, sort]);

  if (!isLoaded) {
    return (
      <main className="min-h-screen px-4 py-8 md:px-10">
        <div className="mx-auto max-w-7xl">
          <div className="h-8 w-48 animate-pulse rounded bg-white/10 mb-8" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-xl bg-white/5 border border-white/10" />
            ))}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-8 md:px-10 pb-16">
      <header className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 mb-8">
        <Link href="/" className="font-bold tracking-[.2em] text-gold">
          REEL RADAR
        </Link>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link href="/discover" className="text-white/70 transition hover:text-white">
            Discover
          </Link>
          <Link href="/search" className="text-white/70 transition hover:text-white">
            Search
          </Link>
          <span className="rounded-full bg-gold/15 px-3 py-1 font-semibold text-gold border border-gold/30">
            Viewed ({state.watched.length})
          </span>
          <Link href="/watchlist" className="text-white/70 transition hover:text-white">
            Watchlist ({state.watchlist.length})
          </Link>
          <Link
            href="/recommendations"
            className="text-white/70 transition hover:text-white"
          >
            Recommendations
          </Link>
          <Link href="/analysis" className="text-white/70 transition hover:text-white">
            Analysis
          </Link>
          <StorageControls onStateChange={(s) => setState(s)} />
        </div>
      </header>

      <section className="mx-auto max-w-7xl">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-white/10">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase font-bold tracking-widest text-gold">Personal Library</span>
              <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] text-white/70">Screening History</span>
            </div>
            <h1 className="mt-1 text-3xl font-extrabold md:text-4xl text-white">
              Viewed Titles
            </h1>
            <p className="mt-1.5 text-sm text-white/60">
              Your complete screening history — every movie and series you have already watched, organized and at a glance.
            </p>
          </div>
          {state.watched.length > 0 && (
            <button
              onClick={removeAll}
              className="text-xs text-red-400/70 hover:text-red-400 underline transition shrink-0"
            >
              Clear all history
            </button>
          )}
        </div>

        {state.watched.length === 0 ? (
          <div className="mt-12 rounded-2xl border border-white/10 bg-panel p-12 text-center max-w-2xl mx-auto">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gold/10 border border-gold/30 text-gold mb-4 text-2xl">
              🎞️
            </div>
            <h2 className="text-2xl font-bold">No Watched Titles Yet</h2>
            <p className="mt-2 text-sm text-white/60 leading-relaxed">
              Start building your personal library by marking movies and series you have already seen.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link
                href="/discover"
                className="rounded-full bg-gold px-6 py-2.5 text-sm font-bold text-black transition hover:brightness-110"
              >
                Browse Discovery
              </Link>
              <Link
                href="/search"
                className="rounded-full border border-white/20 px-6 py-2.5 text-sm font-semibold text-white hover:border-gold hover:text-gold"
              >
                Search Titles
              </Link>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-5">
              <div className="rounded-2xl border border-gold/30 bg-gradient-to-br from-gold/15 to-panel p-5 relative overflow-hidden">
                <span className="text-xs uppercase font-bold text-gold tracking-wider">Total Titles</span>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold text-white">{state.watched.length}</span>
                  <span className="text-xs text-white/60">screened</span>
                </div>
                <div className="mt-2 flex gap-2 text-[11px] text-white/50 border-t border-white/10 pt-2">
                  <span>🎬 {movieCount} films</span>
                  <span>•</span>
                  <span>📺 {tvCount} series</span>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-panel p-5">
                <span className="text-xs uppercase font-semibold text-white/50 tracking-wider">Avg. Rating</span>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold text-emerald-400">★ {avgRating.toFixed(1)}</span>
                  <span className="text-xs text-white/50">/ 10</span>
                </div>
                <div className="mt-2 h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-400 to-gold rounded-full transition-all duration-700"
                    style={{ width: `${(avgRating / 10) * 100}%` }}
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-panel p-5">
                <span className="text-xs uppercase font-semibold text-white/50 tracking-wider">Est. Screen Time</span>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold text-purple-400">~{estimatedHours}</span>
                  <span className="text-xs text-white/50">hours</span>
                </div>
                <p className="mt-2 text-[11px] text-white/50">
                  ⌛ {Math.round(estimatedHours / 24)} full days of screening
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-panel p-5">
                <span className="text-xs uppercase font-semibold text-white/50 tracking-wider">Genres Explored</span>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold text-blue-400">{genreDistribution.length}</span>
                  <span className="text-xs text-white/50">categories</span>
                </div>
                <p className="mt-2 text-[11px] text-white/50 truncate">
                  Top: {genreDistribution.slice(0, 3).map(([g]) => g).join(", ") || "—"}
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-panel p-5 col-span-2 lg:col-span-1">
                <span className="text-xs uppercase font-semibold text-white/50 tracking-wider">Crown Jewel</span>
                {highestRated ? (
                  <>
                    <h4 className="mt-2 font-bold text-sm text-white line-clamp-1" title={highestRated.title}>
                      {highestRated.title}
                    </h4>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-gold font-bold text-lg">★ {highestRated.rating.toFixed(1)}</span>
                      <span className="text-[10px] text-white/50">{highestRated.year}</span>
                    </div>
                  </>
                ) : (
                  <p className="mt-2 text-xs text-white/50">No data yet</p>
                )}
              </div>
            </div>

            {genreDistribution.length > 0 && (
              <div className="mt-6 rounded-2xl border border-white/10 bg-panel p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-sm text-white flex items-center gap-2">
                    <span>🧬</span> Genre Fingerprint
                  </h3>
                  {genreFilter && (
                    <button
                      onClick={() => setGenreFilter(null)}
                      className="text-[11px] text-gold underline hover:text-white transition"
                    >
                      Clear genre filter
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {genreDistribution.map(([genre, count]) => {
                    const pct = Math.round((count / state.watched.length) * 100);
                    const colors = genreColors[genre] || defaultGenreColor;
                    const isActive = genreFilter === genre;
                    return (
                      <button
                        key={genre}
                        onClick={() => setGenreFilter(isActive ? null : genre)}
                        className={`flex items-center gap-1.5 rounded-full border bg-gradient-to-r px-3 py-1.5 text-xs font-medium transition-all ${colors} ${
                          isActive ? "ring-2 ring-gold shadow-lg scale-105" : "hover:scale-105 hover:shadow-md"
                        }`}
                      >
                        <span>{genre}</span>
                        <span className="rounded-full bg-black/30 px-1.5 py-0.5 text-[10px] font-bold">
                          {count} ({pct}%)
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {recentlyAdded.length > 0 && !searchQuery && !genreFilter && filter === "all" && (
              <div className="mt-6 rounded-2xl border border-white/10 bg-gradient-to-r from-panel via-neutral-900/80 to-panel p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-sm text-white flex items-center gap-2">
                    <span>⚡</span> Recently Added
                  </h3>
                  <span className="text-[11px] text-white/40">Latest additions to your library</span>
                </div>
                <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
                  {recentlyAdded.map((t) => (
                    <div
                      key={keyOf(t)}
                      className="flex-shrink-0 w-28 group"
                    >
                      <div className="relative aspect-[2/3] rounded-xl overflow-hidden border border-white/10 group-hover:border-gold/50 transition-all group-hover:shadow-lg group-hover:shadow-gold/10">
                        {t.posterPath ? (
                          <img
                            src={poster(t.posterPath)!}
                            alt={t.title}
                            className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
                            loading="lazy"
                          />
                        ) : (
                          <span className="absolute inset-0 grid place-items-center text-[10px] text-white/50 poster">
                            No poster
                          </span>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                        <span className="absolute bottom-1.5 left-1.5 right-1.5 text-[10px] text-white font-semibold opacity-0 group-hover:opacity-100 transition-opacity line-clamp-2 leading-tight">
                          {t.title}
                        </span>
                        <span className="absolute top-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-gold">
                          ★ {t.rating.toFixed(1)}
                        </span>
                      </div>
                      <p className="mt-1.5 text-[11px] text-white/70 line-clamp-1 text-center font-medium">
                        {t.title}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-2 flex-wrap items-center">
                <div className="flex rounded-full bg-white/5 p-1 border border-white/10 text-xs">
                  {([
                    { key: "all" as Filter, label: `All (${state.watched.length})` },
                    { key: "movie" as Filter, label: `Movies (${movieCount})` },
                    { key: "tv" as Filter, label: `Series (${tvCount})` },
                  ]).map((f) => (
                    <button
                      key={f.key}
                      onClick={() => setFilter(f.key)}
                      className={`rounded-full px-3 py-1.5 font-medium transition ${
                        filter === f.key
                          ? "bg-gold text-black font-semibold shadow"
                          : "text-white/70 hover:text-white"
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                {genreFilter && (
                  <span className="flex items-center gap-1 rounded-full bg-gold/15 border border-gold/30 px-3 py-1 text-xs text-gold font-medium">
                    {genreFilter}
                    <button onClick={() => setGenreFilter(null)} className="ml-0.5 hover:text-white">✕</button>
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="flex items-center gap-2">
                  <label htmlFor="sort-select" className="text-xs text-white/60">
                    Sort:
                  </label>
                  <select
                    id="sort-select"
                    value={sort}
                    onChange={(e) => setSort(e.target.value as Sort)}
                    className="rounded-full border border-white/10 bg-neutral-900 px-3 py-1.5 text-xs text-white focus:border-gold focus:outline-none"
                  >
                    {sortOptions.map((opt) => (
                      <option key={opt.value} value={opt.value} className="bg-neutral-900 text-white">
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="w-full sm:w-56">
                  <input
                    type="text"
                    placeholder="Search watched titles..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs text-white placeholder-white/40 focus:border-gold focus:outline-none"
                  />
                </div>

                <div className="flex rounded-full bg-white/5 border border-white/10 p-0.5">
                  <button
                    onClick={() => setViewMode("grid")}
                    title="Grid view"
                    className={`rounded-full px-2.5 py-1.5 text-xs transition ${
                      viewMode === "grid"
                        ? "bg-gold text-black font-bold shadow"
                        : "text-white/60 hover:text-white"
                    }`}
                  >
                    ▦
                  </button>
                  <button
                    onClick={() => setViewMode("list")}
                    title="List view"
                    className={`rounded-full px-2.5 py-1.5 text-xs transition ${
                      viewMode === "list"
                        ? "bg-gold text-black font-bold shadow"
                        : "text-white/60 hover:text-white"
                    }`}
                  >
                    ☰
                  </button>
                </div>
              </div>
            </div>

            {(searchQuery || genreFilter || filter !== "all") && (
              <p className="mt-3 text-xs text-white/50">
                Showing {sortedWatched.length} of {state.watched.length} titles
                {genreFilter && <> in <span className="text-gold font-medium">{genreFilter}</span></>}
              </p>
            )}

            {sortedWatched.length === 0 ? (
              <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-white/70 text-sm">
                <p>No watched titles match your current filter combination.</p>
                <button
                  onClick={() => { setFilter("all"); setGenreFilter(null); setSearchQuery(""); }}
                  className="mt-3 text-xs text-gold underline hover:text-white"
                >
                  Reset all filters
                </button>
              </div>
            ) : viewMode === "grid" ? (
              <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-5">
                {sortedWatched.map((t) => (
                  <div key={keyOf(t)} className="flex flex-col group">
                    <TitleCard title={t} />
                    {t.mediaType === "tv" && t.watchedSeasons && t.watchedSeasons.length > 0 && (
                      <span className="mt-1 text-[11px] text-white/50">
                        Seasons watched: {t.watchedSeasons.join(", ")}
                      </span>
                    )}
                    <div className="mt-2 flex flex-col gap-1.5">
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => moveToWatchlist(t)}
                          title={`Move ${t.title} to watchlist`}
                          className="flex-1 rounded-lg bg-white/10 py-1.5 text-[11px] text-white/80 transition hover:bg-white/20"
                        >
                          + Watchlist
                        </button>
                        <button
                          onClick={() => removeTitle(t)}
                          title={`Remove ${t.title} from history`}
                          className="flex-1 rounded-lg border border-red-500/20 bg-red-500/10 py-1.5 text-[11px] text-red-300 transition hover:border-red-500/40 hover:bg-red-500/20"
                        >
                          Remove
                        </button>
                      </div>

                      <Link
                        href={`/similar?type=${t.mediaType}&id=${t.id}`}
                        className="w-full text-center rounded-lg border border-white/10 bg-white/5 py-1.5 text-[11px] font-medium text-white/80 transition hover:border-gold/40 hover:bg-gold/10 hover:text-gold"
                      >
                        Find Similar
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-6 space-y-2">
                {sortedWatched.map((t) => (
                  <div
                    key={keyOf(t)}
                    className="flex items-center gap-4 rounded-xl border border-white/10 bg-panel p-3 hover:border-white/20 hover:bg-white/5 transition group"
                  >
                    <div className="h-16 w-11 shrink-0 rounded-lg overflow-hidden poster">
                      {t.posterPath ? (
                        <img
                          src={poster(t.posterPath)!}
                          alt={t.title}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <span className="h-full w-full grid place-items-center text-[8px] text-white/50">
                          N/A
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold text-sm text-white truncate">{t.title}</h4>
                        <span className="shrink-0 text-[10px] text-white/50">{t.year}</span>
                        <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-white/60 uppercase">
                          {t.mediaType === "tv" ? "Series" : "Movie"}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs font-bold text-gold">★ {t.rating.toFixed(1)}</span>
                        <span className="text-[11px] text-white/50 truncate">
                          {t.genreNames?.slice(0, 3).join(" • ") || ""}
                        </span>
                        {t.mediaType === "tv" && t.watchedSeasons && t.watchedSeasons.length > 0 && (
                          <span className="text-[10px] text-white/40">
                            S{t.watchedSeasons.join(", S")}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <Link
                        href={`/similar?type=${t.mediaType}&id=${t.id}`}
                        className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-medium text-white/80 hover:border-gold/40 hover:bg-gold/10 hover:text-gold transition"
                      >
                        Find Similar
                      </Link>
                      <button
                        onClick={() => moveToWatchlist(t)}
                        className="rounded-lg bg-white/10 px-3 py-1.5 text-[11px] text-white/80 hover:bg-white/20 transition"
                      >
                        + Watchlist
                      </button>
                      <button
                        onClick={() => removeTitle(t)}
                        className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-[11px] text-red-300 hover:bg-red-500/20 transition"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            href="/discover"
            className="rounded-full border border-white/20 px-6 py-3 text-sm hover:border-white/40 transition"
          >
            Add more titles
          </Link>
          <Link
            href="/watchlist"
            className="rounded-full border border-white/20 px-6 py-3 text-sm hover:border-white/40 transition"
          >
            My Watchlist ({state.watchlist.length})
          </Link>
          <Link
            href="/analysis"
            className="rounded-full border border-white/20 px-6 py-3 text-sm hover:border-white/40 transition"
          >
            Deep Analysis
          </Link>
          {state.watched.length >= 10 ? (
            <Link
              href="/recommendations"
              className="rounded-full bg-gold px-6 py-3 text-sm font-bold text-black transition hover:brightness-110"
            >
              Get my recommendations
            </Link>
          ) : (
            <span className="rounded-full bg-white/10 px-6 py-3 text-sm text-white/40">
              Select {10 - state.watched.length} more to unlock recommendations
            </span>
          )}
        </div>
      </section>
    </main>
  );
}