export type MediaType = "movie" | "tv";
export type Title = { id:number; mediaType:MediaType; title:string; year:number|null; posterPath:string|null; overview:string; genres:number[]; genreNames?:string[]; rating:number; popularity:number; cast?:string[]; creators?:string[]; keywords?:string[]; numberOfSeasons?:number; watchedSeasons?:number[] };
export const keyOf=(t:Pick<Title,"id"|"mediaType">)=>`${t.mediaType}:${t.id}`;
