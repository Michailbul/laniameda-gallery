import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { signedOwnerMutation as ownerMutation, signedOwnerQuery as ownerQuery } from "./actor";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import { resolveAssetThumbUrl, resolveAssetUrl } from "./r2_url";
import {
  characterDocValidator, characterLaneValidator, characterLinkRoleValidator, characterStatusValidator,
} from "./characterValidators";
import {
  deriveCharacterPrefix, formatCharacterCode, formatCostumeCode, normalizeCharacterName,
  normalizeCharacterPrefix, parseCharacterCode, parseCostumeCode,
} from "../lib/character-codes";

type Character = Doc<"characters">;
type LinkRole = Doc<"characterAssets">["role"];

const MAX_LINKS_PER_CALL = 100;

const text = (value: string | null | undefined, max: number, label: string) => {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > max) throw new ConvexError(`${label} is limited to ${max} characters.`);
  return trimmed;
};
const tagName = (value: string | null | undefined) => {
  const normalized = value?.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  return normalized || undefined;
};
const names = (values: string[] | undefined) => {
  const cleaned = [...new Set((values ?? []).map((name) => text(name, 80, "Another name")).filter((name): name is string => Boolean(name)))];
  if (cleaned.length > 12) throw new ConvexError("A character keeps at most 12 other names.");
  return cleaned;
};

const prefixFrom = (input: string) => {
  try { return normalizeCharacterPrefix(input); } catch (error) { throw new ConvexError((error as Error).message); }
};

// Optional patch fields: undefined keeps the stored value, null clears it.
const clearableText = v.optional(v.union(v.string(), v.null()));
const clearableAsset = v.optional(v.union(v.id("assets"), v.null()));

const requireWorld = async (ctx: QueryCtx, owner: string, folderId: Id<"folders">) => {
  const folder = await ctx.db.get(folderId);
  if (!folder || !canActorAccessOwnerUserId(owner, folder.ownerUserId)) throw new ConvexError("World collection not found.");
  if (folder.parentFolderId || folder.kind === "storybook") {
    throw new ConvexError("A character's world is a root collection, not a child folder or storybook.");
  }
  return folder;
};

const requireAsset = async (ctx: QueryCtx, owner: string, assetId: Id<"assets">) => {
  const asset = await ctx.db.get(assetId);
  if (!asset || !canActorAccessOwnerUserId(owner, asset.ownerUserId)) throw new ConvexError(`Asset not found: asset:${assetId}`);
  return asset;
};

const ownedCharacter = (owner: string, character: Character | null) => {
  if (!character || !canActorAccessOwnerUserId(owner, character.ownerUserId)) throw new ConvexError("Character not found.");
  return character;
};

// A character is addressed by its code (DA-CH-001), its document ID, or
// "character:<id>". Codes are unique per owner.
const resolveCharacter = async (ctx: QueryCtx, owner: string, ref: string) => {
  const parsed = parseCharacterCode(ref);
  if (parsed) {
    for (const candidate of resolveUserIdCandidates(owner)) {
      const row = await ctx.db.query("characters").withIndex("by_owner_code", (q) => q.eq("ownerUserId", candidate).eq("code", parsed.code)).unique();
      if (row) return row;
    }
    throw new ConvexError(`Character not found: ${parsed.code}`);
  }
  const id = ctx.db.normalizeId("characters", ref.trim().replace(/^character:/, ""));
  return ownedCharacter(owner, id ? await ctx.db.get(id) : null);
};

const findByName = async (ctx: QueryCtx, owner: string, worldFolderId: Id<"folders">, normalizedName: string) => {
  for (const candidate of resolveUserIdCandidates(owner)) {
    const row = await ctx.db.query("characters")
      .withIndex("by_owner_world_normalizedName", (q) => q.eq("ownerUserId", candidate).eq("worldFolderId", worldFolderId).eq("normalizedName", normalizedName))
      .first();
    if (row) return row;
  }
  return null;
};

