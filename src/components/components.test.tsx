// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { jsonResponse, mk } from "@/test/fixtures";

const pathname = vi.hoisted(() => ({ value: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.value }));
vi.mock("@/lib/storage", () => ({ exportData: vi.fn(), importData: vi.fn(), clearDiscoveryHistory: vi.fn(), reset: vi.fn() }));

import { TitleCard } from "./TitleCard";
import { TitleDetailsModal } from "./TitleDetailsModal";
import { StorageControls } from "./StorageControls";
import { LogoutButton } from "./LogoutButton";
import { AppSwitcher } from "./AppSwitcher";
import { APPS } from "@/lib/apps";
import * as storage from "@/lib/storage";

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => jsonResponse({}));
  vi.stubGlobal("fetch", fetchMock);
});

// jsdom can't navigate; swap in a plain object so redirects can be asserted.
function stubLocation(search = "") {
  const loc = { href: "", search };
  Object.defineProperty(window, "location", { value: loc, configurable: true, writable: true });
  return loc;
}

describe("TitleCard", () => {
  it("shows title info, poster and region badge", () => {
    render(<TitleCard title={mk(1, { title: "Lagaan", year: 2001, rating: 8.1, originalLanguage: "hi", genreNames: ["Drama", "Sport", "Musical"] })} />);
    expect(screen.getByText("Lagaan")).toBeTruthy();
    expect(screen.getByText("2001")).toBeTruthy();
    expect(screen.getByText("Movie • 8.1")).toBeTruthy();
    expect(screen.getByText("Drama • Sport")).toBeTruthy();
    expect(screen.getByText("IN")).toBeTruthy();
    expect(screen.getByRole("img").getAttribute("src")).toBe("https://image.tmdb.org/t/p/w500/p1.jpg");
  });

  it("handles missing poster and genres, and marks series", () => {
    render(<TitleCard title={mk(1, { mediaType: "tv", posterPath: null, genreNames: [] })} />);
    expect(screen.getByText("No poster")).toBeTruthy();
    expect(screen.getByText("Genres unavailable")).toBeTruthy();
    expect(screen.getByText(/^Series •/)).toBeTruthy();
    expect(screen.queryByText("IN")).toBeNull();
  });

  it("shows the recommendation reason", () => {
    render(<TitleCard title={mk(1)} why="Because you liked Heat" />);
    expect(screen.getByText("Why recommended")).toBeTruthy();
    expect(screen.getByText("Because you liked Heat")).toBeTruthy();
  });

  it("toggles on card click but not on the details button", () => {
    const onToggle = vi.fn();
    const { rerender } = render(<TitleCard title={mk(1)} onToggle={onToggle} />);
    expect(screen.getByText("+")).toBeTruthy();
    fireEvent.click(screen.getByText("Title 1"));
    expect(onToggle).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Trailer & Details"));
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<TitleCard title={mk(1)} onToggle={onToggle} selected />);
    expect(screen.getByText("✓")).toBeTruthy();
  });

  it("opens the details modal", async () => {
    render(<TitleCard title={mk(1, { title: "Heat" })} />);
    fireEvent.click(screen.getByText("Trailer & Details"));
    expect(fetchMock).toHaveBeenCalledWith("/api/title?type=movie&id=1");
    expect(await screen.findByText("Synopsis")).toBeTruthy();
  });
});

