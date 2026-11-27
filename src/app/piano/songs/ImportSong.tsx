"use client";

import { ChangeEvent, useRef, useState } from "react";
import { saveImportedSong, ImportError } from "@/lib/pianoData";
import { MAX_MIDI_BYTES, MidiFileError, ParsedMidi, parseMidiFile } from "@/lib/pianoMidiFile";
import { noteName } from "@/lib/pianoMidi";
import { DEFAULT_SPLIT, MAX_TITLE, barsOf, buildImportedSong, handCounts, planHands } from "@/lib/pianoSongImport";

export const SAVE_ERRORS: Record<ImportError, string> = {
  "too-many": "You have 50 imported songs. Delete one to add another.",
  "too-big": "That song is too big to store. Try a shorter one.",
  storage: "This browser has no room left to save it.",
};
const pitchLabel = (n: number) => `${noteName(n)}${Math.floor(n / 12) - 1}`;
const fileTitle = (name: string) => name.replace(/\.(mid|midi)$/i, "").replace(/[_]+/g, " ").trim();

// Import a MIDI file: parse it in the browser, preview the hands (a split slider when the file has no two
// parts), then save it as an imported song. A bad or oversized file gets a message and nothing is stored.
export function ImportSong({ onSaved }: { onSaved: (title: string) => void }) {
  const [parsed, setParsed] = useState<ParsedMidi | null>(null);
  const [title, setTitle] = useState("");
  const [split, setSplit] = useState(DEFAULT_SPLIT);
  const [error, setError] = useState("");
  const latest = useRef(0); // the newest pick: an older file that finishes reading later is ignored
  const [inputKey, setInputKey] = useState(0); // a new input after each pick, so the same file can be picked again

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const mine = ++latest.current;
    setInputKey((k) => k + 1);
    setParsed(null);
    setError("");
    if (!file) return;
    if (file.size > MAX_MIDI_BYTES) {
      setError(`That file is too big (over ${MAX_MIDI_BYTES / 1024} KB). Pick a smaller MIDI file.`);
      return;
    }
    try {
      const p = parseMidiFile(new Uint8Array(await file.arrayBuffer()));
      if (mine !== latest.current) return;
      setParsed(p);
      setTitle((p.title || fileTitle(file.name)).slice(0, MAX_TITLE));
      setSplit(DEFAULT_SPLIT);
    } catch (err) {
      if (mine !== latest.current) return;
      setError(err instanceof MidiFileError ? err.message : "That file couldn't be read.");
    }
  };

  const plan = parsed ? planHands(parsed, split) : null;
  const counts = plan ? handCounts(plan.hands) : null;

  const save = () => {
    if (!parsed || !plan) return;
    const out = saveImportedSong((id) => ({ song: buildImportedSong(parsed, plan, id, title || "Imported song"), split: plan.by === "split" ? split : undefined }), Date.now());
    if ("error" in out) {
      setError(SAVE_ERRORS[out.error]);
      return;
    }
    setParsed(null);
    setError("");
    onSaved(out.song.title);
  };

  return (
    <section className="space-y-3 rounded-lg border border-pn-line bg-pn-felt p-4">
      <label className="inline-block cursor-pointer rounded-full border border-pn-brass px-4 py-1.5 text-sm font-semibold text-pn-brass hover:bg-pn-brass hover:text-pn-ebony focus-within:ring-2 focus-within:ring-pn-brass">
        Import MIDI file
        <input key={inputKey} type="file" accept=".mid,.midi,audio/midi,audio/x-midi" aria-label="MIDI file" className="sr-only" onChange={pick} />
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      {parsed && plan && counts && (
        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="text-pn-ivory/60">Title</span>
            <input value={title} maxLength={MAX_TITLE} onChange={(e) => setTitle(e.target.value)} className="mt-1 block w-full rounded-md border border-pn-line bg-pn-velvet px-3 py-1.5" />
          </label>
          <p data-testid="import-info" className="text-pn-ivory/70">
            {parsed.bpm} BPM · {parsed.beatsPerBar} beats a bar · {barsOf(parsed.notes, parsed.beatsPerBar)} bars
          </p>
          <p data-testid="import-counts" className="text-pn-ivory/70">
            Right hand {counts.R} notes · Left hand {counts.L} notes
            {plan.by !== "split" && ` (hands taken from the file's ${plan.by})`}
          </p>
          {plan.by === "split" && (
            <label className="block">
              <span className="text-pn-ivory/60">
                Split the hands at {pitchLabel(split)} (notes from here up are the right hand)
              </span>
              <input type="range" min={36} max={84} value={split} aria-label="Split point" onChange={(e) => setSplit(Number(e.target.value))} className="mt-1 block w-full" />
            </label>
          )}
          <p className="text-xs text-pn-ivory/50">Fingering is suggested by the app and may need your own touch.</p>
          <div className="flex gap-2">
            <button onClick={save} disabled={!counts.R && !counts.L} className="rounded-full bg-pn-brass px-4 py-1.5 font-semibold text-pn-ebony disabled:opacity-40">
              Save song
            </button>
            <button onClick={() => setParsed(null)} className="rounded-lg px-3 py-1.5 text-pn-ivory/70 hover:bg-pn-ivory/10">
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
