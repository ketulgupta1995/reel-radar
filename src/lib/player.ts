// The sentence player's state machine and the splitting of long sentences (pure; no "use client").
// Validated in the Android speech prototype: Android can still deliver an end event for a sentence that
// was cancelled, so every "speak this sentence" request has a run id and an end from an earlier run is
// ignored.

export type PlayerStatus = "stopped" | "playing" | "paused" | "finished";
export type PlayerState = {
  status: PlayerStatus;
  index: number; // the current sentence
  count: number; // sentences in the loaded chapter
  runId: number; // bumped each time a sentence has to be spoken (again)
  key: string; // which chapter is loaded, so a stale position isn't saved against the wrong one
};

export type PlayerAction =
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "ENDED"; runId: number }
  | { type: "RETRY"; runId: number }
  | { type: "JUMP"; index: number }
  | { type: "LOAD"; key: string; count: number; index: number; play: boolean };

export const initialPlayer = (): PlayerState => ({ status: "stopped", index: 0, count: 0, runId: 0, key: "" });

const clamp = (index: number, count: number) => Math.max(0, Math.min(count - 1, index));

export function playerReducer(state: PlayerState, action: PlayerAction): PlayerState {
  switch (action.type) {
    case "PLAY":
      if (!state.count) return state;
      return { ...state, status: "playing", index: state.status === "finished" ? 0 : state.index, runId: state.runId + 1 };
    case "PAUSE":
      return state.status === "playing" ? { ...state, status: "paused" } : state;
    case "ENDED": {
      if (state.status !== "playing" || action.runId !== state.runId) return state;
      const index = state.index + 1;
      return index >= state.count ? { ...state, status: "finished" } : { ...state, index, runId: state.runId + 1 };
    }
    case "RETRY":
      return state.status === "playing" && action.runId === state.runId ? { ...state, runId: state.runId + 1 } : state;
    case "JUMP": {
      if (!state.count) return state;
      const status = state.status === "finished" ? "paused" : state.status;
      return { ...state, status, index: clamp(action.index, state.count), runId: status === "playing" ? state.runId + 1 : state.runId };
    }
    case "LOAD": {
      const { key, count, play } = action;
      return { status: play && count ? "playing" : "stopped", index: clamp(action.index, count), count, runId: state.runId + 1, key };
    }
  }
}

// Android's speech engine fails on very long text; a sentence of 1,000 characters finished in the
// test and one of 4,500 failed at once.
export const SPEAK_LIMIT = 1000;

// A sentence as pieces short enough to speak, cut after a comma, semicolon or colon where possible.
export function chunkSentence(text: string, limit = SPEAK_LIMIT): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const head = rest.slice(0, limit);
    let cut = Math.max(head.lastIndexOf(", "), head.lastIndexOf("; "), head.lastIndexOf(": ")) + 1;
    if (cut < limit * 0.3) cut = head.lastIndexOf(" ") + 1;
    if (cut <= 0) cut = limit;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}
