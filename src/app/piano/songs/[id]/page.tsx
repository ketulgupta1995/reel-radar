"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { loadImportedSong, pullSongDoc } from "@/lib/pianoData";
import { exerciseById } from "@/lib/pianoExercises";
import { songById } from "@/lib/pianoSongLibrary";
import { Song } from "@/lib/pianoSongs";
import { SongPlayer } from "../SongPlayer";

export default function SongPage() {
  const { id } = useParams<{ id: string }>();
  const builtIn = songById(id) ?? exerciseById(id);
  // An imported song comes from this device's storage, read after the first render (so it matches the prerender),
  // and from the server when another device imported it and this one hasn't pulled it yet.
  const [imported, setImported] = useState<Song | undefined>();
  const [looked, setLooked] = useState(false);
  useEffect(() => {
    if (builtIn) return;
    let live = true;
    const done = () => {
      if (!live) return;
      setImported(loadImportedSong(id));
      setLooked(true);
    };
    if (loadImportedSong(id)) return done();
    void pullSongDoc(id).then(done, done);
    return () => {
      live = false;
    };
  }, [id, builtIn]);
  const song = builtIn ?? imported;
  if (!song) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 px-4 py-10 sm:px-6">
        <p>{looked ? "That song isn't in the list." : "Loading…"}</p>
        <Link href="/piano/songs" className="text-gold">
          ← Songs
        </Link>
      </div>
    );
  }
  return <SongPlayer key={song.id} song={song} />;
}
