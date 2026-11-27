"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { PianoKeyboard, keyLayout } from "@/components/PianoKeyboard";
import { loadSongProgress, newSessionId, saveSession, saveSongProgress, usePianoSync } from "@/lib/pianoData";
import { HANDS_LADDER, LAST_STEP, RunOutcome, RunResult, SongMode, SongProgress, applyRun, ladderTempo, stepIndex } from "@/lib/pianoSongLadder";
import { RUSH_DRAG_MS } from "@/lib/pianoSongPlay";
import { BOTH_UNLOCK_PCT, bothUnlocked } from "@/lib/pianoScales";
import { HandChoice, Song, beatMs, songRange } from "@/lib/pianoSongs";
import { offsetStats } from "@/lib/pianoTiming";
import { WaitState, advance, autoNotes, expectedNotes, press, startWait, stepsPlayed } from "@/lib/pianoSongWait";
import { useWakeLock } from "@/lib/useWakeLock";
import { KeyboardStatus } from "../KeyboardStatus";
import { usePiano } from "../PianoProvider";
import { FallingNotes, GRADE_BAR, HAND_KEY } from "./FallingNotes";
import { PlayDone, usePlayAlong } from "./usePlayAlong";

export const SONGS_DRILL = "songs"; // the drill id of a song (or coordination exercise) run in the practice log; items are keyed by song id
export const SCALES_DRILL = "scales"; // the same for a scale run; items are keyed by the scale's id
const AUTO_VELOCITY = 80;
const mmss = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
type Summary = { misses: number; durationMs: number; played: number; total: number; early: boolean };
type Next = { stepDone: boolean; mastered: boolean; step: number; tempo: number | null }; // what the ladders say after a run
const MODES: { id: SongMode; label: string }[] = [
  { id: "wait", label: "Wait" },
  { id: "play", label: "Play-along" },
];
const HAND_NAME = { R: "right", L: "left", both: "both" } as const;
const HANDS: { id: HandChoice; label: string }[] = [
  { id: "R", label: "Right hand" },
  { id: "L", label: "Left hand" },
  { id: "both", label: "Both hands" },
];

