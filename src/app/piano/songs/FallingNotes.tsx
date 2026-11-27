"use client";

import { useEffect, useRef, useState } from "react";
import { KEY_W, keyLayout } from "@/components/PianoKeyboard";
import { noteName } from "@/lib/pianoMidi";
import { CROSS_LABEL } from "@/lib/pianoScales";
import { Hand, HandChoice, SongNote, Step } from "@/lib/pianoSongs";
import { Grade } from "@/lib/pianoTiming";

// Hand colours (Tailwind classes, so the scanner sees them whole): right hand amber, left hand sky.
// Bars are the stronger shade, a lit key the lighter one; the keyboard's "pressed" gold and the drills'
// emerald target stay as they are. Notes the app plays (the other hand) are drawn dimmer.
export const HAND_BAR: Record<Hand, string> = { R: "fill-amber-400", L: "fill-sky-500" };
export const HAND_KEY: Record<Hand, string> = { R: "fill-amber-300", L: "fill-sky-300" };

// Play-along feedback colours (a scored note replaces its hand colour): on time green, early violet, late orange, missed red.
export const GRADE_BAR: Record<Grade, string> = { on: "fill-emerald-400", early: "fill-violet-400", late: "fill-orange-400", missed: "fill-red-500" };

export const PX_PER_BEAT = 30;
export const VIEW_H = 150; // the height (in viewBox units) used until the box has been measured

// The size of the box the notes fill (Stage's `above` area), kept up to date with a ResizeObserver. Until it is
// measured (first render, or no ResizeObserver) both are 0 and the caller falls back to VIEW_H.
function useBox() {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = (w: number, h: number) => setBox((b) => (b.w === w && b.h === h ? b : { w, h }));
    const r = el.getBoundingClientRect();
    set(r.width, r.height);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const c = entries[entries.length - 1]?.contentRect;
      if (c) set(c.width, c.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, ...box };
}

// Notes fall toward the top edge of the keyboard drawn under this box (same width, same scroller): `low`-`high`
// is the range the stage draws, so a lane is exactly over its key. The box takes the height Stage gives it: one
// viewBox unit is as wide as a key unit, so the height in units is height * (keys' width / box width), and more
// height shows more beats at the same PX_PER_BEAT. The current step sits on the keys and later steps stand higher,
// spaced by their distance in beats, so in wait mode nothing moves until the step is played. In play-along `at` is
// the song position in beats (negative in the count-in) and the notes move with it; `marks` gives each scored
// note its feedback colour.
export function FallingNotes({ steps, index, hands, low, high, at, marks }: { steps: Step[]; index: number; hands: HandChoice; low: number; high: number; at?: number; marks?: ReadonlyMap<SongNote, Grade> }) {
  const lay = keyLayout(low, high);
  const { ref, w: boxW, h: boxH } = useBox();
  const viewH = boxW > 0 && boxH > 0 ? Math.max(40, (boxH * lay.width) / boxW) : VIEW_H;
  const now = at ?? steps[Math.min(index, steps.length - 1)]?.start ?? 0;
  const cur = steps[index];
  const notes = steps.flatMap((s) => s.notes).filter((n) => n.start + n.dur > now && n.start < now + viewH / PX_PER_BEAT);
  return (
    <div ref={ref} data-testid="falling-notes" className="relative h-full w-full">
    <svg
      viewBox={`0 0 ${lay.width} ${viewH}`}
      data-view-h={Math.round(viewH)}
      preserveAspectRatio="xMidYMax slice"
      role="img"
      aria-label="Falling notes"
      className="absolute inset-0 block h-full w-full overflow-hidden"
    >
      {Array.from({ length: low <= high ? high - low + 1 : 0 }, (_, i) => low + i)
        .filter((n) => n % 12 === 0 || n % 12 === 5) // faint lanes at every C and F
        .map((n) => (
          <line key={n} x1={lay.x(n)} x2={lay.x(n)} y1={0} y2={viewH} className="stroke-pn-ivory/10" strokeWidth={0.5} />
        ))}
      {notes.map((n) => {
        const h = Math.max(n.dur * PX_PER_BEAT - 2, 13);
        const y = viewH - (n.start - now) * PX_PER_BEAT - h;
        const x = lay.x(n.pitch) + 1;
        const w = lay.w(n.pitch) - 2;
        const here = at === undefined && (cur?.notes.includes(n) ?? false);
        const grade = marks?.get(n);
        const mine = hands === "both" || hands === n.hand;
        const short = h < 26;
        return (
          <g key={`${n.start}-${n.pitch}-${n.hand}`} data-testid="note" data-note={n.pitch} data-hand={n.hand} data-grade={grade ?? ""} data-current={here} data-expected={here && mine} data-short={short} opacity={mine ? 1 : 0.55}>
            <rect x={x} y={y} width={w} height={h} rx={3} className={`${grade ? GRADE_BAR[grade] : HAND_BAR[n.hand]} ${here ? "stroke-white" : "stroke-black/30"}`} strokeWidth={here ? 1.5 : 0.6} />
            {/* Letter then finger. A short bar has one line: the letter with the finger beside it. A tall bar has the letter at the foot and the finger in a dot at the head, so "C" and finger 1 never read as "C1". */}
            <text x={x + w / 2} y={y + h - 4} textAnchor="middle" fontSize={w < KEY_W ? 7 : 9.5} fontWeight="bold" className="fill-pn-ebony pointer-events-none select-none font-pns">
              {noteName(n.pitch)}
              {short && (
                <tspan data-testid="finger-inline" dx={2} fontSize={w < KEY_W ? 6 : 7.5} className="fill-pn-ebony/70">
                  {n.finger}
                </tspan>
              )}
            </text>
            {!short && (
              <g className="pointer-events-none select-none">
                <circle cx={x + w / 2} cy={y + 7} r={w < KEY_W ? 4.5 : 5.5} className="fill-pn-ebony/80" />
                <text x={x + w / 2} y={y + 9.6} textAnchor="middle" fontSize={w < KEY_W ? 6.5 : 7.5} fontWeight="bold" className="fill-pn-ivory font-pns">
                  {n.finger}
                </text>
              </g>
            )}
            {n.cross && (
              <text data-testid="cross" data-cross={n.cross} x={x + w / 2} y={y - 3} textAnchor="middle" fontSize={7} fontWeight="bold" className="fill-white pointer-events-none select-none">
                {CROSS_LABEL[n.cross]}
              </text>
            )}
          </g>
        );
      })}
    </svg>
    </div>
  );
}
