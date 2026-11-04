// The apps listed on the home page (/) and in the AppSwitcher menu.
// To add an app: add an entry here, then put <AppSwitcher current="<id>" /> in its page headers.
export type AppId = "reel-radar" | "planner" | "money" | "books";

export type AppInfo = {
  id: AppId;
  name: string;
  href: string;
  icon: string;
  description: string;
};

export const APPS: AppInfo[] = [
  {
    id: "reel-radar",
    name: "Reel Radar",
    href: "/reel-radar",
    icon: "🎬",
    description: "Track movies and series, build a watchlist, and get recommendations and analytics from your own taste.",
  },
  {
    id: "planner",
    name: "Daily Planner",
    href: "/todos",
    icon: "🗓️",
    description: "Plan your day in time blocks, keep repeating tasks and streaks, keep lists of things to remember, and see weekly stats.",
  },
  {
    id: "money",
    name: "Money",
    href: "/money",
    icon: "💰",
    description: "Log spending, set monthly limits, import Google Pay statements, and keep track of what you owe family.",
  },
  {
    id: "books",
    name: "Books",
    href: "/books",
    icon: "📚",
    description: "Find free books or upload your own EPUBs, then listen with your phone reading them aloud.",
  },
];

export function getApp(id: AppId): AppInfo {
  return APPS.find((a) => a.id === id)!;
}
