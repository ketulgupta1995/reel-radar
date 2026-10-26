"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Title, keyOf, MediaType } from "@/types/title";
import { load, reset, save, syncWithServer, State, clearDiscoveryHistory } from "@/lib/storage";
import { TitleCard } from "@/components/TitleCard";
import { StorageControls } from "@/components/StorageControls";

type Filter = "all" | MediaType;
type RegionFilter = "all" | "in" | "global";

export default function Discover() {
  const [state, setState] = useState<State>({
    watched: [],
    displayed: [],
    shown: [],
    watchlist: [],
    dismissed: [],
  });

  const [movieTitles, setMovieTitles] = useState<Title[]>([]);
  const [tvTitles, setTvTitles] = useState<Title[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [region, setRegion] = useState<RegionFilter>("all");
  const [loadingMovies, setLoadingMovies] = useState(true);
  const [loadingTv, setLoadingTv] = useState(true);
  const [error, setError] = useState("");

  const isInitialMount = useRef(true);
  const moviePageRef = useRef<number>(1);
  const tvPageRef = useRef<number>(1);
  const count = state.watched.length;

  const update = (fn: (s: State) => State) =>
    setState((s) => {
      const n = fn(s);
      save(n);
      return n;
    });

  const getExcludeKeys = (s: State) => {
    return new Set([
      ...s.watched.map(keyOf),
      ...(s.dismissed || []),
      ...(s.displayed || []),
      ...(s.shown || []),
    ]);
  };

  const fetchCategoryBatch = async (
    type: MediaType,
    currentState: State,
    currentRegion = region,
    resetPage = false
  ) => {
    if (type === "movie") setLoadingMovies(true);
    else setLoadingTv(true);
    setError("");

    try {
      let page = resetPage ? 1 : (type === "movie" ? moviePageRef.current : tvPageRef.current);
      const excludeKeys = getExcludeKeys(currentState);
      const fresh: Title[] = [];
      const freshKeys = new Set<string>();

      let pagesScanned = 0;
      const maxPagesToScan = 8;

      while (fresh.length < 15 && pagesScanned < maxPagesToScan) {
        const r = await fetch(
          `/api/discover?type=${type}&region=${currentRegion}&page=${page}`
        );
        const d = await r.json();

        if (!r.ok) throw new Error(d.error || `Couldn't load ${type === "movie" ? "movies" : "series"}`);

        const results: Title[] = d.results || [];
        if (!results.length) {
          if (page > 1 && fresh.length === 0) {
            page = 1;
            pagesScanned++;
            continue;
          }
          break;
        }

        for (const item of results) {
          const k = keyOf(item);
          if (!excludeKeys.has(k) && !freshKeys.has(k)) {
            freshKeys.add(k);
            fresh.push(item);
            if (fresh.length >= 15) break;
          }
        }
        page++;
        pagesScanned++;
      }

      if (type === "movie") {
        moviePageRef.current = page;
        setMovieTitles(fresh);
      } else {
        tvPageRef.current = page;
        setTvTitles(fresh);
      }

      if (fresh.length > 0) {
        update((s) => ({
          ...s,
          displayed: [...new Set([...s.displayed, ...fresh.map(keyOf)])],
        }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load titles");
    } finally {
      if (type === "movie") setLoadingMovies(false);
      else setLoadingTv(false);
    }
  };

  const loadAllBatches = (currentState: State, currentRegion = region, resetPage = false) => {
    if (resetPage) {
      moviePageRef.current = 1;
      tvPageRef.current = 1;
    }
    fetchCategoryBatch("movie", currentState, currentRegion, resetPage);
    fetchCategoryBatch("tv", currentState, currentRegion, resetPage);
  };

  useEffect(() => {
    const s = load();
    setState(s);
    loadAllBatches(s, region, false);
    syncWithServer().then((synced) => {
      setState(synced);
    });
  }, []);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    const s = load();
    setState(s);
    loadAllBatches(s, region, true);
  }, [region]);

  const toggle = (t: Title) =>
    update((s) => {
      const has = s.watched.some((x) => keyOf(x) === keyOf(t));
      return {
        ...s,
        watched: has ? s.watched.filter((x) => keyOf(x) !== keyOf(t)) : [...s.watched, t],
        watchlist: has ? s.watchlist : s.watchlist.filter((x) => keyOf(x) !== keyOf(t)),
      };
    });

  const changeSeasons = (t: Title, seasons: number[]) =>
    update((s) => ({
      ...s,
      watched: s.watched.map((x) =>
        keyOf(x) === keyOf(t) ? { ...x, watchedSeasons: seasons } : x
      ),
    }));

  const dismissTitle = (t: Title) => {
    const k = keyOf(t);
    update((s) => ({
      ...s,
      dismissed: s.dismissed ? [...new Set([...s.dismissed, k])] : [k],
      watchlist: s.watchlist.filter((x) => keyOf(x) !== k),
    }));
    setMovieTitles((prev) => prev.filter((x) => keyOf(x) !== k));
    setTvTitles((prev) => prev.filter((x) => keyOf(x) !== k));
  };

  const selected = new Set(state.watched.map(keyOf));
  const series = state.watched.filter((t) => t.mediaType === "tv");

  const renderCardGrid = (
    items: Title[],
    loading: boolean,
    onLoadMore: () => void,
    categoryName: string
  ) => {
    if (loading) {
      return (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <div className="poster aspect-[2/3] animate-pulse rounded-xl" key={i} />
          ))}
        </div>
      );
    }
    if (items.length === 0) {
      return (
        <div className="rounded-xl border border-white/10 p-8 text-center text-white/60">
          No unseen {categoryName.toLowerCase()} found for this region. Click below to scan deeper!
          <div className="mt-3">
            <button
              onClick={onLoadMore}
              className="rounded-full border border-white/20 px-4 py-1.5 text-xs text-white hover:bg-white/10"
            >
              Scan next batch
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {items.map((t) => {
          const isWatched = selected.has(keyOf(t));
          const inWatchlist = state.watchlist.some((x) => keyOf(x) === keyOf(t));
          return (
            <div key={keyOf(t)} className="flex flex-col">
              <TitleCard
                title={t}
                selected={isWatched}
                onToggle={() => toggle(t)}
              />
              <div className="mt-2 flex flex-col gap-1.5">
                <div className="flex gap-2">
                  <button
                    onClick={() => toggle(t)}
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
                    onClick={() => {
                      update((s) => ({
                        ...s,
                        watchlist: inWatchlist
                          ? s.watchlist.filter((x) => keyOf(x) !== keyOf(t))
                          : [...s.watchlist, t],
                      }));
                    }}
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
                  href={`/similar?type=${t.mediaType}&id=${t.id}`}
                  className="w-full text-center rounded-lg border border-white/10 bg-white/5 py-1.5 text-[11px] font-medium text-white/80 transition hover:border-gold/40 hover:bg-gold/10 hover:text-gold"
                >
                  Find Similar
                </Link>
                <button
                  onClick={() => dismissTitle(t)}
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
    );
  };

  return (
    <main className="min-h-screen px-4 py-7 md:px-10 pb-16">
      <header className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
        <Link href="/" className="font-bold tracking-[.2em] text-gold">
          REEL RADAR
        </Link>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link
            href="/search"
            className="text-white/70 transition hover:text-white"
          >
            Search
          </Link>
          <Link
            href="/watchlist"
            className="rounded-full bg-white/10 px-3.5 py-1.5 text-xs text-white/80 transition hover:bg-white/20 hover:text-white"
          >
            Watchlist (<b className="text-gold">{state.watchlist.length}</b>)
          </Link>
          <Link
            href="/watched"
            className="rounded-full bg-white/10 px-3.5 py-1.5 text-xs text-white/80 transition hover:bg-white/20 hover:text-white"
          >
            Viewed titles (<b className="text-gold">{count}</b>)
          </Link>
          <Link
            href="/recommendations"
            className="text-white/70 transition hover:text-white text-xs"
          >
            Recommendations
          </Link>
          <Link
            href="/analysis"
            className="text-white/70 transition hover:text-white text-xs"
          >
            Analysis
          </Link>
          <Link
            href="/todos"
            className="text-white/70 transition hover:text-white text-xs"
          >
            Daily Todos
          </Link>
          <StorageControls onStateChange={(merged) => setState(merged)} />
          <button
            onClick={() => {
              if (
                confirm(
                  "Clear displayed and shown titles history? (Your watched list, watchlist, and dismissed titles will be kept)"
                )
              ) {
                const refreshedState = clearDiscoveryHistory();
                setState(refreshedState);
                loadAllBatches(refreshedState, region, true);
              }
            }}
            className="text-xs text-blue-300 hover:text-blue-200 bg-blue-500/10 border border-blue-500/30 px-2.5 py-1 rounded transition"
          >
            Clear Displayed &amp; Shown
          </button>
          <button
            onClick={() => {
              if (confirm("Reset ALL data including watched history and watchlist?")) {
                reset();
                location.reload();
              }
            }}
            className="text-xs text-white/50 underline hover:text-red-400"
          >
            Reset All
          </button>
        </div>
      </header>

      <section className="mx-auto max-w-7xl py-10">
        <h1 className="text-3xl font-bold">Build your viewing history</h1>
        <p className="mt-2 text-white/65">
          Select what you have seen across Hollywood and Indian cinema. Series and Movies are segregated for effortless tracking.
        </p>

        <div className="mt-5 h-2 overflow-hidden rounded bg-white/10">
          <div
            className="h-full bg-gold transition-all duration-300"
            style={{ width: `${Math.min(100, count * 10)}%` }}
          />
        </div>

        <div className="mt-2 flex items-center justify-between">
          <p className="text-sm text-white/60">
            {count >= 10
              ? `Great progress! With ${count} viewed titles, your recommendations are calibrated with deep affinity.`
              : `Select ${10 - count} more to unlock recommendations.`}
          </p>
          {count > 0 && (
            <Link href="/watched" className="text-xs text-gold underline">
              Manage viewed titles ({count})
            </Link>
          )}
        </div>

        <div className="mt-7 flex flex-wrap items-center justify-between gap-4">
          <div className="flex gap-2">
            {(["all", "movie", "tv"] as Filter[]).map((x) => (
              <button
                key={x}
                onClick={() => setFilter(x)}
                className={`rounded-full px-4 py-2 text-sm transition ${
                  filter === x ? "bg-gold text-black font-semibold shadow-md" : "bg-white/10 text-white hover:bg-white/20"
                }`}
              >
                {x === "all" ? "Both (Movies & Series)" : x === "tv" ? "Series only" : "Movies only"}
              </button>
            ))}
          </div>

          <div className="flex gap-2 rounded-full bg-white/5 p-1 border border-white/10">
            <button
              onClick={() => setRegion("all")}
              className={`rounded-full px-3 py-1.5 text-xs transition ${
                region === "all" ? "bg-gold text-black font-semibold" : "text-white/70 hover:text-white"
              }`}
            >
              All Regions
            </button>
            <button
              onClick={() => setRegion("in")}
              className={`rounded-full px-3 py-1.5 text-xs transition ${
                region === "in" ? "bg-gold text-black font-semibold" : "text-white/70 hover:text-white"
              }`}
            >
              Indian Cinema & Series
            </button>
            <button
              onClick={() => setRegion("global")}
              className={`rounded-full px-3 py-1.5 text-xs transition ${
                region === "global" ? "bg-gold text-black font-semibold" : "text-white/70 hover:text-white"
              }`}
            >
              Hollywood & Global
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-8 rounded-xl border border-red-400/40 p-5">
            {error}{" "}
            <button
              onClick={() => loadAllBatches(load(), region, true)}
              className="underline"
            >
              Retry
            </button>
          </div>
        )}

        {(filter === "all" || filter === "movie") && (
          <div className="mt-10">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <span>🎥</span> Feature Films & Movies
                </h2>
                <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-white/70">
                  {movieTitles.length} items
                </span>
              </div>
              <button
                onClick={() => fetchCategoryBatch("movie", load(), region, false)}
                disabled={loadingMovies}
                className="text-xs text-gold border border-gold/30 rounded-full px-3 py-1 hover:bg-gold hover:text-black transition disabled:opacity-50"
              >
                {loadingMovies ? "Loading..." : "Next batch of Movies ➜"}
              </button>
            </div>
            {renderCardGrid(movieTitles, loadingMovies, () => fetchCategoryBatch("movie", load(), region, false), "Movies")}
          </div>
        )}

        {(filter === "all" || filter === "tv") && (
          <div className="mt-14">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <span>📺</span> TV & Web Series
                </h2>
                <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-white/70">
                  {tvTitles.length} items
                </span>
              </div>
              <button
                onClick={() => fetchCategoryBatch("tv", load(), region, false)}
                disabled={loadingTv}
                className="text-xs text-gold border border-gold/30 rounded-full px-3 py-1 hover:bg-gold hover:text-black transition disabled:opacity-50"
              >
                {loadingTv ? "Loading..." : "Next batch of Series ➜"}
              </button>
            </div>
            {renderCardGrid(tvTitles, loadingTv, () => fetchCategoryBatch("tv", load(), region, false), "Series")}
          </div>
        )}

        {series.length > 0 && (
          <section className="mt-14 rounded-xl border border-white/10 bg-panel p-5">
            <h2 className="font-bold">Series progress</h2>
            <p className="mt-1 text-sm text-white/60">
              Select every season you have finished to improve recommendation weighting.
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {series.map((t) => (
                <SeasonControl
                  key={keyOf(t)}
                  title={t}
                  onChange={(x) => changeSeasons(t, x)}
                />
              ))}
            </div>
          </section>
        )}

        <div className="mt-12 flex flex-wrap gap-3">
          {count >= 10 ? (
            <Link
              className="rounded-full bg-gold px-7 py-3 font-bold text-black shadow-lg hover:brightness-110 transition"
              href="/recommendations"
            >
              Get my recommendations ({count} titles analyzed)
            </Link>
          ) : (
            <button disabled className="rounded-full bg-white/10 px-6 py-3 text-white/40">
              Get my recommendations ({count}/10)
            </button>
          )}
          <Link
            className="rounded-full border border-white/20 px-6 py-3 text-white/80 hover:bg-white/10 transition"
            href="/watched"
          >
            Review all viewed titles ({count})
          </Link>
        </div>
      </section>
    </main>
  );
}

function SeasonControl({
  title,
  onChange,
}: {
  title: Title;
  onChange: (s: number[]) => void;
}) {
  const [total, setTotal] = useState(title.numberOfSeasons);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (total) return;
    setBusy(true);
    fetch(`/api/title?type=tv&id=${title.id}`)
      .then((r) => r.json())
      .then((d) => setTotal(d.numberOfSeasons))
      .finally(() => setBusy(false));
  }, [title.id, total]);

  const watched = title.watchedSeasons || [];
  return (
    <div className="rounded-lg bg-white/5 p-4">
      <div className="flex justify-between gap-2">
        <b>{title.title}</b>
        <span className="text-sm text-white/55">
          {busy
            ? "Loading..."
            : total
            ? `${watched.length}/${total} seasons`
            : "Season total unavailable"}
        </span>
      </div>
      {total && (
        <div className="mt-3 flex flex-wrap gap-2">
          {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              onClick={() =>
                onChange(
                  watched.includes(n)
                    ? watched.filter((x) => x !== n)
                    : [...watched, n].sort((a, b) => a - b)
                )
              }
              className={`rounded-full px-3 py-1 text-sm ${
                watched.includes(n) ? "bg-gold text-black font-bold" : "bg-white/10 text-white"
              }`}
            >
              S{n}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}