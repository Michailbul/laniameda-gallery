import { ConvexError, v, type Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { REVIEWER_SUBJECT_PREFIX, TEASER_SUBJECT_PREFIX, actorMatchesUserId, signedOwnerMutation, signedOwnerQuery } from "./actor";
import { canActorAccessOwnerUserId } from "./authz";
import { buildR2PublicUrl } from "./r2_url";
import { assetFolderIds, worldsOfAsset } from "./worldCore";
import { fileAssetsInWorld } from "./worlds";
import {
  reviewRoleValidator, reviewSectionValidator, reviewStyleEntryValidator,
  reviewVerdictValidator, reviewVersionStatusValidator,
} from "./reviewValidators";

// Director review. Two kinds of caller:
//   - the owner: a gallery session or agent token (sub = ownerUserId), or a
//     Google sign-in on the review page with an email in project.ownerEmails;
//   - a reviewer: a Google sign-in whose email is on project.reviewers. The
//     review page mints a Convex token with sub "reviewer:<email>"; it opens
//     only the functions in this file (convex/actor.ts refuses it elsewhere).
// Viewer functions (page, feedback, comments, verdicts) resolve the caller
// themselves; management functions are owner-scoped like the rest of the
// gallery and are what the agent route (/api/agent/review) calls.

type Ctx = QueryCtx | MutationCtx;
type Project = Doc<"reviewProjects">;
type Role = Infer<typeof reviewRoleValidator>;
type Viewer = { role: Role; email?: string; name?: string };

const COMMENT_MAX = 4000;
const MAX_BATCH = 500;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizeEmail = (value: string) => value.trim().toLowerCase();
export const versionLabel = (number: number) => `v0.${number}`;
export const shortCode = (assetId: string) => `CA-${assetId.slice(-6).toUpperCase()}`;

// The six-character code (Michael's explorer convention) can repeat: Convex
// ids share their last characters. Frames whose code clashes inside one list
// get a longer suffix, so every code on a page stays unique.
export const uniqueCodes = (assetIds: string[]) => {
  const counts = new Map<string, number>();
  for (const id of new Set(assetIds)) counts.set(shortCode(id), (counts.get(shortCode(id)) ?? 0) + 1);
  return (assetId: string) => {
    const code = shortCode(assetId);
    return (counts.get(code) ?? 0) > 1 ? `CA-${assetId.slice(-10).toUpperCase()}` : code;
  };
};

export const slugify = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "folder";

// ---------------------------------------------------------------- access

const projectBySlug = async (ctx: Ctx, slug: string) =>
  await ctx.db.query("reviewProjects").withIndex("by_slug", (q) => q.eq("slug", slug.trim().toLowerCase())).unique();

const requireProject = async (ctx: Ctx, slug: string) => {
  const project = await projectBySlug(ctx, slug);
  if (!project) throw new ConvexError(`No review project "${slug}".`);
  return project;
};

const identityOf = async (ctx: Ctx) => {
  const identity = (await ctx.auth.getUserIdentity()) as
    | ({ subject: string; name?: string } & Record<string, unknown>)
    | null;
  return identity;
};

export const resolveViewer = async (ctx: Ctx, project: Project): Promise<Viewer | null> => {
  const identity = await identityOf(ctx);
  const subject = identity?.subject?.trim();
  if (!subject) return null;
  if (subject.startsWith(REVIEWER_SUBJECT_PREFIX)) {
    const email = normalizeEmail(subject.slice(REVIEWER_SUBJECT_PREFIX.length));
    const name = typeof identity?.name === "string" ? identity.name : undefined;
    if (project.ownerEmails.includes(email)) return { role: "owner", email, name };
    const reviewer = project.reviewers.find((row) => row.email === email);
    if (!reviewer) return null;
    return { role: reviewer.role, email, name: reviewer.name ?? name };
  }
  if (actorMatchesUserId(subject, project.ownerUserId)) return { role: "owner", name: "Michael" };
  return null;
};

const requireViewer = async (ctx: Ctx, slug: string) => {
  const project = await requireProject(ctx, slug);
  const viewer = await resolveViewer(ctx, project);
  if (!viewer) throw new ConvexError("This account has no access to this review.");
  return { project, viewer };
};

// Owner-scoped management: the caller's ownerUserId (filled in by
// signedOwner* from the token) must own the project.
const requireOwnedProject = async (ctx: Ctx, ownerUserId: string, slug: string) => {
  const project = await requireProject(ctx, slug);
  if (!canActorAccessOwnerUserId(ownerUserId, project.ownerUserId)) {
    throw new ConvexError(`No review project "${slug}".`);
  }
  return project;
};

// ---------------------------------------------------------------- media

const mediaBase = () => (buildR2PublicUrl("x") ?? "").replace(/\/x$/, "");

// Media references go out as R2 keys (the client prefixes mediaBase) or as
// full URLs when an asset has no R2 copy. Keeps the page payload small.
const ref = async (ctx: Ctx, r2Key?: string, storageId?: Id<"_storage">, fallback?: string) => {
  if (r2Key) return r2Key;
  if (storageId) return (await ctx.storage.getUrl(storageId)) ?? fallback;
  return fallback;
};

const thumbSetValidator = v.array(v.object({ src: v.string(), w: v.number() }));

const mediaOf = async (ctx: Ctx, asset: Doc<"assets">) => {
  const thumbs: Array<{ src: string; w: number }> = [];
  for (const variant of asset.thumbVariants ?? []) thumbs.push({ src: variant.r2Key, w: variant.width });
  const card = await ref(ctx, asset.thumbR2Key, asset.thumbStorageId);
  if (card) thumbs.push({ src: card, w: asset.thumbWidth ?? asset.width ?? 1440 });
  const original = await ref(ctx, asset.r2Key, asset.storageId, asset.sourceUrl);
  if (thumbs.length === 0 && original && asset.kind === "image") {
    thumbs.push({ src: original, w: asset.width ?? 2048 });
  }
  thumbs.sort((a, b) => a.w - b.w);
  return {
    kind: asset.kind,
    width: asset.width ?? asset.thumbWidth ?? 1600,
    height: asset.height ?? asset.thumbHeight ?? 900,
    thumbs,
    original,
  };
};

// ---------------------------------------------------------------- reads

const versionsOf = async (ctx: Ctx, projectId: Id<"reviewProjects">) =>
  await ctx.db.query("reviewVersions").withIndex("by_project_number", (q) => q.eq("projectId", projectId)).collect();

const itemsOf = async (ctx: Ctx, versionId: Id<"reviewVersions">) =>
  await ctx.db.query("reviewItems").withIndex("by_version_order", (q) => q.eq("versionId", versionId)).collect();

const foldersOf = async (ctx: Ctx, projectId: Id<"reviewProjects">) => {
  const rows: Doc<"reviewFolders">[] = [];
  for (const section of ["locations", "characters", "scenes"] as const) {
    rows.push(...(await ctx.db
      .query("reviewFolders")
      .withIndex("by_project_section_order", (q) => q.eq("projectId", projectId).eq("section", section))
      .collect()));
  }
  return rows;
};

const viewerValidator = v.object({
  role: reviewRoleValidator,
  email: v.optional(v.string()),
  name: v.optional(v.string()),
  // The key this viewer's own likes and dislikes are stored under.
  key: v.optional(v.string()),
  // The owner looking through the director's eyes (page asDirector).
  preview: v.optional(v.boolean()),
});

const pageItemValidator = v.object({
  id: v.id("reviewItems"),
  assetId: v.id("assets"),
  code: v.string(),
  folderId: v.id("reviewFolders"),
  styleId: v.optional(v.id("worldStyles")),
  order: v.number(),
  kind: v.union(v.literal("image"), v.literal("video")),
  width: v.number(),
  height: v.number(),
  thumbs: thumbSetValidator,
  original: v.optional(v.string()),
  isNew: v.boolean(),
  note: v.optional(v.string()),
  previous: v.optional(v.array(v.object({ assetId: v.id("assets"), thumb: v.optional(v.string()) }))),
});

const pageValidator = v.object({
  viewer: viewerValidator,
  mediaBase: v.string(),
  project: v.object({
    id: v.id("reviewProjects"),
    slug: v.string(),
    title: v.string(),
    subtitle: v.optional(v.string()),
    publicUrl: v.optional(v.string()),
    feedbackSeenAt: v.optional(v.number()),
  }),
  styles: v.array(v.object({
    id: v.id("worldStyles"),
    label: v.string(),
    name: v.string(),
    line: v.optional(v.string()),
    cover: v.optional(v.string()),
    hidden: v.boolean(),
  })),
  folders: v.array(v.object({
    id: v.id("reviewFolders"),
    section: reviewSectionValidator,
    area: v.optional(v.string()),
    name: v.string(),
    slug: v.string(),
    note: v.optional(v.string()),
    scenes: v.optional(v.array(v.number())),
    icon: v.optional(v.string()),
    order: v.number(),
  })),
  versions: v.array(v.object({
    id: v.id("reviewVersions"),
    number: v.number(),
    label: v.string(),
    title: v.optional(v.string()),
    note: v.optional(v.string()),
    status: reviewVersionStatusValidator,
    publishedAt: v.optional(v.number()),
    createdAt: v.number(),
    isCurrent: v.boolean(),
    isDraft: v.boolean(),
    // Owner only, on the draft: frames it adds to / takes out of the current round.
    added: v.optional(v.number()),
    removed: v.optional(v.number()),
  })),
  versionId: v.optional(v.id("reviewVersions")),
  items: v.array(pageItemValidator),
});

/**
 * Everything the review page needs for one round, in one read: the folder
 * tree, the style carousel, the rounds, and every item of the shown round.
 * The page filters by folder and style on the client, so moving around costs
 * no round trip. Feedback is a separate, small query (it changes often).
 */
export const page = query({
  args: {
    slug: v.string(),
    versionId: v.optional(v.id("reviewVersions")),
    // Owner only: show the draft round being prepared.
    draft: v.optional(v.boolean()),
    // Owner only: see the page exactly as the director does (published
    // rounds, no owner tools or making-of). Feedback still saves as the owner.
    asDirector: v.optional(v.boolean()),
  },
  returns: v.union(v.null(), v.object({ denied: v.literal(true), email: v.optional(v.string()) }), pageValidator),
  handler: async (ctx, args) => {
    const project = await projectBySlug(ctx, args.slug);
    if (!project) return null;
    const viewer = await resolveViewer(ctx, project);
    if (!viewer) {
      const subject = (await identityOf(ctx))?.subject ?? "";
      return {
        denied: true as const,
        email: subject.startsWith(REVIEWER_SUBJECT_PREFIX) ? subject.slice(REVIEWER_SUBJECT_PREFIX.length) : undefined,
      };
    }
    const preview = Boolean(args.asDirector) && viewer.role === "owner";
    const isOwner = viewer.role === "owner" && !preview;

    const allVersions = await versionsOf(ctx, project._id);
    const visible = allVersions.filter((row) => isOwner || row.status === "published");
    const published = allVersions.filter((row) => row.status === "published");

    let shown: Doc<"reviewVersions"> | undefined;
    if (args.versionId) shown = visible.find((row) => row._id === args.versionId);
    if (!shown && args.draft && isOwner && project.draftVersionId) {
      shown = allVersions.find((row) => row._id === project.draftVersionId);
    }
    if (!shown && project.currentVersionId) shown = visible.find((row) => row._id === project.currentVersionId);
    if (!shown) shown = published[published.length - 1] ?? (isOwner ? allVersions[allVersions.length - 1] : undefined);

    // "New" = not in the round before the shown one (the current round when
    // the draft is shown).
    let previousAssets = new Set<string>();
    if (shown) {
      const before = shown.status === "draft"
        ? allVersions.find((row) => row._id === project.currentVersionId)
        : [...published].reverse().find((row) => row.number < shown!.number);
      if (before) previousAssets = new Set((await itemsOf(ctx, before._id)).map((row) => row.assetId));
    }

    const items: Infer<typeof pageItemValidator>[] = [];
    if (shown) {
      const rows = await itemsOf(ctx, shown._id);
      const codeOf = uniqueCodes(rows.map((row) => row.assetId));
      const assets = await Promise.all(rows.map((row) => ctx.db.get(row.assetId)));
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index]!;
        const asset = assets[index];
        if (!asset) continue;
        const media = await mediaOf(ctx, asset);
        let previous: Array<{ assetId: Id<"assets">; thumb?: string }> | undefined;
        if (row.previousAssetIds?.length) {
          previous = [];
          for (const previousId of row.previousAssetIds) {
            const earlier = await ctx.db.get(previousId);
            if (!earlier) continue;
            const earlierMedia = await mediaOf(ctx, earlier);
            previous.push({ assetId: previousId, thumb: earlierMedia.thumbs[earlierMedia.thumbs.length - 1]?.src });
          }
        }
        items.push({
          id: row._id,
          assetId: row.assetId,
          code: codeOf(row.assetId),
          folderId: row.folderId,
          styleId: row.styleId,
          order: row.order,
          kind: media.kind,
          width: media.width,
          height: media.height,
          thumbs: media.thumbs,
          original: media.original,
          isNew: previousAssets.size > 0 && !previousAssets.has(row.assetId),
          note: row.note,
          previous,
        });
      }
    }

    // Owner only: what the draft changes against the current round, so the
    // page can say "Next round · 5 frames waiting" without opening it.
    let draftChange: { added: number; removed: number } | undefined;
    if (isOwner && project.draftVersionId) {
      const draftAssets = new Set((await itemsOf(ctx, project.draftVersionId)).map((row) => row.assetId as string));
      const currentAssets = project.currentVersionId
        ? new Set((await itemsOf(ctx, project.currentVersionId)).map((row) => row.assetId as string))
        : new Set<string>();
      draftChange = {
        added: [...draftAssets].filter((id) => !currentAssets.has(id)).length,
        removed: [...currentAssets].filter((id) => !draftAssets.has(id)).length,
      };
    }

    const styles = [];
    // A style dropped from the carousel (removeStyle) still labels the frames
    // that use it in an already published round, so that round reads as sent.
    const entries: Array<{ styleId: Id<"worldStyles">; label?: string; hidden?: boolean }> = [...project.styles];
    for (const item of items) {
      if (item.styleId && !entries.some((entry) => entry.styleId === item.styleId)) entries.push({ styleId: item.styleId });
    }
    for (const entry of entries) {
      const style = await ctx.db.get(entry.styleId);
      if (!style) continue;
      if (entry.hidden && !items.some((item) => item.styleId === entry.styleId)) continue;
      let cover: string | undefined;
      const coverId = style.coverAssetIds[0];
      const coverAsset = coverId ? await ctx.db.get(coverId) : null;
      if (coverAsset) {
        const media = await mediaOf(ctx, coverAsset);
        cover = media.thumbs.find((thumb) => thumb.w >= 400)?.src ?? media.thumbs[0]?.src;
      } else {
        const first = items.find((item) => item.styleId === style._id);
        cover = first?.thumbs.find((thumb) => thumb.w >= 400)?.src ?? first?.thumbs[0]?.src;
      }
      styles.push({
        id: style._id,
        label: entry.label?.trim() || style.name,
        name: isOwner ? style.name : entry.label?.trim() || style.name,
        line: isOwner ? style.line : undefined,
        cover,
        hidden: Boolean(entry.hidden),
      });
    }

    const folders = (await foldersOf(ctx, project._id))
      .filter((row) => !row.archivedAt)
      .map((row) => ({
        id: row._id, section: row.section, area: row.area, name: row.name, slug: row.slug,
        note: row.note, scenes: row.scenes, icon: row.icon, order: row.order,
      }));

    return {
      viewer: preview
        ? { role: "director" as const, email: viewer.email, name: viewer.name, key: feedbackKey(viewer), preview: true }
        : { ...viewer, key: feedbackKey(viewer) },
      mediaBase: mediaBase(),
      project: {
        id: project._id,
        slug: project.slug,
        title: project.title,
        subtitle: project.subtitle,
        publicUrl: project.publicUrl,
        feedbackSeenAt: isOwner ? project.feedbackSeenAt : undefined,
      },
      styles,
      folders,
      versions: visible.map((row) => ({
        id: row._id,
        number: row.number,
        label: row.label,
        title: row.title,
        note: row.note,
        status: row.status,
        publishedAt: row.publishedAt,
        createdAt: row.createdAt,
        isCurrent: row._id === project.currentVersionId,
        isDraft: row._id === project.draftVersionId,
        ...(row._id === project.draftVersionId && draftChange ? draftChange : {}),
      })),
      versionId: shown?._id,
      items,
    };
  },
});

