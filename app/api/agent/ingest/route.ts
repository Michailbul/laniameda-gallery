import { NextResponse } from "next/server";
import { makeFunctionReference } from "convex/server";
import { requireAgentAuth, AgentAuthError } from "@/lib/server/agent-auth";
import { getServerConvexClient } from "@/lib/server/convex";

const ingestAction = makeFunctionReference<"action">("ingest:ingestFromApi");
const addAssetFoldersMutation = makeFunctionReference<"mutation">(
  "assets:addAssetFolders",
);

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

const readFolderIds = (value: unknown) => {
  if (!Array.isArray(value)) return undefined;
  return Array.from(
    new Set(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
};

export async function POST(request: Request) {
  try {
    const agent = await requireAgentAuth(request, "gallery:write");
    const data = await readJson(request);
    if (!data) {
      return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
    }

    const {
      ownerUserId: _ignoredOwnerUserId,
      folderIds: rawFolderIds,
      ...rest
    } = data;
    const folderIds = readFolderIds(rawFolderIds);
    const requestedPrimaryFolderId =
      typeof rest.folderId === "string" && rest.folderId.trim()
        ? rest.folderId.trim()
        : folderIds?.[0];
    const payload = {
      ...rest,
      ...(requestedPrimaryFolderId
        ? { folderId: requestedPrimaryFolderId }
        : {}),
      ownerUserId: agent.ownerUserId,
      ingestSource:
        typeof rest.ingestSource === "string" ? rest.ingestSource : "agent",
    };

    const client = getServerConvexClient();
    const result = await client.action(ingestAction, payload);
    const collections =
      result.assetId && folderIds
        ? await client.mutation(addAssetFoldersMutation, {
            ownerUserId: agent.ownerUserId,
            assetId: result.assetId,
            folderIds,
          })
        : undefined;
    return NextResponse.json({ ok: true, result, collections });
  } catch (error) {
    if (error instanceof AgentAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
