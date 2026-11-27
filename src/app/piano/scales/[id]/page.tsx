"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { scaleSongById } from "@/lib/pianoScales";
import { SongPlayer } from "../../songs/SongPlayer";

export default function ScalePage() {
  const { id } = useParams<{ id: string }>();
  const song = scaleSongById(id);
  if (!song) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 px-4 py-10 sm:px-6">
        <p>That scale isn&apos;t in the list.</p>
        <Link href="/piano/scales" className="text-gold">
          ← Scales
        </Link>
      </div>
    );
  }
  return <SongPlayer key={song.id} song={song} scale back={{ href: "/piano/scales", label: "Scales" }} />;
}
