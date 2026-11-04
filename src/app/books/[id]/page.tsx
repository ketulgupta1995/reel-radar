"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AppSwitcher } from "@/components/AppSwitcher";
import { openBook } from "@/lib/books";
import type { ParsedBook } from "@/lib/epub";

export default function BookPage() {
  const { id } = useParams<{ id: string }>();
  const [book, setBook] = useState<ParsedBook | null>(null);
  const [state, setState] = useState<"loading" | "missing" | "ready">("loading");
  const [chapter, setChapter] = useState(0);

  useEffect(() => {
    openBook(id).then(
      (b) => {
        setBook(b);
        setState(b ? "ready" : "missing");
      },
      () => setState("missing")
    );
  }, [id]);

  const current = book?.chapters[chapter];

  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,#261e38_0%,#090910_55%,#050508_100%)] text-white">
      <header className="sticky top-0 z-40 border-b border-white/5 bg-black/20 backdrop-blur-md">
        <nav className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
          <AppSwitcher current="books" />
        </nav>
      </header>

      <div className="mx-auto max-w-3xl space-y-5 px-4 py-8 sm:px-6">
        <Link href="/books" className="text-sm text-white/60 hover:text-gold">
          ← Library
        </Link>
        {state === "loading" && <p className="text-sm text-white/60">Opening…</p>}
        {state === "missing" && (
          <p className="text-sm text-white/80">This book isn&apos;t on this device. Go back to the library and upload the file again.</p>
        )}
        {book && current && (
          <>
            <div>
              <h1 className="text-2xl font-bold">{book.title}</h1>
              <p className="text-sm text-white/60">{book.author}</p>
            </div>
            <label htmlFor="chapter" className="block text-xs font-semibold uppercase tracking-wider text-white/45">
              Chapter
            </label>
            <select
              id="chapter"
              value={chapter}
              onChange={(e) => setChapter(Number(e.target.value))}
              className="w-full rounded-xl border border-white/10 bg-panel px-3 py-2 text-sm text-white outline-none focus:border-gold/50"
            >
              {book.chapters.map((c, i) => (
                <option key={i} value={i}>
                  {c.title}
                </option>
              ))}
            </select>
            <p className="font-serif text-lg leading-relaxed text-white/90" aria-label="Chapter text">
              {current.sentences.map((s, i) => (
                <span key={i}>{s} </span>
              ))}
            </p>
          </>
        )}
      </div>
    </main>
  );
}
