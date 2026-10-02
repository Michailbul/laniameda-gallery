import { NextResponse } from "next/server";
import { getAppUser } from "@/lib/server/app-user";
import {
  errorRedirect,
  isMcpAllowedUser,
  issueAuthorizationCode,
  readConsentTicket,
} from "@/lib/server/mcp-oauth";

// The consent form on /oauth/authorize posts here. The ticket was signed for the
// signed-in owner when the page rendered; the session must still be that owner.
// The session cookie is SameSite=Lax, so a cross-site form post arrives without
// it and is refused.
export async function POST(request: Request) {
  const form = await request.formData();
  const ticket = await readConsentTicket(String(form.get("ticket") ?? ""));
  if (!ticket) {
    return new Response("This approval link expired. Start the connection again from your client.", {
      status: 400,
    });
  }

  const user = await getAppUser();
  if (!user || user.ownerUserId !== ticket.ownerUserId || !isMcpAllowedUser(user.ownerUserId)) {
    return new Response("Sign in as the gallery owner to approve this connection.", {
      status: 403,
    });
  }

  const { request: authRequest } = ticket;
  if (form.get("decision") !== "approve") {
    return NextResponse.redirect(
      errorRedirect(authRequest.redirectUri, "access_denied", authRequest.state, "The owner declined."),
      303,
    );
  }

  const code = await issueAuthorizationCode(authRequest, user.ownerUserId);
  const location = new URL(authRequest.redirectUri);
  location.searchParams.set("code", code);
  if (authRequest.state) location.searchParams.set("state", authRequest.state);
  return NextResponse.redirect(location.toString(), 303);
}
