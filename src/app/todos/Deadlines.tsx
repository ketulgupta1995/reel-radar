// Deadline wording shared by the planner's screens.

import { DAY_NAMES, formatShortDate } from "./planner";

const dayNumber = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};

export const daysUntil = (date: string, today: string) => dayNumber(date) - dayNumber(today);

// "Due tomorrow", "Due Fri", "Due Nov 8", "2 days late".
export function dueLabel(due: string, today: string): string {
  const left = daysUntil(due, today);
  if (left < 0) return `${-left} ${left === -1 ? "day" : "days"} late`;
  if (left === 0) return "Due today";
  if (left === 1) return "Due tomorrow";
  if (left < 7) return `Due ${DAY_NAMES[new Date(due + "T00:00:00").getDay()]}`;
  return `Due ${formatShortDate(due)}`;
}
