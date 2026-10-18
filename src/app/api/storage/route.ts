import { promises as fs } from "fs";
import path from "path";

const dataDir = path.join(process.cwd(), "data");
const filePath = path.join(dataDir, "storage.json");

async function ensureStorageFile() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(filePath);
  } catch {
    // File does not exist yet; create with empty structure
    const initial = {
      watched: [],
      displayed: [],
      shown: [],
      watchlist: [],
      dismissed: [],
    };
    await fs.writeFile(filePath, JSON.stringify(initial, null, 2), "utf-8");
  }
}

export async function GET() {
  try {
    await ensureStorageFile();
    const content = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(content || "{}");
    return Response.json(parsed);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to read storage" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(body, null, 2), "utf-8");
    return Response.json({ success: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to save storage" },
      { status: 500 }
    );
  }
}