import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { convexTokenFor, googleReviewClientId, resolveReviewViewer } from "@/lib/server/review-auth";
import type { ReviewPage } from "@/lib/review-client";
import { getReviewTeaserData } from "@/lib/server/review-teaser";
import { reviewTheme } from "@/lib/review-theme";
import { ReviewApp } from "@/components/review/ReviewApp";
import { SignIn } from "@/components/review/SignIn";
import { TeaserBackdrop } from "@/components/review/Teaser";
import { reviewFontClass } from "@/components/review/fonts";
import "@/components/review/review.css";

// The director review page. Served here at /review/<slug> and, through a
// rewrite, at the public address (www.mishabuloichyk.com/cassandra), so the
// client never assumes its own path. Signed out: the sign-in screen. Signed
// in: the round is read on the server with the viewer's Convex token, so the
// first paint already has every frame, then the client subscribes live.

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Director review",
  description: "Art direction review.",
  robots: { index: false, follow: false },
};

type Params = { slug: string };
type Search = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

const convexUrl = () => process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL;

const searchString = (search: Search) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, entry);
  }
  return params.toString();
};

export default async function ReviewRoute({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Search> }) {
  const [{ slug }, search] = await Promise.all([params, searchParams]);
  const url = convexUrl();
  const options = (token?: string) => ({ ...(url ? { url } : {}), ...(token ? { token } : {}) });
  const viewer = await resolveReviewViewer();
  const isDev = process.env.NODE_ENV !== "production";

  // Signed out (or refused): the sign-in card over the real layout of the
  // current round, blurred. The card paints at once; the backdrop (built on
  // the server from 48 px blurred thumbnails) streams in behind it, so the
  // browser makes no extra request and never waits for it.
  const signIn = async (denied?: { email?: string }) => {
    const [card] = await Promise.all([
      fetchQuery(api.review.signInCard, { slug }, options()).catch(() => null),
      getReviewTeaserData(slug),
    ]);
    if (!card) notFound();
    return (
      <div className={reviewFontClass}>
        <title>{`${card.title} · Director review`}</title>
        <div className="rv-signin" data-theme={reviewTheme(slug)}>
          <Suspense fallback={null}>
            <TeaserBackdrop slug={slug} />
          </Suspense>
          <SignIn
            title={card.title}
            openSignIn={card.openSignIn}
            people={card.people}
            clientId={googleReviewClientId()}
            denied={denied}
            invite={one(search.invite)}
            isDev={isDev}
          />
        </div>
      </div>
    );
  };

  if (!viewer) return signIn();

  const token = convexTokenFor(viewer);
  // ?view=director: Michael sees exactly what the director sees (the backend
  // honours it for the owner only; anyone else gets their normal page).
  const asDirector = one(search.view) === "director";
  // The owner opens on the round being prepared when there is one (?draft=0
  // opens the published round); the backend ignores it for everyone else.
  const draft = !asDirector && one(search.draft) !== "0";
  const pageArgs: { slug: string; draft?: boolean; versionId?: Id<"reviewVersions">; asDirector?: boolean } = {
    slug,
    ...(draft ? { draft: true } : {}),
    ...(asDirector ? { asDirector: true } : {}),
  };
  const [first, feedback] = await Promise.all([
    fetchQuery(api.review.page, pageArgs, options(token)),
    fetchQuery(api.review.feedback, { slug }, options(token)),
  ]);
  if (first === null) notFound();
  if ("denied" in first) return signIn({ email: first.email ?? (viewer.kind === "reviewer" ? viewer.email : undefined) });

  // A link to an earlier round (?r=v0.1): read that round instead.
  let page: ReviewPage = first;
  const round = one(search.r).toLowerCase();
  const wanted = round ? first.versions.find((row) => row.label.toLowerCase() === round) : undefined;
  if (wanted && wanted.id !== first.versionId) {
    pageArgs.versionId = wanted.id;
    delete pageArgs.draft;
    const again = await fetchQuery(api.review.page, pageArgs, options(token));
    if (again && !("denied" in again)) page = again;
  }

  return (
    <div className={reviewFontClass}>
      <title>{`${page.project.title} · Director review`}</title>
      <ReviewApp
        slug={slug}
        initialPage={page}
        initialArgs={{ versionId: pageArgs.versionId, draft: pageArgs.draft, asDirector: pageArgs.asDirector }}
        initialFeedback={feedback}
        initialToken={token ?? null}
        initialSearch={searchString(search)}
        convexUrl={url ?? ""}
        isDev={isDev}
      />
    </div>
  );
}
