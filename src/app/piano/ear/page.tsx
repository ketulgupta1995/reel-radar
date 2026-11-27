"use client";

import { EAR_DRILL } from "@/lib/pianoEarDrill";
import { DrillRunner } from "../DrillRunner";

export default function EarPage() {
  return (
    <DrillRunner
      def={EAR_DRILL}
      blurb="The app plays, you play it back. First a C and then one note of the C position; later three-note phrases, then a chord to call major or minor by playing it. Tap Hear again as often as you like; the keys light up only after a miss."
    />
  );
}
