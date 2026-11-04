"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppSwitcher } from "@/components/AppSwitcher";
import { BookEntry, addUpload, errorText, loadLibrary } from "@/lib/books";

export default function BooksPage() {
  const [books, setBooks] = useState<BookEntry[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

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
        {message && (
          <p role="status" className="text-sm text-white/80">
            {message}
          </p>
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
