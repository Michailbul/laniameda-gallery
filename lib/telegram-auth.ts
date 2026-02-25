import { createHmac, createHash } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

export interface TelegramUser {
  telegramId: string;
  firstName: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
}

export interface TelegramWidgetData {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

const SESSION_COOKIE = "tg_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function getSessionSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters.");
  }
  return new TextEncoder().encode(secret);
}

/** Verify the Telegram Login Widget hash per https://core.telegram.org/widgets/login#checking-authorization */
export function verifyTelegramAuth(
  data: TelegramWidgetData,
  botToken: string,
): boolean {
  const { hash, ...rest } = data;
  const checkString = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${rest[key as keyof typeof rest]}`)
    .join("\n");

  const secretKey = createHash("sha256").update(botToken).digest();
  const hmac = createHmac("sha256", secretKey)
    .update(checkString)
    .digest("hex");

  return hmac === hash;
}

/** Check that auth_date is not stale (default: 24 hours). */
export function isAuthDateFresh(
  authDate: number,
  maxAgeSeconds = 86400,
): boolean {
  return Date.now() / 1000 - authDate < maxAgeSeconds;
}

export async function createSessionCookie(user: TelegramUser): Promise<void> {
  const token = await new SignJWT({ ...user })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(getSessionSecret());

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
}

export async function getSessionUser(): Promise<TelegramUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getSessionSecret());
    return {
      telegramId: payload.telegramId as string,
      firstName: payload.firstName as string,
      lastName: payload.lastName as string | undefined,
      username: payload.username as string | undefined,
      photoUrl: payload.photoUrl as string | undefined,
    };
  } catch {
    return null;
  }
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}
