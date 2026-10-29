import { describe, expect, it } from "vitest";
import { bucketDate, usageByDay } from "./usageStats";

// Buckets are UTC; days are local. Use a bucket in the middle of the day so any zone agrees.
const noon = (date: string) => `${date}T12:00`;

describe("usageByDay", () => {
  it("totals reads and writes per day and fills days with none", () => {
    const days = usageByDay(
      [
        { t: noon("2026-10-28"), reads: 3, writes: 1 },
        { t: noon("2026-10-28").replace("12:00", "12:30"), reads: 2, writes: 0 },
        { t: noon("2026-10-30"), reads: 4, writes: 2 },
        { t: noon("2026-10-20"), reads: 9, writes: 9 }, // before the range
      ],
      "2026-10-28",
      "2026-10-30"
    );
    expect(days).toEqual([
      { date: "2026-10-28", reads: 5, writes: 1 },
      { date: "2026-10-29", reads: 0, writes: 0 },
      { date: "2026-10-30", reads: 4, writes: 2 },
    ]);
  });

  it("names the local day a bucket falls on", () => {
    expect(bucketDate(noon("2026-10-30"))).toBe("2026-10-30");
  });
});
