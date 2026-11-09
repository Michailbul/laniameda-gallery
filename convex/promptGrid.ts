import { ConvexError, v, type Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { signedOwnerMutation as ownerMutation, signedOwnerQuery as ownerQuery } from "./actor";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import { buildR2PublicUrl, resolveAssetThumbUrl } from "./r2_url";
import { childrenOf, recordWorldChange, resolveWorld } from "./worldCore";
import { fileAssetsInWorld } from "./worlds";
import { batchRows } from "./mjQueue";
import { presetStatusValidator, runVerdictValidator } from "./promptGridValidators";
import { ART_DIRECTOR_SCOPE } from "./projectValidators";
import { GRID_LIMITS, composeCell, pacingEstimate, planGrid, variantsOf } from "../lib/prompt-grid";
import { parseFlags, templateWords } from "../lib/mj-recipe";
import { MJ_QUEUE_LIMITS, batchKeyOf, composeMjCommand, threadIdOf } from "../lib/mj-queue";
import { mjFilePrefix, mjIdentityOf, mjMatches, mjSourcePrefixes } from "../lib/world-styles";

// Prompt sets × style presets × seeds: the comparison grid of a project.
// Presets are exact recipes as frozen codes; a run writes one MJ Queue thread
// (screening cells first) that Michael sends himself, one job per click;
// frames that come back are filed with their exact cell and judged on the
// grid (rows = presets, columns = prompts). Art-director scope: owner only.

type Ctx = QueryCtx | MutationCtx;
type Preset = Doc<"stylePresets">;
type Locked = Doc<"lockedPrompts">;
type Run = Doc<"promptRuns">;

const ACTOR = "prompt grid";
const RESULTS_SHELF = "Run results";
const owned = <T extends { ownerUserId?: string }>(owner: string, row: T | null): row is T =>
  Boolean(row && canActorAccessOwnerUserId(owner, row.ownerUserId ?? ""));
const clip = (value: string | undefined | null, max: number) => value?.trim().slice(0, max) || undefined;
const journalArgs = { actor: v.optional(v.string()), session: v.optional(v.string()) };
const keyOf = (name: string) => name.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

const presetsOfWorld = async (ctx: Ctx, owner: string, worldId: Id<"folders">) => {
  const out: Preset[] = [];
  for (const candidate of resolveUserIdCandidates(owner)) {
    out.push(...await ctx.db.query("stylePresets").withIndex("by_owner_world_updatedAt", (q) => q.eq("ownerUserId", candidate).eq("worldFolderId", worldId)).take(500));
  }
  return out;
};
const setsOfWorld = async (ctx: Ctx, owner: string, worldId: Id<"folders">) => {
  const out: Doc<"promptSets">[] = [];
  for (const candidate of resolveUserIdCandidates(owner)) {
    out.push(...await ctx.db.query("promptSets").withIndex("by_owner_world_updatedAt", (q) => q.eq("ownerUserId", candidate).eq("worldFolderId", worldId)).take(200));
  }
  return out;
};

const idOrKey = (ref: string, prefix: RegExp) => ref.trim().replace(prefix, "");

const presetRef = async (ctx: Ctx, owner: string, ref: string): Promise<Preset> => {
  const value = idOrKey(ref, /^preset:/);
  const id = ctx.db.normalizeId("stylePresets", value);
  const byId = id ? await ctx.db.get(id) : null;
  if (owned(owner, byId)) return byId;
  for (const candidate of resolveUserIdCandidates(owner)) {
    const row = await ctx.db.query("stylePresets").withIndex("by_owner_ingestKey", (q) => q.eq("ownerUserId", candidate).eq("ingestKey", value)).first();
    if (row) return row;
  }
  throw new ConvexError(`No style preset "${ref}". list_style_presets lists them.`);
};
const setRef = async (ctx: Ctx, owner: string, ref: string): Promise<Doc<"promptSets">> => {
  const value = idOrKey(ref, /^set:/);
  const id = ctx.db.normalizeId("promptSets", value);
  const byId = id ? await ctx.db.get(id) : null;
  if (owned(owner, byId)) return byId;
  for (const candidate of resolveUserIdCandidates(owner)) {
    const row = await ctx.db.query("promptSets").withIndex("by_owner_ingestKey", (q) => q.eq("ownerUserId", candidate).eq("ingestKey", value)).first();
    if (row) return row;
  }
  throw new ConvexError(`No prompt set "${ref}". list_prompt_sets lists them.`);
};
const promptRef = async (ctx: Ctx, owner: string, ref: string): Promise<Locked> => {
  const value = idOrKey(ref, /^(lp|locked):/);
  const id = ctx.db.normalizeId("lockedPrompts", value);
  const byId = id ? await ctx.db.get(id) : null;
  if (owned(owner, byId)) return byId;
  for (const candidate of resolveUserIdCandidates(owner)) {
    const row = await ctx.db.query("lockedPrompts").withIndex("by_owner_ingestKey", (q) => q.eq("ownerUserId", candidate).eq("ingestKey", value)).first();
    if (row) return row;
  }
  throw new ConvexError(`No locked prompt "${ref}".`);
};

/* ── Presets ─────────────────────────────────────────────────────────────── */

const codeName = async (ctx: Ctx, owner: string, code: string) => {
  for (const candidate of resolveUserIdCandidates(owner)) {
    const board = await ctx.db.query("moodboards").withIndex("by_owner_mjCode", (q) => q.eq("ownerUserId", candidate).eq("mjCode", code)).first();
    if (board) return { kind: "moodboard" as const, id: board._id, name: board.name };
    const profile = await ctx.db.query("mjProfiles").withIndex("by_owner_code", (q) => q.eq("ownerUserId", candidate).eq("code", code)).first();
    if (profile) return { kind: "profile" as const, id: profile._id, name: profile.name };
  }
  return null;
};

const presetOut = v.object({
  id: v.id("stylePresets"), ingestKey: v.string(), name: v.string(), status: presetStatusValidator,
  source: v.string(), styleId: v.optional(v.id("worldStyles")), parentPresetId: v.optional(v.id("stylePresets")), perturbation: v.optional(v.string()),
  moodboards: v.array(v.object({ code: v.string(), name: v.optional(v.string()) })),
  profiles: v.array(v.object({ code: v.string(), name: v.optional(v.string()) })),
  srefs: v.array(v.object({ code: v.string(), sv: v.optional(v.string()), weight: v.optional(v.number()) })),
  parameters: v.optional(v.string()), sentence: v.optional(v.string()), note: v.optional(v.string()),
  revision: v.number(), updatedAt: v.number(),
});
const toPresetOut = (row: Preset) => ({
  id: row._id, ingestKey: row.ingestKey, name: row.name, status: row.status, source: row.source, styleId: row.styleId,
  parentPresetId: row.parentPresetId, perturbation: row.perturbation,
  moodboards: row.moodboards.map((m) => ({ code: m.code, name: m.name })), profiles: row.profiles.map((p) => ({ code: p.code, name: p.name })),
  srefs: row.srefs, parameters: row.parameters, sentence: row.sentence, note: row.note, revision: row.revision, updatedAt: row.updatedAt,
});

export const listPresets = ownerQuery({
  args: { ownerUserId: v.string(), world: v.string(), includeArchived: v.optional(v.boolean()) },
  returns: v.array(presetOut),
  handler: async (ctx, args) => {
    const root = await resolveWorld(ctx, args.ownerUserId, args.world);
    const rows = (await presetsOfWorld(ctx, args.ownerUserId, root._id)).filter((row) => args.includeArchived || row.status !== "archived");
    // Parents first, each followed by its perturbations.
    const parents = rows.filter((row) => !row.parentPresetId).sort((a, b) => a.name.localeCompare(b.name));
    const out: Preset[] = [];
    for (const parent of parents) out.push(parent, ...rows.filter((row) => row.parentPresetId === parent._id).sort((a, b) => a.name.localeCompare(b.name)));
    out.push(...rows.filter((row) => row.parentPresetId && !out.includes(row)));
    return out.map(toPresetOut);
  },
});

type PresetContent = Pick<Preset, "name" | "moodboards" | "profiles" | "srefs" | "parameters" | "sentence" | "note" | "status" | "styleId" | "parentPresetId" | "perturbation">;

const writePreset = async (ctx: MutationCtx, owner: string, root: Doc<"folders">, ingestKey: string, content: PresetContent, source: Preset["source"], meta: { actor?: string; session?: string }) => {
  if (content.moodboards.length + content.profiles.length + content.srefs.length === 0 && !content.parameters?.trim()) {
    throw new ConvexError("A preset needs at least a moodboard, a profile, an sref or parameters.");
  }
  let existing: Preset | null = null;
  for (const candidate of resolveUserIdCandidates(owner)) {
    existing ??= await ctx.db.query("stylePresets").withIndex("by_owner_ingestKey", (q) => q.eq("ownerUserId", candidate).eq("ingestKey", ingestKey)).first();
  }
  const now = Date.now();
  if (existing) {
    const same = JSON.stringify({ ...content }) === JSON.stringify({
      name: existing.name, moodboards: existing.moodboards, profiles: existing.profiles, srefs: existing.srefs, parameters: existing.parameters,
      sentence: existing.sentence, note: existing.note, status: existing.status, styleId: existing.styleId, parentPresetId: existing.parentPresetId, perturbation: existing.perturbation,
    });
    if (same) return { presetId: existing._id, created: false, changed: false };
    await ctx.db.patch(existing._id, { ...content, revision: existing.revision + 1, updatedAt: now });
    await recordWorldChange(ctx, { ownerUserId: existing.ownerUserId, worldFolderId: root._id, op: "preset.save", targetType: "stylePreset", targetId: existing._id, summary: `Updated style preset "${content.name}"`, before: existing, after: content, actor: meta.actor ?? ACTOR, session: meta.session });
    return { presetId: existing._id, created: false, changed: true };
  }
  const presetId = await ctx.db.insert("stylePresets", {
    ownerUserId: root.ownerUserId ?? owner, worldFolderId: root._id, ingestKey, ...content, source,
    revision: 1, createdBy: meta.actor?.slice(0, 80) || "agent", createdAt: now, updatedAt: now,
  });
  await recordWorldChange(ctx, { ownerUserId: root.ownerUserId ?? owner, worldFolderId: root._id, op: "preset.save", targetType: "stylePreset", targetId: presetId, summary: `Added style preset "${content.name}"${content.perturbation ? ` (${content.perturbation})` : ""}`, before: null, after: content, actor: meta.actor ?? ACTOR, session: meta.session });
  return { presetId, created: true, changed: true };
};

const codesIn = async (ctx: Ctx, owner: string, codes: string[]) => {
  const moodboards: PresetContent["moodboards"] = [];
  const profiles: PresetContent["profiles"] = [];
  for (const raw of codes) {
    const code = raw.trim().replace(/^--?p(rofile)?\s+/, "");
    if (!code || !/^[A-Za-z0-9]{3,40}$/.test(code)) continue;
    const hit = await codeName(ctx, owner, code);
    if (hit?.kind === "moodboard") moodboards.push({ code, moodboardId: hit.id, name: hit.name });
    else profiles.push({ code, profileId: hit?.kind === "profile" ? hit.id : undefined, name: hit?.name });
  }
  return { moodboards, profiles };
};

/** srefs and their --sv out of a parameter line; the rest of it back. */
const splitParams = (parameters?: string) => {
  const flags = parseFlags(parameters);
  const sv = flags.find((flag) => flag.name === "sv")?.values[0];
  const srefs = flags.filter((flag) => flag.name === "sref").flatMap((flag) => flag.values).map((value) => {
    const [code, weight] = value.split("::");
    return { code: code!, sv, weight: weight ? Number(weight) : undefined };
  });
  const profileCodes = flags.filter((flag) => flag.name === "profile" || flag.name === "p").flatMap((flag) => flag.values);
  const rest = flags.filter((flag) => !["sref", "sv", "profile", "p", "seed"].includes(flag.name)).map((flag) => [`--${flag.name}`, ...flag.values].join(" ")).join(" ");
  return { srefs, profileCodes, rest: rest || undefined };
};

export const savePreset = ownerMutation({
  args: {
    ownerUserId: v.string(), world: v.string(),
    preset: v.optional(v.string()), ingestKey: v.optional(v.string()),
    name: v.optional(v.string()),
    // Codes as Michael pastes them: moodboard and profile codes (resolved and named), srefs with optional --sv.
    codes: v.optional(v.array(v.string())),
    srefs: v.optional(v.array(v.object({ code: v.string(), sv: v.optional(v.string()), weight: v.optional(v.number()) }))),
    parameters: v.optional(v.union(v.string(), v.null())),
    sentence: v.optional(v.union(v.string(), v.null())),
    note: v.optional(v.union(v.string(), v.null())),
    status: v.optional(presetStatusValidator),
    ...journalArgs,
  },
  returns: v.object({ presetId: v.id("stylePresets"), created: v.boolean(), changed: v.boolean() }),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const root = await resolveWorld(ctx, owner, args.world);
    const existing = args.preset ? await presetRef(ctx, owner, args.preset) : null;
    const name = clip(args.name, 100) ?? existing?.name;
    if (!name) throw new ConvexError("Name the preset (CAS STORYBOOK · stylize 750).");
    const split = splitParams(args.parameters ?? undefined);
    const codes = args.codes ? await codesIn(ctx, owner, [...args.codes, ...split.profileCodes]) : split.profileCodes.length ? await codesIn(ctx, owner, split.profileCodes) : null;
    const content: PresetContent = {
      name,
      moodboards: codes?.moodboards ?? existing?.moodboards ?? [],
      profiles: codes?.profiles ?? existing?.profiles ?? [],
      srefs: args.srefs ?? (split.srefs.length ? split.srefs : existing?.srefs ?? []),
      parameters: args.parameters === null ? undefined : args.parameters !== undefined ? split.rest : existing?.parameters,
      sentence: args.sentence === null ? undefined : clip(args.sentence, 300) ?? existing?.sentence,
      note: args.note === null ? undefined : clip(args.note, 1000) ?? existing?.note,
      status: args.status ?? existing?.status ?? "candidate",
      styleId: existing?.styleId, parentPresetId: existing?.parentPresetId, perturbation: existing?.perturbation,
    };
    const ingestKey = existing?.ingestKey ?? clip(args.ingestKey, 200) ?? `${root.worldKey}:preset:${keyOf(name)}`;
    return await writePreset(ctx, owner, root, ingestKey, content, existing?.source ?? "gallery", args);
  },
});

