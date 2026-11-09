import { ConvexError, v, type Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { signedOwnerMutation as ownerMutation, signedOwnerQuery as ownerQuery } from "./actor";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import { buildR2PublicUrl, resolveAssetThumbUrl, resolveAssetUrl } from "./r2_url";
import { childrenOf, recordWorldChange, resolveWorld } from "./worldCore";
import { fileAssetsInWorld } from "./worlds";
import { batchRows, resolveRefs } from "./mjQueue";
import { mjQueueRefValidator } from "./mjQueueValidators";
import { lockedFrameValidator, lockedPromptContentFields, lockedTakeValidator, restyleModeValidator } from "./lockedPromptValidators";
import { ART_DIRECTOR_SCOPE } from "./projectValidators";
import { LOCKED_PROMPT_LIMITS, SEED_MAX, midjourneyCdnUrl, restyle, seedFor, type RestyleMode } from "../lib/locked-prompt";
import { MJ_QUEUE_LIMITS, batchKeyOf, composeMjCommand, threadIdOf } from "../lib/mj-queue";
import { mjFilePrefix, mjIdentityOf, mjMatches, mjSourcePrefixes } from "../lib/world-styles";

// Locked location prompts: one style-neutral prompt per place of a project
// (CASSANDRA: School · Patio …), restyled into any world style in one click.
// A restyle writes MJ Queue items (one thread per call) that Michael sends
// himself, one job per click; nothing here submits anything to Midjourney.
// Frames that come back (saved from those jobs) are filed under their place
// and style and linked to the prompt and the source frame. Art-director
// scope: owner queries only; never promoted to the director review here.

type Ctx = QueryCtx | MutationCtx;
type Locked = Doc<"lockedPrompts">;
type Style = Doc<"worldStyles">;

const ACTOR = "locked prompts";
const TAKES_SHELF = "Location takes";
const owned = <T extends { ownerUserId?: string }>(owner: string, row: T | null): row is T =>
  Boolean(row && canActorAccessOwnerUserId(owner, row.ownerUserId ?? ""));
const clip = (value: string | undefined | null, max: number) => value?.trim().slice(0, max) || undefined;
const journalArgs = { actor: v.optional(v.string()), session: v.optional(v.string()) };
const CONTENT_KEYS = Object.keys(lockedPromptContentFields) as Array<keyof typeof lockedPromptContentFields>;

const contentOf = (row: Locked) => Object.fromEntries(CONTENT_KEYS.map((key) => [key, row[key]])) as Pick<Locked, keyof typeof lockedPromptContentFields>;
const searchTextOf = (row: Pick<Locked, "title" | "place" | "text" | "note" | "reviewFolder" | "scenes">) =>
  [row.title, row.place, row.reviewFolder, row.text, row.note, row.scenes.length ? `scenes ${row.scenes.join(" ")}` : ""]
    .filter(Boolean).join(" \n").slice(0, 12_000);

const resolveLocked = async (ctx: Ctx, owner: string, ref: string): Promise<Locked> => {
  const value = ref.trim().replace(/^(lp|locked):/, "");
  const id = ctx.db.normalizeId("lockedPrompts", value);
  if (id) {
    const row = await ctx.db.get(id);
    if (owned(owner, row)) return row;
  }
  for (const candidate of resolveUserIdCandidates(owner)) {
    const row = await ctx.db.query("lockedPrompts").withIndex("by_owner_ingestKey", (q) => q.eq("ownerUserId", candidate).eq("ingestKey", value)).first();
    if (row) return row;
  }
  throw new ConvexError(`No locked prompt "${ref}". list_locked_prompts lists a project's.`);
};

const promptsOfWorld = async (ctx: Ctx, owner: string, worldId: Id<"folders">) => {
  const rows: Locked[] = [];
  for (const candidate of resolveUserIdCandidates(owner)) {
    rows.push(...await ctx.db.query("lockedPrompts")
      .withIndex("by_owner_world_updatedAt", (q) => q.eq("ownerUserId", candidate).eq("worldFolderId", worldId)).take(500));
  }
  return rows.sort((a, b) => a.place.localeCompare(b.place) || a.createdAt - b.createdAt);
};

const resolveStyle = async (ctx: Ctx, owner: string, worldIds: Set<string>, ref: string): Promise<Style> => {
  const value = ref.trim().replace(/^style:/, "");
  const id = ctx.db.normalizeId("worldStyles", value);
  if (id) {
    const row = await ctx.db.get(id);
    if (owned(owner, row)) return row;
  }
  const slug = value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  for (const worldId of worldIds) {
    for (const candidate of resolveUserIdCandidates(owner)) {
      const row = await ctx.db.query("worldStyles")
        .withIndex("by_owner_world_slug", (q) => q.eq("ownerUserId", candidate).eq("worldFolderId", worldId as Id<"folders">).eq("slug", slug)).first();
      if (row) return row;
    }
  }
  throw new ConvexError(`No style "${ref}" in this world. list_styles shows them.`);
};

/** A style's first recipe as composeRecipe input, with moodboard and profile codes read from their records. */
const styleForCompose = async (ctx: Ctx, style: Style, recipeIndex = 0) => {
  const recipe = style.recipes[recipeIndex] ?? style.recipes[0];
  if (!recipe) throw new ConvexError(`${style.name} has no recipe yet; save one with save_style first.`);
  const moodboardCodes: Array<string | undefined> = [];
  for (const id of recipe.moodboardIds) {
    const board = await ctx.db.get(id);
    moodboardCodes.push(board?.mjCode ?? (board?.mjMoodboardId ? `m${board.mjMoodboardId}` : undefined));
  }
  const profileCodes: string[] = [];
  for (const id of recipe.profileIds) {
    const profile = await ctx.db.get(id);
    if (profile) profileCodes.push(profile.code);
  }
  return {
    name: style.name, parameters: recipe.parameters, template: recipe.template,
    moodboardCodes, profileCodes, unknownCodes: recipe.unknownCodes ?? [],
  };
};

/** What --edit attaches for a frame: its Midjourney CDN image when it came from a job, else the gallery copy. */
const lockedFrameOf = async (ctx: Ctx, owner: string, ref: string, label?: string): Promise<Infer<typeof lockedFrameValidator>> => {
  const id = ctx.db.normalizeId("assets", ref.trim().replace(/^asset:/, ""));
  const asset = id ? await ctx.db.get(id) : null;
  if (!owned(owner, asset) || asset.kind !== "image") throw new ConvexError(`The locked frame ${ref} is not a gallery image.`);
  const identity = mjIdentityOf(asset);
  const fullJob = identity && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(identity.job) ? identity : null;
  const editUrl = fullJob ? midjourneyCdnUrl(fullJob.job, fullJob.index ?? 0) : await resolveAssetUrl(ctx, asset);
  if (!editUrl) throw new ConvexError(`The locked frame ${ref} has no public image address.`);
  return { assetId: asset._id, editUrl, thumbUrl: (await resolveAssetThumbUrl(ctx, asset)) ?? undefined, label: label?.trim().slice(0, 120) || undefined };
};

/* ── Reads ──────────────────────────────────────────────────────────────── */

const pictureValidator = v.object({ assetId: v.id("assets"), thumbUrl: v.optional(v.string()) });

const cardValidator = v.object({
  id: v.id("lockedPrompts"), ingestKey: v.string(), title: v.string(), place: v.string(),
  reviewFolder: v.optional(v.string()), shelfId: v.optional(v.id("folders")), scenes: v.array(v.number()),
  text: v.string(), aspect: v.string(), seed: v.number(), extraParams: v.optional(v.string()), note: v.optional(v.string()),
  imagePrompts: v.array(mjQueueRefValidator),
  lockedFrame: v.optional(lockedFrameValidator),
  currentStyle: v.optional(v.object({ id: v.id("worldStyles"), name: v.string() })),
  takes: v.number(), lastTakes: v.array(pictureValidator),
  archived: v.boolean(), revision: v.number(), updatedAt: v.number(),
});

const cardOf = async (ctx: Ctx, owner: string, row: Locked, lastTakes = 4) => {
  const style = row.currentStyleId ? await ctx.db.get(row.currentStyleId) : null;
  const takes = [];
  for (const take of [...row.takes].reverse().slice(0, lastTakes)) {
    const asset = await ctx.db.get(take.assetId);
    if (owned(owner, asset)) {
      const small = [...(asset.thumbVariants ?? [])].sort((a, b) => a.width - b.width)[0];
      takes.push({ assetId: asset._id, thumbUrl: (small ? buildR2PublicUrl(small.r2Key) : undefined) ?? await resolveAssetThumbUrl(ctx, asset) ?? undefined });
    }
  }
  return {
    id: row._id, ingestKey: row.ingestKey, title: row.title, place: row.place, reviewFolder: row.reviewFolder, shelfId: row.shelfId,
    scenes: row.scenes, text: row.text, aspect: row.aspect, seed: row.seed, extraParams: row.extraParams, note: row.note,
    imagePrompts: row.imagePrompts, lockedFrame: row.lockedFrame,
    currentStyle: owned(owner, style) ? { id: style._id, name: style.name } : undefined,
    takes: row.takes.length, lastTakes: takes, archived: Boolean(row.archivedAt), revision: row.revision, updatedAt: row.updatedAt,
  };
};

export const listLockedPrompts = ownerQuery({
  args: { ownerUserId: v.string(), world: v.string(), place: v.optional(v.string()), includeArchived: v.optional(v.boolean()) },
  returns: v.object({ world: v.object({ id: v.id("folders"), key: v.string(), name: v.string() }), prompts: v.array(cardValidator) }),
  handler: async (ctx, args) => {
    const root = await resolveWorld(ctx, args.ownerUserId, args.world);
    const place = args.place?.trim().toLowerCase();
    const rows = (await promptsOfWorld(ctx, args.ownerUserId, root._id))
      .filter((row) => args.includeArchived || !row.archivedAt)
      .filter((row) => !place || row.place.toLowerCase().startsWith(place) || row.reviewFolder === place);
    const prompts = [];
    for (const row of rows) prompts.push(await cardOf(ctx, args.ownerUserId, row));
    return { world: { id: root._id, key: root.worldKey ?? "", name: root.name }, prompts };
  },
});

export const getLockedPrompt = ownerQuery({
  args: { ownerUserId: v.string(), prompt: v.string() },
  returns: v.object({
    prompt: cardValidator,
    world: v.object({ id: v.id("folders"), key: v.string(), name: v.string() }),
    takes: v.array(v.object({ ...lockedTakeValidator.fields, thumbUrl: v.optional(v.string()), styleName: v.optional(v.string()) })),
    revisions: v.array(v.object({ revision: v.number(), savedBy: v.string(), savedAt: v.number(), text: v.string(), seed: v.number(), title: v.string() })),
  }),
  handler: async (ctx, args) => {
    const row = await resolveLocked(ctx, args.ownerUserId, args.prompt);
    const world = await ctx.db.get(row.worldFolderId);
    const takes = [];
    for (const take of row.takes) {
      const asset = await ctx.db.get(take.assetId);
      const style = take.styleId ? await ctx.db.get(take.styleId) : null;
      takes.push({ ...take, thumbUrl: asset ? await resolveAssetThumbUrl(ctx, asset) ?? undefined : undefined, styleName: style?.name });
    }
    const revisions = await ctx.db.query("lockedPromptRevisions").withIndex("by_prompt_revision", (q) => q.eq("lockedPromptId", row._id)).order("desc").take(LOCKED_PROMPT_LIMITS.revisions);
    return {
      prompt: await cardOf(ctx, args.ownerUserId, row, 12),
      world: { id: row.worldFolderId, key: world?.worldKey ?? "", name: world?.name ?? "" },
      takes,
      revisions: revisions.map((rev) => ({ revision: rev.revision, savedBy: rev.savedBy, savedAt: rev.savedAt, text: rev.text, seed: rev.seed, title: rev.title })),
    };
  },
});

/* ── Save (versioned) ───────────────────────────────────────────────────── */

const refInput = v.object({
  url: v.optional(v.string()), code: v.optional(v.string()), assetId: v.optional(v.string()),
  weight: v.optional(v.number()), label: v.optional(v.string()),
});

export const saveLockedPrompt = ownerMutation({
  args: {
    ownerUserId: v.string(),
    world: v.string(),
    // An existing prompt (id or ingestKey) to change; or a new ingestKey to create one.
    prompt: v.optional(v.string()),
    ingestKey: v.optional(v.string()),
    title: v.optional(v.string()),
    place: v.optional(v.string()),
    reviewFolder: v.optional(v.union(v.string(), v.null())),
    shelf: v.optional(v.union(v.string(), v.null())),
    scenes: v.optional(v.array(v.number())),
    text: v.optional(v.string()),
    imagePrompts: v.optional(v.array(refInput)),
    aspect: v.optional(v.string()),
    seed: v.optional(v.number()),
    extraParams: v.optional(v.union(v.string(), v.null())),
    note: v.optional(v.union(v.string(), v.null())),
    lockedFrame: v.optional(v.union(v.string(), v.null())),
    lockedFrameLabel: v.optional(v.string()),
    currentStyle: v.optional(v.union(v.string(), v.null())),
    sourceQueueItemIds: v.optional(v.array(v.string())),
    archived: v.optional(v.boolean()),
    expectedRevision: v.optional(v.number()),
    ...journalArgs,
  },
  returns: v.object({ promptId: v.id("lockedPrompts"), created: v.boolean(), changed: v.boolean(), revision: v.number() }),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const root = await resolveWorld(ctx, owner, args.world);
    let existing: Locked | null = null;
    if (args.prompt) existing = await resolveLocked(ctx, owner, args.prompt);
    const ingestKey = clip(args.ingestKey, 200) ?? existing?.ingestKey;
    if (!existing && ingestKey) {
      for (const candidate of resolveUserIdCandidates(owner)) {
        existing ??= await ctx.db.query("lockedPrompts").withIndex("by_owner_ingestKey", (q) => q.eq("ownerUserId", candidate).eq("ingestKey", ingestKey)).first();
      }
    }
    if (!existing && !ingestKey) throw new ConvexError("A new locked prompt needs a stable ingestKey (cassandra:lp:school-patio).");
    if (existing && existing.worldFolderId !== root._id) throw new ConvexError("That locked prompt belongs to another world.");
    if (existing && args.expectedRevision !== undefined && existing.revision !== args.expectedRevision) {
      throw new ConvexError(`The locked prompt changed since revision ${args.expectedRevision} (now ${existing.revision}); read it again.`);
    }
    const title = clip(args.title, LOCKED_PROMPT_LIMITS.title) ?? existing?.title;
    const text = clip(args.text, LOCKED_PROMPT_LIMITS.text) ?? existing?.text;
    const place = clip(args.place, LOCKED_PROMPT_LIMITS.place) ?? existing?.place;
    if (!title || !text || !place) throw new ConvexError("A locked prompt needs a title, a place (School · Patio) and its text.");
    if (/(^|\s)--[a-z]/i.test(text)) throw new ConvexError("Keep flags out of the text: aspect, seed and extraParams have their own fields; style flags come from the style.");
    const seed = args.seed ?? existing?.seed ?? seedFor(ingestKey!);
    if (!Number.isInteger(seed) || seed < 0 || seed > SEED_MAX) throw new ConvexError(`A seed is a whole number from 0 to ${SEED_MAX}.`);
    const aspect = clip(args.aspect, 12) ?? existing?.aspect ?? "16:9";
    if (!/^\d{1,2}:\d{1,2}$/.test(aspect)) throw new ConvexError(`"${aspect}" is not an aspect ratio (16:9).`);
    let shelfId = existing?.shelfId;
    if (args.shelf === null) shelfId = undefined;
    else if (args.shelf) {
      const children = (await childrenOf(ctx, root._id)).filter((child) => owned(owner, child));
      const ref = args.shelf.trim().replace(/^(folder|collection|shelf):/, "");
      const hit = children.find((child) => child._id === ref || child.name.toLowerCase() === ref.toLowerCase());
      if (!hit) throw new ConvexError(`No shelf "${args.shelf}" in ${root.name}.`);
      shelfId = hit._id;
    }
    let currentStyleId = existing?.currentStyleId;
    if (args.currentStyle === null) currentStyleId = undefined;
    else if (args.currentStyle) currentStyleId = (await resolveStyle(ctx, owner, new Set([root._id, ...(root.universeRootId ? [root.universeRootId] : [])]), args.currentStyle))._id;
    const lockedFrame = args.lockedFrame === null ? undefined
      : args.lockedFrame ? await lockedFrameOf(ctx, owner, args.lockedFrame, args.lockedFrameLabel) : existing?.lockedFrame;
    const scenes = args.scenes ? [...new Set(args.scenes.filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b).slice(0, LOCKED_PROMPT_LIMITS.scenes) : existing?.scenes ?? [];
    const content = {
      title, place, text, aspect, seed, scenes, shelfId, currentStyleId, lockedFrame,
      reviewFolder: args.reviewFolder === null ? undefined : clip(args.reviewFolder, 80)?.toLowerCase() ?? existing?.reviewFolder,
      imagePrompts: args.imagePrompts ? await resolveRefs(ctx, owner, args.imagePrompts, LOCKED_PROMPT_LIMITS.imagePrompts, "Image prompt") : existing?.imagePrompts ?? [],
      extraParams: args.extraParams === null ? undefined : clip(args.extraParams, 200) ?? existing?.extraParams,
      note: args.note === null ? undefined : clip(args.note, LOCKED_PROMPT_LIMITS.note) ?? existing?.note,
    };
    const sources: Id<"mjQueueItems">[] = [...(existing?.sourceQueueItemIds ?? [])];
    for (const raw of args.sourceQueueItemIds ?? []) {
      const id = ctx.db.normalizeId("mjQueueItems", raw.trim().replace(/^mjq:/, ""));
      const item = id ? await ctx.db.get(id) : null;
      if (owned(owner, item) && !sources.includes(item._id)) sources.push(item._id);
    }
    const archivedAt = args.archived === undefined ? existing?.archivedAt : args.archived ? existing?.archivedAt ?? Date.now() : undefined;
    const now = Date.now();
    const savedBy = args.actor?.trim().slice(0, 80) || "agent";
    const contentChanged = !existing || JSON.stringify(contentOf({ ...existing, ...content } as Locked)) !== JSON.stringify(contentOf(existing));
    if (existing && !contentChanged && sources.length === existing.sourceQueueItemIds.length && archivedAt === existing.archivedAt) {
      return { promptId: existing._id, created: false, changed: false, revision: existing.revision };
    }
    const revision = existing ? existing.revision + (contentChanged ? 1 : 0) : 1;
    const doc = { ...content, sourceQueueItemIds: sources, archivedAt, searchText: searchTextOf(content), revision, updatedAt: now };
    let promptId: Id<"lockedPrompts">;
    if (existing) {
      await ctx.db.patch(existing._id, doc);
      promptId = existing._id;
    } else {
      promptId = await ctx.db.insert("lockedPrompts", {
        ownerUserId: root.ownerUserId ?? owner, worldFolderId: root._id, ingestKey: ingestKey!, ...doc,
        takes: [], createdBy: savedBy, createdAt: now,
      });
    }
    if (contentChanged) {
      await ctx.db.insert("lockedPromptRevisions", { ownerUserId: root.ownerUserId ?? owner, lockedPromptId: promptId, revision, ...content, savedBy, savedAt: now });
    }
    await recordWorldChange(ctx, {
      ownerUserId: root.ownerUserId ?? owner, worldFolderId: root._id, op: "lockedPrompt.save", targetType: "lockedPrompt", targetId: promptId,
      summary: `${existing ? "Updated" : "Locked"} the location prompt "${title}" (${place}) · revision ${revision}`,
      before: existing ? contentOf(existing) : null, after: content, actor: args.actor ?? ACTOR, session: args.session,
    });
    return { promptId, created: !existing, changed: true, revision };
  },
});

/* ── Restyle → MJ Queue ─────────────────────────────────────────────────── */

const restyleItemValidator = v.object({
  id: v.id("mjQueueItems"), created: v.boolean(), prompt: v.string(), place: v.string(), style: v.string(),
  mode: restyleModeValidator, command: v.string(), warnings: v.array(v.string()),
});

/**
 * Locked prompts × styles → one MJ Queue thread. Same prompt + seed ("seed")
 * or the locked frame attached with --edit ("frame"). Repeating the call
 * returns the same items (ingestKey per prompt revision, style and mode).
 * dryRun composes without writing.
 */
export const restyleLockedPrompts = ownerMutation({
  args: {
    ownerUserId: v.string(),
    world: v.string(),
    prompts: v.optional(v.array(v.string())),
    // Every locked prompt of these places ("School", "School · Patio", or a review folder slug).
    places: v.optional(v.array(v.string())),
    styles: v.array(v.string()),
    mode: restyleModeValidator,
    recipe: v.optional(v.number()),
    thread: v.optional(v.string()),
    dryRun: v.optional(v.boolean()),
    createdBy: v.optional(v.string()),
  },
  returns: v.object({
    thread: v.string(), threadId: v.string(), worldKey: v.string(), dryRun: v.boolean(),
    items: v.array(v.union(restyleItemValidator, v.object({ prompt: v.string(), place: v.string(), style: v.string(), mode: restyleModeValidator, command: v.string(), warnings: v.array(v.string()), created: v.literal(false), dry: v.literal(true) }))),
  }),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const root = await resolveWorld(ctx, owner, args.world);
    const all = (await promptsOfWorld(ctx, owner, root._id)).filter((row) => !row.archivedAt);
    const chosen = new Map<string, Locked>();
    for (const ref of args.prompts ?? []) {
      const row = await resolveLocked(ctx, owner, ref);
      if (row.worldFolderId !== root._id) throw new ConvexError(`${row.title} is in another world.`);
      chosen.set(row._id, row);
    }
    for (const place of args.places ?? []) {
      const key = place.trim().toLowerCase();
      const hits = all.filter((row) => row.place.toLowerCase() === key || row.place.toLowerCase().startsWith(`${key} ·`) || row.reviewFolder === key);
      if (!hits.length) throw new ConvexError(`No locked prompt in the place "${place}".`);
      for (const row of hits) chosen.set(row._id, row);
    }
    const prompts = [...chosen.values()].sort((a, b) => a.place.localeCompare(b.place) || a.createdAt - b.createdAt);
    if (!prompts.length) throw new ConvexError("Pick locked prompts or places to redo.");
    if (prompts.length > LOCKED_PROMPT_LIMITS.promptsPerRestyle) throw new ConvexError(`At most ${LOCKED_PROMPT_LIMITS.promptsPerRestyle} prompts per restyle.`);
    if (!args.styles.length || args.styles.length > LOCKED_PROMPT_LIMITS.stylesPerRestyle) throw new ConvexError(`Pick 1 to ${LOCKED_PROMPT_LIMITS.stylesPerRestyle} styles.`);
    const worldIds = new Set<string>([root._id, ...(root.universeRootId ? [root.universeRootId] : [])]);
    const styles = [];
    for (const ref of args.styles) {
      const style = await resolveStyle(ctx, owner, worldIds, ref);
      styles.push({ style, compose: await styleForCompose(ctx, style, args.recipe ?? 0) });
    }
    const areas = [...new Set(prompts.map((row) => row.place.split("·")[0]!.trim()))];
    const placeLabel = areas.length === 1 ? (prompts.length === 1 ? prompts[0]!.place : areas[0]!) : "Locked locations";
    const thread = clip(args.thread, MJ_QUEUE_LIMITS.batch)
      ?? `${root.name} · ${placeLabel} · in ${styles.map((row) => row.style.name).join(" + ")}${args.mode === "frame" ? " · locked frame" : ""}`;
    const batchKey = batchKeyOf(thread);
    const existing = args.dryRun ? [] : await batchRows(ctx, owner, batchKey);
    let order = existing.reduce((max, row) => Math.max(max, row.order), 0);
    const now = Date.now();
    const createdBy = clip(args.createdBy, 80) ?? "agent";
    const items = [];
    for (const row of prompts) {
      for (const { style, compose } of styles) {
        const composed = restyle(row, compose, args.mode as RestyleMode, row.lockedFrame ? { url: row.lockedFrame.editUrl, assetId: row.lockedFrame.assetId, label: row.lockedFrame.label } : undefined);
        const mode: RestyleMode = args.mode === "frame" && composed.editRefs.length ? "frame" : "seed";
        const ingestKey = `restyle:${row._id}:r${row.revision}:${style._id}:${mode}`;
        const queueFields = {
          prompt: composed.prompt,
          imagePrompts: composed.imagePrompts.map((ref) => ({ url: ref.url, assetId: ref.assetId as Id<"assets"> | undefined, thumbUrl: ref.thumbUrl, weight: ref.weight, label: ref.label })),
          styleRefs: composed.styleRefs,
          profileCodes: composed.profileCodes,
          params: composed.params,
          editRefs: composed.editRefs.map((ref) => ({ url: ref.url, assetId: ref.assetId as Id<"assets"> | undefined, thumbUrl: row.lockedFrame?.thumbUrl, label: ref.label })),
        };
        const { command, warnings } = composeMjCommand(queueFields);
        const allWarnings = [...composed.warnings, ...warnings];
        if (args.dryRun) {
          items.push({ prompt: row.title, place: row.place, style: style.name, mode, command, warnings: allWarnings, created: false as const, dry: true as const });
          continue;
        }
        let found: Doc<"mjQueueItems"> | null = null;
        for (const candidate of resolveUserIdCandidates(owner)) {
          found ??= await ctx.db.query("mjQueueItems").withIndex("by_owner_ingestKey", (q) => q.eq("ownerUserId", candidate).eq("ingestKey", ingestKey)).first();
        }
        if (found) {
          items.push({ id: found._id, created: false, prompt: row.title, place: row.place, style: style.name, mode, ...composeMjCommand(found) });
          continue;
        }
        if (existing.length + items.length >= MJ_QUEUE_LIMITS.itemsPerBatch) throw new ConvexError(`A thread holds at most ${MJ_QUEUE_LIMITS.itemsPerBatch} prompts.`);
        order += 1;
        // The prompt's own note describes its first recipe; a restyle says only the mode and the scenes.
        const note = [mode === "frame" ? "Keeps the layout of the locked frame; only the look changes." : "Same words and seed: similar composition, the new recipe still moves the picture.", row.scenes.length ? `Scenes ${row.scenes.join(", ")}.` : ""].filter(Boolean).join(" ").slice(0, MJ_QUEUE_LIMITS.note);
        const id = await ctx.db.insert("mjQueueItems", {
          ownerUserId: root.ownerUserId ?? owner, worldFolderId: root._id, worldKey: root.worldKey,
          batch: thread, batchKey, order,
          title: `${row.title} · ${style.name}`.slice(0, MJ_QUEUE_LIMITS.title),
          ...queueFields,
          lockedPromptId: row._id, placeLabel: row.place, styleId: style._id, styleLabel: style.name, restyleMode: mode,
          note, status: "queued", ingestKey, createdBy, createdAt: now, updatedAt: now,
        });
        items.push({ id, created: true, prompt: row.title, place: row.place, style: style.name, mode, command, warnings: allWarnings });
      }
    }
    return { thread, threadId: threadIdOf(batchKey), worldKey: root.worldKey ?? "", dryRun: Boolean(args.dryRun), items };
  },
});

