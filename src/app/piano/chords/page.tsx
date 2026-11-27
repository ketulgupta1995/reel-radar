"use client";

import { CHORD_DRILL } from "@/lib/pianoChordDrill";
import { DrillRunner } from "../DrillRunner";

export default function ChordsPage() {
  return (
    <DrillRunner
      def={CHORD_DRILL}
      blurb="A chord name appears. Hold its notes together, in any octave or inversion (doubling a note is fine). A note that isn't in the chord is a miss. The chord's notes light up in root position, with finger numbers, only after a miss or a 2-second pause."
    />
  );
}
