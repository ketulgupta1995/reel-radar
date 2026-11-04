"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { AppSwitcher } from "@/components/AppSwitcher";
import { BookEntry, addBook, addUpload, errorText, loadLibrary } from "@/lib/books";
import { downloadFound, searchCatalogue, sourceName } from "@/lib/catalogue";
import type { Found } from "@/lib/sources";

export default function BooksPage() {
  const [books, setBooks] = useState<BookEntry[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const [results, setResults] = useState<Found[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState("");
  const [problems, setProblems] = useState<string[]>([]);

  // Read after mount, so the first render matches the prerendered page.
  useEffect(() => setBooks(loadLibrary()), []);

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setMessage("");
    try {
      const { entry, existing } = await addUpload(file);
      setBooks(loadLibrary());
      setMessage(existing ? `“${entry.title}” is already in your library.` : `Added “${entry.title}”.`);
    } catch (err) {
      setMessage(errorText(err));
    }
    setBusy(false);
  }

  async function search(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setMessage("");
    setSearched(q);
    setProblems([]);
    try {
      const found = await searchCatalogue(q);
      setResults(found.results);
      setProblems(found.problems);
    } catch (err) {
      setResults(null);
      setMessage(errorText(err));
    }
    setSearching(false);
  }

  async function add(found: Found) {
    setAdding(found.sourceId);
    setMessage("");
    try {
      const { entry, existing } = await addBook(await downloadFound(found), found.source, found.sourceId);
      setBooks(loadLibrary());
      setMessage(existing ? `“${entry.title}” is already in your library.` : `Added “${entry.title}”.`);
    } catch (err) {
      setMessage(errorText(err));
    }
    setAdding("");
  }

  const owned = new Set(books.map((b) => b.sourceId));

  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,#261e38_0%,#090910_55%,#050508_100%)] text-white">
      <header className="sticky top-0 z-40 border-b border-white/5 bg-black/20 backdrop-blur-md">
        <nav className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
          <AppSwitcher current="books" />
        </nav>
      </header>

      <div className="mx-auto max-w-3xl space-y-5 px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">Books</h1>
          <label
            htmlFor="upload-epub"
            className="cursor-pointer rounded-full bg-gold px-4 py-2 text-sm font-semibold text-ink transition hover:bg-amber-300"
          >
            {busy ? "Adding…" : "Upload an EPUB"}
          </label>
          <input
            id="upload-epub"
            type="file"
            accept=".epub,application/epub+zip"
            disabled={busy}
            className="sr-only"
            onChange={(e) => {
              void upload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
        <form onSubmit={search} className="flex gap-2" role="search">
          <label htmlFor="book-search" className="sr-only">
            Search for a book
          </label>
          <input
            id="book-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Title or author"
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[.06] px-3 py-2 text-sm text-white outline-none placeholder:text-white/35 focus:border-gold/50"
          />
          <button
            disabled={searching || !query.trim()}
            className="rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold transition hover:border-gold/40 disabled:opacity-50"
          >
            {searching ? "Searching…" : "Search"}
          </button>
        </form>
        {message && (
          <p role="status" className="text-sm text-white/80">
            {message}
          </p>
        )}
        {results && (
          <section aria-label="Search results" className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-white/45">Results for “{searched}”</h2>
            {problems.map((p) => (
              <p key={p} role="status" className="text-sm text-white/65">
                {p} Showing the other source only.
              </p>
            ))}
            {results.length === 0 && <p className="text-sm text-white/65">No books found. Try another title or author.</p>}
            {results.map((r) => (
              <div key={r.sourceId} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[.04] px-4 py-3">
                <div className="min-w-0">
                  <span className="block font-semibold">{r.title}</span>
                  <span className="block text-sm text-white/60">{r.author} · {sourceName(r)}</span>
                </div>
                {owned.has(r.sourceId) ? (
                  <span className="shrink-0 text-sm text-white/50">In your library</span>
                ) : (
                  <button
                    onClick={() => add(r)}
                    disabled={!!adding}
                    aria-label={`Add ${r.title}`}
                    className="shrink-0 rounded-full bg-gold px-4 py-1.5 text-sm font-semibold text-ink transition hover:bg-amber-300 disabled:opacity-50"
                  >
                    {adding === r.sourceId ? "Adding…" : "Add"}
                  </button>
                )}
              </div>
            ))}
          </section>
        )}

        {books.length === 0 ? (
          <section className="rounded-3xl border border-white/10 bg-white/[.04] p-6 shadow-xl shadow-black/20 backdrop-blur-xl">
            <h2 className="text-xl font-bold">Your library is empty</h2>
            <p className="mt-2 text-sm text-white/65">Add a book in one of two ways:</p>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-white/80">
              <li>Search for a free book by title or author.</li>
              <li>Upload an EPUB file you already own, without copy protection.</li>
            </ul>
          </section>
        ) : (
          <ul className="space-y-2" aria-label="Your library">
            {books.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/books/${b.id}`}
                  className="block rounded-2xl border border-white/10 bg-white/[.04] px-4 py-3 transition hover:border-gold/40"
                >
                  <span className="block font-semibold">{b.title}</span>
                  <span className="block text-sm text-white/60">{b.author}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
