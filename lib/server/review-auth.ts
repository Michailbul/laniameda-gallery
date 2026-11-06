import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { mintConvexActorToken, resolveConvexAuthPrivateKey } from "@/lib/convex-auth";
import { getAppUser } from "@/lib/server/app-user";
import { mintServerActorToken } from "@/lib/server/convex";

// Director review sign-in. A reviewer signs in with Google on the review page
// (Google Identity Services gives the page an ID token; no client secret).
// The server checks the token, asks Convex whether the email may open the
// project, and sets `rv_session`: a 30-day cookie signed with a key derived
// from SESSION_SECRET, so it can never pass for the gallery's tg_session.
// The page's Convex client then fetches short-lived tokens with
// sub "reviewer:<email>" from /review/<slug>/api/auth/token.
//
// The gallery owner needs no Google sign-in on gallery.laniameda.space: the
// Telegram session already names him. On the public address (another
// domain, so no tg_session) he signs in with a Google email listed in the
// project's ownerEmails.

export const REVIEW_COOKIE = "rv_session";
const REVIEW_MAX_AGE = 60 * 60 * 24 * 30;
const REVIEWER_TOKEN_TTL = 60 * 60;
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export type ReviewSession = { email: string; name?: string; picture?: string };

export type ReviewViewerAuth =
  | { kind: "owner"; ownerUserId: string; name?: string }
  | { kind: "reviewer"; email: string; name?: string; picture?: string };

export const googleReviewClientId = () =>
  process.env.GOOGLE_REVIEW_CLIENT_ID?.trim() || process.env.NEXT_PUBLIC_GOOGLE_REVIEW_CLIENT_ID?.trim() || "";

const reviewSecret = () => {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters.");
  return new TextEncoder().encode(`${secret}:director-review`);
};

/** Check a Google ID token from the sign-in button. Returns the verified person. */
export async function verifyGoogleCredential(credential: string): Promise<ReviewSession> {
  const clientId = googleReviewClientId();
  if (!clientId) throw new Error("Google sign-in is not configured (GOOGLE_REVIEW_CLIENT_ID).");
  const { payload } = await jwtVerify(credential, googleKeys, { issuer: GOOGLE_ISSUERS, audience: clientId });
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!email || payload.email_verified !== true) throw new Error("Google did not confirm this email address.");
  return {
    email,
    name: typeof payload.name === "string" ? payload.name : undefined,
    picture: typeof payload.picture === "string" ? payload.picture : undefined,
  };
}

export async function signReviewSession(session: ReviewSession) {
  return new SignJWT({ typ: "director-review", email: session.email, name: session.name, picture: session.picture })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${REVIEW_MAX_AGE}s`)
    .sign(reviewSecret());
}

export async function readReviewSession(token: string | undefined): Promise<ReviewSession | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, reviewSecret());
    if (payload.typ !== "director-review" || typeof payload.email !== "string") return null;
    return {
      email: payload.email,
      name: typeof payload.name === "string" ? payload.name : undefined,
      picture: typeof payload.picture === "string" ? payload.picture : undefined,
    };
  } catch {
    return null;
  }
}

export const reviewCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: REVIEW_MAX_AGE,
});

// A private invite link: for a reviewer whose email has no Google account
// (alexsugich@mac.com is an iCloud address). Michael copies the link from the
// owner view or an agent makes it (review_setup invite) and sends it himself.
// Opening it sets the same rv_session as a Google sign-in, as long as the
// email is still on the project's reviewers.
const INVITE_MAX_AGE_DAYS = 30;

export async function signReviewInvite(slug: string, email: string, name?: string) {
  return new SignJWT({ typ: "director-review-invite", slug: slug.trim().toLowerCase(), email: email.trim().toLowerCase(), name })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${INVITE_MAX_AGE_DAYS}d`)
    .sign(reviewSecret());
}

export async function readReviewInvite(token: string | null | undefined) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, reviewSecret());
    if (payload.typ !== "director-review-invite" || typeof payload.email !== "string" || typeof payload.slug !== "string") return null;
    return { slug: payload.slug, email: payload.email, name: typeof payload.name === "string" ? payload.name : undefined };
  } catch {
    return null;
  }
}

/** The invite link for a reviewer, under the project's public address. */
export async function reviewInviteUrl(publicBase: string, slug: string, email: string, name?: string) {
  const token = await signReviewInvite(slug, email, name);
  return `${publicBase.replace(/\/+$/, "")}/api/auth/invite?token=${encodeURIComponent(token)}`;
}

/** A Convex token for a reviewer (sub "reviewer:<email>"). */
export function mintReviewerConvexToken(email: string) {
  const privateKeyPem = resolveConvexAuthPrivateKey();
  if (!privateKeyPem) throw new Error("CONVEX_AUTH_PRIVATE_KEY is not configured.");
  return mintConvexActorToken(`reviewer:${email.trim().toLowerCase()}`, { privateKeyPem, ttlSeconds: REVIEWER_TOKEN_TTL });
}

/**
 * Who is looking at the review page: the gallery owner (Telegram session) or
 * a Google-signed reviewer (rv_session). Null when signed out.
 */
// Local development only: act as the test reviewer while a gallery session is
// open (set by /review/<slug>/api/dev-as). Ignored in production builds, and
// only for the listed test address.
export const REVIEW_DEV_AS_COOKIE = "rv_dev_as";
export const REVIEW_DEV_AS_EMAILS = ["director.test@example.com", "producer.test@example.com"];
export const reviewDevAsAllowed = () => process.env.NODE_ENV !== "production";

export async function resolveReviewViewer(): Promise<ReviewViewerAuth | null> {
  const store = await cookies();
  if (reviewDevAsAllowed()) {
    const devAs = store.get(REVIEW_DEV_AS_COOKIE)?.value?.trim().toLowerCase();
    if (devAs && REVIEW_DEV_AS_EMAILS.includes(devAs)) return { kind: "reviewer", email: devAs, name: "Test Director" };
  }
  const review = await readReviewSession(store.get(REVIEW_COOKIE)?.value);
  try {
    const owner = await getAppUser();
    if (owner) return { kind: "owner", ownerUserId: owner.ownerUserId, name: owner.name };
  } catch {
    // No usable gallery session; fall through to the review session.
  }
  if (review) return { kind: "reviewer", email: review.email, name: review.name, picture: review.picture };
  return null;
}

/** The Convex token the review page uses for this viewer. */
export function convexTokenFor(viewer: ReviewViewerAuth): string | undefined {
  if (viewer.kind === "owner") return mintServerActorToken(viewer.ownerUserId);
  return mintReviewerConvexToken(viewer.email);
}