/** Sign-in check: may the caller open this project, and as what? */
export const access = query({
  args: { slug: v.string() },
  returns: v.union(v.null(), v.object({ role: reviewRoleValidator, title: v.string() })),
  handler: async (ctx, args) => {
    const project = await projectBySlug(ctx, args.slug);
    if (!project) return null;
    const viewer = await resolveViewer(ctx, project);
    return viewer ? { role: viewer.role, title: project.title } : null;
  },
});

const verdictRowValidator = v.object({
  assetId: v.id("assets"),
  // The verdict's author: their email for the owner and for their own rows,
  // otherwise the same short id as `who`.
  email: v.string(),
  who: v.optional(v.string()),
  role: reviewRoleValidator,
  verdict: reviewVerdictValidator,
  updatedAt: v.number(),
});

// Short stable ids for the people of a project ("owner", "r1", "r2" …),
// so frames can show who liked them without handing out emails.
const peopleIds = (project: Project) => {
  const index = new Map(project.reviewers.map((row, position) => [row.email, `r${position + 1}`]));
  return (email: string) => (email === "owner" || project.ownerEmails.includes(email) ? "owner" : index.get(email) ?? "guest");
};

/** Likes, dislikes and comment counts for the whole project: small and live. */
export const feedback = query({
  args: { slug: v.string() },
  returns: v.union(v.null(), v.object({
    // Everyone who can leave feedback, for the avatars on frames. `who` is a
    // short id; emails are only shown to the owner.
    people: v.array(v.object({
      who: v.string(), name: v.string(), initials: v.string(), title: v.optional(v.string()),
      pictureUrl: v.optional(v.string()), role: v.string(), isYou: v.boolean(),
    })),
    verdicts: v.array(verdictRowValidator),
    comments: v.array(v.object({
      assetId: v.id("assets"), count: v.number(), open: v.number(), lastAt: v.number(),
      lastByOwner: v.boolean(),
    })),
    reviewers: v.array(v.object({ email: v.string(), name: v.optional(v.string()), role: v.string(), lastSeenAt: v.optional(v.number()) })),
  })),
  handler: async (ctx, args) => {
    const project = await projectBySlug(ctx, args.slug);
    if (!project) return null;
    const viewer = await resolveViewer(ctx, project);
    if (!viewer) return null;
    const verdictRows = await ctx.db
      .query("reviewFeedback")
      .withIndex("by_project_updatedAt", (q) => q.eq("projectId", project._id))
      .collect();
    const commentRows = await ctx.db
      .query("reviewComments")
      .withIndex("by_project_createdAt", (q) => q.eq("projectId", project._id))
      .collect();
    const byAsset = new Map<string, { assetId: Id<"assets">; count: number; open: number; lastAt: number; lastByOwner: boolean }>();
    for (const row of commentRows) {
      const entry = byAsset.get(row.assetId) ?? { assetId: row.assetId, count: 0, open: 0, lastAt: 0, lastByOwner: false };
      entry.count += 1;
      if (!row.resolvedAt) entry.open += 1;
      if (row.createdAt >= entry.lastAt) {
        entry.lastAt = row.createdAt;
        entry.lastByOwner = row.authorRole === "owner" || row.authorRole === "agent";
      }
      byAsset.set(row.assetId, entry);
    }
    const whoOf = peopleIds(project);
    const mine = feedbackKey(viewer);
    const isOwner = viewer.role === "owner";
    const initialsOf = (name: string) =>
      name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("") || "?";
    const people = [
      { who: "owner", name: "Michael", initials: "M", title: "Art director", pictureUrl: undefined, role: "owner", isYou: mine === "owner" },
      ...project.reviewers.map((row) => {
        const name = row.name?.trim() || row.email.split("@")[0]!;
        return {
          who: whoOf(row.email), name, initials: initialsOf(name), title: row.title,
          pictureUrl: row.pictureUrl, role: row.role, isYou: row.email === mine,
        };
      }),
    ];
    return {
      people,
      verdicts: verdictRows.map((row) => ({
        assetId: row.assetId,
        email: isOwner || row.reviewerEmail === mine ? row.reviewerEmail : whoOf(row.reviewerEmail),
        who: whoOf(row.reviewerEmail),
        role: row.role, verdict: row.verdict, updatedAt: row.updatedAt,
      })),
      comments: [...byAsset.values()],
      reviewers: viewer.role === "owner"
        ? project.reviewers.map((row) => ({ email: row.email, name: row.name, role: row.role, lastSeenAt: row.lastSeenAt }))
        : [],
    };
  },
});

