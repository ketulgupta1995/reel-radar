"use client";

// Play-along run driver: a count-in bar, then the song at a fixed tempo on the performance.now() clock. The
// scheduler hands out beats ~100 ms early; the app's hand is sent to the keyboard with timestamps from those
// beats. A 50 ms tick moves the falling notes and colours each note as it is scored; after the last note (plus
// a short wait for late hits) the run is scored with scorePlayAlong and handed to `onDone`.
import { useCallback, useEffect, useRef, useState } from "react";
import type { PianoMidi } from "@/lib/pianoMidi";
import { COUNT_IN_BARS, Hit, NoteScore, Onset, PlaySummary, onsetsFor, runEndMs, scorePlayAlong, summarize } from "@/lib/pianoSongPlay";
import { HandChoice, Song, SongNote, handOf, songBeats } from "@/lib/pianoSongs";
import { DEFAULT_WINDOW_MS, Grade, Scheduler, beatInterval, createScheduler } from "@/lib/pianoTiming";
import { loadLatencyMs } from "@/lib/pianoTimingSettings";

const SETTLE_MS = 300; // after the last note, wait this long for late hits
const REACH_MS = DEFAULT_WINDOW_MS * 2.5; // past this a note with no hit is shown missed
const AUTO_VELOCITY = 80;

export type PlayDone = { hands: HandChoice; bpm: number; summary: PlaySummary; scores: NoteScore[]; wall: number; durationMs: number };
export type PlayLive = { at: number; marks: ReadonlyMap<SongNote, Grade> }; // at: song position in beats, negative in the count-in

type Run = { startMs: number; bpm: number; hands: HandChoice; onsets: Onset[]; hits: Hit[]; wall: number; perf: number; latency: number };

export function usePlayAlong(song: Song, midi: PianoMidi, onDone: (r: PlayDone) => void) {
  const [live, setLive] = useState<PlayLive | null>(null);
  const run = useRef<Run | null>(null);
  const sched = useRef<Scheduler | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const done = useRef(onDone);
  done.current = onDone;

  const halt = useCallback(() => {
    sched.current?.stop();
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    run.current = null;
    setLive(null);
  }, []);

  useEffect(
    () =>
      midi.onNote((e) => {
        const r = run.current;
        if (e.type === "on" && r && e.time >= r.startMs - 250) r.hits.push({ note: e.note, time: e.time });
      }),
    [midi],
  );
  useEffect(() => halt, [halt]);

  const start = useCallback(
    (hands: HandChoice, bpm: number, clicks: boolean) => {
      halt();
      const startMs = performance.now() + 60;
      const mine = handOf(song.notes, hands);
      const app = song.notes.filter((n) => !mine.includes(n));
      const countBeats = COUNT_IN_BARS * song.beatsPerBar;
      const total = Math.ceil(songBeats(song));
      const ms = beatInterval(bpm);
      const r: Run = { startMs, bpm, hands, onsets: onsetsFor(song, hands, startMs, bpm), hits: [], wall: Date.now(), perf: performance.now(), latency: loadLatencyMs() };
      run.current = r;
      const s = createScheduler({
        onBeat(beat) {
          const p = beat.index - countBeats; // song beat this click lands on
          if (p >= total) return;
          if (beat.countIn || clicks) midi.click(beat.accent, beat.time);
          for (const n of app) if (n.start >= p && n.start < p + 1) midi.play(n.pitch, AUTO_VELOCITY, Math.round(n.dur * ms * 0.95), beat.time + (n.start - p) * ms);
        },
      });
      sched.current = s;
      s.start({ bpm, beatsPerBar: song.beatsPerBar, countInBars: COUNT_IN_BARS, at: startMs });
      const tick = () => {
        const t = performance.now();
        const { scores, extra } = scorePlayAlong(r.onsets, r.hits, { latencyMs: r.latency });
        if (t >= runEndMs(song, startMs, bpm) + SETTLE_MS) {
          const { wall, perf } = r;
          halt();
          done.current({ hands, bpm, summary: summarize(song, scores, extra), scores, wall, durationMs: Math.max(0, Math.round(t - perf)) });
          return;
        }
        const marks = new Map<SongNote, Grade>();
        scores.forEach((sc, i) => {
          if (sc.grade !== "missed") marks.set(sc.note, sc.grade);
          else if (t - r.latency > r.onsets[i].time + REACH_MS) marks.set(sc.note, "missed");
        });
        setLive({ at: (t - startMs) / ms - countBeats, marks });
      };
      timer.current = setInterval(tick, 50);
      setLive({ at: -countBeats - 60 / ms, marks: new Map() });
    },
    [song, midi, halt],
  );

  return { live, start, stop: halt };
}
