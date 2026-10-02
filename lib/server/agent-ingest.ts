import { makeFunctionReference } from "convex/server";
import type { AgentAuthContext } from "@/lib/server/agent-auth";
import { resolveUploadedMedia } from "@/lib/server/agent-uploads";
import { getServerConvexClient } from "@/lib/server/convex";

const ingestAction = makeFunctionReference<"action">("ingest:ingestFromApi");
const addAssetFoldersMutation = makeFunctionReference<"mutation">(
  "assets:addAssetFolders",
);

export const MAX_INGEST_BATCH = 50;

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

const optionalString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

/**
 * One agent save: the token decides the owner, `folderIds` become collection
 * memberships, and an `uploadId` (from prepare_uploads) is resolved into the
 * R2 media fields. Shared by /api/agent/ingest and /api/agent/ingest/batch.
 */
export const ingestForAgent = async (agent: AgentAuthContext, data: Record<string, unknown>) => {
  const {
    ownerUserId: _ignoredOwnerUserId,
    folderIds: rawFolderIds,
    uploadId: rawUploadId,
    posterUploadId: rawPosterUploadId,
    // Raw R2 keys are only accepted through a signed uploadId.
    r2Key: _ignoredR2Key,
    ...rest
  } = data;
  const folderIds = readFolderIds(rawFolderIds);
  const requestedPrimaryFolderId = optionalString(rest.folderId) ?? folderIds?.[0];

  const uploadId = optionalString(rawUploadId);
  const media = uploadId
    ? await resolveUploadedMedia({
        ownerUserId: agent.ownerUserId,
        uploadId,
        posterUploadId: optionalString(rawPosterUploadId),
        fileName: optionalString(rest.fileName),
        contentType: optionalString(rest.contentType),
      })
    : undefined;
  if (media) {
    delete rest.fileName;
    delete rest.contentType;
  }

  const payload = {
    ...rest,
    ...(media ?? {}),
    ...(requestedPrimaryFolderId ? { folderId: requestedPrimaryFolderId } : {}),
    ownerUserId: agent.ownerUserId,
    ingestSource: typeof rest.ingestSource === "string" ? rest.ingestSource : "agent",
  };

  const client = getServerConvexClient(agent.ownerUserId);
  const result = await client.action(ingestAction, payload);
  const collections =
    result.assetId && folderIds
      ? await client.mutation(addAssetFoldersMutation, {
          ownerUserId: agent.ownerUserId,
          assetId: result.assetId,
          folderIds,
        })
      : undefined;
  return { result, collections };
};
