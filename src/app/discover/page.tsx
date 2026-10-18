"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Title, keyOf, MediaType } from "@/types/title";
import { load, reset, save, syncWithServer, State } from "@/lib/storage";
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
  const [titles, setTitles] = useState<Title[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [region, setRegion] = useState<RegionFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const isInitialMount = useRef(true);
  const pageMapRef = useRef<Record<string, number>>({});

  const count = state.watched.length;

  const update = (fn: (s: State) => State) =>
    setState((s) => {
      const n = fn(s);
      save(n);
      return n;
    });

  // Only exclude titles explicitly marked as watched or dismissed
  const getExcludeKeys = (s: State) => {
    return new Set([
      ...s.watched.map(keyOf),
      ...(s.dismissed || []),
    ]);
  };

  const fetchBatch = async (
    currentState: State,
    currentFilter = filter,
    currentRegion = region,
    resetPage = false
  ) => {
    setLoading(true);
    setError("");
    try {
      const filterKey = `${currentFilter}:${currentRegion}`;
      let page = resetPage ? 1 : pageMapRef.current[filterKey] || 1;
      const excludeKeys = getExcludeKeys(currentState);
      const fresh: Title[] = [];
      const freshKeys = new Set<string>();
      let pagesScanned = 0;
      const maxPagesToScan = 8;

      while (fresh.length < 20 && pagesScanned < maxPagesToScan) {
        const r = await fetch(
          `/api/discover?type=${currentFilter}&region=${currentRegion}&page=${page}`
        );
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Couldn't load titles");
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
            if (fresh.length >= 20) break;
          }
        }
        page++;
        pagesScanned++;
      }

      pageMapRef.current[filterKey] = page;
      setTitles(fresh);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load titles");
    } finally {
      setLoading(false);
    }
  };

  // 1. Initial mount: load local state immediately, then sync with server file
  useEffect(() => {
    const s = load();
    setState(s);
    fetchBatch(s, filter, region, false);

    // Sync in background to back up to data/storage.json without wiping local
    syncWithServer().then((synced) => {
      setState(synced);
    });
  }, []);

  // 2. Filter/Region changes
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    const s = load();
    setState(s);
    fetchBatch(s, filter, region, true);
  }, [filter, region]);

  const toggle = (t: Title) =>
    update((s) => {
      const has = s.watched.some((x) => keyOf(x) === keyOf(t));
      return {
        ...s,
        watched: has ? s.watched.filter((x) => keyOf(x) !== keyOf(t)) : [...s.watched, t],
      };
    });

  const changeSeasons = (t: Title, seasons: number[]) =>
    update((s) => ({
      ...s,
      watched: s.watched.map((x) =>
        keyOf(x) === keyOf(t) ? { ...x, watchedSeasons: seasons } : x
      ),
    }));

  const selected = new Set(state.watched.map(keyOf));
  const series = state.watched.filter((t) => t.mediaType === "tv");

  return (
    <main className="min-h-screen px-4 py-7 md:px-10">
      <header className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
        <Link href="/" className="font-bold tracking-[.2em] text-gold">
          REEL RADAR
        </Link>
        <div className="flex flex-wrap items-center gap-3">
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

          <StorageControls onStateChange={(merged) => setState(merged)} />

          <button
            onClick={() => {
              if (confirm("Reset all discovery history and file storage?")) {
                reset();
                location.reload();
              }
            }}
            className="text-xs text-white/50 underline"
          >
            Reset
          </button>
        </div>
      </header>

      <section className="mx-auto max-w-7xl py-10">
        <h1 className="text-3xl font-bold">Build your viewing history</h1>
        <p className="mt-2 text-white/65">
          Select what you have seen across Hollywood and Indian cinema. For series, track completed seasons.
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
              ? "Recommendations unlocked. Keep adding titles to refine."
              : `Select ${10 - count} more to unlock recommendations.`}
          </p>
          {count > 0 && (
            <Link href="/watched" className="text-xs text-gold underline">
              Manage viewed titles ({count}) →
            </Link>
          )}
        </div>

        <div className="mt-7 flex flex-wrap items-center justify-between gap-4">
          <div className="flex gap-2">
            {(["all", "movie", "tv"] as Filter[]).map((x) => (
              <button
                key={x}
                onClick={() => setFilter(x)}
                className={`rounded-full px-4 py-2 text-sm ${
                  filter === x ? "bg-gold text-black font-semibold" : "bg-white/10 text-white"
                }`}
              >
                {x === "all" ? "All types" : x === "tv" ? "Series" : "Movies"}
              </button>
            ))}
          </div>

          <div className="flex gap-2 rounded-full bg-white/5 p-1 border border-white/10">
            <button
              onClick={() => setRegion("all")}
              className={`rounded-full px-3 py-1.5 text-xs ${
                region === "all" ? "bg-gold text-black font-semibold" : "text-white/70"
              }`}
            >
              All Regions
            </button>
            <button
              onClick={() => setRegion("in")}
              className={`rounded-full px-3 py-1.5 text-xs ${
                region === "in" ? "bg-gold text-black font-semibold" : "text-white/70"
              }`}
            >
              Indian Cinema & Series
            </button>
            <button
              onClick={() => setRegion("global")}
              className={`rounded-full px-3 py-1.5 text-xs ${
                region === "global" ? "bg-gold text-black font-semibold" : "text-white/70"
              }`}
            >
              Hollywood & Global
            </button>
          </div>
        </div>

        {error ? (
          <div className="mt-8 rounded-xl border border-red-400/40 p-5">
            {error}{" "}
            <button
              onClick={() => fetchBatch(load(), filter, region)}
              className="underline"
            >
              Retry
            </button>
          </div>
        ) : loading ? (
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-5">
            {Array.from({ length: 10 }, (_, i) => (
              <div className="poster aspect-[2/3] animate-pulse rounded-xl" key={i} />
            ))}
          </div>
        ) : titles.length === 0 ? (
          <div className="mt-12 rounded-xl border border-white/10 p-8 text-center text-white/60">
            No more unseen titles found for this filter. Try selecting another type or region!
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-5">
            {titles.map((t) => (
              <TitleCard
                key={keyOf(t)}
                title={t}
                selected={selected.has(keyOf(t))}
                onToggle={() => toggle(t)}
              />
            ))}
          </div>
        )}

        {series.length > 0 && (
          <section className="mt-10 rounded-xl border border-white/10 bg-panel p-5">
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

        <div className="mt-10 flex flex-wrap gap-3">
          <button
            onClick={() => fetchBatch(load(), filter, region)}
            disabled={loading}
            className="rounded-full border border-white/20 px-6 py-3 disabled:opacity-50"
          >
            {loading ? "Loading..." : "Discover next batch"}
          </button>
          {count >= 10 ? (
            <Link
              className="rounded-full bg-gold px-6 py-3 font-bold text-black"
              href="/recommendations"
            >
              Get my recommendations
            </Link>
          ) : (
            <button disabled className="rounded-full bg-white/10 px-6 py-3 text-white/40">
              Get my recommendations ({count}/10)
            </button>
          )}
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