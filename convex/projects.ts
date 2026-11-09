import { ConvexError, v, type Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { signedOwnerMutation as ownerMutation, signedOwnerQuery as ownerQuery } from "./actor";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import { collectAssetsForFolderTree } from "./assets";
import { buildR2PublicUrl, resolveAssetThumbUrl, resolveAssetUrl } from "./r2_url";
import { childrenOf, recordWorldChange, resolveWorld } from "./worldCore";
import {
  ART_DIRECTOR_SCOPE, BRIEF_LIMITS, briefFileValidator, briefKindValidator,
  projectDetailsValidator, projectPersonValidator,
} from "./projectValidators";

// A project is a world with project details: CASSANDRA, the animated feature
// for Sula Entertainment that Michael art-directs. This module serves the
// project page (/w/<world>/project) and the project_* agent tools: the world,
// its art-director shelves, the director review(s), the inspiration for it
// and the production briefs (what the director or producers sent, by whom,
// when and why, with its private files and its pictures).
//
// Everything here is owner-only (signed owner queries and mutations). The
// director review and the public world page never read these tables
// (Michael, 9 Nov 2026: the project is the art director's scope first).

type Ctx = QueryCtx | MutationCtx;
type Brief = Doc<"productionBriefs">;
type Folder = Doc<"folders">;

const ACTOR = "project";
// Convex storage keeps sha256 as base64; briefs keep hex.
const base64ToHex = (value: string) => Array.from(atob(value), (char) => char.charCodeAt(0).toString(16).padStart(2, "0")).join("");
const owned = <T extends { ownerUserId?: string }>(owner: string, row: T | null): row is T =>
  Boolean(row && canActorAccessOwnerUserId(owner, row.ownerUserId ?? ""));
const clip = (value: string | undefined, max: number) => value?.trim().slice(0, max) || undefined;
const journalArgs = { actor: v.optional(v.string()), session: v.optional(v.string()) };

/* ── Pictures ───────────────────────────────────────────────────────────── */

const pictureValidator = v.object({
  assetId: v.id("assets"),
  kind: v.union(v.literal("image"), v.literal("video")),
  thumbUrl: v.optional(v.string()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
});
type Picture = Infer<typeof pictureValidator>;

const smallThumb = (asset: Doc<"assets">) => {
  const small = [...(asset.thumbVariants ?? [])].sort((a, b) => a.width - b.width)[0];
  return small ? buildR2PublicUrl(small.r2Key) : undefined;
};

const pictureOf = async (ctx: Ctx, asset: Doc<"assets">): Promise<Picture> => ({
  assetId: asset._id,
  kind: asset.kind === "video" ? "video" : "image",
  thumbUrl: smallThumb(asset) ?? await resolveAssetThumbUrl(ctx, asset) ?? undefined,
  width: asset.thumbWidth ?? asset.width,
  height: asset.thumbHeight ?? asset.height,
});

const picturesOf = async (ctx: Ctx, owner: string, ids: Id<"assets">[], limit: number) => {
  const out: Picture[] = [];
  for (const id of ids) {
    if (out.length >= limit) break;
    const asset = await ctx.db.get(id);
    if (owned(owner, asset)) out.push(await pictureOf(ctx, asset));
  }
  return out;
};

/* ── Briefs: shape and search text ──────────────────────────────────────── */

const fileMetaValidator = v.object({
  key: v.string(), name: v.string(), contentType: v.string(), size: v.number(),
  pages: v.optional(v.number()), hasCover: v.boolean(),
  // The owner-only address of the bytes (session cookie or agent token).
  url: v.string(), coverUrl: v.optional(v.string()),
});

const briefCardValidator = v.object({
  id: v.id("productionBriefs"), ingestKey: v.string(), title: v.string(), kind: briefKindValidator,
  from: v.optional(v.string()), receivedAt: v.optional(v.number()), note: v.optional(v.string()),
  topics: v.array(v.string()), reviewFolders: v.array(v.string()),
  assetCount: v.number(), groups: v.array(v.object({ label: v.string(), count: v.number() })),
  files: v.array(fileMetaValidator), previews: v.array(pictureValidator),
  revision: v.number(), createdBy: v.string(), updatedAt: v.number(),
});

export const briefFilePath = (briefId: string, key: string, cover = false) =>
  `/api/briefs/${briefId}/files/${encodeURIComponent(key)}${cover ? "?cover=1" : ""}`;

const filesOf = (brief: Brief) => brief.files.map((file) => ({
  key: file.key, name: file.name, contentType: file.contentType, size: file.size, pages: file.pages,
  hasCover: Boolean(file.coverStorageId),
  url: briefFilePath(brief._id, file.key), coverUrl: file.coverStorageId ? briefFilePath(brief._id, file.key, true) : undefined,
}));

const cardOf = async (ctx: Ctx, owner: string, brief: Brief, previewCount: number) => ({
  id: brief._id, ingestKey: brief.ingestKey, title: brief.title, kind: brief.kind,
  from: brief.from, receivedAt: brief.receivedAt, note: brief.note,
  topics: brief.topics, reviewFolders: brief.reviewFolders,
  assetCount: brief.assetIds.length,
  groups: (brief.groups ?? []).map((group) => ({ label: group.label, count: group.assetIds.length })),
  files: filesOf(brief),
  previews: await picturesOf(ctx, owner, brief.assetIds, previewCount),
  revision: brief.revision, createdBy: brief.createdBy, updatedAt: brief.updatedAt,
});

const searchTextOf = (brief: Pick<Brief, "title" | "kind" | "from" | "note" | "topics" | "reviewFolders" | "files" | "groups">) =>
  [brief.title, brief.kind.replace("_", " "), brief.from, brief.note, ...brief.topics, ...brief.reviewFolders,
    ...brief.files.map((file) => file.name), ...(brief.groups ?? []).map((group) => group.label)]
    .filter(Boolean).join(" \n").slice(0, 16_000);

const briefsOfWorld = async (ctx: Ctx, owner: string, worldId: Id<"folders">) => {
  const rows: Brief[] = [];
  for (const candidate of resolveUserIdCandidates(owner)) {
    rows.push(...await ctx.db.query("productionBriefs")
      .withIndex("by_owner_world_updatedAt", (q) => q.eq("ownerUserId", candidate).eq("worldFolderId", worldId))
      .order("desc").take(200));
  }
  // Newest received first; briefs without a date after, newest saved first.
  return rows.sort((a, b) => (b.receivedAt ?? 0) - (a.receivedAt ?? 0) || b.updatedAt - a.updatedAt);
};

const resolveBrief = async (ctx: Ctx, owner: string, ref: string): Promise<Brief> => {
  const value = ref.trim().replace(/^brief:/, "");
  const id = ctx.db.normalizeId("productionBriefs", value);
  if (id) {
    const row = await ctx.db.get(id);
    if (owned(owner, row)) return row;
  }
  for (const candidate of resolveUserIdCandidates(owner)) {
    const row = await ctx.db.query("productionBriefs").withIndex("by_owner_ingestKey", (q) => q.eq("ownerUserId", candidate).eq("ingestKey", value)).first();
    if (row) return row;
  }
  throw new ConvexError(`No production brief "${ref}". project_open lists a project's briefs.`);
};

/* ── The project page ───────────────────────────────────────────────────── */

const reviewSummaryValidator = v.object({
  slug: v.string(), title: v.string(), subtitle: v.optional(v.string()), publicUrl: v.optional(v.string()),
  current: v.optional(v.object({ label: v.string(), title: v.optional(v.string()), frames: v.number(), publishedAt: v.optional(v.number()) })),
  draft: v.optional(v.object({ label: v.string(), frames: v.number() })),
  folders: v.number(),
  reviewers: v.array(v.object({ name: v.string(), title: v.optional(v.string()), lastSeenAt: v.optional(v.number()) })),
  // Reviewer likes, dislikes and comments since Michael last marked them read.
  unread: v.number(),
});

const shelfCardValidator = v.object({
  id: v.id("folders"), name: v.string(), group: v.optional(v.string()), count: v.number(),
  artDirector: v.boolean(), previews: v.array(pictureValidator),
});

const projectValidator = v.object({
  world: v.object({
    id: v.id("folders"), key: v.string(), name: v.string(), description: v.optional(v.string()),
    cover: v.optional(pictureValidator), memberCount: v.number(),
  }),
  details: v.union(v.null(), projectDetailsValidator),
  isProject: v.boolean(),
  styles: v.number(),
  shelves: v.array(shelfCardValidator),
  reviews: v.array(reviewSummaryValidator),
  briefs: v.array(briefCardValidator),
});

const reviewsOfWorld = async (ctx: Ctx, owner: string, root: Folder) => {
  const slugs = new Set(root.project?.reviewSlugs ?? []);
  const projects: Doc<"reviewProjects">[] = [];
  for (const candidate of resolveUserIdCandidates(owner)) {
    for (const row of await ctx.db.query("reviewProjects").withIndex("by_owner", (q) => q.eq("ownerUserId", candidate)).take(50)) {
      if (row.worldFolderId === root._id || slugs.has(row.slug)) projects.push(row);
    }
  }
  const out = [];
  for (const project of projects) {
    const versions = await ctx.db.query("reviewVersions").withIndex("by_project_number", (q) => q.eq("projectId", project._id)).collect();
    const count = async (versionId: Id<"reviewVersions">) =>
      (await ctx.db.query("reviewItems").withIndex("by_version_order", (q) => q.eq("versionId", versionId)).take(1000)).length;
    const current = versions.find((row) => row._id === project.currentVersionId);
    const draft = versions.find((row) => row._id === project.draftVersionId);
    const seen = project.feedbackSeenAt ?? 0;
    const verdicts = await ctx.db.query("reviewFeedback").withIndex("by_project_updatedAt", (q) => q.eq("projectId", project._id).gt("updatedAt", seen)).take(200);
    const comments = await ctx.db.query("reviewComments").withIndex("by_project_createdAt", (q) => q.eq("projectId", project._id).gt("createdAt", seen)).take(200);
    const folders = await ctx.db.query("reviewFolders").withIndex("by_project_section_order", (q) => q.eq("projectId", project._id)).take(200);
    out.push({
      slug: project.slug, title: project.title, subtitle: project.subtitle, publicUrl: project.publicUrl,
      current: current ? { label: current.label, title: current.title, frames: await count(current._id), publishedAt: current.publishedAt } : undefined,
      draft: draft ? { label: draft.label, frames: await count(draft._id) } : undefined,
      folders: folders.filter((row) => !row.archivedAt).length,
      reviewers: project.reviewers.map((row) => ({ name: row.name ?? row.email.split("@")[0]!, title: row.title, lastSeenAt: row.lastSeenAt })),
      unread: verdicts.filter((row) => row.role !== "owner").length
        + comments.filter((row) => row.authorRole === "director" || row.authorRole === "viewer").length,
    });
  }
  return out;
};

export const getProject = ownerQuery({
  args: { ownerUserId: v.string(), world: v.string() },
  returns: projectValidator,
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const root = await resolveWorld(ctx, owner, args.world);
    if (!owned(owner, root)) throw new ConvexError("World not found.");
    const children = (await childrenOf(ctx, root._id)).filter((child) => owned(owner, child) && child.kind !== "storybook");
    // Art-director shelves first (the project's own working space), then the rest by group.
    const shelves = [];
    for (const child of children.sort((a, b) => Number(b.scope === ART_DIRECTOR_SCOPE) - Number(a.scope === ART_DIRECTOR_SCOPE)
      || (a.sortOrder ?? 1e9) - (b.sortOrder ?? 1e9) || a.name.localeCompare(b.name))) {
      const artDirector = child.scope === ART_DIRECTOR_SCOPE;
      let previews: Picture[] = [];
      if (artDirector) {
        const links = await ctx.db.query("assetFolders").withIndex("by_folder_createdAt", (q) => q.eq("folderId", child._id)).order("desc").take(6);
        previews = await picturesOf(ctx, owner, links.map((link) => link.assetId), 6);
      }
      shelves.push({ id: child._id, name: child.name, group: child.group, count: child.memberCount ?? 0, artDirector, previews });
    }
    let styles = 0;
    for (const candidate of resolveUserIdCandidates(owner)) {
      const rows = await ctx.db.query("worldStyles").withIndex("by_owner_world_slug", (q) => q.eq("ownerUserId", candidate).eq("worldFolderId", root._id)).take(200);
      styles += rows.filter((row) => row.status !== "archived" && row.status !== "merged").length;
    }
    const cover = root.coverAssetId ? await ctx.db.get(root.coverAssetId) : null;
    const briefs = [];
    for (const brief of await briefsOfWorld(ctx, owner, root._id)) briefs.push(await cardOf(ctx, owner, brief, 8));
    return {
      world: {
        id: root._id, key: root.worldKey ?? "", name: root.name, description: root.description,
        cover: owned(owner, cover) ? await pictureOf(ctx, cover) : undefined, memberCount: root.memberCount ?? 0,
      },
      details: root.project ?? null,
      isProject: Boolean(root.project),
      styles, shelves,
      reviews: await reviewsOfWorld(ctx, owner, root),
      briefs,
    };
  },
});

/**
 * The project's inspiration: inspiration pieces filed in the world (outside
 * references) that are not part of a brief, and inspiration-library takes made
 * for this project. Its own subscription: the page asks after the first screen.
 */
export const projectInspiration = ownerQuery({
  args: { ownerUserId: v.string(), world: v.string(), limit: v.optional(v.number()) },
  returns: v.object({
    pieces: v.array(pictureValidator),
    total: v.number(),
    takes: v.array(v.object({ sourceId: v.id("inspirationSources"), adaptationId: v.id("inspirationAdaptations"), title: v.string(), intendedUse: v.string(), status: v.string(), lead: v.optional(pictureValidator) })),
  }),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const root = await resolveWorld(ctx, owner, args.world);
    const limit = Math.min(Math.max(args.limit ?? 36, 1), 120);
    const inspirationTags = new Set<string>();
    for (const name of ["inspiration", "inspirations"]) {
      const tag = await ctx.db.query("tags").withIndex("by_normalized", (q) => q.eq("normalized", name)).first();
      if (tag) inspirationTags.add(tag._id);
    }
    const inBriefs = new Set<string>();
    for (const brief of await briefsOfWorld(ctx, owner, root._id)) for (const id of brief.assetIds) inBriefs.add(id);
    const members = await collectAssetsForFolderTree(ctx, resolveUserIdCandidates(owner), root._id, 600);
    const matching = members.filter((asset) => !inBriefs.has(asset._id) && asset.tagIds.some((id) => inspirationTags.has(id)));
    const pieces = [];
    for (const asset of matching.slice(0, limit)) pieces.push(await pictureOf(ctx, asset));
    const takes = [];
    for (const candidate of resolveUserIdCandidates(owner)) {
      for (const status of ["proposed", "ready", "changes_requested", "approved", "blocked"] as const) {
        const rows = await ctx.db.query("inspirationAdaptations")
          .withIndex("by_owner_status_updatedAt", (q) => q.eq("ownerUserId", candidate).eq("status", status)).order("desc").take(200);
        for (const row of rows) {
          if (row.targetWorldId !== root._id) continue;
          const source = await ctx.db.get(row.sourceId);
          if (!source) continue;
          const lead = source.assetIds[0] ? await ctx.db.get(source.assetIds[0]) : null;
          takes.push({ sourceId: source._id, adaptationId: row._id, title: source.title, intendedUse: row.intendedUse, status: row.status, lead: owned(owner, lead) ? await pictureOf(ctx, lead) : undefined });
        }
      }
    }
    return { pieces, total: matching.length, takes: takes.slice(0, 48) };
  },
});

