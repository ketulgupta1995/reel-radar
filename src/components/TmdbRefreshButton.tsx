"use client";

import { useState } from "react";
import { MediaType } from "@/types/title";

// Gets past both TMDB caches: the server's copy is expired here, then `onRefreshed` reloads the
// page's data with `cache: "reload"`, which skips and replaces the browser's copy.
export function TmdbRefreshButton({
  person,
  title,
  onRefreshed,
}: {
  person?: number;
  title?: { type: MediaType; id: number };
  onRefreshed: () => Promise<unknown>;
}) {
  const [status, setStatus] = useState<"idle" | "busy" | "failed">("idle");

  const refresh = async () => {
    setStatus("busy");
    try {
      const res = await fetch("/api/tmdb/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ person, title }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await onRefreshed();
      setStatus("idle");
    } catch {
      setStatus("failed");
    }
  };

  return (
    <button
      onClick={refresh}
      disabled={status === "busy"}
      title="Skip the saved copy and ask TMDB for the newest data"
      className="rounded-full border border-white/20 px-3 py-1.5 text-xs text-white/80 transition hover:border-gold hover:text-gold disabled:opacity-50"
    >
      {status === "busy" ? "Getting latest…" : status === "failed" ? "Couldn't update. Try again" : "↻ Get latest from TMDB"}
    </button>
  );
}
