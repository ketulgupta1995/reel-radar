import { describe, expect, it } from "vitest";
import { keyOf } from "./title";

describe("keyOf", () => {
  it("combines media type and id so movie and tv ids don't collide", () => {
    expect(keyOf({ id: 550, mediaType: "movie" })).toBe("movie:550");
    expect(keyOf({ id: 550, mediaType: "tv" })).toBe("tv:550");
  });
});