/* ── Briefs for agents ──────────────────────────────────────────────────── */

const briefAssetValidator = v.object({
  assetId: v.id("assets"), kind: v.string(), thumbUrl: v.optional(v.string()), url: v.optional(v.string()),
  width: v.optional(v.number()), height: v.optional(v.number()),
  description: v.optional(v.string()), agentDescription: v.optional(v.string()),
  fileName: v.optional(v.string()), sourceUrl: v.optional(v.string()), group: v.optional(v.string()),
});

const briefDetailValidator = v.object({
  ...briefCardValidator.fields,
  world: v.object({ id: v.id("folders"), key: v.string(), name: v.string() }),
  assets: v.array(briefAssetValidator),
});

const detailOf = async (ctx: Ctx, owner: string, brief: Brief) => {
  const world = await ctx.db.get(brief.worldFolderId);
  const groupOf = new Map<string, string>();
  for (const group of brief.groups ?? []) for (const id of group.assetIds) if (!groupOf.has(id)) groupOf.set(id, group.label);
  const assets = [];
  for (const id of brief.assetIds) {
    const asset = await ctx.db.get(id);
    if (!owned(owner, asset)) continue;
    assets.push({
      assetId: asset._id, kind: asset.kind, thumbUrl: smallThumb(asset) ?? await resolveAssetThumbUrl(ctx, asset) ?? undefined,
      url: await resolveAssetUrl(ctx, asset) ?? undefined, width: asset.width, height: asset.height,
      description: asset.description, agentDescription: asset.agentDescription, fileName: asset.fileName, sourceUrl: asset.sourceUrl,
      group: groupOf.get(asset._id),
    });
  }
  return {
    ...(await cardOf(ctx, owner, brief, 0)),
    world: { id: brief.worldFolderId, key: world?.worldKey ?? "", name: world?.name ?? "" },
    assets,
  };
};

