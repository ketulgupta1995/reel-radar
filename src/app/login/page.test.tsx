// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import LoginPage from "./page";
import { jsonResponse } from "@/test/fixtures";

let fetchMock: ReturnType<typeof vi.fn>;
let loc: { href: string; search: string };

beforeEach(() => {
  fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
  // jsdom can't navigate; swap in a plain object so redirects can be asserted.
  loc = { href: "", search: "" };
  Object.defineProperty(window, "location", { value: loc, configurable: true, writable: true });
});

function signIn(username = "kay", password = "s3cret") {
  render(<LoginPage />);
  fireEvent.change(screen.getByPlaceholderText("Username"), { target: { value: username } });
  fireEvent.change(screen.getByPlaceholderText("Password"), { target: { value: password } });
  fireEvent.click(screen.getByText("Sign in"));
}

describe("LoginPage", () => {
  it("disables sign-in until both fields are filled", () => {
    render(<LoginPage />);
    const button = screen.getByText("Sign in") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("Username"), { target: { value: "kay" } });
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("Password"), { target: { value: "x" } });
    expect(button.disabled).toBe(false);
  });

  it("posts credentials and goes home on success", async () => {
    signIn();
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/login", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ username: "kay", password: "s3cret" });
    await waitFor(() => expect(loc.href).toBe("/"));
  });

  it("returns to the page in ?next= after signing in", async () => {
    loc.search = "?next=/watched%3Ftab%3Dtv";
    signIn();
    await waitFor(() => expect(loc.href).toBe("/watched?tab=tv"));
  });

  it.each(["//evil.example", "https://evil.example"])("ignores off-site ?next=%s", async (next) => {
    loc.search = `?next=${encodeURIComponent(next)}`;
    signIn();
    await waitFor(() => expect(loc.href).toBe("/"));
  });

  it("shows the server's error and re-enables the button", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "Invalid username or password" }, { status: 401 }));
    signIn();
    expect(await screen.findByText("Invalid username or password")).toBeTruthy();
    expect((screen.getByText("Sign in") as HTMLButtonElement).disabled).toBe(false);
    expect(loc.href).toBe("");
  });

  it("shows a network error", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    signIn();
    expect(await screen.findByText("Network error")).toBeTruthy();
  });
});
