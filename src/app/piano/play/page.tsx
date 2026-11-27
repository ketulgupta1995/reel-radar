"use client";

import { useEffect, useState } from "react";
import { PianoKeyboard } from "@/components/PianoKeyboard";
import { noteName, noteOctave } from "@/lib/pianoMidi";
import { useWakeLock } from "@/lib/useWakeLock";
import { usePiano } from "../PianoProvider";
import { KeyboardStatus } from "../KeyboardStatus";

export default function PianoPage() {
  const { midi, snapshot } = usePiano();
  const [held, setHeld] = useState<ReadonlySet<number>>(new Set());
  const [last, setLast] = useState<number | null>(null);
  useWakeLock(true);

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
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold">Free play</h1>

      <KeyboardStatus />

      <div aria-live="polite" className="flex h-24 items-baseline justify-center gap-2 rounded-2xl border border-white/10 bg-panel/60 py-4">
        {last === null ? (
          <span className="self-center text-sm text-white/40">Play a key</span>
        ) : (
          <>
            <span data-testid="note-name" className="text-6xl font-extrabold text-gold">
              {noteName(last)}
            </span>
            <span className="text-lg text-white/50">{noteOctave(last)}</span>
          </>
        )}
      </div>

      <PianoKeyboard pressed={held} onPress={(n) => midi.noteOn(n)} onRelease={(n) => midi.noteOff(n)} />
      <p className="text-xs text-white/40">
        {state === "connected" ? "Tapped keys play on your keyboard." : "Tapped keys play through a simple built-in sound."}
      </p>
    </div>
  );
}
