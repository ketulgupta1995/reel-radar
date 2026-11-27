// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { keyLayout } from "@/components/PianoKeyboard";
import { installFakeAudio } from "@/test/audio";
import { fakeMidi, uninstallMidi } from "@/test/midi";
import { openSettings } from "@/test/stage";
import { keyboardRange } from "@/lib/pianoKeyboardRange";
import { songById } from "@/lib/pianoSongLibrary";
import { Song, handOf, songBeats, stepsOf } from "@/lib/pianoSongs";
import PianoLayout from "../layout";
import { FallingNotes, PX_PER_BEAT, VIEW_H } from "./FallingNotes";
import { SongPlayer, SongResult } from "./SongPlayer";

vi.mock("next/navigation", () => ({ usePathname: () => "/piano/songs" }));

let midi: ReturnType<typeof fakeMidi>;
const mary = songById("mary-had-a-little-lamb")!;
const ode = songById("ode-to-joy")!;
const open = async (ui: React.ReactElement) => {
  render(<PianoLayout>{ui}</PianoLayout>);
  await act(async () => {});
};
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));

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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// A ResizeObserver that reports whatever size the test gives it.
const stubResize = () => {
  const watchers: ((e: ResizeObserverEntry[]) => void)[] = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      cb: (e: ResizeObserverEntry[]) => void;
      constructor(cb: (e: ResizeObserverEntry[]) => void) {
        this.cb = cb;
        watchers.push(cb);
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  return (width: number, height: number) => act(() => watchers.forEach((w) => w([{ contentRect: { width, height } } as ResizeObserverEntry])));
};

describe("Song player on the stage", () => {
  it("keeps hands and mode in the settings sheet, which change the start summary and the top bar", async () => {
    await open(<SongPlayer song={mary} />);
    expect(screen.getByTestId("stage")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Hands" })).toBeNull();
    expect(screen.getByTestId("song-meta").textContent).toBe("Right hand · Wait · 100 BPM");
    openSettings();
    fireEvent.click(screen.getByRole("button", { name: "Left hand" }));
    fireEvent.click(screen.getByRole("button", { name: "Play-along" }));
    expect(screen.getByTestId("song-meta").textContent).toBe("Left hand · Play-along · 60 BPM");
    expect(screen.getByTestId("start-summary").textContent).toBe("Left hand · Play-along, 60 BPM");
    expect(screen.getByLabelText("Click during the song")).toBeTruthy();
    expect(screen.getByRole("list", { name: "Hands ladder" })).toBeTruthy();
  });

  it("shows a Stop button and a progress bar in the top bar while playing, not the start button", async () => {
    await open(<SongPlayer song={mary} />);
    click("Start");
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
    expect(screen.getByRole("progressbar", { name: "Song progress" }).getAttribute("aria-valuenow")).toBe("0");
    for (const n of handOf(mary.notes, "R").slice(0, 3)) {
      act(() => midi.noteOn(n.pitch));
      act(() => midi.noteOff(n.pitch));
    }
    expect(Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"))).toBeGreaterThan(0);
    click("Stop");
    expect(screen.getByRole("region", { name: "Song summary" }).textContent).toContain("Stopped");
    expect(screen.getByRole("button", { name: "Play again" })).toBeTruthy();
  });

  it("shows on-time, early and late counts during a play-along run", async () => {
    await open(<SongPlayer song={mary} mode="play" hands="R" />);
    const t0 = performance.now() + 60;
    click("Start");
    const first = handOf(mary.notes, "R")[0];
    wait(t0 + 4100 - performance.now());
    act(() => midi.noteOn(first.pitch, 100, t0 + 4000 + 5));
    wait(60);
    expect(screen.getByTestId("counts").textContent).toBe("1 on time · 0 early · 0 late");
  });

  it("shows the summary in place of the falling notes after a run, and the notes again on Play again", async () => {
    await open(<SongPlayer song={mary} />);
    expect(screen.getByRole("img", { name: "Falling notes" })).toBeTruthy();
    click("Start");
    const first = handOf(mary.notes, "R")[0];
    act(() => midi.noteOn(first.pitch));
    act(() => midi.noteOff(first.pitch));
    click("Stop");
    expect(screen.getByRole("region", { name: "Song summary" })).toBeTruthy();
    expect(screen.queryByRole("img", { name: "Falling notes" })).toBeNull();
    click("Play again");
    expect(screen.getByRole("img", { name: "Falling notes" })).toBeTruthy();
  });

  it("scrolls the keyboard to the current step when it is off screen on a narrow screen", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(2000);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
    const song: Song = { id: "wide", title: "Wide", bpm: 60, beatsPerBar: 4, level: 1, notes: [{ start: 0, dur: 1, pitch: 48, hand: "R", finger: 1 }, { start: 1, dur: 1, pitch: 50, hand: "R", finger: 2 }, { start: 2, dur: 1, pitch: 83, hand: "R", finger: 5 }] };
    await open(<SongPlayer song={song} />);
    const scroller = screen.getByTestId("stage-scroller");
    expect(scroller.scrollLeft).toBe(0); // C3 is in view
    click("Start");
    act(() => midi.noteOn(48));
    act(() => midi.noteOff(48));
    expect(scroller.scrollLeft).toBe(0); // D3 is still in view: no jump
    act(() => midi.noteOn(50));
    act(() => midi.noteOff(50));
    const { low, high } = keyboardRange(song.notes.map((n) => n.pitch), { width: window.innerWidth, landscape: window.innerWidth > window.innerHeight });
    const lay = keyLayout(low, high);
    const mid = ((lay.x(83) + lay.w(83) / 2) / lay.width) * 2000;
    expect(scroller.scrollLeft).toBeCloseTo(Math.min(mid - 200, 2000), 0); // B5 centred
  });

  it("draws the keyboard for the song's range, not three octaves", async () => {
    await open(<SongPlayer song={ode} />);
    const notes = ode.notes.map((n) => n.pitch);
    expect(Math.max(...notes)).toBeLessThanOrEqual(72);
    expect(screen.getByRole("button", { name: "C5" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "C6" })).toBeNull();
  });
});

describe("FallingNotes in the stage", () => {
  const steps = stepsOf(mary);
  const props = { steps, index: 0, hands: "both" as const, low: 48, high: 72 };

  it("uses VIEW_H until the box is measured, then the box's height", async () => {
    const resize = stubResize();
    await open(<FallingNotes {...props} />);
    const svg = () => screen.getByRole("img", { name: "Falling notes" });
    const lay = keyLayout(48, 72);
    expect(svg().getAttribute("viewBox")).toBe(`0 0 ${lay.width} ${VIEW_H}`);
    resize(lay.width, 100); // one unit per pixel
    expect(svg().getAttribute("viewBox")).toBe(`0 0 ${lay.width} 100`);
    const few = screen.getAllByTestId("note").length;
    resize(lay.width, 600);
    expect(svg().getAttribute("viewBox")).toBe(`0 0 ${lay.width} 600`);
    expect(screen.getAllByTestId("note").length).toBeGreaterThan(few); // more height, more beats
    // exactly the notes that start less than height / PX_PER_BEAT beats ahead are drawn
    const ahead = steps.flatMap((s) => s.notes).filter((n) => n.start < 600 / PX_PER_BEAT);
    expect(screen.getAllByTestId("note")).toHaveLength(ahead.length);
  });

  it("scales the height by the box's width so a unit stays square", async () => {
    const resize = stubResize();
    await open(<FallingNotes {...props} />);
    const lay = keyLayout(48, 72);
    resize(lay.width * 2, 200); // keys drawn twice as wide: 100 units tall
    expect(screen.getByRole("img", { name: "Falling notes" }).getAttribute("data-view-h")).toBe("100");
  });

  it("lines each lane and bar up with its key for the range the stage draws", async () => {
    await open(<SongPlayer song={ode} />);
    const svg = screen.getByRole("img", { name: "Falling notes" });
    const kb = screen.getByRole("button", { name: "C3" }).closest("svg")!;
    const { low, high } = keyboardRange(ode.notes.map((n) => n.pitch), { width: window.innerWidth, landscape: window.innerWidth > window.innerHeight });
    const lay = keyLayout(low, high);
    expect(svg.getAttribute("viewBox")!.split(" ")[2]).toBe(String(lay.width));
    expect(kb.getAttribute("viewBox")!.split(" ")[2]).toBe(String(lay.width));
    const lanes = [...svg.querySelectorAll("line")].map((l) => Number(l.getAttribute("x1")));
    expect(lanes).toEqual(Array.from({ length: high - low + 1 }, (_, i) => low + i).filter((n) => n % 12 === 0 || n % 12 === 5).map((n) => lay.x(n)));
    const bar = screen.getAllByTestId("note")[0];
    expect(Number(bar.querySelector("rect")!.getAttribute("x"))).toBe(lay.x(Number(bar.getAttribute("data-note"))) + 1);
  });

  it("puts the letter and finger side by side on a short note and stacks them on a tall one", async () => {
    const song: Song = { id: "t", title: "T", bpm: 60, beatsPerBar: 4, level: 1, notes: [{ start: 0, dur: 0.25, pitch: 60, hand: "R", finger: 3 }, { start: 1, dur: 2, pitch: 64, hand: "R", finger: 1 }] };
    await open(<FallingNotes steps={stepsOf(song)} index={0} hands="R" low={48} high={72} />);
    const [short, tall] = screen.getAllByTestId("note");
    expect(short.getAttribute("data-short")).toBe("true");
    expect(short.querySelector("text")!.textContent).toBe("C3"); // the letter C, then finger 3, one line
    expect(short.querySelector("[data-testid=finger-inline]")!.textContent).toBe("3");
    expect(tall.getAttribute("data-short")).toBe("false");
    expect(tall.querySelector("[data-testid=finger-inline]")).toBeNull();
    expect(tall.querySelectorAll("text")[0].textContent).toBe("E");
  });
});

describe("Song player for a session step", () => {
  it("opens on the given hands, mode and tempo instead of the saved ladder step", async () => {
    localStorage.setItem("reel-radar-piano-settings", JSON.stringify({ unlocks: {}, slowSteps: {}, slowAt: {}, months: [], songs: { [mary.id]: { at: 1, step: 2, tempo: 90, best: 95 } }, updatedAt: 1 }));
    await open(<SongPlayer song={mary} hands="L" mode="play" tempo={70} />);
    expect(screen.getByTestId("song-meta").textContent).toBe("Left hand · Play-along · 70 BPM");
    expect(screen.getByTestId("start-summary").textContent).toContain("70 BPM");
  });

  it("without them opens on the saved ladder step", async () => {
    localStorage.setItem("reel-radar-piano-settings", JSON.stringify({ unlocks: {}, slowSteps: {}, slowAt: {}, months: [], songs: { [mary.id]: { at: 1, step: 1, tempo: 60, best: 95 } }, updatedAt: 1 }));
    await open(<SongPlayer song={mary} />);
    expect(screen.getByTestId("song-meta").textContent).toBe("Left hand · Wait · 100 BPM");
  });

  it("starts by itself, shows the extra top node, and calls onFinish with the wait result and the ladder", async () => {
    const done: SongResult[] = [];
    await open(<SongPlayer song={mary} hands="R" mode="wait" autoStart top={<span>Step 2 of 3</span>} onFinish={(r) => done.push(r)} />);
    expect(screen.getByText("Step 2 of 3")).toBeTruthy();
    expect(screen.getByTestId("progress").textContent).toBe("Step 1 of 26"); // no Start tap
    for (const st of stepsOf(mary)) {
      const mine = handOf(st.notes, "R");
      mine.forEach((n) => act(() => midi.noteOn(n.pitch)));
      mine.forEach((n) => act(() => midi.noteOff(n.pitch)));
      if (!mine.length) wait(60000);
    }
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ mode: "wait", hands: "R", early: false, play: null, wait: { played: 26, total: 26, misses: 0 }, ladder: { stepDone: true } });
  });

  it("shows the results card after a run, or nothing but the start screen with showResults false", async () => {
    const run = () => {
      for (const st of stepsOf(mary)) {
        const mine = handOf(st.notes, "R");
        mine.forEach((n) => act(() => midi.noteOn(n.pitch)));
        mine.forEach((n) => act(() => midi.noteOff(n.pitch)));
        if (!mine.length) wait(60000);
      }
    };
    const done: SongResult[] = [];
    await open(<SongPlayer song={mary} hands="R" mode="wait" autoStart showResults={false} onFinish={(r) => done.push(r)} />);
    run();
    expect(done).toHaveLength(1);
    expect(screen.queryByRole("region", { name: "Results" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Song summary" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Try next step" })).toBeNull();
    expect(screen.getByRole("button", { name: "Play again" })).toBeTruthy();
    expect(screen.getByTestId("falling-notes")).toBeTruthy(); // the lanes stay: no result takes their place
    cleanup();
    await open(<SongPlayer song={mary} hands="R" mode="wait" autoStart />);
    run();
    expect(screen.getByRole("region", { name: "Results" })).toBeTruthy();
    expect(screen.getByTestId("song-line").textContent).toBe("Step done");
    expect(screen.queryByTestId("falling-notes")).toBeNull();
  });

  it("calls onFinish with the play-along result after an autostarted run", async () => {
    const done: SongResult[] = [];
    await open(<SongPlayer song={mary} hands="R" mode="play" tempo={120} autoStart onFinish={(r) => done.push(r)} />);
    expect(screen.getByTestId("progress").textContent).toMatch(/Count-in/);
    wait(((4 + songBeats(mary)) * 60000) / 120 + 1000);
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ mode: "play", hands: "R", bpm: 120, early: false, wait: null });
    expect(done[0].play!.summary.total).toBeGreaterThan(0);
    expect(done[0].ladder).not.toBeNull();
  });

  it("tells onFinish when a run is stopped: a play-along run is discarded, a wait run reports what was played", async () => {
    const done: SongResult[] = [];
    await open(<SongPlayer song={mary} hands="R" mode="play" tempo={80} autoStart onFinish={(r) => done.push(r)} />);
    wait(1000);
    click("Stop");
    expect(done).toEqual([{ mode: "play", hands: "R", bpm: 80, early: true, wait: null, play: null, ladder: null }]);
    expect(localStorage.getItem("reel-radar-piano-2026-11")).toBeNull(); // nothing saved
    openSettings();
    fireEvent.click(screen.getByRole("button", { name: "Wait" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    click("Start");
    const first = handOf(mary.notes, "R")[0];
    act(() => midi.noteOn(first.pitch));
    act(() => midi.noteOff(first.pitch));
    click("Stop");
    expect(done[1]).toMatchObject({ mode: "wait", hands: "R", bpm: 100, early: true, play: null, ladder: null, wait: { played: 1, early: true } });
  });
});
