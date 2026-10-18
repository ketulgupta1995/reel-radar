"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Title, keyOf } from "@/types/title";
import { load, save, State } from "@/lib/storage";
import { TitleCard } from "@/components/TitleCard";
import { isIndianTitle } from "@/lib/recommend";

type Rec = Title & { why: string };

export default function Recommendations() {
  const [state, setState] = useState<State>({
    watched: [],
    displayed: [],
    shown: [],
    watchlist: [],
    dismissed: [],
  });
  const [recs, setRecs] = useState<Rec[]>([]);
  const [summary, setSummary] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"all" | "in" | "global">("all");

  const persist = (fn: (s: State) => State) =>
    setState((s) => {
      const n = fn(s);
      save(n);
      return n;
    });

  const get = async () => {
    const s = load();
    setState(s);
    if (s.watched.length < 10) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const r = await fetch("/api/recommendations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          watched: s.watched,
          seen: s.shown,
          dismissed: s.dismissed || [],
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);

      setRecs(d.recommendations);
      setSummary(d.summary);
      save({
        ...s,
        shown: [...new Set([...s.shown, ...d.recommendations.map(keyOf)])],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to recommend");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    get();
  }, []);

  const seen = (title: Title) => {
    persist((s) => ({
      ...s,
      watched: s.watched.some((x) => keyOf(x) === keyOf(title))
        ? s.watched
        : [...s.watched, title],
      watchlist: s.watchlist.filter((x) => keyOf(x) !== keyOf(title)),
    }));
    setRecs((r) => r.filter((x) => keyOf(x) !== keyOf(title)));
  };

  const toggleWatchlist = (title: Title) =>
    persist((s) => {
      const has = s.watchlist.some((x) => keyOf(x) === keyOf(title));
      return {
        ...s,
        watchlist: has
          ? s.watchlist.filter((x) => keyOf(x) !== keyOf(title))
          : [...s.watchlist, title],
      };
    });

  // Permanently dismiss title and never recommend again
  const dismiss = (title: Title) => {
    const k = keyOf(title);
    persist((s) => ({
      ...s,
      dismissed: s.dismissed ? [...new Set([...s.dismissed, k])] : [k],
      watchlist: s.watchlist.filter((x) => keyOf(x) !== k),
    }));
    setRecs((r) => r.filter((x) => keyOf(x) !== k));
  };

  if (!loading && state.watched.length < 10) {
    return (
      <main className="grid min-h-screen place-items-center p-6 text-center">
        <div>
          <h1 className="text-3xl font-bold">A little more history first</h1>
          <p className="mt-3 text-white/60">
            Pick at least 10 watched titles to unlock recommendations.
          </p>
          <Link
            href="/discover"
            className="mt-6 inline-block rounded-full bg-gold px-6 py-3 font-bold text-black"
          >
            Continue discovery
          </Link>
        </div>
      </main>
    );
  }

  const filteredRecs = recs.filter((r) => {
    if (tab === "in") return isIndianTitle(r);
    if (tab === "global") return !isIndianTitle(r);
    return true;
  });

  return (
    <main className="min-h-screen px-4 py-8 md:px-10">
      <header className="mx-auto flex max-w-7xl justify-between">
        <Link href="/" className="font-bold tracking-[.2em] text-gold">
          REEL RADAR
        </Link>
        <Link href="/discover" className="text-sm text-white/70">
          Edit watched titles
        </Link>
      </header>

      <section className="mx-auto max-w-7xl py-10">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold">Your next watchlist</h1>
            <p className="mt-3 text-white/65">
              Personalized from your history
              {summary.length ? `: ${summary.join(", ")}` : ""}. Synopses and rationale included.
            </p>
          </div>

          {/* Filter recommended titles */}
          <div className="flex gap-2 rounded-full bg-white/5 p-1 border border-white/10">
            <button
              onClick={() => setTab("all")}
              className={`rounded-full px-3 py-1.5 text-xs ${
                tab === "all" ? "bg-gold text-black font-semibold" : "text-white/70"
              }`}
            >
              All ({recs.length})
            </button>
            <button
              onClick={() => setTab("in")}
              className={`rounded-full px-3 py-1.5 text-xs ${
                tab === "in" ? "bg-gold text-black font-semibold" : "text-white/70"
              }`}
            >
              🇮🇳 Indian ({recs.filter(isIndianTitle).length})
            </button>
            <button
              onClick={() => setTab("global")}
              className={`rounded-full px-3 py-1.5 text-xs ${
                tab === "global" ? "bg-gold text-black font-semibold" : "text-white/70"
              }`}
            >
              🌐 Hollywood & Global ({recs.filter((x) => !isIndianTitle(x)).length})
            </button>
          </div>
        </div>

        {state.watchlist.length > 0 && (
          <div className="mt-6 rounded-xl border border-gold/40 bg-gold/10 p-4 text-sm">
            <b>My watchlist ({state.watchlist.length})</b>
            <div className="mt-2 flex flex-wrap gap-2">
              {state.watchlist.map((t) => (
                <span
                  key={keyOf(t)}
                  className="rounded-full bg-black/40 px-3 py-1 text-white flex items-center gap-1"
                >
                  {t.title}
                  <button
                    onClick={() => toggleWatchlist(t)}
                    aria-label={`Remove ${t.title}`}
                    className="ml-1 text-gold hover:text-white"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {error ? (
          <div className="mt-8 rounded-xl border border-red-400/40 p-5">
            {error}{" "}
            <button className="underline" onClick={get}>
              Retry
            </button>
          </div>
        ) : loading ? (
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-5">
            {Array.from({ length: 10 }, (_, i) => (
              <div className="poster aspect-[2/3] animate-pulse rounded-xl" key={i} />
            ))}
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-5">
            {filteredRecs.map((r) => {
              const saved = state.watchlist.some((x) => keyOf(x) === keyOf(r));
              return (
                <div key={keyOf(r)} className="flex flex-col">
                  <TitleCard title={r} why={r.why} />
                  <div className="mt-2 flex flex-col gap-1.5">
                    <div className="flex gap-2">
                      <button
                        onClick={() => seen(r)}
                        className="flex-1 rounded-lg bg-white/10 px-2 py-2 text-xs hover:bg-white/20"
                      >
                        ✓ Mark seen
                      </button>
                      <button
                        onClick={() => toggleWatchlist(r)}
                        className={`flex-1 rounded-lg px-2 py-2 text-xs ${
                          saved
                            ? "bg-gold text-black font-semibold"
                            : "bg-white/10 hover:bg-white/20"
                        }`}
                      >
                        {saved ? "Saved" : "+ Watchlist"}
                      </button>
                    </div>

                    {/* Don't recommend again button */}
                    <button
                      onClick={() => dismiss(r)}
                      title="Remove and don't recommend again"
                      className="w-full rounded-lg border border-white/10 py-1.5 text-[11px] text-white/45 transition hover:border-red-400/30 hover:bg-red-500/10 hover:text-red-300"
                    >
                      ✕ Not interested
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-10 flex gap-3">
          <button onClick={get} className="rounded-full border border-white/20 px-6 py-3">
            Refresh recommendations
          </button>
          <Link
            href="/discover"
            className="rounded-full bg-gold px-6 py-3 font-bold text-black"
          >
            Discover more titles
          </Link>
        </div>
      </section>
    </main>
  );
}