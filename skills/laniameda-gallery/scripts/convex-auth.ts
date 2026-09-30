import { createPrivateKey, createSign, randomUUID } from "node:crypto";

// Convex only trusts an owner that arrives as a signed token (see the gallery
// repo's lib/convex-auth.ts, which this mirrors so the skill folder can be
// copied on its own). The key is CONVEX_AUTH_PRIVATE_KEY in the repo's
// .env.local, next to KB_OWNER_USER_ID. Keep ISSUER / AUDIENCE / KEY_ID in sync.
const ISSUER = "https://gallery.laniameda.space";
const AUDIENCE = "laniameda-gallery";
const KEY_ID = "gallery-actor-1";
const TTL_SECONDS = 60 * 60;
// Re-mint a few minutes before expiry so long batch runs never send a stale token.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

const cache = new Map<string, { token: string; expiresAt: number }>();

const base64url = (input: string | Buffer) => Buffer.from(input).toString("base64url");

export function mintConvexToken(subject: string, privateKeyPem: string, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const header = { alg: "RS256", typ: "JWT", kid: KEY_ID };
  const payload = {
    iss: ISSUER,
    aud: AUDIENCE,
    sub: subject,
    iat,
    nbf: iat - 30,
    exp: iat + TTL_SECONDS,
    jti: randomUUID(),
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createSign("RSA-SHA256")
    .update(signingInput)
    .sign(createPrivateKey(privateKeyPem.trim().replace(/\\n/g, "\n")));
  return `${signingInput}.${base64url(signature)}`;
}

// Headers for a Convex HTTP API call made on behalf of `subject`
// (default KB_OWNER_USER_ID). Empty when no key is configured, which only
// works while the deployment still has LEGACY_OWNER_ARG_AUTH on.
export function convexAuthHeaders(subject?: string): Record<string, string> {
  const sub = (subject ?? process.env.KB_OWNER_USER_ID ?? "").trim();
  const privateKeyPem = process.env.CONVEX_AUTH_PRIVATE_KEY?.trim();
  if (!sub || !privateKeyPem) return {};

  const now = Date.now();
  const cached = cache.get(sub);
  if (cached && cached.expiresAt - REFRESH_MARGIN_MS > now) {
    return { Authorization: `Bearer ${cached.token}` };
  }
  const token = mintConvexToken(sub, privateKeyPem, now);
  cache.set(sub, { token, expiresAt: now + TTL_SECONDS * 1000 });
  return { Authorization: `Bearer ${token}` };
}
