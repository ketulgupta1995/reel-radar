// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { jsonResponse, mk } from "@/test/fixtures";
import { requests, routeFetch, seed, stored, stubLocation } from "@/test/pages";
import { MediaType } from "@/types/title";

vi.mock("next/navigation", () => ({ usePathname: () => "/discover" }));

import Discover from "./page";

// Ten titles per page and type: movies 1000+, series 2000+.
const page = (type: MediaType, n: number) =>
  Array.from({ length: 10 }, (_, i) =>
    mk((type === "movie" ? 1000 : 2000) + (n - 1) * 10 + i, { mediaType: type, title: `${type} ${n}-${i}` })
  );
const discoverRoute = (url: URL) => ({
  results: page(url.searchParams.get("type") as MediaType, Number(url.searchParams.get("page"))),
});

let fetch: ReturnType<typeof routeFetch>;
beforeEach(() => {
  fetch = routeFetch({ "/api/discover": discoverRoute, "/api/title": { numberOfSeasons: 3 } });
});

const discoverCalls = (type?: MediaType) =>
  requests(fetch, "/api/discover").filter((r) => !type || r.url.searchParams.get("type") === type);
const cardOf = (title: string) => {
  let el: HTMLElement | null = screen.getByText(title);
  while (el && !within(el).queryByText("Find Similar")) el = el.parentElement;
  return el!;
};

