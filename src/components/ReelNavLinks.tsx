"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Counts = { watchlist: number; watched: number; dismissed: number };

// The shared Reel Radar page links, so every page's header shows the same set in the same order.
// The link for the current page is highlighted.
export function ReelNavLinks({ counts }: { counts: Counts }) {
  const pathname = usePathname();
  const links = [
    { href: "/discover", label: "Discover" },
    { href: "/search", label: "Search" },
    { href: "/watchlist", label: `Watchlist (${counts.watchlist})` },
    { href: "/watched", label: `Viewed (${counts.watched})` },
    { href: "/recommendations", label: "Recommendations" },
    { href: "/analysis", label: "Analysis" },
    { href: "/dismissed", label: `Not interested (${counts.dismissed})` },
  ];
  return (
    <>
      {links.map((l) =>
        pathname === l.href ? (
          <span
            key={l.href}
            aria-current="page"
            className="rounded-full border border-gold/30 bg-gold/15 px-3 py-1 font-semibold text-gold"
          >
            {l.label}
          </span>
        ) : (
          <Link key={l.href} href={l.href} className="text-white/70 transition hover:text-white">
            {l.label}
          </Link>
        )
      )}
    </>
  );
}