const commentValidator = v.object({
  id: v.id("reviewComments"),
  assetId: v.id("assets"),
  who: v.optional(v.string()),
  authorName: v.string(),
  authorEmail: v.optional(v.string()),
  authorRole: v.string(),
  body: v.string(),
  versionLabel: v.optional(v.string()),
  resolvedAt: v.optional(v.number()),
  createdAt: v.number(),
  mine: v.boolean(),
});

const toComment = (row: Doc<"reviewComments">, viewer: Viewer, labels: Map<string, string>, whoOf?: (email: string) => string) => ({
  id: row._id,
  assetId: row.assetId,
  who: row.authorRole === "agent" ? "agent" : whoOf ? whoOf(row.authorEmail ?? "owner") : undefined,
  authorName: row.authorName,
  authorEmail: viewer.role === "owner" ? row.authorEmail : undefined,
  authorRole: row.authorRole,
  body: row.body,
  versionLabel: row.versionId ? labels.get(row.versionId) : undefined,
  resolvedAt: row.resolvedAt,
  createdAt: row.createdAt,
  mine: viewer.email
    ? row.authorEmail === viewer.email
    : viewer.role === "owner" && row.authorRole === "owner",
});

/** One frame's comment thread, oldest first. */
export const comments = query({
  args: { slug: v.string(), assetId: v.id("assets") },
  returns: v.array(commentValidator),
  handler: async (ctx, args) => {
    const project = await projectBySlug(ctx, args.slug);
    if (!project) return [];
    const viewer = await resolveViewer(ctx, project);
    if (!viewer) return [];
    const rows = await ctx.db
      .query("reviewComments")
      .withIndex("by_project_asset_createdAt", (q) => q.eq("projectId", project._id).eq("assetId", args.assetId))
      .collect();
    const labels = new Map((await versionsOf(ctx, project._id)).map((row) => [row._id as string, row.label]));
    const whoOf = peopleIds(project);
    return rows.map((row) => toComment(row, viewer, labels, whoOf));
  },
});

// ---------------------------------------------------------------- feedback writes

const uniqueIds = <T extends string>(ids: T[]) => {
  const out = [...new Set(ids)];
  if (out.length === 0) throw new ConvexError("Select at least one frame.");
  if (out.length > MAX_BATCH) throw new ConvexError(`At most ${MAX_BATCH} frames at once.`);
  return out;
};

// Feedback is only taken on frames that are in some round of this project.
const assertInProject = async (ctx: Ctx, projectId: Id<"reviewProjects">, assetId: Id<"assets">) => {
  const row = await ctx.db
    .query("reviewItems")
    .withIndex("by_project_asset", (q) => q.eq("projectId", projectId).eq("assetId", assetId))
    .first();
  if (!row) throw new ConvexError("That frame is not in this review.");
};

const feedbackKey = (viewer: Viewer) => viewer.email ?? "owner";

/** Like, dislike or clear (verdict null) one or many frames. */
export const setVerdict = mutation({
  args: {
    slug: v.string(),
    assetIds: v.array(v.id("assets")),
    verdict: v.union(reviewVerdictValidator, v.null()),
  },
  returns: v.object({ changed: v.number() }),
  handler: async (ctx, args) => {
    const { project, viewer } = await requireViewer(ctx, args.slug);
    if (viewer.role === "viewer") throw new ConvexError("This account can look but not vote.");
    const key = feedbackKey(viewer);
    const now = Date.now();
    let changed = 0;
    for (const assetId of uniqueIds(args.assetIds)) {
      await assertInProject(ctx, project._id, assetId);
      const existing = await ctx.db
        .query("reviewFeedback")
        .withIndex("by_project_asset_reviewer", (q) =>
          q.eq("projectId", project._id).eq("assetId", assetId).eq("reviewerEmail", key))
        .unique();
      if (args.verdict === null) {
        if (existing) {
          await ctx.db.delete(existing._id);
          changed += 1;
        }
        continue;
      }
      if (existing) {
        if (existing.verdict !== args.verdict) {
          await ctx.db.patch(existing._id, { verdict: args.verdict, versionId: project.currentVersionId, updatedAt: now });
          changed += 1;
        }
        continue;
      }
      await ctx.db.insert("reviewFeedback", {
        projectId: project._id,
        assetId,
        reviewerEmail: key,
        role: viewer.role,
        verdict: args.verdict,
        versionId: project.currentVersionId,
        createdAt: now,
        updatedAt: now,
      });
      changed += 1;
    }
    return { changed };
  },
});