/* ── Results back ───────────────────────────────────────────────────────── */

const takesShelf = async (ctx: MutationCtx, owner: string, root: Doc<"folders">) => {
  const children = await childrenOf(ctx, root._id);
  const hit = children.find((child) => child.name === TAKES_SHELF && owned(owner, child));
  if (hit) return hit._id;
  const now = Date.now();
  const id = await ctx.db.insert("folders", {
    ownerUserId: root.ownerUserId ?? owner, name: TAKES_SHELF, normalizedName: `${root._id}/${TAKES_SHELF.toLowerCase()}`,
    description: "Frames made from locked location prompts in other styles. Art director only until Michael promotes them.",
    parentFolderId: root._id, group: "Places", scope: ART_DIRECTOR_SCOPE, memberCount: 0, createdAt: now, updatedAt: now,
  });
  await recordWorldChange(ctx, {
    ownerUserId: root.ownerUserId ?? owner, worldFolderId: root._id, op: "shelf.create", targetType: "shelf", targetId: id,
    summary: `Created shelf "${TAKES_SHELF}" in Places (art director only)`, after: { folderId: id }, actor: ACTOR,
  });
  return id;
};

/**
 * Frames saved from sent restyle jobs: filed onto the prompt's place shelf,
 * the style's shelf and the art-director "Location takes" shelf, linked to the
 * prompt (takes) and to their sources (lineage). Never promoted to the review.
 */
