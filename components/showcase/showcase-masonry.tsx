"use client";

import { useCallback, useMemo, useState } from "react";
import { MasonryGrid } from "@/components/masonry-grid";
import { ShowcaseLightbox } from "./showcase-lightbox";
import { assetSrc, assetThumb } from "./types";
import { sharedAssetHref } from "@/lib/shared-asset-link";
import type { ShowcaseAsset } from "./types";

/**
 * The vault's justified masonry, rendered for the public surface.
 *
 * Same component the signed-in gallery uses — none of the owner affordances
 * are passed, so the cards come out clean: no selection, no like button, no
 * collection menu, no drag. Clicking a tile opens the public lightbox instead
 * of the owner's detail panel.
 */
export function ShowcaseMasonry({
  assets,
  loading = false,
  onEndReached,
  compact = true,
  zoom = 1,
  labels,
  onSetCover,
  coverAssetId,
}: {
  assets: ShowcaseAsset[];
  loading?: boolean;
  onEndReached?: () => void;
  /** Fewer, bigger columns (3 at 2xl instead of 5). On by default here. */
  compact?: boolean;
  /** Tile size factor, 0.4–1 — the grid's own zoom. */
  zoom?: number;
  /** assetId → caption shown on card hover (e.g. the world it belongs to). */
  labels?: Map<string, string>;
  /** Owner-only: make the open piece this set's thumbnail. */
  onSetCover?: (asset: ShowcaseAsset) => Promise<void> | void;
  coverAssetId?: string;
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const images = useMemo(
    () =>
      assets.map((asset) => ({
        id: asset._id as string,
        src: assetThumb(asset) ?? "",
        fullSrc: assetSrc(asset) ?? "",
        prompt: asset.promptText ?? asset.description ?? "",
        author: "",
        likes: 0,
        width: asset.width,
        height: asset.height,
        kind: asset.kind,
        contentType: asset.contentType,
        modelName: asset.modelName,
        overlayLabel: labels?.get(asset._id as string),
        tagNames: asset.tagNames,
        createdAt: asset.createdAt,
        // Skip the card's fade-in. Its skeleton clears on the media's `load`
        // event, which a cached R2 asset can fire before React attaches the
        // handler — leaving a loaded image stuck at opacity 0.
        initiallyLoaded: true,
        previewImages: [],
      })),
    [assets, labels],
  );

  // MasonryGrid hands back the image it was given; the index is what the
  // lightbox needs, so resolve it from the id.
  const openFromCard = useCallback(
    (image: { id: string }) => {
      const index = assets.findIndex((asset) => asset._id === image.id);
      if (index >= 0) setLightboxIndex(index);
    },
    [assets],
  );

  return (
    <>
      <MasonryGrid
        images={images}
        compactColumns={compact}
        zoom={zoom}
        loading={loading}
        onImageSelect={openFromCard}
        onEndReached={onEndReached}
      />
      {lightboxIndex !== null && (
        <ShowcaseLightbox
          assets={assets}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
          shareHrefFor={(asset) => sharedAssetHref(asset._id as string)}
          onSetCover={onSetCover}
          coverAssetId={coverAssetId}
        />
      )}
    </>
  );
}
