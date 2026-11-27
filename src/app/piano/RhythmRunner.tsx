"use client";

import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { drillSettings, loadSettings, newSessionId, recentSessions, saveDrillSettings, saveSession } from "@/lib/pianoData";
import { DrillRecord, ROUND_MS, statsFrom } from "@/lib/pianoDrill";
import {
  BEATS_PER_BAR,
  DEFAULT_BPM,
  GROUP_NAMES,
  REPS,
  RHYTHM_ID,
  RhythmPattern,
  RhythmRound,
  RhythmSummary,
  RunResult,
  WINDOW_STEPS,
  barMs,
} from "@/lib/pianoRhythm";
import { Beat, MAX_BPM, MIN_BPM, Scheduler, clampBpm, createScheduler } from "@/lib/pianoTiming";
import { loadLatencyMs } from "@/lib/pianoTimingSettings";
import { KeyboardStatus } from "./KeyboardStatus";
import { Results } from "./Results";
import { usePiano } from "./PianoProvider";
import { Stage } from "./Stage";

const RANGE = { low: 48, high: 84 };
const SETTLE_MS = 300; // after the last bar, wait this long for late hits before scoring
const mmss = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const lengthText = (ms: number) => (ms % 60_000 === 0 ? `${ms / 60_000}-minute` : mmss(ms));
type Attempt = { startMs: number; bpm: number }; // startMs: the first beat after the count-in
const COUNT_BEATS = BEATS_PER_BAR;
const PLAY_BEATS = BEATS_PER_BAR * REPS;
const SLOT_LABELS = ["1", "&", "2", "&", "3", "&", "4", "&"];

export type RhythmRunnerProps = {
  lengthMs?: number; // round length (default 2 minutes)
  onFinish?: (summary: RhythmSummary, record: DrillRecord | null) => void; // after the round is saved
  top?: ReactNode; // extra top-bar content (a session's progress)
  autoStart?: boolean; // start the round on mount, skipping the start screen (a session step)
  backHref?: string;
  backLabel?: string;
  showResults?: boolean; // default true; false = no results view after the round (a session shows one at the end)
};

