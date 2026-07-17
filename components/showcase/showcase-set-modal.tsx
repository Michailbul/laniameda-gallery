"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SetContent } from "./set-content";

interface ShowcaseSetModalProps {
  folderId: Id<"folders">;
  kind: "collection" | "storybook";
  onClose: () => void;
}

export function ShowcaseSetModal({
  folderId,
  kind,
  onClose,
}: ShowcaseSetModalProps) {
  const collection = useQuery(
    api.showcase.getShowcaseCollection,
    kind === "collection" ? { folderId } : "skip",
  );
  const storybook = useQuery(
    api.showcase.getShowcaseStorybook,
    kind === "storybook" ? { folderId } : "skip",
  );
  const data = kind === "collection" ? collection : storybook;
  const lightboxOpenRef = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !lightboxOpenRef.current) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const isStory = kind === "storybook";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 85,
        background: "var(--lm-paper)",
        overflowY: "auto",
        animation: "fade-in 240ms ease both",
      }}
    >
      {/* Sticky close bar */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 2,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "16px 24px",
          background:
            "linear-gradient(to bottom, var(--lm-paper) 60%, transparent)",
          fontFamily: "var(--lm-font)",
        }}
      >
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "none",
            border: "1px solid var(--lm-border)",
            borderRadius: 3,
            color: "var(--lm-text-secondary)",
            cursor: "pointer",
            fontFamily: "var(--lm-font)",
            fontSize: 11,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            padding: "6px 14px",
          }}
        >
          ← Back
        </button>
        <span
          style={{
            fontSize: 10,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--lm-text-ghost)",
          }}
        >
          {isStory ? "Storybook" : "Collection"}
        </span>
      </div>

      {data === undefined && <SetSkeleton />}
      {data === null && <SetMissing onClose={onClose} />}

      {data && (
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px 80px" }}>
          <SetContent
            data={data}
            variant="modal"
            onLightboxOpenChange={(open) => {
              lightboxOpenRef.current = open;
            }}
          />
        </div>
      )}
    </div>
  );
}

function SetSkeleton() {
  return (
    <div
      style={{
        maxWidth: 1200,
        margin: "0 auto",
        padding: "40px 24px",
        color: "var(--lm-text-ghost)",
        fontFamily: "var(--lm-font)",
        fontSize: 12,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      Loading…
    </div>
  );
}

function SetMissing({ onClose }: { onClose: () => void }) {
  return (
    <div
      style={{
        maxWidth: 600,
        margin: "80px auto",
        textAlign: "center",
        fontFamily: "var(--lm-font)",
        color: "var(--lm-text-tertiary)",
      }}
    >
      <p style={{ fontSize: 14 }}>This set isn’t public anymore.</p>
      <button
        type="button"
        onClick={onClose}
        style={{
          marginTop: 16,
          background: "none",
          border: "1px solid var(--lm-border)",
          borderRadius: 3,
          color: "var(--lm-text-secondary)",
          cursor: "pointer",
          fontFamily: "var(--lm-font)",
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          padding: "6px 14px",
        }}
      >
        ← Back
      </button>
    </div>
  );
}
