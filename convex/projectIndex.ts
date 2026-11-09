import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { signedOwnerQuery as ownerQuery } from "./actor";
import { resolveUserIdCandidates } from "./authz";
import { childrenOf, resolveWorld } from "./worldCore";
import { buildR2PublicUrl } from "./r2_url";

// The agent's map of a project and one search across it: every kind of
// reference a project holds (briefs and their pictures, locked places, shot
// sets, looks, runs, world styles, moodboards, review folders, shelves) with
// the handle an agent passes to the next tool (brief:, lp:, set:, preset:,
// run:, style:, moodboard:, asset:, review folder slugs, collection ids).
// Owner only; art-director scope.

type Ctx = QueryCtx;

const handleValidator = v.object({
  kind: v.string(),
  handle: v.string(),
  title: v.string(),
  // Plain words on what it is and why it matched.
  line: v.optional(v.string()),
  // The tool that opens it whole.
  open: v.string(),
});

const byOwner = async <T>(owner: string, read: (candidate: string) => Promise<T[]>) => {
  const out: T[] = [];
  for (const candidate of resolveUserIdCandidates(owner)) out.push(...await read(candidate));
  return out;
};

const load = async (ctx: Ctx, owner: string, worldId: Id<"folders">) => {
  const [briefs, prompts, sets, presets, runs, styles, boards] = await Promise.all([
    byOwner(owner, (c) => ctx.db.query("productionBriefs").withIndex("by_owner_world_updatedAt", (q) => q.eq("ownerUserId", c).eq("worldFolderId", worldId)).take(200)),
    byOwner(owner, (c) => ctx.db.query("lockedPrompts").withIndex("by_owner_world_updatedAt", (q) => q.eq("ownerUserId", c).eq("worldFolderId", worldId)).take(500)),
    byOwner(owner, (c) => ctx.db.query("promptSets").withIndex("by_owner_world_updatedAt", (q) => q.eq("ownerUserId", c).eq("worldFolderId", worldId)).take(100)),
    byOwner(owner, (c) => ctx.db.query("stylePresets").withIndex("by_owner_world_updatedAt", (q) => q.eq("ownerUserId", c).eq("worldFolderId", worldId)).take(200)),
    byOwner(owner, (c) => ctx.db.query("promptRuns").withIndex("by_owner_world_createdAt", (q) => q.eq("ownerUserId", c).eq("worldFolderId", worldId)).order("desc").take(50)),
    byOwner(owner, (c) => ctx.db.query("worldStyles").withIndex("by_owner_world_slug", (q) => q.eq("ownerUserId", c).eq("worldFolderId", worldId)).take(100)),
    byOwner(owner, (c) => ctx.db.query("moodboards").withIndex("by_owner_updatedAt", (q) => q.eq("ownerUserId", c)).take(500)),
  ]);
  const shelves = await childrenOf(ctx, worldId);
  const shelfIds = new Set<string>([worldId, ...shelves.map((s) => s._id)]);
  const reviewProjects = await byOwner(owner, (c) => ctx.db.query("reviewProjects").withIndex("by_owner", (q) => q.eq("ownerUserId", c)).take(50));
  const review = reviewProjects.find((p) => p.worldFolderId === worldId);
  const folders: Doc<"reviewFolders">[] = review
    ? await ctx.db.query("reviewFolders").withIndex("by_project_section_order", (q) => q.eq("projectId", review._id)).take(200)
    : [];
  return {
    briefs, prompts: prompts.filter((p) => !p.archivedAt), sets, presets: presets.filter((p) => p.status !== "archived"), runs,
    styles: styles.filter((s) => s.status !== "merged"), boards: boards.filter((b) => b.folderId && shelfIds.has(b.folderId)),
    shelves, review, folders: folders.filter((f) => !f.archivedAt),
  };
};

