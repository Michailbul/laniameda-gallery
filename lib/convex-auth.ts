import { createPrivateKey, createPublicKey, createSign, randomUUID } from "node:crypto";

// Convex trusts one kind of identity: a short-lived RS256 JWT whose `sub` is
// the gallery ownerUserId. Only code holding CONVEX_AUTH_PRIVATE_KEY can mint
// one: the Next.js server (for a signed-in browser session, an agent token or
// the extension token) and Michael's local scripts. Convex holds the public
// half as CONVEX_AUTH_JWKS (see convex/auth.config.ts).
//
// Keep ISSUER / AUDIENCE / KEY_ID in sync with convex/auth.config.ts and
// skills/laniameda-gallery/scripts/convex-auth.ts.
export const CONVEX_AUTH_ISSUER = "https://gallery.laniameda.space";
export const CONVEX_AUTH_AUDIENCE = "laniameda-gallery";
export const CONVEX_AUTH_KEY_ID = "gallery-actor-20261006";
export const CONVEX_AUTH_DEFAULT_TTL_SECONDS = 60 * 60;

const base64url = (input: string | Buffer) =>
  Buffer.from(input).toString("base64url");

// Env files and Vercel both mangle multi-line values, so the PEM may arrive
// with literal "\n" sequences.
export const normalizePrivateKeyPem = (raw: string) =>
  raw.trim().replace(/\\n/g, "\n");

export const resolveConvexAuthPrivateKey = (
  env: Record<string, string | undefined> = process.env,
) => {
  const raw = env.CONVEX_AUTH_PRIVATE_KEY?.trim();
  return raw ? normalizePrivateKeyPem(raw) : undefined;
};

export type MintConvexTokenOptions = {
  privateKeyPem: string;
  ttlSeconds?: number;
  now?: number;
};

export const mintConvexActorToken = (
  subject: string,
  { privateKeyPem, ttlSeconds = CONVEX_AUTH_DEFAULT_TTL_SECONDS, now = Date.now() }: MintConvexTokenOptions,
) => {
  const sub = subject.trim();
  if (!sub) {
    throw new Error("Cannot mint a Convex token without a subject.");
  }
  const iat = Math.floor(now / 1000);
  const header = { alg: "RS256", typ: "JWT", kid: CONVEX_AUTH_KEY_ID };
  const payload = {
    iss: CONVEX_AUTH_ISSUER,
    aud: CONVEX_AUTH_AUDIENCE,
    sub,
    iat,
    nbf: iat - 30,
    exp: iat + ttlSeconds,
    jti: randomUUID(),
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createSign("RSA-SHA256")
    .update(signingInput)
    .sign(createPrivateKey(privateKeyPem));
  return `${signingInput}.${base64url(signature)}`;
};

// The JWKS that Convex needs, derived from the private key.
export const publicJwksFromPrivateKey = (privateKeyPem: string) => {
  const jwk = createPublicKey(createPrivateKey(privateKeyPem)).export({ format: "jwk" });
  return {
    keys: [{ ...jwk, kid: CONVEX_AUTH_KEY_ID, alg: "RS256", use: "sig" }],
  };
};

// For scripts and the agent worker, which build their own ConvexHttpClient.
// No-op without CONVEX_AUTH_PRIVATE_KEY (legacy rollout window only).
export const setConvexActorAuth = (
  client: { setAuth: (token: string) => void },
  subject: string,
  { ttlSeconds, env = process.env }: { ttlSeconds?: number; env?: Record<string, string | undefined> } = {},
) => {
  const privateKeyPem = resolveConvexAuthPrivateKey(env);
  if (!privateKeyPem || !subject.trim()) return false;
  client.setAuth(mintConvexActorToken(subject, { privateKeyPem, ttlSeconds }));
  return true;
};
