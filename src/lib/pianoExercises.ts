// Hand-coordination exercises: built-in two-hand song data (the notation of pianoSongs.parseHand), easiest first.
// All are eight bars of 4/4 in C with the right hand in the C five-finger position (thumb on C4) and the left
// hand low (five-finger position C3-G3, little finger on C3). They play in the song player with its hands and
// tempo ladders and keep their progress there, like songs.
import { Song, SongDef, buildSong } from "./pianoSongs";

const C = "C3+E3+G3", F = "F2+A2+C3", G = "G2+B2+D3";
const pulse = (chord: string) => Array(4).fill(`${chord}:1/5+3+1`).join(" ");
// Five-finger lines: "C4 D4:2" with the finger worked out from the position (right C1 D2 E3 F4 G5, left C5 D4 E3 F2 G1).
const FINGER = { R: { C: 1, D: 2, E: 3, F: 4, G: 5 }, L: { C: 5, D: 4, E: 3, F: 2, G: 1 } } as const;
const five = (hand: "R" | "L", text: string) =>
  text.replace(/\b([CDEFG])(\d)(:[\d.]+)?/g, (_, n: "C", o, d = "") => `${n}${o}${d}/${FINGER[hand][n]}`);

const CONTRARY_RH = "C4 D4 E4 F4 | G4 F4 E4 D4 | C4 E4 G4 E4 | C4:4";
const CONTRARY_LH = "G3 F3 E3 D3 | C3 D3 E3 F3 | G3 E3 C3 E3 | C3:4";
const PARALLEL = "C4 D4 E4 F4 | G4 F4 E4 D4 | C4 E4 G4 E4 | C4:4 | E4 F4 G4 F4 | E4 D4 C4 D4 | G4 G4 F4 F4 | C4:4";

export const EXERCISE_DEFS: SongDef[] = [
  {
    id: "coord-held-c", title: "Held C, then C to G", level: 1, bpm: 80, beatsPerBar: 4, key: "C",
    rh: five("R", "C4 D4 E4 F4 | G4 F4 E4 D4 | C4 E4 G4 E4 | D4 F4 E4 D4 | D4 E4 F4 D4 | G4 F4 E4 D4 | E4 D4 E4 C4 | C4:4"),
    lh: "C3:4/5 | C3:4/5 | C3:4/5 | C3:4/5 | G2:4/5 | G2:4/5 | C3:4/5 | C3:4/5",
  },
  {
    id: "coord-half-roots", title: "Half-note roots", level: 1, bpm: 80, beatsPerBar: 4, key: "C",
    rh: five("R", "C4 D4 E4 D4 | E4 F4 G4 F4 | E4 D4 C4 D4 | E4 D4 C4:2 | G4 G4 F4 F4 | G4 F4 E4 D4 | E4 F4 E4 D4 | C4:4"),
    lh: "C3:2/5 G2:2/5 | C3:2/5 G2:2/5 | C3:2/5 F2:2/5 | C3:2/5 G2:2/5 | F2:2/5 C3:2/5 | G2:2/5 C3:2/5 | F2:2/5 G2:2/5 | C3:4/5",
  },
  {
    id: "coord-chord-pulse", title: "Chord pulse under a melody", level: 2, bpm: 76, beatsPerBar: 4, key: "C",
    rh: five("R", "E4:2 G4:2 | F4:2 C4:2 | E4:2 C4:2 | D4:2 G4:2 | G4:2 E4:2 | F4:2 C4:2 | D4:2 F4:2 | C4:4"),
    lh: [C, F, C, G, C, F, G, C].map(pulse).join(" | "),
  },
  {
    id: "coord-broken-chord", title: "Broken chord, root and fifth", level: 2, bpm: 76, beatsPerBar: 4, key: "C",
    rh: five("R", "E4 D4 C4 D4 | F4 E4 F4 G4 | E4 D4 C4 E4 | D4 E4 D4 G4 | G4 E4 C4 E4 | F4 E4 D4 C4 | D4 F4 E4 D4 | C4:4"),
    lh: "C3/5 G3/1 C3/5 G3/1 | F2/5 C3/1 F2/5 C3/1 | C3/5 G3/1 C3/5 G3/1 | G2/5 D3/1 G2/5 D3/1 | C3/5 G3/1 C3/5 G3/1 | F2/5 C3/1 F2/5 C3/1 | G2/5 D3/1 G2/5 D3/1 | C3:4/5",
  },
  {
    id: "coord-dotted-rhythm", title: "Dotted rhythm over steady roots", level: 3, bpm: 72, beatsPerBar: 4, key: "C",
    rh: five("R", "C4:1.5 D4:.5 E4:1.5 F4:.5 | G4:1.5 F4:.5 E4:1.5 D4:.5 | C4:1.5 E4:.5 G4:2 | E4:1.5 D4:.5 C4:2 | G4:1.5 F4:.5 E4:1.5 D4:.5 | E4:1.5 F4:.5 G4:2 | F4:1.5 D4:.5 E4:1.5 D4:.5 | C4:4"),
    lh: `${Array(7).fill("C3/5 G2/5 C3/5 G2/5").join(" | ")} | C3:4/5`,
  },
  {
    id: "coord-contrary", title: "Contrary motion", level: 3, bpm: 72, beatsPerBar: 4, key: "C",
    rh: five("R", `${CONTRARY_RH} | ${CONTRARY_RH}`),
    lh: five("L", `${CONTRARY_LH} | ${CONTRARY_LH}`),
  },
  {
    id: "coord-parallel", title: "Parallel motion, an octave apart", level: 4, bpm: 72, beatsPerBar: 4, key: "C",
    rh: five("R", PARALLEL),
    lh: five("L", PARALLEL.replace(/(\w)4/g, "$13")),
  },
  {
    id: "coord-alternating", title: "Hands alternating, call and response", level: 4, bpm: 72, beatsPerBar: 4, key: "C",
    rh: five("R", "C4 E4 R:2 | D4 F4 R:2 | E4 G4 R:2 | G4:2 R:2 | C4 E4 R:2 | D4 F4 R:2 | E4 D4 R:2 | C4:2 R:2"),
    lh: five("L", "R:2 G3 E3 | R:2 F3 D3 | R:2 E3 C3 | R:2 G3:2 | R:2 G3 E3 | R:2 F3 D3 | R:2 G3 D3 | R:2 C3:2"),
  },
];

export const EXERCISES: Song[] = EXERCISE_DEFS.map(buildSong);
export const exerciseById = (id: string) => EXERCISES.find((s) => s.id === id);