/** A world style's recipe as a preset (frozen codes read from its boards and profiles now). */
export const presetFromStyle = ownerMutation({
  args: { ownerUserId: v.string(), world: v.string(), style: v.string(), recipe: v.optional(v.number()), name: v.optional(v.string()), ...journalArgs },
  returns: v.object({ presetId: v.id("stylePresets"), created: v.boolean(), changed: v.boolean() }),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const root = await resolveWorld(ctx, owner, args.world);
    const value = args.style.trim().replace(/^style:/, "");
    let style = ctx.db.normalizeId("worldStyles", value) ? await ctx.db.get(ctx.db.normalizeId("worldStyles", value)!) : null;
    if (!style) {
      for (const candidate of resolveUserIdCandidates(owner)) {
        style ??= await ctx.db.query("worldStyles").withIndex("by_owner_world_slug", (q) => q.eq("ownerUserId", candidate).eq("worldFolderId", root._id).eq("slug", keyOf(value))).first();
      }
    }
    if (!owned(owner, style)) throw new ConvexError(`No style "${args.style}".`);
    const index = args.recipe ?? 0;
    const recipe = style.recipes[index];
    if (!recipe) throw new ConvexError(`${style.name} has no recipe ${index + 1}.`);
    const moodboards: PresetContent["moodboards"] = [];
    for (const id of recipe.moodboardIds) {
      const board = await ctx.db.get(id);
      const code = board?.mjCode ?? (board?.mjMoodboardId ? `m${board.mjMoodboardId}` : undefined);
      if (board && code) moodboards.push({ code, moodboardId: board._id, name: board.name });
    }
    const profiles: PresetContent["profiles"] = [];
    for (const id of recipe.profileIds) {
      const profile = await ctx.db.get(id);
      if (profile) profiles.push({ code: profile.code, profileId: profile._id, name: profile.name });
    }
    const fromParams = splitParams([recipe.parameters, ...parseFlags(recipe.template).filter((f) => f.name === "profile" || f.name === "p").map((f) => `--profile ${f.values.join(" ")}`)].filter(Boolean).join(" "));
    const loose = await codesIn(ctx, owner, [...fromParams.profileCodes, ...(recipe.unknownCodes ?? []).filter((code) => !code.startsWith("-"))]);
    for (const m of loose.moodboards) if (!moodboards.some((row) => row.code === m.code)) moodboards.push(m);
    for (const p of loose.profiles) if (!profiles.some((row) => row.code === p.code) && !moodboards.some((row) => row.code === p.code)) profiles.push(p);
    const srefs = [...fromParams.srefs];
    for (const code of recipe.unknownCodes ?? []) {
      const m = /^--sref\s+(\S+)/.exec(code);
      if (m && !srefs.some((row) => row.code === m[1])) srefs.push({ code: m[1]!, sv: undefined, weight: undefined });
    }
    const words = templateWords(recipe.template);
    const lead = words && /\[subject\]/i.test(words) ? words.split(/\[subject\]/i)[0]!.trim() : "";
    const name = clip(args.name, 100) ?? (style.recipes.length > 1 ? `${style.name} · ${recipe.name ?? `recipe ${index + 1}`}` : style.name);
    return await writePreset(ctx, owner, root, `${root.worldKey}:preset:style:${style._id}:${index}`, {
      name, moodboards, profiles, srefs, parameters: fromParams.rest, sentence: lead || undefined, note: style.line,
      status: style.status === "ready" ? "locked" : "candidate", styleId: style._id, parentPresetId: undefined, perturbation: undefined,
    }, "style", args);
  },
});

