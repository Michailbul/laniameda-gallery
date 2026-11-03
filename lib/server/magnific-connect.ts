import { createHash, randomBytes } from "node:crypto";
import { MAGNIFIC_CALLBACK_PATH } from "@/lib/magnific-mcp";
import { originFromRequest } from "@/lib/server/mcp-oauth";

// Settings → Connect Magnific: an OAuth authorization-code flow with PKCE
// against Magnific's sign-in, as a public client (no secret). The verifier and
// state wait in a short httpOnly cookie between the two redirects.

export const MAGNIFIC_OAUTH_COOKIE = "lm_magnific_oauth";
export const MAGNIFIC_OAUTH_MAX_AGE = 10 * 60;

const base64url = (bytes: Buffer) => bytes.toString("base64url");

export const newPkce = () => {
  const verifier = base64url(randomBytes(48));
  return { verifier, challenge: base64url(createHash("sha256").update(verifier).digest()), state: base64url(randomBytes(24)) };
};

export const magnificRedirectUri = (request: Request) => `${originFromRequest(request)}${MAGNIFIC_CALLBACK_PATH}`;

export const settingsUrl = (request: Request, params: Record<string, string>) => {
  const url = new URL("/settings", originFromRequest(request));
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
};
