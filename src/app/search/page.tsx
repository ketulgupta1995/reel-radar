"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { Title, keyOf } from "@/types/title";
import { load, save, syncWithServer, State } from "@/lib/storage";
import { TitleCard } from "@/components/TitleCard";
import { StorageControls } from "@/components/StorageControls";

export default function SearchPage() {
  const [state, setState] = useState<State>({ watched: [], displayed: [], shown: [], watchlist: [], dismissed: [] });
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Title[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setState(load());
    syncWithServer().then(setState);
  }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/search?query=${encodeURIComponent(query)}`);
      const data = await res.json();
      setResults(data.results || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const persist = (fn: (s: State) => State) =>
    setState((s) => {
      const n = fn(s);
      save(n);
      return n;
    });

  const toggleWatched = (t: Title) => {
    persist(s => {
      const k = keyOf(t);
      const has = s.watched.some(x => keyOf(x) === k);
      return { ...s, watched: has ? s.watched.filter(x => keyOf(x) !== k) : [...s.watched, t] };
    });
  };

  const toggleWatchlist = (t: Title) => {
    persist(s => {
      const k = keyOf(t);
      const has = s.watchlist.some(x => keyOf(x) === k);
      return { ...s, watchlist: has ? s.watchlist.filter(x => keyOf(x) !== k) : [...s.watchlist, t] };
    });
  };

  const watchedKeys = new Set(state.watched.map(keyOf));
  const watchlistKeys = new Set(state.watchlist.map(keyOf));

  return (
    <main className="min-h-screen px-4 py-8 md:px-10">
      <header className="mx-auto flex max-w-7xl items-center justify-between gap-4 mb-8">
        <Link href="/" className="font-bold tracking-[.2em] text-gold">REEL RADAR</Link>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link href="/discover" className="text-white/70 hover:text-white">Discover</Link>
          <Link href="/watchlist" className="text-white/70 hover:text-white">Watchlist</Link>
          <Link href="/watched" className="text-white/70 hover:text-white">Viewed ({state.watched.length})</Link>
          <StorageControls onStateChange={setState} />
        </div>
      </header>

      <section className="mx-auto max-w-7xl py-6">
        <h1 className="text-3xl font-bold mb-6">Global Search</h1>
        <form onSubmit={handleSearch} className="flex max-w-xl gap-2">
          <input
            type="text"
            placeholder="Search for a movie or TV series..."
            className="flex-1 rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm text-white placeholder-white/40 focus:border-gold focus:outline-none"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit" disabled={loading} className="rounded-full bg-gold px-6 py-3 font-bold text-black disabled:opacity-50">
            {loading ? "Searching..." : "Search"}
          </button>
        </form>

        {results.length > 0 && (
          <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-5">
            {results.map((t) => (
              <div key={keyOf(t)} className="flex flex-col">
                <TitleCard title={t} />
                <div className="mt-2 flex flex-col gap-1.5">
                  <button
                    onClick={() => toggleWatched(t)}
                    className={`w-full rounded-lg py-1.5 text-xs font-semibold transition ${
                      watchedKeys.has(keyOf(t)) ? "bg-gold text-black hover:bg-gold/80" : "bg-white/10 text-white hover:bg-white/20"
                    }`}
                  >
                    {watchedKeys.has(keyOf(t)) ? "✓ Watched" : "+ Mark Seen"}
                  </button>
                  <button
                    onClick={() => toggleWatchlist(t)}
                    className={`w-full rounded-lg border py-1.5 text-xs font-semibold transition ${
                      watchlistKeys.has(keyOf(t)) ? "border-gold/30 bg-gold/20 text-gold" : "border-white/10 text-white/80 hover:bg-white/10"
                    }`}
                  >
                    {watchlistKeys.has(keyOf(t)) ? "✓ In Watchlist" : "+ Watchlist"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}