const perturbationValidator = v.object({
  kind: v.union(v.literal("board_alone"), v.literal("sref_only"), v.literal("add_profile"), v.literal("drop_profiles"), v.literal("stylize"), v.literal("raw"), v.literal("chaos"), v.literal("sv"), v.literal("version")),
  value: v.optional(v.string()),
});

/** Perturbations of a preset, each a preset of its own ("CAS STORYBOOK · stylize 750"). */
export const perturbPreset = ownerMutation({
  args: { ownerUserId: v.string(), world: v.string(), preset: v.string(), perturbations: v.array(perturbationValidator), ...journalArgs },
  returns: v.array(v.object({ presetId: v.id("stylePresets"), name: v.string(), created: v.boolean() })),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const root = await resolveWorld(ctx, owner, args.world);
    const base = await presetRef(ctx, owner, args.preset);
    if (args.perturbations.length > 12) throw new ConvexError("At most 12 perturbations per call.");
    const out = [];
    for (const change of args.perturbations) {
      const flags = parseFlags(base.parameters);
      const setFlag = (name: string, value?: string) => {
        const rest = flags.filter((flag) => flag.name !== name && !(name === "stylize" && flag.name === "s"));
        return [...rest.map((flag) => [`--${flag.name}`, ...flag.values].join(" ")), ...(value === undefined ? [] : [`--${name}${value ? ` ${value}` : ""}`])].join(" ") || undefined;
      };
      let content: PresetContent = { name: base.name, moodboards: base.moodboards, profiles: base.profiles, srefs: base.srefs, parameters: base.parameters, sentence: base.sentence, note: base.note, status: "candidate", styleId: undefined, parentPresetId: base._id, perturbation: "" };
      let label = "";
      if (change.kind === "board_alone") { content = { ...content, profiles: [], srefs: [] }; label = "board alone"; }
      else if (change.kind === "sref_only") { content = { ...content, moodboards: [], profiles: [] }; label = "sref only"; }
      else if (change.kind === "drop_profiles") { content = { ...content, profiles: [] }; label = "no profiles"; }
      else if (change.kind === "add_profile") {
        const code = change.value?.trim();
        if (!code) throw new ConvexError("add_profile needs value: a profile code.");
        const hit = await codeName(ctx, owner, code);
        content = { ...content, profiles: [...content.profiles.filter((p) => p.code !== code), { code, profileId: hit?.kind === "profile" ? hit.id : undefined, name: hit?.name }] };
        label = `+ ${hit?.name ?? code}`;
      } else if (change.kind === "stylize") { content = { ...content, parameters: setFlag("stylize", change.value ?? "250") }; label = `stylize ${change.value ?? "250"}`; }
      else if (change.kind === "chaos") { content = { ...content, parameters: setFlag("chaos", change.value ?? "5") }; label = `chaos ${change.value ?? "5"}`; }
      else if (change.kind === "version") { content = { ...content, parameters: setFlag("v", change.value ?? "8.1") }; label = `v ${change.value ?? "8.1"}`; }
      else if (change.kind === "raw") {
        const on = change.value !== "off";
        content = { ...content, parameters: on ? setFlag("raw", "") : setFlag("raw") };
        label = on ? "raw on" : "raw off";
      } else if (change.kind === "sv") {
        if (!content.srefs.length) throw new ConvexError(`${base.name} has no sref to set --sv on.`);
        content = { ...content, srefs: content.srefs.map((sref) => ({ ...sref, sv: change.value ?? "6" })) };
        label = `sv ${change.value ?? "6"}`;
      }
      content = { ...content, name: `${base.name} · ${label}`.slice(0, 100), perturbation: label };
      const result = await writePreset(ctx, owner, root, `${base.ingestKey}~${keyOf(label)}`, content, "gallery", args);
      out.push({ presetId: result.presetId, name: content.name, created: result.created });
    }
    return out;
  },
});

