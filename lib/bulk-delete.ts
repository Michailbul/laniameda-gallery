export type AssetDeleteResult =
  | { assetId: string; ok: true }
  | { assetId: string; ok: false; error: string };

async function deleteSelectedAsset(assetId: string, request: typeof fetch) {
  for (let attempt = 0; ; attempt++) {
    const response = await request(`/api/assets/${encodeURIComponent(assetId)}`, {
      method: "DELETE",
    });
    if (response.ok) return;

    const payload = await response.json().catch(() => ({})) as { error?: string };
    const message = typeof payload?.error === "string"
      ? payload.error
      : "Failed to delete asset.";
    const conflict = response.status >= 500
      && message.includes("OptimisticConcurrencyControlFailure");
    if (!conflict) throw new Error(message);
    // Convex reports this only after the mutation and its retries failed to
    // commit. Retry that conflict, never an ambiguous network/storage failure.
    if (attempt >= 2) {
      throw new Error("The gallery is busy updating these assets. Please retry deletion.");
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
  }
}

// Reuse the authenticated single-asset endpoint so bulk deletion has exactly
// the same admin checks and storage/lineage cleanup. Keep failures independent.
export async function deleteAssetSelection(
  assetIds: readonly string[],
  options: {
    request?: typeof fetch;
    onResult?: (result: AssetDeleteResult, completed: number, total: number) => void;
  } = {},
): Promise<AssetDeleteResult[]> {
  const ids = [...new Set(assetIds)];
  const request = options.request ?? fetch;
  const results: AssetDeleteResult[] = [];
  // Selected assets often share tag counters, collections and packs. Await
  // each cascade so this batch cannot contend with itself on those documents.
  for (const assetId of ids) {
    let result: AssetDeleteResult;
    try {
      await deleteSelectedAsset(assetId, request);
      result = { assetId, ok: true };
    } catch (error) {
      result = {
        assetId,
        ok: false,
        error: error instanceof Error ? error.message : "Failed to delete asset.",
      };
    }
    results.push(result);
    options.onResult?.(result, results.length, ids.length);
  }
  return results;
}
