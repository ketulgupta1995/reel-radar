import { personCredits } from "@/lib/tmdb";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const id = Number(params.id);
    if (!id) return Response.json({ error: "Invalid person ID" }, { status: 400 });
    return Response.json(await personCredits(id));
  } catch (e) {
    return Response.json({ error: "Failed to fetch person data" }, { status: 500 });
  }
}