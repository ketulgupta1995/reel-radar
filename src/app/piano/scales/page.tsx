"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { loadSettings, usePianoSync } from "@/lib/pianoData";
import { SongProgress } from "@/lib/pianoSongLadder";
import { SCALES, bothUnlocked, scaleUnlocked } from "@/lib/pianoScales";
import { KeyboardStatus } from "../KeyboardStatus";

// The scales in unlock order. A scale opens once the one before it has its right hand done; both hands inside a
// scale open after a one-hand play-along run with 90% on time (the player says so).
export default function ScalesPage() {
  const [songs, setSongs] = useState<Record<string, SongProgress>>({});
  const reload = () => setSongs(loadSettings().songs);
  useEffect(reload, []);
  usePianoSync(reload);
  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-10 sm:px-6">
      <Link href="/piano" className="text-sm text-pn-ivory/60 underline-offset-4 hover:text-pn-ivory hover:underline">
        ← Piano
      </Link>
      <h1 className="font-pnd text-4xl font-semibold leading-tight">Scales</h1>
      <p className="text-sm text-pn-ivory/60">One octave up and down, quarter notes. Standard fingering is on every note; the thumb-under and finger-over notes are marked. A minor is the natural minor.</p>
      <KeyboardStatus />
      <ul className="divide-y divide-pn-line border-y border-pn-line">
        {SCALES.map((sc, i) => {
          const p = songs[sc.id];
          const open = scaleUnlocked(i, (id) => songs[id]);
          const body = (
            <>
              <span className="min-w-0">
                <span className="block text-lg font-semibold">{sc.name}</span>
                <span className="block text-sm text-pn-ivory/60">
                  {open ? (p?.best ? `Best ${p.best}% on time` : "Right hand, then left, then both") : `Locked: finish ${SCALES[i - 1].name} with the right hand first`}
                </span>
                {p && open && (
                  <span data-testid={`hands-${sc.id}`} className="block text-xs text-pn-brass">
                    {p.step >= 1 ? "Right hand done" : "Right hand to do"} · {bothUnlocked(p) ? "both hands open" : "both hands locked"}
                  </span>
                )}
              </span>
              <span className="shrink-0 rounded-full border border-pn-line px-2.5 py-0.5 text-xs text-pn-ivory/70">{open ? `${i + 1}` : "Locked"}</span>
            </>
          );
          const cls = "flex items-center justify-between gap-3 py-3.5 outline-none focus-visible:ring-2 focus-visible:ring-pn-brass sm:px-2";
          return (
            <li key={sc.id}>
              {open ? (
                <Link href={`/piano/scales/${sc.id}`} className={`${cls} transition-colors hover:bg-pn-felt/60`}>
                  {body}
                </Link>
              ) : (
                <div data-testid={`locked-${sc.id}`} aria-disabled className={`${cls} opacity-50`}>
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
