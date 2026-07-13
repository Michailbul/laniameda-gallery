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
  ChevronsDown,
  ChevronsUp,
  Copy,
  Crown,
  Download,
  ExternalLink,
  FolderPlus,
  Heart,
  Image as ImageIcon,
  LayoutGrid,
  Link2,
  MapPin,
  Pencil,
  Pin,
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
  LARGE_IMAGE_BYTES,
  appendImageUploadFields,
  uploadImageToR2,
} from "@/lib/image-ingest";
import {
  StackHoverPreviewOverlay,
  useStackHoverPreview,
} from "@/components/gallery/stack-hover-preview";

// Thumbs/posters narrower than this look soft at tile sizes — serve the
// original image, or let the <video> paint a native-res first frame.
const SHARP_THUMB_MIN_WIDTH = 800;
const thumbIsSharp = (asset: { thumbWidth?: number }) =>
  (asset.thumbWidth ?? 0) >= SHARP_THUMB_MIN_WIDTH;

// Masonry tile-size slider bounds (CSS column-width, px).
const TILE_SIZE_MIN = 240;
const TILE_SIZE_MAX = 720;

// Stable manual-order comparator: pinned floats above everything (latest
// pin first), then move-to-top/bottom weights, then the list's natural
// order (newest-first) as the tiebreak.
const byPriority = (a: ReviewAsset, b: ReviewAsset) =>
  (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0) ||
  (b.orderPriority ?? 0) - (a.orderPriority ?? 0);

// R2's public domain has no CORS headers, so downloads stream through a
// same-origin proxy with an attachment header. Owners hit the auth-gated asset
// route; public board viewers hit the token-gated board proxy (pass `token`).
const triggerAssetDownload = (assetId: string, token?: string) => {
  const anchor = document.createElement("a");
  anchor.href = token
    ? `/api/board/download?token=${encodeURIComponent(
        token,
      )}&assetId=${encodeURIComponent(assetId)}`
    : `/api/assets/${encodeURIComponent(assetId)}/download`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
};

type CollectionOption = { id: string; name: string; count?: number };

/** The project's layers. Beats lead — the packaged pitch view. Characters,
 * Locations, and Stills are asset pools where selections become named
 * stacks. */
type ProjectSection = "characters" | "locations" | "stills" | "beats";
type ReviewTab = ProjectSection;

/** The pool modes — every tab except Beats. */
type PoolSection = Exclude<ProjectSection, "beats">;

const POOL_LABELS: Record<PoolSection, string> = {
  characters: "Characters",
  locations: "Locations",
  stills: "Stills",
};

/** The role tag a pool section stamps on its assets. */
const POOL_TAGS: Record<PoolSection, string> = {
  characters: "character",
  locations: "location",
  stills: "still",
};

const SECTION_TABS: { key: ProjectSection; label: string }[] = [
  { key: "beats", label: "Beats" },
  { key: "characters", label: "Characters" },
  { key: "locations", label: "Locations" },
  { key: "stills", label: "Stills" },
];

const TAB_LABELS: Record<ReviewTab, string> = {
  beats: "Beats",
  characters: "Characters",
  locations: "Locations",
  stills: "Stills",
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

/**
 * A ♥ badge over media. For the owner it's a read-only count (with a
 * "Liked by …" tooltip); pass `onToggle` (public viewer mode) to make it an
 * interactive like button that fills when this viewer liked it.
 */
function LikeControl({
  count,
  likes,
  likedByMe,
  onToggle,
  className = "",
}: {
  count: number;
  likes?: AssetLikes;
  likedByMe?: boolean;
  onToggle?: () => void;
  className?: string;
}) {
  const interactive = Boolean(onToggle);
  // Owner view: nothing to show until someone likes. Viewer view: always show
  // the heart so they can like.
  if (!interactive && count <= 0) return null;
  const filled = interactive ? Boolean(likedByMe) : true;
  const shared = {
    className: `flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-mono font-bold uppercase tracking-wider transition-all ${
      interactive ? "active:scale-95" : ""
    } ${className}`,
    style: {
      backgroundColor: filled ? "var(--lm-coral)" : "rgba(0,0,0,0.62)",
      color: filled ? "#000" : "#fff",
      borderColor: filled
        ? "var(--lm-coral)"
        : "color-mix(in srgb, var(--lm-coral) 42%, transparent)",
    } as React.CSSProperties,
    title: interactive
      ? likedByMe
        ? "Liked — click to remove"
        : "Like"
      : likeTitle(likes),
  };
  const inner = (
    <>
      <Heart
        className="h-3 w-3"
        fill={filled ? "currentColor" : "none"}
        strokeWidth={2.5}
      />
      {count > 0 ? count : ""}
    </>
  );
  return interactive ? (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle?.();
      }}
      aria-pressed={Boolean(likedByMe)}
      {...shared}
    >
      {inner}
    </button>
  ) : (
    <span {...shared}>{inner}</span>
  );
}

type ReviewModalProps = {
  ownerUserId?: string;
  /** Folder id of the open project, or null when closed. */
  projectId?: string | null;
  /** All of the owner's plain collections, for the "add collections" picker. */
  allCollections?: CollectionOption[];
  /**
   * Present → read-only PUBLIC viewer mode. The same workspace view, fed by a
   * share token instead of the owner session, with every admin control and the
   * collections picker stripped. Anonymous viewers can still browse, ♥ like,
   * download, and export PDFs.
   */
  viewerToken?: string;
  /**
   * Left edge of the workspace on md+ (the sidebar width), so the sidebar
   * stays visible and usable while reviewing. Mobile stays full-bleed.
   */
  leftOffset?: string;
  onClose?: () => void;
};

type ReviewAsset = {
  id: string;
  /** User-given handle, referenced as @name when composing beats. */
  name?: string;
  /** Manual sort weight — higher floats first, unset = 0. */
  orderPriority?: number;
  /** Pinned in the workspace — floats above everything, pin marker shown. */
  pinnedAt?: number;
  url?: string;
  thumbUrl?: string;
  thumbWidth?: number;
  kind: "image" | "video";
  contentType?: string;
  width?: number;
  height?: number;
  promptText?: string;
  modelName?: string;
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
  /** Pinned cards float first in their mode. */
  pinned: boolean;
  /** Pin timestamp — the shared sort weight against loose assets. */
  pinnedAt?: number;
};

/**
 * Fullscreen project review workspace. Walks every asset across a project's
 * member collections at large size. Two modes: a big-tile masonry (default)
 * and a hero + horizontal filmstrip focus mode you reach by clicking a tile.
 * "Approve" toggles the global `approved` tag so the shortlist is filterable
 * everywhere (project + approved).
 */
