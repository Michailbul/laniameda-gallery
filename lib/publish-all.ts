// PUBLISH ALL: the pieces of the current view that are still private, made
// public in one confirmed action. The grid knows only the cards it has loaded,
// so the dialog's number comes from the server (assets.countPrivateAssetsInView)
// and the publish runs over exactly the ids that count returned, in batches
// the bulk-curation route accepts.

/** `/api/admin/assets/bulk-curation` and `assets.bulkSetAssetCuration` cap one
 *  request at this many ids. */
export const PUBLISH_BATCH_SIZE = 200;

export type PrivateCount = {
  count: number;
  assetIds: string[];
  /** False when the server stopped scanning before the view's last row. */
  complete: boolean;
};

export const chunkIds = (ids: readonly string[], size = PUBLISH_BATCH_SIZE): string[][] => {
  const batches: string[][] = [];
  for (let start = 0; start < ids.length; start += size) {
    batches.push(ids.slice(start, start + size));
  }
  return batches;
};

const pieces = (count: number) => `${count.toLocaleString("en-US")} ${count === 1 ? "piece" : "pieces"}`;

/** The dialog's one sentence about what will happen, from the server count.
 *  `viewLabel` names the view ("DEAR ANNETE — ART DECO", "Everything"). */
export const describePrivateCount = (
  result: PrivateCount | null | undefined,
  viewLabel: string,
  state: "counting" | "ready" | "failed" = result ? "ready" : "counting",
): { headline: string; detail: string; publishable: boolean } => {
  if (state === "counting") {
    return {
      headline: "Counting private pieces…",
      detail: `Asking the server how many pieces of ${viewLabel} are still private.`,
      publishable: false,
    };
  }
  if (state === "failed" || !result) {
    return {
      headline: "Could not count this view",
      detail: "The server did not answer. Nothing was published; close this and try again.",
      publishable: false,
    };
  }
  if (!result.complete) {
    return {
      headline: `More than ${pieces(result.count)} are private`,
      detail: `${viewLabel} is too large to publish in one go (the count stopped at ${result.count.toLocaleString("en-US")}). Open a world or a shelf and publish from there.`,
      publishable: false,
    };
  }
  if (result.count === 0) {
    return {
      headline: "Everything here is already public",
      detail: `No private pieces in ${viewLabel}.`,
      publishable: false,
    };
  }
  return {
    headline: `Make ${pieces(result.count)} public`,
    detail: `Every private piece in ${viewLabel} becomes visible to visitors. Publishing cannot be undone in bulk; a piece goes private again one at a time.`,
    publishable: true,
  };
};

export type PublishBatchResult = { updatedCount: number; skippedCount: number };

/** Publishes ids batch by batch through `post`, which sends one request and
 *  returns its counts. Stops at the first failed batch and reports how far it
 *  got, so a retry can start from the ids that were not reached. */
export const publishInBatches = async (
  ids: readonly string[],
  post: (batch: string[]) => Promise<PublishBatchResult>,
  onProgress?: (done: number, total: number) => void,
): Promise<PublishBatchResult & { failedAt?: number; error?: string }> => {
  let updatedCount = 0;
  let skippedCount = 0;
  let done = 0;
  for (const batch of chunkIds(ids)) {
    try {
      const result = await post(batch);
      updatedCount += result.updatedCount;
      skippedCount += result.skippedCount;
    } catch (error) {
      return {
        updatedCount,
        skippedCount,
        failedAt: done,
        error: error instanceof Error ? error.message : "Bulk publish failed.",
      };
    }
    done += batch.length;
    onProgress?.(done, ids.length);
  }
  return { updatedCount, skippedCount };
};
