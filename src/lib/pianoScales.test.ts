import { describe, expect, it } from "vitest";
import { BOTH_UNLOCK_PCT, SCALES, SCALE_SONGS, bothUnlocked, scaleById, scaleNotes, scaleSong, scaleSongById, scaleUnlocked } from "./pianoScales";
import { handOf, songBeats, stepsOf } from "./pianoSongs";

const pitches = (id: string, h: "R" | "L") => scaleNotes(scaleById(id)!, h).map((n) => n.pitch);
const fingers = (id: string, h: "R" | "L") => scaleNotes(scaleById(id)!, h).map((n) => n.finger).join("");
const up = (a: number[]) => a.slice(0, 8);

describe("scale table", () => {
  it("lists C, G, F, D, A major and A minor in unlock order", () => {
    expect(SCALES.map((s) => s.name)).toEqual(["C major", "G major", "F major", "D major", "A major", "A minor"]);
    expect(new Set(SCALES.map((s) => s.id)).size).toBe(6);
    expect(scaleById("nope")).toBeUndefined();
  });

  it("has the right notes, one octave up and down", () => {
    expect(pitches("scale-c-major", "R")).toEqual([60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60]);
    expect(pitches("scale-c-major", "L")).toEqual(pitches("scale-c-major", "R").map((p) => p - 12));
    expect(up(pitches("scale-g-major", "R"))).toEqual([67, 69, 71, 72, 74, 76, 78, 79]); // F#
    expect(up(pitches("scale-f-major", "R"))).toEqual([65, 67, 69, 70, 72, 74, 76, 77]); // B flat
    expect(up(pitches("scale-d-major", "R"))).toEqual([62, 64, 66, 67, 69, 71, 73, 74]); // F# C#
    expect(up(pitches("scale-a-major", "R"))).toEqual([69, 71, 73, 74, 76, 78, 80, 81]); // C# F# G#
    expect(up(pitches("scale-a-minor", "R"))).toEqual([69, 71, 72, 74, 76, 77, 79, 81]); // natural minor
    for (const s of SCALES) for (const h of ["R", "L"] as const) {
      const p = pitches(s.id, h);
      expect(p).toHaveLength(15);
      expect(p.slice(7).reverse().slice(0, 8)).toEqual(p.slice(0, 8)); // down mirrors up
    }
  });

  it("uses the standard fingering", () => {
    for (const id of ["scale-c-major", "scale-g-major", "scale-d-major", "scale-a-major", "scale-a-minor"]) {
      expect(fingers(id, "R")).toBe("123123454321321");
    }
    expect(fingers("scale-f-major", "R")).toBe("123412343214321");
    for (const s of SCALES) expect(fingers(s.id, "L")).toBe("543213212312345");
  });

  it("marks where the thumb passes under and a finger crosses over", () => {
    const marks = (id: string, h: "R" | "L") => scaleNotes(scaleById(id)!, h).flatMap((n, i) => (n.cross ? [`${i}:${n.cross}`] : []));
    expect(marks("scale-c-major", "R")).toEqual(["3:under", "12:over"]);
    expect(marks("scale-f-major", "R")).toEqual(["4:under", "11:over"]); // 4 to 1 going up, 1 to 4 coming down
    expect(marks("scale-c-major", "L")).toEqual(["5:over", "10:under"]);
    expect(scaleNotes(scaleById("scale-c-major")!, "R")[0].cross).toBeUndefined();
  });
});

describe("scale songs", () => {
  it("builds a four-bar song with both hands, quarter notes and a closing half note", () => {
    expect(SCALE_SONGS).toHaveLength(6);
    for (const s of SCALE_SONGS) {
      expect(songBeats(s)).toBe(16);
      expect(handOf(s.notes, "R")).toHaveLength(15);
      expect(handOf(s.notes, "L")).toHaveLength(15);
      expect(stepsOf(s)).toHaveLength(15);
      expect(s.notes.every((n) => n.finger >= 1 && n.finger <= 5)).toBe(true);
    }
    const c = scaleSong(SCALES[0]);
    expect(c.title).toBe("C major scale");
    expect(c.notes.filter((n) => n.cross).map((n) => `${n.hand}${n.start}:${n.cross}`)).toEqual(["R3:under", "L5:over", "L10:under", "R12:over"]);
    expect(scaleSongById("scale-g-major")?.key).toBe("G");
    expect(scaleSongById("nope")).toBeUndefined();
  });

  it("opens each scale after the previous one's right hand, and both hands after a good play-along", () => {
    const none = () => undefined;
    expect(scaleUnlocked(0, none)).toBe(true);
    expect(scaleUnlocked(1, none)).toBe(false);
    expect(scaleUnlocked(1, (id) => (id === "scale-c-major" ? { step: 1 } : undefined))).toBe(true);
    expect(scaleUnlocked(2, (id) => (id === "scale-c-major" ? { step: 3 } : undefined))).toBe(false); // needs G
    expect(bothUnlocked()).toBe(false);
    expect(bothUnlocked({ best: BOTH_UNLOCK_PCT - 1 })).toBe(false);
    expect(bothUnlocked({ best: BOTH_UNLOCK_PCT })).toBe(true);
  });
});
