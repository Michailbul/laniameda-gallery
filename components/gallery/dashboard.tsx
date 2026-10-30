"use client";

import "@/app/tokens.css";
import {
  type CollectionSectionKey,
  assetTypeTagForCollectionName,
  collectionSectionBadgeLabel,
  normalizeCollectionSection,
  sectionKeyForTagName,
} from "@/lib/collection-sections";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useAction,
  useConvex,
  useConvexAuth,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import { usePaginatedQuery as useStreamPaginatedQuery } from "convex-helpers/react";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { BookOpen, BookOpenText, Camera, Clapperboard, Download, Eye, EyeOff, FolderPlus, Heart, HeartOff, Layers, LayoutGrid, ListChecks, Loader2, Newspaper, Plus, Search as SearchIcon, Sparkles, Star, Trash2, Upload, X, Youtube } from "lucide-react";
import { deleteAssetSelection } from "@/lib/bulk-delete";
import { setAssetSelectionLiked } from "@/lib/bulk-like";
import { useUploadFile } from "@convex-dev/r2/react";
import {
  assetDownloadHref,
  downloadImagesAsZip,
} from "@/lib/download-image";
import { buildUploadFormData } from "@/lib/upload-form";
import { buildIngestKey } from "@/lib/ingest";
import {
  LARGE_IMAGE_BYTES,
  appendImageUploadFields,
  uploadImageToR2,
} from "@/lib/image-ingest";
import {
  type RawFile,
  isZipFile,
  readDroppedFiles,
  resolveMedia,
} from "@/lib/bulk-upload";
import { quickIngestFile } from "@/lib/quick-ingest";
import { SELECTED_WORK_PATH } from "@/lib/routes";
import { CoralToastProvider, useCoralToast } from "@/components/ui/coral-toast";
import BottomMenu from "@/components/ui/bottom-menu";
import { GallerySidebar } from "./sidebar";
import { SimilarGroups } from "./similar-groups";
import { DEFAULT_SIMILARITY, clusterByHash, similarityToDistance } from "@/lib/perceptual-hash";
import {
  GalleryFilterBar,
  type GalleryScope,
  type SortOrder,
  type ViewMode,
} from "./filter-bar";
import { MasonryGrid } from "@/components/masonry-grid";
import { SkillsView } from "./skills-view";
import { StoriesView } from "./stories-view";
import { useSavedViews } from "./filter-presets";
import { PublishAllDialog, type PrivateCountArgs, type PublishAllOutcome } from "./publish-all-dialog";
import { StorybookShelf, type ShelfBook } from "./storybook-shelf";
import { skillCardToEntry } from "@/lib/skill-entries";
import { CollectionsGrid } from "./collections-grid";
import {
  BrowseBreadcrumb,
  type BreadcrumbSegment,
} from "./browse-breadcrumb";
import { CollectionViewActions } from "./collection-view-actions";
import { StyleScopeSwitcher } from "./style-scope-switcher";
import { EmptyFolderPrompt } from "./empty-folder-prompt";
import { CollectionTabs } from "./collection-tabs";
import {
  buildStyleShelfStacks,
  filterAssetsToStyle,
  resolveFoldersViewWorld,
  resolveWorldStyleScope,
} from "@/lib/style-scope";
import { FeaturedPanel } from "./featured-panel";
import {
  GalleryDetailPanel,
  type AssetFilingTarget,
  type AssetMembership,
} from "./detail-panel";
import { SkillModal } from "./skill-modal";
import { StorybookModal } from "./storybook-modal";
import { UploadModal } from "@/components/upload-modal";
import { CinemaModal, type CinemaModalAsset } from "./cinema-modal";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { MobileBrowseSheet, type BrowseSheetSection } from "./mobile-browse-sheet";
import { CopyLinkButton } from "@/components/youtube/copy-link-button";
import {
  collectionRoute,
  galleryRoutePath,
  galleryRouteTitle,
  parseGalleryRoute,
  resolveWorldSegment,
  worldSegment,
  type GalleryLocation,
  type GalleryRoute,
} from "@/lib/gallery-routes";
import { useSwipeGesture } from "@/lib/use-swipe-gesture";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import {
  buildGalleryEntries,
  type GalleryEntry,
  type GalleryEntryPreview,
} from "@/lib/gallery-entries";
import { reachedGalleryInserts } from "@/lib/gallery-stream";
import { useGalleryStream } from "./use-gallery-stream";
import { canActorAccessByUserId, parseUserIdList } from "@/lib/identity";
import { writeAssetDragPayload } from "@/lib/asset-drag";
import {
  AddToPanel,
  type PanelCollection,
} from "./add-to-panel";
import {
  resolveAccessibleGalleryScope,
  resolveScopeFolderFilter,
} from "@/lib/gallery-filters";
import type { BookmarkPost } from "@/lib/bookmarks";
import { BookmarksView } from "@/components/gallery/bookmarks-view";
import { MidjourneySrefsView } from "@/components/gallery/midjourney-srefs-view";
import {
  MoodboardsView,
  type MoodboardAssetSummary,
  type MoodboardPickTarget,
} from "@/components/gallery/moodboards-view";
import { MoodboardPicker } from "@/components/gallery/moodboard-picker";
import { MoodboardsTab } from "@/components/gallery/moodboards-tab";
import { WorldInstructionsPanel } from "@/components/gallery/world-instructions";
import type { WorldRef } from "@/lib/world-doc-markdown";
import { WorldJournalTab } from "@/components/gallery/world-journal-tab";
import { WorldTasksTab } from "./world-tasks-tab";
import { MoodboardPickBar } from "@/components/gallery/moodboard-pick-bar";
import { CollectionStackGroups } from "@/components/gallery/collection-stack-groups";
import { groupChildCollections, orderChildCollections } from "@/lib/collection-groups";
import { isSrefCollection } from "@/lib/midjourney-srefs";
import {
  WORLD_GROUP,
  isWorldCollection,
  orderRootCollections,
} from "@/lib/collection-worlds";
import { MotionView } from "@/components/gallery/motion-view";
import { CINEMATOGRAPHY_TAG } from "@/lib/cinematography";

type SelectedImage = {
  id: string;
  packId?: string;
  galleryItemId?: string;
  galleryItemType?: "asset" | "pack" | "design" | "skill" | "storybook" | "collection";
  promptId?: string;
  stepCount?: number;
  thumbSrc: string;
  fullSrc: string;
  prompt: string;
  width?: number;
  height?: number;
  kind?: "image" | "video";
  contentType?: string;
  modelName?: string;
  pillar?: string;
  generationType?: string;
  assetRole?: string;
  ingestSource?: string;
  tagNames?: string[];
  sourceUrl?: string;
  description?: string;
  fileName?: string;
  createdAt?: number;
  folderId?: string;
  folderIds?: string[];
  isPublic?: boolean;
  isFeatured?: boolean;
  isLiked?: boolean;
  starredAt?: number;
  starNote?: string;
  isDesignInspiration?: boolean;
  designTitle?: string;
  designDescription?: string;
  designInspirationId?: string;
  sourceDomain?: string;
  captureKind?: string;
  saveIntent?: string;
  inspirationType?: string;
  userNote?: string;
  /** A saved social post (X) — the detail panel leads with the post. */
  bookmark?: BookmarkPost;
  previewImages?: GalleryEntryPreview[];
  /** The pack member a card was showing when clicked — the expanded view
   *  opens on it. */
  activePreviewId?: string;
};

type SemanticGalleryAsset = FunctionReturnType<
  typeof api.semanticSearch.searchAssets
>[number];

type SemanticMode =
  | { kind: "query"; query: string }
  | { kind: "similar"; assetId: string; prompt: string }
  | null;

// What a piece IS. These three tags are the ground truth for the type badge
// and for the Characters / Locations menu pills — see lib/collection-sections.
// The bulk toolbar stamps them across a selection; the detail panel still
// toggles one asset at a time.
const STATICS_TAGS = [
  { tag: "character", label: "Character" },
  { tag: "location", label: "Location" },
  { tag: "scene", label: "Scene" },
] as const;

type StaticsTagName = (typeof STATICS_TAGS)[number]["tag"];

// Same parallelism the bulk uploader runs: enough to keep the R2 pipe busy
// without stampeding the ingest action.
const QUICK_DROP_CONCURRENCY = 3;

// Text-only breadcrumb-row actions share one look.
const quietActionStyle: React.CSSProperties = {
  fontFamily: "var(--lm-font)",
  fontSize: "10px",
  fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--lm-text-ghost)",
  cursor: "pointer",
};

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

interface GalleryDashboardProps {
  user?: {
    id?: string | null;
    email?: string | null;
    firstName?: string | null;
    username?: string | null;
    photoUrl?: string | null;
  } | null;
  onSignOut?: () => void;
  adminMode?: boolean;
}

const canonicalTagKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/^#+/, "")
    .replace(/[_-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const buildAssetSearchHaystack = (
  asset: {
    name?: string;
    description?: string;
    agentDescription?: string;
    promptText?: string;
    fileName?: string;
    sourceUrl?: string;
    tagNames?: string[];
    modelName?: string;
    pillar?: string;
    folderId?: string;
    folderIds?: string[];
    bookmark?: BookmarkPost | null;
  },
  folderNameById?: Map<string, string>,
) => {
  const folderNames = folderNameById
    ? Array.from(
        new Set(
          [asset.folderId, ...(asset.folderIds ?? [])]
            .filter((folderId): folderId is string => Boolean(folderId))
            .map((folderId) => folderNameById.get(folderId))
            .filter((name): name is string => Boolean(name)),
        ),
      )
    : [];

  return [
    asset.name,
    asset.description,
    asset.agentDescription,
    asset.promptText,
    asset.fileName,
    asset.sourceUrl,
    asset.modelName,
    asset.pillar,
    // A saved post is found by its words, its author and the owner's note.
    asset.bookmark?.text,
    asset.bookmark?.authorName,
    asset.bookmark?.authorHandle ? `@${asset.bookmark.authorHandle}` : undefined,
    asset.bookmark?.quotedPost?.text,
    asset.bookmark?.userNote,
    ...(asset.tagNames ?? []),
    ...folderNames,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
};

// Fires a coral toast whenever a grid delete fails. Lives inside the
// CoralToastProvider (the dashboard's own scope is above it), renders nothing.
function DeleteErrorToast({ error }: { error?: string }) {
  const { toast } = useCoralToast();
  const lastErrorRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (error && error !== lastErrorRef.current) {
      toast("Delete failed", error, "warning", 7000);
    }
    lastErrorRef.current = error;
  }, [error, toast]);
  return null;
}

export type DashboardNotice = {
  title: string;
  message?: string;
  type: "success" | "warning";
  // Monotonic key so identical back-to-back notices still fire.
  at: number;
};

// Same bridge pattern as DeleteErrorToast for arbitrary one-shot notices
// (e.g. collection publish results).
function NoticeToast({ notice }: { notice?: DashboardNotice }) {
  const { toast } = useCoralToast();
  const lastAtRef = useRef<number>(0);
  useEffect(() => {
    if (notice && notice.at !== lastAtRef.current) {
      toast(notice.title, notice.message, notice.type, 6000);
      lastAtRef.current = notice.at;
    }
  }, [notice, toast]);
  return null;
}

export function GalleryDashboard({
  user,
  onSignOut,
  adminMode = false,
}: GalleryDashboardProps) {
  const convex = useConvex();
  const devOwnerUserIdOverride =
    process.env.NODE_ENV !== "production"
      ? process.env.NEXT_PUBLIC_DEV_OWNER_USER_ID?.trim() || null
      : null;
  const ownerUserId = (
    devOwnerUserIdOverride ||
    user?.id ||
    ""
  ).trim();
  const canAccessMyGallery = Boolean(ownerUserId);

  const [galleryScope, setGalleryScope] = useState<GalleryScope>(
    canAccessMyGallery ? "mine" : "public",
  );

  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  // Menu-filter ids the user pushed to the NEGATIVE side (minus on the pill).
  const [excludedFilters, setExcludedFilters] = useState<string[]>([]);
  const [likedOnly, setLikedOnly] = useState<boolean>(false);
  const [bookmarksOnly, setBookmarksOnly] = useState(false);
  const [mediaKind, setMediaKind] = useState<"image" | "video" | null>(null);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(
    null,
  );
  const [openStorybookId, setOpenStorybookId] = useState<string | null>(null);
  // Top-level "Storybooks" tab: shows every storybook as a masonry of stack
  // cards, separate from the asset grid.
  const [storybooksView, setStorybooksView] = useState(false);
  const [storiesView, setStoriesView] = useState(false);
  // A story: reference clicked in a world doc opens straight on that story.
  const [storyToOpen, setStoryToOpen] = useState<FunctionReturnType<typeof api.stories.getStory> | null>(null);
  // The story open in the Stories view, so /stories/<id> can name it.
  const [storiesOpenId, setStoriesOpenId] = useState<string | null>(null);
  const [includeSkills, setIncludeSkills] = useState(true);
  // The Bookmarks tab: saved X posts as post cards, by collection.
  const [bookmarksView, setBookmarksView] = useState(false);
  // The Motion tab: assets tagged motion-design, filtered by their own facets.
  const [motionView, setMotionView] = useState(false);
  // The Cinematography tab: camera-move packs, shown as skill cards under
  // their own name and kept out of the Skills tab.
  const [cinematographyView, setCinematographyView] = useState(false);
  // The Moodboards tab: every board, grouped by world, and the one open in it.
  const [moodboardsTab, setMoodboardsTab] = useState(false);
  const [moodboardsTabBoardId, setMoodboardsTabBoardId] = useState<string | null>(null);
  const activeStoriesView = storiesView && canAccessMyGallery && galleryScope === "mine";
  const activeMoodboardsTab = moodboardsTab && canAccessMyGallery && galleryScope === "mine";
  const extraTabView = motionView || cinematographyView || activeStoriesView || activeMoodboardsTab;
  const [selectedFolderId, setSelectedFolderId] = useState<
    string | null
  >(null);
  // The root collection whose child stacks have been flattened into assets.
  // Keying the preference by id means navigating elsewhere resets naturally,
  // while returning to the same collection keeps the user's chosen view.
  const [expandedCollectionId, setExpandedCollectionId] = useState<
    string | null
  >(null);
  // The plain collection whose Moodboards panel holds the main area. Keyed
  // by id like the expansion above: leaving the collection returns to its grid.
  const [moodboardsCollectionId, setMoodboardsCollectionId] = useState<
    string | null
  >(null);
  // A marked world's Docs or Journal tab, keyed by the world root the same way.
  const [worldPanel, setWorldPanel] = useState<{
    collectionId: string;
    tab: "docs" | "journal" | "tasks";
  } | null>(null);
  // The style last chosen inside a world (its Styles group): its shelves then
  // show that style only. Opening a style branch sets it, the world root
  // clears it (lib/style-scope).
  const [rememberedStyle, setRememberedStyle] = useState<{
    worldId: string;
    styleId: string;
  } | null>(null);
  // "Add to moodboard…" from a card menu or the selection bar.
  const [moodboardPicker, setMoodboardPicker] = useState<{
    assetIds: string[];
    anchor: DOMRect | null;
  } | null>(null);
  // "Choose from gallery": the normal grid picks images for this board, then
  // returns to it, in the Moodboards tab (returnTo null) or in the
  // collection's Moodboards panel (returnTo its id).
  const [moodboardPick, setMoodboardPick] = useState<{
    board: MoodboardPickTarget;
    returnTo: string | null;
  } | null>(null);
  // The board a collection's Moodboards panel opens on, after picking.
  const [collectionBoardToOpen, setCollectionBoardToOpen] = useState<string | null>(null);
  const [moodboardNotice, setMoodboardNotice] = useState<DashboardNotice | undefined>(undefined);
  const [selectedModelName, setSelectedModelName] = useState<
    string | null
  >(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  // Each SHUFFLE click (including re-clicks while active) deals a new seed;
  // between deals the arrangement is stable across re-renders.
  const [shuffleSeed, setShuffleSeed] = useState(1);
  const changeSortOrder = useCallback((order: SortOrder) => {
    if (order === "shuffle") {
      setShuffleSeed((seed) => (seed + 1) % 0xffffffff);
    }
    setSortOrder(order);
  }, []);

  const [viewMode, setViewModeRaw] = useState<ViewMode>("grid");
  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeRaw(mode);
    // Leaving the skills view closes whatever skill was open with it.
    if (mode !== "skills") setSelectedSkillId(null);
  }, []);
  // Grid tile size (0.4–1, 1 = full size), persisted across sessions.
  const [gridZoom, setGridZoomRaw] = useState(1);
  useEffect(() => {
    const stored = Number(localStorage.getItem("laniameda-grid-zoom"));
    if (Number.isFinite(stored) && stored >= 0.4 && stored <= 1) {
      setGridZoomRaw(stored);
    }
  }, []);
  const setGridZoom = useCallback((zoom: number) => {
    const clamped = Math.min(1, Math.max(0.4, zoom));
    setGridZoomRaw(clamped);
    localStorage.setItem("laniameda-grid-zoom", String(clamped));
  }, []);
  // Flatten mode: stacks (prompt packs and a collection's folders) spread out
  // into one tile per asset. Persisted across sessions like the zoom.
  const [flattenStacks, setFlattenStacksRaw] = useState(false);
  useEffect(() => {
    setFlattenStacksRaw(
      localStorage.getItem("laniameda-flatten-stacks") === "true",
    );
  }, []);
  const setFlattenStacks = useCallback((next: boolean) => {
    setFlattenStacksRaw(next);
    localStorage.setItem("laniameda-flatten-stacks", String(next));
  }, []);
  const [sidebarCollapsed, setSidebarCollapsed] =
    useState<boolean>(false);
  // The phone's browse sheet, opened from the Search tab of the bottom bar.
  const [browseSheetOpen, setBrowseSheetOpen] = useState(false);

  useEffect(() => {
    setSidebarCollapsed(
      localStorage.getItem("laniameda-sidebar-collapsed") === "true",
    );
  }, []);

  const [selectedImage, setSelectedImage] =
    useState<SelectedImage | null>(null);
  // Which frame of an open pack is on show. Held here, not in the panel: the
  // desktop view and the mobile sheet are both mounted, the keyboard steps
  // through frames, and the live per-file read follows the same frame. Tied
  // to the entry it was set for, so opening another entry starts at 0.
  const [slideState, setSlideState] = useState<{
    entryId: string | null;
    index: number;
  }>({ entryId: null, index: 0 });
  const [sheetDismissing, setSheetDismissing] = useState(false);
  const [sheetDragY, setSheetDragY] = useState(0);
  const mobileDetailRef = useRef<HTMLDivElement>(null);
  const [isUploadOpen, setUploadOpen] = useState(false);
  const [uploadInitialFiles, setUploadInitialFiles] = useState<
    File[] | undefined
  >(undefined);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const dragDepthRef = useRef(0);
  // Which type bucket the cursor is over while dragging (see quickDropTarget).
  const [hoveredDropTag, setHoveredDropTag] = useState<StaticsTagName | null>(
    null,
  );
  const [selectedCinemaAsset, setSelectedCinemaAsset] =
    useState<CinemaModalAsset | null>(null);

  const openAddModal = useCallback(() => {
    setUploadInitialFiles(undefined);
    setUploadOpen(true);
  }, []);

  const closeUploadModal = useCallback(() => {
    setUploadOpen(false);
    setUploadInitialFiles(undefined);
  }, []);

  const openUploadWithFiles = useCallback((files: File[]) => {
    if (files.length === 0) return;
    setUploadInitialFiles(files);
    setUploadOpen(true);
  }, []);

  // ── Gallery drag-and-drop → opens the upload modal pre-loaded with the file ──
  const dragHasFiles = (event: React.DragEvent) =>
    Array.from(event.dataTransfer?.types ?? []).includes("Files");

  // Don't hijack drags while a modal already owns its own dropzone — the
  // upload modals have one. Without this the shell overlay and the modal
  // fight over the drag and the drop goes nowhere.
  const canAcceptShellDrop =
    canAccessMyGallery &&
    !isUploadOpen &&
    !openStorybookId;

  const handleShellDragEnter = useCallback(
    (event: React.DragEvent) => {
      if (!canAcceptShellDrop || !dragHasFiles(event)) return;
      event.preventDefault();
      dragDepthRef.current += 1;
      // A fresh drag starts with no bucket lit — otherwise the last drag's
      // hover would still be highlighted when the overlay comes back.
      if (dragDepthRef.current === 1) setHoveredDropTag(null);
      setIsDraggingFiles(true);
    },
    [canAcceptShellDrop],
  );

  const handleShellDragOver = useCallback(
    (event: React.DragEvent) => {
      if (!canAcceptShellDrop || !dragHasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    [canAcceptShellDrop],
  );

  const handleShellDragLeave = useCallback(
    (event: React.DragEvent) => {
      if (!canAcceptShellDrop || !dragHasFiles(event)) return;
      event.preventDefault();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setIsDraggingFiles(false);
    },
    [canAcceptShellDrop],
  );

  const handleShellDrop = useCallback(
    (event: React.DragEvent) => {
      if (!canAcceptShellDrop || !dragHasFiles(event)) return;
      event.preventDefault();
      dragDepthRef.current = 0;
      setIsDraggingFiles(false);
      // Folders and archives only surface through the entries API —
      // dataTransfer.files reports a dropped directory as one typeless entry,
      // so reading it directly threw the whole folder away.
      const dataTransfer = event.dataTransfer;
      if (!dataTransfer) return;
      void readDroppedFiles(dataTransfer).then((raw) => {
        const files = raw
          .map((entry) => entry.file)
          .filter(
            (file) => isZipFile(file) || resolveMedia(file.name, file.type) !== null,
          );
        if (files.length > 0) openUploadWithFiles(files);
      });
    },
    [canAcceptShellDrop, openUploadWithFiles],
  );
  const [deletingAssetId, setDeletingAssetId] = useState<
    string | null
  >(null);
  const [deleteAssetError, setDeleteAssetError] =
    useState<string>();
  const [folderLoadingAssetId, setFolderLoadingAssetId] = useState<
    string | null
  >(null);
  const [folderError, setFolderError] = useState<string>();
  const [curationLoadingAssetId, setCurationLoadingAssetId] =
    useState<string | null>(null);
  const [curationError, setCurationError] = useState<string>();
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [bulkCurationLoading, setBulkCurationLoading] = useState(false);
  const [bulkCurationError, setBulkCurationError] = useState<string>();
  const [bulkCurationStatus, setBulkCurationStatus] = useState<string>();
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const bulkDeletingRef = useRef(false);
  const bulkLikingRef = useRef(false);
  const [bulkLikeState, setBulkLikeState] = useState<boolean | null>(null);
  const [bulkDeleteProgress, setBulkDeleteProgress] = useState<{ completed: number; total: number } | null>(null);
  const [bulkDeleteNotice, setBulkDeleteNotice] = useState<DashboardNotice>();
  // "Move to" sorting panel — declared up here because card drag opens it.
  const [addToPanelOpen, setAddToPanelOpen] = useState(false);
  // The featured shelf — owner-only control over the public home reel.
  const [featuredPanelOpen, setFeaturedPanelOpen] = useState(false);
  const [bulkAddBusy, setBulkAddBusy] = useState(false);
  // Feedback chip for collection membership changes and drag & drop.
  const [moveStatus, setMoveStatus] = useState<{
    text: string;
    error?: boolean;
  } | null>(null);
  const [replacingThumbAssetId, setReplacingThumbAssetId] =
    useState<string | null>(null);
  const [exitingAssetIds, setExitingAssetIds] = useState<
    Set<string>
  >(() => new Set());
  const [hiddenAssetIds, setHiddenAssetIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [assetSearchQuery, setAssetSearchQuery] = useState("");
  const [debouncedAssetSearchQuery, setDebouncedAssetSearchQuery] =
    useState("");
  const [semanticMode, setSemanticMode] = useState<SemanticMode>(null);
  const [semanticResults, setSemanticResults] = useState<
    SemanticGalleryAsset[] | null
  >(null);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [semanticError, setSemanticError] = useState<string>();
  const semanticRequestIdRef = useRef(0);

  const curatorUserIds = useMemo(() => {
    return parseUserIdList(
      process.env.NEXT_PUBLIC_CURATION_ADMIN_USER_IDS,
    );
  }, []);
  const canCuratePublic = useMemo(() => {
    return canActorAccessByUserId(ownerUserId, curatorUserIds);
  }, [ownerUserId, curatorUserIds]);

  // Delete is admin-only. Same allowlist as public curation
  // (NEXT_PUBLIC_CURATION_ADMIN_USER_IDS). Regular logged-in users see no
  // delete affordance and the server-side mutation rejects them.
  const canDeleteAssets = canCuratePublic;
  const canDeleteInCurrentView =
    canDeleteAssets && galleryScope === "mine";
  const canManageFoldersInCurrentView =
    canAccessMyGallery && galleryScope === "mine";
  // Decisions waiting in each world's Inbox: badges on the world rows and
  // the Decisions link.
  const { isAuthenticated: convexSignedIn } = useConvexAuth();
  const inboxWorlds = useQuery(
    api.inbox.listInboxWorlds,
    canAccessMyGallery && convexSignedIn ? { ownerUserId } : "skip",
  );
  const inboxCountByWorld = useMemo(
    () => new Map((inboxWorlds ?? []).map((row) => [row.worldFolderId as string, row.openCards])),
    [inboxWorlds],
  );
  const inboxOpenCount = (inboxWorlds ?? []).reduce((sum, row) => sum + row.openCards, 0);
  // Tasks waiting in the queue (open, claimed or blocked): the badge on the
  // Tasks link. Blocked ones need Michael; the /tasks page shows them first.
  const taskCounts = useQuery(
    api.tasks.countOpenTasks,
    canAccessMyGallery && convexSignedIn ? { ownerUserId } : "skip",
  );
  const tasksOpenCount = (taskCounts ?? []).reduce((sum, row) => sum + row.open + row.claimed + row.blocked, 0);

  const setAssetFoldersMutation = useMutation(
    api.assets.setAssetFolders,
  );
  const addAssetFoldersMutation = useMutation(
    api.assets.addAssetFolders,
  );
  const removeAssetFolderMutation = useMutation(
    api.assets.removeAssetFolder,
  );
  const setAssetLikedMutation = useMutation(api.assets.setAssetLiked);
  const setAssetStarredMutation = useMutation(api.assets.setAssetStarred);
  const setAssetStarNoteMutation = useMutation(api.assets.setAssetStarNote);
  const setAssetTagStateMutation = useMutation(api.assets.setAssetTagState);
  const bulkAssignAssetTypeMutation = useMutation(
    api.assets.bulkAssignAssetType,
  );
  const createFolderMutation = useMutation(
    api.folders.createFolder,
  );
  const setFolderCoverMutation = useMutation(api.folders.setFolderCover);
  const setAssetDescriptionMutation = useMutation(
    api.assets.setAssetDescription,
  );
  const setAssetTagsMutation = useMutation(api.assets.setAssetTags);
  const updateFolderMutation = useMutation(api.folders.updateFolder);
  const deleteFolderMutation = useMutation(api.folders.deleteFolder);
  const setFolderShowcasedMutation = useMutation(
    api.folders.setFolderShowcased,
  );
  const setFolderFeaturedMutation = useMutation(api.folders.setFolderFeatured);
  const setFolderHiddenMutation = useMutation(
    api.folders.setFolderHiddenFromGallery,
  );
  const setTasteCollectionMutation = useMutation(
    api.folders.setTasteCollection,
  );
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const processAndReplaceThumbnail = useAction(
    api.thumbnails.processAndReplaceThumbnail,
  );
  const semanticSearchAction = useAction(api.semanticSearch.searchAssets);
  const findSimilarAssetsAction = useAction(
    api.semanticSearch.findSimilarAssets,
  );

  useEffect(() => {
    const nextScope = resolveAccessibleGalleryScope({
      canAccessMyGallery,
      galleryScope,
    });
    if (nextScope !== galleryScope) {
      setGalleryScope(nextScope);
    }
  }, [canAccessMyGallery, galleryScope]);

  useEffect(() => {
    setExitingAssetIds(new Set());
    setHiddenAssetIds(new Set());
    setDeleteAssetError(undefined);
    setFolderError(undefined);
    setFolderLoadingAssetId(null);
    setCurationError(undefined);
    setDeletingAssetId(null);
    setSelectedImage(null);
    setSheetDismissing(false);
    setSheetDragY(0);
    setSemanticMode(null);
    setSemanticResults(null);
    setSemanticError(undefined);
    setSemanticLoading(false);
    setSelectedAssetIds(new Set());
    setBulkCurationError(undefined);
    setBulkCurationStatus(undefined);
    setLikedOnly(false);
  }, [galleryScope]);

  useEffect(() => {
    setFolderError(undefined);
    setFolderLoadingAssetId(null);
  }, [selectedImage?.id]);

  useEffect(() => {
    // 600ms: every settled query costs a live Gemini embed call (unless
    // cached), and the embed RPM quota is small — don't fire mid-typing.
    const handle = window.setTimeout(() => {
      setDebouncedAssetSearchQuery(assetSearchQuery.trim());
    }, 600);

    return () => window.clearTimeout(handle);
  }, [assetSearchQuery]);

  const updateAssetCuration = useCallback(
    async ({
      assetId,
      isPublic,
      isFeatured,
    }: {
      assetId: string;
      isPublic: boolean;
      isFeatured?: boolean;
    }) => {
      if (!canCuratePublic || curationLoadingAssetId) return;

      setCurationError(undefined);
      setCurationLoadingAssetId(assetId);
      try {
        const response = await fetch(
          `/api/admin/assets/${assetId}/curation`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ isPublic, isFeatured }),
          },
        );
        const payload = (await response
          .json()
          .catch(() => null)) as {
          error?: string;
          result?: { isPublic: boolean; isFeatured: boolean };
        } | null;
        if (!response.ok) {
          throw new Error(
            payload?.error ||
              "Failed to update curation state.",
          );
        }
        if (payload?.result) {
          setSelectedImage((current) =>
            current && current.id === assetId
              ? {
                  ...current,
                  isPublic: payload.result!.isPublic,
                  isFeatured: payload.result!.isFeatured,
                }
              : current,
          );
        }
      } catch (error) {
        setCurationError(
          error instanceof Error
            ? error.message
            : "Failed to update curation state.",
        );
      } finally {
        setCurationLoadingAssetId((current) =>
          current === assetId ? null : current,
        );
      }
    },
    [canCuratePublic, curationLoadingAssetId],
  );

  // The last card whose selection was touched — the far end of a shift-click
  // range. A ref, not state: it changes on every click but nothing renders
  // from it, and re-rendering the whole grid to remember it would be waste.
  // Grid order for range selection, kept in a ref so the handler below can be
  // declared before the memo that computes it.
  const selectableAssetIdsRef = useRef<string[]>([]);
  const selectionAnchorRef = useRef<string | null>(null);

  const toggleAssetSelection = useCallback(
    (assetId: string, mode: "toggle" | "range" = "toggle") => {
      if (bulkDeletingRef.current || bulkLikingRef.current) return;
      setBulkCurationError(undefined);
      setBulkCurationStatus(undefined);

      // Shift-click: take everything between the anchor and this card, in grid
      // order. Additive, and the anchor stays put so you can widen or narrow
      // the same range by shift-clicking again.
      if (mode === "range" && selectionAnchorRef.current) {
        const order = selectableAssetIdsRef.current;
        const from = order.indexOf(selectionAnchorRef.current);
        const to = order.indexOf(assetId);
        if (from !== -1 && to !== -1) {
          const [lo, hi] = from <= to ? [from, to] : [to, from];
          const span = order.slice(lo, hi + 1);
          setSelectedAssetIds((current) => new Set([...current, ...span]));
          return;
        }
      }

      selectionAnchorRef.current = assetId;
      setSelectedAssetIds((current) => {
        const next = new Set(current);
        if (next.has(assetId)) {
          next.delete(assetId);
        } else {
          next.add(assetId);
        }
        return next;
      });
    },
    [],
  );

  // Replace the whole selection set — used by shift+drag box-select in the grid.
  const replaceAssetSelection = useCallback((ids: string[]) => {
    if (bulkDeletingRef.current || bulkLikingRef.current) return;
    setBulkCurationError(undefined);
    setBulkCurationStatus(undefined);
    setSelectedAssetIds(new Set(ids));
  }, []);

  const clearAssetSelection = useCallback(() => {
    if (bulkDeletingRef.current || bulkLikingRef.current) return;
    setSelectedAssetIds((current) => (current.size === 0 ? current : new Set()));
    setBulkCurationError(undefined);
    setBulkCurationStatus(undefined);
  }, []);

  // The board being filled while choosing from the gallery, and the pieces
  // already on it: they are marked in the grid and cannot be picked twice.
  const moodboardPickDetail = useQuery(
    api.moodboards.getMoodboard,
    moodboardPick && canAccessMyGallery
      ? { ownerUserId, moodboardId: moodboardPick.board.id as Id<"moodboards"> }
      : "skip",
  );
  const pickOnBoardIds = useMemo(
    () =>
      new Set<string>([
        ...(moodboardPickDetail?.items ?? []).map((item) => String(item.assetId)),
        ...(moodboardPickDetail?.missingAssetIds ?? []).map(String),
      ]),
    [moodboardPickDetail],
  );
  const moodboardPickRef = useRef(moodboardPick);
  moodboardPickRef.current = moodboardPick;
  const pickOnBoardIdsRef = useRef(pickOnBoardIds);
  pickOnBoardIdsRef.current = pickOnBoardIds;

  const runBulkCuration = useCallback(
    async (isPublic: boolean, overrideIds?: string[], isFeatured?: boolean) => {
      if (bulkDeletingRef.current || bulkLikingRef.current || bulkCurationLoading || !canCuratePublic) return;
      const ids = overrideIds ?? Array.from(selectedAssetIds);
      if (ids.length === 0) return;

      setBulkCurationLoading(true);
      setBulkCurationError(undefined);
      setBulkCurationStatus(undefined);
      try {
        const response = await fetch("/api/admin/assets/bulk-curation", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            assetIds: ids,
            isPublic,
            ...(isFeatured !== undefined ? { isFeatured } : {}),
          }),
        });
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
          result?: {
            updatedCount: number;
            skippedCount: number;
            isPublic: boolean;
          };
        } | null;
        if (!response.ok || !payload?.result) {
          throw new Error(payload?.error || "Bulk curation failed.");
        }

        const { updatedCount, skippedCount } = payload.result;
        const verb =
          isFeatured === true
            ? "featured on the taste profile"
            : isPublic
              ? "made public"
              : "made private";
        const skippedSuffix =
          skippedCount > 0 ? ` (${skippedCount} skipped)` : "";
        setBulkCurationStatus(
          `${updatedCount} asset${updatedCount === 1 ? "" : "s"} ${verb}${skippedSuffix}.`,
        );

        const updatedIds = new Set(ids);
        setSelectedImage((current) =>
          current && updatedIds.has(current.id)
            ? { ...current, isPublic }
            : current,
        );
        setSelectedAssetIds(new Set());
      } catch (error) {
        setBulkCurationError(
          error instanceof Error ? error.message : "Bulk curation failed.",
        );
      } finally {
        setBulkCurationLoading(false);
      }
    },
    [bulkCurationLoading, canCuratePublic, selectedAssetIds],
  );

  const createFolder = useCallback(
    async (name: string): Promise<string | null> => {
      if (!canAccessMyGallery) {
        setFolderError("Sign in to create folders.");
        return null;
      }
      const trimmedName = name.trim();
      if (!trimmedName) {
        setFolderError("Folder name is required.");
        return null;
      }

      setFolderError(undefined);
      try {
        const result = await createFolderMutation({
          ownerUserId,
          name: trimmedName,
        });
        return result.folderId;
      } catch (error) {
        setFolderError(
          error instanceof Error
            ? error.message
            : "Failed to create folder.",
        );
        return null;
      }
    },
    [canAccessMyGallery, createFolderMutation, ownerUserId],
  );

  const createStorybook = useCallback(
    async (name: string): Promise<string | null> => {
      if (!canAccessMyGallery) {
        setFolderError("Sign in to create storybooks.");
        return null;
      }
      const trimmedName = name.trim();
      if (!trimmedName) return null;

      setFolderError(undefined);
      try {
        const result = await createFolderMutation({
          ownerUserId,
          name: trimmedName,
          kind: "storybook",
        });
        return result.folderId;
      } catch (error) {
        setFolderError(
          error instanceof Error
            ? error.message
            : "Failed to create storybook.",
        );
        return null;
      }
    },
    [canAccessMyGallery, createFolderMutation, ownerUserId],
  );

  const toggleAssetLike = useCallback(
    async (assetId: string, nextLiked: boolean) => {
      if (!canAccessMyGallery) {
        return;
      }
      // Optimistic: reflect the new state on the open detail panel immediately;
      // the reactive gallery query refreshes the card heart shortly after.
      setSelectedImage((current) =>
        current && current.id === assetId
          ? { ...current, isLiked: nextLiked }
          : current,
      );
      try {
        await setAssetLikedMutation({
          ownerUserId,
          assetId: assetId as Id<"assets">,
          isLiked: nextLiked,
        });
      } catch {
        // Revert the optimistic detail-panel change on failure.
        setSelectedImage((current) =>
          current && current.id === assetId
            ? { ...current, isLiked: !nextLiked }
            : current,
        );
      }
    },
    [canAccessMyGallery, ownerUserId, setAssetLikedMutation],
  );

  const toggleAssetStar = useCallback(
    async (assetId: string, nextStarred: boolean) => {
      if (!canAccessMyGallery) {
        return;
      }
      // Optimistic on the open detail panel, same as the like toggle — the
      // reactive gallery query repaints the card ring a moment later.
      setSelectedImage((current) =>
        current && current.id === assetId
          ? { ...current, starredAt: nextStarred ? Date.now() : undefined }
          : current,
      );
      try {
        await setAssetStarredMutation({
          ownerUserId,
          assetId: assetId as Id<"assets">,
          starred: nextStarred,
        });
      } catch {
        setSelectedImage((current) =>
          current && current.id === assetId
            ? { ...current, starredAt: nextStarred ? undefined : Date.now() }
            : current,
        );
      }
    },
    [canAccessMyGallery, ownerUserId, setAssetStarredMutation],
  );

  const saveAssetStarNote = useCallback(
    async (assetId: string, note: string) => {
      if (!canAccessMyGallery) {
        return;
      }
      const trimmed = note.trim();
      setSelectedImage((current) =>
        current && current.id === assetId
          ? { ...current, starNote: trimmed || undefined }
          : current,
      );
      await setAssetStarNoteMutation({
        ownerUserId,
        assetId: assetId as Id<"assets">,
        note: trimmed,
      });
    },
    [canAccessMyGallery, ownerUserId, setAssetStarNoteMutation],
  );

  const closeSelectedImage = useCallback(() => {
    const isMobile =
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 767px)").matches;
    if (isMobile) {
      setSheetDismissing(true);
      setSheetDragY(0);
      setTimeout(() => {
        setSelectedImage(null);
        setSheetDismissing(false);
      }, 200);
    } else {
      setSelectedImage(null);
    }
  }, []);

  const deleteAsset = useCallback(
    async (assetId: string) => {
      if (bulkDeletingRef.current || bulkLikingRef.current || deletingAssetId) return;
      if (!canDeleteInCurrentView) {
        setDeleteAssetError(
          "Switch to My Gallery to delete assets.",
        );
        return;
      }

      setDeleteAssetError(undefined);
      setExitingAssetIds((previous) => {
        const next = new Set(previous);
        next.add(assetId);
        return next;
      });

      await new Promise((resolve) => setTimeout(resolve, 260));

      setHiddenAssetIds((previous) => {
        const next = new Set(previous);
        next.add(assetId);
        return next;
      });
      setDeletingAssetId(assetId);

      try {
        // This handler deletes media; Skill cards use native Skill deletion.
        const response = await fetch(
          `/api/assets/${encodeURIComponent(assetId)}`,
          { method: "DELETE" },
        );
        if (!response.ok) {
          const payload = (await response
            .json()
            .catch(() => ({}))) as { error?: string };
          throw new Error(payload.error || "Failed to delete asset.");
        }

        loadedImageIdsRef.current.delete(assetId);

        // A pack member leaves the pack, not the view: the rest of the pack
        // stays open, and if the cover went the next frame takes its place.
        setSelectedImage((current) => {
          if (!current) return current;
          const previews = current.previewImages ?? [];
          if (!previews.some((preview) => preview.id === assetId)) {
            return current.id === assetId ? null : current;
          }
          const remaining = previews.filter((preview) => preview.id !== assetId);
          if (remaining.length === 0) return null;
          if (current.id !== assetId) {
            return { ...current, previewImages: remaining };
          }
          const next = remaining[0]!;
          return {
            ...current,
            id: next.id,
            promptId: next.promptId,
            thumbSrc: next.src,
            fullSrc: next.fullSrc,
            prompt: next.prompt,
            width: next.width,
            height: next.height,
            kind: next.kind,
            contentType: next.contentType,
            previewImages: remaining,
          };
        });
        setSelectedAssetIds((current) => {
          if (!current.has(assetId)) return current;
          const next = new Set(current);
          next.delete(assetId);
          return next;
        });
      } catch (error) {
        setHiddenAssetIds((previous) => {
          if (!previous.has(assetId)) return previous;
          const next = new Set(previous);
          next.delete(assetId);
          return next;
        });
        setDeleteAssetError(
          error instanceof Error
            ? error.message
            : "Failed to delete asset.",
        );
      } finally {
        setExitingAssetIds((previous) => {
          if (!previous.has(assetId)) return previous;
          const next = new Set(previous);
          next.delete(assetId);
          return next;
        });
        setDeletingAssetId((current) =>
          current === assetId ? null : current,
        );
      }
    },
    [
      canDeleteInCurrentView,
      deletingAssetId,
    ],
  );

  // Image navigation
  const tags = useQuery(api.tags.listTags, {});
  // Curated filter pills (admin-managed) — the only tag UI on the main menu.
  // Counts come from the backend using the same predicates the grid filter
  // applies, so pill numbers always match what a click shows.
  const menuFilters = useQuery(
    api.menuFilters.listMenuFilters,
    ownerUserId
      ? galleryScope === "public"
        ? { ownerUserId, isPublic: true }
        : canAccessMyGallery
          ? { ownerUserId }
          : "skip"
      : "skip",
  );
  const folders = useQuery(
    api.folders.listFolders,
    canAccessMyGallery ? { ownerUserId } : "skip",
  );
  const folderAssetCounts = useQuery(
    api.assets.folderAssetCounts,
    canAccessMyGallery ? { ownerUserId } : "skip",
  );
  const folderNameById = useMemo(
    () =>
      new Map<string, string>(
        (folders ?? []).map((folder) => [folder._id, folder.name]),
      ),
    [folders],
  );
  const folderCountById = useMemo(
    () =>
      new Map<string, number>(
        (folderAssetCounts ?? []).map((entry) => [entry.folderId, entry.count]),
      ),
    [folderAssetCounts],
  );
  // Card badges: where a piece is filed, plus what it is. A section
  // sub-collection (Dear Annete / Characters) badges as its PARENT and hands
  // over the section as the type — the section name on its own would read the
  // same on every world.
  const folderBadgeById = useMemo(() => {
    const byId = new Map(
      (folders ?? []).map((folder) => [folder._id as string, folder]),
    );
    const badges = new Map<
      string,
      { label: string; section: CollectionSectionKey | null }
    >();
    for (const folder of folders ?? []) {
      const parent = folder.parentFolderId
        ? byId.get(folder.parentFolderId as string)
        : undefined;
      const section = normalizeCollectionSection(folder.name);
      badges.set(folder._id as string, {
        label: section && parent ? parent.name : folder.name,
        section,
      });
    }
    return badges;
  }, [folders]);
  const resolveEntryBadges = useCallback(
    (entry: Pick<GalleryEntry, "folderIds" | "tagNames">) => {
      const labels: string[] = [];
      let sectionFromFolder: CollectionSectionKey | null = null;
      for (const folderId of entry.folderIds ?? []) {
        const badge = folderBadgeById.get(folderId);
        if (!badge) continue;
        if (badge.section && !sectionFromFolder) {
          sectionFromFolder = badge.section;
        }
        if (!labels.includes(badge.label)) labels.push(badge.label);
      }
      // Tags win over the filing: `character` / `location` / `scene` are the
      // ground truth for what a piece is, the folder is only the fallback for
      // pieces that predate the tag conversion.
      let section: CollectionSectionKey | null = null;
      for (const tagName of entry.tagNames ?? []) {
        section = sectionKeyForTagName(tagName);
        if (section) break;
      }
      section = section ?? sectionFromFolder;
      if (labels.length === 0 && !section) return null;
      return {
        collectionLabels: labels.length > 0 ? labels : undefined,
        typeLabel: section ? collectionSectionBadgeLabel(section) : undefined,
      };
    },
    [folderBadgeById],
  );
  const foldersWithCounts = useMemo(
    () =>
      (folders ?? []).map((folder) => ({
        ...folder,
        count: folderCountById.get(folder._id) ?? 0,
      })),
    [folders, folderCountById],
  );
  // Storybooks are folders too, but they surface through their own UI — keep
  // them out of the plain collections list.
  const collectionFoldersWithCounts = useMemo(
    () => foldersWithCounts.filter((folder) => folder.kind !== "storybook"),
    [foldersWithCounts],
  );
  const emptyPromptFolders = useMemo(
    () =>
      folders?.map((folder) => ({
        _id: String(folder._id),
        name: folder.name,
        parentFolderId: folder.parentFolderId ? String(folder.parentFolderId) : undefined,
        kind: folder.kind,
      })),
    [folders],
  );
  const smartMenuFilterByFolderId = useMemo(() => {
    const tagFilters = (menuFilters ?? []).filter(
      (entry) => entry.kind === "tag",
    );
    const mappings = new Map<string, (typeof tagFilters)[number]>();
    for (const folder of collectionFoldersWithCounts) {
      // World parts are actual membership collections. A child named Live
      // Action must not become the global Live action tag view.
      if (folder.parentFolderId) continue;
      const folderKey = canonicalTagKey(folder.name);
      if (!folderKey) continue;
      const matchingFilter = tagFilters.find((entry) =>
        (entry.tagNames ?? []).some(
          (tagName) => canonicalTagKey(tagName) === folderKey,
        ),
      );
      if (matchingFilter) {
        mappings.set(folder._id, matchingFilter);
      }
    }
    return mappings;
  }, [collectionFoldersWithCounts, menuFilters]);

  // Collections browse view: preview summaries fetched only while the view is
  // open, merged with the live counts the dashboard already subscribes to.
  // Also fetched for the Add-to drawer's folder view, which shows the same
  // cover thumbnails as drop targets.
  const collectionSummaries = useQuery(
    api.folders.listCollectionSummaries,
    (viewMode === "collections" || addToPanelOpen) &&
      galleryScope === "mine" &&
      canAccessMyGallery
      ? { ownerUserId }
      : "skip",
  );
  const collectionCards = useMemo(
    () =>
      (collectionSummaries ?? []).map((summary) => ({
        ...summary,
        count:
          smartMenuFilterByFolderId.get(summary._id)?.count ??
          folderCountById.get(summary._id) ??
          0,
      })),
    [collectionSummaries, folderCountById, smartMenuFilterByFolderId],
  );

  // Which folders (collections + storybooks) are published to the public
  // showcase. Derived from the folders query so it covers every folder kind.
  const showcasedFolderIds = useMemo(
    () =>
      new Set(
        (folders ?? [])
          .filter((folder) => folder.showcased)
          .map((folder) => folder._id),
      ),
    [folders],
  );
  const toggleFolderShowcase = useCallback(
    (folderId: string, next: boolean) => {
      if (!ownerUserId) return;
      void setFolderShowcasedMutation({
        ownerUserId,
        folderId: folderId as Id<"folders">,
        showcased: next,
      });
    },
    [ownerUserId, setFolderShowcasedMutation],
  );

  // Collections hidden from the main gallery grid. Their members still show
  // inside the collection itself and in search.
  const hiddenFolderIds = useMemo(
    () =>
      new Set(
        (folders ?? [])
          .filter((folder) => folder.hiddenFromGallery)
          .map((folder) => folder._id as string),
      ),
    [folders],
  );
  const toggleFolderHidden = useCallback(
    (folderId: string, next: boolean) => {
      if (!ownerUserId) return;
      void setFolderHiddenMutation({
        ownerUserId,
        folderId: folderId as Id<"folders">,
        hidden: next,
      });
    },
    [ownerUserId, setFolderHiddenMutation],
  );

  // Featured = hero treatment on the public home. Featuring an unpublished
  // set publishes it too (backend enforces featured ⇒ showcased).
  const featuredFolderIds = useMemo(
    () =>
      new Set(
        (folders ?? [])
          .filter((folder) => folder.showcaseFeatured)
          .map((folder) => folder._id),
      ),
    [folders],
  );
  const toggleFolderFeatured = useCallback(
    (folderId: string, next: boolean) => {
      if (!ownerUserId) return;
      void setFolderFeaturedMutation({
        ownerUserId,
        folderId: folderId as Id<"folders">,
        featured: next,
      });
    },
    [ownerUserId, setFolderFeaturedMutation],
  );

  // THE taste collection — the one plain collection whose members are the
  // public showcase's inspiration grid. At most one; backend enforces it.
  const tasteFolderId = useMemo(
    () =>
      (folders ?? []).find((folder) => folder.tasteCollection)?._id ?? null,
    [folders],
  );
  const toggleFolderTaste = useCallback(
    (folderId: string, next: boolean) => {
      if (!ownerUserId) return;
      void setTasteCollectionMutation({
        ownerUserId,
        folderId: folderId as Id<"folders">,
        taste: next,
      });
    },
    [ownerUserId, setTasteCollectionMutation],
  );

  const createSubCollection = useCallback(
    async (parentFolderId: string, name: string): Promise<string | null> => {
      if (!canAccessMyGallery) {
        setFolderError("Sign in to create folders.");
        return null;
      }
      const trimmedName = name.trim();
      if (!trimmedName) return null;

      setFolderError(undefined);
      try {
        const result = await createFolderMutation({
          ownerUserId,
          name: trimmedName,
          parentFolderId: parentFolderId as Id<"folders">,
        });
        return result.folderId;
      } catch (error) {
        setFolderError(
          error instanceof Error
            ? error.message
            : "Failed to create sub-collection.",
        );
        return null;
      }
    },
    [canAccessMyGallery, createFolderMutation, ownerUserId],
  );

  const storybooks = useQuery(
    api.storybooks.listStorybooks,
    canAccessMyGallery && galleryScope === "mine" ? { ownerUserId } : "skip",
  );
  // A storybook can be a child of its world (group "Storybooks"). The child
  // lists the backend returns hold plain collections only, so the world's
  // storybooks are joined here from the folder list and the storybook list.
  const storybookWorldById = useMemo(() => {
    const byId = new Map(
      (folders ?? []).map((folder) => [folder._id as string, folder]),
    );
    const worlds = new Map<string, { _id: string; name: string }>();
    for (const folder of folders ?? []) {
      if (folder.kind !== "storybook" || !folder.parentFolderId) continue;
      const parent = byId.get(folder.parentFolderId as string);
      if (parent) worlds.set(folder._id as string, { _id: parent._id as string, name: parent.name });
    }
    return worlds;
  }, [folders]);
  const storybookChildrenByWorld = useMemo(() => {
    const byId = new Map(
      (folders ?? []).map((folder) => [folder._id as string, folder]),
    );
    const children = new Map<
      string,
      Array<{
        _id: string;
        name: string;
        description?: string;
        parentFolderId: string;
        group: string;
        sortOrder?: number;
        count: number;
        updatedAt?: number;
        createdAt?: number;
        previewAssets: NonNullable<typeof storybooks>[number]["previewAssets"];
      }>
    >();
    for (const book of storybooks ?? []) {
      const world = storybookWorldById.get(book._id as string);
      if (!world) continue;
      const folder = byId.get(book._id as string);
      const list = children.get(world._id) ?? [];
      list.push({
        _id: book._id as string,
        name: book.name,
        description: book.story,
        parentFolderId: world._id,
        group: folder?.group?.trim() || "Storybooks",
        sortOrder: folder?.sortOrder,
        count: book.count,
        updatedAt: book.updatedAt,
        createdAt: book.createdAt,
        previewAssets: book.previewAssets,
      });
      children.set(world._id, list);
    }
    return children;
  }, [folders, storybookWorldById, storybooks]);
  const openCollectionFromCard = useCallback(
    (folderId: string) => {
      // A world's storybook card opens the storybook, not a filtered grid.
      if (storybookWorldById.has(folderId)) {
        setOpenStorybookId(folderId);
        return;
      }
      setSelectedFolderId(folderId);
      setViewMode("grid");
    },
    [setViewMode, storybookWorldById],
  );

  // Saved Skills join the default grid as one card each — an insert is a
  // dated piece of work like any tile, and opens as its document. Its step
  // media stays out of the feed (assetRole "skill_example"); the card is the
  // only place those frames surface.
  const gridSkills = useQuery(
    api.skills.listSkills,
    canAccessMyGallery && galleryScope === "mine"
      ? { ownerUserId, previewLimit: 8, excludeTagNames: [CINEMATOGRAPHY_TAG] }
      : "skip",
  );
  const deleteSkillMutation = useMutation(api.skills.deleteSkill);

  // Owner folder rows carry the saved public counts once their migration is
  // complete. Keep the exact legacy fallback during rollout, then private
  // browsing no longer subscribes to the entire public gallery's counts.
  const ownerPublicCountsReady = folders !== undefined &&
    folders.every((folder) => folder.publicMemberCount !== undefined);
  const publicCollections = useQuery(
    api.assets.listPublicCollections,
    galleryScope === "public" || (canAccessMyGallery && !ownerPublicCountsReady)
      ? {}
      : "skip",
  );
  const publicFoldersWithCounts = useMemo(
    () =>
      (publicCollections ?? []).map((entry) => ({
        _id: entry.folderId,
        name: entry.label,
        count: entry.count,
      })),
    [publicCollections],
  );
  const sidebarFolders =
    galleryScope === "public"
      ? publicFoldersWithCounts
      : collectionFoldersWithCounts;

  // Collections with at least one public asset — marks mine-scope rows and
  // decides whether the row's publish toggle reads as "publish" or "unpublish".
  const publishedFolderIds = useMemo(
    () =>
      new Set(galleryScope === "mine" && ownerPublicCountsReady
        ? (folders ?? []).filter((folder) => (folder.publicMemberCount ?? 0) > 0)
            .map((folder) => String(folder._id))
        : (publicCollections ?? []).map((entry) => String(entry.folderId))),
    [folders, galleryScope, ownerPublicCountsReady, publicCollections],
  );

  const [folderPublishNotice, setFolderPublishNotice] = useState<
    DashboardNotice | undefined
  >(undefined);
  const [folderPublishLoading, setFolderPublishLoading] = useState(false);
  const toggleFolderPublic = useCallback(
    async (folderId: string, next: boolean) => {
      if (folderPublishLoading) return;
      setFolderPublishLoading(true);
      try {
        const response = await fetch(`/api/admin/folders/${folderId}/curation`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ isPublic: next }),
        });
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
          result?: { updatedCount: number; memberCount: number };
        } | null;
        if (!response.ok || !payload?.result) {
          throw new Error(payload?.error || "Failed to update collection visibility.");
        }
        const { updatedCount } = payload.result;
        setFolderPublishNotice({
          title: next ? "Collection published" : "Collection unpublished",
          message: `${updatedCount} asset${updatedCount === 1 ? "" : "s"} made ${next ? "public" : "private"}.`,
          type: "success",
          at: Date.now(),
        });
      } catch (error) {
        setFolderPublishNotice({
          title: next ? "Publish failed" : "Unpublish failed",
          message:
            error instanceof Error
              ? error.message
              : "Failed to update collection visibility.",
          type: "warning",
          at: Date.now(),
        });
      } finally {
        setFolderPublishLoading(false);
      }
    },
    [folderPublishLoading],
  );

  const knownFolderIds = useMemo(() => {
    if (galleryScope === "public") {
      return publicCollections
        ? publicCollections.map((entry) => entry.folderId)
        : null;
    }
    return folders ? folders.map((folder) => folder._id) : null;
  }, [galleryScope, folders, publicCollections]);
  const effectiveSelectedFolderId = useMemo(
    () =>
      resolveScopeFolderFilter({
        galleryScope,
        selectedFolderId,
        knownFolderIds,
      }),
    [galleryScope, knownFolderIds, selectedFolderId],
  );

  useEffect(() => {
    if (selectedFolderId !== effectiveSelectedFolderId) {
      setSelectedFolderId(effectiveSelectedFolderId);
    }
  }, [effectiveSelectedFolderId, selectedFolderId]);

  // Styles as the parent of a world's shelves (lib/style-scope).
  const scopeFolders = useMemo(
    () =>
      collectionFoldersWithCounts.map((folder) => ({
        _id: String(folder._id),
        name: folder.name,
        description: folder.description,
        parentFolderId: folder.parentFolderId
          ? String(folder.parentFolderId)
          : undefined,
        group: folder.group,
        sortOrder: folder.sortOrder,
        count: folder.count,
      })),
    [collectionFoldersWithCounts],
  );
  const worldStyleScope = useMemo(
    () =>
      galleryScope === "mine"
        ? resolveWorldStyleScope({
            folders: scopeFolders,
            activeFolderId: effectiveSelectedFolderId,
            rememberedStyle,
          })
        : null,
    [effectiveSelectedFolderId, galleryScope, rememberedStyle, scopeFolders],
  );
  useEffect(() => {
    if (!worldStyleScope) return;
    const { worldId, activeStyleId, atStyleBranch, atWorldRoot } = worldStyleScope;
    if (atStyleBranch && activeStyleId) {
      setRememberedStyle((current) =>
        current?.worldId === worldId && current.styleId === activeStyleId
          ? current
          : { worldId, styleId: activeStyleId },
      );
    } else if (atWorldRoot) {
      setRememberedStyle((current) => (current?.worldId === worldId ? null : current));
    }
  }, [worldStyleScope]);
  // A style branch shows the world's shelves, each holding only its pieces.
  const styleBranchWithShelves = Boolean(
    worldStyleScope?.atStyleBranch && worldStyleScope.shelves.length > 0,
  );
  // On a shelf, the remembered style narrows the shelf to that style.
  const styleShelfFilterId =
    worldStyleScope && !worldStyleScope.atStyleBranch && !worldStyleScope.atWorldRoot
      ? worldStyleScope.activeStyleId
      : null;
  const activeStyleFolder = styleShelfFilterId
    ? worldStyleScope?.styles.find((style) => style._id === styleShelfFilterId)
    : undefined;
  const selectStyleScope = useCallback(
    (styleId: string | null) => {
      if (!worldStyleScope) return;
      const { worldId, atStyleBranch, atWorldRoot } = worldStyleScope;
      if (atWorldRoot || atStyleBranch) {
        // At the top of the world a style is a place: open its branch.
        setSelectedFolderId(styleId ?? worldId);
        return;
      }
      setRememberedStyle(styleId ? { worldId, styleId } : null);
    },
    [worldStyleScope],
  );
  // Inside a world, the folders view shows that world's children.
  const foldersViewWorldId = useMemo(
    () =>
      galleryScope === "mine"
        ? resolveFoldersViewWorld(scopeFolders, effectiveSelectedFolderId)
        : null,
    [effectiveSelectedFolderId, galleryScope, scopeFolders],
  );

  const availableUploadTags = useMemo(() => {
    const deduped = new Map<string, string>();
    for (const tag of tags ?? []) {
      const key = canonicalTagKey(tag.name) || tag._id;
      if (!deduped.has(key)) {
        deduped.set(key, tag.name);
      }
    }
    return Array.from(deduped.values()).sort((a, b) =>
      a.localeCompare(b),
    );
  }, [tags]);

  // Collection-kind pills only make sense where the folder filter works —
  // the owner's vault. Public scope shows the tag-kind pills only.
  const menuFilterEntries = useMemo(() => {
    const entries = menuFilters ?? [];
    if (galleryScope === "public") {
      return entries.filter((entry) => entry.kind === "tag");
    }
    return entries;
  }, [menuFilters, galleryScope]);
  const activeSmartCollectionFilter = effectiveSelectedFolderId
    ? smartMenuFilterByFolderId.get(effectiveSelectedFolderId)
    : undefined;

  // selectedTags holds the ids of selected tag-kind menu filters. Each pill
  // becomes its OWN group: an asset has to match every selected pill (AND
  // across pills), while a pill's own tag docs stay an OR. Selecting Locations
  // + Live Action asks for live-action locations — the old flat union answered
  // "locations OR live action" and looked like the filter did nothing.
  // A same-named collection backed by a curated tag filter is a smart
  // collection: keep the folder selected for navigation, but use the exact tag
  // predicate from the island.
  const selectedTagIdGroups = useMemo(() => {
    const selectedSet = new Set(selectedTags);
    if (activeSmartCollectionFilter) {
      selectedSet.add(activeSmartCollectionFilter._id);
    }
    if (selectedSet.size === 0) return undefined;
    const groups: Id<"tags">[][] = [];
    for (const entry of menuFilterEntries) {
      if (entry.kind !== "tag" || !selectedSet.has(entry._id)) continue;
      if (entry.tagIds.length > 0) groups.push(entry.tagIds);
    }
    if (bookmarksOnly) {
      const bookmarkTagIds = (tags ?? [])
        .filter((tag) => canonicalTagKey(tag.name) === "bookmark")
        .map((tag) => tag._id);
      if (bookmarkTagIds.length > 0) groups.push(bookmarkTagIds);
    }
    return groups.length > 0 ? groups : undefined;
  }, [activeSmartCollectionFilter, bookmarksOnly, selectedTags, menuFilterEntries, tags]);

  // The Bookmarks pill is about the posts: with it on, every piece that came
  // from a saved post shows as that post (author, text, media), not as bare
  // media.
  const bookmarkFilterOn = useMemo(() => {
    const selectedSet = new Set(selectedTags);
    return bookmarksOnly || menuFilterEntries.some(
      (entry) =>
        entry.kind === "tag" &&
        selectedSet.has(entry._id) &&
        (entry.tagNames ?? []).some((name) => name.trim().toLowerCase() === "bookmark"),
    );
  }, [bookmarksOnly, selectedTags, menuFilterEntries]);

  // The negative side of the same pills (minus button on a pill's left edge).
  // Tag pills exclude their tags; collection pills exclude the collection's
  // members. Exclusion always wins over an include.
  const excludedTagIds = useMemo(() => {
    if (excludedFilters.length === 0 && includeSkills) return undefined;
    const excludedSet = new Set(excludedFilters);
    const ids = new Set<Id<"tags">>();
    if (!includeSkills) {
      for (const tag of tags ?? []) {
        if (["workflow", "skill reference"].includes(canonicalTagKey(tag.name))) ids.add(tag._id);
      }
    }
    for (const entry of menuFilterEntries) {
      if (entry.kind !== "tag" || !excludedSet.has(entry._id)) continue;
      for (const id of entry.tagIds) {
        ids.add(id);
      }
    }
    return ids.size > 0 ? Array.from(ids) : undefined;
  }, [excludedFilters, includeSkills, menuFilterEntries, tags]);

  const excludedFolderIds = useMemo(() => {
    if (excludedFilters.length === 0) return undefined;
    const excludedSet = new Set(excludedFilters);
    const ids: Id<"folders">[] = [];
    for (const entry of menuFilterEntries) {
      if (entry.kind !== "collection" || !excludedSet.has(entry._id)) continue;
      if (entry.folderId) ids.push(entry.folderId as Id<"folders">);
    }
    return ids.length > 0 ? ids : undefined;
  }, [excludedFilters, menuFilterEntries]);

  // Any curated pill predicate at all — positive or negative. Every read path
  // that can't post-filter a cursor page cleanly keys off this.
  const menuFilterActive = Boolean(
    selectedTagIdGroups || excludedTagIds || excludedFolderIds || bookmarksOnly,
  );
  const selectedTagsForFilterBar = useMemo(() => {
    if (!activeSmartCollectionFilter) return selectedTags;
    return Array.from(
      new Set([...selectedTags, activeSmartCollectionFilter._id]),
    );
  }, [activeSmartCollectionFilter, selectedTags]);

  // Newest browsing streams source pages of 60, including sparse filters and
  // flattened worlds. Global featured/shuffle ordering retains its complete
  // window until it has a server-side ordered cursor; shuffling only the first
  // page would silently bias the result toward recent pieces.
  // Breadcrumb above the grid while browsing inside a set. Roots return to
  // the collections (landing) view.
  const breadcrumbSegments = useMemo<BreadcrumbSegment[]>(() => {
    if (galleryScope !== "mine") return [];
    if (viewMode === "collections") {
      const world = foldersViewWorldId
        ? foldersWithCounts.find((entry) => entry._id === foldersViewWorldId)
        : undefined;
      if (!world) return [];
      return [
        { label: "Collections", onClick: () => setSelectedFolderId(null) },
        { label: world.name },
      ];
    }
    if (viewMode !== "grid") return [];
    if (effectiveSelectedFolderId) {
      const folder = foldersWithCounts.find(
        (entry) => entry._id === effectiveSelectedFolderId,
      );
      if (!folder) return [];
      const segments: BreadcrumbSegment[] = [
        {
          label: "Collections",
          onClick: () => {
            setSelectedFolderId(null);
            setViewMode("collections");
          },
        },
      ];
      const parent = folder.parentFolderId
        ? foldersWithCounts.find((entry) => entry._id === folder.parentFolderId)
        : undefined;
      if (parent) {
        segments.push({
          label: parent.name,
          onClick: () => setSelectedFolderId(parent._id),
        });
      }
      if (activeStyleFolder) {
        segments.push({
          label: activeStyleFolder.name,
          onClick: () => setSelectedFolderId(activeStyleFolder._id),
        });
      }
      segments.push({ label: folder.name });
      return segments;
    }
    return [];
  }, [
    activeStyleFolder,
    effectiveSelectedFolderId,
    foldersViewWorldId,
    foldersWithCounts,
    galleryScope,
    setViewMode,
    viewMode,
  ]);

  // A single collection pages its links. A world pages owner assets and tests
  // their memberships, so assets filed in both parent and child appear once
  // and legacy primary-folder pointers remain reachable without a backfill.
  const childFolderParentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const folder of folders ?? []) {
      if (folder.parentFolderId) ids.add(folder.parentFolderId as string);
    }
    return ids;
  }, [folders]);
  const browsingWorldFolder =
    Boolean(effectiveSelectedFolderId) &&
    childFolderParentIds.has(effectiveSelectedFolderId as string);
  const activeCollectionFolder = effectiveSelectedFolderId
    ? collectionFoldersWithCounts.find(
        (folder) => folder._id === effectiveSelectedFolderId,
      )
    : undefined;
  const activeChildCollectionCount = activeCollectionFolder
    ? collectionFoldersWithCounts.filter(
        (folder) => folder.parentFolderId === activeCollectionFolder._id,
      ).length
    : 0;
  // A saved view or smart filter narrows the pieces, not the collection's
  // boards: the Moodboards tab stays open under any of them.
  const moodboardsViewActive = Boolean(
    activeCollectionFolder &&
      moodboardsCollectionId === activeCollectionFolder._id &&
      canManageFoldersInCurrentView &&
      viewMode === "grid" &&
      !storybooksView && !bookmarksView && !extraTabView,
  );
  // Instructions and Journal belong to a marked world (folders.worldKey on
  // its root). Every shelf, style branch and storybook of the world shows
  // them too, so a world's instructions are one click from anywhere in it.
  const activeWorldRoot = activeCollectionFolder
    ? activeCollectionFolder.parentFolderId
      ? collectionFoldersWithCounts.find(
          (folder) => folder._id === activeCollectionFolder.parentFolderId,
        )
      : activeCollectionFolder
    : undefined;
  const activeWorldKey = activeWorldRoot?.worldKey;
  const activeWorldPanel =
    activeWorldKey &&
    activeCollectionFolder &&
    worldPanel?.collectionId === activeCollectionFolder._id &&
    canManageFoldersInCurrentView &&
    galleryScope === "mine" &&
    viewMode === "grid" &&
    !storybooksView && !bookmarksView && !extraTabView
      ? worldPanel.tab
      : null;
  // The world the active collection belongs to: its root and plain children.
  // A board here may belong to any of them.
  const moodboardWorldCollections = useMemo(() => {
    if (!activeCollectionFolder) return [];
    const rootId = activeCollectionFolder.parentFolderId ?? activeCollectionFolder._id;
    return collectionFoldersWithCounts
      .filter((folder) => folder._id === rootId || folder.parentFolderId === rootId)
      .map((folder) => ({
        _id: String(folder._id),
        name: folder.name,
        parentFolderId: folder.parentFolderId ? String(folder.parentFolderId) : undefined,
        group: folder.group,
      }));
  }, [activeCollectionFolder, collectionFoldersWithCounts]);
  const srefsCollectionView = galleryScope === "mine" && viewMode === "grid" &&
    !storybooksView && !bookmarksView && !extraTabView &&
    isSrefCollection(activeCollectionFolder?.name);
  const collectionAssetsExpanded =
    (browsingWorldFolder || styleBranchWithShelves) &&
    !activeSmartCollectionFilter &&
    (flattenStacks || expandedCollectionId === effectiveSelectedFolderId);
  const collectionStackViewAvailable =
    !srefsCollectionView &&
    Boolean(effectiveSelectedFolderId) &&
    !activeSmartCollectionFilter &&
    galleryScope === "mine" &&
    viewMode === "grid" &&
    !selectedModelName &&
    !mediaKind &&
    !likedOnly &&
    !menuFilterActive &&
    !semanticMode &&
    !assetSearchQuery.trim();

  const folderPaginationActive =
    !srefsCollectionView &&
    !browsingWorldFolder &&
    galleryScope === "mine" &&
    canAccessMyGallery &&
    Boolean(effectiveSelectedFolderId) &&
    !activeSmartCollectionFilter &&
    sortOrder === "newest" &&
    !menuFilterActive && !selectedModelName && !mediaKind && !likedOnly;
  const paginationActive = !srefsCollectionView && sortOrder === "newest" && !folderPaginationActive;

  const minePageArgs = paginationActive && galleryScope === "mine" && canAccessMyGallery
      ? {
          ownerUserId,
          modelName: selectedModelName ?? undefined,
          kind: mediaKind ?? undefined,
          onlyLiked: likedOnly || undefined,
          tagIdGroups: selectedTagIdGroups,
          excludeTagIds: excludedTagIds,
          excludeFolderIds: excludedFolderIds,
          folderId: effectiveSelectedFolderId && !activeSmartCollectionFilter
            ? effectiveSelectedFolderId as Id<"folders"> : undefined,
          includeDescendants: browsingWorldFolder || undefined,
          mergeOwners: menuFilterActive || Boolean(effectiveSelectedFolderId) || undefined,
          skipHiddenCollections: !effectiveSelectedFolderId || undefined,
        }
      : "skip" as const;
  const minePagedAssets = usePaginatedQuery(
    api.assets.listGalleryAssetsPage,
    minePageArgs !== "skip" && !minePageArgs.mergeOwners ? minePageArgs : "skip",
    { initialNumItems: 60 },
  );
  // This helper hook supplies endCursor as pages load, keeping the merged
  // chronological stream contiguous through reactive inserts and deletions.
  const mineCreatedPagedAssets = useStreamPaginatedQuery(
    api.assets.listGalleryAssetsPage,
    minePageArgs !== "skip" && minePageArgs.mergeOwners ? minePageArgs : "skip",
    { initialNumItems: 60 },
  );
  const publicPagedAssets = usePaginatedQuery(
    api.assets.listPublicGalleryAssetsPage,
    paginationActive && galleryScope === "public"
      ? {
          modelName: selectedModelName ?? undefined,
          kind: mediaKind ?? undefined,
          tagIdGroups: selectedTagIdGroups,
          excludeTagIds: excludedTagIds,
          excludeFolderIds: excludedFolderIds,
          folderId: effectiveSelectedFolderId && !activeSmartCollectionFilter
            ? effectiveSelectedFolderId as Id<"folders"> : undefined,
        }
      : "skip",
    { initialNumItems: 60 },
  );
  const folderPagedAssets = usePaginatedQuery(
    api.assets.listFolderAssetsPage,
    folderPaginationActive && effectiveSelectedFolderId
      ? {
          ownerUserId,
          folderId: effectiveSelectedFolderId as Id<"folders">,
          tagIdGroups: selectedTagIdGroups,
          excludeTagIds: excludedTagIds,
          excludeFolderIds: excludedFolderIds,
          modelName: selectedModelName ?? undefined,
          kind: mediaKind ?? undefined,
          onlyLiked: likedOnly || undefined,
        }
      : "skip",
    { initialNumItems: 60 },
  );
  const activePagedAssets = folderPaginationActive
    ? folderPagedAssets
    : galleryScope === "mine"
      ? minePageArgs !== "skip" && minePageArgs.mergeOwners
        ? mineCreatedPagedAssets : minePagedAssets
      : publicPagedAssets;
  const anyPaginationActive = paginationActive || folderPaginationActive;
  // The grid calls this repeatedly while its frontier is exposed; loadMore is
  // a no-op unless a next page is actually available.
  const loadNextGalleryPage = useCallback(() => {
    if (!anyPaginationActive) return;
    if (activePagedAssets.status === "CanLoadMore") {
      activePagedAssets.loadMore(60);
    }
  }, [anyPaginationActive, activePagedAssets]);
  // A collection with folders inside leads its grid with one stack card per
  // folder, until the owner flattens it into plain assets.
  const showChildCollectionStacks =
    collectionStackViewAvailable && !collectionAssetsExpanded;
  // The shelf stacks of a style branch are counted from the branch's own
  // pieces, so the whole branch loads (it is one collection, not the world).
  const styleBranchStacksActive =
    styleBranchWithShelves && showChildCollectionStacks;

  const mineGalleryAssets = useQuery(
    api.assets.listGalleryAssets,
    !srefsCollectionView &&
      !paginationActive &&
      !folderPaginationActive &&
      galleryScope === "mine" &&
      canAccessMyGallery
      ? {
          ownerUserId,
          tagIdGroups: selectedTagIdGroups,
          excludeTagIds: excludedTagIds,
          excludeFolderIds: excludedFolderIds,
          folderId:
            effectiveSelectedFolderId && !activeSmartCollectionFilter
              ? (effectiveSelectedFolderId as Id<"folders">)
              : undefined,
          includeDescendants: browsingWorldFolder || undefined,
          // The unscoped grid leaves hidden collections out; a folder view
          // (the backend ignores this there) always shows its members.
          skipHiddenCollections: !effectiveSelectedFolderId || undefined,
          modelName: selectedModelName ?? undefined,
          kind: mediaKind ?? undefined,
          onlyLiked: likedOnly || undefined,
          // Only global featured/shuffle sorts use the legacy one-shot window.
          // Newest flattened worlds now traverse pages without this cap.
          limit: collectionAssetsExpanded || styleBranchStacksActive ? 2000 : 600,
        }
      : "skip",
  );

  // Featured (starred) pieces lead the vault grid only under the FEATURED sort.
  // NEWEST — the default — and SHUFFLE keep them in place with everything else.
  const featuredFirst = sortOrder === "featured";

  // Starred assets in the CURRENT view, read on their own so they can lead the
  // grid under the FEATURED sort. Browse streams 60 rows at a time, so a starred piece sitting deep in
  // the gallery would otherwise not float to the top until the user scrolled
  // that far. Scoped with the same folder args as the grid query above
  // (independently of which read path is active — the folder-paginated path
  // takes only a folderId), and merged in BEFORE search and the filter bar run,
  // so a starred asset is never exempt from a filter the user set.
  const starredAssets = useQuery(
    api.assets.listStarredAssets,
    !srefsCollectionView && galleryScope === "mine" && canAccessMyGallery && featuredFirst
      ? {
          ownerUserId,
          folderId:
            effectiveSelectedFolderId && !activeSmartCollectionFilter
              ? (effectiveSelectedFolderId as Id<"folders">)
              : undefined,
          includeDescendants: browsingWorldFolder || undefined,
          skipHiddenCollections: !effectiveSelectedFolderId || undefined,
        }
      : "skip",
  );

  const childCollectionStacks = useQuery(
    api.folders.listChildCollectionEntries,
    effectiveSelectedFolderId &&
      showChildCollectionStacks &&
      !styleBranchWithShelves &&
      canAccessMyGallery
      ? {
          ownerUserId,
          parentFolderId: effectiveSelectedFolderId as Id<"folders">,
        }
      : "skip",
  );
  useEffect(() => {
    if (
      styleBranchStacksActive &&
      folderPaginationActive &&
      folderPagedAssets.status === "CanLoadMore"
    ) {
      folderPagedAssets.loadMore(200);
    }
  }, [folderPagedAssets, folderPaginationActive, styleBranchStacksActive]);

  const publicGalleryAssets = useQuery(
    api.assets.listPublicGalleryAssets,
    !paginationActive && galleryScope === "public"
      ? {
          tagIdGroups: selectedTagIdGroups,
          excludeTagIds: excludedTagIds,
          excludeFolderIds: excludedFolderIds,
          folderId:
            effectiveSelectedFolderId && !activeSmartCollectionFilter
            ? (effectiveSelectedFolderId as Id<"folders">)
            : undefined,
          modelName: selectedModelName ?? undefined,
          kind: mediaKind ?? undefined,
          limit: 600,
        }
      : "skip",
  );

  const galleryAssets = anyPaginationActive
    ? activePagedAssets.results
    : galleryScope === "mine"
      ? mineGalleryAssets
      : publicGalleryAssets;
  const unscopedGalleryAssets = useMemo(() => {
    const base = galleryAssets ?? [];
    if (!starredAssets || starredAssets.length === 0) return base;
    const present = new Set(base.map((asset) => asset._id));
    // The starred read is scoped by folder only — it knows nothing
    // about the menu pills, so its rows have to clear the same predicate here
    // or a starred piece would lead the grid on a filter it doesn't match.
    const missing = starredAssets.filter((asset) => {
      if (present.has(asset._id)) return false;
      if (
        selectedTagIdGroups &&
        !selectedTagIdGroups.every((group) =>
          asset.tagIds.some((tagId) => group.includes(tagId)),
        )
      ) {
        return false;
      }
      if (
        excludedTagIds &&
        asset.tagIds.some((tagId) => excludedTagIds.includes(tagId))
      ) {
        return false;
      }
      if (excludedFolderIds) {
        const folderIds: string[] =
          asset.folderIds ?? (asset.folderId ? [asset.folderId] : []);
        if (
          folderIds.some((folderId) =>
            excludedFolderIds.includes(folderId as Id<"folders">),
          )
        ) {
          return false;
        }
      }
      return true;
    });
    return missing.length > 0 ? [...missing, ...base] : base;
  }, [
    excludedFolderIds,
    excludedTagIds,
    galleryAssets,
    selectedTagIdGroups,
    starredAssets,
  ]);
  const baseGalleryAssets = useMemo(
    () =>
      styleShelfFilterId
        ? filterAssetsToStyle(unscopedGalleryAssets, styleShelfFilterId)
        : unscopedGalleryAssets,
    [styleShelfFilterId, unscopedGalleryAssets],
  );
  const isSimilarMode = semanticMode?.kind === "similar";

  useEffect(() => {
    if (isSimilarMode) {
      return;
    }

    if (!debouncedAssetSearchQuery) {
      setSemanticMode(null);
      setSemanticResults(null);
      setSemanticError(undefined);
      setSemanticLoading(false);
      return;
    }

    if (debouncedAssetSearchQuery.length < 3) {
      setSemanticMode(null);
      setSemanticResults(null);
      setSemanticError(undefined);
      setSemanticLoading(false);
      return;
    }

    if (galleryScope === "mine" && !ownerUserId) {
      setSemanticMode(null);
      setSemanticResults(null);
      setSemanticError(undefined);
      setSemanticLoading(false);
      return;
    }

    const requestId = semanticRequestIdRef.current + 1;
    semanticRequestIdRef.current = requestId;
    setSemanticLoading(true);
    setSemanticError(undefined);

    void semanticSearchAction({
      ownerUserId: galleryScope === "mine" ? ownerUserId : undefined,
      scope: galleryScope,
      query: debouncedAssetSearchQuery,
      folderId:
        galleryScope === "mine" &&
        effectiveSelectedFolderId &&
        !activeSmartCollectionFilter
          ? (effectiveSelectedFolderId as Id<"folders">)
          : undefined,
      modelName: selectedModelName ?? undefined,
      limit: 120,
    })
      .then((results) => {
        if (semanticRequestIdRef.current !== requestId) {
          return;
        }

        setSemanticLoading(false);
        if (results.length === 0) {
          setSemanticMode(null);
          setSemanticResults(null);
          return;
        }

        setSemanticMode({
          kind: "query",
          query: debouncedAssetSearchQuery,
        });
        setSemanticResults(results);
      })
      .catch((error) => {
        if (semanticRequestIdRef.current !== requestId) {
          return;
        }

        setSemanticLoading(false);
        setSemanticMode(null);
        setSemanticResults(null);
        setSemanticError(
          error instanceof ConvexError && typeof error.data === "string"
            ? error.data
            : "Search is unavailable right now. Try again shortly.",
        );
      });
  }, [
    activeSmartCollectionFilter,
    debouncedAssetSearchQuery,
    effectiveSelectedFolderId,
    galleryScope,
    isSimilarMode,
    ownerUserId,
    selectedModelName,
    semanticSearchAction,
  ]);

  const loadedImageIdsRef = useRef(new Set<string>());
  const markImageLoaded = useCallback((assetId: string) => {
    loadedImageIdsRef.current.add(assetId);
  }, []);

  const handleTagToggle = (tag: string) => {
    // A pill is either included or excluded, never both — picking one side
    // releases the other.
    setExcludedFilters((prev) => prev.filter((entry) => entry !== tag));
    if (activeSmartCollectionFilter?._id === tag) {
      setSelectedFolderId(null);
      setSelectedTags((prev) => prev.filter((entry) => entry !== tag));
      return;
    }
    setSelectedTags((prev) =>
      prev.includes(tag)
        ? prev.filter((t) => t !== tag)
        : [...prev, tag],
    );
  };

  // The minus on a pill's left edge: push it to the negative side (or release
  // it). Works for both kinds — a tag pill excludes its tags, a collection pill
  // excludes that collection's members.
  const handleFilterExcludeToggle = useCallback(
    (filterId: string) => {
      setSelectedTags((prev) => prev.filter((entry) => entry !== filterId));
      const excludedCollection = (menuFilters ?? []).find(
        (entry) => entry._id === filterId && entry.kind === "collection",
      );
      if (excludedCollection?.folderId) {
        // Browsing the very collection being excluded would leave an empty
        // grid with no way to read why.
        setSelectedFolderId((current) =>
          current === excludedCollection.folderId ? null : current,
        );
      }
      setExcludedFilters((prev) =>
        prev.includes(filterId)
          ? prev.filter((entry) => entry !== filterId)
          : [...prev, filterId],
      );
    },
    [menuFilters],
  );

  // Collection-kind menu pill: behaves like picking the collection in the
  // sidebar — single-select folder filter, click again to clear.
  const handleMenuCollectionToggle = useCallback(
    (folderId: string) => {
      // Browsing a collection releases it from the negative side.
      const pillIds = new Set(
        (menuFilters ?? [])
          .filter((entry) => entry.folderId === folderId)
          .map((entry) => entry._id as string),
      );
      if (pillIds.size > 0) {
        setExcludedFilters((prev) => prev.filter((entry) => !pillIds.has(entry)));
      }
      setSelectedFolderId((current) => (current === folderId ? null : folderId));
    },
    [menuFilters],
  );

  const handleClearAll = () => {
    setSelectedTags([]);
    setExcludedFilters([]);
    setBookmarksOnly(false);
  };
  // Clears EVERYTHING hasFilters counts — including the search/semantic mode.
  // (The empty state's "clear all filters" used to leave the search active,
  // so the button appeared broken on zero-result searches.)
  const handleClearFilters = () => {
    setSelectedTags([]);
    setExcludedFilters([]);
    setBookmarksOnly(false);
    setSelectedFolderId(null);
    setSelectedModelName(null);
    setMediaKind(null);
    setLikedOnly(false);
    setAssetSearchQuery("");
    setDebouncedAssetSearchQuery("");
    setSemanticMode(null);
    setSemanticResults(null);
    setSemanticError(undefined);
    setSemanticLoading(false);
  };
  // Content-type filter: Image / Video are mutually exclusive asset kinds.
  const handleMediaKindChange = useCallback((next: "image" | "video" | null) => {
    setMediaKind(next);
  }, []);
  const handleLikedOnlyChange = useCallback((next: boolean) => {
    setLikedOnly(next);
  }, []);
  const clearSemanticMode = useCallback(() => {
    setAssetSearchQuery("");
    setDebouncedAssetSearchQuery("");
    setSemanticMode(null);
    setSemanticResults(null);
    setSemanticError(undefined);
    setSemanticLoading(false);
  }, []);

  const lexicalFilteredAssets = useMemo(() => {
    const search = assetSearchQuery.trim().toLowerCase();
    let result = bookmarksOnly
      ? baseGalleryAssets.filter((asset) => Boolean(asset.bookmark))
      : baseGalleryAssets;
    if (search) {
      result = result.filter((asset) =>
        buildAssetSearchHaystack(asset, folderNameById).includes(search),
      );
    }
    return result;
  }, [assetSearchQuery, baseGalleryAssets, bookmarksOnly, folderNameById]);

  const filteredSemanticResults = useMemo(() => {
    if (!semanticResults) {
      return semanticResults;
    }

    return semanticResults.filter((asset) => {
      if (
        galleryScope === "mine" &&
        effectiveSelectedFolderId &&
        !activeSmartCollectionFilter &&
        !(asset.folderIds ?? (asset.folderId ? [asset.folderId] : []))
          .includes(effectiveSelectedFolderId as Id<"folders">)
      ) {
        return false;
      }
      if (
        styleShelfFilterId &&
        !filterAssetsToStyle([asset], styleShelfFilterId).length
      ) {
        return false;
      }
      if (selectedModelName && asset.modelName !== selectedModelName) {
        return false;
      }
      if (mediaKind && asset.kind !== mediaKind) {
        return false;
      }
      // Same predicate the grid queries run: every selected pill must match,
      // and nothing excluded may survive.
      if (
        selectedTagIdGroups &&
        !selectedTagIdGroups.every((group) =>
          asset.tagIds.some((tagId: Id<"tags">) => group.includes(tagId)),
        )
      ) {
        return false;
      }
      if (
        excludedTagIds &&
        asset.tagIds.some((tagId: Id<"tags">) => excludedTagIds.includes(tagId))
      ) {
        return false;
      }
      if (excludedFolderIds) {
        const folderIds: string[] =
          asset.folderIds ?? (asset.folderId ? [asset.folderId] : []);
        if (
          folderIds.some((folderId) =>
            excludedFolderIds.includes(folderId as Id<"folders">),
          )
        ) {
          return false;
        }
      }
      return true;
    });
  }, [
    activeSmartCollectionFilter,
    effectiveSelectedFolderId,
    excludedFolderIds,
    excludedTagIds,
    galleryScope,
    mediaKind,
    selectedModelName,
    selectedTagIdGroups,
    semanticResults,
    styleShelfFilterId,
  ]);

  const displayGalleryAssets =
    filteredSemanticResults !== null
      ? filteredSemanticResults
      : lexicalFilteredAssets;

  const baseImages = useMemo(() => {
    if (!displayGalleryAssets) return [];
    const entries = buildGalleryEntries({
      assets: displayGalleryAssets,
      hiddenAssetIds,
      loadedAssetIds: loadedImageIdsRef.current,
      // Search results arrive ranked by relevance; the NEWEST / FEATURED /
      // SHUFFLE sorts apply to browsing, not to a search.
      sortOrder: filteredSemanticResults !== null ? "relevance" : sortOrder,
      shuffleSeed,
      // Only the FEATURED sort floats starred pieces. Semantic results are
      // already ordered by score, so a star never jumps the queue there.
      promoteStarred: featuredFirst && filteredSemanticResults === null,
      flattenStacks,
    });
    // Under the Bookmarks pill a post shows once, however many of its images
    // are saved as separate pieces; the card counts the rest ("+3") and the
    // detail panel shows them all.
    const seenPosts = new Set<string>();
    const visibleEntries = bookmarkFilterOn
      ? entries.filter((entry) => {
          if (!entry.bookmark) return true;
          if (seenPosts.has(entry.bookmark._id)) return false;
          seenPosts.add(entry.bookmark._id);
          return true;
        })
      : entries;
    return visibleEntries.map((entry) => {
      const badges = resolveEntryBadges(entry);
      const postCard = entry.postCard || (bookmarkFilterOn && Boolean(entry.bookmark));
      const previewImages = entry.previewImages.map((preview) => ({
        ...preview,
        ...(resolveEntryBadges(preview) ?? {}),
      }));
      return { ...entry, ...(badges ?? {}), previewImages, postCard };
    });
  }, [
    bookmarkFilterOn,
    displayGalleryAssets,
    featuredFirst,
    filteredSemanticResults,
    hiddenAssetIds,
    resolveEntryBadges,
    sortOrder,
    shuffleSeed,
    flattenStacks,
  ]);

  // Skill cards only join the grid in the default browse state: they are
  // inserts, not assets, so any asset filter hides them and the Skills view
  // stays the place to browse them all. Storybooks never join the grid; they
  // live in the Storybooks tab.
  const showSkillCards =
    includeSkills &&
    galleryScope === "mine" &&
    viewMode === "grid" &&
    !effectiveSelectedFolderId &&
    !selectedModelName &&
    !mediaKind &&
    !likedOnly &&
    !menuFilterActive &&
    !semanticMode &&
    !assetSearchQuery.trim();

  // Skills filed in the collection being browsed sit among its pieces.
  const folderSkills = useQuery(
    api.skills.listSkills,
    canAccessMyGallery && galleryScope === "mine" && effectiveSelectedFolderId
      ? {
          ownerUserId,
          folderId: effectiveSelectedFolderId as Id<"folders">,
          previewLimit: 8,
        }
      : "skip",
  );
  const showFolderSkillCards =
    includeSkills &&
    galleryScope === "mine" &&
    viewMode === "grid" &&
    Boolean(effectiveSelectedFolderId) &&
    !selectedModelName &&
    !mediaKind &&
    !likedOnly &&
    !menuFilterActive &&
    !semanticMode &&
    !assetSearchQuery.trim();

  const skillIds = useMemo(
    () =>
      new Set<string>([
        ...(gridSkills ?? []).map((skill) => String(skill._id)),
        ...(folderSkills ?? []).map((skill) => String(skill._id)),
      ]),
    [folderSkills, gridSkills],
  );

  const skillEntries = useMemo<GalleryEntry[]>(() => {
    const source = showFolderSkillCards ? folderSkills : gridSkills;
    if (!source || source.length === 0) return [];
    return source.map(skillCardToEntry);
  }, [folderSkills, gridSkills, showFolderSkillCards]);

  const shelfBooks = useMemo<ShelfBook[]>(
    () =>
      (storybooks ?? []).map((storybook) => {
        // A storybook inside a world reads "WORLD · Title" on the shelf.
        const world = storybookWorldById.get(storybook._id as string);
        return {
        id: storybook._id as string,
        name: world ? `${world.name} · ${storybook.name}` : storybook.name,
        story: storybook.story,
        count: storybook.count,
        previews: storybook.previewAssets.map((preview) => ({
          src: preview.thumbUrl ?? preview.url ?? "/placeholder.svg",
          kind: preview.kind,
        })),
        };
      }),
    [storybookWorldById, storybooks],
  );

  // Child collections as stack entries, split by display group: grouped
  // children render under their group headings above the grid; the rest
  // lead the grid as before.
  // In a style branch the world's shelves stand in for children, counted from
  // the branch's loaded pieces.
  const styleShelfStacks = useMemo(() => {
    if (!styleBranchStacksActive || !worldStyleScope) return null;
    return buildStyleShelfStacks(worldStyleScope.shelves, galleryAssets ?? []).map(
      ({ shelf, count, previews }) => ({
        _id: shelf._id,
        name: shelf.name,
        description: shelf.description,
        group: shelf.group,
        sortOrder: shelf.sortOrder,
        count,
        updatedAt: undefined as number | undefined,
        createdAt: undefined as number | undefined,
        previewAssets: previews.map((asset) => ({
          assetId: String(asset._id),
          kind: asset.kind,
          contentType: asset.contentType,
          url: asset.url,
          thumbUrl: asset.thumbUrl,
          width: asset.width,
          height: asset.height,
          thumbWidth: asset.thumbWidth,
          thumbHeight: asset.thumbHeight,
        })),
      }),
    );
  }, [galleryAssets, styleBranchStacksActive, worldStyleScope]);
  const stackCollections = styleShelfStacks ?? childCollectionStacks;
  // The world's storybooks stack beside its folders (not in a style branch,
  // whose stacks are the world's shelves).
  const storybookChildStacks = useMemo(
    () =>
      showChildCollectionStacks &&
      !styleBranchStacksActive &&
      effectiveSelectedFolderId &&
      childCollectionStacks !== undefined
        ? (storybookChildrenByWorld.get(effectiveSelectedFolderId as string) ?? [])
        : [],
    [
      childCollectionStacks,
      effectiveSelectedFolderId,
      showChildCollectionStacks,
      storybookChildrenByWorld,
      styleBranchStacksActive,
    ],
  );

  const { childCollectionEntries, groupedChildSections } = useMemo(() => {
    const stacks = [
      ...(stackCollections ?? []).map((collection) => ({ ...collection, storybook: false })),
      ...storybookChildStacks.map((book) => ({ ...book, storybook: true })),
    ];
    if (stacks.length === 0) {
      return {
        childCollectionEntries: [] as GalleryEntry[],
        groupedChildSections: [] as { key: string; label: string; entries: GalleryEntry[] }[],
      };
    }
    const toEntry = (
      collection: (typeof stacks)[number],
    ): GalleryEntry => {
      const previews = collection.previewAssets.map((preview) => ({
        id: preview.assetId,
        galleryItemId: preview.assetId,
        galleryItemType: "asset" as const,
        src: preview.thumbUrl ?? preview.url ?? "/placeholder.svg",
        fullSrc: preview.url ?? preview.thumbUrl ?? "/placeholder.svg",
        prompt: collection.name,
        width: preview.thumbWidth ?? preview.width,
        height: preview.thumbHeight ?? preview.height,
        kind: preview.kind,
        contentType: preview.contentType,
      }));
      const cover = previews[0];
      return {
        id: `collection:${collection._id}`,
        galleryItemId: collection._id as string,
        galleryItemType: collection.storybook ? ("storybook" as const) : ("collection" as const),
        src: cover?.src ?? "/placeholder.svg",
        fullSrc: cover?.fullSrc ?? "/placeholder.svg",
        prompt: collection.name,
        author: collection.storybook ? "Storybook" : "Collection",
        likes: 0,
        width: cover?.width,
        height: cover?.height,
        kind: cover?.kind,
        contentType: cover?.contentType,
        description: collection.description,
        createdAt: collection.updatedAt ?? collection.createdAt,
        storybookCount: collection.count,
        previewImages: previews,
      };
    };
    const { groups, ungrouped } = groupChildCollections(stacks);
    return {
      childCollectionEntries: ungrouped.map(toEntry),
      groupedChildSections: groups.map((group) => ({
        key: group.key,
        label: group.label,
        entries: group.members.map(toEntry),
      })),
    };
  }, [stackCollections, storybookChildStacks]);

  const childCollectionIds = useMemo(
    () =>
      showChildCollectionStacks
        ? new Set<string>(
            styleBranchStacksActive && worldStyleScope
              ? worldStyleScope.shelves.map((shelf) => shelf._id)
              : [
                  ...(childCollectionStacks ?? []).map((collection) =>
                    String(collection._id),
                  ),
                  ...storybookChildStacks.map((book) => book._id),
                ],
          )
        : null,
    [
      childCollectionStacks,
      storybookChildStacks,
      showChildCollectionStacks,
      styleBranchStacksActive,
      worldStyleScope,
    ],
  );

  const gridEntries = useMemo(() => {
    const childCollections = showChildCollectionStacks
      ? childCollectionEntries
      : [];
    const assetTiles = baseImages.filter((image) => {
      if (!childCollectionIds || !("folderIds" in image)) return true;
      return !(image.folderIds ?? []).some((folderId) =>
        childCollectionIds.has(folderId),
      );
    });
    // Skill cards sit among the tiles by date, not on a shelf above them:
    // an insert saved yesterday belongs next to yesterday's other work. Under
    // any other sort they trail the tiles rather than fake a position.
    const availableSkillCards =
      showSkillCards || showFolderSkillCards ? skillEntries : [];
    const skillCards = anyPaginationActive
      ? reachedGalleryInserts(
          availableSkillCards,
          activePagedAssets.results,
          activePagedAssets.status === "Exhausted",
          !folderPaginationActive,
        )
      : availableSkillCards;
    const mixed =
      skillCards.length === 0
        ? assetTiles
        : sortOrder === "newest"
          ? [...assetTiles, ...skillCards].sort(
              (left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0),
            )
          : [...assetTiles, ...skillCards];
    // A collection's folders lead the grid when browsing one — shelves, not
    // dated assets.
    const ordered =
      childCollections.length > 0 ? [...childCollections, ...mixed] : mixed;
    // Under the FEATURED sort a star outranks a shelf: featured pieces take
    // the very top, above the collection stacks. Any other sort
    // leaves them where the date puts them.
    // buildGalleryEntries already ordered the starred ones among themselves.
    if (!featuredFirst) return ordered;
    const starredLead = ordered.filter((entry) => "starredAt" in entry && entry.starredAt);
    if (starredLead.length === 0) return ordered;
    return [
      ...starredLead,
      ...ordered.filter((entry) => !("starredAt" in entry && entry.starredAt)),
    ];
  }, [
    baseImages,
    featuredFirst,
    showSkillCards,
    showFolderSkillCards,
    skillEntries,
    sortOrder,
    showChildCollectionStacks,
    childCollectionIds,
    childCollectionEntries,
    anyPaginationActive,
    activePagedAssets.results,
    activePagedAssets.status,
    folderPaginationActive,
  ]);

  const gridInsertsLoading =
    (showSkillCards && gridSkills === undefined) ||
    (showFolderSkillCards && folderSkills === undefined);
  const images = useGalleryStream(
    gridEntries,
    anyPaginationActive && filteredSemanticResults === null && !gridInsertsLoading
      ? JSON.stringify([
          ownerUserId, galleryScope, effectiveSelectedFolderId, sortOrder,
          selectedModelName, mediaKind, likedOnly, includeSkills, flattenStacks,
          assetSearchQuery, showChildCollectionStacks,
          selectedTagIdGroups, excludedTagIds, excludedFolderIds, bookmarksOnly,
          styleShelfFilterId,
        ])
      : null,
  );

  // Group similar: clusters of near-identical images by perceptual hash.
  // Hashes load only while the view option is on.
  const [groupSimilar, setGroupSimilar] = useState(false);
  const [similarity, setSimilarity] = useState(DEFAULT_SIMILARITY);
  const assetHashes = useQuery(
    api.assetHashes.listAssetHashes,
    groupSimilar && canAccessMyGallery && convexSignedIn ? { ownerUserId } : "skip",
  );
  const similarView = useMemo(() => {
    if (!groupSimilar || !assetHashes) return null;
    const hashById = new Map(assetHashes.map((row) => [row.a as string, row.h]));
    const items = images.map((image) => ({ id: image.id, hash: hashById.get(image.id) ?? "" }));
    return {
      clusters: clusterByHash(items, similarityToDistance(similarity)),
      hashedCount: items.filter((item) => item.hash).length,
    };
  }, [assetHashes, groupSimilar, images, similarity]);
  // The open world (the root of the open collection): its Inbox gets
  // duplicates cards sent from a cluster.
  const similarWorld = useMemo(() => {
    const open = (folders ?? []).find((folder) => folder._id === effectiveSelectedFolderId);
    const root = open?.parentFolderId ? (folders ?? []).find((folder) => folder._id === open.parentFolderId) : open;
    return root && root.kind === undefined ? { id: root._id as string, name: root.name } : undefined;
  }, [effectiveSelectedFolderId, folders]);

  // Sparse filters can produce many empty source pages, and child stacks or
  // lexical search can hide every loaded tile. No tile means no scroll
  // sentinel, so advance until a visible match or source exhaustion. Never
  // declare an empty first page to be "no matches".
  const pagedFrontierEmpty = anyPaginationActive &&
    filteredSemanticResults === null && images.length === 0 &&
    (activePagedAssets.status === "CanLoadMore" || activePagedAssets.status === "LoadingMore");
  useEffect(() => {
    if (pagedFrontierEmpty && activePagedAssets.status === "CanLoadMore") {
      activePagedAssets.loadMore(60);
    }
  }, [pagedFrontierEmpty, activePagedAssets]);

  // Every selectable (plain asset) entry currently in the grid — the target
  // set for the bulk toolbar's SELECT ALL.
  const allVisibleAssetIds = useMemo(
    () =>
      images
        .filter(
          (image) =>
            image.galleryItemType === "asset" ||
            image.galleryItemType === undefined,
        )
        .map((image) => image.id),
    [images],
  );
  // Mirrors allVisibleAssetIds for the shift-range handler, which is declared
  // earlier in the component than the memo it needs.
  selectableAssetIdsRef.current = allVisibleAssetIds;

  // While choosing for a moodboard: what can still be added, and what is
  // picked (the board's own pieces never count).
  const pickSelectableIds = useMemo(
    () => moodboardPick ? allVisibleAssetIds.filter((id) => !pickOnBoardIds.has(id)) : [],
    [allVisibleAssetIds, moodboardPick, pickOnBoardIds],
  );
  const pickSelectedIds = useMemo(
    () => moodboardPick ? Array.from(selectedAssetIds).filter((id) => !pickOnBoardIds.has(id)) : [],
    [moodboardPick, pickOnBoardIds, selectedAssetIds],
  );

  const selectAllVisibleAssets = useCallback(() => {
    if (bulkDeletingRef.current || bulkLikingRef.current) return;
    setSelectedAssetIds(new Set(allVisibleAssetIds));
  }, [allVisibleAssetIds]);

  const deleteSelectedAssets = useCallback(async () => {
    if (
      !canDeleteInCurrentView || bulkDeletingRef.current || bulkLikingRef.current || deletingAssetId ||
      bulkActionLoading || bulkCurationLoading || bulkAddBusy
    ) return;
    // Snapshot the exact selection before confirmation; later grid updates must
    // never expand the destructive operation to a new set of assets.
    const ids = Array.from(selectedAssetIds);
    if (ids.length === 0) return;
    if (!window.confirm(
      `Permanently delete ${ids.length} selected asset${ids.length === 1 ? "" : "s"} and their stored files from Gallery? This removes them from every collection and cannot be undone.`,
    )) return;

    bulkDeletingRef.current = true;
    setBulkActionLoading(true);
    setBulkDeleteProgress({ completed: 0, total: ids.length });
    setBulkCurationError(undefined);
    setBulkCurationStatus(undefined);
    try {
      const results = await deleteAssetSelection(ids, {
        onResult: (result, completed, total) => {
          setBulkDeleteProgress({ completed, total });
          if (!result.ok) return;
          loadedImageIdsRef.current.delete(result.assetId);
          setHiddenAssetIds((current) => new Set([...current, result.assetId]));
          setSelectedAssetIds((current) => {
            const next = new Set(current);
            next.delete(result.assetId);
            return next;
          });
        },
      });
      const failed = results.filter((result) => !result.ok);
      const deletedCount = results.length - failed.length;
      const message = `Deleted ${deletedCount} asset${deletedCount === 1 ? "" : "s"}.`;
      setBulkDeleteNotice({
        title: message,
        message: failed.length ? `${failed.length} failed and remain selected for retry.` : undefined,
        type: failed.length ? "warning" : "success",
        at: Date.now(),
      });
      if (failed.length) {
        setBulkCurationError(`${message} ${failed.length} failed and remain selected. ${failed[0]!.error}`);
      }
    } finally {
      bulkDeletingRef.current = false;
      setBulkDeleteProgress(null);
      setBulkActionLoading(false);
    }
  }, [
    canDeleteInCurrentView, deletingAssetId, bulkActionLoading, bulkCurationLoading,
    bulkAddBusy, selectedAssetIds,
  ]);

  const likeSelectedAssets = useCallback(async (isLiked: boolean) => {
    if (
      !canManageFoldersInCurrentView || bulkLikingRef.current || bulkDeletingRef.current ||
      deletingAssetId || bulkActionLoading || bulkCurationLoading || bulkAddBusy
    ) return;
    const ids = Array.from(selectedAssetIds);
    if (!ids.length) return;
    bulkLikingRef.current = true;
    setBulkActionLoading(true);
    setBulkLikeState(isLiked);
    setBulkCurationError(undefined);
    setBulkCurationStatus(undefined);
    try {
      const { updatedIds, failures } = await setAssetSelectionLiked(ids, isLiked,
        (assetId, liked) => setAssetLikedMutation({ ownerUserId, assetId: assetId as Id<"assets">, isLiked: liked }),
        (assetId) => {
          setSelectedImage((current) => current?.id === assetId ? { ...current, isLiked } : current);
        },
      );
      if (failures.length) {
        // Retain failures even when successful unlike operations disappear from
        // a favourites-only grid, so retry never silently loses the remainder.
        setSelectedAssetIds(new Set(failures.map((failure) => failure.assetId)));
        setBulkCurationError(`${updatedIds.length} updated. ${failures.length} failed and remain selected. ${failures[0]!.error}`);
      } else {
        setBulkCurationStatus(`${isLiked ? "Liked" : "Unliked"} ${updatedIds.length} asset${updatedIds.length === 1 ? "" : "s"}.`);
      }
    } finally {
      bulkLikingRef.current = false;
      setBulkLikeState(null);
      setBulkActionLoading(false);
    }
  }, [canManageFoldersInCurrentView, deletingAssetId, bulkActionLoading, bulkCurationLoading,
    bulkAddBusy, selectedAssetIds, setAssetLikedMutation, ownerUserId]);

  // PUBLISH ALL lives under the toolbar's MANAGE menu, behind a dialog that
  // counts the view's private pieces on the server (the grid only knows the
  // cards it has loaded) and publishes exactly those.
  const [publishAllOpen, setPublishAllOpen] = useState(false);
  const [publishAllNotice, setPublishAllNotice] = useState<{ text: string; error: boolean } | null>(null);
  const privateCountArgs = useMemo<PrivateCountArgs | null>(() => {
    if (!canCuratePublic || galleryScope !== "mine" || !canAccessMyGallery) return null;
    return {
      ownerUserId,
      kind: mediaKind ?? undefined,
      onlyLiked: likedOnly || undefined,
      tagIdGroups: selectedTagIdGroups,
      excludeTagIds: excludedTagIds,
      excludeFolderIds: excludedFolderIds,
      folderId: effectiveSelectedFolderId && !activeSmartCollectionFilter
        ? (effectiveSelectedFolderId as Id<"folders">) : undefined,
      includeDescendants: browsingWorldFolder || undefined,
      modelName: selectedModelName ?? undefined,
      skipHiddenCollections: !effectiveSelectedFolderId || undefined,
    };
  }, [
    activeSmartCollectionFilter, browsingWorldFolder, canAccessMyGallery, canCuratePublic,
    effectiveSelectedFolderId, excludedFolderIds, excludedTagIds, galleryScope, likedOnly,
    mediaKind, ownerUserId, selectedModelName, selectedTagIdGroups,
  ]);
  const publishAllFiltered = Boolean(
    menuFilterActive || mediaKind || likedOnly || selectedModelName || activeSmartCollectionFilter,
  );
  const handlePublished = useCallback((outcome: PublishAllOutcome) => {
    const published = new Set(outcome.assetIds);
    setSelectedImage((current) =>
      current && published.has(current.id) ? { ...current, isPublic: true } : current,
    );
    const made = `${outcome.updatedCount.toLocaleString("en-US")} piece${outcome.updatedCount === 1 ? "" : "s"} made public`;
    const skipped = outcome.skippedCount > 0 ? ` (${outcome.skippedCount} skipped)` : "";
    setPublishAllNotice({
      text: outcome.error ? `${made}${skipped}, then: ${outcome.error}` : `${made}${skipped}.`,
      error: Boolean(outcome.error),
    });
  }, []);

  const downloadSelectedAssets = useCallback(async () => {
    if (bulkActionLoading) return;
    const ids = Array.from(selectedAssetIds);
    if (ids.length === 0) return;

    const byId = new Map(images.map((image) => [image.id, image]));
    const targets = ids
      .map((id) => byId.get(id))
      .filter((image): image is (typeof images)[number] => Boolean(image));
    if (targets.length === 0) {
      setBulkCurationError("Selected assets are not in the current view.");
      return;
    }

    const zipItems = targets
      .map((image) => {
        const kind = "kind" in image ? image.kind : undefined;
        const contentType =
          "contentType" in image && typeof image.contentType === "string"
            ? image.contentType
            : undefined;
        const isImage =
          kind === "video" || contentType?.startsWith("video/") ? false : true;
        return {
          // Fetch through the authenticated same-origin proxy. R2/CDN URLs do
          // not expose CORS headers, so fetching image.fullSrc directly makes
          // every item in a browser-created ZIP fail.
          url: assetDownloadHref(image.id),
          name: image.id,
          isImage,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    if (zipItems.length === 0) {
      setBulkCurationError("Selected assets have no downloadable files.");
      return;
    }

    setBulkActionLoading(true);
    setBulkCurationError(undefined);
    setBulkCurationStatus(undefined);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const { zipped, failed } = await downloadImagesAsZip(
        zipItems,
        `laniameda-gallery-${stamp}-${zipItems.length}.zip`,
      );
      const failedSuffix = failed > 0 ? ` (${failed} failed)` : "";
      setBulkCurationStatus(
        `Zipped ${zipped} file${zipped === 1 ? "" : "s"} as JPG${failedSuffix}.`,
      );
    } catch (error) {
      setBulkCurationError(
        error instanceof Error ? error.message : "Download failed.",
      );
    } finally {
      setBulkActionLoading(false);
    }
  }, [bulkActionLoading, images, selectedAssetIds]);

  const moveAssetsToFolder = useCallback(
    async (folderId: string, assetIds: string[]) => {
      if (bulkActionLoading) return;
      if (assetIds.length === 0) return;

      setBulkActionLoading(true);
      setBulkCurationError(undefined);
      setBulkCurationStatus(undefined);
      try {
        // Move relocates the asset among PLAIN collections only. Storybook
        // memberships are an orthogonal overlay and survive a move — replacing the full set here used to silently strip them.
        const plainCollectionIds = new Set(
          collectionFoldersWithCounts.map((folder) => String(folder._id)),
        );
        const imageById = new Map(images.map((image) => [image.id, image]));
        let moved = 0;
        for (const assetId of assetIds) {
          const image = imageById.get(assetId);
          const currentFolderIds: string[] =
            image && "folderIds" in image && Array.isArray(image.folderIds)
              ? image.folderIds
              : image && "folderId" in image && image.folderId
                ? [image.folderId]
                : [];
          const keptFolderIds = currentFolderIds.filter(
            (id) => !plainCollectionIds.has(id) && id !== folderId,
          );
          await setAssetFoldersMutation({
            ownerUserId,
            assetId: assetId as Id<"assets">,
            folderIds: [folderId, ...keptFolderIds] as Id<"folders">[],
          });
          moved += 1;
        }
        const destName = folderNameById.get(folderId) ?? "collection";
        const impliedAssetType = assetTypeTagForCollectionName(destName);
        if (
          impliedAssetType === "character" ||
          impliedAssetType === "location" ||
          impliedAssetType === "scene"
        ) {
          await bulkAssignAssetTypeMutation({
            ownerUserId,
            assetIds: assetIds.map((assetId) => assetId as Id<"assets">),
            assetType: impliedAssetType,
          });
        }
        setMoveStatus({
          text: `Moved ${moved} asset${moved === 1 ? "" : "s"} to ${destName}`,
        });
        setSelectedAssetIds((prev) => {
          if (prev.size === 0) return prev;
          const next = new Set(prev);
          for (const assetId of assetIds) next.delete(assetId);
          return next;
        });
      } catch (error) {
        setMoveStatus({
          text: error instanceof Error ? error.message : "Move failed.",
          error: true,
        });
      } finally {
        setBulkActionLoading(false);
      }
    },
    [
      bulkActionLoading,
      bulkAssignAssetTypeMutation,
      collectionFoldersWithCounts,
      folderNameById,
      images,
      ownerUserId,
      setAssetFoldersMutation,
    ],
  );

  // The bulk picker is a membership checklist. Counts are scoped to the
  // current selection: all = checked, some = mixed, none = unchecked.
  const selectedAssetMemberships = useMemo(() => {
    const imageById = new Map(images.map((image) => [image.id, image]));
    return Array.from(selectedAssetIds).flatMap((assetId) => {
      const image = imageById.get(assetId);
      if (
        !image ||
        (image.galleryItemType !== "asset" &&
          image.galleryItemType !== undefined)
      ) {
        return [];
      }
      const folderIds =
        "folderIds" in image && Array.isArray(image.folderIds)
          ? image.folderIds
          : "folderId" in image && image.folderId
            ? [image.folderId]
            : [];
      return [{ assetId, folderIds: Array.from(new Set(folderIds)) }];
    });
  }, [images, selectedAssetIds]);

  const selectedFolderMembershipCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const asset of selectedAssetMemberships) {
      for (const folderId of asset.folderIds) {
        counts.set(folderId, (counts.get(folderId) ?? 0) + 1);
      }
    }
    return counts;
  }, [selectedAssetMemberships]);

  // Take the selected pieces out of one collection: only the members leave,
  // and every other membership stays.
  const removeSelectedFromFolder = useCallback(
    async (folderId: string) => {
      const targets = selectedAssetMemberships.filter((asset) =>
        asset.folderIds.includes(folderId),
      );
      if (targets.length === 0 || bulkAddBusy) return;
      setBulkAddBusy(true);
      try {
        await Promise.all(
          targets.map((asset) =>
            setAssetFoldersMutation({
              ownerUserId,
              assetId: asset.assetId as Id<"assets">,
              folderIds: asset.folderIds
                .filter((id) => id !== folderId)
                .map((id) => id as Id<"folders">),
            }),
          ),
        );
        setMoveStatus({
          text: `Removed ${targets.length} from ${
            folderNameById.get(folderId) ?? "collection"
          }`,
        });
      } catch (error) {
        setMoveStatus({
          text: error instanceof Error ? error.message : "Remove failed.",
          error: true,
        });
        throw error;
      } finally {
        setBulkAddBusy(false);
      }
    },
    [
      bulkAddBusy,
      folderNameById,
      ownerUserId,
      selectedAssetMemberships,
      setAssetFoldersMutation,
    ],
  );

  const toggleSelectedFolder = useCallback(
    async (folderId: string, folderNameOverride?: string) => {
      if (selectedAssetMemberships.length === 0 || bulkAddBusy) return;
      const membershipCount =
        selectedFolderMembershipCounts.get(folderId) ?? 0;
      const shouldRemove =
        membershipCount === selectedAssetMemberships.length;
      const targets = selectedAssetMemberships.filter((asset) =>
        shouldRemove
          ? asset.folderIds.includes(folderId)
          : !asset.folderIds.includes(folderId),
      );
      if (targets.length === 0) return;

      setBulkAddBusy(true);
      try {
        if (shouldRemove) {
          await Promise.all(
            targets.map((asset) =>
              setAssetFoldersMutation({
                ownerUserId,
                assetId: asset.assetId as Id<"assets">,
                folderIds: asset.folderIds
                  .filter((id) => id !== folderId)
                  .map((id) => id as Id<"folders">),
              }),
            ),
          );
        } else {
          await Promise.all(
            targets.map((asset) =>
              addAssetFoldersMutation({
                ownerUserId,
                assetId: asset.assetId as Id<"assets">,
                folderIds: [folderId as Id<"folders">],
              }),
            ),
          );
          const impliedAssetType = assetTypeTagForCollectionName(
            folderNameOverride ?? folderNameById.get(folderId),
          );
          if (
            impliedAssetType === "character" ||
            impliedAssetType === "location" ||
            impliedAssetType === "scene"
          ) {
            await bulkAssignAssetTypeMutation({
              ownerUserId,
              assetIds: targets.map((target) =>
                target.assetId as Id<"assets">,
              ),
              assetType: impliedAssetType,
            });
          }
        }
        const targetName =
          folderNameOverride ??
          folderNameById.get(folderId) ??
          "collection";
        setMoveStatus({
          text: shouldRemove
            ? `Removed ${targets.length} from ${targetName}`
            : `Added ${targets.length} to ${targetName}`,
        });
      } catch (error) {
        setMoveStatus({
          text:
            error instanceof Error
              ? error.message
              : shouldRemove
                ? "Remove failed."
                : "Add failed.",
          error: true,
        });
      } finally {
        setBulkAddBusy(false);
      }
    },
    [
      addAssetFoldersMutation,
      bulkAddBusy,
      bulkAssignAssetTypeMutation,
      folderNameById,
      ownerUserId,
      selectedAssetMemberships,
      selectedFolderMembershipCounts,
      setAssetFoldersMutation,
    ],
  );

  // Per-card collection controls (gallery grid): move replaces membership,
  // add keeps existing collections, remove drops a single membership.
  const moveAssetToFolder = useCallback(
    async (imageId: string, folderId: string) => {
      await moveAssetsToFolder(folderId, [imageId]);
    },
    [moveAssetsToFolder],
  );

  const copyAssetToFolder = useCallback(
    async (imageId: string, folderId: string) => {
      try {
        await addAssetFoldersMutation({
          ownerUserId,
          assetId: imageId as Id<"assets">,
          folderIds: [folderId as Id<"folders">],
        });
        const impliedAssetType = assetTypeTagForCollectionName(
          folderNameById.get(folderId),
        );
        if (
          impliedAssetType === "character" ||
          impliedAssetType === "location" ||
          impliedAssetType === "scene"
        ) {
          await bulkAssignAssetTypeMutation({
            ownerUserId,
            assetIds: [imageId as Id<"assets">],
            assetType: impliedAssetType,
          });
        }
        setMoveStatus({
          text: `Added to ${folderNameById.get(folderId) ?? "collection"}`,
        });
      } catch (error) {
        setMoveStatus({
          text: error instanceof Error ? error.message : "Add failed.",
          error: true,
        });
      }
    },
    [
      addAssetFoldersMutation,
      bulkAssignAssetTypeMutation,
      folderNameById,
      ownerUserId,
    ],
  );

  const removeAssetFromFolder = useCallback(
    async (imageId: string, folderId: string) => {
      const image = images.find((entry) => entry.id === imageId);
      // Gallery variants carry collection memberships or a primary folder.
      // Narrow safely before changing the media's filing.
      const currentFolderIds: string[] = image
        ? "folderIds" in image && Array.isArray(image.folderIds)
          ? image.folderIds
          : "folderId" in image && image.folderId
            ? [image.folderId]
            : []
        : [];
      try {
        await setAssetFoldersMutation({
          ownerUserId,
          assetId: imageId as Id<"assets">,
          folderIds: currentFolderIds.filter(
            (id) => id !== folderId,
          ) as Id<"folders">[],
        });
        setMoveStatus({
          text: `Removed from ${folderNameById.get(folderId) ?? "collection"}`,
        });
      } catch (error) {
        setMoveStatus({
          text: error instanceof Error ? error.message : "Remove failed.",
          error: true,
        });
      }
    },
    [folderNameById, images, ownerUserId, setAssetFoldersMutation],
  );

  // ── One-click exclude ──
  // Exclude drops the piece from the collection the grid is pointed at. The
  // flat gallery has no scope to leave, so no button there.
  const excludeScope = useMemo<
    { kind: "folder"; folderId: string; label: string } | null
  >(() => {
    if (!canManageFoldersInCurrentView) return null;
    if (effectiveSelectedFolderId && !activeSmartCollectionFilter) {
      return {
        kind: "folder",
        folderId: effectiveSelectedFolderId,
        label:
          folderNameById.get(effectiveSelectedFolderId) ?? "this collection",
      };
    }
    return null;
  }, [
    activeSmartCollectionFilter,
    canManageFoldersInCurrentView,
    effectiveSelectedFolderId,
    folderNameById,
  ]);

  const excludeAssetFromCurrentView = useCallback(
    async (imageId: string) => {
      if (!excludeScope) return;

      // Fade the tile first, then mutate — by the time the mutation resolves
      // the grid has already re-read without it, so the card leaves cleanly
      // instead of popping out mid-animation.
      setExitingAssetIds((previous) => {
        const next = new Set(previous);
        next.add(imageId);
        return next;
      });
      await new Promise((resolve) => setTimeout(resolve, 240));

      try {
        await removeAssetFolderMutation({
          ownerUserId,
          assetId: imageId as Id<"assets">,
          folderId: excludeScope.folderId as Id<"folders">,
        });
        setSelectedImage((current) =>
          current?.id === imageId ? null : current,
        );
        setSelectedAssetIds((current) => {
          if (!current.has(imageId)) return current;
          const next = new Set(current);
          next.delete(imageId);
          return next;
        });
        setMoveStatus({ text: `Removed from ${excludeScope.label}` });
      } catch (error) {
        setMoveStatus({
          text: error instanceof Error ? error.message : "Remove failed.",
          error: true,
        });
      } finally {
        setExitingAssetIds((previous) => {
          if (!previous.has(imageId)) return previous;
          const next = new Set(previous);
          next.delete(imageId);
          return next;
        });
      }
    },
    [
      excludeScope,
      ownerUserId,
      removeAssetFolderMutation,
    ],
  );

  // Per-card menu targets: plain collections (Move/Add) plus storybooks
  // (always additive).
  const cardCollections = useMemo(() => {
    // Worlds first, each root followed by its folders in their display-group
    // order, so the list reads as the same tree the sidebar shows.
    const ids = new Set(
      collectionFoldersWithCounts.map((folder) => folder._id as string),
    );
    const childrenByParent = new Map<string, typeof collectionFoldersWithCounts>();
    const roots: typeof collectionFoldersWithCounts = [];
    for (const folder of collectionFoldersWithCounts) {
      const parentId = folder.parentFolderId as string | undefined;
      if (parentId && ids.has(parentId)) {
        const list = childrenByParent.get(parentId) ?? [];
        list.push(folder);
        childrenByParent.set(parentId, list);
      } else {
        roots.push(folder);
      }
    }
    const rows = orderRootCollections(roots).flatMap((root) => {
      const world = isWorldCollection(root);
      return [
        {
          id: root._id as string,
          name: root.name,
          parentName: undefined as string | undefined,
          count: root.count,
          kind: "collection" as const,
          isWorld: world,
        },
        ...orderChildCollections(childrenByParent.get(root._id as string) ?? []).map(
          (child) => ({
            id: child._id as string,
            name: child.name,
            // Several parents each own a "Characters"/"Locations", so the row
            // has to say whose it is or the options are indistinguishable.
            parentName: root.name as string | undefined,
            count: child.count,
            kind: "collection" as const,
            isWorld: world,
          }),
        ),
      ];
    });
    return [
      ...rows,
      ...(storybooks ?? []).map((storybook) => ({
        id: storybook._id as string,
        name: storybook.name,
        parentName: storybookWorldById.get(storybook._id as string)?.name,
        count: storybook.count,
        kind: "storybook" as const,
        isWorld: false,
      })),
    ];
  }, [collectionFoldersWithCounts, storybookWorldById, storybooks]);

  // Auto-dismiss the move feedback chip.
  useEffect(() => {
    if (!moveStatus) return;
    const timer = window.setTimeout(() => setMoveStatus(null), 3200);
    return () => window.clearTimeout(timer);
  }, [moveStatus]);

  // Drag & drop: dragging a card exports the asset ids to move — the whole
  // selection when the dragged card is part of it, otherwise just that card.
  const handleAssetDragStart = useCallback(
    (event: React.DragEvent<HTMLDivElement>, imageId: string) => {
      const ids = selectedAssetIds.has(imageId)
        ? Array.from(selectedAssetIds)
        : [imageId];
      const assetIds = ids.filter((id) => {
        const image = images.find((entry) => entry.id === id);
        return (
          image !== undefined &&
          (image.galleryItemType === "asset" ||
            image.galleryItemType === undefined)
        );
      });
      if (assetIds.length === 0) return;
      writeAssetDragPayload(event.dataTransfer, assetIds);
      if (assetIds.length > 1) {
        const dragBadge = document.createElement("div");
        dragBadge.textContent = `${assetIds.length} ASSETS`;
        Object.assign(dragBadge.style, {
          position: "fixed",
          top: "-1000px",
          left: "-1000px",
          padding: "9px 13px",
          border: "2px solid #111",
          borderRadius: "12px",
          background: "#ff7a64",
          color: "#111",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: "11px",
          fontWeight: "800",
          letterSpacing: "0.1em",
          boxShadow: "0 12px 28px rgba(0,0,0,0.35)",
        });
        document.body.appendChild(dragBadge);
        event.dataTransfer.setDragImage(dragBadge, 58, 20);
        window.setTimeout(() => dragBadge.remove(), 0);
      }
      // Reveal the sorting panel the moment a drag starts, so there is always
      // somewhere to drop without hunting for a button first.
      setAddToPanelOpen(true);
    },
    [images, selectedAssetIds],
  );

  // Dropping on a collection ADDS membership, exactly like storybooks below —
  // every drop target in the sidebar behaves the same.
  // Moving (which removes other collection memberships) is only ever the
  // explicit Move action in the card menu, never a drag.
  const handleAssetsDropOnFolder = useCallback(
    async (
      folderId: string,
      assetIds: string[],
      classificationNameOverride?: string,
    ) => {
      if (assetIds.length === 0) return;
      try {
        await Promise.all(
          assetIds.map((assetId) =>
            addAssetFoldersMutation({
              ownerUserId,
              assetId: assetId as Id<"assets">,
              folderIds: [folderId as Id<"folders">],
            }),
          ),
        );
        const impliedAssetType = assetTypeTagForCollectionName(
          classificationNameOverride ?? folderNameById.get(folderId),
        );
        if (
          impliedAssetType === "character" ||
          impliedAssetType === "location" ||
          impliedAssetType === "scene"
        ) {
          await bulkAssignAssetTypeMutation({
            ownerUserId,
            assetIds: assetIds.map((assetId) => assetId as Id<"assets">),
            assetType: impliedAssetType,
          });
        }
        setMoveStatus({
          text: `Added ${assetIds.length} asset${assetIds.length === 1 ? "" : "s"} to ${folderNameById.get(folderId) ?? "collection"}`,
        });
      } catch (error) {
        setMoveStatus({
          text:
            error instanceof Error
              ? error.message
              : "Failed to add to collection.",
          error: true,
        });
      }
    },
    [
      addAssetFoldersMutation,
      bulkAssignAssetTypeMutation,
      folderNameById,
      ownerUserId,
    ],
  );

  // Dropping on a storybook ADDS membership (keeps existing collections) —
  // a storybook is a narrative overlay, not the asset's home.
  const handleAssetsDropOnStorybook = useCallback(
    async (storybookId: string, assetIds: string[]) => {
      if (assetIds.length === 0) return;
      try {
        await Promise.all(
          assetIds.map((assetId) =>
            addAssetFoldersMutation({
              ownerUserId,
              assetId: assetId as Id<"assets">,
              folderIds: [storybookId as Id<"folders">],
            }),
          ),
        );
        setMoveStatus({
          text: `Added ${assetIds.length} asset${assetIds.length === 1 ? "" : "s"} to ${folderNameById.get(storybookId) ?? "storybook"}`,
        });
      } catch (error) {
        setMoveStatus({
          text:
            error instanceof Error
              ? error.message
              : "Failed to add to storybook.",
          error: true,
        });
      }
    },
    [addAssetFoldersMutation, folderNameById, ownerUserId],
  );

  // ── "Move to" panel ──
  // One floating sorting surface: assign one exclusive asset type, then toggle
  // any number of collection memberships. The grid remains draggable behind
  // it, and a card drag opens it automatically.
  const selectedAssetIdList = useMemo(
    () => Array.from(selectedAssetIds),
    [selectedAssetIds],
  );

  // Cover thumbs for the panel's folder view, keyed by folder.
  const panelPreviewsByFolderId = useMemo(() => {
    const map = new Map<string, { thumbUrl?: string; url?: string }[]>();
    for (const summary of collectionSummaries ?? []) {
      map.set(summary._id, summary.previewAssets);
    }
    return map;
  }, [collectionSummaries]);

  const panelCollections = useMemo<PanelCollection[]>(
    () =>
      collectionFoldersWithCounts
        .map((folder) => ({
          id: folder._id,
          name: folder.name,
          description: folder.description ?? undefined,
          count: folder.count,
          parentId: folder.parentFolderId ?? undefined,
          isWorld: isWorldCollection(folder),
          pinned: Boolean(folder.pinnedAt),
          group: folder.group ?? undefined,
          sortOrder: folder.sortOrder ?? undefined,
          previews: panelPreviewsByFolderId.get(folder._id),
          selectedCount: selectedFolderMembershipCounts.get(folder._id) ?? 0,
        })),
    [
      collectionFoldersWithCounts,
      panelPreviewsByFolderId,
      selectedFolderMembershipCounts,
    ],
  );

  const addAssetsToFolder = useCallback(
    async (folderId: string, assetIds: string[]) => {
      if (assetIds.length === 0) return;
      await handleAssetsDropOnFolder(folderId, assetIds);
    },
    [handleAssetsDropOnFolder],
  );

  const createCollectionFromAssets = useCallback(
    async (name: string, assetIds: string[]) => {
      const folderId = await createFolder(name);
      if (folderId && assetIds.length > 0) {
        await handleAssetsDropOnFolder(folderId, assetIds);
      }
    },
    [createFolder, handleAssetsDropOnFolder],
  );

  // "New folder" inside a collection from the Move-to panel: create the
  // sub-collection, then file whatever was selected straight into it.
  const createSubCollectionFromAssets = useCallback(
    async (parentId: string, name: string, assetIds: string[]) => {
      const folderId = await createSubCollection(parentId, name);
      if (!folderId) return;
      if (assetIds.length > 0) {
        await handleAssetsDropOnFolder(folderId, assetIds);
      } else {
        setMoveStatus({ text: `Folder “${name.trim()}” created` });
      }
    },
    [createSubCollection, handleAssetsDropOnFolder],
  );

  const updateFolderDescription = useCallback(
    async (folderId: string, description: string) => {
      if (!ownerUserId) return;
      const folder = (folders ?? []).find((entry) => entry._id === folderId);
      if (!folder) return;
      await updateFolderMutation({
        ownerUserId,
        folderId: folderId as Id<"folders">,
        name: folder.name,
        description: description || undefined,
      });
    },
    [folders, ownerUserId, updateFolderMutation],
  );

  // ── Stable grid props ──
  // Every prop the masonry hands to a card must keep its identity across
  // dashboard re-renders, otherwise `memo(ImageCard)` never bails out and a
  // single state change (opening the detail view, a hover flag, a toast)
  // re-renders every mounted card. With a deep-scrolled grid that is 1000+
  // card renders on the same frame the expanded view is trying to fade in.
  const handleCardDelete = useCallback(
    (imageId: string) => {
      // A Skill card resolves to a native Skill, preserving legacy copied IDs.
      if (skillIds.has(imageId)) {
        setDeleteAssetError(undefined);
        void convex.query(api.skills.resolveSkillReference, {
          ownerUserId,
          id: imageId,
        }).then((id) => {
          if (!id) throw new Error("Skill not found");
          return deleteSkillMutation({ ownerUserId, id });
        }).catch((error: unknown) => {
          setDeleteAssetError(error instanceof Error ? error.message : "Failed to delete Skill");
        });
        return;
      }
      void deleteAsset(imageId);
    },
    [convex, deleteAsset, deleteSkillMutation, ownerUserId, skillIds],
  );

  const handleCardToggleLike = useCallback(
    (imageId: string, nextLiked: boolean) => {
      void toggleAssetLike(imageId, nextLiked);
    },
    [toggleAssetLike],
  );

  const handleCardToggleStar = useCallback(
    (imageId: string, nextStarred: boolean) => {
      void toggleAssetStar(imageId, nextStarred);
    },
    [toggleAssetStar],
  );

  const handleCardRemoveTag = useCallback(
    (imageId: string, tagName: string) => {
      void setAssetTagStateMutation({
        ownerUserId,
        assetId: imageId as Id<"assets">,
        tagName,
        present: false,
      });
    },
    [ownerUserId, setAssetTagStateMutation],
  );

  const handleCardCollectionOpen = useCallback((collectionId: string) => {
    setSelectedImage(null);
    setSelectedFolderId(collectionId);
  }, []);

  // Mark a root collection as a world (its root `group`): worlds lead the
  // sidebar, the Move-to panel and every card's collection menu.
  const handleToggleWorld = useCallback(
    async (folderId: string, next: boolean) => {
      const name = folderNameById.get(folderId) ?? "Collection";
      try {
        await updateFolderMutation({
          ownerUserId,
          folderId: folderId as Id<"folders">,
          group: next ? WORLD_GROUP : null,
        });
        setMoveStatus({
          text: next ? `${name} is now a world` : `${name} is a plain collection`,
        });
      } catch (error) {
        setMoveStatus({
          text:
            error instanceof Error ? error.message : "Could not update the world mark.",
          error: true,
        });
      }
    },
    [folderNameById, ownerUserId, updateFolderMutation],
  );

  // Rename any folder-backed sidebar row (collection / storybook).
  const handleRenameFolder = useCallback(
    async (folderId: string, name: string) => {
      try {
        await updateFolderMutation({
          ownerUserId,
          folderId: folderId as Id<"folders">,
          name,
        });
        setMoveStatus({ text: `Renamed to ${name}` });
      } catch (error) {
        setMoveStatus({
          text:
            error instanceof Error ? error.message : "Failed to rename.",
          error: true,
        });
      }
    },
    [ownerUserId, updateFolderMutation],
  );

  // Delete a folder-backed row. Assets always survive as gallery entries;
  // the backend clears the membership links and promotes any folders inside.
  const handleDeleteFolder = useCallback(
    async (folderId: string) => {
      const name = folderNameById.get(folderId) ?? "collection";
      try {
        await deleteFolderMutation({
          ownerUserId,
          folderId: folderId as Id<"folders">,
        });
        setSelectedFolderId((current) =>
          current === folderId ? null : current,
        );
        setOpenStorybookId((current) =>
          current === folderId ? null : current,
        );
        setMoveStatus({
          text: `Deleted ${name} — assets stay in the gallery`,
        });
      } catch (error) {
        setMoveStatus({
          text:
            error instanceof Error ? error.message : "Failed to delete.",
          error: true,
        });
      }
    },
    [ownerUserId, deleteFolderMutation, folderNameById],
  );

  const createFolderInActiveCollection = useCallback(
    async (name: string): Promise<boolean> => {
      if (!activeCollectionFolder || activeCollectionFolder.parentFolderId) {
        return false;
      }
      const folderId = await createSubCollection(
        activeCollectionFolder._id,
        name,
      );
      if (!folderId) return false;

      // An empty folder has no asset tile in the flattened view, so return to
      // the overview where its new stack is immediately visible.
      setExpandedCollectionId(null);
      setMoveStatus({
        text: `Folder “${name.trim()}” added to ${activeCollectionFolder.name}`,
      });
      return true;
    },
    [activeCollectionFolder, createSubCollection],
  );

  // Navigation helpers
  const currentImageIndex = useMemo(() => {
    if (!selectedImage) return -1;
    return images.findIndex(
      (img) => img.id === selectedImage.id,
    );
  }, [images, selectedImage]);

  const handleImageSelect = useCallback(
    (img: SelectedImage) => {
      // Choosing images for a moodboard: a click selects a piece, never
      // opens it. Pieces already on the board stay as they are.
      if (moodboardPickRef.current) {
        const isAsset =
          img.galleryItemType === "asset" || img.galleryItemType === undefined;
        if (!isAsset) return;
        if (pickOnBoardIdsRef.current.has(img.id)) {
          setMoodboardNotice({
            title: "Already on the board",
            message: moodboardPickRef.current.board.name,
            type: "warning",
            at: Date.now(),
          });
          return;
        }
        toggleAssetSelection(img.id);
        return;
      }
      // Skills open their dedicated scrollable document modal.
      if (img.galleryItemType === "skill") {
        setSelectedSkillId(img.id);
        return;
      }
      // Storybooks expand into their own modal (images + editable story).
      if (img.galleryItemType === "storybook") {
        setOpenStorybookId(img.galleryItemId ?? img.id);
        return;
      }
      // Cinema frames open the cinema popout (shared-layout animation), not the side panel.
      if (img.pillar === "cinema-inspiration") {
        const entry = images.find((candidate) => candidate.id === img.id);
        const meta =
          entry && "cinemaMetadata" in entry
            ? (entry as { cinemaMetadata?: CinemaModalAsset["metadata"] | null }).cinemaMetadata
            : undefined;
        setSelectedCinemaAsset({
          id: img.id,
          src: img.fullSrc,
          width: img.width,
          height: img.height,
          metadata: meta ?? null,
        });
        return;
      }
      setSelectedImage(img);
      // A pack opens on the frame its deck was showing.
      setSlideState({
        entryId: img.id,
        index: Math.max(
          0,
          (img.previewImages ?? []).findIndex(
            (preview) => preview.id === img.activePreviewId,
          ),
        ),
      });
    },
    [images, toggleAssetSelection],
  );

  const selectImageByEntry = useCallback(
    (entry: (typeof images)[number]) => {
      handleImageSelect({
        id: entry.id,
        packId: "packId" in entry ? entry.packId : undefined,
        galleryItemId:
          "galleryItemId" in entry ? entry.galleryItemId : entry.id,
        galleryItemType:
          "galleryItemType" in entry ? entry.galleryItemType : "asset",
        thumbSrc: entry.src,
        fullSrc: entry.fullSrc,
        prompt: entry.prompt,
        width: entry.width,
        height: entry.height,
        kind: "kind" in entry ? entry.kind : undefined,
        contentType: "contentType" in entry ? entry.contentType : undefined,
        modelName: entry.modelName,
        pillar: entry.pillar,
        generationType: "generationType" in entry ? entry.generationType : undefined,
        assetRole: "assetRole" in entry ? entry.assetRole : undefined,
        ingestSource: "ingestSource" in entry ? entry.ingestSource : undefined,
        tagNames: entry.tagNames,
        sourceUrl: entry.sourceUrl,
        description: "description" in entry ? entry.description : undefined,
        fileName: "fileName" in entry ? entry.fileName : undefined,
        designInspirationId:
          "designInspirationId" in entry ? entry.designInspirationId : undefined,
        createdAt: entry.createdAt,
        folderId: entry.folderId,
        folderIds:
          "folderIds" in entry
            ? entry.folderIds
            : entry.folderId
              ? [entry.folderId]
              : [],
        isPublic: entry.isPublic,
        isFeatured: entry.isFeatured,
        starredAt: "starredAt" in entry ? entry.starredAt : undefined,
        starNote: "starNote" in entry ? entry.starNote : undefined,
        bookmark: "bookmark" in entry ? entry.bookmark : undefined,
        previewImages: entry.previewImages ?? [],
      });
    },
    [handleImageSelect],
  );

  // A moodboard item opens the normal asset detail; the live read fills in
  // its tags, filing and flags.
  const openMoodboardAsset = useCallback(
    (asset: MoodboardAssetSummary) => {
      handleImageSelect({
        id: asset.assetId,
        galleryItemId: asset.assetId,
        galleryItemType: "asset",
        thumbSrc: asset.thumbUrl ?? asset.url ?? "/placeholder.svg",
        fullSrc: asset.url ?? asset.thumbUrl ?? "/placeholder.svg",
        prompt: asset.promptText ?? "",
        width: asset.width,
        height: asset.height,
        kind: asset.kind,
        contentType: asset.contentType,
        previewImages: [],
      });
    },
    [handleImageSelect],
  );

  const openMoodboardsTab = useCallback(
    (boardId?: string) => {
      // Opening the tab ends any half-done pick.
      if (moodboardPickRef.current) {
        setMoodboardPick(null);
        clearAssetSelection();
      }
      setStorybooksView(false);
      setStoriesView(false);
      setBookmarksView(false);
      setMotionView(false);
      setCinematographyView(false);
      setViewMode("grid");
      setMoodboardsTabBoardId(boardId ?? null);
      setMoodboardsTab(true);
    },
    [clearAssetSelection, setViewMode],
  );

  // story:, asset: and moodboard: references in a world's docs open the item:
  // the story in Stories, the asset in its detail panel, the board in Moodboards.
  const openWorldRef = useCallback(
    async (ref: WorldRef) => {
      if (!ownerUserId) return;
      if (ref.kind === "moodboard") {
        openMoodboardsTab(ref.id);
        return;
      }
      try {
        if (ref.kind === "asset") {
          const asset = await convex.query(api.assets.getGalleryAsset, { id: ref.id as Id<"assets">, ownerUserId });
          if (!asset) throw new Error("missing");
          handleImageSelect({
            id: asset._id,
            galleryItemId: asset._id,
            galleryItemType: "asset",
            thumbSrc: asset.thumbUrl ?? asset.url ?? "/placeholder.svg",
            fullSrc: asset.url ?? asset.thumbUrl ?? "/placeholder.svg",
            prompt: asset.promptText ?? "",
            width: asset.width,
            height: asset.height,
            kind: asset.kind,
            contentType: asset.contentType,
            previewImages: [],
          });
          return;
        }
        const story = await convex.query(api.stories.getStory, { ownerUserId, id: ref.id as Id<"stories"> });
        setStoryToOpen(story);
        setStoriesOpenId(story?._id ?? null);
        setStorybooksView(false);
        setMoodboardsTab(false);
        setBookmarksView(false);
        setMotionView(false);
        setCinematographyView(false);
        setStoriesView(true);
        setViewMode("grid");
      } catch {
        setMoodboardNotice({
          title: `Could not open that ${ref.kind}`,
          message: `${ref.kind}:${ref.id} is not in your gallery any more.`,
          type: "warning",
          at: Date.now(),
        });
      }
    },
    [convex, handleImageSelect, openMoodboardsTab, ownerUserId, setViewMode],
  );

  /* ── The address bar ─────────────────────────────────────────────────────
     Every view is a URL (lib/gallery-routes). The view state below is the
     source of truth; it is written to the address on every change, and the
     address is read back on load and on back/forward. Old client-state
     navigation keeps working unchanged: it just shows in the URL now. */

  // The piece the detail panel shows, when it is a plain asset.
  const currentAssetId =
    selectedImage &&
    (selectedImage.galleryItemType === "asset" || selectedImage.galleryItemType === undefined)
      ? (selectedImage.galleryItemId ?? selectedImage.id)
      : null;

  const currentRoute = useMemo<GalleryRoute>(() => {
    if (galleryScope !== "mine") return { kind: "home" };
    // Documents open over any view; their address names the document.
    if (openStorybookId) return { kind: "storybooks", id: openStorybookId };
    if (selectedSkillId) return { kind: "skills", id: selectedSkillId };
    if (storybooksView) return { kind: "storybooks" };
    if (activeMoodboardsTab) return moodboardsTabBoardId ? { kind: "moodboards", id: moodboardsTabBoardId } : { kind: "moodboards" };
    if (activeStoriesView) return storiesOpenId ? { kind: "stories", id: storiesOpenId } : { kind: "stories" };
    if (bookmarksView) return { kind: "bookmarks" };
    if (motionView) return { kind: "motion" };
    if (cinematographyView) return { kind: "cinematography" };
    if (viewMode === "skills") return { kind: "skills" };
    if (activeCollectionFolder) {
      const root = activeWorldRoot ?? activeCollectionFolder;
      const world = worldSegment(root);
      const tab =
        viewMode === "collections"
          ? ("folders" as const)
          : activeWorldPanel === "docs"
            ? ("instructions" as const)
            : activeWorldPanel === "journal" || activeWorldPanel === "tasks"
              ? activeWorldPanel
              : moodboardsViewActive
                ? ("moodboards" as const)
                : undefined;
      // A shelf has one address; a world tab opened from a shelf links to the
      // world's own tab, which shows the same documents.
      if (activeCollectionFolder._id !== root._id && !tab) {
        return { kind: "world", world, shelf: String(activeCollectionFolder._id) };
      }
      return tab ? { kind: "world", world, tab } : { kind: "world", world };
    }
    if (viewMode === "collections") return { kind: "collections" };
    return { kind: "home" };
  }, [
    activeCollectionFolder, activeMoodboardsTab, activeStoriesView, activeWorldPanel, activeWorldRoot,
    bookmarksView, cinematographyView, galleryScope, moodboardsTabBoardId, moodboardsViewActive, motionView,
    openStorybookId, selectedSkillId, storiesOpenId, storybooksView, viewMode,
  ]);
  const currentPath = galleryRoutePath(currentRoute, currentAssetId);

  // A location read from the address and not yet shown: undefined before the
  // first read, null when there is nothing to apply. While one waits (a
  // world needs the collections loaded first), the address is not rewritten.
  const [pendingLocation, setPendingLocation] = useState<GalleryLocation | null | undefined>(undefined);
  // True while the view is being set from the address: the write-back then
  // corrects the address in place instead of adding a history entry.
  const applyingLocationRef = useRef(false);

  useEffect(() => {
    const read = () => parseGalleryRoute(window.location.pathname, window.location.search) ?? { route: { kind: "home" } as GalleryRoute };
    setPendingLocation(read());
    const onPopState = () => setPendingLocation(read());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const leaveEveryView = useCallback(() => {
    setOpenStorybookId(null);
    setSelectedSkillId(null);
    setStoryToOpen(null);
    setStorybooksView(false);
    setStoriesView(false);
    setMoodboardsTab(false);
    setBookmarksView(false);
    setMotionView(false);
    setCinematographyView(false);
    setWorldPanel(null);
    setMoodboardsCollectionId(null);
    setCollectionBoardToOpen(null);
  }, []);

  // Shows a location. From the address (load, back/forward) the write-back
  // corrects the URL in place; from a click it pushes a history entry.
  const applyLocation = useCallback(
    (location: GalleryLocation, source: "address" | "click" = "address") => {
      const { route, asset } = location;
      applyingLocationRef.current = source === "address";
      leaveEveryView();
      switch (route.kind) {
        case "home":
          setSelectedFolderId(null);
          setViewModeRaw("grid");
          break;
        case "collections":
          setSelectedFolderId(null);
          setViewModeRaw("collections");
          break;
        case "world": {
          const all = folders ?? [];
          const root = resolveWorldSegment(all, route.world);
          if (!root) {
            setSelectedFolderId(null);
            setViewModeRaw("grid");
            setMoodboardNotice({ title: "Not in your gallery", message: `No world or collection answers to “${route.world}”.`, type: "warning", at: Date.now() });
            break;
          }
          const child = route.shelf
            ? all.find((folder) => String(folder._id) === route.shelf && String(folder.parentFolderId ?? "") === String(root._id))
            : undefined;
          if (route.shelf && !child) {
            setMoodboardNotice({ title: "Shelf not found", message: `${root.name} has no shelf ${route.shelf} any more; showing the world.`, type: "warning", at: Date.now() });
          }
          if (child?.kind === "storybook") {
            setSelectedFolderId(String(root._id));
            setViewModeRaw("grid");
            setOpenStorybookId(String(child._id));
            break;
          }
          const target = String((child ?? root)._id);
          setSelectedFolderId(target);
          setViewModeRaw(route.tab === "folders" ? "collections" : "grid");
          if (route.tab === "instructions" || route.tab === "journal" || route.tab === "tasks") {
            setWorldPanel({ collectionId: target, tab: route.tab === "instructions" ? "docs" : route.tab });
          }
          if (route.tab === "moodboards") setMoodboardsCollectionId(target);
          break;
        }
        case "storybooks":
          setViewModeRaw("grid");
          setStorybooksView(true);
          if (route.id) setOpenStorybookId(route.id);
          break;
        case "moodboards":
          setViewModeRaw("grid");
          setMoodboardsTabBoardId(route.id ?? null);
          setMoodboardsTab(true);
          break;
        case "stories":
          setViewModeRaw("grid");
          setStoriesOpenId(route.id ?? null);
          setStoriesView(true);
          break;
        case "skills":
          setViewModeRaw("skills");
          setSelectedSkillId(route.id ?? null);
          break;
        case "bookmarks":
          setBookmarksView(true);
          break;
        case "motion":
          setMotionView(true);
          break;
        case "cinematography":
          setViewModeRaw("grid");
          setCinematographyView(true);
          break;
      }
      if (!asset) {
        setSelectedImage(null);
        return;
      }
      if (asset === currentAssetId || !ownerUserId) return;
      void convex
        .query(api.assets.getGalleryAsset, { id: asset as Id<"assets">, ownerUserId })
        .then((row) => {
          if (!row) throw new Error("missing");
          applyingLocationRef.current = source === "address";
          handleImageSelect({
            id: row._id,
            galleryItemId: row._id,
            galleryItemType: "asset",
            thumbSrc: row.thumbUrl ?? row.url ?? "/placeholder.svg",
            fullSrc: row.url ?? row.thumbUrl ?? "/placeholder.svg",
            prompt: row.promptText ?? "",
            width: row.width,
            height: row.height,
            kind: row.kind,
            contentType: row.contentType,
            previewImages: [],
          });
        })
        .catch(() => {
          setMoodboardNotice({ title: "Piece not found", message: `asset:${asset} is not in your gallery any more.`, type: "warning", at: Date.now() });
        });
    },
    [convex, currentAssetId, folders, handleImageSelect, leaveEveryView, ownerUserId],
  );

  // Apply what the address asks for as soon as the data it names is here.
  useEffect(() => {
    if (!pendingLocation) return;
    if (pendingLocation.route.kind === "world" && folders === undefined) return;
    applyLocation(pendingLocation);
    setPendingLocation(null);
  }, [applyLocation, folders, pendingLocation]);

  // Write the view to the address. A change the user made pushes a history
  // entry; one that came from the address corrects it in place.
  useEffect(() => {
    if (pendingLocation !== null) return;
    const here = new URL(window.location.href);
    const next = new URL(currentPath, here.origin);
    // Unrelated parameters (a login error, a preview flag) ride along.
    for (const [key, value] of here.searchParams) {
      if (key !== "asset" && !next.searchParams.has(key)) next.searchParams.append(key, value);
    }
    const unchanged = next.pathname === here.pathname && next.search === here.search;
    if (!unchanged) {
      if (applyingLocationRef.current) window.history.replaceState(null, "", next.toString());
      else window.history.pushState(null, "", next.toString());
    }
    applyingLocationRef.current = false;
  }, [currentPath, pendingLocation]);

  // The tab reads as the place, not the showcase the route's metadata names.
  const worldNameForTitle = activeWorldRoot?.name ?? activeCollectionFolder?.name;
  const shelfNameForTitle = activeCollectionFolder && activeWorldRoot && activeCollectionFolder._id !== activeWorldRoot._id ? activeCollectionFolder.name : undefined;
  useEffect(() => {
    document.title = galleryRouteTitle(currentRoute, { world: worldNameForTitle, shelf: shelfNameForTitle });
  }, [currentRoute, shelfNameForTitle, worldNameForTitle]);

  // What the phone's browse sheet lists under the tree: the sidebar's items.
  const browseSections = useMemo<BrowseSheetSection[]>(() => {
    const open = (route: GalleryRoute) => () => applyLocation({ route }, "click");
    return [
      { key: "storybooks", label: "Storybooks", hint: "Episodes with their frames and stories", icon: BookOpen, active: storybooksView, onOpen: open({ kind: "storybooks" }) },
      { key: "stories", label: "Stories", hint: "Ideas, scripts and style locks", icon: BookOpenText, active: activeStoriesView, onOpen: open({ kind: "stories" }) },
      { key: "moodboards", label: "Moodboards", hint: "Looks mirrored to Midjourney", icon: LayoutGrid, active: activeMoodboardsTab, onOpen: open({ kind: "moodboards" }) },
      { key: "skills", label: "Skills", hint: "Techniques and recipes, step by step", icon: Sparkles, active: viewMode === "skills" && !storybooksView && !bookmarksView && !extraTabView, onOpen: open({ kind: "skills" }) },
      { key: "youtube", label: "YouTube", hint: "Channel and format research", icon: Youtube, href: "/youtube" },
      { key: "motion", label: "Motion", hint: "Motion design by facet", icon: Clapperboard, active: motionView, onOpen: open({ kind: "motion" }) },
      { key: "cinematography", label: "Cinematography", hint: "Camera moves and shot packs", icon: Camera, active: cinematographyView, onOpen: open({ kind: "cinematography" }) },
      { key: "tasks", label: "Tasks", hint: "The queue agents claim and finish", icon: ListChecks, href: "/tasks", badge: tasksOpenCount },
      { key: "decisions", label: "Decisions", hint: "Cards waiting for your answer", icon: Layers, href: "/inbox", badge: inboxOpenCount },
      ...(tasksOpenCount !== undefined ? [{ key: "newspaper", label: "Newspaper", hint: "The morning review: done, needs you, decisions", icon: Newspaper, href: "/newspaper" }] : []),
    ];
  }, [activeMoodboardsTab, activeStoriesView, applyLocation, bookmarksView, cinematographyView, extraTabView, inboxOpenCount, motionView, storybooksView, tasksOpenCount, viewMode]);

  // "Choose from gallery" on a board: the grid opens on the board's own
  // collection with every filter at hand, and a click selects.
  const startMoodboardPick = useCallback(
    (board: MoodboardPickTarget, returnTo: string | null) => {
      setSelectedImage(null);
      clearAssetSelection();
      setMoodboardPicker(null);
      setMoodboardPick({ board, returnTo });
      setStorybooksView(false);
      setStoriesView(false);
      setBookmarksView(false);
      setMotionView(false);
      setCinematographyView(false);
      setMoodboardsTab(false);
      setMoodboardsCollectionId(null);
      setCollectionBoardToOpen(null);
      setViewMode("grid");
      setSelectedFolderId(board.folderId);
      // Start at the top, where the filters are.
      document
        .getElementById("gallery-main-content")
        ?.closest(".overflow-y-auto")
        ?.scrollTo({ top: 0 });
    },
    [clearAssetSelection, setViewMode],
  );

  // Added or cancelled: back to the board where the round started.
  const finishMoodboardPick = useCallback(() => {
    const pick = moodboardPickRef.current;
    setMoodboardPick(null);
    clearAssetSelection();
    if (!pick) return;
    if (pick.returnTo) {
      setViewMode("grid");
      setSelectedFolderId(pick.returnTo);
      setCollectionBoardToOpen(pick.board.id);
      setMoodboardsCollectionId(pick.returnTo);
      setWorldPanel(null);
      return;
    }
    openMoodboardsTab(pick.board.id);
  }, [clearAssetSelection, openMoodboardsTab, setViewMode]);

  const moodboardTabFolders = useMemo(
    () =>
      (folders ?? []).map((folder) => ({
        _id: String(folder._id),
        name: folder.name,
        parentFolderId: folder.parentFolderId ? String(folder.parentFolderId) : undefined,
        group: folder.group,
        kind: folder.kind,
      })),
    [folders],
  );

  const addAssetToMoodboard = useCallback(
    (assetId: string, anchor: DOMRect | null) =>
      setMoodboardPicker({ assetIds: [assetId], anchor }),
    [],
  );
  const closeMoodboardPicker = useCallback(() => setMoodboardPicker(null), []);

  const isDetailPanelEntry = useCallback(
    (entry: (typeof images)[number]) =>
      entry.galleryItemType !== "storybook" &&
      entry.galleryItemType !== "collection",
    [],
  );

  // Stack entries open their own destination, not the detail panel, so
  // prev/next navigation steps over them.
  const canGoPrev =
    currentImageIndex > 0 &&
    images
      .slice(0, currentImageIndex)
      .some(isDetailPanelEntry);
  const canGoNext =
    currentImageIndex >= 0 &&
    images
      .slice(currentImageIndex + 1)
      .some(isDetailPanelEntry);

  const goToPrev = useCallback(() => {
    if (!canGoPrev) return;
    for (let index = currentImageIndex - 1; index >= 0; index -= 1) {
      if (!isDetailPanelEntry(images[index])) continue;
      selectImageByEntry(images[index]);
      return;
    }
  }, [
    canGoPrev,
    currentImageIndex,
    images,
    isDetailPanelEntry,
    selectImageByEntry,
  ]);

  const goToNext = useCallback(() => {
    if (!canGoNext) return;
    for (let index = currentImageIndex + 1; index < images.length; index += 1) {
      if (!isDetailPanelEntry(images[index])) continue;
      selectImageByEntry(images[index]);
      return;
    }
  }, [
    canGoNext,
    currentImageIndex,
    images,
    isDetailPanelEntry,
    selectImageByEntry,
  ]);

  const imagePosition =
    currentImageIndex >= 0
      ? `${currentImageIndex + 1}/${images.length}`
      : undefined;

  // ── The open pack's frames ─────────────────────────────────────────────────
  const carouselImages = useMemo(() => {
    const previews = selectedImage?.previewImages ?? [];
    if (!selectedImage || previews.length <= 1) {
      return undefined;
    }

    return previews.map((preview) => ({
      id: preview.id,
      thumbSrc: preview.src,
      fullSrc: preview.fullSrc,
      posterSrc: preview.posterSrc,
      width: preview.width,
      height: preview.height,
      prompt: preview.prompt,
      promptId: preview.promptId,
      kind: preview.kind,
      contentType: preview.contentType,
    }));
  }, [selectedImage]);
  const slideCount = carouselImages?.length ?? 1;
  const slideIndex =
    selectedImage && slideState.entryId === selectedImage.id
      ? Math.min(slideState.index, slideCount - 1)
      : 0;
  const activeSlideId =
    carouselImages?.[slideIndex]?.id ?? selectedImage?.id ?? null;
  const setSlideIndex = useCallback(
    (index: number) => {
      if (!selectedImage) return;
      setSlideState({
        entryId: selectedImage.id,
        index: Math.min(Math.max(index, 0), slideCount - 1),
      });
    },
    [selectedImage, slideCount],
  );

  const handleFindSimilar = useCallback(
    async (imageId: string) => {
      const image = images.find((candidate) => candidate.id === imageId);
      const requestId = semanticRequestIdRef.current + 1;
      semanticRequestIdRef.current = requestId;

      setAssetSearchQuery("");
      setDebouncedAssetSearchQuery("");
      setSemanticMode({
        kind: "similar",
        assetId: imageId,
        prompt: image?.prompt ?? "Selected image",
      });
      setSemanticLoading(true);
      setSemanticError(undefined);

      try {
        const results = await findSimilarAssetsAction({
          ownerUserId: galleryScope === "mine" ? ownerUserId : undefined,
          scope: galleryScope,
          assetId: imageId as Id<"assets">,
          limit: 120,
        });

        if (semanticRequestIdRef.current !== requestId) {
          return;
        }

        setSemanticResults(results);
        setSemanticLoading(false);
      } catch (error) {
        if (semanticRequestIdRef.current !== requestId) {
          return;
        }

        setSemanticResults([]);
        setSemanticLoading(false);
        setSemanticError(
          error instanceof Error
            ? error.message
            : "Failed to find similar assets.",
        );
      }
    },
    [findSimilarAssetsAction, galleryScope, images, ownerUserId],
  );

  const handleReplaceThumbnail = useCallback(
    async (imageId: string, file: File) => {
      if (!ownerUserId || replacingThumbAssetId) return;
      setReplacingThumbAssetId(imageId);
      try {
        const uploadUrl = await generateUploadUrl();
        const uploadRes = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!uploadRes.ok) {
          throw new Error("Upload failed");
        }
        const { storageId } = (await uploadRes.json()) as {
          storageId: string;
        };
        await processAndReplaceThumbnail({
          ownerUserId,
          assetId: imageId as Id<"assets">,
          storageId: storageId as Id<"_storage">,
        });
      } finally {
        setReplacingThumbAssetId(null);
      }
    },
    [ownerUserId, replacingThumbAssetId, generateUploadUrl, processAndReplaceThumbnail],
  );

  // Swipe gestures for mobile detail sheet
  const swipeHandlers = useMemo(
    () => ({
      // Same order as the arrow keys: a pack's frames, then the next card.
      onSwipeLeft: () =>
        slideIndex < slideCount - 1
          ? setSlideIndex(slideIndex + 1)
          : goToNext(),
      onSwipeRight: () =>
        slideIndex > 0 ? setSlideIndex(slideIndex - 1) : goToPrev(),
      onSwipeDown: closeSelectedImage,
      onDrag: (_dx: number, dy: number) => {
        if (dy > 0) setSheetDragY(dy);
      },
      onDragCancel: () => setSheetDragY(0),
    }),
    [
      goToNext,
      goToPrev,
      closeSelectedImage,
      setSlideIndex,
      slideCount,
      slideIndex,
    ],
  );
  useSwipeGesture(mobileDetailRef, swipeHandlers);

  // Keyboard: Escape, ArrowLeft/Right for image navigation
  useEffect(() => {
    if (!selectedImage || typeof window === "undefined") return;

    const isMobile = window
      .matchMedia("(max-width: 767px)")
      .matches;
    const previousOverflow = document.body.style.overflow;
    if (isMobile) {
      document.body.style.overflow = "hidden";
      window.setTimeout(() => {
        const container = mobileDetailRef.current;
        if (!container) return;
        const firstFocusable =
          container.querySelector<HTMLElement>(
            FOCUSABLE_SELECTOR,
          );
        (firstFocusable ?? container).focus();
      }, 0);
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSelectedImage();
        return;
      }
      if (!isMobile || event.key !== "Tab") return;
      const container = mobileDetailRef.current;
      if (!container) return;

      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(
          FOCUSABLE_SELECTOR,
        ),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement =
        document.activeElement as HTMLElement | null;
      if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (isMobile) {
        document.body.style.overflow = previousOverflow;
      }
    };
  }, [
    closeSelectedImage,
    selectedImage,
  ]);

  // ArrowLeft/Right: in a pack, walk its frames first and only then step to
  // the neighbouring card. Kept apart from the effect above so a slide change
  // doesn't re-run its mobile focus handling.
  useEffect(() => {
    if (!selectedImage) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      // Arrows move the caret while editing a description or tags.
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT"
      ) {
        return;
      }
      event.preventDefault();
      if (event.key === "ArrowLeft") {
        if (slideIndex > 0) setSlideIndex(slideIndex - 1);
        else goToPrev();
        return;
      }
      if (slideIndex < slideCount - 1) setSlideIndex(slideIndex + 1);
      else goToNext();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    goToNext,
    goToPrev,
    selectedImage,
    setSlideIndex,
    slideCount,
    slideIndex,
  ]);

  // Escape drops the selection when no overlay is up (the detail view has its
  // own Escape handler and wins while open).
  useEffect(() => {
    if (selectedImage || selectedAssetIds.size === 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      // Never steal Escape from a field the user is typing in.
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      clearAssetSelection();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clearAssetSelection, selectedAssetIds.size, selectedImage]);

  // Distinguish loading / empty / no-matches / has-images
  // Once grouped stacks are up, the rest keeps loading behind them: a world
  // whose pieces all sit in its folders (DEAR ANNETE — ART DECO) has no loose
  // tile to end the wait, and a style branch counts its stacks from its pages.
  const groupedStacksShowing =
    showChildCollectionStacks && groupedChildSections.length > 0;
  const isLoading =
    gridInsertsLoading ||
    (showChildCollectionStacks && !styleBranchWithShelves &&
      childCollectionStacks === undefined)
      ? true
      : anyPaginationActive
        ? (galleryScope === "public" || canAccessMyGallery) &&
          (activePagedAssets.status === "LoadingFirstPage" ||
            (pagedFrontierEmpty && !groupedStacksShowing))
        : galleryScope === "mine"
          ? canAccessMyGallery &&
            mineGalleryAssets === undefined
          : publicGalleryAssets === undefined;
  const hasFilters =
    selectedTags.length > 0 ||
    excludedFilters.length > 0 ||
    likedOnly ||
    effectiveSelectedFolderId !== null ||
    selectedModelName !== null ||
    assetSearchQuery.trim().length > 0 ||
    semanticMode?.kind === "similar";
  const hasImages = images.length > 0;
  // Grouped child collections render under their group headings above the
  // grid, so a world whose children are all grouped is not "empty".
  const showGroupedChildStacks =
    showChildCollectionStacks && groupedChildSections.length > 0;
  const isNoMatches =
    !isLoading && !hasImages && !showGroupedChildStacks && hasFilters;

  const contentMarginLeft = sidebarCollapsed
    ? "var(--lm-sidebar-collapsed)"
    : "var(--lm-sidebar-width)";

  // The open file, live. `selectedImage` is a snapshot taken on click, so
  // anything written from the panel — a description, tags, filing, a cover —
  // would leave the panel showing its own stale copy. Subscribing to the one
  // asset keeps the panel honest without re-fetching the grid. In a pack it
  // is the frame on show, so every field and action is about that file.
  const selectedAssetIdForLive =
    selectedImage &&
    (selectedImage.galleryItemType === "asset" ||
      selectedImage.galleryItemType === "pack" ||
      selectedImage.galleryItemType === undefined) &&
    !selectedImage.isDesignInspiration
      ? activeSlideId
      : null;
  const liveReadExpected = Boolean(selectedAssetIdForLive && canAccessMyGallery);
  const liveSelectedAsset = useQuery(
    api.assets.getGalleryAsset,
    liveReadExpected
      ? { id: selectedAssetIdForLive as Id<"assets">, ownerUserId }
      : "skip",
  );

  const selectedImageLive = useMemo<SelectedImage | null>(() => {
    if (!selectedImage) return null;
    const onCover = activeSlideId === selectedImage.id;
    if (!liveSelectedAsset || liveSelectedAsset._id !== activeSlideId) {
      if (onCover || !liveReadExpected) return selectedImage;
      // Another frame, still loading: show nothing of the cover's rather
      // than pass its tags and filing off as this file's.
      return {
        ...selectedImage,
        description: undefined,
        tagNames: [],
        folderId: undefined,
        folderIds: [],
        isPublic: undefined,
        isFeatured: undefined,
        isLiked: undefined,
        starredAt: undefined,
        starNote: undefined,
      };
    }
    return {
      ...selectedImage,
      packId: onCover
        ? selectedImage.packId
        : (liveSelectedAsset.assetPackId as string | undefined),
      description: liveSelectedAsset.description,
      tagNames: liveSelectedAsset.tagNames,
      folderId: liveSelectedAsset.folderId as string | undefined,
      folderIds: liveSelectedAsset.folderIds.map(String),
      isPublic: liveSelectedAsset.isPublic,
      isFeatured: liveSelectedAsset.isFeatured,
      isLiked: liveSelectedAsset.isLiked,
      starredAt: liveSelectedAsset.starredAt,
      starNote: liveSelectedAsset.starNote,
      modelName: liveSelectedAsset.modelName ?? selectedImage.modelName,
      sourceUrl: liveSelectedAsset.sourceUrl ?? selectedImage.sourceUrl,
      createdAt: liveSelectedAsset.createdAt,
      bookmark:
        (liveSelectedAsset.bookmark as BookmarkPost | undefined) ??
        selectedImage.bookmark,
    };
  }, [activeSlideId, liveReadExpected, liveSelectedAsset, selectedImage]);

  // ── Collection thumbnail ───────────────────────────────────────────────────
  // A collection's card image can come from any piece inside it (the detail
  // panel's "Cover"), or from a file that isn't in the vault yet — a poster
  // frame, a title card. That second path ingests into the collection first,
  // because a cover still has to be an asset somewhere.
  const uploadToR2 = useUploadFile(api.r2);
  const collectionCoverInputRef = useRef<HTMLInputElement | null>(null);
  const [collectionCoverBusy, setCollectionCoverBusy] = useState(false);

  const uploadCollectionCover = useCallback(
    async (file: File) => {
      if (!ownerUserId || !effectiveSelectedFolderId || collectionCoverBusy) return;
      const folderId = effectiveSelectedFolderId as Id<"folders">;
      const folderName = folderNameById.get(folderId) ?? "collection";
      const promptText = `${folderName} cover`;
      setCollectionCoverBusy(true);
      try {
        // Past ~3 MB the bytes can't ride inside the ingest action call, so
        // they go browser → R2 first, exactly like the upload panel does.
        const isLarge = file.size > LARGE_IMAGE_BYTES;
        const formData = buildUploadFormData({
          promptText,
          folderId: folderId as string,
          file: isLarge ? null : file,
          assetRole: "reference",
        });
        if (isLarge) {
          const upload = await uploadImageToR2(file, { upload: uploadToR2 });
          appendImageUploadFields(formData, upload);
          const key = buildIngestKey({ promptText, fileName: file.name });
          if (key) formData.set("ingestKey", key);
        }
        const response = await fetch("/api/ingest", {
          method: "POST",
          body: formData,
        });
        const body = (await response.json().catch(() => null)) as {
          error?: string;
          result?: { assetId?: string };
        } | null;
        if (!response.ok) {
          throw new Error(body?.error ?? "Upload failed.");
        }
        const assetId = body?.result?.assetId;
        if (!assetId) {
          throw new Error("Upload didn't return an asset.");
        }
        await setFolderCoverMutation({
          ownerUserId,
          folderId,
          assetId: assetId as Id<"assets">,
        });
        setMoveStatus({ text: `Thumbnail set for ${folderName}` });
      } catch (error) {
        setMoveStatus({
          text:
            error instanceof Error
              ? error.message
              : "Couldn't set the thumbnail.",
          error: true,
        });
      } finally {
        setCollectionCoverBusy(false);
      }
    },
    [
      collectionCoverBusy,
      effectiveSelectedFolderId,
      folderNameById,
      ownerUserId,
      setFolderCoverMutation,
      uploadToR2,
    ],
  );

  // ── Type buckets: drop straight into the collection you're already in ──────
  // Dropping media while a collection is open already answers
  // the two questions the upload form asks — where it goes, and what it IS —
  // so the drag overlay offers the three type buckets instead of the form. The
  // form stays one drop away: anywhere outside a bucket still opens it.
  const quickDropTarget = useMemo<
    { kind: "folder"; folderId: string; label: string } | null
  >(() => {
    // Same gate as the breadcrumb: a bucket may only claim a destination the
    // grid is actually showing. The collections landing, Skills and the
    // storybook shelf all keep the plain "opens the form" drop.
    if (!canAccessMyGallery || galleryScope !== "mine") return null;
    if (viewMode !== "grid" || storybooksView || bookmarksView || extraTabView) return null;
    if (effectiveSelectedFolderId) {
      const folder = foldersWithCounts.find(
        (entry) => entry._id === effectiveSelectedFolderId,
      );
      if (!folder) return null;
      return { kind: "folder", folderId: folder._id, label: folder.name };
    }
    return null;
  }, [
    canAccessMyGallery,
    effectiveSelectedFolderId,
    foldersWithCounts,
    galleryScope,
    storybooksView,
    bookmarksView,
    extraTabView,
    viewMode,
  ]);
  const quickDropImpliedTag = useMemo<StaticsTagName | null>(() => {
    if (quickDropTarget?.kind !== "folder") return null;
    const tag = assetTypeTagForCollectionName(quickDropTarget.label);
    return tag === "character" || tag === "location" || tag === "scene"
      ? tag
      : null;
  }, [quickDropTarget]);
  const quickDropOptions = useMemo(
    () =>
      quickDropImpliedTag
        ? STATICS_TAGS.filter((option) => option.tag === quickDropImpliedTag)
        : STATICS_TAGS,
    [quickDropImpliedTag],
  );

  // Which bucket is mid-upload. (Which one the cursor is over lives with the
  // rest of the drag state, up where the shell handlers can clear it.)
  const [quickDropBusy, setQuickDropBusy] = useState<StaticsTagName | null>(
    null,
  );

  const runQuickDrop = useCallback(
    async (tag: StaticsTagName, dropped: RawFile[]) => {
      if (!quickDropTarget || !ownerUserId || quickDropBusy) return;
      const files = dropped
        .map((entry) => entry.file)
        .filter((file) => resolveMedia(file.name, file.type) !== null);
      if (files.length === 0) return;

      setQuickDropBusy(tag);
      setMoveStatus({
        text: `Saving ${files.length} ${tag}${files.length === 1 ? "" : "s"} to ${quickDropTarget.label}…`,
      });
      try {
        const folderId = quickDropTarget.folderId;

        let saved = 0;
        let duplicates = 0;
        const failures: string[] = [];
        for (
          let index = 0;
          index < files.length;
          index += QUICK_DROP_CONCURRENCY
        ) {
          const batch = files.slice(index, index + QUICK_DROP_CONCURRENCY);
          const results = await Promise.allSettled(
            batch.map((file) =>
              quickIngestFile({ file, folderId, tags: [tag], uploadToR2 }),
            ),
          );
          for (const result of results) {
            if (result.status === "fulfilled") {
              saved += 1;
              if (result.value.duplicate) duplicates += 1;
            } else {
              failures.push(
                result.reason instanceof Error
                  ? result.reason.message
                  : "Upload failed.",
              );
            }
          }
        }

        if (saved === 0) {
          setMoveStatus({
            text: failures[0] ?? "Nothing saved.",
            error: true,
          });
          return;
        }
        const notes = [
          `${saved} ${tag}${saved === 1 ? "" : "s"} → ${quickDropTarget.label}`,
        ];
        if (duplicates > 0) {
          notes.push(`${duplicates} already in your vault (filed, not copied)`);
        }
        if (failures.length > 0) notes.push(`${failures.length} failed`);
        setMoveStatus({ text: notes.join(" · "), error: failures.length > 0 });
      } catch (error) {
        setMoveStatus({
          text: error instanceof Error ? error.message : "Drop failed.",
          error: true,
        });
      } finally {
        setQuickDropBusy(null);
      }
    },
    [
      ownerUserId,
      quickDropBusy,
      quickDropTarget,
      uploadToR2,
    ],
  );

  const handleBucketDrop = useCallback(
    (tag: StaticsTagName, event: React.DragEvent) => {
      event.preventDefault();
      // Without this the shell's own drop handler also fires and opens the
      // upload form on top of the save.
      event.stopPropagation();
      dragDepthRef.current = 0;
      setIsDraggingFiles(false);
      setHoveredDropTag(null);
      const dataTransfer = event.dataTransfer;
      if (!dataTransfer) return;
      // Entries have to be read before the first await or the DataTransfer is
      // already drained — readDroppedFiles captures them synchronously.
      void readDroppedFiles(dataTransfer).then((dropped) => {
        // A zip needs staging and per-file review, which is the bulk panel's
        // job — hand the whole drop to the form rather than half-saving it.
        if (dropped.some((entry) => isZipFile(entry.file))) {
          openUploadWithFiles(dropped.map((entry) => entry.file));
          return;
        }
        void runQuickDrop(tag, dropped);
      });
    },
    [openUploadWithFiles, runQuickDrop],
  );

  // ── The open asset's filing model ──────────────────────────────────────────
  // The detail panel needs three things the raw folder list can't answer:
  // which folders this asset is actually in, which world each of those sits
  // under, and which of them uses this asset as its thumbnail.
  const folderById = useMemo(
    () => new Map((folders ?? []).map((folder) => [folder._id as string, folder])),
    [folders],
  );
  // The toolbar's VIEWS popover: the saved views, and which filters and
  // collections still exist (a view naming a deleted one cannot be applied).
  const savedViews = useSavedViews(ownerUserId);
  const validViewFilterIds = useMemo(
    () => new Set((menuFilters ?? []).filter((filter) => filter.kind !== "tag" || filter.tagIds.length > 0).map((filter) => String(filter._id))),
    [menuFilters],
  );
  const validViewFolderIds = useMemo(
    () => new Set((folders ?? []).map((folder) => String(folder._id))),
    [folders],
  );
  const publishAllViewLabel =
    (effectiveSelectedFolderId && folderById.get(effectiveSelectedFolderId)?.name) || "Everything";

  const selectedFolderIds = useMemo<string[]>(() => {
    const asset = selectedImageLive;
    if (!asset) return [];
    if (asset.folderIds && asset.folderIds.length > 0) return asset.folderIds;
    return asset.folderId ? [asset.folderId] : [];
  }, [selectedImageLive]);

  const assetMemberships = useMemo<AssetMembership[]>(() => {
    if (!selectedImageLive) return [];
    const assetId = selectedImageLive.id;
    const rows: AssetMembership[] = [];
    for (const folderId of selectedFolderIds) {
      const folder = folderById.get(folderId);
      if (!folder) continue;
      const parent = folder.parentFolderId
        ? folderById.get(folder.parentFolderId)
        : undefined;
      rows.push({
        folderId,
        label: folder.name,
        context: parent?.name,
        isCover: folder.coverAssetId === assetId,
        canRemove: true,
      });
    }
    return rows;
  }, [
    folderById,
    selectedFolderIds,
    selectedImageLive,
  ]);

  const assetFilingTargets = useMemo<AssetFilingTarget[]>(() => {
    const targets: AssetFilingTarget[] = [];
    for (const folder of collectionFoldersWithCounts) {
      const parent = folder.parentFolderId
        ? folderById.get(folder.parentFolderId)
        : undefined;
      targets.push({
        key: folder._id,
        label: folder.name,
        context: parent?.name,
        folderId: folder._id,
      });
    }
    return targets;
  }, [collectionFoldersWithCounts, folderById]);

  const handleSetFolderCover = useCallback(
    async (folderId: string, assetId: string | null) => {
      if (!ownerUserId) return;
      try {
        await setFolderCoverMutation({
          ownerUserId,
          folderId: folderId as Id<"folders">,
          assetId: assetId ? (assetId as Id<"assets">) : null,
        });
        setMoveStatus({
          text: assetId
            ? `Thumbnail set for ${folderNameById.get(folderId) ?? "set"}`
            : `Thumbnail cleared for ${folderNameById.get(folderId) ?? "set"}`,
        });
      } catch (error) {
        setMoveStatus({
          text:
            error instanceof Error ? error.message : "Couldn't set the thumbnail.",
          error: true,
        });
      }
    },
    [folderNameById, ownerUserId, setFolderCoverMutation],
  );

  const handleAddAssetToTarget = useCallback(
    async (target: AssetFilingTarget, assetId: string) => {
      await addAssetsToFolder(target.folderId, [assetId]);
    },
    [addAssetsToFolder],
  );

  const handleSaveAssetDescription = useCallback(
    async (assetId: string, description: string) => {
      if (!ownerUserId) return;
      await setAssetDescriptionMutation({
        ownerUserId,
        assetId: assetId as Id<"assets">,
        description,
      });
    },
    [ownerUserId, setAssetDescriptionMutation],
  );

  const handleSaveAssetTags = useCallback(
    async (assetId: string, tagNames: string[]) => {
      if (!ownerUserId) return;
      await setAssetTagsMutation({
        ownerUserId,
        assetId: assetId as Id<"assets">,
        tagNames,
      });
    },
    [ownerUserId, setAssetTagsMutation],
  );

  const expandedDetailProps = {
    onClose: closeSelectedImage,
    shareHref: currentAssetId ? currentPath : undefined,
    onPrev: goToPrev,
    onNext: goToNext,
    canGoPrev,
    canGoNext,
    imagePosition,
    ownerUserId,
    // The Skill document sits under the detail overlay in the stack, so
    // the panel steps aside before the Skill opens.
    onOpenSkill: (skillId: string) => {
      closeSelectedImage();
      setSelectedSkillId(skillId);
    },
    onDelete: canDeleteInCurrentView
      ? (imageId: string) => {
          void deleteAsset(imageId);
        }
      : undefined,
    deleting: deletingAssetId === activeSlideId,
    deleteError: canDeleteInCurrentView
      ? deletingAssetId === activeSlideId ||
        deleteAssetError
        ? deleteAssetError
        : undefined
      : undefined,
    onToggleStar: canManageFoldersInCurrentView
      ? handleCardToggleStar
      : undefined,
    onSaveStarNote: canManageFoldersInCurrentView
      ? saveAssetStarNote
      : undefined,
    canManageFolder: canManageFoldersInCurrentView,
    memberships: assetMemberships,
    filingTargets: canManageFoldersInCurrentView ? assetFilingTargets : [],
    onAddToTarget: canManageFoldersInCurrentView
      ? handleAddAssetToTarget
      : undefined,
    onRemoveMembership: canManageFoldersInCurrentView
      ? (imageId: string, folderId: string) => removeAssetFromFolder(imageId, folderId)
      : undefined,
    onSetCover: canManageFoldersInCurrentView
      ? handleSetFolderCover
      : undefined,
    onCreateCollection: canManageFoldersInCurrentView
      ? (name: string, imageId: string) =>
          createCollectionFromAssets(name, [imageId])
      : undefined,
    filingBusy: folderLoadingAssetId === activeSlideId,
    filingError:
      folderLoadingAssetId === activeSlideId ||
      folderError
        ? folderError
        : undefined,
    canCuratePublic,
    onSetPublicState: canCuratePublic
      ? (imageId: string, isPublic: boolean) => {
          void updateAssetCuration({
            assetId: imageId,
            isPublic,
          });
        }
      : undefined,
    curationBusy:
      curationLoadingAssetId === activeSlideId,
    curationError:
      curationLoadingAssetId === activeSlideId ||
      curationError
        ? curationError
        : undefined,
    onFindSimilar: (imageId: string) => {
      void handleFindSimilar(imageId);
    },
    similarBusy:
      semanticLoading &&
      semanticMode?.kind === "similar" &&
      semanticMode.assetId === activeSlideId,
    similarActive:
      semanticMode?.kind === "similar" &&
      semanticMode.assetId === activeSlideId,
    onReplaceThumbnail: canDeleteInCurrentView
      ? handleReplaceThumbnail
      : undefined,
    replacingThumbnail:
      replacingThumbAssetId === activeSlideId,
    // Description and tags edit through owner-auth mutations, so this needs no
    // admin mode — unlike the old metadata form, which sat behind /admin.
    canEditDetails: canManageFoldersInCurrentView,
    availableTags: availableUploadTags,
    onSaveDescription: canManageFoldersInCurrentView
      ? handleSaveAssetDescription
      : undefined,
    onSaveTags: canManageFoldersInCurrentView
      ? handleSaveAssetTags
      : undefined,
  };

  return (
    <CoralToastProvider
      contentLeft={sidebarCollapsed ? "var(--lm-sidebar-collapsed)" : "var(--lm-sidebar-width)"}
      contentRight="0"
    >
    {/* Grid deletes have no inline error surface (the card just returns),
        so failures fire a toast — otherwise a failed delete looks like a
        silent no-op. */}
    <DeleteErrorToast error={deleteAssetError} />
    <NoticeToast notice={folderPublishNotice} />
    <NoticeToast notice={bulkDeleteNotice} />
    <NoticeToast notice={moodboardNotice} />
    {galleryScope === "mine" && canAccessMyGallery && canManageFoldersInCurrentView && (
      <EmptyFolderPrompt
        ownerUserId={ownerUserId}
        folders={emptyPromptFolders}
        assetCountById={folderCountById}
        ready={folderAssetCounts !== undefined}
        onDelete={handleDeleteFolder}
      />
    )}
    <div
      className="lm-brutal lm-grid-bg h-[100dvh] overflow-hidden"
      data-pillar="creators"
      style={{ backgroundColor: "var(--lm-surface-0)" }}
      onDragEnter={handleShellDragEnter}
      onDragOver={handleShellDragOver}
      onDragLeave={handleShellDragLeave}
      onDrop={handleShellDrop}
    >
      {/* Drag-and-drop overlay. Inside an open collection it offers the three
          type buckets, which save on release; everywhere else (and anywhere
          outside a bucket) the drop opens the upload form. */}
      {isDraggingFiles && (
        <div
          className="pointer-events-none fixed inset-0 z-[90] flex items-center justify-center p-8 lm-animate-fade-in"
          style={{
            backgroundColor: "var(--lm-scrim)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
          }}
          aria-hidden
        >
          {quickDropTarget ? (
            <div className="flex w-full max-w-[900px] flex-col items-center gap-7 text-center">
              <div className="flex flex-col gap-1.5">
                <span
                  style={{
                    fontFamily: "var(--lm-font)",
                    fontSize: "18px",
                    fontWeight: 900,
                    letterSpacing: "0.04em",
                    color: "var(--lm-text-primary)",
                  }}
                >
                  Drop into {quickDropTarget.label}
                </span>
                <span
                  style={{
                    fontFamily: "var(--lm-font)",
                    fontSize: "11px",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.16em",
                    color: "var(--lm-text-tertiary)",
                  }}
                >
                  {quickDropImpliedTag
                    ? "Type comes from this collection · saves on release"
                    : "Pick what it is · saves on release"}
                </span>
              </div>
              <div className="flex w-full flex-wrap items-stretch justify-center gap-4">
                {quickDropOptions.map(({ tag, label }) => {
                  const isHovered = hoveredDropTag === tag;
                  return (
                    <div
                      key={tag}
                      className="pointer-events-auto flex h-[190px] flex-1 basis-[200px] flex-col items-center justify-center gap-2 transition-colors"
                      style={{
                        maxWidth: "260px",
                        border: `2px dashed ${
                          isHovered
                            ? "var(--lm-coral)"
                            : "var(--lm-border-strong)"
                        }`,
                        borderRadius: "20px",
                        backgroundColor: isHovered
                          ? "var(--lm-accent-dim)"
                          : "transparent",
                      }}
                      onDragEnter={(event) => {
                        if (!dragHasFiles(event)) return;
                        event.preventDefault();
                        setHoveredDropTag(tag);
                      }}
                      onDragOver={(event) => {
                        if (!dragHasFiles(event)) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "copy";
                        if (hoveredDropTag !== tag) setHoveredDropTag(tag);
                      }}
                      onDragLeave={(event) => {
                        if (!dragHasFiles(event)) return;
                        setHoveredDropTag((current) =>
                          current === tag ? null : current,
                        );
                      }}
                      onDrop={(event) => handleBucketDrop(tag, event)}
                    >
                      <span
                        style={{
                          fontFamily: "var(--lm-font)",
                          fontSize: "15px",
                          fontWeight: 900,
                          textTransform: "uppercase",
                          letterSpacing: "0.16em",
                          color: isHovered
                            ? "var(--lm-coral)"
                            : "var(--lm-text-primary)",
                        }}
                      >
                        {label}
                      </span>
                    </div>
                  );
                })}
              </div>
              <span
                style={{
                  fontFamily: "var(--lm-font)",
                  fontSize: "10px",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.14em",
                  color: "var(--lm-text-ghost)",
                }}
              >
                Drop anywhere else for the full form
              </span>
            </div>
          ) : (
            <div
              className="flex flex-col items-center gap-4 px-12 py-10 text-center"
              style={{
                border: "3px dashed var(--lm-coral)",
                borderRadius: "24px",
                backgroundColor: "var(--lm-accent-dim)",
              }}
            >
              <Upload
                className="h-10 w-10"
                style={{ color: "var(--lm-coral)" }}
                strokeWidth={2}
              />
              <div className="flex flex-col gap-1.5">
                <span
                  style={{
                    fontFamily: "var(--lm-font)",
                    fontSize: "18px",
                    fontWeight: 900,
                    letterSpacing: "0.04em",
                    color: "var(--lm-text-primary)",
                  }}
                >
                  Drop to add to your gallery
                </span>
                <span
                  style={{
                    fontFamily: "var(--lm-font)",
                    fontSize: "11px",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.16em",
                    color: "var(--lm-text-tertiary)",
                  }}
                >
                  Images &amp; video · opens the upload form
                </span>
              </div>
            </div>
          )}
        </div>
      )}
      {/* Admin mode badge — fixed top-center, unmistakable indicator */}
      {adminMode && (
        <div
          className="pointer-events-none fixed top-3 left-1/2 z-[80] -translate-x-1/2"
          aria-label="Admin mode"
        >
          <div
            className="pointer-events-auto inline-flex items-center gap-2 px-3 py-1"
            style={{
              backgroundColor: "var(--lm-coral)",
              color: "#000",
              border: "2px solid var(--lm-ink)",
              borderRadius: "999px",
              boxShadow: "var(--shadow-lg)",
              fontFamily: "var(--lm-font)",
              fontSize: "10px",
              fontWeight: 800,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
            }}
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: "#000" }}
            />
            Admin Mode
          </div>
        </div>
      )}

      {/* Skip link */}
      <a
        href="#gallery-main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:px-4 focus:py-2 focus:text-[13px] focus:font-medium"
        style={{
          backgroundColor: "var(--lm-coral)",
          color: "#000",
          borderRadius: "12px",
        }}
      >
        Skip to gallery
      </a>

      {/* Sidebar (desktop only) */}
      <div className="hidden md:block">
        <GallerySidebar
          collapsed={sidebarCollapsed}
          onCollapsedChange={setSidebarCollapsed}
          onUploadClick={openAddModal}
          onFeaturedShelf={
            canManageFoldersInCurrentView
              ? () => setFeaturedPanelOpen(true)
              : undefined
          }
          featuredShelfActive={featuredPanelOpen}
          onStoriesTab={canManageFoldersInCurrentView ? () => { setStoryToOpen(null); setStoriesOpenId(null); setStorybooksView(false); setStoriesView(false); setMoodboardsTab(false); setBookmarksView(false); setMotionView(false); setCinematographyView(false); setStoriesView(true); setViewMode("grid"); } : undefined}
          storiesTabActive={activeStoriesView}
          onMoodboardsTab={canManageFoldersInCurrentView ? () => openMoodboardsTab() : undefined}
          moodboardsTabActive={activeMoodboardsTab}
          onStorybooksTab={
            canManageFoldersInCurrentView
              ? () => {
                  setBookmarksView(false);
                  setMotionView(false);
                  setCinematographyView(false);
                  setStoriesView(false); setMoodboardsTab(false); setStorybooksView(true);
                }
              : undefined
          }
          storybooksTabActive={storybooksView}
          onBookmarksTab={
            canManageFoldersInCurrentView
              ? () => {
                  setStorybooksView(false); setStoriesView(false); setMoodboardsTab(false);
                  setBookmarksView(true);
                  setMotionView(false);
                  setCinematographyView(false);
                }
              : undefined
          }
          bookmarksTabActive={bookmarksView}
          showYouTubeTab={canManageFoldersInCurrentView}
          inboxOpenCount={canManageFoldersInCurrentView ? inboxOpenCount : undefined}
          inboxCountByWorld={canManageFoldersInCurrentView ? inboxCountByWorld : undefined}
          tasksOpenCount={canManageFoldersInCurrentView ? tasksOpenCount : undefined}
          onMotionTab={
            canManageFoldersInCurrentView
              ? () => {
                  setStorybooksView(false); setStoriesView(false); setMoodboardsTab(false);
                  setBookmarksView(false);
                  setMotionView(true);
                  setCinematographyView(false);
                }
              : undefined
          }
          motionTabActive={motionView}
          onCinematographyTab={
            canManageFoldersInCurrentView
              ? () => {
                  setStorybooksView(false); setStoriesView(false); setMoodboardsTab(false);
                  setBookmarksView(false);
                  setMotionView(false);
                  setCinematographyView(true);
                  setViewMode("grid");
                }
              : undefined
          }
          cinematographyTabActive={cinematographyView}
          onSkillsTab={
            canManageFoldersInCurrentView
              ? () => {
                  setStorybooksView(false); setStoriesView(false); setMoodboardsTab(false);
                  setBookmarksView(false);
                  setMotionView(false);
                  setCinematographyView(false);
                  setViewMode("skills");
                }
              : undefined
          }
          skillsTabActive={
            viewMode === "skills" && !storybooksView && !bookmarksView && !extraTabView
          }
          onGalleryHome={() => applyLocation({ route: { kind: "home" } }, "click")}
          user={user}
          onSignOut={onSignOut}
          folders={sidebarFolders}
          selectedFolderId={effectiveSelectedFolderId}
          onFolderSelect={(id) => {
            setStoriesView(false); setMoodboardsTab(false);
            if (id && isSrefCollection(folderNameById.get(id))) {
              setStorybooksView(false); setBookmarksView(false);
              setMotionView(false); setCinematographyView(false);
              setViewMode("grid");
            }
            setSelectedFolderId(id);
          }}
          onAssetsDropOnFolder={
            canManageFoldersInCurrentView ? handleAssetsDropOnFolder : undefined
          }
          onRenameFolder={
            canManageFoldersInCurrentView ? handleRenameFolder : undefined
          }
          onToggleWorld={
            canManageFoldersInCurrentView ? handleToggleWorld : undefined
          }
          onDeleteFolder={
            canManageFoldersInCurrentView ? handleDeleteFolder : undefined
          }
          showcasedFolderIds={showcasedFolderIds}
          onToggleShowcase={
            canManageFoldersInCurrentView ? toggleFolderShowcase : undefined
          }
          featuredFolderIds={featuredFolderIds}
          onToggleFeatured={
            canManageFoldersInCurrentView ? toggleFolderFeatured : undefined
          }
          onCreateSubCollection={
            canManageFoldersInCurrentView ? createSubCollection : undefined
          }
          onCreateCollection={
            canManageFoldersInCurrentView ? createFolder : undefined
          }
          tasteFolderId={tasteFolderId}
          onToggleTaste={
            canManageFoldersInCurrentView ? toggleFolderTaste : undefined
          }
          publicFolderIds={publishedFolderIds}
          onToggleFolderPublic={
            canManageFoldersInCurrentView && canCuratePublic
              ? toggleFolderPublic
              : undefined
          }
          onPreviewShowcase={
            () => window.open(SELECTED_WORK_PATH, "_blank")
          }
          hiddenFolderIds={hiddenFolderIds}
          onToggleHidden={
            canManageFoldersInCurrentView ? toggleFolderHidden : undefined
          }
        />
      </div>

      {/* Main content area (offset by sidebar) */}
      <div
        className="flex h-full min-h-0 flex-col md-sidebar-offset"
        style={{
          marginLeft: contentMarginLeft,
          transition: `margin-left var(--lm-duration-normal) ease-out`,
        }}
      >
        {moodboardPick && ownerUserId && (
          <MoodboardPickBar
            ownerUserId={ownerUserId}
            boardId={moodboardPick.board.id}
            boardName={moodboardPick.board.name}
            selectedIds={pickSelectedIds}
            onBoardCount={moodboardPickDetail ? pickOnBoardIds.size : undefined}
            selectableCount={pickSelectableIds.length}
            onSelectAllVisible={() =>
              setSelectedAssetIds((current) => new Set([...current, ...pickSelectableIds]))
            }
            onClearSelection={clearAssetSelection}
            onAdded={finishMoodboardPick}
            onCancel={finishMoodboardPick}
          />
        )}
        <div className="flex min-h-0 flex-1">
          <div
            className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain"
            style={{}}
          >
            {/* Filter Bar — hidden on the Storybooks tab (asset filters don't
                apply to a storybook masonry). */}
            {!storybooksView && !bookmarksView && !extraTabView && !srefsCollectionView && (
              <GalleryFilterBar
                galleryScope={galleryScope}
                canAccessMyGallery={canAccessMyGallery}
                onGalleryScopeChange={setGalleryScope}
                menuFilters={menuFilterEntries}
                selectedTags={selectedTagsForFilterBar}
                onTagToggle={handleTagToggle}
                excludedFilters={excludedFilters}
                onFilterExcludeToggle={handleFilterExcludeToggle}
                selectedFolderId={effectiveSelectedFolderId}
                onCollectionToggle={handleMenuCollectionToggle}
                onClearAllTags={handleClearAll}
                bookmarksOnly={bookmarksOnly}
                onBookmarksOnlyChange={
                  galleryScope === "mine" && canAccessMyGallery
                    ? setBookmarksOnly
                    : undefined
                }
                canManageMenuFilters={
                  galleryScope === "mine" && canAccessMyGallery
                }
                ownerUserId={ownerUserId}
                likedOnly={likedOnly}
                onLikedOnlyChange={handleLikedOnlyChange}
                showLiked={canManageFoldersInCurrentView}
                mediaKind={mediaKind}
                onMediaKindChange={handleMediaKindChange}
                sortOrder={sortOrder}
                onSortOrderChange={changeSortOrder}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                gridZoom={gridZoom}
                onGridZoomChange={setGridZoom}
                groupSimilar={groupSimilar}
                onGroupSimilarChange={canManageFoldersInCurrentView ? setGroupSimilar : undefined}
                similarity={similarity}
                onSimilarityChange={setSimilarity}
                flattenStacks={flattenStacks}
                onFlattenStacksChange={setFlattenStacks}
                views={
                  viewMode === "grid" && canManageFoldersInCurrentView
                    ? {
                        ownerUserId,
                        presets: savedViews,
                        includeSkills,
                        onIncludeSkillsChange: setIncludeSkills,
                        validFilterIds: validViewFilterIds,
                        validFolderIds: validViewFolderIds,
                        current: {
                          selectedFilterIds: selectedTags as Id<"menuFilters">[],
                          excludedFilterIds: excludedFilters as Id<"menuFilters">[],
                          folderId: (effectiveSelectedFolderId || undefined) as Id<"folders"> | undefined,
                          mediaKind: mediaKind || undefined,
                          onlyLiked: likedOnly,
                          includeSkills,
                          flattenStacks,
                          sortOrder,
                        },
                        onApply: (filters) => {
                          setSelectedTags(filters.selectedFilterIds); setExcludedFilters(filters.excludedFilterIds);
                          setSelectedFolderId(filters.folderId ?? null); setMediaKind(filters.mediaKind ?? null);
                          setLikedOnly(filters.onlyLiked); setIncludeSkills(filters.includeSkills);
                          setFlattenStacks(filters.flattenStacks); changeSortOrder(filters.sortOrder);
                          setSelectedModelName(null); setAssetSearchQuery(""); setSemanticMode(null);
                        },
                      }
                    : undefined
                }
                onPublishAll={
                  viewMode !== "skills" && privateCountArgs
                    ? () => {
                        setPublishAllNotice(null);
                        setPublishAllOpen(true);
                      }
                    : undefined
                }
              />
            )}

            {/* Storybooks shelf — lives on the main page, with its own filters. */}
            {!storybooksView &&
              !bookmarksView &&
              !extraTabView &&
              viewMode === "grid" &&
              canManageFoldersInCurrentView &&
              galleryScope === "mine" &&
              !effectiveSelectedFolderId &&
              selectedTags.length === 0 &&
              excludedFilters.length === 0 &&
              !assetSearchQuery &&
              !likedOnly &&
              shelfBooks.length > 0 && (
                <StorybookShelf
                  mode="shelf"
                  books={shelfBooks}
                  onOpen={setOpenStorybookId}
                  onCreate={createStorybook}
                  onSeeAll={() => {
                    setBookmarksView(false);
                    setMotionView(false);
                    setCinematographyView(false);
                    setStoriesView(false); setMoodboardsTab(false);
                    setStorybooksView(true);
                  }}
                  onDropAssets={handleAssetsDropOnStorybook}
                />
              )}

            {/* Search Vault is now in the bottom dock */}

            {!storybooksView && !bookmarksView && !extraTabView && publishAllNotice && (
              <div className="flex items-center gap-3 px-4 pb-2">
                <p
                  role={publishAllNotice.error ? "alert" : "status"}
                  style={{
                    fontFamily: "var(--lm-font)",
                    fontSize: "10px",
                    fontWeight: 600,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: publishAllNotice.error ? "var(--lm-coral)" : "var(--lm-text-secondary)",
                    margin: 0,
                  }}
                >
                  {publishAllNotice.text}
                </p>
                <button
                  type="button"
                  onClick={() => setPublishAllNotice(null)}
                  aria-label="Dismiss"
                  className="lm-quiet-action"
                  style={{ color: "var(--lm-text-ghost)", fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em" }}
                >
                  OK
                </button>
              </div>
            )}

            {!storybooksView && !bookmarksView && !extraTabView && (semanticMode?.kind === "similar" || semanticError) && (
              <div className="px-4 pb-2">
                <div
                  className="flex flex-col gap-2 rounded-[18px] px-4 py-3 md:flex-row md:items-center md:justify-between"
                  style={{
                    backgroundColor: "rgba(255, 122, 100, 0.08)",
                    border: "2px solid var(--lm-border-strong)",
                  }}
                >
                  <div className="min-w-0">
                    <div
                      style={{
                        fontSize: "10px",
                        fontWeight: 800,
                        letterSpacing: "0.16em",
                        textTransform: "uppercase",
                        color: "var(--lm-text-primary)",
                      }}
                    >
                      {semanticMode?.kind === "similar"
                        ? "Similar Results"
                        : "Semantic Search"}
                    </div>
                    <p
                      className="mt-1"
                      style={{
                        fontSize: "11px",
                        lineHeight: 1.5,
                        color: "var(--lm-text-secondary)",
                        wordBreak: "break-word",
                      }}
                    >
                      {semanticError
                        ? semanticError
                        : semanticMode?.kind === "similar"
                          ? `Showing nearest matches for "${semanticMode.prompt}".`
                          : undefined}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={clearSemanticMode}
                    className="lm-btn-ghost self-start md:self-auto"
                    style={{
                      border: "2px solid var(--lm-border-strong)",
                    }}
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}

            <main
              id="gallery-main-content"
              className="relative min-w-0"
            >
              {!storybooksView && !bookmarksView && !extraTabView && breadcrumbSegments.length > 0 && (
                <BrowseBreadcrumb
                  segments={breadcrumbSegments}
                  trailing={
                    activeCollectionFolder ? (
                      <span className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
                        <CopyLinkButton
                          path={() => currentPath}
                          label="Copy link"
                          className="lm-quiet-action inline-flex items-center gap-1 border-none bg-transparent p-0"
                          style={quietActionStyle}
                        />
                        {viewMode === "grid" && !activeSmartCollectionFilter && (!activeCollectionFolder.parentFolderId || styleBranchWithShelves) && !moodboardsViewActive && !activeWorldPanel && (
                          <CollectionViewActions
                            key={activeCollectionFolder._id}
                            collectionName={activeCollectionFolder.name}
                            childCount={
                              collectionStackViewAvailable && !flattenStacks
                                ? styleBranchWithShelves
                                  ? (styleShelfStacks?.length ?? 0)
                                  : activeChildCollectionCount
                                : 0
                            }
                            expanded={collectionAssetsExpanded}
                            // Collections are one level deep: a style branch
                            // borrows its world's shelves and holds none.
                            canCreateFolder={canManageFoldersInCurrentView && !styleBranchWithShelves}
                            onExpandedChange={(expanded) =>
                              setExpandedCollectionId(
                                expanded ? activeCollectionFolder._id : null,
                              )
                            }
                            onCreateFolder={createFolderInActiveCollection}
                          />
                        )}
                        {viewMode === "grid" && !activeSmartCollectionFilter && canManageFoldersInCurrentView && !moodboardsViewActive && !activeWorldPanel && (
                          <>
                            <input
                              ref={collectionCoverInputRef}
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                event.target.value = "";
                                if (file) void uploadCollectionCover(file);
                              }}
                            />
                            <button
                              type="button"
                              onClick={() =>
                                collectionCoverInputRef.current?.click()
                              }
                              disabled={collectionCoverBusy}
                              title="Upload an image to use as this collection's thumbnail"
                              className="lm-quiet-action border-none bg-transparent p-0"
                              style={{
                                ...quietActionStyle,
                                cursor: collectionCoverBusy ? "default" : "pointer",
                              }}
                            >
                              {collectionCoverBusy
                                ? "Uploading…"
                                : activeCollectionFolder.coverAssetId
                                  ? "Replace thumbnail"
                                  : "Upload thumbnail"}
                            </button>
                          </>
                        )}
                      </span>
                    ) : undefined
                  }
                />
              )}
              {!storybooksView && !bookmarksView && !extraTabView &&
                galleryScope === "mine" && canManageFoldersInCurrentView &&
                ownerUserId && activeCollectionFolder && !srefsCollectionView &&
                (viewMode === "grid" || viewMode === "collections") && (
                <CollectionTabs
                  key={`tabs-${activeCollectionFolder._id}`}
                  ownerUserId={ownerUserId}
                  collectionId={String(activeCollectionFolder._id)}
                  includeChildren={!activeCollectionFolder.parentFolderId}
                  showFolders={Boolean(foldersViewWorldId)}
                  showWorldTabs={Boolean(activeWorldKey)}
                  worldFolderId={activeWorldRoot ? String(activeWorldRoot._id) : undefined}
                  always={browsingWorldFolder || Boolean(worldStyleScope?.atStyleBranch)}
                  active={
                    viewMode === "collections"
                      ? "folders"
                      : activeWorldPanel
                        ? activeWorldPanel
                        : moodboardsViewActive
                          ? "moodboards"
                          : "pieces"
                  }
                  onSelect={(tab) => {
                    // The panel opens on its list; a half-done pick ends.
                    setCollectionBoardToOpen(null);
                    if (tab === "moodboards" && moodboardPick) {
                      setMoodboardPick(null);
                      clearAssetSelection();
                    }
                    setViewMode(tab === "folders" ? "collections" : "grid");
                    setMoodboardsCollectionId(
                      tab === "moodboards" ? activeCollectionFolder._id : null,
                    );
                    setWorldPanel(
                      tab === "docs" || tab === "journal" || tab === "tasks"
                        ? { collectionId: activeCollectionFolder._id, tab }
                        : null,
                    );
                  }}
                />
              )}
              {!storybooksView && !bookmarksView && !extraTabView &&
                viewMode === "grid" && !moodboardsViewActive && !activeWorldPanel &&
                worldStyleScope && worldStyleScope.styles.length > 1 && (
                <StyleScopeSwitcher
                  styles={worldStyleScope.styles}
                  activeStyleId={worldStyleScope.activeStyleId}
                  onSelect={selectStyleScope}
                />
              )}
              {activeMoodboardsTab && ownerUserId ? (
                <MoodboardsTab
                  ownerUserId={ownerUserId}
                  folders={moodboardTabFolders}
                  openBoardId={moodboardsTabBoardId}
                  onOpenBoardChange={setMoodboardsTabBoardId}
                  onOpenAsset={openMoodboardAsset}
                  onChooseFromGallery={(board) => startMoodboardPick(board, null)}
                />
              ) : activeStoriesView && ownerUserId ? (
                <StoriesView key={storyToOpen?._id ?? "stories"} ownerUserId={ownerUserId} initialStory={storyToOpen ?? undefined} openStoryId={storiesOpenId} onOpenStoryChange={setStoriesOpenId} collections={(folders ?? []).map((folder) => ({ _id: String(folder._id), name: folder.name, parentFolderId: folder.parentFolderId ? String(folder.parentFolderId) : undefined, kind: folder.kind }))} />
              ) : motionView && ownerUserId ? (
                <MotionView ownerUserId={ownerUserId} />
              ) : cinematographyView && ownerUserId ? (
                <SkillsView
                  key="cinematography"
                  section="cinematography"
                  ownerUserId={ownerUserId}
                  collections={(folders ?? []).map((folder) => ({
                    _id: String(folder._id),
                    name: folder.name,
                    parentFolderId: folder.parentFolderId
                      ? String(folder.parentFolderId)
                      : undefined,
                  }))}
                  onSkillOpen={setSelectedSkillId}
                  selectedSkillId={selectedSkillId}
                  onImageLoad={markImageLoaded}
                />
              ) : bookmarksView ? (
                <BookmarksView
                  ownerUserId={ownerUserId ?? undefined}
                  folders={(folders ?? []).map((folder) => ({
                    _id: folder._id,
                    name: folder.name,
                    parentFolderId: folder.parentFolderId,
                  }))}
                  resolveEntryBadges={resolveEntryBadges}
                  onImageSelect={handleImageSelect}
                  selectedImageId={selectedImage?.id}
                  onImageLoad={markImageLoaded}
                />
              ) : activeWorldPanel && activeWorldKey && ownerUserId && activeCollectionFolder ? (
                activeWorldPanel === "docs" ? (
                  <WorldInstructionsPanel
                    key={`docs-${activeWorldKey}`}
                    ownerUserId={ownerUserId}
                    worldKey={activeWorldKey}
                    worldName={activeWorldRoot?.name ?? activeCollectionFolder.name}
                    onOpenRef={(ref) => void openWorldRef(ref)}
                    onJump={(tab) => {
                      setMoodboardsCollectionId(
                        tab === "moodboards" ? activeCollectionFolder._id : null,
                      );
                      setWorldPanel(
                        tab === "journal"
                          ? { collectionId: activeCollectionFolder._id, tab }
                          : null,
                      );
                    }}
                  />
                ) : activeWorldPanel === "tasks" && activeWorldRoot ? (
                  <WorldTasksTab
                    key={`tasks-${activeWorldKey}`}
                    ownerUserId={ownerUserId}
                    worldFolderId={activeWorldRoot._id as Id<"folders">}
                    worldKey={activeWorldKey}
                    worldName={activeWorldRoot.name}
                  />
                ) : (
                  <WorldJournalTab
                    key={`journal-${activeWorldKey}`}
                    ownerUserId={ownerUserId}
                    worldKey={activeWorldKey}
                    worldName={activeWorldRoot?.name ?? activeCollectionFolder.name}
                  />
                )
              ) : moodboardsViewActive && ownerUserId && activeCollectionFolder ? (
                <MoodboardsView
                  key={`${activeCollectionFolder._id}-${collectionBoardToOpen ?? "list"}`}
                  initialBoardId={collectionBoardToOpen ?? undefined}
                  onChooseFromGallery={(board) =>
                    startMoodboardPick(board, String(activeCollectionFolder._id))
                  }
                  ownerUserId={ownerUserId}
                  collection={{
                    _id: String(activeCollectionFolder._id),
                    name: activeCollectionFolder.name,
                    parentFolderId: activeCollectionFolder.parentFolderId
                      ? String(activeCollectionFolder.parentFolderId)
                      : undefined,
                    group: activeCollectionFolder.group,
                  }}
                  collections={moodboardWorldCollections}
                  onBack={() => {
                    setCollectionBoardToOpen(null);
                    setMoodboardsCollectionId(null);
                  }}
                  onOpenAsset={openMoodboardAsset}
                />
              ) : srefsCollectionView && ownerUserId && activeCollectionFolder ? (
                <MidjourneySrefsView key={activeCollectionFolder._id} ownerUserId={ownerUserId} folderId={activeCollectionFolder._id as Id<"folders">} />
              ) : storybooksView ? (
                <StorybookShelf
                  mode="grid"
                  books={shelfBooks}
                  onOpen={setOpenStorybookId}
                  onCreate={createStorybook}
                  onDropAssets={handleAssetsDropOnStorybook}
                />
              ) : viewMode === "collections" ? (
                galleryScope === "mine" && canAccessMyGallery ? (
                  <CollectionsGrid
                    collections={
                      foldersViewWorldId
                        ? [
                            ...collectionCards.filter(
                              (card) => card.parentFolderId === foldersViewWorldId,
                            ),
                            // The world's storybooks, under their own group.
                            ...(storybookChildrenByWorld.get(foldersViewWorldId) ?? []),
                          ]
                        : collectionCards
                    }
                    grouped={Boolean(foldersViewWorldId)}
                    onOpenCollection={openCollectionFromCard}
                    onRenameCollection={
                      canManageFoldersInCurrentView
                        ? handleRenameFolder
                        : undefined
                    }
                    loading={collectionSummaries === undefined}
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center min-h-[50vh] px-8 py-12 text-center lm-animate-fade-in">
                    <p
                      style={{
                        fontFamily: "var(--lm-font)",
                        fontSize: "11px",
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.12em",
                        color: "var(--lm-text-tertiary)",
                      }}
                    >
                      SWITCH TO MY GALLERY TO BROWSE COLLECTIONS.
                    </p>
                  </div>
                )
              ) : viewMode === "skills" ? (
                galleryScope === "mine" && canAccessMyGallery ? (
                  <SkillsView
                    key="skills"
                    ownerUserId={ownerUserId}
                    collections={(folders ?? []).map((folder) => ({
                      _id: String(folder._id),
                      name: folder.name,
                      parentFolderId: folder.parentFolderId
                        ? String(folder.parentFolderId)
                        : undefined,
                    }))}
                    onSkillOpen={setSelectedSkillId}
                    selectedSkillId={selectedSkillId}
                    onImageLoad={markImageLoaded}
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center min-h-[50vh] px-8 py-12 text-center lm-animate-fade-in">
                    <p
                      style={{
                        fontFamily: "var(--lm-font)",
                        fontSize: "11px",
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.12em",
                        color: "var(--lm-text-tertiary)",
                      }}
                    >
                      SWITCH TO MY GALLERY TO BROWSE SKILLS.
                    </p>
                  </div>
                )
              ) : isLoading ? (
                <MasonryGrid
                  images={[]}
                  loading
                  compactColumns={false}
                  onImageSelect={handleImageSelect}
                  onImageLoad={markImageLoaded}
                />
              ) : hasImages || showGroupedChildStacks ? (
                <>
                  {showGroupedChildStacks && (
                    <CollectionStackGroups
                      sections={groupedChildSections}
                      separated={hasImages}
                      renderGrid={(entries) => (
                        <MasonryGrid
                          images={entries}
                          compactColumns={false}
                          onImageSelect={handleImageSelect}
                          onImageLoad={markImageLoaded}
                          onCollectionOpen={handleCardCollectionOpen}
                          onStorybookOpen={setOpenStorybookId}
                          zoom={gridZoom}
                        />
                      )}
                    />
                  )}
                  {hasImages && (() => {
                  const renderMainGrid = (entries: typeof images, last = true) => (
                  <MasonryGrid
                    images={entries}
                    // The desktop expanded view is a full-screen opaque
                    // overlay, so nothing behind it is visible — re-flowing
                    // the grid into compact columns (and dimming every card)
                    // would relayout + repaint the whole mounted list for
                    // pixels no one sees, on the exact frame the overlay is
                    // trying to fade in.
                    compactColumns={false}
                    onImageSelect={handleImageSelect}
                    onImageLoad={markImageLoaded}
                    canDelete={canDeleteInCurrentView}
                    deletingImageId={deletingAssetId}
                    exitingImageIds={exitingAssetIds}
                    onDeleteImage={handleCardDelete}
                    selectable={canCuratePublic || canManageFoldersInCurrentView}
                    selectedAssetIds={selectedAssetIds}
                    onToggleAssetSelect={toggleAssetSelection}
                    onReplaceSelection={replaceAssetSelection}
                    likeable={canManageFoldersInCurrentView}
                    onToggleLike={handleCardToggleLike}
                    starrable={canManageFoldersInCurrentView}
                    onToggleStar={handleCardToggleStar}
                    draggableAssets={canManageFoldersInCurrentView}
                    onAssetDragStart={handleAssetDragStart}
                    collections={
                      canManageFoldersInCurrentView ? cardCollections : undefined
                    }
                    onMoveAssetToCollection={
                      canManageFoldersInCurrentView ? moveAssetToFolder : undefined
                    }
                    onCopyAssetToCollection={
                      canManageFoldersInCurrentView ? copyAssetToFolder : undefined
                    }
                    onRemoveAssetFromCollection={
                      canManageFoldersInCurrentView
                        ? removeAssetFromFolder
                        : undefined
                    }
                    onCreateCollection={
                      canManageFoldersInCurrentView ? createFolder : undefined
                    }
                    onRenameCollection={
                      canManageFoldersInCurrentView
                        ? handleRenameFolder
                        : undefined
                    }
                    // Owner-only: tag chips on card hover, click to remove.
                    onRemoveAssetTag={
                      canManageFoldersInCurrentView
                        ? handleCardRemoveTag
                        : undefined
                    }
                    // One click on hover drops the piece from whatever the
                    // grid is scoped to — "not relevant here".
                    onExcludeAssetFromView={
                      excludeScope ? excludeAssetFromCurrentView : undefined
                    }
                    excludeLabel={excludeScope?.label}
                    excludeFolderId={excludeScope?.folderId}
                    onStorybookOpen={setOpenStorybookId}
                    onCollectionOpen={handleCardCollectionOpen}
                    onAddAssetToMoodboard={
                      canManageFoldersInCurrentView ? addAssetToMoodboard : undefined
                    }
                    markedAssetIds={moodboardPick ? pickOnBoardIds : undefined}
                    markedLabel="On board"
                    showPublicBadge={galleryScope === "mine"}
                    onEndReached={
                      last && anyPaginationActive && activePagedAssets.status !== "Exhausted"
                        ? loadNextGalleryPage : undefined
                    }
                    zoom={gridZoom}
                  />
                  );
                  return similarView ? (
                    <SimilarGroups
                      ownerUserId={ownerUserId}
                      images={images}
                      clusters={similarView.clusters}
                      hashedCount={similarView.hashedCount}
                      world={similarWorld}
                      renderGrid={renderMainGrid}
                      onSelect={canManageFoldersInCurrentView ? replaceAssetSelection : undefined}
                    />
                  ) : renderMainGrid(images);
                  })()}
                </>
              ) : isNoMatches ? (
                <div
                  className="flex flex-col items-center justify-center min-h-[50vh] px-8 py-12 text-center lm-animate-fade-in"
                  aria-live="polite"
                >
                  <div
                    className="flex items-center justify-center mb-5"
                    style={{
                      width: "52px",
                      height: "52px",
                      border: "3px solid var(--lm-ink)",
                      backgroundColor:
                        "var(--lm-accent-dim)",
                      boxShadow: "0 0 16px rgba(255, 122, 100, 0.15)",
                      borderRadius: "12px",
                    }}
                  >
                    <SearchIcon
                      className="h-5 w-5"
                      style={{
                        color: "var(--lm-coral)",
                      }}
                    />
                  </div>
                  <h2
                    style={{
                      fontFamily: "var(--lm-font)",
                      fontSize: "16px",
                      fontWeight: 900,
                      textTransform: "uppercase",
                      letterSpacing: "0.18em",
                      color: "var(--lm-text-primary)",
                    }}
                  >
                    NO MATCHES FOUND
                  </h2>
                  <p
                    className="mt-2"
                    style={{
                      fontFamily: "var(--lm-font)",
                      fontSize: "11px",
                      textTransform: "uppercase",
                      letterSpacing: "0.10em",
                      color: "var(--lm-text-tertiary)",
                      maxWidth: "320px",
                      fontWeight: 500,
                    }}
                  >
                    ADJUST FILTERS OR SEARCH TERMS TO FIND
                    WHAT YOU ARE LOOKING FOR.
                  </p>
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
                    {effectiveSelectedFolderId && (
                      <span
                        className="lm-chip"
                        style={{ borderRadius: "12px" }}
                      >
                        {folderNameById.get(
                          effectiveSelectedFolderId,
                        ) ?? "FOLDER"}
                      </span>
                    )}
                    {selectedModelName && (
                      <span
                        className="lm-chip"
                        style={{ borderRadius: "12px" }}
                      >
                        {selectedModelName}
                      </span>
                    )}
                    {selectedTags.length > 0 && (
                      <span
                        className="lm-chip"
                        style={{ borderRadius: "12px" }}
                      >
                        {selectedTags.length} TAG
                        {selectedTags.length > 1
                          ? "S"
                          : ""}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleClearFilters}
                    className="lm-btn-brutal mt-6"
                    style={{ borderRadius: "12px" }}
                  >
                    CLEAR ALL FILTERS
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center min-h-[50vh] px-8 py-12 text-center lm-animate-fade-in">
                  {/* Stacked frames with softer radius */}
                  <div className="relative mb-6 h-20 w-20">
                    <div
                      className="absolute inset-2 rotate-[-6deg]"
                      style={{
                        border: "2px solid var(--lm-border-strong)",
                        backgroundColor:
                          "var(--lm-surface-1)",
                        borderRadius: "12px",
                      }}
                    />
                    <div
                      className="absolute inset-1 rotate-[3deg]"
                      style={{
                        border: "2px solid var(--lm-border-strong)",
                        backgroundColor:
                          "var(--lm-surface-2)",
                        borderRadius: "12px",
                      }}
                    />
                    <div
                      className="absolute inset-0 flex items-center justify-center"
                      style={{
                        border: "3px solid var(--lm-ink)",
                        backgroundColor:
                          "var(--lm-surface-3)",
                        boxShadow: "0 0 16px rgba(255, 122, 100, 0.15)",
                        borderRadius: "12px",
                      }}
                    >
                      <Plus
                        className="h-5 w-5"
                        style={{
                          color: "var(--lm-coral)",
                        }}
                      />
                    </div>
                  </div>
                  <h2
                    style={{
                      fontFamily: "var(--lm-font)",
                      fontSize: "18px",
                      fontWeight: 900,
                      textTransform: "uppercase",
                      letterSpacing: "0.18em",
                      color: "var(--lm-text-primary)",
                    }}
                  >
                    START YOUR COLLECTION
                  </h2>
                  <p
                    className="mt-2"
                    style={{
                      fontFamily: "var(--lm-font)",
                      fontSize: "11px",
                      textTransform: "uppercase",
                      letterSpacing: "0.10em",
                      color: "var(--lm-text-tertiary)",
                      maxWidth: "360px",
                      fontWeight: 500,
                    }}
                  >
                    ADD YOUR FIRST REFERENCE IMAGE TO BEGIN
                    BUILDING YOUR CREATIVE LIBRARY.
                  </p>
                  <button
                    type="button"
                    onClick={openAddModal}
                    className="lm-btn-brutal mt-6"
                    style={{ borderRadius: "12px" }}
                  >
                    <Plus className="h-4 w-4" />
                    ADD IMAGE
                  </button>
                </div>
              )}
            </main>
          </div>

        </div>
      </div>

      {/* Desktop expanded view — cardless: the image + details float directly
          on the dark canvas, no modal window. */}
      {selectedImage && (
        <div
          className="fixed inset-0 z-[70] hidden md:block"
          role="dialog"
          aria-modal="true"
          aria-label="Selected image details"
        >
          {/* No backdrop-filter here: at 0.992 alpha the blur is invisible,
              but it forces a full-viewport blur pass over the whole gallery
              behind it on every frame of the fade — the single most
              expensive thing in the open animation. */}
          <div
            className="absolute inset-0 animate-fade-in"
            style={{
              backgroundColor: "var(--lm-overlay-canvas)",
              willChange: "opacity",
            }}
            onClick={closeSelectedImage}
            aria-hidden="true"
          />
          <div
            className="relative z-10 h-full w-full animate-fade-in"
            style={{ willChange: "opacity" }}
          >
            <GalleryDetailPanel
              image={selectedImageLive ?? selectedImage}
              carouselImages={carouselImages}
              slideIndex={slideIndex}
              onSlideIndexChange={setSlideIndex}
              variant="modal"
              {...expandedDetailProps}
            />
          </div>
        </div>
      )}

      {/* Mobile detail sheet */}
      {selectedImage && (
        <div
          className="fixed inset-0 z-[65] md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Selected image details"
        >
          <div
            className={`absolute inset-0 bg-[var(--lm-scrim)] ${sheetDismissing ? "animate-fade-out" : "animate-fade-in"}`}
            onClick={closeSelectedImage}
            aria-hidden="true"
          />
          <div
            ref={mobileDetailRef}
            tabIndex={-1}
            className={`absolute inset-x-0 bottom-0 h-[88dvh] ${sheetDismissing ? "animate-sheet-slide-down-v7" : "animate-sheet-slide-up-v7"}`}
            style={{
              backgroundColor: "var(--lm-surface-1)",
              borderTop: "3px solid var(--lm-ink)",
              borderTopLeftRadius: "20px",
              borderTopRightRadius: "20px",
              transform:
                sheetDragY > 0
                  ? `translateY(${sheetDragY}px)`
                  : undefined,
              transition:
                sheetDragY > 0 ? "none" : undefined,
              paddingBottom: "env(safe-area-inset-bottom)",
            }}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div
                style={{
                  height: "4px",
                  width: "40px",
                  backgroundColor: "var(--lm-ink)",
                  borderRadius: "12px",
                }}
              />
            </div>
            <div className="h-[calc(100%-20px)] overflow-y-auto">
              <GalleryDetailPanel
                image={selectedImageLive ?? selectedImage}
                carouselImages={carouselImages}
                slideIndex={slideIndex}
                onSlideIndexChange={setSlideIndex}
                {...expandedDetailProps}
              />
            </div>
          </div>
        </div>
      )}

      {/* Mobile bottom nav */}
      {!selectedImage && (
        <MobileBottomNav
          onAddClick={openAddModal}
          onSearchClick={() => setBrowseSheetOpen(true)}
          searchActive={browseSheetOpen}
          onHomeClick={() => applyLocation({ route: { kind: "home" } }, "click")}
          onMoodboardsClick={canManageFoldersInCurrentView ? () => openMoodboardsTab() : undefined}
          moodboardsActive={activeMoodboardsTab}
          inboxOpenCount={canManageFoldersInCurrentView ? inboxOpenCount : undefined}
          user={user}
          onSignOut={onSignOut}
        />
      )}

      {/* Phone: the browse sheet behind the Search tab. Rows go through the
          same routes the sidebar and the address bar use. */}
      {canAccessMyGallery && galleryScope === "mine" && (
        <MobileBrowseSheet
          open={browseSheetOpen}
          onClose={() => setBrowseSheetOpen(false)}
          folders={collectionFoldersWithCounts}
          selectedFolderId={effectiveSelectedFolderId ?? null}
          onFolderSelect={(id) => {
            const folder = id ? collectionFoldersWithCounts.find((entry) => entry._id === id) : undefined;
            applyLocation({ route: folder ? collectionRoute(collectionFoldersWithCounts, folder) : { kind: "home" } }, "click");
          }}
          inboxCountByWorld={inboxCountByWorld}
          onSearchPieces={(query) => {
            applyLocation({ route: { kind: "home" } }, "click");
            setAssetSearchQuery(query);
            setSemanticError(undefined);
            if (semanticMode?.kind === "similar") {
              setSemanticMode(null);
              setSemanticResults(null);
            }
          }}
          sections={browseSections}
        />
      )}

      {/* Collection-move feedback chip — outlives the bulk toolbar */}
      {moveStatus && (
        <div
          className="fixed z-[70] flex justify-center pointer-events-none"
          style={{
            left: sidebarCollapsed
              ? "var(--lm-sidebar-collapsed)"
              : "var(--lm-sidebar-width)",
            right: "0",
            bottom: "56px",
          }}
          role={moveStatus.error ? "alert" : "status"}
        >
          <div
            className="px-4 py-2"
            style={{
              backgroundColor: "var(--lm-surface-1)",
              border: `2px solid ${moveStatus.error ? "var(--lm-coral)" : "var(--lm-ink)"}`,
              borderRadius: "12px",
              boxShadow: "var(--shadow-lg)",
              fontFamily: "var(--lm-font)",
              fontSize: "11px",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: moveStatus.error
                ? "var(--lm-coral)"
                : "var(--lm-text-primary)",
            }}
          >
            {moveStatus.text}
          </div>
        </div>
      )}

      <PublishAllDialog
        open={publishAllOpen}
        onClose={() => setPublishAllOpen(false)}
        viewLabel={publishAllViewLabel}
        filtered={publishAllFiltered}
        countArgs={privateCountArgs}
        onPublished={handlePublished}
      />

      {/* Bulk selection toolbar — visible only when selection is non-empty */}
      {(canCuratePublic || canManageFoldersInCurrentView) && !moodboardPick &&
        (selectedAssetIds.size > 0 || bulkDeleteProgress) && (
        <div
          className={`fixed left-4 right-4 z-[55] flex justify-center pointer-events-none md:right-0 ${sidebarCollapsed ? "md:left-[var(--lm-sidebar-collapsed)]" : "md:left-[var(--lm-sidebar-width)]"}`}
          style={{
            bottom: "104px",
            transition:
              "left var(--lm-duration-normal) ease-out, right var(--lm-duration-normal) ease-out",
          }}
          role="region"
          aria-label="Bulk curation toolbar"
          aria-busy={Boolean(bulkDeleteProgress)}
        >
          <div
            className="pointer-events-auto flex flex-col gap-2 px-4 py-3"
            style={{
              backgroundColor: "var(--lm-surface-1)",
              border: "2px solid var(--lm-ink)",
              borderRadius: "16px",
              boxShadow: "var(--shadow-lg)",
              maxWidth: "min(640px, calc(100vw - 32px))",
            }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="inline-flex items-center px-2.5 py-1"
                style={{
                  backgroundColor: "var(--lm-coral)",
                  color: "#000",
                  borderRadius: "10px",
                  fontFamily: "var(--lm-font)",
                  fontSize: "11px",
                  fontWeight: 800,
                  letterSpacing: "0.10em",
                  textTransform: "uppercase",
                }}
              >
                {selectedAssetIds.size} selected
              </span>
              {/* The gestures are invisible otherwise — nothing on a card
                  suggests that shift extends or that empty space boxes. */}
              <span
                className="hidden md:inline"
                style={{
                  fontFamily: "var(--lm-font)",
                  fontSize: "10.5px",
                  color: "var(--lm-text-ghost)",
                }}
              >
                Shift-click a range · shift-drag to box · ⌘A all · Esc to clear
              </span>
              {selectedAssetIds.size < allVisibleAssetIds.length && (
                <button
                  type="button"
                  onClick={selectAllVisibleAssets}
                  disabled={bulkCurationLoading || bulkActionLoading}
                  className="lm-btn-ghost inline-flex items-center gap-1.5"
                  style={{
                    border: "2px solid var(--lm-border-strong)",
                    borderRadius: "10px",
                    padding: "6px 12px",
                    fontSize: "11px",
                    opacity:
                      bulkCurationLoading || bulkActionLoading ? 0.55 : 1,
                    cursor:
                      bulkCurationLoading || bulkActionLoading
                        ? "not-allowed"
                        : "pointer",
                  }}
                  aria-label={`Select all ${allVisibleAssetIds.length} visible assets`}
                >
                  SELECT ALL ({allVisibleAssetIds.length})
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  void downloadSelectedAssets();
                }}
                disabled={bulkCurationLoading || bulkActionLoading}
                className="lm-btn-ghost inline-flex items-center gap-1.5"
                style={{
                  border: "2px solid var(--lm-border-strong)",
                  borderRadius: "10px",
                  padding: "6px 12px",
                  fontSize: "11px",
                  opacity: bulkCurationLoading || bulkActionLoading ? 0.55 : 1,
                  cursor:
                    bulkCurationLoading || bulkActionLoading
                      ? "not-allowed"
                      : "pointer",
                }}
                aria-label="Download selected assets"
              >
                {bulkActionLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                DOWNLOAD
              </button>
              {canManageFoldersInCurrentView && (
                <button
                  type="button"
                  onClick={() => setAddToPanelOpen(true)}
                  disabled={
                    bulkCurationLoading ||
                    bulkActionLoading ||
                    bulkAddBusy
                  }
                  className="lm-btn-ghost inline-flex items-center gap-1.5"
                  style={{
                    border: "2px solid var(--lm-border-strong)",
                    borderRadius: "10px",
                    padding: "6px 12px",
                    fontSize: "11px",
                    opacity:
                      bulkCurationLoading ||
                      bulkActionLoading ||
                      bulkAddBusy
                        ? 0.55
                        : 1,
                    cursor:
                      bulkCurationLoading ||
                      bulkActionLoading ||
                      bulkAddBusy
                        ? "not-allowed"
                        : "pointer",
                  }}
                  aria-haspopup="dialog"
                  aria-expanded={addToPanelOpen}
                  aria-label="Move selected assets to collections"
                  title="Add the selection to worlds and collections, or take it out of them"
                >
                  {bulkAddBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <FolderPlus className="h-3.5 w-3.5" />
                  )}
                  MOVE TO
                </button>
              )}
              {canManageFoldersInCurrentView && (
                <button
                  type="button"
                  data-moodboard-picker-trigger
                  onClick={(event) => {
                    const anchor = event.currentTarget.getBoundingClientRect();
                    setMoodboardPicker((current) =>
                      current
                        ? null
                        : { assetIds: Array.from(selectedAssetIds), anchor },
                    );
                  }}
                  disabled={bulkCurationLoading || bulkActionLoading}
                  className="lm-btn-ghost inline-flex items-center gap-1.5"
                  style={{
                    border: "2px solid var(--lm-border-strong)",
                    borderRadius: "10px",
                    padding: "6px 12px",
                    fontSize: "11px",
                    opacity: bulkCurationLoading || bulkActionLoading ? 0.55 : 1,
                  }}
                  aria-haspopup="menu"
                  aria-expanded={Boolean(moodboardPicker)}
                  aria-label="Add selected assets to a moodboard"
                  title="Add the selection to a moodboard"
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                  ADD TO MOODBOARD
                </button>
              )}
              {canManageFoldersInCurrentView && ([true, false] as const).map((isLiked) => (
                <button
                  key={String(isLiked)}
                  type="button"
                  onClick={() => { void likeSelectedAssets(isLiked); }}
                  disabled={bulkCurationLoading || bulkActionLoading || Boolean(deletingAssetId) || bulkAddBusy}
                  className="lm-btn-ghost inline-flex items-center gap-1.5"
                  style={{ border: "2px solid var(--lm-border-strong)", borderRadius: "10px", padding: "6px 12px", fontSize: "11px" }}
                  aria-label={isLiked ? "Like selected assets" : "Unlike selected assets"}
                >
                  {bulkLikeState === isLiked ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isLiked ? <Heart className="h-3.5 w-3.5" /> : <HeartOff className="h-3.5 w-3.5" />}
                  {isLiked ? "LIKE SELECTED" : "UNLIKE SELECTED"}
                </button>
              ))}
              {canDeleteInCurrentView && (
                <button
                  type="button"
                  onClick={() => { void deleteSelectedAssets(); }}
                  disabled={bulkCurationLoading || bulkActionLoading || Boolean(deletingAssetId) || bulkAddBusy}
                  className="lm-btn-ghost inline-flex items-center gap-1.5"
                  style={{
                    border: "2px solid var(--lm-coral)",
                    color: "var(--lm-coral)",
                    borderRadius: "10px",
                    padding: "6px 12px",
                    fontSize: "11px",
                  }}
                  aria-label="Delete selected assets"
                >
                  {bulkDeleteProgress ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  {bulkDeleteProgress ? `DELETING ${bulkDeleteProgress.completed}/${bulkDeleteProgress.total}` : "DELETE SELECTED"}
                </button>
              )}
              {canCuratePublic && (
              <>
              <button
                type="button"
                onClick={() => {
                  void runBulkCuration(true, undefined, true);
                }}
                disabled={bulkCurationLoading || bulkActionLoading}
                className="lm-btn-brutal inline-flex items-center gap-1.5"
                style={{
                  borderRadius: "10px",
                  padding: "6px 12px",
                  fontSize: "11px",
                  opacity: bulkCurationLoading || bulkActionLoading ? 0.55 : 1,
                  cursor: bulkCurationLoading || bulkActionLoading ? "not-allowed" : "pointer",
                }}
                aria-label="Feature selected assets on the public taste profile"
                title="Feature on the taste profile (also makes them public)"
              >
                {bulkCurationLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Star className="h-3.5 w-3.5" />
                )}
                FEATURE
              </button>
              <button
                type="button"
                onClick={() => {
                  void runBulkCuration(true);
                }}
                disabled={bulkCurationLoading || bulkActionLoading}
                className="lm-btn-brutal inline-flex items-center gap-1.5"
                style={{
                  borderRadius: "10px",
                  padding: "6px 12px",
                  fontSize: "11px",
                  opacity: bulkCurationLoading || bulkActionLoading ? 0.55 : 1,
                  cursor: bulkCurationLoading || bulkActionLoading ? "not-allowed" : "pointer",
                }}
                aria-label="Make selected assets public"
              >
                {bulkCurationLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
                MAKE PUBLIC
              </button>
              <button
                type="button"
                onClick={() => {
                  void runBulkCuration(false);
                }}
                disabled={bulkCurationLoading || bulkActionLoading}
                className="lm-btn-ghost inline-flex items-center gap-1.5"
                style={{
                  border: "2px solid var(--lm-border-strong)",
                  borderRadius: "10px",
                  padding: "6px 12px",
                  fontSize: "11px",
                  opacity: bulkCurationLoading || bulkActionLoading ? 0.55 : 1,
                  cursor: bulkCurationLoading || bulkActionLoading ? "not-allowed" : "pointer",
                }}
                aria-label="Make selected assets private"
              >
                {bulkCurationLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5" />
                )}
                MAKE PRIVATE
              </button>
              </>
              )}
              <button
                type="button"
                onClick={clearAssetSelection}
                disabled={bulkCurationLoading || bulkActionLoading}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5"
                style={{
                  border: "2px solid var(--lm-border-strong)",
                  borderRadius: "10px",
                  fontSize: "11px",
                  fontFamily: "var(--lm-font)",
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--lm-text-secondary)",
                  backgroundColor: "transparent",
                  cursor: bulkCurationLoading || bulkActionLoading ? "not-allowed" : "pointer",
                }}
                aria-label="Clear selection"
              >
                <X className="h-3.5 w-3.5" />
                CLEAR
              </button>
            </div>
            {(bulkCurationError || bulkCurationStatus) && (
              <p
                style={{
                  fontFamily: "var(--lm-font)",
                  fontSize: "10px",
                  fontWeight: 600,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: bulkCurationError
                    ? "var(--lm-coral)"
                    : "var(--lm-text-secondary)",
                  margin: 0,
                }}
                role={bulkCurationError ? "alert" : "status"}
              >
                {bulkCurationError ?? bulkCurationStatus}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Desktop bottom dock — centered to content area */}
      <div
        className="fixed bottom-6 z-50 hidden md:flex justify-center pointer-events-none"
        style={{
          left: sidebarCollapsed
            ? "var(--lm-sidebar-collapsed)"
            : "var(--lm-sidebar-width)",
          right: "0",
          transition:
            "left var(--lm-duration-normal) ease-out, right var(--lm-duration-normal) ease-out",
        }}
      >
        <div className="pointer-events-auto">
          <BottomMenu
            user={user}
            onAddClick={openAddModal}
            onHomeClick={() => {
              document
                .getElementById("gallery-main-content")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            onResetClick={() => {
              handleClearFilters();
              clearSemanticMode();
            }}
            onSignOut={onSignOut}
            searchValue={assetSearchQuery}
            onSearchChange={(query) => {
              setAssetSearchQuery(query);
              setSemanticError(undefined);
              if (query.trim().length > 0 && semanticMode?.kind === "similar") {
                setSemanticMode(null);
                setSemanticResults(null);
              }
            }}
            onSearchClear={clearSemanticMode}
            searchPlaceholder="SEARCH VAULT..."
            searchLoading={semanticLoading}
          />
        </div>
      </div>

      {/* Modals */}
      <UploadModal
        open={isUploadOpen}
        onClose={closeUploadModal}
        availableTags={availableUploadTags}
        folders={folders ?? []}
        ownerUserId={
          canAccessMyGallery ? ownerUserId : undefined
        }
        canPromoteToPublic={canCuratePublic}
        initialFiles={uploadInitialFiles}
      />

      <CinemaModal
        asset={selectedCinemaAsset}
        onClose={() => setSelectedCinemaAsset(null)}
      />

      <SkillModal
        skillId={selectedSkillId}
        ownerUserId={ownerUserId}
        onClose={() => setSelectedSkillId(null)}
      />

      <StorybookModal
        ownerUserId={ownerUserId}
        storybookId={openStorybookId}
        worldName={
          openStorybookId
            ? storybookWorldById.get(openStorybookId)?.name
            : undefined
        }
        // A piece cited in the record opens the detail panel over the book,
        // through the address (/storybooks/<id>?asset=<id>).
        onOpenAsset={(assetId) => {
          if (!openStorybookId) return;
          applyLocation({ route: { kind: "storybooks", id: openStorybookId }, asset: assetId }, "click");
        }}
        suspended={Boolean(selectedImage)}
        onClose={() => setOpenStorybookId(null)}
      />

      {canAccessMyGallery && (
        <FeaturedPanel
          ownerUserId={ownerUserId}
          open={featuredPanelOpen}
          onClose={() => setFeaturedPanelOpen(false)}
          onOpenAsset={(assetId) => {
            setFeaturedPanelOpen(false);
            const match = images.find((image) => image.id === assetId);
            if (match) setSelectedImage(match as unknown as SelectedImage);
          }}
        />
      )}

      {canAccessMyGallery && moodboardPicker && (
        <MoodboardPicker
          ownerUserId={ownerUserId}
          assetIds={moodboardPicker.assetIds}
          anchor={moodboardPicker.anchor}
          currentFolderId={effectiveSelectedFolderId}
          collections={(folders ?? []).map((folder) => ({
            _id: String(folder._id),
            name: folder.name,
            parentFolderId: folder.parentFolderId
              ? String(folder.parentFolderId)
              : undefined,
            kind: folder.kind,
          }))}
          onClose={closeMoodboardPicker}
        />
      )}

      {canAccessMyGallery && (
        <AddToPanel
          open={addToPanelOpen}
          onClose={() => setAddToPanelOpen(false)}
          selectedAssetIds={selectedAssetIdList}
          collections={panelCollections}
          onAddToFolder={addAssetsToFolder}
          onToggleFolder={toggleSelectedFolder}
          onRemoveFromFolder={removeSelectedFromFolder}
          onCreateCollection={createCollectionFromAssets}
          onCreateSubCollection={createSubCollectionFromAssets}
          onUpdateDescription={updateFolderDescription}
        />
      )}
    </div>
    </CoralToastProvider>
  );
}
