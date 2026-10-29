"use client";

import { useEffect, useRef, useState } from "react";

// A time field with a clock-face picker: tap the hour, then the minute, and choose AM or PM.
// `value` and `onChange` use 24-hour "HH:MM"; an empty string means no time is set.

const SIZE = 224;
const RADIUS = 88;
const pad = (n: number) => String(n).padStart(2, "0");
const parse = (v: string) => {
  const m = /^(\d{2}):(\d{2})$/.exec(v);
  return m ? { h: Number(m[1]), m: Number(m[2]) } : null;
};

// "06:45" -> "6:45 AM"
export function formatClock(value: string): string {
  const t = parse(value);
  if (!t) return "";
  return `${t.h % 12 || 12}:${pad(t.m)} ${t.h < 12 ? "AM" : "PM"}`;
}

export function ClockTimePicker({
  label,
  value,
  onChange,
  fallback,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  fallback: string; // where the clock starts when no time is set yet
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(parse(fallback)!);
  const [mode, setMode] = useState<"hour" | "minute">("hour");
  const root = useRef<HTMLDivElement>(null);

  const show = () => {
    setDraft(parse(value) ?? parse(fallback)!);
    setMode("hour");
    setOpen(true);
  };
  const close = () => setOpen(false);
  const done = () => {
    onChange(`${pad(draft.h)}:${pad(draft.m)}`);
    close();
  };

  // Click outside or Escape closes without changing the time.
  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => {
      if (root.current && !root.current.contains(e.target as Node)) close();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const pm = draft.h >= 12;
  const setHour = (h12: number) => {
    setDraft({ ...draft, h: (h12 % 12) + (pm ? 12 : 0) });
    setMode("minute");
  };
  const setMinute = (m: number) => setDraft({ ...draft, m: (m + 60) % 60 });
  const setPeriod = (toPm: boolean) => setDraft({ ...draft, h: (draft.h % 12) + (toPm ? 12 : 0) });

  const marks = mode === "hour" ? Array.from({ length: 12 }, (_, i) => (i === 0 ? 12 : i)) : Array.from({ length: 12 }, (_, i) => i * 5);
  const selected = mode === "hour" ? draft.h % 12 || 12 : draft.m;
  const angle = mode === "hour" ? (draft.h % 12) * 30 : draft.m * 6;
  const at = (deg: number, r: number) => ({
    left: SIZE / 2 + r * Math.sin((deg * Math.PI) / 180),
    top: SIZE / 2 - r * Math.cos((deg * Math.PI) / 180),
  });

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : show())}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={value ? `${label}: ${formatClock(value)}` : `${label}: not set`}
        className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition ${
          open ? "border-gold/60 bg-white/10" : "border-white/10 bg-white/5 hover:border-white/25"
        }`}
      >
        <span className="text-xs uppercase tracking-wide text-white/50">{label}</span>
        <span className={`text-sm font-semibold tabular-nums ${value ? "text-white" : "text-white/40"}`}>
          {value ? formatClock(value) : "Set time"}
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={`Set ${label.toLowerCase()} time`}
          className="absolute left-0 z-50 mt-2 w-[17rem] max-w-[calc(100vw-2rem)] rounded-2xl border border-white/15 bg-ink p-4 shadow-2xl"
        >
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-baseline text-3xl font-semibold tabular-nums">
              <button
                type="button"
                onClick={() => setMode("hour")}
                aria-pressed={mode === "hour"}
                className={`rounded-lg px-1.5 ${mode === "hour" ? "bg-gold/20 text-gold" : "text-white/70"}`}
              >
                {pad(draft.h % 12 || 12)}
              </button>
              <span className="text-white/40">:</span>
              <button
                type="button"
                onClick={() => setMode("minute")}
                aria-pressed={mode === "minute"}
                className={`rounded-lg px-1.5 ${mode === "minute" ? "bg-gold/20 text-gold" : "text-white/70"}`}
              >
                {pad(draft.m)}
              </button>
            </div>
            <div className="flex flex-col overflow-hidden rounded-lg border border-white/15 text-xs font-semibold">
              {(["AM", "PM"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p === "PM")}
                  aria-pressed={(p === "PM") === pm}
                  className={`px-2.5 py-1 ${(p === "PM") === pm ? "bg-gold text-black" : "text-white/60 hover:text-white"}`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div
            className="relative mx-auto rounded-full bg-white/[.06]"
            style={{ width: SIZE, height: SIZE, maxWidth: "100%" }}
            data-testid="clock-face"
          >
            <div
              className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold"
              aria-hidden
            />
            <div
              className="absolute bottom-1/2 left-1/2 w-0.5 origin-bottom -translate-x-1/2 bg-gold transition-transform"
              style={{ height: RADIUS, transform: `translateX(-50%) rotate(${angle}deg)` }}
              aria-hidden
            />
            {marks.map((n, i) => {
              const on = n === selected;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => (mode === "hour" ? setHour(n) : setMinute(n))}
                  aria-label={mode === "hour" ? `${n} o'clock` : `${n} minutes`}
                  aria-pressed={on}
                  className={`absolute flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-sm tabular-nums transition ${
                    on ? "bg-gold font-semibold text-black" : "text-white/80 hover:bg-white/10"
                  }`}
                  style={at(i * 30, RADIUS)}
                >
                  {mode === "hour" ? n : pad(n)}
                </button>
              );
            })}
          </div>

          {mode === "minute" && (
            <div className="mt-2 flex items-center justify-center gap-2 text-xs text-white/60">
              <button
                type="button"
                onClick={() => setMinute(draft.m - 1)}
                className="rounded-lg border border-white/15 px-2 py-1 hover:border-gold/50 hover:text-white"
              >
                − 1 min
              </button>
              <button
                type="button"
                onClick={() => setMinute(draft.m + 1)}
                className="rounded-lg border border-white/15 px-2 py-1 hover:border-gold/50 hover:text-white"
              >
                + 1 min
              </button>
            </div>
          )}

          <div className="mt-3 flex items-center justify-between text-sm">
            <button
              type="button"
              onClick={() => {
                onChange("");
                close();
              }}
              className="text-white/50 hover:text-red-300"
            >
              Clear
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={close} className="rounded-lg px-3 py-1.5 text-white/60 hover:text-white">
                Cancel
              </button>
              <button type="button" onClick={done} className="rounded-lg bg-gold px-3 py-1.5 font-semibold text-black">
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