const findWorldCounter = async (ctx: QueryCtx, owner: string, folderId: Id<"folders">) => {
  for (const candidate of resolveUserIdCandidates(owner)) {
    const row = await ctx.db.query("characterWorlds").withIndex("by_owner_folder", (q) => q.eq("ownerUserId", candidate).eq("folderId", folderId)).unique();
    if (row) return row;
  }
  return null;
};

const findPrefixOwner = async (ctx: QueryCtx, owner: string, prefix: string) => {
  for (const candidate of resolveUserIdCandidates(owner)) {
    const row = await ctx.db.query("characterWorlds").withIndex("by_owner_prefix", (q) => q.eq("ownerUserId", candidate).eq("prefix", prefix)).first();
    if (row) return row;
  }
  return null;
};

// Upserts the one link row for (character, asset). Returns the change made.
const upsertLink = async (
  ctx: MutationCtx, character: Character, assetId: Id<"assets">,
  role: LinkRole, costumeCode: string | undefined, note?: string,
): Promise<"created" | "updated" | "unchanged"> => {
  const existing = await ctx.db.query("characterAssets")
    .withIndex("by_character_asset", (q) => q.eq("characterId", character._id).eq("assetId", assetId)).first();
  if (!existing) {
    await ctx.db.insert("characterAssets", {
      ownerUserId: character.ownerUserId, characterId: character._id, assetId, role,
      ...(costumeCode ? { costumeCode } : {}), ...(note ? { note } : {}), createdAt: Date.now(),
    });
    return "created";
  }
  const next = { role, costumeCode: costumeCode ?? existing.costumeCode, note: note ?? existing.note };
  if (next.role === existing.role && next.costumeCode === existing.costumeCode && next.note === existing.note) return "unchanged";
  await ctx.db.patch(existing._id, next);
  return "updated";
};

// Clears every sheet/face pointer (master and costumes) that names an asset
// which is no longer linked.
const withoutAssetPointers = (character: Character, assetIds: Set<string>) => {
  const drop = (id: Id<"assets"> | undefined) => (id && assetIds.has(id) ? undefined : id);
  return {
    sheetAssetId: drop(character.sheetAssetId),
    faceAssetId: drop(character.faceAssetId),
    costumes: character.costumes.map((costume) => ({ ...costume, sheetAssetId: drop(costume.sheetAssetId), faceAssetId: drop(costume.faceAssetId) })),
  };
};

const countLinks = async (ctx: QueryCtx, characterId: Id<"characters">) =>
  (await ctx.db.query("characterAssets").withIndex("by_character_createdAt", (q) => q.eq("characterId", characterId)).collect()).length;

const costumeFor = (character: Character, input: string | undefined) => {
  if (!input?.trim()) return undefined;
  const code = parseCostumeCode(input, character.code);
  const costume = code ? character.costumes.find((entry) => entry.code === code) : undefined;
  if (!costume) throw new ConvexError(`${character.code} has no costume ${input.trim()}.`);
  return costume.code;
};

const searchable = (character: Character) => [
  character.code, character.name, character.alias, character.role, character.nameTag, character.notes,
  ...character.otherNames, ...character.costumes.flatMap((costume) => [`${character.code}-${costume.code}`, costume.name]),
].filter(Boolean).join("\n").toLowerCase();

const thumbFor = async (ctx: QueryCtx, owner: string, assetId: Id<"assets"> | undefined) => {
  if (!assetId) return undefined;
  const asset = await ctx.db.get(assetId);
  if (!asset || !canActorAccessOwnerUserId(owner, asset.ownerUserId)) return undefined;
  return await resolveAssetThumbUrl(ctx, asset);
};

const summaryValidator = v.object({
  character: characterDocValidator,
  worldName: v.optional(v.string()),
  sheetThumbUrl: v.optional(v.string()),
  faceThumbUrl: v.optional(v.string()),
});

