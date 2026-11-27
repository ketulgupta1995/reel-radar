// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { installFakeAudio } from "@/test/audio";
import { fakeMidi, uninstallMidi } from "@/test/midi";
import { openSettings } from "@/test/stage";
import PianoLayout from "../layout";
import EarPage from "./page";

vi.mock("next/navigation", () => ({ usePathname: () => "/piano/ear" }));

let midi: ReturnType<typeof fakeMidi>;
const open = async () => {
  render(
    <PianoLayout>
      <EarPage />
    </PianoLayout>,
  );
  await act(async () => {});
};
const press = (n: number) => {
  act(() => midi.noteOn(n, 90, performance.now()));
  act(() => midi.noteOff(n, performance.now()));
};
const noteOns = () => midi.sent().filter((d) => d[0] === 0x90).map((d) => [d[1], d[2]]);
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
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Ear training page", () => {
  it("lists its groups and says the hint comes only after a miss", async () => {
    await open();
    expect(screen.getByText("Open: Notes C D E F G")).toBeTruthy();
    expect(screen.getByText("Locked: Three-note phrases")).toBeTruthy();
    expect(screen.getByText("Locked: Major or minor")).toBeTruthy();
    openSettings();
    expect(screen.getByText("A hint lights the keys after a miss.")).toBeTruthy();
  });

  it("plays a C then the note, hides the answer, replays on Hear again, lights the key after a miss and saves", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // note-C first, then note-D
    await open();
    fireEvent.click(screen.getByRole("button", { name: /Start/ }));
    expect(screen.getByTestId("target").textContent).toBe("Listen");
    expect(screen.getByTestId("caption").textContent).toBe("After the C, play the note you hear");
    expect(screen.getByTestId("next").textContent).toContain("?"); // the next answer stays hidden too
    expect(noteOns()).toEqual([[60, 60], [60, 90]]); // the reference C, then the note (C)
    fireEvent.click(screen.getByRole("button", { name: "Hear again" }));
    expect(noteOns()).toHaveLength(4);
    act(() => void vi.advanceTimersByTime(30_000));
    expect(document.querySelectorAll('[data-state="lit"]')).toHaveLength(0); // no hint on a timer
    press(72); // C, another octave
    expect(screen.getByTestId("previous").textContent).toContain("C"); // the answer, named once played
    expect(noteOns().slice(-2)).toEqual([[60, 60], [62, 90]]); // the next item plays at once
    press(64); // wrong
    expect(screen.getByRole("status", { name: "" }).textContent).toBe("You pressed E4. Wanted D.");
    expect([...document.querySelectorAll('[data-state="lit"]')].map((k) => k.getAttribute("aria-label"))).toEqual(["D4"]);
    press(62);
    fireEvent.click(screen.getByRole("button", { name: "End round" }));
    const [rec] = saved();
    expect(rec.drill).toBe("ear");
    expect(rec.items["note-C"]).toMatchObject({ attempts: 1, misses: 0 });
    expect(rec.items["note-D"]).toMatchObject({ attempts: 1, misses: 1 });
    expect(screen.getByTestId("weakest").textContent).toContain("D: 1 missed");
  });
});