/** Find briefs: a project's, or by words ("school brief"), or one brief whole. */
export const findBriefs = ownerQuery({
  args: { ownerUserId: v.string(), world: v.optional(v.string()), query: v.optional(v.string()), brief: v.optional(v.string()), limit: v.optional(v.number()) },
  returns: v.array(briefDetailValidator),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    if (args.brief) return [await detailOf(ctx, owner, await resolveBrief(ctx, owner, args.brief))];
    const limit = Math.min(Math.max(args.limit ?? 10, 1), 30);
    const root = args.world ? await resolveWorld(ctx, owner, args.world) : null;
    const text = args.query?.trim();
    let rows: Brief[] = [];
    if (text) {
      for (const candidate of resolveUserIdCandidates(owner)) {
        rows.push(...await ctx.db.query("productionBriefs").withSearchIndex("search_text", (q) => {
          const base = q.search("searchText", text).eq("ownerUserId", candidate);
          return root ? base.eq("worldFolderId", root._id) : base;
        }).take(limit));
      }
    } else if (root) {
      rows = await briefsOfWorld(ctx, owner, root._id);
    } else {
      throw new ConvexError("Give world (a project), query (words like \"school brief\") or brief (an id or ingestKey).");
    }
    const out = [];
    for (const brief of rows.slice(0, limit)) out.push(await detailOf(ctx, owner, brief));
    return out;
  },
});

