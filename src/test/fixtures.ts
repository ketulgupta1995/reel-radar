import { Title } from "@/types/title";

// Builds a Title with sensible defaults; override only what a test cares about.
export const mk = (id: number, overrides: Partial<Title> = {}): Title => ({
  id,
  mediaType: "movie",
  title: `Title ${id}`,
  year: 2015,
  posterPath: `/p${id}.jpg`,
  overview: "A test title synopsis",
  genres: [18],
  genreNames: ["Drama"],
  rating: 7,
  popularity: 20,
  ...overrides,
});

// A fetch Response stand-in; enough for code that reads ok/status/headers/json().
export const jsonResponse = (body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
