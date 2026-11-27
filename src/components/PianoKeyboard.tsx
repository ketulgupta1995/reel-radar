"use client";

import { useRef } from "react";
import { isBlack, noteName, noteOctave } from "@/lib/pianoMidi";

const W = 24; // white key width in viewBox units
const H = 100;
const BW = 14;
const BH = 62;

type Props = {
  low?: number; // lowest and highest MIDI note drawn (60 = middle C)
  high?: number;
  pressed?: ReadonlySet<number>; // notes held right now
  lit?: ReadonlySet<number>; // target keys (a drill's hint)
  fingers?: Readonly<Record<number, number>>; // finger number to show on a key
  tint?: Readonly<Record<number, string>>; // fill class for a lit key (e.g. "fill-sky-300"), for songs' two hands; default emerald
  bare?: boolean; // no scroll wrapper: the caller scrolls it (songs draw the falling notes in the same scroller)
  labels?: boolean; // letter names on the keys
  onPress?: (note: number) => void;
  onRelease?: (note: number) => void;
};

// Where a key sits in the keyboard's viewBox (units; a white key is KEY_W wide). The falling notes use it to line up.
export const KEY_W = W;
export function keyLayout(low: number, high: number) {
  const whites: number[] = [];
  for (let n = low; n <= high; n++) if (!isBlack(n)) whites.push(n);
  return {
    width: whites.length * W,
    whites: whites.length,
    x: (n: number) => (isBlack(n) ? whites.filter((w) => w < n).length * W - BW / 2 : whites.indexOf(n) * W),
    w: (n: number) => (isBlack(n) ? BW : W),
  };
}

// A hand-drawn SVG keyboard. It narrows to fit, but never below ~28px per white key; the wrapper then
// scrolls sideways, so a phone shows about two octaves at a time.
export function PianoKeyboard({ low = 48, high = 84, pressed, lit, fingers, labels = true, tint, bare, onPress, onRelease }: Props) {
  const down = useRef(new Set<number>());
  const notes: number[] = [];
  for (let n = low; n <= high; n++) notes.push(n);
  const whites = notes.filter((n) => !isBlack(n));
  const whiteIndex = (n: number) => whites.indexOf(n);
  const xOf = (n: number) => (isBlack(n) ? whites.filter((w) => w < n).length * W - BW / 2 : whiteIndex(n) * W);

  const press = (n: number) => {
    if (down.current.has(n)) return;
    down.current.add(n);
    onPress?.(n);
  };
  const release = (n: number) => {
    if (!down.current.delete(n)) return;
    onRelease?.(n);
  };

  const key = (n: number) => {
    const black = isBlack(n);
    const x = xOf(n);
    const state = lit?.has(n) ? "lit" : pressed?.has(n) ? "pressed" : "idle";
    const fill = {
      lit: tint?.[n] ?? "fill-emerald-300",
      pressed: "fill-gold",
      idle: black ? "fill-slate-900" : "fill-white",
    }[state];
    const text = black ? "fill-white" : "fill-slate-700";
    const label = noteName(n) + (n % 12 === 0 && !black ? String(noteOctave(n)) : "");
    const f = fingers?.[n];
    return (
      <g
        key={n}
        role="button"
        aria-label={`${noteName(n)}${noteOctave(n)}`}
        aria-pressed={pressed?.has(n) ?? false}
        data-note={n}
        data-state={state}
        onPointerDown={() => press(n)}
        onPointerUp={() => release(n)}
        onPointerLeave={() => release(n)}
        onPointerCancel={() => release(n)}
      >
        <rect x={x} y={0} width={black ? BW : W} height={black ? BH : H} rx={2} className={`${fill} stroke-slate-500`} strokeWidth={0.6} />
        {labels && (
          <text x={x + (black ? BW : W) / 2} y={black ? BH - 8 : H - 8} textAnchor="middle" fontSize={black ? 5 : 7} className={`${text} pointer-events-none select-none`}>
            {label}
          </text>
        )}
        {f !== undefined && (
          <text x={x + (black ? BW : W) / 2} y={black ? 18 : 30} textAnchor="middle" fontSize={11} fontWeight="bold" className={`pointer-events-none select-none ${black && state === "idle" ? "fill-white" : "fill-slate-900"}`}>
            {f}
          </text>
        )}
      </g>
    );
  };

  const svg = (
      <svg
        viewBox={`0 0 ${whites.length * W} ${H}`}
        role="group"
        aria-label="On-screen keyboard"
        style={{ minWidth: whites.length * 28, touchAction: "pan-x" }}
        className="block w-full"
      >
        {notes.filter((n) => !isBlack(n)).map(key)}
        {notes.filter(isBlack).map(key)}
      </svg>
  );
  if (bare) return svg;
  return <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/30 p-2">{svg}</div>;
}
