"use client";

import { usePiano } from "./PianoProvider";

const PROBLEM = {
  unsupported: "This browser can't talk to MIDI keyboards. Use Chrome on Android or on a computer. The on-screen keyboard still works.",
  denied: "MIDI access was refused. Allow it in the browser's site settings and reload the page. The on-screen keyboard still works.",
} as const;


// What to tell about the keyboard connection: no Web MIDI, refused, not plugged in, or which of
// several devices to use. Shown on every Piano page that plays.
export function KeyboardStatus() {
  const { midi, snapshot } = usePiano();
  const { state, devices, deviceId } = snapshot;
  return (
    <>
      {(state === "unsupported" || state === "denied") && (
        <p role="alert" className="rounded-r-md border-l-4 border-pn-brass bg-pn-ebony/50 px-3 py-2.5 text-sm text-pn-ivory/90">
          {PROBLEM[state]}
        </p>
      )}
      {state === "disconnected" && <p className="text-sm text-pn-ivory/60">Plug in your keyboard with a USB cable. It connects by itself.</p>}

      {devices.length > 1 && (
        <label className="flex items-center gap-2 text-sm text-pn-ivory/70">
          Keyboard
          <select
            value={deviceId ?? ""}
            onChange={(e) => midi.selectDevice(e.target.value)}
            className="rounded-lg border border-pn-line bg-pn-felt px-2 py-1 text-pn-ivory"
          >
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}
