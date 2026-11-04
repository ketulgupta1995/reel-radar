import { describe, expect, it } from "vitest";
import { splitSentences } from "./sentences";

describe("splitSentences", () => {
  it("splits on full stops, question marks and exclamation marks", () => {
    expect(splitSentences("It rained. Was it cold? Nobody looked up!")).toEqual(["It rained.", "Was it cold?", "Nobody looked up!"]);
  });

  it("keeps titles, initials and decimals inside their sentence", () => {
    expect(splitSentences("Mr. Rao met Dr. Iyer at 7.15. J. R. Smith left.")).toEqual(["Mr. Rao met Dr. Iyer at 7.15.", "J. R. Smith left."]);
  });

  it("keeps closing quotes with the sentence, and a lowercase continuation in it", () => {
    expect(splitSentences('"Then I will take the next one," she said. "Fine." He left.')).toEqual([
      '"Then I will take the next one," she said.',
      '"Fine."',
      "He left.",
    ]);
    expect(splitSentences("He said so. and then left.")).toEqual(["He said so. and then left."]);
  });

  it("keeps trailing text with no final punctuation, and returns nothing for blank text", () => {
    expect(splitSentences("Chapter One")).toEqual(["Chapter One"]);
    expect(splitSentences("  \n ")).toEqual([]);
  });
});