/** Everything a project holds, organized, with handles: what project_open adds for agents. */
export const projectMap = ownerQuery({
  args: { ownerUserId: v.string(), world: v.string() },
  returns: v.object({
    places: v.array(v.object({ area: v.string(), places: v.array(v.object({ place: v.string(), prompts: v.array(v.object({ handle: v.string(), title: v.string(), scenes: v.array(v.number()), variants: v.number(), hasFrame: v.boolean(), takes: v.number() })) })) })),
    sets: v.array(v.object({ handle: v.string(), name: v.string(), kind: v.string(), prompts: v.number() })),
    looks: v.array(v.object({ handle: v.string(), name: v.string(), status: v.string(), parent: v.optional(v.string()), fromStyle: v.optional(v.string()) })),
    runs: v.array(v.object({ handle: v.string(), name: v.string(), stage: v.string(), jobs: v.number(), frames: v.number(), threadId: v.string() })),
    styles: v.array(v.object({ handle: v.string(), name: v.string(), status: v.string(), line: v.optional(v.string()) })),
    moodboards: v.array(v.object({ handle: v.string(), name: v.string(), code: v.optional(v.string()), items: v.number(), status: v.string() })),
    reviewFolders: v.array(v.object({ slug: v.string(), name: v.string(), section: v.string(), area: v.optional(v.string()), scenes: v.array(v.number()) })),
  }),
  handler: async (ctx, args) => {
    const root = await resolveWorld(ctx, args.ownerUserId, args.world);
    const data = await load(ctx, args.ownerUserId, root._id);
    const areas = new Map<string, Map<string, Doc<"lockedPrompts">[]>>();
    for (const prompt of data.prompts.sort((a, b) => a.place.localeCompare(b.place) || a.createdAt - b.createdAt)) {
      const area = prompt.place.split("·")[0]!.trim();
      const places = areas.get(area) ?? new Map();
      places.set(prompt.place, [...(places.get(prompt.place) ?? []), prompt]);
      areas.set(area, places);
    }
    const styleName = new Map(data.styles.map((s) => [s._id as string, s.name]));
    const presetName = new Map(data.presets.map((p) => [p._id as string, p.name]));
    return {
      places: [...areas.entries()].map(([area, places]) => ({
        area,
        places: [...places.entries()].map(([place, prompts]) => ({
          place,
          prompts: prompts.map((p) => ({ handle: `lp:${p._id}`, title: p.title, scenes: p.scenes, variants: p.variants?.length ?? 1, hasFrame: Boolean(p.lockedFrame), takes: p.takes.length })),
        })),
      })),
      sets: data.sets.map((s) => ({ handle: `set:${s._id}`, name: s.name, kind: s.kind, prompts: s.promptIds.length })),
      looks: data.presets.sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({
        handle: `preset:${p._id}`, name: p.name, status: p.status,
        parent: p.parentPresetId ? presetName.get(p.parentPresetId) : undefined, fromStyle: p.styleId ? styleName.get(p.styleId) : undefined,
      })),
      runs: data.runs.map((r) => ({ handle: `run:${r._id}`, name: r.name, stage: r.stage, jobs: r.jobs, frames: r.frames.length, threadId: r.threadId })),
      styles: data.styles.map((s) => ({ handle: `style:${s._id}`, name: s.name, status: s.status, line: s.line })),
      moodboards: data.boards.map((b) => ({ handle: `moodboard:${b._id}`, name: b.name, code: b.mjCode, items: b.itemCount, status: b.status })),
      reviewFolders: data.folders.map((f) => ({ slug: f.slug, name: f.name, section: f.section, area: f.area, scenes: f.scenes ?? [] })),
    };
  },
});

const words = (query: string) => query.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 1);
const sceneOf = (query: string) => {
  const m = /(?:scene|sc\.?|shot)\s*(\d{1,3})/i.exec(query);
  return m ? Number(m[1]) : null;
};
const scoreText = (tokens: string[], text: string) => {
  const hay = text.toLowerCase().normalize("NFKD");
  return tokens.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
};

/**
 * One search across a project: briefs and their pictures, locked places,
 * shot sets, looks, runs, world styles, moodboards, review folders and
 * shelves. Words ("school patio", "night beach") or a scene ("scene 61").
 * Results are grouped by kind, best first, each with the tool that opens it.
 */
