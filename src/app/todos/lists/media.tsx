"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_VOICE_SECONDS, mediaUrl, type MediaRef } from "@/lib/media";

// Recording voice notes, and showing an item's photos and voice notes.

const VOICE_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

export const fmtSeconds = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// Record from the microphone, up to MAX_VOICE_SECONDS. `seconds` is null while not recording.
// `onDone` gets the recording once it stops.
export function useVoiceRecorder(onDone: (blob: Blob, seconds: number) => void) {
  const [seconds, setSeconds] = useState<number | null>(null);
  const [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => () => recorder.current?.stream.getTracks().forEach((t) => t.stop()), []);

  async function start() {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("This browser can't record audio.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Microphone access was blocked. Allow it in the browser's site settings.");
      return;
    }
    const type = VOICE_TYPES.find((t) => MediaRecorder.isTypeSupported?.(t));
    const r = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 32000 });
    const chunks: Blob[] = [];
    const started = Date.now();
    const elapsed = () => Math.floor((Date.now() - started) / 1000);
    const timer = setInterval(() => {
      setSeconds(elapsed());
      if (elapsed() >= MAX_VOICE_SECONDS && r.state === "recording") r.stop();
    }, 250);
    r.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    r.onstop = () => {
      clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
      recorder.current = null;
      setSeconds(null);
      const blob = new Blob(chunks, { type: r.mimeType || type || "audio/webm" });
      if (blob.size) done.current(blob, Math.max(1, Math.min(MAX_VOICE_SECONDS, elapsed())));
    };
    recorder.current = r;
    r.start();
    setSeconds(0);
  }

  const stop = () => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  };

  return { seconds, error, start, stop, recording: seconds !== null };
}

// A mic button that records while on, with the time so far.
export function VoiceButton({ onRecorded, disabled }: { onRecorded: (blob: Blob, seconds: number) => void; disabled?: boolean }) {
  const { seconds, error, start, stop, recording } = useVoiceRecorder(onRecorded);
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        onClick={recording ? stop : start}
        disabled={disabled && !recording}
        title={recording ? "Stop recording" : `Record a voice note (up to ${MAX_VOICE_SECONDS / 60} min)`}
        aria-label={recording ? "Stop recording" : "Record a voice note"}
        className={`flex h-10 items-center gap-1.5 rounded-xl border px-3 text-sm transition disabled:opacity-40 ${
          recording
            ? "animate-pulse border-red-400/60 bg-red-500/15 text-red-200"
            : "border-white/15 bg-white/5 text-white/80 hover:border-gold/40 hover:text-gold"
        }`}
      >
        {recording ? <>■ {fmtSeconds(seconds ?? 0)}</> : "🎙"}
      </button>
      {error && <span className="mt-1 max-w-[14rem] text-xs text-red-300">{error}</span>}
    </span>
  );
}

// An item's photos (as thumbnails that open full size) and voice notes (as players).
export function MediaStrip({ media, onRemove }: { media: MediaRef[]; onRemove?: (m: MediaRef) => void }) {
  const [open, setOpen] = useState<MediaRef | null>(null);
  const images = media.filter((m) => m.kind === "image");
  const voices = media.filter((m) => m.kind === "voice");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const remove = (m: MediaRef) =>
    onRemove && (
      <button
        type="button"
        onClick={() => onRemove(m)}
        aria-label={m.kind === "image" ? "Remove photo" : "Remove voice note"}
        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-white/20 bg-black/80 text-[10px] text-white/80 hover:text-red-300"
      >
        ✕
      </button>
    );

  return (
    <div className="space-y-2">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((m) => (
            <span key={m.id} className="relative">
              <button type="button" onClick={() => setOpen(m)} aria-label="Open photo" className="block">
                {/* eslint-disable-next-line @next/next/no-img-element -- served by our own route, already sized */}
                <img src={mediaUrl(m.id)} alt="" loading="lazy" className="h-20 w-20 rounded-lg border border-white/10 object-cover" />
              </button>
              {remove(m)}
            </span>
          ))}
        </div>
      )}
      {voices.map((m) => (
        <span key={m.id} className="relative flex items-center gap-2">
          <audio controls preload="none" src={mediaUrl(m.id)} className="h-9 w-full max-w-xs" aria-label="Voice note" />
          {m.seconds !== undefined && <span className="text-xs text-white/50">{fmtSeconds(m.seconds)}</span>}
          {remove(m)}
        </span>
      ))}
      {open && (
        <div
          role="dialog"
          aria-label="Photo"
          onClick={() => setOpen(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- full-size view of an uploaded photo */}
          <img src={mediaUrl(open.id)} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
        </div>
      )}
    </div>
  );
}
