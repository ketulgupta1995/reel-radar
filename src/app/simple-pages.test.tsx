// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { mk } from "@/test/fixtures";
import { requests, routeFetch, seed, stored, stubLocation } from "@/test/pages";
import { APPS } from "@/lib/apps";

const nav = vi.hoisted(() => ({ params: { id: "42" } as Record<string, string> }));
vi.mock("next/navigation", () => ({ usePathname: () => "/", useParams: () => nav.params }));

import Home from "./page";
import Layout, { metadata } from "./layout";
import SearchPage from "./search/page";
import PersonPage from "./person/[id]/page";
import WatchlistPage from "./watchlist/page";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// The card for a title: the nearest wrapper around its name that also holds "Find Similar".
const cardOf = (title: string) => {
  let el: HTMLElement | null = screen.getByText(title);
  while (el && !within(el).queryByText("Find Similar")) el = el.parentElement;
  return el!;
};

describe("Home", () => {
  it("links to every registered app", () => {
    render(<Home />);
    for (const app of APPS) {
      const link = screen.getByText(app.name).closest("a")!;
      expect(link.getAttribute("href")).toBe(app.href);
    }
  });
});

describe("Layout", () => {
  it("links the install manifest and icons", () => {
    expect(metadata.manifest).toBe("/manifest.webmanifest");
    expect(metadata.icons.apple).toBe("/apple-touch-icon.png");
  });

  it("renders the page with the logout button", () => {
    const html = Layout({ children: <p>child</p> }) as React.ReactElement<{ children: React.ReactElement }>;
    expect(html.props.children).toBeTruthy();
  });
});

