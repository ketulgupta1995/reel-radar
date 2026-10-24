import Link from "next/link";
import { discover, poster } from "@/lib/tmdb";
import { Title } from "@/types/title";

export default async function Home() {
  // Fetch a few featured preview titles for hero visual showcase
  let previewTitles: Title[] = [];
  try {
    const movies: Title[] = await discover("movie", 1);
    const indianMovies: Title[] = await discover("movie", 1, undefined, { originCountry: "IN", minVotes: 5 });
    previewTitles = [
      ...movies.filter((m: Title) => m.posterPath).slice(0, 3),
      ...indianMovies.filter((m: Title) => m.posterPath).slice(0, 3),
    ].slice(0, 4);
  } catch {
    previewTitles = [];
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[radial-gradient(ellipse_at_top,#261e38_0%,#090910_55%,#050508_100%)] text-white">
      {/* Top Navbar */}
      <header className="border-b border-white/5 bg-black/20 backdrop-blur-md sticky top-0 z-40">
        <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2 group">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gold/15 text-gold border border-gold/30 font-black text-sm">
              RR
            </span>
            <span className="font-bold tracking-[.22em] text-gold text-lg group-hover:text-amber-300 transition">
              REEL RADAR
            </span>
          </Link>

          <div className="flex items-center gap-2 sm:gap-6 text-sm">
            <Link
              href="/discover"
              className="font-medium text-white/80 transition hover:text-gold"
            >
              Discover
            </Link>
            <Link
              href="/search"
              className="flex items-center gap-1.5 font-medium text-white/80 transition hover:text-gold"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-4.35-4.35m0 0A7.5 7.5 0 1116.65 6.65a7.5 7.5 0 010 10.6z"
                />
              </svg>
              Search
            </Link>
            <Link
              href="/watchlist"
              className="hidden sm:inline-block font-medium text-white/80 transition hover:text-gold"
            >
              Watchlist
            </Link>
            <Link
              href="/watched"
              className="hidden sm:inline-block font-medium text-white/80 transition hover:text-gold"
            >
              Viewed History
            </Link>
            <Link
              href="/analysis"
              className="hidden md:inline-flex items-center gap-1.5 rounded-full bg-white/5 border border-white/10 px-3.5 py-1 text-xs text-white/85 hover:border-gold/40 hover:text-white transition"
            >
              Taste Analysis
            </Link>
            <Link
              href="/discover"
              className="rounded-full bg-gold px-4 py-1.5 text-xs font-bold text-black transition hover:bg-gold/90"
            >
              Open App
            </Link>
          </div>
        </nav>
      </header>

      {/* Hero Section */}
      <section className="relative mx-auto grid max-w-7xl items-center gap-12 px-6 py-20 lg:py-28 md:grid-cols-[1.15fr_0.85fr]">
        <div className="z-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-3.5 py-1 text-xs font-semibold uppercase tracking-wider text-gold mb-6 backdrop-blur-sm">
            <span className="h-2 w-2 rounded-full bg-gold animate-pulse" />
            Zero algorithms, 100% your taste
          </div>

          <h1 className="text-4xl font-extrabold tracking-tight sm:text-6xl lg:text-7xl leading-[1.08]">
            Your personal <br />
            <span className="bg-gradient-to-r from-gold via-amber-200 to-yellow-500 bg-clip-text text-transparent">
              screening room.
            </span>
          </h1>

          <p className="mt-6 max-w-xl text-base sm:text-lg leading-relaxed text-white/70">
            Track what you’ve seen across Hollywood and Indian cinema. Reel Radar learns the exact contours of your taste and serves tailored recommendations with zero clutter.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-4">
            <Link
              href="/discover"
              className="rounded-full bg-gold px-8 py-4 font-bold text-black shadow-lg shadow-gold/20 transition hover:brightness-110 hover:scale-105 active:scale-95"
            >
              Start Discovering
            </Link>
            <Link
              href="/search"
              className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-7 py-4 font-bold text-white transition hover:border-gold hover:text-gold hover:bg-white/10"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-4.35-4.35m0 0A7.5 7.5 0 1116.65 6.65a7.5 7.5 0 010 10.6z"
                />
              </svg>
              Search Any Title
            </Link>
          </div>

          <div className="mt-10 flex items-center gap-6 text-xs text-white/50 border-t border-white/10 pt-6">
            <div className="flex items-center gap-2">
              <span className="text-gold font-bold">✓</span> No account required
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gold font-bold">✓</span> Dual Indian & Global support
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gold font-bold">✓</span> Local & Cloud Sync
            </div>
          </div>
        </div>

        {/* Hero Visual Mockup Grid */}
        <div className="relative">
          <div className="absolute -inset-4 bg-gradient-to-tr from-purple-600/20 via-gold/10 to-transparent blur-3xl opacity-60 rounded-3xl" />
          
          <div className="relative grid grid-cols-2 gap-4 rotate-2 sm:rotate-3 transition hover:rotate-0 duration-500">
            {previewTitles.length >= 4 ? (
              previewTitles.map((item, idx) => (
                <div
                  key={item.id}
                  className={`group relative overflow-hidden rounded-2xl border border-white/10 bg-panel shadow-2xl transition hover:-translate-y-1 hover:border-gold/50 ${
                    idx % 2 === 1 ? "mt-6" : ""
                  }`}
                >
                  <div className="aspect-[2/3] w-full relative">
                    <img
                      src={poster(item.posterPath)!}
                      alt={item.title}
                      className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
                    <div className="absolute bottom-3 left-3 right-3">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-gold">
                        ★ {item.rating.toFixed(1)}
                      </span>
                      <h4 className="font-semibold text-xs text-white line-clamp-1">
                        {item.title}
                      </h4>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              [1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className={`poster aspect-[2/3] rounded-2xl border border-white/10 shadow-xl ${
                    i % 2 === 0 ? "mt-6" : ""
                  }`}
                />
              ))
            )}
          </div>
        </div>
      </section>

      {/* Feature Highlights Section */}
      <section className="border-t border-white/10 bg-black/40 py-20 px-6">
        <div className="mx-auto max-w-7xl">
          <div className="text-center max-w-2xl mx-auto">
            <h2 className="text-xs uppercase font-bold tracking-[.25em] text-gold">
              Core Capabilities
            </h2>
            <p className="mt-2 text-3xl font-bold sm:text-4xl text-white">
              Built for discerning viewers
            </p>
            <p className="mt-3 text-sm text-white/60">
              Everything you need to catalogue your cinematic journey, discover hidden gems, and track series seasons.
            </p>
          </div>

          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-panel/60 p-6 backdrop-blur transition hover:border-gold/40 hover:-translate-y-1">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gold/10 text-gold border border-gold/20 text-xl font-bold mb-4">
                🎯
              </div>
              <h3 className="font-bold text-lg text-white">Infinite Discovery</h3>
              <p className="mt-2 text-sm text-white/65 leading-relaxed">
                Browse dynamic feeds filtered by Indian Cinema or Hollywood & Global. Mark titles seen, add to watchlist, or dismiss with a single click.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-panel/60 p-6 backdrop-blur transition hover:border-gold/40 hover:-translate-y-1">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gold/10 text-gold border border-gold/20 text-xl font-bold mb-4">
                🧠
              </div>
              <h3 className="font-bold text-lg text-white">Tailored Taste Engine</h3>
              <p className="mt-2 text-sm text-white/65 leading-relaxed">
                Reach 10 titles to unlock categorized recommendations with explainability badges showing why each title was suggested for you.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-panel/60 p-6 backdrop-blur transition hover:border-gold/40 hover:-translate-y-1">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gold/10 text-gold border border-gold/20 text-xl font-bold mb-4">
                📺
              </div>
              <h3 className="font-bold text-lg text-white">Season-Level Tracking</h3>
              <p className="mt-2 text-sm text-white/65 leading-relaxed">
                Track TV series at the season level. Finishing multiple seasons gives series higher weighting in your personal recommendation algorithm.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-panel/60 p-6 backdrop-blur transition hover:border-gold/40 hover:-translate-y-1">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gold/10 text-gold border border-gold/20 text-xl font-bold mb-4">
                📊
              </div>
              <h3 className="font-bold text-lg text-white">Taste Analytics</h3>
              <p className="mt-2 text-sm text-white/65 leading-relaxed">
                Inspect your cinematic DNA with interactive charts, top directors and actors, genre distributions, and runtime milestones.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Quick Navigation Cards */}
      <section className="py-20 px-6 max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-6 rounded-3xl border border-white/15 bg-gradient-to-r from-panel via-[#191929] to-panel p-8 sm:p-12">
          <div>
            <span className="text-xs font-bold uppercase tracking-widest text-gold">Ready to explore?</span>
            <h3 className="text-2xl sm:text-3xl font-extrabold text-white mt-1">
              Begin calibrating your radar today
            </h3>
            <p className="text-sm text-white/65 mt-2 max-w-xl">
              Hop directly into the discovery feed, check your watchlist, or run an analysis on your existing history.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 shrink-0">
            <Link
              href="/discover"
              className="rounded-full bg-gold px-6 py-3 text-sm font-bold text-black transition hover:bg-gold/90"
            >
              Open Discovery Feed
            </Link>
            <Link
              href="/analysis"
              className="rounded-full border border-white/20 px-6 py-3 text-sm font-semibold text-white transition hover:border-gold hover:text-gold"
            >
              View Analytics
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 py-8 px-6 text-center text-xs text-white/40">
        <p>Reel Radar &copy; 2026. Powered by TMDB metadata.</p>
        <p className="mt-1">
          This product uses the TMDB API but is not endorsed or certified by TMDB.
        </p>
      </footer>
    </main>
  );
}