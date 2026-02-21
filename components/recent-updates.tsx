"use client";

import Image from "next/image";

interface RecentAsset {
  _id: string;
  thumbUrl?: string;
  url?: string;
  sourceUrl?: string;
  promptText?: string;
}

interface RecentUpdatesProps {
  assets: RecentAsset[];
  onAssetClick?: (assetId: string) => void;
}

export function RecentUpdates({ assets, onAssetClick }: RecentUpdatesProps) {
  const items = assets.slice(0, 6);

  if (items.length === 0) return null;

  return (
    <div
      className="grid grid-cols-2 gap-2"
    >
      {items.map((asset) => {
        const src = asset.thumbUrl ?? asset.url ?? asset.sourceUrl;
        if (!src) return null;
        return (
          <button
            key={asset._id}
            type="button"
            onClick={() => onAssetClick?.(asset._id)}
            className="group relative overflow-hidden rounded-xl transition-all"
            style={{
              aspectRatio: "1",
              border: "1px solid var(--border-subtle)",
              transitionDuration: "var(--duration-fast)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "scale(1.04)";
              e.currentTarget.style.borderColor = "var(--amber-9)";
              e.currentTarget.style.boxShadow = "0 0 12px rgba(255, 140, 66, 0.18)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "scale(1)";
              e.currentTarget.style.borderColor = "var(--border-subtle)";
              e.currentTarget.style.boxShadow = "none";
            }}
            title={asset.promptText ?? "Image"}
          >
            <Image
              src={src}
              alt={asset.promptText ?? "Recent image"}
              fill
              sizes="120px"
              className="object-cover"
              unoptimized
            />
          </button>
        );
      })}
    </div>
  );
}
