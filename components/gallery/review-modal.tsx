"use client";

/* eslint-disable @next/next/no-img-element -- review images render raw <img>/
   <video> at large size (like storybook-modal); next/image adds no value here
   and its optimizer is bypassed for R2 URLs anyway. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  AtSign,
  Check,
  Clapperboard,
  ChevronLeft,
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
  SquareCheck,
  Trash2,
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

// Thumbs/posters narrower than this look soft at tile sizes — serve the
// original image, or let the <video> paint a native-res first frame.
const SHARP_THUMB_MIN_WIDTH = 800;
const thumbIsSharp = (asset: { thumbWidth?: number }) =>
  (asset.thumbWidth ?? 0) >= SHARP_THUMB_MIN_WIDTH;

type CollectionOption = { id: string; name: string; count?: number };

/** The project's layers. Beats lead — the packaged pitch view. Characters
 * and Locations are asset pools where selections become named stacks. */
type ProjectSection = "characters" | "locations" | "beats";
type ReviewTab = ProjectSection;

const SECTION_TABS: { key: ProjectSection; label: string }[] = [
  { key: "beats", label: "Beats" },
  { key: "characters", label: "Characters" },
  { key: "locations", label: "Locations" },
];

const TAB_LABELS: Record<ReviewTab, string> = {
  beats: "Beats",
  characters: "Characters",
  locations: "Locations",
};

/** Which bucket a staged beat file sorts into. Videos are fixed; images
 * default to stills and can be flipped to character / location. */
type BeatBucket = "video" | "character" | "location" | "still";

/** An existing asset pulled into a drafted beat — via the @name selector,
 * or promoted from the project's Unsorted files. */
