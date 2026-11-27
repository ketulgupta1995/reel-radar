"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { PianoKeyboard } from "@/components/PianoKeyboard";
import { drillSettings, loadSettings, newSessionId, recentSessions, saveDrillSettings, saveSession } from "@/lib/pianoData";
import { statsFrom } from "@/lib/pianoDrill";
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
import { useWakeLock } from "@/lib/useWakeLock";
import { KeyboardStatus } from "../KeyboardStatus";
import { usePiano } from "../PianoProvider";

const RANGE = { low: 48, high: 84 };
const SETTLE_MS = 300; // after the last bar, wait this long for late hits before scoring
const mmss = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
type Attempt = { startMs: number; bpm: number }; // startMs: the first beat after the count-in
const COUNT_BEATS = BEATS_PER_BAR;
const PLAY_BEATS = BEATS_PER_BAR * REPS;
const SLOT_LABELS = ["1", "&", "2", "&", "3", "&", "4", "&"];

export default function RhythmPage() {
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
  useWakeLock(round !== null);

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
    },
    [silence, refresh],
  );

  const start = () => {
    const history = statsFrom(recentSessions(Date.now()), RHYTHM_ID);
    setSummary(null);
    setNow(performance.now());
    setRound(new RhythmRound({ settings: drillSettings(loadSettings(), RHYTHM_ID), history, now: () => performance.now(), wall: () => Date.now(), rng: Math.random }));
    begin(bpm);
  };

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

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-10 sm:px-6">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold">Rhythm drill</h1>
        <Link href="/piano" className="text-sm text-white/60 hover:text-white">
          All drills
        </Link>
      </div>
      <KeyboardStatus />

      {round && pattern ? (
        <div className="space-y-3 rounded-2xl border border-white/10 bg-panel/60 p-4 text-center">
          <div className="flex items-center justify-between text-sm text-white/60">
            <span aria-label="Time left">{mmss(round.timeLeft(now))}</span>
            <span data-testid="window">±{round.windowMs} ms</span>
            <button onClick={() => finish(round)} className="rounded-lg border border-white/15 px-3 py-1 text-white/80 hover:bg-white/10">
              End round
            </button>
          </div>
          <p data-testid="pattern-name" className="text-sm text-white/70">
            {pattern.name}
          </p>
          <Grid pattern={pattern} beat={attempt ? active : null} />
          <p role="status" data-testid="prompt" className="h-6 text-sm text-white/70">
            {attempt ? (counting ? "Count-in… listen" : `Play it ${REPS} times`) : ""}
          </p>
          {result && <Result result={result} onNext={again} />}
          <Tempo bpm={bpm} onChange={setBpm} />
        </div>
      ) : summary ? (
        <Done summary={summary} onAgain={start} bpm={bpm} onBpm={setBpm} />
      ) : (
        <div className="space-y-3 rounded-2xl border border-white/10 bg-panel/60 p-4">
          <p className="text-sm text-white/70">
            A one-bar rhythm appears as boxes. After a one-bar count-in, play it twice on any key, in time with the click. Each note is marked early, on time or late.
          </p>
          <ul aria-label="Unlock groups" className="space-y-1 text-sm">
            {GROUP_NAMES.map((g, i) => (
              <li key={g} className={i < open ? "text-white" : "text-white/35"}>
                {i < open ? "Open" : "Locked"}: {g}
              </li>
            ))}
          </ul>
          <p className="text-xs text-white/50">On-time window: ±{WINDOW_STEPS[step]} ms</p>
          <Tempo bpm={bpm} onChange={setBpm} />
          <button onClick={start} className="rounded-xl bg-gold px-5 py-2 font-semibold text-black">
            Start 2-minute round
          </button>
        </div>
      )}

      <PianoKeyboard low={RANGE.low} high={RANGE.high} pressed={held} onPress={(n) => midi.noteOn(n)} onRelease={(n) => midi.noteOff(n)} />
    </div>
  );
}

function Tempo({ bpm, onChange }: { bpm: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-center gap-3">
      <button type="button" aria-label="Slower" onClick={() => onChange(bpm - 5)} className="h-9 w-9 rounded-full border border-white/15 hover:bg-white/10">
        −
      </button>
      <span className="text-sm text-white/70">
        <span data-testid="bpm" className="text-xl font-bold tabular-nums text-gold">
          {bpm}
        </span>{" "}
        BPM
      </span>
      <button type="button" aria-label="Faster" onClick={() => onChange(bpm + 5)} className="h-9 w-9 rounded-full border border-white/15 hover:bg-white/10">
        +
      </button>
      <input type="range" aria-label="Tempo" min={MIN_BPM} max={MAX_BPM} value={bpm} onChange={(e) => onChange(Number(e.target.value))} className="w-32 accent-[#f6c453]" />
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
          <li key={i} data-kind={c === "x" ? "note" : c === "-" ? "hold" : "rest"} className="space-y-1 text-xs text-white/50">
            <div
              className={`flex h-14 items-center justify-center rounded-md border text-sm font-semibold ${
                c === "x" ? "border-gold bg-gold text-black" : c === "-" ? "border-gold/40 bg-gold/25" : "border-dashed border-white/25 text-white/40"
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
      <p className="text-lg font-bold">
        On time: <span data-testid="ontime">{Math.round(result.rate * 100)}%</span>
        <span className="ml-2 text-sm font-normal text-white/50">
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
      <button onClick={onNext} className="rounded-xl bg-gold px-5 py-2 font-semibold text-black">
        Next pattern
      </button>
    </div>
  );
}

function Done({ summary, onAgain, bpm, onBpm }: { summary: RhythmSummary; onAgain: () => void; bpm: number; onBpm: (v: number) => void }) {
  return (
    <div className="space-y-3 rounded-2xl border border-white/10 bg-panel/60 p-4">
      <h2 className="text-lg font-semibold">Round done</h2>
      {summary.attempts === 0 ? (
        <p className="text-sm text-white/70">No patterns finished this round, so nothing was saved.</p>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-3 text-center">
            <div>
              <dt className="text-xs text-white/50">On time</dt>
              <dd data-testid="ontime-total" className="text-2xl font-bold">
                {Math.round(summary.onTimeRate * 100)}%
              </dd>
            </div>
            <div>
              <dt className="text-xs text-white/50">Avg error</dt>
              <dd data-testid="error" className="text-2xl font-bold">
                {summary.avgMs} ms
              </dd>
            </div>
            <div>
              <dt className="text-xs text-white/50">Patterns</dt>
              <dd className="text-2xl font-bold">{summary.attempts}</dd>
            </div>
          </dl>
          <div>
            <h3 className="text-sm font-semibold text-white/80">Weakest</h3>
            {summary.weakest.length ? (
              <ol data-testid="weakest" className="mt-1 space-y-1 text-sm text-white/70">
                {summary.weakest.map((w) => (
                  <li key={w.id}>
                    {w.label}: {w.misses} off, of {w.attempts}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-white/70">None. A clean round.</p>
            )}
          </div>
        </>
      )}
      {summary.unlockedNow.map((g) => (
        <p key={g} className="text-sm text-emerald-300">
          Unlocked: {g}
        </p>
      ))}
      <p className="text-xs text-white/50">On-time window now ±{summary.windowMs} ms</p>
      <Tempo bpm={bpm} onChange={onBpm} />
      <button onClick={onAgain} className="rounded-xl bg-gold px-5 py-2 font-semibold text-black">
        Another round
      </button>
    </div>
  );
}
