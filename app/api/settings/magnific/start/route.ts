import { NextResponse } from "next/server";
import { MAGNIFIC_AUTHORIZE_URL, MAGNIFIC_CLIENT_ID, MAGNIFIC_MCP_URL, MAGNIFIC_SCOPE } from "@/lib/magnific-mcp";
import { getAppUser } from "@/lib/server/app-user";
import {
  MAGNIFIC_OAUTH_COOKIE, MAGNIFIC_OAUTH_MAX_AGE, magnificRedirectUri, newPkce, settingsUrl,
} from "@/lib/server/magnific-connect";
import { isMcpAllowedUser } from "@/lib/server/mcp-oauth";

export const dynamic = "force-dynamic";

// Settings → Connect Magnific: send the owner to Magnific's sign-in.
export async function GET(request: Request) {
  const user = await getAppUser();
  if (!user || !isMcpAllowedUser(user.ownerUserId)) {
    return NextResponse.redirect(settingsUrl(request, { magnific: "error", why: "Sign in to the gallery as its owner first." }), 303);
  }
  const { verifier, challenge, state } = newPkce();
  const redirectUri = magnificRedirectUri(request);
  const authorize = new URL(MAGNIFIC_AUTHORIZE_URL);
  authorize.searchParams.set("client_id", MAGNIFIC_CLIENT_ID);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("scope", MAGNIFIC_SCOPE);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  authorize.searchParams.set("resource", MAGNIFIC_MCP_URL);
  const response = NextResponse.redirect(authorize.toString(), 303);
  response.cookies.set(MAGNIFIC_OAUTH_COOKIE, JSON.stringify({ state, verifier, redirectUri }), {
    httpOnly: true,
    sameSite: "lax",
    secure: redirectUri.startsWith("https://"),
    path: "/api/settings/magnific",
    maxAge: MAGNIFIC_OAUTH_MAX_AGE,
  });
  return response;
}
