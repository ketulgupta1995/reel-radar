"use client";

import Link from "next/link";
import { AppSwitcher } from "@/components/AppSwitcher";
import { useEffect, useState, useMemo } from "react";
import { Title, keyOf, MediaType } from "@/types/title";
import { load, save, useStorageSync, State } from "@/lib/storage";
import { TitleCard } from "@/components/TitleCard";
import { StorageControls } from "@/components/StorageControls";

type Filter = "all" | MediaType;
type Sort = "alphabetical" | "genre" | "rating";

const sortOptions: { label: string; value: Sort }[] = [
  { label: "Alphabetical", value: "alphabetical" },
  { label: "Genre", value: "genre" },
  { label: "Rating (High to Low)", value: "rating" },
];

export default function WatchlistPage() {
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

  useEffect(() => {
    setState(load());
    setIsLoaded(true);
  }, []);

  useStorageSync(setState);

  const removeFromWatchlist = (title: Title) => {
    const k = keyOf(title);
    setState((prev) => {
      const nextState: State = {
        ...prev,
        watchlist: prev.watchlist.filter((item) => keyOf(item) !== k),
      };
      save(nextState);
      return nextState;
    });
  };

  const markAsWatched = (title: Title) => {
    const k = keyOf(title);
    setState((prev) => {
      const nextState: State = {
        ...prev,
        watchlist: prev.watchlist.filter((item) => keyOf(item) !== k),
        watched: prev.watched.some((item) => keyOf(item) === k)
          ? prev.watched
          : [...prev.watched, title],
      };
      save(nextState);
      return nextState;
    });
  };

  const removeAll = () => {
    if (confirm("Are you sure you want to clear your entire watchlist?")) {
      setState((prev) => {
        const nextState: State = { ...prev, watchlist: [] };
        save(nextState);
        return nextState;
      });
    }
  };

  const filteredWatchlist = useMemo(() => {
    return state.watchlist.filter((t) => {
      const matchesType = filter === "all" || t.mediaType === filter;
      const matchesSearch = t.title
        .toLowerCase()
        .includes(searchQuery.trim().toLowerCase());
      return matchesType && matchesSearch;
    });
  }, [state.watchlist, filter, searchQuery]);

  const sortedWatchlist = useMemo(() => {
    const getGenreName = (t: Title): string => {
      if (!t.genres || t.genres.length === 0) return "";
      const first = t.genres[0];
      return typeof first === "string" ? first : (first as { name?: string }).name || "";
    };

    return [...filteredWatchlist].sort((a: Title, b: Title): number => {
      if (sort === "alphabetical") {
        return a.title.localeCompare(b.title);
      }
      if (sort === "genre") {
        return getGenreName(a).localeCompare(getGenreName(b));
      }
      if (sort === "rating") {
        return (b.rating ?? 0) - (a.rating ?? 0);
      }
      return 0;
    });
  }, [filteredWatchlist, sort]);

  const movieCount = state.watchlist.filter((t) => t.mediaType === "movie").length;
  const tvCount = state.watchlist.filter((t) => t.mediaType === "tv").length;

  if (!isLoaded) {
    return null;
  }

  return (
    <main className="min-h-screen px-4 py-8 md:px-10">
      <header className="mx-auto flex max-w-7xl items-center justify-between gap-4">
        <AppSwitcher current="reel-radar" />
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link href="/discover" className="text-white/70 transition hover:text-white">
            Discover
          </Link>
          <Link href="/search" className="text-white/70 transition hover:text-white">
            Search
          </Link>
          <Link href="/watched" className="text-white/70 transition hover:text-white">
            Viewed titles ({state.watched.length})
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
          <Link href="/dismissed" className="text-white/70 transition hover:text-white">
            Not interested ({state.dismissed.length})
          </Link>
          <StorageControls onStateChange={(s) => setState(s)} />
        </div>
      </header>

      <section className="mx-auto max-w-7xl py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold md:text-4xl">My Watchlist</h1>
            <p className="mt-2 text-white/65">
              You have{" "}
              <span className="font-semibold text-white">
                {state.watchlist.length}
              </span>{" "}
              title{state.watchlist.length === 1 ? "" : "s"} saved to watch (
              {movieCount} movies, {tvCount} series).
            </p>
          </div>
          {state.watchlist.length > 0 && (
            <button
              onClick={removeAll}
              className="text-xs text-red-400/80 hover:text-red-400 underline"
            >
              Clear entire watchlist
            </button>
          )}
        </div>

        {state.watchlist.length > 0 && (
          <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-2">
              <button
                onClick={() => setFilter("all")}
                className={`rounded-full px-4 py-1.5 text-xs font-semibold ${
                  filter === "all"
                    ? "bg-gold text-black"
                    : "bg-white/10 text-white hover:bg-white/15"
                }`}
              >
                All ({state.watchlist.length})
              </button>
              <button
                onClick={() => setFilter("movie")}
                className={`rounded-full px-4 py-1.5 text-xs font-semibold ${
                  filter === "movie"
                    ? "bg-gold text-black"
                    : "bg-white/10 text-white hover:bg-white/15"
                }`}
              >
                Movies ({movieCount})
              </button>
              <button
                onClick={() => setFilter("tv")}
                className={`rounded-full px-4 py-1.5 text-xs font-semibold ${
                  filter === "tv"
                    ? "bg-gold text-black"
                    : "bg-white/10 text-white hover:bg-white/15"
                }`}
              >
                Series ({tvCount})
              </button>
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

              <div className="w-full sm:w-64">
                <input
                  type="text"
                  placeholder="Search watchlist..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs text-white placeholder-white/40 focus:border-gold focus:outline-none"
                />
              </div>
            </div>
          </div>
        )}

        {state.watchlist.length === 0 ? (
          <div className="mt-12 rounded-xl border border-white/10 p-12 text-center">
            <h2 className="text-xl font-bold">Your watchlist is empty</h2>
            <p className="mt-2 text-sm text-white/60">
              Save recommendations or explore discovery to add titles you want to watch later.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link
                href="/recommendations"
                className="rounded-full bg-gold px-6 py-2.5 text-sm font-bold text-black"
              >
                View Recommendations
              </Link>
              <Link
                href="/discover"
                className="rounded-full border border-white/20 px-6 py-2.5 text-sm font-bold text-white hover:border-white/40"
              >
                Discover Titles
              </Link>
            </div>
          </div>
        ) : sortedWatchlist.length === 0 ? (
          <div className="mt-12 rounded-xl border border-white/10 p-8 text-center text-white/60 text-sm">
            No watchlist titles match your search or filter.
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-5">
            {sortedWatchlist.map((t) => (
              <div key={keyOf(t)} className="flex flex-col">
                <TitleCard title={t} />
                <div className="mt-2 flex flex-col gap-1.5">
                  <button
                    onClick={() => markAsWatched(t)}
                    title={`Mark ${t.title} as watched`}
                    className="w-full rounded-lg bg-white/10 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20"
                  >
                    Mark as watched
                  </button>
                  <Link
                    href={`/similar?type=${t.mediaType}&id=${t.id}`}
                    className="w-full text-center rounded-lg border border-white/10 bg-white/5 py-1.5 text-xs font-medium text-white/80 transition hover:border-gold/40 hover:bg-gold/10 hover:text-gold"
                  >
                    Find Similar
                  </Link>
                  <button
                    onClick={() => removeFromWatchlist(t)}
                    title={`Remove ${t.title} from watchlist`}
                    className="w-full rounded-lg border border-red-500/20 bg-red-500/10 py-1.5 text-xs text-red-300 transition hover:border-red-500/40 hover:bg-red-500/20"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            href="/recommendations"
            className="rounded-full bg-gold px-6 py-3 text-sm font-bold text-black"
          >
            Get recommendations
          </Link>
          <Link
            href="/discover"
            className="rounded-full border border-white/20 px-6 py-3 text-sm hover:border-white/40"
          >
            Discover more titles
          </Link>
          <Link
            href="/watched"
            className="rounded-full border border-white/20 px-6 py-3 text-sm hover:border-white/40"
          >
            Viewed titles ({state.watched.length})
          </Link>
        </div>
      </section>
    </main>
  );
}