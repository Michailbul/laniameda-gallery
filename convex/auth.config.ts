// Convex verifies short-lived RS256 JWTs whose `sub` is the gallery
// ownerUserId. They are minted by trusted code holding CONVEX_AUTH_PRIVATE_KEY:
// the Next.js server (browser session, agent tokens, extension token) and the
// local agent scripts. CONVEX_AUTH_JWKS holds the matching public key set as
// JSON; generate both with `bun scripts/generate-convex-auth-keys.ts`.
// The deployment must have CONVEX_AUTH_JWKS set before a push, or the push
// fails.
//
// Keep issuer / applicationID in sync with lib/convex-auth.ts.
const authConfig = {
  providers: [
    {
      type: "customJwt" as const,
      applicationID: "laniameda-gallery",
      issuer: "https://gallery.laniameda.space",
      jwks: `data:text/plain;charset=utf-8;base64,${btoa(process.env.CONVEX_AUTH_JWKS!.trim())}`,
      algorithm: "RS256" as const,
    },
  ],
};

export default authConfig;
