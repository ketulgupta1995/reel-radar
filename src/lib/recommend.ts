import { Title, keyOf } from "@/types/title";

export const INDIAN_LANGS = new Set(["hi", "te", "ta", "ml", "kn", "bn", "mr", "pa", "gu"]);

export const isIndianTitle = (t: Title): boolean => {
  if (t.originCountry?.includes("IN")) return true;
  if (t.originalLanguage && INDIAN_LANGS.has(t.originalLanguage.toLowerCase())) return true;
  return false;
};

const frequencies = (
  items: Title[],
  pick: (t: Title) => (string | number)[],
  weights?: (t: Title) => number
) => {
  const m = new Map<string | number, number>();
  items.forEach((t) => {
    const w = weights ? weights(t) : 1;
    const values = pick(t);
    values.forEach((v) => {
      m.set(v, (m.get(v) || 0) + w / Math.max(values.length, 1));
    });
  });
  return m;
};

export function rank(
  watched: Title[],
  candidates: Title[],
  seen: string[] = [],
  dismissed: string[] = [],
  watchlist: (Title | string)[] = []
): Title[] {
  if (!candidates.length) return [];

  const itemWeight = (t: Title) => {
    if (t.mediaType === "tv" && t.watchedSeasons && t.watchedSeasons.length > 0) {
      return 1 + Math.min(t.watchedSeasons.length * 0.25, 1.25);
    }
    return 1;
  };

  const gs = frequencies(watched, (t) => t.genres, itemWeight);
  const people = frequencies(
    watched,
    (t) => [...(t.cast || []), ...(t.creators || [])].map((p) => p.id), // Fetch IDs
    itemWeight
  );
  const words = frequencies(watched, (t) => t.keywords || [], itemWeight);

  const indianWatchedCount = watched.filter(isIndianTitle).length;
  const indianAffinity = indianWatchedCount / Math.max(watched.length, 1);
  const typeShare = watched.filter((x) => x.mediaType === "tv").length / Math.max(watched.length, 1);

  const watchedKeys = new Set(watched.map(keyOf));
  const dismissedKeys = new Set(dismissed);
  const seenKeys = new Set(seen);
  const watchlistKeys = new Set(watchlist.map((w) => (typeof w === "string" ? w : keyOf(w))));

  const uniqueCandidates = new Map<string, Title>();
  candidates.forEach((c) => {
    const k = keyOf(c);
    if (!watchedKeys.has(k) && !dismissedKeys.has(k) && !watchlistKeys.has(k) && !uniqueCandidates.has(k)) {
      uniqueCandidates.set(k, c);
    }
  });

  const scored: (Title & { _score: number })[] = Array.from(uniqueCandidates.values()).map((c) => {
    const isIndian = isIndianTitle(c);
    const genreScore = overlap(c.genres, gs);
    const castScore = overlap([...(c.cast || []), ...(c.creators || [])].map(p => p.id), people);
    const keywordScore = overlap(c.keywords || [], words);
    const typeFit = 1 - Math.abs((c.mediaType === "tv" ? 1 : 0) - typeShare);
    const quality = Math.min(Math.max((c.rating - 5) / 5, 0), 1);
    const popularityBonus = Math.min(Math.log10(Math.max(c.popularity, 1)) / 4, 0.4);

    let regionScore = 0.5;
    if (indianAffinity >= 0.2) {
      regionScore = isIndian ? 1.5 : 0.8;
    } else if (isIndian && c.rating >= 7.5) {
      regionScore = 0.9;
    }

    const seenPenalty = seenKeys.has(keyOf(c)) ? 0.45 : 1.0;
    const rawScore =
      (4.2 * genreScore + 2.2 * keywordScore + 1.8 * castScore + 0.9 * quality + 0.3 * popularityBonus + 0.5 * typeFit) *
      regionScore *
      seenPenalty;

    return { ...c, _score: rawScore };
  });

  function overlap(vs: (string | number)[], m: Map<string | number, number>) {
    if (!vs.length || !m.size) return 0;
    return vs.reduce((s: number, v) => s + (m.get(v) || 0), 0) / Math.max(vs.length, 1);
  }

  scored.sort((a, b) => b._score - a._score);

  const picked: (Title & { _score: number })[] = [];
  const genreCounts = new Map<number, number>();

  for (const x of scored) {
    if (picked.length >= 20) break;
    const overSaturated = x.genres.some((g) => (genreCounts.get(g) || 0) >= 5);
    if (overSaturated && scored.length - picked.length > 20) continue;
    picked.push(x);
    x.genres.forEach((g) => genreCounts.set(g, (genreCounts.get(g) || 0) + 1));
  }

  return picked.map(({ _score, ...x }) => x);
}

export function explanation(candidate: Title, watched: Title[]): string {
  const isCandidateIndian = isIndianTitle(candidate);
  const matchedWatched = watched.find((w) => candidate.genres.some((g) => w.genres.includes(g)));

  const sharedPeople = [...(candidate.cast || []), ...(candidate.creators || [])].filter((p) =>
    watched.some((w) => [...(w.cast || []), ...(w.creators || [])].map(x => x.id).includes(p.id))
  );

  if (sharedPeople.length > 0) {
    return `Features ${sharedPeople[0].name}, matching people in your watched titles.`;
  }

  if (isCandidateIndian) {
    const indianWatched = watched.find(isIndianTitle);
    if (indianWatched) {
      return `Recommended Indian ${candidate.mediaType === "tv" ? "series" : "film"} pairing with your history of titles like "${indianWatched.title}".`;
    }
    return `Critically acclaimed Indian ${candidate.mediaType === "tv" ? "series" : "movie"} (${candidate.rating.toFixed(1)}) matching your genre preferences.`;
  }

  const shared = candidate.genres.filter((g) => watched.some((w) => w.genres.includes(g)));
  const names = candidate.genreNames?.filter((_, i) => shared.includes(candidate.genres[i])) || [];

  if (names.length && matchedWatched) {
    return `Matches the ${names.slice(0, 2).join(" & ")} style from your viewing of "${matchedWatched.title}".`;
  }

  if (candidate.rating >= 7.8) {
    return `A top-rated ${candidate.mediaType === "tv" ? "series" : "movie"} (${candidate.rating.toFixed(1)}) curated to expand your taste profile.`;
  }

  return "A high-affinity recommendation aligned with your viewing patterns.";
}