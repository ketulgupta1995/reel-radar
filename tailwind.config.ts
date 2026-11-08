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
        bf: { bg: bf("bg"), s1: bf("s1"), s2: bf("s2"), ink: bf("ink"), muted: bf("muted"), line: bf("line"), late: bf("late"), water: bf("water"), "water-ink": bf("water-ink"), ontag: "#0b0b0d" },
      },
      fontFamily: { bfd: ["var(--font-bf-display)", "system-ui", "sans-serif"], bfm: ["var(--font-bf-mono)", "ui-monospace", "monospace"] },
    },
  },
  plugins: [],
} satisfies Config;
