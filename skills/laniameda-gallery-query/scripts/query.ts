#!/usr/bin/env bun
/**
 * laniameda-gallery-query — CLI script for agents to query the gallery.
 *
 * Uses Convex HTTP API directly — no generated imports, fully portable.
 *
 * Usage:
 *   bun run <path>/query.ts '{"action":"list","pillar":"creators","limit":5}'
 *   bun run <path>/query.ts '{"action":"search","query":"cinematic car","limit":10}'
 *   bun run <path>/query.ts '{"action":"get","assetId":"..."}'
 *   bun run <path>/query.ts '{"action":"download","assetId":"...","outDir":"/tmp/gallery"}'
 *
 * Env vars:
 *   CONVEX_URL or NEXT_PUBLIC_CONVEX_URL — required
 *   KB_OWNER_USER_ID — required for scope=mine (default: 278674008)
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

// --- Config ---

const CONVEX_URL = (
  process.env.CONVEX_URL ||
  process.env.NEXT_PUBLIC_CONVEX_URL ||
  ""
).replace(/\/$/, "");

if (!CONVEX_URL) {
  console.error("ERROR: CONVEX_URL or NEXT_PUBLIC_CONVEX_URL is required.");
  process.exit(1);
}

const OWNER_USER_ID = process.env.KB_OWNER_USER_ID || "278674008";

// --- Convex HTTP helpers ---

async function convexQuery(
  functionPath: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(`${CONVEX_URL}/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: functionPath, args }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Convex query ${functionPath} failed (${response.status}): ${text}`);
  }
  const body = await response.json() as { value?: unknown; errorMessage?: string; status?: string };
  if (body.status === "error" || body.errorMessage) {
    throw new Error(`Convex query error: ${body.errorMessage ?? "unknown"}`);
  }
  return body.value;
}

async function convexAction(
  functionPath: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(`${CONVEX_URL}/api/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: functionPath, args }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Convex action ${functionPath} failed (${response.status}): ${text}`);
  }
  const body = await response.json() as { value?: unknown; errorMessage?: string; status?: string };
  if (body.status === "error" || body.errorMessage) {
    throw new Error(`Convex action error: ${body.errorMessage ?? "unknown"}`);
  }
  return body.value;
}

// --- Types ---

type Pillar = "creators" | "cars" | "designs" | "dump";
type Scope = "mine" | "public";
type AssetKind = "image" | "video";

interface ListParams {
  action: "list";
  scope?: Scope;
  pillar?: Pillar;
  kind?: AssetKind;
  modelName?: string;
  limit?: number;
}

interface SearchParams {
  action: "search";
  query: string;
  scope?: Scope;
  pillar?: Pillar;
  kind?: AssetKind;
  modelName?: string;
  limit?: number;
}

interface GetParams {
  action: "get";
  assetId: string;
}

interface DownloadParams {
  action: "download";
  assetId: string;
  outDir?: string;
}

type Params = ListParams | SearchParams | GetParams | DownloadParams;

// --- Helpers ---

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
  assetRole: unknown;
  createdAt: unknown;
  score?: unknown;
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
  assetRole: asset.assetRole,
  createdAt: asset.createdAt,
  ...(asset.score !== undefined ? { score: asset.score } : {}),
});

async function downloadImage(
  url: string,
  outDir: string,
  fileName: string,
): Promise<string> {
  await mkdir(outDir, { recursive: true });
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const outPath = join(outDir, fileName);
  await writeFile(outPath, buffer);
  return outPath;
}

// --- Actions ---

async function handleList(params: ListParams) {
  const scope = params.scope ?? "mine";
  const limit = Math.min(params.limit ?? 20, 200);

  const fnPath =
    scope === "mine" ? "assets:listGalleryAssets" : "assets:listPublicGalleryAssets";

  const args: Record<string, unknown> = {
    kind: params.kind,
    pillar: params.pillar,
    modelName: params.modelName,
    limit,
  };
  if (scope === "mine") {
    args.ownerUserId = OWNER_USER_ID;
  }

  const assets = (await convexQuery(fnPath, args)) as Record<string, unknown>[];
  return { count: assets.length, assets: assets.map(compactAsset) };
}

async function handleSearch(params: SearchParams) {
  const scope = params.scope ?? "mine";
  const limit = Math.min(params.limit ?? 20, 100);

  const results = (await convexAction("semanticSearch:searchAssets", {
    ownerUserId: scope === "mine" ? OWNER_USER_ID : undefined,
    scope,
    query: params.query,
    pillar: params.pillar,
    kind: params.kind,
    modelName: params.modelName,
    limit,
  })) as Record<string, unknown>[];
  return { count: results.length, results: results.map(compactAsset) };
}

async function handleGet(params: GetParams) {
  const asset = (await convexQuery("assets:getGalleryAsset", {
    id: params.assetId,
    ownerUserId: OWNER_USER_ID,
  })) as Record<string, unknown> | null;

  if (!asset) {
    return { error: `Asset ${params.assetId} not found in owner's gallery.` };
  }
  return { asset: compactAsset(asset) };
}

async function handleDownload(params: DownloadParams) {
  const outDir = params.outDir || "/tmp/laniameda-gallery";

  const result = await handleGet({ action: "get", assetId: params.assetId });
  if ("error" in result) {
    return result;
  }

  const asset = result.asset;
  const url = (asset.url || asset.sourceUrl) as string | undefined;
  if (!url) {
    return { error: "Asset has no downloadable URL.", asset };
  }

  const ext =
    typeof asset.fileName === "string"
      ? asset.fileName.split(".").pop() || "png"
      : "png";
  const safeName = `${asset.id}.${ext}`;
  const savedPath = await downloadImage(url, outDir, safeName);

  return {
    savedPath,
    asset,
    promptText: asset.promptText,
  };
}

// --- Main ---

async function main() {
  const rawInput = process.argv[2];
  if (!rawInput) {
    console.error(
      "Usage: bun run query.ts '{\"action\":\"list\",\"pillar\":\"creators\"}'",
    );
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
    console.error(
      "ERROR: 'action' field is required (list, search, get, download).",
    );
    process.exit(1);
  }

  let result: unknown;
  switch (params.action) {
    case "list":
      result = await handleList(params);
      break;
    case "search":
      result = await handleSearch(params as SearchParams);
      break;
    case "get":
      result = await handleGet(params as GetParams);
      break;
    case "download":
      result = await handleDownload(params as DownloadParams);
      break;
    default:
      console.error(
        `ERROR: Unknown action '${(params as Params).action}'.`,
      );
      process.exit(1);
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error("ERROR:", error instanceof Error ? error.message : error);
  process.exit(1);
});
