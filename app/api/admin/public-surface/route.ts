import { NextResponse } from "next/server";
import { makeFunctionReference } from "convex/server";
import { requireAuth } from "@/lib/server-auth";
import { canActorAccessByUserId, parseUserIdList } from "@/lib/identity";
import { getServerConvexClient } from "@/lib/server/convex";

// Owner control over the public surface. Same shape as the curation routes:
// the session proves who is asking, the curator list decides whether they may,
// and the secret lets the Convex mutation trust that it came through here.
const setPublicBrowseScopeMutation = makeFunctionReference<"mutation">(
  "publicSurface:setPublicBrowseScope",
);

const BROWSE_SCOPES = ["published", "everything"] as const;
type BrowseScope = (typeof BROWSE_SCOPES)[number];

const isBrowseScope = (value: unknown): value is BrowseScope =>
  typeof value === "string" &&
  (BROWSE_SCOPES as readonly string[]).includes(value);

const resolveCuratorUserIds = () =>
  parseUserIdList(
    process.env.CURATION_ADMIN_USER_IDS ?? process.env.KB_OWNER_USER_ID,
  );

export async function POST(request: Request) {
  try {
    const authUser = await requireAuth();
    const body = (await request.json().catch(() => null)) as
      | { browseScope?: unknown }
      | null;

    if (!isBrowseScope(body?.browseScope)) {
      return NextResponse.json(
        { error: 'browseScope must be "published" or "everything".' },
        { status: 400 },
      );
    }

    const adminSecret = process.env.CURATION_ADMIN_SECRET;
    if (!adminSecret) {
      return NextResponse.json(
        { error: "Server misconfigured: missing CURATION_ADMIN_SECRET." },
        { status: 500 },
      );
    }

    const allowedCurators = resolveCuratorUserIds();
    if (allowedCurators.length === 0) {
      return NextResponse.json(
        { error: "Server misconfigured: no curator users configured." },
        { status: 500 },
      );
    }

    if (!canActorAccessByUserId(authUser.id, allowedCurators)) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const client = getServerConvexClient();
    const result = await client.mutation(setPublicBrowseScopeMutation, {
      actorUserId: authUser.id,
      browseScope: body.browseScope,
      adminSecret,
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
