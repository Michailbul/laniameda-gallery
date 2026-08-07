"use client";

import "@/app/tokens.css";
import {
  type CollectionSectionKey,
  collectionSectionBadgeLabel,
  compareCollectionSectionNames,
  normalizeCollectionSection,
  sectionKeyForTagName,
} from "@/lib/collection-sections";

import {
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useAction,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { Check, Download, Eye, EyeOff, FolderPlus, Layers, Loader2, Minus, Plus, Search as SearchIcon, Star, Upload, X } from "lucide-react";
import { useUploadFile } from "@convex-dev/r2/react";
import { downloadImagesAsZip } from "@/lib/download-image";
import { buildUploadFormData } from "@/lib/upload-form";
import { buildIngestKey } from "@/lib/ingest";
import {
  LARGE_IMAGE_BYTES,
  appendImageUploadFields,
  uploadImageToR2,
} from "@/lib/image-ingest";
import { isZipFile, readDroppedFiles, resolveMedia } from "@/lib/bulk-upload";
import { TASTE_PROFILE_PATH } from "@/lib/routes";
import { CoralToastProvider, useCoralToast } from "@/components/ui/coral-toast";
import BottomMenu from "@/components/ui/bottom-menu";
import { GallerySidebar } from "./sidebar";
import {
  GalleryFilterBar,
  type GalleryScope,
  type SortOrder,
  type ViewMode,
} from "./filter-bar";
import { MasonryGrid } from "@/components/masonry-grid";
import { WorkflowGrid } from "./workflow-grid";
import { CollectionsGrid } from "./collections-grid";
import {
  BrowseBreadcrumb,
  type BreadcrumbSegment,
} from "./browse-breadcrumb";
import { ProjectSectionTabs } from "./project-section-tabs";
import { FeaturedPanel } from "./featured-panel";
import {
  GalleryDetailPanel,
  type AssetFilingTarget,
  type AssetMembership,
} from "./detail-panel";
import { WorkflowModal } from "./workflow-modal";
import { StorybookModal } from "./storybook-modal";
import { ReviewModal } from "./review-modal";
import { UploadModal } from "@/components/upload-modal";
import type { UploadWorld } from "@/components/upload-panel";
import { CinemaModal, type CinemaModalAsset } from "./cinema-modal";
import { SeedanceIngestModal } from "@/components/seedance-ingest-modal";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { useSwipeGesture } from "@/lib/use-swipe-gesture";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import {
  buildGalleryEntries,
  type GalleryEntry,
  type GalleryEntryPreview,
} from "@/lib/gallery-entries";
import { canActorAccessByUserId, parseUserIdList } from "@/lib/identity";
import { writeAssetDragPayload } from "@/lib/asset-drag";
import {
  AddToPanel,
  type PanelCollection,
  type PanelSection,
  type PanelWorld,
} from "./add-to-panel";
import {
  resolveAccessibleGalleryScope,
  resolveScopeFolderFilter,
} from "@/lib/gallery-filters";

// The world sections an asset can be filed into, in narrative order. Section
// pools are created on demand, so these are offered whether or not the folder
// behind them exists yet.
const PANEL_SECTIONS: { key: PanelSection; label: string }[] = [
  { key: "beats", label: "Beats" },
  { key: "characters", label: "Characters" },
  { key: "locations", label: "Locations" },
  { key: "stills", label: "Stills" },
];

type SelectedImage = {
  id: string;
  packId?: string;
  galleryItemId?: string;
  galleryItemType?: "asset" | "pack" | "design" | "workflow" | "storybook" | "beat" | "collection";
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
  previewImages?: GalleryEntryPreview[];
};

type SemanticGalleryAsset = FunctionReturnType<
  typeof api.semanticSearch.searchAssets
>[number];

type SemanticMode =
  | { kind: "query"; query: string }
  | { kind: "similar"; assetId: string; prompt: string }
  | null;

// The project view's section switcher. "all" is the whole pool; the named
// sections mirror projectCollections.section, and "unsorted" catches members
// that were never filed so nothing is unreachable.
type ProjectSectionTab =
  | "all"
  | "beats"
  | "characters"
  | "locations"
  | "stills"
  | "unsorted";

// Always offered, in narrative order, so the switcher doesn't shift around as
// a project fills up. Stills/Unsorted are conditional — see projectSectionTabs.
const PROJECT_SECTION_TABS: {
  key: ProjectSectionTab;
  label: string;
  /** Hide until the project actually has members here. */
  onlyWhenPresent?: boolean;
}[] = [
  { key: "all", label: "All" },
  { key: "beats", label: "Beats" },
  { key: "characters", label: "Characters" },
  { key: "locations", label: "Locations" },
  { key: "stills", label: "Stills", onlyWhenPresent: true },
  // Custom project folders and never-filed members both land here.
  { key: "unsorted", label: "More", onlyWhenPresent: true },
];

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
    promptText?: string;
    fileName?: string;
    sourceUrl?: string;
    tagNames?: string[];
    modelName?: string;
    pillar?: string;
    folderId?: string;
    folderIds?: string[];
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
    asset.promptText,
    asset.fileName,
    asset.sourceUrl,
    asset.modelName,
    asset.pillar,
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

function BulkMembershipMark({
  count,
  total,
}: {
  count: number;
  total: number;
}) {
  const checked = total > 0 && count === total;
  const mixed = count > 0 && !checked;
  return (
    <span
      className="flex flex-shrink-0 items-center gap-1.5"
      aria-hidden="true"
    >
      <span
        className="flex h-4 w-4 items-center justify-center"
        style={{
          border: `1.5px solid ${
            checked || mixed ? "var(--lm-coral)" : "var(--lm-border-strong)"
          }`,
          borderRadius: "4px",
          backgroundColor: checked ? "var(--lm-coral)" : "transparent",
          color: checked ? "var(--lm-ink)" : "var(--lm-coral)",
        }}
      >
        {checked ? (
          <Check className="h-3 w-3" strokeWidth={3} />
        ) : mixed ? (
          <Minus className="h-3 w-3" strokeWidth={3} />
        ) : null}
      </span>
      <span
        style={{
          minWidth: "2.5em",
          fontSize: "9px",
          fontVariantNumeric: "tabular-nums",
          color: "var(--lm-text-tertiary)",
          textAlign: "right",
        }}
      >
        {count}/{total}
      </span>
    </span>
  );
}

const bulkMembershipAriaState = (
  count: number,
  total: number,
): boolean | "mixed" => {
  if (total > 0 && count === total) return true;
  if (count > 0) return "mixed";
  return false;
};

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
  const [mediaKind, setMediaKind] = useState<"image" | "video" | null>(null);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(
    null,
  );
  const [openStorybookId, setOpenStorybookId] = useState<string | null>(null);
  const [openProjectTarget, setOpenProjectTarget] = useState<{
    projectId: string;
    beatFolderId?: string;
  } | null>(null);
  const openProjectId = openProjectTarget?.projectId ?? null;
  // Generic project navigation always opens the project overview. A beat
  // click uses setOpenProjectTarget directly to retain its drill-down target.
  const setOpenProjectId = useCallback(
    (next: SetStateAction<string | null>) => {
      setOpenProjectTarget((current) => {
        const currentId = current?.projectId ?? null;
        const nextId =
          typeof next === "function" ? next(currentId) : next;
        return nextId ? { projectId: nextId } : null;
      });
    },
    [],
  );
  // Top-level "Storybooks" tab: shows every storybook as a masonry of stack
  // cards, separate from the asset grid.
  const [storybooksView, setStorybooksView] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState<
    string | null
  >(null);
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

  // The route's static metadata titles the page for its public face (the
  // taste profile / link previews). When the owner's vault mounts, re-title
  // the tab so it reads as the gallery, not the showcase.
  useEffect(() => {
    const previous = document.title;
    document.title = "Main Gallery · Laniameda";
    return () => {
      document.title = previous;
    };
  }, []);
  const [viewMode, setViewModeRaw] = useState<ViewMode>("grid");
  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeRaw(mode);
    // Leaving the workflows view closes whatever workflow was open with it.
    if (mode !== "workflows") setSelectedWorkflowId(null);
  }, []);
  // Browsing a project's pool in the main grid (breadcrumb: PROJECTS / name).
  const [browseProject, setBrowseProject] = useState<{
    id: string;
    name: string;
  } | null>(null);
  // Which layer of the browsed project the grid is showing. "all" is the whole
  // pool; the rest narrow to one section. This is the project view's own
  // switcher — the top filter bar (image/video/liked/tags) still applies on
  // top of whichever section is active.
  const [projectSection, setProjectSection] =
    useState<ProjectSectionTab>("all");
  // Stepped inside one beat of the browsed project (breadcrumb: PROJECTS /
  // name / beat). Drilling in stays in this view rather than handing off to the
  // review workspace, which is deprecated.
  const [browseBeat, setBrowseBeat] = useState<{
    id: string;
    name: string;
  } | null>(null);
  // A different project starts back on "All" rather than inheriting a section
  // the new project may not even have. Deliberately does NOT clear browseBeat:
  // stepping into a beat from collection browse sets project + beat in the same
  // tick, and an effect here would race that and drop the beat. Every path that
  // means "leave the beat" clears it explicitly instead.
  const browsedProjectId = browseProject?.id ?? null;
  useEffect(() => {
    setProjectSection("all");
  }, [browsedProjectId]);
  // Changing section leaves the beat — its media isn't in the new layer.
  const selectProjectSection = useCallback((next: ProjectSectionTab) => {
    setProjectSection(next);
    setBrowseBeat(null);
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
  const [sidebarCollapsed, setSidebarCollapsed] =
    useState<boolean>(false);

  useEffect(() => {
    setSidebarCollapsed(
      localStorage.getItem("laniameda-sidebar-collapsed") === "true",
    );
  }, []);

  const [selectedImage, setSelectedImage] =
    useState<SelectedImage | null>(null);
  const [sheetDismissing, setSheetDismissing] = useState(false);
  const [sheetDragY, setSheetDragY] = useState(0);
  const mobileDetailRef = useRef<HTMLDivElement>(null);
  const [isUploadOpen, setUploadOpen] = useState(false);
  const [uploadInitialFiles, setUploadInitialFiles] = useState<
    File[] | undefined
  >(undefined);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const dragDepthRef = useRef(0);
  const [selectedCinemaAsset, setSelectedCinemaAsset] =
    useState<CinemaModalAsset | null>(null);
  const [isSeedanceOpen, setSeedanceOpen] = useState(false);

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
  // upload modals have one, and the project review modal uploads dropped
  // files straight into a beat. Without this the shell overlay and the
  // review modal fight over the drag and the drop goes nowhere.
  const canAcceptShellDrop =
    canAccessMyGallery &&
    !isUploadOpen &&
    !openProjectId &&
    !openStorybookId;

  const handleShellDragEnter = useCallback(
    (event: React.DragEvent) => {
      if (!canAcceptShellDrop || !dragHasFiles(event)) return;
      event.preventDefault();
      dragDepthRef.current += 1;
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
  // "Add to" drawer — declared up here because the card drag handler opens it.
  const [addToPanelOpen, setAddToPanelOpen] = useState(false);
  // The featured shelf — owner-only control over the public home reel.
  const [featuredPanelOpen, setFeaturedPanelOpen] = useState(false);
  const [bulkAddMenuOpen, setBulkAddMenuOpen] = useState(false);
  const [bulkAddDraft, setBulkAddDraft] = useState("");
  const [bulkAddBusy, setBulkAddBusy] = useState(false);
  // Feedback chip for collection/project membership changes and drag & drop.
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
  const createFolderMutation = useMutation(
    api.folders.createFolder,
  );
  const addAssetsToProjectMutation = useMutation(
    api.projects.addAssetsToProject,
  );
  const removeAssetsFromProjectMutation = useMutation(
    api.projects.removeAssetsFromProject,
  );
  const ensureSectionPoolMutation = useMutation(api.projects.ensureSectionPool);
  const setFolderCoverMutation = useMutation(api.folders.setFolderCover);
  const setAssetDescriptionMutation = useMutation(
    api.assets.setAssetDescription,
  );
  const setAssetTagsMutation = useMutation(api.assets.setAssetTags);
  const addCollectionToProjectMutation = useMutation(
    api.projects.addCollectionToProject,
  );
  const updateFolderMutation = useMutation(api.folders.updateFolder);
  const deleteFolderMutation = useMutation(api.folders.deleteFolder);
  const unpackBeatMutation = useMutation(api.projects.unpackBeat);
  const setFolderShowcasedMutation = useMutation(
    api.folders.setFolderShowcased,
  );
  const setFolderFeaturedMutation = useMutation(api.folders.setFolderFeatured);
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
    setBulkAddMenuOpen(false);
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
    setBulkCurationError(undefined);
    setBulkCurationStatus(undefined);
    setSelectedAssetIds(new Set(ids));
  }, []);

  const clearAssetSelection = useCallback(() => {
    setSelectedAssetIds((current) => (current.size === 0 ? current : new Set()));
    setBulkCurationError(undefined);
    setBulkCurationStatus(undefined);
    setBulkAddMenuOpen(false);
  }, []);

  const runBulkCuration = useCallback(
    async (isPublic: boolean, overrideIds?: string[], isFeatured?: boolean) => {
      if (bulkCurationLoading || !canCuratePublic) return;
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

  const createProject = useCallback(
    async (name: string): Promise<string | null> => {
      if (!canAccessMyGallery) {
        setFolderError("Sign in to create projects.");
        return null;
      }
      const trimmedName = name.trim();
      if (!trimmedName) return null;

      setFolderError(undefined);
      try {
        const result = await createFolderMutation({
          ownerUserId,
          name: trimmedName,
          kind: "project",
        });
        // Open the new project's review workspace immediately.
        setOpenProjectId(result.folderId);
        return result.folderId;
      } catch (error) {
        setFolderError(
          error instanceof Error ? error.message : "Failed to create project.",
        );
        return null;
      }
    },
    [canAccessMyGallery, createFolderMutation, ownerUserId, setOpenProjectId],
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
      if (deletingAssetId) return;
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
        // Only assets reach the grid now — workflows have their own view, and
        // delete their own record from the card there.
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

        setSelectedImage((current) =>
          current?.id === assetId ? null : current,
        );
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
  // same on every world. Projects, beats and episodes are workspace furniture
  // and surface through project browse, so they never badge a tile.
  const folderBadgeById = useMemo(() => {
    const byId = new Map(
      (folders ?? []).map((folder) => [folder._id as string, folder]),
    );
    const badges = new Map<
      string,
      { label: string; section: CollectionSectionKey | null }
    >();
    for (const folder of folders ?? []) {
      if (
        folder.kind === "project" ||
        folder.kind === "beat" ||
        folder.kind === "episode"
      ) {
        continue;
      }
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
    (entry: GalleryEntry) => {
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
  // Storybooks, projects, project beats (beats/stacks/pools), and
  // episodes are folders too, but they surface through their own UIs — keep
  // them out of the plain collections list.
  const collectionFoldersWithCounts = useMemo(
    () =>
      foldersWithCounts.filter(
        (folder) =>
          folder.kind !== "storybook" &&
          folder.kind !== "project" &&
          folder.kind !== "beat" &&
          folder.kind !== "episode",
      ),
    [foldersWithCounts],
  );
  const smartMenuFilterByFolderId = useMemo(() => {
    const tagFilters = (menuFilters ?? []).filter(
      (entry) => entry.kind === "tag",
    );
    const mappings = new Map<string, (typeof tagFilters)[number]>();
    for (const folder of collectionFoldersWithCounts) {
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
  const openCollectionFromCard = useCallback(
    (folderId: string) => {
      setOpenProjectId(null);
      setBrowseProject(null);
      setSelectedFolderId(folderId);
      setViewMode("grid");
    },
    [setOpenProjectId, setViewMode],
  );
  const openProjectFromCard = useCallback(
    (projectId: string, name: string) => {
      setOpenProjectId(null);
      setSelectedFolderId(null);
      setBrowseProject({ id: projectId, name });
      // Opening a project lands on its top level, never inside a stale beat.
      setBrowseBeat(null);
      setViewMode("grid");
      // A history entry per browse level, so the browser's Back walks back
      // OUT of the project instead of leaving the vault entirely.
      window.history.pushState({ lmBrowse: "project" }, "");
    },
    [setOpenProjectId, setViewMode],
  );

  // Back unwinds the in-app browse (beat → project → gallery). Without this
  // the dashboard never touches history, so Back from a project view jumps to
  // whatever page came before the vault — usually the taste profile.
  const browseStateRef = useRef<{ beat: boolean; project: boolean }>({
    beat: false,
    project: false,
  });
  browseStateRef.current = {
    beat: Boolean(browseBeat),
    project: Boolean(browseProject),
  };
  useEffect(() => {
    const onPopState = () => {
      const { beat, project } = browseStateRef.current;
      if (beat) {
        setBrowseBeat(null);
      } else if (project) {
        setBrowseProject(null);
        setViewMode("collections");
      }
      // Neither open: the entry being popped is ours but already unwound via
      // the breadcrumb — let the browser continue on its way.
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [setViewMode]);


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

  const projects = useQuery(
    api.projects.listProjects,
    canAccessMyGallery && galleryScope === "mine" ? { ownerUserId } : "skip",
  );

  // Sidebar project rows behave like collections: clicking one expands the
  // project's whole pool in the main gallery grid.
  const browseProjectById = useCallback(
    (projectId: string) => {
      const project = (projects ?? []).find((p) => p._id === projectId);
      openProjectFromCard(projectId, project?.name ?? "Project");
    },
    [projects, openProjectFromCard],
  );

  // Public-facing collections, derived from the data: any collection with at
  // least one public asset, counted over public assets only. Queried in both
  // scopes — the public tab lists them, the mine tab uses them to mark which
  // collections are currently published.
  const publicCollections = useQuery(api.assets.listPublicCollections, {});
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
      new Set((publicCollections ?? []).map((entry) => String(entry.folderId))),
    [publicCollections],
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

  const assetFacets = useQuery(
    api.assets.galleryAssetFacets,
    galleryScope === "mine" && canAccessMyGallery
      ? { ownerUserId }
      : galleryScope === "public"
        ? { isPublic: true }
      : "skip",
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
    return groups.length > 0 ? groups : undefined;
  }, [activeSmartCollectionFilter, selectedTags, menuFilterEntries]);

  // The negative side of the same pills (minus button on a pill's left edge).
  // Tag pills exclude their tags; collection pills exclude the collection's
  // members. Exclusion always wins over an include.
  const excludedTagIds = useMemo(() => {
    if (excludedFilters.length === 0) return undefined;
    const excludedSet = new Set(excludedFilters);
    const ids = new Set<Id<"tags">>();
    for (const entry of menuFilterEntries) {
      if (entry.kind !== "tag" || !excludedSet.has(entry._id)) continue;
      for (const id of entry.tagIds) {
        ids.add(id);
      }
    }
    return ids.size > 0 ? Array.from(ids) : undefined;
  }, [excludedFilters, menuFilterEntries]);

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
    selectedTagIdGroups || excludedTagIds || excludedFolderIds,
  );
  const selectedTagsForFilterBar = useMemo(() => {
    if (!activeSmartCollectionFilter) return selectedTags;
    return Array.from(
      new Set([...selectedTags, activeSmartCollectionFilter._id]),
    );
  }, [activeSmartCollectionFilter, selectedTags]);

  // Cursor pagination serves the default browse (newest, no folder): pages of
  // 60 stream in as the grid's scroll frontier nears the end of what's loaded,
  // so the whole gallery is never read in one query — and reactive re-runs
  // only re-read the page that changed. Folder views and the
  // featured/popular/largest sorts need the full set in hand (they join or
  // globally re-order), so they keep the one-shot query, now capped at 600.
  // Breadcrumb above the grid while browsing inside a set. Roots return to
  // the collections (landing) view.
  const breadcrumbSegments = useMemo<BreadcrumbSegment[]>(() => {
    if (galleryScope !== "mine" || viewMode !== "grid") return [];
    if (browseProject) {
      const segments: BreadcrumbSegment[] = [
        {
          label: "Projects",
          onClick: () => {
            setBrowseProject(null);
            setBrowseBeat(null);
            setViewMode("collections");
          },
        },
        {
          label: browseProject.name,
          // Only clickable while stepped inside a beat — that's what it undoes.
          onClick: browseBeat ? () => setBrowseBeat(null) : undefined,
        },
      ];
      if (browseBeat) segments.push({ label: browseBeat.name });
      return segments;
    }
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
      segments.push({ label: folder.name });
      return segments;
    }
    return [];
  }, [
    browseBeat,
    browseProject,
    effectiveSelectedFolderId,
    foldersWithCounts,
    galleryScope,
    setViewMode,
    viewMode,
  ]);

  // Menu-filter predicates also take the one-shot path: the page query
  // post-filters each 60-item page, so a sparse tag can hand the grid an empty
  // first page (it reads as "no matches") even when hundreds match. The
  // one-shot query returns the full filtered set, keeping the grid consistent
  // with the menu pill counts.
  const paginationActive =
    sortOrder === "newest" &&
    !effectiveSelectedFolderId &&
    !browseProject &&
    !menuFilterActive;

  // Collection browsing gets its own cursor pagination over the membership
  // links, so a collection of ANY size streams fully (no 600-item cap).
  // Combining the folder with another asset filter falls back to the capped
  // one-shot query, same as before.
  // A world = a collection with sub-collections. Browsing one unions the whole
  // tree, which the single-folder cursor query can't paginate over, so world
  // browse falls back to the capped one-shot read.
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

  const folderPaginationActive =
    !browsingWorldFolder &&
    galleryScope === "mine" &&
    canAccessMyGallery &&
    Boolean(effectiveSelectedFolderId) &&
    !browseProject &&
    sortOrder === "newest" &&
    !menuFilterActive &&
    !selectedModelName &&
    !mediaKind &&
    !likedOnly;

  // Both paged reads only run while no menu filter is set (see above), so they
  // never carry a tag predicate.
  const minePagedAssets = usePaginatedQuery(
    api.assets.listGalleryAssetsPage,
    paginationActive && galleryScope === "mine" && canAccessMyGallery
      ? {
          ownerUserId,
          modelName: selectedModelName ?? undefined,
          kind: mediaKind ?? undefined,
          onlyLiked: likedOnly || undefined,
        }
      : "skip",
    { initialNumItems: 60 },
  );
  const publicPagedAssets = usePaginatedQuery(
    api.assets.listPublicGalleryAssetsPage,
    paginationActive && galleryScope === "public"
      ? {
          modelName: selectedModelName ?? undefined,
          kind: mediaKind ?? undefined,
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
        }
      : "skip",
    { initialNumItems: 60 },
  );
  const activePagedAssets = folderPaginationActive
    ? folderPagedAssets
    : galleryScope === "mine"
      ? minePagedAssets
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

  // Beat stack cards join the project browse grid only in its default state —
  // any asset-targeting filter flips to flat assets (and keeps beat members
  // in the flat set, so a VIDEO filter still surfaces a beat's videos).
  const showBeatStacks =
    Boolean(browseProject) &&
    // Inside a beat the grid shows that beat's flat media, not stack cards.
    !browseBeat &&
    galleryScope === "mine" &&
    viewMode === "grid" &&
    // Beats collapse into stack cards on the All and Beats tabs only. On a
    // Characters/Locations/Stills tab there are no beats in the pool anyway.
    (projectSection === "all" || projectSection === "beats") &&
    !effectiveSelectedFolderId &&
    !selectedModelName &&
    !mediaKind &&
    !likedOnly &&
    !menuFilterActive &&
    !semanticMode &&
    !assetSearchQuery.trim();

  // Same treatment when browsing a plain collection that fully contains
  // beats (e.g. a collection mirroring a project's pool): those beats lead
  // the grid as stacks and their members collapse out of the flat tiles.
  const showCollectionBeatStacks =
    Boolean(effectiveSelectedFolderId) &&
    !activeSmartCollectionFilter &&
    !browseProject &&
    galleryScope === "mine" &&
    viewMode === "grid" &&
    !selectedModelName &&
    !mediaKind &&
    !likedOnly &&
    !menuFilterActive &&
    !semanticMode &&
    !assetSearchQuery.trim();

  const showChildCollectionStacks = showCollectionBeatStacks;

  const mineGalleryAssets = useQuery(
    api.assets.listGalleryAssets,
    !paginationActive &&
      !folderPaginationActive &&
      galleryScope === "mine" &&
      canAccessMyGallery
      ? {
          ownerUserId,
          tagIdGroups: selectedTagIdGroups,
          excludeTagIds: excludedTagIds,
          excludeFolderIds: excludedFolderIds,
          // Inside a beat, that one beat IS the scope — it wins over the
          // project pool so the grid shows only the beat's own media.
          folderId: browseBeat
            ? (browseBeat.id as Id<"folders">)
            : effectiveSelectedFolderId && !activeSmartCollectionFilter
            ? (effectiveSelectedFolderId as Id<"folders">)
            : undefined,
          includeDescendants: browsingWorldFolder || undefined,
          projectId:
            browseProject && !browseBeat
              ? (browseProject.id as Id<"folders">)
              : undefined,
          // Beats render as stack cards (below) — keep their members out of
          // the flat tiles so nothing shows twice.
          excludeBeatAssets: showBeatStacks ? true : undefined,
          projectSection:
            browseProject && projectSection !== "all"
              ? projectSection
              : undefined,
          modelName: selectedModelName ?? undefined,
          kind: mediaKind ?? undefined,
          onlyLiked: likedOnly || undefined,
          limit: 600,
        }
      : "skip",
  );

  // Starred assets in the CURRENT view, read on their own so they can lead the
  // grid. Browse streams 60 rows at a time, so a starred piece sitting deep in
  // the gallery would otherwise not float to the top until the user scrolled
  // that far. Scoped with the same folder/project args as the grid query above
  // (independently of which read path is active — the folder-paginated path
  // takes only a folderId), and merged in BEFORE search and the filter bar run,
  // so a starred asset is never exempt from a filter the user set.
  const starredAssets = useQuery(
    api.assets.listStarredAssets,
    galleryScope === "mine" && canAccessMyGallery
      ? {
          ownerUserId,
          folderId: browseBeat
            ? (browseBeat.id as Id<"folders">)
            : effectiveSelectedFolderId && !activeSmartCollectionFilter
              ? (effectiveSelectedFolderId as Id<"folders">)
              : undefined,
          includeDescendants: browsingWorldFolder || undefined,
          projectId:
            browseProject && !browseBeat
              ? (browseProject.id as Id<"folders">)
              : undefined,
          excludeBeatAssets: showBeatStacks ? true : undefined,
          projectSection:
            browseProject && projectSection !== "all"
              ? projectSection
              : undefined,
        }
      : "skip",
  );

  // Section tabs for the browsed project, counted by member collections (so
  // "Beats 4" means four beats, matching how the workspace counts them).
  // Stills/Unsorted only appear once the project actually uses them.
  const projectSectionTabs = useMemo(() => {
    if (!browseProject) return [];
    const project = (projects ?? []).find((p) => p._id === browseProject.id);
    if (!project) return [];
    const counts = new Map<ProjectSectionTab, number>();
    for (const collection of project.collections) {
      const key = (collection.section ?? "unsorted") as ProjectSectionTab;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return PROJECT_SECTION_TABS.filter(
      (tab) =>
        !tab.onlyWhenPresent ||
        (counts.get(tab.key) ?? 0) > 0 ||
        // Never hide the tab the user is currently on out from under them.
        tab.key === projectSection,
    ).map((tab) => ({
      ...tab,
      count:
        tab.key === "all" ? project.collections.length : (counts.get(tab.key) ?? 0),
    }));
  }, [browseProject, projects, projectSection]);

  // The browsed project's beats as stack cards for the grid (cover tile +
  // hover peek fan). Same underlying assets as the review workspace.
  const projectBeatStacks = useQuery(
    api.projects.listProjectBeatStacks,
    browseProject && showBeatStacks && canAccessMyGallery
      ? {
          ownerUserId,
          projectId: browseProject.id as Id<"folders">,
        }
      : "skip",
  );

  // Beats fully contained in the browsed collection (stack cards).
  const collectionBeatStacks = useQuery(
    api.projects.listCollectionBeatStacks,
    effectiveSelectedFolderId && showCollectionBeatStacks && canAccessMyGallery
      ? {
          ownerUserId,
          folderId: effectiveSelectedFolderId as Id<"folders">,
        }
      : "skip",
  );

  const childCollectionStacks = useQuery(
    api.folders.listChildCollectionEntries,
    effectiveSelectedFolderId &&
      showChildCollectionStacks &&
      canAccessMyGallery
      ? {
          ownerUserId,
          parentFolderId: effectiveSelectedFolderId as Id<"folders">,
        }
      : "skip",
  );

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
  const baseGalleryAssets = useMemo(() => {
    const base = galleryAssets ?? [];
    if (!starredAssets || starredAssets.length === 0) return base;
    const present = new Set(base.map((asset) => asset._id));
    // The starred read is scoped by folder/project only — it knows nothing
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

  const imageCount = assetFacets?.totalCount;

  const modelTags = useMemo(() => {
    return (assetFacets?.modelCounts ?? []).map((model) => ({
      name: model.name,
      usageCount: model.count,
    }));
  }, [assetFacets]);

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
      setBrowseProject(null);
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
  };
  // Clears EVERYTHING hasFilters counts — including the search/semantic mode.
  // (The empty state's "clear all filters" used to leave the search active,
  // so the button appeared broken on zero-result searches.)
  const handleClearFilters = () => {
    setSelectedTags([]);
    setExcludedFilters([]);
    setSelectedFolderId(null);
    setBrowseProject(null);
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
    let result = baseGalleryAssets;
    if (search) {
      result = result.filter((asset) =>
        buildAssetSearchHaystack(asset, folderNameById).includes(search),
      );
    }
    return result;
  }, [assetSearchQuery, baseGalleryAssets, folderNameById]);

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
          .includes(effectiveSelectedFolderId)
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
      sortOrder,
      shuffleSeed,
      // Semantic results are already ordered by score — that ranking is what
      // the user asked for, so a star doesn't get to jump the queue there.
      promoteStarred: filteredSemanticResults === null,
    });
    return entries.map((entry) => {
      const badges = resolveEntryBadges(entry);
      return badges ? { ...entry, ...badges } : entry;
    });
  }, [
    displayGalleryAssets,
    filteredSemanticResults,
    hiddenAssetIds,
    resolveEntryBadges,
    sortOrder,
    shuffleSeed,
  ]);

  // Workflows are an organizing layer that owns its own view. WorkflowGrid
  // queries and renders them there; nothing about them belongs in this grid.

  // Storybook stack cards only join the grid in the default browse state —
  // every filter below targets assets, which storybooks are not.
  const showStorybookStacks =
    galleryScope === "mine" &&
    viewMode === "grid" &&
    !effectiveSelectedFolderId &&
    !browseProject &&
    !selectedModelName &&
    !mediaKind &&
    !likedOnly &&
    !menuFilterActive &&
    !semanticMode &&
    !assetSearchQuery.trim();

  const storybookEntries = useMemo<GalleryEntry[]>(() => {
    if (!storybooks || storybooks.length === 0) return [];
    return storybooks.map((storybook) => {
      const previews = storybook.previewAssets.map((preview) => ({
        id: preview.assetId,
        galleryItemId: preview.assetId,
        galleryItemType: "asset" as const,
        src: preview.thumbUrl ?? preview.url ?? "/placeholder.svg",
        fullSrc: preview.url ?? preview.thumbUrl ?? "/placeholder.svg",
        prompt: storybook.name,
        width: preview.thumbWidth ?? preview.width,
        height: preview.thumbHeight ?? preview.height,
        kind: preview.kind,
        contentType: preview.contentType,
      }));
      const cover = previews[0];
      return {
        id: `storybook:${storybook._id}`,
        galleryItemId: storybook._id as string,
        galleryItemType: "storybook" as const,
        src: cover?.src ?? "/placeholder.svg",
        fullSrc: cover?.fullSrc ?? "/placeholder.svg",
        prompt: storybook.name,
        author: "Storybook",
        likes: 0,
        width: cover?.width,
        height: cover?.height,
        kind: cover?.kind,
        contentType: cover?.contentType,
        description: storybook.story,
        createdAt: storybook.updatedAt ?? storybook.createdAt,
        storybookCount: storybook.count,
        previewImages: previews,
      };
    });
  }, [storybooks]);

  const childCollectionEntries = useMemo<GalleryEntry[]>(() => {
    if (!childCollectionStacks || childCollectionStacks.length === 0) {
      return [];
    }
    return childCollectionStacks.map((collection) => {
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
        galleryItemType: "collection" as const,
        src: cover?.src ?? "/placeholder.svg",
        fullSrc: cover?.fullSrc ?? "/placeholder.svg",
        prompt: collection.name,
        author: "Collection",
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
    });
  }, [childCollectionStacks]);

  const childCollectionIds = useMemo(
    () =>
      showChildCollectionStacks
        ? new Set<string>(
            (childCollectionStacks ?? []).map((collection) =>
              String(collection._id),
            ),
          )
        : null,
    [childCollectionStacks, showChildCollectionStacks],
  );

  // The browsed project's (or collection's) beats as stack entries — same
  // underlying assets as the review workspace, presented as one card each.
  const activeBeatStacks = browseProject
    ? projectBeatStacks
    : collectionBeatStacks;
  const beatEntries = useMemo<GalleryEntry[]>(() => {
    if (!activeBeatStacks || activeBeatStacks.length === 0) return [];
    return activeBeatStacks.map((beat) => {
      const cover = beat.cover;
      const coverSrc = cover?.thumbUrl ?? cover?.url;
      return {
        id: `beat:${beat.folderId}`,
        galleryItemId: beat.folderId as string,
        galleryItemType: "beat" as const,
        src: coverSrc ?? "/placeholder.svg",
        fullSrc: cover?.url ?? coverSrc ?? "/placeholder.svg",
        prompt: beat.name,
        author: "Beat",
        likes: 0,
        width: cover?.thumbWidth ?? cover?.width,
        height: cover?.thumbHeight ?? cover?.height,
        kind: cover?.kind,
        contentType: cover?.contentType,
        createdAt: beat.createdAt,
        storybookCount: beat.count,
        peekThumbs: beat.peekThumbs,
        previewImages: [],
      };
    });
  }, [activeBeatStacks]);

  // In collection browse the flat query can't exclude beat members server-
  // side (that path is project-scoped), so collapse them out here.
  const collectionBeatMemberIds = useMemo(() => {
    if (!showCollectionBeatStacks || !collectionBeatStacks) return null;
    const ids = new Set<string>();
    for (const beat of collectionBeatStacks) {
      for (const assetId of beat.memberAssetIds) ids.add(assetId);
    }
    return ids.size > 0 ? ids : null;
  }, [showCollectionBeatStacks, collectionBeatStacks]);

  const images = useMemo(() => {
    const stacks = showStorybookStacks ? storybookEntries : [];
    const beats =
      showBeatStacks || showCollectionBeatStacks ? beatEntries : [];
    const childCollections = showChildCollectionStacks
      ? childCollectionEntries
      : [];
    // Workflows never join the grid — they render only in the workflows view,
    // so a saved recipe can't push assets down the feed with its own card.
    const mixed = baseImages.filter((image) => {
      if (collectionBeatMemberIds?.has(image.id)) return false;
      if (!childCollectionIds || !("folderIds" in image)) return true;
      return !(image.folderIds ?? []).some((folderId) =>
        childCollectionIds.has(folderId),
      );
    });
    // Stacks lead the grid — they're shelves, not dated assets. In project
    // browse that's the beats; in the default state, storybooks.
    const leading = [...stacks, ...childCollections, ...beats];
    const ordered =
      leading.length > 0 ? [...leading, ...mixed] : mixed;
    // ...except a star outranks a shelf. Starring is a deliberate "this one
    // first" on a specific piece, so it wins the very top of the grid — above
    // the storybook/beat/collection stacks, not just above the other tiles.
    // buildGalleryEntries already ordered the starred ones among themselves.
    const starredLead = ordered.filter((entry) => "starredAt" in entry && entry.starredAt);
    if (starredLead.length === 0) return ordered;
    return [
      ...starredLead,
      ...ordered.filter((entry) => !("starredAt" in entry && entry.starredAt)),
    ];
  }, [
    baseImages,
    showStorybookStacks,
    storybookEntries,
    showBeatStacks,
    showCollectionBeatStacks,
    showChildCollectionStacks,
    collectionBeatMemberIds,
    childCollectionIds,
    beatEntries,
    childCollectionEntries,
  ]);

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

  const selectAllVisibleAssets = useCallback(() => {
    setSelectedAssetIds(new Set(allVisibleAssetIds));
  }, [allVisibleAssetIds]);

  const publishAllAssetIds = useMemo(() => {
    return images
      .filter(
        (image) =>
          (image.galleryItemType === "asset" || image.galleryItemType === undefined) &&
          !image.isPublic,
      )
      .map((image) => image.id);
  }, [images]);

  const runPublishAll = useCallback(async () => {
    if (bulkCurationLoading || !canCuratePublic) return;
    if (publishAllAssetIds.length === 0) return;
    const confirmed = window.confirm(
      `Make all ${publishAllAssetIds.length} currently visible private asset${publishAllAssetIds.length === 1 ? "" : "s"} public? This can't be undone in bulk — you'd need to make them private one by one.`,
    );
    if (!confirmed) return;
    await runBulkCuration(true, publishAllAssetIds);
  }, [bulkCurationLoading, canCuratePublic, publishAllAssetIds, runBulkCuration]);

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
        const url = image.fullSrc || image.src;
        if (!url) return null;
        const kind = "kind" in image ? image.kind : undefined;
        const contentType =
          "contentType" in image && typeof image.contentType === "string"
            ? image.contentType
            : undefined;
        const isImage =
          kind === "video" || contentType?.startsWith("video/") ? false : true;
        return { url, name: image.id, isImage };
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
        // and beat/beat memberships are orthogonal overlays and survive
        // a move — replacing the full set here used to silently strip them.
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
      folderNameById,
      ownerUserId,
      selectedAssetMemberships,
      selectedFolderMembershipCounts,
      setAssetFoldersMutation,
    ],
  );

  // Collections grouped for the picker: roots first, sub-collections nested.
  const bulkAddCollectionTree = useMemo(() => {
    const ids = new Set(collectionFoldersWithCounts.map((f) => f._id));
    const roots: typeof collectionFoldersWithCounts = [];
    const childrenByParent = new Map<string, typeof collectionFoldersWithCounts>();
    for (const folder of collectionFoldersWithCounts) {
      if (folder.parentFolderId && ids.has(folder.parentFolderId)) {
        const list = childrenByParent.get(folder.parentFolderId) ?? [];
        list.push(folder);
        childrenByParent.set(folder.parentFolderId, list);
      } else {
        roots.push(folder);
      }
    }
    for (const children of childrenByParent.values()) {
      children.sort((left, right) =>
        compareCollectionSectionNames(left.name, right.name),
      );
    }
    return { roots, childrenByParent };
  }, [collectionFoldersWithCounts]);

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
    [addAssetFoldersMutation, folderNameById, ownerUserId],
  );

  const removeAssetFromFolder = useCallback(
    async (imageId: string, folderId: string) => {
      const image = images.find((entry) => entry.id === imageId);
      // `images` is a union — only asset entries carry folderIds; design/
      // workflow entries have just folderId. Narrow safely.
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
  // What "exclude" means depends on where the grid is pointed: inside a beat
  // it's that beat, inside a collection that collection, inside a project the
  // whole pool. The flat gallery has no scope to leave, so no button there.
  const excludeScope = useMemo<
    | { kind: "folder"; folderId: string; label: string }
    | { kind: "project"; projectId: string; label: string }
    | null
  >(() => {
    if (!canManageFoldersInCurrentView) return null;
    if (browseBeat) {
      return { kind: "folder", folderId: browseBeat.id, label: browseBeat.name };
    }
    if (effectiveSelectedFolderId && !activeSmartCollectionFilter) {
      return {
        kind: "folder",
        folderId: effectiveSelectedFolderId,
        label:
          folderNameById.get(effectiveSelectedFolderId) ?? "this collection",
      };
    }
    if (browseProject) {
      return {
        kind: "project",
        projectId: browseProject.id,
        label: browseProject.name,
      };
    }
    return null;
  }, [
    activeSmartCollectionFilter,
    browseBeat,
    browseProject,
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
        if (excludeScope.kind === "project") {
          await removeAssetsFromProjectMutation({
            ownerUserId,
            projectId: excludeScope.projectId as Id<"folders">,
            assetIds: [imageId as Id<"assets">],
          });
        } else {
          await removeAssetFolderMutation({
            ownerUserId,
            assetId: imageId as Id<"assets">,
            folderId: excludeScope.folderId as Id<"folders">,
          });
        }
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
      removeAssetsFromProjectMutation,
    ],
  );

  // Per-card menu targets: plain collections (Move/Add) plus storybooks
  // (always additive). Projects group collections, not assets, so they are
  // never asset-membership targets and are excluded.
  const cardCollections = useMemo(() => {
    const nameById = new Map(
      collectionFoldersWithCounts.map((folder) => [
        folder._id as string,
        folder.name,
      ]),
    );
    const rows = collectionFoldersWithCounts.map((folder) => {
      const parentId = folder.parentFolderId as string | undefined;
      return {
        id: folder._id as string,
        name: folder.name,
        // Several parents each own a "Characters"/"Locations", so the row has
        // to say whose it is or the options are indistinguishable.
        parentName: parentId ? nameById.get(parentId) : undefined,
        count: folder.count,
        kind: "collection" as const,
      };
    });
    // Group each child under its parent, roots alphabetical, so the list reads
    // as the tree it is instead of an interleaved flat dump.
    const sortKey = (row: (typeof rows)[number]) =>
      `${(row.parentName ?? row.name).toLowerCase()} ${
        row.parentName ? `1${row.name.toLowerCase()}` : "0"
      }`;
    rows.sort((left, right) => sortKey(left).localeCompare(sortKey(right)));
    return [
      ...rows,
      ...(storybooks ?? []).map((storybook) => ({
        id: storybook._id as string,
        name: storybook.name,
        parentName: undefined,
        count: storybook.count,
        kind: "storybook" as const,
      })),
    ];
  }, [collectionFoldersWithCounts, storybooks]);

  // Plain collections only (no storybooks/projects) — offered as members a
  // project's review can aggregate.
  const projectCollectionOptions = useMemo(
    () =>
      collectionFoldersWithCounts.map((folder) => ({
        id: folder._id as string,
        name: folder.name,
        count: folder.count,
      })),
    [collectionFoldersWithCounts],
  );

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
      // Reveal the filing drawer the moment a drag starts, so there is always
      // somewhere to drop without hunting for a button first.
      setAddToPanelOpen(true);
    },
    [images, selectedAssetIds],
  );

  // Dropping on a collection ADDS membership, exactly like storybooks and
  // beats below — every drop target in the sidebar behaves the same.
  // Moving (which removes other collection memberships) is only ever the
  // explicit Move action in the card menu, never a drag.
  const handleAssetsDropOnFolder = useCallback(
    async (folderId: string, assetIds: string[]) => {
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
    [addAssetFoldersMutation, folderNameById, ownerUserId],
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

  // Dropping on a beat (a project's member collection) ADDS membership,
  // same semantics as storybooks — beats layer on top of the asset's home.
  const handleAssetsDropOnBeat = useCallback(
    async (beatId: string, assetIds: string[]) => {
      if (assetIds.length === 0) return;
      try {
        await Promise.all(
          assetIds.map((assetId) =>
            addAssetFoldersMutation({
              ownerUserId,
              assetId: assetId as Id<"assets">,
              folderIds: [beatId as Id<"folders">],
            }),
          ),
        );
        setMoveStatus({
          text: `Added ${assetIds.length} asset${assetIds.length === 1 ? "" : "s"} to ${folderNameById.get(beatId) ?? "beat"}`,
        });
      } catch (error) {
        setMoveStatus({
          text:
            error instanceof Error
              ? error.message
              : "Failed to add to beat.",
          error: true,
        });
      }
    },
    [addAssetFoldersMutation, folderNameById, ownerUserId],
  );

  const selectedProjectMembershipCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const project of projects ?? []) {
      const memberFolderIds = new Set(
        project.collections.map((collection) => String(collection.folderId)),
      );
      const count = selectedAssetMemberships.filter((asset) =>
        asset.folderIds.some((folderId) => memberFolderIds.has(folderId)),
      ).length;
      counts.set(String(project._id), count);
    }
    return counts;
  }, [projects, selectedAssetMemberships]);

  // Dropping on a project files assets into its "<Project> — Inbox" beat
  // (created + attached on first drop, idempotent) so a drop never needs a
  // target choice mid-drag; sort into proper beats later.
  const handleAssetsDropOnProject = useCallback(
    // projectNameOverride covers just-created projects that aren't in the
    // reactive `projects` list yet (used by the bulk "Add to" picker).
    async (projectId: string, assetIds: string[], projectNameOverride?: string) => {
      if (assetIds.length === 0) return;
      const project = (projects ?? []).find((p) => p._id === projectId);
      const projectName = projectNameOverride ?? project?.name ?? "Project";
      try {
        // Server-side: skips assets already inside ANY of the project's
        // member collections (e.g. already living in a beat); only genuinely
        // new assets land in the project's Inbox.
        const result = await addAssetsToProjectMutation({
          ownerUserId,
          projectId: projectId as Id<"folders">,
          assetIds: assetIds as Id<"assets">[],
        });
        const parts: string[] = [];
        if (result.added > 0) {
          parts.push(
            `Added ${result.added} to ${projectName} — Inbox`,
          );
        }
        if (result.skipped > 0) {
          parts.push(
            `${result.skipped} already in ${projectName}`,
          );
        }
        setMoveStatus({
          text: parts.join(" · ") || `Nothing to add to ${projectName}`,
        });
      } catch (error) {
        setMoveStatus({
          text:
            error instanceof Error
              ? error.message
              : "Failed to add to project.",
          error: true,
        });
      }
    },
    [
      addAssetsToProjectMutation,
      ownerUserId,
      projects,
    ],
  );

  const toggleSelectedProject = useCallback(
    async (projectId: string, projectNameOverride?: string) => {
      if (selectedAssetMemberships.length === 0 || bulkAddBusy) return;
      const project = (projects ?? []).find(
        (entry) => String(entry._id) === projectId,
      );
      const memberFolderIds = new Set(
        project?.collections.map((collection) =>
          String(collection.folderId),
        ) ?? [],
      );
      const projectMembers = selectedAssetMemberships.filter((asset) =>
        asset.folderIds.some((folderId) => memberFolderIds.has(folderId)),
      );
      const shouldRemove =
        projectMembers.length === selectedAssetMemberships.length &&
        selectedAssetMemberships.length > 0;
      const projectName =
        projectNameOverride ?? project?.name ?? "project";

      setBulkAddBusy(true);
      try {
        if (shouldRemove) {
          const result = await removeAssetsFromProjectMutation({
            ownerUserId,
            projectId: projectId as Id<"folders">,
            assetIds: selectedAssetMemberships.map(
              (asset) => asset.assetId as Id<"assets">,
            ),
          });
          setMoveStatus({
            text: `Removed ${result.removed} from ${projectName}`,
          });
        } else {
          const result = await addAssetsToProjectMutation({
            ownerUserId,
            projectId: projectId as Id<"folders">,
            assetIds: selectedAssetMemberships.map(
              (asset) => asset.assetId as Id<"assets">,
            ),
          });
          const parts: string[] = [];
          if (result.added > 0) {
            parts.push(`Added ${result.added} to ${projectName}`);
          }
          if (result.skipped > 0) {
            parts.push(`${result.skipped} already there`);
          }
          setMoveStatus({
            text: parts.join(" · ") || `Nothing to add to ${projectName}`,
          });
        }
      } catch (error) {
        setMoveStatus({
          text:
            error instanceof Error
              ? error.message
              : shouldRemove
                ? "Remove from project failed."
                : "Add to project failed.",
          error: true,
        });
      } finally {
        setBulkAddBusy(false);
      }
    },
    [
      addAssetsToProjectMutation,
      bulkAddBusy,
      ownerUserId,
      projects,
      removeAssetsFromProjectMutation,
      selectedAssetMemberships,
    ],
  );

  // ── "Add to" panel ──
  // The one filing surface: a drawer (not a modal) so the grid stays
  // scrollable and draggable while it's open. Every handler ADDS; nothing
  // here moves or removes.
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

  const panelWorlds = useMemo<PanelWorld[]>(
    () =>
      (projects ?? []).map((project) => ({
        id: project._id,
        name: project.name,
        description: project.brief,
        previews: project.previewAssets,
        members: project.collections.map((member) => ({
          folderId: member.folderId,
          name: member.name,
          section: member.section as PanelSection | undefined,
          previews: panelPreviewsByFolderId.get(member.folderId),
        })),
      })),
    [panelPreviewsByFolderId, projects],
  );

  // The same worlds, shaped for the upload modal's destination list: sections
  // and named beats by name, so a manual save can land where the Add-to drawer
  // would have put it.
  const uploadWorlds = useMemo<UploadWorld[]>(
    () =>
      (projects ?? []).map((project) => ({
        _id: project._id,
        name: project.name,
        members: project.collections.map((member) => ({
          folderId: member.folderId,
          name: member.name,
          section: member.section,
        })),
      })),
    [projects],
  );

  // Collections offered as destinations EXCLUDE anything that is really a
  // world's section — a project's member beats, and the sub-collections
  // of a collection-shaped world. Those are reachable under their world, so
  // listing them flat duplicated "Characters"/"Locations"/"Scenes" rows.
  const worldSectionFolderIds = useMemo(() => {
    const ids = new Set<string>();
    for (const project of projects ?? []) {
      for (const member of project.collections) ids.add(member.folderId);
    }
    return ids;
  }, [projects]);

  const panelCollections = useMemo<PanelCollection[]>(
    () =>
      collectionFoldersWithCounts
        .filter((folder) => !worldSectionFolderIds.has(folder._id))
        .map((folder) => ({
          id: folder._id,
          name: folder.name,
          count: folder.count,
          parentId: folder.parentFolderId ?? undefined,
          previews: panelPreviewsByFolderId.get(folder._id),
        })),
    [collectionFoldersWithCounts, panelPreviewsByFolderId, worldSectionFolderIds],
  );

  const addAssetsToFolder = useCallback(
    async (folderId: string, assetIds: string[]) => {
      if (assetIds.length === 0) return;
      await handleAssetsDropOnFolder(folderId, assetIds);
    },
    [handleAssetsDropOnFolder],
  );

  // Filing into a SECTION rather than a named collection: the world's pool
  // folder for that section is created on demand, so "add a character" needs
  // no collection to exist first.
  const addAssetsToWorldSection = useCallback(
    async (worldId: string, section: PanelSection, assetIds: string[]) => {
      if (assetIds.length === 0 || !ownerUserId) return;
      // Beats never pool — the panel routes them to createBeatsFromAssets.
      if (section === "beats") return;
      try {
        const pool = await ensureSectionPoolMutation({
          ownerUserId,
          projectId: worldId as Id<"folders">,
          section,
        });
        await handleAssetsDropOnFolder(pool.folderId as string, assetIds);
      } catch (error) {
        setMoveStatus({
          text:
            error instanceof Error ? error.message : "Failed to file assets.",
          error: true,
        });
      }
    },
    [ensureSectionPoolMutation, handleAssetsDropOnFolder, ownerUserId],
  );

  // A beat is a beat attached to the world under its "beats" section —
  // the same shape the review modal's composer produces, now reachable from
  // the gallery with any asset selected.
  const createBeatFromAssets = useCallback(
    async (worldId: string, name: string, assetIds: string[]) => {
      if (!ownerUserId) return;
      try {
        const created = await createFolderMutation({
          ownerUserId,
          name,
          kind: "beat",
        });
        await addCollectionToProjectMutation({
          ownerUserId,
          projectId: worldId as Id<"folders">,
          folderId: created.folderId,
          section: "beats",
        });
        if (assetIds.length > 0) {
          await handleAssetsDropOnFolder(created.folderId as string, assetIds);
        } else {
          setMoveStatus({
            text: `Beat "${name}" created`,
          });
        }
      } catch (error) {
        setMoveStatus({
          text:
            error instanceof Error ? error.message : "Failed to create beat.",
          error: true,
        });
      }
    },
    [
      addCollectionToProjectMutation,
      createFolderMutation,
      handleAssetsDropOnFolder,
      ownerUserId,
    ],
  );

  // Beats are never pooled: one video + its characters/locations IS the beat.
  // Filing assets onto a world's Beats makes one beat per asset, named from
  // the asset so it's identifiable before you rename it.
  const createBeatsFromAssets = useCallback(
    async (worldId: string, assetIds: string[]) => {
      if (assetIds.length === 0) return;
      for (const assetId of assetIds) {
        const image = images.find((entry) => entry.id === assetId);
        const base =
          image?.prompt?.trim().slice(0, 40) ||
          `Beat ${new Date().toISOString().slice(11, 19)}`;
        await createBeatFromAssets(worldId, base, [assetId]);
      }
    },
    [createBeatFromAssets, images],
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
  const cardProjectOptions = useMemo(
    () =>
      (projects ?? []).map((project) => ({
        id: project._id as string,
        name: project.name,
      })),
    [projects],
  );

  const handleCardDelete = useCallback(
    (imageId: string) => {
      void deleteAsset(imageId);
    },
    [deleteAsset],
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

  const handleCardAddToProject = useCallback(
    (imageId: string, projectId: string) => {
      void handleAssetsDropOnProject(projectId, [imageId]);
    },
    [handleAssetsDropOnProject],
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

  // A beat click steps INTO the beat without leaving the project view — the
  // grid re-scopes to that one beat and the breadcrumb grows a segment. It used
  // to hand off to the review workspace; that view is deprecated, and bouncing
  // into it also dropped the light theme and the top filter bar.
  const handleCardBeatOpen = useCallback(
    (beatFolderId: string) => {
      const owningProject = (projects ?? []).find((project) =>
        project.collections.some(
          (collection) => collection.folderId === beatFolderId,
        ),
      );
      const rawName =
        owningProject?.collections.find(
          (collection) => collection.folderId === beatFolderId,
        )?.name ?? "Beat";
      // Beat folders are namespaced ("DADDY ISSUES — Full Film") so names stay
      // unique across projects; the breadcrumb already says the project, so
      // show just the leaf.
      const prefix = owningProject ? `${owningProject.name} — ` : "";
      const beatName =
        prefix && rawName.startsWith(prefix)
          ? rawName.slice(prefix.length)
          : rawName;
      // Reached from collection browse rather than project browse: step into
      // the owning project first so the breadcrumb stays truthful.
      if (!browseProject && owningProject) {
        setSelectedFolderId(null);
        setBrowseProject({ id: owningProject._id, name: owningProject.name });
      }
      setSelectedImage(null);
      setBrowseBeat({ id: beatFolderId, name: beatName });
      window.history.pushState({ lmBrowse: "beat" }, "");
    },
    [browseProject, projects],
  );

  const createTargetAndAddSelected = useCallback(
    async (kind: "collection" | "project") => {
      const name = bulkAddDraft.trim();
      if (!name || bulkAddBusy) return;
      try {
        const result = await createFolderMutation({
          ownerUserId,
          name,
          kind: kind === "project" ? "project" : undefined,
        });
        if (kind === "project") {
          await toggleSelectedProject(result.folderId, name);
        } else {
          await toggleSelectedFolder(result.folderId, name);
        }
        setBulkAddDraft("");
      } catch (error) {
        setMoveStatus({
          text:
            error instanceof Error
              ? error.message
              : `Failed to create ${kind}.`,
          error: true,
        });
      }
    },
    [
      bulkAddBusy,
      bulkAddDraft,
      createFolderMutation,
      ownerUserId,
      toggleSelectedFolder,
      toggleSelectedProject,
    ],
  );

  // Rename any folder-backed sidebar row (collection / storybook / project).
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
  // the backend clears assetFolders + projectCollections links both ways.
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
        setOpenProjectId((current) =>
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
    [ownerUserId, deleteFolderMutation, folderNameById, setOpenProjectId],
  );

  // ── Beat management from the project browse ───────────────────────────────
  // Unpack dissolves the grouping but keeps every member in the project (they
  // move to the Inbox). Delete removes the grouping AND the members' project
  // membership — the assets themselves always survive in the vault.
  const handleBeatUnpack = useCallback(
    async (beatFolderId: string) => {
      const name = folderNameById.get(beatFolderId) ?? "beat";
      try {
        const result = await unpackBeatMutation({
          ownerUserId,
          beatFolderId: beatFolderId as Id<"folders">,
        });
        setBrowseBeat((current) =>
          current?.id === beatFolderId ? null : current,
        );
        setMoveStatus({
          text:
            result.movedAssets > 0
              ? `Unpacked ${name} — ${result.movedAssets} asset${result.movedAssets === 1 ? "" : "s"} moved to Inbox`
              : `Unpacked ${name}`,
        });
      } catch (error) {
        setMoveStatus({
          text: error instanceof Error ? error.message : "Failed to unpack.",
          error: true,
        });
      }
    },
    [folderNameById, ownerUserId, unpackBeatMutation],
  );

  const handleBeatDelete = useCallback(
    async (beatFolderId: string) => {
      const name = folderNameById.get(beatFolderId) ?? "this beat";
      const confirmed = window.confirm(
        `Delete ${name}? Its assets stay in the vault but leave this project. To keep them in the project, unpack instead.`,
      );
      if (!confirmed) return;
      setBrowseBeat((current) =>
        current?.id === beatFolderId ? null : current,
      );
      await handleDeleteFolder(beatFolderId);
    },
    [folderNameById, handleDeleteFolder],
  );

  // A custom folder inside the project — the owner's own sorting layer next
  // to the fixed sections. Linked with no section, so it lands on the More
  // tab and its assets stay in the project's All pool.
  const handleCreateProjectFolder = useCallback(async () => {
    if (!browseProject || !ownerUserId) return;
    const name = window.prompt(
      `New folder in ${browseProject.name}`,
    )?.trim();
    if (!name) return;
    try {
      const created = await createFolderMutation({ ownerUserId, name });
      await addCollectionToProjectMutation({
        ownerUserId,
        projectId: browseProject.id as Id<"folders">,
        folderId: created.folderId,
      });
      setMoveStatus({
        text: `Folder “${name}” added to ${browseProject.name}`,
      });
    } catch (error) {
      setMoveStatus({
        text:
          error instanceof Error ? error.message : "Failed to create folder.",
        error: true,
      });
    }
  }, [
    addCollectionToProjectMutation,
    browseProject,
    createFolderMutation,
    ownerUserId,
  ]);

  // Navigation helpers
  const currentImageIndex = useMemo(() => {
    if (!selectedImage) return -1;
    return images.findIndex(
      (img) => img.id === selectedImage.id,
    );
  }, [images, selectedImage]);

  const handleImageSelect = useCallback(
    (img: SelectedImage) => {
      // Workflows open a dedicated scrollable modal, not the side panel.
      if (img.galleryItemType === "workflow") {
        setSelectedWorkflowId(img.id);
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
    },
    [images],
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
        previewImages: entry.previewImages ?? [],
      });
    },
    [handleImageSelect],
  );

  const isDetailPanelEntry = useCallback(
    (entry: (typeof images)[number]) =>
      entry.galleryItemType !== "storybook" &&
      entry.galleryItemType !== "collection" &&
      entry.galleryItemType !== "beat",
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
      onSwipeLeft: goToNext,
      onSwipeRight: goToPrev,
      onSwipeDown: closeSelectedImage,
      onDrag: (_dx: number, dy: number) => {
        if (dy > 0) setSheetDragY(dy);
      },
      onDragCancel: () => setSheetDragY(0),
    }),
    [goToNext, goToPrev, closeSelectedImage],
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
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goToPrev();
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goToNext();
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
    goToPrev,
    goToNext,
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
  const isLoading =
    showChildCollectionStacks && childCollectionStacks === undefined
      ? true
      : anyPaginationActive
        ? (galleryScope === "public" || canAccessMyGallery) &&
          activePagedAssets.status === "LoadingFirstPage"
        : galleryScope === "mine"
          ? canAccessMyGallery &&
            mineGalleryAssets === undefined
          : publicGalleryAssets === undefined;
  const hasFilters =
    selectedTags.length > 0 ||
    excludedFilters.length > 0 ||
    likedOnly ||
    effectiveSelectedFolderId !== null ||
    browseProject !== null ||
    selectedModelName !== null ||
    assetSearchQuery.trim().length > 0 ||
    semanticMode?.kind === "similar";
  const hasImages = images.length > 0;
  const isNoMatches = !isLoading && !hasImages && hasFilters;

  const contentMarginLeft = sidebarCollapsed
    ? "var(--lm-sidebar-collapsed)"
    : "var(--lm-sidebar-width)";

  const carouselImages = useMemo(() => {
    const previews = selectedImage?.previewImages ?? [];
    if (!selectedImage || previews.length <= 1) {
      return undefined;
    }

    return previews.map((preview) => ({
      id: preview.id,
      thumbSrc: preview.src,
      fullSrc: preview.fullSrc,
      width: preview.width,
      height: preview.height,
      prompt: preview.prompt,
      kind: preview.kind,
      contentType: preview.contentType,
    }));
  }, [selectedImage]);

  // The open asset, live. `selectedImage` is a snapshot taken on click, so
  // anything written from the panel — a description, tags, filing, a cover —
  // would leave the panel showing its own stale copy. Subscribing to the one
  // asset keeps the panel honest without re-fetching the grid.
  const selectedAssetIdForLive =
    selectedImage &&
    (selectedImage.galleryItemType === "asset" ||
      selectedImage.galleryItemType === undefined) &&
    !selectedImage.isDesignInspiration
      ? selectedImage.id
      : null;
  const liveSelectedAsset = useQuery(
    api.assets.getGalleryAsset,
    selectedAssetIdForLive && canAccessMyGallery
      ? { id: selectedAssetIdForLive as Id<"assets">, ownerUserId }
      : "skip",
  );

  const selectedImageLive = useMemo<SelectedImage | null>(() => {
    if (!selectedImage) return null;
    if (!liveSelectedAsset || liveSelectedAsset._id !== selectedImage.id) {
      return selectedImage;
    }
    return {
      ...selectedImage,
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
    };
  }, [liveSelectedAsset, selectedImage]);

  // ── Project thumbnail ──────────────────────────────────────────────────────
  // A world's card image can come from any piece inside it (the detail panel's
  // "Cover"), or from a file that isn't in the vault yet — a poster frame, a
  // title card. That second path ingests into the project's Stills pool first,
  // because a cover still has to be an asset somewhere.
  const uploadToR2 = useUploadFile(api.r2);
  const projectCoverInputRef = useRef<HTMLInputElement | null>(null);
  const [projectCoverBusy, setProjectCoverBusy] = useState(false);

  const uploadProjectCover = useCallback(
    async (file: File) => {
      if (!ownerUserId || !browseProject || projectCoverBusy) return;
      const projectId = browseProject.id as Id<"folders">;
      const promptText = `${browseProject.name} cover`;
      setProjectCoverBusy(true);
      try {
        const pool = await ensureSectionPoolMutation({
          ownerUserId,
          projectId,
          section: "stills",
        });
        // Past ~3 MB the bytes can't ride inside the ingest action call, so
        // they go browser → R2 first, exactly like the upload panel does.
        const isLarge = file.size > LARGE_IMAGE_BYTES;
        const formData = buildUploadFormData({
          promptText,
          folderId: pool.folderId as string,
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
          folderId: projectId,
          assetId: assetId as Id<"assets">,
        });
        setMoveStatus({ text: `Thumbnail set for ${browseProject.name}` });
      } catch (error) {
        setMoveStatus({
          text:
            error instanceof Error
              ? error.message
              : "Couldn't set the thumbnail.",
          error: true,
        });
      } finally {
        setProjectCoverBusy(false);
      }
    },
    [
      browseProject,
      ensureSectionPoolMutation,
      ownerUserId,
      projectCoverBusy,
      setFolderCoverMutation,
      uploadToR2,
    ],
  );

  // ── The open asset's filing model ──────────────────────────────────────────
  // The detail panel needs three things the raw folder list can't answer:
  // which folders this asset is actually in, which world each of those sits
  // under, and which of them uses this asset as its thumbnail.
  const folderById = useMemo(
    () => new Map((folders ?? []).map((folder) => [folder._id as string, folder])),
    [folders],
  );

  // folderId -> the project that links it as a member collection.
  const projectByMemberFolderId = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const project of projects ?? []) {
      for (const member of project.collections) {
        if (!map.has(member.folderId)) {
          map.set(member.folderId, { id: project._id, name: project.name });
        }
      }
    }
    return map;
  }, [projects]);

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
    // Worlds first — the project a beat belongs to is the thing whose cover
    // matters publicly, and it holds collections rather than assets, so it can
    // never be "removed from" here.
    const seenProjects = new Set<string>();
    for (const folderId of selectedFolderIds) {
      const project = projectByMemberFolderId.get(folderId);
      if (!project || seenProjects.has(project.id)) continue;
      seenProjects.add(project.id);
      const projectFolder = folderById.get(project.id);
      rows.push({
        folderId: project.id,
        label: project.name,
        context: "World",
        isCover: projectFolder?.coverAssetId === assetId,
        canRemove: false,
      });
    }
    for (const folderId of selectedFolderIds) {
      const folder = folderById.get(folderId);
      if (!folder) continue;
      const project = projectByMemberFolderId.get(folderId);
      const parent = folder.parentFolderId
        ? folderById.get(folder.parentFolderId)
        : undefined;
      rows.push({
        folderId,
        label: folder.name,
        context: project?.name ?? parent?.name,
        isCover: folder.coverAssetId === assetId,
        canRemove: true,
      });
    }
    return rows;
  }, [
    folderById,
    projectByMemberFolderId,
    selectedFolderIds,
    selectedImageLive,
  ]);

  const assetFilingTargets = useMemo<AssetFilingTarget[]>(() => {
    const targets: AssetFilingTarget[] = [];
    for (const project of projects ?? []) {
      for (const section of PANEL_SECTIONS) {
        targets.push({
          key: `${project._id}:${section.key}`,
          label: section.label,
          context: project.name,
          worldId: project._id,
          section: section.key,
        });
      }
      for (const member of project.collections) {
        targets.push({
          key: member.folderId,
          label: member.name,
          context: project.name,
          folderId: member.folderId,
        });
      }
    }
    for (const folder of collectionFoldersWithCounts) {
      if (worldSectionFolderIds.has(folder._id)) continue;
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
  }, [
    collectionFoldersWithCounts,
    folderById,
    projects,
    worldSectionFolderIds,
  ]);

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
      if (target.folderId) {
        await addAssetsToFolder(target.folderId, [assetId]);
        return;
      }
      if (!target.worldId || !target.section) return;
      // Beats never pool — filing onto a world's Beats makes one beat.
      if (target.section === "beats") {
        await createBeatsFromAssets(target.worldId, [assetId]);
        return;
      }
      await addAssetsToWorldSection(target.worldId, target.section, [assetId]);
    },
    [addAssetsToFolder, addAssetsToWorldSection, createBeatsFromAssets],
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
    onPrev: goToPrev,
    onNext: goToNext,
    canGoPrev,
    canGoNext,
    imagePosition,
    onDelete: canDeleteInCurrentView
      ? (imageId: string) => {
          void deleteAsset(imageId);
        }
      : undefined,
    deleting: deletingAssetId === selectedImage?.id,
    deleteError: canDeleteInCurrentView
      ? deletingAssetId === selectedImage?.id ||
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
    filingBusy: folderLoadingAssetId === selectedImage?.id,
    filingError:
      folderLoadingAssetId === selectedImage?.id ||
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
    onSetFeaturedState: canCuratePublic
      ? (imageId: string, isFeatured: boolean) => {
          void updateAssetCuration({
            assetId: imageId,
            isPublic: Boolean(selectedImageLive?.isPublic),
            isFeatured,
          });
        }
      : undefined,
    curationBusy:
      curationLoadingAssetId === selectedImage?.id,
    curationError:
      curationLoadingAssetId === selectedImage?.id ||
      curationError
        ? curationError
        : undefined,
    onFindSimilar: (imageId: string) => {
      void handleFindSimilar(imageId);
    },
    similarBusy:
      semanticLoading &&
      semanticMode?.kind === "similar" &&
      semanticMode.assetId === selectedImage?.id,
    similarActive:
      semanticMode?.kind === "similar" &&
      semanticMode.assetId === selectedImage?.id,
    onReplaceThumbnail: canDeleteInCurrentView
      ? handleReplaceThumbnail
      : undefined,
    replacingThumbnail:
      replacingThumbAssetId === selectedImage?.id,
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
    <div
      className="lm-brutal lm-grid-bg h-[100dvh] overflow-hidden"
      data-pillar="creators"
      style={{ backgroundColor: "var(--lm-surface-0)" }}
      onDragEnter={handleShellDragEnter}
      onDragOver={handleShellDragOver}
      onDragLeave={handleShellDragLeave}
      onDrop={handleShellDrop}
    >
      {/* Drag-and-drop overlay — drop media anywhere to open the upload modal */}
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
          modelTags={modelTags}
          selectedModelName={selectedModelName}
          onModelSelect={(name) => {
            // Navigating anywhere else leaves the project workspace — the
            // gallery behind it is what these filters act on.
            setOpenProjectId(null);
            setSelectedModelName(name);
          }}
          collapsed={sidebarCollapsed}
          onCollapsedChange={setSidebarCollapsed}
          onUploadClick={() => {
            setOpenProjectId(null);
            openAddModal();
          }}
          onFeaturedShelf={
            canManageFoldersInCurrentView
              ? () => setFeaturedPanelOpen(true)
              : undefined
          }
          featuredShelfActive={featuredPanelOpen}
          onSeedanceClick={() => setSeedanceOpen(true)}
          onStorybooksTab={
            canManageFoldersInCurrentView
              ? () => {
                  setOpenProjectId(null);
                  setStorybooksView(true);
                }
              : undefined
          }
          storybooksTabActive={storybooksView}
          onGalleryHome={() => {
            setOpenProjectId(null);
            setStorybooksView(false);
          }}
          user={user}
          onSignOut={onSignOut}
          imageCount={imageCount}
          folders={sidebarFolders}
          selectedFolderId={effectiveSelectedFolderId}
          onFolderSelect={(folderId) => {
            setOpenProjectId(null);
            setBrowseProject(null);
            setSelectedFolderId(folderId);
          }}
          onAssetsDropOnFolder={
            canManageFoldersInCurrentView ? handleAssetsDropOnFolder : undefined
          }
          storybooks={
            canManageFoldersInCurrentView
              ? (storybooks ?? []).map((storybook) => ({
                  _id: storybook._id,
                  name: storybook.name,
                  count: storybook.count,
                }))
              : []
          }
          onStorybookOpen={
            canManageFoldersInCurrentView
              ? (storybookId) => {
                  setOpenProjectId(null);
                  setOpenStorybookId(storybookId);
                }
              : undefined
          }
          onCreateStorybook={
            canManageFoldersInCurrentView ? createStorybook : undefined
          }
          onAssetsDropOnStorybook={
            canManageFoldersInCurrentView
              ? handleAssetsDropOnStorybook
              : undefined
          }
          activeProjectId={openProjectId}
          projects={
            canManageFoldersInCurrentView
              ? (projects ?? []).map((project) => ({
                  _id: project._id,
                  name: project.name,
                  count: project.assetCount,
                  worldName: project.world?.name,
                  beats: (project.collections ?? []).map(
                    (collection) => ({
                      id: collection.folderId as string,
                      name: collection.name,
                    }),
                  ),
                }))
              : []
          }
          onProjectOpen={
            canManageFoldersInCurrentView ? setOpenProjectId : undefined
          }
          onProjectBrowse={
            canManageFoldersInCurrentView ? browseProjectById : undefined
          }
          onCreateProject={
            canManageFoldersInCurrentView ? createProject : undefined
          }
          onAssetsDropOnProject={
            canManageFoldersInCurrentView
              ? handleAssetsDropOnProject
              : undefined
          }
          onAssetsDropOnBeat={
            canManageFoldersInCurrentView
              ? handleAssetsDropOnBeat
              : undefined
          }
          onRenameFolder={
            canManageFoldersInCurrentView ? handleRenameFolder : undefined
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
            () => window.open(TASTE_PROFILE_PATH, "_blank")
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
        <div className="flex min-h-0 flex-1">
          <div
            className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain"
            style={{}}
          >
            {/* Filter Bar — hidden on the Storybooks tab (asset filters don't
                apply to a storybook masonry). */}
            {!storybooksView && (
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
              />
            )}

            {/* Storybooks tab header */}
            {storybooksView && (
              <div className="flex items-center justify-between px-4 pb-2 pt-4">
                <h2
                  style={{
                    fontFamily: "var(--lm-font)",
                    fontSize: "13px",
                    fontWeight: 800,
                    letterSpacing: "0.16em",
                    textTransform: "uppercase",
                    color: "var(--lm-text-primary)",
                  }}
                >
                  Storybooks
                  <span
                    style={{
                      marginLeft: "8px",
                      fontSize: "11px",
                      fontWeight: 600,
                      color: "var(--lm-text-tertiary)",
                    }}
                  >
                    {storybookEntries.length}
                  </span>
                </h2>
              </div>
            )}

            {/* Search Vault is now in the bottom dock */}

            {!storybooksView && canCuratePublic && galleryScope === "mine" && publishAllAssetIds.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-4 pb-2">
                <button
                  type="button"
                  onClick={() => {
                    void runPublishAll();
                  }}
                  disabled={bulkCurationLoading}
                  className="lm-btn-brutal inline-flex items-center gap-1.5"
                  style={{
                    borderRadius: "10px",
                    padding: "6px 12px",
                    fontSize: "11px",
                    opacity: bulkCurationLoading ? 0.55 : 1,
                    cursor: bulkCurationLoading ? "not-allowed" : "pointer",
                  }}
                  aria-label="Make all visible private assets public"
                >
                  {bulkCurationLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                  PUBLISH ALL ({publishAllAssetIds.length})
                </button>
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
            )}

            {!storybooksView && (semanticMode?.kind === "similar" || semanticError) && (
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
              {!storybooksView && breadcrumbSegments.length > 0 && (
                <BrowseBreadcrumb
                  segments={breadcrumbSegments}
                  trailing={
                    browseBeat && canManageFoldersInCurrentView ? (
                      <span className="flex items-center gap-4">
                        <button
                          type="button"
                          onClick={() => void handleBeatUnpack(browseBeat.id)}
                          title="Dissolve this beat — its assets move to the project's Inbox"
                          className="lm-quiet-action border-none bg-transparent p-0"
                          style={quietActionStyle}
                        >
                          Unpack beat
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleBeatDelete(browseBeat.id)}
                          title="Delete this beat"
                          className="lm-quiet-action border-none bg-transparent p-0"
                          style={quietActionStyle}
                        >
                          Delete beat
                        </button>
                      </span>
                    ) : browseProject && canManageFoldersInCurrentView ? (
                      <span className="flex items-center gap-4">
                        <button
                          type="button"
                          onClick={() => void handleCreateProjectFolder()}
                          title="Create a folder inside this project for your own sorting"
                          className="lm-quiet-action border-none bg-transparent p-0"
                          style={quietActionStyle}
                        >
                          New folder
                        </button>
                        <input
                          ref={projectCoverInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.target.value = "";
                            if (file) void uploadProjectCover(file);
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => projectCoverInputRef.current?.click()}
                          disabled={projectCoverBusy}
                          title="Upload an image to use as this world's thumbnail"
                          className="lm-quiet-action border-none bg-transparent p-0"
                          style={{
                            ...quietActionStyle,
                            cursor: projectCoverBusy ? "default" : "pointer",
                          }}
                        >
                          {projectCoverBusy
                            ? "Uploading…"
                            : folderById.get(browseProject.id)?.coverAssetId
                              ? "Replace thumbnail"
                              : "Upload thumbnail"}
                        </button>
                      </span>
                    ) : undefined
                  }
                />
              )}
              {!storybooksView && browseProject && (
                <ProjectSectionTabs
                  tabs={projectSectionTabs}
                  active={projectSection}
                  onChange={selectProjectSection}
                />
              )}
              {storybooksView ? (
                storybookEntries.length > 0 ? (
                  <MasonryGrid
                    images={storybookEntries}
                    compactColumns={false}
                    onStorybookOpen={setOpenStorybookId}
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
                      No storybooks yet. Create one from the sidebar.
                    </p>
                  </div>
                )
              ) : viewMode === "collections" ? (
                galleryScope === "mine" && canAccessMyGallery ? (
                  <CollectionsGrid
                    collections={collectionCards}
                    onOpenCollection={openCollectionFromCard}
                    onRenameCollection={
                      canManageFoldersInCurrentView
                        ? handleRenameFolder
                        : undefined
                    }
                    projects={(projects ?? []).map((project) => ({
                      _id: project._id,
                      name: project.name,
                      count: project.assetCount,
                      previewAssets: project.previewAssets,
                    }))}
                    onOpenProject={openProjectFromCard}
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
              ) : viewMode === "workflows" ? (
                galleryScope === "mine" && canAccessMyGallery ? (
                  <WorkflowGrid
                    ownerUserId={ownerUserId}
                    scope={galleryScope}
                    onWorkflowSelect={setSelectedWorkflowId}
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
                      SWITCH TO MY GALLERY TO BROWSE WORKFLOWS.
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
              ) : hasImages ? (
                (
                  <MasonryGrid
                    images={images}
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
                    projects={
                      canManageFoldersInCurrentView
                        ? cardProjectOptions
                        : undefined
                    }
                    onAddAssetToProject={
                      canManageFoldersInCurrentView
                        ? handleCardAddToProject
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
                    excludeFolderId={
                      excludeScope?.kind === "folder"
                        ? excludeScope.folderId
                        : undefined
                    }
                    onStorybookOpen={setOpenStorybookId}
                    onCollectionOpen={handleCardCollectionOpen}
                    onBeatOpen={handleCardBeatOpen}
                    onBeatUnpack={
                      canManageFoldersInCurrentView
                        ? handleBeatUnpack
                        : undefined
                    }
                    onBeatDelete={
                      canManageFoldersInCurrentView
                        ? handleBeatDelete
                        : undefined
                    }
                    showPublicBadge={galleryScope === "mine"}
                    onEndReached={
                      anyPaginationActive ? loadNextGalleryPage : undefined
                    }
                    zoom={gridZoom}
                  />
                )
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
          user={user}
          onSignOut={onSignOut}
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

      {/* Bulk selection toolbar — visible only when selection is non-empty */}
      {(canCuratePublic || canManageFoldersInCurrentView) &&
        selectedAssetIds.size > 0 && (
        <div
          className="fixed z-[55] flex justify-center pointer-events-none"
          style={{
            left: sidebarCollapsed
              ? "var(--lm-sidebar-collapsed)"
              : "var(--lm-sidebar-width)",
            right: "0",
            bottom: "104px",
            transition:
              "left var(--lm-duration-normal) ease-out, right var(--lm-duration-normal) ease-out",
          }}
          role="region"
          aria-label="Bulk curation toolbar"
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
                Shift-click a range · drag empty space to box · Esc to clear
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
                <div className="relative">
                  <button
                    type="button"
                    // ADD TO now opens the filing drawer instead of the old
                    // dropdown: same job, but it stays open while you scroll
                    // and accepts drops. (The dropdown below is unreachable
                    // and due for removal.)
                    onClick={() => {
                      setBulkAddMenuOpen(false);
                      setAddToPanelOpen(true);
                    }}
                    disabled={bulkCurationLoading || bulkAddBusy}
                    className="lm-btn-ghost inline-flex items-center gap-1.5"
                    style={{
                      border: "2px solid var(--lm-border-strong)",
                      borderRadius: "10px",
                      padding: "6px 12px",
                      fontSize: "11px",
                      opacity: bulkCurationLoading || bulkAddBusy ? 0.55 : 1,
                      cursor:
                        bulkCurationLoading || bulkAddBusy
                          ? "not-allowed"
                          : "pointer",
                    }}
                    aria-haspopup="menu"
                    aria-expanded={bulkAddMenuOpen}
                    aria-label="Manage selected assets in collections and projects"
                    title="Select or deselect collections and projects"
                  >
                    {bulkAddBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <FolderPlus className="h-3.5 w-3.5" />
                    )}
                    ADD TO
                  </button>
                  {bulkAddMenuOpen && (
                    <div
                      role="menu"
                      className="absolute bottom-full left-0 mb-2 flex max-h-96 w-72 flex-col py-1"
                      style={{
                        backgroundColor: "var(--lm-surface-1)",
                        border: "2px solid var(--lm-ink)",
                        borderRadius: "12px",
                        boxShadow: "var(--shadow-lg)",
                        zIndex: 60,
                      }}
                    >
                      {/* Create-new row */}
                      <div
                        className="flex flex-col gap-1.5 px-3 pb-2 pt-1.5"
                        style={{
                          borderBottom: "1px solid var(--lm-border-subtle)",
                        }}
                      >
                        <input
                          autoFocus
                          value={bulkAddDraft}
                          disabled={bulkAddBusy}
                          onChange={(event) => setBulkAddDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              void createTargetAndAddSelected("collection");
                            }
                            if (event.key === "Escape") {
                              setBulkAddMenuOpen(false);
                            }
                          }}
                          placeholder="New collection or project…"
                          className="w-full bg-transparent pb-1 outline-none"
                          style={{
                            fontFamily: "var(--lm-font)",
                            fontSize: "12px",
                            fontWeight: 600,
                            color: "var(--lm-text-primary)",
                            borderBottom: "1px solid var(--lm-coral)",
                            caretColor: "var(--lm-coral)",
                            opacity: bulkAddBusy ? 0.5 : 1,
                          }}
                          aria-label="Name for a new collection or project"
                        />
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              void createTargetAndAddSelected("collection");
                            }}
                            disabled={bulkAddBusy || !bulkAddDraft.trim()}
                            className="inline-flex items-center gap-1 px-2 py-1"
                            style={{
                              fontFamily: "var(--lm-font)",
                              fontSize: "10px",
                              fontWeight: 800,
                              letterSpacing: "0.08em",
                              textTransform: "uppercase",
                              color: bulkAddDraft.trim()
                                ? "var(--lm-coral)"
                                : "var(--lm-text-ghost)",
                              backgroundColor: "transparent",
                              cursor:
                                bulkAddBusy || !bulkAddDraft.trim()
                                  ? "not-allowed"
                                  : "pointer",
                            }}
                          >
                            <Plus className="h-3 w-3" /> Collection
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              void createTargetAndAddSelected("project");
                            }}
                            disabled={bulkAddBusy || !bulkAddDraft.trim()}
                            className="inline-flex items-center gap-1 px-2 py-1"
                            style={{
                              fontFamily: "var(--lm-font)",
                              fontSize: "10px",
                              fontWeight: 800,
                              letterSpacing: "0.08em",
                              textTransform: "uppercase",
                              color: bulkAddDraft.trim()
                                ? "var(--lm-coral)"
                                : "var(--lm-text-ghost)",
                              backgroundColor: "transparent",
                              cursor:
                                bulkAddBusy || !bulkAddDraft.trim()
                                  ? "not-allowed"
                                  : "pointer",
                            }}
                          >
                            <Plus className="h-3 w-3" /> Project
                          </button>
                        </div>
                      </div>

                      <p
                        className="px-3 py-2"
                        style={{
                          borderBottom: "1px solid var(--lm-border-subtle)",
                          fontFamily: "var(--lm-font)",
                          fontSize: "10px",
                          lineHeight: 1.4,
                          color: "var(--lm-text-tertiary)",
                          margin: 0,
                        }}
                      >
                        Checked means all selected assets belong there. Click
                        again to remove them.
                      </p>

                      <div className="overflow-y-auto">
                        {/* Collections (roots + nested sub-collections) */}
                        {bulkAddCollectionTree.roots.length > 0 && (
                          <p
                            className="px-3 pb-1 pt-2"
                            style={{
                              fontFamily: "var(--lm-font)",
                              fontSize: "9px",
                              fontWeight: 800,
                              letterSpacing: "0.16em",
                              textTransform: "uppercase",
                              color: "var(--lm-text-ghost)",
                              margin: 0,
                            }}
                          >
                            Collections
                          </p>
                        )}
                        {bulkAddCollectionTree.roots.map((folder) => (
                          <div key={folder._id}>
                            <button
                              type="button"
                              role="menuitemcheckbox"
                              aria-checked={bulkMembershipAriaState(
                                selectedFolderMembershipCounts.get(folder._id) ??
                                  0,
                                selectedAssetMemberships.length,
                              )}
                              disabled={bulkAddBusy}
                              onClick={() => {
                                void toggleSelectedFolder(folder._id);
                              }}
                              className="interactive-ghost flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left"
                              style={{
                                fontFamily: "var(--lm-font)",
                                fontSize: "12px",
                                fontWeight: 600,
                                color: "var(--lm-text-primary)",
                                backgroundColor: "transparent",
                                cursor: bulkAddBusy ? "wait" : "pointer",
                              }}
                            >
                              <span className="truncate">{folder.name}</span>
                              <BulkMembershipMark
                                count={
                                  selectedFolderMembershipCounts.get(
                                    folder._id,
                                  ) ?? 0
                                }
                                total={selectedAssetMemberships.length}
                              />
                            </button>
                            {(bulkAddCollectionTree.childrenByParent.get(folder._id) ?? []).map(
                              (child) => (
                                <button
                                  key={child._id}
                                  type="button"
                                  role="menuitemcheckbox"
                                  aria-checked={bulkMembershipAriaState(
                                    selectedFolderMembershipCounts.get(
                                      child._id,
                                    ) ?? 0,
                                    selectedAssetMemberships.length,
                                  )}
                                  disabled={bulkAddBusy}
                                  onClick={() => {
                                    void toggleSelectedFolder(child._id);
                                  }}
                                  className="interactive-ghost flex w-full items-center justify-between gap-2 py-1.5 pl-7 pr-3 text-left"
                                  style={{
                                    fontFamily: "var(--lm-font)",
                                    fontSize: "12px",
                                    fontWeight: 500,
                                    color: "var(--lm-text-secondary)",
                                    backgroundColor: "transparent",
                                    cursor: bulkAddBusy ? "wait" : "pointer",
                                  }}
                                >
                                  <span className="truncate">{child.name}</span>
                                  <BulkMembershipMark
                                    count={
                                      selectedFolderMembershipCounts.get(
                                        child._id,
                                      ) ?? 0
                                    }
                                    total={selectedAssetMemberships.length}
                                  />
                                </button>
                              ),
                            )}
                          </div>
                        ))}

                        {/* Projects */}
                        {(projects ?? []).length > 0 && (
                          <p
                            className="px-3 pb-1 pt-2"
                            style={{
                              fontFamily: "var(--lm-font)",
                              fontSize: "9px",
                              fontWeight: 800,
                              letterSpacing: "0.16em",
                              textTransform: "uppercase",
                              color: "var(--lm-text-ghost)",
                              margin: 0,
                              borderTop: "1px solid var(--lm-border-subtle)",
                            }}
                          >
                            Projects
                          </p>
                        )}
                        {(projects ?? []).map((project) => (
                          <button
                            key={project._id}
                            type="button"
                            role="menuitemcheckbox"
                            aria-checked={bulkMembershipAriaState(
                              selectedProjectMembershipCounts.get(
                                String(project._id),
                              ) ?? 0,
                              selectedAssetMemberships.length,
                            )}
                            disabled={bulkAddBusy}
                            onClick={() => {
                              void toggleSelectedProject(project._id);
                            }}
                            className="interactive-ghost flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left"
                            style={{
                              fontFamily: "var(--lm-font)",
                              fontSize: "12px",
                              fontWeight: 600,
                              color: "var(--lm-text-primary)",
                              backgroundColor: "transparent",
                              cursor: bulkAddBusy ? "wait" : "pointer",
                            }}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <Layers
                                className="h-3 w-3 flex-shrink-0"
                                style={{ color: "var(--lm-text-ghost)" }}
                              />
                              <span className="truncate">{project.name}</span>
                            </span>
                            <BulkMembershipMark
                              count={
                                selectedProjectMembershipCounts.get(
                                  String(project._id),
                                ) ?? 0
                              }
                              total={selectedAssetMemberships.length}
                            />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {canCuratePublic && (
              <>
              <button
                type="button"
                onClick={() => {
                  void runBulkCuration(true, undefined, true);
                }}
                disabled={bulkCurationLoading}
                className="lm-btn-brutal inline-flex items-center gap-1.5"
                style={{
                  borderRadius: "10px",
                  padding: "6px 12px",
                  fontSize: "11px",
                  opacity: bulkCurationLoading ? 0.55 : 1,
                  cursor: bulkCurationLoading ? "not-allowed" : "pointer",
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
                disabled={bulkCurationLoading}
                className="lm-btn-brutal inline-flex items-center gap-1.5"
                style={{
                  borderRadius: "10px",
                  padding: "6px 12px",
                  fontSize: "11px",
                  opacity: bulkCurationLoading ? 0.55 : 1,
                  cursor: bulkCurationLoading ? "not-allowed" : "pointer",
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
                disabled={bulkCurationLoading}
                className="lm-btn-ghost inline-flex items-center gap-1.5"
                style={{
                  border: "2px solid var(--lm-border-strong)",
                  borderRadius: "10px",
                  padding: "6px 12px",
                  fontSize: "11px",
                  opacity: bulkCurationLoading ? 0.55 : 1,
                  cursor: bulkCurationLoading ? "not-allowed" : "pointer",
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
                  cursor: bulkCurationLoading ? "not-allowed" : "pointer",
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
        projects={projects ?? []}
        worlds={uploadWorlds}
        ownerUserId={
          canAccessMyGallery ? ownerUserId : undefined
        }
        canPromoteToPublic={canCuratePublic}
        initialFiles={uploadInitialFiles}
      />

      <SeedanceIngestModal
        open={isSeedanceOpen}
        onClose={() => setSeedanceOpen(false)}
      />

      <CinemaModal
        asset={selectedCinemaAsset}
        onClose={() => setSelectedCinemaAsset(null)}
      />

      <WorkflowModal
        workflowId={selectedWorkflowId}
        ownerUserId={ownerUserId}
        onClose={() => setSelectedWorkflowId(null)}
      />

      <StorybookModal
        ownerUserId={ownerUserId}
        storybookId={openStorybookId}
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

      <ReviewModal
        key={openProjectId ?? "review-closed"}
        ownerUserId={ownerUserId}
        projectId={openProjectId}
        initialBeatId={openProjectTarget?.beatFolderId ?? null}
        allCollections={projectCollectionOptions}
        leftOffset={contentMarginLeft}
        onClose={() => setOpenProjectId(null)}
      />

      {canAccessMyGallery && (
        <AddToPanel
          open={addToPanelOpen}
          onClose={() => setAddToPanelOpen(false)}
          selectedAssetIds={selectedAssetIdList}
          worlds={panelWorlds}
          collections={panelCollections}
          onAddToFolder={addAssetsToFolder}
          onAddToSection={addAssetsToWorldSection}
          onCreateBeat={createBeatFromAssets}
          onAddAsBeats={createBeatsFromAssets}
          onCreateCollection={createCollectionFromAssets}
          onUpdateDescription={updateFolderDescription}
        />
      )}
    </div>
    </CoralToastProvider>
  );
}
