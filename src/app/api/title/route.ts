import { detail } from "@/lib/tmdb";
import { MediaType } from "@/types/title";
import { DAY, cachedJson } from "@/lib/http";

export const maxDuration = 10;

export async function GET(request:Request){try{const p=new URL(request.url).searchParams;const type=p.get("type") as MediaType,id=Number(p.get("id"));if(!id||!["movie","tv"].includes(type))return Response.json({error:"Invalid title"},{status:400});return cachedJson(await detail(type,id),DAY)}catch(e){return Response.json({error:e instanceof Error?e.message:"Unable to load title"},{status:500})}}
