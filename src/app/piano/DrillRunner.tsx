"use client";

import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { DrillDef, DrillItem, DrillRecord, DrillRound, HINT_AFTER_MS, ROUND_MS, Summary, lastRoundAvgMs, statsFrom } from "@/lib/pianoDrill";
import { NoteSpeed, todayNoteSpeed } from "@/lib/pianoNoteSpeed";
import { drillSettings, loadSettings, newSessionId, recentSessions, saveDrillSettings, saveSession } from "@/lib/pianoData";
import { noteName, noteOctave } from "@/lib/pianoMidi";
import { TouchSample, TouchStats, touchStats } from "@/lib/pianoTouch";
import { KeyboardStatus } from "./KeyboardStatus";
import { Results } from "./Results";
import { usePiano } from "./PianoProvider";
import { Stage } from "./Stage";

const RANGE = { low: 48, high: 84 };
const mmss = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const lengthText = (ms: number) => (ms % 60_000 === 0 ? `${ms / 60_000}-minute` : mmss(ms));

export type DrillRunnerProps<T extends DrillItem> = {
  def: DrillDef<T>;
  blurb: string;
  lengthMs?: number; // round length (default 2 minutes)
  items?: readonly string[]; // only these item ids (see DrillRound); a filtered round never unlocks groups
  // After the round is saved. prevAvgMs: the mean reaction of the previous round of this drill (null = none), what a
  // results card compares against (DrillCardData). touch: evenness of the right answers' velocity (drills with
  // `fingerOf`, keyboard notes only; null when too few).
  onFinish?: (summary: Summary, record: DrillRecord | null, prevAvgMs: number | null, touch: TouchStats | null) => void;
  top?: ReactNode; // extra top-bar content (a session's progress)
  autoStart?: boolean; // start the round on mount, skipping the start screen (a session step)
  backHref?: string;
  backLabel?: string;
  showResults?: boolean; // default true; false = no results view after the round (a session shows one at the end)
};

