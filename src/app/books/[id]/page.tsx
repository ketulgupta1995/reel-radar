"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AppSwitcher } from "@/components/AppSwitcher";
import { RecordingPlayer } from "./RecordingPlayer";
import { loadPosition, openBook, savePosition } from "@/lib/books";
import { RecordingChoice, commitPosition, loadRecording, pushPosition, setRecording, syncBooks, useBooksSync } from "@/lib/booksDoc";
import { Recording, formatDuration, searchRecordings } from "@/lib/librivox";
import type { ParsedBook } from "@/lib/epub";
import { usePlayer } from "@/lib/usePlayer";
import { useWakeLock } from "@/lib/useWakeLock";
import { RATES, voiceLabel } from "@/lib/voices";

const MODE_KEY = "books-mode-v1";
const savedMode = (id: string) => {
  try {
    return JSON.parse(localStorage.getItem(MODE_KEY) || "{}")[id] as string | undefined;
  } catch {
    return undefined;
  }
};
const saveMode = (id: string, mode: string) => {
  try {
    localStorage.setItem(MODE_KEY, JSON.stringify({ ...JSON.parse(localStorage.getItem(MODE_KEY) || "{}"), [id]: mode }));
  } catch {
    // Not kept; the book opens read aloud next time.
  }
};

