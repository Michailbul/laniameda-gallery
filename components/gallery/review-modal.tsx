"use client";

/* eslint-disable @next/next/no-img-element -- review images render raw <img>/
   <video> at large size (like storybook-modal); next/image adds no value here
   and its optimizer is bypassed for R2 URLs anyway. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  Crown,
  ExternalLink,
  FileDown,
  FolderPlus,
  Heart,
  LayoutGrid,
  Link2,
  MapPin,
  Pencil,
  Play,
  Plus,
  Upload,
  User,
  X,
} from "lucide-react";
import { useUploadFile } from "@convex-dev/r2/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { buildUploadFormData } from "@/lib/upload-form";
import { buildIngestKey } from "@/lib/ingest";
import { uploadVideoToR2 } from "@/lib/video-ingest";
import {
  StackHoverPreviewOverlay,
  useStackHoverPreview,
} from "@/components/gallery/stack-hover-preview";

const APPROVED_TAG = "approved";

type CollectionOption = { id: string; name: string; count?: number };

/** The project's layers. Each layer holds "directions" — collections of
 * similar options with a master (cover) thumbnail. */
type ProjectSection = "characters" | "locations" | "beats";
type ReviewTab = "all" | ProjectSection | "unsorted";

const SECTION_TABS: { key: ProjectSection; label: string }[] = [
  { key: "characters", label: "Characters" },
  { key: "locations", label: "Locations" },
  { key: "beats", label: "Beats" },
];

const TAB_LABELS: Record<ReviewTab, string> = {
  all: "All",
  characters: "Characters",
  locations: "Locations",
  beats: "Beats",
  unsorted: "Unsorted",
};

type AssetLikes = { count: number; names: string[] };

// Tooltip text for a like badge: viewer names when they left one, plus an
// anonymous remainder.
const likeTitle = (entry: AssetLikes | undefined): string => {
  if (!entry || entry.count === 0) return "";
  if (entry.names.length === 0) {
    return `${entry.count} like${entry.count === 1 ? "" : "s"} from the shared board`;
  }
  const anonymous = entry.count - entry.names.length;
  return `Liked by ${entry.names.join(", ")}${anonymous > 0 ? ` +${anonymous}` : ""}`;
};

type ReviewModalProps = {
  ownerUserId: string;
  /** Folder id of the open project, or null when closed. */
  projectId: string | null;
  /** All of the owner's plain collections, for the "add collections" picker. */
  allCollections: CollectionOption[];
  /**
   * Left edge of the workspace on md+ (the sidebar width), so the sidebar
   * stays visible and usable while reviewing. Mobile stays full-bleed.
   */
  leftOffset?: string;
  onClose: () => void;
};

type ReviewAsset = {
  id: string;
  url?: string;
  thumbUrl?: string;
  kind: "image" | "video";
  contentType?: string;
  width?: number;
  height?: number;
  promptText?: string;
  modelName?: string;
  approvedByTag: boolean;
  collectionId: string;
  collectionName: string;
  /** All collections this asset belongs to (for membership removal). */
  folderIds: string[];
  /** Tag names, for the metadata filter chips. */
  tagNames: string[];
};

type DirectionCardData = {
  id: string;
  name: string;
  count: number;
  section?: ProjectSection;
  cover: ReviewAsset | null;
  /** Thumb urls of the next variations, peeking behind the master. */
  backs: string[];
  /** Thumb urls (master first) for the hover-to-preview rotation. */
  previews: string[];
};

/**
 * Fullscreen project review workspace. Walks every asset across a project's
 * member collections at large size. Two modes: a big-tile masonry (default)
 * and a hero + horizontal filmstrip focus mode you reach by clicking a tile.
 * "Approve" toggles the global `approved` tag so the shortlist is filterable
 * everywhere (project + approved).
 */
