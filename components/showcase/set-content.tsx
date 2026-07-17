"use client";

/* eslint-disable @next/next/no-img-element */
import { useMemo, useState } from "react";
import { ShowcaseLightbox } from "./showcase-lightbox";
import { assetThumb, assetRatio } from "./types";
import type { ShowcaseSet } from "./types";

type ShowcaseSetAsset = ShowcaseSet["assets"][number];

// The body of a showcased set: header + story, the set's own works, then one
// named section per chapter (sub-collection: "Characters", "Locations", …).
// Used fullscreen by the set modal and inline by the home's EXPAND ALL view.
// The lightbox walks the whole set — own works first, then chapters in order.
export function SetContent({
  data,
  variant = "modal",
  onLightboxOpenChange,
}: {
  data: NonNullable<ShowcaseSet>;
  variant?: "modal" | "inline";
  // Lets a fullscreen host (the set modal) skip its own Escape-to-close
  // while the lightbox is up.
  onLightboxOpenChange?: (open: boolean) => void;
}) {
  const [lightboxIndex, setLightboxIndexRaw] = useState<number | null>(null);
  const setLightboxIndex = (index: number | null) => {
    setLightboxIndexRaw(index);
    onLightboxOpenChange?.(index !== null);
  };
  const isStory = data.kind === "storybook";
  const inline = variant === "inline";

  const flatAssets = useMemo(
    () => [...data.assets, ...data.chapters.flatMap((c) => c.assets)],
    [data],
  );
  // Flat lightbox index where each chapter's assets begin.
  const chapterOffsets = useMemo(() => {
    const offsets: number[] = [];
    let cursor = data.assets.length;
    for (const chapter of data.chapters) {
      offsets.push(cursor);
      cursor += chapter.assets.length;
    }
    return offsets;
  }, [data]);

  return (
    <>
      {/* Header / story */}
      <header
        style={{
          maxWidth: isStory && !inline ? 720 : 900,
          margin: inline
            ? "0 0 28px"
            : isStory
              ? "24px auto 48px"
              : "24px 0 40px",
          textAlign: isStory && !inline ? "center" : "left",
        }}
      >
        {inline && (
          <p
            style={{
              fontFamily: "var(--lm-font)",
              fontSize: 10,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "var(--lm-coral)",
              margin: "0 0 10px",
            }}
          >
            {isStory ? "Storybook" : "Collection"}
          </p>
        )}
        <h1
          style={{
            fontFamily: "var(--lm-font-display)",
            fontWeight: 800,
            fontSize: inline
              ? "clamp(24px, 3.6vw, 34px)"
              : "clamp(28px, 5vw, 46px)",
            lineHeight: 1.05,
            letterSpacing: "-0.02em",
            color: "var(--lm-text-primary)",
            margin: 0,
          }}
        >
          {data.name}
        </h1>
        {data.story && (
          <p
            style={{
              marginTop: inline ? 12 : 20,
              maxWidth: 720,
              fontFamily:
                isStory && !inline ? "var(--lm-font-display)" : "var(--lm-font)",
              fontSize: isStory && !inline ? "clamp(15px, 2.2vw, 19px)" : 14,
              lineHeight: 1.7,
              color: "var(--lm-text-secondary)",
              whiteSpace: "pre-wrap",
              marginLeft: isStory && !inline ? "auto" : 0,
              marginRight: isStory && !inline ? "auto" : 0,
            }}
          >
            {data.story}
          </p>
        )}
      </header>

      {/* The set's own works */}
      {data.assets.length > 0 && (
        <div className="lm-showcase-columns">
          {data.assets.map((asset, i) => (
            <SetTile
              key={asset._id}
              asset={asset}
              onClick={() => setLightboxIndex(i)}
            />
          ))}
        </div>
      )}

      {/* Chapters (sub-collections) */}
      {data.chapters.map(
        (chapter, ci) =>
          chapter.assets.length > 0 && (
            <section key={chapter.folderId} style={{ marginTop: 44 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 12,
                  marginBottom: 18,
                  paddingBottom: 10,
                  borderBottom: "1px solid var(--lm-border)",
                }}
              >
                <h2
                  style={{
                    fontFamily: "var(--lm-font)",
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: "var(--lm-text-primary)",
                    margin: 0,
                  }}
                >
                  {chapter.name}
                </h2>
                <span
                  style={{
                    fontFamily: "var(--lm-font)",
                    fontSize: 11,
                    color: "var(--lm-text-ghost)",
                  }}
                >
                  {chapter.assets.length}
                </span>
              </div>
              {chapter.story && (
                <p
                  style={{
                    fontFamily: "var(--lm-font)",
                    fontSize: 13,
                    lineHeight: 1.65,
                    color: "var(--lm-text-secondary)",
                    maxWidth: 640,
                    margin: "0 0 18px",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {chapter.story}
                </p>
              )}
              <div className="lm-showcase-columns">
                {chapter.assets.map((asset, i) => (
                  <SetTile
                    key={asset._id}
                    asset={asset}
                    onClick={() => setLightboxIndex(chapterOffsets[ci] + i)}
                  />
                ))}
              </div>
            </section>
          ),
      )}

      {lightboxIndex !== null && (
        <ShowcaseLightbox
          assets={flatAssets}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </>
  );
}

function SetTile({
  asset,
  onClick,
}: {
  asset: ShowcaseSetAsset;
  onClick: () => void;
}) {
  const src = assetThumb(asset);
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        marginBottom: 14,
        breakInside: "avoid",
        border: "none",
        padding: 0,
        background: "var(--lm-surface-1)",
        borderRadius: 4,
        overflow: "hidden",
        cursor: "zoom-in",
      }}
    >
      {asset.kind === "video" ? (
        <video
          src={asset.url}
          poster={asset.thumbUrl}
          muted
          loop
          playsInline
          style={{
            width: "100%",
            display: "block",
            aspectRatio: String(assetRatio(asset)),
            objectFit: "cover",
          }}
        />
      ) : (
        <img
          src={src}
          alt={asset.description ?? asset.fileName ?? "Work"}
          loading="lazy"
          style={{ width: "100%", display: "block" }}
        />
      )}
    </button>
  );
}
