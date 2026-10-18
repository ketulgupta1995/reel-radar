"use client";

import { Title } from "@/types/title";
import { poster } from "@/lib/tmdb";
import { isIndianTitle } from "@/lib/recommend";

export function TitleCard({
  title,
  selected,
  onToggle,
  why,
}: {
  title: Title;
  selected?: boolean;
  onToggle?: () => void;
  why?: string;
}) {
  const isIndian = isIndianTitle(title);

  return (
    <article
      className={`flex flex-col overflow-hidden rounded-xl border bg-panel transition ${
        selected
          ? "border-gold ring-1 ring-gold"
          : "border-white/10 hover:-translate-y-1 hover:border-white/20"
      }`}
    >
      <button
        onClick={onToggle}
        disabled={!onToggle}
        aria-pressed={selected}
        className="flex h-full w-full flex-col text-left disabled:cursor-default"
      >
        {/* Poster */}
        <div className="poster relative aspect-[2/3] w-full shrink-0">
          {title.posterPath ? (
            <img
              src={poster(title.posterPath)!}
              alt={title.title}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <span className="absolute inset-0 grid place-items-center text-sm text-white/50">
              No poster
            </span>
          )}

          {/* Toggle Button */}
          {onToggle && (
            <span
              className={`absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full text-sm font-bold shadow-md ${
                selected ? "bg-gold text-black" : "bg-black/70 text-white"
              }`}
            >
              {selected ? "✓" : "+"}
            </span>
          )}

          {/* Indian Origin Badge */}
          {isIndian && (
            <span className="absolute left-2 top-2 rounded bg-black/80 px-2 py-0.5 text-[10px] font-bold tracking-wider text-gold shadow border border-gold/30">
              🇮🇳 IN
            </span>
          )}
        </div>

        {/* Content Details */}
        <div className="flex flex-1 flex-col p-3.5">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold leading-tight line-clamp-1" title={title.title}>
              {title.title}
            </h3>
            <span className="shrink-0 text-xs text-white/60">{title.year || " "}</span>
          </div>

          <p className="mt-1 text-xs text-gold">
            {title.mediaType === "tv" ? "Series" : "Movie"} · ★ {title.rating.toFixed(1)}
          </p>

          <p className="mt-0.5 text-xs text-white/50 line-clamp-1">
            {title.genreNames?.slice(0, 2).join(" · ") || "Genres unavailable"}
          </p>

          {/* Movie / Series Synopsis Description */}
          {title.overview && (
            <p
              className="mt-2.5 text-xs leading-relaxed text-white/70 line-clamp-3"
              title={title.overview}
            >
              {title.overview}
            </p>
          )}

          {/* Recommendation Explanation */}
          {why && (
            <div className="mt-auto pt-3">
              <div className="rounded-lg border border-gold/25 bg-gold/10 p-2.5">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-gold">
                  Why recommended
                </span>
                <p className="mt-0.5 text-xs leading-snug text-white/80">{why}</p>
              </div>
            </div>
          )}
        </div>
      </button>
    </article>
  );
}