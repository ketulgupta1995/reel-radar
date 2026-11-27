import { describe, expect, it } from "vitest";
import { MAX_MIDI_BYTES, MAX_NOTES, MidiErrorCode, MidiFileError, parseMidiFile } from "./pianoMidiFile";
import { chunk, endOfTrack, header, meta, midiFile, note, off, offVel0, on, running, sysex, tempo, timeSig, track, trackName } from "@/test/midiFile";

const fails = (bytes: Uint8Array, code: MidiErrorCode) => {
  try {
    parseMidiFile(bytes);
  } catch (e) {
    expect(e).toBeInstanceOf(MidiFileError);
    expect((e as MidiFileError).code).toBe(code);
    expect((e as MidiFileError).message.length).toBeGreaterThan(10);
    return;
  }
  throw new Error("expected an error");
};
const simple = (...events: number[][]) => midiFile([track(...events, endOfTrack())], { format: 0 });

describe("parseMidiFile", () => {
  it("reads a format 0 file: notes in beats, tempo, time signature", () => {
    const p = parseMidiFile(simple(tempo(0, 90), timeSig(0, 3, 2), ...note(60), ...note(64, 2), ...note(67, 0.5)));
    expect(p.format).toBe(0);
    expect(p.bpm).toBe(90);
    expect(p.beatsPerBar).toBe(3);
    expect(p.notes.map((n) => [n.start, n.dur, n.pitch])).toEqual([[0, 1, 60], [1, 2, 64], [3, 0.5, 67]]);
  });

  it("reads format 1: several tracks, the title from the first track name, notes merged and sorted", () => {
    const conductor = track(trackName(0, "My Song"), tempo(0, 100), endOfTrack());
    const a = track(trackName(0, "Right"), ...note(72, 1), ...note(74, 1), endOfTrack());
    const b = track(trackName(0, "Left"), ...note(48, 2), endOfTrack());
    const p = parseMidiFile(midiFile([conductor, a, b]));
    expect(p.title).toBe("My Song");
    expect(p.format).toBe(1);
    expect(p.bpm).toBe(100);
    expect(p.notes.map((n) => [n.start, n.pitch, n.track])).toEqual([[0, 48, 2], [0, 72, 1], [1, 74, 1]]);
  });

  it("defaults to 120 BPM and 4 beats a bar, scales by the division, and uses the earliest tempo", () => {
    const p = parseMidiFile(midiFile([track(...note(60, 1), endOfTrack())], { division: 96 })); // 480 ticks = 5 beats at 96
    expect(p.bpm).toBe(120);
    expect(p.beatsPerBar).toBe(4);
    expect(p.notes[0].dur).toBe(5);
    const q = parseMidiFile(simple(on(0, 60), off(480, 60), tempo(0, 80), tempo(960, 150)));
    expect(q.bpm).toBe(80); // the tempo at tick 0, though listed after a note
  });

  it("treats a 6/8 signature as 3 quarter-note beats and ignores nonsense signatures", () => {
    expect(parseMidiFile(simple(timeSig(0, 6, 3), ...note(60))).beatsPerBar).toBe(3);
    expect(parseMidiFile(simple(timeSig(0, 0, 2), ...note(60))).beatsPerBar).toBe(4);
    expect(parseMidiFile(simple(timeSig(0, 4, 200), ...note(60))).beatsPerBar).toBe(4);
  });

  it("clamps absurd tempos", () => {
    expect(parseMidiFile(simple(tempo(0, 1000), ...note(60))).bpm).toBe(240);
    expect(parseMidiFile(simple(tempo(0, 10), ...note(60))).bpm).toBe(40);
  });

  it("follows running status", () => {
    // on 60, then (running) on 62, off by velocity 0 via running status, and so on
    const p = parseMidiFile(simple(on(0, 60), running(240, 62, 64), running(240, 60, 0), running(240, 62, 0)));
    expect(p.notes.map((n) => [n.pitch, n.start, n.dur])).toEqual([[60, 0, 1], [62, 0.5, 1]]);
  });

  it("takes a note-on with velocity 0 as the note off", () => {
    const p = parseMidiFile(simple(on(0, 60), offVel0(480, 60)));
    expect(p.notes).toHaveLength(1);
    expect(p.notes[0].dur).toBe(1);
  });

  it("drops channel 10 (drums) and non-note messages, and skips sysex and unknown metas", () => {
    const p = parseMidiFile(simple(sysex(0, 1, 2, 3), meta(0, 0x7f, 9, 9), meta(0, 0x01, 65, 66), [0, 0xc0, 5], [0, 0xb0, 7, 100], [0, 0xe0, 1, 1], on(0, 36, 100, 9), off(10, 36, 9), ...note(60)));
    expect(p.notes.map((n) => n.pitch)).toEqual([60]);
  });

  it("only drums is an empty file", () => {
    fails(simple(on(0, 36, 100, 9), off(10, 36, 9)), "empty");
    fails(simple(tempo(0, 100)), "empty");
  });

  it("quantizes to a quarter beat, at least one quantum long", () => {
    const p = parseMidiFile(simple(on(50, 60), off(100, 60), on(300, 62), off(5, 62))); // starts 0.104 and 0.833..., lengths ~0.2 and 0.01
    expect(p.notes.map((n) => [n.start, n.dur])).toEqual([[0, 0.25], [1, 0.25]]);
  });

  it("closes a note left on at the end of its track, and ignores a stray off", () => {
    const p = parseMidiFile(midiFile([track(off(0, 55), on(0, 60), on(480, 62), endOfTrack(960))]));
    expect(p.notes.map((n) => [n.pitch, n.dur])).toEqual([[60, 3], [62, 2]]);
  });

  it("keeps the longer of two notes that start together on one pitch", () => {
    const p = parseMidiFile(simple(on(0, 60), on(0, 60), off(240, 60), off(240, 60)));
    expect(p.notes).toHaveLength(1);
    expect(p.notes[0].dur).toBe(1);
  });

  it("drops whole empty bars at the start but keeps a pickup's place in the bar", () => {
    const p = parseMidiFile(simple(on(480 * 8 + 480 * 3, 60), off(480, 60)));
    expect(p.notes[0].start).toBe(3); // two empty 4/4 bars removed, the pickup beat stays beat 3
  });

  it("skips unknown chunks and reads a long header", () => {
    const bytes = [...header(1, 1, 480).slice(0, 4), 0, 0, 0, 8, 0, 1, 0, 1, 1, 0xe0, 9, 9, ...chunk("XXXX", [1, 2, 3]), ...track(...note(60), endOfTrack())];
    expect(parseMidiFile(new Uint8Array(bytes)).notes).toHaveLength(1);
  });

  it("decodes a multi-byte track name and strips control characters", () => {
    const text = new TextEncoder().encode("Café\u0007 x");
    const p = parseMidiFile(simple([0, 0xff, 0x03, text.length, ...text], ...note(60)));
    expect(p.title).toBe("Café x");
  });

  it("refuses format 2 and SMPTE time with 'unsupported'", () => {
    fails(midiFile([track(...note(60), endOfTrack())], { format: 2 }), "unsupported");
    fails(midiFile([track(...note(60), endOfTrack())], { division: 0xe728 }), "unsupported");
  });

  it("rejects garbage, truncation and bad shapes with 'invalid'", () => {
    fails(new Uint8Array(0), "invalid");
    fails(new Uint8Array([1, 2, 3]), "invalid");
    fails(new Uint8Array(40).fill(7), "invalid");
    fails(new TextEncoder().encode("RIFF....WAVEfmt this is not midi at all"), "invalid");
    const good = simple(...note(60), ...note(62));
    for (let cut = 14; cut < good.length - 1; cut += 3) {
      try {
        parseMidiFile(good.subarray(0, cut));
      } catch (e) {
        expect((e as MidiFileError).code).toBe("invalid");
      }
    }
    fails(good.subarray(0, good.length - 5), "invalid"); // the track claims more bytes than there are
    fails(midiFile([track(...note(60), endOfTrack())], { format: 5 }), "invalid");
    fails(midiFile([track(...note(60), endOfTrack())], { division: 0 }), "invalid");
    fails(new Uint8Array([...header(1, 1, 480), 77, 84, 114]), "invalid"); // a chunk header cut short
    fails(new Uint8Array([...header(1, 0, 480)]), "invalid"); // no tracks
    fails(new Uint8Array([...chunk("MThd", [0, 1]), ...new Array(20).fill(0)]), "invalid"); // header too short
    fails(midiFile([track([0, 0x40, 0x40], endOfTrack())]), "invalid"); // data byte with no running status
    fails(midiFile([track([0, 0xf2, 1, 1], endOfTrack())]), "invalid"); // a system message that doesn't belong in a file
    fails(midiFile([track([0, 0x90, 60], endOfTrack())]), "invalid"); // message cut by the chunk end
    fails(midiFile([track([0, 0x90, 200, 64], endOfTrack())]), "invalid"); // data byte with the high bit set
    fails(midiFile([track([0x80, 0x80, 0x80, 0x80, 0x01, 0x90, 60, 64])]), "invalid"); // delta time of five bytes
    fails(midiFile([track([0x81])]), "invalid"); // delta cut off
    fails(midiFile([track([0])]), "invalid"); // delta with no event
    fails(midiFile([track([0, 0xff])]), "invalid"); // meta cut off
    fails(midiFile([track([0, 0xff, 0x01, 50, 65])]), "invalid"); // meta longer than the chunk
    fails(midiFile([track([0, 0xf0, 50, 1])]), "invalid"); // sysex longer than the chunk
  });

  it("ends a track at its end-of-track meta even with bytes after it", () => {
    const p = parseMidiFile(midiFile([track(...note(60), endOfTrack(), [255, 255, 255])]));
    expect(p.notes).toHaveLength(1);
  });

  it("rejects an oversized file before looking at it", () => {
    fails(new Uint8Array(MAX_MIDI_BYTES + 1), "too-big");
  });

  it("caps the number of notes, and the number of tracks", () => {
    const many = Array.from({ length: MAX_NOTES + 1 }, (_, i) => [on(i === 0 ? 0 : 1, 30 + (i % 60), 64), off(0, 30 + (i % 60))]).flat();
    fails(midiFile([track(...many, endOfTrack())]), "too-big");
    const ok = Array.from({ length: MAX_NOTES }, (_, i) => [on(i === 0 ? 0 : 1, 30 + (i % 60), 64), off(0, 30 + (i % 60))]).flat();
    expect(parseMidiFile(midiFile([track(...ok, endOfTrack())])).notes.length).toBeGreaterThan(0);
    fails(midiFile(Array.from({ length: 129 }, () => track(endOfTrack()))), "too-big");
  });

  it("always terminates on random bytes", () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const base = Array.from(simple(tempo(0, 100), ...note(60), ...note(64)));
    for (let i = 0; i < 300; i++) {
      const b = Uint8Array.from(base);
      for (let k = 0; k < 4; k++) b[Math.floor(rnd() * b.length)] = Math.floor(rnd() * 256);
      try {
        parseMidiFile(b);
      } catch (e) {
        expect(e).toBeInstanceOf(MidiFileError);
      }
    }
  });
});