// Wait mode: the song waits on each step until the keys of the chosen hand(s) are held; the other hand is
// played by the app (at the song's tempo times the speed slider). Play-along: a count-in, then the song keeps
// going at the tempo ladder's BPM and each note is scored (usePlayAlong). Both feed the ladders and progress.
//
// Scale mode (`scale`): the same player for a scale song. It always opens on the right hand in wait mode, hides the
// hands ladder (a scale has its own order: one hand first), locks "Both hands" until a play-along run reached
// BOTH_UNLOCK_PCT on time, shows the evenness of the timing after a play-along run, and logs runs as "scales".
export function SongPlayer({ song, scale = false, back }: { song: Song; scale?: boolean; back?: { href: string; label: string } }) {
  const drill = scale ? SCALES_DRILL : SONGS_DRILL;
  const { midi } = usePiano();
  const [hands, setHands] = useState<HandChoice>("R");
  const [mode, setMode] = useState<SongMode>("wait");
  const [speed, setSpeed] = useState(100);
  const [clicks, setClicks] = useState(false);
  const [progress, setProgress] = useState<SongProgress | undefined>();
  const [next, setNext] = useState<Next | null>(null);
  const [play, setPlay] = useState<PlayDone | null>(null);
  const [run, setRun] = useState<WaitState | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [held, setHeld] = useState<ReadonlySet<number>>(new Set());
  const runRef = useRef<WaitState | null>(null);
  const heldRef = useRef(new Set<number>());
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const started = useRef({ wall: 0, perf: 0 });
  const scroller = useRef<HTMLDivElement>(null);
  const tempo = ladderTempo(song, progress);
  const bothLocked = scale && !bothUnlocked(progress);

  // Saved progress: read on open (the hands and mode jump to the ladder's step) and again when another device syncs.
  const loaded = useRef(false);
  const reload = () => {
    const p = loadSongProgress(song.id);
    setProgress(p);
    if (!loaded.current) {
      loaded.current = true;
      if (p && !scale) {
        setHands(HANDS_LADDER[p.step].hands);
        setMode(HANDS_LADDER[p.step].mode);
      }
    }
  };
  useEffect(reload, []); // eslint-disable-line react-hooks/exhaustive-deps
  usePianoSync(reload);

  // Feeds a finished run to the ladders; progress is only written when it changed.
  const record = (r: RunResult) => {
    const out: RunOutcome = applyRun(song, loadSongProgress(song.id), r, Date.now());
    if (out.changed) saveSongProgress(song.id, out.progress, Date.now());
    setProgress(out.progress);
    setNext({ stepDone: out.stepDone && !scale, mastered: out.mastered && out.stepDone, step: out.progress.step, tempo: out.nextTempo });
  };

  const { live, start: startPlay, stop: stopPlay } = usePlayAlong(song, midi, (r) => {
    setPlay(r);
    const { summary: sm } = r;
    saveSession({
      id: newSessionId(),
      kind: "drill",
      drill,
      startedAt: r.wall,
      durationMs: r.durationMs,
      items: { [song.id]: { attempts: 1, misses: sm.total - sm.onTime, slow: 0, avgMs: Math.round(sm.meanAbsMs) } },
      updatedAt: Date.now(),
    });
    record({ mode: "play", hands: r.hands, onTime: sm.onTimePct, tempo: r.bpm });
  });
  useWakeLock(run !== null || live !== null);

  const view = useMemo(() => run ?? startWait(song, hands), [run, song, hands]);
  const { low, high } = useMemo(() => songRange(song), [song]);

  const finish = (s: WaitState, early: boolean) => {
    const durationMs = Math.max(0, Math.round(performance.now() - started.current.perf));
    runRef.current = null;
    setRun(null);
    const played = stepsPlayed(s);
    setSummary({ misses: s.misses, durationMs, played, total: s.steps.length, early });
    if (!played) return;
    if (!early) record({ mode: "wait", hands: s.hands, finished: true, misses: s.misses, steps: s.steps.length });
    const now = Date.now();
    saveSession({
      id: newSessionId(),
      kind: "drill",
      drill,
      startedAt: started.current.wall,
      durationMs,
      items: { [song.id]: { attempts: 1, misses: s.misses, slow: 0, avgMs: 0 } },
      updatedAt: now,
    });
  };
  const apply = (next: WaitState) => {
    if (next === runRef.current) return;
    if (next.done) return finish(next, false);
    runRef.current = next;
    setRun(next);
  };
  const applyRef = useRef(apply);
  applyRef.current = apply;

  // Keys: the held set (for the on-screen keyboard and chords) and wait mode's one input.
  useEffect(
    () =>
      midi.onNote((e) => {
        if (e.type === "off") heldRef.current.delete(e.note);
        else heldRef.current.add(e.note);
        setHeld(new Set(heldRef.current));
        const r = runRef.current;
        if (e.type === "on" && r) applyRef.current(press(r, e.note, heldRef.current).state);
      }),
    [midi],
  );

  // Reaching a step: the app plays its hand; a step with nothing for the player moves on by itself.
  const index = run?.index;
  useEffect(() => {
    const r = runRef.current;
    if (!r || r.done) return;
    const ms = beatMs(song.bpm, speedRef.current / 100);
    for (const n of autoNotes(r)) midi.play(n.pitch, AUTO_VELOCITY, Math.round(n.dur * ms * 0.95));
    if (expectedNotes(r).length) return;
    const next = advance(r);
    const gap = (r.steps[r.index + 1]?.start ?? Math.max(...r.steps[r.index].notes.map((n) => n.start + n.dur))) - r.steps[r.index].start;
    const t = setTimeout(() => applyRef.current(next), gap * ms);
    return () => clearTimeout(t);
  }, [index, run?.hands, midi, song.bpm]);

  // Keep the notes of the current step in view on a phone.
  const lay = keyLayout(low, high);
  const viewIndex = view.index;
  useEffect(() => {
    const el = scroller.current;
    const step = view.steps[viewIndex];
    if (!el || !step || !el.scrollWidth) return;
    const lay = keyLayout(low, high);
    const xs = step.notes.map((n) => lay.x(n.pitch) + lay.w(n.pitch) / 2);
    const mid = ((Math.min(...xs) + Math.max(...xs)) / 2 / lay.width) * el.scrollWidth;
    el.scrollLeft = Math.max(0, mid - el.clientWidth / 2);
  }, [view.steps, viewIndex, low, high]);

  const start = () => {
    setNext(null);
    setPlay(null);
    if (mode === "play") {
      setSummary(null);
      startPlay(hands, tempo, clicks);
      return;
    }
    started.current = { wall: Date.now(), perf: performance.now() };
    const s = startWait(song, hands);
    runRef.current = s;
    setSummary(null);
    setRun(s);
  };
  const reset = () => {
    runRef.current = null; // changing hands or mode restarts: back to the ready state
    setRun(null);
    stopPlay();
    setSummary(null);
    setPlay(null);
    setNext(null);
  };
  const pickHands = (h: HandChoice) => {
    setHands(h);
    reset();
  };
  const pickMode = (m: SongMode) => {
    setMode(m);
    reset();
  };
  const tryNext = () => {
    const s = HANDS_LADDER[Math.min(progress?.step ?? 0, LAST_STEP)];
    setHands(s.hands);
    setMode(s.mode);
    reset();
  };

  const step = view.steps[view.index];
  const lit = new Set<number>();
  const tint: Record<number, string> = {};
  const fingers: Record<number, number> = {};
  for (const n of step?.notes ?? []) {
    lit.add(n.pitch);
    tint[n.pitch] = HAND_KEY[n.hand];
    fingers[n.pitch] = n.finger;
  }
  const playing = run !== null;
  const counting = live !== null && live.at < 0;
  const onStep = stepIndex(hands, mode);
  const nextStep = HANDS_LADDER[Math.min(progress?.step ?? 0, LAST_STEP)];

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-8 sm:px-6">
      <div>
        <Link href={back?.href ?? "/piano/songs"} className="text-sm text-white/60 hover:text-white">
          ← {back?.label ?? "Songs"}
        </Link>
        <h1 className="text-2xl font-bold">{song.title}</h1>
        <p className="text-sm text-white/60">
          {song.imported ? "Imported" : `Level ${song.level} · ${song.key}`} · {song.bpm} BPM · {song.beatsPerBar} beats a bar
          {song.notes.some((n) => n.suggested) && <i data-testid="suggested"> · fingering suggested</i>}
        </p>
      </div>

      <KeyboardStatus />

      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Hands" className="flex overflow-hidden rounded-lg border border-white/15 text-sm">
          {HANDS.map((h) => (
            <button
              key={h.id}
              aria-pressed={hands === h.id}
              disabled={bothLocked && h.id === "both"}
              title={bothLocked && h.id === "both" ? `Opens after a one-hand play-along run with ${BOTH_UNLOCK_PCT}% on time` : undefined}
              onClick={() => pickHands(h.id)}
              className={`px-3 py-1.5 disabled:opacity-40 ${hands === h.id ? "bg-white/20 font-semibold" : "text-white/70 hover:bg-white/10"}`}
            >
              {h.label}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Mode" className="flex overflow-hidden rounded-lg border border-white/15 text-sm">
          {MODES.map((m) => (
            <button
              key={m.id}
              aria-pressed={mode === m.id}
              onClick={() => pickMode(m.id)}
              className={`px-3 py-1.5 ${mode === m.id ? "bg-white/20 font-semibold" : "text-white/70 hover:bg-white/10"}`}
            >
              {m.label}
            </button>
          ))}
        </div>
        {mode === "wait" ? (
          <label className="flex items-center gap-2 text-sm text-white/70">
            Speed
            <input type="range" min={25} max={100} step={5} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Speed" />
            <span data-testid="speed" className="w-10 tabular-nums">
              {speed}%
            </span>
          </label>
        ) : (
          <label className="flex items-center gap-2 text-sm text-white/70">
            <input type="checkbox" checked={clicks} onChange={(e) => setClicks(e.target.checked)} />
            Click during the song
          </label>
        )}
      </div>
      {scale && (
        <p data-testid="scale-note" className="text-sm text-white/70">
          {bothLocked ? `Both hands open after a one-hand play-along run with at least ${BOTH_UNLOCK_PCT}% of the notes on time.` : "Both hands are open."}
          {" "}Notes marked &ldquo;thumb under&rdquo; or &ldquo;finger over&rdquo; are where the hand crosses.
        </p>
      )}
      {!scale && (
        <ol aria-label="Hands ladder" className="flex flex-wrap gap-2 text-xs">
        {HANDS_LADDER.map((s, i) => {
          const cur = !progress?.mastered && (progress?.step ?? 0) === i;
          const done = progress?.mastered || (progress?.step ?? 0) > i;
          return (
            <li
              key={s.label}
              data-current={cur}
              data-done={!!done}
              className={`rounded-full border px-2.5 py-1 ${cur ? "border-gold bg-gold/20 font-semibold text-white" : done ? "border-emerald-400/40 text-emerald-300" : "border-white/15 text-white/60"}`}
            >
              {done ? "✓ " : `${i + 1}. `}
              {s.label}
            </li>
          );
        })}
      </ol>
      )}
      {mode === "play" && (
        <p className="text-sm text-white/70">
          Tempo ladder: <span data-testid="next-tempo">Next run: {tempo} BPM</span> (song tempo {song.bpm}
          {progress?.best ? `, best ${progress.best}% on time` : ""})
        </p>
      )}
      <p className="flex gap-3 text-xs text-white/60">
        <span>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-amber-400" />
          Right hand
        </span>
        <span>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-sky-500" />
          Left hand
        </span>
        <span className="text-white/40">Each note shows its letter and finger.</span>
      </p>

      <div ref={scroller} className="overflow-x-auto rounded-xl border border-white/10 bg-black/30 p-2">
        <div style={{ minWidth: lay.whites * 28 }}>
          <FallingNotes steps={view.steps} index={view.index} hands={hands} low={low} high={high} at={live?.at} marks={live?.marks} />
          <PianoKeyboard
            bare
            low={low}
            high={high}
            pressed={held}
            lit={lit}
            tint={tint}
            fingers={fingers}
            onPress={(n) => midi.noteOn(n)}
            onRelease={(n) => midi.noteOff(n)}
          />
        </div>
      </div>

      {live ? (
        <div className="flex items-center justify-between gap-3 text-sm">
          <span data-testid="progress" role="status">
            {counting ? "Count-in… listen" : `Bar ${Math.floor(live.at / song.beatsPerBar) + 1}`}
          </span>
          <span className="flex gap-2 text-xs text-white/60">
            {(["on", "early", "late", "missed"] as const).map((g) => (
              <span key={g}>
                <span className={`mr-1 inline-block h-2 w-2 rounded-sm ${GRADE_BAR[g].replace("fill-", "bg-")}`} />
                {g === "on" ? "on time" : g}
              </span>
            ))}
          </span>
          <button onClick={stopPlay} className="rounded-lg border border-white/15 px-3 py-1 text-white/80 hover:bg-white/10">
            Stop
          </button>
        </div>
      ) : playing ? (
        <div className="flex items-center justify-between gap-3 text-sm">
          <span data-testid="progress">
            Step {Math.min(view.index + 1, view.steps.length)} of {view.steps.length}
          </span>
          <span data-testid="misses">Misses {view.misses}</span>
          <button onClick={() => finish(view, true)} className="rounded-lg border border-white/15 px-3 py-1 text-white/80 hover:bg-white/10">
            Stop
          </button>
        </div>
      ) : (
        <button onClick={start} className="rounded-xl bg-gold px-5 py-2 font-semibold text-black">
          {summary || play ? "Play again" : "Start"}
        </button>
      )}
      <p className="text-xs text-white/40">
        {hands === "both" ? "Hold the lit keys of both hands together." : `Play the ${hands === "R" ? "right" : "left"} hand; the app plays the other.`} {mode === "wait" ? "The song waits for you." : "The song keeps going: a bar of clicks, then play along; the app plays the other hand."}
      </p>
      {onStep < 0 && <p className="text-xs text-white/40">This hands and mode combination isn&apos;t a ladder step; it still counts as practice.</p>}

      {summary && (
        <section aria-label="Song summary" className="rounded-2xl border border-white/10 bg-panel/60 p-4">
          <h2 className="font-semibold">{summary.early ? "Stopped" : "Song finished"}</h2>
          <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
            <div>
              <dt className="text-white/60">Misses</dt>
              <dd data-testid="summary-misses" className="text-lg font-bold">
                {summary.misses}
              </dd>
            </div>
            <div>
              <dt className="text-white/60">Time</dt>
              <dd data-testid="summary-time" className="text-lg font-bold">
                {mmss(summary.durationMs)}
              </dd>
            </div>
            <div>
              <dt className="text-white/60">Steps</dt>
              <dd data-testid="summary-steps" className="text-lg font-bold">
                {summary.played}/{summary.total}
              </dd>
            </div>
          </dl>
        </section>
      )}
      {play && <PlayAlongSummary done={play} song={song} scale={scale} />}
      {next && (next.stepDone || next.tempo !== null) && (
        <section aria-label="Ladders" className="space-y-2 rounded-2xl border border-white/10 bg-panel/60 p-4 text-sm">
          {next.tempo !== null && (
            <p data-testid="ladder-tempo">
              Next run: {next.tempo} BPM
              {next.tempo > (play?.bpm ?? 0) ? " (up 5 BPM)" : ""}
            </p>
          )}
          {next.mastered ? (
            <p className="font-semibold text-emerald-300">Song mastered: both hands at full tempo.</p>
          ) : (
            next.stepDone && (
              <p className="flex flex-wrap items-center gap-3">
                <span>
                  Step done. Next: {nextStep.label.toLowerCase()}.
                </span>
                <button onClick={tryNext} className="rounded-lg bg-gold px-3 py-1 font-semibold text-black">
                  Try next step
                </button>
              </p>
            )
          )}
        </section>
      )}
    </div>
  );
}

function PlayAlongSummary({ done, song, scale }: { done: PlayDone; song: Song; scale: boolean }) {
  const sm = done.summary;
  const spread = offsetStats(done.scores.map((s) => s.offsetMs)); // evenness: the spread (standard deviation) of the offsets
  const ms = (x: number) => `${x < 0 ? "-" : "+"}${Math.round(Math.abs(x))} ms`;
  return (
    <section aria-label="Play-along summary" className="rounded-2xl border border-white/10 bg-panel/60 p-4">
      <h2 className="font-semibold">
        Run done at {done.bpm} BPM
        {song.bpm !== done.bpm ? ` (song tempo ${song.bpm})` : ""}
      </h2>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-white/60">On time</dt>
          <dd data-testid="pa-ontime" className="text-lg font-bold">
            {Math.round(sm.onTimePct * 100)}%
          </dd>
        </div>
        <div>
          <dt className="text-white/60">Early / late</dt>
          <dd data-testid="pa-earlylate" className="text-lg font-bold">
            {sm.early} / {sm.late}
          </dd>
        </div>
        <div>
          <dt className="text-white/60">Missed</dt>
          <dd data-testid="pa-missed" className="text-lg font-bold">
            {sm.missed}
          </dd>
        </div>
        <div>
          <dt className="text-white/60">Average offset</dt>
          <dd data-testid="pa-offset" className="text-lg font-bold">
            {sm.total - sm.missed ? ms(sm.meanOffsetMs) : "-"}
          </dd>
        </div>
      </dl>
      {scale && (
        <p data-testid="pa-evenness" className="mt-2 text-sm">
          Evenness: {spread.n ? `±${Math.round(spread.spread)} ms` : "-"} <span className="text-white/60">(the smaller, the more even the notes)</span>
        </p>
      )}
      <p data-testid="pa-bars" className="mt-2 text-sm text-white/70">
        {sm.rush || sm.drag
          ? `You ${[sm.rush && `rush in bar ${sm.rush.bar} (${ms(sm.rush.mean)})`, sm.drag && `drag in bar ${sm.drag.bar} (${ms(sm.drag.mean)})`].filter(Boolean).join(" and ")}.`
          : `No bar was more than ${RUSH_DRAG_MS} ms early or late on average.`}
        {sm.extra ? ` ${sm.extra} extra ${sm.extra === 1 ? "key" : "keys"} pressed.` : ""}
      </p>
    </section>
  );
}
