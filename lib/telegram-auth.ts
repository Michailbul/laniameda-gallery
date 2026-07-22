import { createHmac, createHash, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  shouldRenew,
  signSession,
  verifySession,
} from "@/lib/session-jwt";

export interface TelegramUser {
  telegramId: string;
  firstName: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
}

/** Parse and validate Telegram Login Widget payload shape. */
export function parseTelegramWidgetData(
  input: unknown,
): TelegramWidgetData | null {
  if (!input || typeof input !== "object") return null;

  const data = input as Record<string, unknown>;
  const id = normalizeInteger(data.id);
  const firstName = normalizeOptionalString(data.first_name);
  const authDate = normalizeInteger(data.auth_date);
  const hash = normalizeOptionalString(data.hash);

  if (id === null || id <= 0 || !firstName || authDate === null || authDate <= 0 || !hash) {
    return null;
  }
  if (!TELEGRAM_HASH_HEX.test(hash)) return null;

  return {
    id,
    first_name: firstName,
    auth_date: authDate,
    hash,
    ...(normalizeOptionalString(data.last_name)
      ? { last_name: normalizeOptionalString(data.last_name) }
      : {}),
    ...(normalizeOptionalString(data.username)
      ? { username: normalizeOptionalString(data.username) }
      : {}),
    ...(normalizeOptionalString(data.photo_url)
      ? { photo_url: normalizeOptionalString(data.photo_url) }
      : {}),
  };
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

const TELEGRAM_HASH_HEX = /^[a-f0-9]{64}$/i;

const isString = (value: unknown): value is string =>
  typeof value === "string";

const normalizeOptionalString = (value: unknown): string | undefined => {
  if (!isString(value)) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeInteger = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
};

/** Verify the Telegram Login Widget hash per https://core.telegram.org/widgets/login#checking-authorization */
export function verifyTelegramAuth(
  data: TelegramWidgetData,
  botToken: string,
): boolean {
  const pairs: Array<[string, string]> = [
    ["auth_date", String(data.auth_date)],
    ["first_name", data.first_name],
    ["id", String(data.id)],
    ...(data.last_name ? [["last_name", data.last_name] as [string, string]] : []),
    ...(data.photo_url ? [["photo_url", data.photo_url] as [string, string]] : []),
    ...(data.username ? [["username", data.username] as [string, string]] : []),
  ];

  const checkString = pairs
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = createHash("sha256").update(botToken).digest();
  const hmac = createHmac("sha256", secretKey)
    .update(checkString)
    .digest("hex");

  if (!TELEGRAM_HASH_HEX.test(data.hash) || hmac.length !== data.hash.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(hmac, "hex"), Buffer.from(data.hash, "hex"));
}

/** Check that auth_date is not stale (default: 24 hours). */
export function isAuthDateFresh(
  authDate: number,
  maxAgeSeconds = 86400,
  futureSkewSeconds = 60,
): boolean {
  if (!Number.isInteger(authDate)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (authDate > now + futureSkewSeconds) return false;
  return now - authDate < maxAgeSeconds;
}

export async function createSessionCookie(user: TelegramUser): Promise<void> {
  const token = await signSession(user);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, sessionCookieOptions());
}

export async function getSessionUser(): Promise<TelegramUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const payload = await verifySession(token);
  if (!payload) return null;

  return {
    telegramId: payload.telegramId,
    firstName: payload.firstName,
    lastName: payload.lastName,
    username: payload.username,
    photoUrl: payload.photoUrl,
  };
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

// Re-issue the session cookie once its token crosses the renew threshold so an
// active user's window keeps rolling forward instead of expiring mid-use. Only
// callable from contexts where cookies are writable (route handlers, server
// actions). Edge navigations are handled separately by middleware.ts.
export async function renewSessionCookieIfStale(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return;

  const payload = await verifySession(token);
  if (!payload || !shouldRenew(payload.iat)) return;

  await createSessionCookie({
    telegramId: payload.telegramId,
    firstName: payload.firstName,
    lastName: payload.lastName,
    username: payload.username,
    photoUrl: payload.photoUrl,
  });
}
