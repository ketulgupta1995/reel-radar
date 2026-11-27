"use client";

import Link from "next/link";
import { ReactNode, useEffect, useRef, useState } from "react";
import { PianoKeyboard, keyLayout } from "@/components/PianoKeyboard";
import { KeyboardRange, keyboardRange } from "@/lib/pianoKeyboardRange";
import { useWakeLock } from "@/lib/useWakeLock";
import { usePiano } from "./PianoProvider";

// The stage: every practice screen's full-screen instrument view. A slim top bar, a middle that fills,
// and the keyboard docked at the bottom at full width. Everything else goes in the settings sheet.
//
//   <Stage top={<StageProgress steps={...} />} notes={itemNotes} pressed={held} lit={target} onPress=... sheet={<Controls />}>
//     the target, the previous and next items ...
//   </Stage>
//
// - top: sits between the back button and the connection dot (session progress, BPM, score, timer, the hand).
// - children: the middle; it fills the space between the bar and the keyboard.
// - above: drawn directly above the keyboard, filling the height between the middle and the keys, in the same
//   horizontal scroller and at exactly the keyboard's width (songs put FallingNotes here). It may be a function
//   of the drawn range (low, high, whites) so it lines up with the keys. With `above`, children shrink to fit.
// - notes / range: the notes of the item, padded to whole octaves (at least C3-C5), or an explicit range.
// - follow: notes to keep in view; when the keyboard scrolls sideways (a phone) and any of them is off screen,
//   the shared scroller centres them (a song's current step).
// - keyboard props (pressed, lit, fingers, tint, labels, onPress, onRelease) go to the PianoKeyboard.
// - noKeyboard: hide the dock (the metronome, rhythm taps); the rest of the layout stays.
// - sheet: settings-sheet content; the settings button shows only when there is some.
// - backHref / backLabel: the back button (default /piano).
type Props = {
  children?: ReactNode;
  top?: ReactNode;
  above?: ReactNode | ((range: KeyboardRange) => ReactNode);
  sheet?: ReactNode;
  notes?: readonly number[];
  range?: { low: number; high: number };
  follow?: readonly number[];
  noKeyboard?: boolean;
  backHref?: string;
  backLabel?: string;
  pressed?: ReadonlySet<number>;
  lit?: ReadonlySet<number>;
  fingers?: Readonly<Record<number, number>>;
  tint?: Readonly<Record<number, string>>;
  labels?: boolean;
  onPress?: (note: number) => void;
  onRelease?: (note: number) => void;
};

// A session's progress for the top bar: one segment per step, as wide as its minutes. fraction runs 0 to 1.
export type StageStep = { label: string; weight: number; fraction: number };
export function StageProgress({ steps }: { steps: readonly StageStep[] }) {
  return (
    <ol aria-label="Today's practice" className="m-0 flex min-w-0 flex-1 list-none items-center gap-1.5 p-0">
      {steps.map((s, i) => {
        const state = s.fraction >= 1 ? "done" : s.fraction > 0 ? "now" : "next";
        return (
          <li key={i} data-state={state} style={{ flex: s.weight }} className={`flex min-w-0 flex-col gap-0.5 text-[11px] ${state === "now" ? "font-semibold text-pn-brass" : "text-pn-ivory/60"}`}>
            <span className="h-1 rounded-sm bg-pn-ebony">
              <span className={`block h-full rounded-sm ${state === "done" ? "bg-emerald-300" : "bg-pn-brass"}`} style={{ width: `${Math.round(Math.min(1, Math.max(0, s.fraction)) * 100)}%` }} />
            </span>
            <span className="truncate">{s.label}{state === "done" ? " ✓" : ""}</span>
          </li>
        );
      })}
    </ol>
  );
}

const ignore = () => {}; // a refused fullscreen or orientation lock changes nothing

// Lock to the way the device is held now, so bumping the phone doesn't flip the layout. Refused or missing: ignored.
function lockOrientation() {
  try {
    const o = screen.orientation;
    const way = o?.type?.startsWith("portrait") ? "portrait" : "landscape";
    void Promise.resolve((o as { lock?: (w: string) => Promise<void> } | undefined)?.lock?.(way)).catch(ignore);
  } catch {
    // Not available here.
  }
}
function unlockOrientation() {
  try {
    screen.orientation?.unlock?.();
  } catch {
    // Not available here.
  }
}

