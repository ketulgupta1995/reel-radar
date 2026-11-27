// @vitest-environment jsdom
// The song player's practice tools: bar loops (with their own ladder and "Practise bar N"), the chord line of melody +
// chords songs, record and replay of the last run, and evenness of touch in scale mode.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { installFakeAudio } from "@/test/audio";
import { fakeMidi, uninstallMidi } from "@/test/midi";
import { openSettings } from "@/test/stage";
import { SCALES, scaleSong } from "@/lib/pianoScales";
import { songById } from "@/lib/pianoSongLibrary";
import { buildSong, handOf } from "@/lib/pianoSongs";
import PianoLayout from "../layout";
import { SongPlayer } from "./SongPlayer";

vi.mock("next/navigation", () => ({ usePathname: () => "/piano/songs" }));

let midi: ReturnType<typeof fakeMidi>;
const mary = songById("mary-had-a-little-lamb")!;
// Two bars over C then G; bpm 100, so a play-along run starts at 60 BPM (a beat every second).
const two = buildSong({ id: "two", title: "Two", level: 1, bpm: 100, beatsPerBar: 4, key: "C", rh: "C4/1 D4/2 E4/3 F4/4 | G4/5 F4/4 E4/3 D4/2", chords: "C | G" });
const open = async (ui: React.ReactElement) => {
  render(<PianoLayout>{ui}</PianoLayout>);
  await act(async () => {});
};
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(Math.max(0, ms)));
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const tap = (n: number, velocity = 100) => {
  act(() => midi.noteOn(n, velocity, performance.now()));
  act(() => midi.noteOff(n, performance.now()));
};
const saved = () => Object.entries(localStorage).filter(([k]) => /^reel-radar-piano-\d{4}-\d{2}$/.test(k)).flatMap(([, v]) => Object.values(JSON.parse(v).items)) as { drill: string; items: Record<string, { attempts: number; misses: number }> }[];
const settingsSongs = () => JSON.parse(localStorage.getItem("reel-radar-piano-settings") || "{}").songs ?? {};
const loops = () => JSON.parse(localStorage.getItem("reel-radar-piano-loops") || "{}");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 27, 10, 0, 0));
  installFakeAudio();
  localStorage.clear();
  midi = fakeMidi();
  midi.install();
  midi.plug();
});
afterEach(() => {
  uninstallMidi();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("bar loops", () => {
  it("loops bars 2-3 in wait mode, speeds up after a clean run, repeats until Stop and leaves the song's ladder alone", async () => {
    await open(<SongPlayer song={mary} />);
    openSettings();
    expect(screen.getByRole("list", { name: "Hands ladder" })).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Loop"));
    fireEvent.change(screen.getByLabelText("From bar"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("To bar"), { target: { value: "3" } });
    expect(screen.getByTestId("loop-tag").textContent).toBe("Loop bars 2–3");
    expect(screen.getByTestId("loop-ladder").textContent).toContain("Loop speed 50%");
    expect(screen.getByTestId("speed").textContent).toBe("50%");
    expect(screen.queryByRole("list", { name: "Hands ladder" })).toBeNull();
    expect(screen.getByTestId("start-summary").textContent).toBe("Right hand · Wait, 50% speed · loop bars 2–3");

    click("Start");
    for (const n of [64, 64, 64, 62, 62, 62]) tap(n); // E E E | D D D
    expect(screen.getByText("Next run in a moment…")).toBeTruthy();
    expect(screen.getByTestId("speed").textContent).toBe("60%"); // a clean run: +10%
    expect(loops()).toEqual({ "mary-had-a-little-lamb:2-3": { tempo: 60, speed: 60 } });
    wait(1500);
    expect(screen.getByTestId("loop-tag").textContent).toBe("Loop bars 2–3 · run 2");
    tap(64);
    click("Stop");
    wait(3000);
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull(); // no restart after Stop
    expect(screen.queryByRole("button", { name: "Stop loop" })).toBeNull();
    expect(saved().map((r) => r.drill)).toEqual(["songs", "songs"]); // both runs count as practice
    expect(settingsSongs()).toEqual({}); // but the song's ladders didn't move

    fireEvent.click(screen.getByLabelText("Loop")); // off again: the whole song and its ladder
    expect(screen.queryByTestId("loop-tag")).toBeNull();
    expect(screen.getByRole("list", { name: "Hands ladder" })).toBeTruthy();
  });

  it("stops a loop between runs with Stop loop", async () => {
    await open(<SongPlayer song={mary} />);
    openSettings();
    fireEvent.click(screen.getByLabelText("Loop"));
    fireEvent.change(screen.getByLabelText("To bar"), { target: { value: "1" } });
    expect(screen.getByTestId("loop-tag").textContent).toBe("Loop bar 1");
    click("Start");
    for (const n of [64, 62, 61, 60, 62]) tap(n); // E D (wrong C#) C D: a miss, so no speed-up
    expect(screen.getByTestId("speed").textContent).toBe("50%");
    click("Stop loop");
    wait(3000);
    expect(screen.getByRole("button", { name: "Play again" })).toBeTruthy();
  });

  it("names the bar you rush in, practises it as a loop on its own tempo ladder, and shows the chords as they come", async () => {
    await open(<SongPlayer song={two} mode="play" hands="R" />);
    openSettings();
    expect(screen.getByTestId("chord-song")).toBeTruthy();
    const t0 = performance.now() + 60;
    click("Start");
    const notes = handOf(two.notes, "R");
    notes.forEach((n, i) => {
      const at = t0 + 4000 + n.start * 1000 + (i >= 4 ? -40 : 0); // bar 2 is 40 ms early
      wait(at + 1 - performance.now());
      if (i === 0) expect(screen.getByTestId("chord-now").textContent).toBe("Chord C → G");
      if (i === 5) expect(screen.getByTestId("chord-now").textContent).toBe("Chord G");
      act(() => midi.noteOn(n.pitch, 100, at));
    });
    wait(t0 + 12_400 - performance.now());
    expect(screen.getByTestId("pa-bars").textContent).toContain("rush in bar 2");
    click("Practise bar 2");
    expect(screen.getByTestId("loop-tag").textContent).toBe("Loop bar 2");
    expect(screen.getByTestId("song-meta").textContent).toBe("Right hand · Play-along · 60 BPM"); // the loop's own ladder starts low

    // One loop run, all on time: the loop's tempo goes up; the bar is still counted in the whole song.
    const t1 = performance.now() + 60;
    click("Start");
    expect(screen.getByTestId("chord-now").textContent).toBe("Chord G");
    notes.slice(4).forEach((n) => {
      const at = t1 + 4000 + (n.start - 4) * 1000;
      wait(at + 1 - performance.now());
      act(() => midi.noteOn(n.pitch, 100, at));
    });
    wait(t1 + 8400 - performance.now());
    expect(loops()).toEqual({ "two:2-2": { tempo: 65, speed: 50 } });
    expect(screen.getByTestId("pa-ontime").textContent).toBe("100%");
    expect(screen.getByTestId("song-meta").textContent).toBe("Right hand · Play-along · 65 BPM");
    wait(1600); // the next run starts by itself
    expect(screen.getByTestId("progress").textContent).toBe("Count-in… listen");
    click("Stop");
    wait(10_000);
    expect(screen.getByTestId("start-summary").textContent).toBe("Right hand · Play-along, 65 BPM · loop bar 2");
  });

  it("stays ready when the looped bars have nothing to play", async () => {
    const gap = buildSong({ id: "gap", title: "Gap", level: 1, bpm: 100, beatsPerBar: 4, key: "C", rh: "C4:4/1 | R:4 | E4:4/3", lh: "C3:4/5 | R:4 | C3:4/5" });
    await open(<SongPlayer song={gap} />);
    openSettings();
    fireEvent.click(screen.getByLabelText("Loop"));
    fireEvent.change(screen.getByLabelText("From bar"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("To bar"), { target: { value: "2" } });
    click("Start");
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy(); // no run that can never end
    expect(screen.queryByText("Next run in a moment…")).toBeNull();
  });

  it("offers no loop in a session step, and shows the chord sounding from the start", async () => {
    await open(<SongPlayer song={songById("old-macdonald")!} autoStart hands="R" mode="wait" onFinish={() => {}} />);
    expect(screen.getByTestId("chord-now").textContent).toBe("Chord C → F");
    openSettings();
    expect(screen.queryByLabelText("Loop")).toBeNull();
  });
});

describe("record and replay", () => {
  it("keeps the last run and plays it back with the keys lit, also after reopening the song", async () => {
    await open(<SongPlayer song={mary} />);
    expect(screen.queryByRole("button", { name: "Hear your run" })).toBeNull();
    click("Start");
    act(() => midi.noteOn(64, 70, performance.now()));
    wait(400);
    act(() => midi.noteOff(64, performance.now()));
    wait(100);
    tap(62, 90);
    click("Stop");
    const before = midi.sent().length;
    click("Hear your run");
    expect(screen.getByRole("button", { name: "Stop replay" })).toBeTruthy();
    wait(1);
    expect(midi.sent().slice(before)).toEqual([[0x90, 64, 70]]);
    expect(document.querySelector('[aria-label="E4"]')!.getAttribute("data-state")).toBe("pressed");
    wait(450);
    expect(document.querySelector('[aria-label="E4"]')!.getAttribute("data-state")).not.toBe("pressed");
    wait(1000);
    expect(screen.getByRole("button", { name: "Hear your run" })).toBeTruthy(); // done
    expect(midi.sent().slice(before).filter((d) => d[0] === 0x90).map((d) => d[1])).toEqual([64, 62]);

    click("Hear your run");
    click("Stop replay");
    expect(screen.getByRole("button", { name: "Hear your run" })).toBeTruthy();

    cleanup();
    await open(<SongPlayer song={mary} />);
    expect(screen.getByRole("button", { name: "Hear your run" })).toBeTruthy(); // kept on the device
    cleanup();
    await open(<SongPlayer song={two} />);
    expect(screen.queryByRole("button", { name: "Hear your run" })).toBeNull(); // another song's run
  });
});

describe("evenness of touch in scale mode", () => {
  it("shows how evenly each finger played after a run on the keyboard", async () => {
    const scale = scaleSong(SCALES[0]);
    await open(<SongPlayer song={scale} scale />);
    click("Start");
    for (const n of handOf(scale.notes, "R")) tap(n.pitch, n.finger === 1 ? 115 : 80);
    const touch = screen.getByRole("region", { name: "Touch" });
    expect(touch.textContent).toContain("Evenness of touch");
    expect(screen.getByTestId("touch-line").textContent).toBe("Thumb plays harder than the others.");
  });
});
