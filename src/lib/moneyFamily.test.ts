import { afterEach, describe, expect, it, vi } from "vitest";
import { parseStarterFamily } from "./moneyFamily";
import { GET } from "@/app/api/money/family/route";

afterEach(() => vi.unstubAllEnvs());

describe("parseStarterFamily", () => {
  it("splits people by ';' and names by ',', the first shown, with ids from first names", () => {
    expect(parseStarterFamily(" Asha Rao ,Asha K  Rao", "Ravi Rao, Ravi K Rao; ; Meena Rao;Ravi Iyer")).toEqual({
      me: ["Asha Rao", "Asha K Rao"],
      family: [
        { id: "ravi", name: "Ravi Rao", aliases: ["Ravi Rao", "Ravi K Rao"] },
        { id: "meena", name: "Meena Rao", aliases: ["Meena Rao"] },
        { id: "ravi2", name: "Ravi Iyer", aliases: ["Ravi Iyer"] },
      ],
    });
  });

  it("is empty when nothing is configured", () => {
    expect(parseStarterFamily()).toEqual({ me: [], family: [] });
  });
});

describe("/api/money/family", () => {
  it("serves the family from the env, uncached", async () => {
    vi.stubEnv("MONEY_MY_NAMES", "Asha Rao");
    vi.stubEnv("MONEY_FAMILY", "Ravi Rao");
    const res = GET();
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ me: ["Asha Rao"], family: [{ id: "ravi", name: "Ravi Rao", aliases: ["Ravi Rao"] }] });
  });
});
