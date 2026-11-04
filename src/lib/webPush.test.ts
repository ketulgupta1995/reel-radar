import { afterEach, describe, expect, it, vi } from "vitest";
import { createECDH, createPublicKey, randomBytes, verify } from "crypto";
import { encryptPayload, sendPush, vapidConfig, vapidHeader } from "./webPush";

const b64 = (s: string) => Buffer.from(s, "base64url");

function newVapid() {
  const c = createECDH("prime256v1");
  c.generateKeys();
  return { publicKey: c.getPublicKey("base64url"), privateKey: c.getPrivateKey("base64url"), subject: "mailto:me@example.com" };
}

afterEach(() => vi.unstubAllGlobals());

describe("encryptPayload", () => {
  it("matches the worked example in RFC 8291 appendix A", () => {
    const out = encryptPayload(
      "When I grow up, I want to be a watermelon",
      { p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", auth: "BTBZMqHH6r4Tts7J_aSIgg" },
      b64("DGv6ra1nlYgDCS1FRnbzlw"),
      b64("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw")
    );
    expect(out.toString("base64url")).toBe(
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
    );
  });

  it("uses a fresh key and salt each time", () => {
    const c = createECDH("prime256v1");
    c.generateKeys();
    const target = { p256dh: c.getPublicKey("base64url"), auth: "BTBZMqHH6r4Tts7J_aSIgg" };
    expect(encryptPayload("x", target).equals(encryptPayload("x", target))).toBe(false);
  });
});

describe("vapidHeader", () => {
  it("signs a token for the endpoint's origin that the public key verifies", () => {
    const vapid = newVapid();
    const header = vapidHeader("https://fcm.googleapis.com/fcm/send/abc", vapid, 1_000_000_000);
    const [, token, key] = /^vapid t=(.+), k=(.+)$/.exec(header)!;
    expect(key).toBe(vapid.publicKey);
    const [head, claims, signature] = token.split(".");
    expect(JSON.parse(b64(claims).toString())).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: 1_000_000 + 12 * 60 * 60,
      sub: vapid.subject,
    });
    const pub = b64(vapid.publicKey);
    const publicKey = createPublicKey({
      format: "jwk",
      key: { kty: "EC", crv: "P-256", x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33).toString("base64url") },
    });
    expect(verify("sha256", Buffer.from(`${head}.${claims}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, b64(signature))).toBe(true);
  });

  it("restores a private key's leading zero byte, which ECDH can drop", () => {
    const c = createECDH("prime256v1");
    const short = randomBytes(31);
    c.setPrivateKey(Buffer.concat([Buffer.alloc(1), short]));
    const pub = c.getPublicKey();
    const vapid = { publicKey: pub.toString("base64url"), privateKey: short.toString("base64url"), subject: "mailto:me@example.com" };
    const [, token] = /^vapid t=(.+), k=/.exec(vapidHeader("https://fcm.googleapis.com/x", vapid))!;
    const [head, claims, signature] = token.split(".");
    const publicKey = createPublicKey({
      format: "jwk",
      key: { kty: "EC", crv: "P-256", x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33).toString("base64url") },
    });
    expect(verify("sha256", Buffer.from(`${head}.${claims}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, b64(signature))).toBe(true);
  });
});

describe("vapidConfig", () => {
  it("needs all three settings and well-sized keys", () => {
    const v = newVapid();
    vi.stubEnv("VAPID_PUBLIC_KEY", v.publicKey);
    vi.stubEnv("VAPID_PRIVATE_KEY", v.privateKey);
    vi.stubEnv("VAPID_SUBJECT", "");
    expect(vapidConfig()).toBeNull();
    vi.stubEnv("VAPID_SUBJECT", v.subject);
    expect(vapidConfig()).toEqual(v);
    vi.stubEnv("VAPID_PUBLIC_KEY", "AAAA");
    expect(vapidConfig()).toBeNull();
    vi.stubEnv("VAPID_PUBLIC_KEY", v.publicKey);
    vi.stubEnv("VAPID_PRIVATE_KEY", Buffer.alloc(40).toString("base64url"));
    expect(vapidConfig()).toBeNull();
  });
});

describe("sendPush", () => {
  it("posts an encrypted body, refuses redirects and returns the status", async () => {
    const browser = createECDH("prime256v1");
    browser.generateKeys();
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const status = await sendPush(
      { endpoint: "https://fcm.googleapis.com/x", p256dh: browser.getPublicKey("base64url"), auth: "BTBZMqHH6r4Tts7J_aSIgg" },
      { title: "Secret task" },
      newVapid(),
      900
    );
    expect(status).toBe(201);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://fcm.googleapis.com/x");
    expect(init.redirect).toBe("error");
    expect(init.headers).toMatchObject({ "Content-Encoding": "aes128gcm", TTL: "900", Urgency: "high" });
    expect(Buffer.from(init.body as Uint8Array).toString()).not.toContain("Secret task");
  });
});
