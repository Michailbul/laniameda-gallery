import { randomBytes } from "node:crypto";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { mintConvexActorToken, resolveConvexAuthPrivateKey } from "@/lib/convex-auth";

// Short personal sign-in links: <public address>/i/<code>, e.g.
// mishabuloichyk.com/cassandra/i/alejandro-k7m2xq9p. The code lives on the
// reviewer row in Convex; only the review page's server (teaser token) can
// read who it signs in.

export type ReviewInvitee = { email: string; name?: string; who: string; first: string; title: string; aliases: string[] };

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** A fresh code: the person's first name plus 8 random characters. */
export function newInviteCode(name?: string) {
  const first = (name ?? "")
    .trim()
    .split(/\s+/)[0]!
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 20);
  const bytes = randomBytes(8);
  const tail = Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
  return `${first || "guest"}-${tail}`;
}

/** Who a short invite code signs in, or null. */
export async function redeemReviewInvite(slug: string, code: string): Promise<ReviewInvitee | null> {
  const privateKeyPem = resolveConvexAuthPrivateKey();
  const url = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!privateKeyPem || !url || !/^[a-z0-9-]{6,48}$/i.test(code)) return null;
  const token = mintConvexActorToken(`teaser:${slug.trim().toLowerCase()}`, { privateKeyPem, ttlSeconds: 120 });
  return await fetchQuery(api.review.redeemInvite, { slug, code }, { url, token }).catch(() => null);
}
