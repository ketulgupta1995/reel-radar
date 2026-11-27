"use client";

import { NOTE_DRILL } from "@/lib/pianoNoteDrill";
import { DrillRunner } from "../DrillRunner";

export default function NotesPage() {
  return (
    <DrillRunner
      def={NOTE_DRILL}
      blurb="A note name appears. Play that note, in any octave. The key lights up on the keyboard below only after a miss or a 2-second pause, so look at your own keyboard first."
    />
  );
}
