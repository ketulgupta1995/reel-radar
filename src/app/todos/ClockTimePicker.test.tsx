// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ClockTimePicker, formatClock } from "./ClockTimePicker";

const setup = (value = "") => {
  const onChange = vi.fn();
  render(<ClockTimePicker label="Woke up" value={value} fallback="07:00" onChange={onChange} />);
  return onChange;
};
const open = () => fireEvent.click(screen.getByRole("button", { name: /^Woke up:/ }));

describe("formatClock", () => {
  it("shows 24-hour times as 12-hour", () => {
    expect(formatClock("00:05")).toBe("12:05 AM");
    expect(formatClock("12:00")).toBe("12:00 PM");
    expect(formatClock("18:30")).toBe("6:30 PM");
    expect(formatClock("")).toBe("");
  });
});

describe("ClockTimePicker", () => {
  it("starts the clock at the fallback and saves the picked hour, minute and period", () => {
    const onChange = setup();
    expect(screen.getByText("Set time")).toBeTruthy();
    open();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByLabelText("7 o'clock").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByLabelText("9 o'clock"));
    // It moves on to the minutes by itself.
    expect(screen.getByLabelText("30 minutes")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("30 minutes"));
    fireEvent.click(screen.getByText("PM"));
    fireEvent.click(screen.getByText("Done"));
    expect(onChange).toHaveBeenCalledWith("21:30");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("starts from the current time and fine-tunes minutes one at a time, wrapping around", () => {
    const onChange = setup("06:00");
    open();
    fireEvent.click(screen.getByText("12", { selector: "button" })); // the hour 12 on the dial
    fireEvent.click(screen.getByText("AM"));
    fireEvent.click(screen.getByText("− 1 min"));
    fireEvent.click(screen.getByText("+ 1 min"));
    fireEvent.click(screen.getByText("− 1 min"));
    fireEvent.click(screen.getByText("Done"));
    expect(onChange).toHaveBeenCalledWith("00:59");
  });

  it("changes the hour again from the readout, and switches back to the hours", () => {
    const onChange = setup("13:20");
    open();
    fireEvent.click(screen.getByText("20", { selector: "button" }));
    expect(screen.getByLabelText("20 minutes").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByText("01", { selector: "button" }));
    fireEvent.click(screen.getByLabelText("2 o'clock"));
    fireEvent.click(screen.getByText("Done"));
    expect(onChange).toHaveBeenCalledWith("14:20"); // still PM
  });

  it("clears the time", () => {
    const onChange = setup("06:45");
    expect(screen.getByRole("button", { name: "Woke up: 6:45 AM" })).toBeTruthy();
    open();
    fireEvent.click(screen.getByText("Clear"));
    expect(onChange).toHaveBeenCalledWith("");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes without changing anything on Cancel, Escape, a click outside, or the button again", () => {
    const onChange = setup("06:45");
    open();
    fireEvent.click(screen.getByLabelText("9 o'clock"));
    fireEvent.click(screen.getByText("Cancel"));
    open();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    open();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
    open();
    fireEvent.mouseDown(screen.getByRole("dialog")); // inside: stays open
    fireEvent.keyDown(document, { key: "a" });
    expect(screen.getByRole("dialog")).toBeTruthy();
    open();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});
