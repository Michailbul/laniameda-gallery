import { mutation, query, type QueryCtx } from "./_generated/server";
import { ConvexError, v, type Infer } from "convex/values";
import {
  canActorAccessByUserId,
  parseUserIdList,
  resolveUserIdCandidates,
} from "./authz";

// ---------------------------------------------------------------------------
// Owner settings for the public surface (/misha.buloy/selected_work).
//
// One row per showcase owner. The authless queries that feed the public Browse
// view read it, so what a visitor gets is decided here rather than in the
// frontend:
//
//   browseScope "published"  — Browse walks the curated isPublic slice. Default.
//   browseScope "everything" — Browse walks the owner's whole vault.
//
// Featured stays curated either way: the reel is isPublic + isFeatured, and the
// setting never touches it. Share links and downloads follow Browse, so a piece
// a visitor can see is a piece they can link to.
// ---------------------------------------------------------------------------

export const publicBrowseScopeValidator = v.union(
  v.literal("published"),
  v.literal("everything"),
);
export type PublicBrowseScope = Infer<typeof publicBrowseScopeValidator>;
export const DEFAULT_PUBLIC_BROWSE_SCOPE: PublicBrowseScope = "published";

// The public surface belongs to exactly one owner. Every authless read is
// scoped to it so a second authenticated user flagging their own work can never
// place content on the public home. Unconfigured => the surface renders empty.
export const showcaseOwnerUserId = () =>
  (
    process.env.SHOWCASE_OWNER_USER_ID ??
    process.env.KB_OWNER_USER_ID ??
    ""
  ).trim();

export const showcaseOwnerCandidates = () => {
  const owner = showcaseOwnerUserId();
  return owner ? resolveUserIdCandidates(owner) : [];
};

export const isShowcaseOwner = (ownerUserId: string | undefined) => {
  const trimmed = ownerUserId?.trim();
  if (!trimmed) return false;
  return showcaseOwnerCandidates().includes(trimmed);
};

export const readPublicSurfaceSettings = async (ctx: QueryCtx) => {
  for (const candidate of showcaseOwnerCandidates()) {
    const row = await ctx.db
      .query("publicSurfaceSettings")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", candidate))
      .first();
    if (row) return row;
  }
  return null;
};

/** Which slice the public Browse view walks. No row => the curated default. */
export const resolvePublicBrowseScope = async (
  ctx: QueryCtx,
): Promise<PublicBrowseScope> =>
  (await readPublicSurfaceSettings(ctx))?.browseScope ??
  DEFAULT_PUBLIC_BROWSE_SCOPE;

// Authless: the Browse view shows the owner their current setting, and the
// grid re-keys on it so a flip restarts the scroll cleanly.
export const getPublicSurfaceSettings = query({
  args: {},
  returns: v.object({ browseScope: publicBrowseScopeValidator }),
  handler: async (ctx) => ({
    browseScope: await resolvePublicBrowseScope(ctx),
  }),
});

// Same gate as asset curation: the secret proves the call came through the
// app's own server route, the actor has to be a configured curator.
const assertCurationAdmin = (rawActorUserId: string, adminSecret: string) => {
  const expectedSecret = process.env.CURATION_ADMIN_SECRET;
  if (!expectedSecret || adminSecret !== expectedSecret) {
    throw new ConvexError("Unauthorized curator request.");
  }
  const actorUserId = rawActorUserId.trim();
  if (!actorUserId) {
    throw new ConvexError("actorUserId is required.");
  }
  const allowedUserIds = parseUserIdList(
    process.env.CURATION_ADMIN_USER_IDS ?? process.env.KB_OWNER_USER_ID,
  );
  if (allowedUserIds.length === 0) {
    throw new ConvexError("Curator user list is not configured.");
  }
  if (!canActorAccessByUserId(actorUserId, allowedUserIds)) {
    throw new ConvexError("Forbidden curator.");
  }
  return actorUserId;
};

// Idempotent upsert: setting the scope it already has writes nothing.
export const setPublicBrowseScope = mutation({
  args: {
    actorUserId: v.string(),
    browseScope: publicBrowseScopeValidator,
    adminSecret: v.string(),
  },
  returns: v.object({
    browseScope: publicBrowseScopeValidator,
    updatedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const actorUserId = assertCurationAdmin(args.actorUserId, args.adminSecret);
    const owner = showcaseOwnerUserId();
    if (!owner) {
      throw new ConvexError("Showcase owner is not configured.");
    }

    const existing = await readPublicSurfaceSettings(ctx);
    if (existing) {
      if (existing.browseScope === args.browseScope) {
        return { browseScope: existing.browseScope, updatedAt: existing.updatedAt };
      }
      const updatedAt = Date.now();
      await ctx.db.patch(existing._id, {
        browseScope: args.browseScope,
        updatedByUserId: actorUserId,
        updatedAt,
      });
      return { browseScope: args.browseScope, updatedAt };
    }

    const updatedAt = Date.now();
    await ctx.db.insert("publicSurfaceSettings", {
      ownerUserId: owner,
      browseScope: args.browseScope,
      updatedByUserId: actorUserId,
      updatedAt,
    });
    return { browseScope: args.browseScope, updatedAt };
  },
});
