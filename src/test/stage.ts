import { fireEvent, screen } from "@testing-library/react";

// Opens the stage's settings sheet if the page has one and it is closed (the song player keeps hands, mode and the ladder there).
export function openSettings() {
  const b = screen.queryByRole("button", { name: "Settings" });
  if (b && b.getAttribute("aria-expanded") !== "true") fireEvent.click(b);
}
