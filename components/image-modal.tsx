"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";

type ImageModalProps = {
  open: boolean;
  onClose: () => void;
  image: {
    thumbSrc: string;
    fullSrc: string;
    prompt: string;
    width?: number;
    height?: number;
  } | null;
};

export function ImageModal({ open, onClose, image }: ImageModalProps) {
  const [fullLoaded, setFullLoaded] = useState(false);
  const aspectRatio = useMemo(() => {
    if (!image?.width || !image?.height) return undefined;
    return image.width / image.height;
  }, [image?.height, image?.width]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !image) return;
    const frame = requestAnimationFrame(() => {
      setFullLoaded(false);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [image, open]);

  if (!open || !image) return null;

  return (
    <div className="fixed inset-0 z-[60]">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 flex h-full w-full items-center justify-center p-6">
        <div
          className="rounded-xl border border-border bg-card shadow-2xl"
          style={
            aspectRatio
              ? {
                  width: `min(92vw, calc(78vh * ${aspectRatio}))`,
                  maxWidth: "92vw",
                }
              : { maxWidth: "92vw" }
          }
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm text-muted-foreground">Image preview</p>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="px-4 py-4">
            <div className="relative w-full overflow-hidden rounded-xl border border-border/50 bg-black/10">
              <div className="relative h-[68vh] min-h-[280px] w-full">
                <Image
                  src={image.thumbSrc}
                  alt={image.prompt}
                  fill
                  sizes="(max-width: 1280px) 90vw, 60vw"
                  className="object-contain"
                  priority
                  unoptimized
                />
                <Image
                  src={image.fullSrc}
                  alt={image.prompt}
                  fill
                  sizes="(max-width: 1280px) 90vw, 60vw"
                  className={`object-contain transition-opacity duration-500 ${
                    fullLoaded ? "opacity-100" : "opacity-0"
                  }`}
                  priority
                  onLoadingComplete={() => setFullLoaded(true)}
                  onError={() => setFullLoaded(true)}
                  unoptimized
                />
              </div>
            </div>
          </div>
          <div className="border-t border-border px-4 py-3">
            <p className="text-sm text-foreground">{image.prompt}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
