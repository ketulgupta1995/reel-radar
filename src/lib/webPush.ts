import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign } from "crypto";

// Sends Web Push messages: VAPID signing (RFC 8292) and payload encryption (RFC 8291) with Node's
// crypto. The push service only ever sees ciphertext. Server only.

export type PushTarget = { endpoint: string; p256dh: string; auth: string };
export type Vapid = { publicKey: string; privateKey: string; subject: string };

const b64 = (text: string) => Buffer.from(text, "base64url");
const hkdf = (salt: Buffer, ikm: Buffer, info: Buffer | string, length: number) =>
  Buffer.from(hkdfSync("sha256", ikm, salt, info, length));

// The VAPID settings, or null unless all three are set and the keys are the right size.
export function vapidConfig(): Vapid | null {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = process.env;
  if (!publicKey || !privateKey || !subject) return null;
  const pub = b64(publicKey);
  if (pub.length !== 65 || pub[0] !== 4 || b64(privateKey).length > 32) return null;
  return { publicKey, privateKey, subject };
}

// The Authorization header proving to the push service that this server sent the message.
export function vapidHeader(endpoint: string, { publicKey, privateKey, subject }: Vapid, now = Date.now()): string {
  const pub = b64(publicKey);
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const claims = { aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 60 * 60, sub: subject };
  const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part(claims)}`;
  const raw = b64(privateKey);
  const key = createPrivateKey({
    format: "jwk",
    key: {
      kty: "EC",
      crv: "P-256",
      x: pub.subarray(1, 33).toString("base64url"),
      y: pub.subarray(33, 65).toString("base64url"),
      // A key with leading zero bytes can come out of ECDH shorter than 32 bytes.
      d: Buffer.concat([Buffer.alloc(32 - raw.length), raw]).toString("base64url"),
    },
  });
  const signature = sign("sha256", Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${unsigned}.${signature.toString("base64url")}, k=${publicKey}`;
}

// Encrypt a message for one browser. `salt` and `serverPrivate` are only passed by the RFC's test vector.
export function encryptPayload(text: string, target: Pick<PushTarget, "p256dh" | "auth">, salt = randomBytes(16), serverPrivate?: Buffer): Buffer {
  const ecdh = createECDH("prime256v1");
  if (serverPrivate) ecdh.setPrivateKey(serverPrivate);
  else ecdh.generateKeys();
  const serverPublic = ecdh.getPublicKey();
  const browserPublic = b64(target.p256dh);

  const info = Buffer.concat([Buffer.from("WebPush: info\0"), browserPublic, serverPublic]);
  const ikm = hkdf(b64(target.auth), ecdh.computeSecret(browserPublic), info, 32);
  const contentKey = hkdf(salt, ikm, "Content-Encoding: aes128gcm\0", 16);
  const nonce = hkdf(salt, ikm, "Content-Encoding: nonce\0", 12);

  const cipher = createCipheriv("aes-128-gcm", contentKey, nonce);
  const body = Buffer.concat([cipher.update(text, "utf8"), cipher.update(Buffer.from([2])), cipher.final(), cipher.getAuthTag()]);
  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(4096);
  return Buffer.concat([salt, recordSize, Buffer.from([serverPublic.length]), serverPublic, body]);
}

// Send one message and return the push service's status. A failed request throws.
export async function sendPush(target: PushTarget, message: object, vapid: Vapid, ttlSeconds: number): Promise<number> {
  const res = await fetch(target.endpoint, {
    method: "POST",
    headers: {
      Authorization: vapidHeader(target.endpoint, vapid),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(ttlSeconds),
      Urgency: "high",
    },
    body: new Uint8Array(encryptPayload(JSON.stringify(message), target)),
    redirect: "error",
    signal: AbortSignal.timeout(4000),
  });
  return res.status;
}
