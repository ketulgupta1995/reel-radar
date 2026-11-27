// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { installFakeAudio } from "@/test/audio";
import { fakeMidi, uninstallMidi } from "@/test/midi";
import { openSettings } from "@/test/stage";
import PianoLayout from "../layout";
import { Metronome } from "../Metronome";
import MetronomePage from "./page";

vi.mock("next/navigation", () => ({ usePathname: () => "/piano/metronome" }));

let voices: ReturnType<typeof installFakeAudio>;
beforeEach(() => {
  vi.useFakeTimers();
  voices = installFakeAudio();
});
afterEach(() => {
  vi.useRealTimers();
  uninstallMidi();
  localStorage.clear();
});

const open = async (sheet = true) => {
  render(
    <PianoLayout>
      <MetronomePage />
    </PianoLayout>,
  );
  await act(async () => {});
  if (sheet) openSettings(); // beats per bar, the count-in and the tap-along live in the settings sheet
};
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const press = (m: ReturnType<typeof fakeMidi>, ...args: [number, number, number]) => act(() => void m.noteOn(...args));
const clicks = (m: ReturnType<typeof fakeMidi>) => m.sent().filter((d) => d[0] === 0x99);
const lit = () => [...screen.getByTestId("beats").children].map((c) => c.getAttribute("data-on"));

