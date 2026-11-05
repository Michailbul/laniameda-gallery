import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  shouldRenew,
  signSession,
  verifySession,
} from "@/lib/session-jwt";

const FALLBACK_CANONICAL_HOST = "gallery.laniameda.space";

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

// /w/<slug> is two pages. A visitor gets the public pitch; the signed-in
// owner gets the vault on that world, served from /w/<slug>/owner-view at the
// same address. `?public=1` shows the owner the pitch. Deciding here keeps the
// vault's code out of the public page's bundle.
const WORLD_ROOT = /^\/w\/([^/]+)\/?$/;
const routeFor = async (request: NextRequest): Promise<NextResponse> => {
  const match = WORLD_ROOT.exec(request.nextUrl.pathname);
  if (!match || request.nextUrl.searchParams.get("public") === "1") {
    return NextResponse.next();
  }
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await verifySession(token))) return NextResponse.next();
  const target = request.nextUrl.clone();
  target.pathname = `/w/${match[1]}/owner-view`;
  return NextResponse.rewrite(target);
};

export async function proxy(request: NextRequest) {
  if (process.env.VERCEL_ENV !== "production") {
    return withRenewedSession(request, await routeFor(request));
  }

  const host = request.headers.get("host")?.trim().toLowerCase();
  const canonicalHost = resolveCanonicalHost();

  if (!host || host === canonicalHost || !host.endsWith(".vercel.app")) {
    return withRenewedSession(request, await routeFor(request));
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