export default function BookPage() {
  const { id } = useParams<{ id: string }>();
  const [book, setBook] = useState<ParsedBook | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "missing" | "ready">("loading");
  const [chapter, setChapter] = useState(0);
  const sentences = book?.chapters[chapter]?.sentences ?? [];
  const player = usePlayer(sentences);
  const { state } = player;
  // Where to start the chapter that is about to load, and whether to start speaking at once.
  const start = useRef({ index: 0, play: false });
  const currentRef = useRef<HTMLButtonElement>(null);
  const savedChapter = useRef<number | null>(null);
  // Which way the book is listened to on this device: read aloud by the phone, or a LibriVox recording.
  const [recording, setChosen] = useState<RecordingChoice | null>(null);
  const [mode, setMode] = useState<"speech" | "recording">("speech");
  const [finder, setFinder] = useState<{ state: "loading" | "ready"; found: Recording[]; error: string } | null>(null);
  const latest = useRef({ chapter, status: player.state.status, index: player.state.index });
  latest.current = { chapter, status: player.state.status, index: player.state.index };

  useEffect(() => {
    openBook(id).then(
      (b) => {
        const saved = loadPosition(id);
        const at = b && saved && saved.chapter < b.chapters.length ? saved : undefined;
        start.current = { index: at?.sentence ?? 0, play: false };
        setChapter(at?.chapter ?? 0);
        setBook(b);
        setLoadState(b ? "ready" : "missing");
        const chosen = loadRecording(id);
        setChosen(chosen);
        setMode(chosen && savedMode(id) === "recording" ? "recording" : "speech");
        void syncBooks();
      },
      () => setLoadState("missing")
    );
  }, [id]);

  // Load each chapter into the player, at the saved sentence the first time.
  useEffect(() => {
    if (!book) return;
    player.load(String(chapter), start.current.index, start.current.play);
    start.current = { index: 0, play: false };
  }, [book, chapter]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save the position after every sentence, once the player holds this chapter. It is queued for
  // syncing when the chapter changes, when playback stops, and when the page is left or hidden.
  useEffect(() => {
    if (!book || state.key !== String(chapter)) return;
    savePosition(id, chapter, state.index);
    if (savedChapter.current !== null && savedChapter.current !== chapter) commitPosition();
    savedChapter.current = chapter;
  }, [id, book, chapter, state.key, state.index]);
  useEffect(() => {
    if (state.status !== "playing") commitPosition();
  }, [state.status]);
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") pushPosition();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", pushPosition);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", pushPosition);
      pushPosition();
    };
  }, []);

  // Another device moved on: follow it, unless this one is playing.
  useBooksSync(() => {
    const chosen = loadRecording(id);
    setChosen(chosen);
    if (!chosen) setMode("speech");
    const saved = loadPosition(id);
    const now = latest.current;
    if (!saved || now.status === "playing" || (saved.chapter === now.chapter && saved.sentence === now.index)) return;
    if (saved.chapter === now.chapter) player.jump(saved.sentence);
    else {
      start.current = { index: saved.sentence, play: false };
      setChapter(saved.chapter);
    }
  });

  // At the end of a chapter, carry on into the next one.
  useEffect(() => {
    if (book && state.status === "finished" && state.key === String(chapter) && chapter + 1 < book.chapters.length) {
      start.current = { index: 0, play: true };
      setChapter(chapter + 1);
    }
  }, [book, chapter, state.status, state.key]);

  // Braces matter: some browsers return a Promise from scrollIntoView, and an effect must return nothing or a function.
  useEffect(() => {
    currentRef.current?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [state.index, state.key]);

  const playing = state.status === "playing";
  useWakeLock(playing);

  const switchTo = (next: "speech" | "recording") => {
    if (next === mode || !book) return;
    player.pause();
    if (next === "speech") {
      start.current = { index: 0, play: false };
      setChapter(Math.min(chapter, book.chapters.length - 1)); // a recording can have more sections than the book has chapters
    }
    setMode(next);
    saveMode(id, next);
  };
  // The recording's sections stand in for chapters, so changing section keeps the position in step.
  const onSection = useCallback((index: number) => {
    start.current = { index: 0, play: false };
    setChapter(index);
  }, []);
  const find = async () => {
    if (!book) return;
    setFinder({ state: "loading", found: [], error: "" });
    try {
      setFinder({ state: "ready", found: await searchRecordings(book.title, book.author), error: "" });
    } catch (err) {
      setFinder({ state: "ready", found: [], error: (err as Error).message });
    }
  };
  const pick = (r: Recording) => {
    const choice = { id: r.id, title: r.title };
    setRecording(id, choice);
    setChosen(choice);
    setFinder(null);
    switchTo("recording");
  };
  const clear = () => {
    setRecording(id, null);
    setChosen(null);
    switchTo("speech");
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,#261e38_0%,#090910_55%,#050508_100%)] text-white">
      <header className="sticky top-0 z-40 border-b border-white/5 bg-black/20 backdrop-blur-md">
        <nav className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
          <AppSwitcher current="books" />
        </nav>
      </header>

      <div className="mx-auto max-w-3xl space-y-5 px-4 pb-32 pt-8 sm:px-6">
        <Link href="/books" className="text-sm text-white/60 hover:text-gold">
          ← Library
        </Link>
        {loadState === "loading" && <p className="text-sm text-white/60">Opening…</p>}
        {loadState === "missing" && (
          <p className="text-sm text-white/80">This book isn&apos;t on this device. Go back to the library and upload the file again.</p>
        )}
        {book && (
          <>
            <div>
              <h1 className="text-2xl font-bold">{book.title}</h1>
              <p className="text-sm text-white/60">{book.author}</p>
            </div>
            <section aria-label="Recording" className="space-y-3 rounded-2xl border border-white/10 bg-white/[.04] p-3">
              {recording ? (
                <>
                  <p className="text-sm">
                    <span className="text-white/55">Recording: </span>
                    {recording.title}
                  </p>
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Listen with">
                    {(["speech", "recording"] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => switchTo(m)}
                        aria-pressed={mode === m}
                        className={`rounded-full border px-3 py-1.5 text-sm transition ${
                          mode === m ? "border-gold/50 bg-gold/15 text-gold" : "border-white/10 text-white/70 hover:border-white/25"
                        }`}
                      >
                        {m === "speech" ? "Read aloud by the phone" : "The recording"}
                      </button>
                    ))}
                    <button onClick={find} className="rounded-full border border-white/10 px-3 py-1.5 text-sm text-white/70 hover:border-white/25">
                      Change recording
                    </button>
                    <button onClick={clear} className="rounded-full border border-white/10 px-3 py-1.5 text-sm text-white/70 hover:border-white/25">
                      Remove recording
                    </button>
                  </div>
                </>
              ) : (
                <button onClick={find} className="rounded-full border border-white/15 px-4 py-1.5 text-sm font-semibold transition hover:border-gold/40">
                  Find a recording
                </button>
              )}
              {finder && (
                <div className="space-y-2" aria-label="Recordings found">
                  {finder.state === "loading" && <p className="text-sm text-white/60">Looking for recordings…</p>}
                  {finder.error && <p className="text-sm text-white/80">{finder.error}</p>}
                  {finder.state === "ready" && !finder.error && !finder.found.length && (
                    <p className="text-sm text-white/65">No recordings found for this book. LibriVox only records public-domain books.</p>
                  )}
                  {finder.found.map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 px-3 py-2">
                      <div className="min-w-0 text-sm">
                        <span className="block font-semibold">{r.title}</span>
                        <span className="block text-white/60">
                          {r.readers.join(", ") || "Volunteer readers"} · {formatDuration(r.seconds)} · {r.sectionCount} sections
                        </span>
                      </div>
                      <button
                        onClick={() => pick(r)}
                        aria-label={`Choose ${r.title}, read by ${r.readers.join(", ") || "volunteers"}`}
                        className="shrink-0 rounded-full bg-gold px-3 py-1.5 text-sm font-semibold text-ink hover:bg-amber-300"
                      >
                        Choose
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
            {mode === "recording" && recording && (
              <RecordingPlayer recordingId={recording.id} section={chapter} onSection={onSection} rate={player.prefs.rate} onRate={(rate) => player.choose({ rate })} />
            )}
            {mode === "speech" && (
              <>
                {!player.supported && (
                  <p role="alert" className="rounded-xl border border-gold/40 px-3 py-2 text-sm">
                    This browser can&apos;t read aloud. Open Books in Chrome.
                  </p>
                )}
                {player.error && (
                  <p role="alert" className="rounded-xl border border-gold/40 px-3 py-2 text-sm">
                    {player.error}
                  </p>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="voice" className="block text-xs font-semibold uppercase tracking-wider text-white/45">
                      Voice
                    </label>
                    <select
                      id="voice"
                      value={player.prefs.voiceURI ?? ""}
                      onChange={(e) => player.choose({ voiceURI: e.target.value || null })}
                      className="mt-1 w-full rounded-xl border border-white/10 bg-panel px-3 py-2 text-sm text-white outline-none focus:border-gold/50"
                    >
                      <option value="">Phone default</option>
                      {player.voices.map((v) => (
                        <option key={v.voiceURI} value={v.voiceURI}>
                          {voiceLabel(v)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <span className="block text-xs font-semibold uppercase tracking-wider text-white/45">Speed</span>
                    <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label="Speed">
                      {RATES.map((r) => (
                        <button
                          key={r}
                          onClick={() => player.choose({ rate: r })}
                          aria-pressed={player.prefs.rate === r}
                          className={`rounded-full border px-3 py-1.5 text-sm transition ${
                            player.prefs.rate === r ? "border-gold/50 bg-gold/15 text-gold" : "border-white/10 text-white/70 hover:border-white/25"
                          }`}
                        >
                          {r}×
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <label htmlFor="chapter" className="block text-xs font-semibold uppercase tracking-wider text-white/45">
                  Chapter
                </label>
                <select
                  id="chapter"
                  value={chapter}
                  onChange={(e) => {
                    start.current = { index: 0, play: false };
                    setChapter(Number(e.target.value));
                  }}
                  className="w-full rounded-xl border border-white/10 bg-panel px-3 py-2 text-sm text-white outline-none focus:border-gold/50"
                >
                  {book.chapters.map((c, i) => (
                    <option key={i} value={i}>
                      {c.title}
                    </option>
                  ))}
                </select>
                <p className="font-serif text-lg leading-relaxed text-white/90" aria-label="Chapter text">
                  {sentences.map((s, i) => {
                    const current = i === state.index && state.key === String(chapter);
                    return (
                      <span key={i}>
                        <button
                          ref={current ? currentRef : undefined}
                          onClick={() => player.jump(i)}
                          aria-current={current ? "true" : undefined}
                          className={`rounded px-0.5 text-left transition ${current ? "bg-gold text-ink" : "hover:bg-white/10"}`}
                        >
                          {s}
                        </button>{" "}
                      </span>
                    );
                  })}
                </p>
              </>
            )}
          </>
        )}
      </div>

      {book && mode === "speech" && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-panel/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
          <div className="mx-auto grid max-w-3xl grid-cols-[1fr_2fr_1fr] gap-2">
            <button
              onClick={() => player.jump(state.index - 1)}
              aria-label="Previous sentence"
              className="rounded-xl border border-white/10 py-3 text-sm font-semibold transition hover:border-gold/40"
            >
              Back
            </button>
            <button
              onClick={playing ? player.pause : player.play}
              className="rounded-xl bg-gold py-3 text-sm font-bold text-ink transition hover:bg-amber-300"
            >
              {playing ? "Pause" : "Play"}
            </button>
            <button
              onClick={() => player.jump(state.index + 1)}
              aria-label="Next sentence"
              className="rounded-xl border border-white/10 py-3 text-sm font-semibold transition hover:border-gold/40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
