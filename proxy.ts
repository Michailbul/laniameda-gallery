import { NextRequest, NextResponse } from "next/server";

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

export function proxy(request: NextRequest) {
  if (process.env.VERCEL_ENV !== "production") {
    return NextResponse.next();
  }

  const host = request.headers.get("host")?.trim().toLowerCase();
  const canonicalHost = resolveCanonicalHost();

  if (!host || host === canonicalHost || !host.endsWith(".vercel.app")) {
    return NextResponse.next();
  }

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.protocol = "https";
  redirectUrl.host = canonicalHost;

  return NextResponse.redirect(redirectUrl, 308);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
