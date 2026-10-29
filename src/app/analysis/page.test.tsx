// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { mk } from "@/test/fixtures";
import { routeFetch, seed, stored } from "@/test/pages";
import { Title } from "@/types/title";

vi.mock("next/navigation", () => ({ usePathname: () => "/analysis" }));

import AnalysisPage from "./page";

const nolan = { id: 1, name: "Christopher Nolan" };
const caine = { id: 2, name: "Michael Caine" };
const bale = { id: 3, name: "Christian Bale" };

// A library that switches on every section: director and actor hubs, a director universe,
// an unfinished series, hidden gems and guilty pleasures, Indian titles, and enough titles
// for the blindspot checks.
const library: Title[] = [
  mk(1, { title: "Memento", year: 2000, rating: 8.2, popularity: 30, creators: [nolan], cast: [caine] }),
  mk(2, { title: "The Prestige", year: 2006, rating: 8.2, popularity: 40, creators: [nolan], cast: [caine, bale] }),
  mk(3, { title: "Batman Begins", year: 2005, rating: 7.7, popularity: 50, creators: [nolan], cast: [caine, bale] }),
  mk(4, { title: "Inception", year: 2010, rating: 8.4, popularity: 90, creators: [nolan], cast: [caine], genreNames: ["Science Fiction"] }),
  mk(5, { title: "Hidden Gem", year: 2015, rating: 9.5, popularity: 5 }),
  mk(6, { title: "Guilty Pleasure", year: 2012, rating: 5.9, popularity: 80, genreNames: ["Action"] }),
  mk(7, { title: "Dark", mediaType: "tv", year: 2017, rating: 8.7, numberOfSeasons: 3, watchedSeasons: [1], overview: "Time travel" }),
  mk(8, { title: "Fargo", mediaType: "tv", year: 2014, rating: 8.3, numberOfSeasons: 2, watchedSeasons: [1, 2] }),
  mk(9, { title: "Lagaan", year: 2001, rating: 8.1, originCountry: ["IN"], originalLanguage: "hi" }),
  mk(10, { title: "Sholay", year: 1975, rating: 8.1, originCountry: ["IN"], originalLanguage: "hi" }),
  ...Array.from({ length: 12 }, (_, i) => mk(100 + i, { title: `Filler ${i}`, year: 1995 + i, rating: 6.8, popularity: 20 })),
];

beforeEach(() => {
  routeFetch();
});

describe("AnalysisPage", () => {
  it("shows an empty state without watched titles", () => {
    render(<AnalysisPage />);
    expect(screen.getByText("No Viewing Data Yet")).toBeTruthy();
  });

  it("renders the full report for a varied library", () => {
    seed({ watched: library, watchlist: [mk(500)] });
    render(<AnalysisPage />);
    expect(screen.getByText("Screen Time Mileage")).toBeTruthy();
    expect(screen.getByText("Orphaned Series Alert")).toBeTruthy();
    expect(screen.getByText("1 Unfinished Runs")).toBeTruthy();
    expect(screen.getByText("Next up: Season 2")).toBeTruthy();
    expect(screen.getByText(/Cinema Constellation Graph/)).toBeTruthy();
    expect(screen.getAllByText("Christopher Nolan").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Hidden Gem").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Guilty Pleasure").length).toBeGreaterThan(0);
  });

  it("filters by format and region, and resets when nothing matches", () => {
    seed({ watched: library });
    render(<AnalysisPage />);
    fireEvent.click(screen.getByText("Series"));
    expect(screen.queryByText("No watched titles match your current filter combination.")).toBeNull();
    fireEvent.click(screen.getByText("Indian"));
    expect(screen.getByText("No watched titles match your current filter combination.")).toBeTruthy();
    fireEvent.click(screen.getByText("Reset active filters"));
    expect(screen.getByText("Screen Time Mileage")).toBeTruthy();
    fireEvent.click(screen.getByText("Movies"));
    fireEvent.click(screen.getByText("Global"));
    fireEvent.click(screen.getByText("All Regions"));
    fireEvent.click(screen.getByText("All Formats"));
    expect(screen.getByText("Orphaned Series Alert")).toBeTruthy();
  });

  it("tracks seasons of an unfinished series", () => {
    seed({ watched: library });
    render(<AnalysisPage />);
    fireEvent.click(screen.getByTitle("Click to mark Season 2 as watched"));
    expect(stored().watched.find((t) => t.id === 7)!.watchedSeasons).toEqual([1, 2]);
    fireEvent.click(screen.getByTitle("Season 1 watched (click to unmark)"));
    expect(stored().watched.find((t) => t.id === 7)!.watchedSeasons).toEqual([2]);
  });

  it("falls back to season 1 when the last season is unmarked", () => {
    seed({ watched: library });
    render(<AnalysisPage />);
    fireEvent.click(screen.getByTitle("Season 1 watched (click to unmark)"));
    expect(stored().watched.find((t) => t.id === 7)!.watchedSeasons).toEqual([1]);
  });

  it("isolates a talent hub or node in the constellation graph", () => {
    seed({ watched: library });
    const { container } = render(<AnalysisPage />);
    const hub = screen.getAllByText("Christopher Nolan").find((el) => el.closest("button"))!.closest("button")!;
    fireEvent.click(hub);
    expect(screen.getByText("Reset Constellation")).toBeTruthy();
    expect(screen.getByText("Director Hub")).toBeTruthy();
    const panel = screen.getByText("Director Hub").closest("div")!.parentElement!.parentElement!;
    fireEvent.click(within(panel).getByText("Memento"));
    expect(screen.getByText("Film / Series Node")).toBeTruthy();
    fireEvent.click(screen.getAllByText("✕").find((el) => el.tagName === "BUTTON")!); // the detail panel's close
    expect(screen.queryByText("Film / Series Node")).toBeNull();

    const nodes = container.querySelectorAll("svg g.cursor-pointer");
    expect(nodes.length).toBeGreaterThan(0);
    fireEvent.click(nodes[0]);
    expect(screen.getByText("Reset Constellation")).toBeTruthy();
    fireEvent.click(nodes[0]); // clicking the selected node again clears it
    expect(screen.queryByText("Reset Constellation")).toBeNull();
    fireEvent.click(hub);
    fireEvent.click(hub);
    fireEvent.click(nodes[1]);
    fireEvent.click(screen.getByText("Reset Constellation"));
    expect(screen.queryByText("Reset Constellation")).toBeNull();
  });
});
