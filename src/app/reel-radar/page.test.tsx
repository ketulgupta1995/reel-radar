// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { mk } from "@/test/fixtures";
import { Title } from "@/types/title";

const tmdb = vi.hoisted(() => ({ discover: vi.fn() }));
vi.mock("@/lib/tmdb", () => ({ discover: tmdb.discover, poster: (path: string) => `https://posters.test${path}` }));
vi.mock("next/navigation", () => ({ usePathname: () => "/reel-radar" }));

import ReelRadarHome from "./page";

// Answers the page's two discover calls: the Indian one is the call that passes options.
const feeds = (global: Title[], indian: Title[]) => {
  tmdb.discover.mockImplementation(async (_type: string, _page: number, _genre?: number, options?: object) =>
    options ? indian : global
  );
};

const global = [1, 2, 3, 4].map((id) => mk(id, { title: `Global ${id}`, rating: 8 }));
const indian = [5, 6].map((id) => mk(id, { title: `Indian ${id}`, rating: 7.5, originCountry: ["IN"] }));

const renderPage = async () => render(await ReelRadarHome());
const spotlight = () => screen.queryAllByRole("img").map((img) => img.getAttribute("alt"));

beforeEach(() => {
  tmdb.discover.mockReset();
  feeds(global, indian);
});

describe("ReelRadarHome", () => {
  it("links to the Reel Radar pages", async () => {
    await renderPage();
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    for (const path of ["/discover", "/search", "/watchlist", "/watched", "/analysis"]) expect(hrefs).toContain(path);
  });

  it("asks for trending movies and for Indian movies", async () => {
    await renderPage();
    expect(tmdb.discover).toHaveBeenCalledWith("movie", 1);
    expect(tmdb.discover).toHaveBeenCalledWith("movie", 1, undefined, { originCountry: "IN", minVotes: 5 });
  });

  it("shows four posters: up to three global, then Indian", async () => {
    await renderPage();
    expect(spotlight()).toEqual(["Global 1", "Global 2", "Global 3", "Indian 5"]);
    expect(screen.getByAltText("Indian 5").getAttribute("src")).toBe("https://posters.test/p5.jpg");
    expect(screen.getByText("★ 7.5")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Indian 5" })).toBeTruthy();
  });

  it("gives more room to Indian titles when global ones are short", async () => {
    feeds(global.slice(0, 2), indian);
    await renderPage();
    expect(spotlight()).toEqual(["Global 1", "Global 2", "Indian 5", "Indian 6"]);
  });

  it("leaves out titles with no poster", async () => {
    feeds([mk(1, { title: "No poster", posterPath: null }), ...global.slice(1)], indian);
    await renderPage();
    expect(spotlight()).toEqual(["Global 2", "Global 3", "Global 4", "Indian 5"]);
  });

  it("shows placeholders when there are fewer than four posters", async () => {
    feeds(global.slice(0, 2), indian.slice(0, 1));
    const { container } = await renderPage();
    expect(spotlight()).toEqual([]);
    expect(container.querySelectorAll(".poster")).toHaveLength(4);
  });

  it("still renders, with placeholders, when TMDB fails", async () => {
    tmdb.discover.mockRejectedValue(new Error("TMDB is down"));
    const { container } = await renderPage();
    expect(spotlight()).toEqual([]);
    expect(container.querySelectorAll(".poster")).toHaveLength(4);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("screening room");
  });
});
