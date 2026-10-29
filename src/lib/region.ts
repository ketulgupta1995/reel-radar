import { Title } from "@/types/title";

// Single source of truth for the Indian vs Global split. Edit the language lists here only.
export const INDIAN_LANGS = new Set(["hi", "te", "ta", "ml", "kn", "bn", "mr", "pa", "gu"]);
export const SOUTH_INDIAN_LANGS = new Set(["te", "ta", "ml", "kn"]);

const lang = (t: Pick<Title, "originalLanguage">) => t.originalLanguage?.toLowerCase();

export const isIndianTitle = (t: Pick<Title, "originCountry" | "originalLanguage">): boolean => {
  if (t.originCountry?.includes("IN")) return true;
  const l = lang(t);
  return !!l && INDIAN_LANGS.has(l);
};

export const isSouthIndianTitle = (t: Pick<Title, "originalLanguage">): boolean => {
  const l = lang(t);
  return !!l && SOUTH_INDIAN_LANGS.has(l);
};