export const listCharacters = ownerQuery({
  args: {
    ownerUserId: v.string(), worldFolderId: v.optional(v.id("folders")),
    status: v.optional(characterStatusValidator), search: v.optional(v.string()), limit: v.optional(v.number()),
  },
  returns: v.array(summaryValidator),
  handler: async (ctx, args) => {
    const limit = Math.min(1000, Math.max(1, Math.floor(args.limit ?? 500)));
    const rows: Character[] = [];
    for (const owner of resolveUserIdCandidates(args.ownerUserId)) {
      rows.push(...await (args.worldFolderId
        ? ctx.db.query("characters").withIndex("by_owner_world_number", (q) => q.eq("ownerUserId", owner).eq("worldFolderId", args.worldFolderId!))
        : ctx.db.query("characters").withIndex("by_owner_updatedAt", (q) => q.eq("ownerUserId", owner))
      ).collect());
    }
    const terms = args.search?.trim().toLowerCase().split(/\s+/).filter(Boolean) ?? [];
    const matches = [...new Map(rows.map((row) => [row._id, row])).values()]
      .filter((row) => !args.status || row.status === args.status)
      .filter((row) => { const haystack = searchable(row); return terms.every((term) => haystack.includes(term)); })
      .sort((a, b) => a.prefix.localeCompare(b.prefix) || a.number - b.number)
      .slice(0, limit);
    const worldNames = new Map<string, string | undefined>();
    const results = [];
    for (const character of matches) {
      if (!worldNames.has(character.worldFolderId)) worldNames.set(character.worldFolderId, (await ctx.db.get(character.worldFolderId))?.name);
      results.push({
        character, worldName: worldNames.get(character.worldFolderId),
        sheetThumbUrl: await thumbFor(ctx, args.ownerUserId, character.sheetAssetId),
        faceThumbUrl: await thumbFor(ctx, args.ownerUserId, character.faceAssetId),
      });
    }
    return results;
  },
});

const linkedAssetValidator = v.object({
  kind: v.union(v.literal("image"), v.literal("video")),
  url: v.optional(v.string()), thumbUrl: v.optional(v.string()),
  width: v.optional(v.number()), height: v.optional(v.number()),
  description: v.optional(v.string()), agentDescription: v.optional(v.string()),
});

export const getCharacter = ownerQuery({
  args: { ownerUserId: v.string(), character: v.string() },
  returns: v.object({
    character: characterDocValidator,
    worldName: v.optional(v.string()),
    links: v.array(v.object({
      _id: v.id("characterAssets"), assetId: v.id("assets"), role: characterLinkRoleValidator,
      costumeCode: v.optional(v.string()), note: v.optional(v.string()), createdAt: v.number(),
      asset: v.union(linkedAssetValidator, v.null()),
    })),
  }),
  handler: async (ctx, args) => {
    const character = await resolveCharacter(ctx, args.ownerUserId, args.character);
    const world = await ctx.db.get(character.worldFolderId);
    const rows = await ctx.db.query("characterAssets").withIndex("by_character_createdAt", (q) => q.eq("characterId", character._id)).collect();
    const links = [];
    for (const row of rows) {
      const asset = await ctx.db.get(row.assetId);
      const visible = asset && canActorAccessOwnerUserId(args.ownerUserId, asset.ownerUserId) ? asset : null;
      links.push({
        _id: row._id, assetId: row.assetId, role: row.role, costumeCode: row.costumeCode, note: row.note, createdAt: row.createdAt,
        asset: visible ? {
          kind: visible.kind, url: await resolveAssetUrl(ctx, visible), thumbUrl: await resolveAssetThumbUrl(ctx, visible),
          width: visible.width, height: visible.height, description: visible.description, agentDescription: visible.agentDescription,
        } : null,
      });
    }
    return { character, worldName: world?.name, links };
  },
});

