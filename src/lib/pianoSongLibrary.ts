// The built-in songs: public-domain tunes in the compact notation of parseHand (pianoSongs.ts), easiest first.
// Fingering is written by hand (right hand: thumb on the key the hand position starts on; hands are
// moved where a tune goes past five notes). The left hand is a simple part: chord roots in the first
// songs, 5-3-1 triads after that. Where a tune is simplified, the comment says so.
import { Song, SongDef, buildSong } from "./pianoSongs";

const C = "C3+E3+G3", F = "F2+A2+C3", G = "G2+B2+D3", Am = "A2+C3+E3", Em = "E2+G2+B2", D = "D3+F#3+A3", E = "E2+G#2+B2";
const tri = (chord: string, beats: number) => `${chord}:${beats}/5+3+1`;

// Greensleeves, shared first four bars of each strain.
const GS_OPEN = "C5:2/2 D5/3 | E5:1.5/4 F5:.5/5 E5/4 | D5:2/3 B4/1 | G4:1.5/1 A4:.5/2 B4/3";

export const SONG_DEFS: SongDef[] = [
  {
    id: "mary-had-a-little-lamb", title: "Mary Had a Little Lamb", level: 1, bpm: 100, beatsPerBar: 4, key: "C",
    rh: "E4/3 D4/2 C4/1 D4/2 | E4/3 E4/3 E4:2/3 | D4/2 D4/2 D4:2/2 | E4/3 G4/5 G4:2/5 | E4/3 D4/2 C4/1 D4/2 | E4/3 E4/3 E4/3 E4/3 | D4/2 D4/2 E4/3 D4/2 | C4:4/1",
    lh: "C3:4/5 | C3:4/5 | G2:4/5 | C3:4/5 | C3:4/5 | C3:4/5 | G2:4/5 | C3:4/5",
  },
  {
    id: "twinkle-twinkle", title: "Twinkle, Twinkle, Little Star", level: 1, bpm: 100, beatsPerBar: 4, key: "C",
    rh: "C4/1 C4/1 G4/4 G4/4 | A4/5 A4/5 G4:2/4 | F4/4 F4/4 E4/3 E4/3 | D4/2 D4/2 C4:2/1 | G4/5 G4/5 F4/4 F4/4 | E4/3 E4/3 D4:2/2 | G4/5 G4/5 F4/4 F4/4 | E4/3 E4/3 D4:2/2"
      + " | C4/1 C4/1 G4/4 G4/4 | A4/5 A4/5 G4:2/4 | F4/4 F4/4 E4/3 E4/3 | D4/2 D4/2 C4:2/1",
    lh: "C3:4/5 | F2:2/5 C3:2/5 | F2:2/5 C3:2/5 | G2:2/5 C3:2/5 | C3:2/5 F2:2/5 | C3:2/5 G2:2/5 | C3:2/5 F2:2/5 | C3:2/5 G2:2/5"
      + " | C3:4/5 | F2:2/5 C3:2/5 | F2:2/5 C3:2/5 | G2:2/5 C3:2/5",
  },
  {
    id: "frere-jacques", title: "Frère Jacques", level: 2, bpm: 100, beatsPerBar: 4, key: "C",
    rh: "C4/1 D4/2 E4/3 C4/1 | C4/1 D4/2 E4/3 C4/1 | E4/3 F4/4 G4:2/5 | E4/3 F4/4 G4:2/5 | G4:.5/4 A4:.5/5 G4:.5/4 F4:.5/3 E4/2 C4/1 | G4:.5/4 A4:.5/5 G4:.5/4 F4:.5/3 E4/2 C4/1 | C4/3 G3/1 C4:2/3 | C4/3 G3/1 C4:2/3",
    lh: "C3:4/5 | C3:4/5 | C3:4/5 | C3:4/5 | G2:2/5 C3:2/5 | G2:2/5 C3:2/5 | C3:4/5 | C3:4/5",
  },
  {
    id: "ode-to-joy", title: "Ode to Joy", level: 2, bpm: 100, beatsPerBar: 4, key: "C",
    rh: "E4/3 E4/3 F4/4 G4/5 | G4/5 F4/4 E4/3 D4/2 | C4/1 C4/1 D4/2 E4/3 | E4:1.5/3 D4:.5/2 D4:2/2"
      + " | E4/3 E4/3 F4/4 G4/5 | G4/5 F4/4 E4/3 D4/2 | C4/1 C4/1 D4/2 E4/3 | D4:1.5/2 C4:.5/1 C4:2/1"
      + " | D4/2 D4/2 E4/3 C4/1 | D4/2 E4:.5/3 F4:.5/4 E4/3 C4/1 | D4/2 E4:.5/3 F4:.5/4 E4/3 D4/2 | C4/4 D4/5 G3:2/1"
      + " | E4/3 E4/3 F4/4 G4/5 | G4/5 F4/4 E4/3 D4/2 | C4/1 C4/1 D4/2 E4/3 | D4:1.5/2 C4:.5/1 C4:2/1",
    lh: "C3:4/5 | C3:2/5 G2:2/5 | C3:4/5 | C3:2/5 G2:2/5 | C3:4/5 | C3:2/5 G2:2/5 | C3:4/5 | G2:2/5 C3:2/5"
      + " | G2:2/5 C3:2/5 | G2:2/5 C3:2/5 | C3:2/5 G2:2/5 | C3:2/5 G2:2/5"
      + " | C3:4/5 | C3:2/5 G2:2/5 | C3:4/5 | G2:2/5 C3:2/5",
  },
  {
    // The chorus as first played; it ends on the lead-in D G that goes back to the top.
    id: "jingle-bells", title: "Jingle Bells (chorus)", level: 2, bpm: 110, beatsPerBar: 4, key: "C",
    rh: "E4/3 E4/3 E4:2/3 | E4/3 E4/3 E4:2/3 | E4/3 G4/5 C4:1.5/1 D4:.5/2 | E4:4/3 | F4/4 F4/4 F4:1.5/4 F4:.5/4 | F4/4 E4/3 E4/3 E4:.5/3 E4:.5/3 | E4/3 D4/2 D4/2 E4/3 | D4:2/2 G4:2/5",
    lh: "C3:4/5 | C3:4/5 | C3:4/5 | C3:4/5 | F2:4/5 | C3:4/5 | C3:2/5 G2:2/5 | G2:4/5",
  },
  {
    id: "when-the-saints", title: "When the Saints Go Marching In", level: 2, bpm: 110, beatsPerBar: 4, key: "C",
    // Simplified: every note a quarter (the long notes on "saints" and "in" are not held).
    rh: "C4/1 E4/3 F4/4 G4/5 | C4/1 E4/3 F4/4 G4/5 | C4/1 E4/3 F4/4 G4/5 | E4/3 C4/1 E4/3 D4/2 | E4/3 E4/3 D4/2 C4/1 | E4/3 G4/5 G4/5 F4/4 | E4/3 F4/4 G4/5 E4/3 | C4/1 D4/2 C4:2/1",
    lh: "C3:4/5 | C3:4/5 | C3:4/5 | G2:4/5 | C3:4/5 | F2:4/5 | C3:4/5 | G2:2/5 C3:2/5",
  },
  {
    id: "happy-birthday", title: "Happy Birthday", level: 3, bpm: 90, beatsPerBar: 3, key: "C",
    rh: "G4:.75/1 G4:.25/1 | A4/2 G4/1 C5/4 | B4:2/3 G4:.75/1 G4:.25/1 | A4/2 G4/1 D5/5 | C5:2/4 G4:.75/1 G4:.25/1"
      + " | G5/5 E5/4 C5/3 | B4/2 A4/1 F5:.75/5 F5:.25/5 | E5/4 C5/2 D5/3 | C5:3/2",
    lh: `R:1 | ${tri(C, 3)} | ${tri(G, 3)} | ${tri(G, 3)} | ${tri(C, 3)} | ${tri(C, 3)} | ${tri(G, 3)} | ${tri(G, 3)} | ${tri(C, 3)}`,
  },
  {
    id: "amazing-grace", title: "Amazing Grace", level: 3, bpm: 80, beatsPerBar: 3, key: "G",
    rh: "D4/1 | G4:2/3 B4:.5/4 G4:.5/3 | B4:2/4 A4/3 | G4:2/3 E4/2 | D4:2/1 D4/1 | G4:2/3 B4:.5/4 G4:.5/3 | B4:2/4 A4/3 | D5:2/5 B4/3 | D5:2/5 B4/3"
      + " | G4:2/2 E4/1 | G4:2/2 E4/1 | D4:2/1 D4/1 | G4:2/3 B4:.5/4 G4:.5/3 | B4:2/4 A4/3 | G4:3/3",
    lh: `R:1 | ${tri(G, 3)} | ${tri(G, 3)} | ${tri(C, 3)} | ${tri(G, 3)} | ${tri(G, 3)} | ${tri(G, 3)} | ${tri(G, 3)} | ${tri(G, 3)}`
      + ` | ${tri(C, 3)} | ${tri(C, 3)} | ${tri(G, 3)} | ${tri(G, 3)} | ${tri(G, 3)} | ${tri(G, 3)}`,
  },
  {
    // Pachelbel's canon, simplified: the famous descending line in half notes over the eight-chord ground
    // bass, moved from D to C so it stays on the white keys.
    id: "canon", title: "Canon (Pachelbel, simplified)", level: 4, bpm: 76, beatsPerBar: 4, key: "C",
    rh: "E5:2/5 D5:2/4 | C5:2/3 B4:2/2 | A4:2/2 G4:2/1 | A4:2/2 B4:2/3 | C5:2/4 B4:2/3 | A4:2/2 G4:2/1 | F4:2/2 E4:2/1 | F4:2/3 D4:2/1",
    lh: `${tri(C, 2)} ${tri(G, 2)} | ${tri(Am, 2)} ${tri(Em, 2)} | ${tri(F, 2)} ${tri(C, 2)} | ${tri(F, 2)} ${tri(G, 2)}`
      + ` | ${tri(C, 2)} ${tri(G, 2)} | ${tri(Am, 2)} ${tri(Em, 2)} | ${tri(F, 2)} ${tri(C, 2)} | ${tri(F, 2)} ${tri(G, 2)}`,
  },
  {
    // Petzold's minuet, the first eight bars (the A section, without its repeat).
    id: "minuet-in-g", title: "Minuet in G (Petzold)", level: 4, bpm: 100, beatsPerBar: 3, key: "G",
    rh: "D5/5 G4:.5/1 A4:.5/2 B4:.5/3 C5:.5/4 | D5/5 G4/1 G4/1 | E5/5 C5:.5/1 D5:.5/2 E5:.5/3 F#5:.5/4 | G5/5 G4/1 G4/1"
      + " | C5/4 D5:.5/5 C5:.5/4 B4:.5/3 A4:.5/2 | B4/3 C5:.5/4 B4:.5/3 A4:.5/2 G4:.5/1 | F#4/1 G4:.5/2 A4:.5/3 B4:.5/4 G4:.5/2 | A4:3/3",
    lh: [G, G, C, G, C, G, D, D].map((c) => tri(c, 3)).join(" | "),
  },
  {
    // Simplified: the first strain and the closing phrase of the second, in 3/4 (the tune is usually written in 6/8).
    id: "greensleeves", title: "Greensleeves", level: 4, bpm: 90, beatsPerBar: 3, key: "A minor",
    rh: `A4/1 | ${GS_OPEN} | C5:2/4 A4/2 | A4:1.5/2 G#4:.5/1 A4/2 | B4:2/3 G#4/1 | E4:2/1 A4/4 | ${GS_OPEN} | C5:1.5/4 B4:.5/3 A4/2 | G#4:1.5/2 F#4:.5/1 G#4/2 | A4:3/1`,
    lh: `R:1 | ${[Am, Am, G, G, Am, Am, E].map((c) => tri(c, 3)).join(" | ")} | ${tri(Am, 2)} R:1 | ${[Am, Am, G, G, Am, E, Am].map((c) => tri(c, 3)).join(" | ")}`,
  },
  {
    // The opening: the famous eight notes and the two answers, in 3/8 counted as eighth-note beats
    // (a sixteenth is half a beat). The left hand only adds chords.
    id: "fur-elise", title: "Für Elise (opening)", level: 5, bpm: 110, beatsPerBar: 3, key: "A minor",
    rh: "E5:.5/4 D#5:.5/3 | E5:.5/4 D#5:.5/3 E5:.5/4 B4:.5/1 D5:.5/3 C5:.5/2 | A4/2 R:.5 C4:.5/1 E4:.5/2 A4:.5/5 | B4/2 R:.5 E4:.5/1 G#4:.5/2 B4:.5/5 | C5/3 R:1 E5:.5/4 D#5:.5/3"
      + " | E5:.5/4 D#5:.5/3 E5:.5/4 B4:.5/1 D5:.5/3 C5:.5/2 | A4/2 R:.5 C4:.5/1 E4:.5/2 A4:.5/5 | B4/2 R:.5 E4:.5/1 C5:.5/3 B4:.5/2 | A4:3/1",
    lh: `R:1 | R:3 | ${tri(Am, 3)} | ${tri(E, 3)} | ${tri(Am, 3)} | R:3 | ${tri(Am, 3)} | ${tri(E, 3)} | ${tri(Am, 3)}`,
  },
  // Indian songs: public-domain and traditional tunes. Pitches follow published letter-note charts (Sa = C,
  // or Sa = G for the aarti); the rhythm is simplified to even quarters with each phrase's last note held.
  {
    // Tagore's national anthem, the full version. Where charts differ ("Maratha", "jaya he") the majority reading is used.
    id: "jana-gana-mana", title: "Jana Gana Mana", level: 3, bpm: 80, beatsPerBar: 4, key: "C",
    rh: "C4/1 D4/2 E4/3 E4/3 | E4/3 E4/3 E4/3 E4/3 | E4/3 E4/3 E4/3 D4/2 | E4/3 F4:3/4 | E4/4 E4/4 E4/4 D4/3 | D4/3 D4/3 B3/1 D4/3 | C4:4/2 | C4/1 G4/5 G4/5 G4/5 | G4/5 G4/5 G4/5 G4/5 | G4/5 G4/5 F#4/3 A4/5 | G4:4/4 | F4/3 F4/3 F4/3 E4/2 | E4/2 E4/2 D4/1 F4/3 | E4:4/2 | E4:2/2 E4/2 E4/2 | E4/2 E4/2 D4/1 G4/4 | G4/4 G4/4 F4/3 F4/3 | F4:4/3 | E4/4 E4/4 E4/4 D4/3 | D4/3 D4/3 D4/3 B3/1 | D4/3 C4:3/2 | C4/1 D4/2 E4/3 E4/3 | E4/3 E4/3 D4/2 E4/3 | F4:4/4 | E4/3 F4/4 G4/5 G4/5 | G4/5 F4/4 E4/3 D4/2 | F4/4 E4:3/3 | E4/4 E4/4 D4/3 D4/3 | D4/3 D4/3 B3/1 D4/3 | C4:4/2 | G4/4 G4/4 G4/4 G4/4 | G4/4 G4/4 G4/4 G4/4 | G4/4 G4/4 F#4/3 A4/5 | G4:4/4 | F4/3 F4/3 F4/3 E4/2 | E4/2 E4/2 D4/1 F4/3 | E4:4/2 | B4/3 B4/3 C5:2/4 | B4/3 A4/2 B4:2/3 | A4/2 G4/1 A4:2/2 | C4/1 C4/1 D4/2 D4/2 | E4/3 E4/3 D4/2 E4/3 | F4:4/4",
    lh: "C3:4/5 | C3:4/5 | C3:4/5 | F2:4/5 | C3:4/5 | G2:4/5 | C3:4/5 | C3:4/5 | C3:4/5 | C3:4/5 | C3:4/5 | F2:4/5 | C3:4/5 | C3:4/5 | C3:4/5 | C3:4/5 | C3:4/5 | F2:4/5 | C3:4/5 | G2:4/5 | C3:4/5 | C3:4/5 | C3:4/5 | F2:4/5 | C3:4/5 | C3:4/5 | C3:4/5 | C3:4/5 | G2:4/5 | C3:4/5 | C3:4/5 | C3:4/5 | C3:4/5 | C3:4/5 | F2:4/5 | C3:4/5 | C3:4/5 | C3:4/5 | G2:4/5 | F2:4/5 | C3:4/5 | C3:4/5 | F2:4/5",
  },
  {
    // Ram Dhun (Paluskar's tune): the first verse and a return to the opening. The black keys are komal Re (D#), Dha (G#) and Ni (A#).
    id: "raghupati-raghava", title: "Raghupati Raghava Raja Ram", level: 3, bpm: 90, beatsPerBar: 4, key: "C",
    rh: "G3/1 C4/4 C4/4 C4/4 | C4/4 D4/5 C4/4 B3/3 | A3:4/2 | A3/2 B3/3 D4/1 D4/1 | F4/3 E4/2 F4:2/3 | D4/4 D#4/5 D4/4 C4/3 | A#3/2 A3/1 A3/1 D4/4 | C4:4/3 | C4:2/1 E4/3 E4/3 | E4/3 E4/3 D4/2 C4/1 | D4/2 E4/3 F4/4 E4/3 | F4:4/4 | D4/2 D4/2 F4/3 G4/4 | G#4/5 G4/4 F4/3 D#4/3 | D4/2 C4:3/1 | G3/1 C4/4 C4/4 C4/4 | C4/4 D4/5 C4/4 B3/3 | A3:4/2 | A3/2 B3/3 D4/1 D4/1 | F4/3 E4/2 F4:2/3 | D4/4 D#4/5 D4/4 C4/3 | A#3/2 A3/1 A3/1 D4/4 | C4:4/3",
    lh: "C3:4/5 | C3:4/5 | F2:4/5 | G2:4/5 | F2:4/5 | G2:4/5 | F2:4/5 | C3:4/5 | C3:4/5 | C3:4/5 | C3:4/5 | F2:4/5 | G2:4/5 | C3:4/5 | C3:4/5 | C3:4/5 | C3:4/5 | F2:4/5 | G2:4/5 | F2:4/5 | G2:4/5 | F2:4/5 | C3:4/5",
  },
  {
    // The aarti's first stanza and its refrain.
    id: "om-jai-jagdish-hare", title: "Om Jai Jagdish Hare", level: 3, bpm: 90, beatsPerBar: 4, key: "G",
    rh: "G4:2/2 G4/2 G4/2 | G4/2 G4/2 F#4/1 G4/2 | A4:4/3 | A4/1 B4/2 C5/3 D5/4 | E5/5 D5/4 C5/3 B4/2 | C5/3 A4:3/1 | A4/2 B4/3 A4/2 B4/3 | C5/4 C5/4 B4:2/3 | A4:2/2 B4/3 A4/2 | G4:4/1 | G4/3 A4/4 B4/5 A4/4 | G4/3 F#4/2 G4/3 F#4/2 | E4:4/1 | A4/4 A4/4 A4/4 A4/4 | B4/5 A4/4 G4/3 F#4/2 | G4:4/3",
    lh: "G2:4/5 | G2:4/5 | D3:4/5 | G2:4/5 | G2:4/5 | D3:4/5 | G2:4/5 | G2:4/5 | D3:4/5 | G2:4/5 | G2:4/5 | G2:4/5 | C3:4/5 | D3:4/5 | G2:4/5 | G2:4/5",
  },
];

export const SONGS: Song[] = SONG_DEFS.map(buildSong);
export const songById = (id: string) => SONGS.find((s) => s.id === id);
