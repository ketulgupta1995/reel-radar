// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Summary } from "@/lib/pianoDrill";
import { noteSpeed } from "@/lib/pianoNoteSpeed";
import { RhythmSummary } from "@/lib/pianoRhythm";
import { Results, slowLine, songTag } from "./Results";
import type { SongResult } from "./songs/SongPlayer";
import type { PlayDone } from "./songs/usePlayAlong";

afterEach(cleanup);

const drill: Summary = { attempts: 20, accuracy: 0.9, avgMs: 1400, weakest: [{ id: "F#", label: "F#", attempts: 4, misses: 1, slow: 2 }], unlockedNow: ["F G"], slowLimit: 2000 };
const song = (over: Partial<SongResult>): SongResult => ({ mode: "play", hands: "R", bpm: 85, early: false, wait: null, play: { summary: { onTimePct: 0.91 } } as unknown as PlayDone, ladder: { stepDone: false, mastered: false, step: 0, tempo: 90 }, ...over });

describe("Results cards", () => {
  it("shows a drill card with accuracy, reaction against the last round, weakest and unlocks", () => {
    render(<Results title="Round done" cards={[{ kind: "drill", tag: "Note drill", summary: drill, prevAvgMs: 2100 }]} />);
    expect(screen.getByText("Round done")).toBeTruthy();
    expect(screen.getByTestId("accuracy").textContent).toBe("90%");
    expect(screen.getByTestId("reaction").textContent).toContain("1.40");
    expect(screen.getByTestId("reaction-vs").textContent).toBe("Faster than last round (was 2.1 s)");
    expect(screen.getByTestId("weakest").textContent).toContain("F#: 1 missed, 2 slow, of 4");
    expect(screen.getByText("Unlocked: F G")).toBeTruthy();
  });

  it("says slower, same, or nothing about the last round", () => {
    const { rerender } = render(<Results cards={[{ kind: "drill", tag: "d", summary: drill, prevAvgMs: 900 }]} />);
    expect(screen.getByTestId("reaction-vs").textContent).toBe("Slower than last round (was 0.9 s)");
    rerender(<Results cards={[{ kind: "drill", tag: "d", summary: drill, prevAvgMs: 1420 }]} />);
    expect(screen.getByTestId("reaction-vs").textContent).toContain("Same as last round");
    rerender(<Results cards={[{ kind: "drill", tag: "d", summary: drill, prevAvgMs: null }]} />);
    expect(screen.queryByTestId("reaction-vs")).toBeNull();
  });

  it("handles an empty drill round and a clean one", () => {
    const { rerender } = render(<Results cards={[{ kind: "drill", tag: "d", summary: { ...drill, attempts: 0, weakest: [], unlockedNow: [] } }]} />);
    expect(screen.getByText(/nothing was saved/)).toBeTruthy();
    rerender(<Results cards={[{ kind: "drill", tag: "d", summary: { ...drill, weakest: [] } }]} />);
    expect(screen.getByText("None. A clean round.")).toBeTruthy();
  });

  it("shows a rhythm card", () => {
    const r: RhythmSummary = { attempts: 8, accuracy: 0.75, onTimeRate: 0.75, avgMs: 42, weakest: [{ id: "a", label: "Syncopation", attempts: 3, misses: 2 }], unlockedNow: ["Eighths"], windowMs: 90 };
    render(<Results cards={[{ kind: "rhythm", tag: "Rhythm drill", summary: r }]} />);
    expect(screen.getByTestId("ontime-total").textContent).toBe("75%");
    expect(screen.getByTestId("error").textContent).toBe("42 ms");
    expect(screen.getByTestId("weakest").textContent).toContain("Syncopation: 2 off, of 3");
    expect(screen.getByText("Unlocked: Eighths")).toBeTruthy();
    expect(screen.getByText(/±90 ms/)).toBeTruthy();
  });

  it("shows song cards: ladder up, step done, mastered, wait misses and stopped", () => {
    const view = (r: SongResult) => render(<Results cards={[{ kind: "song", tag: songTag("Ode to Joy", "R"), result: r }]} />);
    let v = view(song({}));
    expect(screen.getByText("Song · Ode to Joy, R hand")).toBeTruthy();
    expect(screen.getByTestId("song-big").textContent).toBe("91%");
    expect(screen.getByTestId("song-line").textContent).toBe("Ladder up: next time 90 BPM");
    v.unmount();
    v = view(song({ ladder: { stepDone: false, mastered: false, step: 0, tempo: 85 } }));
    expect(screen.getByTestId("song-line").textContent).toBe("Next time 85 BPM");
    v.unmount();
    v = view(song({ ladder: { stepDone: true, mastered: false, step: 1, tempo: null } }));
    expect(screen.getByTestId("song-line").textContent).toBe("Step done");
    v.unmount();
    v = view(song({ ladder: { stepDone: true, mastered: true, step: 3, tempo: null } }));
    expect(screen.getByTestId("song-line").textContent).toContain("Mastered");
    v.unmount();
    v = view(song({ mode: "wait", play: null, wait: { misses: 2, durationMs: 5000, played: 10, total: 10, early: false }, ladder: { stepDone: false, mastered: false, step: 0, tempo: null } }));
    expect(screen.getByTestId("song-big").textContent).toBe("2");
    expect(screen.getByTestId("song-line").textContent).toBe("Not through this step yet");
    v.unmount();
    view(song({ early: true, play: null, ladder: null }));
    expect(screen.getByTestId("song-big").textContent).toBe("Stopped");
  });

  it("shows a card per step for a session", () => {
    render(<Results cards={[{ kind: "drill", tag: "Warm-up", summary: drill }, { kind: "drill", tag: "Weak spot", summary: drill }, { kind: "song", tag: "Song", result: song({}) }]} />);
    expect(screen.getAllByTestId("result-card")).toHaveLength(3);
  });

  it("renders Done as a link and the other action as a button", () => {
    const again = vi.fn();
    render(<Results cards={[]} primary={{ label: "Done", href: "/piano" }} secondary={{ label: "Another round", onClick: again }} />);
    expect(screen.getByRole("link", { name: "Done" }).getAttribute("href")).toBe("/piano");
    fireEvent.click(screen.getByRole("button", { name: "Another round" }));
    expect(again).toHaveBeenCalled();
  });
});

