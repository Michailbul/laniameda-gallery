"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { UploadPanel, type UploadPanelProps } from "./upload-panel";
import { X } from "lucide-react";

type UploadModalProps = {
  open: boolean;
  onClose: () => void;
} & Pick<UploadPanelProps, "availableTags" | "folders">;

export function UploadModal({ open, onClose, availableTags, folders }: UploadModalProps) {
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
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity" onClick={onClose} />
      <div
        className="relative z-10 w-full max-w-5xl rounded-3xl border border-border/60 bg-background/90 p-6 shadow-2xl shadow-muted/50 backdrop-blur"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.5em] text-muted-foreground">
              Manual ingest
            </p>
            <h2 className="text-2xl font-semibold text-foreground">Add a prompt</h2>
            <p className="text-sm text-muted-foreground">
              Drag files, paste a URL, add tags/folder metadata, and push straight to the gallery.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close upload modal">
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>
        <UploadPanel
          availableTags={availableTags}
          folders={folders}
          className="bg-background/90 shadow-inner"
        />
      </div>
    </div>
  );
}
