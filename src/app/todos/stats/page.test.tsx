// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { routeFetch, requests } from "@/test/pages";
import { Todo, getTodayDate, saveTodos, shiftDate } from "@/lib/todos";

vi.mock("next/navigation", () => ({ usePathname: () => "/todos/stats" }));

import PlannerStatsPage from "./page";

const todo = (id: string, extra: Partial<Todo> = {}): Todo => ({
  id,
  text: id,
  completed: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...extra,
});

describe("PlannerStatsPage", () => {
  it("says when there's nothing to show", () => {
    routeFetch();
    render(<PlannerStatsPage />);
    expect(screen.getByText(/No tasks in this period yet/)).toBeTruthy();
  });

  it("summarises the days in range and switches ranges", async () => {
    const fetch = routeFetch();
    const today = getTodayDate();
    saveTodos(
      [
        todo("Ship", { completed: true, start: 540, duration: 90, tag: "work", spent: 45 }),
        todo("Gym", { start: 1080, duration: 60, tag: "health" }),
        todo("Errand"),
      ],
      today
    );
    saveTodos([todo("Old", { completed: true, carriedFrom: shiftDate(today, -61) })], shiftDate(today, -60));
    render(<PlannerStatsPage />);
    expect(screen.getByText("1 of 3 tasks done")).toBeTruthy(); // the last 30 days
    expect(screen.getByText("1 of 3 tasks done").previousElementSibling!.textContent).toBe("33%");
    expect(screen.getAllByText("Work").length).toBeGreaterThan(0);
    // It pulls every synced month, so other devices' days count too.
    expect(decodeURIComponent(requests(fetch, "/api/sync")[0].url.search)).toContain("planner-daily");

    fireEvent.click(screen.getByText("All time"));
    expect(screen.getByText("2 of 4 tasks done")).toBeTruthy();
    expect(screen.getByText("Old")).toBeTruthy(); // postponed once
    fireEvent.click(screen.getByText("7 days"));
    expect(screen.getByText("1 of 3 tasks done")).toBeTruthy();
    fireEvent.click(screen.getByText("90 days"));
    expect(screen.getByText("2 of 4 tasks done")).toBeTruthy();
  });

  it("takes in days that arrive from the server", async () => {
    const today = getTodayDate();
    routeFetch({
      "/api/sync": (_u, init) =>
        init?.method === "POST"
          ? { etag: '"e"' }
          : {
              docs: {
                [`planner-${today.slice(0, 7)}`]: {
                  etag: '"m"',
                  data: { items: [{ date: today, pos: 0, todo: todo("Remote", { completed: true }), updatedAt: 1 }] },
                },
              },
            },
    });
    render(<PlannerStatsPage />);
    expect(await screen.findByText("1 of 1 tasks done")).toBeTruthy();
  });
});
