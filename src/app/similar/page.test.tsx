// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { jsonResponse, mk } from "@/test/fixtures";
import { requests, routeFetch, seed, stored } from "@/test/pages";

const nav = vi.hoisted(() => ({ search: "type=movie&id=10" }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/similar",
  useSearchParams: () => new URLSearchParams(nav.search),
}));

import SimilarPage from "./page";
import ReelRadarHome from "../reel-radar/page";

const source = mk(10, { title: "Heat", genreNames: ["Crime", "Thriller"], rating: 8.3, year: 1995 });
const similar = [mk(11, { title: "Collateral", similarityScore: 91, why: "Same director" }), mk(12, { title: "Thief" })];

let fetch: ReturnType<typeof routeFetch>;
beforeEach(() => {
  nav.search = "type=movie&id=10";
  fetch = routeFetch({ "/api/title": source, "/api/similar": { results: similar } });
});

const cardOf = (title: string) => {
  let el: HTMLElement | null = screen.getAllByText(title).at(-1)!;
  while (el && !within(el).queryByText("Find Similar")) el = el.parentElement;
  return el!;
};

describe("SimilarPage", () => {
  it("shows the source title and its similar titles", async () => {
    render(<SimilarPage />);
    expect(await screen.findByText(/Titles Similar to/)).toBeTruthy();
    expect(screen.getByText("Crime, Thriller")).toBeTruthy();
    expect(screen.getByText("91% Match")).toBeTruthy();
    expect(screen.getByText("Thief")).toBeTruthy();
    expect(requests(fetch, "/api/similar")[0].url.searchParams.get("minYear")).toBe("1990");
  });

  it("refetches for another era, and offers all eras when nothing matches", async () => {
    render(<SimilarPage />);
    await screen.findByText("Thief");
    fetch.mockImplementation(async (input: string) =>
      String(input).startsWith("/api/similar") ? jsonResponse({ results: [] }) : jsonResponse(source)
    );
    fireEvent.click(screen.getByText("2010s+"));
    expect(await screen.findByText("No Similar Titles Found")).toBeTruthy();
    fireEvent.click(screen.getByText("Show All Eras"));
    await waitFor(() => expect(fetch.mock.calls.some(([u]) => String(u).includes("minYear=all"))).toBe(true));
  });

  it("marks the source and similar titles seen, saves them, and dismisses", async () => {
    render(<SimilarPage />);
    await screen.findByText("Thief");
    fireEvent.click(screen.getByText("+ Mark Seen"));
    expect(screen.getByText("✓ Watched")).toBeTruthy();
    fireEvent.click(screen.getByText("✓ Watched"));
    fireEvent.click(screen.getAllByText("+ Watchlist")[0]);
    expect(screen.getByText("✓ In Watchlist")).toBeTruthy();
    fireEvent.click(screen.getByText("✓ In Watchlist"));
    expect(stored()).toMatchObject({ watched: [], watchlist: [] });

    const card = cardOf("Collateral");
    fireEvent.click(within(card).getByText("+ Watchlist"));
    fireEvent.click(within(card).getByText("Mark seen"));
    expect(stored().watched.map((t) => t.id)).toEqual([11]);
    expect(stored().watchlist).toEqual([]);
    fireEvent.click(within(card).getByText("✓ Seen"));
    fireEvent.click(within(card).getByText("+ Watchlist"));
    fireEvent.click(within(card).getByText("✓ Watchlist"));
    fireEvent.click(within(cardOf("Thief")).getByText("Not interested"));
    expect(screen.queryByText("Thief")).toBeNull();
    expect(stored().dismissed).toEqual(["movie:12"]);
  });

  it("explains a missing id or a failed request", async () => {
    nav.search = "type=movie";
    const { unmount } = render(<SimilarPage />);
    expect(await screen.findByText("Missing or invalid title identifier.")).toBeTruthy();
    unmount();
    nav.search = "type=tv&id=5";
    fetch.mockImplementation(async (input: string) =>
      String(input).startsWith("/api/similar") ? jsonResponse({}, { status: 500 }) : jsonResponse({}, { status: 404 })
    );
    render(<SimilarPage />);
    expect(await screen.findByText("Failed to fetch similar titles")).toBeTruthy();
  });

  it("adds to a dismissed list that already exists", async () => {
    seed({ dismissed: ["tv:1"] });
    render(<SimilarPage />);
    await screen.findByText("Thief");
    fireEvent.click(within(cardOf("Thief")).getByText("Not interested"));
    expect(stored().dismissed).toEqual(["tv:1", "movie:12"]);
  });
});

describe("ReelRadarHome", () => {
  it("links to the Reel Radar pages", async () => {
    render(await ReelRadarHome());
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    for (const path of ["/discover", "/search", "/watchlist", "/watched", "/analysis"]) expect(hrefs).toContain(path);
  });
});