export const findInProject = ownerQuery({
  args: { ownerUserId: v.string(), world: v.string(), query: v.string(), limit: v.optional(v.number()) },
  returns: v.object({ query: v.string(), results: v.array(handleValidator), pictures: v.array(v.object({ handle: v.string(), title: v.string(), from: v.string(), thumbUrl: v.optional(v.string()) })) }),
  handler: async (ctx, args) => {
    const root = await resolveWorld(ctx, args.ownerUserId, args.world);
    const data = await load(ctx, args.ownerUserId, root._id);
    const scene = sceneOf(args.query);
    // "scene 61" asks for the scene number: the word itself and the number are not search words.
    const tokens = words(scene === null ? args.query : args.query.replace(/(?:scene|sc\.?|shot)\s*\d{1,3}/gi, " "));
    const limit = Math.min(Math.max(args.limit ?? 30, 1), 80);
    type Hit = { score: number; row: { kind: string; handle: string; title: string; line?: string; open: string } };
    const hits: Hit[] = [];
    const add = (score: number, row: Hit["row"]) => { if (score > 0) hits.push({ score, row }); };
    const sceneHit = (scenes: number[] | undefined) => (scene !== null && scenes?.includes(scene) ? 3 : 0);

    for (const b of data.briefs) {
      add(scoreText(tokens, `${b.title} ${b.kind} ${b.from ?? ""} ${b.note ?? ""} ${b.topics.join(" ")} ${b.reviewFolders.join(" ")} ${(b.groups ?? []).map((g) => g.label).join(" ")}`) * 2,
        { kind: "brief", handle: `brief:${b._id}`, title: b.title, line: `${b.kind.replace("_", " ")} from ${b.from ?? "production"} · ${b.assetIds.length} pictures · ${b.files.length} files`, open: "project_get" });
    }
    for (const p of data.prompts) {
      add(scoreText(tokens, `${p.title} ${p.place} ${p.reviewFolder ?? ""} ${p.text}`) + scoreText(tokens, p.title) + 2 * scoreText(tokens, p.place) + sceneHit(p.scenes),
        { kind: "locked place", handle: `lp:${p._id}`, title: `${p.place} · ${p.title}`, line: `${p.variants?.length ?? 1} wordings, seed ${p.seed}${p.scenes.length ? `, scenes ${p.scenes.join(", ")}` : ""}${p.takes.length ? `, ${p.takes.length} takes` : ""}`, open: "project_get" });
    }
    for (const s of data.sets) add(scoreText(tokens, `${s.name} ${s.kind} ${s.note ?? ""}`) * 2, { kind: "shot set", handle: `set:${s._id}`, title: s.name, line: `${s.promptIds.length} shots`, open: "project_get" });
    for (const p of data.presets) add(scoreText(tokens, `${p.name} ${p.perturbation ?? ""} ${p.note ?? ""} ${p.sentence ?? ""}`) * 2, { kind: "look", handle: `preset:${p._id}`, title: p.name, line: `${p.status}${p.perturbation ? ` · variation: ${p.perturbation}` : ""}`, open: "project_get" });
    for (const r of data.runs) add(scoreText(tokens, r.name) * 2, { kind: "run", handle: `run:${r._id}`, title: r.name, line: `${r.stage} · ${r.jobs} jobs · ${r.frames.length} frames back`, open: "project_get" });
    for (const s of data.styles) add(scoreText(tokens, `${s.name} ${s.line ?? ""} ${s.notes ?? ""}`) * 2, { kind: "world style", handle: `style:${s._id}`, title: s.name, line: s.line, open: "get_style" });
    for (const b of data.boards) add(scoreText(tokens, `${b.name} ${b.description ?? ""} ${b.styleTag ?? ""}`) * 2, { kind: "moodboard", handle: `moodboard:${b._id}`, title: b.name, line: `${b.itemCount} pictures${b.mjCode ? `, code ${b.mjCode}` : ""}`, open: "get_moodboard" });
    for (const f of data.folders) {
      add(scoreText(tokens, `${f.name} ${f.slug} ${f.area ?? ""} ${f.note ?? ""}`) * 2 + sceneHit(f.scenes),
        { kind: "review folder", handle: f.slug, title: `${f.area ? `${f.area} · ` : ""}${f.name}`, line: `${f.section}${f.scenes?.length ? `, scenes ${f.scenes.join(", ")}` : ""}`, open: "review_items {project, folder}" });
    }
    for (const s of data.shelves) add(scoreText(tokens, `${s.name} ${s.group ?? ""} ${s.description ?? ""}`) * 2, { kind: "shelf", handle: s._id, title: s.name, line: `${s.group ?? "shelf"} · ${s.memberCount ?? 0} pieces${s.scope === "art_director" ? " · art director only" : ""}`, open: "list_assets_page {folderId}" });

    // Pictures from production (brief pictures) whose own words match.
    const pictures: Array<{ score: number; handle: string; title: string; from: string; thumbUrl?: string }> = [];
    if (tokens.length) {
      for (const b of data.briefs) {
        for (const id of b.assetIds.slice(0, 120)) {
          const asset = await ctx.db.get(id);
          if (!asset) continue;
          const group = (b.groups ?? []).find((g) => g.assetIds.includes(id))?.label ?? "";
          const score = scoreText(tokens, `${asset.description ?? ""} ${asset.agentDescription ?? ""} ${asset.fileName ?? ""} ${group} ${b.topics.join(" ")}`);
          if (score > 0) {
            const small = [...(asset.thumbVariants ?? [])].sort((x, y) => x.width - y.width)[0];
            pictures.push({ score, handle: `asset:${asset._id}`, title: asset.description ?? asset.fileName ?? "picture", from: b.title, thumbUrl: small ? buildR2PublicUrl(small.r2Key) ?? undefined : undefined });
          }
        }
      }
    }
    return {
      query: args.query,
      results: hits.sort((a, b) => b.score - a.score).slice(0, limit).map((hit) => hit.row),
      pictures: pictures.sort((a, b) => b.score - a.score).slice(0, 24).map(({ score: _score, ...row }) => { void _score; return row; }),
    };
  },
});
