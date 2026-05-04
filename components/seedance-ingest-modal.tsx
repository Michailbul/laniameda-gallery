"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useUploadFile } from "@convex-dev/r2/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { buildIngestKey } from "@/lib/ingest";
import { uploadVideoToR2 } from "@/lib/video-ingest";
import { cn } from "@/lib/utils";
import { api } from "@/convex/_generated/api";
import { Film, ImageIcon, Plus, X } from "lucide-react";

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

type MetadataField = { id: string; key: string; value: string };

const MODEL_NAME = "Seedance";

const VIDEO_CATEGORIES = [
  "action",
  "commercial",
  "fashion",
  "cinematic",
  "ugc",
  "music-video",
  "narrative",
  "documentary",
] as const;

const slugify = (input: string) =>
  input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-:_.]/g, "");

const newMetadataField = (): MetadataField => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  key: "",
  value: "",
});

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
  const [videoCategory, setVideoCategory] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [metadata, setMetadata] = useState<MetadataField[]>([
    newMetadataField(),
  ]);

  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const uploadVideo = useUploadFile(api.r2);

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
    setVideoCategory(null);
    setTags([]);
    setTagDraft("");
    setMetadata([newMetadataField()]);
  };

  const commitTagDraft = () => {
    const fragments = tagDraft
      .split(/[,\n]/)
      .map((value) => slugify(value))
      .filter(Boolean);
    if (fragments.length === 0) {
      setTagDraft("");
      return;
    }
    setTags((current) => Array.from(new Set([...current, ...fragments])));
    setTagDraft("");
  };

  const removeTag = (tag: string) => {
    setTags((current) => current.filter((value) => value !== tag));
  };

  const addMetadataField = () => {
    setMetadata((current) => [...current, newMetadataField()]);
  };

  const updateMetadataField = (
    id: string,
    patch: Partial<Omit<MetadataField, "id">>,
  ) => {
    setMetadata((current) =>
      current.map((field) =>
        field.id === id ? { ...field, ...patch } : field,
      ),
    );
  };

  const removeMetadataField = (id: string) => {
    setMetadata((current) => {
      const next = current.filter((field) => field.id !== id);
      return next.length > 0 ? next : [newMetadataField()];
    });
  };

  const collectTagPayload = () => {
    const collected = new Set<string>();
    for (const tag of tags) {
      const slug = slugify(tag);
      if (slug) collected.add(slug);
    }
    if (videoCategory) {
      collected.add(slugify(videoCategory));
      collected.add(`category:${slugify(videoCategory)}`);
    }
    for (const field of metadata) {
      const key = slugify(field.key);
      const value = slugify(field.value);
      if (key && value) {
        collected.add(`${key}:${value}`);
      }
    }
    return Array.from(collected);
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

  // Image branch: send the file straight to Convex via /api/ingest (the
  // existing image path). Multimodal embedding still gets the bytes.
  const ingestImage = async ({
    file,
    promptIngestKey,
    extra,
    extraTags = [],
  }: {
    file: File;
    promptIngestKey: string;
    extra: Record<string, string>;
    extraTags?: string[];
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
    for (const tag of extraTags) {
      formData.append("tags", tag);
    }
    for (const [key, value] of Object.entries(extra)) {
      formData.append(key, value);
    }
    return postIngest(formData);
  };

  // Video branch: bytes already live in R2 (uploaded direct from
  // browser by uploadVideoToR2). We send only the r2Key + small poster
  // JPEG to /api/ingest so the asset row gets created and the gallery
  // card has a still to render.
  const ingestVideoFromR2 = async ({
    upload,
    promptIngestKey,
    extra,
    extraTags = [],
  }: {
    upload: Awaited<ReturnType<typeof uploadVideoToR2>>;
    promptIngestKey: string;
    extra: Record<string, string>;
    extraTags?: string[];
  }) => {
    const formData = new FormData();
    formData.append("prompt", promptText.trim());
    formData.append("promptText", promptText.trim());
    formData.append("promptIngestKey", promptIngestKey);
    formData.append(
      "ingestKey",
      buildIngestKey({
        promptText: promptText.trim(),
        fileName: upload.fileName,
      }) ?? `${promptIngestKey}|${upload.fileName}`,
    );
    formData.append("modelName", MODEL_NAME);
    formData.append("r2Key", upload.r2Key);
    formData.append("mediaContentType", upload.contentType);
    formData.append("mediaSize", String(upload.size));
    formData.append("mediaWidth", String(upload.poster.width));
    formData.append("mediaHeight", String(upload.poster.height));
    formData.append("mediaFileName", upload.fileName);
    formData.append(
      "posterFile",
      new File([upload.poster.blob], `${upload.fileName}.poster.jpg`, {
        type: upload.poster.blob.type || "image/jpeg",
      }),
    );
    formData.append("posterWidth", String(upload.poster.width));
    formData.append("posterHeight", String(upload.poster.height));
    for (const tag of extraTags) {
      formData.append("tags", tag);
    }
    for (const [key, value] of Object.entries(extra)) {
      formData.append(key, value);
    }
    return postIngest(formData);
  };

  const postIngest = async (formData: FormData) => {
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
    const sharedTags = collectTagPayload();

    try {
      let upstreamAssetId: string | undefined;

      if (sourceImage) {
        setStatus({ type: "info", message: "Saving source image..." });
        const imageResult = await ingestImage({
          file: sourceImage,
          promptIngestKey,
          extra: {
            generationType: "image_gen",
            assetRole: "reference",
          },
          extraTags: sharedTags,
        });
        upstreamAssetId = imageResult.result?.assetId;
      }

      setStatus({ type: "info", message: "Generating video poster..." });
      const upload = await uploadVideoToR2(video, {
        uploadVideo,
        onStage: (stage) => {
          if (stage === "uploading") {
            setStatus({
              type: "info",
              message: "Uploading video to R2...",
            });
          }
        },
      });

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

      setStatus({ type: "info", message: "Finishing ingest..." });
      await ingestVideoFromR2({
        upload,
        promptIngestKey,
        extra: videoExtra,
        extraTags: sharedTags,
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

          {/* Video category */}
          <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-border/60 bg-white/40 p-5 shadow-sm backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <Label className="text-[13px] font-semibold text-muted-foreground">
                Video category
              </Label>
              {videoCategory && (
                <button
                  type="button"
                  onClick={() => setVideoCategory(null)}
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {VIDEO_CATEGORIES.map((category) => {
                const active = videoCategory === category;
                return (
                  <button
                    key={category}
                    type="button"
                    onClick={() =>
                      setVideoCategory(active ? null : category)
                    }
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-[12px] font-medium uppercase tracking-wider transition-colors",
                      active
                        ? "border-primary bg-primary text-white"
                        : "border-border/60 bg-surface-1 text-muted-foreground hover:bg-surface-2 hover:text-foreground",
                    )}
                  >
                    {category}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Saved as the <code>category:&lt;name&gt;</code> tag plus the
              category itself, so the existing tag filter picks it up.
            </p>
          </div>

          {/* Tags */}
          <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-border/60 bg-white/40 p-5 shadow-sm backdrop-blur-sm">
            <Label
              htmlFor="seedance-tags"
              className="text-[13px] font-semibold text-muted-foreground"
            >
              Tags
            </Label>
            <Input
              id="seedance-tags"
              value={tagDraft}
              onChange={(event) => setTagDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === ",") {
                  event.preventDefault();
                  commitTagDraft();
                }
              }}
              onBlur={() => {
                if (tagDraft.trim()) commitTagDraft();
              }}
              placeholder="Press Enter or comma to add (e.g. dramatic, hero-shot)"
              className="h-11 rounded-[14px] border-border/60 bg-surface-1 text-[13px] focus-visible:border-primary focus-visible:shadow-[0_0_0_3px_var(--accent-subtle)] focus-visible:ring-0"
            />
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-surface-2 px-3 py-1.5 text-[12px] text-foreground"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => removeTag(tag)}
                      aria-label={`Remove tag ${tag}`}
                      className="text-muted-foreground transition-colors hover:text-foreground"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Free-form metadata */}
          <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-border/60 bg-white/40 p-5 shadow-sm backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <Label className="text-[13px] font-semibold text-muted-foreground">
                Custom metadata
              </Label>
              <button
                type="button"
                onClick={addMetadataField}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
              >
                <Plus className="h-3 w-3" />
                Add field
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {metadata.map((field) => (
                <div key={field.id} className="flex items-center gap-2">
                  <Input
                    value={field.key}
                    onChange={(event) =>
                      updateMetadataField(field.id, { key: event.target.value })
                    }
                    placeholder="key (e.g. duration)"
                    className="h-10 flex-1 rounded-[12px] border-border/60 bg-surface-1 text-[13px] focus-visible:border-primary focus-visible:shadow-[0_0_0_3px_var(--accent-subtle)] focus-visible:ring-0"
                  />
                  <Input
                    value={field.value}
                    onChange={(event) =>
                      updateMetadataField(field.id, {
                        value: event.target.value,
                      })
                    }
                    placeholder="value (e.g. 5s)"
                    className="h-10 flex-[2] rounded-[12px] border-border/60 bg-surface-1 text-[13px] focus-visible:border-primary focus-visible:shadow-[0_0_0_3px_var(--accent-subtle)] focus-visible:ring-0"
                  />
                  <button
                    type="button"
                    onClick={() => removeMetadataField(field.id)}
                    aria-label="Remove metadata field"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Each filled pair is saved as a <code>key:value</code> tag, so
              you can filter on it later (e.g. <code>duration:5s</code>).
            </p>
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