function requestFull() {
  try {
    void Promise.resolve(document.documentElement.requestFullscreen?.()).catch(ignore);
  } catch {
    // Refused or missing: the stage still covers the page.
  }
}

// Stages mounted right now. Going from one stage to the next (a session's steps) keeps fullscreen: the
// old stage only leaves fullscreen if no new stage has mounted by the next tick.
let mounted = 0;

// Fullscreen is asked for as the stage opens (after a tap on a link the browser still counts the user's
// gesture; on a reload it doesn't, so the bar also offers an "Enter full screen" button). The orientation
// lock is tried only once the page really is fullscreen. Leaving fullscreen keeps the stage.
function useFullscreen() {
  const [full, setFull] = useState(false);
  const [can, setCan] = useState(false); // read in an effect, so the first render matches the server
  useEffect(() => {
    mounted++;
    setCan(typeof document.documentElement.requestFullscreen === "function" && document.fullscreenEnabled !== false);
    const sync = () => {
      const on = !!document.fullscreenElement;
      setFull(on);
      if (on) lockOrientation();
      else unlockOrientation();
    };
    document.addEventListener("fullscreenchange", sync);
    if (!document.fullscreenElement) requestFull();
    sync();
    return () => {
      mounted--;
      document.removeEventListener("fullscreenchange", sync);
      setTimeout(() => {
        if (mounted > 0) return;
        unlockOrientation();
        if (document.fullscreenElement) void Promise.resolve(document.exitFullscreen?.()).catch(ignore);
      }, 0);
    };
  }, []);
  const exit = () => {
    unlockOrientation();
    void Promise.resolve(document.exitFullscreen?.()).catch(ignore);
  };
  return { full, can, enter: requestFull, exit };
}

