// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { installFakeAudio } from "@/test/audio";
import { fakeMidi, uninstallMidi } from "@/test/midi";
import PianoLayout from "../layout";
import RhythmPage from "./page";

vi.mock("next/navigation", () => ({ usePathname: () => "/piano/rhythm" }));

let midi: ReturnType<typeof fakeMidi>;
const open = async () => {
  render(
    <PianoLayout>
      <RhythmPage />
    </PianoLayout>,
  );
  await act(async () => {});
};
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const saved = () =>
  Object.entries(localStorage)
    .filter(([k]) => /^reel-radar-piano-\d{4}-\d{2}$/.test(k))
    .flatMap(([, v]) => Object.values(JSON.parse(v).items)) as { drill: string; durationMs: number; items: Record<string, { attempts: number; misses: number; slow: number; avgMs: number }> }[];
const settings = () => JSON.parse(localStorage.getItem("reel-radar-piano-settings") || "{}");
const grades = () => screen.getAllByTestId("marker").map((m) => m.getAttribute("data-grade"));
const BPM = 70;
const BEAT = 60000 / BPM;

// Clicks a button that begins an attempt and returns when the first beat after the count-in is due.
const begin = (name: string | RegExp) => {
  const t = performance.now();
  click(name);
  return t + 60 + 4 * BEAT;
};
// Onset times (ms after the downbeat) of the pattern on show, read from its boxes.
const onsets = () => [...screen.getByTestId("grid").children].flatMap((li, i) => (li.getAttribute("data-kind") === "note" ? [(i * BEAT) / 2] : []));
// Plays both bars: `offset(i)` shifts note i (null skips it). Notes are stamped as the keyboard would.
const playBars = (start: number, offset: (i: number) => number | null = () => 0) => {
  const marks = [...onsets(), ...onsets().map((x) => x + 4 * BEAT)];
  marks.forEach((m, i) => {
    const off = offset(i);
    if (off === null) return;
    wait(Math.max(0, start + m + off - performance.now()));
    act(() => midi.noteOn(60, 100, start + m + off));
    act(() => midi.noteOff(60, start + m + off + 50));
  });
  wait(start + 8 * BEAT + 300 + 100 - performance.now());
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 27, 10, 0, 0));
  vi.spyOn(Math, "random").mockReturnValue(0);
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

describe("Rhythm drill page", () => {
  it("shows the groups and the window, and adjusts the tempo before starting", async () => {
    await open();
    expect(screen.getByText("Open: Quarters, halves, whole")).toBeTruthy();
    expect(screen.getByText("Locked: Syncopation")).toBeTruthy();
    expect(screen.getByText("On-time window: ±100 ms")).toBeTruthy();
    expect(screen.getByTestId("bpm").textContent).toBe("70");
    click("Faster");
    expect(screen.getByTestId("bpm").textContent).toBe("75");
    fireEvent.change(screen.getByLabelText("Tempo"), { target: { value: "70" } });
    expect(screen.getByTestId("bpm").textContent).toBe("70");
  });

  it("counts in with the click, scores two bars with early/on/late/missed markers and an on-time %, and saves the round", async () => {
    await open();
    const start = begin(/Start/);
    expect(screen.getByTestId("pattern-name").textContent).toBe("Four quarters");
    expect([...screen.getByTestId("grid").children].map((c) => c.getAttribute("data-kind"))).toEqual(["note", "hold", "note", "hold", "note", "hold", "note", "hold"]);
    wait(100);
    expect(screen.getByTestId("prompt").textContent).toMatch(/Count-in/);
    // A key pressed in the count-in does not count.
    act(() => midi.noteOn(60, 100, performance.now()));
    // Note 3 is 150 ms late, note 7 is skipped, the rest are within 30 ms either way.
    playBars(start, (i) => (i === 3 ? 150 : i === 7 ? null : i % 2 ? -30 : 20));
    expect(screen.getByTestId("ontime").textContent).toBe("75%");
    expect(grades()).toEqual(["on", "on", "on", "late", "on", "on", "on", "missed"]);
    const bar1 = screen.getByRole("list", { name: "Bar 1" });
    expect(within(bar1).getAllByTestId("marker")[3].textContent).toBe("Late +150 ms");
    expect(within(bar1).getAllByTestId("marker")[1].textContent).toBe("On time -30 ms");
    expect(screen.queryByText(/extra/)).toBeNull();
    const clicks = midi.sent().filter((d) => d[0] === 0x99);
    expect(clicks).toHaveLength(12); // one count-in bar and the two bars, and no more
    expect(clicks[0][1]).toBe(76);
    expect(clicks[4][1]).toBe(76);

    click("End round");
    expect(screen.getByText("Round done")).toBeTruthy();
    expect(screen.getByTestId("ontime-total").textContent).toBe("75%");
    expect(screen.getByTestId("error").textContent).toMatch(/ms$/);
    const [rec] = saved();
    expect(rec.drill).toBe("rhythm");
    expect(rec.items.quarters).toMatchObject({ attempts: 1, misses: 0, slow: 0 });
    expect(rec.items.quarters.avgMs).toBeGreaterThan(20);
    expect(settings().unlocks.rhythm).toBe(1);
  });

  it("subtracts this device's latency, flags stray notes, and moves to the next pattern", async () => {
    localStorage.setItem("reel-radar-piano-timing", JSON.stringify({ bpm: 70, beatsPerBar: 4, latencyMs: 40 }));
    await open();
    let start = begin(/Start/);
    playBars(start, () => 40);
    expect(screen.getByTestId("ontime").textContent).toBe("100%");
    expect(grades().every((g) => g === "on")).toBe(true);
    start = begin("Next pattern");
    expect(screen.getByTestId("pattern-name").textContent).toBe("Half, two quarters"); // never the same twice
    expect(screen.queryByTestId("result")).toBeNull();
    wait(start + 100 - performance.now());
    act(() => midi.noteOn(60, 100, start + 7 * BEAT / 2 + 3000)); // hits no note
    playBars(start, () => 40);
    expect(screen.getByText(/1 extra note played/)).toBeTruthy();
  });

  it("saves the round when the 2 minutes run out, and shows what is unlocked and the narrower window", async () => {
    await open();
    let start = begin(/Start/);
    for (let i = 0; i < 6; i++) {
      playBars(start);
      if (i < 5) start = begin("Next pattern");
    }
    expect(settings().unlocks.rhythm).toBe(2);
    expect(settings().slowSteps.rhythm).toBe(1);
    expect(screen.getByTestId("window").textContent).toBe("±80 ms");
    wait(120_000);
    expect(screen.getByText("Round done")).toBeTruthy();
    expect(screen.getByText("Unlocked: Eighths")).toBeTruthy();
    expect(screen.getByText("On-time window now ±80 ms")).toBeTruthy();
    expect(saved()).toHaveLength(1);
    expect(saved()[0].durationMs).toBe(120_000);
    expect(screen.getByText("None. A clean round.")).toBeTruthy();
    // A new round starts from the saved unlock and window.
    click("Another round");
    expect(screen.getByTestId("window").textContent).toBe("±80 ms");
    click("End round");
    expect(screen.getByText(/nothing was saved/)).toBeTruthy();
    expect(saved()).toHaveLength(1);
  });

  it("names the weakest patterns after failed runs", async () => {
    await open();
    const start = begin(/Start/);
    playBars(start, () => null);
    expect(screen.getByTestId("ontime").textContent).toBe("0%");
    click("End round");
    expect(screen.getByTestId("weakest").textContent).toContain("Four quarters: 1 off, of 1");
    expect(saved()[0].items.quarters.misses).toBe(1);
  });
});