/** A preset as save_style recipe input (moodboard/profile ids where known, the rest as codes): presets back to world styles. */
export const presetAsRecipe = ownerQuery({
  args: { ownerUserId: v.string(), preset: v.string() },
  returns: v.object({
    name: v.string(), world: v.string(), styleId: v.optional(v.id("worldStyles")),
    recipe: v.object({ name: v.optional(v.string()), moodboardIds: v.array(v.string()), profileIds: v.array(v.string()), unknownCodes: v.array(v.string()), parameters: v.optional(v.string()), template: v.optional(v.string()) }),
  }),
  handler: async (ctx, args) => {
    const preset = await presetRef(ctx, args.ownerUserId, args.preset);
    const world = await ctx.db.get(preset.worldFolderId);
    const sv = preset.srefs.map((s) => s.sv).find(Boolean);
    const parameters = [preset.parameters, sv && preset.srefs.length ? `--sv ${sv}` : ""].filter(Boolean).join(" ") || undefined;
    return {
      name: preset.name, world: world?.worldKey ?? "", styleId: preset.styleId,
      recipe: {
        name: preset.perturbation ?? "preset",
        moodboardIds: preset.moodboards.map((m) => m.moodboardId).filter(Boolean) as string[],
        profileIds: preset.profiles.map((p) => p.profileId).filter(Boolean) as string[],
        unknownCodes: [
          ...preset.moodboards.filter((m) => !m.moodboardId).map((m) => m.code),
          ...preset.profiles.filter((p) => !p.profileId).map((p) => p.code),
          ...preset.srefs.map((s) => `--sref ${s.code}${s.weight ? `::${s.weight}` : ""}`),
        ],
        parameters,
        template: preset.sentence ? `${preset.sentence} [subject]` : undefined,
      },
    };
  },
});

/** The extension dock's own presets (board, profiles, settings), kept as gallery presets of the world. */
export const importDockPresets = ownerMutation({
  args: { ownerUserId: v.string(), world: v.string(), presets: v.array(v.object({ id: v.string(), name: v.string(), codes: v.array(v.string()), params: v.optional(v.string()) })) },
  returns: v.object({ saved: v.number(), unchanged: v.number() }),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const root = await resolveWorld(ctx, owner, args.world);
    let saved = 0;
    let unchanged = 0;
    for (const entry of args.presets.slice(0, 32)) {
      const { moodboards, profiles } = await codesIn(ctx, owner, entry.codes);
      const split = splitParams(entry.params);
      if (!moodboards.length && !profiles.length && !split.rest) continue;
      const result = await writePreset(ctx, owner, root, `dock:${root.worldKey}:${entry.id.slice(0, 80)}`, {
        name: entry.name.trim().slice(0, 100) || "Dock preset", moodboards, profiles, srefs: split.srefs, parameters: split.rest,
        sentence: undefined, note: "From the Midjourney dock.", status: "candidate", styleId: undefined, parentPresetId: undefined, perturbation: undefined,
      }, "dock", { actor: "extension dock" });
      if (result.changed) saved += 1; else unchanged += 1;
    }
    return { saved, unchanged };
  },
});

/* ── Prompt sets ─────────────────────────────────────────────────────────── */

