import { redeemReviewInvite } from "@/lib/server/review-invite";

export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store" };

// GET /<review>/i/<code>: a person's short sign-in link. Goes to the review
// page with ?i=<code>, which shows the sign-in card made for that person
// (their name and role, one Google button). The redirect is relative ("../"),
// so it lands on whichever address the link was opened at.
export async function GET(_request: Request, context: { params: Promise<{ slug: string; code: string }> }) {
  const { slug, code } = await context.params;
  const invitee = await redeemReviewInvite(slug, code.toLowerCase());
  const location = invitee ? `../?i=${encodeURIComponent(code.toLowerCase())}` : "../?invite=invalid";
  return new Response(null, { status: 303, headers: { Location: location, ...noStore } });
}
