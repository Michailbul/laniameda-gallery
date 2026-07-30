"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  FileArchive,
  Film,
  FolderUp,
  Globe,
  Star,
  X,
} from "lucide-react";
import { useMutation } from "convex/react";
import { useUploadFile } from "@convex-dev/r2/react";
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
import { requestJson } from "@/lib/app-api";
import { buildIngestKey, parseTagNames } from "@/lib/ingest";
import { buildUploadFormData } from "@/lib/upload-form";
import { uploadVideoToR2 } from "@/lib/video-ingest";
import {
  LARGE_IMAGE_BYTES,
  appendImageUploadFields,
  uploadImageToR2,
} from "@/lib/image-ingest";
import {
  MAX_BULK_FILES,
  type RawFile,
  type StagedFile,
  filesToRaw,
  formatBytes,
  readDroppedFiles,
  stageBulkFiles,
} from "@/lib/bulk-upload";
import { cn } from "@/lib/utils";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { FolderOption } from "@/components/upload-panel";
import {
  DestinationField,
  type DestinationGroup,
} from "@/components/gallery/destination-field";

/**
 * Bulk ingest — a whole folder (or a .zip of one) in one pass.
 *
 * The single-asset panel is media-first: one asset, its destinations, taxonomy.
 * This one is batch-first. Every destination and every piece of metadata is
 * shared by the whole drop, and the only per-asset decision is the one that
 * actually differs per asset: does this frame go to the public gallery as
 * featured work. That decision is made by clicking thumbnails in the mini
 * gallery, which is why the grid — not the form — owns the left column.
 */

export type BulkUploadPanelProps = {
  availableTags?: string[];
  folders?: FolderOption[];
  projects?: FolderOption[];
  ownerUserId?: string;
  canPromoteToPublic?: boolean;
  onDataChanged?: () => void;
  className?: string;
  initialFiles?: File[];
};

const NO_VALUE = "__none";

// Enough parallelism to keep the R2 pipe busy without stampeding the ingest
// action (each small image also travels as base64 through a Convex action).
const UPLOAD_CONCURRENCY = 3;

// /api/admin/assets/bulk-curation caps at 200 per request.
const CURATION_CHUNK = 100;

type ItemStatus = "idle" | "uploading" | "done" | "duplicate" | "error";

/** Finished either way — a duplicate was filed onto the existing asset. */
const isSettled = (status: ItemStatus | undefined) =>
  status === "done" || status === "duplicate";

type ItemState = {
  status: ItemStatus;
  assetId?: string;
  error?: string;
};

type StatusMessage = {
  type: "success" | "error" | "info";
  message: string;
} | null;

const MODEL_NAME_OPTIONS = [
  "Midjourney",
  "Nano Banana Pro",
  "Nano Banana 2",
  "FLUX",
  "Recraft V4",
  "Ideogram",
  "Seedance 2.0",
  "Kling",
  "Runway",
  "Sora",
  "Veo",
  "Higgsfield",
] as const;

const SECTION_OPTIONS = [
  { value: "stills", label: "Stills" },
  { value: "characters", label: "Characters" },
  { value: "locations", label: "Locations" },
  { value: "beats", label: "Beats — one beat per asset" },
] as const;

type SectionValue = (typeof SECTION_OPTIONS)[number]["value"];

const chunk = <T,>(items: T[], size: number) => {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
};

