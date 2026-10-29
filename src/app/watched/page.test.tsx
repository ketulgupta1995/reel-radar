// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { mk } from "@/test/fixtures";
import { routeFetch, seed, stored } from "@/test/pages";

vi.mock("next/navigation", () => ({ usePathname: () => "/watched" }));

import WatchedPage from "./page";

const watched = [
  mk(1, { title: "Zodiac", rating: 7.7, year: 2007, genreNames: ["Crime", "Mystery"] }),
  mk(2, { title: "Andor", mediaType: "tv", rating: 8.4, year: 2022, genreNames: ["Drama"], watchedSeasons: [1, 2] }),
  mk(3, { title: "Memento", rating: 8.2, year: 2000, genreNames: ["Mystery"], posterPath: null }),
];
// Titles of the cards in the main grid or list, in order.
const shown = () => screen.getAllByTitle(/^Remove .* from history$/).map((b) => b.title.replace(/^Remove | from history$/g, ""));

beforeEach(() => {
  routeFetch();
});

describe("WatchedPage", () => {
  it("shows an empty state with a prompt to add titles", () => {
    render(<WatchedPage />);
    expect(screen.getByText("No Watched Titles Yet")).toBeTruthy();
    expect(screen.getByText("Select 10 more to unlock recommendations")).toBeTruthy();
  });

  it("summarises the library", () => {
    seed({ watched });
    render(<WatchedPage />);
    expect(screen.getByText("🎬 2 films")).toBeTruthy();
    expect(screen.getByText("📺 1 series")).toBeTruthy();
    expect(screen.getByText("★ 8.1")).toBeTruthy(); // average
    expect(screen.getByText("~20")).toBeTruthy(); // 2 + 2 + 2 seasons × 8
    expect(screen.getByText("Top: Mystery, Crime, Drama")).toBeTruthy();
    expect(screen.getAllByText("Andor").length).toBeGreaterThan(1); // crown jewel + card
    expect(screen.getByText("Seasons watched: 1, 2")).toBeTruthy();
    expect(screen.getAllByText("No poster").length).toBeGreaterThan(0); // Memento has no poster
  });

  it("filters by type, genre and search, sorts, and resets", () => {
    seed({ watched });
    render(<WatchedPage />);
    expect(shown()).toEqual(["Andor", "Memento", "Zodiac"]);
    for (const [value, order] of [
      ["rating", ["Andor", "Memento", "Zodiac"]],
      ["year-new", ["Andor", "Zodiac", "Memento"]],
      ["year-old", ["Memento", "Zodiac", "Andor"]],
      ["genre", ["Zodiac", "Andor", "Memento"]],
    ] as const) {
      fireEvent.change(screen.getByLabelText("Sort:"), { target: { value } });
      expect(shown()).toEqual(order);
    }
    fireEvent.click(screen.getByText("Series (1)"));
    expect(shown()).toEqual(["Andor"]);
    expect(screen.getByText("Showing 1 of 3 titles")).toBeTruthy();
    fireEvent.click(screen.getByText("Movies (2)"));
    fireEvent.click(screen.getByText("Crime"));
    expect(shown()).toEqual(["Zodiac"]);
    fireEvent.click(screen.getByText("Clear genre filter"));
    fireEvent.click(screen.getByText("Crime"));
    fireEvent.click(screen.getByText("✕"));
    fireEvent.change(screen.getByPlaceholderText("Search watched titles..."), { target: { value: "nothing" } });
    expect(screen.getByText("No watched titles match your current filter combination.")).toBeTruthy();
    fireEvent.click(screen.getByText("Reset all filters"));
    expect(shown()).toHaveLength(3);
  });

  it("moves a title to the watchlist or removes it, in grid and list view", () => {
    seed({ watched, watchlist: [mk(3, { title: "Memento" })], displayed: ["movie:1"] });
    render(<WatchedPage />);
    fireEvent.click(screen.getByTitle("Move Zodiac to watchlist"));
    expect(stored().watched.map((t) => t.id)).toEqual([2, 3]);
    expect(stored().displayed).toEqual([]);
    expect(stored().watchlist.map((t) => t.id)).toEqual([3, 1]);
    fireEvent.click(screen.getByTitle("Move Memento to watchlist")); // already saved: no duplicate
    expect(stored().watchlist).toHaveLength(2);

    fireEvent.click(screen.getByTitle("List view"));
    expect(screen.getByText("S1, S2")).toBeTruthy();
    fireEvent.click(screen.getByText("+ Watchlist")); // Andor, the last one left
    expect(stored().watched).toEqual([]);
  });

  it("removes from the list view, and clears all history after confirming", () => {
    seed({ watched });
    render(<WatchedPage />);
    fireEvent.click(screen.getByTitle("List view"));
    fireEvent.click(screen.getAllByText("Remove")[0]);
    expect(stored().watched).toHaveLength(2);
    fireEvent.click(screen.getByTitle("Grid view"));
    fireEvent.click(screen.getAllByTitle(/from history$/)[0]);
    expect(stored().watched).toHaveLength(1);

    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.click(screen.getByText("Clear all history"));
    expect(stored().watched).toHaveLength(1);
    fireEvent.click(screen.getByText("Clear all history"));
    expect(stored().watched).toEqual([]);
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("unlocks recommendations at ten titles", () => {
    seed({ watched: Array.from({ length: 10 }, (_, i) => mk(i + 1)) });
    render(<WatchedPage />);
    expect(screen.getByText("Get my recommendations").getAttribute("href")).toBe("/recommendations");
  });
});