export const listCharactersForAsset = ownerQuery({
  args: { ownerUserId: v.string(), assetId: v.id("assets") },
  returns: v.array(v.object({
    characterId: v.id("characters"), code: v.string(), name: v.string(), alias: v.optional(v.string()),
    role: characterLinkRoleValidator, costumeCode: v.optional(v.string()),
  })),
  handler: async (ctx, args) => {
    const links = await ctx.db.query("characterAssets").withIndex("by_asset", (q) => q.eq("assetId", args.assetId)).collect();
    const results = [];
    for (const link of links) {
      if (!canActorAccessOwnerUserId(args.ownerUserId, link.ownerUserId)) continue;
      const character = await ctx.db.get(link.characterId);
      if (!character) continue;
      results.push({ characterId: character._id, code: character.code, name: character.name, alias: character.alias, role: link.role, costumeCode: link.costumeCode });
    }
    return results.sort((a, b) => a.code.localeCompare(b.code));
  },
});

const writeResult = v.object({ id: v.id("characters"), code: v.string(), created: v.boolean(), revision: v.number() });

export const createCharacter = ownerMutation({
  args: {
    ownerUserId: v.string(), worldFolderId: v.id("folders"), name: v.string(),
    alias: v.optional(v.string()), otherNames: v.optional(v.array(v.string())), role: v.optional(v.string()),
    lane: v.optional(characterLaneValidator), status: v.optional(characterStatusValidator),
    sheetAssetId: v.optional(v.id("assets")), faceAssetId: v.optional(v.id("assets")),
    nameTag: v.optional(v.string()), notes: v.optional(v.string()), prefix: v.optional(v.string()),
  },
  returns: writeResult,
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const world = await requireWorld(ctx, owner, args.worldFolderId);
    const name = text(args.name, 80, "Name");
    if (!name) throw new ConvexError("A character needs a name.");
    const alias = text(args.alias, 120, "Alias");
    const normalizedName = normalizeCharacterName(name, alias);
    // Same name in the same world is the same person: a retried create
    // returns the existing record instead of minting a second code.
    const existing = await findByName(ctx, owner, world._id, normalizedName);
    if (existing) return { id: existing._id, code: existing.code, created: false, revision: existing.revision };
    for (const assetId of [args.sheetAssetId, args.faceAssetId]) if (assetId) await requireAsset(ctx, owner, assetId);

    let counter = await findWorldCounter(ctx, owner, world._id);
    const now = Date.now();
    if (counter && args.prefix?.trim() && prefixFrom(args.prefix) !== counter.prefix) {
      throw new ConvexError(`${world.name} already uses the prefix ${counter.prefix}.`);
    }
    if (!counter) {
      const prefix = args.prefix?.trim() ? prefixFrom(args.prefix) : deriveCharacterPrefix(world.name);
      if (!prefix) throw new ConvexError(`Supply a prefix for ${world.name} (2 to 4 capital letters, e.g. DA).`);
      const taken = await findPrefixOwner(ctx, owner, prefix);
      if (taken) throw new ConvexError(`The prefix ${prefix} belongs to another world. Supply a different prefix.`);
      const counterId = await ctx.db.insert("characterWorlds", { ownerUserId: owner, folderId: world._id, prefix, lastNumber: 0, createdAt: now, updatedAt: now });
      counter = (await ctx.db.get(counterId))!;
    }
    const number = counter.lastNumber + 1;
    await ctx.db.patch(counter._id, { lastNumber: number, updatedAt: now });
    const code = formatCharacterCode(counter.prefix, number);
    const id = await ctx.db.insert("characters", {
      ownerUserId: owner, worldFolderId: world._id, code, prefix: counter.prefix, number,
      name, alias, normalizedName, otherNames: names(args.otherNames), role: text(args.role, 120, "Role"),
      lane: args.lane, status: args.status ?? "concept", sheetAssetId: args.sheetAssetId, faceAssetId: args.faceAssetId,
      nameTag: tagName(args.nameTag), notes: text(args.notes, 20_000, "Notes"),
      costumes: [], lastCostumeNumber: 0, linkCount: 0, revision: 1, createdAt: now, updatedAt: now,
    });
    const character = (await ctx.db.get(id))!;
    if (args.sheetAssetId) await upsertLink(ctx, character, args.sheetAssetId, "sheet", undefined);
    if (args.faceAssetId) await upsertLink(ctx, character, args.faceAssetId, "face", undefined);
    if (args.sheetAssetId || args.faceAssetId) await ctx.db.patch(id, { linkCount: await countLinks(ctx, id) });
    return { id, code, created: true, revision: 1 };
  },
});

