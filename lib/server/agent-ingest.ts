import { makeFunctionReference } from "convex/server";
import type { AgentAuthContext } from "@/lib/server/agent-auth";
import { resolveUploadedMedia } from "@/lib/server/agent-uploads";
import { getServerConvexClient } from "@/lib/server/convex";

const ingestAction = makeFunctionReference<"action">("ingest:ingestFromApi");
const addAssetFoldersMutation = makeFunctionReference<"mutation">(
  "assets:addAssetFolders",
);
const validateOwnedFoldersQuery = makeFunctionReference<"query">("folders:validateOwnedFolders");

export const MAX_INGEST_BATCH = 50;

export const readAgentFolderIds = (value: unknown) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 100 || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
    throw new Error("folderIds must be an array of at most 100 non-empty collection IDs.");
  }
  return Array.from(
    new Set(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
};

export const validateAgentFolders = async (
  client: ReturnType<typeof getServerConvexClient>, ownerUserId: string, folderIds: string[],
) => {
  if (folderIds.length) await client.query(validateOwnedFoldersQuery, { ownerUserId, folderIds: [...new Set(folderIds)] });
};

export class PartialAgentSaveError extends Error {
  constructor(public readonly result: Record<string, unknown>, public readonly requestedFolderIds: string[], cause: unknown, public readonly failedStep = "collections") {
    super(cause instanceof Error ? cause.message : "Collection filing failed after saving.");
    this.name = "PartialAgentSaveError";
  }

  toResult() {
    return { ...this.result, ok: false, partial: true, result: this.result, failedStep: this.failedStep, requestedFolderIds: this.requestedFolderIds, error: this.message };
  }
}

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
  const folderIds = readAgentFolderIds(rawFolderIds);
  const requestedPrimaryFolderId = optionalString(rest.folderId) ?? folderIds?.[0];
  const client = getServerConvexClient(agent.ownerUserId);
  await validateAgentFolders(client, agent.ownerUserId, [...(folderIds ?? []), ...(requestedPrimaryFolderId ? [requestedPrimaryFolderId] : [])]);

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

  const result = await client.action(ingestAction, payload);
  if (result.partial) throw new PartialAgentSaveError(result, folderIds ?? [], new Error(result.error ?? "A save is incomplete."), result.failedStep ?? "save");
  let collections;
  if (result.assetId && folderIds) {
    try {
      collections = await client.mutation(addAssetFoldersMutation, {
          ownerUserId: agent.ownerUserId,
          assetId: result.assetId,
          folderIds,
      });
    } catch (error) { throw new PartialAgentSaveError(result, folderIds, error); }
  }
  return { result, collections };
};