/* ── Writes ─────────────────────────────────────────────────────────────── */

export type BriefSnapshot = Omit<Brief, "_id" | "_creationTime"> & { briefId: Id<"productionBriefs"> };
const snapshot = (brief: Brief): BriefSnapshot => {
  const { _id, _creationTime, ...rest } = brief;
  void _creationTime;
  return { ...rest, briefId: _id };
};

const assertAssets = async (ctx: Ctx, owner: string, ids: ReadonlyArray<string>) => {
  const out: Id<"assets">[] = [];
  for (const raw of ids) {
    const id = ctx.db.normalizeId("assets", raw.trim().replace(/^asset:/, ""));
    const asset = id ? await ctx.db.get(id) : null;
    if (!owned(owner, asset)) throw new ConvexError(`Unknown asset "${raw}".`);
    if (!out.includes(asset._id)) out.push(asset._id);
  }
  return out;
};

export const saveBrief = ownerMutation({
  args: {
    ownerUserId: v.string(),
    world: v.string(),
    ingestKey: v.string(),
    title: v.optional(v.string()),
    kind: v.optional(briefKindValidator),
    from: v.optional(v.union(v.string(), v.null())),
    receivedAt: v.optional(v.union(v.number(), v.null())),
    note: v.optional(v.union(v.string(), v.null())),
    topics: v.optional(v.array(v.string())),
    reviewFolders: v.optional(v.array(v.string())),
    // Replace the picture list, or add to it (kept in order, each once).
    assetIds: v.optional(v.array(v.string())),
    addAssetIds: v.optional(v.array(v.string())),
    groups: v.optional(v.array(v.object({ label: v.string(), assetIds: v.array(v.string()) }))),
    expectedRevision: v.optional(v.number()),
    ...journalArgs,
  },
  returns: v.object({ briefId: v.id("productionBriefs"), created: v.boolean(), changed: v.boolean(), revision: v.number(), changeId: v.union(v.null(), v.id("worldChanges")) }),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const root = await resolveWorld(ctx, owner, args.world);
    const ingestKey = args.ingestKey.trim().slice(0, 200);
    if (!ingestKey) throw new ConvexError("A brief needs a stable ingestKey (\"cassandra:brief:school-design\").");
    let existing: Brief | null = null;
    for (const candidate of resolveUserIdCandidates(owner)) {
      existing ??= await ctx.db.query("productionBriefs").withIndex("by_owner_ingestKey", (q) => q.eq("ownerUserId", candidate).eq("ingestKey", ingestKey)).first();
    }
    if (existing && existing.worldFolderId !== root._id) throw new ConvexError(`That ingestKey belongs to a brief of another world.`);
    if (existing && args.expectedRevision !== undefined && args.expectedRevision !== existing.revision) {
      throw new ConvexError(`The brief changed since revision ${args.expectedRevision} (now ${existing.revision}); read it again.`);
    }
    const title = clip(args.title, BRIEF_LIMITS.title) ?? existing?.title;
    if (!title) throw new ConvexError("A new brief needs a title (\"School design brief\").");
    const kind = args.kind ?? existing?.kind ?? "brief";
    const replace = args.assetIds ? await assertAssets(ctx, owner, args.assetIds) : null;
    const added = args.addAssetIds ? await assertAssets(ctx, owner, args.addAssetIds) : [];
    const assetIds = [...(replace ?? existing?.assetIds ?? [])];
    for (const id of added) if (!assetIds.includes(id)) assetIds.push(id);
    if (assetIds.length > BRIEF_LIMITS.assets) throw new ConvexError(`A brief holds at most ${BRIEF_LIMITS.assets} pictures.`);
    let groups = existing?.groups;
    if (args.groups) {
      if (args.groups.length > BRIEF_LIMITS.groups) throw new ConvexError(`At most ${BRIEF_LIMITS.groups} groups.`);
      groups = [];
      for (const group of args.groups) {
        const ids = await assertAssets(ctx, owner, group.assetIds);
        for (const id of ids) if (!assetIds.includes(id)) assetIds.push(id);
        groups.push({ label: group.label.trim().slice(0, 80) || "Pictures", assetIds: ids });
      }
    }
    const list = (values: string[] | undefined, fallback: string[]) =>
      values ? [...new Set(values.map((value) => value.trim().toLowerCase().slice(0, BRIEF_LIMITS.topic)).filter(Boolean))].slice(0, BRIEF_LIMITS.topics) : fallback;
    const next = {
      title, kind,
      from: args.from === null ? undefined : clip(args.from, BRIEF_LIMITS.from) ?? existing?.from,
      receivedAt: args.receivedAt === null ? undefined : args.receivedAt ?? existing?.receivedAt,
      note: args.note === null ? undefined : clip(args.note, BRIEF_LIMITS.note) ?? existing?.note,
      topics: list(args.topics, existing?.topics ?? []),
      reviewFolders: list(args.reviewFolders, existing?.reviewFolders ?? []),
      assetIds, groups, files: existing?.files ?? [],
    };
    const searchText = searchTextOf(next);
    const now = Date.now();
    const meta = { actor: args.actor ?? ACTOR, session: args.session };
    if (existing) {
      const before = snapshot(existing);
      const same = JSON.stringify({ ...next, searchText }) === JSON.stringify({
        title: existing.title, kind: existing.kind, from: existing.from, receivedAt: existing.receivedAt, note: existing.note,
        topics: existing.topics, reviewFolders: existing.reviewFolders, assetIds: existing.assetIds, groups: existing.groups,
        files: existing.files, searchText: existing.searchText,
      });
      if (same) return { briefId: existing._id, created: false, changed: false, revision: existing.revision, changeId: null };
      const revision = existing.revision + 1;
      await ctx.db.patch(existing._id, { ...next, searchText, revision, updatedAt: now });
      const changeId = await recordWorldChange(ctx, {
        ownerUserId: existing.ownerUserId, worldFolderId: root._id, op: "brief.save", targetType: "brief", targetId: existing._id,
        summary: `Updated production brief "${title}"`, before, after: snapshot((await ctx.db.get(existing._id))!), ...meta,
      });
      return { briefId: existing._id, created: false, changed: true, revision, changeId };
    }
    const briefId = await ctx.db.insert("productionBriefs", {
      ownerUserId: root.ownerUserId ?? owner, worldFolderId: root._id, ingestKey, ...next, searchText,
      revision: 1, createdBy: args.actor?.trim().slice(0, 80) || "agent", createdAt: now, updatedAt: now,
    });
    const changeId = await recordWorldChange(ctx, {
      ownerUserId: root.ownerUserId ?? owner, worldFolderId: root._id, op: "brief.save", targetType: "brief", targetId: briefId,
      summary: `Added production brief "${title}"${next.from ? ` from ${next.from}` : ""}`, before: null, after: snapshot((await ctx.db.get(briefId))!), ...meta,
    });
    return { briefId, created: true, changed: true, revision: 1, changeId };
  },
});