// Runs a round of any DrillDef on the stage: start screen, the round, the summary. The middle shows the
// target very large with the previous item (and its time) and the next one dimmed beside it. Chord,
// five-finger and later drills are a page that passes their definition.
export function DrillRunner<T extends DrillItem>({ def, blurb, lengthMs = ROUND_MS, items, onFinish, top, autoStart, backHref = "/piano", backLabel = "All drills", showResults = true }: DrillRunnerProps<T>) {
  const { midi } = usePiano();
  const [round, setRound] = useState<DrillRound<T> | null>(null);
  const [done, setDone] = useState<{ summary: Summary; prevAvgMs: number | null; speed: NoteSpeed | null; touch: TouchStats | null } | null>(null);
  const touch = useRef<TouchSample[]>([]); // velocity of each right answer, by finger (drills with fingerOf)
  const [now, setNow] = useState(0);
  const [held, setHeld] = useState<ReadonlySet<number>>(new Set());
  const [wrong, setWrong] = useState<number | null>(null); // the key last pressed wrongly
  const [open, setOpen] = useState(1); // unlocked groups, read after the first render
  const [limit, setLimit] = useState<number | null>(null);
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

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
      const prevAvgMs = record ? lastRoundAvgMs(recentSessions(Date.now()), def.id, record.startedAt) : null; // before this round is saved
      if (record) saveSession(record);
      saveDrillSettings(def.id, r.settings, Date.now());
      // Today's rounds of the note drill (this one included): only this drill's items are pitch-class names.
      const speed = def.id === "notes" ? todayNoteSpeed(recentSessions(Date.now(), 2), Date.now()) : null;
      const t = def.fingerOf ? touchStats(touch.current) : null;
      setDone({ summary: sum, prevAvgMs, speed, touch: t });
      setRound(null);
      setWrong(null);
      refresh();
      onFinishRef.current?.(sum, record, prevAvgMs, t);
    },
    [def.id, refresh],
  );

  const start = () => {
    const history = statsFrom(recentSessions(Date.now()), def.id);
    setDone(null);
    setWrong(null);
    touch.current = [];
    setNow(performance.now());
    setRound(
      new DrillRound({
        def,
        settings: drillSettings(loadSettings(), def.id),
        history,
        now: () => performance.now(),
        wall: () => Date.now(),
        rng: Math.random,
        lengthMs,
        items,
      }),
    );
  };

  // A session step starts straight away: the learner already tapped Start practice. Once per mount.
  const started = useRef(false);
  const startRef = useRef(start);
  startRef.current = start;
  useEffect(() => {
    if (!autoStart || started.current) return;
    started.current = true;
    startRef.current();
  }, [autoStart]);

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
        const item = round.current;
        const res = round.handle(e);
        if (res.outcome === "correct" && e.type === "on" && e.source === "keyboard") {
          const finger = def.fingerOf?.(item, e.note);
          if (finger) touch.current.push({ finger, velocity: e.velocity });
        }
        if (res.outcome === "miss") setWrong(e.note);
        if (res.advanced) setWrong(null);
        if (res.changed) saveDrillSettings(def.id, round.settings, Date.now());
        setNow(performance.now());
      }),
    [midi, round, def],
  );

  // Ear training: the app plays the item when it comes up (a new item, or a new round), and again on "Hear again".
  const hear = useCallback(
    (item: T) => {
      const snd = def.sound?.(item);
      if (!snd) return;
      const t0 = performance.now() + 120;
      snd.groups.forEach((g, i) => g.forEach((n) => midi.play(n, snd.velocity?.[i] ?? 85, Math.round(snd.gapMs * 0.9), t0 + i * snd.gapMs)));
    },
    [def, midi],
  );
  const shownAt = round?.shownAt;
  useEffect(() => {
    if (round && !round.closed) hear(round.current);
  }, [round, shownAt, hear]);

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
  const next = round?.peek();
  const prev = round?.previous;
  const side = "flex min-w-[4.5rem] flex-col items-center gap-0.5 opacity-40";
  const sideLabel = "text-[11px] uppercase tracking-[0.12em]";

  const bar = (
    <>
      <h1 className={`truncate font-pnd text-lg font-semibold ${top ? "hidden sm:block" : ""}`}>{def.title}</h1>
      {round && (
        <span data-testid="level" className="hidden shrink-0 text-xs text-pn-ivory/60 sm:inline">
          Level {round.settings.unlocked} of {def.groupNames.length}
        </span>
      )}
      {round && (
        <>
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
      <p className="text-sm text-pn-ivory/70">
        {def.hintAfterMs === Infinity ? "A hint lights the keys after a miss." : `A hint lights the key after a miss or ${(def.hintAfterMs ?? HINT_AFTER_MS) / 1000} seconds with no answer.`}
      </p>
      {limit !== null && <p className="text-sm text-pn-ivory/70">Slow limit: {limit / 1000} s</p>}
      <Groups def={def} open={open} />
    </>
  );

  return (
    <Stage
      top={bar}
      sheet={sheet}
      range={RANGE}
      backHref={backHref}
      backLabel={backLabel}
      pressed={held}
      lit={lit}
      fingers={fingers}
      onPress={(n) => midi.noteOn(n)}
      onRelease={(n) => midi.noteOff(n)}
    >
      {round ? (
        <div className="flex w-full max-w-4xl flex-wrap items-center justify-center gap-x-6 text-center landscape:flex-nowrap landscape:gap-x-12">
          <div data-testid="previous" className={`${side} order-1 mr-auto landscape:order-1 landscape:mr-0`}>
            <span className={sideLabel}>Last</span>
            <span className="font-pnd text-4xl font-semibold">{prev ? def.label(prev.item) : "\u00a0"}</span>
            <span className="text-xs text-emerald-300">{prev ? `${(prev.ms / 1000).toFixed(1)} s` : "\u00a0"}</span>
          </div>
          <div className="order-3 basis-full landscape:order-2 landscape:basis-auto">
            {def.caption && (
              <p data-testid="caption" className="text-sm text-pn-ivory/70">
                {def.caption(round.current)}
              </p>
            )}
            <div data-testid="target" className={`py-1 font-pnd font-semibold leading-none tracking-tight text-pn-ivory ${def.prompt ? "text-[clamp(2.5rem,min(18vh,14vw),6rem)]" : "text-[clamp(4rem,min(30vh,38vw),11rem)]"}`}>
              {(def.prompt ?? def.label)(round.current)}
            </div>
            {def.sound && (
              <button type="button" onClick={() => hear(round.current)} className="mt-1 rounded-full border border-pn-ivory/30 px-4 py-1.5 text-sm text-pn-ivory hover:bg-pn-ivory/10">
                Hear again
              </button>
            )}
            <p role="status" className="min-h-6 text-sm font-medium text-[#ffb59e]">
              {wrong !== null && `You pressed ${noteName(wrong)}${noteOctave(wrong)}. Wanted ${def.label(round.current)}.`}
            </p>
          </div>
          <div data-testid="next" className={`${side} order-2 ml-auto landscape:order-3 landscape:ml-0`}>
            <span className={sideLabel}>Next</span>
            <span className="font-pnd text-4xl font-semibold">{next ? (def.prompt ? "?" : def.label(next)) : "\u00a0"}</span>
            <span className="text-xs">&nbsp;</span>
          </div>
        </div>
      ) : done && showResults ? (
        <Results
          title="Round done"
          cards={[{ kind: "drill", tag: def.title, summary: done.summary, prevAvgMs: done.prevAvgMs, touch: done.touch }]}
          noteSpeed={done.speed}
          primary={{ label: "Done", href: backHref }}
          secondary={{ label: "Another round", onClick: start }}
        />
      ) : (
        <div className="w-full max-w-xl space-y-3 rounded-lg border border-pn-line bg-pn-felt p-4">
          <KeyboardStatus />
          <p className="text-sm text-pn-ivory/70">{blurb}</p>
          <Groups def={def} open={open} />
          {limit !== null && <p className="text-xs text-pn-ivory/50">Slow limit: {limit / 1000} s</p>}
          <button onClick={start} className="rounded-full bg-pn-brass px-6 py-2.5 font-semibold text-pn-ebony hover:brightness-110">
            Start {lengthText(lengthMs)} round
          </button>
        </div>
      )}
    </Stage>
  );
}

function Groups<T extends DrillItem>({ def, open }: { def: DrillDef<T>; open: number }) {
  return (
    <ul aria-label="Unlock groups" className="space-y-1 text-sm">
      {def.groupNames.map((g, i) => (
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
  );
}
