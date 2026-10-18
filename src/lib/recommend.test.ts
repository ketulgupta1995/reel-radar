import { describe, expect, it } from "vitest";
import { rank } from "./recommend";
import { Title } from "@/types/title";

const t = (id: number, genres: number[], type: "movie" | "tv" = "movie"): Title => ({
  id,
  mediaType: type,
  title: String(id),
  year: 2000,
  posterPath: null,
  overview: "A test title synopsis",
  genres,
  rating: 7,
  popularity: 5,
});

describe("rank", () => {
  it("excludes watched titles and favors shared genres", () => {
    const watched = [t(1, [878])];
    const out = rank(watched, [t(1, [878]), t(2, [878]), t(3, [35])]);
    expect(out.map((x) => x.id)).not.toContain(1);
    expect(out[0].id).toBe(2);
  });
});