export const updateCharacter = ownerMutation({
  args: {
    ownerUserId: v.string(), character: v.string(), expectedRevision: v.number(),
    name: v.optional(v.string()), alias: clearableText, otherNames: v.optional(v.array(v.string())),
    role: clearableText, lane: v.optional(v.union(characterLaneValidator, v.null())), status: v.optional(characterStatusValidator),
    sheetAssetId: clearableAsset, faceAssetId: clearableAsset,
    nameTag: clearableText, notes: clearableText,
  },
  returns: writeResult,
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const character = await resolveCharacter(ctx, owner, args.character);
    if (args.expectedRevision !== character.revision) throw new ConvexError(`${character.code} changed (revision ${character.revision}). Reload before saving.`);
    const name = args.name === undefined ? character.name : text(args.name, 80, "Name");
    if (!name) throw new ConvexError("A character needs a name.");
    const alias = args.alias === undefined ? character.alias : text(args.alias, 120, "Alias");
    const normalizedName = normalizeCharacterName(name, alias);
    if (normalizedName !== character.normalizedName) {
      const clash = await findByName(ctx, owner, character.worldFolderId, normalizedName);
      if (clash && clash._id !== character._id) throw new ConvexError(`${clash.code} already has that name in this world.`);
    }
    const sheetAssetId = args.sheetAssetId === undefined ? character.sheetAssetId : args.sheetAssetId ?? undefined;
    const faceAssetId = args.faceAssetId === undefined ? character.faceAssetId : args.faceAssetId ?? undefined;
    for (const assetId of [sheetAssetId, faceAssetId]) if (assetId) await requireAsset(ctx, owner, assetId);
    const patch = {
      name, alias, normalizedName,
      otherNames: args.otherNames === undefined ? character.otherNames : names(args.otherNames),
      role: args.role === undefined ? character.role : text(args.role, 120, "Role"),
      lane: args.lane === undefined ? character.lane : args.lane ?? undefined,
      status: args.status ?? character.status, sheetAssetId, faceAssetId,
      nameTag: args.nameTag === undefined ? character.nameTag : tagName(args.nameTag),
      notes: args.notes === undefined ? character.notes : text(args.notes, 20_000, "Notes"),
    };
    const unchanged = (Object.keys(patch) as (keyof typeof patch)[]).every((key) => JSON.stringify(patch[key]) === JSON.stringify(character[key]));
    if (unchanged) return { id: character._id, code: character.code, created: false, revision: character.revision };
    if (sheetAssetId && sheetAssetId !== character.sheetAssetId) await upsertLink(ctx, character, sheetAssetId, "sheet", undefined);
    if (faceAssetId && faceAssetId !== character.faceAssetId) await upsertLink(ctx, character, faceAssetId, "face", undefined);
    const revision = character.revision + 1;
    await ctx.db.patch(character._id, { ...patch, linkCount: await countLinks(ctx, character._id), revision, updatedAt: Date.now() });
    return { id: character._id, code: character.code, created: false, revision };
  },
});

