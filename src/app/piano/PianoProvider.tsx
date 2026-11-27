"use client";

import { ReactNode, createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { AppSwitcher } from "@/components/AppSwitcher";
import { syncPiano, usePianoSync } from "@/lib/pianoData";
import { INITIAL, MidiSnapshot, PianoMidi, createPianoMidi } from "@/lib/pianoMidi";

const Ctx = createContext<{ midi: PianoMidi; snapshot: MidiSnapshot; setStaged: (on: boolean) => void } | null>(null);

// Every Piano page: the app header with the keyboard's connection dot, and one shared MIDI connection.
export function usePiano() {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePiano needs <PianoProvider>");
  return v;
}

export function PianoProvider({ children }: { children: ReactNode }) {
  const [midi] = useState(() => createPianoMidi()); // touches no browser API until start()
  // The server snapshot is the initial one, so the first render matches the prerendered page.
  const snapshot = useSyncExternalStore(midi.subscribe, midi.getSnapshot, () => INITIAL);
  useEffect(() => {
    void midi.start();
    return () => midi.stop();
  }, [midi]);

  // Open: pull settings and this and last month; the tab coming back into view re-syncs them (lib/sync.ts).
  useEffect(() => void syncPiano(), []);
  usePianoSync(() => {});

  // A stage covers the page and carries its own connection dot, so the app header steps aside while one is open.
  const [staged, setStaged] = useState(false);
  const on = snapshot.state === "connected";
  const device = snapshot.devices.find((d) => d.id === snapshot.deviceId);
  return (
    <Ctx.Provider value={{ midi, snapshot, setStaged }}>
      <main className="min-h-screen bg-pn-velvet bg-[radial-gradient(ellipse_90%_60%_at_50%_0%,#4a1a26_0%,transparent_70%)] text-pn-ivory selection:bg-pn-brass selection:text-pn-ebony">
        <header hidden={staged} className="sticky top-0 z-40 border-b-4 border-pn-crimson bg-pn-ebony/85 backdrop-blur-md">
          <nav className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <AppSwitcher current="piano" />
            <div role="status" aria-label={on ? "Keyboard connected" : "Keyboard not connected"} className="flex min-w-0 items-center gap-2 text-xs text-pn-ivory/70">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${on ? "bg-emerald-400 shadow-[0_0_8px_2px_rgba(52,211,153,0.6)]" : "border border-pn-ivory/40"}`} />
              <span className="truncate">{on ? device?.name : "No keyboard"}</span>
            </div>
          </nav>
        </header>
        {children}
      </main>
    </Ctx.Provider>
  );
}
