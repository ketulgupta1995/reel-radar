// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { mk } from "@/test/fixtures";
import { requests, routeFetch, seed, stored } from "@/test/pages";

vi.mock("next/navigation", () => ({ usePathname: () => "/dismissed" }));

import DismissedPage from "./page";

let fetchMock: ReturnType<typeof routeFetch>;
beforeEach(() => {
  // Only Zodiac resolves; the TV key 404s and the third request fails outright.
  fetchMock = routeFetch({
    "/api/title": (url) => {
      if (url.searchParams.get("id") === "1") return mk(1, { title: "Zodiac" });
      if (url.searchParams.get("id") === "3") throw new Error("offline");
      return new Response(null, { status: 404 });
    },
  });
});

describe("DismissedPage", () => {
  it("shows an empty state", () => {
    render(<DismissedPage />);
    expect(screen.getByText("Nothing here")).toBeTruthy();
    expect(screen.getByText(/0 titles hidden/)).toBeTruthy();
    expect(screen.queryByText("Restore all")).toBeNull();
  });

  it("loads metadata for dismissed keys, newest first, leaving unresolved ones loading", async () => {
    seed({ dismissed: ["movie:1", "tv:2", "movie:3"] });
    render(<DismissedPage />);
    expect(await screen.findByText("Zodiac")).toBeTruthy();
    expect(screen.getByText(/3 titles hidden/)).toBeTruthy();
    expect(screen.getAllByText("Loading…")).toHaveLength(2);
    expect(screen.getAllByTitle(/^Restore /).map((b) => b.title)).toEqual(["Restore movie:3", "Restore tv:2", "Restore Zodiac"]);
    const asked = new Set(requests(fetchMock, "/api/title").map((r) => r.url.search));
    expect([...asked]).toEqual(["?type=movie&id=1", "?type=tv&id=2", "?type=movie&id=3"]);
  });

  it("restores one title, and all titles after confirming", async () => {
    seed({ dismissed: ["movie:1", "tv:2"] });
    render(<DismissedPage />);
    await screen.findByText("Zodiac");
    fireEvent.click(screen.getByTitle("Restore Zodiac"));
    expect(stored().dismissed).toEqual(["tv:2"]);
    expect(screen.getByText(/1 title hidden/)).toBeTruthy();

    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.click(screen.getByText("Restore all"));
    expect(stored().dismissed).toEqual(["tv:2"]);
    fireEvent.click(screen.getByText("Restore all"));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(stored().dismissed).toEqual([]);
    expect(screen.getByText("Nothing here")).toBeTruthy();
  });
});