export const saveCostume = ownerMutation({
  args: {
    ownerUserId: v.string(), character: v.string(), code: v.optional(v.string()), name: v.optional(v.string()),
    status: v.optional(characterStatusValidator), sheetAssetId: clearableAsset, faceAssetId: clearableAsset,
    notes: clearableText,
  },
  returns: v.object({ id: v.id("characters"), code: v.string(), costumeCode: v.string(), fullCode: v.string(), created: v.boolean(), revision: v.number() }),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const character = await resolveCharacter(ctx, owner, args.character);
    const name = text(args.name, 120, "Costume name");
    const byName = name ? character.costumes.find((costume) => costume.name.toLowerCase() === name.toLowerCase()) : undefined;
    const code = args.code?.trim() ? costumeFor(character, args.code) : byName?.code;
    const current = code ? character.costumes.find((costume) => costume.code === code) : undefined;
    if (!current && !name) throw new ConvexError("A new costume needs a name.");
    if (byName && current && byName.code !== current.code) throw new ConvexError(`${character.code}-${byName.code} already has that name.`);
    const sheetAssetId = args.sheetAssetId === undefined ? current?.sheetAssetId : args.sheetAssetId ?? undefined;
    const faceAssetId = args.faceAssetId === undefined ? current?.faceAssetId : args.faceAssetId ?? undefined;
    for (const assetId of [sheetAssetId, faceAssetId]) if (assetId) await requireAsset(ctx, owner, assetId);
    const costumeNumber = current ? undefined : character.lastCostumeNumber + 1;
    const costumeCode = current?.code ?? formatCostumeCode(costumeNumber!);
    const next = {
      code: costumeCode, name: name ?? current!.name, status: args.status ?? current?.status ?? "concept",
      sheetAssetId, faceAssetId,
      notes: args.notes === undefined ? current?.notes : text(args.notes, 5_000, "Costume notes"),
    };
    const fullCode = `${character.code}-${costumeCode}`;
    if (current && (Object.keys(next) as (keyof typeof next)[]).every((key) => next[key] === current[key])) {
      return { id: character._id, code: character.code, costumeCode, fullCode, created: false, revision: character.revision };
    }
    if (sheetAssetId && sheetAssetId !== current?.sheetAssetId) await upsertLink(ctx, character, sheetAssetId, "sheet", costumeCode);
    if (faceAssetId && faceAssetId !== current?.faceAssetId) await upsertLink(ctx, character, faceAssetId, "face", costumeCode);
    const costumes = current
      ? character.costumes.map((costume) => (costume.code === costumeCode ? next : costume))
      : [...character.costumes, next];
    const revision = character.revision + 1;
    await ctx.db.patch(character._id, {
      costumes, lastCostumeNumber: costumeNumber ?? character.lastCostumeNumber,
      linkCount: await countLinks(ctx, character._id), revision, updatedAt: Date.now(),
    });
    return { id: character._id, code: character.code, costumeCode, fullCode, created: !current, revision };
  },
});

export const removeCostume = ownerMutation({
  args: { ownerUserId: v.string(), character: v.string(), code: v.string() },
  returns: v.object({ id: v.id("characters"), revision: v.number(), relinked: v.number() }),
  handler: async (ctx, args) => {
    const character = await resolveCharacter(ctx, args.ownerUserId, args.character);
    const code = costumeFor(character, args.code)!;
    // Links stay on the person; they only lose the costume they pointed at.
    const links = await ctx.db.query("characterAssets").withIndex("by_character_createdAt", (q) => q.eq("characterId", character._id)).collect();
    let relinked = 0;
    for (const link of links) {
      if (link.costumeCode !== code) continue;
      await ctx.db.patch(link._id, { costumeCode: undefined });
      relinked += 1;
    }
    const revision = character.revision + 1;
    await ctx.db.patch(character._id, { costumes: character.costumes.filter((costume) => costume.code !== code), revision, updatedAt: Date.now() });
    return { id: character._id, revision, relinked };
  },
});

