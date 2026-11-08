// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// next/font only works inside Next's compiler; here each face is just its CSS variable's class.
vi.mock("next/font/google", () => ({
  Archivo: () => ({ variable: "font-display-var" }),
  JetBrains_Mono: () => ({ variable: "font-mono-var" }),
}));

import PlannerLayout, { metadata } from "./layout";

describe("planner layout", () => {
  it("wraps the page in the Bold focus palette and both fonts", () => {
    render(
      <PlannerLayout>
        <p>Inside</p>
      </PlannerLayout>
    );
    const box = screen.getByText("Inside").parentElement!;
    expect(box.className).toContain("bf ");
    expect(box.className).toContain("font-display-var");
    expect(box.className).toContain("font-mono-var");
    expect(metadata.title).toBe("Daily Planner");
  });
});
