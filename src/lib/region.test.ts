import { describe, expect, it } from "vitest";
import { isIndianTitle, isSouthIndianTitle } from "./region";

describe("region", () => {
  it("treats Indian origin country or an Indian language as Indian", () => {
    expect(isIndianTitle({ originCountry: ["IN"] })).toBe(true);
    expect(isIndianTitle({ originalLanguage: "ML" })).toBe(true);
    expect(isIndianTitle({ originCountry: ["US"], originalLanguage: "en" })).toBe(false);
    expect(isIndianTitle({})).toBe(false);
  });

  it("detects South Indian languages only", () => {
    expect(isSouthIndianTitle({ originalLanguage: "ta" })).toBe(true);
    expect(isSouthIndianTitle({ originalLanguage: "hi" })).toBe(false);
  });
});
