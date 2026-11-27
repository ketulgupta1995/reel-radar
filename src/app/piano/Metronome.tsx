"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_BPM, MIN_BPM, Beat, DEFAULT_WINDOW_MS, Scheduler, clampBpm, createScheduler, describeOffset, offsetStats, scoreHit } from "@/lib/pianoTiming";
import { loadTiming, saveTiming } from "@/lib/pianoTimingSettings";
import { useWakeLock } from "@/lib/useWakeLock";
import { usePiano } from "./PianoProvider";

const RECENT = 16; // hits the tap-along average covers

// The metronome: start/stop, tempo, beats per bar, a one-bar count-in, a beat indicator and the
// tap-along check. Reusable: render it on any Piano page inside PianoProvider. `onBeat` sees every
// beat as it is scheduled (a little before it sounds); `windowMs` is the "on time" window.
export function Metronome({ onBeat, windowMs = DEFAULT_WINDOW_MS, tapAlong = true }: { onBeat?: (b: Beat) => void; windowMs?: number; tapAlong?: boolean }) {
  const { midi } = usePiano();
  // Defaults on the server and first render; this device's saved values arrive in an effect.
  const [bpm, setBpmState] = useState(80);
  const [beatsPerBar, setBeats] = useState(4);
  const [latencyMs, setLatencyState] = useState(0);
  const [countIn, setCountIn] = useState(true);
  const [running, setRunning] = useState(false);
  const [active, setActive] = useState<Beat | null>(null);
  const [offsets, setOffsets] = useState<number[]>([]);

  const sched = useRef<Scheduler | null>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const latest = useRef({ latencyMs, windowMs, onBeat });
  latest.current = { latencyMs, windowMs, onBeat };

  useEffect(() => {
    const s = loadTiming();
    setBpmState(s.bpm);
    setBeats(s.beatsPerBar);
    setLatencyState(s.latencyMs);
  }, []);

  useEffect(() => {
    const pending = timers.current;
    sched.current = createScheduler({
      onBeat(beat) {
        midi.click(beat.accent, beat.time);
        latest.current.onBeat?.(beat);
        // The indicator follows the sound: lit when the click is due.
        const id = setTimeout(() => {
          pending.delete(id);
          setActive(beat);
        }, Math.max(0, beat.time - performance.now()));
        pending.add(id);
      },
    });
    return () => {
      sched.current?.stop();
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, [midi]);

  // Tap-along: every key press, on the keyboard or the screen, against the nearest beat.
  useEffect(
    () =>
      midi.onNote((e) => {
        const s = sched.current;
        if (e.type !== "on" || !s?.running()) return;
        const beat = s.nearest(e.time - latest.current.latencyMs);
        if (!beat) return;
        const { offsetMs } = scoreHit(e.time, beat.time, { windowMs: latest.current.windowMs, latencyMs: latest.current.latencyMs });
        if (offsetMs !== null) setOffsets((o) => [...o, offsetMs].slice(-RECENT));
      }),
    [midi],
  );

  useWakeLock(running);

  const begin = (nextBeats = beatsPerBar) => {
    setOffsets([]);
    setActive(null);
    sched.current?.start({ bpm, beatsPerBar: nextBeats, countInBars: countIn ? 1 : 0 });
    setRunning(true);
  };
  const end = () => {
    sched.current?.stop();
    timers.current.forEach(clearTimeout);
    timers.current.clear();
    setActive(null);
    setRunning(false);
  };
  const setBpm = (v: number) => {
    const next = clampBpm(v);
    setBpmState(next);
    sched.current?.setBpm(next);
    saveTiming({ bpm: next });
  };
  const setMeter = (n: number) => {
    setBeats(n);
    saveTiming({ beatsPerBar: n });
    if (running) begin(n);
  };
  const setLatency = (v: number) => {
    const next = Math.max(-500, Math.min(500, Math.round(v) || 0));
    setLatencyState(next);
    setOffsets([]); // the old hits were corrected with the old value
    saveTiming({ latencyMs: next });
  };

  const stats = offsetStats(offsets);
  const counting = running && active?.countIn;
  return (
    <section aria-label="Metronome" className="space-y-4 rounded-2xl border border-white/10 bg-panel/60 p-4">
      <div className="flex items-center justify-center gap-4">
        <button type="button" aria-label="Slower" onClick={() => setBpm(bpm - 1)} className="h-11 w-11 rounded-full border border-white/15 text-xl hover:bg-white/10">
          −
        </button>
        <div className="text-center">
          <span data-testid="bpm" className="text-5xl font-extrabold tabular-nums text-gold">
            {bpm}
          </span>
          <span className="ml-1 text-sm text-white/50">BPM</span>
        </div>
        <button type="button" aria-label="Faster" onClick={() => setBpm(bpm + 1)} className="h-11 w-11 rounded-full border border-white/15 text-xl hover:bg-white/10">
          +
        </button>
      </div>
      <input type="range" aria-label="Tempo" min={MIN_BPM} max={MAX_BPM} value={bpm} onChange={(e) => setBpm(Number(e.target.value))} className="w-full accent-[#f6c453]" />

      <div role="img" aria-label={counting ? "Count-in" : "Beat"} className="flex h-10 items-center justify-center gap-3" data-testid="beats">
        {Array.from({ length: beatsPerBar }, (_, i) => (
          <span
            key={i}
            data-on={active?.beatInBar === i ? "true" : "false"}
            className={`h-6 w-6 rounded-full border ${active?.beatInBar === i ? (i === 0 ? "border-gold bg-gold" : "border-white bg-white") : "border-white/25"} ${i === 0 ? "scale-110" : ""}`}
          />
        ))}
      </div>
      <p className="h-4 text-center text-xs text-white/50" aria-live="polite">
        {counting ? "Count-in…" : running ? "Playing" : ""}
      </p>

      <div className="flex flex-wrap items-center justify-center gap-3 text-sm text-white/70">
        <label className="flex items-center gap-2">
          Beats per bar
          <select value={beatsPerBar} onChange={(e) => setMeter(Number(e.target.value))} className="rounded-lg border border-white/15 bg-ink px-2 py-1">
            {[2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={countIn} onChange={(e) => setCountIn(e.target.checked)} />
          One-bar count-in
        </label>
      </div>

      <button
        type="button"
        onClick={running ? end : () => begin()}
        className={`w-full rounded-xl py-3 font-semibold ${running ? "border border-white/20 hover:bg-white/10" : "bg-gold text-ink hover:brightness-110"}`}
      >
        {running ? "Stop" : "Start"}
      </button>

      {tapAlong && (
        <div className="space-y-2 border-t border-white/10 pt-3 text-sm">
          <p className="font-semibold">Tap along</p>
          <p className="text-white/60">Press any key on the beat. Handy for measuring this device&apos;s click delay.</p>
          <p data-testid="tap-result" aria-live="polite" className="text-white/90">
            {describeOffset(stats)}
          </p>
          <label className="flex flex-wrap items-center gap-2 text-white/70">
            Latency offset (ms)
            <input
              type="number"
              aria-label="Latency offset"
              value={latencyMs}
              step={5}
              onChange={(e) => setLatency(Number(e.target.value))}
              className="w-20 rounded-lg border border-white/15 bg-ink px-2 py-1"
            />
            <button
              type="button"
              disabled={!stats.n}
              onClick={() => setLatency(latencyMs + stats.mean)}
              className="rounded-lg border border-white/15 px-2 py-1 hover:bg-white/10 disabled:opacity-40"
            >
              Set from average
            </button>
          </label>
          <p className="text-xs text-white/40">Saved on this device only. Scores subtract it from your hit times.</p>
        </div>
      )}
    </section>
  );
}
