"use client";
import { useState } from "react";
import { Title } from "@/types/title";
import { poster } from "@/lib/tmdb";
import { isIndianTitle } from "@/lib/region";
import { TitleDetailsModal } from "./TitleDetailsModal";

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
  const [showDetails, setShowDetails] = useState(false);
  const isIndian = isIndianTitle(title);

  return (
    <>
      <article
        onClick={onToggle ? (e) => {
          // Trigger toggle UNLESS they clicked a button/link inside
          if ((e.target as HTMLElement).closest('button, a')) return;
          onToggle();
        } : undefined}
        className={`flex flex-col h-full overflow-hidden rounded-xl border bg-panel transition ${onToggle ? "cursor-pointer" : ""} ${
          selected
            ? "border-gold ring-1 ring-gold"
            : "border-white/10 hover:-translate-y-1 hover:border-white/20"
        }`}
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
          {onToggle && (
            <span
              className={`absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full text-sm font-bold shadow-md ${
                selected ? "bg-gold text-black" : "bg-black/70 text-white"
              }`}
            >
              {selected ? "✓" : "+"}
            </span>
          )}
          {isIndian && (
            <span className="absolute left-2 top-2 rounded bg-black/80 px-2 py-0.5 text-[10px] font-bold tracking-wider text-gold shadow border border-gold/30">
              IN
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
            {title.mediaType === "tv" ? "Series" : "Movie"} • {title.rating.toFixed(1)}
          </p>
          <p className="mt-0.5 text-xs text-white/50 line-clamp-1">
            {title.genreNames?.slice(0, 2).join(" • ") || "Genres unavailable"}
          </p>

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

          <div className="mt-auto pt-3 flex flex-col gap-1.5">
             <button 
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowDetails(true); }}
                className="w-full rounded-lg bg-white/10 py-1.5 text-[11px] font-medium text-white/80 hover:bg-white/20 transition"
              >
                Trailer & Details
             </button>
          </div>
        </div>
      </article>

      {showDetails && <TitleDetailsModal title={title} onClose={() => setShowDetails(false)} />}
    </>
  );
}