describe("note-speed keyboard", () => {
  const stats = {
    C: { attempts: 5, misses: 0, slow: 0, ms: 3000, msN: 5 }, // 0.6 s
    D: { attempts: 4, misses: 0, slow: 0, ms: 5600, msN: 4 }, // 1.4 s
    "F#": { attempts: 4, misses: 0, slow: 4, ms: 10000, msN: 4 }, // 2.5 s
    "A#": { attempts: 2, misses: 2, slow: 0, ms: 0, msN: 0 }, // missed only
    E: { attempts: 6, misses: 0, slow: 0 }, // old record: no data
  };

  it("colours keys by band and shows times, missed and no data", () => {
    render(<Results cards={[]} noteSpeed={noteSpeed(stats)} />);
    const band = (n: string) => screen.getByTestId(`key-${n}`).getAttribute("data-band");
    expect([band("C"), band("D"), band("F#"), band("A#"), band("E"), band("G")]).toEqual(["fast", "ok", "slow", "slow", "none", "none"]);
    expect(screen.getByTestId("key-C").className).toContain("bg-sky-300");
    expect(screen.getByTestId("key-D").className).toContain("bg-pn-ivory");
    expect(screen.getByTestId("key-F#").className).toContain("bg-orange-400");
    expect(screen.getByTestId("key-E").className).toContain("bg-neutral-600");
    expect(screen.getByTestId("time-C").textContent).toBe("0.6 s");
    expect(screen.getByTestId("time-D").textContent).toBe("1.4 s");
    expect(screen.getByTestId("time-F#").textContent).toBe("2.5 s");
    expect(screen.getByTestId("time-A#").textContent).toBe("missed");
    expect(screen.getByTestId("time-E").textContent).toBe("no data");
    expect(screen.getByTestId("time-G#").textContent).toBe("–"); // black keys are too narrow for the words
    expect(screen.getByLabelText("G#: no data")).toBeTruthy();
    const row = screen.getByRole("group", { name: "How fast you found each note" });
    expect(within(row).getAllByRole("img")).toHaveLength(12);
    expect(within(row).getByRole("img", { name: "F#: 2.5 s, over 2 s or missed" })).toBeTruthy();
    expect(within(row).getByRole("img", { name: "A#: missed, over 2 s or missed" })).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Legend" })).getAllByRole("listitem")).toHaveLength(4);
  });

  it("names the slow keys as tomorrow's warm-up", () => {
    render(<Results cards={[]} noteSpeed={noteSpeed(stats)} />);
    expect(screen.getByTestId("slow-line").textContent).toBe("A# and F# are still slow: tomorrow's warm-up.");
  });

  it("says so when no key is slow, and when there is no timing at all", () => {
    const { rerender } = render(<Results cards={[]} noteSpeed={noteSpeed({ C: { attempts: 2, misses: 0, slow: 0, ms: 1000, msN: 2 } })} />);
    expect(screen.getByTestId("slow-line").textContent).toContain("No slow keys");
    rerender(<Results cards={[]} noteSpeed={noteSpeed({ C: { attempts: 2, misses: 0, slow: 0 } })} />);
    expect(screen.getByTestId("slow-line").textContent).toContain("No timing yet");
    rerender(<Results cards={[]} />);
    expect(screen.queryByRole("region", { name: "Note speed" })).toBeNull();
  });

  it("words one, two and three slow keys", () => {
    expect(slowLine(["F#"])).toBe("F# is still slow: tomorrow's warm-up.");
    expect(slowLine(["F#", "A#"])).toBe("F# and A# are still slow: tomorrow's warm-up.");
    expect(slowLine(["F#", "A#", "D#"])).toBe("F#, A# and D# are still slow: tomorrow's warm-up.");
  });
});
