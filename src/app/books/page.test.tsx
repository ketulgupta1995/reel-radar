// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { getApp } from "@/lib/apps";
import BooksPage from "./page";

describe("Books page", () => {
  it("is registered as an app and opens at its own address", () => {
    const app = getApp("books");
    expect(app.name).toBe("Books");
    expect(app.href).toBe("/books");
  });

  it("starts with an empty library that names the two ways to add a book", () => {
    render(<BooksPage />);
    expect(screen.getByRole("heading", { name: "Your library is empty" })).toBeTruthy();
    expect(screen.getByText(/search/i, { selector: "li" })).toBeTruthy();
    expect(screen.getByText(/upload/i, { selector: "li" })).toBeTruthy();
  });

  it("has the app switcher header, leading to the other apps", () => {
    render(<BooksPage />);
    expect(screen.getByRole("link", { name: "Books" }).getAttribute("href")).toBe("/books");
    fireEvent.click(screen.getByRole("button", { name: "Switch app" }));
    expect(screen.getByRole("link", { name: "🎬 Reel Radar" }).getAttribute("href")).toBe("/reel-radar");
  });
});
