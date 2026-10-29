import Link from "next/link";
import { APPS } from "@/lib/apps";

export default function Home() {
  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,#261e38_0%,#090910_55%,#050508_100%)] px-4 py-12 text-white sm:px-6 sm:py-20">
      <div className="mx-auto max-w-4xl">
        <p className="text-xs font-bold uppercase tracking-[.25em] text-gold">My apps</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-5xl">What are we doing today?</h1>

        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          {APPS.map((app) => (
            <Link
              key={app.id}
              href={app.href}
              className="group rounded-2xl border border-white/10 bg-panel/60 p-6 backdrop-blur transition hover:-translate-y-1 hover:border-gold/40"
            >
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-gold/20 bg-gold/10 text-2xl">
                {app.icon}
              </div>
              <h2 className="text-xl font-bold text-white transition group-hover:text-gold">{app.name}</h2>
              <p className="mt-2 text-sm leading-relaxed text-white/65">{app.description}</p>
              <span className="mt-5 inline-block text-sm font-semibold text-gold">Open →</span>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
