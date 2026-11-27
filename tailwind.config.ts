import type { Config } from "tailwindcss";
// bf-*: the new planner's Bold focus palette (/planner-next), set as CSS variables in globals.css so it follows the device's light or dark setting.
const bf = (name: string) => `rgb(var(--bf-${name}) / <alpha-value>)`;
export default {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#07070c",
        panel: "#11111a",
        gold: "#f6c453",
        // pn-*: the Piano app (inside of a piano: claret case felt, ivory and ebony keys, brass, the crimson key-rail felt).
        pn: { velvet: "#2a0d14", felt: "#3a1520", line: "#5c2b37", ivory: "#f3ead8", ebony: "#140c0f", brass: "#d4a64a", crimson: "#9a2133" },
        bf: { bg: bf("bg"), s1: bf("s1"), s2: bf("s2"), ink: bf("ink"), muted: bf("muted"), line: bf("line"), late: bf("late"), water: bf("water"), "water-ink": bf("water-ink"), ontag: "#0b0b0d" },
      },
      fontFamily: { bfd: ["var(--font-bf-display)", "system-ui", "sans-serif"], bfm: ["var(--font-bf-mono)", "ui-monospace", "monospace"], pnd: ["var(--font-pn-display)", "Didot", "Georgia", "serif"], pns: ["var(--font-pn-sans)", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
} satisfies Config;