function useViewport() {
  const [size, setSize] = useState({ w: 0, h: 0 }); // browser sizes are read in an effect, so the first render matches the server
  useEffect(() => {
    const read = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  return size;
}

const icon = "h-5 w-5";
const button = "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-pn-ivory hover:text-pn-brass";

export function Stage({ children, top, above, sheet, notes = [], range, follow, noKeyboard, backHref = "/piano", backLabel = "Back", labels, onPress, onRelease, ...keys }: Props) {
  const { snapshot, setStaged } = usePiano();
  const { w, h } = useViewport();
  const { full, can, enter, exit } = useFullscreen();
  const [sheetOpen, setSheetOpen] = useState(false);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const done = useRef<HTMLButtonElement>(null);
  useWakeLock(true);
  useEffect(() => {
    setStaged(true);
    return () => setStaged(false);
  }, [setStaged]);

  // The sheet: focus moves into it, Escape closes it, and focus goes back to the settings button.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (sheetOpen) {
      done.current?.focus();
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") setSheetOpen(false);
      };
      document.addEventListener("keydown", onKey);
      wasOpen.current = true;
      return () => document.removeEventListener("keydown", onKey);
    }
    if (wasOpen.current) settingsButton.current?.focus();
    wasOpen.current = false;
  }, [sheetOpen]);

  const landscape = w > h;
  const fit = keyboardRange(notes, { width: w, landscape });
  const { low, high } = range ?? fit;
  const whites = keyLayout(low, high).whites;
  const drawn: KeyboardRange = { low, high, whites, minKey: fit.minKey, scrolls: whites * fit.minKey > w };
  const on = snapshot.state === "connected";
  const device = snapshot.devices.find((d) => d.id === snapshot.deviceId);
  // Keep the followed notes on screen: scroll only when one of them is out of view, then centre them.
  const scroller = useRef<HTMLDivElement>(null);
  const followKey = follow?.join(",") ?? "";
  useEffect(() => {
    const el = scroller.current;
    if (!el || !followKey || el.scrollWidth <= el.clientWidth) return;
    const lay = keyLayout(low, high);
    const scale = el.scrollWidth / lay.width;
    const ns = followKey.split(",").map(Number);
    const left = Math.min(...ns.map((n) => lay.x(n))) * scale;
    const right = Math.max(...ns.map((n) => lay.x(n) + lay.w(n))) * scale;
    if (left >= el.scrollLeft && right <= el.scrollLeft + el.clientWidth) return;
    el.scrollLeft = Math.max(0, (left + right) / 2 - el.clientWidth / 2);
  }, [followKey, low, high, w]);
  const dock = { height: landscape ? "clamp(120px, 36vh, 220px)" : "clamp(150px, 26vh, 220px)" };

  return (
    <div data-testid="stage" data-layout={landscape ? "landscape" : "portrait"} className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-pn-velvet bg-[radial-gradient(ellipse_90%_60%_at_50%_35%,#3a1520_0%,transparent_70%)] pt-[env(safe-area-inset-top)] text-pn-ivory">
      <header className="flex h-[46px] shrink-0 items-center gap-1 px-2 text-[13px] sm:gap-2">
        <Link href={backHref} aria-label={backLabel} className={button}>
          <svg className={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </Link>
        <div className="flex min-w-0 flex-1 items-center gap-3">{top}</div>
        <div role="status" aria-label={on ? "Keyboard connected" : "Keyboard not connected"} className="flex min-w-0 items-center gap-1.5 text-xs text-pn-ivory/75">
          <span className={`h-2 w-2 shrink-0 rounded-full ${on ? "bg-emerald-400 shadow-[0_0_8px_2px_rgba(52,211,153,0.6)]" : "border border-pn-ivory/40"}`} />
          <span className="hidden max-w-[9rem] truncate sm:inline">{on ? device?.name : "No keyboard"}</span>
        </div>
        {full ? (
          <button type="button" aria-label="Exit full screen" onClick={exit} className={button}>
            <svg className={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
            </svg>
          </button>
        ) : (
          can && (
            <button type="button" aria-label="Enter full screen" onClick={enter} className={button}>
              <svg className={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
              </svg>
            </button>
          )
        )}
        {sheet && (
          <button ref={settingsButton} type="button" aria-label="Settings" aria-expanded={sheetOpen} onClick={() => setSheetOpen((v) => !v)} className={button}>
            <svg className={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
              <circle cx="16" cy="7" r="2" />
              <circle cx="10" cy="17" r="2" />
            </svg>
          </button>
        )}
      </header>

      {/* With `above`, the middle shrinks to its content and `above` takes the rest. `above` and the keys share one
          horizontal scroller at the keyboard's width, so falling notes stay over their keys when it scrolls. */}
      <div className={`flex min-h-0 flex-col items-center overflow-y-auto px-4 [justify-content:safe_center] ${above && !noKeyboard ? "shrink-0 py-1" : "flex-1"}`}>{children}</div>

      {!noKeyboard && (
        <div ref={scroller} data-testid="stage-scroller" className={`overflow-x-auto overflow-y-hidden pb-[env(safe-area-inset-bottom)] ${above ? "min-h-0 flex-1" : "shrink-0"}`}>
          <div className="flex h-full flex-col" style={{ minWidth: whites * fit.minKey }}>
            {above && <div className="min-h-0 flex-1">{typeof above === "function" ? above(drawn) : above}</div>}
            <div className="shrink-0" style={dock}>
              <PianoKeyboard fill low={low} high={high} minKey={fit.minKey} labels={labels} onPress={onPress} onRelease={onRelease} {...keys} />
            </div>
          </div>
        </div>
      )}

      {sheet && sheetOpen && (
        <div className="absolute inset-0 z-10 flex items-end justify-center bg-black/50 sm:items-stretch sm:justify-end" onClick={() => setSheetOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="stage-sheet-title" onClick={(e) => e.stopPropagation()} className="max-h-[85%] w-full overflow-y-auto rounded-t-2xl border-t border-pn-line bg-pn-felt p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:max-h-none sm:w-96 sm:rounded-none sm:border-l sm:border-t-0">
            <div className="mb-4 flex items-center justify-between">
              <h2 id="stage-sheet-title" className="font-pnd text-2xl font-semibold">
                Settings
              </h2>
              <button ref={done} type="button" onClick={() => setSheetOpen(false)} className="min-h-11 rounded-lg px-4 text-sm text-pn-ivory/80 hover:text-pn-brass">
                Done
              </button>
            </div>
            <div className="space-y-4">{sheet}</div>
          </div>
        </div>
      )}
    </div>
  );
}
