// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { jsonResponse, mk } from "@/test/fixtures";
import { requests, routeFetch, seed, stored } from "@/test/pages";

vi.mock("next/navigation", () => ({ usePathname: () => "/recommendations" }));

import Recommendations from "./page";

const watched = Array.from({ length: 10 }, (_, i) => mk(i + 1));
const rec = (id: number, extra = {}) => ({ ...mk(id, { title: `Rec ${id}` }), why: `because ${id}`, ...extra });
const categories = {
  indianMovies: [rec(100, { originCountry: ["IN"] })],
  globalMovies: [rec(101), rec(102)],
  indianSeries: [rec(200, { mediaType: "tv", originCountry: ["IN"] })],
  globalSeries: [rec(201, { mediaType: "tv" })],
  thematicShelves: [{ id: "noir", title: "Neo-Noir Nights", subtitle: "Dark streets", badge: "Shelf", items: [rec(300)] }],
};

const recsFetch = (body: object = { categories, summary: ["Drama", "Crime"] }) =>
  routeFetch({ "/api/recommendations": body });

const cardOf = (title: string) => {
  let el: HTMLElement | null = screen.getByText(title);
  while (el && !within(el).queryByText("Find Similar")) el = el.parentElement;
  return el!;
};
const sections = () => screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);

describe("Recommendations", () => {
  it("asks for ten titles before calling the API", () => {
    const fetch = recsFetch();
    seed({ watched: watched.slice(0, 3) });
    render(<Recommendations />);
    expect(requests(fetch, "/api/recommendations")).toHaveLength(0);
    expect(screen.getByText(/Calibrated against 3 viewed titles/)).toBeTruthy();
  });

  it("shows each shelf and category, and records them as shown", async () => {
    const fetch = recsFetch();
    seed({ watched, shown: ["movie:999"], dismissed: ["movie:5"] });
    render(<Recommendations />);
    expect(await screen.findByText("Rec 101")).toBeTruthy();
    expect(sections()).toEqual([
      "Neo-Noir Nights",
      "Indian Movies",
      "Global & Hollywood Movies",
      "Indian Web Series & Shows",
      "Global & International Series",
    ]);
    expect(screen.getByText(/Core: Drama, Crime/)).toBeTruthy();
    const body = JSON.parse(requests(fetch, "/api/recommendations")[0].init!.body as string);
    expect(body).toMatchObject({ seen: ["movie:999"], dismissed: ["movie:5"], discoveryStyle: "balanced", era: "all", mood: "all" });
    expect(stored().shown).toEqual(["movie:999", "movie:100", "movie:101", "movie:102", "tv:200", "tv:201", "movie:300"]);
  });

  it("filters by format and region without refetching", async () => {
    const fetch = recsFetch();
    seed({ watched });
    render(<Recommendations />);
    await screen.findByText("Rec 101");
    fireEvent.click(screen.getByText("Series"));
    expect(sections()).toEqual(["Neo-Noir Nights", "Indian Web Series & Shows", "Global & International Series"]);
    fireEvent.click(screen.getByText("Movies"));
    fireEvent.click(screen.getByText("Indian"));
    expect(sections()).toEqual(["Neo-Noir Nights", "Indian Movies"]);
    fireEvent.click(screen.getByText("Global"));
    expect(sections()).toEqual(["Neo-Noir Nights", "Global & Hollywood Movies"]);
    fireEvent.click(screen.getByText("All Regions"));
    fireEvent.click(screen.getByText("All Formats"));
    expect(sections()).toHaveLength(5);
    expect(requests(fetch, "/api/recommendations")).toHaveLength(1);
  });

  it("refetches with the chosen depth, era and mood", async () => {
    const fetch = recsFetch();
    seed({ watched });
    render(<Recommendations />);
    await screen.findByText("Rec 101");
    fireEvent.click(screen.getByText("★ Hidden Gems"));
    await waitFor(() => expect(requests(fetch, "/api/recommendations")).toHaveLength(2));
    fireEvent.click(screen.getByText("2020s"));
    await waitFor(() => expect(requests(fetch, "/api/recommendations")).toHaveLength(3));
    fireEvent.click(screen.getByText("🌀 Mind-Bending"));
    await waitFor(() => expect(requests(fetch, "/api/recommendations")).toHaveLength(4));
    fireEvent.click(screen.getByText("Mainstream Hits"));
    fireEvent.click(screen.getByText("Balanced"));
    fireEvent.click(screen.getByText("Refresh recommendations"));
    await waitFor(() => expect(requests(fetch, "/api/recommendations")).toHaveLength(7));
    const last = JSON.parse(requests(fetch, "/api/recommendations")[6].init!.body as string);
    expect(last).toMatchObject({ discoveryStyle: "balanced", era: "recent", mood: "mindbending" });
  });

  it("marks seen, saves, and dismisses, hiding saved and dismissed titles", async () => {
    recsFetch();
    seed({ watched });
    render(<Recommendations />);
    await screen.findByText("Rec 101");
    fireEvent.click(within(cardOf("Rec 101")).getByText("Mark seen"));
    expect(stored().watched.map((t) => t.id)).toContain(101);
    fireEvent.click(within(cardOf("Rec 101")).getByText("✓ Seen"));
    expect(stored().watched.map((t) => t.id)).not.toContain(101);
    fireEvent.click(within(cardOf("Rec 101")).getByText("+ Watchlist"));
    expect(screen.queryByText("Rec 101")).toBeNull(); // saved titles leave the list
    expect(stored().watchlist.map((t) => t.id)).toEqual([101]);
    fireEvent.click(within(cardOf("Rec 102")).getByText("Not interested"));
    expect(screen.queryByText("Rec 102")).toBeNull();
    expect(stored().dismissed).toEqual(["movie:102"]);
    fireEvent.click(within(cardOf("Rec 300")).getByText("Not interested"));
    expect(screen.queryByText("Neo-Noir Nights")).toBeNull(); // empty shelves disappear
  });

  it("shows the API's error", async () => {
    routeFetch({ "/api/recommendations": () => jsonResponse({ error: "Select at least 10 titles." }, { status: 400 }) });
    seed({ watched });
    render(<Recommendations />);
    expect(await screen.findByText("Select at least 10 titles.")).toBeTruthy();
  });

  it("copes with missing categories and a non-Error failure", async () => {
    recsFetch({ categories: {} });
    seed({ watched });
    render(<Recommendations />);
    await waitFor(() => expect(screen.queryByText("Refresh recommendations")).toBeTruthy());
    routeFetch({ "/api/recommendations": () => Promise.reject("nope") });
    fireEvent.click(screen.getByText("Refresh recommendations"));
    expect(await screen.findByText("Unable to recommend")).toBeTruthy();
  });
});