const setOut = v.object({
  id: v.id("promptSets"), ingestKey: v.string(), name: v.string(), kind: v.string(), note: v.optional(v.string()),
  prompts: v.array(v.object({ id: v.id("lockedPrompts"), title: v.string(), place: v.string(), variants: v.array(v.object({ key: v.string(), label: v.string(), kind: v.string(), seeds: v.array(v.number()) })), thumbUrl: v.optional(v.string()) })),
  revision: v.number(),
});

export const listPromptSets = ownerQuery({
  args: { ownerUserId: v.string(), world: v.string() },
  returns: v.array(setOut),
  handler: async (ctx, args) => {
    const root = await resolveWorld(ctx, args.ownerUserId, args.world);
    const sets = (await setsOfWorld(ctx, args.ownerUserId, root._id)).sort((a, b) => a.name.localeCompare(b.name));
    const out = [];
    for (const set of sets) {
      const prompts = [];
      for (const id of set.promptIds) {
        const row = await ctx.db.get(id);
        if (!row || row.archivedAt) continue;
        prompts.push({
          id: row._id, title: row.title, place: row.place,
          variants: variantsOf(row).map((variant) => ({ key: variant.key, label: variant.label, kind: variant.kind, seeds: variant.seeds })),
          thumbUrl: row.lockedFrame?.thumbUrl ?? row.imagePrompts[0]?.thumbUrl ?? row.attach?.[0]?.thumbUrl,
        });
      }
      out.push({ id: set._id, ingestKey: set.ingestKey, name: set.name, kind: set.kind, note: set.note, prompts, revision: set.revision });
    }
    return out;
  },
});

export const savePromptSet = ownerMutation({
  args: {
    ownerUserId: v.string(), world: v.string(), set: v.optional(v.string()), ingestKey: v.optional(v.string()),
    name: v.optional(v.string()), kind: v.optional(v.union(v.literal("test_shots"), v.literal("locations"), v.literal("custom"))),
    note: v.optional(v.union(v.string(), v.null())), prompts: v.optional(v.array(v.string())), ...journalArgs,
  },
  returns: v.object({ setId: v.id("promptSets"), created: v.boolean(), prompts: v.number() }),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const root = await resolveWorld(ctx, owner, args.world);
    let existing = args.set ? await setRef(ctx, owner, args.set) : null;
    const ingestKey = existing?.ingestKey ?? clip(args.ingestKey, 200) ?? (args.name ? `${root.worldKey}:set:${keyOf(args.name)}` : undefined);
    if (!existing && ingestKey) {
      for (const candidate of resolveUserIdCandidates(owner)) {
        existing ??= await ctx.db.query("promptSets").withIndex("by_owner_ingestKey", (q) => q.eq("ownerUserId", candidate).eq("ingestKey", ingestKey)).first();
      }
    }
    const name = clip(args.name, 100) ?? existing?.name;
    if (!name || !ingestKey) throw new ConvexError("A prompt set needs a name.");
    const promptIds: Id<"lockedPrompts">[] = [];
    if (args.prompts) {
      for (const ref of args.prompts) {
        const row = await promptRef(ctx, owner, ref);
        if (row.worldFolderId !== root._id) throw new ConvexError(`${row.title} is in another world.`);
        if (!promptIds.includes(row._id)) promptIds.push(row._id);
      }
    }
    const content = {
      name, kind: args.kind ?? existing?.kind ?? "custom",
      note: args.note === null ? undefined : clip(args.note, 1000) ?? existing?.note,
      promptIds: args.prompts ? promptIds : existing?.promptIds ?? [],
    };
    const now = Date.now();
    let setId: Id<"promptSets">;
    if (existing) {
      await ctx.db.patch(existing._id, { ...content, revision: existing.revision + 1, updatedAt: now });
      setId = existing._id;
    } else {
      setId = await ctx.db.insert("promptSets", { ownerUserId: root.ownerUserId ?? owner, worldFolderId: root._id, ingestKey, ...content, revision: 1, createdBy: args.actor?.slice(0, 80) || "agent", createdAt: now, updatedAt: now });
    }
    await recordWorldChange(ctx, { ownerUserId: root.ownerUserId ?? owner, worldFolderId: root._id, op: "promptSet.save", targetType: "promptSet", targetId: setId, summary: `${existing ? "Updated" : "Made"} the prompt set "${name}" (${content.promptIds.length} prompts)`, before: existing ?? null, after: content, actor: args.actor ?? ACTOR, session: args.session });
    return { setId, created: !existing, prompts: content.promptIds.length };
  },
});

/* ── Runs ────────────────────────────────────────────────────────────────── */

const runArgs = {
  ownerUserId: v.string(), world: v.string(),
  set: v.optional(v.string()),
  prompts: v.optional(v.array(v.string())),
  variants: v.optional(v.array(v.string())),
  presets: v.array(v.string()),
  stage: v.union(v.literal("screen"), v.literal("refine")),
  allSeeds: v.optional(v.boolean()),
  // Screen in Draft (one submit = 24 small images, one job against the caps); default on for screen.
  draft: v.optional(v.boolean()),
  name: v.optional(v.string()),
};

const prepareRun = async (ctx: Ctx, args: { ownerUserId: string; world: string; set?: string; prompts?: string[]; variants?: string[]; presets: string[]; stage: "screen" | "refine"; allSeeds?: boolean; draft?: boolean }) => {
  const owner = args.ownerUserId;
  const root = await resolveWorld(ctx, owner, args.world);
  const set = args.set ? await setRef(ctx, owner, args.set) : null;
  const ids: Id<"lockedPrompts">[] = [...(set?.promptIds ?? [])];
  const prompts: Locked[] = [];
  for (const ref of args.prompts ?? []) {
    const row = await promptRef(ctx, owner, ref);
    if (!ids.includes(row._id)) ids.push(row._id);
  }
  for (const id of ids) {
    const row = await ctx.db.get(id);
    if (row && !row.archivedAt && owned(owner, row) && row.worldFolderId === root._id) prompts.push(row);
  }
  if (!prompts.length) throw new ConvexError("Pick a prompt set or prompts.");
  if (prompts.length > GRID_LIMITS.prompts) throw new ConvexError(`At most ${GRID_LIMITS.prompts} prompts per run.`);
  if (!args.presets.length || args.presets.length > GRID_LIMITS.presets) throw new ConvexError(`Pick 1 to ${GRID_LIMITS.presets} presets.`);
  const presets: Preset[] = [];
  for (const ref of args.presets) presets.push(await presetRef(ctx, owner, ref));
  const cells = planGrid({ prompts: prompts.map((row) => ({ id: row._id, variants: variantsOf(row) })), presets, variantKeys: args.variants, allSeeds: args.allSeeds, stage: args.stage });
  const draft = args.draft ?? args.stage === "screen";
  return { root, set, prompts, presets, cells, draft };
};