describe("Discover", () => {
  it("loads fifteen unseen movies and series, and records them as displayed", async () => {
    seed({ watched: [mk(1000, { title: "seen" })], dismissed: ["movie:1001"] });
    render(<Discover />);
    expect(await screen.findByText("movie 1-2")).toBeTruthy();
    await screen.findByText("tv 1-0");
    expect(screen.queryByText("movie 1-0")).toBeNull(); // watched
    expect(screen.queryByText("movie 1-1")).toBeNull(); // dismissed
    expect(screen.getAllByText("15 items")).toHaveLength(2);
    expect(discoverCalls("movie").map((r) => r.url.searchParams.get("page"))).toEqual(["1", "2"]);
    await waitFor(() => expect(stored().displayed).toHaveLength(30));
    expect(screen.getByText("Select 9 more to unlock recommendations.")).toBeTruthy();
  });

  it("loads the next batch past what's been displayed", async () => {
    render(<Discover />);
    await screen.findByText("movie 1-0");
    await screen.findByText("tv 1-0");
    fireEvent.click(screen.getByText("Next batch of Movies ➜"));
    // The first batch read pages 1-2, so the next one starts at page 3.
    expect(await screen.findByText("movie 3-0")).toBeTruthy();
    expect(screen.queryByText("movie 1-0")).toBeNull();
    fireEvent.click(screen.getByText("Next batch of Series ➜"));
    expect(await screen.findByText("tv 3-0")).toBeTruthy();
  });

  it("filters by format and refetches for a region", async () => {
    render(<Discover />);
    await screen.findByText("tv 1-0");
    fireEvent.click(screen.getByText("Series only"));
    expect(screen.queryByText("Feature Films & Movies", { exact: false })).toBeNull();
    fireEvent.click(screen.getByText("Movies only"));
    expect(screen.queryByText("TV & Web Series", { exact: false })).toBeNull();
    fireEvent.click(screen.getByText("Both (Movies & Series)"));
    fireEvent.click(screen.getByText("Indian Cinema & Series"));
    await waitFor(() => expect(discoverCalls().some((r) => r.url.searchParams.get("region") === "in")).toBe(true));
    fireEvent.click(screen.getByText("Hollywood & Global"));
    await waitFor(() => expect(discoverCalls().some((r) => r.url.searchParams.get("region") === "global")).toBe(true));
    fireEvent.click(screen.getByText("All Regions"));
  });

  it("marks seen, saves, and dismisses titles", async () => {
    render(<Discover />);
    await screen.findByText("movie 1-0");
    const card = cardOf("movie 1-0");
    fireEvent.click(within(card).getByText("+ Watchlist"));
    expect(within(card).getByText("✓ Watchlist")).toBeTruthy();
    fireEvent.click(within(card).getByText("Mark seen"));
    expect(stored().watched.map((t) => t.id)).toEqual([1000]);
    expect(stored().watchlist).toEqual([]);
    fireEvent.click(within(card).getByText("✓ Seen"));
    expect(stored().watched).toEqual([]);
    fireEvent.click(within(card).getByText("+ Watchlist"));
    fireEvent.click(within(card).getByText("✓ Watchlist"));
    expect(stored().watchlist).toEqual([]);
    fireEvent.click(within(cardOf("movie 1-1")).getByText("Not interested"));
    expect(screen.queryByText("movie 1-1")).toBeNull();
    expect(stored().dismissed).toEqual(["movie:1001"]);
  });

  it("tracks seasons of watched series, fetching the season count when unknown", async () => {
    seed({ watched: [mk(5, { mediaType: "tv", title: "Dark", watchedSeasons: [1] }), mk(6, { mediaType: "tv", title: "Fargo", numberOfSeasons: 2 })] });
    render(<Discover />);
    expect(await screen.findByText("1/3 seasons")).toBeTruthy();
    expect(requests(fetch, "/api/title")[0].url.searchParams.get("id")).toBe("5");
    expect(screen.getByText("0/2 seasons")).toBeTruthy();
    fireEvent.click(screen.getAllByText("S3")[0]);
    expect(stored().watched[0].watchedSeasons).toEqual([1, 3]);
    fireEvent.click(screen.getAllByText("S1")[0]);
    expect(stored().watched[0].watchedSeasons).toEqual([3]);
  });

  it("says when a season total is unavailable", async () => {
    routeFetch({ "/api/discover": discoverRoute, "/api/title": {} });
    seed({ watched: [mk(5, { mediaType: "tv", title: "Dark" })] });
    render(<Discover />);
    expect(await screen.findByText("Season total unavailable")).toBeTruthy();
  });

  it("offers a deeper scan when nothing unseen is left, wrapping back to page one", async () => {
    // Only page 1 has titles, and they're all already displayed.
    routeFetch({
      "/api/discover": (url: URL) => (url.searchParams.get("page") === "1" ? discoverRoute(url) : { results: [] }),
    });
    seed({ displayed: [...page("movie", 1), ...page("tv", 1)].map((t) => `${t.mediaType}:${t.id}`) });
    render(<Discover />);
    expect(await screen.findByText(/No unseen movies found/)).toBeTruthy();
    expect(await screen.findByText(/No unseen series found/)).toBeTruthy();
    const [movies, series] = screen.getAllByText("Scan next batch");
    fireEvent.click(movies);
    fireEvent.click(series);
    await waitFor(() => expect(screen.getAllByText("Scan next batch")).toHaveLength(2));
  });

  it("shows an error with a retry", async () => {
    routeFetch({ "/api/discover": () => jsonResponse({ error: "TMDB is down" }, { status: 500 }) });
    render(<Discover />);
    expect((await screen.findAllByText("TMDB is down", { exact: false })).length).toBeGreaterThan(0);
    routeFetch({ "/api/discover": () => jsonResponse({}, { status: 500 }) });
    fireEvent.click(screen.getByText("Retry"));
    expect(await screen.findByText(/Couldn't load movies|Couldn't load series/)).toBeTruthy();
    routeFetch({ "/api/discover": () => Promise.reject("offline") });
    fireEvent.click(screen.getByText("Retry"));
    expect(await screen.findByText(/Couldn't load titles/)).toBeTruthy();
  });

  it("clears discovery history and resets everything after confirming", async () => {
    const loc = stubLocation();
    seed({ watched: [mk(1)], displayed: ["movie:9"], shown: ["movie:8"], dismissed: ["movie:7"] });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Discover />);
    await screen.findByText("movie 1-0");
    await screen.findByText("tv 1-0");
    fireEvent.click(screen.getByText("Clear Displayed & Shown"));
    fireEvent.click(screen.getByText("Reset All"));
    expect(stored().shown).toEqual(["movie:8"]);
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByText("Clear Displayed & Shown"));
    await waitFor(() => expect(stored().shown).toEqual([]));
    expect(stored().dismissed).toEqual(["movie:7"]);
    // Let the reloaded batches land first: one landing after the reset would save the old state back.
    await waitFor(() => expect(["movie:", "tv:"].every((t) => stored().displayed.some((k) => k.startsWith(t)))).toBe(true));
    fireEvent.click(screen.getByText("Reset All"));
    await waitFor(() => expect(loc.reload).toHaveBeenCalled());
    expect(stored().watched).toEqual([]);
  });

  it("unlocks recommendations at ten watched titles", async () => {
    seed({ watched: Array.from({ length: 10 }, (_, i) => mk(i + 1)) });
    render(<Discover />);
    expect(screen.getByText("Get my recommendations (10 titles analyzed)").getAttribute("href")).toBe("/recommendations");
    expect(screen.getByText(/Great progress! With 10 viewed titles/)).toBeTruthy();
    await screen.findByText("movie 1-0");
  });
});
