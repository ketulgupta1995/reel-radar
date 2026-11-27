"use client";

import { KeyboardStatus } from "../KeyboardStatus";
import { Metronome } from "../Metronome";

export default function MetronomePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold">Metronome</h1>
      <KeyboardStatus />
      <Metronome />
    </div>
  );
}
