import { SignJWT, jwtVerify } from "jose";

// Edge-safe session primitives (jose only — no node:crypto, no next/headers).
// Shared by lib/telegram-auth.ts (route handlers / server actions) and
// middleware.ts (edge sliding renewal) so the cookie name, lifetime, and
// signing stay in lockstep across surfaces.

export const SESSION_COOKIE = "tg_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 365; // 365 days
// Re-issue the cookie once its current token is older than this, so an active
// user's window keeps rolling forward instead of expiring mid-use.
export const SESSION_RENEW_AFTER = 60 * 60 * 24; // 1 day

export interface SessionPayload {
  telegramId: string;
  firstName: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
}

export function getSessionSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters.");
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(getSessionSecret());
}

/** Verify a session token. Returns the payload, or null if invalid/expired. */
export async function verifySession(
  token: string,
): Promise<(SessionPayload & { iat?: number }) | null> {
  try {
    const { payload } = await jwtVerify(token, getSessionSecret());
    return {
      telegramId: payload.telegramId as string,
      firstName: payload.firstName as string,
      lastName: payload.lastName as string | undefined,
      username: payload.username as string | undefined,
      photoUrl: payload.photoUrl as string | undefined,
      iat: typeof payload.iat === "number" ? payload.iat : undefined,
    };
  } catch {
    return null;
  }
}

/** Whether a token issued at `iat` (unix seconds) is old enough to re-issue. */
export function shouldRenew(iat: number | undefined): boolean {
  if (typeof iat !== "number") return false;
  const ageSeconds = Math.floor(Date.now() / 1000) - iat;
  return ageSeconds >= SESSION_RENEW_AFTER;
}

/** Shared cookie attributes for the session cookie. */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: SESSION_MAX_AGE,
    path: "/",
  };
}
