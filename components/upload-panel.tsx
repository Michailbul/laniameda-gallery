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
import { parseTagNames } from "@/lib/ingest";
import { buildUploadFormData } from "@/lib/upload-form";
import { cn } from "@/lib/utils";

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
  className?: string;
};

type FilePreview = {
  file: File;
  url: string;
};

const NO_FOLDER_VALUE = "__none";

export function UploadPanel({
  availableTags = [],
  folders = [],
  className,
}: UploadPanelProps) {
  const [promptText, setPromptText] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [folderSelection, setFolderSelection] = useState(NO_FOLDER_VALUE);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [status, setStatus] = useState<StatusMessage>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragCounterRef = useRef(0);
  const highlightRef = useRef<HTMLPreElement | null>(null);

  const canSubmit = Boolean(
    promptText.trim().length > 0 || urlInput.trim().length > 0 || selectedFiles.length > 0,
  );

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
    setFolderSelection(NO_FOLDER_VALUE);
    setIsDragActive(false);
    setStatus(null);
  };

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
      const formData = buildUploadFormData({
        promptText,
        url: urlInput,
        folderId: resolvedFolderId,
        tags,
        file: selectedFiles[0] ?? null,
      });

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

  const dropzoneClasses = cn(
    "relative flex min-h-[160px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border/60 bg-background/50 p-6 text-center transition",
    isDragActive ? "border-primary bg-primary/10" : "hover:border-border/80",
  );

  const statusClasses = {
    success: "text-success-foreground bg-success/10 border border-success/20",
    error: "text-destructive bg-destructive/10 border border-destructive/30",
    info: "text-muted-foreground bg-muted/20 border border-muted",
  };

  const descriptionId = "upload-dropzone-description";

  return (
    <div className={cn("relative mx-auto flex h-full w-full max-w-6xl flex-col min-h-0", className)}>
      {status && (
        <div
          role="status"
          aria-live={status.type === "error" ? "assertive" : "polite"}
          className={cn("mb-4 rounded-xl px-4 py-2 text-xs font-medium", statusClasses[status.type])}
        >
          {status.message}
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
        className="grid h-full min-h-0 gap-6 lg:grid-cols-[1.25fr_0.75fr] lg:items-stretch"
      >
          <div className="flex flex-col gap-2 lg:h-full min-h-0">
              <Label htmlFor="prompt-text">Prompt</Label>
              <div className="relative flex min-h-[420px] flex-1 flex-col min-h-0 overflow-hidden rounded-2xl border border-border/60 bg-background/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                {promptHighlight && (
                  <pre
                    ref={highlightRef}
                    aria-hidden
                    className="pointer-events-none absolute inset-0 overflow-auto px-4 py-3 text-sm font-mono leading-relaxed text-foreground/90"
                    dangerouslySetInnerHTML={{ __html: promptHighlight }}
                  />
                )}
                <Textarea
                  id="prompt-text"
                  placeholder="Describe the scene or instructions"
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
                    "min-h-[360px] flex-1 resize-none border-0 bg-transparent px-4 py-3 text-sm font-mono leading-relaxed focus-visible:ring-0",
                    promptHighlight
                      ? "text-transparent caret-foreground selection:bg-foreground/20 selection:text-transparent"
                      : "text-foreground"
                  )}
                />
              </div>
              <div className="text-xs text-muted-foreground">
                {promptText.length}/2000 characters
              </div>
          </div>
          <div className="flex flex-col gap-4 lg:h-full">
            <div className="flex flex-col gap-2">
              <Label>Media</Label>
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
                className={cn(dropzoneClasses, "min-h-[200px]")}
              >
                {isUploading && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-background/80">
                    <span className="animate-pulse text-xs uppercase tracking-[0.4em] text-muted-foreground">
                      Uploading...
                    </span>
                  </div>
                )}
                {previews.length > 0 ? (
                  <div className="relative flex w-full flex-1 items-center justify-center">
                    {previews[activePreviewIndex]?.file.type.startsWith("image/") ? (
                      <Image
                        src={previews[activePreviewIndex].url}
                        alt={previews[activePreviewIndex].file.name}
                        width={640}
                        height={320}
                        unoptimized
                        className="max-h-40 w-full rounded-2xl object-contain"
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-2">
                        <span className="text-xs font-semibold text-muted-foreground">
                          {previews[activePreviewIndex].file.name}
                        </span>
                        <span className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground">
                          No preview
                        </span>
                      </div>
                    )}
                    <div className="absolute bottom-3 flex gap-1">
                      {previews.map((preview, index) => (
                        <span
                          key={`${preview.file.name}-${index}`}
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            index === activePreviewIndex ? "bg-primary" : "bg-border/60",
                          )}
                        />
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-xs uppercase tracking-[0.4em] text-muted-foreground">
                      Drag &amp; drop
                    </p>
                    <p className="text-sm font-semibold text-foreground">Upload media</p>
                    <p id={descriptionId} className="text-xs text-muted-foreground">
                      Images + video supported. Multi-file sends the first file for now.
                    </p>
                  </>
                )}
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
              {selectedFiles.length > 1 && (
                <p className="text-[11px] text-muted-foreground">
                  We currently upload the first file in multi-file batches. Extra files stay queued for future syncs.
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="prompt-url">Prompt URL</Label>
              <Input
                id="prompt-url"
                placeholder="https://example.com/asset"
                value={urlInput}
                onChange={(event) => setUrlInput(event.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">Fetch media from URLs you trust.</p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="tag-input">Tags</Label>
              <Input
                id="tag-input"
                placeholder="Add tags (comma-separated)"
                value={tagInput}
                onChange={(event) => setTagInput(event.target.value)}
                onKeyDown={handleTagKeyDown}
              />
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="flex items-center gap-1 rounded-full border border-border/60 px-3 py-1 text-[11px]"
                  >
                    {tag}
                    <button
                      type="button"
                      aria-label={`Remove ${tag}`}
                      className="text-[10px] text-muted-foreground"
                      onClick={() => setTags((previous) => previous.filter((value) => value !== tag))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              {tagSuggestions.length > 0 && (
                <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                  {tagSuggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      className="rounded-full border border-border/60 px-2 py-1 text-[11px] transition hover:border-primary hover:text-primary"
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
            <div className="flex min-h-fit flex-col gap-2">
              <Label htmlFor="folder-select">Optional folder</Label>
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-muted-foreground">
                  Pick a folder to help future agents organize prompts.
                </p>
                <span className="text-[10px] text-muted-foreground">Optional</span>
              </div>
              <Select
                value={folderSelection}
                onValueChange={(value) => setFolderSelection(value)}
              >
                <SelectTrigger id="folder-select">
                  <SelectValue placeholder="Choose a folder" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value={NO_FOLDER_VALUE}>No folder (default)</SelectItem>
                    {folders.map((folder) => (
                      <SelectItem key={folder._id} value={folder._id}>
                        {folder.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {folders.length === 0 && (
                <p className="text-[10px] text-muted-foreground">No folders sync yet.</p>
              )}
            </div>
            <div className="mt-auto flex flex-wrap items-center justify-end gap-3 pt-2">
              <Button
                type="submit"
                disabled={!canSubmit || isUploading}
                size="lg"
                className="px-6 text-sm font-semibold"
              >
                Save to gallery
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={isUploading}
                onClick={clearForm}
                className="text-xs"
              >
                Clear form
              </Button>
            </div>
          </div>
      </form>
    </div>
  );
}
