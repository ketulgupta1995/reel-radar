"use client";

import { usePathname } from "next/navigation";

export function LogoutButton() {
  if (usePathname() === "/login") return null;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <button
      onClick={logout}
      className="fixed bottom-4 right-4 z-50 rounded-full border border-white/10 bg-panel/90 px-3 py-1.5 text-xs text-white/60 backdrop-blur transition hover:text-gold"
    >
      Log out
    </button>
  );
}
