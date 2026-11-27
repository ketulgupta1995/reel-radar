"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { deleteImportedSong, loadImportedSongs, loadSettings, pullImportedSongs, usePianoSync } from "@/lib/pianoData";
import { SongProgress, progressLine } from "@/lib/pianoSongLadder";
import { EXERCISES } from "@/lib/pianoExercises";
import { SONGS } from "@/lib/pianoSongLibrary";
import { Song } from "@/lib/pianoSongs";
import { KeyboardStatus } from "../KeyboardStatus";
import { ImportNoobNotes } from "./ImportNoobNotes";
import { ImportSong } from "./ImportSong";

// Easiest first; songs with the same level keep their order in the library.
const SORTED = SONGS.map((s, i) => ({ s, i })).sort((a, b) => a.s.level - b.s.level || a.i - b.i).map((x) => x.s);

export default function SongsPage() {
  const [songs, setSongs] = useState<Record<string, SongProgress>>({});
  const [mine, setMine] = useState<Song[]>([]);
  const [asking, setAsking] = useState<string | null>(null); // the imported song whose delete is being confirmed
  const [saved, setSaved] = useState("");
  const reload = () => {
    setSongs(loadSettings().songs);
    setMine(loadImportedSongs());
    void pullImportedSongs(); // songs another device imported; a no-op (no request) when none are missing
  };
  useEffect(reload, []);
  usePianoSync(reload);
  const remove = (id: string) => {
    deleteImportedSong(id, Date.now());
    setAsking(null);
    setMine(loadImportedSongs());
  };
  const row = (s: Song) => (
    <Link href={`/piano/songs/${s.id}`} className="flex items-center justify-between gap-3 py-3.5 outline-none transition-colors hover:bg-pn-felt/60 focus-visible:bg-pn-felt focus-visible:ring-2 focus-visible:ring-pn-brass sm:px-2">
      <span className="min-w-0">
        <span className="block truncate text-lg font-semibold">{s.title}</span>
        <span className="block text-sm text-pn-ivory/60">{s.imported ? `${s.bpm} BPM` : `${s.key} · ${s.bpm} BPM`}</span>
        {songs[s.id] && (
          <span data-testid={`progress-${s.id}`} className="block text-xs text-pn-brass">
            {progressLine(songs[s.id])}
          </span>
        )}
      </span>
      <span className="shrink-0 rounded-full border border-pn-line px-2.5 py-0.5 text-xs text-pn-ivory/70" aria-label={s.imported ? "Imported" : `Level ${s.level}`}>
        {s.imported ? "Imported" : `Level ${s.level}`}
      </span>
    </Link>
  );
  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-10 sm:px-6">
      <Link href="/piano" className="text-sm text-pn-ivory/60 underline-offset-4 hover:text-pn-ivory hover:underline">
        ← Piano
      </Link>
      <h1 className="font-pnd text-4xl font-semibold leading-tight">Songs</h1>
      <KeyboardStatus />
      <ImportNoobNotes onSaved={(t) => { setSaved(t); reload(); }} />
      <ImportSong onSaved={(t) => { setSaved(t); reload(); }} />
      {saved && (
        <p role="status" className="text-sm text-emerald-300">
          Saved &ldquo;{saved}&rdquo;.
        </p>
      )}
      {mine.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-pnd text-2xl font-semibold">Your songs</h2>
          <ul className="divide-y divide-pn-line border-y border-pn-line">
            {mine.map((s) => (
              <li key={s.id} className="pb-2">
                {row(s)}
                {asking === s.id ? (
                  <p className="flex flex-wrap items-center gap-2 px-1 text-sm">
                    <span>Delete &ldquo;{s.title}&rdquo; from every device?</span>
                    <button onClick={() => remove(s.id)} className="rounded-lg bg-red-500/80 px-2.5 py-1 font-semibold">
                      Yes, delete
                    </button>
                    <button onClick={() => setAsking(null)} className="rounded-lg px-2.5 py-1 text-pn-ivory/70 hover:bg-pn-ivory/10">
                      Keep
                    </button>
                  </p>
                ) : (
                  <button onClick={() => setAsking(s.id)} aria-label={`Delete ${s.title}`} className="px-1 text-xs text-pn-ivory/50 hover:text-red-300">
                    Delete
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <ul className="divide-y divide-pn-line border-y border-pn-line">
        {SORTED.map((s) => (
          <li key={s.id}>{row(s)}</li>
        ))}
      </ul>
      <section id="coordination" className="space-y-2">
        <h2 className="font-pnd text-2xl font-semibold">Coordination</h2>
        <p className="text-sm text-pn-ivory/60">Two-hand exercises, easiest first: the left hand holds or repeats a chord while the right hand plays a five-finger melody.</p>
        <ul className="divide-y divide-pn-line border-y border-pn-line">
          {EXERCISES.map((s) => (
            <li key={s.id}>{row(s)}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
