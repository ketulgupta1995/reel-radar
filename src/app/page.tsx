import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-[radial-gradient(ellipse_at_top,#2c2440_0%,#07070c_54%)] px-6 py-10">
      <nav className="mx-auto flex max-w-6xl items-center justify-between">
        <span className="font-bold tracking-[.2em] text-gold">REEL RADAR</span>
        <div className="flex items-center gap-6">
  <Link
    className="flex items-center gap-1.5 text-sm text-white/70 transition hover:text-white"
    href="/search"
  >
    <svg
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
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
    className="text-sm text-white/70 transition hover:text-white"
    href="/analysis"
  >
    Analysis
  </Link>
  <Link
    className="text-sm text-white/70 transition hover:text-white"
    href="/discover"
  >
    Continue discovery
  </Link>
</div>
      </nav>

      <section className="mx-auto grid max-w-6xl items-center gap-12 py-24 md:grid-cols-[1.2fr_.8fr]">
        <div>
          <p className="mb-4 text-sm uppercase tracking-[.25em] text-gold">
            Your personal screening room
          </p>
          <h1 className="max-w-2xl text-5xl font-bold tracking-tight md:text-7xl">
            Discover what to watch next.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-white/70">
            Tell us which films and series you’ve watched. We’ll learn the shape of your taste and keep the next great title in view.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-4">
            <Link
              href="/discover"
              className="inline-block rounded-full bg-gold px-7 py-4 font-bold text-black transition hover:brightness-110"
            >
              Start Discovering
            </Link>
            <Link
              href="/search"
              className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-7 py-4 font-bold text-white transition hover:border-gold hover:text-gold"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-4.35-4.35m0 0A7.5 7.5 0 1116.65 6.65a7.5 7.5 0 010 10.6z"
                />
              </svg>
              Search Titles
            </Link>
          </div>

          <p className="mt-8 text-xs text-white/45">
            Uses TMDB metadata. This product is not endorsed or certified by TMDB.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3 rotate-3 opacity-80">
          <div className="poster aspect-[2/3] rounded-xl" />
          <div className="poster mt-10 aspect-[2/3] rounded-xl" />
          <div className="poster aspect-[2/3] rounded-xl" />
        </div>
      </section>
    </main>
  );
}