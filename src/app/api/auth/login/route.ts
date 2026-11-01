import { NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_MAX_AGE, createSession, credentialsMatch } from "@/lib/auth";
import { LoginAttempt, beginLoginAttempt, flushUsage, forgetLoginAttempt } from "@/lib/docStore";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function POST(req: Request) {
  const { APP_USERNAME, APP_PASSWORD, AUTH_SECRET } = process.env;
  if (!APP_USERNAME || !APP_PASSWORD || !AUTH_SECRET) {
    return NextResponse.json({ error: "Login is not configured. Set APP_USERNAME, APP_PASSWORD and AUTH_SECRET." }, { status: 500 });
  }

  try {
    // Without a record of the attempt there is no guess limit, so refuse rather than skip it.
    let attempt: LoginAttempt;
    try {
      attempt = await beginLoginAttempt();
    } catch (err) {
      console.error("[Login] Couldn't record the attempt", err);
      return NextResponse.json({ error: "Login is unavailable right now. Try again shortly." }, { status: 503 });
    }
    if (!attempt.allowed) {
      const minutes = Math.ceil(attempt.retryAfter / 60);
      return NextResponse.json(
        { error: `Too many failed logins. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` },
        { status: 429, headers: { "Retry-After": String(attempt.retryAfter) } }
      );
    }

    const { username = "", password = "" } = await req.json().catch(() => ({}));
    const ok =
      (await credentialsMatch(String(username), APP_USERNAME, AUTH_SECRET)) &&
      (await credentialsMatch(String(password), APP_PASSWORD, AUTH_SECRET));

    if (!ok) {
      await new Promise((r) => setTimeout(r, 800)); // slow down brute-force attempts
      return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
    }

    // A success doesn't count toward the limit. If removing it fails, it just expires in an hour.
    await forgetLoginAttempt(attempt.id).catch((err) => console.error("[Login] Couldn't clear the attempt", err));
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, await createSession(AUTH_SECRET), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
    return res;
  } finally {
    await flushUsage(true);
  }
}
