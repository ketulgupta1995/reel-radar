import { AppSwitcher } from "@/components/AppSwitcher";

export default function BooksPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,#261e38_0%,#090910_55%,#050508_100%)] text-white">
      <header className="sticky top-0 z-40 border-b border-white/5 bg-black/20 backdrop-blur-md">
        <nav className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
          <AppSwitcher current="books" />
        </nav>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <section className="rounded-3xl border border-white/10 bg-white/[.04] p-6 shadow-xl shadow-black/20 backdrop-blur-xl">
          <h1 className="text-2xl font-bold">Your library is empty</h1>
          <p className="mt-2 text-sm text-white/65">Add a book in one of two ways:</p>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-white/80">
            <li>Search for a free book by title or author.</li>
            <li>Upload an EPUB file you already own, without copy protection.</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
