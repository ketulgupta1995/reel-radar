// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PianoKeyboard } from "./PianoKeyboard";

describe("PianoKeyboard", () => {
  it("draws the range with letter labels and black keys", () => {
    render(<PianoKeyboard low={60} high={72} />);
    expect(screen.getAllByRole("button")).toHaveLength(13);
    expect(screen.getByLabelText("C#4").textContent).toBe("C#");
    expect(screen.getByLabelText("C4").textContent).toBe("C4");
    expect(screen.getByLabelText("D4").textContent).toBe("D");
  });

  it("can hide the labels", () => {
    render(<PianoKeyboard low={60} high={62} labels={false} />);
    expect(screen.getByLabelText("C4").textContent).toBe("");
  });

  it("shows held, target and finger-numbered keys", () => {
    render(<PianoKeyboard low={60} high={64} pressed={new Set([60])} lit={new Set([64, 62])} fingers={{ 62: 3, 61: 2 }} />);
    expect(screen.getByLabelText("C4").getAttribute("data-state")).toBe("pressed");
    expect(screen.getByLabelText("C4").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("E4").getAttribute("data-state")).toBe("lit");
    expect(screen.getByLabelText("D4").textContent).toContain("3");
    expect(screen.getByLabelText("C#4").textContent).toContain("2");
    expect(screen.getByLabelText("D#4").getAttribute("data-state")).toBe("idle");
  });

  it("reports each press once and its release", () => {
    const onPress = vi.fn();
    const onRelease = vi.fn();
    render(<PianoKeyboard low={60} high={64} onPress={onPress} onRelease={onRelease} />);
    const c = screen.getByLabelText("C4");
    fireEvent.pointerDown(c);
    fireEvent.pointerDown(c);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledWith(60);
    fireEvent.pointerLeave(c);
    fireEvent.pointerUp(c); // already released
    expect(onRelease).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(c);
    fireEvent.pointerUp(c);
    fireEvent.pointerDown(c);
    fireEvent.pointerCancel(c);
    expect(onRelease).toHaveBeenCalledTimes(3);
  });

  it("works without handlers", () => {
    render(<PianoKeyboard low={60} high={62} />);
    const c = screen.getByLabelText("C4");
    fireEvent.pointerDown(c);
    fireEvent.pointerUp(c);
  });
});
