# Reel Radar 🎬

A modern, cinematic web application built with **Next.js 14 (App Router)**, **TypeScript**, and **Tailwind CSS**. Reel Radar provides personalized movie and TV series discovery powered by live TMDB metadata, intelligent taste analysis, and hybrid local/cloud state persistence—without requiring accounts or authentication.

---

## 🚀 Key Features

1. **Dual Cinema & Series Support (Indian & Global)**:
   - Filter seamlessly between **All Regions**, **Indian Cinema & Series** (Bollywood, South Indian, OTT web series), and **Hollywood & Global**.
   - Special heuristic handling for Indian regional languages (`hi`, `te`, `ta`, `ml`, `kn`, `bn`, etc.) and origin countries.

2. **Interactive Discovery Feed (`/discover`)**:
   - Continuous paginated discovery feed.
   - Per-title quick action buttons on every card matching the recommendations experience:
     - **Mark seen / ✓ Seen**: Toggles title in your watched list.
     - **+ Watchlist / ✓ Watchlist**: Adds or removes title from your personal watchlist.
     - **Not interested**: Instantly dismisses title so it won't clutter your feed or recommendations again.
     - **Trailer & Details**: Opens an embedded YouTube trailer modal, complete synopsis, director/creator links, and cast.

3. **Season-Level TV Progress Tracking**:
   - Track series at granular season levels (e.g., S1, S2, S3).
   - Higher season completions give weighted boosts to your taste engine.

4. **Recommendation Engine (`/recommendations`)**:
   - Unlocked once you have logged at least 10 titles.
   - Categorized buckets:
     - **Indian Movies**
     - **Global & Hollywood Movies**
     - **Indian Web Series & Shows**
     - **Global & International Series**
   - Deterministic ranking incorporating normalized genre overlap, keywords, cast/creator credits, type balance, rating quality, and diversity passes.
   - Transparent, human-readable **Why recommended** explanation badges on each title.

5. **Viewing & Taste Analytics (`/analysis`)**:
   - Deep-dive into your cinematic DNA:
     - Key metrics: total titles, total estimated runtime hours, average TMDB rating, Indian cinema ratio.
     - Media format split (Movies vs. TV series).
     - Top genres distribution bar charts.
     - Decade & era breakdown (from classic 1970s–1990s to contemporary releases).
     - Top directors, creators, and actors by frequency in your library.
     - Highest-rated titles milestone showcase.
     - Dynamic filtering across Movies, Series, Indian, or Global titles.

6. **Global Search & Creator Profiles**:
   - Multi-search across TMDB for any film, series, actor, or director (`/search`).
   - Creator/actor profile pages (`/person/[id]`) showing filmography and credits with instant watch/watchlist controls.

7. **Multi-Tier Hybrid Storage & Portability**:
   - **Local Browser Storage**: Instant responsive reads and offline resilience via `localStorage`.
   - **Cloud Sync**: Automatic background persistence to **Vercel Blob Storage** (when configured) or local `data/storage.json`.
   - **Export & Import**: Download a `.json` backup of your viewing history and watchlist at any time, or restore/merge across devices.

---

## 🛠️ Technology Stack & Architecture

- **Framework**: [Next.js 14](https://nextjs.org/) (App Router, Server & Client Components)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) with a curated dark luxury palette (`#07070c` ink background, `#11111a` panels, and `#f6c453` warm gold accents)
- **API & Data**: [The Movie Database (TMDB) API v3](https://developer.themoviedb.org/docs)
- **Cloud Storage**: Optional [@vercel/blob](https://vercel.com/docs/storage/vercel-blob) with automatic fallback to local JSON file
- **Testing**: [Vitest](https://vitest.dev/)

---

## 📁 Project Structure

```
reel-radar-final/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root HTML wrapper and metadata
│   │   ├── globals.css             # Tailwind base & custom animations
│   │   ├── page.tsx                # Polished Home / Landing page with live spotlight
│   │   ├── discover/page.tsx       # Discovery feed with Seen/Watchlist/Dismiss actions
│   │   ├── recommendations/page.tsx# Categorized recommendation engine
│   │   ├── analysis/page.tsx       # Viewing history and taste analytics
│   │   ├── watchlist/page.tsx      # User's saved watchlist with sorting and filters
│   │   ├── watched/page.tsx        # User's viewed titles history with season breakdown
│   │   ├── search/page.tsx         # Multi-search across movies & TV
│   │   ├── person/[id]/page.tsx    # Filmography & creator credits page
│   │   └── api/
│   │       ├── discover/route.ts   # TMDB discover proxy with Indian & Global region feeds
│   │       ├── recommendations/    # Deterministic scoring & categorization endpoint
│   │       ├── search/route.ts     # Multi-search endpoint
│   │       ├── title/route.ts      # Enriched title details & YouTube trailer lookup
│   │       ├── person/[id]/        # Cast/crew credits endpoint
│   │       └── storage/route.ts    # Dual-backend storage handler (Vercel Blob / local file)
│   ├── components/
│   │   ├── TitleCard.tsx           # Reusable poster card with badges & trailer button
│   │   ├── TitleDetailsModal.tsx   # Video trailer player, synopsis, cast & crew modal
│   │   └── StorageControls.tsx     # Backup Export & Import controls
│   ├── lib/
│   │   ├── tmdb.ts                 # TMDB API client & normalization
│   │   ├── recommend.ts            # Scoring algorithm, ranking & explanations
│   │   ├── analysis.ts             # Analytics math & breakdown aggregator
│   │   └── storage.ts              # LocalStorage, sync, merge & export/import utilities
│   └── types/
│       └── title.ts                # TypeScript interfaces (Title, CastMember, MediaType)
├── data/
│   └── storage.json                # Local JSON fallback for server storage sync
├── vitest.config.ts                # Unit testing configuration
├── tailwind.config.ts              # Theme tokens & custom colors
└── package.json
```

---

## ⚙️ Getting Started Locally

### 1. Prerequisites
- **Node.js 18.17+** or newer installed.
- A free TMDB v3 API Key from [The Movie Database](https://www.themoviedb.org/settings/api).

### 2. Setup Environment Variables
Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```
Add your TMDB API key:
```ini
TMDB_API_KEY=your_tmdb_api_key_here

# (Optional) For cloud sync on Vercel:
# BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
```

### 3. Install and Run
```bash
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🧪 Testing & Verification

Run unit tests:
```bash
npm test
```

Create production build:
```bash
npm run build
```

---

## 💡 How the Taste Engine Works

1. **Viewing Profile**: As you mark movies and series as seen, their genres, keywords, cast, and directors are aggregated into a weighted preference profile.
2. **Season Amplification**: TV series with completed seasons receive exponential weighting over casual views.
3. **Multi-Factor Scoring**:
   $$\text{Score} = (4.2 \cdot \text{Genre} + 2.2 \cdot \text{Keywords} + 1.8 \cdot \text{Cast/Crew} + 0.9 \cdot \text{Rating} + 0.3 \cdot \text{Popularity} + 0.5 \cdot \text{FormatFit}) \times \text{RegionMultiplier} \times \text{FreshnessPenalty}$$
4. **Categorization Pass**: Candidates are partitioned into dedicated categories (*Indian Movies*, *Global Movies*, *Indian TV*, *Global TV*) with a genre-diversity threshold ensuring varied recommendations.

---

## 🧹 Resetting State (Developer Utility)

To reset your local cache and server backup directly from the browser developer console:
```javascript
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

---

*Notice: This product uses the TMDB API but is not endorsed or certified by TMDB.*