/** One comment on one or many frames (one row per frame, sharing a batch). */
export const addComment = mutation({
  args: { slug: v.string(), assetIds: v.array(v.id("assets")), body: v.string() },
  returns: v.object({ added: v.number(), batchId: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const { project, viewer } = await requireViewer(ctx, args.slug);
    if (viewer.role === "viewer") throw new ConvexError("This account can look but not comment.");
    const body = args.body.trim();
    if (!body) throw new ConvexError("Write a comment first.");
    if (body.length > COMMENT_MAX) throw new ConvexError(`At most ${COMMENT_MAX} characters.`);
    const ids = uniqueIds(args.assetIds);
    const now = Date.now();
    const batchId = ids.length > 1 ? `b${now.toString(36)}${Math.random().toString(36).slice(2, 8)}` : undefined;
    for (const assetId of ids) {
      await assertInProject(ctx, project._id, assetId);
      await ctx.db.insert("reviewComments", {
        projectId: project._id,
        assetId,
        versionId: project.currentVersionId,
        authorEmail: viewer.email,
        authorName: viewer.name ?? viewer.email ?? "Michael",
        authorRole: viewer.role,
        body,
        batchId,
        createdAt: now,
        updatedAt: now,
      });
    }
    return { added: ids.length, batchId };
  },
});

/** Delete your own comment (the owner may delete any). */
export const deleteComment = mutation({
  args: { slug: v.string(), commentId: v.id("reviewComments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { project, viewer } = await requireViewer(ctx, args.slug);
    const row = await ctx.db.get(args.commentId);
    if (!row || row.projectId !== project._id) return null;
    const mine = viewer.email ? row.authorEmail === viewer.email : row.authorRole === "owner";
    if (!mine && viewer.role !== "owner") throw new ConvexError("You can delete only your own comments.");
    await ctx.db.delete(row._id);
    return null;
  },
});

/** Owner: mark a comment handled (or reopen it). */
export const resolveComment = mutation({
  args: { slug: v.string(), commentId: v.id("reviewComments"), resolved: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { project, viewer } = await requireViewer(ctx, args.slug);
    if (viewer.role !== "owner") throw new ConvexError("Only the owner can resolve comments.");
    const row = await ctx.db.get(args.commentId);
    if (!row || row.projectId !== project._id) return null;
    await ctx.db.patch(row._id, { resolvedAt: args.resolved ? Date.now() : undefined, updatedAt: Date.now() });
    return null;
  },
});

/** The review page records who visited and when (reviewers only). */
export const recordVisit = mutation({
  args: { slug: v.string(), name: v.optional(v.string()), pictureUrl: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { project, viewer } = await requireViewer(ctx, args.slug);
    if (viewer.role === "owner" || !viewer.email) return null;
    const now = Date.now();
    const reviewers = project.reviewers.map((row) => row.email === viewer.email
      ? {
          ...row,
          name: row.name ?? args.name?.trim().slice(0, 120),
          pictureUrl: args.pictureUrl?.slice(0, 500) ?? row.pictureUrl,
          lastSeenAt: now,
        }
      : row);
    await ctx.db.patch(project._id, { reviewers });
    return null;
  },
});

/** Owner: "I have read the director's feedback up to now." */
export const markFeedbackSeen = mutation({
  args: { slug: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { project, viewer } = await requireViewer(ctx, args.slug);
    if (viewer.role !== "owner") return null;
    await ctx.db.patch(project._id, { feedbackSeenAt: Date.now() });
    return null;
  },
});

// ---------------------------------------------------------------- owner reads

const styleRecipeSummary = async (ctx: Ctx, style: Doc<"worldStyles">) => {
  const recipes = [];
  for (const recipe of style.recipes) {
    const moodboards = [];
    for (const id of recipe.moodboardIds) {
      const board = await ctx.db.get(id);
      if (board) moodboards.push({ id, name: board.name, code: board.mjCode });
    }
    const profiles = [];
    for (const id of recipe.profileIds) {
      const profile = await ctx.db.get(id);
      if (profile) profiles.push({ id, name: profile.name, code: profile.code });
    }
    recipes.push({
      name: recipe.name,
      moodboards,
      profiles,
      unknownCodes: recipe.unknownCodes,
      parameters: recipe.parameters,
      template: recipe.template,
    });
  }
  return recipes;
};

/**
 * Owner and agents: the project as configured (reviewers, styles with their
 * recipes, folders with item counts per round, rounds, draft state).
 */
export const overview = signedOwnerQuery({
  args: { ownerUserId: v.optional(v.string()), slug: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const project = await requireOwnedProject(ctx, args.ownerUserId!, args.slug);
    const versions = await versionsOf(ctx, project._id);
    const folders = await foldersOf(ctx, project._id);
    const counts = new Map<string, Map<string, number>>();
    for (const version of versions) {
      const perFolder = new Map<string, number>();
      for (const item of await itemsOf(ctx, version._id)) {
        perFolder.set(item.folderId, (perFolder.get(item.folderId) ?? 0) + 1);
      }
      counts.set(version._id, perFolder);
    }
    const styles = [];
    for (const entry of project.styles) {
      const style = await ctx.db.get(entry.styleId);
      styles.push(style
        ? {
            styleId: entry.styleId, label: entry.label, hidden: Boolean(entry.hidden), name: style.name,
            line: style.line, status: style.status, recipes: await styleRecipeSummary(ctx, style),
          }
        : { styleId: entry.styleId, missing: true });
    }
    const current = project.currentVersionId;
    const draft = project.draftVersionId;
    return {
      project: {
        id: project._id, slug: project.slug, title: project.title, subtitle: project.subtitle,
        worldFolderId: project.worldFolderId, publicUrl: project.publicUrl,
        reviewers: project.reviewers, ownerEmails: project.ownerEmails,
        currentVersion: versions.find((row) => row._id === current)?.label,
        draftVersion: versions.find((row) => row._id === draft)?.label,
      },
      styles,
      folders: folders.map((row) => ({
        id: row._id, section: row.section, area: row.area, name: row.name, slug: row.slug,
        note: row.note, scenes: row.scenes, icon: row.icon, order: row.order, archived: Boolean(row.archivedAt),
        currentCount: current ? counts.get(current)?.get(row._id) ?? 0 : 0,
        draftCount: draft ? counts.get(draft)?.get(row._id) ?? 0 : undefined,
      })),
      versions: versions.map((row) => ({
        id: row._id, number: row.number, label: row.label, title: row.title, note: row.note,
        status: row.status, publishedAt: row.publishedAt, createdAt: row.createdAt,
        itemCount: [...(counts.get(row._id)?.values() ?? [])].reduce((sum, n) => sum + n, 0),
        isCurrent: row._id === current, isDraft: row._id === draft,
      })),
    };
  },
});

/** Owner and agents: the items of one round (default: draft, else current). */
export const listItems = signedOwnerQuery({
  args: {
    ownerUserId: v.optional(v.string()),
    slug: v.string(),
    version: v.optional(v.string()),
    folderId: v.optional(v.id("reviewFolders")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const project = await requireOwnedProject(ctx, args.ownerUserId!, args.slug);
    const version = await resolveVersion(ctx, project, args.version);
    if (!version) return { version: null, items: [] };
    const rows = (await itemsOf(ctx, version._id)).filter((row) => !args.folderId || row.folderId === args.folderId);
    const folders = new Map((await foldersOf(ctx, project._id)).map((row) => [row._id as string, row]));
    const styleNames = new Map<string, string>();
    for (const entry of project.styles) {
      const style = await ctx.db.get(entry.styleId);
      if (style) styleNames.set(entry.styleId, entry.label || style.name);
    }
    return {
      version: { id: version._id, label: version.label, status: version.status },
      items: rows.map((row) => ({
        itemId: row._id,
        asset: `asset:${row.assetId}`,
        code: shortCode(row.assetId),
        folder: folders.get(row.folderId)?.slug,
        folderId: row.folderId,
        style: row.styleId ? styleNames.get(row.styleId) ?? row.styleId : undefined,
        styleId: row.styleId,
        order: row.order,
        note: row.note,
        previousAssetIds: row.previousAssetIds,
      })),
    };
  },
});

/**
 * Owner and agents: what the director said. Every verdict and comment, newest
 * first, with the frame's folder and style; `since` limits it to new ones.
 */
export const feedbackFeed = signedOwnerQuery({
  args: {
    ownerUserId: v.optional(v.string()),
    slug: v.string(),
    since: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const project = await requireOwnedProject(ctx, args.ownerUserId!, args.slug);
    const since = args.since ?? 0;
    const limit = Math.min(Math.max(args.limit ?? 200, 1), 1000);
    const verdicts = await ctx.db
      .query("reviewFeedback")
      .withIndex("by_project_updatedAt", (q) => q.eq("projectId", project._id).gte("updatedAt", since))
      .order("desc")
      .take(limit);
    const commentRows = await ctx.db
      .query("reviewComments")
      .withIndex("by_project_createdAt", (q) => q.eq("projectId", project._id).gte("createdAt", since))
      .order("desc")
      .take(limit);
    const folders = new Map((await foldersOf(ctx, project._id)).map((row) => [row._id as string, row]));
    const versions = new Map((await versionsOf(ctx, project._id)).map((row) => [row._id as string, row.label]));
    const placeOf = new Map<string, { folder?: string; styleId?: string }>();
    const place = async (assetId: Id<"assets">) => {
      if (placeOf.has(assetId)) return placeOf.get(assetId)!;
      const item = await ctx.db
        .query("reviewItems")
        .withIndex("by_project_asset", (q) => q.eq("projectId", project._id).eq("assetId", assetId))
        .first();
      const value = { folder: item ? folders.get(item.folderId)?.name : undefined, styleId: item?.styleId };
      placeOf.set(assetId, value);
      return value;
    };
    const events = [];
    for (const row of verdicts) {
      events.push({
        type: "verdict", asset: `asset:${row.assetId}`, code: shortCode(row.assetId), verdict: row.verdict,
        by: row.reviewerEmail, role: row.role, at: row.updatedAt,
        version: row.versionId ? versions.get(row.versionId) : undefined, ...(await place(row.assetId)),
      });
    }
    for (const row of commentRows) {
      events.push({
        type: "comment", asset: `asset:${row.assetId}`, code: shortCode(row.assetId), commentId: row._id,
        body: row.body, by: row.authorEmail ?? row.authorName, role: row.authorRole, at: row.createdAt,
        resolved: Boolean(row.resolvedAt), version: row.versionId ? versions.get(row.versionId) : undefined,
        ...(await place(row.assetId)),
      });
    }
    events.sort((a, b) => b.at - a.at);
    return {
      feedbackSeenAt: project.feedbackSeenAt,
      counts: {
        likes: verdicts.filter((row) => row.verdict === "like").length,
        dislikes: verdicts.filter((row) => row.verdict === "dislike").length,
        comments: commentRows.length,
      },
      events: events.slice(0, limit),
    };
  },
});

/**
 * Owner: where a gallery frame could go. Lists the projects with folders and
 * styles, and per asset the suggested folder (a folder named like one of the
 * asset's shelves) and style (the world style whose shelf holds it), plus
 * whether it is already in the current or draft round, whether it sits in the
 * project's world, and its thumbnail. Per project also the current round's
 * label and the draft's (or the next one's).
 */
export const promoteTargets = signedOwnerQuery({
  args: { ownerUserId: v.optional(v.string()), assetIds: v.optional(v.array(v.id("assets"))) },
  returns: v.any(),
  handler: async (ctx, args) => {
    const projects = await ctx.db
      .query("reviewProjects")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", args.ownerUserId!))
      .collect();
    const out = [];
    for (const project of projects) {
      const folders = (await foldersOf(ctx, project._id)).filter((row) => !row.archivedAt);
      const styles = [];
      for (const entry of project.styles) {
        const style = await ctx.db.get(entry.styleId);
        if (style) styles.push({ id: style._id, label: entry.label || style.name, name: style.name, shelfFolderId: style.shelfFolderId });
      }
      const suggestions = [];
      for (const assetId of args.assetIds ?? []) {
        const asset = await ctx.db.get(assetId);
        if (!asset || !canActorAccessOwnerUserId(args.ownerUserId!, asset.ownerUserId)) continue;
        const shelfIds = await assetFolderIds(ctx, asset);
        const shelves = (await Promise.all(shelfIds.map((id) => ctx.db.get(id)))).filter(Boolean) as Doc<"folders">[];
        const style = styles.find((row) => row.shelfFolderId && shelfIds.includes(row.shelfFolderId));
        const shelfNames = shelves.map((row) => slugify(row.name));
        const folder = folders.find((row) => shelfNames.includes(row.slug) || shelfNames.some((name) => name.includes(row.slug)));
        const memberships = await ctx.db
          .query("reviewItems")
          .withIndex("by_project_asset", (q) => q.eq("projectId", project._id).eq("assetId", assetId))
          .collect();
        const thumbKey = asset.thumbVariants?.[0]?.r2Key ?? asset.thumbR2Key;
        suggestions.push({
          assetId,
          folderId: folder?._id,
          styleId: style?.id,
          inCurrent: memberships.some((row) => row.versionId === project.currentVersionId),
          inDraft: memberships.some((row) => row.versionId === project.draftVersionId),
          // The frame sits in this project's world (its root or a shelf of it):
          // the gallery's promote palette preselects that project.
          inWorld: Boolean(project.worldFolderId) && shelves.some(
            (row) => row._id === project.worldFolderId || row.parentFolderId === project.worldFolderId,
          ),
          thumb: thumbKey ? buildR2PublicUrl(thumbKey) : undefined,
        });
      }
      const versions = await versionsOf(ctx, project._id);
      const draft = versions.find((row) => row._id === project.draftVersionId);
      out.push({
        slug: project.slug,
        title: project.title,
        worldFolderId: project.worldFolderId,
        hasDraft: Boolean(project.draftVersionId),
        currentLabel: versions.find((row) => row._id === project.currentVersionId)?.label,
        // The draft's label, or the one promoting would give a new draft.
        draftLabel: draft?.label ?? versionLabel((versions[versions.length - 1]?.number ?? 0) + 1),
        folders: folders.map((row) => ({ id: row._id, section: row.section, area: row.area, name: row.name, slug: row.slug })),
        styles: styles.map(({ shelfFolderId: _shelf, ...rest }) => rest),
        suggestions,
      });
    }
    return out;
  },
});

/** Owner: one frame's making-of for the owner lightbox (prompt, style recipe). */
export const itemDetail = query({
  // styleId: the style the frame has in the round on screen (a frame can
  // change style between rounds); without it, the frame's first round.
  args: { slug: v.string(), assetId: v.id("assets"), styleId: v.optional(v.id("worldStyles")) },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { project, viewer } = await requireViewer(ctx, args.slug);
    if (viewer.role !== "owner") return null;
    const asset = await ctx.db.get(args.assetId);
    if (!asset || !canActorAccessOwnerUserId(project.ownerUserId, asset.ownerUserId)) return null;
    const prompt = asset.promptId ? await ctx.db.get(asset.promptId) : null;
    const item = await ctx.db
      .query("reviewItems")
      .withIndex("by_project_asset", (q) => q.eq("projectId", project._id).eq("assetId", args.assetId))
      .first();
    const styleId = args.styleId && project.styles.some((entry) => entry.styleId === args.styleId) ? args.styleId : item?.styleId;
    const style = styleId ? await ctx.db.get(styleId) : null;
    // Names for the frame's --profile codes from the gallery's moodboards and
    // Midjourney profiles, for codes the frame's own metadata left unnamed.
    const codes = new Set((asset.midjourneyMetadata?.personalization ?? []).filter((row) => !row.name).map((row) => row.code));
    for (const match of (prompt?.text ?? "").matchAll(/--(?:profile|p)\s+((?:[^\s-][^\s]*\s*)+)/g)) {
      for (const code of match[1]!.trim().split(/\s+/)) codes.add(code);
    }
    const codeNames: Array<{ code: string; name: string; type: "moodboard" | "profile" }> = [];
    for (const code of [...codes].slice(0, 20)) {
      const board = await ctx.db
        .query("moodboards")
        .withIndex("by_owner_mjCode", (q) => q.eq("ownerUserId", project.ownerUserId).eq("mjCode", code))
        .first();
      if (board) {
        codeNames.push({ code, name: board.name, type: "moodboard" });
        continue;
      }
      const profile = await ctx.db
        .query("mjProfiles")
        .withIndex("by_owner_code", (q) => q.eq("ownerUserId", project.ownerUserId).eq("code", code))
        .first();
      if (profile) codeNames.push({ code, name: profile.name, type: "profile" });
    }
    return {
      assetId: asset._id,
      code: shortCode(asset._id),
      fileName: asset.fileName,
      modelName: asset.modelName,
      sourceUrl: asset.sourceUrl,
      description: asset.agentDescription ?? asset.description,
      prompt: prompt?.text,
      midjourney: asset.midjourneyMetadata,
      codeNames,
      style: style ? { id: style._id, name: style.name, line: style.line, recipes: await styleRecipeSummary(ctx, style) } : null,
      galleryUrl: `https://gallery.laniameda.space/?asset=${asset._id}`,
    };
  },
});

// ---------------------------------------------------------------- style shelves

/**
 * A review style IS a gallery world style: a frame shown in a style must sit
 * on that style's shelf, so the gallery's styles page, MCP (get_style) and
 * the review agree. Files the frames onto their style shelves (and off the
 * style shelf they left), journaled like any world filing so world_undo can
 * revert it. Frames from another world are skipped, never moved.
 */
const syncStyleShelves = async (
  ctx: MutationCtx,
  project: Project,
  moves: Array<{ assetId: Id<"assets">; styleId?: Id<"worldStyles">; previousStyleId?: Id<"worldStyles"> }>,
) => {
  if (!project.worldFolderId || moves.length === 0) return { filed: 0 };
  const shelves = new Map<string, Id<"folders">>();
  for (const entry of project.styles) {
    const style = await ctx.db.get(entry.styleId);
    if (style?.shelfFolderId) shelves.set(entry.styleId, style.shelfFolderId);
  }
  const groups = new Map<string, { addTo?: Id<"folders">; removeFrom?: Id<"folders">; assetIds: Id<"assets">[] }>();
  for (const move of moves) {
    const addTo = move.styleId ? shelves.get(move.styleId) : undefined;
    const removeFrom = move.previousStyleId && move.previousStyleId !== move.styleId ? shelves.get(move.previousStyleId) : undefined;
    if (!addTo && !removeFrom) continue;
    const asset = await ctx.db.get(move.assetId);
    if (!asset) continue;
    const worlds = await worldsOfAsset(ctx, asset);
    if (worlds.size > 0 && !worlds.has(project.worldFolderId)) continue;
    if (addTo && !removeFrom && (await assetFolderIds(ctx, asset)).includes(addTo)) continue;
    const key = `${addTo ?? ""}|${removeFrom ?? ""}`;
    const group = groups.get(key) ?? { addTo, removeFrom, assetIds: [] };
    group.assetIds.push(move.assetId);
    groups.set(key, group);
  }
  let filed = 0;
  for (const group of groups.values()) {
    for (let start = 0; start < group.assetIds.length; start += 100) {
      const result = await fileAssetsInWorld(ctx, {
        ownerUserId: project.ownerUserId,
        world: project.worldFolderId,
        assetIds: group.assetIds.slice(start, start + 100),
        ...(group.addTo ? { addTo: [group.addTo] } : {}),
        ...(group.removeFrom ? { removeFrom: [group.removeFrom] } : {}),
        note: "Kept in step with its style in the director review",
        actor: "review",
        session: `review-${project.slug}`,
      });
      filed += result.changed;
    }
  }
  return { filed };
};

// ---------------------------------------------------------------- owner writes

const resolveVersion = async (ctx: Ctx, project: Project, version?: string) => {
  const versions = await versionsOf(ctx, project._id);
  const wanted = version?.trim().toLowerCase();
  if (!wanted || wanted === "draft") {
    const draft = versions.find((row) => row._id === project.draftVersionId);
    if (draft || wanted === "draft") return draft;
    return versions.find((row) => row._id === project.currentVersionId);
  }
  if (wanted === "current") return versions.find((row) => row._id === project.currentVersionId);
  return versions.find((row) => row._id === wanted || row.label.toLowerCase() === wanted || String(row.number) === wanted);
};

const ensureDraft = async (ctx: MutationCtx, project: Project, fromVersionId?: Id<"reviewVersions">) => {
  if (project.draftVersionId) {
    const existing = await ctx.db.get(project.draftVersionId);
    if (existing) return existing;
  }
  const versions = await versionsOf(ctx, project._id);
  const number = (versions[versions.length - 1]?.number ?? 0) + 1;
  const base = fromVersionId ?? project.currentVersionId;
  const now = Date.now();
  const draftId = await ctx.db.insert("reviewVersions", {
    ownerUserId: project.ownerUserId,
    projectId: project._id,
    number,
    label: versionLabel(number),
    status: "draft",
    basedOnVersionId: base,
    createdAt: now,
  });
  if (base) {
    for (const row of await itemsOf(ctx, base)) {
      await ctx.db.insert("reviewItems", {
        ownerUserId: row.ownerUserId,
        projectId: row.projectId,
        versionId: draftId,
        assetId: row.assetId,
        folderId: row.folderId,
        styleId: row.styleId,
        order: row.order,
        note: row.note,
        previousAssetIds: row.previousAssetIds,
        addedAt: row.addedAt,
      });
    }
  }
  await ctx.db.patch(project._id, { draftVersionId: draftId, updatedAt: now });
  return (await ctx.db.get(draftId))!;
};

const ownerArgs = { ownerUserId: v.optional(v.string()), slug: v.string() };

/** Create or update a review project (first call creates it). */
export const upsertProject = signedOwnerMutation({
  args: {
    ...ownerArgs,
    title: v.optional(v.string()),
    subtitle: v.optional(v.string()),
    worldFolderId: v.optional(v.id("folders")),
    publicUrl: v.optional(v.string()),
    reviewers: v.optional(v.array(v.object({
      email: v.string(), name: v.optional(v.string()),
      role: v.optional(v.union(v.literal("director"), v.literal("viewer"))),
      title: v.optional(v.string()),
    }))),
    ownerEmails: v.optional(v.array(v.string())),
    styles: v.optional(v.array(reviewStyleEntryValidator)),
  },
  returns: v.object({ projectId: v.id("reviewProjects"), created: v.boolean() }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId!;
    const slug = slugify(args.slug);
    const existing = await projectBySlug(ctx, slug);
    if (existing && !canActorAccessOwnerUserId(ownerUserId, existing.ownerUserId)) {
      throw new ConvexError(`The address "${slug}" is taken.`);
    }
    const now = Date.now();
    const cleanEmails = (list: string[]) => {
      const out = [...new Set(list.map(normalizeEmail))];
      for (const email of out) if (!EMAIL.test(email)) throw new ConvexError(`Not an email address: ${email}`);
      return out;
    };
    const reviewers = args.reviewers?.map((row) => {
      const email = normalizeEmail(row.email);
      if (!EMAIL.test(email)) throw new ConvexError(`Not an email address: ${row.email}`);
      const before = existing?.reviewers.find((old) => old.email === email);
      return {
        email,
        name: row.name?.trim() || before?.name,
        pictureUrl: before?.pictureUrl,
        role: row.role ?? before?.role ?? "director",
        title: row.title?.trim() || before?.title,
        addedAt: before?.addedAt ?? now,
        lastSeenAt: before?.lastSeenAt,
      };
    });
    if (args.styles) {
      for (const entry of args.styles) {
        const style = await ctx.db.get(entry.styleId);
        if (!style || !canActorAccessOwnerUserId(ownerUserId, style.ownerUserId)) {
          throw new ConvexError(`Unknown style ${entry.styleId}.`);
        }
      }
    }
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...(args.title !== undefined ? { title: args.title.trim() || existing.title } : {}),
        ...(args.subtitle !== undefined ? { subtitle: args.subtitle.trim() || undefined } : {}),
        ...(args.worldFolderId !== undefined ? { worldFolderId: args.worldFolderId } : {}),
        ...(args.publicUrl !== undefined ? { publicUrl: args.publicUrl.trim() || undefined } : {}),
        ...(reviewers ? { reviewers } : {}),
        ...(args.ownerEmails ? { ownerEmails: cleanEmails(args.ownerEmails) } : {}),
        ...(args.styles ? { styles: args.styles } : {}),
        updatedAt: now,
      });
      return { projectId: existing._id, created: false };
    }
    const projectId = await ctx.db.insert("reviewProjects", {
      ownerUserId,
      slug,
      title: args.title?.trim() || slug.toUpperCase(),
      subtitle: args.subtitle?.trim() || undefined,
      worldFolderId: args.worldFolderId,
      reviewers: reviewers ?? [],
      ownerEmails: cleanEmails(args.ownerEmails ?? []),
      styles: args.styles ?? [],
      publicUrl: args.publicUrl?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    });
    return { projectId, created: true };
  },
});

