# Reel Radar

A cinematic Next.js application that discovers movies and TV series using live TMDB metadata. It stores viewing history in the browser—there are no accounts or database.

## Run locally

1. Install Node.js 18.17+.
2. Copy `.env.example` to `.env.local` and add a **TMDB v3 API key** from [TMDB API settings](https://www.themoviedb.org/settings/api).
3. Run `npm install`, then `npm run dev`.
4. Open `http://localhost:3000`.

Use `npm run build` for a production verification and `npm test` for the recommendation unit test. Deploy to Vercel or any Node-compatible host, setting `TMDB_API_KEY` as a server-side environment variable.

## How it works

Discovery fetches paginated movie and TV results from TMDB released from 1990 onward. Every displayed `mediaType:id` is persisted and omitted from later batches. When a user filters by genre, that filter is applied to the live TMDB query; unfiltered batches retain broad exploration across movies and series.

At 10 watched titles, the server enriches selections with TMDB credits and keywords, then calculates a deterministic score: normalized genre overlap (highest weight), keyword overlap, cast/creator overlap, type balance, rating, and a genre-cap diversity pass. Watched `mediaType:id` pairs are always excluded. Explanations only cite actual shared genre metadata or a conservative fallback.

## Limitations and TMDB

- A valid TMDB key and internet connection are required. Missing keys, rate limits, and API failures are presented with a retry message.
- Metadata can be incomplete; the app degrades to available genre/rating/overview data.
- This prototype uses localStorage, so progress is browser/device-specific and can be cleared by the user.
- TMDB results, images, and data are supplied by TMDB; this product uses the required notice: **This product uses the TMDB API but is not endorsed or certified by TMDB.** Review TMDB’s terms before public deployment.


# code to reset the shown and displayed

```
(() => {
  const key = "reel-radar-v1";
  const state = JSON.parse(localStorage.getItem(key) || "{}");
  state.shown = [];
  state.displayed = [];
  localStorage.setItem(key, JSON.stringify(state));

  fetch("/api/storage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state),
  })
    .then((res) => res.json())
    .then(() => {
      console.log("Shown and displayed lists cleared successfully.");
      location.reload();
    })
    .catch((err) => console.error("Failed to sync reset to server:", err));
})();
```