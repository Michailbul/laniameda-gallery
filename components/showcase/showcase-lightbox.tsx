"use client";

/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ShowcaseAsset } from "./types";
import { assetSrc, meaningfulPrompt } from "./types";

interface ShowcaseLightboxProps {
  assets: ShowcaseAsset[];
  index: number;
  onIndexChange: (next: number) => void;
  onClose: () => void;
  /** Absolute link that reopens this exact asset. Omit to hide Share. */
  shareHrefFor?: (asset: ShowcaseAsset) => string;
  /**
   * Owner-only: make this piece the set's thumbnail. Omitted for visitors, so
   * the control simply doesn't exist on the public page.
   */
  onSetCover?: (asset: ShowcaseAsset) => Promise<void> | void;
  /** The asset currently used as the cover, so the button can read as set. */
  coverAssetId?: string;
}

export function ShowcaseLightbox({
  assets,
  index,
  onIndexChange,
  onClose,
  shareHrefFor,
  onSetCover,
  coverAssetId,
}: ShowcaseLightboxProps) {
  const asset = assets[index];
  // Track which slide was copied so "Copied" clears itself the moment you
  // navigate — no reset effect needed.
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const copied = copiedIndex === index;
  // Same self-clearing trick for the share link: navigating away resets it.
  const [sharedIndex, setSharedIndex] = useState<number | null>(null);
  const shared = sharedIndex === index;
  // "saving" / "error" are per-slide too, for the same self-clearing reason.
  const [coverState, setCoverState] = useState<{
    index: number;
    state: "saving" | "error";
  } | null>(null);
  const coverStatus = coverState?.index === index ? coverState.state : null;
  // Keep the active thumb in view as you arrow through a long reel.
  const stripRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const active = stripRef.current?.querySelector('[data-active="true"]');
    active?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [index]);

  const go = useCallback(
    (delta: number) => {
      const next = (index + delta + assets.length) % assets.length;
      onIndexChange(next);
    },
    [index, assets.length, onIndexChange],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  if (!asset) return null;

  const src = assetSrc(asset);
  const prompt = meaningfulPrompt(asset.promptText);

  const shareAsset = async () => {
    if (!shareHrefFor || !asset) return;
    const href = shareHrefFor(asset);
    // Native sheet on mobile; clipboard everywhere else. Either way the link
    // is the deep link, so the recipient lands on this same piece.
    try {
      if (navigator.share) {
        await navigator.share({ url: href });
        return;
      }
      await navigator.clipboard.writeText(href);
      setSharedIndex(index);
    } catch {
      // A dismissed share sheet rejects — don't claim success.
      setSharedIndex(null);
    }
  };

  const setCover = async () => {
    if (!onSetCover || !asset) return;
    setCoverState({ index, state: "saving" });
    try {
      await onSetCover(asset);
      // The cover id arrives back through the query, so success needs no
      // local flag — the label flips on its own.
      setCoverState(null);
    } catch {
      setCoverState({ index, state: "error" });
    }
  };

  const copyPrompt = async () => {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedIndex(index);
    } catch {
      setCopiedIndex(null);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      /* Media viewer — pinned dark in both app themes. */
      data-theme="dark"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 90,
        background: "rgba(8, 7, 6, 0.94)",
        backdropFilter: "blur(6px)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Top bar */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 20px",
          fontFamily: "var(--lm-font)",
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--lm-text-tertiary)",
        }}
      >
        <span>
          {index + 1} / {assets.length}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {onSetCover &&
            (() => {
              const isCover = coverAssetId === (asset._id as string);
              return (
                <button
                  type="button"
                  onClick={setCover}
                  disabled={coverStatus === "saving"}
                  aria-pressed={isCover}
                  title="Use this piece as the world's thumbnail"
                  style={{
                    background: "none",
                    border: "none",
                    padding: 4,
                    cursor: coverStatus === "saving" ? "default" : "pointer",
                    font: "inherit",
                    letterSpacing: "inherit",
                    textTransform: "inherit",
                    color:
                      coverStatus === "error"
                        ? "var(--lm-status-error)"
                        : isCover
                          ? "var(--lm-coral)"
                          : "var(--lm-text-secondary)",
                  }}
                >
                  {coverStatus === "saving"
                    ? "Setting…"
                    : coverStatus === "error"
                      ? "Failed"
                      : isCover
                        ? "Cover ✓"
                        : "Make cover"}
                </button>
              );
            })()}
          {shareHrefFor && (
            <button
              type="button"
              onClick={shareAsset}
              aria-label="Copy a link that opens this piece"
              title="Copy a link that opens this piece"
              style={{
                background: "none",
                border: "none",
                padding: 4,
                cursor: "pointer",
                font: "inherit",
                letterSpacing: "inherit",
                textTransform: "inherit",
                color: shared ? "var(--lm-coral)" : "var(--lm-text-secondary)",
              }}
            >
              {shared ? "Link copied" : "Share"}
            </button>
          )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            background: "none",
            border: "none",
            color: "var(--lm-text-secondary)",
            cursor: "pointer",
            fontSize: 22,
            lineHeight: 1,
            padding: 4,
          }}
        >
          ×
        </button>
        </span>
      </div>

      {/* Stage */}
      <div
        onClick={onClose}
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: "0 12px",
        }}
      >
        {assets.length > 1 && (
          <NavArrow dir="left" onClick={(e) => { e.stopPropagation(); go(-1); }} />
        )}
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            maxWidth: "min(1100px, 92vw)",
            maxHeight: "82vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          {asset.kind === "video" ? (
            <video
              src={src}
              poster={asset.thumbUrl}
              controls
              autoPlay
              loop
              playsInline
              style={{ maxWidth: "100%", maxHeight: "82vh", borderRadius: 4 }}
            />
          ) : (
            <img
              src={src}
              alt={asset.name ?? asset.description ?? asset.fileName ?? "Work"}
              style={{
                maxWidth: "100%",
                maxHeight: "82vh",
                objectFit: "contain",
                borderRadius: 4,
              }}
            />
          )}
        </div>
        {assets.length > 1 && (
          <NavArrow dir="right" onClick={(e) => { e.stopPropagation(); go(1); }} />
        )}
      </div>

      {/* Meta strip */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          padding: "16px 24px 24px",
          maxWidth: 900,
          margin: "0 auto",
          width: "100%",
          fontFamily: "var(--lm-font)",
        }}
      >
        {/* The title set on the featured shelf. Leads the strip so a named
            piece reads as a piece rather than a file. */}
        {asset.name?.trim() && (
          <h2
            style={{
              margin: "0 0 6px",
              fontFamily: "var(--lm-font-display)",
              fontSize: 21,
              fontWeight: 700,
              letterSpacing: "-0.01em",
              lineHeight: 1.2,
              color: "var(--lm-text-primary)",
            }}
          >
            {asset.name.trim()}
          </h2>
        )}
        {asset.description && (
          <p
            style={{
              margin: "0 0 10px",
              color: asset.name?.trim()
                ? "var(--lm-text-secondary)"
                : "var(--lm-text-primary)",
              fontSize: 15,
              lineHeight: 1.5,
            }}
          >
            {asset.description}
          </p>
        )}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
            fontSize: 10.5,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--lm-text-tertiary)",
          }}
        >
          {asset.modelName && <MetaChip>{asset.modelName}</MetaChip>}
          {asset.tagNames.slice(0, 6).map((tag) => (
            <MetaChip key={tag}>{tag}</MetaChip>
          ))}
        </div>
        {prompt && (
          <div style={{ marginTop: 14 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 6,
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "var(--lm-text-ghost)",
                }}
              >
                Prompt
              </span>
              <button
                type="button"
                onClick={copyPrompt}
                style={{
                  background: "none",
                  border: "1px solid var(--lm-border)",
                  borderRadius: 3,
                  color: copied ? "var(--lm-coral)" : "var(--lm-text-secondary)",
                  cursor: "pointer",
                  fontFamily: "var(--lm-font)",
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  padding: "4px 10px",
                }}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p
              style={{
                margin: 0,
                color: "var(--lm-text-secondary)",
                fontSize: 12.5,
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
                maxHeight: 140,
                overflowY: "auto",
              }}
            >
              {prompt}
            </p>
          </div>
        )}
      </div>

      {/* Filmstrip — the only signal that there is more than this one piece, so
          it renders whenever there is. A shared link lands on a single asset;
          without this the visitor has no idea the rest of the work is one
          arrow away. */}
      {assets.length > 1 && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            flexShrink: 0,
            borderTop: "1px solid var(--lm-border)",
            padding: "10px 20px 14px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              paddingBottom: 8,
              fontFamily: "var(--lm-font)",
              fontSize: 10,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--lm-text-ghost)",
            }}
          >
            <span>More work</span>
            <span>← → to move</span>
          </div>
          <div
            ref={stripRef}
            className="lm-lightbox-strip"
            style={{
              display: "flex",
              gap: 8,
              overflowX: "auto",
              paddingBottom: 2,
            }}
          >
            {assets.map((entry, i) => {
              const active = i === index;
              const thumb = entry.thumbUrl ?? assetSrc(entry);
              return (
                <button
                  key={entry._id as string}
                  type="button"
                  data-active={active ? "true" : "false"}
                  onClick={() => onIndexChange(i)}
                  aria-label={`Show item ${i + 1} of ${assets.length}`}
                  aria-current={active ? "true" : undefined}
                  style={{
                    flex: "0 0 auto",
                    width: 74,
                    height: 46,
                    padding: 0,
                    borderRadius: 4,
                    overflow: "hidden",
                    cursor: "pointer",
                    background: "var(--lm-surface-2)",
                    border: active
                      ? "1.5px solid var(--lm-coral)"
                      : "1.5px solid transparent",
                    opacity: active ? 1 : 0.45,
                    transition:
                      "opacity var(--lm-duration-fast), border-color var(--lm-duration-fast)",
                  }}
                >
                  {thumb ? (
                    <img
                      src={thumb}
                      alt=""
                      loading="lazy"
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        display: "block",
                      }}
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function NavArrow({
  dir,
  onClick,
}: {
  dir: "left" | "right";
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={dir === "left" ? "Previous" : "Next"}
      style={{
        flexShrink: 0,
        width: 40,
        height: 40,
        borderRadius: "50%",
        border: "1px solid var(--lm-border)",
        background: "rgba(255,255,255,0.04)",
        color: "var(--lm-text-secondary)",
        cursor: "pointer",
        fontSize: 18,
      }}
    >
      {dir === "left" ? "‹" : "›"}
    </button>
  );
}

function MetaChip({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        border: "1px solid var(--lm-border)",
        borderRadius: 3,
        padding: "3px 8px",
        color: "var(--lm-text-secondary)",
      }}
    >
      {children}
    </span>
  );
}