const runPreviewOut = v.object({
  jobs: v.number(), screen: v.number(), pacing: v.object({ jobs: v.number(), hours: v.number(), days: v.number(), label: v.string() }),
  draft: v.boolean(), prompts: v.number(), presets: v.number(),
  sample: v.array(v.object({ prompt: v.string(), preset: v.string(), variant: v.string(), seed: v.number(), command: v.string() })),
  refineHint: v.string(),
});

export const previewRun = ownerQuery({
  args: runArgs,
  returns: runPreviewOut,
  handler: async (ctx, args) => {
    const { prompts, presets, cells, draft } = await prepareRun(ctx, args);
    const byId = new Map(prompts.map((row) => [row._id as string, row]));
    const sample = cells.slice(0, 3).map(({ promptId, preset, cell }) => {
      const row = byId.get(promptId)!;
      const fields = composeCell(row, cell, preset, { draft });
      return { prompt: row.title, preset: preset.name, variant: cell.variant.label, seed: cell.seed, command: composeMjCommand(fields).command };
    });
    const refineJobs = prompts.reduce((sum, row) => sum + variantsOf(row).reduce((n, variant) => n + variant.seeds.length, 0), 0);
    return {
      jobs: cells.length, screen: cells.filter((cell) => cell.screen).length, pacing: pacingEstimate(cells.length), draft,
      prompts: prompts.length, presets: presets.length, sample,
      refineHint: `Refine later: the presets you keep × all ${refineJobs} variant seeds (${pacingEstimate(refineJobs * 2).label} for two presets).`,
    };
  },
});

export const queueRun = ownerMutation({
  args: { ...runArgs, thread: v.optional(v.string()), createdBy: v.optional(v.string()) },
  returns: v.object({ runId: v.id("promptRuns"), thread: v.string(), threadId: v.string(), worldKey: v.string(), jobs: v.number(), created: v.number(), pacing: v.object({ jobs: v.number(), hours: v.number(), days: v.number(), label: v.string() }) }),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const { root, set, prompts, presets, cells, draft } = await prepareRun(ctx, args);
    if (cells.length > GRID_LIMITS.jobsPerRun) throw new ConvexError(`${cells.length} jobs is more than one run holds (${GRID_LIMITS.jobsPerRun}). Screen first, then refine the winners.`);
    const stageLabel = args.stage === "screen" ? `screen${draft ? " · draft" : ""}` : "refine";
    const name = clip(args.name, 100) ?? `${set?.name ?? `${prompts.length} prompts`} × ${presets.length} presets`;
    const thread = clip(args.thread, MJ_QUEUE_LIMITS.batch) ?? `${root.name} · ${name} · ${stageLabel}`.slice(0, MJ_QUEUE_LIMITS.batch);
    const batchKey = batchKeyOf(thread);
    const existing = await batchRows(ctx, owner, batchKey);
    if (existing.length + cells.length > MJ_QUEUE_LIMITS.itemsPerBatch) throw new ConvexError(`That thread would pass ${MJ_QUEUE_LIMITS.itemsPerBatch} prompts; name a new thread.`);
    const now = Date.now();
    const createdBy = clip(args.createdBy, 80) ?? "agent";
    const runId = await ctx.db.insert("promptRuns", {
      ownerUserId: root.ownerUserId ?? owner, worldFolderId: root._id, name, thread, threadId: threadIdOf(batchKey), stage: args.stage, draft,
      setId: set?._id, presetIds: presets.map((p) => p._id), promptIds: prompts.map((p) => p._id), jobs: cells.length,
      rowVerdicts: [], cellVerdicts: [], frameVerdicts: [], frames: [], createdBy, createdAt: now, updatedAt: now,
    });
    const byId = new Map(prompts.map((row) => [row._id as string, row]));
    let order = existing.reduce((max, row) => Math.max(max, row.order), 0);
    let created = 0;
    for (const { promptId, preset, cell, screen } of cells) {
      const row = byId.get(promptId)!;
      const ingestKey = `run:${row._id}:r${row.revision}:${preset._id}:r${preset.revision}:${cell.variant.key}:${cell.seed}:${draft ? "d" : "f"}`;
      let found: Doc<"mjQueueItems"> | null = null;
      for (const candidate of resolveUserIdCandidates(owner)) {
        found ??= await ctx.db.query("mjQueueItems").withIndex("by_owner_ingestKey", (q) => q.eq("ownerUserId", candidate).eq("ingestKey", ingestKey)).first();
      }
      if (found) continue;
      const fields = composeCell(row, cell, preset, { draft });
      order += 1;
      await ctx.db.insert("mjQueueItems", {
        ownerUserId: root.ownerUserId ?? owner, worldFolderId: root._id, worldKey: root.worldKey,
        batch: thread, batchKey, order,
        title: `${row.title} · ${preset.name}`.slice(0, MJ_QUEUE_LIMITS.title),
        prompt: fields.prompt,
        imagePrompts: fields.imagePrompts.map((ref) => ({ url: ref.url, assetId: ref.assetId as Id<"assets"> | undefined, thumbUrl: ref.thumbUrl, weight: ref.weight, label: ref.label })),
        styleRefs: fields.styleRefs.map((ref) => ({ code: ref.code, weight: ref.weight, label: ref.label })),
        profileCodes: fields.profileCodes,
        params: fields.params,
        editRefs: fields.editRefs.length ? fields.editRefs.filter((ref) => ref.url).map((ref) => ({ url: ref.url, assetId: ref.assetId as Id<"assets"> | undefined, thumbUrl: ref.thumbUrl, label: ref.label })) : undefined,
        lockedPromptId: row._id, placeLabel: row.place,
        runId, presetId: preset._id, presetLabel: preset.name, variantKey: cell.variant.key, variantLabel: cell.variant.label, seed: cell.seed, screen,
        note: `${screen ? "Screening" : "Refine"} · ${cell.variant.label} · seed ${cell.seed}${draft ? " · Draft: 24 small images, one job" : ""}.`,
        status: "queued", ingestKey, createdBy, createdAt: now, updatedAt: now,
      });
      created += 1;
    }
    await recordWorldChange(ctx, { ownerUserId: root.ownerUserId ?? owner, worldFolderId: root._id, op: "promptRun.create", targetType: "promptRun", targetId: runId, summary: `Queued run "${name}" (${created} jobs, ${stageLabel})`, after: { runId, thread, jobs: created }, actor: ACTOR });
    return { runId, thread, threadId: threadIdOf(batchKey), worldKey: root.worldKey ?? "", jobs: cells.length, created, pacing: pacingEstimate(created) };
  },
});