export const fileRestyleResults = ownerMutation({
  args: { ownerUserId: v.string(), world: v.string(), thread: v.optional(v.string()), prompt: v.optional(v.string()), session: v.optional(v.string()) },
  returns: v.object({
    checked: v.number(), waiting: v.number(),
    filed: v.array(v.object({ assetId: v.id("assets"), prompt: v.string(), style: v.optional(v.string()), mode: v.optional(restyleModeValidator) })),
  }),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const root = await resolveWorld(ctx, owner, args.world);
    let items: Doc<"mjQueueItems">[] = [];
    if (args.thread) {
      const key = /^thr-[0-9a-f]{8}$/.test(args.thread.trim()) ? null : batchKeyOf(args.thread);
      if (key) items = await batchRows(ctx, owner, key);
      else {
        for (const candidate of resolveUserIdCandidates(owner)) {
          const rows = await ctx.db.query("mjQueueItems").withIndex("by_owner_updatedAt", (q) => q.eq("ownerUserId", candidate)).order("desc").take(1000);
          items.push(...rows.filter((row) => threadIdOf(row.batchKey) === args.thread!.trim()));
        }
      }
    } else {
      for (const candidate of resolveUserIdCandidates(owner)) {
        items.push(...await ctx.db.query("mjQueueItems").withIndex("by_owner_updatedAt", (q) => q.eq("ownerUserId", candidate)).order("desc").take(1000));
      }
    }
    const only = args.prompt ? (await resolveLocked(ctx, owner, args.prompt))._id : null;
    const restyles = items.filter((row) => row.lockedPromptId && row.worldFolderId === root._id && (!only || row.lockedPromptId === only));
    const filed = [];
    let waiting = 0;
    let shelf: Id<"folders"> | null = null;
    for (const item of restyles) {
      if (item.status !== "sent" || !item.jobId) { waiting += 1; continue; }
      const job = item.jobId.toLowerCase();
      const found = new Map<Id<"assets">, Doc<"assets">>();
      for (const candidate of resolveUserIdCandidates(owner)) {
        for (const prefix of mjSourcePrefixes(job)) {
          for (const asset of await ctx.db.query("assets").withIndex("by_owner_sourceUrl", (q) => q.eq("ownerUserId", candidate).gte("sourceUrl", prefix).lt("sourceUrl", `${prefix}￿`)).take(16)) found.set(asset._id, asset);
        }
        for (const asset of await ctx.db.query("assets").withIndex("by_owner_fileName", (q) => q.eq("ownerUserId", candidate).gte("fileName", mjFilePrefix(job)).lt("fileName", `${mjFilePrefix(job)}￿`)).take(16)) found.set(asset._id, asset);
      }
      const frames = [...found.values()].filter((asset) => mjMatches({ job }, mjIdentityOf(asset)));
      if (!frames.length) { waiting += 1; continue; }
      const locked = await ctx.db.get(item.lockedPromptId!);
      if (!locked) continue;
      const style = item.styleId ? await ctx.db.get(item.styleId) : null;
      const fresh = frames.filter((asset) => !locked.takes.some((take) => take.assetId === asset._id));
      if (!fresh.length) continue;
      shelf ??= await takesShelf(ctx, owner, root);
      const addTo = [shelf as string, ...(locked.shelfId ? [locked.shelfId as string] : []), ...(style?.shelfFolderId && style.worldFolderId === root._id ? [style.shelfFolderId as string] : [])];
      await fileAssetsInWorld(ctx, {
        ownerUserId: owner, world: root._id, assetIds: fresh.map((asset) => asset._id), addTo, move: false,
        note: `restyle of "${locked.title}" in ${style?.name ?? "a style"}`, actor: ACTOR, session: args.session ?? "locked-prompts-results",
      });
      const now = Date.now();
      for (const asset of fresh) {
        const sources: Array<{ id: Id<"assets">; role: "edit_source" | "starting_image_asset" | "other"; notes: string }> = [];
        if (item.restyleMode === "frame" && locked.lockedFrame) sources.push({ id: locked.lockedFrame.assetId, role: "edit_source", notes: "Locked frame restyled (--edit)" });
        else if (locked.lockedFrame) sources.push({ id: locked.lockedFrame.assetId, role: "other", notes: "Same locked prompt and seed as this frame" });
        if (item.restyleMode !== "frame") for (const ref of locked.imagePrompts) if (ref.assetId) sources.push({ id: ref.assetId, role: "starting_image_asset", notes: "Brief image prompt of the locked prompt" });
        for (const source of sources) {
          await ctx.db.insert("generationLineage", { ownerUserId: asset.ownerUserId ?? owner, targetAssetId: asset._id, sourceAssetId: source.id, role: source.role, notes: `${source.notes} · ${locked.title}`, createdAt: now });
        }
        filed.push({ assetId: asset._id, prompt: locked.title, style: style?.name, mode: item.restyleMode });
      }
      await ctx.db.patch(locked._id, {
        takes: [...locked.takes, ...fresh.map((asset) => ({ assetId: asset._id, styleId: style?._id, mode: item.restyleMode, queueItemId: item._id, jobId: job, at: now }))],
        updatedAt: now,
      });
    }
    return { checked: restyles.length, waiting, filed };
  },
});


