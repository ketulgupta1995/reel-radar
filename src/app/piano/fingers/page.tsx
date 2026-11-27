"use client";

import { FINGER_DRILL } from "@/lib/pianoFingerDrill";
import { DrillRunner } from "../DrillRunner";

export default function FingersPage() {
  return (
    <DrillRunner
      def={FINGER_DRILL}
      blurb="Put your hand in the position shown (the keyboard shows which finger sits on which key), then play the key for the finger called. Finger 1 is the thumb. Only that exact key counts. It lights up after a miss or a 2-second pause."
    />
  );
}