/** Undo of a brief.save: put the brief back as it was (a created brief with no files goes away). */
export const restoreBriefSnapshot = async (ctx: MutationCtx, before: BriefSnapshot | null, after: BriefSnapshot) => {
  const current = await ctx.db.get(after.briefId);
  if (!current) return { ok: false as const, reason: "the brief is gone" };
  if (current.revision !== after.revision) return { ok: false as const, reason: "the brief changed since" };
  if (!before) {
    if (current.files.length) return { ok: false as const, reason: "the brief holds files now; it stays" };
    await ctx.db.delete(current._id);
    return { ok: true as const, restored: null };
  }
  const { briefId, ...fields } = before;
  void briefId;
  // Files attached after the snapshot stay: undo never drops private bytes silently.
  const files = [...before.files, ...current.files.filter((file) => !before.files.some((row) => row.key === file.key))];
  await ctx.db.patch(current._id, { ...fields, files, revision: current.revision + 1, updatedAt: Date.now() });
  return { ok: true as const, restored: snapshot((await ctx.db.get(current._id))!) };
};

export const briefUploadUrl = ownerMutation({
  args: { ownerUserId: v.string() },
  returns: v.string(),
  handler: async (ctx) => ctx.storage.generateUploadUrl(),
});

export const attachBriefFile = ownerMutation({
  args: {
    ownerUserId: v.string(),
    brief: v.string(),
    storageId: v.id("_storage"),
    name: v.string(),
    sha256: v.string(),
    contentType: v.optional(v.string()),
    pages: v.optional(v.number()),
    coverStorageId: v.optional(v.id("_storage")),
    ...journalArgs,
  },
  returns: v.object({ key: v.string(), attached: v.boolean(), size: v.number(), url: v.string() }),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const brief = await resolveBrief(ctx, owner, args.brief);
    const stored = await ctx.db.system.get(args.storageId);
    if (!stored) throw new ConvexError("That upload is not in storage; upload the bytes first (production_brief_file upload_url).");
    const hex = base64ToHex(stored.sha256);
    if (hex !== args.sha256.trim().toLowerCase()) {
      await ctx.storage.delete(args.storageId);
      throw new ConvexError("The uploaded bytes do not match sha256; the upload was removed. Upload the file again.");
    }
    if (stored.size > BRIEF_LIMITS.fileBytes) {
      await ctx.storage.delete(args.storageId);
      throw new ConvexError("Files up to 200 MB only.");
    }
    if (args.coverStorageId && !(await ctx.db.system.get(args.coverStorageId))) throw new ConvexError("The cover upload is not in storage.");
    const same = brief.files.find((file) => file.sha256 === hex);
    if (same) {
      // The same bytes again: keep one copy, never two.
      if (same.storageId !== args.storageId) await ctx.storage.delete(args.storageId);
      if (args.coverStorageId && !same.coverStorageId) {
        await ctx.db.patch(brief._id, { files: brief.files.map((file) => file.key === same.key ? { ...file, coverStorageId: args.coverStorageId } : file), updatedAt: Date.now() });
      } else if (args.coverStorageId && args.coverStorageId !== same.coverStorageId) {
        await ctx.storage.delete(args.coverStorageId);
      }
      return { key: same.key, attached: false, size: same.size, url: briefFilePath(brief._id, same.key) };
    }
    if (brief.files.length >= BRIEF_LIMITS.files) throw new ConvexError(`A brief holds at most ${BRIEF_LIMITS.files} files.`);
    let n = brief.files.length + 1;
    while (brief.files.some((file) => file.key === `f${n}`)) n += 1;
    const file: Infer<typeof briefFileValidator> = {
      key: `f${n}`, name: args.name.trim().slice(0, 200) || `file-${n}`,
      contentType: args.contentType?.trim() || stored.contentType || "application/octet-stream",
      size: stored.size, sha256: hex, storageId: args.storageId,
      pages: args.pages, coverStorageId: args.coverStorageId, addedAt: Date.now(),
    };
    const before = snapshot(brief);
    const files = [...brief.files, file];
    await ctx.db.patch(brief._id, { files, searchText: searchTextOf({ ...brief, files }), revision: brief.revision + 1, updatedAt: Date.now() });
    await recordWorldChange(ctx, {
      ownerUserId: brief.ownerUserId, worldFolderId: brief.worldFolderId, op: "brief.save", targetType: "brief", targetId: brief._id,
      summary: `Attached ${file.name} to production brief "${brief.title}"`, before, after: snapshot((await ctx.db.get(brief._id))!),
      actor: args.actor ?? ACTOR, session: args.session,
    });
    return { key: file.key, attached: true, size: file.size, url: briefFilePath(brief._id, file.key) };
  },
});

