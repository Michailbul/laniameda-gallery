"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { buildIngestKey } from "@/lib/ingest";
import { cn } from "@/lib/utils";
import { Film, ImageIcon, X } from "lucide-react";

type SeedanceIngestModalProps = {
  open: boolean;
  onClose: () => void;
  onIngested?: () => void;
};

type Status = {
  type: "success" | "error" | "info";
  message: string;
} | null;

type DropTarget = "video" | "image";

const MODEL_NAME = "Seedance";

export function SeedanceIngestModal({
  open,
  onClose,
  onIngested,
}: SeedanceIngestModalProps) {
  const [video, setVideo] = useState<File | null>(null);
  const [sourceImage, setSourceImage] = useState<File | null>(null);
  const [promptText, setPromptText] = useState("");
  const [status, setStatus] = useState<Status>(null);
  const [submitting, setSubmitting] = useState(false);
  const [activeDrop, setActiveDrop] = useState<DropTarget | null>(null);

  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const videoPreviewUrl = useMemo(() => {
    if (!video) return null;
    return URL.createObjectURL(video);
  }, [video]);

  const imagePreviewUrl = useMemo(() => {
    if (!sourceImage) return null;
    return URL.createObjectURL(sourceImage);
  }, [sourceImage]);

  useEffect(() => {
    return () => {
      if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    };
  }, [videoPreviewUrl]);

  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    };
  }, [imagePreviewUrl]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose, submitting]);

  if (!open) return null;

  const reset = () => {
    setVideo(null);
    setSourceImage(null);
    setPromptText("");
    setStatus(null);
    setActiveDrop(null);
  };

  const handleClose = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const handleVideoFile = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      setStatus({ type: "error", message: "Video file must be a video format." });
      return;
    }
    setVideo(file);
    setStatus(null);
  };

  const handleImageFile = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setStatus({
        type: "error",
        message: "Source image must be an image format.",
      });
      return;
    }
    setSourceImage(file);
    setStatus(null);
  };

  const onDrop = (target: DropTarget) =>
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setActiveDrop(null);
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      if (target === "video") handleVideoFile(file);
      else handleImageFile(file);
    };

  const onDragOver = (target: DropTarget) =>
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
      setActiveDrop(target);
    };

  const onDragLeave = () => setActiveDrop(null);

  const canSubmit =
    Boolean(video) && promptText.trim().length > 0 && !submitting;

  const ingestOne = async ({
    file,
    promptIngestKey,
    extra,
  }: {
    file: File;
    promptIngestKey: string;
    extra: Record<string, string>;
  }) => {
    const formData = new FormData();
    formData.append("prompt", promptText.trim());
    formData.append("promptText", promptText.trim());
    formData.append("promptIngestKey", promptIngestKey);
    formData.append(
      "ingestKey",
      buildIngestKey({
        promptText: promptText.trim(),
        fileName: file.name,
      }) ?? `${promptIngestKey}|${file.name}`,
    );
    formData.append("file", file);
    formData.append("modelName", MODEL_NAME);
    for (const [key, value] of Object.entries(extra)) {
      formData.append(key, value);
    }

    const response = await fetch("/api/ingest", {
      method: "POST",
      body: formData,
    });
    const body = await response
      .json()
      .catch(() => null as Record<string, unknown> | null);
    if (!response.ok) {
      const message =
        body && typeof body.error === "string"
          ? body.error
          : "Ingest failed.";
      throw new Error(message);
    }
    return body as {
      ok: boolean;
      result?: { assetId?: string; promptId?: string };
    };
  };

  const handleSubmit = async () => {
    if (!canSubmit || !video) return;
    setSubmitting(true);
    setStatus({ type: "info", message: "Saving to gallery..." });

    const trimmed = promptText.trim();
    const promptIngestKey =
      buildIngestKey({ promptText: trimmed }) ?? `seedance|${Date.now()}`;

    try {
      let upstreamAssetId: string | undefined;

      if (sourceImage) {
        const imageResult = await ingestOne({
          file: sourceImage,
          promptIngestKey,
          extra: {
            generationType: "image_gen",
            assetRole: "reference",
          },
        });
        upstreamAssetId = imageResult.result?.assetId;
      }

      const videoExtra: Record<string, string> = {
        generationType: "video_gen",
        assetRole: "generated_output",
      };
      if (upstreamAssetId) {
        videoExtra.upstreamInputs = JSON.stringify([
          {
            type: "asset",
            id: upstreamAssetId,
            role: "input",
          },
        ]);
      }

      await ingestOne({
        file: video,
        promptIngestKey,
        extra: videoExtra,
      });

      setStatus({
        type: "success",
        message: sourceImage
          ? "Seedance video + source saved."
          : "Seedance video saved.",
      });
      onIngested?.();
      reset();
      onClose();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      setStatus({ type: "error", message });
    } finally {
      setSubmitting(false);
    }
  };

  const statusClasses = {
    success: "text-success-foreground bg-success/10 border border-success/20",
    error: "text-destructive bg-destructive/10 border border-destructive/30",
    info: "text-muted-foreground bg-muted/20 border border-muted",
  } as const;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-10"
      aria-modal="true"
      role="dialog"
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={handleClose}
      />
      <div
        className="relative z-10 flex max-h-[90vh] w-full max-w-[960px] flex-col overflow-hidden rounded-[24px] border border-border/60 bg-background shadow-2xl shadow-black/20"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border/60 bg-surface-1/50 px-8 py-5">
          <div className="flex flex-col gap-1">
            <span className="text-micro text-muted-foreground">
              Seedance ingest
            </span>
            <h2 className="text-[24px] font-display tracking-tight text-foreground">
              Add Seedance asset
            </h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClose}
            aria-label="Close Seedance ingest"
            className="h-8 w-8 rounded-full hover:bg-surface-2"
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-8 py-6">
          {status && (
            <div
              role="status"
              aria-live={status.type === "error" ? "assertive" : "polite"}
              className={cn(
                "mb-6 rounded-xl px-4 py-3 text-sm font-medium",
                statusClasses[status.type],
              )}
            >
              {status.message}
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Video drop zone */}
            <div className="flex flex-col gap-2 rounded-2xl border border-border/60 bg-white/40 p-5 shadow-sm backdrop-blur-sm">
              <div className="flex items-center justify-between">
                <Label className="text-[13px] font-semibold text-muted-foreground">
                  Video <span className="text-destructive">*</span>
                </Label>
                {video && (
                  <button
                    type="button"
                    onClick={() => setVideo(null)}
                    className="text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    Remove
                  </button>
                )}
              </div>
              <div
                role="button"
                tabIndex={0}
                aria-label="Drop video or click to browse"
                onClick={() => videoInputRef.current?.click()}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    videoInputRef.current?.click();
                  }
                }}
                onDrop={onDrop("video")}
                onDragOver={onDragOver("video")}
                onDragLeave={onDragLeave}
                className={cn(
                  "relative flex min-h-[220px] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border border-border/40 bg-linear-to-br from-surface-2 to-surface-1 p-4 text-center transition-all duration-250 hover:from-surface-3 hover:to-surface-2",
                  activeDrop === "video" &&
                    "border-primary from-accent-subtle to-surface-1 shadow-[0_0_0_3px_var(--accent-subtle)]",
                )}
              >
                {videoPreviewUrl ? (
                  <video
                    src={videoPreviewUrl}
                    controls
                    playsInline
                    preload="metadata"
                    className="h-full max-h-[240px] w-full rounded-lg bg-black object-contain"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-1">
                    <Film className="mb-2 h-10 w-10 text-muted-foreground/60" />
                    <p className="text-[15px] font-semibold text-foreground">
                      Drop video here
                    </p>
                    <p className="text-[13px] text-muted-foreground">
                      or click to browse
                    </p>
                  </div>
                )}
                <input
                  ref={videoInputRef}
                  type="file"
                  accept="video/*"
                  className="sr-only"
                  onChange={(event) => {
                    handleVideoFile(event.target.files?.[0] ?? null);
                    event.target.value = "";
                  }}
                />
              </div>
              {video && (
                <div className="flex items-center justify-between px-1 text-[11px] text-muted-foreground">
                  <span className="truncate">{video.name}</span>
                  <span>
                    {(video.size / (1024 * 1024)).toFixed(1)} MB
                  </span>
                </div>
              )}
            </div>

            {/* Source image drop zone */}
            <div className="flex flex-col gap-2 rounded-2xl border border-border/60 bg-white/40 p-5 shadow-sm backdrop-blur-sm">
              <div className="flex items-center justify-between">
                <Label className="text-[13px] font-semibold text-muted-foreground">
                  Source image{" "}
                  <span className="text-muted-foreground/60">(optional)</span>
                </Label>
                {sourceImage && (
                  <button
                    type="button"
                    onClick={() => setSourceImage(null)}
                    className="text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    Remove
                  </button>
                )}
              </div>
              <div
                role="button"
                tabIndex={0}
                aria-label="Drop source image or click to browse"
                onClick={() => imageInputRef.current?.click()}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    imageInputRef.current?.click();
                  }
                }}
                onDrop={onDrop("image")}
                onDragOver={onDragOver("image")}
                onDragLeave={onDragLeave}
                className={cn(
                  "relative flex min-h-[220px] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border border-border/40 bg-linear-to-br from-surface-2 to-surface-1 p-4 text-center transition-all duration-250 hover:from-surface-3 hover:to-surface-2",
                  activeDrop === "image" &&
                    "border-primary from-accent-subtle to-surface-1 shadow-[0_0_0_3px_var(--accent-subtle)]",
                )}
              >
                {imagePreviewUrl ? (
                  <Image
                    src={imagePreviewUrl}
                    alt={sourceImage?.name ?? "Source image preview"}
                    width={400}
                    height={400}
                    unoptimized
                    className="h-full max-h-[240px] w-auto rounded-lg object-contain"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-1">
                    <ImageIcon className="mb-2 h-10 w-10 text-muted-foreground/60" />
                    <p className="text-[15px] font-semibold text-foreground">
                      Drop source image
                    </p>
                    <p className="text-[13px] text-muted-foreground">
                      or click to browse
                    </p>
                  </div>
                )}
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(event) => {
                    handleImageFile(event.target.files?.[0] ?? null);
                    event.target.value = "";
                  }}
                />
              </div>
              {sourceImage && (
                <div className="flex items-center justify-between px-1 text-[11px] text-muted-foreground">
                  <span className="truncate">{sourceImage.name}</span>
                  <span>
                    {(sourceImage.size / (1024 * 1024)).toFixed(1)} MB
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Prompt */}
          <div className="mt-6 flex flex-col gap-2 rounded-2xl border border-border/60 bg-white/40 p-5 shadow-sm backdrop-blur-sm">
            <Label
              htmlFor="seedance-prompt"
              className="text-[13px] font-semibold text-muted-foreground"
            >
              Prompt <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="seedance-prompt"
              value={promptText}
              onChange={(event) => setPromptText(event.target.value)}
              placeholder="Paste the Seedance prompt that produced this video..."
              className="min-h-[160px] resize-y rounded-[14px] border-border/60 bg-surface-1 px-4 py-3 font-mono text-[13px] leading-relaxed focus-visible:border-primary focus-visible:shadow-[0_0_0_3px_var(--accent-subtle)] focus-visible:ring-0"
              maxLength={4000}
            />
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>
                Saved with model name <strong>{MODEL_NAME}</strong>. Source
                image (if added) is linked as upstream input.
              </span>
              <span className="font-mono">{promptText.length} / 4000</span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border/60 bg-surface-1/50 px-8 py-4">
          <Button
            type="button"
            variant="ghost"
            onClick={handleClose}
            disabled={submitting}
            className="h-11 rounded-[14px] border border-border/60 bg-transparent px-5 text-[13px] font-medium text-muted-foreground hover:bg-surface-2 hover:text-foreground"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            className="h-11 rounded-[16px] bg-primary px-5 text-[14px] font-semibold text-white shadow-sm transition-all duration-150 hover:-translate-y-px hover:bg-primary/90 hover:shadow-md disabled:opacity-50"
          >
            {submitting ? "Saving..." : "Save Seedance asset"}
          </Button>
        </div>
      </div>
    </div>
  );
}
