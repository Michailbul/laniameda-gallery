/**
 * Shareable deep links to a single public asset.
 *
 * A link keeps whatever page it was copied from (`/` or the taste-profile URL)
 * and adds `?asset=<id>`, so the recipient lands on the same surface with the
 * same piece already open. Resolved server-side by `showcase.getPublicAsset`,
 * which only ever returns individually-public assets.
 */
export const SHARED_ASSET_PARAM = "asset";

/**
 * Absolute link to `assetId` on the CURRENT page. Client-only — it reads
 * window.location so the link inherits the surface the user is actually on.
 */
export function sharedAssetHref(assetId: string): string {
  const url = new URL(window.location.href);
  // Keep the path, drop everything else: a share link shouldn't carry the
  // sharer's incidental state (scroll restoration keys, other params).
  url.search = "";
  url.hash = "";
  url.searchParams.set(SHARED_ASSET_PARAM, assetId);
  return url.toString();
}