describe("Metronome page", () => {
  it("clicks on the keyboard's channel 10 with beat 1 accented, after a one-bar count-in, at the timestamps asked for", async () => {
    const m = fakeMidi().install();
    m.plug();
    await open();
    fireEvent.change(screen.getByLabelText("Tempo"), { target: { value: "120" } });
    expect(screen.getByTestId("bpm").textContent).toBe("120");
    fireEvent.change(screen.getByLabelText(/Beats per bar/), { target: { value: "3" } });
    const t0 = performance.now();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
    advance(3000);
    const sent = clicks(m);
    expect(sent.length).toBeGreaterThanOrEqual(6); // a count-in bar of 3 and a bar of 3
    expect(sent.slice(0, 7).map((d) => d[1])).toEqual([76, 77, 77, 76, 77, 77, 76].slice(0, Math.min(7, sent.length)));
    expect(sent[0]).toEqual([0x99, 76, 120]);
    expect(sent[1][2]).toBeLessThan(120);
    const times = m.sentTimes().filter((t, i) => m.sent()[i][0] === 0x99) as number[];
    expect(times[0]).toBeCloseTo(t0 + 60, 0);
    expect(times[1] - times[0]).toBeCloseTo(500, 0); // 120 BPM
    expect(times[3] - times[0]).toBeCloseTo(1500, 0);
    expect(voices).toHaveLength(0); // nothing through the browser
  });

  it("shows the count-in, then the beat indicator, and changes tempo while running", async () => {
    const m = fakeMidi().install();
    m.plug();
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Start" })); // 80 BPM = 750 ms, 4 beats
    advance(100);
    expect(screen.getByText("Count-in…")).toBeTruthy();
    expect(lit()).toEqual(["true", "false", "false", "false"]);
    advance(750 * 4);
    expect(screen.getByText("Playing")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Faster" }));
    fireEvent.click(screen.getByRole("button", { name: "Faster" }));
    fireEvent.click(screen.getByRole("button", { name: "Slower" }));
    expect(screen.getByTestId("bpm").textContent).toBe("81");
    const before = clicks(m).length;
    const times = () => m.sentTimes().filter((_, i) => m.sent()[i][0] === 0x99) as number[];
    advance(5000);
    const t = times();
    expect(clicks(m).length).toBeGreaterThan(before + 3);
    expect(t[t.length - 1] - t[t.length - 2]).toBeCloseTo(60000 / 81, 0);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    const n = clicks(m).length;
    advance(3000);
    expect(clicks(m).length).toBe(n);
    expect(lit()).toEqual(["false", "false", "false", "false"]);
  });

  it("can skip the count-in, restarts when the bar length changes and remembers the tempo", async () => {
    const m = fakeMidi().install();
    m.plug();
    await open();
    fireEvent.click(screen.getByLabelText("One-bar count-in"));
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    advance(100);
    expect(screen.queryByText("Count-in…")).toBeNull();
    fireEvent.change(screen.getByLabelText(/Beats per bar/), { target: { value: "2" } });
    advance(100);
    expect(screen.getByTestId("beats").children).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Faster" }));
    expect(JSON.parse(localStorage.getItem("reel-radar-piano-timing")!)).toMatchObject({ bpm: 81, beatsPerBar: 2 });
  });

  it("falls back to a browser click when no keyboard is connected, accent higher, on the audio clock", async () => {
    fakeMidi().install();
    await open();
    fireEvent.click(screen.getByLabelText("One-bar count-in"));
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    advance(2400); // 80 BPM: beats at +60, +810, +1560, +2310
    const hz = voices.map((v) => v.hz);
    expect(hz.slice(0, 4)).toEqual([1600, 1000, 1000, 1000]);
    expect(voices[0].startAt).toBeCloseTo(0.06, 2);
    expect(voices[1].startAt).toBeGreaterThan(voices[0].startAt!);
  });

  it("measures the average offset of key presses against the beat, and applies the latency offset", async () => {
    const m = fakeMidi().install();
    m.plug();
    await open();
    fireEvent.click(screen.getByLabelText("One-bar count-in"));
    fireEvent.change(screen.getByLabelText("Tempo"), { target: { value: "60" } });
    expect(screen.getByTestId("tap-result").textContent).toMatch(/Play along/);
    const t0 = performance.now();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    // Beats at t0 + 60 + n * 1000; the player is 40, 30, 50 ms late. A key lifted is not a hit.
    for (const [n, late] of [[0, 40], [1, 30], [2, 50]]) {
      advance(60 + n * 1000 + late - (performance.now() - t0));
      press(m, 60, 90, performance.now());
      m.noteOff(60, performance.now());
    }
    expect(screen.getByTestId("tap-result").textContent).toBe("You play 40 ms late on average (spread 8 ms, last 3 hits).");

    // Setting the latency from the average clears the old hits and corrects the next ones.
    fireEvent.click(screen.getByRole("button", { name: "Set from average" }));
    expect((screen.getByLabelText("Latency offset") as HTMLInputElement).value).toBe("40");
    expect(screen.getByTestId("tap-result").textContent).toMatch(/Play along/);
    advance(3060 + 40 - (performance.now() - t0));
    press(m, 60, 90, performance.now());
    expect(screen.getByTestId("tap-result").textContent).toContain("right on the click");
    expect(JSON.parse(localStorage.getItem("reel-radar-piano-timing")!).latencyMs).toBe(40);
  });

  it("ignores key presses while stopped or in the count-in, and keeps the last 16 hits", async () => {
    const m = fakeMidi().install();
    m.plug();
    await open();
    press(m, 60, 90, performance.now());
    expect(screen.getByTestId("tap-result").textContent).toMatch(/Play along/);
    fireEvent.click(screen.getByRole("button", { name: "Start" })); // count-in: beats are not scorable
    advance(200);
    press(m, 60, 90, performance.now());
    expect(screen.getByTestId("tap-result").textContent).toMatch(/Play along/);
    advance(750 * 4);
    for (let i = 0; i < 20; i++) {
      advance(750);
      press(m, 60, 90, performance.now());
    }
    expect(screen.getByTestId("tap-result").textContent).toMatch(/last 16 hits/);
  });

  it("starts with this device's saved tempo and latency", async () => {
    localStorage.setItem("reel-radar-piano-timing", JSON.stringify({ bpm: 132, beatsPerBar: 3, latencyMs: -12 }));
    fakeMidi().install();
    await open();
    expect(screen.getByTestId("bpm").textContent).toBe("132");
    expect(screen.getByTestId("beats").children).toHaveLength(3);
    expect((screen.getByLabelText("Latency offset") as HTMLInputElement).value).toBe("-12");
    fireEvent.change(screen.getByLabelText("Latency offset"), { target: { value: "" } });
    expect((screen.getByLabelText("Latency offset") as HTMLInputElement).value).toBe("0");
  });

  it("runs on the stage without a keyboard, with the meter, count-in and tap-along in the settings sheet", async () => {
    fakeMidi().install();
    await open(false);
    expect(screen.getByTestId("stage")).toBeTruthy();
    expect(screen.queryByLabelText("On-screen keyboard")).toBeNull();
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
    expect(screen.queryByLabelText(/Beats per bar/)).toBeNull();
    expect(screen.queryByTestId("tap-result")).toBeNull();
    openSettings();
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(screen.getByLabelText(/Beats per bar/))).toBe(true);
    expect(dialog.contains(screen.getByLabelText("One-bar count-in"))).toBe(true);
    expect(dialog.contains(screen.getByTestId("tap-result"))).toBe(true);
    expect(dialog.contains(screen.getByRole("button", { name: "Set from average" }))).toBe(true);
    expect(screen.getByTestId("bpm").textContent).toBe("80");
  });

  it("still works as an embeddable card", async () => {
    fakeMidi().install();
    render(
      <PianoLayout>
        <Metronome />
      </PianoLayout>,
    );
    await act(async () => {});
    expect(screen.getByRole("region", { name: "Metronome" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Faster" }));
    expect(screen.getByTestId("bpm").textContent).toBe("81");
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
    expect(screen.getByTestId("tap-result")).toBeTruthy();
  });
});
