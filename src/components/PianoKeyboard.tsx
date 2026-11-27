"use client";

import { useEffect, useId, useRef, useState } from "react";
import { isBlack, noteName, noteOctave } from "@/lib/pianoMidi";

const W = 24; // white key width in viewBox units
const H = 100;
const BW = 14;
const BH = 62; // the unfilled key height (a black key is BH of it)
const FELT = 5; // the crimson felt rail the keys sit under, as on a real piano

type Props = {
  low?: number; // lowest and highest MIDI note drawn (60 = middle C)
  high?: number;
  pressed?: ReadonlySet<number>; // notes held right now
  lit?: ReadonlySet<number>; // target keys (a drill's hint)
  fingers?: Readonly<Record<number, number>>; // finger number to show on a key
  tint?: Readonly<Record<number, string>>; // fill class for a lit key (e.g. "fill-sky-300"), for songs' two hands; default emerald
  fill?: boolean; // no card; the keys stretch to the parent's height (the stage docks it)
  minKey?: number; // narrowest a white key may get, in px, before the wrapper scrolls (28 by default)
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
export function PianoKeyboard({ low = 48, high = 84, pressed, lit, fingers, labels = true, tint, bare, fill, minKey = 28, onPress, onRelease }: Props) {
  // fill: the keys stretch to the height the parent gives (the stage's dock) instead of keeping the 100-unit height.
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!fill || !el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fill]);
  const down = useRef(new Set<number>());
  const notes: number[] = [];
  for (let n = low; n <= high; n++) notes.push(n);
  const whites = notes.filter((n) => !isBlack(n));
  const unitsW = whites.length * W;
  let hh = H;
  if (fill && size && size.w > 0 && size.h > 0) {
    const scale = Math.max(size.w, whites.length * minKey) / unitsW; // px per unit once the scroller has done its sizing
    hh = Math.max(40, size.h / scale - FELT - 1);
  }
  const bh = (hh * BH) / H;
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

  const id = useId().replace(/:/g, "");
  const key = (n: number) => {
    const black = isBlack(n);
    const x = xOf(n);
    const w = black ? BW : W;
    const h = black ? bh : hh;
    const state = lit?.has(n) ? "lit" : pressed?.has(n) ? "pressed" : "idle";
    // Idle keys are shaded ivory and ebony (gradients); a lit or pressed key is flat colour so it reads at a glance.
    const fill = state === "lit" ? tint?.[n] ?? "fill-emerald-300" : state === "pressed" ? "fill-pn-brass" : "";
    const text = black && state === "idle" ? "fill-pn-ivory/80" : "fill-pn-ebony/70";
    const label = noteName(n) + (n % 12 === 0 && !black ? String(noteOctave(n)) : "");
    const f = fingers?.[n];
    const down = state === "pressed" ? 1 : 0; // a pressed key dips a little
    return (
      <g
        key={n}
        role="button"
        aria-label={`${noteName(n)}${noteOctave(n)}`}
        aria-pressed={pressed?.has(n) ?? false}
        data-note={n}
        data-state={state}
        transform={down ? `translate(0 ${down})` : undefined}
        className="cursor-pointer"
        onPointerDown={() => press(n)}
        onPointerUp={() => release(n)}
        onPointerLeave={() => release(n)}
        onPointerCancel={() => release(n)}
      >
        <rect
          x={x + (black ? 0 : 0.3)}
          y={FELT - 2}
          width={w - (black ? 0 : 0.6)}
          height={h + 2}
          rx={black ? 1.5 : 2.5}
          fill={fill ? undefined : `url(#${id}-${black ? "ebony" : "ivory"})`}
          className={`${fill} ${black ? "stroke-pn-ebony" : "stroke-[#8c7b66]"}`}
          strokeWidth={0.5}
        />
        {black && state === "idle" && <rect x={x + 2} y={FELT} width={w - 4} height={h - 7} rx={1} className="pointer-events-none fill-white/[0.07]" />}
        {!black && state === "idle" && <rect x={x + 0.8} y={FELT + h - 4} width={w - 1.6} height={3.5} rx={1.5} className="pointer-events-none fill-[#c9bca3]/60" />}
        {labels && (
          <text x={x + w / 2} y={FELT + (black ? bh - 9 : hh - 9)} textAnchor="middle" fontSize={black ? 5.5 : 7.5} fontWeight={600} className={`${text} pointer-events-none select-none font-pns`}>
            {label}
          </text>
        )}
        {f !== undefined && (
          <text x={x + w / 2} y={FELT + (black ? 18 : 32)} textAnchor="middle" fontSize={12} fontWeight={700} className={`pointer-events-none select-none font-pns ${black && state === "idle" ? "fill-pn-ivory" : "fill-pn-ebony"}`}>
            {f}
          </text>
        )}
      </g>
    );
  };

  const width = whites.length * W;
  const svg = (
    <svg
      viewBox={`0 0 ${width} ${hh + FELT + 1}`}
      preserveAspectRatio="xMinYMin meet"
      role="group"
      aria-label="On-screen keyboard"
      style={{ minWidth: whites.length * minKey, touchAction: "pan-x" }}
      className={fill ? "block h-full w-full" : "block w-full"}
    >
      <defs>
        <linearGradient id={`${id}-ivory`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e9dfca" />
          <stop offset="0.12" stopColor="#fbf6ea" />
          <stop offset="1" stopColor="#efe5d1" />
        </linearGradient>
        <linearGradient id={`${id}-ebony`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0d0809" />
          <stop offset="0.85" stopColor="#2a1d21" />
          <stop offset="1" stopColor="#3b2a2f" />
        </linearGradient>
      </defs>
      {notes.filter((n) => !isBlack(n)).map(key)}
      {notes.filter(isBlack).map(key)}
      <rect x={0} y={0} width={width} height={FELT} className="pointer-events-none fill-pn-crimson" />
      <rect x={0} y={FELT - 0.8} width={width} height={0.8} className="pointer-events-none fill-black/40" />
    </svg>
  );
  if (fill) return <div ref={box} className="h-full overflow-x-auto overflow-y-hidden bg-pn-ebony">{svg}</div>;
  if (bare) return svg;
  return <div className="overflow-x-auto rounded-lg bg-pn-ebony px-2 pb-2 shadow-[0_24px_48px_-24px_rgba(0,0,0,0.9)]">{svg}</div>;
}
