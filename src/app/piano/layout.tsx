import { ReactNode } from "react";
import { Bodoni_Moda, Instrument_Sans } from "next/font/google";
import { PianoProvider } from "./PianoProvider";

// The Piano look: the inside of a piano (pn-* colours in tailwind.config.ts). Bodoni, the type of printed scores,
// carries the letter names and titles; Instrument Sans the rest. next/font serves both from this site.
const display = Bodoni_Moda({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-pn-display", display: "swap" });
const sans = Instrument_Sans({ subsets: ["latin"], variable: "--font-pn-sans", display: "swap" });

export default function PianoLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${display.variable} ${sans.variable} font-pns`}>
      <PianoProvider>{children}</PianoProvider>
    </div>
  );
}
