import { Archivo, JetBrains_Mono } from "next/font/google";

// The new planner, built beside /todos on the same data until it replaces it (.scratch/planner-revamp/spec.md).
// next/font serves both faces from this site, so no request goes to Google at runtime.
const display = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-bf-display", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-bf-mono", display: "swap" });

export const metadata = { title: "Daily Planner" };

export default function PlannerNextLayout({ children }: { children: React.ReactNode }) {
  return <div className={`bf ${display.variable} ${mono.variable} min-h-screen bg-bf-bg font-bfd text-bf-ink`}>{children}</div>;
}
