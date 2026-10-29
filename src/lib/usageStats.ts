export type UsageBucket = { t: string; reads: number; writes: number }; // t: UTC half hour, "2026-10-30T09:30"
export type UsageDay = { date: string; reads: number; writes: number };

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// The local date a bucket falls on.
export const bucketDate = (t: string) => localDate(new Date(t + ":00Z"));

// Database reads and writes per local day for the days from `from` to `to` (YYYY-MM-DD, inclusive),
// including days with none. Half-hour buckets keep the split exact in zones like IST.
export function usageByDay(buckets: UsageBucket[], from: string, to: string): UsageDay[] {
  const days = new Map<string, UsageDay>();
  for (let d = new Date(from + "T00:00:00"); localDate(d) <= to; d.setDate(d.getDate() + 1)) {
    days.set(localDate(d), { date: localDate(d), reads: 0, writes: 0 });
  }
  for (const b of buckets) {
    const day = days.get(bucketDate(b.t));
    if (day) {
      day.reads += b.reads;
      day.writes += b.writes;
    }
  }
  return Array.from(days.values());
}
