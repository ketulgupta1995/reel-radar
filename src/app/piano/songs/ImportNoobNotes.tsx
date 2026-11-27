"use client";

import { FormEvent, useState } from "react";
import { saveImportedSong } from "@/lib/pianoData";
import { MAX_SONG_BPM, MIN_SONG_BPM } from "@/lib/pianoMidiFile";
import { MAX_TITLE } from "@/lib/pianoSongImport";
import { NOOB_BPM, NoobPage, buildNoobSong, noobNotes, noobUrl } from "@/lib/pianoNoobNotes";
import { SAVE_ERRORS } from "./ImportSong";

// Import a NoobNotes link: fetch its note lines, preview them, then save an imported (right-hand) song.
export function ImportNoobNotes({ onSaved }: { onSaved: (title: string) => void }) {
  const [link, setLink] = useState("");
  const [page, setPage] = useState<NoobPage | null>(null);
  const [title, setTitle] = useState("");
  const [bpm, setBpm] = useState(NOOB_BPM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async (e: FormEvent) => {
    e.preventDefault();
    setPage(null);
    setError("");
    if (!noobUrl(link)) {
      setError("Paste a song link from noobnotes.net.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/piano/noobnotes?url=${encodeURIComponent(link.trim())}`);
      const body = await res.json();
      if (!res.ok) setError(body.error || "That song couldn't be loaded.");
      else {
        setPage(body);
        setTitle(body.title.slice(0, MAX_TITLE));
        setBpm(NOOB_BPM);
      }
    } catch {
      setError("That song couldn't be loaded. Check your connection.");
    }
    setBusy(false);
  };

  const save = () => {
    if (!page) return;
    if (!buildNoobSong(page.lines, "", title, bpm)) {
      setError(SAVE_ERRORS["too-big"]);
      return;
    }
    const out = saveImportedSong((id) => ({ song: buildNoobSong(page.lines, id, title, bpm)! }), Date.now());
    if ("error" in out) {
      setError(SAVE_ERRORS[out.error]);
      return;
    }
    setPage(null);
    setLink("");
    onSaved(out.song.title);
  };

  const field = "rounded-md border border-pn-line bg-pn-velvet px-3 py-1.5 text-sm";
  const primary = "rounded-full bg-pn-brass px-4 py-1.5 text-sm font-semibold text-pn-ebony disabled:opacity-40";

  return (
    <section className="space-y-3 rounded-lg border border-pn-line bg-pn-felt p-4">
      <form onSubmit={load} className="flex flex-wrap gap-2">
        <input value={link} onChange={(e) => setLink(e.target.value)} inputMode="url" aria-label="NoobNotes link" placeholder="Paste a noobnotes.net song link" className={`min-w-0 flex-1 basis-56 ${field}`} />
        <button type="submit" disabled={busy || !link.trim()} className={primary}>
          {busy ? "Loading…" : "Get song"}
        </button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      {page && (
        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="text-pn-ivory/60">Title</span>
            <input value={title} maxLength={MAX_TITLE} onChange={(e) => setTitle(e.target.value)} className={`mt-1 block w-full ${field}`} />
          </label>
          <label className="block">
            <span className="text-pn-ivory/60">Tempo: {bpm} BPM</span>
            <input type="range" min={MIN_SONG_BPM} max={MAX_SONG_BPM / 1.5} step={5} value={bpm} aria-label="Tempo" onChange={(e) => setBpm(Number(e.target.value))} className="mt-1 block w-full" />
          </label>
          <p data-testid="noob-info" className="text-pn-ivory/70">
            {noobNotes(page.lines).length} notes · right hand only
          </p>
          <pre aria-label="Notes" className="max-h-40 overflow-auto rounded-md bg-pn-velvet p-3 font-mono text-xs">
            {page.lines.join("\n")}
          </pre>
          <p className="text-xs text-pn-ivory/50">NoobNotes has no rhythm, so the timing is approximate: start with Wait mode. Fingering is suggested by the app.</p>
          <div className="flex gap-2">
            <button onClick={save} className={primary}>
              Save song
            </button>
            <button onClick={() => setPage(null)} className="rounded-lg px-3 py-1.5 text-pn-ivory/70 hover:bg-pn-ivory/10">
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
