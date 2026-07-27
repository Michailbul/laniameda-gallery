import { NextResponse } from "next/server";
import { makeFunctionReference } from "convex/server";
import { requireAgentAuth, AgentAuthError } from "@/lib/server/agent-auth";
import { getServerConvexClient } from "@/lib/server/convex";

const updateAction = makeFunctionReference<"action">("ingest:updateFromApi");
const setAssetFoldersMutation = makeFunctionReference<"mutation">(
  "assets:setAssetFolders",
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
    if (folderIds && rest.target !== "asset") {
      return NextResponse.json(
        { error: "folderIds is supported only for asset updates." },
        { status: 400 },
      );
    }

    const client = getServerConvexClient();
    const result = await client.action(updateAction, {
      ...rest,
      ownerUserId: agent.ownerUserId,
    });
    const collections =
      result.assetId && folderIds
        ? await client.mutation(setAssetFoldersMutation, {
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
