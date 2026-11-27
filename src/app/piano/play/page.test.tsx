// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { getApp } from "@/lib/apps";
import { installFakeAudio } from "@/test/audio";
import { fakeMidi, uninstallMidi } from "@/test/midi";
import PianoLayout from "../layout";
import PianoPage from "./page";

vi.mock("next/navigation", () => ({ usePathname: () => "/piano/play" }));

const open = async () => {
  render(
    <PianoLayout>
      <PianoPage />
    </PianoLayout>,
  );
  await act(async () => {});
};
const dot = () => screen.getByRole("status");
const key = (n: string) => screen.getByLabelText(n);

let voices: ReturnType<typeof installFakeAudio>;
beforeEach(() => {
  voices = installFakeAudio();
});
afterEach(() => {
  uninstallMidi();
  vi.unstubAllGlobals();
});

describe("Piano page", () => {
  it("is registered as an app at /piano and carries the app switcher", async () => {
    const app = getApp("piano");
    expect(app).toMatchObject({ name: "Piano", href: "/piano", icon: "🎹", description: "Notes, chords, songs and practice log" });
    fakeMidi().install();
    await open();
    expect(screen.getByRole("link", { name: "Piano" }).getAttribute("href")).toBe("/piano");
    expect(screen.getByLabelText("Switch app")).toBeTruthy();
  });

  it("explains when the browser has no Web MIDI, and the on-screen keyboard still plays", async () => {
    await open();
    expect(screen.getByRole("alert").textContent).toContain("Use Chrome");
    expect(dot().getAttribute("aria-label")).toBe("Keyboard not connected");
    fireEvent.pointerDown(key("D4"));
    expect(screen.getByTestId("note-name").textContent).toBe("D");
    expect(voices[0].hz).toBeCloseTo(293.66, 1);
  });

  it("explains a refused permission", async () => {
    fakeMidi().install({ deny: true });
    await open();
    expect(screen.getByRole("alert").textContent).toContain("refused");
    fireEvent.pointerDown(key("C4"));
    expect(voices).toHaveLength(1);
  });

  it("connects by itself, lights played keys with their name, and reconnects after unplugging", async () => {
    const midi = fakeMidi();
    midi.install();
    await open();
    expect(screen.getByText(/Plug in your keyboard/)).toBeTruthy();
    expect(screen.getByText("Play a key")).toBeTruthy();

    act(() => midi.plug());
    expect(dot().getAttribute("aria-label")).toBe("Keyboard connected");
    expect(dot().textContent).toBe("CASIO USB-MIDI");
    expect(screen.queryByRole("combobox")).toBeNull();

    act(() => midi.noteOn(61, 100, 10));
    expect(screen.getByTestId("note-name").textContent).toBe("C#");
    expect(key("C#4").getAttribute("data-state")).toBe("pressed");
    act(() => midi.noteOff(61, 20));
    expect(key("C#4").getAttribute("data-state")).toBe("idle");
    expect(screen.getByTestId("note-name").textContent).toBe("C#");

    act(() => midi.noteOn(64, 100, 30));
    act(() => midi.unplug());
    expect(dot().getAttribute("aria-label")).toBe("Keyboard not connected");
    expect(key("E4").getAttribute("data-state")).toBe("idle");

    act(() => midi.plug());
    expect(dot().getAttribute("aria-label")).toBe("Keyboard connected");
    act(() => midi.noteOn(65, 90, 40));
    expect(screen.getByTestId("note-name").textContent).toBe("F");
  });

  it("plays taps through the keyboard when connected, and the synth when not", async () => {
    const midi = fakeMidi();
    midi.install();
    await open();
    expect(screen.getByText(/built-in sound/)).toBeTruthy();
    act(() => midi.plug());
    expect(screen.getByText(/play on your keyboard/)).toBeTruthy();
    fireEvent.pointerDown(key("G4"));
    fireEvent.pointerUp(key("G4"));
    expect(midi.sent()).toEqual([[0x90, 67, 90], [0x80, 67, 0]]);
    expect(voices).toHaveLength(0);
    expect(key("G4").getAttribute("data-state")).toBe("idle");
    act(() => midi.unplug());
    fireEvent.pointerDown(key("G4"));
    expect(voices).toHaveLength(1);
  });

  it("shows a picker only with more than one device", async () => {
    const midi = fakeMidi();
    midi.install();
    midi.plug("Casio", "casio");
    await open();
    expect(screen.queryByRole("combobox")).toBeNull();
    act(() => midi.plug("Other", "other"));
    const picker = screen.getByRole("combobox") as HTMLSelectElement;
    expect(picker.value).toBe("casio");
    fireEvent.change(picker, { target: { value: "other" } });
    expect(dot().textContent).toBe("Other");
    act(() => midi.noteOn(60, 100, 1, "casio"));
    expect(screen.getByText("Play a key")).toBeTruthy();
    act(() => midi.noteOn(60, 100, 1, "other"));
    expect(screen.getByTestId("note-name").textContent).toBe("C");
  });

  it("keeps the screen on while the page is open", async () => {
    const release = vi.fn();
    const request = vi.fn(async () => ({ release }));
    Object.defineProperty(navigator, "wakeLock", { value: { request }, configurable: true });
    fakeMidi().install();
    await open();
    expect(request).toHaveBeenCalledWith("screen");
    delete (navigator as unknown as Record<string, unknown>).wakeLock;
  });
});
