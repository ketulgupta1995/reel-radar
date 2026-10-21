export type MediaType = "movie" | "tv";

export type PersonInfo = {
  id: number;
  name: string;
};

export type Title = {
  id: number;
  mediaType: MediaType;
  title: string;
  year: number | null;
  posterPath: string | null;
  overview: string;
  genres: number[];
  genreNames?: string[];
  rating: number;
  popularity: number;
  cast?: PersonInfo[];
  creators?: PersonInfo[];
  keywords?: string[];
  numberOfSeasons?: number;
  watchedSeasons?: number[];
  originalLanguage?: string;
  originCountry?: string[];
  trailerYoutubeId?: string; // Appended property for instant trailer
};

export const keyOf = (t: Pick<Title, "id" | "mediaType">) => `${t.mediaType}:${t.id}`;