/** Create or edit a folder (a location, a character, later a scene). */
export const upsertFolder = signedOwnerMutation({
  args: {
    ...ownerArgs,
    folderId: v.optional(v.id("reviewFolders")),
    section: v.optional(reviewSectionValidator),
    area: v.optional(v.string()),
    name: v.optional(v.string()),
    folderSlug: v.optional(v.string()),
    note: v.optional(v.string()),
    scenes: v.optional(v.array(v.number())),
    icon: v.optional(v.string()),
    order: v.optional(v.number()),
    archived: v.optional(v.boolean()),
  },
  returns: v.object({ folderId: v.id("reviewFolders"), created: v.boolean() }),
  handler: async (ctx, args) => {
    const project = await requireOwnedProject(ctx, args.ownerUserId!, args.slug);
    const now = Date.now();
    const all = await foldersOf(ctx, project._id);
    const existing = args.folderId
      ? all.find((row) => row._id === args.folderId)
      : args.folderSlug
        ? all.find((row) => row.slug === slugify(args.folderSlug!) && (!args.section || row.section === args.section))
        : undefined;
    if (args.folderId && !existing) throw new ConvexError("Unknown folder.");
    if (existing) {
      const section = args.section ?? existing.section;
      await ctx.db.patch(existing._id, {
        section,
        ...(args.area !== undefined ? { area: args.area.trim() || undefined } : {}),
        ...(args.name !== undefined ? { name: args.name.trim() || existing.name } : {}),
        ...(args.note !== undefined ? { note: args.note.trim() || undefined } : {}),
        ...(args.scenes !== undefined ? { scenes: args.scenes } : {}),
        ...(args.icon !== undefined ? { icon: args.icon.trim() || undefined } : {}),
        ...(args.order !== undefined ? { order: args.order } : {}),
        ...(args.archived !== undefined ? { archivedAt: args.archived ? now : undefined } : {}),
        updatedAt: now,
      });
      return { folderId: existing._id, created: false };
    }
    if (!args.section || !args.name?.trim()) throw new ConvexError("A new folder needs a section and a name.");
    const slug = slugify(args.folderSlug ?? args.name);
    if (all.some((row) => row.section === args.section && row.slug === slug)) {
      throw new ConvexError(`A ${args.section} folder "${slug}" exists already.`);
    }
    const sameSection = all.filter((row) => row.section === args.section);
    const folderId = await ctx.db.insert("reviewFolders", {
      ownerUserId: project.ownerUserId,
      projectId: project._id,
      section: args.section,
      area: args.area?.trim() || undefined,
      name: args.name.trim(),
      slug,
      note: args.note?.trim() || undefined,
      scenes: args.scenes,
      icon: args.icon?.trim() || undefined,
      order: args.order ?? (sameSection[sameSection.length - 1]?.order ?? 0) + 10,
      createdAt: now,
      updatedAt: now,
    });
    return { folderId, created: true };
  },
});