// The rhythm drill on the stage. The keyboard stays docked: the drill accepts any key, so the on-screen keys
// are a tap target on a phone. Tempo, the window and the unlock groups live in the settings sheet.
export function RhythmRunner({ lengthMs = ROUND_MS, onFinish, top, autoStart, backHref = "/piano", backLabel = "All drills", showResults = true }: RhythmRunnerProps) {
  const { midi } = usePiano();
  const [round, setRound] = useState<RhythmRound | null>(null);
  const [summary, setSummary] = useState<RhythmSummary | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [active, setActive] = useState<Beat | null>(null);
  const [bpm, setBpmState] = useState(DEFAULT_BPM);
  const [now, setNow] = useState(0);
  const [held, setHeld] = useState<ReadonlySet<number>>(new Set());
  const [open, setOpen] = useState(1);
  const [step, setStep] = useState(0);
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  const sched = useRef<Scheduler | null>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const hits = useRef<number[]>([]);
  const current = useRef<Attempt | null>(null); // the attempt being played; cleared the moment it is scored (state lags a render)

  const refresh = useCallback(() => {
    const s = drillSettings(loadSettings(), RHYTHM_ID);
    setOpen(s.unlocked);
    setStep(Math.min(s.slowStep, WINDOW_STEPS.length - 1));
  }, []);
  useEffect(refresh, [refresh]);

  const silence = useCallback(() => {
    sched.current?.stop();
    timers.current.forEach(clearTimeout);
    timers.current.clear();
    setActive(null);
  }, []);

  useEffect(() => {
    const pending = timers.current;
    sched.current = createScheduler({
      onBeat(beat) {
        if (beat.index >= COUNT_BEATS + PLAY_BEATS) return; // the attempt is over; the scorer stops us
        midi.click(beat.accent, beat.time);
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

  const begin = useCallback((tempo: number) => {
    const t0 = performance.now() + 60;
    hits.current = [];
    setResult(null);
    current.current = { startMs: t0 + COUNT_BEATS * (60000 / tempo), bpm: tempo };
    setAttempt(current.current);
    sched.current?.start({ bpm: tempo, beatsPerBar: BEATS_PER_BAR, countInBars: 1, at: t0 });
  }, []);

  const finish = useCallback(
    (r: RhythmRound) => {
      if (r.closed) return; // timer ticks can outrun the re-render that stops them
      current.current = null;
      silence();
      const { record, summary: sum } = r.finish(newSessionId(), performance.now());
      if (record) saveSession(record);
      saveDrillSettings(RHYTHM_ID, r.settings, Date.now());
      setSummary(sum);
      setRound(null);
      setAttempt(null);
      setResult(null);
      refresh();
      onFinishRef.current?.(sum, record);
    },
    [silence, refresh],
  );

  const start = () => {
    const history = statsFrom(recentSessions(Date.now()), RHYTHM_ID);
    setSummary(null);
    setNow(performance.now());
    setRound(new RhythmRound({ settings: drillSettings(loadSettings(), RHYTHM_ID), history, now: () => performance.now(), wall: () => Date.now(), rng: Math.random, durationMs: lengthMs }));
    begin(bpm);
  };

  // A session step starts straight away: the learner already tapped Start practice. Once per mount. No
  // "started" ref guard: StrictMode remounts effects in dev, and the scheduler effect's cleanup stops the
  // first start, so the remount must start again (on a fresh scheduler) or the count-in is silent.
  const startRef = useRef(start);
  startRef.current = start;
  useEffect(() => {
    if (autoStart) startRef.current();
  }, [autoStart]);

  const again = () => {
    if (!round) return;
    round.next();
    begin(bpm);
  };

  const setBpm = (v: number) => {
    const next = clampBpm(v);
    setBpmState(next);
  };

  useEffect(
    () =>
      midi.onNote((e) => {
        setHeld((prev) => {
          const next = new Set(prev);
          if (e.type === "on") next.add(e.note);
          else next.delete(e.note);
          return next;
        });
        const a = current.current;
        if (e.type === "on" && a && e.time >= a.startMs - 250) hits.current.push(e.time);
      }),
    [midi],
  );

  useEffect(() => {
    if (!round) return;
    const id = setInterval(() => {
      const t = performance.now();
      if (round.over(t)) return finish(round);
      setNow(t);
      const a = current.current;
      if (a && t >= a.startMs + REPS * barMs(a.bpm) + SETTLE_MS) {
        current.current = null;
        silence();
        const latency = loadLatencyMs();
        const { result: res, changed } = round.score(a.startMs, a.bpm, hits.current, latency);
        if (changed) saveDrillSettings(RHYTHM_ID, round.settings, Date.now());
        setAttempt(null);
        setResult(res);
      }
    }, 50);
    return () => clearInterval(id);
  }, [round, finish, silence]);

  const counting = attempt !== null && now < attempt.startMs;
  const pattern = round?.current;

  const bar = (
    <>
      <h1 className={`truncate font-pnd text-lg font-semibold ${top ? "hidden sm:block" : ""}`}>Rhythm drill</h1>
      <span data-testid="level" className="hidden shrink-0 text-xs text-pn-ivory/60 sm:inline">
        Level {round ? round.settings.unlocked : open} of {GROUP_NAMES.length}
      </span>
      <span className="shrink-0 text-xs text-pn-ivory/70">
        <span data-testid="bpm" className="font-bold tabular-nums text-pn-brass">
          {bpm}
        </span>{" "}
        BPM
      </span>
      {round && (
        <>
          <span data-testid="window" className="hidden shrink-0 text-xs text-pn-ivory/60 sm:inline">
            ±{round.windowMs} ms
          </span>
          <span aria-label="Time left" className="ml-auto font-pnd text-xl tabular-nums">
            {mmss(round.timeLeft(now))}
          </span>
          <button onClick={() => finish(round)} className="shrink-0 rounded-full border border-pn-ivory/20 px-3 py-1 text-pn-ivory/80 hover:bg-pn-ivory/10">
            End round
          </button>
        </>
      )}
      {top}
    </>
  );

  const sheet = (
    <>
      <KeyboardStatus />
      <Tempo bpm={bpm} onChange={setBpm} />
      <p className="text-sm text-pn-ivory/70">On-time window: ±{WINDOW_STEPS[step]} ms</p>
      <ul aria-label="Unlock groups" className="space-y-1 text-sm">
        {GROUP_NAMES.map((g, i) => (
          <li key={g} className={`flex items-baseline gap-3 ${i < open ? "text-pn-ivory" : "text-pn-ivory/40"}`}>
            <span className="sr-only">
              {i < open ? "Open" : "Locked"}: {g}
            </span>
            <span aria-hidden className={`w-14 shrink-0 text-xs ${i < open ? "text-pn-brass" : ""}`}>
              {i < open ? "Open" : "Locked"}
            </span>
            <span aria-hidden className="font-pnd text-lg tracking-wide">
              {g}
            </span>
          </li>
        ))}
      </ul>
    </>
  );

  return (
    <Stage top={bar} sheet={sheet} range={RANGE} backHref={backHref} backLabel={backLabel} pressed={held} onPress={(n) => midi.noteOn(n)} onRelease={(n) => midi.noteOff(n)}>
      {round && pattern ? (
        <div className="w-full max-w-3xl space-y-3 text-center">
          <p data-testid="pattern-name" className="font-pnd text-2xl font-semibold text-pn-ivory/90">
            {pattern.name}
          </p>
          <Grid pattern={pattern} beat={attempt ? active : null} />
          <p role="status" data-testid="prompt" className="h-6 text-sm text-pn-ivory/70">
            {attempt ? (counting ? "Count-in… listen" : `Play it ${REPS} times`) : ""}
          </p>
          {result && <Result result={result} onNext={again} />}
        </div>
      ) : summary && showResults ? (
        <Results
          title="Round done"
          cards={[{ kind: "rhythm", tag: "Rhythm drill", summary }]}
          primary={{ label: "Done", href: backHref }}
          secondary={{ label: "Another round", onClick: start }}
        />
      ) : (
        <div className="w-full max-w-xl space-y-3 rounded-lg border border-pn-line bg-pn-felt p-4">
          <KeyboardStatus />
          <p className="text-sm text-pn-ivory/70">
            A one-bar rhythm appears as boxes. After a one-bar count-in, play it twice on any key, in time with the click. Each note is marked early, on time or late.
          </p>
          <button onClick={start} className="rounded-full bg-pn-brass px-6 py-2.5 font-semibold text-pn-ebony hover:brightness-110">
            Start {lengthText(lengthMs)} round
          </button>
        </div>
      )}
    </Stage>
  );
}

function Tempo({ bpm, onChange }: { bpm: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-center gap-3">
      <button type="button" aria-label="Slower" onClick={() => onChange(bpm - 5)} className="h-9 w-9 rounded-full border border-pn-ivory/20 hover:bg-pn-ivory/10">
        −
      </button>
      <span className="text-sm text-pn-ivory/70">
        <span className="text-xl font-bold tabular-nums text-pn-brass">{bpm}</span>{" "}
        BPM
      </span>
      <button type="button" aria-label="Faster" onClick={() => onChange(bpm + 5)} className="h-9 w-9 rounded-full border border-pn-ivory/20 hover:bg-pn-ivory/10">
        +
      </button>
      <input type="range" aria-label="Tempo" min={MIN_BPM} max={MAX_BPM} value={bpm} onChange={(e) => onChange(Number(e.target.value))} className="w-32 accent-[#d4a64a]" />
    </div>
  );
}

// The bar as eighth-note boxes: a note starts (gold), rings on (pale), or silence (dashed "rest").
function Grid({ pattern, beat }: { pattern: RhythmPattern; beat: Beat | null }) {
  return (
    <ol data-testid="grid" aria-label="Pattern" className="grid grid-cols-8 gap-1">
      {[...pattern.slots].map((c, i) => {
        const now = beat !== null && beat.beatInBar === i >> 1;
        return (
          <li key={i} data-kind={c === "x" ? "note" : c === "-" ? "hold" : "rest"} className="space-y-1 text-xs text-pn-ivory/50">
            <div
              className={`flex h-14 items-center justify-center rounded-md border text-sm font-semibold ${
                c === "x" ? "border-pn-brass bg-pn-brass text-pn-ebony" : c === "-" ? "border-pn-brass/40 bg-pn-brass/25" : "border-dashed border-pn-ivory/20 text-pn-ivory/40"
              } ${now ? "ring-2 ring-white" : ""}`}
            >
              {c === "." ? "rest" : ""}
            </div>
            <span>{SLOT_LABELS[i]}</span>
          </li>
        );
      })}
    </ol>
  );
}

const GRADE_STYLE = { on: "bg-emerald-500/25 text-emerald-200", early: "bg-sky-500/25 text-sky-200", late: "bg-amber-500/25 text-amber-200", missed: "bg-rose-500/25 text-rose-200" };
const gradeText = (g: RunResult["scores"][number]) =>
  g.grade === "missed" ? "Missed" : `${g.grade === "on" ? "On time" : g.grade === "early" ? "Early" : "Late"} ${g.offsetMs! > 0 ? "+" : ""}${Math.round(g.offsetMs!)} ms`;

function Result({ result, onNext }: { result: RunResult; onNext: () => void }) {
  const per = result.scores.length / REPS;
  return (
    <div className="space-y-2" data-testid="result">
      <p className="font-pnd text-2xl font-semibold tabular-nums">
        On time: <span data-testid="ontime">{Math.round(result.rate * 100)}%</span>
        <span className="ml-2 text-sm font-normal text-pn-ivory/50">
          ({result.onTime} of {result.expected.length}, ±{result.windowMs} ms)
        </span>
      </p>
      {Array.from({ length: REPS }, (_, r) => (
        <ul key={r} aria-label={`Bar ${r + 1}`} className="flex flex-wrap justify-center gap-1 text-xs">
          {result.scores.slice(r * per, (r + 1) * per).map((s, i) => (
            <li key={i} data-testid="marker" data-grade={s.grade} className={`rounded-md px-2 py-1 ${GRADE_STYLE[s.grade]}`}>
              {gradeText(s)}
            </li>
          ))}
        </ul>
      ))}
      {result.extra.length > 0 && (
        <p className="text-xs text-rose-300">
          {result.extra.length} extra {result.extra.length === 1 ? "note" : "notes"} played.
        </p>
      )}
      <button onClick={onNext} className="rounded-full bg-pn-brass px-6 py-2.5 font-semibold text-pn-ebony hover:brightness-110">
        Next pattern
      </button>
    </div>
  );
}
