"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Globe } from "lucide-react";
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
import { useMutation } from "convex/react";
import { useUploadFile } from "@convex-dev/r2/react";
import { requestJson } from "@/lib/app-api";
import { buildIngestKey, parseTagNames } from "@/lib/ingest";
import { buildUploadFormData } from "@/lib/upload-form";
import { uploadVideoToR2 } from "@/lib/video-ingest";
import {
  LARGE_IMAGE_BYTES,
  appendImageUploadFields,
  uploadImageToR2,
} from "@/lib/image-ingest";
import { cn } from "@/lib/utils";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export type FolderOption = {
  _id: string;
  name: string;
  description?: string | null;
};

export type PillarOption = {
  value: string;
  label: string;
  color?: string;
  description?: string;
};

type StatusMessage = {
  type: "success" | "error" | "info";
  message: string;
} | null;

export type UploadPanelProps = {
  availableTags?: string[];
  folders?: FolderOption[];
  /** Projects (folders with kind:"project") the asset can be filed into. */
  projects?: FolderOption[];
  ownerUserId?: string;
  /** Whether this user may promote saves straight into the public gallery. */
  canPromoteToPublic?: boolean;
  onDataChanged?: () => void;
  className?: string;
  /** Files to seed the form with (e.g. dropped onto the gallery). */
  initialFiles?: File[];
};

type FilePreview = {
  file: File;
  url: string;
};

const NO_FOLDER_VALUE = "__none";
const NO_VALUE = "__none";

const MODEL_NAME_OPTIONS = [
  // Image models
  "Midjourney",
  "Nano Banana Pro",
  "Nano Banana 2",
  "FLUX",
  "Recraft V4",
  "Ideogram",
  "DALL-E 3",
  "Stable Diffusion",
  "Firefly",
  "Imagen",
  // Video models
  "Seedance 2.0",
  "Seedance",
  "Kling",
  "Runway",
  "Sora",
  "Veo",
  "Hailuo",
  "Luma",
  "Pika",
] as const;

