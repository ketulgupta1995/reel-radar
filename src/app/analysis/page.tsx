"use client";

import Link from "next/link";
import { useEffect, useState, useMemo } from "react";
import { MediaType, Title } from "@/types/title";
import { load, save, syncWithServer, State } from "@/lib/storage";
import { StorageControls } from "@/components/StorageControls";
import { TitleCard } from "@/components/TitleCard";
import { computeAnalysis, AnalysisFilters, GraphNode } from "@/lib/analysis";

export default function AnalysisPage() {
  const [state, setState] = useState<State>({
    watched: [],
    displayed: [],
    shown: [],
    watchlist: [],
    dismissed: [],
  });
  const [loading, setLoading] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [filters, setFilters] = useState<AnalysisFilters>({
    mediaType: "all",
    region: "all",
  });

  useEffect(() => {
    const local = load();
    setState(local);
    setLoading(false);
    syncWithServer().then((synced) => {
      setState(synced);
    });
  }, []);

  const stats = useMemo(() => {
    return computeAnalysis(state.watched, state.watchlist, filters);
  }, [state.watched, state.watchlist, filters]);

  if (loading) {
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
      {/* Navigation Header */}
      <header className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 mb-8">
        <Link href="/" className="font-bold tracking-[.2em] text-gold">
          REEL RADAR
        </Link>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link href="/discover" className="text-white/70 transition hover:text-white">
            Discover
          </Link>
          <Link href="/watched" className="text-white/70 transition hover:text-white">
            Viewed ({state.watched.length})
          </Link>
          <Link href="/watchlist" className="text-white/70 transition hover:text-white">
            Watchlist ({state.watchlist.length})
          </Link>
          <Link href="/recommendations" className="text-white/70 transition hover:text-white">
            Recommendations
          </Link>
          <Link
            href="/todos"
            className="text-white/70 transition hover:text-white"
          >
            Daily Todos
          </Link>
          <span className="rounded-full bg-gold/15 px-3 py-1 font-semibold text-gold border border-gold/30">
            Analysis
          </span>
          <StorageControls onStateChange={(s) => setState(s)} />
        </div>
      </header>

      <section className="mx-auto max-w-7xl">
        {/* Page Title & Controls */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-white/10">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase font-bold tracking-widest text-gold">Library Intelligence</span>
              <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] text-white/70">Dynamic Analysis</span>
            </div>
            <h1 className="mt-1 text-3xl font-extrabold md:text-4xl text-white">
              Viewing & Taste Analytics
            </h1>
            <p className="mt-1.5 text-sm text-white/60">
              Interactive insights and statistical breakdowns derived directly from your personal screening records.
            </p>
          </div>

          {/* Interactive Filter Pills */}
          {state.watched.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              {/* Media Type Filter */}
              <div className="flex rounded-full bg-white/5 p-1 border border-white/10 text-xs">
                {(["all", "movie", "tv"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setFilters((prev) => ({ ...prev, mediaType: t }))}
                    className={`rounded-full px-3 py-1.5 font-medium transition ${
                      filters.mediaType === t
                        ? "bg-gold text-black font-semibold shadow"
                        : "text-white/70 hover:text-white"
                    }`}
                  >
                    {t === "all" ? "All Formats" : t === "movie" ? "Movies" : "Series"}
                  </button>
                ))}
              </div>

              {/* Regional Scope Filter */}
              <div className="flex rounded-full bg-white/5 p-1 border border-white/10 text-xs">
                {(["all", "in", "global"] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setFilters((prev) => ({ ...prev, region: r }))}
                    className={`rounded-full px-3 py-1.5 font-medium transition ${
                      filters.region === r
                        ? "bg-gold text-black font-semibold shadow"
                        : "text-white/70 hover:text-white"
                    }`}
                  >
                    {r === "all" ? "All Regions" : r === "in" ? "Indian" : "Global"}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Empty State */}
        {state.watched.length === 0 ? (
          <div className="mt-12 rounded-2xl border border-white/10 bg-panel p-12 text-center max-w-2xl mx-auto">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gold/10 border border-gold/30 text-gold mb-4 text-2xl">
              📊
            </div>
            <h2 className="text-2xl font-bold">No Viewing Data Yet</h2>
            <p className="mt-2 text-sm text-white/60 leading-relaxed">
              To generate your personalized taste profile, quality index, and genre distributions, mark at least a few titles as watched in your discovery feed.
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
        ) : stats.totalAnalyzed === 0 ? (
          <div className="mt-12 rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-white/70">
            <p className="text-sm">No watched titles match your current filter combination.</p>
            <button
              onClick={() => setFilters({ mediaType: "all", region: "all" })}
              className="mt-3 text-xs text-gold underline hover:text-white"
            >
              Reset active filters
            </button>
          </div>
        ) : (
          <div className="mt-8 space-y-8">
            {/* 1. Screen Mileage & Scale Banner (Wrapped Style) */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <div className="rounded-2xl border border-gold/30 bg-gradient-to-br from-gold/15 to-panel p-5 relative overflow-hidden">
                <span className="text-xs uppercase font-bold text-gold tracking-wider">Screen Time Mileage</span>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold text-white">~{stats.screenMileage.totalHours}</span>
                  <span className="text-xs text-white/60">Hours Logged</span>
                </div>
                <p className="mt-2 text-xs text-white/60">
                  Equivalent to <b className="text-gold">{stats.screenMileage.totalDays} full days</b> of non-stop screening.
                </p>
                <div className="mt-3 flex gap-2 text-[11px] text-white/50 border-t border-white/10 pt-2">
                  <span>Films: {stats.screenMileage.movieHours}h</span>
                  <span>•</span>
                  <span>Series: {stats.screenMileage.seriesHours}h</span>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-panel p-5">
                <span className="text-xs uppercase font-semibold text-white/50 tracking-wider">Consensus vs. Contrarian</span>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold text-emerald-400">
                    {stats.tasteIndex.consensusScore}%
                  </span>
                  <span className="text-xs text-white/50">Consensus Index</span>
                </div>
                <p className="mt-2 text-xs text-gold font-semibold">
                  {stats.tasteIndex.consensusLabel}
                </p>
                <div className="mt-3 h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-400 to-gold rounded-full"
                    style={{ width: `${stats.tasteIndex.consensusScore}%` }}
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-panel p-5">
                <span className="text-xs uppercase font-semibold text-white/50 tracking-wider">Catalog Calibration</span>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold text-purple-400">
                    ★ {stats.averageRating.toFixed(1)}
                  </span>
                  <span className="text-xs text-white/50">/ 10 TMDB Avg</span>
                </div>
                <p className="mt-2 text-xs text-white/60">
                  <span className="font-semibold text-white">{stats.highRatedCount} titles</span> rated 8.0+ by global consensus.
                </p>
                <div className="mt-3 text-[11px] text-white/45 border-t border-white/10 pt-2">
                  <span>{stats.popularityBreakdown.hiddenGems} gems</span> • <span>{stats.popularityBreakdown.blockbusters} blockbusters</span>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-panel p-5">
                <span className="text-xs uppercase font-semibold text-white/50 tracking-wider">Series Completionist</span>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold text-blue-400">
                    {stats.tvSeriesProgress.overallCompletionRate}%
                  </span>
                  <span className="text-xs text-white/50">Finished</span>
                </div>
                <p className="mt-2 text-xs text-white/60">
                  {stats.tvSeriesProgress.completedSeries} of {stats.tvSeriesProgress.totalSeries} TV runs fully completed.
                </p>
                {stats.screenMileage.longestSeries && (
                  <div className="mt-3 text-[11px] text-white/50 border-t border-white/10 pt-2 truncate" title={stats.screenMileage.longestSeries.title}>
                    Longest: <span className="text-white font-medium">{stats.screenMileage.longestSeries.title}</span> ({stats.screenMileage.longestSeries.seasons}S)
                  </div>
                )}
              </div>
            </div>

            {/* 2. Cinephile Archetype / Persona Card */}
            <div className="rounded-2xl border border-gold/30 bg-gradient-to-r from-gold/15 via-panel to-neutral-900 p-6 md:p-8">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-gold bg-gold/20 px-2.5 py-0.5 rounded-full border border-gold/30">
                      {stats.persona.badge}
                    </span>
                    <span className="text-xs text-white/50">Personal Cinema Fingerprint</span>
                  </div>
                  <h2 className="mt-2 text-2xl font-bold text-white md:text-3xl">
                    {stats.persona.title}
                  </h2>
                  <p className="mt-2 text-sm text-white/80 max-w-2xl leading-relaxed">
                    {stats.persona.description}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2 md:justify-end shrink-0">
                  {stats.persona.traits.map((trait, i) => (
                    <span
                      key={i}
                      className="rounded-lg border border-white/15 bg-black/40 px-3 py-1.5 text-xs font-medium text-white/90 shadow-sm"
                    >
                      ✦ {trait}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* 3. Talent Footprint: Top Directors & Actors */}
            <div className="grid gap-6 md:grid-cols-2">
              {/* Director Obsessions */}
              <div className="rounded-2xl border border-white/10 bg-panel p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">🎬</span>
                    <h3 className="font-bold text-lg text-white">Director Obsessions</h3>
                  </div>
                  <span className="text-xs text-white/50">Most screened creators</span>
                </div>
                {stats.topDirectors.length === 0 ? (
                  <p className="text-xs text-white/50 py-4">Add more titles to discover your most-watched directors.</p>
                ) : (
                  <div className="space-y-3">
                    {stats.topDirectors.map((d) => (
                      <div key={d.name} className="rounded-xl border border-white/5 bg-white/5 p-3 flex items-center justify-between">
                        <div>
                          <h4 className="font-bold text-sm text-white">{d.name}</h4>
                          <p className="text-xs text-white/50 mt-0.5 truncate max-w-xs">
                            {d.sampleTitles.join(", ")}
                          </p>
                        </div>
                        <div className="text-right">
                          <span className="rounded-full bg-gold/20 px-2.5 py-1 text-xs font-bold text-gold border border-gold/30">
                            {d.count} titles
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Actor Obsessions */}
              <div className="rounded-2xl border border-white/10 bg-panel p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">🌟</span>
                    <h3 className="font-bold text-lg text-white">Most Screened Stars</h3>
                  </div>
                  <span className="text-xs text-white/50">Frequent leading actors</span>
                </div>
                {stats.topActors.length === 0 ? (
                  <p className="text-xs text-white/50 py-4">Add more titles to reveal your most-watched actors.</p>
                ) : (
                  <div className="space-y-3">
                    {stats.topActors.map((a) => (
                      <div key={a.name} className="rounded-xl border border-white/5 bg-white/5 p-3 flex items-center justify-between">
                        <div>
                          <h4 className="font-bold text-sm text-white">{a.name}</h4>
                          <p className="text-xs text-white/50 mt-0.5 truncate max-w-xs">
                            {a.sampleTitles.join(", ")}
                          </p>
                        </div>
                        <div className="text-right">
                          <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-bold text-white/90">
                            {a.count} titles
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 4. Franchise & Studio Universes */}
            {stats.universes.length > 0 && (
              <div className="rounded-2xl border border-white/10 bg-panel p-6">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">🌌</span>
                    <h3 className="font-bold text-lg text-white">Universe & Studio Conquered</h3>
                  </div>
                  <span className="text-xs text-gold font-medium">Franchise Mastery</span>
                </div>
                <p className="text-xs text-white/60 mb-6">
                  Track how much of notable director canons and iconic cinematic universes you have watched.
                </p>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {stats.universes.map((u) => (
                    <div key={u.name} className="rounded-xl border border-white/5 bg-white/5 p-4 flex flex-col justify-between">
                      <div>
                        <div className="flex justify-between items-start gap-2">
                          <h4 className="font-bold text-sm text-white">{u.name}</h4>
                          <span className="text-[10px] uppercase font-bold text-white/50 bg-white/10 px-1.5 py-0.5 rounded">
                            {u.tag}
                          </span>
                        </div>
                        <p className="text-xs text-white/50 mt-1 truncate">
                          {u.titles.join(", ")}
                        </p>
                      </div>

                      <div className="mt-4">
                        <div className="flex justify-between text-xs mb-1.5">
                          <span className="text-white/60">{u.watchedCount} of {u.totalKnown} completed</span>
                          <span className="font-bold text-gold">{u.percentage}%</span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-gold/60 to-gold rounded-full"
                            style={{ width: `${u.percentage}%` }}
                          />
                        </div>

                        {/* Unseen / Missing Titles in Canon */}
                        {u.unseenTitles && u.unseenTitles.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-white/10">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-white/40 block mb-1.5">
                              Unseen in this canon ({u.unseenTitles.length} pending):
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              {u.unseenTitles.map((title) => (
                                <Link
                                  key={title}
                                  href={`/search?q=${encodeURIComponent(title)}`}
                                  title={`Find and add "${title}"`}
                                  className="inline-flex items-center gap-1 rounded bg-white/10 hover:bg-gold hover:text-black px-2 py-0.5 text-[11px] text-white/80 transition"
                                >
                                  <span>+</span> {title}
                                </Link>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="mt-3 flex justify-end">
                          <Link
                            href={`/search?q=${encodeURIComponent(u.searchQuery || u.name)}`}
                            className="text-[11px] text-gold/80 hover:text-gold underline font-medium"
                          >
                            Explore all in {u.name.split(" ")[0]} →
                          </Link>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 5. Taste Blindspots & The Next Frontier */}
            {stats.blindspots.length > 0 && (
              <div className="rounded-2xl border border-blue-400/20 bg-gradient-to-br from-blue-950/20 via-panel to-neutral-900 p-6">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">🧭</span>
                    <h3 className="font-bold text-lg text-white">Taste Blindspots & The Next Frontier</h3>
                  </div>
                  <span className="text-xs text-blue-400 font-semibold bg-blue-500/10 px-2.5 py-0.5 rounded-full border border-blue-500/30">
                    Expand Horizons
                  </span>
                </div>
                <p className="text-xs text-white/60 mb-6">
                  Based on your 500+ records, here are significant cinema categories and movements you have barely explored.
                </p>

                <div className="grid gap-4 md:grid-cols-2">
                  {stats.blindspots.map((b) => (
                    <div key={b.category} className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col justify-between">
                      <div>
                        <h4 className="font-bold text-sm text-blue-300">{b.category}</h4>
                        <p className="mt-1 text-xs text-white/70 leading-relaxed">
                          {b.reason}
                        </p>
                      </div>
                      <div className="mt-3 pt-3 border-t border-white/10 flex items-center justify-between">
                        <span className="text-[11px] text-gold font-medium">💡 {b.recommendationHint}</span>
                        <Link href="/discover" className="text-[11px] text-white/50 underline hover:text-white">
                          Discover →
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 6. Contrarian Spotlights: Biggest Hidden Gems & Guilty Pleasures */}
            <div className="grid gap-6 md:grid-cols-2">
              {/* Hidden Gems */}
              <div className="rounded-2xl border border-white/10 bg-panel p-6">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">💎</span>
                    <h3 className="font-bold text-lg text-white">Your Hidden Gems</h3>
                  </div>
                  <span className="text-xs text-gold">High Rating, Low Mainstream Hype</span>
                </div>
                <p className="text-xs text-white/60 mb-4">
                  Under-the-radar titles in your history that deserve wider recognition.
                </p>
                {stats.tasteIndex.biggestHiddenGems.length === 0 ? (
                  <p className="text-xs text-white/50 py-4">No hidden gems detected yet.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {stats.tasteIndex.biggestHiddenGems.map((t) => (
                      <div key={t.id} className="rounded-xl border border-white/5 bg-white/5 p-3 flex flex-col justify-between">
                        <div>
                          <h4 className="font-semibold text-xs text-white line-clamp-1">{t.title}</h4>
                          <span className="text-[10px] text-white/50">{t.year} • {t.genreNames?.[0]}</span>
                        </div>
                        <div className="mt-2 flex justify-between items-center text-xs">
                          <span className="font-bold text-emerald-400">★ {t.rating.toFixed(1)}</span>
                          <span className="text-[10px] text-gold font-mono">Hidden Pick</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Guilty Pleasures */}
              <div className="rounded-2xl border border-white/10 bg-panel p-6">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">🍿</span>
                    <h3 className="font-bold text-lg text-white">Popcorn Guilty Pleasures</h3>
                  </div>
                  <span className="text-xs text-white/50">Modest Critics, Big Fun</span>
                </div>
                <p className="text-xs text-white/60 mb-4">
                  Commercial crowd-pleasers with lower critic consensus that you screened anyway.
                </p>
                {stats.tasteIndex.guiltyPleasures.length === 0 ? (
                  <p className="text-xs text-white/50 py-4">Your history is exceptionally critical!</p>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {stats.tasteIndex.guiltyPleasures.map((t) => (
                      <div key={t.id} className="rounded-xl border border-white/5 bg-white/5 p-3 flex flex-col justify-between">
                        <div>
                          <h4 className="font-semibold text-xs text-white line-clamp-1">{t.title}</h4>
                          <span className="text-[10px] text-white/50">{t.year} • {t.genreNames?.[0]}</span>
                        </div>
                        <div className="mt-2 flex justify-between items-center text-xs">
                          <span className="font-bold text-amber-400">★ {t.rating.toFixed(1)}</span>
                          <span className="text-[10px] text-white/40 font-mono">Popular</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 7. Genre Fingerprint & Era Time-Travel Matrix */}
            <div className="grid gap-6 md:grid-cols-2">
              {/* Genre Breakdown Chart */}
              <div className="rounded-2xl border border-white/10 bg-panel p-6 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-lg text-white">Genre Fingerprint</h3>
                    <span className="text-xs text-white/50">Top affinities</span>
                  </div>
                  <p className="mt-1 text-xs text-white/60">
                    Proportion of your watched library tagged with each primary genre.
                  </p>

                  <div className="mt-6 space-y-3.5">
                    {stats.topGenres.length === 0 ? (
                      <p className="text-xs text-white/50">No genre tags available for selected titles.</p>
                    ) : (
                      stats.topGenres.map((g) => (
                        <div key={g.name}>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="font-semibold text-white/90">{g.name}</span>
                            <span className="text-white/60">
                              {g.count} titles <span className="text-gold font-mono">({g.percentage}%)</span>
                            </span>
                          </div>
                          <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-gold/60 to-gold rounded-full transition-all duration-500"
                              style={{ width: `${Math.min(100, g.percentage)}%` }}
                            />
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-white/10 flex items-center justify-between text-[11px] text-white/50">
                  <span>Calculated from TMDB genre taxonomy</span>
                  <span>Multiple genres per title normalized</span>
                </div>
              </div>

              {/* Release Era / Decade Spectrum Chart */}
              <div className="rounded-2xl border border-white/10 bg-panel p-6 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-lg text-white">Decade Time-Travel Matrix</h3>
                    <span className="text-xs text-white/50">Decade Distribution</span>
                  </div>
                  <p className="mt-1 text-xs text-white/60">
                    Chronological distribution of the titles you consume across cinematic history.
                  </p>

                  <div className="mt-6 space-y-3.5">
                    {stats.eraDistribution.map((era) => (
                      <div key={era.label}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-medium text-white/85">{era.label}</span>
                          <span className="text-white/60">
                            {era.count} titles <span className="text-blue-400 font-mono">({era.percentage}%)</span>
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-blue-500/70 to-blue-400 rounded-full transition-all duration-500"
                            style={{ width: `${Math.min(100, era.percentage)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-white/10 flex items-center justify-between text-[11px] text-white/50">
                  <span>Based on release & first-air dates</span>
                  <span>Indicates appetite for modern vs. classic releases</span>
                </div>
              </div>
            </div>

            {/* 8. TV Series Season Progress Breakdown (If TV series exist) */}
            {stats.tvSeriesProgress.items.length > 0 && (
              <div className="rounded-2xl border border-white/10 bg-panel p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-bold text-lg text-white">Series & Season Progress Tracker</h3>
                    <p className="mt-0.5 text-xs text-white/60">
                      Tracking watched seasons against available runs for television titles.
                    </p>
                  </div>
                  <span className="text-xs text-purple-400 font-semibold bg-purple-500/10 px-3 py-1 rounded-full border border-purple-500/20">
                    {stats.tvSeriesProgress.completedSeries} of {stats.tvSeriesProgress.totalSeries} Completed
                  </span>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {stats.tvSeriesProgress.items.map((item) => (
                    <div key={item.id} className="rounded-xl border border-white/5 bg-white/5 p-3.5 flex flex-col justify-between">
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="font-semibold text-xs text-white line-clamp-1" title={item.title}>
                            {item.title}
                          </h4>
                          {item.isComplete ? (
                            <span className="shrink-0 text-[10px] text-emerald-400 font-bold bg-emerald-500/15 px-1.5 py-0.5 rounded">
                              Complete
                            </span>
                          ) : (
                            <span className="shrink-0 text-[10px] text-amber-400 font-bold bg-amber-500/15 px-1.5 py-0.5 rounded">
                              Ongoing
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-[11px] text-white/50">
                          {item.totalCount
                            ? `${item.watchedCount} of ${item.totalCount} seasons watched`
                            : `${item.watchedCount} seasons tracked`}
                        </p>
                      </div>

                      <div className="mt-3">
                        <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${item.isComplete ? "bg-emerald-400" : "bg-purple-500"}`}
                            style={{ width: `${item.percentage}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ⚠️ Orphaned Series Alert Shelf */}
            {stats.orphanedSeries && stats.orphanedSeries.length > 0 && (
              <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-panel to-neutral-900 p-6 shadow-xl">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">⚠️</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-xl font-bold text-white">Orphaned Series Alert</h3>
                        <span className="rounded-full bg-amber-500/20 px-2.5 py-0.5 text-[10px] font-bold text-amber-300 border border-amber-500/40">
                          {stats.orphanedSeries.length} Unfinished Runs
                        </span>
                      </div>
                      <p className="text-xs text-white/60 mt-0.5">
                        High-quality series where you watched initial seasons, but never returned when subsequent seasons aired.
                      </p>
                    </div>
                  </div>
                  <Link
                    href="/discover"
                    className="text-xs text-amber-300 underline hover:text-white"
                  >
                    Find Next Seasons →
                  </Link>
                </div>

                <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {stats.orphanedSeries.map((orphan) => {
                    const t = orphan.title;
                    const watchedSet = new Set(t.watchedSeasons || [1]);

                    const toggleSeason = (seasonNum: number) => {
                      const updatedWatched = state.watched.map((item) => {
                        if (item.mediaType === "tv" && item.id === t.id) {
                          const existingSeasons = new Set(item.watchedSeasons || [1]);
                          if (existingSeasons.has(seasonNum)) {
                            existingSeasons.delete(seasonNum);
                          } else {
                            existingSeasons.add(seasonNum);
                          }
                          const newSeasons = Array.from(existingSeasons).sort((a, b) => a - b);
                          return {
                            ...item,
                            watchedSeasons: newSeasons.length > 0 ? newSeasons : [1],
                          };
                        }
                        return item;
                      });

                      const nextState: State = { ...state, watched: updatedWatched };
                      setState(nextState);
                      save(nextState);
                    };

                    return (
                      <div
                        key={t.id}
                        className="rounded-xl border border-white/10 bg-black/40 p-4 flex flex-col justify-between hover:border-amber-400/40 transition group"
                      >
                        <div>
                          <div className="flex items-start justify-between gap-3">
                            <h4 className="font-bold text-sm text-white group-hover:text-amber-300 transition line-clamp-1" title={t.title}>
                              {t.title}
                            </h4>
                            <span className="shrink-0 text-xs text-gold font-bold bg-gold/15 px-2 py-0.5 rounded">
                              ★ {t.rating.toFixed(1)}
                            </span>
                          </div>

                          <p className="mt-1.5 text-xs text-amber-200/90 font-medium leading-relaxed">
                            {orphan.recommendationNote}
                          </p>
                          <p className="mt-1 text-[11px] text-white/50 line-clamp-2">
                            {t.overview}
                          </p>
                        </div>

                        <div className="mt-4 pt-3 border-t border-white/10">
                          <div className="flex items-center justify-between text-[11px] text-white/60 mb-2">
                            <span>Interactive Season Tracker:</span>
                            <span className="font-semibold text-white/80">
                              {orphan.watchedSeasonCount} of {orphan.totalSeasonCount} watched
                            </span>
                          </div>

                          <div className="flex flex-wrap gap-1.5">
                            {Array.from({ length: orphan.totalSeasonCount }).map((_, idx) => {
                              const sNum = idx + 1;
                              const isWatched = watchedSet.has(sNum);
                              return (
                                <button
                                  key={sNum}
                                  onClick={() => toggleSeason(sNum)}
                                  title={isWatched ? `Season ${sNum} watched (click to unmark)` : `Click to mark Season ${sNum} as watched`}
                                  className={`rounded px-2 py-1 text-[11px] font-bold transition flex items-center gap-1 ${
                                    isWatched
                                      ? "bg-amber-400 text-black shadow"
                                      : "bg-white/5 text-white/70 border border-white/15 hover:bg-white/15 hover:text-white"
                                  }`}
                                >
                                  {isWatched ? `✓ S${sNum}` : `+ S${sNum}`}
                                </button>
                              );
                            })}
                          </div>

                          <div className="mt-3 flex items-center justify-between text-[11px]">
                            <span className="text-amber-400/80">
                              Next up: Season {orphan.unwatchedSeasons[0]}
                            </span>
                            <Link
                              href={`/search?q=${encodeURIComponent(t.title)}`}
                              className="text-white/60 hover:text-gold underline"
                            >
                              Search title →
                            </Link>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 🕸️ "The Kevin Bacon" / Six Degrees Cinema Graph */}
            {stats.cinemaGraph && stats.cinemaGraph.nodes.length > 0 && (
              <div className="rounded-2xl border border-purple-500/30 bg-gradient-to-br from-purple-950/20 via-panel to-neutral-900 p-6 shadow-2xl">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xl">🕸️</span>
                      <h3 className="text-xl font-bold text-white">&quot;The Kevin Bacon&quot; / Cinema Constellation Graph</h3>
                      <span className="rounded-full bg-purple-500/20 px-2.5 py-0.5 text-[10px] font-bold text-purple-300 border border-purple-500/30">
                        Interactive Network
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-white/60">
                      Visualizing recurring talent (directors &amp; cast) connecting your library titles. Click any node or talent hub to isolate its cinematic constellation.
                    </p>
                  </div>

                  {/* Reset Selection / Quick Controls */}
                  {selectedNodeId && (
                    <button
                      onClick={() => setSelectedNodeId(null)}
                      className="self-start md:self-auto rounded-full bg-white/10 hover:bg-white/20 px-3 py-1.5 text-xs text-white transition flex items-center gap-1.5"
                    >
                      <span>✕</span> Reset Constellation
                    </button>
                  )}
                </div>

                {/* Library Gravity Centers */}
                {stats.cinemaGraph.centralHubs.length > 0 && (
                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-bold text-gold uppercase tracking-wider">
                      Library Gravity Centers:
                    </span>
                    {stats.cinemaGraph.centralHubs.map((hub) => {
                      const hubId = `hub_${hub.type === "Director" ? "dir" : "act"}:${hub.name}`;
                      const isSelected = selectedNodeId === hubId;
                      return (
                        <button
                          key={hub.name}
                          onClick={() => setSelectedNodeId(isSelected ? null : hubId)}
                          className={`rounded-full px-3 py-1 text-xs font-medium transition flex items-center gap-1.5 ${
                            isSelected
                              ? "bg-gold text-black font-bold shadow-lg"
                              : "bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 hover:border-gold/50"
                          }`}
                        >
                          <span className={isSelected ? "text-black" : "text-gold"}>
                            {hub.type === "Director" ? "🎬" : "🎭"}
                          </span>
                          <span>{hub.name}</span>
                          <span className={`text-[10px] px-1 rounded-full ${isSelected ? "bg-black/20 text-black" : "bg-white/10 text-white/60"}`}>
                            {hub.connections}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Interactive SVG Network Canvas */}
                <div className="relative w-full rounded-xl bg-black/60 border border-white/10 overflow-hidden p-2 md:p-4">
                  <svg
                    viewBox="0 0 800 500"
                    className="w-full h-auto max-h-[560px] select-none"
                    style={{ background: "radial-gradient(ellipse at center, rgba(30,20,50,0.5) 0%, rgba(10,10,15,0.95) 100%)" }}
                  >
                    <defs>
                      <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                        <feGaussianBlur stdDeviation="3" result="blur" />
                        <feComposite in="SourceGraphic" in2="blur" operator="over" />
                      </filter>
                    </defs>

                    {/* Links / Edges */}
                    <g className="links">
                      {stats.cinemaGraph.links.map((link, idx) => {
                        const sourceNode = stats.cinemaGraph.nodes.find((n) => n.id === link.source);
                        const targetNode = stats.cinemaGraph.nodes.find((n) => n.id === link.target);
                        if (!sourceNode || !targetNode || sourceNode.x == null || sourceNode.y == null || targetNode.x == null || targetNode.y == null) {
                          return null;
                        }

                        const isConnected =
                          !selectedNodeId ||
                          link.source === selectedNodeId ||
                          link.target === selectedNodeId;

                        return (
                          <line
                            key={`link-${idx}`}
                            x1={sourceNode.x}
                            y1={sourceNode.y}
                            x2={targetNode.x}
                            y2={targetNode.y}
                            stroke={isConnected ? (selectedNodeId ? "#D4AF37" : "rgba(168, 85, 247, 0.45)") : "rgba(255, 255, 255, 0.05)"}
                            strokeWidth={isConnected ? (selectedNodeId ? 2.5 : 1.2) : 0.5}
                            strokeDasharray={isConnected && selectedNodeId ? "none" : "2,2"}
                            className="transition-all duration-300"
                          />
                        );
                      })}
                    </g>

                    {/* Nodes */}
                    <g className="nodes">
                      {stats.cinemaGraph.nodes.map((node) => {
                        if (node.x == null || node.y == null) return null;
                        const isSelected = selectedNodeId === node.id;
                        const isConnected =
                          !selectedNodeId ||
                          node.id === selectedNodeId ||
                          stats.cinemaGraph.links.some(
                            (l) =>
                              (l.source === selectedNodeId && l.target === node.id) ||
                              (l.target === selectedNodeId && l.source === node.id)
                          );

                        const isPerson = node.type === "person";
                        const radius = isPerson
                          ? Math.min(22, 12 + (node.connections || 1) * 2)
                          : 8;

                        return (
                          <g
                            key={node.id}
                            className="cursor-pointer transition-all duration-300"
                            onClick={() => setSelectedNodeId(isSelected ? null : node.id)}
                            opacity={isConnected ? 1 : 0.2}
                          >
                            {/* Halo / Glow for selected or central hubs */}
                            {(isSelected || (isPerson && node.connections > 2)) && (
                              <circle
                                cx={node.x}
                                cy={node.y}
                                r={radius + 5}
                                fill={isPerson ? "rgba(212, 175, 55, 0.2)" : "rgba(168, 85, 247, 0.2)"}
                                filter="url(#glow)"
                              />
                            )}

                            {/* Main Circle Node */}
                            <circle
                              cx={node.x}
                              cy={node.y}
                              r={radius}
                              fill={
                                isSelected
                                  ? "#FFFFFF"
                                  : isPerson
                                  ? "#D4AF37"
                                  : "#A855F7"
                              }
                              stroke={isSelected ? "#D4AF37" : "#1A1A1A"}
                              strokeWidth={2}
                            />

                            {/* Node Label */}
                            <text
                              x={node.x}
                              y={node.y + radius + 11}
                              textAnchor="middle"
                              fill={isSelected ? "#FFD700" : isConnected ? "#EDEDED" : "rgba(255,255,255,0.3)"}
                              fontSize={isPerson ? "11px" : "9px"}
                              fontWeight={isPerson || isSelected ? "bold" : "normal"}
                              className="pointer-events-none drop-shadow"
                            >
                              {node.name.length > 18 ? node.name.slice(0, 16) + "…" : node.name}
                            </text>
                          </g>
                        );
                      })}
                    </g>
                  </svg>

                  {/* Node Inspector Overlay if a Node is clicked */}
                  {selectedNodeId && (() => {
                    const selNode = stats.cinemaGraph.nodes.find((n) => n.id === selectedNodeId);
                    if (!selNode) return null;

                    const connectedLinks = stats.cinemaGraph.links.filter(
                      (l) => l.source === selectedNodeId || l.target === selectedNodeId
                    );

                    const neighborIds = connectedLinks.map((l) =>
                      l.source === selectedNodeId ? l.target : l.source
                    );

                    const neighbors = stats.cinemaGraph.nodes.filter((n) =>
                      neighborIds.includes(n.id)
                    );

                    return (
                      <div className="absolute bottom-4 left-4 right-4 md:right-auto md:w-96 rounded-xl border border-gold/40 bg-black/90 p-4 backdrop-blur-md shadow-2xl z-20">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className="text-[10px] font-bold uppercase tracking-wider text-gold">
                              {selNode.type === "person" ? (selNode.subType === "director" ? "Director Hub" : "Actor Hub") : "Film / Series Node"}
                            </span>
                            <h4 className="text-base font-bold text-white mt-0.5">{selNode.name}</h4>
                            {selNode.rating && (
                              <span className="text-xs text-gold">★ {selNode.rating.toFixed(1)} TMDB Rating</span>
                            )}
                          </div>
                          <button
                            onClick={() => setSelectedNodeId(null)}
                            className="text-xs text-white/50 hover:text-white"
                          >
                            ✕
                          </button>
                        </div>

                        <div className="mt-3 pt-3 border-t border-white/10">
                          <span className="text-[11px] font-semibold text-white/70 block mb-1.5">
                            Connected Constellation ({neighbors.length} titles / talent):
                          </span>
                          <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
                            {neighbors.map((nb) => (
                              <button
                                key={nb.id}
                                onClick={() => setSelectedNodeId(nb.id)}
                                className="rounded bg-white/10 hover:bg-gold hover:text-black px-2 py-0.5 text-[11px] text-white/80 transition"
                              >
                                {nb.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between text-[11px] text-white/50">
                  <div className="flex items-center gap-4">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-gold inline-block" />
                      Recurring Talent (Directors &amp; Actors)
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-purple-500 inline-block" />
                      Watched Titles
                    </span>
                  </div>
                  <span>Click any node to isolate its cinematic constellation</span>
                </div>
              </div>
            )}

            {/* 9. Highest-Rated Benchmarks */}
            {stats.topRatedTitles.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-xl font-bold text-white">Personal Critical Hall of Fame</h3>
                    <p className="text-xs text-white/60">Highest rated titles logged in your viewing vault.</p>
                  </div>
                  <Link href="/watched" className="text-xs text-gold underline hover:text-white">
                    View all {state.watched.length} titles
                  </Link>
                </div>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                  {stats.topRatedTitles.map((t) => (
                    <div key={t.id} className="h-full">
                      <TitleCard title={t} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Bottom Navigation CTA */}
            <div className="pt-6 border-t border-white/10 flex flex-wrap gap-3">
              <Link
                href="/recommendations"
                className="rounded-full bg-gold px-6 py-3 text-sm font-bold text-black transition hover:brightness-110 shadow"
              >
                Explore Recommendations
              </Link>
              <Link
                href="/discover"
                className="rounded-full border border-white/20 px-6 py-3 text-sm text-white hover:border-white/40 transition"
              >
                Discover More Titles
              </Link>
              <Link
                href="/watched"
                className="rounded-full border border-white/20 px-6 py-3 text-sm text-white hover:border-white/40 transition"
              >
                Manage Watched Titles ({state.watched.length})
              </Link>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}