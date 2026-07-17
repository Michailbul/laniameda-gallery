"use client";

/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useState } from "react";
import type { ShowcaseAsset } from "./types";
import { assetSrc, meaningfulPrompt } from "./types";

interface ShowcaseLightboxProps {
  assets: ShowcaseAsset[];
  index: number;
  onIndexChange: (next: number) => void;
  onClose: () => void;
}

export function ShowcaseLightbox({
  assets,
  index,
  onIndexChange,
  onClose,
}: ShowcaseLightboxProps) {
  const asset = assets[index];
  // Track which slide was copied so "Copied" clears itself the moment you
  // navigate — no reset effect needed.
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const copied = copiedIndex === index;

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
              alt={asset.description ?? asset.fileName ?? "Work"}
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
        {asset.description && (
          <p
            style={{
              margin: "0 0 10px",
              color: "var(--lm-text-primary)",
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