const runOf = async (ctx: Ctx, owner: string, ref: string): Promise<Run> => {
  const value = ref.trim().replace(/^run:/, "");
  const id = ctx.db.normalizeId("promptRuns", value);
  if (id) {
    const row = await ctx.db.get(id);
    if (owned(owner, row)) return row;
  }
  if (/^thr-[0-9a-f]{8}$/.test(value)) {
    for (const candidate of resolveUserIdCandidates(owner)) {
      const row = await ctx.db.query("promptRuns").withIndex("by_owner_threadId", (q) => q.eq("ownerUserId", candidate).eq("threadId", value)).order("desc").first();
      if (row) return row;
    }
  }
  throw new ConvexError(`No run "${ref}".`);
};

export const listRuns = ownerQuery({
  args: { ownerUserId: v.string(), world: v.string() },
  returns: v.array(v.object({ id: v.id("promptRuns"), name: v.string(), thread: v.string(), threadId: v.string(), stage: v.string(), draft: v.boolean(), jobs: v.number(), frames: v.number(), presets: v.number(), prompts: v.number(), createdAt: v.number() })),
  handler: async (ctx, args) => {
    const root = await resolveWorld(ctx, args.ownerUserId, args.world);
    const out = [];
    for (const candidate of resolveUserIdCandidates(args.ownerUserId)) {
      for (const row of await ctx.db.query("promptRuns").withIndex("by_owner_world_createdAt", (q) => q.eq("ownerUserId", candidate).eq("worldFolderId", root._id)).order("desc").take(50)) {
        out.push({ id: row._id, name: row.name, thread: row.thread, threadId: row.threadId, stage: row.stage, draft: row.draft, jobs: row.jobs, frames: row.frames.length, presets: row.presetIds.length, prompts: row.promptIds.length, createdAt: row.createdAt });
      }
    }
    return out;
  },
});

const thumbOf = async (ctx: Ctx, asset: Doc<"assets">) => {
  const small = [...(asset.thumbVariants ?? [])].sort((a, b) => a.width - b.width)[0];
  return (small ? buildR2PublicUrl(small.r2Key) : undefined) ?? await resolveAssetThumbUrl(ctx, asset) ?? undefined;
};

/** The grid: rows = presets, columns = prompts; each cell its frames, queue status and verdicts. */
export const getRunGrid = ownerQuery({
  args: { ownerUserId: v.string(), run: v.string() },
  returns: v.object({
    run: v.object({ id: v.id("promptRuns"), name: v.string(), thread: v.string(), threadId: v.string(), stage: v.string(), draft: v.boolean(), jobs: v.number(), worldKey: v.string(), worldId: v.id("folders") }),
    presets: v.array(v.object({ id: v.id("stylePresets"), name: v.string(), perturbation: v.optional(v.string()), verdict: v.optional(runVerdictValidator) })),
    prompts: v.array(v.object({ id: v.id("lockedPrompts"), title: v.string(), place: v.string() })),
    cells: v.array(v.object({
      presetId: v.id("stylePresets"), promptId: v.id("lockedPrompts"), verdict: v.optional(runVerdictValidator),
      queued: v.number(), sent: v.number(),
      frames: v.array(v.object({ assetId: v.id("assets"), thumbUrl: v.optional(v.string()), width: v.optional(v.number()), height: v.optional(v.number()), variantKey: v.string(), seed: v.number(), verdict: v.optional(runVerdictValidator) })),
    })),
  }),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const run = await runOf(ctx, owner, args.run);
    const world = await ctx.db.get(run.worldFolderId);
    const items = (await batchRows(ctx, owner, batchKeyOf(run.thread))).filter((row) => row.runId === run._id);
    const presets = [];
    for (const id of run.presetIds) {
      const row = await ctx.db.get(id);
      if (row) presets.push({ id: row._id, name: row.name, perturbation: row.perturbation, verdict: run.rowVerdicts.find((entry) => entry.presetId === row._id)?.verdict });
    }
    const prompts = [];
    for (const id of run.promptIds) {
      const row = await ctx.db.get(id);
      if (row) prompts.push({ id: row._id, title: row.title, place: row.place });
    }
    const cells = [];
    for (const preset of presets) {
      for (const prompt of prompts) {
        const mine = items.filter((item) => item.presetId === preset.id && item.lockedPromptId === prompt.id);
        const frames = [];
        for (const frame of run.frames.filter((entry) => entry.presetId === preset.id && entry.promptId === prompt.id)) {
          const asset = await ctx.db.get(frame.assetId);
          if (!asset) continue;
          frames.push({ assetId: asset._id, thumbUrl: await thumbOf(ctx, asset), width: asset.thumbWidth ?? asset.width, height: asset.thumbHeight ?? asset.height, variantKey: frame.variantKey, seed: frame.seed, verdict: run.frameVerdicts.find((entry) => entry.assetId === asset._id)?.verdict });
        }
        cells.push({
          presetId: preset.id, promptId: prompt.id, verdict: run.cellVerdicts.find((entry) => entry.presetId === preset.id && entry.promptId === prompt.id)?.verdict,
          queued: mine.filter((item) => item.status === "queued" || item.status === "injected").length, sent: mine.filter((item) => item.status === "sent").length, frames,
        });
      }
    }
    return { run: { id: run._id, name: run.name, thread: run.thread, threadId: run.threadId, stage: run.stage, draft: run.draft, jobs: run.jobs, worldKey: world?.worldKey ?? "", worldId: run.worldFolderId }, presets, prompts, cells };
  },
});

