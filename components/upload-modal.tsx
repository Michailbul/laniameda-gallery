"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { UploadPanel, type UploadPanelProps } from "./upload-panel";
import { X } from "lucide-react";

type UploadModalProps = {
  open: boolean;
  onClose: () => void;
} & Pick<
  UploadPanelProps,
  "availableTags" | "folders" | "ownerUserId" | "onDataChanged"
>;

export function UploadModal({
  open,
  onClose,
  availableTags,
  folders,
  ownerUserId,
  onDataChanged,
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
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-10"
      aria-modal="true"
      role="dialog"
    >
      <div
        className="absolute inset-0 transition-opacity bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className="relative z-10 flex h-[88vh] w-full max-w-[1200px] flex-col overflow-hidden rounded-[24px] bg-background border border-border/60 shadow-2xl shadow-black/20"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border/60 px-8 py-5 bg-surface-1/50">
          <div className="flex flex-col gap-1">
            <span className="text-micro text-muted-foreground">
              Manual ingest
            </span>
            <h2 className="text-[24px] font-display text-foreground tracking-tight">Add to gallery</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close upload modal" className="rounded-full h-8 w-8 hover:bg-surface-2">
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-8 py-6">
          <div className="flex min-h-full flex-col">
            <UploadPanel
              availableTags={availableTags}
              folders={folders}
              ownerUserId={ownerUserId}
              onDataChanged={onDataChanged}
              className="flex-1 min-h-0"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
