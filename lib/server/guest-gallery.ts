import { NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { makeFunctionReference } from "convex/server";
import { galleryAssetPageInputSchema } from "@/lib/gallery-pagination";
import { resolveSkillForOwner } from "@/lib/server/agent-skills";
import { filterCollections, projectAgentAssets, projectCollectionRow } from "@/lib/agent-read-projections";
import { parseGalleryId } from "@/lib/gallery-ids";
import type { getServerConvexClient } from "@/lib/server/convex";
import type { GuestReach } from "@/lib/server/agent-auth";
import {
  GUEST_REFUSAL, guestCollectionRows, guestMayCall, isGuestVisibleAsset, isGuestVisibleSkill,
  sanitizeGuestAsset, sanitizeGuestSkill, stripGuestFilters,
} from "@/lib/guest-access";
import {
  guestEmbeddableMediaIds, guestFolderAndChildren, guestVisibleAssetIds, loadGuestScope, type GuestScope,
} from "@/lib/server/guest-scope";

// The guest reader's side of /api/agent/gallery and the listFolders of
// /api/agent/customize. Every answer passes the deny-wins rule in
// lib/guest-access.ts; a hidden piece reads exactly like a missing one.

type Client = ReturnType<typeof getServerConvexClient>;
type Row = Record<string, unknown>;

const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const strArray = (value: unknown) =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0) : undefined;
const KINDS = new Set(["image", "video"]);
const MODES = new Set(["hybrid", "visual", "text"]);
const PIECE_TYPES = new Set(["character", "location", "scene", "inspiration"]);
const MEDIUMS = new Set(["animation", "live-action"]);
const pick = <T extends string>(value: unknown, allowed: Set<string>) => {
  const text = str(value);
  return text && allowed.has(text) ? (text as T) : undefined;
};

const namedFilters = (data: Row) => ({
  tagNames: strArray(data.tagNames),
  anyTagNames: strArray(data.anyTagNames),
  excludeTagNames: strArray(data.excludeTagNames),
  pieceType: pick<"character" | "location" | "scene" | "inspiration">(data.pieceType, PIECE_TYPES),
  medium: pick<"animation" | "live-action">(data.medium, MEDIUMS),
});

const notFoundCollection = () => NextResponse.json({ error: "Collection not found." }, { status: 404 });

const visibleAssets = (assets: readonly Row[], scope: GuestScope) =>
  assets.filter((asset) => isGuestVisibleAsset(asset as never, scope.visible)).map(sanitizeGuestAsset);

type MediaRow = { id: string } & Row;
type SkillRow = Row & { previewImages?: MediaRow[]; bodyMedia?: MediaRow[]; steps?: Array<Row & { media?: MediaRow[] }> };

/** Visible Skills only, with media filed in a hidden place taken out. */
const guestSkills = async (client: Client, owner: string, scope: GuestScope, skills: readonly SkillRow[]) => {
  const kept = skills.filter((skill) => isGuestVisibleSkill(skill as never, scope.visible));
  const mediaIds = kept.flatMap((skill) => [
    ...(skill.previewImages ?? []), ...(skill.bodyMedia ?? []), ...(skill.steps ?? []).flatMap((step) => step.media ?? []),
  ].map((media) => String(media.id)));
  const allowed = await guestEmbeddableMediaIds(client, owner, scope, mediaIds);
  const keep = (media: MediaRow[] | undefined) => media?.filter((entry) => allowed.has(String(entry.id)));
  return kept.map((skill) => sanitizeGuestSkill({
    ...skill,
    ...(skill.previewImages ? { previewImages: keep(skill.previewImages) } : {}),
    ...(skill.bodyMedia ? { bodyMedia: keep(skill.bodyMedia) } : {}),
    ...(skill.steps ? { steps: skill.steps.map((step) => ({ ...step, media: keep(step.media) ?? [] })) } : {}),
  }));
};

const readGuestSkill = async (client: Client, owner: string, scope: GuestScope, reference: string) => {
  const id = await resolveSkillForOwner(client, owner, reference).catch(() => null);
  if (!id) return null;
  const skill = (await client.query(api.skills.getSkill, { id, ownerUserId: owner })) as SkillRow | null;
  if (!skill) return null;
  const [visible] = await guestSkills(client, owner, scope, [skill]);
  return visible ?? null;
};

