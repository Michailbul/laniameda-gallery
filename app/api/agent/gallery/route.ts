import { NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { requireAgentAuth, AgentAuthError } from "@/lib/server/agent-auth";
import { getServerConvexClient } from "@/lib/server/convex";

type GalleryIdKind = "asset" | "pack" | "design";

const readJson = async (request: Request) => {
  try {
    const data = await request.json();
    return data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const stringValue = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const numberValue = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const stringArrayValue = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : undefined;

const normalizeGalleryIdKind = (kind: string): GalleryIdKind | null => {
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
};

const parseGalleryId = (rawValue: unknown, expectedKind?: GalleryIdKind) => {
  const value = stringValue(rawValue);
  if (!value) {
    throw new Error("id is required.");
  }

  const separatorIndex = value.indexOf(":");
  if (separatorIndex > 0) {
    const kind = normalizeGalleryIdKind(value.slice(0, separatorIndex));
    const id = value.slice(separatorIndex + 1).trim();
    if (kind && id) {
      if (expectedKind && kind !== expectedKind) {
        throw new Error(`Expected a ${expectedKind} ID, got ${kind}:${id}.`);
      }
      return { kind, id };
    }
  }

  if (expectedKind) {
    return { kind: expectedKind, id: value };
  }

  throw new Error("Typed gallery ID is required. Use asset:<id>, pack:<id>, or design:<id>.");
};

export async function POST(request: Request) {
  try {
    const agent = await requireAgentAuth(request, "gallery:read");
    const data = await readJson(request);
    if (!data) {
      return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
    }

    const action = stringValue(data.action);
    if (!action) {
      return NextResponse.json({ error: "action is required." }, { status: 400 });
    }

    const client = getServerConvexClient();

    if (action === "listAssets") {
      const assets = await client.query(api.assets.listGalleryAssets, {
        ownerUserId: agent.ownerUserId,
        kind: stringValue(data.kind) as "image" | "video" | undefined,
        tagIds: stringArrayValue(data.tagIds) as Id<"tags">[] | undefined,
        folderId: stringValue(data.folderId) as Id<"folders"> | undefined,
        modelName: stringValue(data.modelName),
        pillar: stringValue(data.pillar),
        assetRole: stringValue(data.assetRole) as
          | "generated_output"
          | "reference"
          | "inspiration_capture"
          | "workflow_asset"
          | "cinema_frame"
          | "other"
          | undefined,
        search: stringValue(data.search),
        limit: numberValue(data.limit),
      });
      return NextResponse.json({ assets });
    }

    if (action === "searchAssets") {
      const query = stringValue(data.query);
      if (!query) {
        return NextResponse.json({ error: "query is required." }, { status: 400 });
      }
      const results = await client.action(api.semanticSearch.searchAssets, {
        ownerUserId: agent.ownerUserId,
        scope: "mine",
        query,
        pillar: stringValue(data.pillar),
        folderId: stringValue(data.folderId) as Id<"folders"> | undefined,
        kind: stringValue(data.kind) as "image" | "video" | undefined,
        modelName: stringValue(data.modelName),
        assetRole: stringValue(data.assetRole) as
          | "generated_output"
          | "reference"
          | "inspiration_capture"
          | "workflow_asset"
          | "cinema_frame"
          | "other"
          | undefined,
        limit: numberValue(data.limit),
      });
      return NextResponse.json({ results });
    }

    if (action === "getById") {
      const parsed = parseGalleryId(data.id);
      if (parsed.kind === "asset") {
        const asset = await client.query(api.assets.getGalleryAsset, {
          id: parsed.id as Id<"assets">,
          ownerUserId: agent.ownerUserId,
        });
        return NextResponse.json({ asset });
      }
      if (parsed.kind === "pack") {
        const pack = await client.query(api.assetPacks.getGalleryAssetPack, {
          packId: parsed.id as Id<"assetPacks">,
          ownerUserId: agent.ownerUserId,
        });
        return NextResponse.json({ pack });
      }

      const design = await client.query(api.designInspirations.getDesignInspiration, {
        id: parsed.id as Id<"designInspirations">,
        ownerUserId: agent.ownerUserId,
      });
      const asset =
        design?.assetId
          ? await client.query(api.assets.getGalleryAsset, {
              id: design.assetId,
              ownerUserId: agent.ownerUserId,
            })
          : null;
      return NextResponse.json({ design, asset });
    }

    if (action === "listFolders") {
      const folders = await client.query(api.folders.listFolders, {
        ownerUserId: agent.ownerUserId,
      });
      return NextResponse.json({ folders });
    }

    if (action === "listDesigns") {
      const designs = await client.query(api.designInspirations.listDesignGalleryEntries, {
        ownerUserId: agent.ownerUserId,
        pillar: stringValue(data.pillar) ?? "designs",
        folderId: stringValue(data.folderId) as Id<"folders"> | undefined,
        inspirationType: stringValue(data.inspirationType) as never,
        platform: stringValue(data.platform) as never,
        workflowType: stringValue(data.workflowType) as never,
        captureKind: stringValue(data.captureKind) as never,
        saveIntent: stringValue(data.saveIntent) as never,
        sourceDomain: stringValue(data.sourceDomain),
        search: stringValue(data.search),
        requireAsset: data.requireAsset === true ? true : undefined,
        limit: numberValue(data.limit),
      });
      return NextResponse.json({ designs });
    }

    return NextResponse.json({ error: `Unsupported action: ${action}` }, { status: 400 });
  } catch (error) {
    if (error instanceof AgentAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
