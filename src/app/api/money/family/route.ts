import { starterFamily } from "@/lib/moneyFamily";

export const dynamic = "force-dynamic";

// GET /api/money/family
// The starter family from MONEY_MY_NAMES and MONEY_FAMILY, as { me: string[], family: [{ id, name, aliases }] }.
// Behind the login like every API route; seedFamily() in lib/money.ts adds them on first use.
export function GET() {
  return Response.json(starterFamily(), { headers: { "Cache-Control": "no-store" } });
}