describe("SearchPage", () => {
  it("gets the latest from TMDB for the search on request", async () => {
    routeFetch({ "/api/search": { results: [mk(1, { title: "Dune" })] } });
    stubLocation("");
    render(<SearchPage />);
    expect(screen.queryByText("↻ Get latest from TMDB")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText(/Search for a movie/), { target: { value: "dune" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByText("Dune");
    const fetch = routeFetch({ "/api/search": { results: [mk(2, { title: "Dune: Part Two" })] } });
    fireEvent.click(screen.getByText("↻ Get latest from TMDB"));
    expect(await screen.findByText("Dune: Part Two")).toBeTruthy();
    expect(requests(fetch, "/api/tmdb/refresh")).toHaveLength(1);
    expect(requests(fetch, "/api/search")[0].init?.cache).toBe("reload");
  });

  it("searches and shows results", async () => {
    const fetch = routeFetch({ "/api/search": { results: [mk(1, { title: "Dune" }), mk(2, { title: "Arrival" })] } });
    stubLocation("");
    render(<SearchPage />);
    fireEvent.change(screen.getByPlaceholderText(/Search for a movie/), { target: { value: "villeneuve" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("Dune")).toBeTruthy();
    expect(screen.getByText("Arrival")).toBeTruthy();
    expect(requests(fetch, "/api/search")[0].url.searchParams.get("query")).toBe("villeneuve");
  });

  it("runs the search from ?q= on load, and ignores a blank query", async () => {
    const fetch = routeFetch({ "/api/search": { results: [mk(1, { title: "Dune" })] } });
    stubLocation("?q=dune");
    render(<SearchPage />);
    expect(await screen.findByText("Dune")).toBeTruthy();
    expect((screen.getByPlaceholderText(/Search for a movie/) as HTMLInputElement).value).toBe("dune");
    fireEvent.change(screen.getByPlaceholderText(/Search for a movie/), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(requests(fetch, "/api/search")).toHaveLength(1);
  });

  it("marks a result seen or saves it, and clears it from the watchlist when seen", async () => {
    routeFetch({ "/api/search": { results: [mk(1, { title: "Dune" })] } });
    stubLocation("?q=dune");
    render(<SearchPage />);
    await screen.findByText("Dune");
    const card = cardOf("Dune");
    fireEvent.click(within(card).getByText("+ Watchlist"));
    expect(stored().watchlist.map((t) => t.id)).toEqual([1]);
    expect(within(card).getByText("✓ Saved")).toBeTruthy();
    fireEvent.click(within(card).getByText("+ Mark Seen"));
    expect(stored().watched.map((t) => t.id)).toEqual([1]);
    expect(stored().watchlist).toEqual([]);
    fireEvent.click(within(card).getByText("✓ Watched"));
    expect(stored().watched).toEqual([]);
    fireEvent.click(within(card).getByText("+ Watchlist"));
    fireEvent.click(within(card).getByText("✓ Saved"));
    expect(stored().watchlist).toEqual([]);
    expect(within(card).getByText("Find Similar").getAttribute("href")).toBe("/similar?type=movie&id=1");
  });

  it("survives a failed search", async () => {
    routeFetch({ "/api/search": () => Promise.reject(new Error("offline")) });
    stubLocation("");
    render(<SearchPage />);
    fireEvent.change(screen.getByPlaceholderText(/Search for a movie/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Search" })).toBeTruthy());
    expect(console.error).toHaveBeenCalled();
  });
});

describe("PersonPage", () => {
  it("gets the latest from TMDB for this person, past both caches, on request", async () => {
    nav.params = { id: "42" };
    const fetch = routeFetch({ "/api/person/*": { name: "Denis Villeneuve", titles: [mk(1, { title: "Sicario" })] } });
    render(<PersonPage />);
    await screen.findByText("Sicario");
    expect(requests(fetch, "/api/person/42")[0].init).toBeUndefined();
    fetch.mockImplementation(async (input: string) =>
      new Response(JSON.stringify(String(input).startsWith("/api/person") ? { name: "Denis Villeneuve", titles: [mk(2, { title: "New Film" })] } : {}))
    );
    fireEvent.click(screen.getByText("↻ Get latest from TMDB"));
    expect(await screen.findByText("New Film")).toBeTruthy();
    expect(JSON.parse(requests(fetch, "/api/tmdb/refresh")[0].init?.body as string)).toEqual({ person: 42 });
    expect(requests(fetch, "/api/person/42").at(-1)!.init?.cache).toBe("reload");
  });

  it("shows the person's titles and toggles watched and watchlist", async () => {
    nav.params = { id: "42" };
    const fetch = routeFetch({ "/api/person/*": { name: "Denis Villeneuve", titles: [mk(1, { title: "Sicario" })] } });
    render(<PersonPage />);
    expect(screen.getByText("Loading...")).toBeTruthy();
    expect(await screen.findByText("Denis Villeneuve")).toBeTruthy();
    expect(requests(fetch, "/api/person/42")).toHaveLength(1);
    const card = cardOf("Sicario");
    fireEvent.click(within(card).getByText("+ Watchlist"));
    fireEvent.click(within(card).getByText("+ Mark Seen"));
    expect(stored().watched.map((t) => t.id)).toEqual([1]);
    expect(stored().watchlist).toEqual([]);
    fireEvent.click(within(card).getByText("✓ Watched"));
    fireEvent.click(within(card).getByText("+ Watchlist"));
    fireEvent.click(within(card).getByText("✓ Saved"));
    expect(stored()).toMatchObject({ watched: [], watchlist: [] });
  });
});

describe("WatchlistPage", () => {
  const list = [
    mk(1, { title: "Zodiac", rating: 7.7, genres: [80] }),
    mk(2, { title: "Andor", mediaType: "tv", rating: 8.4, genres: [18] }),
    mk(3, { title: "Memento", rating: 8.2, genres: [53] }),
  ];
  const titles = () => screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);

  it("shows an empty state with links onward", () => {
    routeFetch();
    render(<WatchlistPage />);
    expect(screen.getByText("Your watchlist is empty")).toBeTruthy();
    expect(screen.getByText("Discover Titles").getAttribute("href")).toBe("/discover");
  });

  it("filters by type and search, and sorts", () => {
    routeFetch();
    seed({ watchlist: list });
    render(<WatchlistPage />);
    expect(screen.getByText(/movies, 1 series/).textContent).toContain("2 movies, 1 series");
    expect(titles()).toEqual(["Andor", "Memento", "Zodiac"]);
    fireEvent.change(screen.getByLabelText("Sort:"), { target: { value: "rating" } });
    expect(titles()).toEqual(["Andor", "Memento", "Zodiac"]);
    fireEvent.change(screen.getByLabelText("Sort:"), { target: { value: "genre" } });
    expect(titles()).toHaveLength(3);
    fireEvent.click(screen.getByText("Series (1)"));
    expect(titles()).toEqual(["Andor"]);
    fireEvent.click(screen.getByText("Movies (2)"));
    fireEvent.change(screen.getByPlaceholderText("Search watchlist..."), { target: { value: "zod" } });
    expect(titles()).toEqual(["Zodiac"]);
    fireEvent.change(screen.getByPlaceholderText("Search watchlist..."), { target: { value: "nothing" } });
    expect(screen.getByText("No watchlist titles match your search or filter.")).toBeTruthy();
    fireEvent.click(screen.getByText("All (3)"));
  });

  it("marks a title watched, removes one, and clears the list after confirming", () => {
    routeFetch();
    seed({ watchlist: list, watched: [mk(3, { title: "Memento" })] });
    render(<WatchlistPage />);
    fireEvent.click(screen.getByTitle("Mark Zodiac as watched"));
    expect(stored().watched.map((t) => t.id).sort()).toEqual([1, 3]);
    fireEvent.click(screen.getByTitle("Mark Memento as watched")); // already watched: not added twice
    expect(stored().watched).toHaveLength(2);
    fireEvent.click(screen.getByTitle("Remove Andor from watchlist"));
    expect(stored().watchlist).toEqual([]);

    seed({ watchlist: list });
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<WatchlistPage />);
    fireEvent.click(screen.getAllByText("Clear entire watchlist").at(-1)!);
    expect(stored().watchlist).toHaveLength(3);
    fireEvent.click(screen.getAllByText("Clear entire watchlist").at(-1)!);
    expect(stored().watchlist).toEqual([]);
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("picks up the server copy on mount", async () => {
    routeFetch({
      "/api/sync": (_u, init) =>
        init?.method === "POST"
          ? { etag: '"e"' }
          : { docs: { library: { etag: '"l1"', data: { watched: [], watchlist: [mk(7, { title: "Heat" })], dismissed: [] } }, history: null } },
    });
    render(<WatchlistPage />);
    expect(await screen.findByText("Heat")).toBeTruthy();
  });
});
