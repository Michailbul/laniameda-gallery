import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { api } from "@/convex/_generated/api";
import { getAppUser } from "@/lib/server/app-user";
import { getServerConvexClient } from "@/lib/server/convex";
import { MAGNIFIC_OAUTH_COOKIE, settingsUrl } from "@/lib/server/magnific-connect";
import { isMcpAllowedUser } from "@/lib/server/mcp-oauth";

export const dynamic = "force-dynamic";

// Magnific sends the owner back here with a code; Convex trades it for tokens
// and keeps them sealed (convex/providerVault.ts connectMagnific).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (params: Record<string, string>) => {
    const response = NextResponse.redirect(settingsUrl(request, params), 303);
    response.cookies.delete({ name: MAGNIFIC_OAUTH_COOKIE, path: "/api/settings/magnific" });
    return response;
  };

  const jar = await cookies();
  let saved: { state?: string; verifier?: string; redirectUri?: string } = {};
  try { saved = JSON.parse(jar.get(MAGNIFIC_OAUTH_COOKIE)?.value ?? "{}"); } catch { /* expired or tampered */ }

  const denied = url.searchParams.get("error");
  if (denied) return back({ magnific: "error", why: url.searchParams.get("error_description") || denied });
  const code = url.searchParams.get("code");
  if (!code || !saved.state || !saved.verifier || !saved.redirectUri || url.searchParams.get("state") !== saved.state) {
    return back({ magnific: "error", why: "The sign-in link expired. Press Connect again." });
  }

  const user = await getAppUser();
  if (!user || !isMcpAllowedUser(user.ownerUserId)) {
    return back({ magnific: "error", why: "Sign in to the gallery as its owner first." });
  }
  try {
    const client = getServerConvexClient(user.ownerUserId);
    const result = await client.action(api.providerVault.connectMagnific, {
      ownerUserId: user.ownerUserId, code, codeVerifier: saved.verifier, redirectUri: saved.redirectUri,
    });
    return back({ magnific: "connected", ...(result.account ? { account: result.account } : {}) });
  } catch (error) {
    const why = error instanceof Error ? error.message.replace(/^.*ConvexError: /, "").split("\n")[0]! : "Could not connect.";
    return back({ magnific: "error", why: why.slice(0, 200) });
  }
}
