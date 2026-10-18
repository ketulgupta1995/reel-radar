import { Title } from "@/types/title";

const K = "reel-radar-v1";

export type State = {
  watched: Title[];
  displayed: string[];
  shown: string[];
  watchlist: Title[];
  dismissed: string[]; // Media keys (e.g. "movie:550") the user rejected
};

const empty = (): State => ({
  watched: [],
  displayed: [],
  shown: [],
  watchlist: [],
  dismissed: [],
});

export const load = (): State => {
  try {
    const value = JSON.parse(localStorage.getItem(K) || "");
    return value ? { ...empty(), ...value } : empty();
  } catch {
    return empty();
  }
};

export const save = (s: State) => localStorage.setItem(K, JSON.stringify(s));

export const reset = () => localStorage.removeItem(K);