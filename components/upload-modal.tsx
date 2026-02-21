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
      <div
        className="absolute inset-0 transition-opacity"
        style={{
          background: "radial-gradient(ellipse at center, rgba(74, 30, 10, 0.1) 0%, rgba(0,0,0,0.85) 65%)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
        }}
        onClick={onClose}
      />
      <div
        className="relative z-10 flex h-[82vh] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-border/60 shadow-2xl shadow-black/70 backdrop-blur grain-overlay"
        style={{
          background: "linear-gradient(180deg, rgba(17,10,6,0.95) 0%, rgba(8,4,2,0.98) 100%)",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border/60 px-6 py-4">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground">
              Manual ingest
            </span>
            <h2 className="text-sm font-medium text-foreground">Add a prompt</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close upload modal">
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="flex min-h-full flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Drag files, paste a URL, add tags/folder metadata, and push straight to the gallery.
            </p>
            <UploadPanel
              availableTags={availableTags}
              folders={folders}
              className="bg-background/80 shadow-inner flex-1 min-h-0"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
