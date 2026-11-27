"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_BPM, MIN_BPM, Beat, DEFAULT_WINDOW_MS, Scheduler, clampBpm, createScheduler, describeOffset, offsetStats, scoreHit } from "@/lib/pianoTiming";
import { loadTiming, saveTiming } from "@/lib/pianoTimingSettings";
import { useWakeLock } from "@/lib/useWakeLock";
import { usePiano } from "./PianoProvider";

const RECENT = 16; // hits the tap-along average covers

type Options = { onBeat?: (b: Beat) => void; windowMs?: number };

// The metronome's state and scheduler: start/stop, tempo, beats per bar, a one-bar count-in, the beat
// indicator and the tap-along hits. Used by the card (<Metronome>) and the stage page. Render inside PianoProvider.
// `onBeat` sees every beat as it is scheduled (a little before it sounds); `windowMs` is the "on time" window.
export function useMetronome({ onBeat, windowMs = DEFAULT_WINDOW_MS }: Options = {}) {
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
  const counting = !!(running && active?.countIn);
  return { bpm, beatsPerBar, latencyMs, countIn, setCountIn, running, active, stats, counting, begin, end, setBpm, setMeter, setLatency };
}
type Metro = ReturnType<typeof useMetronome>;

// The beat dots and the status line.
export function BeatDisplay({ m, big }: { m: Metro; big?: boolean }) {
  const { active, beatsPerBar, counting, running } = m;
  return (
    <>
      <div role="img" aria-label={counting ? "Count-in" : "Beat"} className={`flex items-center justify-center gap-3 ${big ? "h-16 gap-5" : "h-10"}`} data-testid="beats">
        {Array.from({ length: beatsPerBar }, (_, i) => (
          <span
            key={i}
            data-on={active?.beatInBar === i ? "true" : "false"}
            className={`${big ? "h-10 w-10" : "h-6 w-6"} rounded-full border ${active?.beatInBar === i ? (i === 0 ? "border-pn-brass bg-pn-brass" : "border-pn-ivory bg-pn-ivory") : "border-pn-ivory/20"} ${i === 0 ? "scale-110" : ""}`}
          />
        ))}
      </div>
      <p className="h-4 text-center text-xs text-pn-ivory/50" aria-live="polite">
        {counting ? "Count-in…" : running ? "Playing" : ""}
      </p>
    </>
  );
}

export function BeatsPerBar({ m }: { m: Metro }) {
  return (
    <label className="flex items-center gap-2">
      Beats per bar
      <select value={m.beatsPerBar} onChange={(e) => m.setMeter(Number(e.target.value))} className="rounded-md border border-pn-line bg-pn-velvet px-2 py-1">
        {[2, 3, 4].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}

export function CountInToggle({ m }: { m: Metro }) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={m.countIn} onChange={(e) => m.setCountIn(e.target.checked)} />
      One-bar count-in
    </label>
  );
}

export function TapAlong({ m }: { m: Metro }) {
  const { stats, latencyMs, setLatency } = m;
  return (
    <div className="space-y-2 text-sm">
      <p className="font-pnd text-xl font-semibold">Tap along</p>
      <p className="text-pn-ivory/60">Press any key on the beat. Handy for measuring this device&apos;s click delay.</p>
      <p data-testid="tap-result" aria-live="polite" className="text-pn-ivory/90">
        {describeOffset(stats)}
      </p>
      <label className="flex flex-wrap items-center gap-2 text-pn-ivory/70">
        Latency offset (ms)
        <input
          type="number"
          aria-label="Latency offset"
          value={latencyMs}
          step={5}
          onChange={(e) => setLatency(Number(e.target.value))}
          className="w-20 rounded-md border border-pn-line bg-pn-velvet px-2 py-1"
        />
        <button
          type="button"
          disabled={!stats.n}
          onClick={() => setLatency(latencyMs + stats.mean)}
          className="rounded-lg border border-pn-ivory/20 px-2 py-1 hover:bg-pn-ivory/10 disabled:opacity-40"
        >
          Set from average
        </button>
      </label>
      <p className="text-xs text-pn-ivory/40">Saved on this device only. Scores subtract it from your hit times.</p>
    </div>
  );
}

// The BPM readout with - and + around it and the tempo slider. `big` is the stage's music-stand size.
export function TempoControl({ m, big }: { m: Metro; big?: boolean }) {
  const { bpm, setBpm } = m;
  return (
    <>
      <div className="flex items-center justify-center gap-4">
        <button type="button" aria-label="Slower" onClick={() => setBpm(bpm - 1)} className={`${big ? "h-14 w-14 text-3xl" : "h-11 w-11 text-xl"} rounded-full border border-pn-ivory/20 hover:bg-pn-ivory/10`}>
          −
        </button>
        <div className="text-center">
          <span data-testid="bpm" className={`font-pnd font-semibold tabular-nums text-pn-ivory ${big ? "text-[clamp(4.5rem,24vh,9rem)] leading-none" : "text-7xl"}`}>
            {bpm}
          </span>
          <span className="ml-2 text-sm text-pn-brass">BPM</span>
        </div>
        <button type="button" aria-label="Faster" onClick={() => setBpm(bpm + 1)} className={`${big ? "h-14 w-14 text-3xl" : "h-11 w-11 text-xl"} rounded-full border border-pn-ivory/20 hover:bg-pn-ivory/10`}>
          +
        </button>
      </div>
      <input type="range" aria-label="Tempo" min={MIN_BPM} max={MAX_BPM} value={bpm} onChange={(e) => setBpm(Number(e.target.value))} className="w-full accent-[#d4a64a]" />
    </>
  );
}

export function StartStop({ m, big }: { m: Metro; big?: boolean }) {
  return (
    <button
      type="button"
      onClick={m.running ? m.end : () => m.begin()}
      className={`w-full rounded-full ${big ? "py-4 text-xl" : "py-3 text-lg"} font-semibold ${m.running ? "border border-pn-ivory/30 hover:bg-pn-ivory/10" : "bg-pn-brass text-pn-ebony hover:brightness-110"}`}
    >
      {m.running ? "Stop" : "Start"}
    </button>
  );
}

// The metronome as a card: tempo, beat indicator, meter, count-in, start/stop and the tap-along check.
// Reusable: render it on any Piano page inside PianoProvider. The metronome page puts the same parts on the stage.
export function Metronome({ onBeat, windowMs = DEFAULT_WINDOW_MS, tapAlong = true }: { onBeat?: (b: Beat) => void; windowMs?: number; tapAlong?: boolean }) {
  const m = useMetronome({ onBeat, windowMs });
  return (
    <section aria-label="Metronome" className="space-y-5 rounded-lg border border-pn-line bg-pn-felt p-4 sm:p-6">
      <TempoControl m={m} />
      <BeatDisplay m={m} />
      <div className="flex flex-wrap items-center justify-center gap-3 text-sm text-pn-ivory/70">
        <BeatsPerBar m={m} />
        <CountInToggle m={m} />
      </div>
      <StartStop m={m} />
      {tapAlong && (
        <div className="border-t border-pn-line pt-3">
          <TapAlong m={m} />
        </div>
      )}
    </section>
  );
}
