// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { installFakeAudio } from "@/test/audio";
import { fakeMidi, uninstallMidi } from "@/test/midi";
import PianoLayout from "../layout";
import FingersPage from "./page";

vi.mock("next/navigation", () => ({ usePathname: () => "/piano/fingers" }));

let midi: ReturnType<typeof fakeMidi>;
const open = async () => {
  render(
    <PianoLayout>
      <FingersPage />
    </PianoLayout>,
  );
  await act(async () => {});
};
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const finger = () => Number(screen.getByTestId("target").textContent);
const press = (n: number) => {
  act(() => midi.noteOn(n, 100, performance.now()));
  act(() => midi.noteOff(n, performance.now()));
};
const start = () => fireEvent.click(screen.getByRole("button", { name: /Start/ }));
const lit = () => [...document.querySelectorAll('[data-state="lit"]')];
const RH_C = [60, 62, 64, 65, 67]; // finger 1..5
const saved = () => Object.entries(localStorage).filter(([k]) => /^reel-radar-piano-\d{4}-\d{2}$/.test(k)).flatMap(([, v]) => Object.values(JSON.parse(v).items)) as { drill: string; items: Record<string, { attempts: number; misses: number }> }[];

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
  vi.useRealTimers();
});

describe("Five-finger drill page", () => {
  it("lists the position groups", async () => {
    await open();
    expect(screen.getByText("Open: Right hand: C G F")).toBeTruthy();
    expect(screen.getByText("Locked: Left hand: C G F")).toBeTruthy();
    expect(screen.getByText("Locked: Right and Left hand: D A E")).toBeTruthy();
  });

  it("shows the position and finger, accepts the exact key, misses a neighbour, lights the key with its number, and saves", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // RH C, finger 1 first, then finger 2
    await open();
    start();
    expect(screen.getByTestId("caption").textContent).toBe("Right hand · C position");
    expect(finger()).toBe(1);
    // The five fingers are on the keyboard from the start, but nothing is lit yet.
    for (const [n, f] of [["C4", 1], ["D4", 2], ["E4", 3], ["F4", 4], ["G4", 5]] as const) expect(document.querySelector(`[aria-label="${n}"]`)!.textContent).toContain(String(f));
    expect(lit()).toHaveLength(0);

    await wait(400);
    press(62); // finger 2's key, not 1
    expect(screen.getByRole("status", { name: "" }).textContent).toBe("You pressed D4. Wanted 1.");
    expect(finger()).toBe(1);
    expect(lit()).toHaveLength(1);
    expect(lit()[0].getAttribute("aria-label")).toBe("C4");
    expect(lit()[0].textContent).toContain("1");
    press(72); // wrong octave
    expect(finger()).toBe(1);
    press(60);
    expect(finger()).toBe(2);
    expect(lit()).toHaveLength(0);
    await wait(300);
    press(RH_C[1]); // finger 2 = D4
    expect(finger()).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "End round" }));
    const [rec] = saved();
    expect(rec.drill).toBe("fingers");
    expect(rec.items["RH-C-1"]).toMatchObject({ attempts: 1, misses: 1 });
    expect(rec.items["RH-C-2"]).toMatchObject({ attempts: 1, misses: 0 });
  });

  it("shows the evenness of touch after a round played on the keyboard: a hard thumb, a soft finger 2", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // RH C fingers 1, 2, 1, 2, ...
    await open();
    start();
    for (let i = 0; i < 8; i++) {
      const f = finger();
      act(() => midi.noteOn(RH_C[f - 1], f === 1 ? 110 : 60, performance.now()));
      act(() => midi.noteOff(RH_C[f - 1], performance.now()));
    }
    fireEvent.click(screen.getByRole("button", { name: "End round" }));
    expect(screen.getByTestId("evenness").textContent).toBe("71");
    expect(screen.getByTestId("touch-line").textContent).toBe("Your thumb plays hardest and finger 2 softest.");
    expect(screen.getByLabelText("Finger 1: velocity 110")).toBeTruthy();
    expect(screen.getByLabelText("Finger 5: not played")).toBeTruthy();
  });

  it("shows no evenness for a round played on the screen (its keys always send one velocity)", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    await open();
    start();
    for (let i = 0; i < 8; i++) {
      const key = document.querySelector(`[aria-label="${finger() === 1 ? "C4" : "D4"}"]`)!;
      fireEvent.pointerDown(key);
      fireEvent.pointerUp(key);
    }
    fireEvent.click(screen.getByRole("button", { name: "End round" }));
    expect(screen.getByTestId("accuracy")).toBeTruthy();
    expect(screen.queryByTestId("touch")).toBeNull();
  });

  it("with left-hand positions unlocked, finger 5 is the lowest key and finger 1 the highest", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99); // last item: LH F finger 5, then finger 4
    localStorage.setItem("reel-radar-piano-settings", JSON.stringify({ unlocks: { fingers: 2 }, slowSteps: {}, updatedAt: 1 }));
    await open();
    start();
    expect(screen.getByTestId("caption").textContent).toBe("Left hand · F position");
    expect(finger()).toBe(5);
    await wait(2100);
    expect(lit()[0].getAttribute("aria-label")).toBe("F3");
    for (const [n, f] of [["F3", 5], ["G3", 4], ["A3", 3], ["A#3", 2], ["C4", 1]] as const) expect(document.querySelector(`[aria-label="${n}"]`)!.textContent).toContain(String(f));
    press(53);
    expect(finger()).toBe(4);
    press(55);
    expect(finger()).toBe(5);
  });
});
