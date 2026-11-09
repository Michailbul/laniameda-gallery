import { v, type Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import { projectBySlug, resolveViewer } from "./review";
import { composeRecipe } from "../lib/mj-recipe";

// A style's recipes as copy-ready Midjourney text: the full parameter line and
// the template with [subject] (lib/mj-recipe composeRecipe), with every code
// named when the gallery knows it. Owner and agents only: the director and
// producer never receive this (review.md: recipes stay with the owner).

type Ctx = QueryCtx | MutationCtx;

export const recipeCodeValidator = v.object({
  code: v.string(),
  flag: v.union(v.literal("sref"), v.literal("profile")),
  kind: v.union(v.literal("moodboard"), v.literal("profile"), v.literal("sref"), v.literal("unknown")),
  name: v.optional(v.string()),
});

export const recipeViewValidator = v.object({
  name: v.optional(v.string()),
  params: v.string(),
  prompt: v.optional(v.string()),
  frames: v.optional(v.number()),
  codes: v.array(recipeCodeValidator),
});
export type RecipeView = Infer<typeof recipeViewValidator>;

/** Names for codes: moodboards by their Midjourney code, profiles by current or earlier code. */
const codeNamer = (ctx: Ctx, owner: string) => {
  const memo = new Map<string, { kind: "moodboard" | "profile"; name: string } | null>();
  return async (code: string) => {
    if (memo.has(code)) return memo.get(code) ?? null;
    let hit: { kind: "moodboard" | "profile"; name: string } | null = null;
    for (const candidate of resolveUserIdCandidates(owner)) {
      const board = await ctx.db.query("moodboards").withIndex("by_owner_mjCode", (q) => q.eq("ownerUserId", candidate).eq("mjCode", code)).first();
      if (board) { hit = { kind: "moodboard", name: board.name }; break; }
      const profile = await ctx.db.query("mjProfiles").withIndex("by_owner_code", (q) => q.eq("ownerUserId", candidate).eq("code", code)).first();
      if (profile) { hit = { kind: "profile", name: profile.name }; break; }
    }
    memo.set(code, hit);
    return hit;
  };
};

export const recipeViewsOf = async (ctx: Ctx, owner: string, style: Doc<"worldStyles">): Promise<RecipeView[]> => {
  const nameOf = codeNamer(ctx, owner);
  const out: RecipeView[] = [];
  for (const recipe of style.recipes) {
    const known = new Map<string, { kind: "moodboard" | "profile"; name: string }>();
    const boardCodes: string[] = [];
    for (const id of recipe.moodboardIds) {
      const board = await ctx.db.get(id);
      const code = board?.mjCode ?? (board?.mjMoodboardId ? `m${board.mjMoodboardId}` : undefined);
      if (board && code) { boardCodes.push(code); known.set(code, { kind: "moodboard", name: board.name }); }
    }
    const profileCodes: string[] = [];
    for (const id of recipe.profileIds) {
      const profile = await ctx.db.get(id);
      if (profile) { profileCodes.push(profile.code); known.set(profile.code, { kind: "profile", name: profile.name }); }
    }
    const composed = composeRecipe({
      parameters: recipe.parameters, template: recipe.template,
      moodboardCodes: boardCodes, profileCodes, unknownCodes: recipe.unknownCodes,
    });
    if (!composed.params && !composed.prompt) continue;
    const codes: RecipeView["codes"] = composed.srefs.map((code) => ({ code, flag: "sref" as const, kind: "sref" as const }));
    for (const code of composed.profiles) {
      const hit = known.get(code) ?? await nameOf(code);
      codes.push({ code, flag: "profile", kind: hit?.kind ?? "unknown", name: hit?.name });
    }
    out.push({ name: recipe.name, params: composed.params, prompt: composed.prompt, frames: recipe.frames, codes });
  }
  return out;
};

/**
 * The director review's style recipes, for the owner only. Anyone else
 * (director, producer, guest) gets null, so the page never ships them.
 */
export const reviewStyleRecipes = query({
  args: { slug: v.string() },
  returns: v.union(v.null(), v.array(v.object({ styleId: v.id("worldStyles"), name: v.string(), recipes: v.array(recipeViewValidator) }))),
  handler: async (ctx, args) => {
    const project = await projectBySlug(ctx, args.slug);
    if (!project) return null;
    const viewer = await resolveViewer(ctx, project);
    if (viewer?.role !== "owner") return null;
    const out = [];
    for (const entry of project.styles) {
      const style = await ctx.db.get(entry.styleId as Id<"worldStyles">);
      if (!style || !canActorAccessOwnerUserId(project.ownerUserId, style.ownerUserId)) continue;
      out.push({ styleId: style._id, name: style.name, recipes: await recipeViewsOf(ctx, project.ownerUserId, style) });
    }
    return out;
  },
});
