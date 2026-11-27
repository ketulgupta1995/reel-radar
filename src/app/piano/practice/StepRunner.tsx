"use client";

import { useEffect, useRef, useState } from "react";
import { DrillDef, DrillItem } from "@/lib/pianoDrill";
import { CHORD_DRILL } from "@/lib/pianoChordDrill";
import { EAR_DRILL } from "@/lib/pianoEarDrill";
import { FINGER_DRILL } from "@/lib/pianoFingerDrill";
import { NOTE_DRILL } from "@/lib/pianoNoteDrill";
import { RHYTHM_ID } from "@/lib/pianoRhythm";
import { Step } from "@/lib/pianoSession";
import { songById } from "@/lib/pianoSongLibrary";
import { DrillRunner } from "../DrillRunner";
import { RhythmRunner } from "../RhythmRunner";
import { ResultCard, songTag } from "../Results";
import { SongPlayer, SongResult } from "../songs/SongPlayer";
import { Stage, StageProgress } from "../Stage";

const DEFS = { notes: NOTE_DRILL, chords: CHORD_DRILL, fingers: FINGER_DRILL, ear: EAR_DRILL } as unknown as Record<string, DrillDef<DrillItem>>;
const MIN_MS = 60_000;
const PAUSE = "Pause practice"; // the stage's back button: the session stays and resumes today

export type StepNames = { label: string; minutes: number }[];

// One step of the session on its own Stage, started at once. `steps`/`index` feed the progress bar (the current
// step's fraction is its elapsed time over its minutes). `onDone(card)` fires once. Mount it with a key per step so
// the next step gets a new Stage (fullscreen carries over).
export function StepRunner({ step, steps, index, onDone }: { step: Step; steps: StepNames; index: number; onDone: (card: ResultCard) => void }) {
  const start = useRef(Date.now());
  const [now, setNow] = useState(start.current);
  const settled = useRef(false);
  const [run, setRun] = useState(0); // song step: which run of the step this is
  const last = useRef<SongResult | null>(null);
  const stop = useRef<(() => boolean) | null>(null); // the song player's Stop
  const ending = useRef(false); // Finish step was tapped
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const t = step.target;
  const lengthMs = t.minutes * MIN_MS;
  const done = (card: ResultCard) => {
    if (settled.current) return;
    settled.current = true;
    onDone(card);
  };

  const top = (
    <StageProgress
      steps={steps.map((s, i) => ({ label: s.label, weight: s.minutes, fraction: i < index ? 1 : i === index ? Math.min(1, (now - start.current) / (s.minutes * MIN_MS)) : 0 }))}
    />
  );

  if (t.kind === "drill") {
    if (t.drill === RHYTHM_ID) return <RhythmRunner backLabel={PAUSE} autoStart showResults={false} lengthMs={lengthMs} top={top} onFinish={(summary) => done({ kind: "rhythm", tag: "Rhythm drill", summary })} />;
    const def = DEFS[t.drill];
    return (
      <DrillRunner
        def={def}
        backLabel={PAUSE}
        blurb={def.title}
        autoStart
        showResults={false}
        lengthMs={lengthMs}
        items={t.items}
        top={top}
        onFinish={(summary, _record, prevAvgMs, touch) => done({ kind: "drill", tag: def.title, summary, prevAvgMs, touch })}
      />
    );
  }

  const song = songById(t.song);
  if (!song) return <Stage top={top}>Song not found</Stage>;
  const card = (r: SongResult): ResultCard => ({ kind: "song", tag: songTag(song.title, r.hands), result: r });
  // After a finished run: another run until the step's minutes have gone by, then the step ends with the last finished
  // run's card. A stopped run leaves the player idle (Play again or Finish step). Finish step stops a run in progress
  // the way Stop does (a wait run with steps played is saved; a play-along run is discarded), then ends the step.
  const onFinish = (r: SongResult) => {
    if (!r.early || !last.current) last.current = r;
    if (ending.current) return done(card(last.current));
    if (r.early) return;
    if (Date.now() - start.current >= lengthMs) done(card(r));
    else setRun((n) => n + 1);
  };
  const finishStep = () => {
    ending.current = true;
    if (stop.current?.()) return; // onFinish ends the step
    done(card(last.current ?? { mode: t.mode, hands: t.hands, bpm: t.tempo, early: true, wait: null, play: null, ladder: null }));
  };
  return (
    <SongPlayer
      key={run}
      song={song}
      hands={t.hands}
      mode={t.mode}
      tempo={run === 0 ? t.tempo : undefined}
      autoStart
      showResults={false}
      back={{ href: "/piano", label: PAUSE }}
      top={
        <>
          {top}
          <button type="button" onClick={finishStep} className="shrink-0 rounded-full border border-pn-ivory/20 px-3 py-1 text-sm text-pn-ivory/80 hover:bg-pn-ivory/10">
            Finish step
          </button>
        </>
      }
      onFinish={onFinish}
      stopRef={stop}
    />
  );
}
