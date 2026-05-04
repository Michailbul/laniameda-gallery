"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useUploadFile } from "@convex-dev/r2/react";
import { requestJson } from "@/lib/app-api";
import { parseTagNames } from "@/lib/ingest";
import { buildUploadFormData } from "@/lib/upload-form";
import { uploadVideoToR2 } from "@/lib/video-ingest";
import { cn } from "@/lib/utils";
import { api } from "@/convex/_generated/api";

export type FolderOption = {
  _id: string;
  name: string;
  description?: string | null;
};

type StatusMessage = {
  type: "success" | "error" | "info";
  message: string;
} | null;

export type UploadPanelProps = {
  availableTags?: string[];
  folders?: FolderOption[];
  ownerUserId?: string;
  onDataChanged?: () => void;
  className?: string;
};

type FilePreview = {
  file: File;
  url: string;
};

const NO_FOLDER_VALUE = "__none";
const NO_VALUE = "__none";

const MODEL_NAME_OPTIONS = [
  "Midjourney",
  "FLUX",
  "DALL-E 3",
  "Stable Diffusion",
  "Nano Banana Pro",
  "CDANCe",
  "Runway",
  "Kling",
  "Sora",
  "Ideogram",
  "Firefly",
  "Imagen",
] as const;

const GENERATION_TYPE_OPTIONS = [
  { value: "image_gen", label: "Image" },
  { value: "video_gen", label: "Video" },
  { value: "ui_design", label: "UI Design" },
  { value: "workflow", label: "Workflow" },
  { value: "other", label: "Other" },
] as const;

const PILLAR_OPTIONS = [
  { value: "creators", label: "Creators" },
  { value: "cars", label: "Cars" },
  { value: "designs", label: "Designs" },
  { value: "dump", label: "Dump" },
] as const;

const PROMPT_TYPE_OPTIONS = [
  { value: "image_gen", label: "Image Gen" },
  { value: "video_gen", label: "Video Gen" },
  { value: "ui_design", label: "UI Design" },
  { value: "cinematic", label: "Cinematic" },
  { value: "ugc_ad", label: "UGC Ad" },
  { value: "workflow", label: "Workflow" },
  { value: "component_prompt", label: "Component Prompt" },
  { value: "page_prompt", label: "Page Prompt" },
  { value: "other", label: "Other" },
] as const;

const WORKFLOW_TYPE_OPTIONS = [
  { value: "component_prompt", label: "Component Prompt" },
  { value: "page_prompt", label: "Page Prompt" },
  { value: "system_prompt", label: "System Prompt" },
  { value: "asset_recipe", label: "Asset Recipe" },
  { value: "other", label: "Other" },
] as const;

const ASSET_ROLE_OPTIONS = [
  { value: "generated_output", label: "Generated Output" },
  { value: "reference", label: "Reference" },
  { value: "inspiration_capture", label: "Inspiration Capture" },
  { value: "workflow_asset", label: "Workflow Asset" },
  { value: "other", label: "Other" },
] as const;

