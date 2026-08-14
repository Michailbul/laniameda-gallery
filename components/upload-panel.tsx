"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Globe, Layers, Star } from "lucide-react";
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
import {
  DestinationField,
  type DestinationGroup,
} from "@/components/gallery/destination-field";
import { useMutation } from "convex/react";
import { useUploadFile } from "@convex-dev/r2/react";
import { requestJson } from "@/lib/app-api";
import { buildIngestKey, parseTagNames } from "@/lib/ingest";
import { buildUploadFormData } from "@/lib/upload-form";
import { uploadVideoToR2 } from "@/lib/video-ingest";
import {
  inspectVideoFileAudio,
  UNDECODABLE_AUDIO_WARNING,
} from "@/lib/video-audio-check";
import {
  LARGE_IMAGE_BYTES,
  appendImageUploadFields,
  uploadImageToR2,
} from "@/lib/image-ingest";
import { cn } from "@/lib/utils";
import {
  applyImpliedAssetTypeTag,
  resolveImpliedAssetTypeTag,
  sectionKeyForTagName,
} from "@/lib/collection-sections";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export type FolderOption = {
  _id: string;
  name: string;
  description?: string | null;
  /** Undefined = a plain collection; projects/beats/storybooks are typed. */
  kind?: "storybook" | "project" | "beat" | "episode";
  parentFolderId?: string;
};

/** A world (showcased project) plus the section folders it already owns. */
export type UploadWorld = {
  _id: string;
  name: string;
  members: { folderId: string; name: string; section?: string }[];
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
  /** Worlds with their existing sections — offered as destinations by name. */
  worlds?: UploadWorld[];
  ownerUserId?: string;
  /** Whether this user may promote saves straight into the public gallery. */
  canPromoteToPublic?: boolean;
  onDataChanged?: () => void;
  className?: string;
  /** Files to seed the form with (e.g. dropped onto the gallery). */
  initialFiles?: File[];
  /** Hand a multi-file staging over to the batch panel, files and all. */
  onRequestBulk?: (files: File[]) => void;
};

type FilePreview = {
  file: File;
  url: string;
};

const NO_VALUE = "__none";

/**
 * Destinations that don't exist yet are picked as intent and resolved on save:
 * a section pool is created on demand, a beat is created and linked, and the
 * project inbox needs no folder at all.
 */
const NEW_POOL_PREFIX = "new-pool:";
const NEW_BEAT_PREFIX = "new-beat:";
const INBOX_PREFIX = "inbox:";

const POOL_SECTIONS = [
  { section: "characters", label: "Characters" },
  { section: "locations", label: "Locations" },
  { section: "stills", label: "Stills" },
] as const;

const SECTION_META: Record<string, string> = {
  beats: "beat",
  characters: "character",
  locations: "location",
  stills: "still",
};

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

const beatNameFromFile = (fileName: string) =>
  fileName.replace(/\.[^.]+$/, "").slice(0, 60) || "Beat";

