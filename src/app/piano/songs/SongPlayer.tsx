"use client";

import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { loadSongProgress, newSessionId, saveSession, saveSongProgress, usePianoSync } from "@/lib/pianoData";
import { HANDS_LADDER, LAST_STEP, RunOutcome, RunResult, SongMode, SongProgress, applyRun, ladderTempo, stepIndex } from "@/lib/pianoSongLadder";
import { RUSH_DRAG_MS } from "@/lib/pianoSongPlay";
import { BOTH_UNLOCK_PCT, bothUnlocked } from "@/lib/pianoScales";
import { HandChoice, Song, beatMs, chordAt, chordLabel, handOf, songBeats } from "@/lib/pianoSongs";
import { BarRange, LoopLadder, barCount, clampRange, loadLoop, loopAfterPlay, loopAfterWait, rangeText, saveLoop, sliceSong } from "@/lib/pianoLoop";
import { RecNote, Recorder, finishRecorder, loadRecording, recordEvent, saveRecording, startRecorder } from "@/lib/pianoRecording";
import { TouchSample, TouchStats, touchStats } from "@/lib/pianoTouch";
import { offsetStats } from "@/lib/pianoTiming";
import { WaitState, advance, autoNotes, expectedNotes, press, startWait, stepsPlayed } from "@/lib/pianoSongWait";
import { KeyboardStatus } from "../KeyboardStatus";
import { Results, TouchBlock, songTag } from "../Results";
import { usePiano } from "../PianoProvider";
import { Stage } from "../Stage";
import { FallingNotes, GRADE_BAR, HAND_KEY } from "./FallingNotes";
import { PlayDone, usePlayAlong } from "./usePlayAlong";

export const SONGS_DRILL = "songs"; // the drill id of a song (or coordination exercise) run in the practice log; items are keyed by song id
export const SCALES_DRILL = "scales"; // the same for a scale run; items are keyed by the scale's id
const AUTO_VELOCITY = 80;
const LOOP_PAUSE_MS = 1500; // between two runs of a bar loop
const mmss = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
export type Summary = { misses: number; durationMs: number; played: number; total: number; early: boolean };
export type Next = { stepDone: boolean; mastered: boolean; step: number; tempo: number | null }; // what the ladders say after a run
const MODES: { id: SongMode; label: string }[] = [
  { id: "wait", label: "Wait" },
  { id: "play", label: "Play-along" },
];
const HAND_LABEL: Record<HandChoice, string> = { R: "Right hand", L: "Left hand", both: "Both hands" };
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
// BOTH_UNLOCK_PCT on time, shows the evenness of the timing after a play-along run and of the touch (velocity per
// finger, keyboard notes only) after any run, and logs runs as "scales".
//
// Bar loop (the settings sheet, or "Practise bar N" under a play-along summary; not in a session step): the run is
// the song cut to those bars (pianoLoop.sliceSong) and starts again by itself LOOP_PAUSE_MS after each finished run
// until Stop. The loop has its own small ladder, kept per device: play-along +5 BPM after a run with >= 90% on time,
// wait mode +10% speed after a run with no wrong keys. Loop runs are saved as practice but never move the song's
// own ladders.
//
// Every run is recorded (pianoRecording; only the last run is kept, on this device) and "Hear your run" plays it back
// through the keyboard with the keys lit. Melody + chords songs show the chord sounding and the next one.
// What a run hands to `onFinish` (a session step), called once whenever a started run ends: `wait` or `play` holds the
// run's own summary (by mode), `early` says it was stopped with Stop, `bpm` is the pace it was played at (a wait run's
// song tempo times the speed slider), and `ladder` is what the ladders said afterwards. A stopped run gives `ladder:
// null` (it doesn't feed the ladders); a stopped play-along run is discarded, so it also has `play: null` and saves
// nothing; a stopped wait run with at least one step played is still saved as practice. Changing hands or mode in the
// sheet mid-run abandons the run without calling onFinish.
export type SongResult = { mode: SongMode; hands: HandChoice; bpm: number; early: boolean; wait: Summary | null; play: PlayDone | null; ladder: Next | null };

