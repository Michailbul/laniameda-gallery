"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

export type CinemaModalMetadata = {
  movieTitle: string;
  director?: string;
  year?: number;
  scene?: string;
  timecode?: string;
  cinematographer?: string;
  lens?: string;
  aperture?: string;
  composition?: string;
  lighting?: string;
  cameraMovement?: string;
  colorPalette?: string;
  mood?: string;
  agentDescription?: string;
};

export type CinemaModalAsset = {
  id: string;
  src: string;
  width?: number;
  height?: number;
  metadata?: CinemaModalMetadata | null;
};

type CinemaModalProps = {
  asset: CinemaModalAsset | null;
  onClose: () => void;
};

export function CinemaModal({ asset, onClose }: CinemaModalProps) {
  useEffect(() => {
    if (!asset) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [asset, onClose]);

  return (
    <AnimatePresence>
      {asset && (
        <motion.div
          key="cinema-backdrop"
          className="fixed inset-0 z-[80] overflow-auto"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          onClick={onClose}
          aria-modal="true"
          role="dialog"
          aria-label={asset.metadata?.movieTitle ?? "Cinema frame"}
          style={{ backgroundColor: "rgba(4, 5, 3, 0.96)" }}
        >
          {/* Centering frame — at least viewport-sized so small images center,
              but grows to image size so larger frames make the scroll appear */}
          <div
            className="flex min-h-full min-w-full items-center justify-center p-6"
            style={{ width: "max-content", minWidth: "100%" }}
          >
            <motion.img
              key={asset.id}
              src={asset.src}
              alt={asset.metadata?.movieTitle ?? "Cinema frame"}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              onClick={(event) => event.stopPropagation()}
              style={{
                display: "block",
                maxWidth: "none",
                maxHeight: "none",
                width: asset.width || "auto",
                height: asset.height || "auto",
                userSelect: "none",
                cursor: "default",
              }}
              draggable={false}
            />
          </div>

          {/* Bare close — top-right, sticky so it stays visible while scrolling */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close cinema frame"
            className="fixed right-6 top-6 z-20 flex h-9 w-9 items-center justify-center transition-opacity hover:opacity-100"
            style={{
              color: "rgba(231, 244, 207, 0.55)",
              opacity: 0.7,
            }}
          >
            <X className="h-5 w-5" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