export const linkAssets = ownerMutation({
  args: {
    ownerUserId: v.string(), character: v.string(),
    links: v.array(v.object({
      assetId: v.id("assets"), role: characterLinkRoleValidator,
      costumeCode: v.optional(v.string()), note: v.optional(v.string()),
    })),
  },
  returns: v.object({ id: v.id("characters"), code: v.string(), created: v.number(), updated: v.number(), unchanged: v.number(), revision: v.number() }),
  handler: async (ctx, args) => {
    if (args.links.length === 0) throw new ConvexError("Supply at least one asset to link.");
    if (args.links.length > MAX_LINKS_PER_CALL) throw new ConvexError(`Link at most ${MAX_LINKS_PER_CALL} assets per call.`);
    const character = await resolveCharacter(ctx, args.ownerUserId, args.character);
    const counts = { created: 0, updated: 0, unchanged: 0 };
    for (const link of args.links) {
      await requireAsset(ctx, args.ownerUserId, link.assetId);
      const costumeCode = costumeFor(character, link.costumeCode);
      counts[await upsertLink(ctx, character, link.assetId, link.role, costumeCode, text(link.note, 500, "Link note"))] += 1;
    }
    if (counts.created === 0 && counts.updated === 0) return { id: character._id, code: character.code, ...counts, revision: character.revision };
    const revision = character.revision + 1;
    await ctx.db.patch(character._id, { linkCount: await countLinks(ctx, character._id), revision, updatedAt: Date.now() });
    return { id: character._id, code: character.code, ...counts, revision };
  },
});

export const unlinkAssets = ownerMutation({
  args: { ownerUserId: v.string(), character: v.string(), assetIds: v.array(v.id("assets")) },
  returns: v.object({ id: v.id("characters"), removed: v.number(), revision: v.number() }),
  handler: async (ctx, args) => {
    if (args.assetIds.length > MAX_LINKS_PER_CALL) throw new ConvexError(`Unlink at most ${MAX_LINKS_PER_CALL} assets per call.`);
    const character = await resolveCharacter(ctx, args.ownerUserId, args.character);
    const removedIds = new Set<string>();
    for (const assetId of new Set(args.assetIds)) {
      const link = await ctx.db.query("characterAssets").withIndex("by_character_asset", (q) => q.eq("characterId", character._id).eq("assetId", assetId)).first();
      if (!link) continue;
      await ctx.db.delete(link._id);
      removedIds.add(assetId);
    }
    if (removedIds.size === 0) return { id: character._id, removed: 0, revision: character.revision };
    const revision = character.revision + 1;
    await ctx.db.patch(character._id, {
      ...withoutAssetPointers(character, removedIds), linkCount: await countLinks(ctx, character._id), revision, updatedAt: Date.now(),
    });
    return { id: character._id, removed: removedIds.size, revision };
  },
});

export const deleteCharacter = ownerMutation({
  args: { ownerUserId: v.string(), character: v.string() },
  returns: v.object({ code: v.string(), removedLinks: v.number() }),
  handler: async (ctx, args) => {
    const character = await resolveCharacter(ctx, args.ownerUserId, args.character);
    const links = await ctx.db.query("characterAssets").withIndex("by_character_createdAt", (q) => q.eq("characterId", character._id)).collect();
    for (const link of links) await ctx.db.delete(link._id);
    // The world counter keeps its number, so this code is never reissued.
    await ctx.db.delete(character._id);
    return { code: character.code, removedLinks: links.length };
  },
});

// Asset delete cascade (assets.ts): drop the asset's character links and any
// sheet/face pointer that named it. Media itself is never touched here.
export const detachAssetFromCharacters = async (ctx: MutationCtx, assetId: Id<"assets">) => {
  const links = await ctx.db.query("characterAssets").withIndex("by_asset", (q) => q.eq("assetId", assetId)).collect();
  for (const link of links) {
    await ctx.db.delete(link._id);
    const character = await ctx.db.get(link.characterId);
    if (!character) continue;
    await ctx.db.patch(character._id, {
      ...withoutAssetPointers(character, new Set([assetId])),
      linkCount: await countLinks(ctx, character._id), revision: character.revision + 1, updatedAt: Date.now(),
    });
  }
};
