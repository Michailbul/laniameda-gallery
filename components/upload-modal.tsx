"use client";

import { useEffect } from "react";
import { UploadPanel, type UploadPanelProps } from "./upload-panel";
import { Upload, X } from "lucide-react";

type UploadModalProps = {
  open: boolean;
  onClose: () => void;
} & Pick<
  UploadPanelProps,
  "availableTags" | "folders" | "ownerUserId" | "onDataChanged" | "initialFiles"
>;

export function UploadModal({
  open,
  onClose,
  availableTags,
  folders,
  ownerUserId,
  onDataChanged,
  initialFiles,
}: UploadModalProps) {
  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center px-4 py-8"
      aria-modal="true"
      role="dialog"
      aria-label="Add to gallery"
      style={{ fontFamily: "var(--lm-font)" }}
    >
      <div
        className="absolute inset-0 animate-fade-in bg-black/75"
        style={{ backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="relative z-10 flex h-[90vh] w-full max-w-[1180px] flex-col overflow-hidden rounded-[18px] animate-fade-in"
        style={{
          backgroundColor: "var(--lm-surface-0)",
          border: "1px solid var(--lm-border-strong)",
          boxShadow: "0 30px 90px rgba(0,0,0,0.65)",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        {/* Coral hairline accent */}
        <div
          className="h-[3px] w-full shrink-0"
          style={{ background: "linear-gradient(90deg, var(--lm-coral), rgba(255,122,100,0.15) 70%, transparent)" }}
        />

        {/* Header */}
        <div
          className="flex shrink-0 items-center justify-between px-7 py-5"
          style={{ borderBottom: "1px solid var(--lm-border)" }}
        >
          <div className="flex items-center gap-3.5">
            <span
              className="flex h-10 w-10 items-center justify-center rounded-[12px]"
              style={{
                background: "var(--lm-accent-dim)",
                border: "1px solid var(--lm-border-strong)",
                color: "var(--lm-coral)",
              }}
            >
              <Upload className="h-[18px] w-[18px]" aria-hidden />
            </span>
            <div className="flex flex-col gap-0.5">
              <span
                className="text-[10px] font-bold uppercase tracking-[0.22em]"
                style={{ color: "var(--lm-text-ghost)" }}
              >
                Manual ingest
              </span>
              <h2
                className="font-display text-[24px] leading-none tracking-tight"
                style={{ color: "var(--lm-text-primary)" }}
              >
                Add to gallery
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close upload modal"
            className="flex h-9 w-9 items-center justify-center rounded-[10px] transition-colors"
            style={{ color: "var(--lm-text-tertiary)" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "var(--lm-surface-2)";
              e.currentTarget.style.color = "var(--lm-text-primary)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
              e.currentTarget.style.color = "var(--lm-text-tertiary)";
            }}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* Body — the panel owns its own scroll + sticky footer */}
        <div className="min-h-0 flex-1">
          <UploadPanel
            availableTags={availableTags}
            folders={folders}
            ownerUserId={ownerUserId}
            onDataChanged={onDataChanged}
            initialFiles={initialFiles}
            className="h-full"
          />
        </div>
      </div>
    </div>
  );
}
