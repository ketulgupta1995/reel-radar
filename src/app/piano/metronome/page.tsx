"use client";

import { KeyboardStatus } from "../KeyboardStatus";
import { BeatDisplay, BeatsPerBar, CountInToggle, StartStop, TapAlong, TempoControl, useMetronome } from "../Metronome";
import { Stage } from "../Stage";

// The metronome on the stage, without the keyboard: a music-stand view with the BPM and beats big in the
// middle. Beats per bar, the count-in and the tap-along check are in the settings sheet.
export default function MetronomePage() {
  const m = useMetronome();
  return (
    <Stage
      noKeyboard
      backLabel="All drills"
      top={<h1 className="font-pnd text-xl font-semibold">Metronome</h1>}
      sheet={
        <>
          <KeyboardStatus />
          <div className="flex flex-wrap items-center gap-3 text-sm text-pn-ivory/70">
            <BeatsPerBar m={m} />
            <CountInToggle m={m} />
          </div>
          <div className="border-t border-pn-line pt-3">
            <TapAlong m={m} />
          </div>
        </>
      }
    >
      <div className="w-full max-w-2xl space-y-4">
        <TempoControl m={m} big />
        <BeatDisplay m={m} big />
        <StartStop m={m} big />
      </div>
    </Stage>
  );
}