const collectionsResponse = (scope: GuestScope, data: Row) => {
  const rows = guestCollectionRows(scope.folders as Array<Row & { _id: string }>, scope.visible);
  const kind = data.kind === "storybook" || data.kind === "plain" ? data.kind : undefined;
  const matching = filterCollections(rows as never[], {
    parentFolderId: str(data.parentFolderId),
    rootsOnly: data.rootsOnly === true,
    search: str(data.search),
    kind,
  }) as Array<Row & { _id: string; name: string }>;
  return NextResponse.json({
    count: matching.length,
    total: rows.length,
    folders: matching.map((folder) => {
      const { memberCount: _count, ...row } = projectCollectionRow(folder);
      void _count;
      return row;
    }),
  });
};

export async function handleGuestRead(
  path: "/api/agent/gallery" | "/api/agent/customize",
  agent: { ownerUserId: string; guest: GuestReach },
  client: Client,
  input: Row,
): Promise<Response> {
  const action = str(input.action);
  if (!guestMayCall(path, action)) return NextResponse.json({ error: GUEST_REFUSAL }, { status: 403 });
  if (str(input.world)) return NextResponse.json({ error: "Worlds are not open to this token." }, { status: 404 });
  const data = stripGuestFilters({ ...input });
  const owner = agent.ownerUserId;
  const scope = await loadGuestScope(client, owner, agent.guest);
  const folderId = str(data.folderId);
  if (folderId && !scope.visible.has(folderId)) return notFoundCollection();

  if (action === "listFolders") return collectionsResponse(scope, data);

  if (action === "listAssetsPage") {
    const { action: _action, ...rest } = data;
    void _action;
    const parsed = galleryAssetPageInputSchema.safeParse(rest);
    if (!parsed.success) return NextResponse.json({ error: "Invalid asset listing filters.", issues: parsed.error.issues }, { status: 400 });
    const page = await client.query(makeFunctionReference<"query">("agentAssets:listAssetsPage"), { ownerUserId: owner, ...parsed.data }) as Row & { assets: Row[] };
    const { scannedCount: _scanned, ...pageRest } = page;
    void _scanned;
    return NextResponse.json({ ...pageRest, assets: visibleAssets(page.assets, scope) });
  }

  if (action === "listAssets") {
    const limit = Math.max(1, Math.min(num(data.limit) ?? 50, 200));
    const roots = folderId ? [folderId] : [...scope.visible].filter((id) => !scope.folders.find((folder) => String(folder._id) === id)?.parentFolderId);
    const lists = await Promise.all(roots.map((root) => client.query(api.assets.listGalleryAssets, {
      ownerUserId: owner,
      kind: pick<"image" | "video">(data.kind, KINDS),
      folderId: root as Id<"folders">,
      includeDescendants: folderId ? data.includeDescendants === true : true,
      modelName: str(data.modelName),
      ...namedFilters(data),
      search: str(data.search),
      limit: Math.min(limit * 2, 400),
    }) as Promise<Row[]>));
    const seen = new Set<string>();
    const merged = lists.flat()
      .filter((asset) => !seen.has(String(asset._id)) && Boolean(seen.add(String(asset._id))))
      .sort((left, right) => Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0));
    const assets = visibleAssets(merged, scope).slice(0, limit);
    return NextResponse.json({ count: assets.length, assets: projectAgentAssets(assets) });
  }

  if (action === "searchAssets") {
    const query = str(data.query);
    if (!query) return NextResponse.json({ error: "query is required." }, { status: 400 });
    const folderIds = (folderId ? guestFolderAndChildren(scope, folderId) : [...scope.visible]) ?? [];
    if (folderIds.length === 0) return NextResponse.json({ count: 0, results: [] });
    const found = await client.action(api.semanticSearch.searchAssetsVerified, {
      ownerUserId: owner,
      scope: "mine",
      query,
      folderIds: folderIds as Id<"folders">[],
      kind: pick<"image" | "video">(data.kind, KINDS),
      modelName: str(data.modelName),
      mode: pick<"hybrid" | "visual" | "text">(data.mode, MODES),
      ...namedFilters(data),
      limit: num(data.limit),
      verify: data.verify === false ? false : undefined,
      includeNear: data.includeNear === true ? true : undefined,
    });
    const results = visibleAssets(found.results as Row[], scope);
    // Candidate and checked counts span the whole vault, so only the mode and note travel.
    return NextResponse.json({
      count: results.length,
      summary: { mode: found.summary.mode, ...(found.summary.note ? { note: found.summary.note } : {}) },
      results: projectAgentAssets(results),
    });
  }

  if (action === "findSimilar") {
    const parsed = parseGalleryId(data.id ?? data.assetId, "asset");
    const source = await guestVisibleAssetIds(client, owner, scope, [parsed.id]);
    if (!source.has(parsed.id)) return NextResponse.json({ error: "Asset not found." }, { status: 404 });
    const folderIds = (folderId ? guestFolderAndChildren(scope, folderId) : [...scope.visible]) ?? [];
    const results = await client.action(api.semanticSearch.findSimilarAssets, {
      ownerUserId: owner,
      scope: "mine",
      assetId: parsed.id as Id<"assets">,
      folderIds: folderIds as Id<"folders">[],
      kind: pick<"image" | "video">(data.kind, KINDS),
      modelName: str(data.modelName),
      mode: pick<"hybrid" | "visual" | "text">(data.mode, MODES),
      ...namedFilters(data),
      minRelativeScore: num(data.minRelativeScore),
      limit: num(data.limit),
    });
    const visible = visibleAssets(results as Row[], scope);
    return NextResponse.json({ count: visible.length, results: projectAgentAssets(visible) });
  }

  if (action === "getById") {
    const reference = str(data.id);
    if (!reference) return NextResponse.json({ error: "id is required." }, { status: 400 });
    const skill = await readGuestSkill(client, owner, scope, reference);
    if (skill) return NextResponse.json({ skill });
    let parsed: ReturnType<typeof parseGalleryId>;
    try { parsed = parseGalleryId(reference); } catch { return NextResponse.json({ asset: null }); }
    if (parsed.kind !== "asset") return NextResponse.json({ asset: null });
    const asset = await client.query(api.assets.getGalleryAsset, { id: parsed.id as Id<"assets">, ownerUserId: owner }).catch(() => null) as Row | null;
    return NextResponse.json({ asset: asset && isGuestVisibleAsset(asset as never, scope.visible) ? sanitizeGuestAsset(asset) : null });
  }

  if (action === "getSkill") {
    const reference = str(data.id ?? data.skillId);
    if (!reference) return NextResponse.json({ error: "id is required." }, { status: 400 });
    return NextResponse.json({ skill: await readGuestSkill(client, owner, scope, reference) });
  }

  if (action === "listSkills") {
    const limit = Math.max(1, Math.min(num(data.limit) ?? 100, 200));
    const skills = await client.query(api.skills.listSkills, {
      ownerUserId: owner,
      tagNames: strArray(data.tagNames),
      folderId: folderId as Id<"folders"> | undefined,
      search: str(data.search),
      limit: 200,
      previewLimit: num(data.previewLimit) ?? 2,
    }) as SkillRow[];
    return NextResponse.json({ skills: (await guestSkills(client, owner, scope, skills)).slice(0, limit) });
  }

  if (action === "searchSkills") {
    const query = str(data.query);
    if (!query) return NextResponse.json({ error: "query is required." }, { status: 400 });
    const limit = Math.max(1, Math.min(num(data.limit) ?? 24, 100));
    const skills = await client.action(api.semanticSearch.searchSkills, {
      ownerUserId: owner,
      query,
      tagNames: strArray(data.tagNames),
      folderId: folderId as Id<"folders"> | undefined,
      minRelativeScore: num(data.minRelativeScore),
      limit: 100,
      previewLimit: num(data.previewLimit) ?? 2,
    }) as SkillRow[];
    return NextResponse.json({ skills: (await guestSkills(client, owner, scope, skills)).slice(0, limit) });
  }

  if (action === "contactSheet") {
    const rawIds = strArray(data.ids ?? data.assetIds);
    if (!rawIds || rawIds.length === 0) return NextResponse.json({ error: "ids is required." }, { status: 400 });
    const ids = rawIds.map((rawId) => parseGalleryId(rawId, "asset").id);
    const visible = await guestVisibleAssetIds(client, owner, scope, ids.slice(0, 200));
    const shown = ids.filter((id) => visible.has(id));
    const hidden = ids.filter((id) => !visible.has(id));
    if (shown.length === 0) return NextResponse.json({ error: "None of these assets were found." }, { status: 404 });
    const sheet = await client.action(api.agentPreview.contactSheet, {
      ownerUserId: owner,
      assetIds: shown,
      columns: num(data.columns),
      maxEdge: num(data.maxEdge),
    });
    return NextResponse.json({ sheet: { ...sheet, missingIds: [...sheet.missingIds, ...hidden] } });
  }

  return NextResponse.json({ error: GUEST_REFUSAL }, { status: 403 });
}
