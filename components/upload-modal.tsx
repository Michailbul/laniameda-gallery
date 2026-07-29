"use client";

import { useEffect, useState } from "react";
import { UploadPanel, type UploadPanelProps } from "./upload-panel";
import { BulkUploadPanel } from "./gallery/bulk-upload-panel";
import { Layers, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";

type UploadMode = "single" | "bulk";

type UploadModalProps = {
  open: boolean;
  onClose: () => void;
} & Pick<
  UploadPanelProps,
  | "availableTags"
  | "folders"
  | "projects"
  | "worlds"
  | "ownerUserId"
  | "canPromoteToPublic"
  | "onDataChanged"
  | "initialFiles"
>;

export function UploadModal({
  open,
  onClose,
  availableTags,
  folders,
  projects,
  worlds,
  ownerUserId,
  canPromoteToPublic,
  onDataChanged,
  initialFiles,
}: UploadModalProps) {
  const [mode, setMode] = useState<UploadMode>("single");

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

  // A multi-file drop is a bulk drop — land on the batch panel rather than the
  // prompt form, which would only ever ingest the first file. Resolved while
  // rendering (React's "adjust state when props change") so each open starts
  // from the right tab without a cascading effect.
  // Files handed over from the single panel when a multi-file staging is sent to
  // the batch panel — without this, "save all in batch" opened an empty batch.
  const [handoffFiles, setHandoffFiles] = useState<File[] | undefined>(undefined);

  const openSeed = open ? (initialFiles ?? "empty") : "closed";
  const [seenSeed, setSeenSeed] = useState<unknown>("closed");
  if (openSeed !== seenSeed) {
    setSeenSeed(openSeed);
    setHandoffFiles(undefined);
    if (open) {
      setMode((initialFiles?.length ?? 0) > 1 ? "bulk" : "single");
    }
  }

  if (!open) {
    return null;
  }

  const isBulk = mode === "bulk";

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center px-4 py-8"
      aria-modal="true"
      role="dialog"
      aria-label="Add to gallery"
      style={{ fontFamily: "var(--lm-font)" }}
    >
      <div
        className="absolute inset-0 animate-fade-in bg-[var(--lm-scrim)]"
        style={{ backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="relative z-10 flex h-[90vh] w-full max-w-[1180px] flex-col overflow-hidden rounded-[18px] animate-fade-in"
        style={{
          backgroundColor: "var(--lm-surface-0)",
          border: "1px solid var(--lm-border-strong)",
          boxShadow: "var(--lm-modal-shadow)",
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
          className="flex shrink-0 items-center justify-between gap-6 px-8 py-5"
          style={{ borderBottom: "1px solid var(--lm-border)" }}
        >
          <div className="flex items-center gap-3">
            {isBulk ? (
              <Layers
                className="h-[18px] w-[18px]"
                style={{ color: "var(--lm-coral)" }}
                aria-hidden
              />
            ) : (
              <Upload
                className="h-[18px] w-[18px]"
                style={{ color: "var(--lm-coral)" }}
                aria-hidden
              />
            )}
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
                {isBulk ? "Add a batch" : "Add to gallery"}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-6">
            {/* Mode switch — boxless, a coral underline marks the live tab */}
            <div role="tablist" aria-label="Ingest mode" className="flex items-center gap-5">
              {(
                [
                  { key: "single" as const, label: "Single" },
                  { key: "bulk" as const, label: "Folder / batch" },
                ]
              ).map((tab) => {
                const active = mode === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setMode(tab.key)}
                    className={cn(
                      "relative pb-1 text-[10px] font-bold uppercase tracking-[0.18em] transition-colors",
                      active
                        ? "text-[var(--lm-text-primary)]"
                        : "text-[var(--lm-text-ghost)] hover:text-[var(--lm-text-secondary)]",
                    )}
                  >
                    {tab.label}
                    <span
                      aria-hidden
                      className="absolute inset-x-0 -bottom-px h-[2px] transition-opacity"
                      style={{
                        backgroundColor: "var(--lm-coral)",
                        opacity: active ? 1 : 0,
                      }}
                    />
                  </button>
                );
              })}
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
        </div>

        {/* Body — each panel owns its own scroll + sticky footer. Both stay
            mounted so flipping tabs can't throw away a staged batch or a
            half-written prompt. */}
        <div className="min-h-0 flex-1">
          <div className={cn("h-full", isBulk && "hidden")}>
            <UploadPanel
              availableTags={availableTags}
              folders={folders}
              projects={projects}
              worlds={worlds}
              ownerUserId={ownerUserId}
              canPromoteToPublic={canPromoteToPublic}
              onDataChanged={onDataChanged}
              initialFiles={isBulk ? undefined : initialFiles}
              onRequestBulk={(files) => {
                setHandoffFiles(files);
                setMode("bulk");
              }}
              className="h-full"
            />
          </div>
          <div className={cn("h-full", !isBulk && "hidden")}>
            <BulkUploadPanel
              availableTags={availableTags}
              folders={folders}
              projects={projects}
              ownerUserId={ownerUserId}
              canPromoteToPublic={canPromoteToPublic}
              onDataChanged={onDataChanged}
              initialFiles={isBulk ? (handoffFiles ?? initialFiles) : undefined}
              className="h-full"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