export function BulkUploadPanel({
  availableTags = [],
  folders = [],
  projects = [],
  ownerUserId,
  canPromoteToPublic = false,
  onDataChanged,
  className,
  initialFiles,
}: BulkUploadPanelProps) {
  const [items, setItems] = useState<StagedFile[]>([]);
  const [featuredIds, setFeaturedIds] = useState<Set<string>>(new Set());
  const [itemStates, setItemStates] = useState<Record<string, ItemState>>({});
  const [isStaging, setIsStaging] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [status, setStatus] = useState<StatusMessage>(null);

  const [folderIds, setFolderIds] = useState<string[]>([]);
  const [creatingFolder, setCreatingFolder] = useState(false);
  // Collections created from this panel, held until the folders query catches
  // up — see destinationGroups.
  const [createdFolders, setCreatedFolders] = useState<FolderOption[]>([]);
  const [projectSelection, setProjectSelection] = useState(NO_VALUE);
  const [sectionSelection, setSectionSelection] = useState<string>(NO_VALUE);
  const [publishAll, setPublishAll] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [sharedPrompt, setSharedPrompt] = useState("");
  const [modelNameSelection, setModelNameSelection] = useState(NO_VALUE);
  const [modelNameCustom, setModelNameCustom] = useState("");
  const [isMetaOpen, setIsMetaOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const dragCounterRef = useRef(0);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewUrlsRef = useRef(new Map<string, string>());
  // Lets stage() dedupe against the live batch without re-creating itself on
  // every add.
  const itemsRef = useRef<StagedFile[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  // Read at the END of a run, so featuring a thumbnail while the batch is
  // still uploading still counts.
  const featuredIdsRef = useRef(featuredIds);
  useEffect(() => {
    featuredIdsRef.current = featuredIds;
  }, [featuredIds]);

  const uploadToR2 = useUploadFile(api.r2);
  const addAssetsToProject = useMutation(api.projects.addAssetsToProject);
  const addAssetFolders = useMutation(api.assets.addAssetFolders);
  const ensureSectionPool = useMutation(api.projects.ensureSectionPool);
  const createFolderMutation = useMutation(api.folders.createFolder);
  const addCollectionToProject = useMutation(api.projects.addCollectionToProject);

  const canCreateFolders = Boolean(ownerUserId?.trim());
  // Featuring publishes, so without curation rights the star would be a lie.
  const canFeature = canPromoteToPublic;

  // Only plain collections are sane bulk destinations — projects have their own
  // picker below, and beats/episodes are reached through a project.
  //
  // A collection created here is selected the instant the API returns, which is
  // before the folders query round-trips, so the created folder is carried
  // locally to keep a row under the selection at all times.
  const destinationGroups = useMemo<DestinationGroup[]>(() => {
    const plain = folders.filter((folder) => !folder.kind);
    const known = new Set(plain.map((folder) => folder._id));
    const options = [
      ...plain,
      ...createdFolders.filter((folder) => !known.has(folder._id)),
    ]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((folder) => ({ id: folder._id, name: folder.name }));
    return [{ key: "collections", label: "Collections", options }];
  }, [folders, createdFolders]);

  const totals = useMemo(() => {
    let bytes = 0;
    let videos = 0;
    for (const item of items) {
      bytes += item.file.size;
      if (item.kind === "video") videos += 1;
    }
    return { bytes, videos, images: items.length - videos };
  }, [items]);

  const doneCount = useMemo(
    () => Object.values(itemStates).filter((state) => isSettled(state.status)).length,
    [itemStates],
  );
  const errorCount = useMemo(
    () => Object.values(itemStates).filter((state) => state.status === "error").length,
    [itemStates],
  );
  const pendingCount = items.filter(
    (item) => !isSettled(itemStates[item.id]?.status),
  ).length;

  // ── Preview URLs. Kept in a ref so a re-render never re-mints them, pruned
  // when rows leave, and fully released on unmount. ──
  const previewUrlFor = useCallback((item: StagedFile) => {
    const cache = previewUrlsRef.current;
    let url = cache.get(item.id);
    if (!url) {
      url = URL.createObjectURL(item.file);
      cache.set(item.id, url);
    }
    return url;
  }, []);

  useEffect(() => {
    const cache = previewUrlsRef.current;
    const live = new Set(items.map((item) => item.id));
    for (const [id, url] of Array.from(cache.entries())) {
      if (live.has(id)) continue;
      URL.revokeObjectURL(url);
      cache.delete(id);
    }
  }, [items]);

  useEffect(() => {
    const cache = previewUrlsRef.current;
    return () => {
      for (const url of cache.values()) URL.revokeObjectURL(url);
      cache.clear();
    };
  }, []);

  useEffect(() => {
    if (!status) return;
    if (statusTimerRef.current !== null) clearTimeout(statusTimerRef.current);
    statusTimerRef.current = setTimeout(() => setStatus(null), 6000);
    return () => {
      if (statusTimerRef.current !== null) {
        clearTimeout(statusTimerRef.current);
        statusTimerRef.current = null;
      }
    };
  }, [status]);

  const stage = useCallback(
    async (loader: () => Promise<RawFile[]>) => {
      setIsStaging(true);
      try {
        const raw = await loader();
        // Dedupe against what's already staged. The ref is bumped straight
        // away, not just by the effect, so two fast drops can't both read a
        // pre-drop snapshot and stage the same files twice.
        const result = await stageBulkFiles(raw, itemsRef.current);
        if (result.added.length > 0) {
          itemsRef.current = [...itemsRef.current, ...result.added];
          setItems(itemsRef.current);
        }

        const notes: string[] = [];
        if (result.added.length > 0) notes.push(`${result.added.length} staged`);
        if (result.duplicates > 0) {
          notes.push(`${result.duplicates} already in the batch`);
        }
        if (result.skipped > 0) notes.push(`${result.skipped} non-media skipped`);
        if (result.overflow > 0) {
          notes.push(
            `${result.overflow} over the ${MAX_BULK_FILES}-file limit — upload in batches`,
          );
        }
        if (notes.length === 0) {
          setStatus({
            type: "error",
            message: "Nothing to stage — no images or videos found in that drop.",
          });
        } else {
          setStatus({
            type: result.added.length === 0 || result.overflow > 0 ? "info" : "success",
            message: notes.join(" · "),
          });
        }
      } catch (error) {
        setStatus({
          type: "error",
          message:
            error instanceof Error ? error.message : "Couldn’t read those files.",
        });
      } finally {
        setIsStaging(false);
      }
    },
    [],
  );

  const seededRef = useRef<File[] | null>(null);
  useEffect(() => {
    if (!initialFiles || initialFiles.length === 0) return;
    if (seededRef.current === initialFiles) return;
    seededRef.current = initialFiles;
    void stage(async () => filesToRaw(initialFiles));
  }, [initialFiles, stage]);

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragActive(false);
    const dataTransfer = event.dataTransfer;
    if (!dataTransfer) return;
    void stage(() => readDroppedFiles(dataTransfer));
  };

  const toggleFeatured = (id: string) => {
    setFeaturedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const removeItem = (id: string) => {
    setItems((previous) => previous.filter((item) => item.id !== id));
    setFeaturedIds((previous) => {
      if (!previous.has(id)) return previous;
      const next = new Set(previous);
      next.delete(id);
      return next;
    });
    setItemStates((previous) => {
      if (!(id in previous)) return previous;
      const next = { ...previous };
      delete next[id];
      return next;
    });
  };

  const clearAll = () => {
    setItems([]);
    setFeaturedIds(new Set());
    setItemStates({});
    setStatus(null);
  };

  const addTags = (value?: string) => {
    const parsed = parseTagNames(value ?? "");
    if (parsed.length === 0) return;
    setTags((previous) => Array.from(new Set([...previous, ...parsed])));
  };

  const toggleDestination = (folderId: string) => {
    setFolderIds((previous) =>
      previous.includes(folderId)
        ? previous.filter((id) => id !== folderId)
        : [...previous, folderId],
    );
  };

  const handleCreateFolder = async (rawName: string) => {
    const name = rawName.trim();
    if (!ownerUserId?.trim()) {
      setStatus({ type: "error", message: "Sign in to create collections." });
      return;
    }
    if (!name || creatingFolder) return;
    setCreatingFolder(true);
    try {
      const result = await requestJson<{
        folder: { _id: string };
        created: boolean;
      }>("/api/folders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      setCreatedFolders((previous) => [
        ...previous.filter((folder) => folder._id !== result.folder._id),
        { _id: result.folder._id, name },
      ]);
      setFolderIds((previous) =>
        previous.includes(result.folder._id)
          ? previous
          : [...previous, result.folder._id],
      );
      setStatus({
        type: "success",
        message: result.created ? "Collection created." : "Using existing collection.",
      });
      onDataChanged?.();
    } catch (error) {
      setStatus({
        type: "error",
        message:
          error instanceof Error ? error.message : "Failed to create collection.",
      });
    } finally {
      setCreatingFolder(false);
    }
  };

  // ── One asset, start to finish. Mirrors the single panel's branching: videos
  // and large images go browser → R2 and the ingest only carries the key. ──
  const ingestOne = useCallback(
    async (
      item: StagedFile,
      destinationFolderId?: string,
    ): Promise<{ assetId: string; duplicate: boolean }> => {
      const resolvedModelName =
        modelNameSelection === "__custom"
          ? modelNameCustom.trim() || undefined
          : modelNameSelection === NO_VALUE
            ? undefined
            : modelNameSelection;

      const isVideo = item.kind === "video";
      const isLargeImage = !isVideo && item.file.size > LARGE_IMAGE_BYTES;
      const viaR2 = isVideo || isLargeImage;

      const formData = buildUploadFormData({
        promptText: sharedPrompt,
        folderId: destinationFolderId,
        tags,
        file: viaR2 ? null : item.file,
        modelName: resolvedModelName,
        generationType: isVideo ? "video_gen" : "image_gen",
      });

      // The shared prompt is identical across the batch, so the per-asset key
      // has to carry the path — otherwise every file dedupes onto the first.
      const ingestKey = buildIngestKey({
        promptText: sharedPrompt.trim() || undefined,
        fileName: item.relativePath,
      });
      if (ingestKey) formData.set("ingestKey", ingestKey);

      if (isVideo) {
        const upload = await uploadVideoToR2(item.file, { uploadVideo: uploadToR2 });
        formData.append("r2Key", upload.r2Key);
        if (upload.contentHash) {
          formData.append("mediaContentHash", upload.contentHash);
        }
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
      } else if (isLargeImage) {
        const upload = await uploadImageToR2(item.file, { upload: uploadToR2 });
        appendImageUploadFields(formData, upload);
      }

      const response = await fetch("/api/ingest", { method: "POST", body: formData });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          body && typeof body.error === "string" ? body.error : "Ingest failed.",
        );
      }
      const assetId =
        body && body.result && typeof body.result.assetId === "string"
          ? (body.result.assetId as string)
          : undefined;
      if (!assetId) throw new Error("Ingest returned no asset.");
      return {
        assetId,
        duplicate: Boolean(body?.result?.duplicateMedia),
      };
    },
    [modelNameCustom, modelNameSelection, sharedPrompt, tags, uploadToR2],
  );

  /** File the finished batch into a project — Inbox, a section pool, or beats. */
  const fileIntoProject = useCallback(
    async (
      projectId: string,
      section: SectionValue | undefined,
      saved: { item: StagedFile; assetId: string }[],
    ) => {
      if (!ownerUserId || saved.length === 0) return;

      if (!section) {
        await addAssetsToProject({
          ownerUserId,
          projectId: projectId as Id<"folders">,
          assetIds: saved.map((entry) => entry.assetId as Id<"assets">),
        });
        return;
      }

      if (section === "beats") {
        // A beat is one video plus its characters/locations, so beats never
        // pool: each asset becomes its own beat, named from its file.
        for (const { item, assetId } of saved) {
          const name = item.relativePath
            .split("/")
            .pop()!
            .replace(/\.[^.]+$/, "")
            .slice(0, 60);
          const created = await createFolderMutation({
            ownerUserId,
            name: name || "Beat",
            kind: "beat",
          });
          await addCollectionToProject({
            ownerUserId,
            projectId: projectId as Id<"folders">,
            folderId: created.folderId,
            section: "beats",
          });
          await addAssetFolders({
            ownerUserId,
            assetId: assetId as Id<"assets">,
            folderIds: [created.folderId],
          });
        }
        return;
      }

      const pool = await ensureSectionPool({
        ownerUserId,
        projectId: projectId as Id<"folders">,
        section,
      });
      for (const { assetId } of saved) {
        await addAssetFolders({
          ownerUserId,
          assetId: assetId as Id<"assets">,
          folderIds: [pool.folderId],
        });
      }
    },
    [
      addAssetFolders,
      addAssetsToProject,
      addCollectionToProject,
      createFolderMutation,
      ensureSectionPool,
      ownerUserId,
    ],
  );

  /** Publish + feature. Featured implies public — the backend enforces it. */
  const curate = useCallback(
    async (featured: string[], plain: string[]) => {
      const calls: Promise<unknown>[] = [];
      const post = (assetIds: string[], isPublic: boolean, isFeatured: boolean) =>
        fetch("/api/admin/assets/bulk-curation", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ assetIds, isPublic, isFeatured }),
        }).then((response) => {
          if (!response.ok) throw new Error("Curation rejected.");
        });

      for (const batch of chunk(featured, CURATION_CHUNK)) {
        calls.push(post(batch, true, true));
      }
      if (publishAll) {
        for (const batch of chunk(plain, CURATION_CHUNK)) {
          calls.push(post(batch, true, false));
        }
      }
      await Promise.all(calls);
    },
    [publishAll],
  );

  const handleUpload = async () => {
    if (isUploading || items.length === 0) return;

    const queue = items.filter(
      (item) => !isSettled(itemStates[item.id]?.status),
    );
    if (queue.length === 0) {
      setStatus({ type: "info", message: "Everything here is already uploaded." });
      return;
    }

    setIsUploading(true);
    setStatus(null);

    // The first collection rides along on each ingest; any others attach after,
    // so a batch can land in several collections at once.
    const [destinationFolderId, ...extraFolderIds] = folderIds;
    const projectId = projectSelection === NO_VALUE ? undefined : projectSelection;
    const section =
      sectionSelection === NO_VALUE ? undefined : (sectionSelection as SectionValue);

    const saved: { item: StagedFile; assetId: string }[] = [];
    let failed = 0;
    // Duplicates still count as saved — they were filed into the chosen
    // collections/project, just onto the existing asset — so they ride along in
    // `saved` and are only broken out for the summary line.
    let duplicates = 0;
    let cursor = 0;

    const worker = async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        const item = queue[index];
        if (!item) return;
        setItemStates((previous) => ({
          ...previous,
          [item.id]: { status: "uploading" },
        }));
        try {
          const { assetId, duplicate } = await ingestOne(
            item,
            destinationFolderId,
          );
          saved.push({ item, assetId });
          if (duplicate) duplicates += 1;
          setItemStates((previous) => ({
            ...previous,
            [item.id]: { status: duplicate ? "duplicate" : "done", assetId },
          }));
        } catch (error) {
          failed += 1;
          setItemStates((previous) => ({
            ...previous,
            [item.id]: {
              status: "error",
              error: error instanceof Error ? error.message : "Upload failed.",
            },
          }));
        }
      }
    };

    try {
      await Promise.all(
        Array.from({ length: Math.min(UPLOAD_CONCURRENCY, queue.length) }, worker),
      );

      const fresh = saved.length - duplicates;
      const notes: string[] = [`${fresh} saved`];
      if (duplicates > 0) {
        notes.push(
          `${duplicates} already in your vault (filed, not duplicated)`,
        );
      }
      if (failed > 0) notes.push(`${failed} failed`);

      if (extraFolderIds.length > 0 && saved.length > 0 && ownerUserId) {
        try {
          for (const { assetId } of saved) {
            await addAssetFolders({
              ownerUserId,
              assetId: assetId as Id<"assets">,
              folderIds: extraFolderIds as Id<"folders">[],
            });
          }
        } catch {
          notes.push("couldn’t file into every collection");
        }
      }

      if (projectId && saved.length > 0) {
        try {
          await fileIntoProject(projectId, section, saved);
        } catch (error) {
          notes.push(
            error instanceof Error
              ? `project filing failed (${error.message})`
              : "project filing failed",
          );
        }
      }

      const stillFeatured = featuredIdsRef.current;
      const featuredAssetIds = saved
        .filter((entry) => stillFeatured.has(entry.item.id))
        .map((entry) => entry.assetId);
      const plainAssetIds = saved
        .filter((entry) => !stillFeatured.has(entry.item.id))
        .map((entry) => entry.assetId);

      if (canPromoteToPublic && (featuredAssetIds.length > 0 || publishAll)) {
        try {
          await curate(featuredAssetIds, plainAssetIds);
          if (featuredAssetIds.length > 0) {
            notes.push(`${featuredAssetIds.length} featured`);
          }
          if (publishAll) notes.push("published");
        } catch {
          notes.push("couldn’t publish the batch");
        }
      }

      setStatus({
        type: failed > 0 ? "info" : "success",
        message: notes.join(" · "),
      });
      onDataChanged?.();
    } finally {
      setIsUploading(false);
    }
  };

  // ── Boxless brand primitives, matching the single-asset panel ──
  const mono = "[font-family:var(--lm-font)]";
  const labelCls = `${mono} text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--lm-text-tertiary)]`;
  const underlineField =
    "h-11 rounded-none border-0 border-b border-[var(--lm-border)] bg-transparent px-0 text-[14px] text-[var(--lm-text-primary)] placeholder:text-[var(--lm-text-ghost)] shadow-none focus-visible:border-[var(--lm-coral)] focus-visible:ring-0 transition-colors";
  const selectTriggerCls =
    "h-11 w-full rounded-none border-0 border-b border-[var(--lm-border)] bg-transparent px-0 text-[14px] text-[var(--lm-text-primary)] shadow-none focus:border-[var(--lm-coral)] focus:ring-0 transition-colors data-placeholder:text-[var(--lm-text-ghost)]";
  const selectContentCls =
    "rounded-[10px] border border-[var(--lm-border-strong)] bg-[var(--lm-surface-1)] text-[var(--lm-text-primary)] shadow-[var(--lm-modal-shadow)]";
  const selectItemCls =
    "text-[14px] text-[var(--lm-text-secondary)] focus:bg-[var(--lm-surface-2)] focus:text-[var(--lm-text-primary)]";
  const ghostAction = cn(
    mono,
    "px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--lm-text-tertiary)] underline-offset-4 transition-colors hover:text-[var(--lm-text-primary)] hover:underline disabled:opacity-40 disabled:no-underline",
  );

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

  const statusStyles: Record<
    NonNullable<StatusMessage>["type"],
    { bg: string; border: string; color: string }
  > = {
    success: {
      bg: "var(--lm-success-dim)",
      border: "color-mix(in srgb, var(--lm-success) 45%, transparent)",
      color: "var(--lm-success-text)",
    },
    error: {
      bg: "var(--lm-status-error-dim)",
      border: "var(--lm-status-error-border)",
      color: "var(--lm-status-error-text)",
    },
    info: {
      bg: "var(--lm-accent-dim)",
      border: "var(--lm-border-strong)",
      color: "var(--lm-text-secondary)",
    },
  };

  const featuredCount = items.filter((item) => featuredIds.has(item.id)).length;

  return (
    <div
      className={cn("flex h-full min-h-0 w-full flex-col", className)}
      onDrop={handleDrop}
      onDragOver={(event) => {
        if (!Array.from(event.dataTransfer?.types ?? []).includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setIsDragActive(true);
      }}
      onDragEnter={(event) => {
        if (!Array.from(event.dataTransfer?.types ?? []).includes("Files")) return;
        event.preventDefault();
        dragCounterRef.current += 1;
        setIsDragActive(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        dragCounterRef.current -= 1;
        if (dragCounterRef.current <= 0) {
          dragCounterRef.current = 0;
          setIsDragActive(false);
        }
      }}
    >
      {status && (
        <div
          role="status"
          aria-live={status.type === "error" ? "assertive" : "polite"}
          className={cn(
            mono,
            "mx-8 mt-4 rounded-[10px] px-4 py-2.5 text-[12px] font-semibold tracking-wide",
          )}
          style={{
            backgroundColor: statusStyles[status.type].bg,
            border: `1px solid ${statusStyles[status.type].border}`,
            color: statusStyles[status.type].color,
          }}
        >
          {status.message}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-8 py-7">
        <div className="grid grid-cols-1 gap-x-12 gap-y-9 lg:grid-cols-[1.7fr_1fr] lg:items-start">
          {/* ── Left: the drop target and the mini gallery ── */}
          <div className="flex flex-col gap-6">
            {items.length === 0 ? (
              <div
                role="button"
                tabIndex={0}
                aria-label="Drop a folder or zip here"
                onClick={() => folderInputRef.current?.click()}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  folderInputRef.current?.click();
                }}
                className={cn(
                  "flex min-h-[340px] flex-col items-center justify-center gap-4 rounded-[14px] border border-dashed border-[var(--lm-border)] px-8 text-center transition-colors duration-200 hover:border-[var(--lm-text-ghost)]",
                  isDragActive && "border-[var(--lm-coral)] bg-[var(--lm-accent-dim)]",
                )}
              >
                <FolderUp
                  className="h-8 w-8 text-[var(--lm-coral)]"
                  strokeWidth={1.6}
                  aria-hidden
                />
                <div className="flex flex-col gap-1.5">
                  <p
                    className={cn(
                      mono,
                      "text-[12px] font-bold uppercase tracking-[0.18em] text-[var(--lm-text-primary)]",
                    )}
                  >
                    {isStaging ? "Reading files…" : "Drop a folder or a .zip"}
                  </p>
                  <p className="text-[12.5px] leading-relaxed text-[var(--lm-text-tertiary)]">
                    Sub-folders are walked, archives are unpacked in the browser,
                    <br />
                    non-media is ignored. Up to {MAX_BULK_FILES} files per batch.
                  </p>
                </div>
                <div className="flex items-center gap-5 pt-1">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      folderInputRef.current?.click();
                    }}
                    className={cn(
                      mono,
                      "inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--lm-coral)] underline-offset-4 hover:underline",
                    )}
                  >
                    <FolderUp className="h-3.5 w-3.5" aria-hidden /> Choose folder
                  </button>
                  <span className="h-3 w-px bg-[var(--lm-border)]" aria-hidden />
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                    className={cn(
                      mono,
                      "inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--lm-text-secondary)] underline-offset-4 hover:text-[var(--lm-text-primary)] hover:underline",
                    )}
                  >
                    <FileArchive className="h-3.5 w-3.5" aria-hidden /> Files or .zip
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Batch summary + bulk verbs, on one hairline row */}
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span
                      className="font-display text-[24px] leading-none tracking-tight text-[var(--lm-text-primary)]"
                    >
                      {items.length}
                    </span>
                    <span className={cn(labelCls, "text-[10px]")}>
                      {items.length === 1 ? "asset" : "assets"}
                    </span>
                    <span className="h-px flex-1 bg-[var(--lm-border)]" aria-hidden />
                    <span className={cn(mono, "text-[11px] tabular-nums text-[var(--lm-text-tertiary)]")}>
                      {formatBytes(totals.bytes)}
                      {totals.videos > 0 && ` · ${totals.videos} video${totals.videos === 1 ? "" : "s"}`}
                      {featuredCount > 0 && (
                        <span className="text-[var(--lm-coral)]">
                          {" "}
                          · {featuredCount} featured
                        </span>
                      )}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                    {canFeature && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            setFeaturedIds(new Set(items.map((item) => item.id)))
                          }
                          className={cn(
                            mono,
                            "inline-flex items-center gap-1.5 px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--lm-coral)] underline-offset-4 hover:underline",
                          )}
                        >
                          <Star className="h-3 w-3" fill="currentColor" aria-hidden />
                          Feature all
                        </button>
                        <button
                          type="button"
                          disabled={featuredCount === 0}
                          onClick={() => setFeaturedIds(new Set())}
                          className={ghostAction}
                        >
                          Clear featured
                        </button>
                        <span className="h-3 w-px bg-[var(--lm-border)]" aria-hidden />
                      </>
                    )}
                    <button
                      type="button"
                      disabled={isUploading}
                      onClick={() => folderInputRef.current?.click()}
                      className={ghostAction}
                    >
                      Add folder
                    </button>
                    <button
                      type="button"
                      disabled={isUploading}
                      onClick={() => fileInputRef.current?.click()}
                      className={ghostAction}
                    >
                      Add files
                    </button>
                    <span className="h-3 w-px bg-[var(--lm-border)]" aria-hidden />
                    <button
                      type="button"
                      disabled={isUploading}
                      onClick={clearAll}
                      className={ghostAction}
                    >
                      Clear batch
                    </button>
                    {isStaging && (
                      <span className={cn(mono, "animate-pulse text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--lm-coral)]")}>
                        Reading…
                      </span>
                    )}
                  </div>

                  {/* Upload progress — a single coral hairline, no chrome */}
                  {(isUploading || doneCount > 0) && (
                    <div className="flex items-center gap-3 pt-1">
                      <div className="h-[2px] flex-1 overflow-hidden bg-[var(--lm-border)]">
                        <div
                          className="h-full bg-[var(--lm-coral)] transition-[width] duration-300"
                          style={{
                            width: `${items.length === 0 ? 0 : Math.round((doneCount / items.length) * 100)}%`,
                          }}
                        />
                      </div>
                      <span className={cn(mono, "text-[10px] tabular-nums text-[var(--lm-text-tertiary)]")}>
                        {doneCount} / {items.length}
                        {errorCount > 0 && (
                          <span className="text-[var(--lm-status-error-text)]">
                            {" "}
                            · {errorCount} failed
                          </span>
                        )}
                      </span>
                    </div>
                  )}

                  <p className="text-[11px] leading-snug text-[var(--lm-text-ghost)]">
                    {canFeature
                      ? "Click a thumbnail to feature it — featured assets publish to the public gallery on save."
                      : "This account can’t publish, so the batch saves privately to the vault."}
                  </p>
                </div>

                {/* The mini gallery */}
                <div
                  className={cn(
                    "grid gap-2 rounded-[12px] transition-colors",
                    isDragActive && "outline outline-1 outline-[var(--lm-coral)]",
                  )}
                  style={{
                    gridTemplateColumns: "repeat(auto-fill, minmax(104px, 1fr))",
                  }}
                >
                  {items.map((item) => {
                    const state = itemStates[item.id];
                    const featured = featuredIds.has(item.id);
                    const url = previewUrlFor(item);
                    const name = item.relativePath.split("/").pop() ?? item.relativePath;
                    return (
                      <div key={item.id} className="group relative">
                        <button
                          type="button"
                          onClick={canFeature ? () => toggleFeatured(item.id) : undefined}
                          title={`${item.relativePath}\n${formatBytes(item.file.size)}`}
                          aria-pressed={canFeature ? featured : undefined}
                          aria-label={
                            canFeature
                              ? `${featured ? "Unfeature" : "Feature"} ${name}`
                              : name
                          }
                          className={cn(
                            "relative block aspect-square w-full overflow-hidden rounded-[8px] bg-[var(--lm-surface-1)] transition-transform duration-150",
                            canFeature ? "hover:scale-[1.02]" : "cursor-default",
                          )}
                          style={{
                            border: featured
                              ? "2px solid var(--lm-coral)"
                              : "1px solid var(--lm-border)",
                          }}
                        >
                          {item.kind === "video" ? (
                            <video
                              src={`${url}#t=0.1`}
                              muted
                              playsInline
                              preload="metadata"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <img
                              src={url}
                              alt=""
                              loading="lazy"
                              className="h-full w-full object-cover"
                            />
                          )}

                          {/* Featured marker */}
                          {featured && (
                            <span
                              className="absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full"
                              style={{ backgroundColor: "var(--lm-coral)" }}
                            >
                              <Star
                                className="h-3 w-3 text-[#1a1008]"
                                fill="currentColor"
                                aria-hidden
                              />
                            </span>
                          )}
                          {item.kind === "video" && !featured && (
                            <span className="absolute left-1.5 top-1.5 text-white/85 drop-shadow">
                              <Film className="h-3.5 w-3.5" aria-hidden />
                            </span>
                          )}

                          {/* Filename, only while hovered */}
                          <span
                            className={cn(
                              mono,
                              "pointer-events-none absolute inset-x-0 bottom-0 truncate px-1.5 py-1 text-left text-[9px] font-semibold text-[#f0e8e0] opacity-0 transition-opacity group-hover:opacity-100",
                            )}
                            style={{
                              background:
                                "linear-gradient(to top, rgba(0,0,0,0.88), rgba(0,0,0,0))",
                            }}
                          >
                            {name}
                          </span>

                          {/* Upload state */}
                          {state?.status === "uploading" && (
                            <span className="absolute inset-0 grid place-items-center bg-[var(--lm-surface-0)]/65">
                              <span
                                className={cn(
                                  mono,
                                  "animate-pulse text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--lm-coral)]",
                                )}
                              >
                                Saving
                              </span>
                            </span>
                          )}
                          {isSettled(state?.status) && (
                            <span className="absolute inset-0 bg-[var(--lm-surface-0)]/45">
                              <span
                                className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full"
                                style={{
                                  backgroundColor:
                                    state?.status === "duplicate"
                                      ? "var(--lm-coral)"
                                      : "var(--lm-success)",
                                }}
                                title={
                                  state?.status === "duplicate"
                                    ? "Already in your vault — filed, not duplicated"
                                    : "Saved"
                                }
                              >
                                <Check
                                  className="h-3 w-3 text-[#0d1410]"
                                  strokeWidth={3}
                                  aria-hidden
                                />
                              </span>
                            </span>
                          )}
                          {state?.status === "error" && (
                            <span
                              className="absolute inset-0 grid place-items-center"
                              style={{ backgroundColor: "var(--lm-status-error-dim)" }}
                              title={state.error}
                            >
                              <AlertTriangle
                                className="h-4 w-4"
                                style={{ color: "var(--lm-status-error-text)" }}
                                aria-hidden
                              />
                            </span>
                          )}
                        </button>

                        {/* Remove — hover only, never during upload */}
                        {!isUploading && !isSettled(state?.status) && (
                          <button
                            type="button"
                            onClick={() => removeItem(item.id)}
                            aria-label={`Remove ${name}`}
                            className="absolute right-1 top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white/90 transition-colors hover:bg-[var(--lm-coral)] hover:text-[#1a1008] group-hover:flex"
                          >
                            <X className="h-3 w-3" aria-hidden />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* Both pickers live here; the empty state and the toolbar share them. */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,video/*,.zip"
              className="sr-only"
              onChange={(event) => {
                const files = event.target.files;
                if (files && files.length > 0) {
                  void stage(async () => filesToRaw(files));
                }
                event.target.value = "";
              }}
            />
            <input
              ref={folderInputRef}
              type="file"
              multiple
              // Not in React's typings — the folder picker is a vendor attribute.
              {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
              className="sr-only"
              onChange={(event) => {
                const files = event.target.files;
                if (files && files.length > 0) {
                  void stage(async () => filesToRaw(files));
                }
                event.target.value = "";
              }}
            />
          </div>

          {/* ── Right: one destination for the whole batch ── */}
          <div className="flex flex-col gap-9 lg:sticky lg:top-0">
            <section className="flex flex-col gap-6">
              <SectionRule>Destination</SectionRule>

              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <span className={labelCls}>Collections</span>
                  <span
                    className={cn(
                      mono,
                      "text-[10px] tabular-nums",
                      folderIds.length > 0
                        ? "text-[var(--lm-coral)]"
                        : "text-[var(--lm-text-ghost)]",
                    )}
                  >
                    {folderIds.length > 0
                      ? `${folderIds.length} picked`
                      : "Uncategorized"}
                  </span>
                </div>
                <DestinationField
                  idPrefix="bulk"
                  groups={destinationGroups}
                  selectedIds={folderIds}
                  onToggle={toggleDestination}
                  onCreate={canCreateFolders ? handleCreateFolder : undefined}
                  creating={creatingFolder}
                  disabled={isUploading}
                />
              </div>

              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="bulk-project-select" className={labelCls}>
                    Project
                  </Label>
                  <span className={cn(labelCls, "text-[9px] text-[var(--lm-text-ghost)]")}>
                    Optional
                  </span>
                </div>
                <Select
                  value={projectSelection}
                  onValueChange={(value) => {
                    setProjectSelection(value);
                    if (value === NO_VALUE) setSectionSelection(NO_VALUE);
                  }}
                  disabled={projects.length === 0}
                >
                  <SelectTrigger
                    id="bulk-project-select"
                    className={cn(selectTriggerCls, projects.length === 0 && "opacity-50")}
                  >
                    <SelectValue
                      placeholder={projects.length === 0 ? "No projects yet" : "No project"}
                    />
                  </SelectTrigger>
                  <SelectContent className={selectContentCls}>
                    <SelectGroup>
                      <SelectItem value={NO_VALUE} className={selectItemCls}>
                        No project
                      </SelectItem>
                      {projects.map((project) => (
                        <SelectItem
                          key={project._id}
                          value={project._id}
                          className={selectItemCls}
                        >
                          {project.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>

              {projectSelection !== NO_VALUE && (
                <div className="flex flex-col gap-2.5 animate-fade-in">
                  <Label htmlFor="bulk-section-select" className={labelCls}>
                    Section
                  </Label>
                  <Select value={sectionSelection} onValueChange={setSectionSelection}>
                    <SelectTrigger id="bulk-section-select" className={selectTriggerCls}>
                      <SelectValue placeholder="Inbox — sort later" />
                    </SelectTrigger>
                    <SelectContent className={selectContentCls}>
                      <SelectGroup>
                        <SelectItem value={NO_VALUE} className={selectItemCls}>
                          Inbox — sort later
                        </SelectItem>
                        {SECTION_OPTIONS.map((option) => (
                          <SelectItem
                            key={option.value}
                            value={option.value}
                            className={selectItemCls}
                          >
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] leading-snug text-[var(--lm-text-ghost)]">
                    Section pools are created on demand. Beats never pool — each
                    asset becomes its own beat, named from its file.
                  </p>
                </div>
              )}
            </section>

            {/* Visibility */}
            <section className="flex flex-col gap-4">
              <SectionRule>Visibility</SectionRule>

              {canFeature && (
                <>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className={cn(labelCls, "flex items-center gap-1.5")}>
                      <Star
                        className="h-3 w-3 text-[var(--lm-coral)]"
                        fill="currentColor"
                        aria-hidden
                      />
                      Featured
                    </span>
                    <span
                      className={cn(
                        mono,
                        "text-[12px] font-semibold tabular-nums",
                        featuredCount > 0
                          ? "text-[var(--lm-coral)]"
                          : "text-[var(--lm-text-ghost)]",
                      )}
                    >
                      {featuredCount} of {items.length}
                    </span>
                  </div>
                  <p className="-mt-2 text-[11px] leading-snug text-[var(--lm-text-tertiary)]">
                    Pick them in the grid, or feature the whole batch at once.
                    Featuring publishes — the backend won’t feature a private asset.
                  </p>
                </>
              )}

              {canPromoteToPublic ? (
                <label
                  htmlFor="bulk-publish-all"
                  className="flex cursor-pointer items-start gap-3"
                >
                  <Checkbox
                    id="bulk-publish-all"
                    checked={publishAll}
                    onCheckedChange={(checked) => setPublishAll(checked === true)}
                    className="mt-0.5 border-[var(--lm-border-strong)] data-[state=checked]:border-[var(--lm-coral)] data-[state=checked]:bg-[var(--lm-coral)] data-[state=checked]:text-[#1a1008]"
                  />
                  <div className="space-y-0.5">
                    <span className={cn(labelCls, "flex items-center gap-1.5")}>
                      <Globe className="h-3 w-3 text-[var(--lm-coral)]" aria-hidden />
                      Publish the whole batch
                    </span>
                    <p className="text-[11px] leading-snug text-[var(--lm-text-tertiary)]">
                      Everything lands in the public gallery. Non-featured assets
                      show in Browse, not on the home hero.
                    </p>
                  </div>
                </label>
              ) : (
                <p className="text-[11px] leading-snug text-[var(--lm-text-ghost)]">
                  This account can’t publish — the batch saves privately to the vault.
                </p>
              )}
            </section>

            {/* Tags */}
            <section className="flex flex-col gap-2.5">
              <SectionRule>Tags</SectionRule>
              <Input
                id="bulk-tag-input"
                placeholder="Applied to every asset — Enter to add"
                value={tagInput}
                onChange={(event) => setTagInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== ",") return;
                  event.preventDefault();
                  addTags(tagInput);
                  setTagInput("");
                }}
                className={underlineField}
              />
              {tags.length > 0 && (
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2">
                  {tags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      aria-label={`Remove ${tag}`}
                      onClick={() =>
                        setTags((previous) => previous.filter((value) => value !== tag))
                      }
                      className={cn(
                        mono,
                        "group inline-flex items-center gap-1.5 text-[12px] font-semibold tracking-wide text-[var(--lm-coral)] transition-opacity hover:opacity-70",
                      )}
                    >
                      <span className="text-[var(--lm-text-ghost)]">#</span>
                      {tag}
                      <span className="text-[var(--lm-text-ghost)] group-hover:text-[var(--lm-coral)]">
                        ×
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {availableTags.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className={cn(labelCls, "text-[9px]")}>Suggested</span>
                  {availableTags.slice(0, 6).map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => addTags(suggestion)}
                      className={cn(
                        mono,
                        "text-[12px] font-medium text-[var(--lm-text-tertiary)] underline-offset-4 transition-colors hover:text-[var(--lm-text-primary)] hover:underline",
                      )}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
            </section>

            {/* Shared metadata — collapsed, because a batch rarely needs it */}
            <section className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => setIsMetaOpen(!isMetaOpen)}
                className="flex items-center gap-3 text-left"
              >
                <span className={labelCls}>Shared metadata</span>
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
                  className={cn(
                    "shrink-0 text-[var(--lm-text-tertiary)] transition-transform duration-300",
                    isMetaOpen && "rotate-90",
                  )}
                >
                  <path d="m9 18 6-6-6-6" />
                </svg>
                <span className="h-px flex-1 bg-[var(--lm-border)]" aria-hidden />
                {!isMetaOpen && (
                  <span className="text-[10px] text-[var(--lm-text-ghost)]">
                    Prompt · model
                  </span>
                )}
              </button>

              <div
                className={cn(
                  "grid transition-all duration-300 ease-in-out",
                  isMetaOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                )}
              >
                <div className="overflow-hidden">
                  <div className="flex flex-col gap-6 pt-3">
                    <div className="flex flex-col gap-2.5">
                      <Label htmlFor="bulk-prompt" className={labelCls}>
                        Prompt
                      </Label>
                      <Textarea
                        id="bulk-prompt"
                        placeholder="The prompt behind this batch — saved once, linked to every asset…"
                        value={sharedPrompt}
                        onChange={(event) => setSharedPrompt(event.target.value)}
                        maxLength={2000}
                        className="min-h-[120px] w-full resize-y rounded-none border-0 border-b border-[var(--lm-border)] bg-transparent px-0 pb-3 pt-1 font-display text-[16px] italic leading-relaxed text-[var(--lm-text-primary)] shadow-none placeholder:text-[var(--lm-text-ghost)] focus-visible:border-[var(--lm-coral)] focus-visible:ring-0"
                      />
                    </div>

                    <div className="flex flex-col gap-2.5">
                      <Label htmlFor="bulk-model-select" className={labelCls}>
                        Model name
                      </Label>
                      <Select
                        value={modelNameSelection}
                        onValueChange={setModelNameSelection}
                      >
                        <SelectTrigger id="bulk-model-select" className={selectTriggerCls}>
                          <SelectValue placeholder="Select model" />
                        </SelectTrigger>
                        <SelectContent className={selectContentCls}>
                          <SelectGroup>
                            <SelectItem value={NO_VALUE} className={selectItemCls}>
                              None
                            </SelectItem>
                            {MODEL_NAME_OPTIONS.map((model) => (
                              <SelectItem key={model} value={model} className={selectItemCls}>
                                {model}
                              </SelectItem>
                            ))}
                            <SelectItem value="__custom" className={selectItemCls}>
                              Other (type below)
                            </SelectItem>
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
        style={{
          borderTop: "1px solid var(--lm-border)",
          backgroundColor: "var(--lm-surface-0)",
        }}
      >
        <span className={cn(mono, "text-[10px] uppercase tracking-[0.14em] text-[var(--lm-text-ghost)]")}>
          {items.length === 0
            ? "Nothing staged yet"
            : errorCount > 0
              ? `${errorCount} failed — press upload to retry`
              : pendingCount === 0
                ? "Saved — clear the batch to add more"
                : `${pendingCount} to upload${featuredCount > 0 ? ` · ${featuredCount} featured` : ""}`}
        </span>
        <button
          type="button"
          onClick={() => void handleUpload()}
          disabled={items.length === 0 || isUploading || pendingCount === 0}
          className={cn(
            mono,
            "inline-flex h-11 items-center gap-2 rounded-[10px] px-6 text-[11px] font-bold uppercase tracking-[0.14em] text-[#1a1008] transition-all disabled:cursor-not-allowed disabled:opacity-40",
          )}
          style={{
            backgroundColor: "var(--lm-coral)",
            boxShadow: "var(--lm-shadow-lg)",
          }}
        >
          {isUploading
            ? `Uploading ${doneCount + errorCount} / ${items.length}…`
            : errorCount > 0
              ? `Retry ${pendingCount}`
              : items.length === 0
                ? "Upload batch"
                : // A finished batch keeps its thumbnails on screen, so the
                  // button has to say the work is done rather than repeat the
                  // count it started with.
                  pendingCount === 0
                  ? `${doneCount} in the vault`
                  : `Upload ${pendingCount} ${pendingCount === 1 ? "asset" : "assets"}`}
        </button>
      </div>
    </div>
  );
}
