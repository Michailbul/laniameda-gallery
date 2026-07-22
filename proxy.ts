import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  shouldRenew,
  signSession,
  verifySession,
} from "@/lib/session-jwt";

const FALLBACK_CANONICAL_HOST = "laniameda-galery.vercel.app";

const resolveCanonicalHost = () => {
  const configuredHost =
    process.env.APP_CANONICAL_HOST?.trim() ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() ||
    FALLBACK_CANONICAL_HOST;

  return configuredHost
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
    .toLowerCase();
};

// Slide the session cookie forward on every navigation. The client also renews
// via /api/auth/me on load, but this covers server-rendered visits and keeps an
// active user's 365-day window rolling at the edge, so the session effectively
// never expires while they keep using the app.
const withRenewedSession = async (
  request: NextRequest,
  response: NextResponse,
): Promise<NextResponse> => {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return response;

  const payload = await verifySession(token);
  if (!payload || !shouldRenew(payload.iat)) return response;

  try {
    const renewed = await signSession({
      telegramId: payload.telegramId,
      firstName: payload.firstName,
      lastName: payload.lastName,
      username: payload.username,
      photoUrl: payload.photoUrl,
    });
    response.cookies.set(SESSION_COOKIE, renewed, sessionCookieOptions());
  } catch {
    // Missing/short SESSION_SECRET — leave the existing cookie untouched.
  }

  return response;
};

export async function proxy(request: NextRequest) {
  if (process.env.VERCEL_ENV !== "production") {
    return withRenewedSession(request, NextResponse.next());
  }

  const host = request.headers.get("host")?.trim().toLowerCase();
  const canonicalHost = resolveCanonicalHost();

  if (!host || host === canonicalHost || !host.endsWith(".vercel.app")) {
    return withRenewedSession(request, NextResponse.next());
  }

  // Non-canonical host: redirect to the canonical one. The redirected request
  // re-enters proxy and renews there, so no cookie is set on the 308.
  const redirectUrl = request.nextUrl.clone();
  redirectUrl.protocol = "https";
  redirectUrl.host = canonicalHost;

  return NextResponse.redirect(redirectUrl, 308);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
