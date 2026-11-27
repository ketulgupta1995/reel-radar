// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { installFakeAudio } from "@/test/audio";
import { fakeMidi, uninstallMidi } from "@/test/midi";
import PianoLayout from "./layout";
import { Stage, StageProgress } from "./Stage";

vi.mock("next/navigation", () => ({ usePathname: () => "/piano" }));

beforeEach(() => {
  installFakeAudio();
  fakeMidi().install();
});
afterEach(() => uninstallMidi());

describe("Stage", () => {
  it("shows a session's progress in the top bar, the item's range on the keyboard and a slot above the keys", async () => {
    render(
      <PianoLayout>
        <Stage
          notes={[55, 77]}
          top={<StageProgress steps={[{ label: "Warm-up", weight: 2, fraction: 1 }, { label: "Chords", weight: 3, fraction: 0.4 }, { label: "Song", weight: 5, fraction: 0 }]} />}
          above={(r) => <div data-testid="above">{r.low}-{r.high}</div>}
          lit={new Set([60])}
          noKeyboard={false}
        >
          <p>Target</p>
        </Stage>
      </PianoLayout>,
    );
    await act(async () => {});
    const steps = screen.getAllByRole("listitem");
    expect(steps.map((s) => s.getAttribute("data-state"))).toEqual(["done", "now", "next"]);
    expect(steps[0].textContent).toBe("Warm-up ✓");
    expect(screen.getByTestId("above").textContent).toBe("48-84");
    // The slot and the keys share one scroller at the keyboard's width, so they stay lined up when it scrolls.
    const scroller = screen.getByTestId("above").closest(".overflow-x-auto")!;
    expect(scroller.contains(screen.getByLabelText("On-screen keyboard"))).toBe(true);
    expect((screen.getByTestId("above").parentElement!.parentElement as HTMLElement).style.minWidth).toBe(`${22 * 44}px`); // jsdom is 1024 x 768: landscape, 44 px keys
    expect(screen.getByLabelText("C3")).toBeTruthy();
    expect(screen.getByLabelText("C6")).toBeTruthy();
    expect(screen.queryByLabelText("Settings")).toBeNull();
    fireEvent.pointerDown(screen.getByLabelText("C4"));
  });

  it("draws an explicit range, and passes it to the slot above", async () => {
    render(
      <PianoLayout>
        <Stage range={{ low: 60, high: 72 }} above={(r) => <div data-testid="above">{r.low}-{r.high}:{r.whites}</div>} />
      </PianoLayout>,
    );
    await act(async () => {});
    expect(screen.getByTestId("above").textContent).toBe("60-72:8");
    expect(screen.queryByLabelText("C3")).toBeNull();
  });

  it("keeps fullscreen from one stage to the next, and leaves it when the last one closes", async () => {
    let fs: Element | null = null;
    Object.defineProperty(document, "fullscreenElement", { get: () => fs, configurable: true });
    const request = vi.fn(async () => {
      fs = document.documentElement;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    const exit = vi.fn(async () => {
      fs = null;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    const unlock = vi.fn();
    document.documentElement.requestFullscreen = request;
    document.exitFullscreen = exit;
    Object.defineProperty(window.screen, "orientation", { value: { type: "portrait-primary", lock: vi.fn(() => Promise.resolve()), unlock }, configurable: true });
    vi.useFakeTimers();
    try {
      const view = render(
        <PianoLayout>
          <Stage key="a" />
        </PianoLayout>,
      );
      await act(async () => {});
      expect(request).toHaveBeenCalledTimes(1);
      expect((window.screen.orientation as unknown as { lock: ReturnType<typeof vi.fn> }).lock).toHaveBeenCalledWith("portrait");
      view.rerender(
        <PianoLayout>
          <Stage key="b" />
        </PianoLayout>,
      );
      await act(async () => vi.runAllTimers());
      expect(exit).not.toHaveBeenCalled();
      expect(request).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText("Exit full screen")).toBeTruthy();
      view.unmount();
      await act(async () => vi.runAllTimers());
      expect(exit).toHaveBeenCalled();
      expect(unlock).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      delete (document.documentElement as unknown as Record<string, unknown>).requestFullscreen;
      delete (document as unknown as Record<string, unknown>).exitFullscreen;
      delete (document as unknown as Record<string, unknown>).fullscreenElement;
      delete (window.screen as unknown as Record<string, unknown>).orientation;
    }
  });

  it("brings the app header back when the stage closes", async () => {
    const view = render(
      <PianoLayout>
        <Stage />
      </PianoLayout>,
    );
    await act(async () => {});
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.queryByRole("link", { name: "Piano" })).toBeNull();
    view.rerender(
      <PianoLayout>
        <p>Hub</p>
      </PianoLayout>,
    );
    expect(screen.getByRole("link", { name: "Piano" })).toBeTruthy();
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("can leave the keyboard out", async () => {
    render(
      <PianoLayout>
        <Stage noKeyboard above={<div data-testid="above" />}>
          <p>Metronome</p>
        </Stage>
      </PianoLayout>,
    );
    await act(async () => {});
    expect(screen.queryByLabelText("On-screen keyboard")).toBeNull();
    expect(screen.queryByTestId("above")).toBeNull();
  });
});
