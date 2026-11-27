"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PianoKeyboard } from "@/components/PianoKeyboard";
import { DrillDef, DrillItem, DrillRound, Summary, statsFrom } from "@/lib/pianoDrill";
import { drillSettings, loadSettings, newSessionId, recentSessions, saveDrillSettings, saveSession } from "@/lib/pianoData";
import { noteName, noteOctave } from "@/lib/pianoMidi";
import { useWakeLock } from "@/lib/useWakeLock";
import { KeyboardStatus } from "./KeyboardStatus";
import { usePiano } from "./PianoProvider";

const RANGE = { low: 48, high: 84 };
const mmss = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// Runs a 2-minute round of any DrillDef: start screen, the round, the summary. Chord, five-finger
// and later drills are a page that passes their definition.
export function DrillRunner<T extends DrillItem>({ def, blurb }: { def: DrillDef<T>; blurb: string }) {
  const { midi } = usePiano();
  const [round, setRound] = useState<DrillRound<T> | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [now, setNow] = useState(0);
  const [held, setHeld] = useState<ReadonlySet<number>>(new Set());
  const [wrong, setWrong] = useState<number | null>(null); // the key last pressed wrongly
  const [open, setOpen] = useState(1); // unlocked groups, read after the first render
  const [limit, setLimit] = useState<number | null>(null);
  useWakeLock(round !== null);

  const refresh = useCallback(() => {
    const s = drillSettings(loadSettings(), def.id);
    setOpen(s.unlocked);
    setLimit([2000, 1500, 1000][s.slowStep]);
  }, [def.id]);
  useEffect(refresh, [refresh]);

  const finish = useCallback(
    (r: DrillRound<T>) => {
      if (r.closed) return; // timer ticks can outrun the re-render that stops them
      const { record, summary: sum } = r.finish(newSessionId(), performance.now());
      if (record) saveSession(record);
      saveDrillSettings(def.id, r.settings, Date.now());
      setSummary(sum);
      setRound(null);
      setWrong(null);
      refresh();
    },
    [def.id, refresh],
  );

  const start = () => {
    const history = statsFrom(recentSessions(Date.now()), def.id);
    setSummary(null);
    setWrong(null);
    setNow(performance.now());
    setRound(
      new DrillRound({
        def,
        settings: drillSettings(loadSettings(), def.id),
        history,
        now: () => performance.now(),
        wall: () => Date.now(),
        rng: Math.random,
      }),
    );
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
        if (!round) return;
        const res = round.handle(e);
        if (res.outcome === "miss") setWrong(e.note);
        if (res.advanced) setWrong(null);
        if (res.changed) saveDrillSettings(def.id, round.settings, Date.now());
        setNow(performance.now());
      }),
    [midi, round, def.id],
  );

  useEffect(() => {
    if (!round) return;
    const id = setInterval(() => {
      if (round.over()) finish(round);
      else setNow(performance.now());
    }, 100);
    return () => clearInterval(id);
  }, [round, finish]);

  const lit = round && round.hintVisible(now) ? round.hint(RANGE).lit : undefined;
  const fingers = round ? (lit ? round.hint(RANGE).fingers : def.setup?.(round.current, RANGE)) : undefined;

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-10 sm:px-6">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold">{def.title}</h1>
        <Link href="/piano" className="text-sm text-white/60 hover:text-white">
          All drills
        </Link>
      </div>
      <KeyboardStatus />

      {round ? (
        <div className="space-y-3 rounded-2xl border border-white/10 bg-panel/60 p-4 text-center">
          <div className="flex items-center justify-between text-sm text-white/60">
            <span aria-label="Time left">{mmss(round.timeLeft(now))}</span>
            <button onClick={() => finish(round)} className="rounded-lg border border-white/15 px-3 py-1 text-white/80 hover:bg-white/10">
              End round
            </button>
          </div>
          {def.caption && (
            <p data-testid="caption" className="text-sm text-white/70">
              {def.caption(round.current)}
            </p>
          )}
          <div data-testid="target" className="text-8xl font-extrabold text-gold">
            {def.label(round.current)}
          </div>
          <p role="status" className="h-6 text-sm text-rose-300">
            {wrong !== null && `You pressed ${noteName(wrong)}${noteOctave(wrong)}. Wanted ${def.label(round.current)}.`}
          </p>
        </div>
      ) : summary ? (
        <Done summary={summary} onAgain={start} />
      ) : (
        <div className="space-y-3 rounded-2xl border border-white/10 bg-panel/60 p-4">
          <p className="text-sm text-white/70">{blurb}</p>
          <ul aria-label="Unlock groups" className="space-y-1 text-sm">
            {def.groupNames.map((g, i) => (
              <li key={g} className={i < open ? "text-white" : "text-white/35"}>
                {i < open ? "Open" : "Locked"}: {g}
              </li>
            ))}
          </ul>
          {limit !== null && <p className="text-xs text-white/50">Slow limit: {limit / 1000} s</p>}
          <button onClick={start} className="rounded-xl bg-gold px-5 py-2 font-semibold text-black">
            Start 2-minute round
          </button>
        </div>
      )}

      <PianoKeyboard
        low={RANGE.low}
        high={RANGE.high}
        pressed={held}
        lit={lit}
        fingers={fingers}
        onPress={(n) => midi.noteOn(n)}
        onRelease={(n) => midi.noteOff(n)}
      />
    </div>
  );
}

function Done({ summary, onAgain }: { summary: Summary; onAgain: () => void }) {
  return (
    <div className="space-y-3 rounded-2xl border border-white/10 bg-panel/60 p-4">
      <h2 className="text-lg font-semibold">Round done</h2>
      {summary.attempts === 0 ? (
        <p className="text-sm text-white/70">No answers this round, so nothing was saved.</p>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-3 text-center">
            <div>
              <dt className="text-xs text-white/50">Accuracy</dt>
              <dd data-testid="accuracy" className="text-2xl font-bold">
                {Math.round(summary.accuracy * 100)}%
              </dd>
            </div>
            <div>
              <dt className="text-xs text-white/50">Avg reaction</dt>
              <dd data-testid="reaction" className="text-2xl font-bold">
                {(summary.avgMs / 1000).toFixed(2)} s
              </dd>
            </div>
            <div>
              <dt className="text-xs text-white/50">Answers</dt>
              <dd className="text-2xl font-bold">{summary.attempts}</dd>
            </div>
          </dl>
          <div>
            <h3 className="text-sm font-semibold text-white/80">Weakest</h3>
            {summary.weakest.length ? (
              <ol data-testid="weakest" className="mt-1 space-y-1 text-sm text-white/70">
                {summary.weakest.map((w) => (
                  <li key={w.id}>
                    {w.label}: {w.misses} missed, {w.slow} slow, of {w.attempts}
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
      <button onClick={onAgain} className="rounded-xl bg-gold px-5 py-2 font-semibold text-black">
        Another round
      </button>
    </div>
  );
}
