"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useUploadFile } from "@convex-dev/r2/react";
import { buildIngestKey } from "@/lib/ingest";
import { uploadVideoToR2 } from "@/lib/video-ingest";
import { api } from "@/convex/_generated/api";
import { ArrowRight, Film, ImageIcon, Plus, X } from "lucide-react";

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

// `.lm-brutal button { border-radius: 6px }` is house-wide, so fields, drop
// zones and the shell match it rather than the sharper 2px token — otherwise
// the buttons in this modal would be the only rounded things in it.
const CONTROL_RADIUS = "6px";

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

  // ── Presentation primitives ──
  // Flat and cardless by house rule: sections are separated by hairlines and
  // typographic hierarchy, never by nested panels. Radius stays at the token
  // (2px) so nothing reads as a rounded card.
  const labelStyle: React.CSSProperties = {
    fontFamily: "var(--lm-font)",
    fontSize: "9px",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.16em",
    color: "var(--lm-text-ghost)",
  };

  const fieldStyle: React.CSSProperties = {
    width: "100%",
    fontFamily: "var(--lm-font)",
    fontSize: "12px",
    color: "var(--lm-text-primary)",
    backgroundColor: "var(--lm-surface-1)",
    border: "1px solid var(--lm-border)",
    borderRadius: CONTROL_RADIUS,
    padding: "8px 10px",
    outline: "none",
  };

  const hintStyle: React.CSSProperties = {
    fontFamily: "var(--lm-font)",
    fontSize: "10px",
    lineHeight: 1.6,
    color: "var(--lm-text-ghost)",
  };

  const statusAccent =
    status?.type === "error"
      ? "var(--lm-coral)"
      : status?.type === "success"
        ? "var(--lm-success)"
        : "var(--lm-text-tertiary)";

  const dropZoneStyle = (
    target: DropTarget,
    filled: boolean,
  ): React.CSSProperties => ({
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    cursor: "pointer",
    overflow: "hidden",
    backgroundColor:
      activeDrop === target ? "var(--lm-accent-dim)" : "var(--lm-surface-1)",
    border: `1px ${filled ? "solid" : "dashed"} ${
      activeDrop === target ? "var(--lm-coral)" : "var(--lm-border)"
    }`,
    borderRadius: CONTROL_RADIUS,
    transition: "background-color 120ms, border-color 120ms",
  });

  const sectionLabel = (
    text: string,
    opts?: { required?: boolean; note?: string; action?: React.ReactNode },
  ) => (
    <div className="flex items-baseline justify-between gap-3">
      <span style={labelStyle}>
        {text}
        {opts?.required && (
          <span style={{ color: "var(--lm-coral)" }}> *</span>
        )}
        {opts?.note && (
          <span style={{ color: "var(--lm-text-ghost)", opacity: 0.7 }}>
            {" "}
            {opts.note}
          </span>
        )}
      </span>
      {opts?.action}
    </div>
  );

  const minorAction = (label: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontFamily: "var(--lm-font)",
        fontSize: "9px",
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.14em",
        color: "var(--lm-text-tertiary)",
        background: "none",
        border: "none",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center px-4 py-6 lm-brutal"
      aria-modal="true"
      role="dialog"
      aria-label="Seedance manual upload"
      // Opts out of the mobile bottom-sheet treatment (coral top stroke +
      // rounded top corners) that `[role="dialog"]` picks up under md — this
      // is a centred panel, not a sheet.
      data-flat-dialog=""
    >
      <div
        className="absolute inset-0 animate-fade-in"
        style={{ backgroundColor: "rgba(8, 7, 6, 0.94)", willChange: "opacity" }}
        onClick={handleClose}
        aria-hidden
      />

      <div
        className="relative z-10 flex max-h-[92vh] w-full max-w-[1080px] flex-col overflow-hidden animate-fade-in"
        style={{
          backgroundColor: "var(--lm-surface-0)",
          border: "1px solid var(--lm-border-strong)",
          borderRadius: CONTROL_RADIUS,
          willChange: "opacity",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header — mono eyebrow + mono title, no serif, no filled bar */}
        <div
          className="flex items-center justify-between gap-4 px-6 py-4"
          style={{ borderBottom: "1px solid var(--lm-border)" }}
        >
          <div className="flex flex-col gap-1.5">
            <span
              style={{
                fontFamily: "var(--lm-font)",
                fontSize: "9px",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.2em",
                color: "var(--lm-coral)",
              }}
            >
              Seedance
            </span>
            <h2
              style={{
                fontFamily: "var(--lm-font)",
                fontSize: "15px",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                color: "var(--lm-text-primary)",
              }}
            >
              Manual upload
            </h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close Seedance manual upload"
            className="flex h-7 w-7 shrink-0 items-center justify-center interactive-ghost"
            style={{
              border: "1px solid var(--lm-border)",
              borderRadius: CONTROL_RADIUS,
              color: "var(--lm-text-tertiary)",
            }}
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>

        {status && (
          <div
            role="status"
            aria-live={status.type === "error" ? "assertive" : "polite"}
            className="px-6 py-2.5"
            style={{
              borderBottom: "1px solid var(--lm-border)",
              borderLeft: `2px solid ${statusAccent}`,
              backgroundColor: "var(--lm-surface-1)",
              fontFamily: "var(--lm-font)",
              fontSize: "11px",
              letterSpacing: "0.04em",
              color:
                status.type === "error"
                  ? "var(--lm-coral)"
                  : "var(--lm-text-secondary)",
            }}
          >
            {status.message}
          </div>
        )}

        {/* Two columns: media on the left, everything typed on the right, so
            the two required fields (video + prompt) sit side by side without
            scrolling. Stacks under md. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
          {/* ── Media ── */}
          <div
            className="flex shrink-0 flex-col gap-5 p-6 md:w-[42%] md:overflow-y-auto"
            style={{ borderRight: "1px solid var(--lm-border)" }}
          >
            <div className="flex flex-col gap-2">
              {sectionLabel("Video", {
                required: true,
                action: video
                  ? minorAction("Remove", () => setVideo(null))
                  : undefined,
              })}
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
                style={{
                  ...dropZoneStyle("video", Boolean(video)),
                  aspectRatio: "16 / 9",
                }}
              >
                {videoPreviewUrl ? (
                  <video
                    src={videoPreviewUrl}
                    controls
                    playsInline
                    preload="metadata"
                    className="h-full w-full object-contain"
                    style={{ backgroundColor: "#000" }}
                  />
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <Film
                      className="h-6 w-6"
                      style={{ color: "var(--lm-text-ghost)" }}
                      aria-hidden
                    />
                    <span
                      style={{
                        fontFamily: "var(--lm-font)",
                        fontSize: "10px",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.14em",
                        color: "var(--lm-text-secondary)",
                      }}
                    >
                      Drop video
                    </span>
                    <span style={hintStyle}>or click to browse</span>
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
                <div
                  className="flex items-baseline justify-between gap-3"
                  style={hintStyle}
                >
                  <span
                    className="truncate"
                    style={{ color: "var(--lm-text-secondary)" }}
                  >
                    {video.name}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {(video.size / (1024 * 1024)).toFixed(1)} MB
                  </span>
                </div>
              )}
            </div>

            <div className="lm-divider" />

            <div className="flex flex-col gap-2">
              {sectionLabel("Source image", {
                note: "· optional",
                action: sourceImage
                  ? minorAction("Remove", () => setSourceImage(null))
                  : undefined,
              })}
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
                style={{
                  ...dropZoneStyle("image", Boolean(sourceImage)),
                  // Cap the filled zone, not the <img> — a wide frame would
                  // otherwise push the filename row and hint out of the column.
                  height: sourceImage ? "150px" : undefined,
                  minHeight: sourceImage ? undefined : "96px",
                }}
              >
                {imagePreviewUrl ? (
                  <Image
                    src={imagePreviewUrl}
                    alt={sourceImage?.name ?? "Source image preview"}
                    width={400}
                    height={400}
                    unoptimized
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <div className="flex items-center gap-2.5 px-3">
                    <ImageIcon
                      className="h-4 w-4 shrink-0"
                      style={{ color: "var(--lm-text-ghost)" }}
                      aria-hidden
                    />
                    <span style={hintStyle}>
                      Drop the frame this video was generated from
                    </span>
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
                <div
                  className="flex items-baseline justify-between gap-3"
                  style={hintStyle}
                >
                  <span
                    className="truncate"
                    style={{ color: "var(--lm-text-secondary)" }}
                  >
                    {sourceImage.name}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {(sourceImage.size / (1024 * 1024)).toFixed(1)} MB
                  </span>
                </div>
              )}
              <p style={hintStyle}>Linked as the video&rsquo;s upstream input.</p>
            </div>
          </div>

          {/* ── Prompt + metadata ── */}
          <div className="flex min-w-0 flex-1 flex-col gap-4 p-6 md:overflow-y-auto">
            <div className="flex flex-col gap-2">
              {sectionLabel("Prompt", {
                required: true,
                action: (
                  <span
                    style={{ ...hintStyle, letterSpacing: "0.04em" }}
                    className="tabular-nums"
                  >
                    {promptText.length} / 4000
                  </span>
                ),
              })}
              <textarea
                id="seedance-prompt"
                value={promptText}
                onChange={(event) => setPromptText(event.target.value)}
                placeholder="Paste the Seedance prompt that produced this video"
                maxLength={4000}
                className="lm-field resize-y"
                style={{
                  ...fieldStyle,
                  minHeight: "148px",
                  lineHeight: 1.65,
                }}
              />
            </div>

            <div className="lm-divider" />

            <div className="flex flex-col gap-2.5">
              {sectionLabel("Category", {
                action: videoCategory
                  ? minorAction("Clear", () => setVideoCategory(null))
                  : undefined,
              })}
              <div className="flex flex-wrap gap-1.5">
                {VIDEO_CATEGORIES.map((category) => {
                  const active = videoCategory === category;
                  return (
                    <button
                      key={category}
                      type="button"
                      className="lm-chip"
                      data-active={active ? "true" : undefined}
                      onClick={() => setVideoCategory(active ? null : category)}
                    >
                      {category}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="lm-divider" />

            <div className="flex flex-col gap-2.5">
              {sectionLabel("Tags")}
              <input
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
                placeholder="dramatic, hero-shot — Enter or comma to add"
                className="lm-field"
                style={fieldStyle}
              />
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <span key={tag} className="lm-chip" style={{ cursor: "default" }}>
                      {tag}
                      <button
                        type="button"
                        onClick={() => removeTag(tag)}
                        aria-label={`Remove tag ${tag}`}
                        className="flex items-center"
                        style={{
                          background: "none",
                          border: "none",
                          color: "var(--lm-text-tertiary)",
                          cursor: "pointer",
                          padding: 0,
                          marginLeft: "2px",
                        }}
                      >
                        <X className="h-2.5 w-2.5" aria-hidden />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="lm-divider" />

            <div className="flex flex-col gap-2.5">
              {sectionLabel("Metadata", {
                action: (
                  <button
                    type="button"
                    onClick={addMetadataField}
                    className="inline-flex items-center gap-1"
                    style={{
                      fontFamily: "var(--lm-font)",
                      fontSize: "9px",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.14em",
                      color: "var(--lm-text-tertiary)",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                    }}
                  >
                    <Plus className="h-2.5 w-2.5" aria-hidden />
                    Add field
                  </button>
                ),
              })}
              <div className="flex flex-col gap-1.5">
                {metadata.map((field) => (
                  <div key={field.id} className="flex items-center gap-1.5">
                    <input
                      value={field.key}
                      onChange={(event) =>
                        updateMetadataField(field.id, {
                          key: event.target.value,
                        })
                      }
                      placeholder="duration"
                      className="lm-field"
                      style={{ ...fieldStyle, flex: "1 1 0%", minWidth: 0 }}
                    />
                    <input
                      value={field.value}
                      onChange={(event) =>
                        updateMetadataField(field.id, {
                          value: event.target.value,
                        })
                      }
                      placeholder="5s"
                      className="lm-field"
                      style={{ ...fieldStyle, flex: "2 1 0%", minWidth: 0 }}
                    />
                    <button
                      type="button"
                      onClick={() => removeMetadataField(field.id)}
                      aria-label="Remove metadata field"
                      className="flex h-[33px] w-[33px] shrink-0 items-center justify-center interactive-ghost"
                      style={{
                        border: "1px solid var(--lm-border)",
                        borderRadius: CONTROL_RADIUS,
                        color: "var(--lm-text-ghost)",
                      }}
                    >
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
              <p style={hintStyle}>
                Category and each filled pair are saved as{" "}
                <span style={{ color: "var(--lm-text-tertiary)" }}>
                  key:value
                </span>{" "}
                tags, so the gallery&rsquo;s tag filter picks them up.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between gap-4 px-6 py-3.5"
          style={{ borderTop: "1px solid var(--lm-border)" }}
        >
          <span className="hidden sm:inline" style={hintStyle}>
            Saved as model{" "}
            <span style={{ color: "var(--lm-text-secondary)" }}>
              {MODEL_NAME}
            </span>
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="lm-btn-ghost"
              onClick={handleClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="lm-btn-brutal"
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
              style={
                canSubmit ? undefined : { opacity: 0.4, cursor: "not-allowed" }
              }
            >
              {submitting ? "Saving" : "Save to gallery"}
              {!submitting && <ArrowRight className="h-3 w-3" aria-hidden />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
