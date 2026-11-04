"use client";

import { useEffect, useRef, useState } from "react";
import { commitPosition } from "@/lib/booksDoc";
import { Section, formatDuration, loadSections } from "@/lib/librivox";
import { useWakeLock } from "@/lib/useWakeLock";
import { RATES } from "@/lib/voices";

// Plays a LibriVox recording one section at a time, straight from archive.org. Sections don't line up with
// the book's chapters, and the recording has no sentence timings, so only the section is tracked.
export function RecordingPlayer({
  recordingId,
  section,
  onSection,
  rate,
  onRate,
}: {
  recordingId: string;
  section: number;
  onSection: (index: number) => void;
  rate: number;
  onRate: (rate: number) => void;
}) {
  const [sections, setSections] = useState<Section[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const carryOn = useRef(false); // start the next section by itself, after one ends

  useEffect(() => {
    let current = true;
    setSections(null);
    setError("");
    loadSections(recordingId).then(
      (s) => current && (s.length ? setSections(s) : setError("That recording has no audio.")),
      (e: Error) => current && setError(e.message)
    );
    return () => {
      current = false;
    };
  }, [recordingId, attempt]);

  // A recording can have fewer sections than the book has chapters.
  const index = sections ? Math.min(section, sections.length - 1) : 0;
  useEffect(() => {
    if (sections && index !== section) onSection(index);
  }, [sections, index, section, onSection]);

  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    el.playbackRate = rate;
    if (carryOn.current) {
      carryOn.current = false;
      void el.play()?.catch(() => setPlaying(false));
    }
  }, [rate, index, sections]);

  useWakeLock(playing);

  if (error) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-gold/40 px-3 py-2 text-sm">
        <span>{error}</span>
        <button onClick={() => setAttempt((n) => n + 1)} className="rounded-full border border-white/20 px-3 py-1 hover:border-gold/40">
          Try again
        </button>
      </div>
    );
  }
  if (!sections) return <p className="text-sm text-white/60">Loading the recording…</p>;

  const go = (i: number) => {
    if (i < 0 || i >= sections.length) return;
    carryOn.current = playing;
    commitPosition();
    onSection(i);
  };
  const now = sections[index];

  return (
    <div className="space-y-4">
      <label htmlFor="section" className="block text-xs font-semibold uppercase tracking-wider text-white/45">
        Section
      </label>
      <select
        id="section"
        value={index}
        onChange={(e) => go(Number(e.target.value))}
        className="w-full rounded-xl border border-white/10 bg-panel px-3 py-2 text-sm text-white outline-none focus:border-gold/50"
      >
        {sections.map((s, i) => (
          <option key={i} value={i}>
            {i + 1}. {s.title} ({formatDuration(s.seconds)})
          </option>
        ))}
      </select>
      <audio
        ref={audio}
        key={now.url}
        src={now.url}
        controls
        preload="metadata"
        aria-label={`Recording: ${now.title}`}
        className="w-full"
        onPlay={() => setPlaying(true)}
        onPause={() => {
          setPlaying(false);
          commitPosition();
        }}
        onEnded={() => {
          carryOn.current = true;
          if (index + 1 < sections.length) go(index + 1);
          else {
            carryOn.current = false;
            setPlaying(false);
          }
        }}
        onError={() => setError("The recording couldn't be played. Check your connection and try again.")}
      />
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => go(index - 1)}
          disabled={index === 0}
          className="rounded-xl border border-white/10 py-3 text-sm font-semibold transition hover:border-gold/40 disabled:opacity-40"
        >
          Previous section
        </button>
        <button
          onClick={() => go(index + 1)}
          disabled={index === sections.length - 1}
          className="rounded-xl border border-white/10 py-3 text-sm font-semibold transition hover:border-gold/40 disabled:opacity-40"
        >
          Next section
        </button>
      </div>
      <div>
        <span className="block text-xs font-semibold uppercase tracking-wider text-white/45">Speed</span>
        <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label="Recording speed">
          {RATES.map((r) => (
            <button
              key={r}
              onClick={() => onRate(r)}
              aria-pressed={rate === r}
              className={`rounded-full border px-3 py-1.5 text-sm transition ${
                rate === r ? "border-gold/50 bg-gold/15 text-gold" : "border-white/10 text-white/70 hover:border-white/25"
              }`}
            >
              {r}×
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
