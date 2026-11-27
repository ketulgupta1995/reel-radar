"use client";

import { useEffect, useState } from "react";
import { noteName, noteOctave } from "@/lib/pianoMidi";
import { usePiano } from "../PianoProvider";
import { KeyboardStatus } from "../KeyboardStatus";
import { Stage } from "../Stage";

export default function PianoPage() {
  const { midi, snapshot } = usePiano();
  const [held, setHeld] = useState<ReadonlySet<number>>(new Set());
  const [last, setLast] = useState<number | null>(null);
  const [labels, setLabels] = useState(true);

  useEffect(
    () =>
      midi.onNote((e) => {
        setHeld((prev) => {
          const next = new Set(prev);
          if (e.type === "on") next.add(e.note);
          else next.delete(e.note);
          return next;
        });
        if (e.type === "on") setLast(e.note);
      }),
    [midi],
  );

  const { state } = snapshot;
  return (
    <Stage
      notes={[48, 84]}
      pressed={held}
      labels={labels}
      onPress={(n) => midi.noteOn(n)}
      onRelease={(n) => midi.noteOff(n)}
      top={<h1 className="font-pnd text-xl font-semibold">Free play</h1>}
      sheet={
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} className="h-4 w-4 accent-pn-brass" />
          Show key names
        </label>
      }
    >
      <div className="w-full max-w-xl space-y-2 text-center">
        <KeyboardStatus />
      </div>
      <div aria-live="polite" className="flex min-h-0 items-baseline justify-center gap-2 py-2">
        {last === null ? (
          <span className="font-pnd text-2xl italic text-pn-ivory/40">Play a key</span>
        ) : (
          <>
            <span data-testid="note-name" className="font-pnd text-[clamp(5rem,28vh,10rem)] font-semibold leading-none text-pn-ivory">
              {noteName(last)}
            </span>
            <span className="font-pnd text-4xl text-pn-brass">{noteOctave(last)}</span>
          </>
        )}
      </div>
      <p className="text-xs text-pn-ivory/40">
        {state === "connected" ? "Tapped keys play on your keyboard." : "Tapped keys play through a simple built-in sound."}
      </p>
    </Stage>
  );
}