/** Put a section's folders in this order (others keep theirs, after). */
export const reorderFolders = signedOwnerMutation({
  args: { ...ownerArgs, folderIds: v.array(v.id("reviewFolders")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const project = await requireOwnedProject(ctx, args.ownerUserId!, args.slug);
    let order = 10;
    for (const id of args.folderIds) {
      const row = await ctx.db.get(id);
      if (!row || row.projectId !== project._id) continue;
      await ctx.db.patch(id, { order, updatedAt: Date.now() });
      order += 10;
    }
    return null;
  },
});

const resolveFolder = async (
  ctx: Ctx, project: Project, folderId?: Id<"reviewFolders">, folderSlug?: string,
) => {
  if (folderId) {
    const row = await ctx.db.get(folderId);
    if (!row || row.projectId !== project._id) throw new ConvexError("Unknown folder.");
    return row;
  }
  if (folderSlug) {
    const slug = slugify(folderSlug);
    const row = (await foldersOf(ctx, project._id)).find((folder) => folder.slug === slug || slugify(folder.name) === slug);
    if (!row) throw new ConvexError(`No folder "${folderSlug}".`);
    return row;
  }
  return undefined;
};

const assertProjectStyle = (project: Project, styleId?: Id<"worldStyles">) => {
  if (styleId && !project.styles.some((entry) => entry.styleId === styleId)) {
    throw new ConvexError("That style is not part of this review. Add it to the project's styles first.");
  }
};

/**
 * Promote gallery frames into the draft round (made from the current round
 * when there is none). A frame already in that folder of the draft is updated
 * instead of doubled. Without a style, the world style whose shelf holds the
 * frame is used.
 */
export const promote = signedOwnerMutation({
  args: {
    ...ownerArgs,
    assetIds: v.array(v.id("assets")),
    folderId: v.optional(v.id("reviewFolders")),
    folderSlug: v.optional(v.string()),
    styleId: v.optional(v.id("worldStyles")),
    note: v.optional(v.string()),
  },
  returns: v.object({
    draftVersionId: v.id("reviewVersions"),
    draftLabel: v.string(),
    added: v.number(),
    updated: v.number(),
  }),
  handler: async (ctx, args) => {
    const project = await requireOwnedProject(ctx, args.ownerUserId!, args.slug);
    const folder = await resolveFolder(ctx, project, args.folderId, args.folderSlug);
    if (!folder) throw new ConvexError("Choose a folder to promote into.");
    assertProjectStyle(project, args.styleId);
    const draft = await ensureDraft(ctx, project);
    const shelfStyles = new Map<string, Id<"worldStyles">>();
    for (const entry of project.styles) {
      const style = await ctx.db.get(entry.styleId);
      if (style?.shelfFolderId) shelfStyles.set(style.shelfFolderId, style._id);
    }
    let added = 0;
    let updated = 0;
    let order = Date.now();
    const moves: Array<{ assetId: Id<"assets">; styleId?: Id<"worldStyles">; previousStyleId?: Id<"worldStyles"> }> = [];
    for (const assetId of uniqueIds(args.assetIds)) {
      const asset = await ctx.db.get(assetId);
      if (!asset || !canActorAccessOwnerUserId(project.ownerUserId, asset.ownerUserId)) {
        throw new ConvexError(`Unknown asset ${assetId}.`);
      }
      let styleId = args.styleId;
      if (!styleId) {
        for (const shelfId of await assetFolderIds(ctx, asset)) {
          const match = shelfStyles.get(shelfId);
          if (match) { styleId = match; break; }
        }
      }
      const existing = (await ctx.db
        .query("reviewItems")
        .withIndex("by_version_asset", (q) => q.eq("versionId", draft._id).eq("assetId", assetId))
        .collect()).find((row) => row.folderId === folder._id);
      if (existing) {
        await ctx.db.patch(existing._id, {
          ...(styleId ? { styleId } : {}),
          ...(args.note !== undefined ? { note: args.note.trim() || undefined } : {}),
        });
        if (styleId) moves.push({ assetId, styleId, previousStyleId: existing.styleId });
        updated += 1;
        continue;
      }
      if (styleId) moves.push({ assetId, styleId });
      await ctx.db.insert("reviewItems", {
        ownerUserId: project.ownerUserId,
        projectId: project._id,
        versionId: draft._id,
        assetId,
        folderId: folder._id,
        styleId,
        order: order++,
        note: args.note?.trim() || undefined,
        addedAt: Date.now(),
      });
      added += 1;
    }
    await syncStyleShelves(ctx, project, moves);
    return { draftVersionId: draft._id, draftLabel: draft.label, added, updated };
  },
});

const draftItems = async (ctx: MutationCtx, project: Project, itemIds: Id<"reviewItems">[]) => {
  const draft = await ensureDraft(ctx, project);
  const rows: Doc<"reviewItems">[] = [];
  for (const id of uniqueIds(itemIds)) {
    let row = await ctx.db.get(id);
    if (!row || row.projectId !== project._id) throw new ConvexError(`Unknown item ${id}.`);
    if (row.versionId !== draft._id) {
      // An item of the current round: act on its copy in the draft.
      const source = row;
      row = (await ctx.db
        .query("reviewItems")
        .withIndex("by_version_asset", (q) => q.eq("versionId", draft._id).eq("assetId", source.assetId))
        .collect()).find((copy) => copy.folderId === source.folderId) ?? null;
      if (!row) continue;
    }
    rows.push(row);
  }
  return { draft, rows };
};

/** Move items (draft round) to another folder or style, or set their note. */
export const updateItems = signedOwnerMutation({
  args: {
    ...ownerArgs,
    itemIds: v.array(v.id("reviewItems")),
    folderId: v.optional(v.id("reviewFolders")),
    folderSlug: v.optional(v.string()),
    styleId: v.optional(v.union(v.id("worldStyles"), v.null())),
    note: v.optional(v.string()),
  },
  returns: v.object({ draftLabel: v.string(), changed: v.number() }),
  handler: async (ctx, args) => {
    const project = await requireOwnedProject(ctx, args.ownerUserId!, args.slug);
    const folder = await resolveFolder(ctx, project, args.folderId, args.folderSlug);
    if (args.styleId) assertProjectStyle(project, args.styleId);
    const { draft, rows } = await draftItems(ctx, project, args.itemIds);
    const moves: Array<{ assetId: Id<"assets">; styleId?: Id<"worldStyles">; previousStyleId?: Id<"worldStyles"> }> = [];
    for (const row of rows) {
      await ctx.db.patch(row._id, {
        ...(folder ? { folderId: folder._id } : {}),
        ...(args.styleId !== undefined ? { styleId: args.styleId ?? undefined } : {}),
        ...(args.note !== undefined ? { note: args.note.trim() || undefined } : {}),
      });
      if (args.styleId !== undefined && (args.styleId ?? undefined) !== row.styleId) {
        moves.push({ assetId: row.assetId, styleId: args.styleId ?? undefined, previousStyleId: row.styleId });
      }
    }
    await syncStyleShelves(ctx, project, moves);
    return { draftLabel: draft.label, changed: rows.length };
  },
});

/** Take items out of the draft round (earlier rounds keep them). */
export const removeItems = signedOwnerMutation({
  args: { ...ownerArgs, itemIds: v.array(v.id("reviewItems")) },
  returns: v.object({ draftLabel: v.string(), removed: v.number() }),
  handler: async (ctx, args) => {
    const project = await requireOwnedProject(ctx, args.ownerUserId!, args.slug);
    const { draft, rows } = await draftItems(ctx, project, args.itemIds);
    for (const row of rows) await ctx.db.delete(row._id);
    return { draftLabel: draft.label, removed: rows.length };
  },
});

/** Order items (draft round) as listed. */
export const reorderItems = signedOwnerMutation({
  args: { ...ownerArgs, itemIds: v.array(v.id("reviewItems")) },
  returns: v.object({ draftLabel: v.string() }),
  handler: async (ctx, args) => {
    const project = await requireOwnedProject(ctx, args.ownerUserId!, args.slug);
    const { draft, rows } = await draftItems(ctx, project, args.itemIds);
    let order = 1;
    for (const row of rows) await ctx.db.patch(row._id, { order: order++ });
    return { draftLabel: draft.label };
  },
});

/** Swap a frame for its new take in the draft; the old one is kept as history. */
export const replaceItemAsset = signedOwnerMutation({
  args: { ...ownerArgs, itemId: v.id("reviewItems"), assetId: v.id("assets") },
  returns: v.object({ draftLabel: v.string() }),
  handler: async (ctx, args) => {
    const project = await requireOwnedProject(ctx, args.ownerUserId!, args.slug);
    const asset = await ctx.db.get(args.assetId);
    if (!asset || !canActorAccessOwnerUserId(project.ownerUserId, asset.ownerUserId)) throw new ConvexError("Unknown asset.");
    const { draft, rows } = await draftItems(ctx, project, [args.itemId]);
    const row = rows[0];
    if (!row) throw new ConvexError("That item is not in the draft.");
    if (row.assetId !== args.assetId) {
      await ctx.db.patch(row._id, {
        assetId: args.assetId,
        previousAssetIds: [...(row.previousAssetIds ?? []), row.assetId],
      });
    }
    return { draftLabel: draft.label };
  },
});

/** Start the next round now (a copy of the current one, or of fromVersion). */
export const createDraft = signedOwnerMutation({
  args: { ...ownerArgs, fromVersion: v.optional(v.string()) },
  returns: v.object({ draftVersionId: v.id("reviewVersions"), draftLabel: v.string() }),
  handler: async (ctx, args) => {
    const project = await requireOwnedProject(ctx, args.ownerUserId!, args.slug);
    const from = args.fromVersion ? await resolveVersion(ctx, project, args.fromVersion) : undefined;
    if (args.fromVersion && !from) throw new ConvexError(`No round "${args.fromVersion}".`);
    if (project.draftVersionId && from) throw new ConvexError("A draft round exists already. Publish or discard it first.");
    const draft = await ensureDraft(ctx, project, from?._id);
    return { draftVersionId: draft._id, draftLabel: draft.label };
  },
});

/** Publish the draft: it becomes the round the director sees. */
export const publishDraft = signedOwnerMutation({
  args: { ...ownerArgs, title: v.optional(v.string()), note: v.optional(v.string()), label: v.optional(v.string()) },
  returns: v.object({ versionId: v.id("reviewVersions"), label: v.string(), items: v.number() }),
  handler: async (ctx, args) => {
    const project = await requireOwnedProject(ctx, args.ownerUserId!, args.slug);
    if (!project.draftVersionId) throw new ConvexError("There is no draft round to publish.");
    const draft = await ctx.db.get(project.draftVersionId);
    if (!draft) throw new ConvexError("There is no draft round to publish.");
    const items = (await itemsOf(ctx, draft._id)).length;
    if (items === 0) throw new ConvexError("The draft round is empty.");
    const now = Date.now();
    const label = args.label?.trim() || draft.label;
    await ctx.db.patch(draft._id, {
      status: "published",
      publishedAt: now,
      label,
      ...(args.title !== undefined ? { title: args.title.trim() || undefined } : {}),
      ...(args.note !== undefined ? { note: args.note.trim() || undefined } : {}),
    });
    await ctx.db.patch(project._id, { currentVersionId: draft._id, draftVersionId: undefined, updatedAt: now });
    return { versionId: draft._id, label, items };
  },
});

/** Roll back (or forward): show an earlier published round as the current one. */
export const setCurrentVersion = signedOwnerMutation({
  args: { ...ownerArgs, version: v.string() },
  returns: v.object({ versionId: v.id("reviewVersions"), label: v.string() }),
  handler: async (ctx, args) => {
    const project = await requireOwnedProject(ctx, args.ownerUserId!, args.slug);
    const version = await resolveVersion(ctx, project, args.version);
    if (!version || version.status !== "published") throw new ConvexError(`No published round "${args.version}".`);
    await ctx.db.patch(project._id, { currentVersionId: version._id, updatedAt: Date.now() });
    return { versionId: version._id, label: version.label };
  },
});

/** Throw the draft away (its items go; published rounds are untouched). */
export const discardDraft = signedOwnerMutation({
  args: { ...ownerArgs },
  returns: v.object({ removed: v.number() }),
  handler: async (ctx, args) => {
    const project = await requireOwnedProject(ctx, args.ownerUserId!, args.slug);
    if (!project.draftVersionId) return { removed: 0 };
    const rows = await itemsOf(ctx, project.draftVersionId);
    for (const row of rows) await ctx.db.delete(row._id);
    await ctx.db.delete(project.draftVersionId);
    await ctx.db.patch(project._id, { draftVersionId: undefined, updatedAt: Date.now() });
    return { removed: rows.length };
  },
});

/** Owner or agent reply on frames (agents pass author "agent"). */
export const ownerComment = signedOwnerMutation({
  args: {
    ...ownerArgs,
    assetIds: v.array(v.id("assets")),
    body: v.string(),
    author: v.optional(v.union(v.literal("owner"), v.literal("agent"))),
  },
  returns: v.object({ added: v.number() }),
  handler: async (ctx, args) => {
    const project = await requireOwnedProject(ctx, args.ownerUserId!, args.slug);
    const body = args.body.trim();
    if (!body) throw new ConvexError("Write a comment first.");
    if (body.length > COMMENT_MAX) throw new ConvexError(`At most ${COMMENT_MAX} characters.`);
    const now = Date.now();
    const ids = uniqueIds(args.assetIds);
    for (const assetId of ids) {
      await assertInProject(ctx, project._id, assetId);
      await ctx.db.insert("reviewComments", {
        projectId: project._id,
        assetId,
        versionId: project.currentVersionId,
        authorName: args.author === "agent" ? "Studio agent" : "Michael",
        authorRole: args.author ?? "owner",
        body,
        createdAt: now,
        updatedAt: now,
      });
    }
    return { added: ids.length };
  },
});

/** Owner or agent: resolve or reopen a comment by id. */
export const ownerResolveComment = signedOwnerMutation({
  args: { ...ownerArgs, commentId: v.id("reviewComments"), resolved: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const project = await requireOwnedProject(ctx, args.ownerUserId!, args.slug);
    const row = await ctx.db.get(args.commentId);
    if (!row || row.projectId !== project._id) throw new ConvexError("Unknown comment.");
    await ctx.db.patch(row._id, { resolvedAt: args.resolved ? Date.now() : undefined, updatedAt: Date.now() });
    return null;
  },
});

/** Delete a folder that holds no frame in any round (else archive it instead). */
export const deleteFolder = signedOwnerMutation({
  args: { ...ownerArgs, folderId: v.id("reviewFolders") },
  returns: v.object({ deleted: v.boolean() }),
  handler: async (ctx, args) => {
    const project = await requireOwnedProject(ctx, args.ownerUserId!, args.slug);
    const folder = await ctx.db.get(args.folderId);
    if (!folder || folder.projectId !== project._id) throw new ConvexError("Unknown folder.");
    for (const version of await versionsOf(ctx, project._id)) {
      const used = (await itemsOf(ctx, version._id)).some((row) => row.folderId === folder._id);
      if (used) throw new ConvexError(`"${folder.name}" holds frames in ${version.label}; archive it instead.`);
    }
    await ctx.db.delete(folder._id);
    return { deleted: true };
  },
});

// ---------------------------------------------------------------- review page helpers

/**
 * The signed-out screen: the project title and one frame of the current
 * round, nothing else. Public on purpose (the sign-in page shows it).
 */
export const signInCard = query({
  args: { slug: v.string() },
  returns: v.union(v.null(), v.object({
    title: v.string(),
    subtitle: v.optional(v.string()),
    mediaBase: v.string(),
    cover: v.optional(v.object({ src: v.string(), w: v.number(), h: v.number() })),
  })),
  handler: async (ctx, args) => {
    const project = await projectBySlug(ctx, args.slug);
    if (!project) return null;
    // No frame here any more: this query is public, and unreleased frames
    // must not reach signed-out callers. The preview behind the sign-in
    // comes from signInTeaser, which only the review page's server can read.
    const cover: { src: string; w: number; h: number } | undefined = undefined;
    if (false as boolean) {
      const first = await ctx.db
        .query("reviewItems")
        .withIndex("by_version_order", (q) => q.eq("versionId", project.currentVersionId!))
        .first();
      const asset = first ? await ctx.db.get(first.assetId) : null;
      if (asset && asset.kind === "image") {
        const media = await mediaOf(ctx, asset);
        const thumb = media.thumbs.find((row) => row.w >= 1400) ?? media.thumbs[media.thumbs.length - 1];
        void thumb;
      }
    }
    return { title: project.title, subtitle: project.subtitle, mediaBase: mediaBase(), cover };
  },
});

const TEASER_FRAMES = 30;

/**
 * The signed-out preview: the real layout of the current round (folders in
 * order with icons and counts, style labels, the first frames) for the
 * blurred view behind the sign-in. Only the review page's server may read it
 * (sub "teaser:<slug>", or anyone who may open the project); the server turns
 * each frame into a tiny blurred thumbnail before the page gets it.
 */
export const signInTeaser = query({
  args: { slug: v.string() },
  returns: v.union(v.null(), v.object({
    title: v.string(),
    subtitle: v.optional(v.string()),
    mediaBase: v.string(),
    round: v.optional(v.object({ label: v.string(), title: v.optional(v.string()), publishedAt: v.optional(v.number()) })),
    folders: v.array(v.object({
      section: reviewSectionValidator, area: v.optional(v.string()), name: v.string(),
      icon: v.optional(v.string()), count: v.number(),
    })),
    styles: v.array(v.object({ label: v.string(), count: v.number() })),
    frames: v.array(v.object({ src: v.string(), w: v.number(), h: v.number(), folder: v.string(), style: v.optional(v.string()) })),
  })),
  handler: async (ctx, args) => {
    const project = await projectBySlug(ctx, args.slug);
    if (!project) return null;
    const subject = (await identityOf(ctx))?.subject?.trim() ?? "";
    const allowed = subject === `${TEASER_SUBJECT_PREFIX}${project.slug}` || Boolean(await resolveViewer(ctx, project));
    if (!allowed) return null;
    const version = project.currentVersionId ? await ctx.db.get(project.currentVersionId) : null;
    const rows = version && version.status === "published" ? await itemsOf(ctx, version._id) : [];
    const folders = (await foldersOf(ctx, project._id)).filter((row) => !row.archivedAt);
    const folderIndex = new Map(folders.map((row, index) => [row._id as string, index]));
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.folderId, (counts.get(row.folderId) ?? 0) + 1);
    const styleLabels = new Map<string, string>();
    const styleIndex = new Map<string, number>();
    for (const [index, entry] of project.styles.entries()) {
      if (entry.hidden) continue;
      const style = await ctx.db.get(entry.styleId);
      if (style) { styleLabels.set(entry.styleId, entry.label?.trim() || style.name); styleIndex.set(entry.styleId, index); }
    }
    const styleCounts = new Map<string, number>();
    for (const row of rows) if (row.styleId) styleCounts.set(row.styleId, (styleCounts.get(row.styleId) ?? 0) + 1);
    const ordered = [...rows]
      .filter((row) => folderIndex.has(row.folderId))
      .sort((a, b) =>
        (folderIndex.get(a.folderId)! - folderIndex.get(b.folderId)!)
        || ((a.styleId ? styleIndex.get(a.styleId) ?? 99 : 99) - (b.styleId ? styleIndex.get(b.styleId) ?? 99 : 99))
        || a.order - b.order);
    const frames = [];
    for (const row of ordered) {
      if (frames.length >= TEASER_FRAMES) break;
      const asset = await ctx.db.get(row.assetId);
      if (!asset) continue;
      const media = await mediaOf(ctx, asset);
      const thumb = media.thumbs[0];
      if (!thumb) continue;
      frames.push({
        src: thumb.src, w: media.width, h: media.height,
        folder: folders[folderIndex.get(row.folderId)!]!.name,
        style: row.styleId ? styleLabels.get(row.styleId) : undefined,
      });
    }
    return {
      title: project.title,
      subtitle: project.subtitle,
      mediaBase: mediaBase(),
      round: version && version.status === "published"
        ? { label: version.label, title: version.title, publishedAt: version.publishedAt }
        : undefined,
      folders: folders.map((row) => ({
        section: row.section, area: row.area, name: row.name, icon: row.icon, count: counts.get(row._id) ?? 0,
      })),
      styles: [...styleLabels.entries()].map(([id, label]) => ({ label, count: styleCounts.get(id) ?? 0 })),
      frames,
    };
  },
});