export function UploadPanel({
  availableTags = [],
  folders = [],
  projects = [],
  worlds = [],
  ownerUserId,
  canPromoteToPublic = false,
  onDataChanged,
  className,
  initialFiles,
  onRequestBulk,
}: UploadPanelProps) {
  const [promptText, setPromptText] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [destinationIds, setDestinationIds] = useState<string[]>([]);
  const [promoteToPublic, setPromoteToPublic] = useState(false);
  const [featureOnSave, setFeatureOnSave] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  // A collection created here is selected the instant the API returns, which is
  // before the folders query round-trips — carrying it locally keeps the row in
  // the list under the selection at all times.
  const [createdFolders, setCreatedFolders] = useState<FolderOption[]>([]);
  const [modelNameSelection, setModelNameSelection] = useState(NO_VALUE);
  const [modelNameCustom, setModelNameCustom] = useState("");
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

  // A PCM-audio clip uploads perfectly and then plays silent, so the warning has
  // to arrive at selection time — after upload there is nothing to react to.
  // Only a positive identification warns; an unparseable container stays quiet.
  const [audioWarning, setAudioWarning] = useState<string | null>(null);
  useEffect(() => {
    const videos = selectedFiles.filter((file) => file.type.startsWith("video/"));
    if (videos.length === 0) {
      setAudioWarning(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      for (const video of videos) {
        const check = await inspectVideoFileAudio(video);
        if (cancelled) return;
        if (check.hasUndecodableAudio) {
          setAudioWarning(
            videos.length > 1
              ? `${video.name}: ${UNDECODABLE_AUDIO_WARNING}`
              : UNDECODABLE_AUDIO_WARNING,
          );
          return;
        }
      }
      if (!cancelled) setAudioWarning(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedFiles]);

  const tagSuggestions = useMemo(() => {
    const unique = Array.from(new Set(availableTags));
    return unique.slice(0, 6);
  }, [availableTags]);

  // Folders that are really a world's section are reachable under their world
  // below — listing them flat as "collections" is what made the old drop list
  // 76 rows of "DADDY ISSUES — Characters".
  // Worlds carry their sections; a plain project with none still deserves an
  // inbox row, so fall back to the project list when no world was passed.
  const worldGroupSources = useMemo<UploadWorld[]>(
    () =>
      worlds.length > 0
        ? worlds
        : projects.map((project) => ({
            _id: project._id,
            name: project.name,
            members: [],
          })),
    [projects, worlds],
  );

  const worldMemberIds = useMemo(() => {
    const ids = new Set<string>();
    for (const world of worldGroupSources) {
      for (const member of world.members) ids.add(member.folderId);
    }
    return ids;
  }, [worldGroupSources]);

  const destinationGroups = useMemo<DestinationGroup[]>(() => {
    const known = new Set(folders.map((folder) => folder._id));
    const collections = [
      ...folders.filter(
        (folder) => !folder.kind && !worldMemberIds.has(folder._id),
      ),
      ...createdFolders.filter((folder) => !known.has(folder._id)),
    ].sort((left, right) => left.name.localeCompare(right.name));

    const groups: DestinationGroup[] = [];
    if (collections.length > 0 || createdFolders.length > 0) {
      groups.push({
        key: "collections",
        label: "Collections",
        options: collections.map((folder) => ({
          id: folder._id,
          name: folder.name,
        })),
      });
    }

    for (const world of worldGroupSources) {
      const existingSections = new Set(
        world.members
          .map((member) => member.section)
          .filter((section): section is string => Boolean(section)),
      );
      groups.push({
        key: world._id,
        label: `${world.name} · world`,
        options: [
          // Existing sections and named beats, by name. Episodes group beats
          // and hold no assets, so they are never a destination.
          ...world.members
            .filter((member) => member.section !== "episodes")
            .map((member) => ({
              id: member.folderId,
              name: member.name,
              meta: member.section ? SECTION_META[member.section] : undefined,
            })),
          // Pools this world hasn't opened yet — created on save.
          ...POOL_SECTIONS.filter(
            (pool) => !existingSections.has(pool.section),
          ).map((pool) => ({
            id: `${NEW_POOL_PREFIX}${world._id}:${pool.section}`,
            name: pool.label,
            meta: "new pool",
          })),
          {
            id: `${NEW_BEAT_PREFIX}${world._id}`,
            name: selectedFiles[0]
              ? `New beat — ${beatNameFromFile(selectedFiles[0].name)}`
              : "New beat",
            meta: "new beat",
          },
          {
            id: `${INBOX_PREFIX}${world._id}`,
            name: "Inbox — sort later",
            meta: "inbox",
          },
        ],
      });
    }

    return groups;
  }, [createdFolders, folders, selectedFiles, worldGroupSources, worldMemberIds]);

  const impliedAssetTypeTag = useMemo(() => {
    const destinationNames = destinationIds.flatMap((destinationId) => {
      for (const group of destinationGroups) {
        const option = group.options.find((entry) => entry.id === destinationId);
        if (option) return [option.meta ?? option.name];
      }
      return [];
    });
    return resolveImpliedAssetTypeTag(destinationNames);
  }, [destinationGroups, destinationIds]);
  const tagsForSave = useMemo(
    () => applyImpliedAssetTypeTag(tags, impliedAssetTypeTag),
    [impliedAssetTypeTag, tags],
  );
  const visibleTags = useMemo(
    () =>
      impliedAssetTypeTag
        ? tags.filter((tagName) => sectionKeyForTagName(tagName) === null)
        : tags,
    [impliedAssetTypeTag, tags],
  );

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
    const parsed = parseTagNames(value?.toString() ?? "").filter(
      (tagName) =>
        !impliedAssetTypeTag || sectionKeyForTagName(tagName) === null,
    );
    if (parsed.length === 0) return;
    setTags((previous) => Array.from(new Set([...previous, ...parsed])));
  };

  const toggleDestination = (folderId: string) => {
    setDestinationIds((previous) =>
      previous.includes(folderId)
        ? previous.filter((id) => id !== folderId)
        : [...previous, folderId],
    );
  };

  const clearForm = () => {
    setPromptText("");
    setUrlInput("");
    setTagInput("");
    setTags([]);
    setSelectedFiles([]);
    setSaveAsTextOnlyPrompt(false);
    setDestinationIds([]);
    setPromoteToPublic(false);
    setFeatureOnSave(false);
    setCreatingFolder(false);
    setModelNameSelection(NO_VALUE);
    setModelNameCustom("");
    setGenerationType(NO_VALUE);
    setPromptType(NO_VALUE);
    setWorkflowType(NO_VALUE);
    setAssetRole(NO_VALUE);
    setDomainInput("");
    setIsDragActive(false);
    setStatus(null);
  };

  const handleCreateFolder = async (name: string) => {
    const normalizedOwnerUserId = ownerUserId?.trim();
    if (!normalizedOwnerUserId) {
      setStatus({ type: "error", message: "Sign in to create collections." });
      return;
    }
    if (!name.trim() || creatingFolder) return;

    setCreatingFolder(true);
    setStatus(null);
    try {
      const result = await requestJson<{
        folder: { _id: string };
        created: boolean;
      }>("/api/folders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      setCreatedFolders((previous) => [
        ...previous.filter((folder) => folder._id !== result.folder._id),
        { _id: result.folder._id, name: name.trim() },
      ]);
      setDestinationIds((previous) =>
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
      const message =
        error instanceof Error ? error.message : "Failed to create collection.";
      setStatus({ type: "error", message });
    } finally {
      setCreatingFolder(false);
    }
  };

  const uploadVideo = useUploadFile(api.r2);
  const addAssetsToProject = useMutation(api.projects.addAssetsToProject);
  const addAssetFolders = useMutation(api.assets.addAssetFolders);
  const createFolder = useMutation(api.folders.createFolder);
  const addCollectionToProject = useMutation(api.projects.addCollectionToProject);
  const ensureSectionPool = useMutation(api.projects.ensureSectionPool);

  /**
   * Turn the picked destinations into real folder ids, creating pools and beats
   * on the way. Returns the project ids that only wanted the inbox separately —
   * those file the asset without a folder of their own.
   */
  const resolveDestinations = async (fileName: string) => {
    const folderIds: string[] = [];
    const inboxProjectIds: string[] = [];
    if (!ownerUserId) return { folderIds, inboxProjectIds };

    for (const id of destinationIds) {
      if (id.startsWith(INBOX_PREFIX)) {
        inboxProjectIds.push(id.slice(INBOX_PREFIX.length));
        continue;
      }
      if (id.startsWith(NEW_POOL_PREFIX)) {
        const [projectId, section] = id
          .slice(NEW_POOL_PREFIX.length)
          .split(":");
        const pool = await ensureSectionPool({
          ownerUserId,
          projectId: projectId as Id<"folders">,
          section: section as "characters" | "locations" | "stills",
        });
        folderIds.push(pool.folderId as string);
        continue;
      }
      if (id.startsWith(NEW_BEAT_PREFIX)) {
        const projectId = id.slice(NEW_BEAT_PREFIX.length);
        const created = await createFolder({
          ownerUserId,
          name: beatNameFromFile(fileName),
          kind: "beat",
        });
        await addCollectionToProject({
          ownerUserId,
          projectId: projectId as Id<"folders">,
          folderId: created.folderId,
          section: "beats",
        });
        folderIds.push(created.folderId as string);
        continue;
      }
      folderIds.push(id);
    }
    return { folderIds, inboxProjectIds };
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
      const resolvedModelName =
        modelNameSelection === "__custom"
          ? modelNameCustom.trim() || undefined
          : modelNameSelection === NO_VALUE
            ? undefined
            : modelNameSelection;
      // Whatever is on screen is what saves — the thumbnail strip is the
      // chooser, so silently saving file 0 while file 2 is previewed would be a
      // lie the old panel told.
      const candidateFile =
        selectedFiles[activePreviewIndex] ?? selectedFiles[0] ?? null;
      const isVideoUpload = Boolean(
        candidateFile && candidateFile.type.startsWith("video/"),
      );
      // The taxonomy follows the file unless it was set by hand — nobody should
      // have to tell the form that an .mp4 is a video.
      const derivedType = candidateFile
        ? isVideoUpload
          ? "video_gen"
          : "image_gen"
        : undefined;
      const resolvedGenerationType =
        generationType === NO_VALUE ? derivedType : generationType;
      const resolvedPromptType =
        promptType === NO_VALUE
          ? promptText.trim()
            ? derivedType
            : undefined
          : promptType;
      const resolvedWorkflowType =
        workflowType === NO_VALUE ? undefined : workflowType;
      const resolvedAssetRole =
        assetRole === NO_VALUE ? undefined : assetRole;
      if (isPromptOnlyDraft && !saveAsTextOnlyPrompt) {
        throw new Error(
          "Enable “save as text-only prompt” to ingest prompt-only content.",
        );
      }

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
        // Destinations are attached after the save. A new beat or pool is a real
        // folder, and creating one up front would litter the world with empties
        // every time an upload failed.
        tags: tagsForSave,
        file: isVideoUpload || isLargeImageUpload ? null : candidateFile,
        modelName: resolvedModelName,
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
      // the extra destinations, project filing and curation off it. All are
      // best-effort: the asset is already saved, so a follow-up failure
      // downgrades to a warning rather than losing the save.
      const savedAssetId =
        body && body.result && typeof body.result.assetId === "string"
          ? (body.result.assetId as string)
          : undefined;
      // The bytes were already in the vault: ingest filed them where you asked
      // and handed back the original instead of making a second copy.
      const wasDuplicate = Boolean(body?.result?.duplicateMedia);
      const followupNotes: string[] = [];

      if (savedAssetId && destinationIds.length > 0 && ownerUserId?.trim()) {
        try {
          const { folderIds, inboxProjectIds } = await resolveDestinations(
            candidateFile?.name || promptText.trim().slice(0, 60) || "Beat",
          );
          if (folderIds.length > 0) {
            await addAssetFolders({
              ownerUserId,
              assetId: savedAssetId as Id<"assets">,
              folderIds: folderIds as Id<"folders">[],
            });
          }
          for (const projectId of inboxProjectIds) {
            await addAssetsToProject({
              ownerUserId,
              projectId: projectId as Id<"folders">,
              assetIds: [savedAssetId as Id<"assets">],
            });
          }
        } catch {
          followupNotes.push("couldn’t file it into every destination");
        }
      }

      // Featuring implies publishing — the backend force-ANDs isFeatured with
      // isPublic, so a featured save always publishes.
      const wantsPublic = promoteToPublic || featureOnSave;
      if (savedAssetId && wantsPublic && canPromoteToPublic) {
        try {
          const curationRes = await fetch(
            `/api/admin/assets/${savedAssetId}/curation`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                isPublic: true,
                isFeatured: featureOnSave,
              }),
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
      } else if (wasDuplicate) {
        setStatus({
          type: "info",
          message:
            "Already in your vault — filed into the same places instead of duplicating it.",
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
    success: { bg: "var(--lm-success-dim)", border: "color-mix(in srgb, var(--lm-success) 45%, transparent)", color: "var(--lm-success-text)" },
    error: { bg: "var(--lm-status-error-dim)", border: "var(--lm-status-error-border)", color: "var(--lm-status-error-text)" },
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
    "rounded-[10px] border border-[var(--lm-border-strong)] bg-[var(--lm-surface-1)] text-[var(--lm-text-primary)] shadow-[var(--lm-modal-shadow)]";
  const selectItemCls =
    "text-[14px] text-[var(--lm-text-secondary)] focus:bg-[var(--lm-surface-2)] focus:text-[var(--lm-text-primary)]";
  const checkboxCls =
    "mt-0.5 border-[var(--lm-border-strong)] data-[state=checked]:border-[var(--lm-coral)] data-[state=checked]:bg-[var(--lm-coral)] data-[state=checked]:text-[#1a1008]";

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

  const activePreview = previews[activePreviewIndex];
  const extraFileCount = Math.max(0, selectedFiles.length - 1);

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

      {audioWarning && (
        <p
          role="status"
          aria-live="polite"
          className={cn(
            mono,
            "mx-8 mt-4 border-l-2 pl-3 text-[12px] leading-relaxed",
          )}
          style={{
            borderColor: "var(--lm-coral)",
            color: "var(--lm-text-secondary)",
          }}
        >
          {audioWarning}
        </p>
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
          <div className="grid grid-cols-1 gap-x-12 gap-y-9 lg:grid-cols-[1.35fr_1fr] lg:items-start">
            {/* ── Left: the asset itself, then what it says ── */}
            <div className="flex flex-col gap-9">
              {/* Media — the asset leads, because a drop already brought one */}
              <section className="flex flex-col gap-3">
                <SectionRule
                  trailing={
                    activePreview ? (
                      <span className="flex items-center gap-4">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className={cn(
                            mono,
                            "text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--lm-text-tertiary)] underline-offset-4 transition-colors hover:text-[var(--lm-text-primary)] hover:underline",
                          )}
                        >
                          Add
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedFiles([])}
                          className={cn(
                            mono,
                            "text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--lm-text-tertiary)] underline-offset-4 transition-colors hover:text-[var(--lm-coral)] hover:underline",
                          )}
                        >
                          Remove
                        </button>
                      </span>
                    ) : undefined
                  }
                >
                  Media
                </SectionRule>

                <div
                  data-testid="upload-dropzone"
                  role="button"
                  aria-label="Drag files here or click to browse"
                  aria-describedby={descriptionId}
                  tabIndex={0}
                  onClick={() => {
                    if (activePreview) return;
                    fileInputRef.current?.click();
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    fileInputRef.current?.click();
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
                    "group relative overflow-hidden rounded-[12px] transition-colors duration-200",
                    activePreview
                      ? "cursor-default bg-[var(--lm-surface-1)]"
                      : "flex min-h-[132px] cursor-pointer flex-col items-center justify-center gap-2.5 border border-dashed border-[var(--lm-border)] p-6 text-center hover:border-[var(--lm-text-ghost)]",
                    isDragActive &&
                      "border-[var(--lm-coral)] bg-[var(--lm-accent-dim)] outline outline-1 outline-[var(--lm-coral)]",
                  )}
                >
                  {isUploading && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-[12px] bg-[var(--lm-surface-0)]/80 backdrop-blur-sm">
                      <span className={cn(mono, "animate-pulse text-[10px] font-bold uppercase tracking-[0.3em] text-[var(--lm-coral)]")}>
                        Uploading…
                      </span>
                    </div>
                  )}

                  {activePreview ? (
                    activePreview.file.type.startsWith("image/") ? (
                      <Image
                        src={activePreview.url}
                        alt={activePreview.file.name}
                        width={1200}
                        height={800}
                        unoptimized
                        className="max-h-[360px] w-full object-contain"
                      />
                    ) : activePreview.file.type.startsWith("video/") ? (
                      <video
                        src={activePreview.url}
                        controls
                        playsInline
                        preload="metadata"
                        className="max-h-[360px] w-full bg-[var(--media-stage-bg)] object-contain"
                      />
                    ) : (
                      <div className="flex h-[200px] w-full flex-col items-center justify-center gap-2">
                        <span className="text-sm font-semibold text-[var(--lm-text-secondary)]">
                          {activePreview.file.name}
                        </span>
                        <span className={cn(labelCls, "text-[9px]")}>No preview</span>
                      </div>
                    )
                  ) : (
                    <>
                      <span className="text-[var(--lm-coral)] transition-transform duration-200 group-hover:scale-105">
                        <svg className="h-7 w-7" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
                      </span>
                      <p className={cn(mono, "text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--lm-text-primary)]")}>
                        Drop media here
                      </p>
                      <p className="text-[12px] text-[var(--lm-text-tertiary)]">or click to browse</p>
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

                {activePreview ? (
                  <div className="flex items-center justify-between gap-3">
                    <span className={cn(mono, "min-w-0 flex-1 truncate text-[11px] text-[var(--lm-text-tertiary)]")}>
                      {activePreview.file.name}
                    </span>
                    <span className={cn(mono, "shrink-0 text-[10px] tabular-nums text-[var(--lm-text-ghost)]")}>
                      {(activePreview.file.size / (1024 * 1024)).toFixed(1)} MB
                    </span>
                  </div>
                ) : (
                  <p id={descriptionId} className="text-[11px] text-[var(--lm-text-ghost)]">
                    JPEG, PNG, MP4, MOV. One asset per save.
                  </p>
                )}

                {/* A single save takes a single asset. Say so, and offer the
                    panel that does take the rest — the old copy admitted the
                    extras were dropped in a footnote nobody read. */}
                {extraFileCount > 0 && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-l-2 border-[var(--lm-coral)] pl-3">
                    <span className="text-[11.5px] leading-snug text-[var(--lm-text-secondary)]">
                      {extraFileCount} more file{extraFileCount === 1 ? "" : "s"} staged
                      — only{" "}
                      <span className="text-[var(--lm-text-primary)]">
                        {activePreview?.file.name}
                      </span>{" "}
                      saves here. Pick another below, or save the lot as a batch.
                    </span>
                    {onRequestBulk && (
                      <button
                        type="button"
                        onClick={() => onRequestBulk(selectedFiles)}
                        className={cn(
                          mono,
                          "inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--lm-coral)] underline-offset-4 hover:underline",
                        )}
                      >
                        <Layers className="h-3 w-3" aria-hidden />
                        Save all in batch
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedFiles((previous) =>
                          previous.filter((_, index) => index === activePreviewIndex),
                        )
                      }
                      className={cn(
                        mono,
                        "text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--lm-text-tertiary)] underline-offset-4 transition-colors hover:text-[var(--lm-text-primary)] hover:underline",
                      )}
                    >
                      Drop the extras
                    </button>
                  </div>
                )}

                {previews.length > 1 && (
                  <div className="flex flex-wrap gap-2">
                    {previews.map((preview, index) => (
                      <button
                        key={`${preview.file.name}-${index}`}
                        type="button"
                        onClick={() => setActivePreviewIndex(index)}
                        aria-label={`Preview ${preview.file.name}`}
                        aria-pressed={index === activePreviewIndex}
                        className={cn(
                          "h-12 w-12 overflow-hidden rounded-[6px] bg-[var(--lm-surface-1)] transition-all",
                          index === activePreviewIndex
                            ? "outline outline-2 outline-[var(--lm-coral)]"
                            : "opacity-60 hover:opacity-100",
                        )}
                      >
                        {preview.file.type.startsWith("image/") ? (
                          <Image
                            src={preview.url}
                            alt=""
                            width={96}
                            height={96}
                            unoptimized
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className={cn(mono, "flex h-full w-full items-center justify-center text-[9px] font-bold uppercase text-[var(--lm-text-ghost)]")}>
                            {index === 0 ? "1st" : index + 1}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex flex-col gap-2.5 pt-1">
                  <FieldLabel htmlFor="prompt-url">
                    Or fetch from a URL
                  </FieldLabel>
                  <Input
                    id="prompt-url"
                    placeholder="https://example.com/asset"
                    value={urlInput}
                    onChange={(event) => setUrlInput(event.target.value)}
                    className={underlineField}
                  />
                </div>
              </section>

              {/* Prompt — optional for a plain media save, so it no longer owns
                  the top of the form */}
              <section className="flex flex-col gap-3">
                <SectionRule
                  trailing={
                    <span className={cn(mono, "text-[10px] tabular-nums text-[var(--lm-text-ghost)]")}>
                      {promptText.length} / 2000
                    </span>
                  }
                >
                  Prompt{hasMediaInputs ? " · optional" : ""}
                </SectionRule>
                <div className="relative min-h-[150px] flex-1">
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
                      "min-h-[150px] h-full w-full resize-y rounded-none border-0 bg-transparent px-0 pb-4 pt-1 font-display text-[19px] italic leading-relaxed shadow-none placeholder:text-[var(--lm-text-ghost)] focus-visible:ring-0",
                      promptHighlight
                        ? "text-transparent caret-[var(--lm-coral)] selection:bg-[var(--lm-accent-dim)] selection:text-transparent"
                        : "text-[var(--lm-text-primary)]",
                    )}
                  />
                </div>

                {/* Only a prompt with no media has a decision to make here. */}
                {isPromptOnlyDraft && (
                  <label
                    htmlFor="save-as-text-only-prompt"
                    className="flex cursor-pointer items-start gap-3 pt-1"
                  >
                    <Checkbox
                      id="save-as-text-only-prompt"
                      checked={saveAsTextOnlyPrompt}
                      onCheckedChange={(checked) => setSaveAsTextOnlyPrompt(checked === true)}
                      className={checkboxCls}
                    />
                    <div className="space-y-0.5">
                      <span className={cn(labelCls, "block")}>Save as text-only prompt</span>
                      <p className="text-[11px] leading-snug text-[var(--lm-text-tertiary)]">
                        No media attached — turn this on to save the prompt on its own.
                      </p>
                    </div>
                  </label>
                )}
              </section>

              {/* Tags */}
              <section className="flex flex-col gap-2.5">
                <FieldLabel htmlFor="tag-input">Tags</FieldLabel>
                {impliedAssetTypeTag && (
                  <p className="text-[11px] leading-snug text-[var(--lm-coral)]">
                    {impliedAssetTypeTag[0].toUpperCase() + impliedAssetTypeTag.slice(1)}
                    {" comes from the selected collection."}
                  </p>
                )}
                <Input
                  id="tag-input"
                  placeholder="Type a tag, press Enter or comma to add"
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  onKeyDown={handleTagKeyDown}
                  className={underlineField}
                />

                {visibleTags.length > 0 && (
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2">
                    {visibleTags.map((tag) => (
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
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <span className={cn(labelCls, "text-[9px]")}>Suggested</span>
                    {tagSuggestions
                      .filter(
                        (suggestion) =>
                          !impliedAssetTypeTag ||
                          sectionKeyForTagName(suggestion) === null,
                      )
                      .map((suggestion) => (
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
              </section>
            </div>

            {/* ── Right: where it goes, who sees it ── */}
            <div className="flex flex-col gap-9">
              <section className="flex flex-col gap-3">
                <SectionRule
                  trailing={
                    <span
                      className={cn(
                        mono,
                        "text-[10px] tabular-nums",
                        destinationIds.length > 0
                          ? "text-[var(--lm-coral)]"
                          : "text-[var(--lm-text-ghost)]",
                      )}
                    >
                      {destinationIds.length > 0
                        ? `${destinationIds.length} picked`
                        : "Uncategorized"}
                    </span>
                  }
                >
                  Destination
                </SectionRule>
                <DestinationField
                  idPrefix="upload"
                  groups={destinationGroups}
                  selectedIds={destinationIds}
                  onToggle={toggleDestination}
                  onCreate={canCreateFolders ? handleCreateFolder : undefined}
                  creating={creatingFolder}
                  disabled={isUploading}
                />
              </section>

              {/* Visibility */}
              {canPromoteToPublic && (
                <section className="flex flex-col gap-4">
                  <SectionRule>Visibility</SectionRule>

                  <label
                    htmlFor="promote-to-public"
                    className="flex cursor-pointer items-start gap-3"
                  >
                    <Checkbox
                      id="promote-to-public"
                      checked={promoteToPublic || featureOnSave}
                      disabled={featureOnSave}
                      onCheckedChange={(checked) => setPromoteToPublic(checked === true)}
                      className={checkboxCls}
                    />
                    <div className="space-y-0.5">
                      <span className={cn(labelCls, "flex items-center gap-1.5")}>
                        <Globe className="h-3 w-3 text-[var(--lm-coral)]" aria-hidden />
                        Publish to the public gallery
                      </span>
                      <p className="text-[11px] leading-snug text-[var(--lm-text-tertiary)]">
                        A world page only renders published assets.
                      </p>
                    </div>
                  </label>

                  <label
                    htmlFor="feature-on-save"
                    className="flex cursor-pointer items-start gap-3"
                  >
                    <Checkbox
                      id="feature-on-save"
                      checked={featureOnSave}
                      onCheckedChange={(checked) => setFeatureOnSave(checked === true)}
                      className={checkboxCls}
                    />
                    <div className="space-y-0.5">
                      <span className={cn(labelCls, "flex items-center gap-1.5")}>
                        <Star
                          className="h-3 w-3 text-[var(--lm-coral)]"
                          fill="currentColor"
                          aria-hidden
                        />
                        Feature on the home reel
                      </span>
                      <p className="text-[11px] leading-snug text-[var(--lm-text-tertiary)]">
                        Featuring publishes too — there is no private featured state.
                      </p>
                    </div>
                  </label>
                </section>
              )}

              {/* Details — taxonomy, collapsed by default. A dropped file already
                  answers image-vs-video, so nothing here is required. */}
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
                            <SelectValue
                              placeholder={
                                selectedFiles[0]?.type.startsWith("video/")
                                  ? "From the file — Video"
                                  : selectedFiles[0]
                                    ? "From the file — Image"
                                    : "Select type"
                              }
                            />
                          </SelectTrigger>
                          <SelectContent className={selectContentCls}>
                            <SelectGroup>
                              <SelectItem value={NO_VALUE} className={selectItemCls}>From the file</SelectItem>
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
                            <SelectValue placeholder="From the file" />
                          </SelectTrigger>
                          <SelectContent className={selectContentCls}>
                            <SelectGroup>
                              <SelectItem value={NO_VALUE} className={selectItemCls}>From the file</SelectItem>
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
                            <SelectValue placeholder="None" />
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
                            <SelectValue placeholder="None" />
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
              boxShadow: "var(--lm-shadow-lg)",
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
