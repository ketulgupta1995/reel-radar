import { describe, expect, it } from "vitest";
import { merge3, mergeHistory, mergeLibrary, toStored } from "./syncDocs";
import { mk } from "@/test/fixtures";

type Item = { id: string; v: number };
const it3 = (id: string, v = 0): Item => ({ id, v });
const merge = (local: Item[], server: Item[], base?: Item[]) =>
  merge3(local, server, base, (x) => x.id, (l, s) => (s.v > l.v ? s : l));

describe("merge3", () => {
  it("without a base, keeps everything from both sides", () => {
    expect(merge([it3("a"), it3("b")], [it3("b"), it3("c")])).toEqual([it3("a"), it3("b"), it3("c")]);
  });

  it("drops an item deleted on either side since the base", () => {
    const base = [it3("a"), it3("b"), it3("c")];
    expect(merge([it3("a"), it3("c")], base, base)).toEqual([it3("a"), it3("c")]); // deleted here
    expect(merge(base, [it3("a"), it3("b")], base)).toEqual([it3("a"), it3("b")]); // deleted there
  });

  it("takes whichever side changed an item, and asks `both` when both did", () => {
    const base = [it3("a", 1), it3("b", 1), it3("c", 1)];
    expect(merge([it3("a", 2), it3("b", 1), it3("c", 3)], [it3("a", 1), it3("b", 5), it3("c", 4)], base)).toEqual([
      it3("a", 2),
      it3("b", 5),
      it3("c", 4),
    ]);
  });

  it("keeps an item edited on one side and deleted on the other", () => {
    expect(merge([it3("a", 2)], [], [it3("a", 1)])).toEqual([it3("a", 2)]);
  });

  it("adds new items from both sides, local order first", () => {
    const base = [it3("a")];
    expect(merge([it3("a"), it3("l")], [it3("s"), it3("a")], base).map((x) => x.id)).toEqual(["a", "l", "s"]);
  });
});

describe("library and history", () => {
  it("merges watched seasons when both sides changed a title", () => {
    const base = { watched: [mk(1, { mediaType: "tv", watchedSeasons: [1] })], watchlist: [], dismissed: [] };
    const merged = mergeLibrary(
      { ...base, watched: [mk(1, { mediaType: "tv", watchedSeasons: [1, 2] })] },
      { ...base, watched: [mk(1, { mediaType: "tv", watchedSeasons: [1, 3], rating: 9 })] },
      base
    );
    expect(merged.watched[0]).toMatchObject({ watchedSeasons: [1, 2, 3], rating: 9 });
  });

  it("clears history everywhere once one side cleared it", () => {
    const base = { displayed: ["movie:1", "movie:2"], shown: ["tv:1"] };
    expect(mergeHistory({ displayed: [], shown: [] }, { displayed: [...base.displayed, "movie:3"], shown: base.shown }, base)).toEqual({
      displayed: ["movie:3"],
      shown: [],
    });
  });

  it("toStored drops only keywords, the trailer and why", () => {
    const cast = [{ id: 1, name: "A" }];
    const creators = [{ id: 2, name: "B" }];
    expect(toStored(mk(1, { cast, creators, keywords: ["k"], trailerYoutubeId: "t", why: "w" }))).toEqual(
      mk(1, { cast, creators })
    );
  });
});