/** Keep or drop a preset row, a cell or a frame (null clears it). Michael's call: the board keys 1 and 2. */
export const setRunVerdict = ownerMutation({
  args: { ownerUserId: v.string(), run: v.string(), presetId: v.optional(v.id("stylePresets")), promptId: v.optional(v.id("lockedPrompts")), assetId: v.optional(v.id("assets")), verdict: v.union(runVerdictValidator, v.null()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await runOf(ctx, args.ownerUserId, args.run);
    const at = Date.now();
    if (args.assetId) {
      const rest = run.frameVerdicts.filter((entry) => entry.assetId !== args.assetId);
      await ctx.db.patch(run._id, { frameVerdicts: args.verdict ? [...rest, { assetId: args.assetId, verdict: args.verdict, at }] : rest, updatedAt: at });
    } else if (args.presetId && args.promptId) {
      const rest = run.cellVerdicts.filter((entry) => !(entry.presetId === args.presetId && entry.promptId === args.promptId));
      await ctx.db.patch(run._id, { cellVerdicts: args.verdict ? [...rest, { presetId: args.presetId, promptId: args.promptId, verdict: args.verdict, at }] : rest, updatedAt: at });
    } else if (args.presetId) {
      const rest = run.rowVerdicts.filter((entry) => entry.presetId !== args.presetId);
      await ctx.db.patch(run._id, { rowVerdicts: args.verdict ? [...rest, { presetId: args.presetId, verdict: args.verdict, at }] : rest, updatedAt: at });
    } else throw new ConvexError("Name a preset row, a cell (preset and prompt) or a frame.");
    return null;
  },
});

const resultsShelf = async (ctx: MutationCtx, owner: string, root: Doc<"folders">) => {
  const hit = (await childrenOf(ctx, root._id)).find((child) => child.name === RESULTS_SHELF && owned(owner, child));
  if (hit) return hit._id;
  const now = Date.now();
  const id = await ctx.db.insert("folders", {
    ownerUserId: root.ownerUserId ?? owner, name: RESULTS_SHELF, normalizedName: `${root._id}/${RESULTS_SHELF.toLowerCase()}`,
    description: "Frames from prompt × preset runs, each with its prompt, variant, preset and seed. Art director only.",
    parentFolderId: root._id, group: "Production", scope: ART_DIRECTOR_SCOPE, memberCount: 0, createdAt: now, updatedAt: now,
  });
  await recordWorldChange(ctx, { ownerUserId: root.ownerUserId ?? owner, worldFolderId: root._id, op: "shelf.create", targetType: "shelf", targetId: id, summary: `Created shelf "${RESULTS_SHELF}" (art director only)`, after: { folderId: id }, actor: ACTOR });
  return id;
};

/**
 * Frames saved from a run's sent jobs: filed on the art-director "Run
 * results" shelf (and the prompt's place shelf), recorded with their exact
 * cell on the run and as takes of the prompt. A frame goes on a world style's
 * shelf only when its preset is that style's own recipe unchanged.
 */
export const fileRunResults = ownerMutation({
  args: { ownerUserId: v.string(), run: v.string(), session: v.optional(v.string()) },
  returns: v.object({ checked: v.number(), waiting: v.number(), filed: v.number() }),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const run = await runOf(ctx, owner, args.run);
    const root = (await ctx.db.get(run.worldFolderId))!;
    const items = (await batchRows(ctx, owner, batchKeyOf(run.thread))).filter((row) => row.runId === run._id);
    let waiting = 0;
    let filed = 0;
    let shelf: Id<"folders"> | null = null;
    const frames = [...run.frames];
    for (const item of items) {
      if (item.status !== "sent" || !item.jobId || !item.presetId || !item.lockedPromptId) { waiting += 1; continue; }
      const job = item.jobId.toLowerCase();
      const found = new Map<Id<"assets">, Doc<"assets">>();
      for (const candidate of resolveUserIdCandidates(owner)) {
        for (const prefix of mjSourcePrefixes(job)) {
          for (const asset of await ctx.db.query("assets").withIndex("by_owner_sourceUrl", (q) => q.eq("ownerUserId", candidate).gte("sourceUrl", prefix).lt("sourceUrl", `${prefix}￿`)).take(30)) found.set(asset._id, asset);
        }
        for (const asset of await ctx.db.query("assets").withIndex("by_owner_fileName", (q) => q.eq("ownerUserId", candidate).gte("fileName", mjFilePrefix(job)).lt("fileName", `${mjFilePrefix(job)}￿`)).take(30)) found.set(asset._id, asset);
      }
      const fresh = [...found.values()].filter((asset) => mjMatches({ job }, mjIdentityOf(asset)) && !frames.some((entry) => entry.assetId === asset._id));
      if (!fresh.length) { if (!frames.some((entry) => entry.queueItemId === item._id)) waiting += 1; continue; }
      shelf ??= await resultsShelf(ctx, owner, root);
      const locked = await ctx.db.get(item.lockedPromptId);
      const preset = await ctx.db.get(item.presetId);
      const style = preset?.source === "style" && !preset.parentPresetId && preset.styleId ? await ctx.db.get(preset.styleId) : null;
      const addTo = [shelf as string, ...(locked?.shelfId ? [locked.shelfId as string] : []), ...(style?.shelfFolderId && style.worldFolderId === root._id ? [style.shelfFolderId as string] : [])];
      await fileAssetsInWorld(ctx, { ownerUserId: owner, world: root._id, assetIds: fresh.map((asset) => asset._id), addTo, move: false, note: `run "${run.name}": ${preset?.name ?? "preset"} · ${item.variantLabel ?? item.variantKey} · seed ${item.seed}`, actor: ACTOR, session: args.session ?? "prompt-runs" });
      const at = Date.now();
      for (const asset of fresh) {
        frames.push({ assetId: asset._id, presetId: item.presetId, promptId: item.lockedPromptId, variantKey: item.variantKey ?? "neutral", seed: item.seed ?? 0, queueItemId: item._id, at });
        filed += 1;
      }
      if (locked) {
        await ctx.db.patch(locked._id, { takes: [...locked.takes, ...fresh.map((asset) => ({ assetId: asset._id, styleId: style?._id, presetId: item.presetId, variantKey: item.variantKey, seed: item.seed, queueItemId: item._id, jobId: job, at }))], updatedAt: at });
      }
    }
    if (filed) await ctx.db.patch(run._id, { frames, updatedAt: Date.now() });
    return { checked: items.length, waiting, filed };
  },
});

export type PresetOut = Infer<typeof presetOut>;