/** The locked prompts a frame belongs to (as its locked frame or a take): the open frame's "Redo in style". */
export const lockedForAsset = ownerQuery({
  args: { ownerUserId: v.string(), assetId: v.id("assets") },
  returns: v.array(v.object({ id: v.id("lockedPrompts"), title: v.string(), place: v.string(), worldKey: v.string(), as: v.union(v.literal("locked frame"), v.literal("take")) })),
  handler: async (ctx, args) => {
    const out = [];
    for (const candidate of resolveUserIdCandidates(args.ownerUserId)) {
      const rows = await ctx.db.query("lockedPrompts").withIndex("by_owner_world_updatedAt", (q) => q.eq("ownerUserId", candidate)).take(1000);
      for (const row of rows) {
        const as = row.lockedFrame?.assetId === args.assetId ? "locked frame" as const : row.takes.some((take) => take.assetId === args.assetId) ? "take" as const : null;
        if (!as || row.archivedAt) continue;
        const world = await ctx.db.get(row.worldFolderId);
        out.push({ id: row._id, title: row.title, place: row.place, worldKey: world?.worldKey ?? "", as });
      }
    }
    return out;
  },
});

/** How many locked prompts a world has (the styles page shows its button only then). */
export const countLockedPrompts = ownerQuery({
  args: { ownerUserId: v.string(), world: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const root = await resolveWorld(ctx, args.ownerUserId, args.world);
    return (await promptsOfWorld(ctx, args.ownerUserId, root._id)).filter((row) => !row.archivedAt).length;
  },
});
