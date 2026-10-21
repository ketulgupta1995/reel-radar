"use client";
import { useEffect, useState } from "react";
import { Title } from "@/types/title";
import Link from "next/link";

export function TitleDetailsModal({ title, onClose }: { title: Title; onClose: () => void }) {
  const [details, setDetails] = useState<Title | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/title?type=${title.mediaType}&id=${title.id}`)
      .then((r) => r.json())
      .then((d) => {
        setDetails(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [title]);

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" 
      onClick={onClose}
    >
      <div 
        className="relative w-full max-w-3xl rounded-2xl border border-white/20 bg-neutral-900 p-6 shadow-2xl overflow-y-auto max-h-[90vh]" 
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute right-4 top-4 text-2xl text-white/50 hover:text-white">
          &times;
        </button>
        <h2 className="text-2xl font-bold mr-8">{title.title}</h2>
        <div className="mt-1 flex items-center gap-2 text-xs text-gold">
          <span>{title.mediaType === "tv" ? "Series" : "Movie"}</span>
          <span>•</span>
          <span>{title.year}</span>
          <span>•</span>
          <span>★ {title.rating.toFixed(1)}</span>
        </div>

        {loading ? (
          <p className="mt-6 text-white/50 animate-pulse">Loading extra details & trailer...</p>
        ) : (
          <div className="mt-6 flex flex-col gap-6">
            {details?.trailerYoutubeId ? (
              <div className="aspect-video w-full rounded-xl overflow-hidden bg-black border border-white/10">
                <iframe
                  className="h-full w-full"
                  src={`https://www.youtube.com/embed/${details.trailerYoutubeId}?autoplay=1`}
                  title={`${title.title} Trailer`}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : (
              <div className="flex aspect-video w-full items-center justify-center rounded-xl bg-white/5 border border-white/10 text-white/50 text-sm">
                No official trailer available
              </div>
            )}
            
            <div>
              <h3 className="text-xs font-bold text-gold uppercase tracking-wider mb-2">Synopsis</h3>
              <p className="text-sm text-white/80 leading-relaxed">{details?.overview || title.overview}</p>

              {details?.cast && details.cast.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-xs font-bold text-gold uppercase tracking-wider mb-2">Cast</h3>
                  <div className="flex flex-wrap gap-2">
                    {details.cast.map((c) => (
                      <Link key={c.id} href={`/person/${c.id}`} className="rounded-full bg-white/10 px-3 py-1 text-xs text-white hover:bg-gold hover:text-black transition">
                        {c.name}
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {details?.creators && details.creators.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-xs font-bold text-gold uppercase tracking-wider mb-2">
                    {title.mediaType === 'movie' ? 'Directors' : 'Creators'}
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {details.creators.map((c) => (
                      <Link key={c.id} href={`/person/${c.id}`} className="rounded-full bg-white/10 px-3 py-1 text-xs text-white hover:bg-gold hover:text-black transition">
                        {c.name}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}