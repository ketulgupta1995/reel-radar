// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { installFakeAudio } from "@/test/audio";
import { fakeMidi, uninstallMidi } from "@/test/midi";
import PianoLayout from "./layout";
import PianoHub from "./page";

vi.mock("next/navigation", () => ({ usePathname: () => "/piano" }));

afterEach(() => {
  uninstallMidi();
  vi.unstubAllGlobals();
});

describe("Piano hub", () => {
  it("links the drills and free play, and says when the keyboard is missing", async () => {
    installFakeAudio();
    fakeMidi().install();
    render(
      <PianoLayout>
        <PianoHub />
      </PianoLayout>,
    );
    await act(async () => {});
    expect(screen.getByRole("link", { name: /Note drill/ }).getAttribute("href")).toBe("/piano/notes");
    expect(screen.getByRole("link", { name: /Chord drill/ }).getAttribute("href")).toBe("/piano/chords");
    expect(screen.getByRole("link", { name: /Five-finger/ }).getAttribute("href")).toBe("/piano/fingers");
    expect(screen.getByRole("link", { name: /Free play/ }).getAttribute("href")).toBe("/piano/play");
    expect(screen.getByRole("link", { name: /Practice log/ }).getAttribute("href")).toBe("/piano/log");
    expect(screen.getByText(/Plug in your keyboard/)).toBeTruthy();
    expect(screen.getByTestId("teaser").textContent).toBe("Today 0 min · streak 0 days");
  });
});
