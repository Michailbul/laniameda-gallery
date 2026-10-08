export type AssetDeleteResult =
  | { assetId: string; ok: true }
  | { assetId: string; ok: false; error: string };

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
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, ids.length) }, async () => {
      while (next < ids.length) {
        const assetId = ids[next++]!;
        let result: AssetDeleteResult;
        try {
          const response = await request(`/api/assets/${encodeURIComponent(assetId)}`, {
            method: "DELETE",
          });
          if (!response.ok) {
            const payload = await response.json().catch(() => ({})) as { error?: string };
            throw new Error(payload.error || "Failed to delete asset.");
          }
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
    }),
  );
  return results;
}
