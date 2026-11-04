"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { chunkSentence, initialPlayer, playerReducer } from "./player";

// Reads a chapter aloud one sentence at a time with the browser's speech engine. Pausing cancels the
// speech, so playing again repeats the current sentence (Android's own pause is unreliable).
export function usePlayer(sentences: string[]) {
  const [state, dispatch] = useReducer(playerReducer, undefined, initialPlayer);
  const [supported, setSupported] = useState(true);
  const [error, setError] = useState("");
  const stateRef = useRef(state);
  const sentencesRef = useRef(sentences);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null); // held so the browser can't drop its events
  stateRef.current = state;
  sentencesRef.current = sentences;

  useEffect(() => setSupported("speechSynthesis" in window), []);
  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    if (state.status !== "playing") return;

    const { runId } = state;
    const chunks = chunkSentence(sentencesRef.current[state.index]);
    let next = 0;
    const speak = () => {
      const u = new SpeechSynthesisUtterance(chunks[next]);
      u.lang = "en-US";
      u.onend = () => {
        if (stateRef.current.runId !== runId) return;
        if (++next < chunks.length) speak();
        else dispatch({ type: "ENDED", runId });
      };
      u.onerror = (e) => {
        if (stateRef.current.runId !== runId || e.error === "canceled" || e.error === "interrupted") return;
        setError("The phone's speech engine stopped. Press Play to try again.");
        dispatch({ type: "PAUSE" });
      };
      utteranceRef.current = u;
      synth.speak(u);
    };
    setError("");
    speak();
  }, [state.status, state.runId]); // eslint-disable-line react-hooks/exhaustive-deps

  const play = useCallback(() => dispatch({ type: "PLAY" }), []);
  const pause = useCallback(() => dispatch({ type: "PAUSE" }), []);
  const jump = useCallback((index: number) => dispatch({ type: "JUMP", index }), []);
  const load = useCallback(
    (key: string, index: number, play: boolean) => dispatch({ type: "LOAD", key, count: sentencesRef.current.length, index, play }),
    []
  );

  return { state, supported, error, play, pause, jump, load };
}