const GENERATION_TYPE_OPTIONS = [
  { value: "image_gen", label: "Image" },
  { value: "video_gen", label: "Video" },
  { value: "ui_design", label: "UI Design" },
  { value: "workflow", label: "Workflow" },
  { value: "other", label: "Other" },
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
  projects = [],
  ownerUserId,
  canPromoteToPublic = false,
  onDataChanged,
  className,
  initialFiles,
}: UploadPanelProps) {
  const [promptText, setPromptText] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [folderSelection, setFolderSelection] = useState(NO_FOLDER_VALUE);
  const [projectSelection, setProjectSelection] = useState(NO_VALUE);
  const [promoteToPublic, setPromoteToPublic] = useState(false);
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

  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
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

  // Seed dropped files into the form. The dashboard passes a fresh array
  // reference each time a new drop happens, so we de-dupe on identity.
  const seededFilesRef = useRef<File[] | null>(null);
  useEffect(() => {
    if (!initialFiles || initialFiles.length === 0) return;
    if (seededFilesRef.current === initialFiles) return;
    seededFilesRef.current = initialFiles;
    setSelectedFiles((previous) => [...previous, ...initialFiles]);
  }, [initialFiles]);

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
    setProjectSelection(NO_VALUE);
    setPromoteToPublic(false);
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
      setStatus({ type: "error", message: "Sign in to create collections." });
      return;
    }
    if (!name) {
      setStatus({ type: "error", message: "Collection name is required." });
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
        message: result.created ? "Collection created." : "Using existing collection.",
      });
      onDataChanged?.();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create collection.";
      setStatus({ type: "error", message });
    } finally {
      setCreatingFolder(false);
    }
  };

  const uploadVideo = useUploadFile(api.r2);
  const addAssetsToProject = useMutation(api.projects.addAssetsToProject);

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
      const resolvedProjectId =
        projectSelection === NO_VALUE || !projectSelection
          ? undefined
          : projectSelection;
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
      // Convex Node action args cap at 5 MiB, and small images travel as
      // base64 INSIDE the action call — large ones must go browser → R2
      // like videos do, or ingest rejects them.
      const isLargeImageUpload = Boolean(
        candidateFile &&
          candidateFile.type.startsWith("image/") &&
          candidateFile.size > LARGE_IMAGE_BYTES,
      );

      // Videos (and large images) go to Cloudflare R2 directly from the
      // browser; small images keep the inline ingest path.
      const formData = buildUploadFormData({
        promptText,
        allowPromptOnly: isPromptOnlyDraft && saveAsTextOnlyPrompt,
        url: urlInput,
        folderId: resolvedFolderId,
        tags,
        file: isVideoUpload || isLargeImageUpload ? null : candidateFile,
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
      } else if (isLargeImageUpload && candidateFile) {
        setStatus({ type: "info", message: "Uploading image to R2..." });
        const upload = await uploadImageToR2(candidateFile, {
          upload: uploadVideo,
        });
        appendImageUploadFields(formData, upload);
        // file was omitted from the form, so re-key on the file name to keep
        // repeat submissions idempotent.
        const key = buildIngestKey({
          promptText: promptText || undefined,
          url: urlInput?.trim() || undefined,
          fileName: candidateFile.name,
        });
        if (key) formData.set("ingestKey", key);
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

      // Ingest is synchronous and returns the freshly-created asset id — chain
      // project filing and public promotion off it. Both are best-effort: the
      // asset is already saved, so a follow-up failure downgrades to a warning
      // rather than losing the save.
      const savedAssetId =
        body && body.result && typeof body.result.assetId === "string"
          ? (body.result.assetId as string)
          : undefined;
      const followupNotes: string[] = [];

      if (savedAssetId && resolvedProjectId && ownerUserId?.trim()) {
        try {
          await addAssetsToProject({
            ownerUserId,
            projectId: resolvedProjectId as Id<"folders">,
            assetIds: [savedAssetId as Id<"assets">],
          });
        } catch {
          followupNotes.push("couldn’t file it into the project");
        }
      }

      if (savedAssetId && promoteToPublic && canPromoteToPublic) {
        try {
          const curationRes = await fetch(
            `/api/admin/assets/${savedAssetId}/curation`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ isPublic: true }),
            },
          );
          if (!curationRes.ok) {
            throw new Error("curation rejected");
          }
        } catch {
          followupNotes.push("couldn’t promote it to the public gallery");
        }
      }

      clearForm();
      if (followupNotes.length > 0) {
        setStatus({
          type: "info",
          message: `Saved to the vault, but ${followupNotes.join(" and ")}.`,
        });
      } else {
        setStatus({
          type: "success",
          message: "Ingest queued. The gallery will update shortly.",
        });
      }
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

  const statusStyles: Record<
    NonNullable<StatusMessage>["type"],
    { bg: string; border: string; color: string }
  > = {
    success: { bg: "var(--lm-success-dim)", border: "rgba(22,163,74,0.45)", color: "#5fcf86" },
    error: { bg: "rgba(220,38,38,0.12)", border: "rgba(220,38,38,0.45)", color: "#f08a82" },
    info: { bg: "var(--lm-accent-dim)", border: "var(--lm-border-strong)", color: "var(--lm-text-secondary)" },
  };

  const descriptionId = "upload-dropzone-description";

  // ── Boxless brand primitives — dark editorial, mono micro-labels, hairline
  // dividers, underline fields, coral focus. No card panels or filled chrome.
  const mono = "[font-family:var(--lm-font)]";
  const labelCls = `${mono} text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--lm-text-tertiary)]`;
  const underlineField =
    "h-11 rounded-none border-0 border-b border-[var(--lm-border)] bg-transparent px-0 text-[14px] text-[var(--lm-text-primary)] placeholder:text-[var(--lm-text-ghost)] shadow-none focus-visible:border-[var(--lm-coral)] focus-visible:ring-0 transition-colors";
  const selectTriggerCls =
    "h-11 w-full rounded-none border-0 border-b border-[var(--lm-border)] bg-transparent px-0 text-[14px] text-[var(--lm-text-primary)] shadow-none focus:border-[var(--lm-coral)] focus:ring-0 transition-colors data-placeholder:text-[var(--lm-text-ghost)]";
  const selectContentCls =
    "rounded-[10px] border border-[var(--lm-border-strong)] bg-[var(--lm-surface-1)] text-[var(--lm-text-primary)] shadow-[0_18px_46px_rgba(0,0,0,0.55)]";
  const selectItemCls =
    "text-[14px] text-[var(--lm-text-secondary)] focus:bg-[var(--lm-surface-2)] focus:text-[var(--lm-text-primary)]";

  const FieldLabel = ({
    htmlFor,
    children,
    trailing,
  }: {
    htmlFor?: string;
    children: React.ReactNode;
    trailing?: React.ReactNode;
  }) => (
    <div className="flex items-center justify-between">
      <Label htmlFor={htmlFor} className={labelCls}>
        {children}
      </Label>
      {trailing}
    </div>
  );

  // Section heading: mono label + a hairline rule that fills the row. This is
  // the boxless replacement for the old bordered card headers.
  const SectionRule = ({
    children,
    trailing,
  }: {
    children: React.ReactNode;
    trailing?: React.ReactNode;
  }) => (
    <div className="flex items-center gap-3">
      <span className={labelCls}>{children}</span>
      <span className="h-px flex-1 bg-[var(--lm-border)]" aria-hidden />
      {trailing}
    </div>
  );

  return (
    <div className={cn("flex h-full min-h-0 w-full flex-col", className)}>
      {status && (
        <div
          role="status"
          aria-live={status.type === "error" ? "assertive" : "polite"}
          className={cn(mono, "mx-8 mt-4 rounded-[10px] px-4 py-2.5 text-[12px] font-semibold tracking-wide")}
          style={{
            backgroundColor: statusStyles[status.type].bg,
            border: `1px solid ${statusStyles[status.type].border}`,
            color: statusStyles[status.type].color,
          }}
        >
          {status.message}
        </div>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        {/* Scrollable form body */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-8 py-7">
          <div className="grid grid-cols-1 gap-x-12 gap-y-9 lg:grid-cols-[1.55fr_1fr] lg:items-start">
            {/* ── Left: core content ── */}
            <div className="flex flex-col gap-9">
              {/* Prompt */}
              <section className="flex flex-col gap-3">
                <SectionRule
                  trailing={
                    <span className={cn(mono, "text-[10px] tabular-nums text-[var(--lm-text-ghost)]")}>
                      {promptText.length} / 2000
                    </span>
                  }
                >
                  Prompt
                </SectionRule>
                <div className="relative min-h-[260px] flex-1">
                  {promptHighlight && (
                    <pre
                      ref={highlightRef}
                      aria-hidden
                      className="pointer-events-none absolute inset-0 overflow-auto pb-4 pt-1 font-display text-[19px] italic leading-relaxed text-[var(--lm-text-primary)]"
                      dangerouslySetInnerHTML={{ __html: promptHighlight }}
                    />
                  )}
                  <Textarea
                    id="prompt-text"
                    placeholder="A quiet morning in a Parisian café, golden light streaming through tall windows, the scent of fresh croissants…"
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
                      "min-h-[260px] h-full w-full resize-y rounded-none border-0 bg-transparent px-0 pb-4 pt-1 font-display text-[19px] italic leading-relaxed shadow-none placeholder:text-[var(--lm-text-ghost)] focus-visible:ring-0",
                      promptHighlight
                        ? "text-transparent caret-[var(--lm-coral)] selection:bg-[var(--lm-accent-dim)] selection:text-transparent"
                        : "text-[var(--lm-text-primary)]",
                    )}
                  />
                </div>

                {/* Text-only toggle — inline, boxless */}
                <label
                  htmlFor="save-as-text-only-prompt"
                  className="flex cursor-pointer items-start gap-3 pt-1"
                >
                  <Checkbox
                    id="save-as-text-only-prompt"
                    checked={saveAsTextOnlyPrompt}
                    onCheckedChange={(checked) => setSaveAsTextOnlyPrompt(checked === true)}
                    className="mt-0.5 border-[var(--lm-border-strong)] data-[state=checked]:border-[var(--lm-coral)] data-[state=checked]:bg-[var(--lm-coral)] data-[state=checked]:text-[#1a1008]"
                  />
                  <div className="space-y-0.5">
                    <span className={cn(labelCls, "block")}>Save as text-only prompt</span>
                    <p className="text-[11px] leading-snug text-[var(--lm-text-tertiary)]">
                      Required to ingest prompt text without any file or URL attached.
                    </p>
                    {isPromptOnlyDraft && !saveAsTextOnlyPrompt ? (
                      <p className="text-[11px] font-medium text-[var(--lm-coral)]">
                        No media attached — turn this on to save it intentionally as text-only.
                      </p>
                    ) : null}
                  </div>
                </label>
              </section>

              {/* Media */}
              <section className="flex flex-col gap-3">
                <SectionRule>Media</SectionRule>
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
                    "group relative flex min-h-[132px] flex-col items-center justify-center gap-2.5 rounded-[12px] border border-dashed border-[var(--lm-border)] bg-transparent p-6 text-center transition-colors duration-200 hover:border-[var(--lm-text-ghost)]",
                    isDragActive &&
                      "border-[var(--lm-coral)] bg-[var(--lm-accent-dim)]",
                  )}
                >
                  {isUploading && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-[12px] bg-[var(--lm-surface-0)]/80 backdrop-blur-sm">
                      <span className={cn(mono, "animate-pulse text-[10px] font-bold uppercase tracking-[0.3em] text-[var(--lm-coral)]")}>
                        Uploading…
                      </span>
                    </div>
                  )}
                  <span className="text-[var(--lm-coral)] transition-transform duration-200 group-hover:scale-105">
                    <svg className="h-7 w-7" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
                  </span>
                  <p className={cn(mono, "text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--lm-text-primary)]")}>
                    Drop media here
                  </p>
                  <p className="text-[12px] text-[var(--lm-text-tertiary)]">or click to browse</p>

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
                <p id={descriptionId} className="text-[11px] text-[var(--lm-text-ghost)]">
                  JPEG, PNG, MP4, MOV — up to 50MB per file. Multi-file sends the first for now.
                </p>
              </section>

              {/* URL + Tags */}
              <section className="flex flex-col gap-6">
                <div className="flex flex-col gap-2.5">
                  <FieldLabel htmlFor="prompt-url">Source URL</FieldLabel>
                  <Input
                    id="prompt-url"
                    placeholder="https://example.com/asset"
                    value={urlInput}
                    onChange={(event) => setUrlInput(event.target.value)}
                    className={underlineField}
                  />
                  <p className="text-[11px] text-[var(--lm-text-ghost)]">Fetch media from an external URL you trust.</p>
                </div>

                <div className="flex flex-col gap-2.5">
                  <FieldLabel htmlFor="tag-input">Tags</FieldLabel>
                  <Input
                    id="tag-input"
                    placeholder="Type a tag, press Enter or comma to add"
                    value={tagInput}
                    onChange={(event) => setTagInput(event.target.value)}
                    onKeyDown={handleTagKeyDown}
                    className={underlineField}
                  />

                  {tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2">
                      {tags.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          aria-label={`Remove ${tag}`}
                          onClick={() => setTags((previous) => previous.filter((value) => value !== tag))}
                          className={cn(
                            mono,
                            "group inline-flex items-center gap-1.5 text-[12px] font-semibold tracking-wide text-[var(--lm-coral)] transition-opacity hover:opacity-70",
                          )}
                        >
                          <span className="text-[var(--lm-text-ghost)]">#</span>
                          {tag}
                          <span className="text-[var(--lm-text-ghost)] transition-colors group-hover:text-[var(--lm-coral)]">×</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {tagSuggestions.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                      <span className={cn(labelCls, "text-[9px]")}>Suggested</span>
                      {tagSuggestions.map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          className={cn(
                            mono,
                            "text-[12px] font-medium text-[var(--lm-text-tertiary)] underline-offset-4 transition-colors hover:text-[var(--lm-text-primary)] hover:underline",
                          )}
                          onClick={() => {
                            addTags(suggestion);
                            setTagInput("");
                          }}
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </div>

            {/* ── Right: preview + destination + details ── */}
            <div className="flex flex-col gap-9">
              {/* Preview */}
              {previews.length > 0 && (
                <section className="flex flex-col gap-3 animate-fade-in-up">
                  <SectionRule>Preview</SectionRule>
                  <div className="relative overflow-hidden rounded-[10px] bg-[var(--lm-surface-1)]">
                    {previews[activePreviewIndex]?.file.type.startsWith("image/") ? (
                      <Image
                        src={previews[activePreviewIndex].url}
                        alt={previews[activePreviewIndex].file.name}
                        width={800}
                        height={600}
                        unoptimized
                        className="h-[240px] w-full object-cover"
                      />
                    ) : previews[activePreviewIndex]?.file.type.startsWith("video/") ? (
                      <video
                        src={previews[activePreviewIndex].url}
                        controls
                        playsInline
                        preload="metadata"
                        className="h-[240px] w-full bg-black object-contain"
                      />
                    ) : (
                      <div className="flex h-[240px] w-full flex-col items-center justify-center gap-2">
                        <span className="text-sm font-semibold text-[var(--lm-text-secondary)]">
                          {previews[activePreviewIndex].file.name}
                        </span>
                        <span className={cn(labelCls, "text-[9px]")}>No preview</span>
                      </div>
                    )}
                    {previews.length > 1 && (
                      <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
                        {previews.map((preview, index) => (
                          <span
                            key={`${preview.file.name}-${index}`}
                            className={cn(
                              "h-1.5 rounded-full transition-all duration-300",
                              index === activePreviewIndex ? "w-4 bg-[var(--lm-coral)]" : "w-1.5 bg-white/40",
                            )}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className={cn(mono, "max-w-[200px] truncate text-[11px] text-[var(--lm-text-tertiary)]")}>
                      {previews[activePreviewIndex].file.name}
                    </span>
                    <span className={cn(mono, "text-[10px] text-[var(--lm-text-ghost)]")}>
                      {(previews[activePreviewIndex].file.size / (1024 * 1024)).toFixed(1)} MB
                    </span>
                  </div>
                </section>
              )}

              {/* Destination — collection · project · visibility */}
              <section className="flex flex-col gap-6">
                <SectionRule>Destination</SectionRule>

                {/* Collection */}
                <div className="flex flex-col gap-2.5">
                  <FieldLabel
                    htmlFor="folder-select"
                    trailing={<span className={cn(labelCls, "text-[9px] text-[var(--lm-text-ghost)]")}>Optional</span>}
                  >
                    Collection
                  </FieldLabel>
                  <Select value={folderSelection} onValueChange={(value) => setFolderSelection(value)}>
                    <SelectTrigger id="folder-select" className={selectTriggerCls}>
                      <SelectValue placeholder="No collection (default)" />
                    </SelectTrigger>
                    <SelectContent className={selectContentCls}>
                      <SelectGroup>
                        <SelectItem value={NO_FOLDER_VALUE} className={selectItemCls}>No collection (default)</SelectItem>
                        {folders.map((folder) => (
                          <SelectItem key={folder._id} value={folder._id} className={selectItemCls}>
                            {folder.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
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
                        placeholder="Create new collection"
                        className={cn(underlineField, "h-10 flex-1")}
                      />
                      <button
                        type="button"
                        onClick={() => void handleCreateFolder()}
                        disabled={creatingFolder || folderDraftName.trim().length === 0}
                        className={cn(
                          mono,
                          "h-10 shrink-0 px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--lm-text-secondary)] underline-offset-4 transition-colors hover:text-[var(--lm-coral)] hover:underline disabled:opacity-40 disabled:no-underline",
                        )}
                      >
                        {creatingFolder ? "Saving…" : "Create"}
                      </button>
                    </div>
                  )}
                </div>

                {/* Project */}
                <div className="flex flex-col gap-2.5">
                  <FieldLabel
                    htmlFor="project-select"
                    trailing={<span className={cn(labelCls, "text-[9px] text-[var(--lm-text-ghost)]")}>Optional</span>}
                  >
                    Project
                  </FieldLabel>
                  <Select
                    value={projectSelection}
                    onValueChange={(value) => setProjectSelection(value)}
                    disabled={projects.length === 0}
                  >
                    <SelectTrigger id="project-select" className={cn(selectTriggerCls, projects.length === 0 && "opacity-50")}>
                      <SelectValue placeholder={projects.length === 0 ? "No projects yet" : "No project"} />
                    </SelectTrigger>
                    <SelectContent className={selectContentCls}>
                      <SelectGroup>
                        <SelectItem value={NO_VALUE} className={selectItemCls}>No project</SelectItem>
                        {projects.map((project) => (
                          <SelectItem key={project._id} value={project._id} className={selectItemCls}>
                            {project.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-[var(--lm-text-ghost)]">
                    Files the save into the project’s inbox for review.
                  </p>
                </div>

                {/* Promote to public */}
                {canPromoteToPublic && (
                  <label
                    htmlFor="promote-to-public"
                    className="flex cursor-pointer items-start gap-3"
                  >
                    <Checkbox
                      id="promote-to-public"
                      checked={promoteToPublic}
                      onCheckedChange={(checked) => setPromoteToPublic(checked === true)}
                      className="mt-0.5 border-[var(--lm-border-strong)] data-[state=checked]:border-[var(--lm-coral)] data-[state=checked]:bg-[var(--lm-coral)] data-[state=checked]:text-[#1a1008]"
                    />
                    <div className="space-y-0.5">
                      <span className={cn(labelCls, "flex items-center gap-1.5")}>
                        <Globe className="h-3 w-3 text-[var(--lm-coral)]" aria-hidden />
                        Promote to public gallery
                      </span>
                      <p className="text-[11px] leading-snug text-[var(--lm-text-tertiary)]">
                        Publishes this save to your public gallery the moment it lands.
                      </p>
                    </div>
                  </label>
                )}
              </section>

              {/* Details — taxonomy, collapsed by default */}
              <section className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => setIsDetailsOpen(!isDetailsOpen)}
                  className="flex items-center gap-3 text-left"
                >
                  <span className={labelCls}>Details</span>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={cn("shrink-0 text-[var(--lm-text-tertiary)] transition-transform duration-300", isDetailsOpen && "rotate-90")}
                  >
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                  <span className="h-px flex-1 bg-[var(--lm-border)]" aria-hidden />
                  {!isDetailsOpen && (
                    <span className="text-[10px] text-[var(--lm-text-ghost)]">Model · type · domain</span>
                  )}
                </button>

                <div
                  className={cn(
                    "grid transition-all duration-300 ease-in-out",
                    isDetailsOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                  )}
                >
                  <div className="overflow-hidden">
                    <div className="flex flex-col gap-6 pt-3">
                      {/* Model */}
                      <div className="flex flex-col gap-2.5">
                        <FieldLabel htmlFor="model-name-select">Model name</FieldLabel>
                        <Select value={modelNameSelection} onValueChange={(value) => setModelNameSelection(value)}>
                          <SelectTrigger id="model-name-select" className={selectTriggerCls}>
                            <SelectValue placeholder="Select model" />
                          </SelectTrigger>
                          <SelectContent className={selectContentCls}>
                            <SelectGroup>
                              <SelectItem value={NO_VALUE} className={selectItemCls}>None</SelectItem>
                              {MODEL_NAME_OPTIONS.map((model) => (
                                <SelectItem key={model} value={model} className={selectItemCls}>
                                  {model}
                                </SelectItem>
                              ))}
                              <SelectItem value="__custom" className={selectItemCls}>Other (type below)</SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        {modelNameSelection === "__custom" && (
                          <Input
                            placeholder="Enter custom model name"
                            value={modelNameCustom}
                            onChange={(event) => setModelNameCustom(event.target.value)}
                            className={cn(underlineField, "mt-1")}
                          />
                        )}
                      </div>

                      {/* Generation Type */}
                      <div className="flex flex-col gap-2.5">
                        <FieldLabel htmlFor="generation-type-select">Generation type</FieldLabel>
                        <Select value={generationType} onValueChange={(value) => setGenerationType(value)}>
                          <SelectTrigger id="generation-type-select" className={selectTriggerCls}>
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                          <SelectContent className={selectContentCls}>
                            <SelectGroup>
                              <SelectItem value={NO_VALUE} className={selectItemCls}>None</SelectItem>
                              {GENERATION_TYPE_OPTIONS.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value} className={selectItemCls}>
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Prompt Type */}
                      <div className="flex flex-col gap-2.5">
                        <FieldLabel htmlFor="prompt-type-select">Prompt type</FieldLabel>
                        <Select value={promptType} onValueChange={(value) => setPromptType(value)}>
                          <SelectTrigger id="prompt-type-select" className={selectTriggerCls}>
                            <SelectValue placeholder="Select prompt type" />
                          </SelectTrigger>
                          <SelectContent className={selectContentCls}>
                            <SelectGroup>
                              <SelectItem value={NO_VALUE} className={selectItemCls}>None</SelectItem>
                              {PROMPT_TYPE_OPTIONS.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value} className={selectItemCls}>
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Workflow Type */}
                      <div className="flex flex-col gap-2.5">
                        <FieldLabel htmlFor="workflow-type-select">Workflow type</FieldLabel>
                        <Select value={workflowType} onValueChange={(value) => setWorkflowType(value)}>
                          <SelectTrigger id="workflow-type-select" className={selectTriggerCls}>
                            <SelectValue placeholder="Select workflow type" />
                          </SelectTrigger>
                          <SelectContent className={selectContentCls}>
                            <SelectGroup>
                              <SelectItem value={NO_VALUE} className={selectItemCls}>None</SelectItem>
                              {WORKFLOW_TYPE_OPTIONS.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value} className={selectItemCls}>
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Asset Role */}
                      <div className="flex flex-col gap-2.5">
                        <FieldLabel htmlFor="asset-role-select">Asset role</FieldLabel>
                        <Select value={assetRole} onValueChange={(value) => setAssetRole(value)}>
                          <SelectTrigger id="asset-role-select" className={selectTriggerCls}>
                            <SelectValue placeholder="Select asset role" />
                          </SelectTrigger>
                          <SelectContent className={selectContentCls}>
                            <SelectGroup>
                              <SelectItem value={NO_VALUE} className={selectItemCls}>None</SelectItem>
                              {ASSET_ROLE_OPTIONS.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value} className={selectItemCls}>
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Domain */}
                      <div className="flex flex-col gap-2.5">
                        <FieldLabel htmlFor="domain-input">Domain</FieldLabel>
                        <Input
                          id="domain-input"
                          placeholder="e.g. fashion, architecture, gaming"
                          value={domainInput}
                          onChange={(event) => setDomainInput(event.target.value)}
                          className={underlineField}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>

        {/* Sticky action footer */}
        <div
          className="flex shrink-0 items-center justify-between gap-3 px-8 py-4"
          style={{ borderTop: "1px solid var(--lm-border)", backgroundColor: "var(--lm-surface-0)" }}
        >
          <button
            type="button"
            disabled={isUploading}
            onClick={clearForm}
            className={cn(
              mono,
              "h-11 px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--lm-text-tertiary)] underline-offset-4 transition-colors hover:text-[var(--lm-text-primary)] hover:underline disabled:opacity-40 disabled:no-underline",
            )}
          >
            Clear form
          </button>
          <button
            type="submit"
            disabled={!canSubmit || isUploading}
            className={cn(
              mono,
              "inline-flex h-11 items-center gap-2 rounded-[10px] px-6 text-[11px] font-bold uppercase tracking-[0.14em] text-[#1a1008] transition-all disabled:cursor-not-allowed disabled:opacity-40",
            )}
            style={{
              backgroundColor: "var(--lm-coral)",
              boxShadow: "3px 3px 0 rgba(0,0,0,0.5)",
            }}
            onMouseEnter={(e) => {
              if (canSubmit && !isUploading) e.currentTarget.style.backgroundColor = "var(--lm-accent-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "var(--lm-coral)";
            }}
          >
            {isUploading ? "Uploading…" : "Save to gallery"}
          </button>
        </div>
      </form>
    </div>
  );
}
