// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { installFakeAudio } from "@/test/audio";
import { fakeMidi, uninstallMidi } from "@/test/midi";
import PianoLayout from "../layout";
import ChordsPage from "./page";

vi.mock("next/navigation", () => ({ usePathname: () => "/piano/chords" }));

let midi: ReturnType<typeof fakeMidi>;
const open = async () => {
  render(
    <PianoLayout>
      <ChordsPage />
    </PianoLayout>,
  );
  await act(async () => {});
};
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const target = () => screen.getByTestId("target").textContent!;
const on = (n: number) => act(() => midi.noteOn(n, 100, performance.now()));
const off = (n: number) => act(() => midi.noteOff(n, performance.now()));
const hold = (notes: number[]) => notes.forEach(on);
const release = (notes: number[]) => notes.forEach(off);
const start = () => fireEvent.click(screen.getByRole("button", { name: /Start/ }));
const lit = () => [...document.querySelectorAll('[data-state="lit"]')].map((e) => e.getAttribute("aria-label")!);
// Notes of the chord shown, as pitch classes -> an inversion across octaves.
const PCS: Record<string, number[]> = { C: [0, 4, 7], F: [5, 9, 0], G: [7, 11, 2] };
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

describe("Chord drill page", () => {
  it("lists the chord groups in unlock order", async () => {
    await open();
    expect(screen.getByText("Open: C F G")).toBeTruthy();
    expect(screen.getByText("Locked: Am Dm Em")).toBeTruthy();
    expect(screen.getByText(/Locked: C7 G7 D7/)).toBeTruthy();
  });

  it("counts a chord held in any inversion, and shows the next chord", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // C, then F, then C ...
    await open();
    start();
    expect(target()).toBe("C");
    await wait(500);
    hold([72, 64]); // C5 E4
    expect(target()).toBe("C"); // still pending
    hold([55]); // G3: a second inversion
    expect(target()).toBe("F");
    release([72, 64, 55]);
    await wait(300);
    hold([53, 57, 60, 65]); // F3 A3 C4 F4: doubled root
    expect(target()).toBe("C");
  });

  it("a note outside the chord is a miss, and the hint lights root position with finger numbers", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    await open();
    start();
    await wait(300);
    on(61); // C#: not in C major
    expect(screen.getByRole("status", { name: "" }).textContent).toBe("You pressed C#4. Wanted C.");
    expect(lit().sort()).toEqual(["C4", "E4", "G4"]);
    const text = (n: string) => document.querySelector(`[aria-label="${n}"]`)!.textContent;
    expect(text("C4")).toContain("1");
    expect(text("E4")).toContain("3");
    expect(text("G4")).toContain("5");

    // C# is still held: the right chord stays pending until it is let go, and C# isn't judged again.
    hold([60, 64, 67]);
    expect(target()).toBe("C");
    off(61);
    off(67);
    on(67);
    expect(target()).toBe("F");

    fireEvent.click(screen.getByRole("button", { name: "End round" }));
    const [rec] = saved();
    expect(rec.drill).toBe("chords");
    expect(rec.items.C).toMatchObject({ attempts: 1, misses: 1 });
  });

  it("keys left down from the last chord are not a miss for the next one", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    await open();
    start();
    await wait(300);
    hold([60, 64, 67]); // C done, held on; F is shown
    expect(target()).toBe("F");
    hold([65]); // F4: in F, and E/G are stale: pending, no miss
    expect(screen.getByRole("status", { name: "" }).textContent).toBe("");
    off(64);
    off(67);
    hold([69]); // A4: held is C F A: C is in F, so it completes
    expect(target()).toBe("C");
    release([60, 65, 69]);
    fireEvent.click(screen.getByRole("button", { name: "End round" }));
    expect(saved()[0].items.F).toMatchObject({ attempts: 1, misses: 0 });
  });

  it("shows 7th fingering 1-2-3-5", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99); // the last chord: B7
    localStorage.setItem("reel-radar-piano-settings", JSON.stringify({ unlocks: { chords: 4 }, slowSteps: {}, updatedAt: 1 }));
    await open();
    expect(screen.getByText(/Open: C7 G7/)).toBeTruthy();
    start();
    expect(target()).toBe("B7");
    await wait(2100);
    expect(lit().sort()).toEqual(["A5", "B4", "D#5", "F#5"]);
    const text = (n: string) => document.querySelector(`[aria-label="${n}"]`)!.textContent;
    expect([text("B4"), text("D#5"), text("F#5"), text("A5")].map((t) => t!.match(/\d$/)![0])).toEqual(["1", "2", "3", "5"]);
  });
});
