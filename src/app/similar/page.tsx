"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AppSwitcher } from "@/components/AppSwitcher";
import { ReelNavLinks } from "@/components/ReelNavLinks";
import { MediaType, Title, keyOf } from "@/types/title";
import { load, save, useStorageSync, State } from "@/lib/storage";
import { TitleCard } from "@/components/TitleCard";
import { StorageControls } from "@/components/StorageControls";
import { poster } from "@/lib/tmdb";

type EraChoice = "1990" | "2000" | "2010" | "all";

function SimilarContent() {
  const searchParams = useSearchParams();
  const type = (searchParams.get("type") as MediaType) || "movie";
  const idParam = searchParams.get("id");
  const id = idParam ? Number(idParam) : null;

  const [state, setState] = useState<State>({
    watched: [],
    displayed: [],
    shown: [],
    watchlist: [],
    dismissed: [],
  });

  const [sourceTitle, setSourceTitle] = useState<Title | null>(null);
  const [similarTitles, setSimilarTitles] = useState<Title[]>([]);
  const [eraFilter, setEraFilter] = useState<EraChoice>("1990");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const persist = (fn: (s: State) => State) =>
    setState((s) => {
      const n = fn(s);
      save(n);
      return n;
    });

  useEffect(() => {
    setState(load());
  }, []);

  useStorageSync(setState);

  useEffect(() => {
    if (!id || !["movie", "tv"].includes(type)) {
      setLoading(false);
      setError("Missing or invalid title identifier.");
      return;
    }

    setLoading(true);
    setError("");

    Promise.all([
      fetch(`/api/title?type=${type}&id=${id}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/similar?type=${type}&id=${id}&minYear=${eraFilter}`).then((r) => {
        if (!r.ok) throw new Error("Failed to fetch similar titles");
        return r.json();
      }),
    ])
      .then(([sourceData, simData]) => {
        if (sourceData) setSourceTitle(sourceData);
        setSimilarTitles(simData.results || []);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Unable to load similar titles");
      })
      .finally(() => setLoading(false));
  }, [type, id, eraFilter]);

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
      return {
        ...s,
        watchlist: has ? s.watchlist.filter((x) => keyOf(x) !== k) : [...s.watchlist, t],
      };
    });
  };

  const dismissTitle = (t: Title) => {
    const k = keyOf(t);
    persist((s) => ({
      ...s,
      dismissed: s.dismissed ? [...new Set([...s.dismissed, k])] : [k],
      watchlist: s.watchlist.filter((x) => keyOf(x) !== k),
    }));
    setSimilarTitles((prev) => prev.filter((x) => keyOf(x) !== k));
  };

  const watchedKeys = new Set(state.watched.map(keyOf));
  const watchlistKeys = new Set(state.watchlist.map(keyOf));

  return (
    <main className="min-h-screen px-4 py-8 md:px-10 pb-16">
      {/* Top Navbar */}
      <header className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 mb-8">
        <AppSwitcher current="reel-radar" />
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <ReelNavLinks counts={{ watchlist: state.watchlist.length, watched: state.watched.length, dismissed: state.dismissed.length }} />
          <StorageControls onStateChange={setState} />
        </div>
      </header>

      <section className="mx-auto max-w-7xl">
        {/* Source Title Hero Anchor */}
        {sourceTitle && (
          <div className="mb-10 rounded-2xl border border-gold/30 bg-gradient-to-r from-gold/15 via-panel to-neutral-900 p-6 md:p-8 shadow-xl">
            <div className="flex flex-col md:flex-row gap-6 items-start">
              {sourceTitle.posterPath && (
                <div className="h-36 w-24 sm:h-44 sm:w-28 shrink-0 overflow-hidden rounded-xl border border-white/20 shadow-lg">
                  <img
                    src={poster(sourceTitle.posterPath)!}
                    alt={sourceTitle.title}
                    className="h-full w-full object-cover"
                  />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-gold bg-gold/20 px-2 py-0.5 rounded border border-gold/30">
                    Source Anchor
                  </span>
                  <span className="text-xs text-white/50">
                    {sourceTitle.mediaType === "tv" ? "Television Series" : "Feature Film"}
                  </span>
                </div>
                <h1 className="mt-2 text-2xl sm:text-3xl font-extrabold text-white">
                  Titles Similar to &ldquo;{sourceTitle.title}&rdquo;
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gold">
                  <span>{sourceTitle.year || "Year N/A"}</span>
                  <span>•</span>
                  <span>★ {sourceTitle.rating.toFixed(1)}</span>
                  {sourceTitle.genreNames && sourceTitle.genreNames.length > 0 && (
                    <>
                      <span>•</span>
                      <span className="text-white/60">{sourceTitle.genreNames.join(", ")}</span>
                    </>
                  )}
                </div>
                <p className="mt-3 text-xs sm:text-sm text-white/75 leading-relaxed max-w-3xl line-clamp-3">
                  {sourceTitle.overview}
                </p>
                <div className="mt-4 flex flex-wrap gap-2.5">
                  <button
                    onClick={() => toggleWatched(sourceTitle)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      watchedKeys.has(keyOf(sourceTitle))
                        ? "bg-gold text-black font-bold"
                        : "bg-white/10 text-white hover:bg-white/20"
                    }`}
                  >
                    {watchedKeys.has(keyOf(sourceTitle)) ? "✓ Watched" : "+ Mark Seen"}
                  </button>
                  <button
                    onClick={() => toggleWatchlist(sourceTitle)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                      watchlistKeys.has(keyOf(sourceTitle))
                        ? "border-gold/50 bg-gold/20 text-gold"
                        : "border-white/20 bg-white/5 text-white/80 hover:bg-white/10"
                    }`}
                  >
                    {watchlistKeys.has(keyOf(sourceTitle)) ? "✓ In Watchlist" : "+ Watchlist"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Section Heading & Filter Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <span>🍿</span> Curated Similar Discoveries
            </h2>
            <p className="text-xs text-white/50 mt-0.5">
              Ranked via narrative tropes, director style, genre Jaccard overlap, and collaborative co-watching patterns.
            </p>
          </div>

          {/* Era Filter Controls */}
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <span className="text-xs text-white/50">Release Era:</span>
            <div className="flex rounded-full bg-white/5 p-1 border border-white/10 text-xs">
              {(
                [
                  { id: "1990", label: "Post-1990" },
                  { id: "2000", label: "2000s+" },
                  { id: "2010", label: "2010s+" },
                  { id: "all", label: "All Eras" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setEraFilter(opt.id)}
                  className={`rounded-full px-3 py-1 font-medium transition ${
                    eraFilter === opt.id
                      ? "bg-gold text-black font-bold shadow"
                      : "text-white/70 hover:text-white"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center text-sm text-red-200">
            {error}
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="poster aspect-[2/3] animate-pulse rounded-xl" />
            ))}
          </div>
        ) : similarTitles.length === 0 && !error ? (
          <div className="rounded-2xl border border-white/10 bg-panel p-12 text-center max-w-xl mx-auto">
            <h3 className="text-lg font-bold text-white">No Similar Titles Found</h3>
            <p className="mt-2 text-xs text-white/60">
              No matching titles found for this era filter. Try switching to &ldquo;All Eras&rdquo;.
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <button
                onClick={() => setEraFilter("all")}
                className="rounded-full bg-gold px-5 py-2 text-xs font-bold text-black"
              >
                Show All Eras
              </button>
              <Link
                href="/discover"
                className="rounded-full border border-white/20 px-5 py-2 text-xs font-semibold text-white hover:bg-white/10"
              >
                Back to Discovery
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-5">
            {similarTitles.map((t) => {
              const isWatched = watchedKeys.has(keyOf(t));
              const inWatchlist = watchlistKeys.has(keyOf(t));
              return (
                <div key={keyOf(t)} className="flex flex-col">
                  {/* Top Match Score Pill */}
                  {t.similarityScore && (
                    <div className="mb-1.5 flex items-center justify-between text-[11px] px-1">
                      <span className="font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                        {t.similarityScore}% Match
                      </span>
                      <span className="text-white/50">{t.year}</span>
                    </div>
                  )}

                  <TitleCard
                    title={t}
                    why={t.why}
                    selected={isWatched}
                    onToggle={() => toggleWatched(t)}
                  />

                  <div className="mt-2 flex flex-col gap-1.5">
                    <div className="flex gap-2">
                      <button
                        onClick={() => toggleWatched(t)}
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
                        onClick={() => toggleWatchlist(t)}
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
        )}
      </section>
    </main>
  );
}

export default function SimilarPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen px-4 py-8 md:px-10">
          <div className="mx-auto max-w-7xl animate-pulse">
            <div className="h-8 w-48 rounded bg-white/10 mb-8" />
            <div className="h-44 rounded-2xl bg-white/5 border border-white/10 mb-10" />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-5">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="aspect-[2/3] rounded-xl bg-white/5" />
              ))}
            </div>
          </div>
        </main>
      }
    >
      <SimilarContent />
    </Suspense>
  );
}