/**
 * Download route: the originals of frames the caller may see (a reviewer only
 * frames of published rounds), with the folder and style for the file name.
 */
export const downloadList = query({
  args: { slug: v.string(), assetIds: v.array(v.id("assets")) },
  returns: v.union(v.null(), v.array(v.object({
    assetId: v.id("assets"),
    code: v.string(),
    folder: v.optional(v.string()),
    style: v.optional(v.string()),
    url: v.optional(v.string()),
  }))),
  handler: async (ctx, args) => {
    const project = await projectBySlug(ctx, args.slug);
    if (!project) return null;
    const viewer = await resolveViewer(ctx, project);
    if (!viewer) return null;
    const ids = uniqueIds(args.assetIds);
    const versions = new Map((await versionsOf(ctx, project._id)).map((row) => [row._id as string, row]));
    const folders = new Map((await foldersOf(ctx, project._id)).map((row) => [row._id as string, row]));
    const styleLabels = new Map<string, string>();
    for (const entry of project.styles) {
      const style = await ctx.db.get(entry.styleId);
      if (style) styleLabels.set(entry.styleId, entry.label?.trim() || style.name);
    }
    const base = mediaBase();
    const out = [];
    for (const assetId of ids) {
      const rows = (await ctx.db
        .query("reviewItems")
        .withIndex("by_project_asset", (q) => q.eq("projectId", project._id).eq("assetId", assetId))
        .collect())
        .filter((row) => viewer.role === "owner" || versions.get(row.versionId)?.status === "published");
      const row = rows[rows.length - 1];
      if (!row) continue;
      const asset = await ctx.db.get(assetId);
      if (!asset) continue;
      const key = await ref(ctx, asset.r2Key, asset.storageId, asset.sourceUrl);
      out.push({
        assetId,
        code: shortCode(assetId),
        folder: folders.get(row.folderId)?.slug,
        style: row.styleId ? styleLabels.get(row.styleId) : undefined,
        url: key ? (/^https?:\/\//.test(key) ? key : `${base}/${key}`) : undefined,
      });
    }
    return out;
  },
});

/**
 * Put every frame of the current and draft rounds on its style's shelf in the
 * gallery (journaled; world_undo reverts). Safe to run again.
 */
export const syncStyles = signedOwnerMutation({
  args: { ...ownerArgs },
  returns: v.object({ checked: v.number(), filed: v.number() }),
  handler: async (ctx, args) => {
    const project = await requireOwnedProject(ctx, args.ownerUserId!, args.slug);
    const seen = new Set<string>();
    const moves: Array<{ assetId: Id<"assets">; styleId?: Id<"worldStyles"> }> = [];
    for (const versionId of [project.currentVersionId, project.draftVersionId]) {
      if (!versionId) continue;
      for (const row of await itemsOf(ctx, versionId)) {
        if (!row.styleId || seen.has(`${row.assetId}:${row.styleId}`)) continue;
        seen.add(`${row.assetId}:${row.styleId}`);
        moves.push({ assetId: row.assetId, styleId: row.styleId });
      }
    }
    const { filed } = await syncStyleShelves(ctx, project, moves);
    return { checked: moves.length, filed };
  },
});
/**
 * Correct the style of frames in any round, published ones included (a
 * mislabelled style is a correction, not new content). Keeps the gallery's
 * style shelves in step. Frames by asset id; every copy in that round moves.
 */
export const restyleInRound = signedOwnerMutation({
  args: { ...ownerArgs, version: v.string(), assetIds: v.array(v.id("assets")), styleId: v.id("worldStyles") },
  returns: v.object({ round: v.string(), changed: v.number() }),
  handler: async (ctx, args) => {
    const project = await requireOwnedProject(ctx, args.ownerUserId!, args.slug);
    assertProjectStyle(project, args.styleId);
    const version = await resolveVersion(ctx, project, args.version);
    if (!version) throw new ConvexError(`No round "${args.version}".`);
    const wanted = new Set<string>(args.assetIds);
    const moves: Array<{ assetId: Id<"assets">; styleId?: Id<"worldStyles">; previousStyleId?: Id<"worldStyles"> }> = [];
    let changed = 0;
    for (const row of await itemsOf(ctx, version._id)) {
      if (!wanted.has(row.assetId) || row.styleId === args.styleId) continue;
      await ctx.db.patch(row._id, { styleId: args.styleId });
      moves.push({ assetId: row.assetId, styleId: args.styleId, previousStyleId: row.styleId });
      changed += 1;
    }
    await syncStyleShelves(ctx, project, moves);
    return { round: version.label, changed };
  },
});

/**
 * Remove a style from a round: every frame shown in that style leaves the
 * round (default the draft, made from the current round when there is none;
 * "current" or a label corrects a published round). With dropFromCarousel the
 * style also leaves the project's carousel. The gallery's world style and its
 * frames are untouched.
 */
export const removeStyle = signedOwnerMutation({
  args: {
    ...ownerArgs,
    styleId: v.id("worldStyles"),
    version: v.optional(v.string()),
    dropFromCarousel: v.optional(v.boolean()),
  },
  returns: v.object({ round: v.string(), removed: v.number() }),
  handler: async (ctx, args) => {
    const project = await requireOwnedProject(ctx, args.ownerUserId!, args.slug);
    const version = args.version && args.version !== "draft"
      ? await resolveVersion(ctx, project, args.version)
      : await ensureDraft(ctx, project);
    if (!version) throw new ConvexError(`No round "${args.version}".`);
    let removed = 0;
    for (const row of await itemsOf(ctx, version._id)) {
      if (row.styleId !== args.styleId) continue;
      await ctx.db.delete(row._id);
      removed += 1;
    }
    if (args.dropFromCarousel) {
      // Hidden, not deleted: rounds that still use the style keep its label
      // and place in the carousel; rounds without its frames never show it.
      await ctx.db.patch(project._id, {
        styles: project.styles.map((entry) => (entry.styleId === args.styleId ? { ...entry, hidden: true } : entry)),
        updatedAt: Date.now(),
      });
    }
    return { round: version.label, removed };
  },
});
