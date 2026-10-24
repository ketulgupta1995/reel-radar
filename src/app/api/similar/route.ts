import { getSimilar } from "@/lib/tmdb";
import { MediaType } from "@/types/title";

export async function GET(request: Request) {
  try {
    const p = new URL(request.url).searchParams;
    const type = p.get("type") as MediaType;
    const id = Number(p.get("id"));
    if (!id || !["movie", "tv"].includes(type)) {
      return Response.json({ error: "Invalid title" }, { status: 400 });
    }
    const results = await getSimilar(type, id);
    return Response.json({ results });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Unable to find similar titles" },
      { status: 500 }
    );
  }
}