export function ReviewModal({
  ownerUserId,
  projectId,
  allCollections,
  leftOffset,
  onClose,
}: ReviewModalProps) {
  const project = useQuery(
    api.projects.getProject,
    projectId
      ? { ownerUserId, projectId: projectId as Id<"folders"> }
      : "skip",
  );

  const setApproved = useMutation(api.assets.setAssetApproved);
  const setAssetFolders = useMutation(api.assets.setAssetFolders);
  const addAssetFolders = useMutation(api.assets.addAssetFolders);
  const addAssetTagsMutation = useMutation(api.assets.addAssetTags);
  const addCollection = useMutation(api.projects.addCollectionToProject);
  const removeCollection = useMutation(api.projects.removeCollectionFromProject);
  const setCollectionSection = useMutation(api.projects.setProjectCollectionSection);
  const setBeatPairingMutation = useMutation(api.projects.setBeatPairing);
  const setFolderCover = useMutation(api.folders.setFolderCover);
  const createFolder = useMutation(api.folders.createFolder);
  const updateFolder = useMutation(api.folders.updateFolder);
  // Videos upload straight from the browser to R2 (the ingest route only
  // carries image bytes — video files would blow the serverless body limit).
  const uploadVideo = useUploadFile(api.r2);
  const enableShare = useMutation(api.directionBoard.enableShare);
  const disableShare = useMutation(api.directionBoard.disableShare);
  const shareState = useQuery(
    api.directionBoard.getShareState,
    projectId
      ? { ownerUserId, projectId: projectId as Id<"folders"> }
      : "skip",
  );

  // null = no explicit choice yet → land on the first non-empty layer so the
  // project opens on its modes (Characters / Locations / Beats), not the wall.
  const [activeTab, setActiveTab] = useState<ReviewTab | null>(null);
  // Direction currently drilled into (a member collection id), or null when
  // browsing a layer's direction cards / the flat All view.
  const [openDirectionId, setOpenDirectionId] = useState<string | null>(null);
  const [approvedOnly, setApprovedOnly] = useState(false);
  const [likedOnly, setLikedOnly] = useState(false);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  // Inline rename of the drilled direction (null = not renaming).
  const [renameDraft, setRenameDraft] = useState<string | null>(null);
  // Draft direction composer: the user names a direction, stages files and an
  // optional text, and only Approve creates + attaches it. Directions are
  // never auto-created from file names.
  const [composer, setComposer] = useState<null | {
    name: string;
    layer: ProjectSection | null;
    files: File[];
    prompt: string;
  }>(null);
  const composerOpen = composer !== null;
  // Object URLs for staged-file previews, revoked when files change/unmount.
  const composerPreviews = useMemo(
    () =>
      (composer?.files ?? []).map((file) => ({
        file,
        url: URL.createObjectURL(file),
      })),
    [composer?.files],
  );
  useEffect(
    () => () => {
      for (const preview of composerPreviews) URL.revokeObjectURL(preview.url);
    },
    [composerPreviews],
  );
  // File drop → upload straight into the project.
  const [dragFilesOver, setDragFilesOver] = useState(false);
  const dragDepthRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadState, setUploadState] = useState<{
    done: number;
    total: number;
    error?: string;
  } | null>(null);
  // Optimistic approve overrides so toggling feels instant before the query
  // re-emits with updated tagNames.
  const [approveOverride, setApproveOverride] = useState<Record<string, boolean>>(
    {},
  );
  // Optimistic master (cover) override per collection id; null = cleared.
  const [coverOverride, setCoverOverride] = useState<
    Record<string, string | null>
  >({});

  // Per-open transient state resets via the `key={projectId}` remount in the
  // dashboard — no reset effect needed.

  const memberCollectionIds = useMemo(
    () => new Set((project?.collections ?? []).map((c) => c.folderId as string)),
    [project],
  );

  // Viewer likes from the shared board, keyed by asset id.
  const likesByAsset = useMemo(
    () =>
      new Map<string, AssetLikes>(
        (project?.assetLikes ?? []).map((entry) => [
          entry.assetId as string,
          { count: entry.count, names: entry.names },
        ]),
      ),
    [project],
  );
  const totalLikes = useMemo(
    () =>
      [...likesByAsset.values()].reduce((sum, entry) => sum + entry.count, 0),
    [likesByAsset],
  );

  type ProjectCollection = NonNullable<typeof project>["collections"][number];

  const toReviewAsset = useCallback(
    (
      asset: ProjectCollection["assets"][number],
      collection: ProjectCollection,
    ): ReviewAsset => ({
      id: asset._id as string,
      url: asset.url ?? asset.thumbUrl,
      thumbUrl: asset.thumbUrl ?? asset.url,
      kind: asset.kind,
      contentType: asset.contentType,
      width: asset.width,
      height: asset.height,
      promptText: asset.promptText,
      modelName: asset.modelName,
      approvedByTag: (asset.tagNames ?? []).includes(APPROVED_TAG),
      collectionId: collection.folderId as string,
      collectionName: collection.name,
      folderIds: (asset.folderIds ?? []).map((id) => id as string),
      tagNames: asset.tagNames ?? [],
    }),
    [],
  );

  // Which tab a collection files under; no section = "unsorted".
  const tabOf = (section: string | undefined): ReviewTab =>
    (section as ProjectSection | undefined) ?? "unsorted";

  // Land on the first layer that has directions; flat All is the fallback.
  const defaultTab = useMemo<ReviewTab>(() => {
    const collections = project?.collections ?? [];
    for (const { key } of SECTION_TABS) {
      if (collections.some((c) => tabOf(c.section) === key)) return key;
    }
    return "all";
  }, [project]);
  const effectiveTab = activeTab ?? defaultTab;

  // Collections visible in the active tab.
  const tabCollections = useMemo<ProjectCollection[]>(() => {
    const collections = project?.collections ?? [];
    if (effectiveTab === "all") return collections;
    return collections.filter((c) => tabOf(c.section) === effectiveTab);
  }, [project, effectiveTab]);

  // The drilled-into direction, if it still exists in the project.
  const openDirection = useMemo<ProjectCollection | null>(
    () =>
      (openDirectionId &&
        (project?.collections ?? []).find(
          (c) => (c.folderId as string) === openDirectionId,
        )) ||
      null,
    [project, openDirectionId],
  );

  const resolveCoverId = useCallback(
    (collection: ProjectCollection): string | null => {
      const collectionId = collection.folderId as string;
      if (collectionId in coverOverride) return coverOverride[collectionId]!;
      return (collection.coverAssetId as string | undefined) ?? null;
    },
    [coverOverride],
  );

  // Direction cards for a layer tab: one card per collection, thumbed by its
  // MASTER option (cover asset) with first-asset fallback.
  const directions = useMemo<DirectionCardData[]>(
    () =>
      tabCollections.map((collection) => {
        const coverId = resolveCoverId(collection);
        const coverAsset =
          (coverId &&
            collection.assets.find((a) => (a._id as string) === coverId)) ||
          collection.assets[0] ||
          null;
        const backs = collection.assets
          .filter((a) => a !== coverAsset)
          .slice(0, 2)
          .map((a) => a.thumbUrl ?? a.url)
          .filter((src): src is string => Boolean(src));
        const previews = (coverAsset
          ? [coverAsset, ...collection.assets.filter((a) => a !== coverAsset)]
          : collection.assets
        )
          .slice(0, 8)
          .map((a) => a.thumbUrl ?? a.url)
          .filter((src): src is string => Boolean(src));
        return {
          id: collection.folderId as string,
          name: collection.name,
          count: collection.count,
          section: collection.section as ProjectSection | undefined,
          cover: coverAsset ? toReviewAsset(coverAsset, collection) : null,
          backs,
          previews,
        };
      }),
    [tabCollections, resolveCoverId, toReviewAsset],
  );

  // Flatten the current scope → assets. Drilled direction wins; otherwise the
  // active tab's collections, deduped by asset id (first collection wins).
  const assets = useMemo<ReviewAsset[]>(() => {
    const source = openDirection ? [openDirection] : tabCollections;
    const out: ReviewAsset[] = [];
    const seen = new Set<string>();
    for (const collection of source) {
      for (const asset of collection.assets) {
        const id = asset._id as string;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(toReviewAsset(asset, collection));
      }
    }
    return out;
  }, [openDirection, tabCollections, toReviewAsset]);

  const isApproved = useCallback(
    (asset: ReviewAsset) =>
      asset.id in approveOverride
        ? approveOverride[asset.id]
        : asset.approvedByTag,
    [approveOverride],
  );

  // Tag chips for the flat/drilled views, ranked by frequency in scope. The
  // selected tag only applies while it exists in scope — switching tabs to a
  // scope without it silently deactivates it (no state-sync effect needed).
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const asset of assets) {
      for (const tag of asset.tagNames) {
        if (tag === APPROVED_TAG) continue;
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 14);
  }, [assets]);
  const activeTag =
    selectedTag && tagCounts.some(([tag]) => tag === selectedTag)
      ? selectedTag
      : null;

  const visibleAssets = useMemo(
    () =>
      assets.filter(
        (asset) =>
          (!approvedOnly || isApproved(asset)) &&
          (!likedOnly || (likesByAsset.get(asset.id)?.count ?? 0) > 0) &&
          (!activeTag || asset.tagNames.includes(activeTag)),
      ),
    [assets, approvedOnly, likedOnly, activeTag, isApproved, likesByAsset],
  );

  const approvedCount = useMemo(
    () => assets.filter(isApproved).length,
    [assets, isApproved],
  );

  const focusIndex = focusId
    ? visibleAssets.findIndex((a) => a.id === focusId)
    : -1;
  const focusAsset = focusIndex >= 0 ? visibleAssets[focusIndex] : null;
  // Drives the header/chip layout. Derived (not focusId) so a focus that fell
  // out of the visible set — e.g. after a filter change — cleanly reverts to
  // the grid without a state-syncing effect.
  const inFocus = Boolean(focusAsset);

  const toggleApprove = useCallback(
    (asset: ReviewAsset) => {
      const next = !isApproved(asset);
      setApproveOverride((prev) => ({ ...prev, [asset.id]: next }));
      void setApproved({
        ownerUserId,
        assetId: asset.id as Id<"assets">,
        approved: next,
      }).catch(() => {
        // Roll back on failure.
        setApproveOverride((prev) => ({ ...prev, [asset.id]: !next }));
      });
    },
    [isApproved, ownerUserId, setApproved],
  );

  // ── Character / Location filing ──
  // Any image inside a direction can be filed into this project's Characters
  // or Locations layer: it lands in an auto-created "<Project> — Characters"
  // (or — Locations) collection and gets the matching global tag. Toggleable.
  const layerAggregates = useMemo(() => {
    const projectName = project?.project.name;
    const find = (label: string, section: ProjectSection) =>
      project?.collections.find(
        (c) =>
          c.name === `${projectName} — ${label}` &&
          tabOf(c.section) === section,
      )?.folderId as string | undefined;
    return {
      characters: find("Characters", "characters"),
      locations: find("Locations", "locations"),
    };
  }, [project]);

  const isFiledToLayer = useCallback(
    (asset: ReviewAsset, layer: "characters" | "locations") => {
      const aggregateId = layerAggregates[layer];
      return Boolean(aggregateId && asset.folderIds.includes(aggregateId));
    },
    [layerAggregates],
  );

  const fileAssetToLayer = async (
    asset: ReviewAsset,
    layer: "characters" | "locations",
  ) => {
    if (!projectId || !project) return;
    const label = layer === "characters" ? "Characters" : "Locations";
    const aggregateId = layerAggregates[layer];

    if (aggregateId && asset.folderIds.includes(aggregateId)) {
      // Already filed → unfile (membership only; the tag stays).
      await setAssetFolders({
        ownerUserId,
        assetId: asset.id as Id<"assets">,
        folderIds: asset.folderIds.filter(
          (id) => id !== aggregateId,
        ) as Id<"folders">[],
      });
      return;
    }

    let folderId = aggregateId as Id<"folders"> | undefined;
    if (!folderId) {
      const created = await createFolder({
        ownerUserId,
        name: `${project.project.name} — ${label}`,
      });
      await addCollection({
        ownerUserId,
        projectId: projectId as Id<"folders">,
        folderId: created.folderId,
        section: layer,
      });
      folderId = created.folderId;
    }
    await addAssetFolders({
      ownerUserId,
      assetId: asset.id as Id<"assets">,
      folderIds: [folderId],
    });
    void addAssetTagsMutation({
      ownerUserId,
      assetId: asset.id as Id<"assets">,
      tagNames: [layer === "characters" ? "character" : "location"],
    }).catch(() => {});
  };

  // ── File uploads into a direction ──
  // A dropped/typed text becomes the prompt for every file in the pack; a
  // beat's first video becomes its MASTER so the stack previews as the shot.
  const uploadFilesToDirection = async (
    media: File[],
    targetFolderId: string,
    promptText: string,
    targetSection: ReviewTab | undefined,
  ) => {
    setUploadState({ done: 0, total: media.length });
    try {
      let masterVideoAssetId: string | null = null;
      let failed = 0;
      for (const file of media) {
        try {
          const isVideo = file.type.startsWith("video/");
          // Mirrors the upload panel: images travel in the ingest request;
          // videos upload browser→R2 with a client-extracted poster, and the
          // ingest request only carries the r2Key + poster + metadata.
          const formData = buildUploadFormData({
            promptText,
            folderId: targetFolderId,
            file: isVideo ? null : file,
          });
          if (isVideo) {
            const upload = await uploadVideoToR2(file, { uploadVideo });
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
            // Without a `file` field the form builder derives no ingest key —
            // key the drop on the file name so re-drops stay idempotent.
            if (!formData.get("ingestKey")) {
              const key = buildIngestKey({ fileName: file.name });
              if (key) formData.append("ingestKey", key);
            }
          }
          const response = await fetch("/api/ingest", {
            method: "POST",
            body: formData,
          });
          const body = (await response.json().catch(() => null)) as {
            result?: { assetId?: string };
            error?: string;
          } | null;
          if (!response.ok) {
            throw new Error(body?.error || "Upload failed.");
          }
          const assetId = body?.result?.assetId;
          if (!masterVideoAssetId && assetId && isVideo) {
            masterVideoAssetId = assetId;
          }
        } catch {
          failed += 1;
        }
        setUploadState((prev) =>
          prev ? { ...prev, done: prev.done + 1 } : prev,
        );
      }

      if (targetSection === "beats" && masterVideoAssetId) {
        await setFolderCover({
          ownerUserId,
          folderId: targetFolderId as Id<"folders">,
          assetId: masterVideoAssetId as Id<"assets">,
        }).catch(() => {});
      }

      if (failed > 0) {
        setUploadState({
          done: media.length,
          total: media.length,
          error: `${failed} of ${media.length} failed to upload.`,
        });
      } else {
        setUploadState({ done: media.length, total: media.length });
        setTimeout(() => setUploadState(null), 2500);
      }
    } catch (error) {
      setUploadState({
        done: 0,
        total: media.length,
        error: error instanceof Error ? error.message : "Upload failed.",
      });
    }
  };

  // Drilled: dropped files land in that direction. Anywhere else they STAGE
  // into the composer — directions are only ever created and named by the
  // user, never auto-named from a file.
  const handleFilesDrop = async (dropped: File[]) => {
    if (!projectId) return;
    const media = dropped.filter(
      (file) =>
        file.type.startsWith("image/") || file.type.startsWith("video/"),
    );
    const promptFile = dropped.find(
      (file) =>
        file.type === "text/plain" || file.name.toLowerCase().endsWith(".txt"),
    );
    const promptText = promptFile
      ? (await promptFile.text()).trim().slice(0, 4000)
      : "";

    if (openDirection && !composer) {
      if (media.length === 0) {
        setUploadState({ done: 0, total: 0, error: "Drop images or videos." });
        return;
      }
      await uploadFilesToDirection(
        media,
        openDirection.folderId as string,
        promptText,
        tabOf(openDirection.section),
      );
      return;
    }

    setComposer((prev) => ({
      name: prev?.name ?? "",
      layer:
        prev?.layer ??
        (effectiveTab !== "all" && effectiveTab !== "unsorted"
          ? effectiveTab
          : null),
      files: [...(prev?.files ?? []), ...media],
      prompt: [prev?.prompt, promptText].filter(Boolean).join("\n\n"),
    }));
  };

  // Approve the drafted direction: create it under the chosen layer, attach
  // it to the project, upload the staged files, and drill in.
  const approveComposer = async () => {
    if (!composer || !projectId) return;
    const name = composer.name.trim();
    if (!name) return;
    const { files, prompt, layer } = composer;
    try {
      const created = await createFolder({
        ownerUserId,
        name,
        description: prompt.trim() || undefined,
      });
      await addCollection({
        ownerUserId,
        projectId: projectId as Id<"folders">,
        folderId: created.folderId,
        section: layer ?? undefined,
      });
      setComposer(null);
      setOpenDirectionId(created.folderId as string);
      if (files.length > 0) {
        await uploadFilesToDirection(
          files,
          created.folderId as string,
          prompt.trim(),
          layer ?? "unsorted",
        );
      }
    } catch (error) {
      setUploadState({
        done: 0,
        total: files.length,
        error:
          error instanceof Error ? error.message : "Could not create direction.",
      });
    }
  };

  const dragHasFiles = (event: React.DragEvent) =>
    Array.from(event.dataTransfer?.types ?? []).includes("Files");

  const dropTargetLabel =
    openDirection && !composer
      ? `Drop to add to ${openDirection.name}`
      : composer
        ? "Drop to stage in the new direction"
        : "Drop to draft a new direction";

  // Set (or clear, when assetId is null) a direction's MASTER option.
  const setMaster = useCallback(
    (collectionId: string, assetId: string | null) => {
      setCoverOverride((prev) => ({ ...prev, [collectionId]: assetId }));
      void setFolderCover({
        ownerUserId,
        folderId: collectionId as Id<"folders">,
        assetId: assetId as Id<"assets"> | null,
      }).catch(() => {
        // Roll back to server truth on failure.
        setCoverOverride((prev) => {
          const next = { ...prev };
          delete next[collectionId];
          return next;
        });
      });
    },
    [ownerUserId, setFolderCover],
  );

  // Remove an asset's membership in the drilled direction — other collection
  // memberships stay intact; the asset is never deleted from the gallery.
  const removeFromDirection = useCallback(
    (asset: ReviewAsset) => {
      if (!openDirectionId) return;
      const next = asset.folderIds.filter((id) => id !== openDirectionId);
      void setAssetFolders({
        ownerUserId,
        assetId: asset.id as Id<"assets">,
        folderIds: next as Id<"folders">[],
      });
    },
    [openDirectionId, ownerUserId, setAssetFolders],
  );

  // Refile a direction under another layer (null = unsorted).
  const refileDirection = useCallback(
    (collectionId: string, section: ProjectSection | null) => {
      if (!projectId) return;
      void setCollectionSection({
        ownerUserId,
        projectId: projectId as Id<"folders">,
        folderId: collectionId as Id<"folders">,
        section,
      });
    },
    [ownerUserId, projectId, setCollectionSection],
  );

  // Update one side of a beat's pairing, preserving the other side.
  const updateBeatPairing = useCallback(
    (
      collection: ProjectCollection,
      side: "character" | "location",
      value: string,
    ) => {
      if (!projectId) return;
      const nextCharacter =
        side === "character"
          ? value
            ? (value as Id<"folders">)
            : null
          : ((collection.beatCharacterFolderId as Id<"folders">) ?? null);
      const nextLocation =
        side === "location"
          ? value
            ? (value as Id<"folders">)
            : null
          : ((collection.beatLocationFolderId as Id<"folders">) ?? null);
      void setBeatPairingMutation({
        ownerUserId,
        projectId: projectId as Id<"folders">,
        folderId: collection.folderId,
        characterFolderId: nextCharacter,
        locationFolderId: nextLocation,
      });
    },
    [ownerUserId, projectId, setBeatPairingMutation],
  );

  const goFocus = useCallback((delta: number) => {
    setFocusId((current) => {
      if (!current) return current;
      const idx = visibleAssets.findIndex((a) => a.id === current);
      if (idx < 0) return current;
      const nextIdx = Math.min(
        visibleAssets.length - 1,
        Math.max(0, idx + delta),
      );
      return visibleAssets[nextIdx]?.id ?? current;
    });
  }, [visibleAssets]);

  // Keyboard: Esc backs out (focus → grid → close); arrows navigate in focus.
  useEffect(() => {
    if (!projectId) return;
    const onKey = (e: KeyboardEvent) => {
      // Typing in an input (rename, picker create, pairing selects) must not
      // trigger the modal shortcuts — Space would approve, Esc would drill out.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (shareOpen) setShareOpen(false);
        else if (pickerOpen) setPickerOpen(false);
        else if (composerOpen) setComposer(null);
        else if (focusId) setFocusId(null);
        else if (openDirectionId) setOpenDirectionId(null);
        else onClose();
      } else if (focusId && e.key === "ArrowLeft") {
        e.preventDefault();
        goFocus(-1);
      } else if (focusId && e.key === "ArrowRight") {
        e.preventDefault();
        goFocus(1);
      } else if (focusId && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        if (focusAsset) toggleApprove(focusAsset);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [projectId, pickerOpen, shareOpen, composerOpen, focusId, focusAsset, openDirectionId, goFocus, toggleApprove, onClose]);

  if (!projectId) return null;

  const isLoading = project === undefined;
  const projectName = project?.project.name ?? "Project";
  const hasCollections = (project?.collections.length ?? 0) > 0;

  // Layer tabs: All + the three layers (+ Unsorted only when needed).
  const allCollections2 = project?.collections ?? [];
  const directionCountBy = (tab: ReviewTab) =>
    allCollections2.filter((c) => tabOf(c.section) === tab).length;
  const unsortedCount = directionCountBy("unsorted");
  const tabs: { key: ReviewTab; label: string; count?: number }[] = [
    { key: "all", label: "All" },
    ...SECTION_TABS.map(({ key, label }) => ({
      key: key as ReviewTab,
      label,
      count: directionCountBy(key),
    })),
    ...(unsortedCount > 0
      ? [{ key: "unsorted" as ReviewTab, label: "Unsorted", count: unsortedCount }]
      : []),
  ];

  // Direction-cards browsing mode: a layer tab with nothing drilled into.
  const showDirectionCards = effectiveTab !== "all" && !openDirection;
  const openDirectionMasterId = openDirection
    ? resolveCoverId(openDirection)
    : null;

  return (
    <div
      className="fixed inset-y-0 left-0 right-0 z-[80] flex flex-col lm-animate-fade-in transition-[left] duration-200 md:left-[var(--review-left)]"
      style={{
        ["--review-left" as string]: leftOffset ?? "0px",
        backgroundColor: "rgba(8,7,6,0.985)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        fontFamily: "var(--lm-font)",
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`Review: ${projectName}`}
      onDragEnter={(event) => {
        if (!dragHasFiles(event)) return;
        event.preventDefault();
        dragDepthRef.current += 1;
        setDragFilesOver(true);
      }}
      onDragOver={(event) => {
        if (!dragHasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (!dragHasFiles(event)) return;
        event.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setDragFilesOver(false);
      }}
      onDrop={(event) => {
        if (!dragHasFiles(event)) return;
        event.preventDefault();
        dragDepthRef.current = 0;
        setDragFilesOver(false);
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length > 0) void handleFilesDrop(files);
      }}
    >
      {/* ── Header ── */}
      <header
        className="flex items-center gap-3 px-4 py-3 md:px-6"
        style={{ borderBottom: "1px solid var(--lm-border-strong)" }}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="text-[10px] font-mono font-bold uppercase tracking-[0.16em]"
            style={{ color: "var(--lm-coral)" }}
          >
            Review
          </span>
          <span
            className="truncate text-[15px] font-semibold"
            style={{ color: "var(--lm-text-primary)" }}
          >
            {projectName}
          </span>
          <span
            className="shrink-0 text-[11px]"
            style={{ color: "var(--lm-text-tertiary)" }}
          >
            {showDirectionCards
              ? `${directions.length} ${
                  directions.length === 1 ? "direction" : "directions"
                }`
              : `${visibleAssets.length} shown · ${approvedCount} approved`}
          </span>
          {uploadState && (
            <span
              className="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider"
              style={{
                backgroundColor: uploadState.error
                  ? "color-mix(in srgb, var(--lm-coral) 22%, transparent)"
                  : "var(--lm-surface-2)",
                color: uploadState.error
                  ? "var(--lm-coral)"
                  : "var(--lm-text-secondary)",
              }}
              role="status"
            >
              {uploadState.error
                ? uploadState.error
                : uploadState.done < uploadState.total
                  ? `Uploading ${uploadState.done + 1}/${uploadState.total}…`
                  : `Uploaded ${uploadState.total}`}
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {inFocus && (
            <button
              type="button"
              onClick={() => setFocusId(null)}
              className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-mono font-bold uppercase tracking-wider transition-opacity hover:opacity-80"
              style={{
                borderColor: "var(--lm-border-strong)",
                color: "var(--lm-text-secondary)",
              }}
              title="Back to grid (Esc)"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Grid
            </button>
          )}
          {totalLikes > 0 && (
            <button
              type="button"
              onClick={() => setLikedOnly((v) => !v)}
              className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-mono font-bold uppercase tracking-wider transition-colors"
              style={{
                borderColor: likedOnly
                  ? "var(--lm-coral)"
                  : "var(--lm-border-strong)",
                backgroundColor: likedOnly ? "var(--lm-coral)" : "transparent",
                color: likedOnly ? "#000" : "var(--lm-text-secondary)",
              }}
              aria-pressed={likedOnly}
              title="Show only assets liked on the shared board"
            >
              <Heart className="h-3.5 w-3.5" />
              Liked {totalLikes}
            </button>
          )}
          <button
            type="button"
            onClick={() => setApprovedOnly((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-mono font-bold uppercase tracking-wider transition-colors"
            style={{
              borderColor: approvedOnly
                ? "var(--lm-coral)"
                : "var(--lm-border-strong)",
              backgroundColor: approvedOnly ? "var(--lm-coral)" : "transparent",
              color: approvedOnly ? "#000" : "var(--lm-text-secondary)",
            }}
            aria-pressed={approvedOnly}
            title="Show only approved"
          >
            <Check className="h-3.5 w-3.5" />
            Approved
          </button>
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-mono font-bold uppercase tracking-wider transition-opacity hover:opacity-80"
            style={{
              borderColor: "var(--lm-border-strong)",
              color: "var(--lm-text-secondary)",
            }}
            title="Add or remove collections"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            Collections
          </button>
          <button
            type="button"
            onClick={() => setShareOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-mono font-bold uppercase tracking-wider transition-opacity hover:opacity-80"
            style={{
              borderColor: shareState?.enabled
                ? "var(--lm-coral)"
                : "var(--lm-border-strong)",
              color: shareState?.enabled
                ? "var(--lm-coral)"
                : "var(--lm-text-secondary)",
            }}
            title="Share a read-only direction board link"
          >
            <Link2 className="h-3.5 w-3.5" />
            Share
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg border transition-opacity hover:opacity-80"
            style={{
              borderColor: "var(--lm-border-strong)",
              color: "var(--lm-text-secondary)",
            }}
            aria-label="Close review"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* ── Layer tabs ── */}
      {hasCollections && !inFocus && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 md:px-6">
          {tabs.map((tab) => {
            const active = effectiveTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  setActiveTab(tab.key);
                  setOpenDirectionId(null);
                }}
                className="rounded-full border px-3 py-1 text-[12px] font-medium transition-colors"
                style={{
                  borderColor: active
                    ? "var(--lm-coral)"
                    : "var(--lm-border-strong)",
                  backgroundColor: active
                    ? "color-mix(in srgb, var(--lm-coral) 16%, transparent)"
                    : "transparent",
                  color: active
                    ? "var(--lm-coral)"
                    : "var(--lm-text-secondary)",
                }}
              >
                {tab.label}
                {tab.count !== undefined && tab.count > 0 && (
                  <span style={{ opacity: 0.6 }}> {tab.count}</span>
                )}
              </button>
            );
          })}

          {/* New direction in the active layer — or just drop files anywhere */}
          <button
            type="button"
            onClick={() =>
              setComposer(
                (prev) =>
                  prev ?? {
                    name: "",
                    layer:
                      effectiveTab !== "all" && effectiveTab !== "unsorted"
                        ? effectiveTab
                        : null,
                    files: [],
                    prompt: "",
                  },
              )
            }
            className="flex items-center gap-1 rounded-full border border-dashed px-3 py-1 text-[12px] font-medium transition-opacity hover:opacity-80"
            style={{
              borderColor: "var(--lm-border-strong)",
              color: "var(--lm-text-tertiary)",
            }}
            title="Create a direction in this layer — or drop files anywhere to create one from them"
          >
            <Plus className="h-3 w-3" />
            New direction
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1 rounded-full border border-dashed px-3 py-1 text-[12px] font-medium transition-opacity hover:opacity-80"
            style={{
              borderColor: "var(--lm-border-strong)",
              color: "var(--lm-text-tertiary)",
            }}
            title={dropTargetLabel.replace("Drop", "Pick files")}
          >
            <Upload className="h-3 w-3" />
            Upload files
          </button>
          <span
            className="hidden text-[10px] font-mono uppercase tracking-wider md:inline"
            style={{ color: "var(--lm-text-ghost)" }}
          >
            or drop anywhere
          </span>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*,.txt"
            className="hidden"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              if (files.length > 0) void handleFilesDrop(files);
            }}
          />
        </div>
      )}

      {/* ── Tag filter chips (flat + drilled views) ── */}
      {hasCollections && !inFocus && !showDirectionCards && tagCounts.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2 md:px-6">
          {tagCounts.map(([tag, count]) => {
            const active = activeTag === tag;
            return (
              <button
                key={tag}
                type="button"
                onClick={() => setSelectedTag(active ? null : tag)}
                className="rounded-full border px-2.5 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider transition-colors"
                style={{
                  borderColor: active
                    ? "var(--lm-coral)"
                    : "var(--lm-border)",
                  backgroundColor: active
                    ? "color-mix(in srgb, var(--lm-coral) 16%, transparent)"
                    : "transparent",
                  color: active ? "var(--lm-coral)" : "var(--lm-text-ghost)",
                }}
                aria-pressed={active}
              >
                {tag}
                <span style={{ opacity: 0.6 }}> {count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Drilled direction breadcrumb ── */}
      {openDirection && !inFocus && (
        <div className="flex flex-wrap items-center gap-2 px-4 pb-2.5 md:px-6">
          <button
            type="button"
            onClick={() => setOpenDirectionId(null)}
            className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-mono font-bold uppercase tracking-wider transition-opacity hover:opacity-80"
            style={{
              borderColor: "var(--lm-border-strong)",
              color: "var(--lm-text-secondary)",
            }}
            title="Back to directions (Esc)"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {TAB_LABELS[effectiveTab]}
          </button>
          {renameDraft !== null ? (
            <input
              autoFocus
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const name = renameDraft.trim();
                  setRenameDraft(null);
                  if (!name || name === openDirection.name) return;
                  void updateFolder({
                    ownerUserId,
                    folderId: openDirection.folderId,
                    name,
                  });
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setRenameDraft(null);
                }
              }}
              onBlur={() => {
                const name = (renameDraft ?? "").trim();
                setRenameDraft(null);
                if (!name || name === openDirection.name) return;
                void updateFolder({
                  ownerUserId,
                  folderId: openDirection.folderId,
                  name,
                });
              }}
              className="w-[220px] rounded-lg border px-2 py-1 text-[14px] font-semibold outline-none"
              style={{
                backgroundColor: "var(--lm-surface-2)",
                borderColor: "var(--lm-coral)",
                color: "var(--lm-text-primary)",
              }}
              aria-label="Rename direction"
            />
          ) : (
            <>
              <span
                className="truncate text-[14px] font-semibold"
                style={{ color: "var(--lm-text-primary)" }}
              >
                {openDirection.name}
              </span>
              <button
                type="button"
                onClick={() => setRenameDraft(openDirection.name)}
                className="flex h-6 w-6 items-center justify-center rounded-md transition-opacity hover:opacity-70"
                style={{ color: "var(--lm-text-ghost)" }}
                aria-label="Rename direction"
                title="Rename this direction"
              >
                <Pencil className="h-3 w-3" />
              </button>
            </>
          )}
          <span
            className="text-[11px]"
            style={{ color: "var(--lm-text-tertiary)" }}
          >
            {openDirection.count}{" "}
            {openDirection.count === 1 ? "option" : "options"}
          </span>
          <a
            href={`/api/projects/direction-pdf?projectId=${encodeURIComponent(
              projectId ?? "",
            )}&folderId=${encodeURIComponent(openDirection.folderId as string)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-mono font-bold uppercase tracking-wider transition-opacity hover:opacity-80"
            style={{
              borderColor: "var(--lm-border-strong)",
              color: "var(--lm-text-secondary)",
            }}
            title="Package this direction as a PDF (images embedded, videos as links)"
          >
            <FileDown className="h-3.5 w-3.5" />
            PDF
          </a>

          {/* Refile this direction under another layer */}
          <div className="ml-auto flex items-center gap-1.5">
            <span
              className="text-[9px] font-mono font-bold uppercase tracking-[0.14em]"
              style={{ color: "var(--lm-text-ghost)" }}
            >
              Layer
            </span>
            {SECTION_TABS.map(({ key, label }) => {
              const current = tabOf(openDirection.section) === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() =>
                    refileDirection(
                      openDirection.folderId as string,
                      current ? null : key,
                    )
                  }
                  className="rounded-full border px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider transition-colors"
                  style={{
                    borderColor: current
                      ? "var(--lm-coral)"
                      : "var(--lm-border-strong)",
                    color: current
                      ? "var(--lm-coral)"
                      : "var(--lm-text-tertiary)",
                  }}
                  aria-pressed={current}
                  title={
                    current
                      ? `Filed under ${label} — click to unfile`
                      : `File under ${label}`
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Beat pairing: which character + location this beat combines */}
          {tabOf(openDirection.section) === "beats" && (
            <div className="flex basis-full flex-wrap items-center gap-2 pt-1">
              <span
                className="text-[9px] font-mono font-bold uppercase tracking-[0.14em]"
                style={{ color: "var(--lm-text-ghost)" }}
              >
                Pairs
              </span>
              {(
                [
                  ["character", "characters", openDirection.beatCharacterFolderId],
                  ["location", "locations", openDirection.beatLocationFolderId],
                ] as const
              ).map(([side, sectionKey, currentId]) => (
                <select
                  key={side}
                  value={(currentId as string | undefined) ?? ""}
                  onChange={(e) =>
                    updateBeatPairing(openDirection, side, e.target.value)
                  }
                  className="rounded-lg border px-2 py-1 text-[11px] outline-none"
                  style={{
                    backgroundColor: "var(--lm-surface-2)",
                    borderColor: "var(--lm-border-strong)",
                    color: currentId
                      ? "var(--lm-text-primary)"
                      : "var(--lm-text-tertiary)",
                  }}
                  aria-label={`Paired ${side} direction`}
                >
                  <option value="">No {side}</option>
                  {(project?.collections ?? [])
                    .filter(
                      (c) =>
                        tabOf(c.section) === sectionKey &&
                        c.folderId !== openDirection.folderId,
                    )
                    .map((c) => (
                      <option key={c.folderId} value={c.folderId as string}>
                        {c.name}
                      </option>
                    ))}
                </select>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Body ── */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {isLoading ? (
          <div
            className="flex h-full items-center justify-center text-[13px]"
            style={{ color: "var(--lm-text-tertiary)" }}
          >
            Loading project…
          </div>
        ) : composer ? (
          <div className="h-full overflow-y-auto px-6 py-10 md:px-12">
            <div className="mx-auto max-w-[720px]">
              <p
                className="text-[10px] font-mono font-bold uppercase tracking-[0.2em]"
                style={{ color: "var(--lm-coral)" }}
              >
                New direction
              </p>

              <input
                autoFocus
                value={composer.name}
                onChange={(e) =>
                  setComposer((prev) =>
                    prev ? { ...prev, name: e.target.value } : prev,
                  )
                }
                placeholder="Name the direction…"
                className="mt-3 w-full bg-transparent pb-2 text-[26px] font-semibold outline-none md:text-[32px]"
                style={{
                  color: "var(--lm-text-primary)",
                  borderBottom: "1px solid var(--lm-border-strong)",
                  caretColor: "var(--lm-coral)",
                }}
                aria-label="Direction name"
              />

              {/* Layer */}
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <span
                  className="text-[9px] font-mono font-bold uppercase tracking-[0.16em]"
                  style={{ color: "var(--lm-text-ghost)" }}
                >
                  Layer
                </span>
                {SECTION_TABS.map(({ key, label }) => {
                  const active = composer.layer === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() =>
                        setComposer((prev) =>
                          prev
                            ? { ...prev, layer: active ? null : key }
                            : prev,
                        )
                      }
                      className="rounded-full border px-3 py-1 text-[11px] font-mono font-bold uppercase tracking-wider transition-colors"
                      style={{
                        borderColor: active
                          ? "var(--lm-coral)"
                          : "var(--lm-border-strong)",
                        color: active
                          ? "var(--lm-coral)"
                          : "var(--lm-text-tertiary)",
                      }}
                      aria-pressed={active}
                    >
                      {label}
                    </button>
                  );
                })}
                <span
                  className="text-[10px] font-mono uppercase tracking-wider"
                  style={{ color: "var(--lm-text-ghost)" }}
                >
                  {composer.layer ? "" : "unsorted"}
                </span>
              </div>

              {/* Text */}
              <textarea
                value={composer.prompt}
                onChange={(e) =>
                  setComposer((prev) =>
                    prev ? { ...prev, prompt: e.target.value } : prev,
                  )
                }
                placeholder="Optional text — the prompt, the beat, notes…"
                rows={3}
                className="mt-6 w-full resize-y bg-transparent text-[14px] leading-relaxed outline-none"
                style={{
                  color: "var(--lm-text-secondary)",
                  borderBottom: "1px solid var(--lm-border)",
                  caretColor: "var(--lm-coral)",
                }}
                aria-label="Direction text"
              />

              {/* Staged files */}
              <div className="mt-6">
                <div className="flex items-baseline gap-3">
                  <span
                    className="text-[9px] font-mono font-bold uppercase tracking-[0.16em]"
                    style={{ color: "var(--lm-text-ghost)" }}
                  >
                    Files
                  </span>
                  <span
                    className="text-[11px]"
                    style={{ color: "var(--lm-text-tertiary)" }}
                  >
                    {composer.files.length === 0
                      ? "Drop images and video anywhere, or"
                      : `${composer.files.length} staged — drop more anywhere, or`}
                  </span>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-[11px] underline underline-offset-4 transition-opacity hover:opacity-80"
                    style={{ color: "var(--lm-coral)" }}
                  >
                    browse
                  </button>
                </div>
                {composerPreviews.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-3">
                    {composerPreviews.map(({ file, url }, index) => (
                      <div key={`${file.name}-${index}`} className="group/stage relative">
                        {file.type.startsWith("video/") ? (
                          <video
                            src={url}
                            muted
                            playsInline
                            preload="metadata"
                            className="h-24 rounded-lg object-cover"
                          />
                        ) : (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={url}
                            alt={file.name}
                            className="h-24 rounded-lg object-cover"
                          />
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            setComposer((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    files: prev.files.filter(
                                      (_, i) => i !== index,
                                    ),
                                  }
                                : prev,
                            )
                          }
                          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full opacity-0 transition-opacity group-hover/stage:opacity-100"
                          style={{
                            backgroundColor: "var(--lm-ink)",
                            color: "var(--lm-paper)",
                          }}
                          aria-label={`Remove ${file.name}`}
                        >
                          <X className="h-3 w-3" strokeWidth={3} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Approve / discard */}
              <div
                className="mt-8 flex items-center gap-3 border-t pt-5"
                style={{ borderColor: "var(--lm-border)" }}
              >
                <button
                  type="button"
                  onClick={() => void approveComposer()}
                  disabled={!composer.name.trim()}
                  className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12px] font-mono font-bold uppercase tracking-wider transition-opacity hover:opacity-90 disabled:opacity-40"
                  style={{ backgroundColor: "var(--lm-coral)", color: "#000" }}
                  title={
                    composer.name.trim()
                      ? "Create the direction and upload the staged files"
                      : "Name the direction first"
                  }
                >
                  <Check className="h-3.5 w-3.5" strokeWidth={3} />
                  Approve direction
                </button>
                <button
                  type="button"
                  onClick={() => setComposer(null)}
                  className="text-[11px] font-mono font-bold uppercase tracking-wider transition-opacity hover:opacity-80"
                  style={{ color: "var(--lm-text-tertiary)" }}
                >
                  Discard
                </button>
                {!composer.name.trim() && composer.files.length > 0 && (
                  <span
                    className="text-[11px]"
                    style={{ color: "var(--lm-text-tertiary)" }}
                  >
                    Name it to approve.
                  </span>
                )}
              </div>
            </div>
          </div>
        ) : !hasCollections ? (
          <EmptyState
            title="No directions yet"
            hint="A direction is one take — images, video, and a text prompt together. Drop files anywhere to start one, or create it by name. Existing collections can also be attached."
            actionLabel="Add direction"
            onAction={() =>
              setComposer({ name: "", layer: null, files: [], prompt: "" })
            }
          />
        ) : showDirectionCards ? (
          directions.length === 0 ? (
            <EmptyState
              title={`No directions in ${TAB_LABELS[effectiveTab]} yet`}
              hint="A direction is a collection of similar options with a master thumbnail. Add or create one for this layer."
              actionLabel="Add direction"
              onAction={() => setPickerOpen(true)}
            />
          ) : (
            <div className="h-full overflow-y-auto px-4 pb-10 pt-1 md:px-6">
              <div
                className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4"
                style={{ columnGap: "14px" }}
              >
                {directions.map((direction) => (
                  <DirectionCard
                    key={direction.id}
                    direction={direction}
                    onOpen={() => setOpenDirectionId(direction.id)}
                  />
                ))}
              </div>
            </div>
          )
        ) : visibleAssets.length === 0 ? (
          <EmptyState
            title={approvedOnly ? "Nothing approved yet" : "No assets here"}
            hint={
              approvedOnly
                ? "Approve options to build the showcase shortlist."
                : "This collection has no assets."
            }
          />
        ) : focusAsset ? (
          <FocusScrollFeed
            assets={visibleAssets}
            focusId={focusAsset.id}
            onFocusChange={setFocusId}
            isApproved={isApproved}
            onToggleApprove={toggleApprove}
            likesByAsset={likesByAsset}
            masterId={openDirection ? openDirectionMasterId : null}
            onMaster={
              openDirection
                ? (asset) =>
                    setMaster(
                      openDirection.folderId as string,
                      openDirectionMasterId === asset.id ? null : asset.id,
                    )
                : undefined
            }
            onRemove={openDirection ? removeFromDirection : undefined}
            showCollectionLabel={effectiveTab === "all"}
          />
        ) : (
          <div className="h-full overflow-y-auto px-4 pb-10 pt-1 md:px-6">
            <div
              className="columns-1 sm:columns-2 lg:columns-3"
              style={{ columnGap: "14px" }}
            >
              {visibleAssets.map((asset) => (
                <ReviewTile
                  key={asset.id}
                  asset={asset}
                  approved={isApproved(asset)}
                  likes={likesByAsset.get(asset.id)}
                  onOpen={() => setFocusId(asset.id)}
                  onApprove={() => toggleApprove(asset)}
                  showCollectionLabel={effectiveTab === "all"}
                  isMaster={
                    openDirection ? openDirectionMasterId === asset.id : undefined
                  }
                  onMaster={
                    openDirection
                      ? () =>
                          setMaster(
                            openDirection.folderId as string,
                            openDirectionMasterId === asset.id
                              ? null
                              : asset.id,
                          )
                      : undefined
                  }
                  onRemove={
                    openDirection ? () => removeFromDirection(asset) : undefined
                  }
                  onFileCharacter={
                    openDirection
                      ? () => void fileAssetToLayer(asset, "characters")
                      : undefined
                  }
                  onFileLocation={
                    openDirection
                      ? () => void fileAssetToLayer(asset, "locations")
                      : undefined
                  }
                  filedCharacter={isFiledToLayer(asset, "characters")}
                  filedLocation={isFiledToLayer(asset, "locations")}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── File drop overlay ── */}
      {dragFilesOver && (
        <div
          className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center"
          style={{ backgroundColor: "rgba(8,7,6,0.72)" }}
        >
          <div
            className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-10 py-8"
            style={{
              borderColor: "var(--lm-coral)",
              backgroundColor: "var(--lm-surface-1)",
            }}
          >
            <Upload className="h-8 w-8" style={{ color: "var(--lm-coral)" }} />
            <p
              className="text-[15px] font-semibold"
              style={{ color: "var(--lm-text-primary)" }}
            >
              {dropTargetLabel}
            </p>
            <p
              className="text-[11px] font-mono uppercase tracking-wider"
              style={{ color: "var(--lm-text-tertiary)" }}
            >
              Images &amp; videos · a .txt becomes the prompt
              {effectiveTab === "beats" || tabOf(openDirection?.section) === "beats"
                ? " · the video becomes the master"
                : ""}
            </p>
          </div>
        </div>
      )}

      {/* ── Share panel ── */}
      {shareOpen && (
        <SharePanel
          token={shareState?.token}
          onEnable={async () => {
            if (!projectId) return "";
            const { token } = await enableShare({
              ownerUserId,
              projectId: projectId as Id<"folders">,
            });
            return token;
          }}
          onDisable={async () => {
            if (!projectId) return;
            await disableShare({
              ownerUserId,
              projectId: projectId as Id<"folders">,
            });
          }}
          onClose={() => setShareOpen(false)}
        />
      )}

      {/* ── Add-collections picker ── */}
      {pickerOpen && (
        <CollectionPicker
          allCollections={allCollections}
          memberIds={memberCollectionIds}
          // Adding from a layer tab files the collection into that layer.
          section={
            effectiveTab !== "all" && effectiveTab !== "unsorted" ? effectiveTab : null
          }
          onToggle={(folderId, isMember) => {
            if (!projectId) return;
            if (isMember) {
              void removeCollection({
                ownerUserId,
                projectId: projectId as Id<"folders">,
                folderId: folderId as Id<"folders">,
              });
            } else {
              void addCollection({
                ownerUserId,
                projectId: projectId as Id<"folders">,
                folderId: folderId as Id<"folders">,
                section:
                  effectiveTab !== "all" && effectiveTab !== "unsorted"
                    ? effectiveTab
                    : undefined,
              });
            }
          }}
          onCreate={(name) => {
            if (!projectId) return;
            void (async () => {
              const { folderId } = await createFolder({ ownerUserId, name });
              await addCollection({
                ownerUserId,
                projectId: projectId as Id<"folders">,
                folderId,
                section:
                  effectiveTab !== "all" && effectiveTab !== "unsorted"
                    ? effectiveTab
                    : undefined,
              });
            })();
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

/* ── Direction card: a stacked deck of similar options, master on top ── */
function DirectionCard({
  direction,
  onOpen,
}: {
  direction: DirectionCardData;
  onOpen: () => void;
}) {
  const cover = direction.cover;
  // Hover 1s → rotate through the direction's options in place.
  const preview = useStackHoverPreview(direction.previews.length);
  return (
    <div
      className="group relative mb-5 block break-inside-avoid cursor-pointer"
      style={{
        aspectRatio:
          cover?.width && cover?.height
            ? `${cover.width} / ${cover.height}`
            : "4 / 5",
      }}
      onClick={onOpen}
      onMouseEnter={preview.start}
      onMouseLeave={preview.stop}
      role="button"
      aria-label={`Open direction: ${direction.name}`}
    >
      {/* Fanned deck — next variations peeking behind the master */}
      {direction.backs.map((src, index) => (
        <div
          key={`${direction.id}-back-${index}`}
          className="absolute inset-0 overflow-hidden rounded-xl transition-transform duration-200 ease-out"
          style={{
            border: "1px solid var(--lm-border)",
            backgroundColor: "var(--lm-surface-2)",
            transform:
              index === 0
                ? "rotate(-2deg) translate(-6px, 5px) scale(0.985)"
                : "rotate(2.6deg) translate(7px, 7px) scale(0.97)",
            zIndex: index === 0 ? 2 : 1,
          }}
        >
          <img
            src={src}
            alt=""
            aria-hidden
            className="h-full w-full object-cover"
            style={{ opacity: 0.85 }}
            loading="lazy"
          />
        </div>
      ))}

      {/* Master on top */}
      <div
        className="absolute inset-0 z-[3] overflow-hidden rounded-xl transition-transform duration-200 ease-out group-hover:-translate-y-[3px]"
        style={{
          border: "2px solid var(--lm-border-strong)",
          backgroundColor: "var(--lm-surface-1)",
          boxShadow: "0 6px 18px rgba(0,0,0,0.45)",
        }}
      >
        {cover ? (
          <Media asset={cover} variant="tile" />
        ) : (
          <div
            className="absolute inset-0 flex items-center justify-center text-[11px] font-mono uppercase tracking-wider"
            style={{
              backgroundColor: "var(--lm-surface-2)",
              color: "var(--lm-text-ghost)",
            }}
          >
            Empty
          </div>
        )}

        <StackHoverPreviewOverlay
          previews={direction.previews}
          index={preview.index}
          engaged={preview.engaged}
        />

        {/* Option count badge — turns into a n/N counter while previewing */}
        <span
          className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider"
          style={{
            backgroundColor: "rgba(0,0,0,0.62)",
            color: "var(--lm-coral)",
            border:
              "1px solid color-mix(in srgb, var(--lm-coral) 42%, transparent)",
          }}
        >
          {preview.engaged
            ? `${(preview.index % direction.previews.length) + 1}/${direction.previews.length}`
            : direction.count}
        </span>

        {/* Bottom label over a gradient so any master image stays readable */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-24"
          style={{
            background:
              "linear-gradient(to top, rgba(0,0,0,0.74), rgba(0,0,0,0.28) 60%, transparent)",
          }}
        />
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3">
          <div className="min-w-0">
            <p
              className="text-[9px] font-mono font-bold uppercase tracking-[0.16em]"
              style={{ color: "var(--lm-coral)" }}
            >
              Direction
            </p>
            <p
              className="truncate text-[14px] font-semibold"
              style={{ color: "#fff", textShadow: "0 1px 4px rgba(0,0,0,0.8)" }}
            >
              {direction.name}
            </p>
            <p
              className="text-[10px] font-mono font-bold uppercase tracking-wider"
              style={{ color: "rgba(255,255,255,0.68)" }}
            >
              {direction.count} {direction.count === 1 ? "option" : "options"}
            </p>
          </div>
          <span
            className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[9px] font-mono font-bold uppercase tracking-wider opacity-0 transition-opacity group-hover:opacity-100"
            style={{ backgroundColor: "rgba(0,0,0,0.62)", color: "#fff" }}
          >
            Explore
            <ChevronRight className="h-3 w-3" />
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── Large masonry tile ── */
function ReviewTile({
  asset,
  approved,
  likes,
  onOpen,
  onApprove,
  showCollectionLabel,
  isMaster,
  onMaster,
  onRemove,
  onFileCharacter,
  onFileLocation,
  filedCharacter,
  filedLocation,
}: {
  asset: ReviewAsset;
  approved: boolean;
  /** Viewer likes from the shared board. */
  likes?: AssetLikes;
  onOpen: () => void;
  onApprove: () => void;
  showCollectionLabel: boolean;
  /** Only defined inside a drilled direction, where "master" is unambiguous. */
  isMaster?: boolean;
  onMaster?: () => void;
  /** Removes the asset from the drilled direction (membership only). */
  onRemove?: () => void;
  /** File into the project's Characters / Locations layer (toggle). */
  onFileCharacter?: () => void;
  onFileLocation?: () => void;
  filedCharacter?: boolean;
  filedLocation?: boolean;
}) {
  return (
    <div
      className="group relative mb-3.5 block break-inside-avoid cursor-pointer overflow-hidden rounded-xl"
      style={{
        border: approved
          ? "2px solid var(--lm-coral)"
          : "1px solid var(--lm-border-subtle)",
        backgroundColor: "var(--lm-surface-1)",
      }}
      onClick={onOpen}
    >
      <div
        className="relative w-full"
        style={{
          aspectRatio:
            asset.width && asset.height
              ? `${asset.width} / ${asset.height}`
              : "1 / 1",
        }}
      >
        <Media asset={asset} variant="tile" />
      </div>

      {/* Viewer likes + approve, grouped top-right */}
      <div className="absolute right-2.5 top-2.5 z-10 flex items-center gap-1">
        {likes && likes.count > 0 && (
          <span
            className="flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-mono font-bold uppercase tracking-wider"
            style={{
              backgroundColor: "rgba(0,0,0,0.62)",
              color: "var(--lm-coral)",
              borderColor:
                "color-mix(in srgb, var(--lm-coral) 42%, transparent)",
            }}
            title={likeTitle(likes)}
          >
            <Heart className="h-3 w-3" fill="currentColor" strokeWidth={2.5} />
            {likes.count}
          </span>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onApprove();
          }}
          className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-mono font-bold uppercase tracking-wider transition-all ${
            approved
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100"
          }`}
          style={{
            backgroundColor: approved ? "var(--lm-coral)" : "rgba(0,0,0,0.62)",
            color: approved ? "#000" : "#fff",
            borderColor: approved ? "var(--lm-coral)" : "rgba(255,255,255,0.25)",
          }}
          aria-pressed={approved}
          title={approved ? "Approved — click to remove" : "Approve"}
        >
          <Check className="h-3 w-3" strokeWidth={3} />
          {approved ? "Approved" : "Approve"}
        </button>
      </div>

      {/* Master (direction thumbnail) toggle */}
      {onMaster && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onMaster();
          }}
          className={`absolute left-2.5 top-2.5 z-10 flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-mono font-bold uppercase tracking-wider transition-all ${
            isMaster ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
          style={{
            backgroundColor: isMaster ? "var(--lm-ink)" : "rgba(0,0,0,0.62)",
            color: isMaster ? "var(--lm-paper)" : "#fff",
            borderColor: isMaster
              ? "var(--lm-ink)"
              : "rgba(255,255,255,0.25)",
          }}
          aria-pressed={Boolean(isMaster)}
          title={
            isMaster
              ? "Master option — click to unset"
              : "Make master (direction thumbnail)"
          }
        >
          <Crown className="h-3 w-3" strokeWidth={2.5} />
          Master
        </button>
      )}

      {showCollectionLabel && (
        <div
          className="absolute bottom-2.5 left-2.5 z-10 rounded-md px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider opacity-0 transition-opacity group-hover:opacity-100"
          style={{ backgroundColor: "rgba(0,0,0,0.62)", color: "#fff" }}
        >
          {asset.collectionName}
        </div>
      )}

      {/* File into the project's Characters / Locations layer */}
      {(onFileCharacter || onFileLocation) && (
        <div className="absolute bottom-2.5 left-2.5 z-10 flex items-center gap-1">
          {onFileCharacter && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onFileCharacter();
              }}
              className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-mono font-bold uppercase tracking-wider transition-all ${
                filedCharacter
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100"
              }`}
              style={{
                backgroundColor: filedCharacter
                  ? "var(--lm-coral)"
                  : "rgba(0,0,0,0.62)",
                color: filedCharacter ? "#000" : "#fff",
                borderColor: filedCharacter
                  ? "var(--lm-coral)"
                  : "rgba(255,255,255,0.25)",
              }}
              aria-pressed={Boolean(filedCharacter)}
              title={
                filedCharacter
                  ? "In this project's Characters — click to unfile"
                  : "File into this project's Characters"
              }
            >
              <User className="h-3 w-3" strokeWidth={2.5} />
              Char
            </button>
          )}
          {onFileLocation && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onFileLocation();
              }}
              className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-mono font-bold uppercase tracking-wider transition-all ${
                filedLocation
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100"
              }`}
              style={{
                backgroundColor: filedLocation
                  ? "var(--lm-coral)"
                  : "rgba(0,0,0,0.62)",
                color: filedLocation ? "#000" : "#fff",
                borderColor: filedLocation
                  ? "var(--lm-coral)"
                  : "rgba(255,255,255,0.25)",
              }}
              aria-pressed={Boolean(filedLocation)}
              title={
                filedLocation
                  ? "In this project's Locations — click to unfile"
                  : "File into this project's Locations"
              }
            >
              <MapPin className="h-3 w-3" strokeWidth={2.5} />
              Loc
            </button>
          )}
        </div>
      )}

      {/* Remove from this direction (membership only, asset stays in gallery) */}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="absolute bottom-2.5 right-2.5 z-10 flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-mono font-bold uppercase tracking-wider opacity-0 transition-opacity group-hover:opacity-100"
          style={{
            backgroundColor: "rgba(0,0,0,0.62)",
            color: "#fff",
            borderColor: "rgba(255,255,255,0.25)",
          }}
          title="Remove from this direction (stays in the gallery)"
        >
          <X className="h-3 w-3" strokeWidth={3} />
          Remove
        </button>
      )}
    </div>
  );
}

/* ── Focus feed: full-resolution scroll-through viewer (MJ-style) ── */
function FocusScrollFeed({
  assets,
  focusId,
  onFocusChange,
  isApproved,
  onToggleApprove,
  likesByAsset,
  masterId,
  onMaster,
  onRemove,
  showCollectionLabel,
}: {
  assets: ReviewAsset[];
  focusId: string;
  onFocusChange: (id: string) => void;
  isApproved: (asset: ReviewAsset) => boolean;
  onToggleApprove: (asset: ReviewAsset) => void;
  likesByAsset: Map<string, AssetLikes>;
  /** Current master id when drilled into a direction, else null. */
  masterId: string | null;
  onMaster?: (asset: ReviewAsset) => void;
  onRemove?: (asset: ReviewAsset) => void;
  showCollectionLabel: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const didInitialScrollRef = useRef(false);

  // Keep the viewport on the focused item when focus changes via keyboard;
  // scroll-driven focus changes are already visible so this no-ops.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !focusId) return;
    const el = container.querySelector(
      `[data-focus-id="${CSS.escape(focusId)}"]`,
    );
    if (!el) return;
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const mid = containerRect.top + containerRect.height / 2;
    const visible = elRect.top <= mid && elRect.bottom >= mid;
    if (!visible) {
      el.scrollIntoView({
        behavior: didInitialScrollRef.current ? "smooth" : "auto",
        block: "start",
      });
    }
    didInitialScrollRef.current = true;
  }, [focusId]);

  // Track which item owns the viewport while the user scrolls through.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = entry.target.getAttribute("data-focus-id");
            if (id) onFocusChange(id);
          }
        }
      },
      { root: container, threshold: 0.55 },
    );
    for (const section of container.querySelectorAll("[data-focus-id]")) {
      observer.observe(section);
    }
    return () => observer.disconnect();
  }, [assets, onFocusChange]);

  return (
    <div
      ref={containerRef}
      className="h-full snap-y snap-mandatory overflow-y-auto"
    >
      {assets.map((asset, index) => {
        const approved = isApproved(asset);
        const likes = likesByAsset.get(asset.id);
        const isMaster = masterId !== null && masterId === asset.id;
        return (
          <section
            key={asset.id}
            data-focus-id={asset.id}
            className="flex h-full snap-start flex-col items-center justify-center gap-3 px-4 py-4 md:px-10"
          >
            <div className="flex min-h-0 w-full flex-1 items-center justify-center">
              <Media asset={asset} variant="hero" />
            </div>

            {/* Per-item actions */}
            <div className="flex w-full max-w-[1100px] flex-wrap items-center gap-2 pb-1">
              <span
                className="text-[11px] font-mono"
                style={{ color: "rgba(255,255,255,0.6)" }}
              >
                {index + 1}/{assets.length}
              </span>
              {showCollectionLabel && (
                <span
                  className="rounded-md px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider"
                  style={{ backgroundColor: "rgba(0,0,0,0.55)", color: "#fff" }}
                >
                  {asset.collectionName}
                </span>
              )}
              {likes && likes.count > 0 && (
                <span
                  className="flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-mono font-bold uppercase tracking-wider"
                  style={{
                    backgroundColor: "rgba(0,0,0,0.62)",
                    color: "var(--lm-coral)",
                    borderColor:
                      "color-mix(in srgb, var(--lm-coral) 42%, transparent)",
                  }}
                  title={likeTitle(likes)}
                >
                  <Heart
                    className="h-3 w-3"
                    fill="currentColor"
                    strokeWidth={2.5}
                  />
                  {likes.count}
                </span>
              )}

              <span className="ml-auto flex items-center gap-2">
                {onMaster && (
                  <button
                    type="button"
                    onClick={() => onMaster(asset)}
                    className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-mono font-bold uppercase tracking-wider transition-all active:scale-95"
                    style={{
                      backgroundColor: isMaster
                        ? "var(--lm-ink)"
                        : "rgba(0,0,0,0.62)",
                      color: isMaster ? "var(--lm-paper)" : "#fff",
                      borderColor: isMaster
                        ? "var(--lm-ink)"
                        : "rgba(255,255,255,0.25)",
                    }}
                    aria-pressed={isMaster}
                    title={
                      isMaster
                        ? "Master option — click to unset"
                        : "Make master (direction thumbnail)"
                    }
                  >
                    <Crown className="h-3.5 w-3.5" strokeWidth={2.5} />
                    Master
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onToggleApprove(asset)}
                  className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-mono font-bold uppercase tracking-wider transition-all active:scale-95"
                  style={{
                    backgroundColor: approved
                      ? "var(--lm-coral)"
                      : "rgba(0,0,0,0.62)",
                    color: approved ? "#000" : "#fff",
                    borderColor: approved
                      ? "var(--lm-coral)"
                      : "rgba(255,255,255,0.25)",
                  }}
                  aria-pressed={approved}
                  title="Approve (Space)"
                >
                  <Check className="h-3.5 w-3.5" strokeWidth={3} />
                  {approved ? "Approved" : "Approve"}
                </button>
                {onRemove && (
                  <button
                    type="button"
                    onClick={() => onRemove(asset)}
                    className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-mono font-bold uppercase tracking-wider transition-opacity hover:opacity-80"
                    style={{
                      backgroundColor: "rgba(0,0,0,0.62)",
                      color: "#fff",
                      borderColor: "rgba(255,255,255,0.25)",
                    }}
                    title="Remove from this direction (stays in the gallery)"
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={3} />
                    Remove
                  </button>
                )}
              </span>
            </div>
          </section>
        );
      })}
    </div>
  );
}

/* ── Media renderer (raw img/video, like storybook-modal) ── */
function Media({
  asset,
  variant,
}: {
  asset: ReviewAsset;
  variant: "tile" | "hero" | "thumb";
}) {
  const isVideo = asset.kind === "video";
  const src =
    variant === "hero" ? asset.url ?? asset.thumbUrl : asset.thumbUrl ?? asset.url;

  if (variant === "hero") {
    // Centered, fully visible; parent flex-centers it.
    if (isVideo) {
      return (
        <div className="relative flex max-h-full max-w-full items-center justify-center">
          <video
            src={asset.url}
            poster={asset.thumbUrl}
            controls
            muted
            loop
            playsInline
            preload={asset.thumbUrl ? "none" : "metadata"}
            className="max-h-full w-full max-w-full object-contain"
            style={{ maxHeight: "78vh" }}
          />
        </div>
      );
    }
    return (
      <img
        src={src}
        alt={asset.promptText ?? asset.collectionName}
        loading="lazy"
        className="max-h-full max-w-full object-contain"
        style={{ maxHeight: "82vh" }}
      />
    );
  }

  // tile / thumb: fill the boxed parent (absolute inset).
  if (isVideo) {
    return (
      <>
        <video
          poster={asset.thumbUrl}
          muted
          playsInline
          preload="none"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <span
          className="pointer-events-none absolute left-1/2 top-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        >
          <Play className="ml-0.5 h-4 w-4" fill="#fff" color="#fff" />
        </span>
      </>
    );
  }
  return (
    <img
      src={src}
      alt={asset.promptText ?? asset.collectionName}
      loading="lazy"
      className={`absolute inset-0 h-full w-full object-cover ${
        variant === "tile"
          ? "transition-transform duration-200 group-hover:scale-[1.02]"
          : ""
      }`}
    />
  );
}

/* ── Share direction board panel ── */
function SharePanel({
  token,
  onEnable,
  onDisable,
  onClose,
}: {
  token: string | undefined;
  onEnable: () => Promise<string>;
  onDisable: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const boardUrl = token ? `${window.location.origin}/b/${token}` : null;

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard unavailable — the URL stays visible for manual copy.
    }
  };

  const handleEnable = async () => {
    setBusy(true);
    try {
      const newToken = await onEnable();
      if (newToken) {
        await copyLink(`${window.location.origin}/b/${newToken}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async () => {
    setBusy(true);
    try {
      await onDisable();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="absolute inset-0 z-20 flex items-start justify-end p-4 md:p-6"
      onClick={onClose}
    >
      <div
        className="mt-14 w-[340px] overflow-hidden rounded-xl"
        style={{
          backgroundColor: "var(--lm-surface-1)",
          border: "2px solid var(--lm-ink)",
          boxShadow: "var(--shadow-lg)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-3.5 py-2.5"
          style={{ borderBottom: "1px solid var(--lm-border-strong)" }}
        >
          <span
            className="text-[10px] font-mono font-bold uppercase tracking-[0.14em]"
            style={{ color: "var(--lm-text-tertiary)" }}
          >
            Direction board link
          </span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-md transition-opacity hover:opacity-70"
            style={{ color: "var(--lm-text-secondary)" }}
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="px-3.5 py-3">
          <p
            className="text-[12px] leading-snug"
            style={{ color: "var(--lm-text-secondary)" }}
          >
            Anyone with the link can view and download this project’s assets —
            no account needed.
          </p>

          {boardUrl ? (
            <>
              <div
                className="mt-3 truncate rounded-lg px-2.5 py-2 text-[11px] font-mono"
                style={{
                  backgroundColor: "var(--lm-surface-2)",
                  color: "var(--lm-text-secondary)",
                  border: "1px solid var(--lm-border)",
                }}
                title={boardUrl}
              >
                {boardUrl}
              </div>
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void copyLink(boardUrl)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-mono font-bold uppercase tracking-wider transition-opacity hover:opacity-90"
                  style={{ backgroundColor: "var(--lm-coral)", color: "#000" }}
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5" strokeWidth={3} />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copied ? "Copied" : "Copy link"}
                </button>
                <a
                  href={boardUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[11px] font-mono font-bold uppercase tracking-wider transition-opacity hover:opacity-80"
                  style={{
                    borderColor: "var(--lm-border-strong)",
                    color: "var(--lm-text-secondary)",
                  }}
                  title="Open board"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open
                </a>
              </div>
              <button
                type="button"
                onClick={() => void handleDisable()}
                disabled={busy}
                className="mt-2.5 w-full rounded-lg border px-3 py-1.5 text-[10px] font-mono font-bold uppercase tracking-wider transition-opacity hover:opacity-80 disabled:opacity-50"
                style={{
                  borderColor: "var(--lm-border-strong)",
                  color: "var(--lm-text-tertiary)",
                }}
              >
                Disable link
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void handleEnable()}
              disabled={busy}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-mono font-bold uppercase tracking-wider transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: "var(--lm-coral)", color: "#000" }}
            >
              <Link2 className="h-3.5 w-3.5" />
              {busy ? "Creating…" : "Create share link"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Add/remove collections picker ── */
function CollectionPicker({
  allCollections,
  memberIds,
  section,
  onToggle,
  onCreate,
  onClose,
}: {
  allCollections: CollectionOption[];
  memberIds: Set<string>;
  /** Layer the picker files additions into (from the active tab), if any. */
  section: ProjectSection | null;
  onToggle: (folderId: string, isMember: boolean) => void;
  onCreate: (name: string) => void;
  onClose: () => void;
}) {
  const [newName, setNewName] = useState("");
  const submitCreate = () => {
    const name = newName.trim();
    if (!name) return;
    onCreate(name);
    setNewName("");
  };

  return (
    <div
      className="absolute inset-0 z-20 flex items-start justify-end p-4 md:p-6"
      onClick={onClose}
    >
      <div
        className="mt-14 flex max-h-[70vh] w-[320px] flex-col overflow-hidden rounded-xl"
        style={{
          backgroundColor: "var(--lm-surface-1)",
          border: "2px solid var(--lm-ink)",
          boxShadow: "var(--shadow-lg)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-3.5 py-2.5"
          style={{ borderBottom: "1px solid var(--lm-border-strong)" }}
        >
          <span
            className="text-[10px] font-mono font-bold uppercase tracking-[0.14em]"
            style={{ color: "var(--lm-text-tertiary)" }}
          >
            {section
              ? `Add directions — ${TAB_LABELS[section]}`
              : "Collections in project"}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-md transition-opacity hover:opacity-70"
            style={{ color: "var(--lm-text-secondary)" }}
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Inline create: new collection → added straight into this layer */}
        <div
          className="flex items-center gap-2 px-3.5 py-2.5"
          style={{ borderBottom: "1px solid var(--lm-border)" }}
        >
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitCreate();
              }
              e.stopPropagation();
            }}
            placeholder={
              section
                ? `New ${TAB_LABELS[section].toLowerCase()} direction…`
                : "New collection…"
            }
            className="min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-[12px] outline-none"
            style={{
              backgroundColor: "var(--lm-surface-2)",
              border: "1px solid var(--lm-border)",
              color: "var(--lm-text-primary)",
            }}
          />
          <button
            type="button"
            onClick={submitCreate}
            disabled={!newName.trim()}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ backgroundColor: "var(--lm-coral)", color: "#000" }}
            aria-label="Create and add"
            title="Create and add to this layer"
          >
            <Plus className="h-4 w-4" strokeWidth={3} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {allCollections.length === 0 && (
            <p
              className="px-3.5 py-3 text-[12px]"
              style={{ color: "var(--lm-text-tertiary)" }}
            >
              No collections yet. Create collections first, then add them here.
            </p>
          )}
          {allCollections.map((collection) => {
            const isMember = memberIds.has(collection.id);
            return (
              <button
                key={collection.id}
                type="button"
                onClick={() => onToggle(collection.id, isMember)}
                className="flex w-full items-center justify-between gap-2 px-3.5 py-2 text-left transition-opacity hover:opacity-75"
                style={{ color: "var(--lm-text-primary)" }}
              >
                <span className="flex items-center gap-2 truncate text-[13px] font-medium">
                  <span
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded"
                    style={{
                      backgroundColor: isMember
                        ? "var(--lm-coral)"
                        : "transparent",
                      border: isMember
                        ? "1px solid var(--lm-coral)"
                        : "1px solid var(--lm-border-strong)",
                    }}
                  >
                    {isMember ? (
                      <Check className="h-3 w-3" strokeWidth={3} color="#000" />
                    ) : (
                      <Plus className="h-3 w-3" color="var(--lm-text-tertiary)" />
                    )}
                  </span>
                  <span className="truncate">{collection.name}</span>
                </span>
                {collection.count !== undefined && (
                  <span
                    className="shrink-0 text-[11px]"
                    style={{ color: "var(--lm-text-tertiary)" }}
                  >
                    {collection.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  title,
  hint,
  actionLabel,
  onAction,
}: {
  title: string;
  hint: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <p
        className="text-[15px] font-semibold"
        style={{ color: "var(--lm-text-primary)" }}
      >
        {title}
      </p>
      <p
        className="max-w-[42ch] text-[13px]"
        style={{ color: "var(--lm-text-tertiary)" }}
      >
        {hint}
      </p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-1 flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[12px] font-mono font-bold uppercase tracking-wider"
          style={{ backgroundColor: "var(--lm-coral)", color: "#000" }}
        >
          <FolderPlus className="h-3.5 w-3.5" />
          {actionLabel}
        </button>
      )}
    </div>
  );
}