// Props for a session step (planner SongTarget = {song, hands, mode, tempo, minutes}): `hands`, `mode` and `tempo`
// (BPM of a play-along run) are the starting values and replace the saved ladder step; `autoStart` begins the run
// as soon as the saved progress is read; `onFinish` gets the result; `top` is an extra node in the stage's top bar;
// `showResults` (default true) false skips the results view after a run (a session shows one at the end). `stopRef`
// receives a function that stops the run in progress the way Stop does (calling onFinish) and says whether one was.
export type SongPlayerProps = {
  song: Song;
  scale?: boolean;
  back?: { href: string; label: string };
  hands?: HandChoice;
  mode?: SongMode;
  tempo?: number;
  autoStart?: boolean;
  onFinish?: (r: SongResult) => void;
  top?: ReactNode;
  showResults?: boolean;
  stopRef?: { current: (() => boolean) | null };
};

export function SongPlayer({ song, scale = false, back, hands: hands0, mode: mode0, tempo: tempo0, autoStart, onFinish, top, showResults = true, stopRef }: SongPlayerProps) {
  const drill = scale ? SCALES_DRILL : SONGS_DRILL;
  const { midi } = usePiano();
  const [hands, setHands] = useState<HandChoice>(hands0 ?? "R");
  const [mode, setMode] = useState<SongMode>(mode0 ?? "wait");
  const [speed, setSpeed] = useState(100);
  const [bpmOverride, setBpmOverride] = useState(tempo0); // a session's BPM for the first play-along run; the ladder takes over after it
  const [ready, setReady] = useState(false); // saved progress has been read
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
  const songTempo = bpmOverride ?? ladderTempo(song, progress);
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;
  const bothLocked = scale && !bothUnlocked(progress);
  const canLoop = !autoStart; // a session step plays the whole song
  const [loop, setLoop] = useState<BarRange | null>(null);
  const [ladder, setLadder] = useState<LoopLadder | null>(null);
  const [looping, setLooping] = useState(false); // a loop restarts by itself until Stop
  const [loopRuns, setLoopRuns] = useState(0);
  const loopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playSong = useMemo(() => (loop ? sliceSong(song, loop) : song), [song, loop]);
  const firstBar = loop?.from ?? 1;
  const [recording, setRecording] = useState<RecNote[] | null>(null);
  const recorder = useRef<Recorder | null>(null);
  const [replayHeld, setReplayHeld] = useState<ReadonlySet<number>>(new Set());
  const [replaying, setReplaying] = useState(false);
  const replayTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const touchSamples = useRef<TouchSample[]>([]);
  const [touch, setTouch] = useState<TouchStats | null>(null);
  // Scale mode: each key's finger, for the evenness of touch.
  const fingerOf = useMemo(() => {
    const m = new Map<number, number>();
    for (const n of handOf(playSong.notes, hands)) if (!m.has(n.pitch)) m.set(n.pitch, n.finger);
    return m;
  }, [playSong, hands]);

  // Saved progress: read on open (the hands and mode jump to the ladder's step) and again when another device syncs.
  const loaded = useRef(false);
  const reload = () => {
    const p = loadSongProgress(song.id);
    setProgress(p);
    if (!loaded.current) {
      loaded.current = true;
      setReady(true);
      setRecording(loadRecording(song.id)?.notes ?? null);
      if (p && !scale && !hands0 && !mode0) {
        setHands(HANDS_LADDER[p.step].hands);
        setMode(HANDS_LADDER[p.step].mode);
      }
    }
  };
  useEffect(reload, []); // eslint-disable-line react-hooks/exhaustive-deps
  usePianoSync(reload);

  // Feeds a finished run to the ladders; progress is only written when it changed.
  const record = (r: RunResult): Next => {
    const out: RunOutcome = applyRun(song, loadSongProgress(song.id), r, Date.now());
    if (out.changed) saveSongProgress(song.id, out.progress, Date.now());
    setProgress(out.progress);
    const n: Next = { stepDone: out.stepDone && !scale, mastered: out.mastered && out.stepDone, step: out.progress.step, tempo: out.nextTempo };
    setNext(n);
    return n;
  };

  // The run's recording and touch: kept when a run ends (finished or stopped).
  const endCapture = () => {
    const rec = recorder.current;
    recorder.current = null;
    if (rec) {
      const notes = finishRecorder(rec, performance.now());
      if (notes.length) {
        saveRecording({ songId: song.id, title: song.title, at: Date.now(), notes });
        setRecording(notes);
      }
    }
    setTouch(scale ? touchStats(touchSamples.current) : null);
  };
  const clearLoopTimer = () => {
    if (loopTimer.current) clearTimeout(loopTimer.current);
    loopTimer.current = null;
  };
  useEffect(() => clearLoopTimer, []);
  // After a finished loop run: the next one, unless the loop was stopped meanwhile.
  const again = () => {
    setLoopRuns((n) => n + 1);
    clearLoopTimer();
    loopTimer.current = setTimeout(() => {
      loopTimer.current = null;
      startRef.current();
    }, LOOP_PAUSE_MS);
  };

  const { live, start: startPlay, stop: stopPlay } = usePlayAlong(playSong, midi, (r) => {
    endCapture();
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
    if (loop && ladder) {
      const nl = loopAfterPlay(song, ladder, sm.onTimePct);
      saveLoop(song.id, loop, nl);
      setLadder(nl);
      setNext(null);
      return again();
    }
    const out = record({ mode: "play", hands: r.hands, onTime: sm.onTimePct, tempo: r.bpm });
    setBpmOverride(undefined);
    onFinishRef.current?.({ mode: "play", hands: r.hands, bpm: r.bpm, early: false, wait: null, play: r, ladder: out });
  });
  const stopRun = () => {
    const bpm = tempo;
    endCapture();
    stopPlay();
    setBpmOverride(undefined);
    onFinishRef.current?.({ mode: "play", hands, bpm, early: true, wait: null, play: null, ladder: null });
  };

  const view = useMemo(() => run ?? startWait(playSong, hands), [run, playSong, hands]);
  const songNotes = useMemo(() => song.notes.map((n) => n.pitch), [song]); // the keyboard shows just the song's range

  const finish = (s: WaitState, early: boolean) => {
    endCapture();
    const durationMs = Math.max(0, Math.round(performance.now() - started.current.perf));
    const bpm = Math.round((song.bpm * speedRef.current) / 100);
    runRef.current = null;
    setRun(null);
    const played = stepsPlayed(s);
    const sum: Summary = { misses: s.misses, durationMs, played, total: s.steps.length, early };
    setSummary(sum);
    if (!played) {
      onFinishRef.current?.({ mode: "wait", hands: s.hands, bpm, early, wait: sum, play: null, ladder: null });
      return;
    }
    const looped = loop && ladder && !early;
    const out = early || looped ? null : record({ mode: "wait", hands: s.hands, finished: true, misses: s.misses, steps: s.steps.length });
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
    if (looped) {
      const nl = loopAfterWait(ladder, s.misses);
      saveLoop(song.id, loop, nl);
      setLadder(nl);
      setSpeed(nl.speed);
      return again();
    }
    onFinishRef.current?.({ mode: "wait", hands: s.hands, bpm, early, wait: sum, play: null, ladder: out });
  };
  const apply = (next: WaitState) => {
    if (next === runRef.current) return;
    if (next.done) return finish(next, false);
    runRef.current = next;
    setRun(next);
  };
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const fingerOfRef = useRef(fingerOf);
  fingerOfRef.current = fingerOf;

  // Keys: the held set (for the on-screen keyboard and chords) and wait mode's one input.
  useEffect(
    () =>
      midi.onNote((e) => {
        if (e.type === "off") heldRef.current.delete(e.note);
        else heldRef.current.add(e.note);
        setHeld(new Set(heldRef.current));
        if (recorder.current) recordEvent(recorder.current, e);
        if (recorder.current && e.type === "on" && e.source === "keyboard") {
          const finger = fingerOfRef.current.get(e.note);
          if (finger) touchSamples.current.push({ finger, velocity: e.velocity });
        }
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

  const start = () => {
    stopReplay();
    setNext(null);
    setPlay(null);
    setTouch(null);
    touchSamples.current = [];
    recorder.current = startRecorder(performance.now());
    if (loop) setLooping(true);
    if (mode === "play") {
      setSummary(null);
      startPlay(hands, tempo, clicks);
      return;
    }
    const s = startWait(playSong, hands);
    if (s.done) {
      // nothing to play (a loop over empty bars): stay ready rather than start a run that can't end
      recorder.current = null;
      setLooping(false);
      return;
    }
    started.current = { wall: Date.now(), perf: performance.now() };
    runRef.current = s;
    setSummary(null);
    setRun(s);
  };
  const reset = () => {
    runRef.current = null; // changing hands or mode restarts: back to the ready state
    recorder.current = null;
    clearLoopTimer();
    setLooping(false);
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
  // Loop: pick a range (or none). The loop's own ladder is read for it; the speed slider follows it in wait mode.
  const pickLoop = (r: BarRange | null) => {
    const c = r && clampRange(song, r);
    setLoop(c);
    setLoopRuns(0);
    if (c) {
      const l = loadLoop(song, c);
      setLadder(l);
      setSpeed(l.speed);
    } else setLadder(null);
    reset();
  };
  const practiseBar = (bar: number) => pickLoop({ from: bar, to: bar });
  const stopLoop = () => {
    clearLoopTimer();
    setLooping(false);
  };

  // Replay of the last run: each note sounds (midi.play) and lights its key at its time; Stop cancels what is left.
  const stopReplay = () => {
    replayTimers.current.forEach(clearTimeout);
    replayTimers.current = [];
    setReplayHeld(new Set());
    setReplaying(false);
  };
  useEffect(() => stopReplay, []);
  const replay = () => {
    if (!recording) return;
    stopReplay();
    const lit = new Set<number>();
    const show = () => setReplayHeld(new Set(lit));
    const end = recording.reduce((m, n) => Math.max(m, n[0] + n[3]), 0);
    for (const [t, pitch, vel, dur] of recording) {
      replayTimers.current.push(
        setTimeout(() => {
          midi.play(pitch, vel, dur);
          lit.add(pitch);
          show();
        }, t),
        setTimeout(() => {
          lit.delete(pitch);
          show();
        }, t + dur),
      );
    }
    replayTimers.current.push(setTimeout(stopReplay, end + 50));
    setReplaying(true);
  };

  const tryNext = () => {
    const s = HANDS_LADDER[Math.min(progress?.step ?? 0, LAST_STEP)];
    setHands(s.hands);
    setMode(s.mode);
    reset();
  };

  // A session step starts straight away, once the saved progress is read (its tempo is the ladder's).
  const autoStarted = useRef(false);
  const startRef = useRef(start);
  startRef.current = start;
  useEffect(() => {
    if (!autoStart || !ready || autoStarted.current) return;
    autoStarted.current = true;
    startRef.current();
  }, [autoStart, ready]);

  const tempo = loop && ladder ? ladder.tempo : songTempo;
  const step = view.steps[view.index];
  // The step to keep on screen when the keyboard scrolls: the current one, or in play-along the next one to play.
  const followStep = live ? view.steps.find((s) => s.start + 0.5 > live.at) : step;
  const follow = followStep?.notes.map((n) => n.pitch);
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
  const active = live !== null || playing;
  const chord = playSong.chords ? chordAt(playSong.chords, live ? Math.max(0, live.at) : (step?.start ?? 0)) : null;
  if (stopRef)
    stopRef.current = () => {
      if (live) stopRun();
      else if (runRef.current) finish(runRef.current, true);
      else return false;
      return true;
    };
  const result = showResults && !active && (summary !== null || play !== null); // after a run its summary takes the falling notes' place

  // The post-run results card: built from what the run left behind (the same data `onFinish` was given).
  const cardResult: SongResult | null =
    result ? { mode: play ? "play" : "wait", hands, bpm: play?.bpm ?? Math.round((song.bpm * speed) / 100), early: summary?.early ?? false, wait: summary, play, ladder: next } : null;

  const counts = { on: 0, early: 0, late: 0, missed: 0 };
  live?.marks.forEach((g) => counts[g]++);
  const total = Math.max(1, songBeats(playSong));
  const fraction = live ? Math.min(1, Math.max(0, live.at / total)) : playing ? Math.min(1, view.index / Math.max(1, view.steps.length)) : 0;
  const bpmNow = mode === "play" ? tempo : Math.round((song.bpm * speed) / 100);
  const tools = "rounded-full border border-pn-ivory/20 px-3 py-1 text-sm text-pn-ivory/80 hover:bg-pn-ivory/10";
  const seg = (on: boolean) => `rounded-full px-3 py-1.5 disabled:opacity-40 ${on ? "bg-pn-ivory font-semibold text-pn-ebony" : "text-pn-ivory/70 hover:bg-pn-ivory/10"}`;
  const group = "flex flex-wrap overflow-hidden rounded-full border border-pn-line bg-pn-ebony/40 p-0.5 text-sm";
  const label = "mb-1.5 block text-xs uppercase tracking-wide text-pn-ivory/50";

  const topBar = (
    <>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
        <div className="flex min-w-0 items-baseline gap-x-3 whitespace-nowrap">
          <h1 className={`min-w-0 truncate font-pnd text-lg font-semibold leading-tight ${top ? "hidden sm:block" : ""}`}>{song.title}</h1>
          <span data-testid="song-meta" className="truncate text-xs text-pn-ivory/70">
            {HAND_LABEL[hands]} · {mode === "wait" ? "Wait" : "Play-along"} · {bpmNow} BPM
          </span>
          {loop && (
            <span data-testid="loop-tag" className="shrink-0 text-xs text-pn-brass">
              Loop {rangeText(loop)}
              {loopRuns ? ` · run ${loopRuns + (active ? 1 : 0)}` : ""}
            </span>
          )}
          {chord?.now && (
            <span data-testid="chord-now" className="shrink-0 text-xs text-pn-ivory/80">
              Chord <b className="font-pnd text-sm text-sky-300">{chordLabel(chord.now.name)}</b>
              {chord.next && ` → ${chordLabel(chord.next.name)}`}
            </span>
          )}
          {!loop && !scale && onStep >= 0 && (
            <span data-testid="ladder-step" className="hidden shrink-0 text-xs text-pn-brass sm:inline">
              Step {onStep + 1} of {HANDS_LADDER.length}
            </span>
          )}
          {live && (
            <span data-testid="counts" className="shrink-0 text-xs text-pn-ivory/70">
              <span className="text-emerald-300">{counts.on} on time</span> · <span className="text-violet-300">{counts.early} early</span> · <span className="text-orange-300">{counts.late} late</span>
            </span>
          )}
          {live ? (
            <span data-testid="progress" role="status" className="shrink-0 text-xs text-pn-ivory/70">
              {counting ? "Count-in… listen" : `Bar ${Math.floor(live.at / song.beatsPerBar) + firstBar}`}
            </span>
          ) : (
            playing && (
              <>
                <span data-testid="progress" className="shrink-0 text-xs text-pn-ivory/70">
                  Step {Math.min(view.index + 1, view.steps.length)} of {view.steps.length}
                </span>
                <span data-testid="misses" className="shrink-0 text-xs text-pn-ivory/70">
                  Misses {view.misses}
                </span>
              </>
            )
          )}
        </div>
        <div role="progressbar" aria-label="Song progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)} className="h-1 rounded-sm bg-pn-ebony">
          <div className="h-full rounded-sm bg-pn-brass" style={{ width: `${Math.round(fraction * 100)}%` }} />
        </div>
      </div>
      {top}
      {active && (
        <button
          onClick={() => {
            stopLoop();
            if (live) stopRun();
            else finish(view, true);
          }}
          className={tools}
        >
          Stop
        </button>
      )}
      {!active && looping && (
        <button onClick={stopLoop} className={tools}>
          Stop loop
        </button>
      )}
    </>
  );

  const sheet = (
    <>
      <p className="text-sm text-pn-ivory/60">
        {song.imported ? "Imported" : `Level ${song.level} · ${song.key}`} · {song.bpm} BPM · {song.beatsPerBar} beats a bar
        {song.notes.some((n) => n.suggested) && <i data-testid="suggested"> · fingering suggested</i>}
        {song.chords && <span data-testid="chord-song"> · melody + chords: the left hand holds each chord</span>}
      </p>
      <div>
        <span className={label}>Hands</span>
        <div role="group" aria-label="Hands" className={group}>
          {HANDS.map((h) => (
            <button
              key={h.id}
              aria-pressed={hands === h.id}
              disabled={bothLocked && h.id === "both"}
              title={bothLocked && h.id === "both" ? `Opens after a one-hand play-along run with ${BOTH_UNLOCK_PCT}% on time` : undefined}
              onClick={() => pickHands(h.id)}
              className={seg(hands === h.id)}
            >
              {h.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <span className={label}>Mode</span>
        <div role="group" aria-label="Mode" className={group}>
          {MODES.map((m) => (
            <button key={m.id} aria-pressed={mode === m.id} onClick={() => pickMode(m.id)} className={seg(mode === m.id)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
      {mode === "wait" ? (
        <label className="flex items-center gap-2 text-sm text-pn-ivory/70">
          Speed
          <input type="range" className="accent-[#d4a64a]" min={25} max={100} step={5} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Speed" />
          <span data-testid="speed" className="w-10 tabular-nums">
            {speed}%
          </span>
        </label>
      ) : (
        <label className="flex items-center gap-2 text-sm text-pn-ivory/70">
          <input type="checkbox" checked={clicks} onChange={(e) => setClicks(e.target.checked)} />
          Click during the song
        </label>
      )}
      {canLoop && <LoopPicker bars={barCount(song)} loop={loop} ladder={ladder} mode={mode} onPick={pickLoop} label={label} />}
      {scale && (
        <p data-testid="scale-note" className="text-sm text-pn-ivory/70">
          {bothLocked ? `Both hands open after a one-hand play-along run with at least ${BOTH_UNLOCK_PCT}% of the notes on time.` : "Both hands are open."} Notes marked &ldquo;thumb under&rdquo; or &ldquo;finger over&rdquo; are where the hand crosses.
        </p>
      )}
      {!scale && !loop && (
        <div>
          <span className={label}>Hands ladder</span>
          <ol aria-label="Hands ladder" className="m-0 flex list-none flex-wrap gap-2 p-0 text-xs">
            {HANDS_LADDER.map((s, i) => {
              const cur = !progress?.mastered && (progress?.step ?? 0) === i;
              const done = progress?.mastered || (progress?.step ?? 0) > i;
              return (
                <li
                  key={s.label}
                  data-current={cur}
                  data-done={!!done}
                  className={`rounded-full border px-2.5 py-1 ${cur ? "border-pn-brass bg-pn-brass font-semibold text-pn-ebony" : done ? "border-emerald-400/40 text-emerald-300" : "border-pn-line text-pn-ivory/60"}`}
                >
                  {done ? "✓ " : `${i + 1}. `}
                  {s.label}
                </li>
              );
            })}
          </ol>
        </div>
      )}
      {mode === "play" && !loop && (
        <p className="text-sm text-pn-ivory/70">
          Tempo ladder: <span data-testid="next-tempo">Next run: {tempo} BPM</span> (song tempo {song.bpm}
          {progress?.best ? `, best ${progress.best}% on time` : ""})
        </p>
      )}
      <div className="space-y-1 text-xs text-pn-ivory/60">
        <p className="flex flex-wrap gap-3">
          <span>
            <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-amber-400" />
            Right hand
          </span>
          <span>
            <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-sky-500" />
            Left hand
          </span>
        </p>
        <p className="flex flex-wrap gap-3">
          {(["on", "early", "late", "missed"] as const).map((g) => (
            <span key={g}>
              <span className={`mr-1 inline-block h-2 w-2 rounded-sm ${GRADE_BAR[g].replace("fill-", "bg-")}`} />
              {g === "on" ? "on time" : g}
            </span>
          ))}
        </p>
        <p className="text-pn-ivory/40">Each note shows its letter and finger.</p>
      </div>
    </>
  );

  return (
    <Stage
      top={topBar}
      sheet={sheet}
      notes={songNotes}
      follow={follow}
      above={result ? undefined : (r) => <FallingNotes steps={view.steps} index={view.index} hands={hands} low={r.low} high={r.high} at={live?.at} marks={live?.marks} />}
      backHref={back?.href ?? "/piano/songs"}
      backLabel={back?.label ?? "Songs"}
      pressed={replaying ? replayHeld : held}
      lit={replaying ? undefined : lit}
      tint={tint}
      fingers={fingers}
      onPress={(n) => midi.noteOn(n)}
      onRelease={(n) => midi.noteOff(n)}
    >
      {!active && (
        <div className={`w-full max-w-xl space-y-3 text-center ${result ? "py-2" : "max-h-[32vh] overflow-y-auto"}`}>
          <KeyboardStatus />
          <div className="flex flex-col items-center gap-1.5">
            <button onClick={start} className="rounded-full bg-pn-brass px-8 py-2.5 font-semibold text-pn-ebony hover:brightness-110">
              {summary || play ? "Play again" : "Start"}
            </button>
            <p data-testid="start-summary" className="text-xs text-pn-ivory/60">
              {HAND_LABEL[hands]} · {mode === "wait" ? `Wait, ${speed}% speed` : `Play-along, ${tempo} BPM${clicks ? ", click on" : ""}`}
              {loop && ` · loop ${rangeText(loop)}`}
            </p>
            {looping && <p className="text-xs text-pn-brass">Next run in a moment…</p>}
            {recording && (
              <button type="button" onClick={replaying ? stopReplay : replay} className="rounded-full border border-pn-ivory/30 px-4 py-1.5 text-sm text-pn-ivory hover:bg-pn-ivory/10">
                {replaying ? "Stop replay" : "Hear your run"}
              </button>
            )}
            <p className="text-xs text-pn-ivory/40 [@media(max-height:480px)]:hidden">
              {hands === "both" ? "Hold the lit keys of both hands together." : `Play the ${hands === "R" ? "right" : "left"} hand; the app plays the other.`} {mode === "wait" ? "The song waits for you." : "The song keeps going: a bar of clicks, then play along; the app plays the other hand."}
            </p>
            {onStep < 0 && <p className="text-xs text-pn-ivory/40 [@media(max-height:480px)]:hidden">This hands and mode combination isn&apos;t a ladder step; it still counts as practice.</p>}
          </div>

          {cardResult && <Results title="Results" cards={[{ kind: "song", tag: songTag(song.title, hands), result: cardResult }]} />}
          {result && summary && (
            <section aria-label="Song summary" className="rounded-lg border border-pn-line bg-pn-felt p-4 text-left">
              <h2 className="font-pnd text-xl font-semibold">{summary.early ? "Stopped" : "Song finished"}</h2>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
                <div>
                  <dt className="text-pn-ivory/60">Misses</dt>
                  <dd data-testid="summary-misses" className="font-pnd text-2xl font-semibold tabular-nums">
                    {summary.misses}
                  </dd>
                </div>
                <div>
                  <dt className="text-pn-ivory/60">Time</dt>
                  <dd data-testid="summary-time" className="font-pnd text-2xl font-semibold tabular-nums">
                    {mmss(summary.durationMs)}
                  </dd>
                </div>
                <div>
                  <dt className="text-pn-ivory/60">Steps</dt>
                  <dd data-testid="summary-steps" className="font-pnd text-2xl font-semibold tabular-nums">
                    {summary.played}/{summary.total}
                  </dd>
                </div>
              </dl>
            </section>
          )}
          {result && play && <PlayAlongSummary done={play} song={song} scale={scale} firstBar={firstBar} onPractise={canLoop ? practiseBar : undefined} />}
          {result && touch && (
            <section aria-label="Touch" className="rounded-lg border border-pn-line bg-pn-felt p-4 text-left">
              <TouchBlock t={touch} />
            </section>
          )}
          {/* The results card says the next tempo, "Step done" and "Mastered"; this row only offers the next step. */}
          {result && next?.stepDone && !next.mastered && (
            <section aria-label="Ladders" className="rounded-lg border border-pn-line bg-pn-felt p-4 text-left text-sm">
              <p className="flex flex-wrap items-center gap-3">
                <span>Step done. Next: {nextStep.label.toLowerCase()}.</span>
                <button onClick={tryNext} className="rounded-lg bg-pn-brass px-3 py-1 font-semibold text-pn-ebony">
                  Try next step
                </button>
              </p>
            </section>
          )}
        </div>
      )}
    </Stage>
  );
}

function PlayAlongSummary({ done, song, scale, firstBar, onPractise }: { done: PlayDone; song: Song; scale: boolean; firstBar: number; onPractise?: (bar: number) => void }) {
  const sm = done.summary;
  const bar = (b: number) => b + firstBar - 1; // bars of a loop are counted in the whole song
  const bars = [...new Set([sm.rush, sm.drag].flatMap((x) => (x ? [bar(x.bar)] : [])))];
  const spread = offsetStats(done.scores.map((s) => s.offsetMs)); // evenness: the spread (standard deviation) of the offsets
  const ms = (x: number) => `${x < 0 ? "-" : "+"}${Math.round(Math.abs(x))} ms`;
  return (
    <section aria-label="Play-along summary" className="rounded-lg border border-pn-line bg-pn-felt p-4">
      <h2 className="font-pnd text-xl font-semibold">
        Run done at {done.bpm} BPM
        {song.bpm !== done.bpm ? ` (song tempo ${song.bpm})` : ""}
      </h2>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-pn-ivory/60">On time</dt>
          <dd data-testid="pa-ontime" className="font-pnd text-2xl font-semibold tabular-nums">
            {Math.round(sm.onTimePct * 100)}%
          </dd>
        </div>
        <div>
          <dt className="text-pn-ivory/60">Early / late</dt>
          <dd data-testid="pa-earlylate" className="font-pnd text-2xl font-semibold tabular-nums">
            {sm.early} / {sm.late}
          </dd>
        </div>
        <div>
          <dt className="text-pn-ivory/60">Missed</dt>
          <dd data-testid="pa-missed" className="font-pnd text-2xl font-semibold tabular-nums">
            {sm.missed}
          </dd>
        </div>
        <div>
          <dt className="text-pn-ivory/60">Average offset</dt>
          <dd data-testid="pa-offset" className="font-pnd text-2xl font-semibold tabular-nums">
            {sm.total - sm.missed ? ms(sm.meanOffsetMs) : "-"}
          </dd>
        </div>
      </dl>
      {scale && (
        <p data-testid="pa-evenness" className="mt-2 text-sm">
          Evenness: {spread.n ? `±${Math.round(spread.spread)} ms` : "-"} <span className="text-pn-ivory/60">(the smaller, the more even the notes)</span>
        </p>
      )}
      <p data-testid="pa-bars" className="mt-2 text-sm text-pn-ivory/70">
        {sm.rush || sm.drag
          ? `You ${[sm.rush && `rush in bar ${bar(sm.rush.bar)} (${ms(sm.rush.mean)})`, sm.drag && `drag in bar ${bar(sm.drag.bar)} (${ms(sm.drag.mean)})`].filter(Boolean).join(" and ")}.`
          : `No bar was more than ${RUSH_DRAG_MS} ms early or late on average.`}
        {sm.extra ? ` ${sm.extra} extra ${sm.extra === 1 ? "key" : "keys"} pressed.` : ""}
      </p>
      {onPractise && bars.length > 0 && (
        <p className="mt-2 flex flex-wrap gap-2">
          {bars.map((b) => (
            <button key={b} type="button" onClick={() => onPractise(b)} className="rounded-full bg-pn-brass px-3 py-1 text-sm font-semibold text-pn-ebony hover:brightness-110">
              Practise bar {b}
            </button>
          ))}
        </p>
      )}
    </section>
  );
}

// The bar-loop picker in the settings sheet: off, or a range of bars, with the loop's own ladder.
function LoopPicker({ bars, loop, ladder, mode, onPick, label }: { bars: number; loop: BarRange | null; ladder: LoopLadder | null; mode: SongMode; onPick: (r: BarRange | null) => void; label: string }) {
  const opts = Array.from({ length: bars }, (_, i) => i + 1);
  const sel = "rounded-md border border-pn-line bg-pn-ebony px-2 py-1 text-sm text-pn-ivory";
  return (
    <div>
      <span className={label}>Loop bars</span>
      <div className="flex flex-wrap items-center gap-2 text-sm text-pn-ivory/80">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!!loop} onChange={(e) => onPick(e.target.checked ? { from: 1, to: Math.min(bars, 2) } : null)} />
          Loop
        </label>
        {loop && (
          <>
            <label className="flex items-center gap-1">
              From
              <select aria-label="From bar" value={loop.from} onChange={(e) => onPick({ from: Number(e.target.value), to: Math.max(Number(e.target.value), loop.to) })} className={sel}>
                {opts.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1">
              to
              <select aria-label="To bar" value={loop.to} onChange={(e) => onPick({ from: Math.min(loop.from, Number(e.target.value)), to: Number(e.target.value) })} className={sel}>
                {opts.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
            <span className="text-xs text-pn-ivory/50">of {bars}</span>
          </>
        )}
      </div>
      {loop && ladder && (
        <p data-testid="loop-ladder" className="mt-1 text-xs text-pn-ivory/60">
          {mode === "play" ? `Loop tempo ${ladder.tempo} BPM: +5 after a run with 90% on time.` : `Loop speed ${ladder.speed}%: +10% after a run with no wrong keys.`} It repeats until Stop and doesn&apos;t move the song&apos;s ladders.
        </p>
      )}
    </div>
  );
}
