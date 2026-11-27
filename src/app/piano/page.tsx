"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { recentRecords, usePianoSync } from "@/lib/pianoData";
import { minutesOf, streak, todayMs } from "@/lib/pianoLog";
import { KeyboardStatus } from "./KeyboardStatus";

const ITEMS = [
  { href: "/piano/notes", title: "Note drill", text: "Find the note by its letter, in any octave." },
  { href: "/piano/chords", title: "Chord drill", text: "Play the chord shown: C, Am, G7, any inversion." },
  { href: "/piano/fingers", title: "Five-finger positions", text: "Hand on a position, then play the finger called." },
  { href: "/piano/rhythm", title: "Rhythm drill", text: "Play a pattern of quarters, eighths and rests along with the click." },
  { href: "/piano/songs", title: "Songs", text: "Falling notes with letters and fingers; wait for each key, one hand or both." },
  { href: "/piano/scales", title: "Scales", text: "One octave up and down with the standard fingering, one hand then both; scored on evenness." },
  { href: "/piano/songs#coordination", title: "Hand coordination", text: "Eight two-hand exercises: a held or repeated left hand under a right-hand melody, contrary and parallel motion." },
  { href: "/piano/log", title: "Practice log", text: "Minutes, streak and progress; add practice done away from the app." },
  { href: "/piano/metronome", title: "Metronome", text: "Click on your keyboard's drum sounds, with a count-in and a tap-along check." },
  { href: "/piano/play", title: "Free play", text: "Press keys and see their names." },
];

export default function PianoHub() {
  // Read after the first render so it matches the server's.
  const [today, setToday] = useState<{ min: number; streak: number } | null>(null);
  const reload = () => {
    const now = Date.now();
    const rs = recentRecords(now, 400);
    setToday({ min: minutesOf(todayMs(rs, now)), streak: streak(rs, now) });
  };
  useEffect(reload, []);
  usePianoSync(reload); // another device's sessions
  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold">Piano</h1>
      <KeyboardStatus />
      {today && (
        <p className="text-sm text-white/70" data-testid="teaser">
          Today {today.min} min · streak {today.streak} {today.streak === 1 ? "day" : "days"}
        </p>
      )}
      <ul className="grid gap-3 sm:grid-cols-2">
        {ITEMS.map((i) => (
          <li key={i.href}>
            <Link href={i.href} className="block rounded-2xl border border-white/10 bg-panel/60 p-4 hover:bg-white/10">
              <span className="block font-semibold">{i.title}</span>
              <span className="block text-sm text-white/60">{i.text}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
