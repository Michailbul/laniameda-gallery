#!/usr/bin/env bun
/**
 * laniameda-gallery-query — CLI script for agents to query the gallery.
 *
 * Uses Convex HTTP API directly and supports both asset-centric reads and the
 * structured designs pillar.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

type Pillar = "creators" | "designs" | "dump";
type Scope = "mine" | "public";
type AssetKind = "image" | "video";
type AssetRole =
  | "generated_output"
  | "reference"
  | "inspiration_capture"
  | "workflow_asset"
  | "other";
type CaptureKind = "website" | "image" | "component" | "tutorial";
type SaveIntent = "utility" | "inspiration" | "component" | "tutorial";
type InspirationType =
  | "website"
  | "landing_page"
  | "dashboard"
  | "component"
  | "mobile_app"
  | "motion"
  | "branding"
  | "asset_pack"
  | "other";
type Platform = "web" | "ios" | "android" | "cross_platform" | "other";
type WorkflowType =
  | "component_prompt"
  | "page_prompt"
  | "system_prompt"
  | "asset_recipe"
  | "other";

interface AssetListParams {
  action: "list";
  scope?: Scope;
  pillar?: Pillar;
  kind?: AssetKind;
  modelName?: string;
  folderId?: string;
  assetRole?: AssetRole;
  search?: string;
  limit?: number;
}

interface AssetSearchParams {
  action: "search";
  query: string;
  scope?: Scope;
  pillar?: Pillar;
  kind?: AssetKind;
  modelName?: string;
  folderId?: string;
  assetRole?: AssetRole;
  limit?: number;
}

interface AssetGetParams {
  action: "get";
  assetId: string;
}

interface GalleryIdGetParams {
  action: "getById";
  id: string;
}

interface AssetDownloadParams {
  action: "download";
  assetId: string;
  outDir?: string;
}

interface AssetPackGetParams {
  action: "getPack";
  packId: string;
}

interface DesignListParams {
  action: "listDesigns";
  inspirationType?: InspirationType;
  platform?: Platform;
  workflowType?: WorkflowType;
  captureKind?: CaptureKind;
  saveIntent?: SaveIntent;
  folderId?: string;
  sourceDomain?: string;
  search?: string;
  dateFrom?: number;
  dateTo?: number;
  requireAsset?: boolean;
  limit?: number;
}

interface DesignGetParams {
  action: "getDesign";
  designInspirationId: string;
}

type Params =
  | AssetListParams
  | AssetSearchParams
  | AssetGetParams
  | GalleryIdGetParams
  | AssetDownloadParams
  | AssetPackGetParams
  | DesignListParams
  | DesignGetParams;

type QueryRuntime = {
  convexUrl?: string;
  ownerUserId?: string;
  fetchImpl?: typeof fetch;
};

interface CompactAsset {
  id: unknown;
  kind: unknown;
  pillar: unknown;
  modelName: unknown;
  promptText: unknown;
  tagNames: unknown;
  fileName: unknown;
  url: unknown;
  thumbUrl: unknown;
  sourceUrl: unknown;
  width: unknown;
  height: unknown;
  folderId: unknown;
  assetRole: unknown;
  assetPackId: unknown;
  packSlotIndex: unknown;
  createdAt: unknown;
  score?: unknown;
}

interface CompactAssetPack {
  id: unknown;
  title: unknown;
  description: unknown;
  pillar: unknown;
  modelName: unknown;
  domain: unknown;
  ingestKey: unknown;
  coverAssetId: unknown;
  isPublic: unknown;
  isFeatured: unknown;
  itemCount: unknown;
  createdAt: unknown;
  updatedAt: unknown;
}

interface CompactDesignEntry {
  id: unknown;
  title: unknown;
  summary: unknown;
  sourceUrl: unknown;
  sourceDomain: unknown;
  sourceTitle: unknown;
  userNote: unknown;
  inspirationType: unknown;
  platform: unknown;
  workflowType: unknown;
  captureKind: unknown;
  saveIntent: unknown;
  templateKey: unknown;
  sourceFingerprint: unknown;
  status: unknown;
  tagNames: unknown;
  previewUrl: unknown;
  previewThumbUrl: unknown;
  previewWidth: unknown;
  previewHeight: unknown;
  folderId: unknown;
  assetId: unknown;
  promptId: unknown;
  createdAt: unknown;
  updatedAt: unknown;
}

export function resolveConvexUrl(explicitValue?: string): string {
  const value = (
    explicitValue ||
    process.env.CONVEX_URL ||
    process.env.NEXT_PUBLIC_CONVEX_URL ||
    ""
  ).replace(/\/$/, "");

  if (!value) {
    throw new Error("CONVEX_URL or NEXT_PUBLIC_CONVEX_URL is required.");
  }

  return value;
}

export function resolveOwnerUserId(explicitValue?: string): string {
  const value = (explicitValue || process.env.KB_OWNER_USER_ID || "").trim();
  if (!value) {
    throw new Error("KB_OWNER_USER_ID is required for mine-scoped gallery reads.");
  }
  return value;
}

type GalleryIdKind = "asset" | "pack" | "design";

function normalizeGalleryIdKind(kind: string): GalleryIdKind | null {
  switch (kind) {
    case "asset":
    case "assets":
      return "asset";
    case "pack":
    case "packs":
    case "assetPack":
    case "assetPacks":
      return "pack";
    case "design":
    case "designs":
    case "designInspiration":
    case "designInspirations":
      return "design";
    default:
      return null;
  }
}

function parseGalleryId(value: string, expectedKind?: GalleryIdKind) {
  const trimmed = value.trim();
  const separatorIndex = trimmed.indexOf(":");
  if (separatorIndex > 0) {
    const rawKind = trimmed.slice(0, separatorIndex);
    const id = trimmed.slice(separatorIndex + 1).trim();
    const kind = normalizeGalleryIdKind(rawKind);
    if (kind && id) {
      if (expectedKind && kind !== expectedKind) {
        throw new Error(`Expected a ${expectedKind} ID, got ${kind}:${id}.`);
      }
      return { kind, id };
    }
  }

  if (expectedKind) {
    return { kind: expectedKind, id: trimmed };
  }

  throw new Error(
    "Typed gallery ID is required. Use asset:<id>, pack:<id>, or design:<id>.",
  );
}

const compactAsset = (asset: Record<string, unknown>): CompactAsset => ({
  id: asset._id,
  kind: asset.kind,
  pillar: asset.pillar,
  modelName: asset.modelName,
  promptText: asset.promptText,
  tagNames: asset.tagNames,
  fileName: asset.fileName,
  url: asset.url,
  thumbUrl: asset.thumbUrl,
  sourceUrl: asset.sourceUrl,
  width: asset.width,
  height: asset.height,
  folderId: asset.folderId,
  assetRole: asset.assetRole,
  assetPackId: asset.assetPackId,
  packSlotIndex: asset.packSlotIndex,
  createdAt: asset.createdAt,
  ...(asset.score !== undefined ? { score: asset.score } : {}),
});

const compactAssetPack = (pack: Record<string, unknown>): CompactAssetPack => ({
  id: pack._id,
  title: pack.title,
  description: pack.description,
  pillar: pack.pillar,
  modelName: pack.modelName,
  domain: pack.domain,
  ingestKey: pack.ingestKey,
  coverAssetId: pack.coverAssetId,
  isPublic: pack.isPublic,
  isFeatured: pack.isFeatured,
  itemCount: pack.itemCount,
  createdAt: pack.createdAt,
  updatedAt: pack.updatedAt,
});

const compactDesignEntry = (
  entry: Record<string, unknown>,
): CompactDesignEntry => ({
  id: entry._id,
  title: entry.title,
  summary: entry.summary,
  sourceUrl: entry.sourceUrl,
  sourceDomain: entry.sourceDomain,
  sourceTitle: entry.sourceTitle,
  userNote: entry.userNote,
  inspirationType: entry.inspirationType,
  platform: entry.platform,
  workflowType: entry.workflowType,
  captureKind: entry.captureKind,
  saveIntent: entry.saveIntent,
  templateKey: entry.templateKey,
  sourceFingerprint: entry.sourceFingerprint,
  status: entry.status,
  tagNames: entry.tagNames,
  previewUrl: entry.previewUrl,
  previewThumbUrl: entry.previewThumbUrl,
  previewWidth: entry.previewWidth,
  previewHeight: entry.previewHeight,
  folderId: entry.folderId,
  assetId: entry.assetId,
  promptId: entry.promptId,
  createdAt: entry.createdAt,
  updatedAt: entry.updatedAt,
});

function createHttpClient(runtime?: QueryRuntime) {
  const convexUrl = resolveConvexUrl(runtime?.convexUrl);
  const fetchImpl = runtime?.fetchImpl ?? fetch;

  return {
    convexUrl,
    async convexQuery(functionPath: string, args: Record<string, unknown>) {
      const response = await fetchImpl(`${convexUrl}/api/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: functionPath, args }),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Convex query ${functionPath} failed (${response.status}): ${text}`);
      }

      const body = await response.json() as {
        value?: unknown;
        errorMessage?: string;
        status?: string;
      };
      if (body.status === "error" || body.errorMessage) {
        throw new Error(`Convex query error: ${body.errorMessage ?? "unknown"}`);
      }
      return body.value;
    },
    async convexAction(functionPath: string, args: Record<string, unknown>) {
      const response = await fetchImpl(`${convexUrl}/api/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: functionPath, args }),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Convex action ${functionPath} failed (${response.status}): ${text}`);
      }

      const body = await response.json() as {
        value?: unknown;
        errorMessage?: string;
        status?: string;
      };
      if (body.status === "error" || body.errorMessage) {
        throw new Error(`Convex action error: ${body.errorMessage ?? "unknown"}`);
      }
      return body.value;
    },
    fetchImpl,
  };
}

function ownerForScope(scope: Scope, runtime?: QueryRuntime) {
  return scope === "mine" ? resolveOwnerUserId(runtime?.ownerUserId) : undefined;
}

async function downloadFile(
  url: string,
  outDir: string,
  fileName: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  await mkdir(outDir, { recursive: true });
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch asset bytes: ${response.status} ${response.statusText}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const outPath = join(outDir, fileName);
  await writeFile(outPath, buffer);
  return outPath;
}

export async function handleList(params: AssetListParams, runtime?: QueryRuntime) {
  const scope = params.scope ?? "mine";
  const limit = Math.min(params.limit ?? 20, 200);
  const { convexQuery } = createHttpClient(runtime);

  const fnPath =
    scope === "mine" ? "assets:listGalleryAssets" : "assets:listPublicGalleryAssets";

  const args: Record<string, unknown> = {
    kind: params.kind,
    pillar: params.pillar,
    modelName: params.modelName,
    folderId: scope === "mine" ? params.folderId : undefined,
    assetRole: params.assetRole,
    search: params.search,
    limit,
  };

  const ownerUserId = ownerForScope(scope, runtime);
  if (ownerUserId) {
    args.ownerUserId = ownerUserId;
  }

  const assets = (await convexQuery(fnPath, args)) as Record<string, unknown>[];
  return { count: assets.length, assets: assets.map(compactAsset) };
}

export async function handleSearch(params: AssetSearchParams, runtime?: QueryRuntime) {
  const scope = params.scope ?? "mine";
  const limit = Math.min(params.limit ?? 20, 100);
  const { convexAction } = createHttpClient(runtime);

  const results = (await convexAction("semanticSearch:searchAssets", {
    ownerUserId: ownerForScope(scope, runtime),
    scope,
    query: params.query,
    pillar: params.pillar,
    folderId: scope === "mine" ? params.folderId : undefined,
    kind: params.kind,
    modelName: params.modelName,
    assetRole: params.assetRole,
    limit,
  })) as Record<string, unknown>[];

  return { count: results.length, results: results.map(compactAsset) };
}

export async function handleGet(params: AssetGetParams, runtime?: QueryRuntime) {
  const { convexQuery } = createHttpClient(runtime);
  const { id: assetId } = parseGalleryId(params.assetId, "asset");
  const asset = (await convexQuery("assets:getGalleryAsset", {
    id: assetId,
    ownerUserId: resolveOwnerUserId(runtime?.ownerUserId),
  })) as Record<string, unknown> | null;

  if (!asset) {
    return { error: `Asset ${assetId} not found in the owner-scoped gallery.` };
  }

  return { asset: compactAsset(asset) };
}

export async function handleGetPack(params: AssetPackGetParams, runtime?: QueryRuntime) {
  const { convexQuery } = createHttpClient(runtime);
  const { id: packId } = parseGalleryId(params.packId, "pack");
  const packResult = (await convexQuery("assetPacks:getGalleryAssetPack", {
    packId,
    ownerUserId: resolveOwnerUserId(runtime?.ownerUserId),
  })) as { pack: Record<string, unknown>; assets: Record<string, unknown>[] } | null;

  if (!packResult) {
    return { error: `Pack ${packId} not found in the owner-scoped gallery.` };
  }

  return {
    pack: compactAssetPack(packResult.pack),
    count: packResult.assets.length,
    assets: packResult.assets.map(compactAsset),
  };
}

export async function handleGetById(params: GalleryIdGetParams, runtime?: QueryRuntime) {
  const parsed = parseGalleryId(params.id);
  if (parsed.kind === "asset") {
    return await handleGet({ action: "get", assetId: parsed.id }, runtime);
  }
  if (parsed.kind === "pack") {
    return await handleGetPack({ action: "getPack", packId: parsed.id }, runtime);
  }
  return await handleGetDesign(
    { action: "getDesign", designInspirationId: parsed.id },
    runtime,
  );
}

export async function handleDownload(params: AssetDownloadParams, runtime?: QueryRuntime) {
  const outDir = params.outDir || "/tmp/laniameda-gallery";
  const { fetchImpl } = createHttpClient(runtime);
  const { id: assetId } = parseGalleryId(params.assetId, "asset");

  const result = await handleGet({ action: "get", assetId }, runtime);
  if ("error" in result) {
    return result;
  }

  const asset = result.asset;
  const url = (asset.url || asset.sourceUrl) as string | undefined;
  if (!url) {
    return { error: "Asset has no downloadable URL.", asset };
  }

  const ext =
    typeof asset.fileName === "string" ? asset.fileName.split(".").pop() || "bin" : "bin";
  const savedPath = await downloadFile(url, outDir, `${asset.id}.${ext}`, fetchImpl);

  return {
    savedPath,
    asset,
    promptText: asset.promptText,
  };
}

export async function handleListDesigns(
  params: DesignListParams,
  runtime?: QueryRuntime,
) {
  const { convexQuery } = createHttpClient(runtime);
  const designs = (await convexQuery("designInspirations:listDesignGalleryEntries", {
    ownerUserId: resolveOwnerUserId(runtime?.ownerUserId),
    inspirationType: params.inspirationType,
    platform: params.platform,
    workflowType: params.workflowType,
    captureKind: params.captureKind,
    saveIntent: params.saveIntent,
    folderId: params.folderId,
    sourceDomain: params.sourceDomain,
    search: params.search,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    requireAsset: params.requireAsset,
    limit: Math.min(params.limit ?? 20, 200),
  })) as Record<string, unknown>[];

  return { count: designs.length, designs: designs.map(compactDesignEntry) };
}

export async function handleGetDesign(params: DesignGetParams, runtime?: QueryRuntime) {
  const { convexQuery } = createHttpClient(runtime);
  const ownerUserId = resolveOwnerUserId(runtime?.ownerUserId);
  const { id: designInspirationId } = parseGalleryId(
    params.designInspirationId,
    "design",
  );
  const design = (await convexQuery("designInspirations:getDesignInspiration", {
    id: designInspirationId,
    ownerUserId,
  })) as Record<string, unknown> | null;

  if (!design) {
    return {
      error: `Design inspiration ${designInspirationId} not found in the owner-scoped gallery.`,
    };
  }

  const assetId =
    typeof design.assetId === "string" && design.assetId.trim().length > 0
      ? design.assetId
      : undefined;
  const linkedAsset = assetId
    ? ((await convexQuery("assets:getGalleryAsset", {
        id: assetId,
        ownerUserId,
      })) as Record<string, unknown> | null)
    : null;

  return {
    design: compactDesignEntry(design),
    linkedAsset: linkedAsset ? compactAsset(linkedAsset) : null,
  };
}

export async function runGalleryQuery(params: Params, runtime?: QueryRuntime) {
  switch (params.action) {
    case "list":
      return await handleList(params, runtime);
    case "search":
      return await handleSearch(params, runtime);
    case "get":
      return await handleGet(params, runtime);
    case "getById":
      return await handleGetById(params, runtime);
    case "download":
      return await handleDownload(params, runtime);
    case "getPack":
      return await handleGetPack(params, runtime);
    case "listDesigns":
      return await handleListDesigns(params, runtime);
    case "getDesign":
      return await handleGetDesign(params, runtime);
    default:
      throw new Error(`Unknown action '${(params as { action: string }).action}'.`);
  }
}

async function main() {
  const rawInput = process.argv[2];
  if (!rawInput) {
    console.error("Usage: bun run query.ts '{\"action\":\"list\",\"pillar\":\"creators\"}'");
    process.exit(1);
  }

  let params: Params;
  try {
    params = JSON.parse(rawInput) as Params;
  } catch {
    console.error("ERROR: Invalid JSON input.");
    process.exit(1);
  }

  if (!params.action) {
    console.error("ERROR: 'action' field is required.");
    process.exit(1);
  }

  try {
    const result = await runGalleryQuery(params);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("ERROR:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
