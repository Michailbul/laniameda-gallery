"use client";

import { useEffect } from "react";
import { CinemaUploadPanel } from "./cinema-upload-panel";

type CinemaUploadModalProps = {
  open: boolean;
  onClose: () => void;
  ownerUserId: string;
  onDataChanged?: () => void;
};

export function CinemaUploadModal({
  open,
  onClose,
  ownerUserId,
  onDataChanged,
}: CinemaUploadModalProps) {
  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70]"
      aria-modal="true"
      role="dialog"
      data-pillar="cinema-inspiration"
    >
      {/* Backdrop — solid dark, no blur card behind anything */}
      <div
        className="absolute inset-0"
        style={{ backgroundColor: "rgba(8, 10, 6, 0.92)" }}
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Panel — edge-to-edge, no border, no shadow ring, just lives on the backdrop */}
      <div
        className="absolute inset-y-0 left-1/2 flex w-full max-w-[1280px] -translate-x-1/2 flex-col overflow-y-auto"
        onClick={(event) => event.stopPropagation()}
      >
        <CinemaUploadPanel
          ownerUserId={ownerUserId}
          onClose={onClose}
          onDataChanged={onDataChanged}
        />
      </div>
    </div>
  );
}
