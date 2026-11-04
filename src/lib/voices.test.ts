import { describe, expect, it } from "vitest";
import { MAX_VOICES, englishVoices, langTag, voiceLabel } from "./voices";

const v = (name: string, lang: string, localService = true, voiceURI = name) => ({ name, lang, voiceURI, localService });

describe("englishVoices", () => {
  it("keeps English voices only, local ones first, then your region, India, the US and the UK", () => {
    const list = englishVoices(
      [
        v("Deutsch", "de_DE"),
        v("English UK", "en_GB"),
        v("Google US English", "en-US", false),
        v("English US", "en_US"),
        v("English India", "en_IN"),
        v("English Australia", "en_AU"),
        v("English", "en"),
      ],
      "en-AU"
    );
    expect(list.map((x) => x.name)).toEqual(["English Australia", "English India", "English US", "English UK", "English", "Google US English"]);
  });

  it("cuts a long list short but always keeps the voice you chose, and drops duplicates", () => {
    const many = Array.from({ length: 40 }, (_, i) => v(`English Region ${String(i).padStart(2, "0")}`, `en_X${i}`));
    expect(englishVoices(many)).toHaveLength(MAX_VOICES);
    const last = many[39];
    const withChosen = englishVoices(many, "en-US", last.voiceURI);
    expect(withChosen).toHaveLength(MAX_VOICES + 1);
    expect(withChosen[0]).toBe(last);
    expect(englishVoices([v("A", "en_US"), v("A", "en_US")])).toHaveLength(1);
    expect(englishVoices([v("A", "en_US")], "en-US", "A")).toHaveLength(1);
  });

  it("labels online voices and normalises language tags", () => {
    expect(voiceLabel(v("Google UK English", "en-GB", false))).toBe("Google UK English (online)");
    expect(voiceLabel(v("English India", "en_IN"))).toBe("English India");
    expect(langTag("en_IN")).toBe("en-IN");
    expect(englishVoices([v("Plain", "en")], "xx")).toHaveLength(1);
  });
});