export function ReviewModal({
  ownerUserId = "",
  projectId,
  allCollections = [],
  viewerToken,
  leftOffset,
  onClose,
}: ReviewModalProps) {
  // Read-only public viewer mode: same view, token-fed, no admin, no auth.
  const readOnly = Boolean(viewerToken);

  // Anonymous viewer identity (beta, no auth): a random client id persisted in
  // this browser so likes toggle. Only used in viewer mode.
  const [viewerKey, setViewerKey] = useState<string | null>(null);
  useEffect(() => {
    if (!readOnly) return;
    let key = window.localStorage.getItem("lm-board-viewer-key");
    if (!key) {
      key = crypto.randomUUID().replace(/-/g, "").slice(0, 32);
      window.localStorage.setItem("lm-board-viewer-key", key);
    }
    setViewerKey(key);
  }, [readOnly]);

  const ownerProject = useQuery(
    api.projects.getProject,
    !readOnly && projectId
      ? { ownerUserId, projectId: projectId as Id<"folders"> }
      : "skip",
  );
  const viewerBoard = useQuery(
    api.directionBoard.getBoardWorkspace,
    readOnly && viewerToken
      ? { token: viewerToken, viewerKey: viewerKey ?? undefined }
      : "skip",
  );
  const project = readOnly ? viewerBoard : ownerProject;

  const renameAssetMutation = useMutation(api.assets.renameAsset);
  const setAssetPriorityMutation = useMutation(api.assets.setAssetPriority);
  const setAssetPinnedMutation = useMutation(api.assets.setAssetPinned);
  const setFolderPinnedMutation = useMutation(api.folders.setFolderPinned);
  const setTagStateMutation = useMutation(api.assets.setAssetTagState);
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
    !readOnly && projectId ? { ownerUserId } : "skip",
  );

  // ── Viewer likes (read-only mode) ──
  const toggleBoardLikeMutation = useMutation(api.directionBoard.toggleBoardLike);
  const viewerLikedAssets = useMemo(
    () => new Set<string>(viewerBoard?.viewerLikedAssetIds ?? []),
    [viewerBoard],
  );
  const viewerLikedFolders = useMemo(
    () => new Set<string>(viewerBoard?.viewerLikedFolderIds ?? []),
    [viewerBoard],
  );
  const toggleAssetLike = useCallback(
    (assetId: string) => {
      if (!readOnly || !viewerToken || !viewerKey) return;
      void toggleBoardLikeMutation({
        token: viewerToken,
        assetId: assetId as Id<"assets">,
        viewerKey,
      }).catch(() => {});
    },
    [readOnly, viewerToken, viewerKey, toggleBoardLikeMutation],
  );
  const toggleDirectionLike = useCallback(
    (folderId: string) => {
      if (!readOnly || !viewerToken || !viewerKey) return;
      void toggleBoardLikeMutation({
        token: viewerToken,
        folderId: folderId as Id<"folders">,
        viewerKey,
      }).catch(() => {});
    },
    [readOnly, viewerToken, viewerKey, toggleBoardLikeMutation],
  );

  // The active mode of the centered toggle. Projects open on Beats.
  const [activeTab, setActiveTab] = useState<ReviewTab>("beats");
  // Direction currently drilled into (a member collection id), or null when
  // browsing a mode.
  const [openDirectionId, setOpenDirectionId] = useState<string | null>(null);
  const [likedOnly, setLikedOnly] = useState(false);
  // Masonry tile size (target CSS column width). Driven by the header
  // slider; the browser fits as many columns as the viewport allows, so the
  // grid stays responsive at every size. Persisted per browser.
  const [tileSize, setTileSize] = useState(480);
  useEffect(() => {
    const stored = Number(
      window.localStorage.getItem("lm-review-tile-size") ?? "",
    );
    if (stored >= TILE_SIZE_MIN && stored <= TILE_SIZE_MAX) {
      setTileSize(stored);
    }
  }, []);
  const pickTileSize = useCallback((next: number) => {
    setTileSize(next);
    window.localStorage.setItem("lm-review-tile-size", String(next));
  }, []);
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
      orderPriority: asset.orderPriority,
      pinnedAt: asset.pinnedAt,
      url: asset.url ?? asset.thumbUrl,
      thumbUrl: asset.thumbUrl ?? asset.url,
      thumbWidth: asset.thumbWidth,
      kind: asset.kind,
      contentType: asset.contentType,
      width: asset.width,
      height: asset.height,
      promptText: asset.promptText,
      modelName: asset.modelName,
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

  // Per-project asset POOLS for the Characters / Locations / Stills modes:
  // auto-created "<Project> — Characters/Locations/Stills" collections that
  // hold the loose assets. Named stacks are every OTHER collection in that
  // section.
  const pools = useMemo(() => {
    const projectName = project?.project.name;
    const find = (section: PoolSection) =>
      (project?.collections ?? []).find(
        (c) =>
          c.name === `${projectName} — ${POOL_LABELS[section]}` &&
          tabOf(c.section) === section,
      );
    return {
      characters: find("characters"),
      locations: find("locations"),
      stills: find("stills"),
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
        pinned: Boolean(collection.pinnedAt),
        pinnedAt: collection.pinnedAt,
      };
    },
    [resolveCoverId, toReviewAsset, likesByCollection],
  );

  // Beats mode cards, pinned first.
  const beatCards = useMemo<DirectionCardData[]>(
    () =>
      effectiveTab === "beats"
        ? [...tabCollections]
            .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0))
            .map(toDirectionCard)
        : [],
    [effectiveTab, tabCollections, toDirectionCard],
  );

  // Pool modes: named stacks (every section collection except the pool) +
  // the loose pool assets not yet in any stack.
  const poolCollection =
    effectiveTab === "beats" ? undefined : pools[effectiveTab];
  const stackCards = useMemo<DirectionCardData[]>(
    () =>
      effectiveTab === "beats"
        ? []
        : [...tabCollections]
            .filter((c) => c.folderId !== poolCollection?.folderId)
            .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0))
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
    return out.sort(byPriority);
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
    return out.sort(byPriority);
  }, [unsortedCollections, toReviewAsset]);

  const drilledAssets = useMemo<ReviewAsset[]>(
    () =>
      openDirection
        ? openDirection.assets
            .map((a) => toReviewAsset(a, openDirection))
            .sort(byPriority)
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

  const passesFilters = useCallback(
    (asset: ReviewAsset) =>
      !likedOnly || (likesByAsset.get(asset.id)?.count ?? 0) > 0,
    [likedOnly, likesByAsset],
  );

  const visibleAssets = useMemo(
    () => assets.filter(passesFilters),
    [assets, passesFilters],
  );

  // Characters / Locations mode: stacks flow in the SAME masonry as the loose
  // assets, ordered by the shared pin / move-to-top weights. The sort is
  // stable, so unweighted stacks lead the unweighted assets.
  const modeItems = useMemo<
    (
      | { kind: "stack"; card: DirectionCardData }
      | { kind: "asset"; asset: ReviewAsset }
    )[]
  >(() => {
    if (effectiveTab === "beats" || openDirection) return [];
    const weighted = [
      ...stackCards.map((card) => ({
        item: { kind: "stack" as const, card },
        pinnedAt: card.pinnedAt ?? 0,
        orderPriority: 0,
      })),
      ...visibleAssets.map((asset) => ({
        item: { kind: "asset" as const, asset },
        pinnedAt: asset.pinnedAt ?? 0,
        orderPriority: asset.orderPriority ?? 0,
      })),
    ];
    weighted.sort(
      (a, b) => b.pinnedAt - a.pinnedAt || b.orderPriority - a.orderPriority,
    );
    return weighted.map((entry) => entry.item);
  }, [effectiveTab, openDirection, stackCards, visibleAssets]);

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
    return [...visibleAssets].sort(
      (a, b) => rank(a) - rank(b) || byPriority(a, b),
    );
  }, [openDirection, visibleAssets, drilledBeat]);
  // Focused element in the beat viewer: explicit pick, else the master.
  const beatFocus =
    beatElements.find((a) => a.id === beatFocusId) ??
    beatElements.find((a) => a.id === drilledBeat?.id) ??
    beatElements[0] ??
    null;

  // Step the drilled direction's focused element (arrow keys + trackpad).
  const stepBeatFocus = useCallback(
    (delta: number) => {
      if (beatElements.length === 0 || !beatFocus) return;
      const idx = beatElements.findIndex((a) => a.id === beatFocus.id);
      if (idx < 0) return;
      const next =
        beatElements[
          Math.min(beatElements.length - 1, Math.max(0, idx + delta))
        ];
      if (next && next.id !== beatFocus.id) setBeatFocusId(next.id);
    },
    [beatElements, beatFocus],
  );
  const stepBeatFocusRef = useRef(stepBeatFocus);
  useEffect(() => {
    stepBeatFocusRef.current = stepBeatFocus;
  }, [stepBeatFocus]);

  // Two-finger trackpad scroll over the preview pane walks the elements —
  // dominant axis wins, with a threshold + cooldown so momentum doesn't
  // skip. Native non-passive listener: preventDefault must actually stop
  // macOS back-swipe and page scroll (React's onWheel is passive).
  const previewPaneRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = previewPaneRef.current;
    if (!el) return;
    let acc = 0;
    let coolUntil = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const dominant =
        Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const now = performance.now();
      if (now < coolUntil) return;
      acc += dominant;
      if (Math.abs(acc) >= 90) {
        stepBeatFocusRef.current(acc > 0 ? 1 : -1);
        acc = 0;
        coolUntil = now + 320;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // Re-bind whenever the pane can (un)mount: drill-in, select mode, focus.
  }, [openDirectionId, selectMode, focusId]);

  // The full-res feed walks the current scope (drilled direction or mode).
  const feedAssets = visibleAssets;
  const focusIndex = focusId
    ? feedAssets.findIndex((a) => a.id === focusId)
    : -1;
  const focusAsset = focusIndex >= 0 ? feedAssets[focusIndex] : null;
  // Drives the header/chip layout. Derived (not focusId) so a focus that fell
  // out of the visible set — e.g. after a filter change — cleanly reverts to
  // the grid without a state-syncing effect.
  const inFocus = Boolean(focusAsset);

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
          // Convex Node action args cap at 5 MiB and small images travel as
          // base64 INSIDE the action call — large ones must go browser → R2
          // (like videos) or ingest rejects them with "arguments size is too
          // large".
          const isLargeImage =
            !isVideo &&
            file.type.startsWith("image/") &&
            file.size > LARGE_IMAGE_BYTES;
          // Mirrors the upload panel: small images travel in the ingest
          // request; videos (and large images) upload browser→R2, and the
          // ingest request only carries the r2Key + poster + metadata.
          const formData = buildUploadFormData({
            promptText,
            folderId: targetFolderId,
            file: isVideo || isLargeImage ? null : file,
          });
          if (isLargeImage) {
            const upload = await uploadImageToR2(file, {
              upload: uploadVideo,
            });
            appendImageUploadFields(formData, upload);
            // file was omitted from the form, so re-key on the file name to
            // keep re-drops idempotent (matches the small-image key shape).
            const key = buildIngestKey({
              promptText: promptText || undefined,
              fileName: file.name,
            });
            if (key) formData.set("ingestKey", key);
          }
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
  const ensurePool = async (section: PoolSection): Promise<string> => {
    const existing = pools[section];
    if (existing) return existing.folderId as string;
    const name = `${project?.project.name ?? "Project"} — ${POOL_LABELS[section]}`;
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

  // Pool modes: uploads land straight in the pool, tagged with their role.
  const uploadToPool = async (media: File[], section: PoolSection) => {
    const poolId = await ensurePool(section);
    const uploaded = await uploadFilesToDirection(media, poolId, "", true);
    const tag = POOL_TAGS[section];
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
      const poolIds: Partial<Record<PoolSection, string>> = {};
      const fileToPool = async (assetId: string, bucket: BeatBucket) => {
        if (bucket === "video") return;
        const section =
          bucket === "character"
            ? ("characters" as const)
            : bucket === "location"
              ? ("locations" as const)
              : ("stills" as const);
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

  // File an unsorted project file into a section pool: pool membership +
  // role tag replace its unsorted memberships (a move). Plain closure (not
  // memoized) because ensurePool is re-created each render.
  const fileUnsortedTo = async (asset: ReviewAsset, section: PoolSection) => {
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
      tagNames: [POOL_TAGS[section]],
    }).catch(() => {});
  };

  // Move an asset to the top/bottom of the workspace views.
  const moveAsset = useCallback(
    (assetId: string, position: "top" | "bottom") => {
      void setAssetPriorityMutation({
        ownerUserId,
        assetId: assetId as Id<"assets">,
        position,
      }).catch(() => {});
    },
    [ownerUserId, setAssetPriorityMutation],
  );

  // Pin/unpin an asset (floats first with a pin marker).
  const toggleAssetPin = useCallback(
    (asset: ReviewAsset) => {
      void setAssetPinnedMutation({
        ownerUserId,
        assetId: asset.id as Id<"assets">,
        pinned: !asset.pinnedAt,
      }).catch(() => {});
    },
    [ownerUserId, setAssetPinnedMutation],
  );

  // Pin/unpin a direction card (beat or stack).
  const toggleDirectionPin = useCallback(
    (direction: DirectionCardData) => {
      void setFolderPinnedMutation({
        ownerUserId,
        folderId: direction.id as Id<"folders">,
        pinned: !direction.pinned,
      }).catch(() => {});
    },
    [ownerUserId, setFolderPinnedMutation],
  );

  // Add/remove a free-form tag on an asset (visible on the project tiles).
  const setAssetTag = useCallback(
    (assetId: string, tagName: string, present: boolean) => {
      void setTagStateMutation({
        ownerUserId,
        assetId: assetId as Id<"assets">,
        tagName,
        present,
      }).catch(() => {});
    },
    [ownerUserId, setTagStateMutation],
  );

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
      const idx = feedAssets.findIndex((a) => a.id === current);
      if (idx < 0) return current;
      const nextIdx = Math.min(
        feedAssets.length - 1,
        Math.max(0, idx + delta),
      );
      return feedAssets[nextIdx]?.id ?? current;
    });
  }, [feedAssets]);

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
        else onClose?.();
      } else if (focusId && e.key === "ArrowLeft") {
        e.preventDefault();
        goFocus(-1);
      } else if (focusId && e.key === "ArrowRight") {
        e.preventDefault();
        goFocus(1);
      } else if (openDirectionId && e.key === "ArrowLeft") {
        e.preventDefault();
        stepBeatFocus(-1);
      } else if (openDirectionId && e.key === "ArrowRight") {
        e.preventDefault();
        stepBeatFocus(1);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [projectId, pickerOpen, shareOpen, composerOpen, selectMode, exitSelect, focusId, focusAsset, openDirectionId, goFocus, stepBeatFocus, onClose]);

  // Owner mode with no open project → render nothing. Viewer mode is driven by
  // the token instead, so it stays mounted.
  if (!readOnly && !projectId) return null;

  const isLoading = project === undefined;
  // Viewer mode: a null payload means the share link is revoked/unknown.
  const notFound = readOnly && project === null;
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
        if (readOnly || !dragHasFiles(event)) return;
        event.preventDefault();
        dragDepthRef.current += 1;
        setDragFilesOver(true);
      }}
      onDragOver={(event) => {
        if (readOnly || !dragHasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (readOnly || !dragHasFiles(event)) return;
        event.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setDragFilesOver(false);
      }}
      onDrop={(event) => {
        if (readOnly || !dragHasFiles(event)) return;
        event.preventDefault();
        dragDepthRef.current = 0;
        setDragFilesOver(false);
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length > 0) void handleFilesDrop(files);
      }}
    >
      {/* ── Header ── */}
      <header
        className="relative flex items-center gap-3 px-4 py-3 md:px-6"
        style={{ borderBottom: "1px solid var(--lm-border-strong)" }}
      >
        {/* Centered mode toggle (top of the page) */}
        {!inFocus && !composerOpen && (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 hidden -translate-y-1/2 justify-center lg:flex">
            <ModeToggle
              tabs={SECTION_TABS.map(({ key, label }) => ({
                key,
                label,
                count: modeCount(key),
              }))}
              active={effectiveTab}
              onPick={(key) => {
                setActiveTab(key);
                setOpenDirectionId(null);
                setBeatFocusId(null);
              }}
            />
          </div>
        )}
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="text-[10px] font-mono font-bold uppercase tracking-[0.16em]"
            style={{ color: "var(--lm-coral)" }}
          >
            {readOnly ? "● Laniameda" : "Review"}
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
              ? `${visibleAssets.length} shown`
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
          {!inFocus && !composerOpen && (
            <label
              className="hidden items-center gap-1.5 lg:flex"
              title="Tile size"
              style={{ color: "var(--lm-text-ghost)" }}
            >
              <LayoutGrid className="h-3 w-3" />
              <input
                type="range"
                min={TILE_SIZE_MIN}
                max={TILE_SIZE_MAX}
                step={20}
                value={tileSize}
                onChange={(e) => pickTileSize(Number(e.target.value))}
                className="w-24 cursor-pointer"
                style={{ accentColor: "var(--lm-coral)" }}
                aria-label="Tile size"
              />
            </label>
          )}
          {!readOnly && (
            <>
              {hasCollections &&
                !inFocus &&
                (Boolean(openDirection) ||
                  effectiveTab !== "beats" ||
                  unsortedAssets.length > 0) && (
                <button
                  type="button"
                  onClick={() =>
                    selectMode ? exitSelect() : setSelectMode(true)
                  }
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
            </>
          )}
          {onClose && (
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
          )}
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

      {/* Mode toggle for small screens (the header hosts it on md+) */}
      {!inFocus && !composerOpen && (
        <div className="flex items-center justify-center px-4 py-2.5 lg:hidden">
          <ModeToggle
            tabs={SECTION_TABS.map(({ key, label }) => ({
              key,
              label,
              count: modeCount(key),
            }))}
            active={effectiveTab}
            onPick={(key) => {
              setActiveTab(key);
              setOpenDirectionId(null);
              setBeatFocusId(null);
            }}
          />
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
              {!readOnly && (
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
              )}
            </>
          )}
          <span
            className="text-[11px]"
            style={{ color: "var(--lm-text-tertiary)" }}
          >
            {openDirection.count}{" "}
            {openDirection.count === 1 ? "option" : "options"}
          </span>
          <LikeControl
            count={openDirectionLikes?.count ?? 0}
            likes={openDirectionLikes}
            likedByMe={viewerLikedFolders.has(openDirection.folderId as string)}
            onToggle={
              readOnly
                ? () => toggleDirectionLike(openDirection.folderId as string)
                : undefined
            }
          />
          {!readOnly && (
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
          )}
        </div>
      )}

      {/* ── Body ── */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {notFound ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <p
              className="text-[15px] font-semibold"
              style={{ color: "var(--lm-text-primary)" }}
            >
              This link isn’t active
            </p>
            <p
              className="text-[13px]"
              style={{ color: "var(--lm-text-tertiary)" }}
            >
              The board may have been unshared. Ask the sender for a fresh link.
            </p>
          </div>
        ) : isLoading ? (
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
            assets={feedAssets}
            focusId={focusAsset.id}
            onFocusChange={setFocusId}
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
            onSetTag={(asset, tag, present) =>
              setAssetTag(asset.id, tag, present)
            }
            onPin={(asset) => toggleAssetPin(asset)}
            showCollectionLabel={false}
            readOnly={readOnly}
            downloadToken={viewerToken}
            viewerLikedAssets={viewerLikedAssets}
            onToggleLike={
              readOnly ? (asset) => toggleAssetLike(asset.id) : undefined
            }
          />
        ) : openDirection && selectMode ? (
          /* ── Drilled direction in select mode: flat grid to multi-pick ── */
          <div className="h-full overflow-y-auto px-4 pb-10 pt-1 md:px-6">
            <div
              style={{ columns: `${tileSize}px`, columnGap: "14px" }}
            >
              {visibleAssets.map((asset) => (
                <ReviewTile
                  key={asset.id}
                  asset={asset}
                  likes={likesByAsset.get(asset.id)}
                  onOpen={() => setFocusId(asset.id)}
                  showCollectionLabel={false}
                  selectable
                  selected={selectedIds.has(asset.id)}
                  onToggleSelect={() => toggleSelect(asset.id)}
                />
              ))}
            </div>
          </div>
        ) : openDirection ? (
          /* ── Direction detail: native-res preview left, elements right ── */
          <div className="flex h-full min-h-0 flex-col lg:flex-row">
            {/* Preview */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col px-4 pb-5 pt-2 md:px-8">
              {beatFocus ? (
                <>
                  <div
                    ref={previewPaneRef}
                    className="flex min-h-0 flex-1 items-center justify-center py-1"
                  >
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
                        className="max-h-full max-w-full"
                        style={{
                          // Both dims auto + max constraints = scale down to
                          // fit while keeping the INTRINSIC ratio (stored
                          // dims can lie — legacy 320px poster pass).
                          height: "auto",
                          width: "auto",
                        }}
                      />
                    ) : (
                      <img
                        key={beatFocus.id}
                        src={beatFocus.url ?? beatFocus.thumbUrl}
                        alt={beatFocus.promptText ?? openDirection.name}
                        className="max-h-full max-w-full object-contain"
                        style={{ height: "auto", width: "auto" }}
                      />
                    )}
                  </div>

                  {/* Focused element actions */}
                  <div className="mt-3 flex shrink-0 flex-wrap items-center gap-2">
                    {!readOnly && (
                      <>
                        <AssetNameEditor
                          name={beatFocus.name}
                          onSave={(next) => renameAsset(beatFocus.id, next)}
                        />
                        <TagEditor
                          tags={beatFocus.tagNames}
                          onAdd={(tag) => setAssetTag(beatFocus.id, tag, true)}
                          onRemove={(tag) =>
                            setAssetTag(beatFocus.id, tag, false)
                          }
                        />
                        <button
                          type="button"
                          onClick={() => toggleAssetPin(beatFocus)}
                          className="flex items-center rounded-lg border p-2"
                          style={{
                            backgroundColor: beatFocus.pinnedAt
                              ? "var(--lm-coral)"
                              : "transparent",
                            color: beatFocus.pinnedAt
                              ? "#000"
                              : "var(--lm-text-secondary)",
                            borderColor: beatFocus.pinnedAt
                              ? "var(--lm-coral)"
                              : "var(--lm-border-strong)",
                          }}
                          aria-pressed={Boolean(beatFocus.pinnedAt)}
                          title={beatFocus.pinnedAt ? "Unpin" : "Pin to the top"}
                        >
                          <Pin
                            className="h-3.5 w-3.5"
                            fill={beatFocus.pinnedAt ? "currentColor" : "none"}
                            strokeWidth={2.5}
                          />
                        </button>
                      </>
                    )}
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
                    <LikeControl
                      count={likesByAsset.get(beatFocus.id)?.count ?? 0}
                      likes={likesByAsset.get(beatFocus.id)}
                      likedByMe={viewerLikedAssets.has(beatFocus.id)}
                      onToggle={
                        readOnly ? () => toggleAssetLike(beatFocus.id) : undefined
                      }
                    />
                    <span className="ml-auto flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          triggerAssetDownload(beatFocus.id, viewerToken)
                        }
                        className="flex items-center rounded-lg border p-2"
                        style={{
                          borderColor: "var(--lm-border-strong)",
                          color: "var(--lm-text-secondary)",
                        }}
                        aria-label="Download"
                        title="Download"
                      >
                        <Download className="h-3.5 w-3.5" strokeWidth={2.5} />
                      </button>
                      {!readOnly && (
                        <>
                          <button
                            type="button"
                            onClick={() => moveAsset(beatFocus.id, "top")}
                            className="flex items-center rounded-lg border p-2"
                            style={{
                              borderColor: "var(--lm-border-strong)",
                              color: "var(--lm-text-secondary)",
                            }}
                            aria-label="Move to top"
                            title="Move to top"
                          >
                            <ChevronsUp
                              className="h-3.5 w-3.5"
                              strokeWidth={2.5}
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveAsset(beatFocus.id, "bottom")}
                            className="flex items-center rounded-lg border p-2"
                            style={{
                              borderColor: "var(--lm-border-strong)",
                              color: "var(--lm-text-secondary)",
                            }}
                            aria-label="Move to bottom"
                            title="Move to bottom"
                          >
                            <ChevronsDown
                              className="h-3.5 w-3.5"
                              strokeWidth={2.5}
                            />
                          </button>
                          {(beatFocus.kind === "video" || !drilledIsBeat) && (
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
                              className="flex items-center rounded-lg border p-2 transition-all active:scale-95"
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
                              aria-pressed={
                                openDirectionMasterId === beatFocus.id
                              }
                              title="Master — shown on the card's thumbnail"
                            >
                              <Crown
                                className="h-3.5 w-3.5"
                                strokeWidth={2.5}
                              />
                            </button>
                          )}
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
                        </>
                      )}
                    </span>
                  </div>
                </>
              ) : (
                <p
                  className="mt-10 text-center text-[13px]"
                  style={{ color: "var(--lm-text-tertiary)" }}
                >
                  {readOnly
                    ? "Nothing here yet."
                    : "Empty — drop files anywhere to add options."}
                </p>
              )}
              <div className="max-h-[22vh] shrink-0 overflow-y-auto">
                <DirectionTextBlock
                  description={openDirection.description}
                  onSave={saveDirectionText}
                  readOnly={readOnly}
                />
              </div>
            </div>

            {/* References */}
            <div
              className="w-full shrink-0 overflow-y-auto px-4 pb-10 pt-2 lg:w-[340px] lg:border-l xl:w-[400px]"
              style={{ borderColor: "var(--lm-border)" }}
            >
              <p
                className="mb-2.5 text-[10px] font-mono font-bold uppercase tracking-[0.18em]"
                style={{ color: "var(--lm-text-ghost)" }}
              >
                {drilledIsBeat ? "References" : "Options"}
                <span
                  className="ml-2"
                  style={{ color: "var(--lm-text-tertiary)" }}
                >
                  {beatElements.length}
                </span>
              </p>
              {beatElements.length === 0 ? (
                <p
                  className="text-[12px]"
                  style={{ color: "var(--lm-text-ghost)" }}
                >
                  {readOnly
                    ? "Nothing here yet."
                    : "Drop files anywhere — they land here."}
                </p>
              ) : (
                <div className="columns-2" style={{ columnGap: "10px" }}>
                  {beatElements.map((el) => {
                    const active = el.id === beatFocus?.id;
                    const role =
                      el.kind === "video"
                        ? null
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
                        className="relative mb-2.5 block w-full break-inside-avoid overflow-hidden rounded-md text-left transition-opacity hover:opacity-90"
                        style={{
                          aspectRatio:
                            el.width && el.height
                              ? `${el.width} / ${el.height}`
                              : "1 / 1",
                          outline: active
                            ? "2px solid var(--lm-coral)"
                            : "none",
                          outlineOffset: "-2px",
                          opacity: active ? 1 : 0.92,
                        }}
                        aria-pressed={active}
                        title={el.name ? `@${el.name}` : undefined}
                      >
                        <img
                          src={el.thumbUrl ?? el.url}
                          alt={el.name ?? ""}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                        {el.kind === "video" && (
                          <span
                            className="pointer-events-none absolute left-1/2 top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full"
                            style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
                          >
                            <Play
                              className="ml-0.5 h-3.5 w-3.5"
                              fill="#fff"
                              color="#fff"
                            />
                          </span>
                        )}
                        {role && (
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
            </div>
          </div>
        ) : effectiveTab === "beats" ? (
          /* ── Beats mode: stacked beat cards + New beat ── */
          <div className="h-full overflow-y-auto px-4 pb-10 pt-1 md:px-8">
            {!readOnly && (
              <div className="mx-auto mb-2 flex max-w-[1500px] justify-end">
                <button
                  type="button"
                  onClick={() =>
                    setComposer({
                      name: "",
                      files: [],
                      buckets: [],
                      linked: [],
                      prompt: "",
                    })
                  }
                  className="flex items-center gap-1 text-[10px] font-mono font-bold uppercase tracking-wider transition-colors hover:text-[var(--lm-coral)]"
                  style={{ color: "var(--lm-text-ghost)" }}
                  title="Create a beat — or just drop files anywhere"
                >
                  <Plus className="h-3 w-3" />
                  New beat
                </button>
              </div>
            )}
            <div
              className="mx-auto max-w-[1500px]"
              style={{ columns: `${tileSize}px`, columnGap: "16px" }}
            >
              {beatCards.map((direction) => (
                <DirectionCard
                  key={direction.id}
                  direction={direction}
                  onOpen={() => {
                    setOpenDirectionId(direction.id);
                    setBeatFocusId(null);
                  }}
                  onDelete={() => deleteDirectionById(direction.id)}
                  onPin={() => toggleDirectionPin(direction)}
                  readOnly={readOnly}
                  likedByMe={viewerLikedFolders.has(direction.id)}
                  onToggleLike={
                    readOnly
                      ? () => toggleDirectionLike(direction.id)
                      : undefined
                  }
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
                </p>
                <div
                  style={{ columns: `${tileSize}px`, columnGap: "14px" }}
                >
                  {visibleAssets.map((asset) => (
                    <ReviewTile
                      key={asset.id}
                      asset={asset}
                      likes={likesByAsset.get(asset.id)}
                      onOpen={() => setFocusId(asset.id)}
                      showCollectionLabel={false}
                      onMoveTop={() => moveAsset(asset.id, "top")}
                      onPin={() => toggleAssetPin(asset)}
                      onRename={(next) => renameAsset(asset.id, next)}
                      onMoveBottom={() => moveAsset(asset.id, "bottom")}
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
                      onFileStill={
                        asset.kind !== "video"
                          ? () => void fileUnsortedTo(asset, "stills")
                          : undefined
                      }
                      onMakeBeat={() => startBeatFromAssets([asset])}
                      selectable={selectMode}
                      selected={selectedIds.has(asset.id)}
                      onToggleSelect={() => toggleSelect(asset.id)}
                      readOnly={readOnly}
                      downloadToken={viewerToken}
                      likedByMe={viewerLikedAssets.has(asset.id)}
                      onToggleLike={
                        readOnly ? () => toggleAssetLike(asset.id) : undefined
                      }
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* ── Characters / Locations mode: stacks + assets, one masonry ── */
          <div className="h-full overflow-y-auto px-4 pb-10 pt-1 md:px-6">
            {!readOnly && (
              <div className="mx-auto mb-2 flex max-w-[1500px] justify-end">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1 text-[10px] font-mono font-bold uppercase tracking-wider transition-colors hover:text-[var(--lm-coral)]"
                  style={{ color: "var(--lm-text-ghost)" }}
                  title="Upload images — or drop them anywhere. Select several assets to group them into a stack."
                >
                  <Plus className="h-3 w-3" />
                  Add
                </button>
              </div>
            )}
            <div
              className="mx-auto max-w-[1500px]"
              style={{ columns: `${tileSize}px`, columnGap: "14px" }}
            >
              {modeItems.map((item) =>
                item.kind === "stack" ? (
                  <DirectionCard
                    key={`stack-${item.card.id}`}
                    direction={item.card}
                    onOpen={() => {
                      setOpenDirectionId(item.card.id);
                      setBeatFocusId(null);
                    }}
                    onDelete={() => deleteDirectionById(item.card.id)}
                    onPin={() => toggleDirectionPin(item.card)}
                    readOnly={readOnly}
                    likedByMe={viewerLikedFolders.has(item.card.id)}
                    onToggleLike={
                      readOnly
                        ? () => toggleDirectionLike(item.card.id)
                        : undefined
                    }
                  />
                ) : (
                  <ReviewTile
                    key={item.asset.id}
                    asset={item.asset}
                    likes={likesByAsset.get(item.asset.id)}
                    onOpen={() => setFocusId(item.asset.id)}
                    showCollectionLabel={false}
                    onDelete={() => void deleteAssetsByIds([item.asset.id])}
                    onMoveTop={() => moveAsset(item.asset.id, "top")}
                    onPin={() => toggleAssetPin(item.asset)}
                    onRename={(next) => renameAsset(item.asset.id, next)}
                    onMoveBottom={() => moveAsset(item.asset.id, "bottom")}
                    selectable={selectMode}
                    selected={selectedIds.has(item.asset.id)}
                    onToggleSelect={() => toggleSelect(item.asset.id)}
                    readOnly={readOnly}
                    downloadToken={viewerToken}
                    likedByMe={viewerLikedAssets.has(item.asset.id)}
                    onToggleLike={
                      readOnly
                        ? () => toggleAssetLike(item.asset.id)
                        : undefined
                    }
                  />
                ),
              )}
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
          projectName={projectName}
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
  onPin,
  active = false,
  readOnly,
  likedByMe,
  onToggleLike,
}: {
  direction: DirectionCardData;
  onOpen: () => void;
  /** Deletes the whole direction (assets stay in the gallery). */
  onDelete?: () => void;
  /** Pin/unpin — pinned cards float first in their mode. */
  onPin?: () => void;
  /** Highlight state — e.g. the stack currently expanded in place. */
  active?: boolean;
  /** Public viewer mode — hide pin/delete, keep the interactive ♥. */
  readOnly?: boolean;
  /** This viewer already liked the whole beat (interactive-like fill). */
  likedByMe?: boolean;
  /** Present → the beat ♥ toggles this viewer's whole-direction like. */
  onToggleLike?: () => void;
}) {
  if (readOnly) {
    onDelete = onPin = undefined;
  }
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
            border: active
              ? "2px solid var(--lm-coral)"
              : "2px solid var(--lm-border-strong)",
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

          {/* Pin + delete (top-left) */}
          <div className="absolute left-2 top-2 z-10 flex items-center gap-1">
            {onPin && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onPin();
                }}
                className={`flex items-center rounded-lg border p-1.5 transition-opacity ${
                  direction.pinned
                    ? "opacity-100"
                    : "opacity-0 group-hover:opacity-100"
                }`}
                style={{
                  backgroundColor: direction.pinned
                    ? "var(--lm-coral)"
                    : "rgba(0,0,0,0.62)",
                  color: direction.pinned ? "#000" : "#fff",
                  borderColor: direction.pinned
                    ? "var(--lm-coral)"
                    : "rgba(255,255,255,0.25)",
                }}
                aria-pressed={direction.pinned}
                title={direction.pinned ? "Unpin" : "Pin to the top"}
              >
                <Pin
                  className="h-3 w-3"
                  fill={direction.pinned ? "currentColor" : "none"}
                  strokeWidth={2.5}
                />
              </button>
            )}
            {onDelete && (
              <span className="opacity-0 transition-opacity group-hover:opacity-100">
                <ArmedDeleteButton
                  compact
                  title="Delete this beat — assets stay in the gallery"
                  onConfirm={onDelete}
                />
              </span>
            )}
          </div>

          {/* Likes + take counter */}
          <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
            <LikeControl
              count={direction.likes}
              likedByMe={likedByMe}
              onToggle={onToggleLike}
            />
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
          border: active
            ? "2px solid var(--lm-coral)"
            : "2px solid var(--lm-border-strong)",
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

          {/* Pin + delete (top-left) */}
          <div className="absolute left-2 top-2 z-10 flex items-center gap-1">
            {onPin && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onPin();
                }}
                className={`flex items-center rounded-lg border p-1.5 transition-opacity ${
                  direction.pinned
                    ? "opacity-100"
                    : "opacity-0 group-hover:opacity-100"
                }`}
                style={{
                  backgroundColor: direction.pinned
                    ? "var(--lm-coral)"
                    : "rgba(0,0,0,0.62)",
                  color: direction.pinned ? "#000" : "#fff",
                  borderColor: direction.pinned
                    ? "var(--lm-coral)"
                    : "rgba(255,255,255,0.25)",
                }}
                aria-pressed={direction.pinned}
                title={direction.pinned ? "Unpin" : "Pin to the top"}
              >
                <Pin
                  className="h-3 w-3"
                  fill={direction.pinned ? "currentColor" : "none"}
                  strokeWidth={2.5}
                />
              </button>
            )}
            {onDelete && (
              <span className="opacity-0 transition-opacity group-hover:opacity-100">
                <ArmedDeleteButton
                  compact
                  title="Delete this direction — assets stay in the gallery"
                  onConfirm={onDelete}
                />
              </span>
            )}
          </div>

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
  likes,
  onOpen,
  showCollectionLabel,
  isMaster,
  onMaster,
  onRemove,
  onDelete,
  onFileCharacter,
  onFileLocation,
  onFileStill,
  onMakeBeat,
  onMoveTop,
  onMoveBottom,
  onPin,
  onRename,
  selectable,
  selected,
  onToggleSelect,
  readOnly,
  downloadToken,
  likedByMe,
  onToggleLike,
}: {
  asset: ReviewAsset;
  /** Viewer likes from the shared board. */
  likes?: AssetLikes;
  onOpen: () => void;
  showCollectionLabel: boolean;
  /** Public viewer mode — hide every admin control, keep view/like/download. */
  readOnly?: boolean;
  /** Share token → download through the public board proxy instead of auth. */
  downloadToken?: string;
  /** This viewer already liked the asset (interactive-like fill). */
  likedByMe?: boolean;
  /** Present → the ♥ is an interactive like toggle (viewer mode). */
  onToggleLike?: () => void;
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
  onFileStill?: () => void;
  /** Start a new beat from this asset (videos in Unsorted). */
  onMakeBeat?: () => void;
  /** Manual ordering: float to the top / sink to the bottom. */
  onMoveTop?: () => void;
  onMoveBottom?: () => void;
  /** Pin/unpin — pinned assets float first with a pin marker. */
  onPin?: () => void;
  /** Rename the asset's @name handle inline on the tile. */
  onRename?: (name: string) => void;
  /** Multiselect: clicks toggle selection instead of opening the feed. */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  // Read-only viewer: strip every admin affordance. The remaining surface is
  // view + interactive ♥ + download.
  if (readOnly) {
    isMaster = false;
    onMaster =
      onRemove =
      onDelete =
      onFileCharacter =
      onFileLocation =
      onFileStill =
      onMakeBeat =
      onMoveTop =
      onMoveBottom =
      onPin =
        undefined;
    onRename = undefined;
    selectable = false;
  }
  return (
    <div
      className="group relative mb-3.5 block break-inside-avoid cursor-pointer overflow-hidden rounded-xl"
      style={{
        border: selected
          ? "2px solid #fff"
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

      {/* Pin + viewer likes, grouped top-right */}
      <div className="absolute right-2.5 top-2.5 z-10 flex items-center gap-1">
        {onPin && !selectable && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPin();
            }}
            className={`flex items-center rounded-lg border p-1.5 transition-opacity ${
              asset.pinnedAt ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
            style={{
              backgroundColor: asset.pinnedAt
                ? "var(--lm-coral)"
                : "rgba(0,0,0,0.62)",
              color: asset.pinnedAt ? "#000" : "#fff",
              borderColor: asset.pinnedAt
                ? "var(--lm-coral)"
                : "rgba(255,255,255,0.25)",
            }}
            aria-pressed={Boolean(asset.pinnedAt)}
            title={asset.pinnedAt ? "Unpin" : "Pin to the top"}
          >
            <Pin
              className="h-3 w-3"
              fill={asset.pinnedAt ? "currentColor" : "none"}
              strokeWidth={2.5}
            />
          </button>
        )}
        <LikeControl
          count={likes?.count ?? 0}
          likes={likes}
          likedByMe={likedByMe}
          onToggle={onToggleLike}
        />
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

      {/* Tags stay visible; the name editor only surfaces on hover (the
          @handle itself stays off the tiles) */}
      {!selectable && (onRename || asset.tagNames.length > 0) && (
        <div
          className={`absolute bottom-2.5 left-2.5 z-10 flex max-w-[85%] flex-col items-start gap-1 ${
            onFileCharacter || onFileLocation || onFileStill || onMakeBeat
              ? "transition-opacity group-hover:opacity-0"
              : ""
          }`}
        >
          {onRename &&
            !(onFileCharacter || onFileLocation || onFileStill || onMakeBeat) && (
            <span className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
              <AssetNameEditor overlay name={asset.name} onSave={onRename} />
            </span>
          )}
          {asset.tagNames.filter((t) => t !== "approved").length > 0 && (
            <span className="flex flex-wrap items-center gap-1">
              {asset.tagNames
                .filter((t) => t !== "approved")
                .slice(0, 3)
                .map((tag) => (
                  <span
                    key={tag}
                    className="rounded-md px-1.5 py-0.5 text-[8px] font-mono font-bold uppercase tracking-wider"
                    style={{
                      backgroundColor: "rgba(0,0,0,0.55)",
                      color: "rgba(255,255,255,0.75)",
                    }}
                  >
                    {tag}
                  </span>
                ))}
            </span>
          )}
        </div>
      )}

      {/* File an unsorted asset into a pool / start a beat from it (hover) */}
      {(onFileCharacter || onFileLocation || onFileStill || onMakeBeat) &&
        !selectable && (
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
          {onFileStill && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onFileStill();
              }}
              className="flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-mono font-bold uppercase tracking-wider"
              style={{
                backgroundColor: "rgba(0,0,0,0.62)",
                color: "#fff",
                borderColor: "rgba(255,255,255,0.25)",
              }}
              title="File into this project's Stills"
            >
              <ImageIcon className="h-3 w-3" strokeWidth={2.5} />
              Still
            </button>
          )}
        </div>
      )}

      {/* Download / Order / Remove / Delete, bottom-right on hover */}
      {!selectable && (
        <div className="absolute bottom-2.5 right-2.5 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              triggerAssetDownload(asset.id, downloadToken);
            }}
            className="flex items-center rounded-lg border p-1.5"
            style={{
              backgroundColor: "rgba(0,0,0,0.62)",
              color: "#fff",
              borderColor: "rgba(255,255,255,0.25)",
            }}
            aria-label="Download"
            title="Download"
          >
            <Download className="h-3 w-3" strokeWidth={2.5} />
          </button>
          {onMoveTop && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMoveTop();
              }}
              className="flex items-center rounded-lg border p-1.5"
              style={{
                backgroundColor: "rgba(0,0,0,0.62)",
                color: "#fff",
                borderColor: "rgba(255,255,255,0.25)",
              }}
              aria-label="Move to top"
              title="Move to top"
            >
              <ChevronsUp className="h-3 w-3" strokeWidth={2.5} />
            </button>
          )}
          {onMoveBottom && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMoveBottom();
              }}
              className="flex items-center rounded-lg border p-1.5"
              style={{
                backgroundColor: "rgba(0,0,0,0.62)",
                color: "#fff",
                borderColor: "rgba(255,255,255,0.25)",
              }}
              aria-label="Move to bottom"
              title="Move to bottom"
            >
              <ChevronsDown className="h-3 w-3" strokeWidth={2.5} />
            </button>
          )}
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
  overlay = false,
}: {
  name?: string;
  onSave: (name: string) => void;
  /** Dark-chip styling for use on top of tile media. */
  overlay?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  if (draft === null) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setDraft(name ?? "");
        }}
        className={`flex items-center gap-1 rounded-lg font-mono font-bold tracking-wider transition-opacity hover:opacity-80 ${
          overlay
            ? "px-2 py-0.5 text-[9px]"
            : "border px-2 py-1 text-[10px]"
        }`}
        style={
          overlay
            ? {
                backgroundColor: "rgba(0,0,0,0.62)",
                color: name ? "var(--lm-coral)" : "rgba(255,255,255,0.6)",
              }
            : {
                borderColor: "var(--lm-border)",
                color: name ? "var(--lm-coral)" : "var(--lm-text-ghost)",
              }
        }
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
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          setDraft(null);
        }
        e.stopPropagation();
      }}
      onBlur={commit}
      placeholder="e.g. cassandra"
      className="w-[140px] rounded-lg border px-2 py-1 text-[12px] outline-none"
      style={{
        backgroundColor: "var(--lm-surface-2)",
        borderColor: "var(--lm-coral)",
        color: "var(--lm-text-primary)",
      }}
      aria-label="Asset name"
    />
  );
}

/* ── Free-form tag editor: chips with hover ×, plus an add input ── */
function TagEditor({
  tags,
  onAdd,
  onRemove,
}: {
  tags: string[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const visible = tags.filter((tag) => tag !== "approved");

  return (
    <span className="flex flex-wrap items-center gap-1">
      {visible.map((tag) => (
        <span
          key={tag}
          className="group/tag flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-mono font-bold uppercase tracking-wider"
          style={{
            borderColor: "var(--lm-border)",
            color: "var(--lm-text-tertiary)",
          }}
        >
          {tag}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(tag);
            }}
            className="hidden group-hover/tag:inline-flex"
            style={{ color: "var(--lm-text-ghost)" }}
            aria-label={`Remove tag ${tag}`}
            title={`Remove tag ${tag}`}
          >
            <X className="h-2.5 w-2.5" strokeWidth={3} />
          </button>
        </span>
      ))}
      {draft === null ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setDraft("");
          }}
          className="flex items-center gap-0.5 text-[10px] font-mono font-bold uppercase tracking-wider transition-colors hover:text-[var(--lm-coral)]"
          style={{ color: "var(--lm-text-ghost)" }}
          title="Add a tag — shown on the project tiles"
        >
          <Plus className="h-3 w-3" />
          tag
        </button>
      ) : (
        <input
          autoFocus
          value={draft}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const next = draft.trim();
              if (next) onAdd(next);
              setDraft(null);
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDraft(null);
            }
            e.stopPropagation();
          }}
          onBlur={() => setDraft(null)}
          placeholder="tag…"
          className="w-[110px] rounded-lg border px-2 py-1 text-[12px] outline-none"
          style={{
            backgroundColor: "var(--lm-surface-2)",
            borderColor: "var(--lm-coral)",
            color: "var(--lm-text-primary)",
          }}
          aria-label="New tag"
        />
      )}
    </span>
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

/* ── Centered segmented mode toggle: Beats / Characters / Locations ── */
function ModeToggle({
  tabs,
  active,
  onPick,
}: {
  tabs: { key: ReviewTab; label: string; count: number }[];
  active: ReviewTab;
  onPick: (key: ReviewTab) => void;
}) {
  return (
    <div
      className="pointer-events-auto flex items-center gap-1 overflow-hidden border p-1"
      style={{
        borderRadius: 9999,
        borderColor: "var(--lm-border-strong)",
        backgroundColor: "var(--lm-surface-1)",
      }}
      role="tablist"
      aria-label="Project layers"
    >
      {tabs.map(({ key, label, count }) => {
        const isActive = active === key;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onPick(key)}
            className="px-4 py-1.5 text-[12px] font-semibold transition-colors"
            style={{
              borderRadius: 9999,
              backgroundColor: isActive ? "var(--lm-coral)" : "transparent",
              color: isActive ? "#000" : "var(--lm-text-secondary)",
            }}
          >
            {label}
            {count > 0 && <span style={{ opacity: 0.6 }}> {count}</span>}
          </button>
        );
      })}
    </div>
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
  readOnly,
}: {
  description?: string;
  onSave: (text: string) => void;
  /** Public viewer mode — show the text, hide the edit affordance. */
  readOnly?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  // Viewer: text only, nothing to edit. Nothing to render if there's no text.
  if (readOnly) {
    return description ? (
      <div className="mt-4 max-w-[900px]">
        <p
          className="whitespace-pre-wrap text-[13px] leading-relaxed"
          style={{ color: "var(--lm-text-secondary)" }}
        >
          {description}
        </p>
      </div>
    ) : null;
  }

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
  likesByAsset,
  masterId,
  onMaster,
  onRemove,
  onDelete,
  onRename,
  onSetTag,
  onPin,
  showCollectionLabel,
  readOnly,
  downloadToken,
  viewerLikedAssets,
  onToggleLike,
}: {
  assets: ReviewAsset[];
  focusId: string;
  onFocusChange: (id: string) => void;
  likesByAsset: Map<string, AssetLikes>;
  /** Current master id when drilled into a direction, else null. */
  masterId: string | null;
  onMaster?: (asset: ReviewAsset) => void;
  onRemove?: (asset: ReviewAsset) => void;
  /** Permanently delete from the gallery. */
  onDelete?: (asset: ReviewAsset) => void;
  /** Rename the asset (its @name handle). */
  onRename?: (asset: ReviewAsset, name: string) => void;
  /** Add/remove a free-form tag. */
  onSetTag?: (asset: ReviewAsset, tag: string, present: boolean) => void;
  /** Pin/unpin the asset. */
  onPin?: (asset: ReviewAsset) => void;
  showCollectionLabel: boolean;
  /** Public viewer mode — hide every admin control, keep view/like/download. */
  readOnly?: boolean;
  /** Share token → download through the public board proxy. */
  downloadToken?: string;
  /** Asset ids this viewer already liked (interactive-like fill). */
  viewerLikedAssets?: Set<string>;
  /** Present → the ♥ toggles this viewer's like on the focused asset. */
  onToggleLike?: (asset: ReviewAsset) => void;
}) {
  if (readOnly) {
    onMaster = onRemove = onDelete = onSetTag = onPin = undefined;
    onRename = undefined;
  }
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
              {onSetTag && (
                <TagEditor
                  tags={asset.tagNames}
                  onAdd={(tag) => onSetTag(asset, tag, true)}
                  onRemove={(tag) => onSetTag(asset, tag, false)}
                />
              )}
              {onPin && (
                <button
                  type="button"
                  onClick={() => onPin(asset)}
                  className="flex items-center rounded-lg border p-1.5"
                  style={{
                    backgroundColor: asset.pinnedAt
                      ? "var(--lm-coral)"
                      : "rgba(0,0,0,0.62)",
                    color: asset.pinnedAt ? "#000" : "#fff",
                    borderColor: asset.pinnedAt
                      ? "var(--lm-coral)"
                      : "rgba(255,255,255,0.25)",
                  }}
                  aria-pressed={Boolean(asset.pinnedAt)}
                  title={asset.pinnedAt ? "Unpin" : "Pin to the top"}
                >
                  <Pin
                    className="h-3 w-3"
                    fill={asset.pinnedAt ? "currentColor" : "none"}
                    strokeWidth={2.5}
                  />
                </button>
              )}
              {showCollectionLabel && (
                <span
                  className="rounded-md px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider"
                  style={{ backgroundColor: "rgba(0,0,0,0.55)", color: "#fff" }}
                >
                  {asset.collectionName}
                </span>
              )}
              <LikeControl
                count={likes?.count ?? 0}
                likes={likes}
                likedByMe={viewerLikedAssets?.has(asset.id)}
                onToggle={onToggleLike ? () => onToggleLike(asset) : undefined}
              />

              <span className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => triggerAssetDownload(asset.id, downloadToken)}
                  className="flex items-center rounded-lg border p-2"
                  style={{
                    backgroundColor: "rgba(0,0,0,0.62)",
                    color: "#fff",
                    borderColor: "rgba(255,255,255,0.25)",
                  }}
                  aria-label="Download"
                  title="Download"
                >
                  <Download className="h-3.5 w-3.5" strokeWidth={2.5} />
                </button>
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
// Turn a project name into a URL-safe slug for the share link prefix. Strips
// accents, lowercases, collapses non-alphanumerics to single hyphens, and
// caps length so the link stays tidy. May return "" for name-less projects.
function slugifyProjectName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

function SharePanel({
  token,
  projectName,
  onEnable,
  onDisable,
  onClose,
}: {
  token: string | undefined;
  projectName: string;
  onEnable: () => Promise<string>;
  onDisable: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  // Readable project-name prefix on the share link. The token stays the
  // security capability; the slug is cosmetic and stripped server-side.
  const buildBoardUrl = (shareToken: string) => {
    const slug = slugifyProjectName(projectName);
    const path = slug ? `${slug}-${shareToken}` : shareToken;
    return `${window.location.origin}/b/${path}`;
  };

  const boardUrl = token ? buildBoardUrl(token) : null;

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
        await copyLink(buildBoardUrl(newToken));
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

