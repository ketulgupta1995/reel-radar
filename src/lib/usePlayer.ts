"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { loadVoicePrefs, saveVoicePrefs } from "./books";
import { chunkSentence, initialPlayer, playerReducer } from "./player";
import { englishVoices, langTag } from "./voices";

// A sentence that fails is spoken again twice; after that playback stops with a message.
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;
const MIN_STALL_MS = 8000;
const MS_PER_CHAR = 200;

// Reads a chapter aloud one sentence at a time with the browser's speech engine. Pausing cancels the
// speech, so playing again repeats the current sentence (Android's own pause is unreliable).
export function usePlayer(sentences: string[]) {
  const [state, dispatch] = useReducer(playerReducer, undefined, initialPlayer);
  const [supported, setSupported] = useState(true);
  const [error, setError] = useState("");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [prefs, setPrefs] = useState({ voiceURI: null as string | null, rate: 1 });
  const stateRef = useRef(state);
  const sentencesRef = useRef(sentences);
  const prefsRef = useRef(prefs);
  const voicesRef = useRef(voices);
  const failures = useRef(0);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null); // held so the browser can't drop its events
  stateRef.current = state;
  sentencesRef.current = sentences;
  prefsRef.current = prefs;
  voicesRef.current = voices;

  useEffect(() => {
    setSupported("speechSynthesis" in window);
    setPrefs(loadVoicePrefs());
    if (!("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    const load = () => setVoices(synth.getVoices());
    load();
    synth.addEventListener?.("voiceschanged", load);
    return () => {
      synth.removeEventListener?.("voiceschanged", load);
      synth.cancel();
    };
  }, []);

  // Leaving the page (or locking the phone) stops speech, and the engine tends to fail in the background.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden" && stateRef.current.status === "playing") {
        setError("Paused because the app went to the background. Press Play to carry on.");
        dispatch({ type: "PAUSE" });
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    if (state.status !== "playing") return;

    const { runId } = state;
    const chunks = chunkSentence(sentencesRef.current[state.index]);
    const timers: ReturnType<typeof setTimeout>[] = [];
    const current = () => stateRef.current.runId === runId;
    let next = 0;
    let watchdog: ReturnType<typeof setTimeout> | undefined;

    const fail = () => {
      clearTimeout(watchdog);
      if (!current()) return;
      if (++failures.current > MAX_RETRIES) {
        failures.current = 0;
        setError("The phone's speech engine stopped. Press Play to try again.");
        dispatch({ type: "PAUSE" });
      } else {
        timers.push(setTimeout(() => dispatch({ type: "RETRY", runId }), RETRY_DELAY_MS));
      }
    };

    const speak = () => {
      const { voiceURI, rate } = prefsRef.current;
      const voice = voiceURI ? voicesRef.current.find((v) => v.voiceURI === voiceURI) : undefined;
      const u = new SpeechSynthesisUtterance(chunks[next]);
      u.lang = voice ? langTag(voice.lang) : "en-US";
      if (voice) u.voice = voice;
      u.rate = rate;
      u.onend = () => {
        clearTimeout(watchdog);
        if (!current()) return;
        if (++next < chunks.length) return speak();
        failures.current = 0;
        dispatch({ type: "ENDED", runId });
      };
      u.onerror = (e) => {
        if (e.error !== "canceled" && e.error !== "interrupted") fail();
      };
      // A piece that takes far longer than it should is treated like a failure.
      watchdog = setTimeout(fail, Math.max(MIN_STALL_MS, (chunks[next].length * MS_PER_CHAR) / rate));
      utteranceRef.current = u;
      synth.speak(u);
    };
    setError("");
    speak();
    return () => {
      clearTimeout(watchdog);
      timers.forEach(clearTimeout);
    };
  }, [state.status, state.runId]); // eslint-disable-line react-hooks/exhaustive-deps

  const play = useCallback(() => {
    failures.current = 0;
    dispatch({ type: "PLAY" });
  }, []);
  const pause = useCallback(() => dispatch({ type: "PAUSE" }), []);
  const jump = useCallback((index: number) => dispatch({ type: "JUMP", index }), []);
  const load = useCallback(
    (key: string, index: number, play: boolean) => dispatch({ type: "LOAD", key, count: sentencesRef.current.length, index, play }),
    []
  );
  const choose = useCallback((change: Partial<typeof prefs>) => {
    const next = { ...prefsRef.current, ...change };
    setPrefs(next);
    saveVoicePrefs(next);
  }, []);

  const options = englishVoices(voices, typeof navigator === "undefined" ? undefined : navigator.language, prefs.voiceURI);
  return { state, supported, error, voices: options, prefs, choose, play, pause, jump, load };
}