describe("TitleDetailsModal", () => {
  it("shows the trailer, synopsis, cast and directors", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        mk(1, {
          trailerYoutubeId: "yt123",
          overview: "Full synopsis",
          cast: [{ id: 10, name: "Al Pacino" }],
          creators: [{ id: 20, name: "Michael Mann" }],
        })
      )
    );
    render(<TitleDetailsModal title={mk(1, { title: "Heat" })} onClose={vi.fn()} />);
    expect(screen.getByText(/Loading extra details/)).toBeTruthy();
    const iframe = (await screen.findByTitle("Heat Trailer")) as HTMLIFrameElement;
    expect(iframe.src).toBe("https://www.youtube.com/embed/yt123?autoplay=1");
    expect(screen.getByText("Full synopsis")).toBeTruthy();
    expect(screen.getByText("Al Pacino").closest("a")?.getAttribute("href")).toBe("/person/10");
    expect(screen.getByText("Directors")).toBeTruthy();
    expect(screen.getByText("Michael Mann").closest("a")?.getAttribute("href")).toBe("/person/20");
    expect(screen.getByText(/Find Similar Titles/).closest("a")?.getAttribute("href")).toBe("/similar?type=movie&id=1");
  });

  it("labels series creators and handles a missing trailer", async () => {
    fetchMock.mockResolvedValue(jsonResponse(mk(2, { mediaType: "tv", creators: [{ id: 1, name: "Creator" }] })));
    render(<TitleDetailsModal title={mk(2, { mediaType: "tv" })} onClose={vi.fn()} />);
    expect(await screen.findByText("No official trailer available")).toBeTruthy();
    expect(screen.getByText("Creators")).toBeTruthy();
  });

  it("falls back to the card's synopsis when loading fails", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    render(<TitleDetailsModal title={mk(3, { overview: "Card synopsis" })} onClose={vi.fn()} />);
    expect(await screen.findByText("Card synopsis")).toBeTruthy();
  });

  it("closes from the backdrop and × button, but not from inside the panel", async () => {
    const onClose = vi.fn();
    const { container } = render(<TitleDetailsModal title={mk(1, { title: "Heat" })} onClose={onClose} />);
    await screen.findByText("Synopsis");
    fireEvent.click(screen.getByText("Heat"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("×"));
    fireEvent.click(container.firstChild as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("StorageControls", () => {
  it("exports a backup", () => {
    render(<StorageControls />);
    fireEvent.click(screen.getByText("Export"));
    expect(storage.exportData).toHaveBeenCalled();
  });

  it("imports a chosen file and reports the merged state", () => {
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    const merged = { watched: [], watchlist: [], shown: [], displayed: [], dismissed: [] };
    vi.mocked(storage.importData).mockImplementation((_file, onSuccess) => onSuccess(merged));
    const onStateChange = vi.fn();
    const { container } = render(<StorageControls onStateChange={onStateChange} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const click = vi.spyOn(input, "click");
    fireEvent.click(screen.getByText("Import"));
    expect(click).toHaveBeenCalled();

    const file = new File(["{}"], "backup.json");
    fireEvent.change(input, { target: { files: [file] } });
    expect(vi.mocked(storage.importData).mock.calls[0][0]).toBe(file);
    expect(onStateChange).toHaveBeenCalledWith(merged);
    expect(alert).toHaveBeenCalledWith(expect.stringContaining("imported successfully"));
  });

  it("alerts on an import error", () => {
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    vi.mocked(storage.importData).mockImplementation((_file, _ok, onError) => onError?.("Invalid JSON backup file."));
    const { container } = render(<StorageControls />);
    fireEvent.change(container.querySelector("input")!, { target: { files: [new File(["x"], "b.json")] } });
    expect(alert).toHaveBeenCalledWith("Invalid JSON backup file.");
  });
});

describe("LogoutButton", () => {
  it("is hidden on the login page", () => {
    pathname.value = "/login";
    const { container } = render(<LogoutButton />);
    expect(container.innerHTML).toBe("");
  });

  it("logs out and returns to the login page", async () => {
    pathname.value = "/discover";
    const loc = stubLocation();
    render(<LogoutButton />);
    fireEvent.click(screen.getByText("Log out"));
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/logout", { method: "POST" });
    await waitFor(() => expect(loc.href).toBe("/login"));
  });
});

describe("AppSwitcher", () => {
  const hrefOf = (name: string) => screen.getByRole("link", { name }).getAttribute("href");

  it("links home and to the current app, with the menu closed", () => {
    render(<AppSwitcher current="planner" />);
    expect(hrefOf("Home")).toBe("/");
    expect(hrefOf("Daily Planner")).toBe("/todos");
    expect(screen.queryByText("Reel Radar")).toBeNull();
  });

  it("lists only the other apps when opened, and closes on Escape", () => {
    render(<AppSwitcher current="reel-radar" />);
    fireEvent.click(screen.getByLabelText("Switch app"));
    expect(hrefOf("🗓️ Daily Planner")).toBe("/todos");
    expect(screen.getAllByText("Reel Radar")).toHaveLength(1);
    expect(hrefOf("All apps →")).toBe("/");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("Switch to")).toBeNull();
  });
});

describe("APPS", () => {
  it("has unique ids and hrefs", () => {
    expect(new Set(APPS.map((a) => a.id)).size).toBe(APPS.length);
    expect(new Set(APPS.map((a) => a.href)).size).toBe(APPS.length);
  });
});