type LinkedRef = {
  assetId: string;
  name: string;
  kind: "image" | "video";
  thumbUrl?: string;
  bucket: BeatBucket;
  /** Set when the asset should MOVE into the beat: on save its memberships
   * become exactly these + the new beat (strips Unsorted). */
  retainedFolderIds?: string[];
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
  /** User-given handle, referenced as @name when composing beats. */
  name?: string;
  url?: string;
  thumbUrl?: string;
  thumbWidth?: number;
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
  /** The beat's videos, master first. The card shows the current one on top
   * of the stack, plays it on hover, and offers arrows to cycle. */
  beatVideos: ReviewAsset[];
  /** Image master for video-less stacks (cover asset, first-image
   * fallback). */
  cover: ReviewAsset | null;
  /** Thumb urls of the next variations, peeking behind the master. */
  backs: string[];
  /** Thumb urls (master first) for the hover-to-preview rotation. */
  previews: string[];
  /** Kind breakdown for the card footer. */
  videos: number;
  images: number;
  /** Whole-direction likes left by board viewers. */
  likes: number;
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
  const renameAssetMutation = useMutation(api.assets.renameAsset);
  const setAssetFolders = useMutation(api.assets.setAssetFolders);
  const addAssetFolders = useMutation(api.assets.addAssetFolders);
  const addAssetTagsMutation = useMutation(api.assets.addAssetTags);
  const addCollection = useMutation(api.projects.addCollectionToProject);
  const removeCollection = useMutation(api.projects.removeCollectionFromProject);
  const setFolderCover = useMutation(api.folders.setFolderCover);
  const createFolder = useMutation(api.folders.createFolder);
  const updateFolder = useMutation(api.folders.updateFolder);
  const deleteFolderMutation = useMutation(api.folders.deleteFolder);
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
  // Named assets across the gallery, for the beat composer's @name selector.
  const namedAssets = useQuery(
    api.assets.listNamedAssets,
    projectId ? { ownerUserId } : "skip",
  );

  // The active mode of the centered toggle. Projects open on Beats.
  const [activeTab, setActiveTab] = useState<ReviewTab>("beats");
  // Direction currently drilled into (a member collection id), or null when
  // browsing a mode.
  const [openDirectionId, setOpenDirectionId] = useState<string | null>(null);
  const [approvedOnly, setApprovedOnly] = useState(false);
  const [likedOnly, setLikedOnly] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  // Focused element inside a drilled beat's preview viewer.
  const [beatFocusId, setBeatFocusId] = useState<string | null>(null);
  // Name draft for "create a stack from the selection" (characters/locations).
  const [stackName, setStackName] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  // Inline rename of the drilled direction (null = not renaming).
  const [renameDraft, setRenameDraft] = useState<string | null>(null);
  // Draft beat composer: the user stages files, sorts each into a bucket
  // (character / location / still; videos are fixed), names the beat, and
  // only Save creates + attaches it. Beats are never auto-created.
  const [composer, setComposer] = useState<null | {
    name: string;
    files: File[];
    buckets: BeatBucket[];
    /** Existing assets pulled in via @name. */
    linked: LinkedRef[];
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
  // Multiselect: tile clicks toggle selection instead of opening the feed;
  // a floating bar offers bulk remove / permanent delete.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Non-null while a bulk delete runs ("Deleting 2/5…").
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);

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
  // Whole-direction likes (a viewer liking a beat card), keyed by folder id.
  const likesByCollection = useMemo(
    () =>
      new Map<string, AssetLikes>(
        (project?.collectionLikes ?? []).map((entry) => [
          entry.folderId as string,
          { count: entry.count, names: entry.names },
        ]),
      ),
    [project],
  );

  type ProjectCollection = NonNullable<typeof project>["collections"][number];

  const toReviewAsset = useCallback(
    (
      asset: ProjectCollection["assets"][number],
      collection: ProjectCollection,
    ): ReviewAsset => ({
      id: asset._id as string,
      name: asset.name,
      url: asset.url ?? asset.thumbUrl,
      thumbUrl: asset.thumbUrl ?? asset.url,
      thumbWidth: asset.thumbWidth,
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

  // Which layer a collection files under; no section = invisible to the
  // three modes (legacy/unsorted memberships stay reachable via the picker).
  const tabOf = (section: string | undefined): ProjectSection | "unsorted" =>
    (section as ProjectSection | undefined) ?? "unsorted";

  const effectiveTab = activeTab;

  // Collections visible in the active mode.
  const tabCollections = useMemo<ProjectCollection[]>(
    () =>
      (project?.collections ?? []).filter(
        (c) => tabOf(c.section) === effectiveTab,
      ),
    [project, effectiveTab],
  );

  // Per-project asset POOLS for the Characters / Locations modes: auto-
  // created "<Project> — Characters/Locations" collections that hold the
  // loose assets. Named stacks are every OTHER collection in that section.
  const pools = useMemo(() => {
    const projectName = project?.project.name;
    const find = (label: string, section: ProjectSection) =>
      (project?.collections ?? []).find(
        (c) =>
          c.name === `${projectName} — ${label}` &&
          tabOf(c.section) === section,
      );
    return {
      characters: find("Characters", "characters"),
      locations: find("Locations", "locations"),
    };
  }, [project]);

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

  // One card per collection. Beat cards cycle their videos (master first);
  // video-less stacks keep the fanned-deck look with the image master on top.
  const toDirectionCard = useCallback(
    (collection: ProjectCollection): DirectionCardData => {
      const reviewAssets = collection.assets.map((a) =>
        toReviewAsset(a, collection),
      );
      const coverId = resolveCoverId(collection);
      const coverAsset =
        reviewAssets.find((a) => a.id === coverId) ?? reviewAssets[0] ?? null;
      const videos = reviewAssets.filter((a) => a.kind === "video");
      const beatVideos =
        coverAsset?.kind === "video"
          ? [coverAsset, ...videos.filter((a) => a !== coverAsset)]
          : videos;
      const images = reviewAssets.filter((a) => a.kind !== "video");
      const imageCover =
        coverAsset && coverAsset.kind !== "video"
          ? coverAsset
          : (images[0] ?? null);
      const backs = images
        .filter((a) => a !== imageCover)
        .slice(0, 2)
        .map((a) => a.thumbUrl ?? a.url)
        .filter((src): src is string => Boolean(src));
      const previews = (
        imageCover
          ? [imageCover, ...images.filter((a) => a !== imageCover)]
          : images
      )
        .slice(0, 8)
        .map((a) => a.thumbUrl ?? a.url)
        .filter((src): src is string => Boolean(src));
      return {
        id: collection.folderId as string,
        name: collection.name,
        count: collection.count,
        section: collection.section as ProjectSection | undefined,
        beatVideos,
        cover: imageCover,
        backs,
        previews,
        videos: videos.length,
        images: images.length,
        likes:
          likesByCollection.get(collection.folderId as string)?.count ?? 0,
      };
    },
    [resolveCoverId, toReviewAsset, likesByCollection],
  );

  // Beats mode cards.
  const beatCards = useMemo<DirectionCardData[]>(
    () =>
      effectiveTab === "beats" ? tabCollections.map(toDirectionCard) : [],
    [effectiveTab, tabCollections, toDirectionCard],
  );

  // Characters / Locations mode: named stacks (every section collection
  // except the pool) + the loose pool assets not yet in any stack.
  const poolCollection =
    effectiveTab === "characters"
      ? pools.characters
      : effectiveTab === "locations"
        ? pools.locations
        : undefined;
  const stackCards = useMemo<DirectionCardData[]>(
    () =>
      effectiveTab === "beats"
        ? []
        : tabCollections
            .filter((c) => c.folderId !== poolCollection?.folderId)
            .map(toDirectionCard),
    [effectiveTab, tabCollections, poolCollection, toDirectionCard],
  );
  const looseAssets = useMemo<ReviewAsset[]>(() => {
    if (effectiveTab === "beats") return [];
    const stackIds = new Set(
      tabCollections
        .filter((c) => c.folderId !== poolCollection?.folderId)
        .map((c) => c.folderId as string),
    );
    const out: ReviewAsset[] = [];
    const seen = new Set<string>();
    for (const collection of tabCollections) {
      for (const raw of collection.assets) {
        const id = raw._id as string;
        if (seen.has(id)) continue;
        seen.add(id);
        const asset = toReviewAsset(raw, collection);
        if (asset.folderIds.some((folderId) => stackIds.has(folderId))) {
          continue; // lives inside a named stack — shown on its card
        }
        out.push(asset);
      }
    }
    return out;
  }, [effectiveTab, tabCollections, poolCollection, toReviewAsset]);

  // Files dropped into the project from the gallery (e.g. the Inbox from
  // "Add to project") — neither beats nor characters/locations. They show on
  // the project's main (Beats) page until filed.
  const unsortedCollections = useMemo(
    () =>
      (project?.collections ?? []).filter(
        (c) => tabOf(c.section) === "unsorted",
      ),
    [project],
  );
  const unsortedIds = useMemo(
    () => new Set(unsortedCollections.map((c) => c.folderId as string)),
    [unsortedCollections],
  );
  const unsortedAssets = useMemo<ReviewAsset[]>(() => {
    const out: ReviewAsset[] = [];
    const seen = new Set<string>();
    for (const collection of unsortedCollections) {
      for (const raw of collection.assets) {
        const id = raw._id as string;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(toReviewAsset(raw, collection));
      }
    }
    return out;
  }, [unsortedCollections, toReviewAsset]);

  const drilledAssets = useMemo<ReviewAsset[]>(
    () =>
      openDirection
        ? openDirection.assets.map((a) => toReviewAsset(a, openDirection))
        : [],
    [openDirection, toReviewAsset],
  );

  // The drilled direction's hero video: its master when that's a video, else
  // the first video in the pack.
  const drilledBeat = useMemo<ReviewAsset | null>(() => {
    if (!openDirection) return null;
    const videos = drilledAssets.filter((a) => a.kind === "video");
    const coverId = resolveCoverId(openDirection);
    return videos.find((a) => a.id === coverId) ?? videos[0] ?? null;
  }, [openDirection, drilledAssets, resolveCoverId]);
  const drilledIsBeat = openDirection
    ? tabOf(openDirection.section) === "beats"
    : false;

  // The tile scope: a drilled direction's assets, the mode's loose pool, or
  // (on the Beats main page) the project's unsorted files.
  const assets = useMemo<ReviewAsset[]>(() => {
    if (openDirection) return drilledAssets;
    if (effectiveTab === "beats") return unsortedAssets;
    return looseAssets;
  }, [openDirection, drilledAssets, effectiveTab, unsortedAssets, looseAssets]);

  const isApproved = useCallback(
    (asset: ReviewAsset) =>
      asset.id in approveOverride
        ? approveOverride[asset.id]
        : asset.approvedByTag,
    [approveOverride],
  );

  const passesFilters = useCallback(
    (asset: ReviewAsset) =>
      (!approvedOnly || isApproved(asset)) &&
      (!likedOnly || (likesByAsset.get(asset.id)?.count ?? 0) > 0),
    [approvedOnly, likedOnly, isApproved, likesByAsset],
  );

  const visibleAssets = useMemo(
    () => assets.filter(passesFilters),
    [assets, passesFilters],
  );

  // A drilled beat's elements in presentation order: videos (master first),
  // then characters, locations, and stills. Drives the preview strip.
  const beatElements = useMemo<ReviewAsset[]>(() => {
    if (!openDirection) return [];
    const rank = (a: ReviewAsset) =>
      a.kind === "video"
        ? a.id === drilledBeat?.id
          ? 0
          : 1
        : a.tagNames.includes("character")
          ? 2
          : a.tagNames.includes("location")
            ? 3
            : 4;
    return [...visibleAssets].sort((a, b) => rank(a) - rank(b));
  }, [openDirection, visibleAssets, drilledBeat]);
  // Focused element in the beat viewer: explicit pick, else the master.
  const beatFocus =
    beatElements.find((a) => a.id === beatFocusId) ??
    beatElements.find((a) => a.id === drilledBeat?.id) ??
    beatElements[0] ??
    null;

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

  // ── File uploads into a direction ──
  // A dropped/typed text becomes the prompt for every file in the pack; the
  // first video becomes the direction's MASTER (its beat) unless a video
  // master already exists, so the card previews as the shot. Returns the
  // created asset ids in file order (null where an upload failed).
  const uploadFilesToDirection = async (
    media: File[],
    targetFolderId: string,
    promptText: string,
    hasVideoMaster: boolean,
  ): Promise<{ assetId: string | null; isVideo: boolean }[]> => {
    const uploaded: { assetId: string | null; isVideo: boolean }[] = [];
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
          uploaded.push({ assetId: assetId ?? null, isVideo });
          if (!masterVideoAssetId && assetId && isVideo) {
            masterVideoAssetId = assetId;
          }
        } catch {
          failed += 1;
          uploaded.push({
            assetId: null,
            isVideo: file.type.startsWith("video/"),
          });
        }
        setUploadState((prev) =>
          prev ? { ...prev, done: prev.done + 1 } : prev,
        );
      }

      if (masterVideoAssetId && !hasVideoMaster) {
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
    return uploaded;
  };

  // Ensure the section's pool collection exists on this project; returns its
  // folder id. Reattaches a detached same-named folder instead of erroring.
  const ensurePool = async (
    section: "characters" | "locations",
  ): Promise<string> => {
    const existing =
      section === "characters" ? pools.characters : pools.locations;
    if (existing) return existing.folderId as string;
    const label = section === "characters" ? "Characters" : "Locations";
    const name = `${project?.project.name ?? "Project"} — ${label}`;
    const detached = allCollections.find((c) => c.name === name);
    const folderId = detached
      ? detached.id
      : ((await createFolder({ ownerUserId, name, kind: "direction" }))
          .folderId as string);
    await addCollection({
      ownerUserId,
      projectId: projectId as Id<"folders">,
      folderId: folderId as Id<"folders">,
      section,
    });
    return folderId;
  };

  // Characters / Locations mode: uploads land straight in the pool, tagged
  // with their role.
  const uploadToPool = async (
    media: File[],
    section: "characters" | "locations",
  ) => {
    const poolId = await ensurePool(section);
    const uploaded = await uploadFilesToDirection(media, poolId, "", true);
    const tag = section === "characters" ? "character" : "location";
    for (const { assetId, isVideo } of uploaded) {
      if (!assetId || isVideo) continue;
      void addAssetTagsMutation({
        ownerUserId,
        assetId: assetId as Id<"assets">,
        tagNames: [tag],
      }).catch(() => {});
    }
  };

  // Drilled: dropped files land in that direction. Beats mode: they STAGE
  // into the beat composer (never auto-created). Characters / Locations:
  // straight into the pool.
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
        drilledBeat !== null && drilledBeat.id === resolveCoverId(openDirection),
      );
      return;
    }

    if (composer || effectiveTab === "beats") {
      setComposer((prev) => ({
        name: prev?.name ?? "",
        files: [...(prev?.files ?? []), ...media],
        buckets: [
          ...(prev?.buckets ?? []),
          ...media.map(
            (file): BeatBucket =>
              file.type.startsWith("video/") ? "video" : "still",
          ),
        ],
        linked: prev?.linked ?? [],
        prompt: [prev?.prompt, promptText].filter(Boolean).join("\n\n"),
      }));
      return;
    }

    if (media.length === 0) {
      setUploadState({ done: 0, total: 0, error: "Drop images or videos." });
      return;
    }
    await uploadToPool(media, effectiveTab);
  };

  // Open the beat composer with existing assets pre-staged (promoting
  // Unsorted files — usually videos — into a new beat). The user still names
  // it; on save the assets MOVE out of Unsorted into the beat.
  const startBeatFromAssets = (list: ReviewAsset[]) => {
    if (list.length === 0) return;
    const refs: LinkedRef[] = list.map((asset) => ({
      assetId: asset.id,
      name: asset.name ?? "",
      kind: asset.kind,
      thumbUrl: asset.thumbUrl,
      bucket:
        asset.kind === "video"
          ? "video"
          : asset.tagNames.includes("character")
            ? "character"
            : asset.tagNames.includes("location")
              ? "location"
              : "still",
      retainedFolderIds: asset.folderIds.filter((id) => !unsortedIds.has(id)),
    }));
    setComposer((prev) => {
      const existing = new Set((prev?.linked ?? []).map((l) => l.assetId));
      return {
        name: prev?.name ?? "",
        files: prev?.files ?? [],
        buckets: prev?.buckets ?? [],
        linked: [
          ...(prev?.linked ?? []),
          ...refs.filter((ref) => !existing.has(ref.assetId)),
        ],
        prompt: prev?.prompt ?? "",
      };
    });
    exitSelect();
  };

  // Save the drafted beat: create + attach it, upload the staged files, and
  // file each character/location-bucketed asset into the project's pool with
  // its role tag (so it also shows in that mode).
  const saveBeat = async () => {
    if (!composer || !projectId) return;
    const name = composer.name.trim();
    if (!name) return;
    const { files, buckets, linked, prompt } = composer;
    try {
      const created = await createFolder({
        ownerUserId,
        name,
        description: prompt.trim() || undefined,
        kind: "direction",
      });
      await addCollection({
        ownerUserId,
        projectId: projectId as Id<"folders">,
        folderId: created.folderId,
        section: "beats",
      });
      setComposer(null);
      setOpenDirectionId(created.folderId as string);
      setBeatFocusId(null);
      // Resolve each pool once per save — `pools` is stale inside this
      // closure after the first ensurePool creates one.
      const poolIds: Partial<Record<"characters" | "locations", string>> = {};
      const fileToPool = async (assetId: string, bucket: BeatBucket) => {
        if (bucket !== "character" && bucket !== "location") return;
        const section =
          bucket === "character"
            ? ("characters" as const)
            : ("locations" as const);
        try {
          poolIds[section] = poolIds[section] ?? (await ensurePool(section));
          await addAssetFolders({
            ownerUserId,
            assetId: assetId as Id<"assets">,
            folderIds: [poolIds[section] as Id<"folders">],
          });
        } catch {
          // Pool filing is best-effort; the asset still lives in the beat.
        }
        void addAssetTagsMutation({
          ownerUserId,
          assetId: assetId as Id<"assets">,
          tagNames: [bucket],
        }).catch(() => {});
      };

      let hasVideoMaster = false;
      if (files.length > 0) {
        const uploaded = await uploadFilesToDirection(
          files,
          created.folderId as string,
          prompt.trim(),
          false,
        );
        hasVideoMaster = uploaded.some((u) => u.assetId && u.isVideo);
        for (const [index, entry] of uploaded.entries()) {
          if (!entry.assetId || entry.isVideo) continue;
          await fileToPool(entry.assetId, buckets[index] ?? "still");
        }
      }

      // Existing assets pulled in by @name or promoted from Unsorted:
      // attach to the beat (moving strips the old Unsorted memberships).
      for (const ref of linked) {
        if (ref.retainedFolderIds) {
          await setAssetFolders({
            ownerUserId,
            assetId: ref.assetId as Id<"assets">,
            folderIds: [
              ...new Set([...ref.retainedFolderIds, created.folderId as string]),
            ] as Id<"folders">[],
          }).catch(() => {});
        } else {
          await addAssetFolders({
            ownerUserId,
            assetId: ref.assetId as Id<"assets">,
            folderIds: [created.folderId],
          }).catch(() => {});
        }
        if (ref.kind !== "video") {
          await fileToPool(ref.assetId, ref.bucket);
        } else if (!hasVideoMaster) {
          // A referenced video becomes the master when no upload claimed it.
          hasVideoMaster = true;
          await setFolderCover({
            ownerUserId,
            folderId: created.folderId,
            assetId: ref.assetId as Id<"assets">,
          }).catch(() => {});
        }
      }
    } catch (error) {
      setUploadState({
        done: 0,
        total: files.length,
        error:
          error instanceof Error ? error.message : "Could not create the beat.",
      });
    }
  };

  // Create a named stack from the current selection (characters/locations
  // modes) — membership is additive, the assets stay in the pool.
  const createStackFromSelection = async () => {
    if (!projectId || effectiveTab === "beats") return;
    const name = stackName.trim();
    if (!name || selectedIds.size === 0) return;
    try {
      const created = await createFolder({
        ownerUserId,
        name,
        kind: "direction",
      });
      await addCollection({
        ownerUserId,
        projectId: projectId as Id<"folders">,
        folderId: created.folderId,
        section: effectiveTab,
      });
      for (const id of selectedIds) {
        await addAssetFolders({
          ownerUserId,
          assetId: id as Id<"assets">,
          folderIds: [created.folderId],
        }).catch(() => {});
      }
      setStackName("");
      exitSelect();
    } catch (error) {
      setUploadState({
        done: 0,
        total: 0,
        error:
          error instanceof Error
            ? error.message
            : "Could not create the stack.",
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

  // ── Multiselect + destructive actions ──
  const toggleSelect = useCallback((assetId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  }, []);

  const exitSelect = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  // Permanently delete assets via the same admin-gated route the gallery
  // uses. The reactive project query drops the tiles as each delete lands.
  const deleteAssetsByIds = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0 || bulkBusy) return;
      setBulkBusy(`Deleting 0/${ids.length}…`);
      let failed = 0;
      let done = 0;
      for (const id of ids) {
        try {
          const response = await fetch(
            `/api/assets/${encodeURIComponent(id)}`,
            { method: "DELETE" },
          );
          if (!response.ok) failed += 1;
        } catch {
          failed += 1;
        }
        done += 1;
        setBulkBusy(`Deleting ${done}/${ids.length}…`);
      }
      setBulkBusy(null);
      exitSelect();
      if (failed > 0) {
        setUploadState({
          done: 0,
          total: 0,
          error: `${failed} of ${ids.length} failed to delete.`,
        });
      }
    },
    [bulkBusy, exitSelect],
  );

  // Bulk remove from the drilled direction — membership only, assets stay.
  const removeSelectedFromDirection = useCallback(async () => {
    if (!openDirectionId) return;
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    for (const id of selectedIds) {
      const asset = byId.get(id);
      if (!asset) continue;
      await setAssetFolders({
        ownerUserId,
        assetId: id as Id<"assets">,
        folderIds: asset.folderIds.filter(
          (folderId) => folderId !== openDirectionId,
        ) as Id<"folders">[],
      }).catch(() => {});
    }
    exitSelect();
  }, [openDirectionId, assets, selectedIds, ownerUserId, setAssetFolders, exitSelect]);

  // Delete a whole direction (the folder). Assets stay in the gallery.
  const deleteDirectionById = useCallback(
    (folderId: string) => {
      setOpenDirectionId((current) =>
        current === folderId ? null : current,
      );
      void deleteFolderMutation({
        ownerUserId,
        folderId: folderId as Id<"folders">,
      }).catch(() => {});
    },
    [ownerUserId, deleteFolderMutation],
  );

  // Rename an asset — its @name handle for beat composing.
  const renameAsset = useCallback(
    (assetId: string, name: string) => {
      void renameAssetMutation({
        ownerUserId,
        assetId: assetId as Id<"assets">,
        name,
      }).catch(() => {});
    },
    [ownerUserId, renameAssetMutation],
  );

  // File an unsorted project file into the Characters/Locations pool: pool
  // membership + role tag replace its unsorted memberships (a move). Plain
  // closure (not memoized) because ensurePool is re-created each render.
  const fileUnsortedTo = async (
    asset: ReviewAsset,
    section: "characters" | "locations",
  ) => {
    const poolId = await ensurePool(section);
    const next = [
      ...new Set([
        ...asset.folderIds.filter((id) => !unsortedIds.has(id)),
        poolId,
      ]),
    ];
    await setAssetFolders({
      ownerUserId,
      assetId: asset.id as Id<"assets">,
      folderIds: next as Id<"folders">[],
    }).catch(() => {});
    void addAssetTagsMutation({
      ownerUserId,
      assetId: asset.id as Id<"assets">,
      tagNames: [section === "characters" ? "character" : "location"],
    }).catch(() => {});
  };

  // Save the drilled direction's text (its description).
  const saveDirectionText = useCallback(
    (text: string) => {
      if (!openDirection) return;
      void updateFolder({
        ownerUserId,
        folderId: openDirection.folderId,
        name: openDirection.name,
        description: text,
      }).catch(() => {});
    },
    [openDirection, ownerUserId, updateFolder],
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
        else if (selectMode) exitSelect();
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
  }, [projectId, pickerOpen, shareOpen, composerOpen, selectMode, exitSelect, focusId, focusAsset, openDirectionId, goFocus, toggleApprove, onClose]);

  if (!projectId) return null;

  const isLoading = project === undefined;
  const projectName = project?.project.name ?? "Project";
  const hasCollections = (project?.collections.length ?? 0) > 0;

  // Counts for the centered mode toggle: beats = number of beats;
  // characters / locations = assets in that layer (loose + stacked, deduped).
  const allCollections2 = project?.collections ?? [];
  const modeCount = (tab: ReviewTab) => {
    const inTab = allCollections2.filter((c) => tabOf(c.section) === tab);
    if (tab === "beats") return inTab.length;
    const seen = new Set<string>();
    for (const c of inTab) {
      for (const a of c.assets) seen.add(a._id as string);
    }
    return seen.size;
  };

  const openDirectionMasterId = openDirection
    ? resolveCoverId(openDirection)
    : null;
  const openDirectionLikes = openDirectionId
    ? likesByCollection.get(openDirectionId)
    : undefined;

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
            {openDirection
              ? `${visibleAssets.length} shown · ${approvedCount} approved`
              : effectiveTab === "beats"
                ? `${beatCards.length} ${beatCards.length === 1 ? "beat" : "beats"}`
                : `${modeCount(effectiveTab)} assets · ${stackCards.length} ${
                    stackCards.length === 1 ? "stack" : "stacks"
                  }`}
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
          {hasCollections &&
            !inFocus &&
            (Boolean(openDirection) ||
              effectiveTab !== "beats" ||
              unsortedAssets.length > 0) && (
            <button
              type="button"
              onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
              className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-mono font-bold uppercase tracking-wider transition-colors"
              style={{
                borderColor: selectMode
                  ? "var(--lm-coral)"
                  : "var(--lm-border-strong)",
                backgroundColor: selectMode
                  ? "color-mix(in srgb, var(--lm-coral) 16%, transparent)"
                  : "transparent",
                color: selectMode
                  ? "var(--lm-coral)"
                  : "var(--lm-text-secondary)",
              }}
              aria-pressed={selectMode}
              title="Select multiple assets to remove or delete"
            >
              <SquareCheck className="h-3.5 w-3.5" />
              Select
            </button>
          )}
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

      {/* Hidden file input — always mounted so browse works in any state */}
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

      {/* ── Centered mode toggle: Beats / Characters / Locations ── */}
      {!inFocus && !composerOpen && (
        <div className="flex items-center justify-center px-4 py-3">
          <div
            className="flex items-center gap-1 rounded-full border p-1"
            style={{
              borderColor: "var(--lm-border-strong)",
              backgroundColor: "var(--lm-surface-1)",
            }}
            role="tablist"
            aria-label="Project layers"
          >
            {SECTION_TABS.map(({ key, label }) => {
              const active = effectiveTab === key;
              const count = modeCount(key);
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    setActiveTab(key);
                    setOpenDirectionId(null);
                    setBeatFocusId(null);
                  }}
                  className="rounded-full px-4 py-1.5 text-[12px] font-semibold transition-colors"
                  style={{
                    backgroundColor: active ? "var(--lm-coral)" : "transparent",
                    color: active ? "#000" : "var(--lm-text-secondary)",
                  }}
                >
                  {label}
                  {count > 0 && (
                    <span style={{ opacity: 0.6 }}> {count}</span>
                  )}
                </button>
              );
            })}
          </div>
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
            title="Back (Esc)"
          >
            <ArrowLeft className="h-3.5 w-3.5 shrink-0" />
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
          {openDirectionLikes && openDirectionLikes.count > 0 && (
            <span
              className="flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-mono font-bold uppercase tracking-wider"
              style={{
                backgroundColor:
                  "color-mix(in srgb, var(--lm-coral) 14%, transparent)",
                color: "var(--lm-coral)",
                borderColor:
                  "color-mix(in srgb, var(--lm-coral) 42%, transparent)",
              }}
              title={likeTitle(openDirectionLikes)}
            >
              <Heart className="h-3 w-3" fill="currentColor" strokeWidth={2.5} />
              {openDirectionLikes.count}
            </span>
          )}
          <span className="ml-auto">
            <ArmedDeleteButton
              label="Delete"
              variant="chrome"
              title="Delete this direction — its assets stay in the gallery"
              onConfirm={() =>
                deleteDirectionById(openDirection.folderId as string)
              }
            />
          </span>
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
          /* ── Beat composer: stage files → sort into buckets → name → save ── */
          <div className="h-full overflow-y-auto px-6 py-10 md:px-12">
            <div className="mx-auto max-w-[860px]">
              <p
                className="text-[10px] font-mono font-bold uppercase tracking-[0.2em]"
                style={{ color: "var(--lm-coral)" }}
              >
                New beat
              </p>

              <input
                autoFocus
                value={composer.name}
                onChange={(e) =>
                  setComposer((prev) =>
                    prev ? { ...prev, name: e.target.value } : prev,
                  )
                }
                placeholder="Name the beat…"
                className="mt-3 w-full bg-transparent pb-2 text-[26px] font-semibold outline-none md:text-[32px]"
                style={{
                  color: "var(--lm-text-primary)",
                  borderBottom: "1px solid var(--lm-border-strong)",
                  caretColor: "var(--lm-coral)",
                }}
                aria-label="Beat name"
              />

              {/* Text */}
              <textarea
                value={composer.prompt}
                onChange={(e) =>
                  setComposer((prev) =>
                    prev ? { ...prev, prompt: e.target.value } : prev,
                  )
                }
                placeholder="Optional text — the prompt, style notes, the beat…"
                rows={3}
                className="mt-6 w-full resize-y bg-transparent text-[14px] leading-relaxed outline-none"
                style={{
                  color: "var(--lm-text-secondary)",
                  borderBottom: "1px solid var(--lm-border)",
                  caretColor: "var(--lm-coral)",
                }}
                aria-label="Beat text"
              />

              {/* Staged files, each sorted into a bucket */}
              <div className="mt-6">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span
                    className="text-[9px] font-mono font-bold uppercase tracking-[0.16em]"
                    style={{ color: "var(--lm-text-ghost)" }}
                  >
                    Assets
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
                  {composer.files.some((f) => !f.type.startsWith("video/")) && (
                    <span
                      className="text-[10px]"
                      style={{ color: "var(--lm-text-ghost)" }}
                    >
                      sort each image: character · location · still
                    </span>
                  )}
                </div>
                {composerPreviews.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-4">
                    {composerPreviews.map(({ file, url }, index) => {
                      const isVideo = file.type.startsWith("video/");
                      const bucket = composer.buckets[index] ?? "still";
                      const setBucket = (next: BeatBucket) =>
                        setComposer((prev) =>
                          prev
                            ? {
                                ...prev,
                                buckets: prev.buckets.map((b, i) =>
                                  i === index ? next : b,
                                ),
                              }
                            : prev,
                        );
                      return (
                        <div
                          key={`${file.name}-${index}`}
                          className="group relative w-[132px]"
                        >
                          {isVideo ? (
                            <video
                              src={url}
                              muted
                              playsInline
                              preload="metadata"
                              className="h-24 w-full rounded-lg object-cover"
                            />
                          ) : (
                            <img
                              src={url}
                              alt={file.name}
                              className="h-24 w-full rounded-lg object-cover"
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
                                      buckets: prev.buckets.filter(
                                        (_, i) => i !== index,
                                      ),
                                    }
                                  : prev,
                              )
                            }
                            className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100"
                            style={{
                              backgroundColor: "var(--lm-ink)",
                              color: "var(--lm-paper)",
                            }}
                            aria-label={`Remove ${file.name}`}
                          >
                            <X className="h-3 w-3" strokeWidth={3} />
                          </button>

                          {/* Bucket chips */}
                          {isVideo ? (
                            <span
                              className="mt-1.5 flex items-center justify-center gap-1 rounded-md py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider"
                              style={{
                                backgroundColor: "var(--lm-surface-2)",
                                color: "var(--lm-text-tertiary)",
                              }}
                            >
                              <Play className="h-2.5 w-2.5" fill="currentColor" />
                              Video
                            </span>
                          ) : (
                            <div className="mt-1.5 flex items-center gap-0.5">
                              {(
                                [
                                  ["character", "Char", User],
                                  ["location", "Loc", MapPin],
                                  ["still", "Still", null],
                                ] as const
                              ).map(([key, label, Icon]) => {
                                const active = bucket === key;
                                return (
                                  <button
                                    key={key}
                                    type="button"
                                    onClick={() => setBucket(key)}
                                    className="flex flex-1 items-center justify-center gap-0.5 rounded-md border py-0.5 text-[8px] font-mono font-bold uppercase tracking-wide transition-colors"
                                    style={{
                                      borderColor: active
                                        ? "var(--lm-coral)"
                                        : "var(--lm-border)",
                                      backgroundColor: active
                                        ? "color-mix(in srgb, var(--lm-coral) 18%, transparent)"
                                        : "transparent",
                                      color: active
                                        ? "var(--lm-coral)"
                                        : "var(--lm-text-ghost)",
                                    }}
                                    aria-pressed={active}
                                    title={`Sort as ${label.toLowerCase()}`}
                                  >
                                    {Icon && <Icon className="h-2.5 w-2.5" />}
                                    {label}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Pull in existing assets by @name */}
              <div className="mt-6">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span
                    className="text-[9px] font-mono font-bold uppercase tracking-[0.16em]"
                    style={{ color: "var(--lm-text-ghost)" }}
                  >
                    By name
                  </span>
                  <span
                    className="text-[11px]"
                    style={{ color: "var(--lm-text-tertiary)" }}
                  >
                    Reference named assets — characters, locations, takes
                  </span>
                </div>
                <AtNameSelector
                  options={(namedAssets ?? []).filter(
                    (option) =>
                      !composer.linked.some(
                        (ref) => ref.assetId === (option.assetId as string),
                      ),
                  )}
                  onPick={(option) =>
                    setComposer((prev) =>
                      prev
                        ? {
                            ...prev,
                            linked: [
                              ...prev.linked,
                              {
                                assetId: option.assetId as string,
                                name: option.name,
                                kind: option.kind,
                                thumbUrl: option.thumbUrl,
                                bucket:
                                  option.kind === "video"
                                    ? "video"
                                    : option.tagNames.includes("character")
                                      ? "character"
                                      : option.tagNames.includes("location")
                                        ? "location"
                                        : "still",
                              },
                            ],
                          }
                        : prev,
                    )
                  }
                />
                {composer.linked.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-4">
                    {composer.linked.map((ref, index) => {
                      const setBucket = (next: BeatBucket) =>
                        setComposer((prev) =>
                          prev
                            ? {
                                ...prev,
                                linked: prev.linked.map((l, i) =>
                                  i === index ? { ...l, bucket: next } : l,
                                ),
                              }
                            : prev,
                        );
                      return (
                        <div
                          key={ref.assetId}
                          className="group relative w-[132px]"
                        >
                          {ref.thumbUrl ? (
                            <img
                              src={ref.thumbUrl}
                              alt={ref.name}
                              className="h-24 w-full rounded-lg object-cover"
                            />
                          ) : (
                            <div
                              className="h-24 w-full rounded-lg"
                              style={{ backgroundColor: "var(--lm-surface-2)" }}
                            />
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              setComposer((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      linked: prev.linked.filter(
                                        (_, i) => i !== index,
                                      ),
                                    }
                                  : prev,
                              )
                            }
                            className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100"
                            style={{
                              backgroundColor: "var(--lm-ink)",
                              color: "var(--lm-paper)",
                            }}
                            aria-label={`Remove @${ref.name}`}
                          >
                            <X className="h-3 w-3" strokeWidth={3} />
                          </button>
                          <p
                            className="mt-1 truncate text-[10px] font-mono font-bold tracking-wider"
                            style={{
                              color: ref.name
                                ? "var(--lm-coral)"
                                : "var(--lm-text-ghost)",
                            }}
                          >
                            {ref.name ? `@${ref.name}` : "from Unsorted"}
                          </p>
                          {ref.kind === "video" ? (
                            <span
                              className="mt-1 flex items-center justify-center gap-1 rounded-md py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider"
                              style={{
                                backgroundColor: "var(--lm-surface-2)",
                                color: "var(--lm-text-tertiary)",
                              }}
                            >
                              <Play className="h-2.5 w-2.5" fill="currentColor" />
                              Video
                            </span>
                          ) : (
                            <div className="mt-1 flex items-center gap-0.5">
                              {(
                                [
                                  ["character", "Char", User],
                                  ["location", "Loc", MapPin],
                                  ["still", "Still", null],
                                ] as const
                              ).map(([key, label, Icon]) => {
                                const active = ref.bucket === key;
                                return (
                                  <button
                                    key={key}
                                    type="button"
                                    onClick={() => setBucket(key)}
                                    className="flex flex-1 items-center justify-center gap-0.5 rounded-md border py-0.5 text-[8px] font-mono font-bold uppercase tracking-wide transition-colors"
                                    style={{
                                      borderColor: active
                                        ? "var(--lm-coral)"
                                        : "var(--lm-border)",
                                      backgroundColor: active
                                        ? "color-mix(in srgb, var(--lm-coral) 18%, transparent)"
                                        : "transparent",
                                      color: active
                                        ? "var(--lm-coral)"
                                        : "var(--lm-text-ghost)",
                                    }}
                                    aria-pressed={active}
                                  >
                                    {Icon && <Icon className="h-2.5 w-2.5" />}
                                    {label}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Save / discard */}
              <div
                className="mt-8 flex items-center gap-3 border-t pt-5"
                style={{ borderColor: "var(--lm-border)" }}
              >
                <button
                  type="button"
                  onClick={() => void saveBeat()}
                  disabled={!composer.name.trim()}
                  className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12px] font-mono font-bold uppercase tracking-wider transition-opacity hover:opacity-90 disabled:opacity-40"
                  style={{ backgroundColor: "var(--lm-coral)", color: "#000" }}
                  title={
                    composer.name.trim()
                      ? "Create the beat and upload the staged assets"
                      : "Name the beat first"
                  }
                >
                  <Check className="h-3.5 w-3.5" strokeWidth={3} />
                  Save beat
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
                    Name it to save.
                  </span>
                )}
              </div>
            </div>
          </div>
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
            onDelete={(asset) => void deleteAssetsByIds([asset.id])}
            onRename={(asset, next) => renameAsset(asset.id, next)}
            showCollectionLabel={false}
          />
        ) : openDirection && drilledIsBeat ? (
          /* ── Beat detail: focused full-res viewer + element strip ── */
          <div className="h-full overflow-y-auto px-4 pb-8 pt-2 md:px-8">
            <div className="mx-auto flex w-full max-w-[1400px] flex-col">
              {beatFocus ? (
                <>
                  <div className="flex items-center justify-center">
                    {beatFocus.kind === "video" ? (
                      <video
                        key={beatFocus.id}
                        src={beatFocus.url}
                        poster={
                          thumbIsSharp(beatFocus)
                            ? beatFocus.thumbUrl
                            : undefined
                        }
                        controls
                        playsInline
                        preload="metadata"
                        className="w-full rounded-xl"
                        style={{
                          maxHeight: "58vh",
                          backgroundColor: "#000",
                          border: "1px solid var(--lm-border)",
                          objectFit: "contain",
                        }}
                      />
                    ) : (
                      <img
                        key={beatFocus.id}
                        src={beatFocus.url ?? beatFocus.thumbUrl}
                        alt={beatFocus.promptText ?? openDirection.name}
                        className="max-w-full rounded-xl object-contain"
                        style={{ maxHeight: "58vh" }}
                      />
                    )}
                  </div>

                  {/* Focused element actions */}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <AssetNameEditor
                      name={beatFocus.name}
                      onSave={(next) => renameAsset(beatFocus.id, next)}
                    />
                    <span
                      className="text-[11px] font-mono"
                      style={{ color: "var(--lm-text-tertiary)" }}
                    >
                      {Math.max(
                        1,
                        beatElements.findIndex((a) => a.id === beatFocus.id) +
                          1,
                      )}
                      /{beatElements.length}
                    </span>
                    {(() => {
                      const focusLikes = likesByAsset.get(beatFocus.id);
                      return focusLikes && focusLikes.count > 0 ? (
                        <span
                          className="flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-mono font-bold uppercase tracking-wider"
                          style={{
                            backgroundColor: "rgba(0,0,0,0.62)",
                            color: "var(--lm-coral)",
                            borderColor:
                              "color-mix(in srgb, var(--lm-coral) 42%, transparent)",
                          }}
                          title={likeTitle(focusLikes)}
                        >
                          <Heart
                            className="h-3 w-3"
                            fill="currentColor"
                            strokeWidth={2.5}
                          />
                          {focusLikes.count}
                        </span>
                      ) : null;
                    })()}
                    <span className="ml-auto flex items-center gap-2">
                      {beatFocus.kind === "video" && (
                        <button
                          type="button"
                          onClick={() =>
                            setMaster(
                              openDirection.folderId as string,
                              openDirectionMasterId === beatFocus.id
                                ? null
                                : beatFocus.id,
                            )
                          }
                          className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-mono font-bold uppercase tracking-wider transition-all active:scale-95"
                          style={{
                            backgroundColor:
                              openDirectionMasterId === beatFocus.id
                                ? "var(--lm-ink)"
                                : "transparent",
                            color:
                              openDirectionMasterId === beatFocus.id
                                ? "var(--lm-paper)"
                                : "var(--lm-text-secondary)",
                            borderColor:
                              openDirectionMasterId === beatFocus.id
                                ? "var(--lm-ink)"
                                : "var(--lm-border-strong)",
                          }}
                          aria-pressed={openDirectionMasterId === beatFocus.id}
                          title="Master — the video on the beat's thumbnail"
                        >
                          <Crown className="h-3.5 w-3.5" strokeWidth={2.5} />
                          Master
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => toggleApprove(beatFocus)}
                        className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-mono font-bold uppercase tracking-wider transition-all active:scale-95"
                        style={{
                          backgroundColor: isApproved(beatFocus)
                            ? "var(--lm-coral)"
                            : "transparent",
                          color: isApproved(beatFocus)
                            ? "#000"
                            : "var(--lm-text-secondary)",
                          borderColor: isApproved(beatFocus)
                            ? "var(--lm-coral)"
                            : "var(--lm-border-strong)",
                        }}
                        aria-pressed={isApproved(beatFocus)}
                      >
                        <Check className="h-3.5 w-3.5" strokeWidth={3} />
                        {isApproved(beatFocus) ? "Approved" : "Approve"}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeFromDirection(beatFocus)}
                        className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-mono font-bold uppercase tracking-wider transition-opacity hover:opacity-80"
                        style={{
                          borderColor: "var(--lm-border-strong)",
                          color: "var(--lm-text-secondary)",
                        }}
                        title="Remove from this beat (stays in the gallery)"
                      >
                        <X className="h-3.5 w-3.5" strokeWidth={3} />
                        Remove
                      </button>
                      <ArmedDeleteButton
                        label="Delete"
                        size="lg"
                        variant="chrome"
                        title="Permanently delete from the gallery"
                        onConfirm={() =>
                          void deleteAssetsByIds([beatFocus.id])
                        }
                      />
                    </span>
                  </div>

                  {/* Element strip: scroll through the beat's assets */}
                  {beatElements.length > 1 && (
                    <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
                      {beatElements.map((el) => {
                        const active = el.id === beatFocus.id;
                        const role =
                          el.kind === "video"
                            ? "video"
                            : el.tagNames.includes("character")
                              ? "C"
                              : el.tagNames.includes("location")
                                ? "L"
                                : null;
                        return (
                          <button
                            key={el.id}
                            type="button"
                            onClick={() => setBeatFocusId(el.id)}
                            className="relative h-20 shrink-0 overflow-hidden rounded-lg transition-transform hover:scale-[1.03]"
                            style={{
                              border: active
                                ? "2px solid var(--lm-coral)"
                                : "1px solid var(--lm-border)",
                              aspectRatio:
                                el.width && el.height
                                  ? `${el.width} / ${el.height}`
                                  : "1 / 1",
                            }}
                            aria-pressed={active}
                            title={
                              el.kind === "video" ? "Video take" : undefined
                            }
                          >
                            <img
                              src={el.thumbUrl ?? el.url}
                              alt=""
                              className="h-full w-full object-cover"
                              loading="lazy"
                            />
                            {el.kind === "video" && (
                              <span
                                className="pointer-events-none absolute left-1/2 top-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full"
                                style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
                              >
                                <Play
                                  className="ml-0.5 h-3 w-3"
                                  fill="#fff"
                                  color="#fff"
                                />
                              </span>
                            )}
                            {role && role !== "video" && (
                              <span
                                className="absolute left-1 top-1 flex h-4 w-4 items-center justify-center rounded text-[8px] font-mono font-bold"
                                style={{
                                  backgroundColor: "rgba(0,0,0,0.62)",
                                  color: "#fff",
                                }}
                              >
                                {role}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : (
                <p
                  className="mt-10 text-center text-[13px]"
                  style={{ color: "var(--lm-text-tertiary)" }}
                >
                  No elements yet — drop images and video anywhere to build
                  this beat.
                </p>
              )}
              <DirectionTextBlock
                description={openDirection.description}
                onSave={saveDirectionText}
              />
            </div>
          </div>
        ) : openDirection ? (
          /* ── Stack drill-in ── */
          <div className="h-full overflow-y-auto px-4 pb-10 pt-1 md:px-6">
            <div className="mb-4">
              <DirectionTextBlock
                description={openDirection.description}
                onSave={saveDirectionText}
              />
            </div>
            {visibleAssets.length === 0 ? (
              <p
                className="mt-10 text-center text-[13px]"
                style={{ color: "var(--lm-text-tertiary)" }}
              >
                {approvedOnly
                  ? "Nothing approved in this stack yet."
                  : "Empty stack — drop images anywhere to fill it."}
              </p>
            ) : (
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
                    showCollectionLabel={false}
                    isMaster={openDirectionMasterId === asset.id}
                    onMaster={() =>
                      setMaster(
                        openDirection.folderId as string,
                        openDirectionMasterId === asset.id ? null : asset.id,
                      )
                    }
                    onRemove={() => removeFromDirection(asset)}
                    onDelete={() => void deleteAssetsByIds([asset.id])}
                    selectable={selectMode}
                    selected={selectedIds.has(asset.id)}
                    onToggleSelect={() => toggleSelect(asset.id)}
                  />
                ))}
              </div>
            )}
          </div>
        ) : effectiveTab === "beats" ? (
          /* ── Beats mode: stacked beat cards + New beat ── */
          <div className="h-full overflow-y-auto px-4 pb-10 pt-1 md:px-8">
            <div
              className="mx-auto max-w-[1500px] columns-1 sm:columns-2 xl:columns-3"
              style={{ columnGap: "16px" }}
            >
              <AddCard
                label="New beat"
                hint="Upload assets, sort them, name it"
                onClick={() =>
                  setComposer({
                    name: "",
                    files: [],
                    buckets: [],
                    linked: [],
                    prompt: "",
                  })
                }
              />
              {beatCards.map((direction) => (
                <DirectionCard
                  key={direction.id}
                  direction={direction}
                  onOpen={() => {
                    setOpenDirectionId(direction.id);
                    setBeatFocusId(null);
                  }}
                  onDelete={() => deleteDirectionById(direction.id)}
                />
              ))}
            </div>

            {/* Unsorted project files (added from the gallery) */}
            {visibleAssets.length > 0 && (
              <div className="mx-auto mt-8 max-w-[1500px]">
                <p
                  className="mb-2.5 text-[10px] font-mono font-bold uppercase tracking-[0.18em]"
                  style={{ color: "var(--lm-text-ghost)" }}
                >
                  Unsorted
                  <span className="ml-2 normal-case tracking-normal">
                    — added from the gallery; file them as characters or
                    locations, or use them in beats
                  </span>
                </p>
                <div
                  className="columns-2 sm:columns-3 xl:columns-5"
                  style={{ columnGap: "12px" }}
                >
                  {visibleAssets.map((asset) => (
                    <ReviewTile
                      key={asset.id}
                      asset={asset}
                      approved={isApproved(asset)}
                      likes={likesByAsset.get(asset.id)}
                      onOpen={() => setFocusId(asset.id)}
                      onApprove={() => toggleApprove(asset)}
                      showCollectionLabel={false}
                      onDelete={() => void deleteAssetsByIds([asset.id])}
                      onFileCharacter={
                        asset.kind !== "video"
                          ? () => void fileUnsortedTo(asset, "characters")
                          : undefined
                      }
                      onFileLocation={
                        asset.kind !== "video"
                          ? () => void fileUnsortedTo(asset, "locations")
                          : undefined
                      }
                      onMakeBeat={() => startBeatFromAssets([asset])}
                      selectable={selectMode}
                      selected={selectedIds.has(asset.id)}
                      onToggleSelect={() => toggleSelect(asset.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* ── Characters / Locations mode: stacks + loose pool assets ── */
          <div className="h-full overflow-y-auto px-4 pb-10 pt-1 md:px-6">
            {stackCards.length > 0 && (
              <div className="mb-5">
                <p
                  className="mb-2.5 text-[10px] font-mono font-bold uppercase tracking-[0.18em]"
                  style={{ color: "var(--lm-coral)" }}
                >
                  Stacks
                </p>
                <div
                  className="columns-2 sm:columns-3 xl:columns-5"
                  style={{ columnGap: "12px" }}
                >
                  {stackCards.map((direction) => (
                    <DirectionCard
                      key={direction.id}
                      direction={direction}
                      onOpen={() => setOpenDirectionId(direction.id)}
                      onDelete={() => deleteDirectionById(direction.id)}
                    />
                  ))}
                </div>
              </div>
            )}
            <p
              className="mb-2.5 text-[10px] font-mono font-bold uppercase tracking-[0.18em]"
              style={{ color: "var(--lm-text-ghost)" }}
            >
              Assets
              <span className="ml-2 normal-case tracking-normal">
                — Select several to group them into a stack
              </span>
            </p>
            <div
              className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4"
              style={{ columnGap: "14px" }}
            >
              <AddCard
                label={
                  effectiveTab === "characters"
                    ? "Add characters"
                    : "Add locations"
                }
                hint="Upload images — or drop them anywhere"
                onClick={() => fileInputRef.current?.click()}
              />
              {visibleAssets.map((asset) => (
                <ReviewTile
                  key={asset.id}
                  asset={asset}
                  approved={isApproved(asset)}
                  likes={likesByAsset.get(asset.id)}
                  onOpen={() => setFocusId(asset.id)}
                  onApprove={() => toggleApprove(asset)}
                  showCollectionLabel={false}
                  onDelete={() => void deleteAssetsByIds([asset.id])}
                  selectable={selectMode}
                  selected={selectedIds.has(asset.id)}
                  onToggleSelect={() => toggleSelect(asset.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Multiselect action bar ── */}
      {selectMode && (
        <div
          className="absolute bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-xl border px-3.5 py-2.5"
          style={{
            backgroundColor: "var(--lm-surface-1)",
            borderColor: "var(--lm-ink)",
            boxShadow: "var(--shadow-lg)",
          }}
          role="toolbar"
          aria-label="Selection actions"
        >
          {bulkBusy ? (
            <span
              className="px-1 text-[11px] font-mono font-bold uppercase tracking-wider"
              style={{ color: "var(--lm-text-secondary)" }}
              role="status"
            >
              {bulkBusy}
            </span>
          ) : (
            <>
              <span
                className="text-[11px] font-mono font-bold uppercase tracking-wider"
                style={{ color: "var(--lm-text-secondary)" }}
              >
                {selectedIds.size} selected
              </span>
              {openDirection && (
                <button
                  type="button"
                  disabled={selectedIds.size === 0}
                  onClick={() => void removeSelectedFromDirection()}
                  className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-mono font-bold uppercase tracking-wider transition-opacity hover:opacity-80 disabled:opacity-40"
                  style={{
                    borderColor: "var(--lm-border-strong)",
                    color: "var(--lm-text-secondary)",
                  }}
                  title="Remove from this direction — assets stay in the gallery"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={3} />
                  Remove
                </button>
              )}
              {!openDirection &&
                effectiveTab === "beats" &&
                selectedIds.size > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      startBeatFromAssets(
                        assets.filter((asset) => selectedIds.has(asset.id)),
                      )
                    }
                    className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-mono font-bold uppercase tracking-wider transition-opacity hover:opacity-90"
                    style={{ backgroundColor: "var(--lm-coral)", color: "#000" }}
                    title="Start a new beat from the selection — name it, then save"
                  >
                    <Clapperboard className="h-3.5 w-3.5" strokeWidth={2.5} />
                    New beat
                  </button>
                )}
              {!openDirection &&
                effectiveTab !== "beats" &&
                selectedIds.size > 0 && (
                  <>
                    <input
                      type="text"
                      value={stackName}
                      onChange={(e) => setStackName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void createStackFromSelection();
                        }
                        e.stopPropagation();
                      }}
                      placeholder="Stack name…"
                      className="w-[150px] rounded-lg border px-2.5 py-1.5 text-[12px] outline-none"
                      style={{
                        backgroundColor: "var(--lm-surface-2)",
                        borderColor: "var(--lm-border)",
                        color: "var(--lm-text-primary)",
                      }}
                      aria-label="Name for the new stack"
                    />
                    <button
                      type="button"
                      disabled={!stackName.trim()}
                      onClick={() => void createStackFromSelection()}
                      className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-mono font-bold uppercase tracking-wider transition-opacity hover:opacity-90 disabled:opacity-40"
                      style={{ backgroundColor: "var(--lm-coral)", color: "#000" }}
                      title="Group the selected assets into a named stack (one direction)"
                    >
                      <Plus className="h-3.5 w-3.5" strokeWidth={3} />
                      Create stack
                    </button>
                  </>
                )}
              {selectedIds.size > 0 && (
                <ArmedDeleteButton
                  label={`Delete ${selectedIds.size}`}
                  variant="chrome"
                  title="Permanently delete from the gallery"
                  onConfirm={() => void deleteAssetsByIds([...selectedIds])}
                />
              )}
              <button
                type="button"
                onClick={exitSelect}
                className="rounded-lg px-2 py-1.5 text-[11px] font-mono font-bold uppercase tracking-wider transition-opacity hover:opacity-80"
                style={{ color: "var(--lm-text-tertiary)" }}
                title="Exit selection (Esc)"
              >
                Done
              </button>
            </>
          )}
        </div>
      )}

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
              Images &amp; videos · a .txt becomes the prompt · the first
              video becomes the shot
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
          // Adding files the collection into the active layer.
          section={effectiveTab}
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
                section: effectiveTab,
              });
            }
          }}
          onCreate={(name) => {
            if (!projectId) return;
            void (async () => {
              const { folderId } = await createFolder({
                ownerUserId,
                name,
                kind: "direction",
              });
              await addCollection({
                ownerUserId,
                projectId: projectId as Id<"folders">,
                folderId,
                section: effectiveTab,
              });
            })();
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

/* ── Direction card ──
 * Beats: a compact STACK with the master video on top — poster idle,
 * playback on hover, arrows to cycle when the beat has several takes.
 * Video-less stacks: the fanned deck with the image master + hover rotate. */
function DirectionCard({
  direction,
  onOpen,
  onDelete,
}: {
  direction: DirectionCardData;
  onOpen: () => void;
  /** Deletes the whole direction (assets stay in the gallery). */
  onDelete?: () => void;
}) {
  const cover = direction.cover;
  const beatVideos = direction.beatVideos;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoIndex, setVideoIndex] = useState(0);
  const activeVideo =
    beatVideos.length > 0
      ? beatVideos[Math.min(videoIndex, beatVideos.length - 1)]!
      : null;
  // Hover 1s → rotate through the options in place (image decks only).
  const preview = useStackHoverPreview(
    activeVideo ? 0 : direction.previews.length,
  );

  const optionNoun = direction.section === "beats" ? "frame" : "option";
  const breakdown = [
    direction.videos > 0 &&
      `${direction.videos} video${direction.videos === 1 ? "" : "s"}`,
    direction.images > 0 &&
      `${direction.images} ${optionNoun}${direction.images === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const cycleVideo = (delta: number) => {
    setVideoIndex(
      (current) =>
        (current + delta + beatVideos.length) % beatVideos.length,
    );
    // Still hovered — keep the new take playing.
    requestAnimationFrame(() => void videoRef.current?.play().catch(() => {}));
  };

  if (activeVideo) {
    return (
      <div
        className="group relative mb-5 block break-inside-avoid cursor-pointer"
        style={{
          aspectRatio:
            activeVideo.width && activeVideo.height
              ? `${activeVideo.width} / ${activeVideo.height}`
              : "16 / 9",
        }}
        onClick={onOpen}
        onMouseEnter={() => void videoRef.current?.play().catch(() => {})}
        onMouseLeave={() => videoRef.current?.pause()}
        role="button"
        aria-label={`Open beat: ${direction.name}`}
      >
        {/* Fanned deck — the beat's other assets peeking behind the shot */}
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

        {/* Master video on top */}
        <div
          className="absolute inset-0 z-[3] overflow-hidden rounded-xl transition-transform duration-200 ease-out group-hover:-translate-y-[3px]"
          style={{
            border: "2px solid var(--lm-border-strong)",
            backgroundColor: "#000",
            boxShadow: "0 6px 18px rgba(0,0,0,0.45)",
          }}
        >
          <video
            ref={videoRef}
            key={activeVideo.id}
            src={activeVideo.url}
            poster={thumbIsSharp(activeVideo) ? activeVideo.thumbUrl : undefined}
            muted
            loop
            playsInline
            preload={thumbIsSharp(activeVideo) ? "none" : "metadata"}
            onLoadedMetadata={(e) => {
              if (
                !thumbIsSharp(activeVideo) &&
                e.currentTarget.currentTime === 0
              ) {
                e.currentTarget.currentTime = 0.001;
              }
            }}
            className="absolute inset-0 h-full w-full object-cover"
          />

          {/* Play affordance until hover starts the shot */}
          <span
            className="pointer-events-none absolute left-1/2 top-1/2 z-[2] flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full transition-opacity duration-200 group-hover:opacity-0"
            style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          >
            <Play className="ml-0.5 h-4 w-4" fill="#fff" color="#fff" />
          </span>

          {/* Cycle between the beat's takes */}
          {beatVideos.length > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  cycleVideo(-1);
                }}
                className="absolute left-1.5 top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100"
                style={{ backgroundColor: "rgba(0,0,0,0.62)", color: "#fff" }}
                aria-label="Previous take"
                title="Previous take"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  cycleVideo(1);
                }}
                className="absolute right-1.5 top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100"
                style={{ backgroundColor: "rgba(0,0,0,0.62)", color: "#fff" }}
                aria-label="Next take"
                title="Next take"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </>
          )}

          {/* Delete the direction (hover, two-step) */}
          {onDelete && (
            <div className="absolute left-2 top-2 z-10 opacity-0 transition-opacity group-hover:opacity-100">
              <ArmedDeleteButton
                compact
                title="Delete this beat — assets stay in the gallery"
                onConfirm={onDelete}
              />
            </div>
          )}

          {/* Likes + take counter */}
          <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
            {direction.likes > 0 && (
              <span
                className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider"
                style={{
                  backgroundColor: "rgba(0,0,0,0.62)",
                  color: "var(--lm-coral)",
                  border:
                    "1px solid color-mix(in srgb, var(--lm-coral) 42%, transparent)",
                }}
              >
                <Heart
                  className="h-3 w-3"
                  fill="currentColor"
                  strokeWidth={2.5}
                />
                {direction.likes}
              </span>
            )}
            <span
              className="rounded-md px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider"
              style={{
                backgroundColor: "rgba(0,0,0,0.62)",
                color: "var(--lm-coral)",
                border:
                  "1px solid color-mix(in srgb, var(--lm-coral) 42%, transparent)",
              }}
            >
              {beatVideos.length > 1
                ? `${videoIndex + 1}/${beatVideos.length}`
                : direction.count}
            </span>
          </div>

          {/* Bottom label over a gradient */}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-20"
            style={{
              background:
                "linear-gradient(to top, rgba(0,0,0,0.78), rgba(0,0,0,0.3) 60%, transparent)",
            }}
          />
          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3">
            <div className="min-w-0">
              <p
                className="text-[9px] font-mono font-bold uppercase tracking-[0.16em]"
                style={{ color: "var(--lm-coral)" }}
              >
                Beat
              </p>
              <p
                className="truncate text-[15px] font-semibold"
                style={{
                  color: "#fff",
                  textShadow: "0 1px 4px rgba(0,0,0,0.8)",
                }}
              >
                {direction.name}
              </p>
              {breakdown && (
                <p
                  className="text-[10px] font-mono font-bold uppercase tracking-wider"
                  style={{ color: "rgba(255,255,255,0.68)" }}
                >
                  {breakdown}
                </p>
              )}
            </div>
            <span
              className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[9px] font-mono font-bold uppercase tracking-wider opacity-0 transition-opacity group-hover:opacity-100"
              style={{ backgroundColor: "rgba(0,0,0,0.62)", color: "#fff" }}
            >
              Expand
              <ChevronRight className="h-3 w-3" />
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="group relative mb-6 block break-inside-avoid cursor-pointer"
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

        {/* Delete the direction (hover, two-step) */}
        {onDelete && (
          <div className="absolute left-2 top-2 z-10 opacity-0 transition-opacity group-hover:opacity-100">
            <ArmedDeleteButton
              compact
              title="Delete this direction — assets stay in the gallery"
              onConfirm={onDelete}
            />
          </div>
        )}

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
              {breakdown ||
                `${direction.count} ${direction.count === 1 ? "option" : "options"}`}
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
  onDelete,
  onFileCharacter,
  onFileLocation,
  onMakeBeat,
  selectable,
  selected,
  onToggleSelect,
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
  /** Permanently deletes the asset from the gallery. */
  onDelete?: () => void;
  /** One-shot filing of an unsorted file into the Characters / Locations
   * pool (a move — it leaves the unsorted section). */
  onFileCharacter?: () => void;
  onFileLocation?: () => void;
  /** Start a new beat from this asset (videos in Unsorted). */
  onMakeBeat?: () => void;
  /** Multiselect: clicks toggle selection instead of opening the feed. */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  return (
    <div
      className="group relative mb-3.5 block break-inside-avoid cursor-pointer overflow-hidden rounded-xl"
      style={{
        border: selected
          ? "2px solid #fff"
          : approved
            ? "2px solid var(--lm-coral)"
            : "1px solid var(--lm-border-subtle)",
        backgroundColor: "var(--lm-surface-1)",
      }}
      onClick={selectable ? onToggleSelect : onOpen}
      aria-selected={selectable ? Boolean(selected) : undefined}
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

      {/* Selection check (multiselect mode) */}
      {selectable && (
        <span
          className="absolute left-2.5 top-2.5 z-20 flex h-6 w-6 items-center justify-center rounded-full border"
          style={{
            backgroundColor: selected ? "#fff" : "rgba(0,0,0,0.55)",
            borderColor: selected ? "#fff" : "rgba(255,255,255,0.45)",
            color: "#000",
          }}
          aria-hidden
        >
          {selected && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
        </span>
      )}

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
        {!selectable && (
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
        )}
      </div>

      {/* Master (direction thumbnail) toggle */}
      {onMaster && !selectable && (
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

      {/* @name handle */}
      {asset.name && !selectable && (
        <div
          className={`pointer-events-none absolute bottom-2.5 left-2.5 z-10 rounded-md px-2 py-0.5 text-[9px] font-mono font-bold tracking-wider ${
            onFileCharacter || onFileLocation || onMakeBeat
              ? "transition-opacity group-hover:opacity-0"
              : ""
          }`}
          style={{ backgroundColor: "rgba(0,0,0,0.62)", color: "var(--lm-coral)" }}
        >
          @{asset.name}
        </div>
      )}

      {/* File an unsorted asset into a pool / start a beat from it (hover) */}
      {(onFileCharacter || onFileLocation || onMakeBeat) && !selectable && (
        <div className="absolute bottom-2.5 left-2.5 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {onMakeBeat && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMakeBeat();
              }}
              className="flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-mono font-bold uppercase tracking-wider"
              style={{
                backgroundColor: "rgba(0,0,0,0.62)",
                color: "#fff",
                borderColor: "rgba(255,255,255,0.25)",
              }}
              title="Start a new beat with this — name it, then save"
            >
              <Clapperboard className="h-3 w-3" strokeWidth={2.5} />
              Beat
            </button>
          )}
          {onFileCharacter && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onFileCharacter();
              }}
              className="flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-mono font-bold uppercase tracking-wider"
              style={{
                backgroundColor: "rgba(0,0,0,0.62)",
                color: "#fff",
                borderColor: "rgba(255,255,255,0.25)",
              }}
              title="File into this project's Characters"
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
              className="flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-mono font-bold uppercase tracking-wider"
              style={{
                backgroundColor: "rgba(0,0,0,0.62)",
                color: "#fff",
                borderColor: "rgba(255,255,255,0.25)",
              }}
              title="File into this project's Locations"
            >
              <MapPin className="h-3 w-3" strokeWidth={2.5} />
              Loc
            </button>
          )}
        </div>
      )}

      {/* Remove (membership) + Delete (permanent), bottom-right on hover */}
      {(onRemove || onDelete) && !selectable && (
        <div className="absolute bottom-2.5 right-2.5 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {onRemove && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              className="flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-mono font-bold uppercase tracking-wider"
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
          {onDelete && (
            <ArmedDeleteButton
              compact
              title="Permanently delete from the gallery"
              onConfirm={onDelete}
            />
          )}
        </div>
      )}
    </div>
  );
}

/* ── Inline @name editor: the asset's handle for beat composing ── */
function AssetNameEditor({
  name,
  onSave,
}: {
  name?: string;
  onSave: (name: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  if (draft === null) {
    return (
      <button
        type="button"
        onClick={() => setDraft(name ?? "")}
        className="flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-mono font-bold tracking-wider transition-opacity hover:opacity-80"
        style={{
          borderColor: "var(--lm-border)",
          color: name ? "var(--lm-coral)" : "var(--lm-text-ghost)",
        }}
        title="Name this asset — reference it later as @name"
      >
        <AtSign className="h-3 w-3" />
        {name ?? "name"}
      </button>
    );
  }

  const commit = () => {
    const next = (draft ?? "").trim();
    setDraft(null);
    if (next === (name ?? "")) return;
    onSave(next);
  };

  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          setDraft(null);
        }
      }}
      onBlur={commit}
      placeholder="e.g. cassandra"
      className="w-[150px] rounded-lg border px-2 py-1 text-[12px] outline-none"
      style={{
        backgroundColor: "var(--lm-surface-2)",
        borderColor: "var(--lm-coral)",
        color: "var(--lm-text-primary)",
      }}
      aria-label="Asset name"
    />
  );
}

/* ── @name autocomplete for the beat composer ── */
type NamedAssetOption = {
  assetId: string;
  name: string;
  kind: "image" | "video";
  thumbUrl?: string;
  tagNames: string[];
};

function AtNameSelector({
  options,
  onPick,
}: {
  options: NamedAssetOption[];
  onPick: (option: NamedAssetOption) => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.replace(/^@/, "").trim().toLowerCase();
  const matches = needle
    ? options
        .filter((option) => option.name.toLowerCase().includes(needle))
        .slice(0, 8)
    : [];

  return (
    <div className="relative mt-3 max-w-[420px]">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && matches[0]) {
            e.preventDefault();
            onPick(matches[0]);
            setQuery("");
          } else if (e.key === "Escape") {
            setQuery("");
          }
          e.stopPropagation();
        }}
        placeholder="@name — pull in an existing asset…"
        className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none transition-colors focus:border-[var(--lm-coral)]"
        style={{
          backgroundColor: "var(--lm-surface-2)",
          borderColor: "var(--lm-border)",
          color: "var(--lm-text-primary)",
        }}
        aria-label="Add an existing asset by name"
      />
      {matches.length > 0 && (
        <div
          className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-lg border"
          style={{
            backgroundColor: "var(--lm-surface-1)",
            borderColor: "var(--lm-border-strong)",
            boxShadow: "var(--shadow-lg)",
          }}
          role="listbox"
        >
          {matches.map((option) => (
            <button
              key={option.assetId}
              type="button"
              onClick={() => {
                onPick(option);
                setQuery("");
              }}
              className="flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--lm-surface-2)]"
              role="option"
              aria-selected={false}
            >
              {option.thumbUrl ? (
                <img
                  src={option.thumbUrl}
                  alt=""
                  className="h-8 w-8 shrink-0 rounded-md object-cover"
                />
              ) : (
                <span
                  className="h-8 w-8 shrink-0 rounded-md"
                  style={{ backgroundColor: "var(--lm-surface-2)" }}
                />
              )}
              <span
                className="min-w-0 flex-1 truncate text-[12px] font-semibold"
                style={{ color: "var(--lm-text-primary)" }}
              >
                @{option.name}
              </span>
              <span
                className="shrink-0 text-[9px] font-mono font-bold uppercase tracking-wider"
                style={{ color: "var(--lm-text-ghost)" }}
              >
                {option.kind === "video"
                  ? "video"
                  : option.tagNames.includes("character")
                    ? "character"
                    : option.tagNames.includes("location")
                      ? "location"
                      : "image"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Dashed add-card: the mode's primary create action, in the masonry ── */
function AddCard({
  label,
  hint,
  onClick,
}: {
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-5 flex w-full break-inside-avoid flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-12 transition-colors hover:border-[var(--lm-coral)] hover:text-[var(--lm-coral)]"
      style={{
        borderColor: "var(--lm-border-strong)",
        color: "var(--lm-text-tertiary)",
      }}
    >
      <Plus className="h-6 w-6" />
      <span className="text-[13px] font-semibold">{label}</span>
      <span
        className="text-[10px] font-mono uppercase tracking-wider"
        style={{ color: "var(--lm-text-ghost)" }}
      >
        {hint}
      </span>
    </button>
  );
}

/* ── Two-step destructive button: first click arms, pointer-leave disarms ── */
function ArmedDeleteButton({
  label,
  size = "sm",
  variant = "overlay",
  compact = false,
  title,
  onConfirm,
}: {
  /** Idle label; omitted when compact (icon-only until armed). */
  label?: string;
  size?: "sm" | "lg";
  /** overlay = dark chip over media; chrome = bordered header/bar button. */
  variant?: "overlay" | "chrome";
  compact?: boolean;
  title?: string;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (!armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        onConfirm();
      }}
      onPointerLeave={() => setArmed(false)}
      className={`flex items-center gap-1 rounded-lg border font-mono font-bold uppercase tracking-wider transition-colors ${
        size === "lg" ? "px-3 py-1.5 text-[11px]" : "px-2 py-1 text-[10px]"
      }`}
      style={
        armed
          ? {
              backgroundColor: "var(--lm-coral)",
              color: "#000",
              borderColor: "var(--lm-coral)",
            }
          : variant === "chrome"
            ? {
                backgroundColor: "transparent",
                color: "var(--lm-text-tertiary)",
                borderColor: "var(--lm-border-strong)",
              }
            : {
                backgroundColor: "rgba(0,0,0,0.62)",
                color: "#fff",
                borderColor: "rgba(255,255,255,0.25)",
              }
      }
      aria-pressed={armed}
      title={title}
    >
      <Trash2
        className={size === "lg" ? "h-3.5 w-3.5" : "h-3 w-3"}
        strokeWidth={2.5}
      />
      {armed ? "Sure?" : compact ? "" : label}
    </button>
  );
}

/* ── Direction text: read view with an edit affordance → inline textarea ── */
function DirectionTextBlock({
  description,
  onSave,
}: {
  description?: string;
  onSave: (text: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  if (draft === null) {
    return (
      <div className="mt-4 max-w-[900px]">
        {description && (
          <p
            className="whitespace-pre-wrap text-[13px] leading-relaxed"
            style={{ color: "var(--lm-text-secondary)" }}
          >
            {description}
          </p>
        )}
        <button
          type="button"
          onClick={() => setDraft(description ?? "")}
          className="mt-1.5 flex items-center gap-1 text-[10px] font-mono font-bold uppercase tracking-wider transition-opacity hover:opacity-70"
          style={{ color: "var(--lm-text-ghost)" }}
          title="Edit this direction's text"
        >
          <Pencil className="h-3 w-3" />
          {description ? "Edit text" : "Add text"}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 max-w-[900px]">
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setDraft(null);
          }
        }}
        rows={4}
        className="w-full resize-y bg-transparent text-[13px] leading-relaxed outline-none"
        style={{
          color: "var(--lm-text-secondary)",
          borderBottom: "1px solid var(--lm-border)",
          caretColor: "var(--lm-coral)",
        }}
        aria-label="Direction text"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            onSave(draft.trim());
            setDraft(null);
          }}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-mono font-bold uppercase tracking-wider transition-opacity hover:opacity-90"
          style={{ backgroundColor: "var(--lm-coral)", color: "#000" }}
        >
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
          Save
        </button>
        <button
          type="button"
          onClick={() => setDraft(null)}
          className="text-[11px] font-mono font-bold uppercase tracking-wider transition-opacity hover:opacity-80"
          style={{ color: "var(--lm-text-tertiary)" }}
        >
          Cancel
        </button>
      </div>
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
  onDelete,
  onRename,
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
  /** Permanently delete from the gallery. */
  onDelete?: (asset: ReviewAsset) => void;
  /** Rename the asset (its @name handle). */
  onRename?: (asset: ReviewAsset, name: string) => void;
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
              {onRename && (
                <AssetNameEditor
                  name={asset.name}
                  onSave={(next) => onRename(asset, next)}
                />
              )}
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
                {onDelete && (
                  <ArmedDeleteButton
                    label="Delete"
                    size="lg"
                    title="Permanently delete from the gallery"
                    onConfirm={() => onDelete(asset)}
                  />
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
    variant === "hero"
      ? (asset.url ?? asset.thumbUrl)
      : thumbIsSharp(asset)
        ? (asset.thumbUrl ?? asset.url)
        : (asset.url ?? asset.thumbUrl);

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

  // tile / thumb: fill the boxed parent (absolute inset). A soft (legacy
  // 320px) poster is dropped so the video paints its own first frame.
  if (isVideo) {
    const posterSharp = thumbIsSharp(asset);
    return (
      <>
        <video
          src={posterSharp ? undefined : asset.url}
          poster={posterSharp ? asset.thumbUrl : undefined}
          muted
          playsInline
          preload={posterSharp ? "none" : "metadata"}
          onLoadedMetadata={(e) => {
            if (!posterSharp && e.currentTarget.currentTime === 0) {
              e.currentTarget.currentTime = 0.001;
            }
          }}
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