export function UploadPanel({
  availableTags = [],
  folders = [],
  ownerUserId,
  onDataChanged,
  className,
}: UploadPanelProps) {
  const [promptText, setPromptText] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [folderSelection, setFolderSelection] = useState(NO_FOLDER_VALUE);
  const [folderDraftName, setFolderDraftName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [modelNameSelection, setModelNameSelection] = useState(NO_VALUE);
  const [modelNameCustom, setModelNameCustom] = useState("");
  const [pillarSelection, setPillarSelection] = useState(NO_VALUE);
  const [generationType, setGenerationType] = useState(NO_VALUE);
  const [promptType, setPromptType] = useState(NO_VALUE);
  const [workflowType, setWorkflowType] = useState(NO_VALUE);
  const [assetRole, setAssetRole] = useState(NO_VALUE);
  const [domainInput, setDomainInput] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [saveAsTextOnlyPrompt, setSaveAsTextOnlyPrompt] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [status, setStatus] = useState<StatusMessage>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragCounterRef = useRef(0);
  const highlightRef = useRef<HTMLPreElement | null>(null);

  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const canCreateFolders = Boolean(ownerUserId?.trim());

  const canSubmit = Boolean(
    promptText.trim().length > 0 || urlInput.trim().length > 0 || selectedFiles.length > 0,
  );
  const hasMediaInputs =
    urlInput.trim().length > 0 || selectedFiles.length > 0;
  const isPromptOnlyDraft =
    promptText.trim().length > 0 && !hasMediaInputs;

  const previews = useMemo<FilePreview[]>(() => {
    return selectedFiles.map((file) => {
      const url = URL.createObjectURL(file);
      return { file, url };
    });
  }, [selectedFiles]);

  const [activePreviewIndex, setActivePreviewIndex] = useState(0);

  useEffect(() => {
    return () => {
      previews.forEach((preview) => URL.revokeObjectURL(preview.url));
    };
  }, [previews]);

  useEffect(() => {
    if (previews.length === 0) {
      setActivePreviewIndex(0);
      return;
    }
    if (activePreviewIndex >= previews.length) {
      setActivePreviewIndex(0);
    }
  }, [previews.length, activePreviewIndex]);

  useEffect(() => {
    if (previews.length <= 1) return;
    const interval = window.setInterval(() => {
      setActivePreviewIndex((prev) => (prev + 1) % previews.length);
    }, 4000);
    return () => window.clearInterval(interval);
  }, [previews.length]);

  useEffect(() => {
    if (!status) return;
    if (statusTimerRef.current !== null) {
      clearTimeout(statusTimerRef.current);
    }
    statusTimerRef.current = setTimeout(() => setStatus(null), 5000);
    return () => {
      if (statusTimerRef.current !== null) {
        clearTimeout(statusTimerRef.current);
        statusTimerRef.current = null;
      }
    };
  }, [status]);

  const tagSuggestions = useMemo(() => {
    const unique = Array.from(new Set(availableTags));
    return unique.slice(0, 6);
  }, [availableTags]);

  const handleIncomingFiles = (files: FileList | File[]) => {
    const added: File[] = Array.from(files).filter((file): file is File => file instanceof File);
    if (added.length === 0) return;
    setSelectedFiles((previous) => [...previous, ...added]);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragActive(false);
    if (event.dataTransfer?.files?.length) {
      handleIncomingFiles(event.dataTransfer.files);
    }
  };

  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounterRef.current += 1;
    setIsDragActive(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragActive(false);
    }
  };

  const addTags = (value?: string) => {
    const parsed = parseTagNames(value?.toString() ?? "");
    if (parsed.length === 0) return;
    setTags((previous) => Array.from(new Set([...previous, ...parsed])));
  };

  const clearForm = () => {
    setPromptText("");
    setUrlInput("");
    setTagInput("");
    setTags([]);
    setSelectedFiles([]);
    setSaveAsTextOnlyPrompt(false);
    setFolderSelection(NO_FOLDER_VALUE);
    setFolderDraftName("");
    setCreatingFolder(false);
    setModelNameSelection(NO_VALUE);
    setModelNameCustom("");
    setPillarSelection(NO_VALUE);
    setGenerationType(NO_VALUE);
    setPromptType(NO_VALUE);
    setWorkflowType(NO_VALUE);
    setAssetRole(NO_VALUE);
    setDomainInput("");
    setIsDragActive(false);
    setStatus(null);
  };

  const handleCreateFolder = async () => {
    const name = folderDraftName.trim();
    const normalizedOwnerUserId = ownerUserId?.trim();
    if (!normalizedOwnerUserId) {
      setStatus({ type: "error", message: "Sign in to create folders." });
      return;
    }
    if (!name) {
      setStatus({ type: "error", message: "Folder name is required." });
      return;
    }
    if (creatingFolder) return;

    setCreatingFolder(true);
    setStatus(null);
    try {
      const result = await requestJson<{
        folder: { _id: string };
        created: boolean;
      }>("/api/folders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      setFolderSelection(result.folder._id);
      setFolderDraftName("");
      setStatus({
        type: "success",
        message: result.created ? "Folder created." : "Using existing folder.",
      });
      onDataChanged?.();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create folder.";
      setStatus({ type: "error", message });
    } finally {
      setCreatingFolder(false);
    }
  };

  const uploadVideo = useUploadFile(api.r2);

  const handleSubmit = async () => {
    if (isUploading) return;
    if (!canSubmit) {
      setStatus({ type: "error", message: "Add a prompt, URL, or file before saving." });
      return;
    }
    setIsUploading(true);
    setStatus(null);
    try {
      const resolvedFolderId =
        folderSelection === NO_FOLDER_VALUE || !folderSelection
          ? undefined
          : folderSelection;
      const resolvedModelName =
        modelNameSelection === "__custom"
          ? modelNameCustom.trim() || undefined
          : modelNameSelection === NO_VALUE
            ? undefined
            : modelNameSelection;
      const resolvedGenerationType =
        generationType === NO_VALUE ? undefined : generationType;
      const resolvedPillar =
        pillarSelection === NO_VALUE ? undefined : pillarSelection;
      const resolvedPromptType =
        promptType === NO_VALUE ? undefined : promptType;
      const resolvedWorkflowType =
        workflowType === NO_VALUE ? undefined : workflowType;
      const resolvedAssetRole =
        assetRole === NO_VALUE ? undefined : assetRole;
      if (isPromptOnlyDraft && !saveAsTextOnlyPrompt) {
        throw new Error(
          "Enable “save as text-only prompt” to ingest prompt-only content.",
        );
      }
      const candidateFile = selectedFiles[0] ?? null;
      const isVideoUpload = Boolean(
        candidateFile && candidateFile.type.startsWith("video/"),
      );

      // Videos go to Cloudflare R2 directly from the browser; images
      // keep using the existing Convex storage path.
      const formData = buildUploadFormData({
        promptText,
        allowPromptOnly: isPromptOnlyDraft && saveAsTextOnlyPrompt,
        url: urlInput,
        folderId: resolvedFolderId,
        tags,
        file: isVideoUpload ? null : candidateFile,
        modelName: resolvedModelName,
        pillar: resolvedPillar,
        generationType: resolvedGenerationType,
        promptType: resolvedPromptType,
        workflowType: resolvedWorkflowType,
        assetRole: resolvedAssetRole,
        domain: domainInput.trim() || undefined,
      });

      if (isVideoUpload && candidateFile) {
        setStatus({ type: "info", message: "Uploading video to R2..." });
        const upload = await uploadVideoToR2(candidateFile, {
          uploadVideo,
          onStage: (stage) => {
            if (stage === "poster") {
              setStatus({ type: "info", message: "Generating video poster..." });
            } else if (stage === "uploading") {
              setStatus({ type: "info", message: "Uploading video to R2..." });
            }
          },
        });
        formData.append("r2Key", upload.r2Key);
        formData.append("mediaContentType", upload.contentType);
        formData.append("mediaSize", String(upload.size));
        formData.append("mediaWidth", String(upload.poster.width));
        formData.append("mediaHeight", String(upload.poster.height));
        formData.append("mediaFileName", upload.fileName);
        formData.append(
          "posterFile",
          new File(
            [upload.poster.blob],
            `${upload.fileName}.poster.jpg`,
            { type: upload.poster.blob.type || "image/jpeg" },
          ),
        );
        formData.append("posterWidth", String(upload.poster.width));
        formData.append("posterHeight", String(upload.poster.height));
      }

      const response = await fetch("/api/ingest", {
        method: "POST",
        body: formData,
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          body && typeof body.error === "string"
            ? body.error
            : "Something went wrong while ingesting your prompt.";
        throw new Error(message);
      }

      clearForm();
      setStatus({ type: "success", message: "Ingest queued. The gallery will update shortly." });
      onDataChanged?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setStatus({ type: "error", message });
    } finally {
      setIsUploading(false);
    }
  };

  const handleTagKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addTags(tagInput);
      setTagInput("");
    }
  };

  const promptHighlight = useMemo(() => {
    const trimmed = promptText.trim();
    if (!trimmed) {
      return null;
    }
    try {
      const parsed = JSON.parse(trimmed);
      const pretty = JSON.stringify(parsed, null, 2);
      const escaped = pretty
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      const keys: string[] = [];
      let staged = escaped.replace(/"(.*?)"(?=\\s*:)/g, (_, key) => {
        const index = keys.push(key) - 1;
        return `@@KEY${index}@@`;
      });
      staged = staged.replace(/"(.*?)"/g, '<span class="text-amber-200">"$1"</span>');
      staged = staged.replace(/\b(true|false|null)\b/g, '<span class="text-purple-200">$1</span>');
      staged = staged.replace(/\b-?\d+(?:\.\d+)?\b/g, '<span class="text-sky-200">$&</span>');
      staged = staged.replace(/@@KEY(\d+)@@/g, (_, index) => {
        const key = keys[Number(index)] ?? "";
        return `<span class="text-emerald-200">"${key}"</span>`;
      });
      return staged;
    } catch {
      return null;
    }
  }, [promptText]);

  const statusClasses = {
    success: "text-success-foreground bg-success/10 border border-success/20",
    error: "text-destructive bg-destructive/10 border border-destructive/30",
    info: "text-muted-foreground bg-muted/20 border border-muted",
  };

  const descriptionId = "upload-dropzone-description";

  return (
    <div className={cn("relative mx-auto flex h-full w-full max-w-[1200px] flex-col min-h-0", className)}>
      {status && (
        <div
          role="status"
          aria-live={status.type === "error" ? "assertive" : "polite"}
          className={cn("mb-6 rounded-xl px-4 py-3 text-sm font-medium", statusClasses[status.type])}
        >
          {status.message}
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
        className="grid grid-cols-1 gap-8 lg:grid-cols-[1.4fr_1fr] lg:items-start"
      >
        {/* Left Column: Core Content */}
        <div className="flex flex-col gap-6">
          {/* Prompt Section (HERO) */}
          <div className="relative flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-white/40 shadow-sm backdrop-blur-sm">
            <Label htmlFor="prompt-text" className="px-4 pt-4 text-[13px] font-semibold text-muted-foreground mb-2">Prompt</Label>
            <div className="relative min-h-[360px] flex-1">
              {promptHighlight && (
                <pre
                  ref={highlightRef}
                  aria-hidden
                  className="pointer-events-none absolute inset-0 overflow-auto px-4 pb-4 font-display text-[18px] italic leading-relaxed text-foreground/90"
                  dangerouslySetInnerHTML={{ __html: promptHighlight }}
                />
              )}
              <Textarea
                id="prompt-text"
                placeholder="A quiet morning in a Parisian café, golden light streaming through tall windows, the scent of fresh croissants..."
                value={promptText}
                onChange={(event) => setPromptText(event.target.value)}
                onScroll={(event) => {
                  if (highlightRef.current) {
                    highlightRef.current.scrollTop = event.currentTarget.scrollTop;
                    highlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
                  }
                }}
                maxLength={2000}
                className={cn(
                  "min-h-[360px] h-full w-full resize-y border-0 bg-transparent px-4 pb-4 font-display text-[18px] italic leading-relaxed focus-visible:ring-0",
                  promptHighlight
                    ? "text-transparent caret-foreground selection:bg-foreground/20 selection:text-transparent"
                    : "text-foreground"
                )}
              />
            </div>
            <div className="absolute bottom-4 right-4 text-xs font-mono text-muted-foreground">
              {promptText.length} / 2000
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-white/40 p-5 shadow-sm backdrop-blur-sm">
            <div className="flex items-start gap-3">
              <Checkbox
                id="save-as-text-only-prompt"
                checked={saveAsTextOnlyPrompt}
                onCheckedChange={(checked) => setSaveAsTextOnlyPrompt(checked === true)}
                className="mt-0.5"
              />
              <div className="space-y-1">
                <Label
                  htmlFor="save-as-text-only-prompt"
                  className="text-[13px] font-semibold text-muted-foreground"
                >
                  Save as text-only prompt
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Required when you want to ingest prompt text without any file or URL.
                </p>
                {isPromptOnlyDraft && !saveAsTextOnlyPrompt ? (
                  <p className="text-[11px] font-medium text-amber-700">
                    This draft has no media attached. Turn this on to save it intentionally as text-only.
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          {/* Media Upload */}
          <div className="flex flex-col gap-2 rounded-2xl border border-border/60 bg-white/40 p-5 shadow-sm backdrop-blur-sm">
            <Label className="text-[13px] font-semibold text-muted-foreground">Media</Label>
            <div
              data-testid="upload-dropzone"
              role="button"
              aria-label="Drag files here or click to browse"
              aria-describedby={descriptionId}
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDrop={handleDrop}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
                handleDragEnter(event);
              }}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              className={cn(
                "relative flex min-h-[160px] flex-col items-center justify-center rounded-xl border border-border/40 bg-linear-to-br from-surface-2 to-surface-1 p-6 text-center transition-all duration-250 hover:from-surface-3 hover:to-surface-2 hover:shadow-[inset_0_3px_12px_rgba(32,23,16,0.06),0_2px_4px_rgba(32,23,16,0.04)]",
                isDragActive && "border-primary from-accent-subtle to-surface-1 shadow-[inset_0_3px_12px_rgba(255,122,100,0.12),0_0_0_3px_var(--accent-subtle)]"
              )}
            >
              {isUploading && (
                <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-background/80 backdrop-blur-sm">
                  <span className="animate-pulse text-[10px] uppercase tracking-[0.4em] font-medium text-muted-foreground">
                    Uploading...
                  </span>
                </div>
              )}
              
              <div className="flex flex-col items-center gap-1">
                <svg className="mb-2 h-10 w-10 text-muted-foreground/60" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
                <p className="text-[15px] font-semibold text-foreground">Drop media here</p>
                <p className="text-[13px] text-muted-foreground">or click to browse</p>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,video/*"
                className="sr-only"
                onChange={(event) => {
                  if (event.target.files) {
                    handleIncomingFiles(event.target.files);
                  }
                  event.target.value = "";
                }}
              />
            </div>
            <p id={descriptionId} className="text-[11px] text-muted-foreground mt-1">
              Support for JPEG, PNG, MP4, MOV — up to 50MB per file. Multi-file sends the first file for now.
            </p>
          </div>

          {/* URL Input */}
          <div className="flex flex-col gap-2 rounded-2xl border border-border/60 bg-white/40 p-5 shadow-sm backdrop-blur-sm">
            <Label htmlFor="prompt-url" className="text-[13px] font-semibold text-muted-foreground">Prompt URL</Label>
            <Input
              id="prompt-url"
              placeholder="https://example.com/asset"
              value={urlInput}
              onChange={(event) => setUrlInput(event.target.value)}
              className="bg-surface-1 border-border/60 rounded-[14px] h-12 text-[15px] focus-visible:ring-0 focus-visible:border-primary focus-visible:shadow-[0_0_0_3px_var(--accent-subtle)] transition-all"
            />
            <p className="text-[11px] text-muted-foreground">Fetch media from external URLs you trust.</p>
          </div>

          {/* Tags Section */}
          <div className="flex flex-col gap-2 rounded-2xl border border-border/60 bg-white/40 p-5 shadow-sm backdrop-blur-sm">
            <Label htmlFor="tag-input" className="text-[13px] font-semibold text-muted-foreground">Tags</Label>
            <Input
              id="tag-input"
              placeholder="Type tags and press Enter or comma to add"
              value={tagInput}
              onChange={(event) => setTagInput(event.target.value)}
              onKeyDown={handleTagKeyDown}
              className="bg-surface-1 border-border/60 rounded-[14px] h-12 text-[15px] focus-visible:ring-0 focus-visible:border-primary focus-visible:shadow-[0_0_0_3px_var(--accent-subtle)] transition-all"
            />
            
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-surface-2 px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:border-border/80 hover:bg-surface-3"
                  >
                    {tag}
                    <button
                      type="button"
                      aria-label={`Remove ${tag}`}
                      className="text-muted-foreground/70 hover:text-foreground transition-colors"
                      onClick={() => setTags((previous) => previous.filter((value) => value !== tag))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            {tagSuggestions.length > 0 && (
              <div className="mt-3">
                <div className="text-[10px] uppercase tracking-[0.4em] font-medium text-muted-foreground mb-2">Suggested</div>
                <div className="flex flex-wrap gap-2">
                  {tagSuggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      className="rounded-[14px] border border-border/60 px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-all hover:bg-surface-2 hover:text-foreground hover:border-border/80"
                      onClick={() => {
                        addTags(suggestion);
                        setTagInput("");
                      }}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Metadata & Actions */}
        <div className="flex flex-col gap-6">
          {/* Preview Area (when file is uploaded) */}
          {previews.length > 0 && (
            <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-white/40 p-5 shadow-sm backdrop-blur-sm animate-fade-in-up">
              <Label className="text-[13px] font-semibold text-muted-foreground">Preview</Label>
              <div className="relative overflow-hidden rounded-xl bg-surface-2">
                {previews[activePreviewIndex]?.file.type.startsWith("image/") ? (
                  <Image
                    src={previews[activePreviewIndex].url}
                    alt={previews[activePreviewIndex].file.name}
                    width={800}
                    height={600}
                    unoptimized
                    className="w-full h-[280px] object-cover"
                  />
                ) : previews[activePreviewIndex]?.file.type.startsWith("video/") ? (
                  <video
                    src={previews[activePreviewIndex].url}
                    controls
                    playsInline
                    preload="metadata"
                    className="h-[280px] w-full object-contain bg-black"
                  />
                ) : (
                  <div className="flex h-[280px] w-full flex-col items-center justify-center gap-2">
                    <span className="text-sm font-semibold text-muted-foreground">
                      {previews[activePreviewIndex].file.name}
                    </span>
                    <span className="text-[10px] uppercase tracking-[0.4em] font-medium text-muted-foreground">
                      No preview
                    </span>
                  </div>
                )}
                {previews.length > 1 && (
                  <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5">
                    {previews.map((preview, index) => (
                      <span
                        key={`${preview.file.name}-${index}`}
                        className={cn(
                          "h-1.5 rounded-full transition-all duration-300",
                          index === activePreviewIndex 
                            ? "w-4 bg-white shadow-sm" 
                            : "w-1.5 bg-white/50"
                        )}
                      />
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between px-1">
                <span className="text-[13px] font-mono text-muted-foreground truncate max-w-[200px]">
                  {previews[activePreviewIndex].file.name}
                </span>
                <span className="text-[11px] text-muted-foreground/70">
                  {(previews[activePreviewIndex].file.size / (1024 * 1024)).toFixed(1)} MB
                </span>
              </div>
            </div>
          )}

          {/* Pillar Selection (Essential) */}
          <div className="flex flex-col gap-2 rounded-2xl border border-border/60 bg-white/40 p-5 shadow-sm backdrop-blur-sm">
            <Label htmlFor="pillar-select" className="text-[13px] font-semibold text-muted-foreground">Pillar</Label>
            <Select
              value={pillarSelection}
              onValueChange={(value) => setPillarSelection(value)}
            >
              <SelectTrigger id="pillar-select" className="bg-surface-1 border-border/60 rounded-[14px] h-12 text-[15px] focus:ring-0 focus:border-primary focus:shadow-[0_0_0_3px_var(--accent-subtle)] transition-all">
                <SelectValue placeholder="Select pillar" />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-border/60 shadow-lg">
                <SelectGroup>
                  <SelectItem value={NO_VALUE} className="text-[14px]">None</SelectItem>
                  {PILLAR_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} className="text-[14px]">
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground mt-1">Primary content category</p>
          </div>

          {/* Advanced Settings (Collapsible) */}
          <div className="flex flex-col rounded-2xl border border-border/60 bg-white/40 shadow-sm backdrop-blur-sm overflow-hidden">
            <button
              type="button"
              onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
              className="flex w-full items-center justify-between p-5 text-left transition-colors hover:bg-surface-1/50"
            >
              <div>
                <Label className="text-[13px] font-semibold text-muted-foreground cursor-pointer">Advanced settings</Label>
                <div className="text-[11px] text-muted-foreground mt-1">Model, type, domain, folder</div>
              </div>
              <svg 
                xmlns="http://www.w3.org/2000/svg" 
                width="18" 
                height="18" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="2" 
                strokeLinecap="round" 
                strokeLinejoin="round"
                className={cn("text-muted-foreground/70 transition-transform duration-300", isAdvancedOpen && "rotate-90")}
              >
                <path d="m9 18 6-6-6-6"/>
              </svg>
            </button>
            
            <div 
              className={cn(
                "grid transition-all duration-400 ease-in-out",
                isAdvancedOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
              )}
            >
              <div className="overflow-hidden">
                <div className="h-px w-full bg-linear-to-r from-transparent via-border/60 to-transparent my-1"></div>
                <div className="flex flex-col gap-5 p-5">
                  {/* Model Name */}
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="model-name-select" className="text-[13px] font-semibold text-muted-foreground">Model Name</Label>
                    <Select
                      value={modelNameSelection}
                      onValueChange={(value) => setModelNameSelection(value)}
                    >
                      <SelectTrigger id="model-name-select" className="bg-surface-1 border-border/60 rounded-[14px] h-11 text-[14px] focus:ring-0 focus:border-primary focus:shadow-[0_0_0_3px_var(--accent-subtle)] transition-all">
                        <SelectValue placeholder="Select model" />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl border-border/60 shadow-lg">
                        <SelectGroup>
                          <SelectItem value={NO_VALUE} className="text-[14px]">None</SelectItem>
                          {MODEL_NAME_OPTIONS.map((model) => (
                            <SelectItem key={model} value={model} className="text-[14px]">
                              {model}
                            </SelectItem>
                          ))}
                          <SelectItem value="__custom" className="text-[14px]">Other (type below)</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    {modelNameSelection === "__custom" && (
                      <Input
                        placeholder="Enter custom model name"
                        value={modelNameCustom}
                        onChange={(event) => setModelNameCustom(event.target.value)}
                        className="mt-1 bg-surface-1 border-border/60 rounded-[14px] h-11 text-[14px] focus-visible:ring-0 focus-visible:border-primary focus-visible:shadow-[0_0_0_3px_var(--accent-subtle)] transition-all"
                      />
                    )}
                  </div>

                  {/* Generation Type */}
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="generation-type-select" className="text-[13px] font-semibold text-muted-foreground">Generation Type</Label>
                    <Select
                      value={generationType}
                      onValueChange={(value) => setGenerationType(value)}
                    >
                      <SelectTrigger id="generation-type-select" className="bg-surface-1 border-border/60 rounded-[14px] h-11 text-[14px] focus:ring-0 focus:border-primary focus:shadow-[0_0_0_3px_var(--accent-subtle)] transition-all">
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl border-border/60 shadow-lg">
                        <SelectGroup>
                          <SelectItem value={NO_VALUE} className="text-[14px]">None</SelectItem>
                          {GENERATION_TYPE_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value} className="text-[14px]">
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Prompt Type */}
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="prompt-type-select" className="text-[13px] font-semibold text-muted-foreground">Prompt Type</Label>
                    <Select
                      value={promptType}
                      onValueChange={(value) => setPromptType(value)}
                    >
                      <SelectTrigger id="prompt-type-select" className="bg-surface-1 border-border/60 rounded-[14px] h-11 text-[14px] focus:ring-0 focus:border-primary focus:shadow-[0_0_0_3px_var(--accent-subtle)] transition-all">
                        <SelectValue placeholder="Select prompt type" />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl border-border/60 shadow-lg">
                        <SelectGroup>
                          <SelectItem value={NO_VALUE} className="text-[14px]">None</SelectItem>
                          {PROMPT_TYPE_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value} className="text-[14px]">
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Workflow Type */}
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="workflow-type-select" className="text-[13px] font-semibold text-muted-foreground">Workflow Type</Label>
                    <Select
                      value={workflowType}
                      onValueChange={(value) => setWorkflowType(value)}
                    >
                      <SelectTrigger id="workflow-type-select" className="bg-surface-1 border-border/60 rounded-[14px] h-11 text-[14px] focus:ring-0 focus:border-primary focus:shadow-[0_0_0_3px_var(--accent-subtle)] transition-all">
                        <SelectValue placeholder="Select workflow type" />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl border-border/60 shadow-lg">
                        <SelectGroup>
                          <SelectItem value={NO_VALUE} className="text-[14px]">None</SelectItem>
                          {WORKFLOW_TYPE_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value} className="text-[14px]">
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Asset Role */}
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="asset-role-select" className="text-[13px] font-semibold text-muted-foreground">Asset Role</Label>
                    <Select
                      value={assetRole}
                      onValueChange={(value) => setAssetRole(value)}
                    >
                      <SelectTrigger id="asset-role-select" className="bg-surface-1 border-border/60 rounded-[14px] h-11 text-[14px] focus:ring-0 focus:border-primary focus:shadow-[0_0_0_3px_var(--accent-subtle)] transition-all">
                        <SelectValue placeholder="Select asset role" />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl border-border/60 shadow-lg">
                        <SelectGroup>
                          <SelectItem value={NO_VALUE} className="text-[14px]">None</SelectItem>
                          {ASSET_ROLE_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value} className="text-[14px]">
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Domain */}
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="domain-input" className="text-[13px] font-semibold text-muted-foreground">Domain</Label>
                    <Input
                      id="domain-input"
                      placeholder="e.g. fashion, architecture, gaming"
                      value={domainInput}
                      onChange={(event) => setDomainInput(event.target.value)}
                      className="bg-surface-1 border-border/60 rounded-[14px] h-11 text-[14px] focus-visible:ring-0 focus-visible:border-primary focus-visible:shadow-[0_0_0_3px_var(--accent-subtle)] transition-all"
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">Optional freeform domain tag</p>
                  </div>

                  {/* Folder */}
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="folder-select" className="text-[13px] font-semibold text-muted-foreground">Folder</Label>
                      <span className="text-[10px] uppercase tracking-[0.2em] font-medium text-muted-foreground/60">Optional</span>
                    </div>
                    <Select
                      value={folderSelection}
                      onValueChange={(value) => setFolderSelection(value)}
                    >
                      <SelectTrigger id="folder-select" className="bg-surface-1 border-border/60 rounded-[14px] h-11 text-[14px] focus:ring-0 focus:border-primary focus:shadow-[0_0_0_3px_var(--accent-subtle)] transition-all">
                        <SelectValue placeholder="No folder (default)" />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl border-border/60 shadow-lg">
                        <SelectGroup>
                          <SelectItem value={NO_FOLDER_VALUE} className="text-[14px]">No folder (default)</SelectItem>
                          {folders.map((folder) => (
                            <SelectItem key={folder._id} value={folder._id} className="text-[14px]">
                              {folder.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground mt-1">Organize prompts into collections</p>
                    {canCreateFolders && (
                      <div className="mt-1 flex items-center gap-2">
                        <Input
                          value={folderDraftName}
                          onChange={(event) => setFolderDraftName(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter") return;
                            event.preventDefault();
                            void handleCreateFolder();
                          }}
                          placeholder="Create new folder"
                          className="h-10 flex-1 rounded-[12px] border-border/60 bg-surface-1 text-[13px] focus-visible:ring-0 focus-visible:border-primary focus-visible:shadow-[0_0_0_3px_var(--accent-subtle)]"
                        />
                        <Button
                          type="button"
                          onClick={() => void handleCreateFolder()}
                          disabled={creatingFolder || folderDraftName.trim().length === 0}
                          className="h-10 rounded-[12px] px-3 text-[11px] font-mono uppercase tracking-wider"
                        >
                          {creatingFolder ? "Saving..." : "Create"}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="h-px w-full bg-linear-to-r from-transparent via-border/60 to-transparent my-2"></div>

          {/* Action Buttons */}
          <div className="flex flex-col gap-3">
            <Button
              type="submit"
              disabled={!canSubmit || isUploading}
              className="w-full bg-primary text-white rounded-[16px] h-12 text-[15px] font-semibold shadow-sm transition-all duration-150 hover:bg-primary/90 hover:shadow-md hover:-translate-y-px active:translate-y-0"
            >
              {isUploading ? "Uploading..." : "Save to gallery"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={isUploading}
              onClick={clearForm}
              className="w-full border border-border/60 bg-transparent rounded-[14px] h-[44px] text-[13px] font-medium text-muted-foreground transition-all duration-150 hover:bg-surface-2 hover:text-foreground hover:border-border/80"
            >
              Clear form
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
