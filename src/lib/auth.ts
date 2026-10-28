// Single-user session auth. Uses Web Crypto so it runs in both middleware (edge) and route handlers.
export const SESSION_COOKIE = "rr_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const enc = new TextEncoder();

async function hmac(value: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(value));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Hash both sides first so comparison time doesn't leak length/content.
export async function credentialsMatch(input: string, expected: string, secret: string) {
  return safeEqual(await hmac(input, secret), await hmac(expected, secret));
}

export async function createSession(secret: string) {
  const expires = String(Date.now() + SESSION_MAX_AGE * 1000);
  return `${expires}.${await hmac(expires, secret)}`;
}

export async function verifySession(token: string | undefined, secret: string | undefined) {
  if (!token || !secret) return false;
  const [expires, sig] = token.split(".");
  if (!expires || !sig || Number(expires) < Date.now()) return false;
  return safeEqual(sig, await hmac(expires, secret));
}
