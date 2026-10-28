import { NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_MAX_AGE, createSession, credentialsMatch } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { APP_USERNAME, APP_PASSWORD, AUTH_SECRET } = process.env;
  if (!APP_USERNAME || !APP_PASSWORD || !AUTH_SECRET) {
    return NextResponse.json({ error: "Login is not configured. Set APP_USERNAME, APP_PASSWORD and AUTH_SECRET." }, { status: 500 });
  }

  const { username = "", password = "" } = await req.json().catch(() => ({}));
  const ok =
    (await credentialsMatch(String(username), APP_USERNAME, AUTH_SECRET)) &&
    (await credentialsMatch(String(password), APP_PASSWORD, AUTH_SECRET));

  if (!ok) {
    await new Promise((r) => setTimeout(r, 800)); // slow down brute-force attempts
    return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSession(AUTH_SECRET), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