/** Where the owner-only file route reads a brief's bytes (a storage URL, never sent to a browser). */
export const briefFile = ownerQuery({
  args: { ownerUserId: v.string(), briefId: v.string(), key: v.string(), cover: v.optional(v.boolean()) },
  returns: v.union(v.null(), v.object({ url: v.string(), name: v.string(), contentType: v.string(), size: v.optional(v.number()) })),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("productionBriefs", args.briefId);
    const brief = id ? await ctx.db.get(id) : null;
    if (!owned(args.ownerUserId, brief)) return null;
    const file = brief.files.find((row) => row.key === args.key);
    if (!file) return null;
    const storageId = args.cover ? file.coverStorageId : file.storageId;
    if (!storageId) return null;
    const url = await ctx.storage.getUrl(storageId);
    if (!url) return null;
    const meta = await ctx.db.system.get(storageId);
    return {
      url,
      name: args.cover ? `${file.name.replace(/\.[^.]+$/, "")}-cover.${meta?.contentType?.includes("png") ? "png" : "jpg"}` : file.name,
      contentType: (args.cover ? meta?.contentType : file.contentType) ?? "application/octet-stream",
      size: meta?.size,
    };
  },
});

export const setProjectDetails = ownerMutation({
  args: {
    ownerUserId: v.string(), world: v.string(),
    line: v.optional(v.union(v.string(), v.null())),
    client: v.optional(v.union(v.string(), v.null())),
    role: v.optional(v.union(v.string(), v.null())),
    people: v.optional(v.array(projectPersonValidator)),
    reviewSlugs: v.optional(v.array(v.string())),
    status: v.optional(v.union(v.literal("active"), v.literal("paused"), v.literal("done"))),
    ...journalArgs,
  },
  returns: v.object({ changed: v.boolean(), changeId: v.union(v.null(), v.id("worldChanges")) }),
  handler: async (ctx, args) => {
    const root = await resolveWorld(ctx, args.ownerUserId, args.world);
    const before = root.project ?? null;
    const pick = (value: string | null | undefined, old: string | undefined, max: number) => value === null ? undefined : clip(value ?? undefined, max) ?? old;
    const next = {
      line: pick(args.line, before?.line, 300),
      client: pick(args.client, before?.client, 120),
      role: pick(args.role, before?.role, 80),
      people: args.people
        ? args.people.slice(0, 24).map((row) => ({ name: row.name.trim().slice(0, 80), role: clip(row.role, 80), org: clip(row.org, 120) })).filter((row) => row.name)
        : before?.people,
      reviewSlugs: args.reviewSlugs ? [...new Set(args.reviewSlugs.map((slug) => slug.trim().toLowerCase()).filter(Boolean))].slice(0, 12) : before?.reviewSlugs,
      status: args.status ?? before?.status ?? "active",
    };
    const strip = (value: object | null) => JSON.stringify(value ? Object.fromEntries(Object.entries(value).filter(([key, entry]) => key !== "updatedAt" && entry !== undefined)) : null);
    if (strip(before) === strip(next)) return { changed: false, changeId: null };
    const project = { ...next, updatedAt: Date.now() };
    await ctx.db.patch(root._id, { project, updatedAt: Date.now() });
    const changeId = await recordWorldChange(ctx, {
      ownerUserId: root.ownerUserId ?? args.ownerUserId, worldFolderId: root._id, op: "project.save", targetType: "world", targetId: root._id,
      summary: before ? `Updated the project details of ${root.name}` : `Made ${root.name} a project`, before, after: project,
      actor: args.actor ?? ACTOR, session: args.session,
    });
    return { changed: true, changeId };
  },
});

/** Which of these assets sit on an art-director shelf (agents need Michael's word before they leave it). */
export const artDirectorOnly = ownerQuery({
  args: { ownerUserId: v.string(), assetIds: v.array(v.string()) },
  returns: v.array(v.object({ assetId: v.string(), shelf: v.string() })),
  handler: async (ctx, args) => {
    const out = [];
    const memo = new Map<string, Folder | null>();
    for (const raw of args.assetIds.slice(0, 500)) {
      const id = ctx.db.normalizeId("assets", raw.trim().replace(/^asset:/, ""));
      if (!id) continue;
      const links = await ctx.db.query("assetFolders").withIndex("by_asset", (q) => q.eq("assetId", id)).take(32);
      for (const link of links) {
        if (!memo.has(link.folderId)) memo.set(link.folderId, await ctx.db.get(link.folderId));
        const folder = memo.get(link.folderId);
        if (folder?.scope === ART_DIRECTOR_SCOPE && owned(args.ownerUserId, folder)) { out.push({ assetId: id as string, shelf: folder.name }); break; }
      }
    }
    return out;
  },
});

