"use client";

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
export const VIEW_H = 150;

// Notes fall toward the top edge of the keyboard drawn under this SVG (same width, same scroller). The
// current step sits on the keys and later steps stand higher, spaced by their distance in beats, so in
// wait mode nothing moves until the step is played. In play-along `at` is the song position in beats (negative
// in the count-in) and the notes move with it; `marks` gives each scored note its feedback colour.
export function FallingNotes({ steps, index, hands, low, high, at, marks }: { steps: Step[]; index: number; hands: HandChoice; low: number; high: number; at?: number; marks?: ReadonlyMap<SongNote, Grade> }) {
  const lay = keyLayout(low, high);
  const now = at ?? steps[Math.min(index, steps.length - 1)]?.start ?? 0;
  const cur = steps[index];
  const notes = steps.flatMap((s) => s.notes).filter((n) => n.start + n.dur > now && n.start < now + VIEW_H / PX_PER_BEAT);
  return (
    <svg
      viewBox={`0 0 ${lay.width} ${VIEW_H}`}
      role="img"
      aria-label="Falling notes"
      style={{ minWidth: lay.whites * 28 }}
      className="block w-full overflow-hidden"
    >
      {Array.from({ length: low <= high ? high - low + 1 : 0 }, (_, i) => low + i)
        .filter((n) => n % 12 === 0 || n % 12 === 5) // faint lanes at every C and F
        .map((n) => (
          <line key={n} x1={lay.x(n)} x2={lay.x(n)} y1={0} y2={VIEW_H} className="stroke-white/10" strokeWidth={0.5} />
        ))}
      {notes.map((n) => {
        const h = Math.max(n.dur * PX_PER_BEAT - 2, 13);
        const y = VIEW_H - (n.start - now) * PX_PER_BEAT - h;
        const x = lay.x(n.pitch) + 1;
        const w = lay.w(n.pitch) - 2;
        const here = at === undefined && (cur?.notes.includes(n) ?? false);
        const grade = marks?.get(n);
        const mine = hands === "both" || hands === n.hand;
        return (
          <g key={`${n.start}-${n.pitch}-${n.hand}`} data-testid="note" data-note={n.pitch} data-hand={n.hand} data-grade={grade ?? ""} data-current={here} data-expected={here && mine} opacity={mine ? 1 : 0.55}>
            <rect x={x} y={y} width={w} height={h} rx={3} className={`${grade ? GRADE_BAR[grade] : HAND_BAR[n.hand]} ${here ? "stroke-white" : "stroke-black/30"}`} strokeWidth={here ? 1.5 : 0.6} />
            <text x={x + w / 2} y={y + h - 4} textAnchor="middle" fontSize={w < KEY_W ? 7 : 9} fontWeight="bold" className="fill-slate-900 pointer-events-none select-none">
              {noteName(n.pitch)}
              {n.finger}
            </text>
            {n.cross && (
              <text data-testid="cross" data-cross={n.cross} x={x + w / 2} y={y - 3} textAnchor="middle" fontSize={7} fontWeight="bold" className="fill-white pointer-events-none select-none">
                {CROSS_LABEL[n.cross]}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
