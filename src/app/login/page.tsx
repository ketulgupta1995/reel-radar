"use client";

import { FormEvent, useState } from "react";

// Where to go after signing in: ?next= only if it stays on this site. It's resolved the way the
// browser will resolve it, so tricks like "/\\evil.com" or "/%09/evil.com" (both read as
// "//evil.com") land on the home page instead.
const SAME_SITE = "http://same-site.invalid";
function nextPath(next: string | null): string {
  if (!next?.startsWith("/")) return "/";
  try {
    const url = new URL(next, SAME_SITE);
    return url.origin === SAME_SITE ? url.pathname + url.search + url.hash : "/";
  } catch {
    return "/";
  }
}

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    }).catch(() => null);

    if (res?.ok) {
      window.location.href = nextPath(new URLSearchParams(window.location.search).get("next"));
      return;
    }
    setError(res ? (await res.json().catch(() => ({}))).error || "Login failed" : "Network error");
    setBusy(false);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,#261e38_0%,#090910_55%,#050508_100%)] px-6 text-white">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-white/10 bg-panel p-8">
        <div className="mb-2 text-center">
          <span className="text-lg font-bold tracking-[.22em] text-gold">MY APPS</span>
          <p className="mt-1 text-sm text-white/50">Private app — please sign in</p>
        </div>
        <input
          className="w-full rounded-lg border border-white/10 bg-ink px-4 py-2.5 outline-none focus:border-gold/60"
          placeholder="Username"
          autoComplete="username"
          autoFocus
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          className="w-full rounded-lg border border-white/10 bg-ink px-4 py-2.5 outline-none focus:border-gold/60"
          type="password"
          placeholder="Password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          disabled={busy || !username || !password}
          className="w-full rounded-lg bg-gold py-2.5 font-semibold text-ink transition hover:bg-amber-300 disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
