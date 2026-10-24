"use client";

import Link from "next/link";
import { useEffect, useState, useMemo } from "react";
import { MediaType, Title } from "@/types/title";
import { load, syncWithServer, State } from "@/lib/storage";
import { StorageControls } from "@/components/StorageControls";
import { TitleCard } from "@/components/TitleCard";
import { computeAnalysis, AnalysisFilters } from "@/lib/analysis";

export default function AnalysisPage() {
  const [state, setState] = useState<State>({
    watched: [],
    displayed: [],
    shown: [],
    watchlist: [],
    dismissed: [],
  });
  const [loading, setLoading] = useState(true);
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
            {/* Top KPI Metrics Row */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <div className="rounded-xl border border-white/10 bg-panel p-5 relative overflow-hidden">
                <span className="text-xs uppercase font-semibold text-white/50 tracking-wider">Titles Analyzed</span>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold text-white">{stats.totalAnalyzed}</span>
                  <span className="text-xs text-white/60">
                    ({stats.movieCount} films, {stats.tvCount} series)
                  </span>
                </div>
                <div className="mt-3 h-1.5 w-full rounded-full bg-white/10 overflow-hidden flex">
                  <div
                    className="h-full bg-gold"
                    style={{ width: `${stats.totalAnalyzed > 0 ? (stats.movieCount / stats.totalAnalyzed) * 100 : 0}%` }}
                    title={`Movies: ${stats.movieCount}`}
                  />
                  <div
                    className="h-full bg-purple-500"
                    style={{ width: `${stats.totalAnalyzed > 0 ? (stats.tvCount / stats.totalAnalyzed) * 100 : 0}%` }}
                    title={`Series: ${stats.tvCount}`}
                  />
                </div>
                <div className="mt-2 flex justify-between text-[10px] text-white/50">
                  <span>Movies ({stats.totalAnalyzed > 0 ? Math.round((stats.movieCount / stats.totalAnalyzed) * 100) : 0}%)</span>
                  <span>Series ({stats.totalAnalyzed > 0 ? Math.round((stats.tvCount / stats.totalAnalyzed) * 100) : 0}%)</span>
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-panel p-5">
                <span className="text-xs uppercase font-semibold text-white/50 tracking-wider">Quality Calibration</span>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold text-emerald-400">
                    ★ {stats.averageRating.toFixed(1)}
                  </span>
                  <span className="text-xs text-white/50">/ 10 TMDB Avg</span>
                </div>
                <p className="mt-3 text-xs text-white/60">
                  <span className="font-semibold text-gold">{stats.highRatedCount}</span> titles rated 8.0+ by community.
                </p>
              </div>

              <div className="rounded-xl border border-white/10 bg-panel p-5">
                <span className="text-xs uppercase font-semibold text-white/50 tracking-wider">Series Completion</span>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold text-purple-400">
                    {stats.tvSeriesProgress.overallCompletionRate}%
                  </span>
                  <span className="text-xs text-white/50">
                    ({stats.tvSeriesProgress.totalSeasonsWatched} seasons logged)
                  </span>
                </div>
                <p className="mt-3 text-xs text-white/60">
                  {stats.tvSeriesProgress.completedSeries} of {stats.tvSeriesProgress.totalSeries} series completed.
                </p>
              </div>

              <div className="rounded-xl border border-white/10 bg-panel p-5">
                <span className="text-xs uppercase font-semibold text-white/50 tracking-wider">Regional Balance</span>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold text-blue-400">
                    {stats.indianPercentage}%
                  </span>
                  <span className="text-xs text-white/50">Indian / {stats.globalPercentage}% Global</span>
                </div>
                <div className="mt-3 h-1.5 w-full rounded-full bg-white/10 overflow-hidden flex">
                  <div className="h-full bg-blue-400" style={{ width: `${stats.indianPercentage}%` }} />
                  <div className="h-full bg-white/30" style={{ width: `${stats.globalPercentage}%` }} />
                </div>
              </div>
            </div>

            {/* Cinephile Archetype / Persona Card */}
            <div className="rounded-2xl border border-gold/30 bg-gradient-to-r from-gold/15 via-panel to-neutral-900 p-6 md:p-8">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-gold bg-gold/20 px-2.5 py-0.5 rounded-full border border-gold/30">
                      {stats.persona.badge}
                    </span>
                    <span className="text-xs text-white/50">Algorithmically Derived Archetype</span>
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

            {/* Charts Grid: Genre Dominance & Era Spectrum */}
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
                    <h3 className="font-bold text-lg text-white">Release Era Spectrum</h3>
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

            {/* Quality & Catalog Dynamics */}
            <div className="grid gap-6 md:grid-cols-3">
              {/* Rating Spread */}
              <div className="rounded-xl border border-white/10 bg-panel p-5">
                <h4 className="font-bold text-sm text-white">TMDB Score Calibration</h4>
                <p className="mt-1 text-xs text-white/50">Quality threshold of logged content.</p>
                <div className="mt-4 space-y-2.5">
                  {stats.ratingDistribution.map((r) => (
                    <div key={r.range} className="flex items-center justify-between text-xs">
                      <span className="w-20 text-white/70">{r.range}</span>
                      <div className="flex-1 mx-3 h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div className="h-full bg-emerald-400" style={{ width: `${r.percentage}%` }} />
                      </div>
                      <span className="w-12 text-right font-mono text-white/80">{r.count}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Popularity & Hidden Gems */}
              <div className="rounded-xl border border-white/10 bg-panel p-5">
                <h4 className="font-bold text-sm text-white">Catalog Discovery Spectrum</h4>
                <p className="mt-1 text-xs text-white/50">Commercial scale vs. niche discovery.</p>
                <div className="mt-4 space-y-2 text-xs">
                  <div className="flex justify-between p-2 rounded-lg bg-white/5 border border-white/5">
                    <span className="text-white/80">💎 Hidden Gems (High rating, Niche)</span>
                    <span className="font-bold text-gold">{stats.popularityBreakdown.hiddenGems}</span>
                  </div>
                  <div className="flex justify-between p-2 rounded-lg bg-white/5 border border-white/5">
                    <span className="text-white/80">🌟 Mainstream Acclaimed Hits</span>
                    <span className="font-bold text-white">{stats.popularityBreakdown.blockbusters}</span>
                  </div>
                  <div className="flex justify-between p-2 rounded-lg bg-white/5 border border-white/5">
                    <span className="text-white/80">🍿 Popcorn & Commercial Media</span>
                    <span className="font-bold text-white/70">{stats.popularityBreakdown.popcornEntertainment}</span>
                  </div>
                  <div className="flex justify-between p-2 rounded-lg bg-white/5 border border-white/5">
                    <span className="text-white/80">🎯 Indie & Under-the-Radar</span>
                    <span className="font-bold text-white/60">{stats.popularityBreakdown.nicheIndies}</span>
                  </div>
                </div>
              </div>

              {/* Language & Cultural Diversity */}
              <div className="rounded-xl border border-white/10 bg-panel p-5">
                <h4 className="font-bold text-sm text-white">Linguistic Footprint</h4>
                <p className="mt-1 text-xs text-white/50">Original languages across your titles.</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {stats.languages.map((l) => (
                    <div
                      key={l.code}
                      className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white"
                    >
                      <span className="font-medium">{l.name}</span>
                      <span className="rounded-full bg-white/20 px-1.5 py-0.2 text-[10px] text-gold font-mono">
                        {l.count}
                      </span>
                    </div>
                  ))}
                  {stats.languages.length === 0 && (
                    <p className="text-xs text-white/40">No language data recorded.</p>
                  )}
                </div>
                <div className="mt-6 pt-3 border-t border-white/10 text-[11px] text-white/50 flex justify-between">
                  <span>Watchlist Conversion Backlog</span>
                  <span className="font-bold text-gold">{stats.backlogRatio}% pending</span>
                </div>
              </div>
            </div>

            {/* TV Series Season Progress Breakdown (If TV series exist) */}
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

            {/* Highest-Rated Benchmarks */}
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
                className="rounded-full bg-gold px-6 py-3 text-sm font-bold text-black transition hover:brightness-110"
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
                href="/watchlist"
                className="rounded-full border border-white/20 px-6 py-3 text-sm text-white hover:border-white/40 transition"
              >
                My Watchlist ({state.watchlist.length})
              </Link>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}