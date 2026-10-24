"use client";

import Link from "next/link";
import { useEffect, useState, useMemo } from "react";
import { Title, keyOf, MediaType } from "@/types/title";
import { load, save, syncWithServer, State } from "@/lib/storage";
import { TitleCard } from "@/components/TitleCard";
import { StorageControls } from "@/components/StorageControls";

type Filter = "all" | MediaType;
type Sort = "alphabetical" | "genre" | "rating";

const sortOptions: { label: string; value: Sort }[] = [
  { label: "Alphabetical", value: "alphabetical" },
  { label: "Genre", value: "genre" },
  { label: "Rating (High to Low)", value: "rating" },
];

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

  useEffect(() => {
    setState(load());
    setIsLoaded(true);

    syncWithServer().then((synced) => {
      setState(synced);
    });
  }, []);

  const removeTitle = (title: Title) => {
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
  };

  const removeAll = () => {
    if (confirm("Are you sure you want to clear your entire watched history?")) {
      setState((prev) => {
        const nextState: State = { ...prev, watched: [] };
        save(nextState);
        return nextState;
      });
    }
  };

  const filteredWatched = useMemo(() => {
    return state.watched.filter((t) => {
      const matchesType = filter === "all" || t.mediaType === filter;
      const matchesSearch = t.title
        .toLowerCase()
        .includes(searchQuery.trim().toLowerCase());
      return matchesType && matchesSearch;
    });
  }, [state.watched, filter, searchQuery]);

  const sortedWatched = useMemo(() => {
    const getGenreName = (t: Title): string => {
      if (!t.genres || t.genres.length === 0) return "";
      const first = t.genres[0];
      return typeof first === "string" ? first : (first as { name?: string }).name || "";
    };

    return [...filteredWatched].sort((a: Title, b: Title): number => {
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
  }, [filteredWatched, sort]);

  const movieCount = state.watched.filter((t) => t.mediaType === "movie").length;
  const tvCount = state.watched.filter((t) => t.mediaType === "tv").length;

  if (!isLoaded) {
    return null;
  }

  return (
    <main className="min-h-screen px-4 py-8 md:px-10">
      <header className="mx-auto flex max-w-7xl items-center justify-between gap-4">
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

      <section className="mx-auto max-w-7xl py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold md:text-4xl">Viewed Titles</h1>
            <p className="mt-2 text-white/65">
              You have recorded{" "}
              <span className="font-semibold text-white">
                {state.watched.length}
              </span>{" "}
              watched title{state.watched.length === 1 ? "" : "s"} (
              {movieCount} movies, {tvCount} series).
            </p>
          </div>
          {state.watched.length > 0 && (
            <button
              onClick={removeAll}
              className="text-xs text-red-400/80 hover:text-red-400 underline"
            >
              Clear all history
            </button>
          )}
        </div>

        {state.watched.length > 0 && (
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
                All ({state.watched.length})
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
                  placeholder="Search watched titles..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs text-white placeholder-white/40 focus:border-gold focus:outline-none"
                />
              </div>
            </div>
          </div>
        )}

        {state.watched.length === 0 ? (
          <div className="mt-12 rounded-xl border border-white/10 p-12 text-center">
            <h2 className="text-xl font-bold">No watched titles yet</h2>
            <p className="mt-2 text-sm text-white/60">
              Browse the discovery feed to add movies and series you have already seen.
            </p>
            <Link
              href="/discover"
              className="mt-6 inline-block rounded-full bg-gold px-6 py-2.5 text-sm font-bold text-black"
            >
              Start Discovering
            </Link>
          </div>
        ) : sortedWatched.length === 0 ? (
          <div className="mt-12 rounded-xl border border-white/10 p-8 text-center text-white/60 text-sm">
            No watched titles match your search or filter.
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-5">
            {sortedWatched.map((t) => (
              <div key={keyOf(t)} className="flex flex-col">
                <TitleCard title={t} />
                {t.mediaType === "tv" && t.watchedSeasons && t.watchedSeasons.length > 0 && (
                  <span className="mt-1 text-[11px] text-white/50">
                    Seasons watched: {t.watchedSeasons.join(", ")}
                  </span>
                )}
                <button
                  onClick={() => removeTitle(t)}
                  title={`Remove ${t.title} from history`}
                  className="mt-2 w-full rounded-lg border border-red-500/20 bg-red-500/10 py-1.5 text-xs text-red-300 transition hover:border-red-500/40 hover:bg-red-500/20"
                >
                  Remove from history
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            href="/discover"
            className="rounded-full border border-white/20 px-6 py-3 text-sm hover:border-white/40"
          >
            Add more titles
          </Link>
          <Link
            href="/watchlist"
            className="rounded-full border border-white/20 px-6 py-3 text-sm hover:border-white/40"
          >
            My Watchlist ({state.watchlist.length})
          </Link>
          {state.watched.length >= 10 ? (
            <Link
              href="/recommendations"
              className="rounded-full bg-gold px-6 py-3 text-sm font-bold text-black"
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