export async function setAssetSelectionLiked(
  assetIds: readonly string[],
  isLiked: boolean,
  update: (assetId: string, isLiked: boolean) => Promise<unknown>,
  onSuccess?: (assetId: string) => void,
) {
  const ids = [...new Set(assetIds)];
  const updatedIds: string[] = [];
  const failures: { assetId: string; error: string }[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, ids.length) }, async () => {
    while (next < ids.length) {
      const assetId = ids[next++]!;
      try {
        // Set one explicit state across mixed selections; never toggle each
        // item, which would invert already-liked assets and be unsafe to retry.
        await update(assetId, isLiked);
        updatedIds.push(assetId);
        onSuccess?.(assetId);
      } catch (error) {
        failures.push({
          assetId,
          error: error instanceof Error ? error.message : "Could not update favourite.",
        });
      }
    }
  }));
  return { updatedIds, failures };
}
