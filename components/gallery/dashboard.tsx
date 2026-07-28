"use client";

import "@/app/tokens.css";
import { compareCollectionSectionNames } from "@/lib/collection-sections";

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
import { downloadImagesAsZip } from "@/lib/download-image";
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
import { PackGrid, PackDetailView } from "./pack-grid";
import { CollectionsGrid } from "./collections-grid";
import {
  BrowseBreadcrumb,
  type BreadcrumbSegment,
} from "./browse-breadcrumb";
import { GalleryDetailPanel } from "./detail-panel";
import { WorkflowModal } from "./workflow-modal";
import { StorybookModal } from "./storybook-modal";
import { ReviewModal } from "./review-modal";
import { UploadModal } from "@/components/upload-modal";
import { CinemaModal, type CinemaModalAsset } from "./cinema-modal";
import { SeedanceIngestModal } from "@/components/seedance-ingest-modal";
import { AiWorkspacePanel } from "@/components/ai-workspace-panel";
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
  resolveAccessibleGalleryScope,
  resolveScopeFolderFilter,
} from "@/lib/gallery-filters";

const INTENT_LABELS = {
  transfer_style: "Transfer Style",
  transfer_pose: "Transfer Pose",
  replace_character: "Replace Character",
} as const;


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
  const [workflowsOnly, setWorkflowsOnly] = useState<boolean>(false);
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
    if (mode !== "packs") setSelectedPackId(null);
  }, []);
  // Browsing a project's pool in the main grid (breadcrumb: PROJECTS / name).
  const [browseProject, setBrowseProject] = useState<{
    id: string;
    name: string;
  } | null>(null);
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
  // files straight into a direction. Without this the shell overlay and the
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
      const files = Array.from(event.dataTransfer?.files ?? []).filter(
        (file) =>
          file.type.startsWith("image/") || file.type.startsWith("video/"),
      );
      if (files.length > 0) openUploadWithFiles(files);
    },
    [canAcceptShellDrop, openUploadWithFiles],
  );
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceRunId, setWorkspaceRunId] = useState<string>();
  const [workspaceActionLabel, setWorkspaceActionLabel] =
    useState("Prompt Package");
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceContent, setWorkspaceContent] = useState("");
  const [workspaceError, setWorkspaceError] = useState<string>();
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
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [editAssetError, setEditAssetError] = useState<string>();
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [bulkCurationLoading, setBulkCurationLoading] = useState(false);
  const [bulkCurationError, setBulkCurationError] = useState<string>();
  const [bulkCurationStatus, setBulkCurationStatus] = useState<string>();
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
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
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
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
  const canEditAssets = adminMode && canCuratePublic;
  const canManageFoldersInCurrentView =
    canAccessMyGallery && galleryScope === "mine";

  const setAssetFoldersMutation = useMutation(
    api.assets.setAssetFolders,
  );
  const addAssetFoldersMutation = useMutation(
    api.assets.addAssetFolders,
  );
  const setAssetLikedMutation = useMutation(api.assets.setAssetLiked);
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
  const updateFolderMutation = useMutation(api.folders.updateFolder);
  const deleteFolderMutation = useMutation(api.folders.deleteFolder);
  const setFolderShowcasedMutation = useMutation(
    api.folders.setFolderShowcased,
  );
  const setFolderFeaturedMutation = useMutation(api.folders.setFolderFeatured);
  const setTasteCollectionMutation = useMutation(
    api.folders.setTasteCollection,
  );
  const deleteWorkflowMutation = useMutation(api.workflows.deleteWorkflow);
  // Ids of workflow grid entries, so delete can route to the right backend.
  // A ref (synced below where workflow entries are computed) because
  // deleteAsset is declared before the workflows query.
  const workflowIdsRef = useRef<Set<string>>(new Set());
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
    setEditAssetError(undefined);
    setEditingAssetId(null);
    setSelectedImage(null);
    setSheetDismissing(false);
    setSheetDragY(0);
    setSemanticMode(null);
    setSemanticResults(null);
    setSemanticError(undefined);
    setSemanticLoading(false);
    setSelectedPackId(null);
    setSelectedAssetIds(new Set());
    setBulkCurationError(undefined);
    setBulkCurationStatus(undefined);
    setBulkAddMenuOpen(false);
    setLikedOnly(false);
  }, [galleryScope]);

  useEffect(() => {
    setFolderError(undefined);
    setFolderLoadingAssetId(null);
    setEditAssetError(undefined);
    setEditingAssetId(null);
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

  const saveAssetEdit = useCallback(
    async (
      assetId: string,
      patch: {
        description: string | null;
        promptText: string | null;
        tagNames: string[];
        kind: "image" | "video";
        modelName: string | null;
        pillar: string | null;
        generationType: string | null;
        assetRole: string | null;
        ingestSource: string | null;
        sourceUrl: string | null;
        fileName: string | null;
        contentType: string | null;
      },
    ) => {
      if (!canEditAssets || editingAssetId) return;

      setEditAssetError(undefined);
      setEditingAssetId(assetId);
      try {
        const response = await fetch(
          `/api/admin/assets/${encodeURIComponent(assetId)}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(patch),
          },
        );
        const payload = (await response.json().catch(() => null)) as
          | {
              error?: string;
              result?: {
                assetId: string;
                promptText?: string;
                description?: string;
                tagNames: string[];
                folderId?: string;
                sourceUrl?: string;
                fileName?: string;
                contentType?: string;
                kind?: "image" | "video";
                modelName?: string;
                pillar?: string;
                generationType?: string;
                assetRole?: string;
                ingestSource?: string;
              };
            }
          | null;
        if (!response.ok || !payload?.result) {
          throw new Error(payload?.error || "Failed to update asset.");
        }

        const result = payload.result;
        setSelectedImage((current) => {
          if (!current) return current;
          const previewImages = current.previewImages?.map((preview) =>
            preview.id === result.assetId
              ? {
                  ...preview,
                  prompt: result.promptText ?? preview.prompt,
                }
              : preview,
          );
          if (current.id !== result.assetId) {
            return {
              ...current,
              previewImages,
            };
          }
          return {
            ...current,
            prompt: result.promptText ?? current.prompt,
            description: result.description ?? undefined,
            tagNames: result.tagNames,
            folderId: result.folderId ?? undefined,
            sourceUrl: result.sourceUrl ?? undefined,
            fileName: result.fileName ?? undefined,
            contentType: result.contentType ?? undefined,
            kind: result.kind ?? current.kind,
            modelName: result.modelName ?? undefined,
            pillar: result.pillar ?? undefined,
            generationType: result.generationType ?? undefined,
            assetRole: result.assetRole ?? undefined,
            ingestSource: result.ingestSource ?? undefined,
            previewImages,
          };
        });
      } catch (error) {
        setEditAssetError(
          error instanceof Error ? error.message : "Failed to update asset.",
        );
        throw error;
      } finally {
        setEditingAssetId((current) => (current === assetId ? null : current));
      }
    },
    [canEditAssets, editingAssetId],
  );

  const toggleAssetSelection = useCallback((assetId: string) => {
    setBulkCurationError(undefined);
    setBulkCurationStatus(undefined);
    setSelectedAssetIds((current) => {
      const next = new Set(current);
      if (next.has(assetId)) {
        next.delete(assetId);
      } else {
        next.add(assetId);
      }
      return next;
    });
  }, []);

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

  const setAssetFolders = useCallback(
    async (assetId: string, folderIds: string[]) => {
      if (!canAccessMyGallery) {
        setFolderError("Sign in to manage folders.");
        return;
      }
      if (folderLoadingAssetId) return;

      setFolderError(undefined);
      setFolderLoadingAssetId(assetId);
      try {
        const result = await setAssetFoldersMutation({
          ownerUserId,
          assetId: assetId as Id<"assets">,
          folderIds: Array.from(new Set(folderIds))
            .filter((folderId) => folderId.trim().length > 0)
            .map((folderId) => folderId as Id<"folders">),
        });
        const nextFolderId = result.folderId ?? undefined;
        const nextFolderIds = (result.folderIds ?? []).map(String);
        setSelectedImage((current) =>
          current && current.id === assetId
            ? {
                ...current,
                folderId: nextFolderId,
                folderIds: nextFolderIds,
              }
            : current,
        );

        if (
          galleryScope === "mine" &&
          selectedFolderId &&
          !nextFolderIds.includes(selectedFolderId)
        ) {
          setSelectedImage((current) =>
            current?.id === assetId ? null : current,
          );
        }
      } catch (error) {
        setFolderError(
          error instanceof Error
            ? error.message
            : "Failed to update asset folder.",
        );
      } finally {
        setFolderLoadingAssetId((current) =>
          current === assetId ? null : current,
        );
      }
    },
    [
      canAccessMyGallery,
      folderLoadingAssetId,
      galleryScope,
      ownerUserId,
      selectedFolderId,
      setAssetFoldersMutation,
    ],
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
        // Workflow grid entries carry a workflows-table id — the assets
        // DELETE route can't touch them, so route by item type.
        if (workflowIdsRef.current.has(assetId)) {
          await deleteWorkflowMutation({
            ownerUserId,
            id: assetId as Id<"workflows">,
          });
          setSelectedWorkflowId((current) =>
            current === assetId ? null : current,
          );
        } else {
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
      deleteWorkflowMutation,
      ownerUserId,
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
  const foldersWithCounts = useMemo(
    () =>
      (folders ?? []).map((folder) => ({
        ...folder,
        count: folderCountById.get(folder._id) ?? 0,
      })),
    [folders, folderCountById],
  );
  // Storybooks, projects, and project directions (beats/stacks/pools) are
  // folders too, but they surface through their own UIs — keep them out of
  // the plain collections list.
  const collectionFoldersWithCounts = useMemo(
    () =>
      foldersWithCounts.filter(
        (folder) =>
          folder.kind !== "storybook" &&
          folder.kind !== "project" &&
          folder.kind !== "direction",
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
  const collectionSummaries = useQuery(
    api.folders.listCollectionSummaries,
    viewMode === "collections" && galleryScope === "mine" && canAccessMyGallery
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
      setViewMode("grid");
    },
    [setOpenProjectId, setViewMode],
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

  // selectedTags holds the ids of selected tag-kind menu filters; the grid
  // filter is the union of their resolved tagIds. A same-named collection
  // backed by a curated tag filter is a smart collection: keep the folder
  // selected for navigation, but use the exact tag predicate from the island.
  const selectedTagIds = useMemo(() => {
    const selectedSet = new Set(selectedTags);
    if (activeSmartCollectionFilter) {
      selectedSet.add(activeSmartCollectionFilter._id);
    }
    if (selectedSet.size === 0) return undefined;
    const ids = new Set<Id<"tags">>();
    for (const entry of menuFilterEntries) {
      if (entry.kind !== "tag" || !selectedSet.has(entry._id)) continue;
      for (const id of entry.tagIds) {
        ids.add(id);
      }
    }
    return ids.size > 0 ? Array.from(ids) : undefined;
  }, [activeSmartCollectionFilter, selectedTags, menuFilterEntries]);
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
      return [
        {
          label: "Projects",
          onClick: () => {
            setBrowseProject(null);
            setViewMode("collections");
          },
        },
        { label: browseProject.name },
      ];
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
    browseProject,
    effectiveSelectedFolderId,
    foldersWithCounts,
    galleryScope,
    setViewMode,
    viewMode,
  ]);

  // Tag filters also take the one-shot path: the page query post-filters each
  // 60-item page, so a sparse tag can hand the grid an empty first page (it
  // reads as "no matches") even when hundreds match. The one-shot query
  // returns the full filtered set, keeping the grid consistent with the menu
  // pill counts.
  const paginationActive =
    sortOrder === "newest" &&
    !effectiveSelectedFolderId &&
    !browseProject &&
    !selectedTagIds;

  // Collection browsing gets its own cursor pagination over the membership
  // links, so a collection of ANY size streams fully (no 600-item cap).
  // Combining the folder with another asset filter falls back to the capped
  // one-shot query, same as before.
  const folderPaginationActive =
    galleryScope === "mine" &&
    canAccessMyGallery &&
    Boolean(effectiveSelectedFolderId) &&
    !browseProject &&
    sortOrder === "newest" &&
    !selectedTagIds &&
    !selectedModelName &&
    !mediaKind &&
    !likedOnly;

  const minePagedAssets = usePaginatedQuery(
    api.assets.listGalleryAssetsPage,
    paginationActive && galleryScope === "mine" && canAccessMyGallery
      ? {
          ownerUserId,
          tagIds: selectedTagIds,
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
          tagIds: selectedTagIds,
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
    galleryScope === "mine" &&
    viewMode === "grid" &&
    !effectiveSelectedFolderId &&
    !selectedModelName &&
    !mediaKind &&
    !likedOnly &&
    !workflowsOnly &&
    selectedTags.length === 0 &&
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
    !workflowsOnly &&
    selectedTags.length === 0 &&
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
          tagIds: selectedTagIds,
          folderId:
            effectiveSelectedFolderId && !activeSmartCollectionFilter
            ? (effectiveSelectedFolderId as Id<"folders">)
            : undefined,
          projectId: browseProject
            ? (browseProject.id as Id<"folders">)
            : undefined,
          // Beats render as stack cards (below) — keep their members out of
          // the flat tiles so nothing shows twice.
          excludeBeatAssets: showBeatStacks ? true : undefined,
          modelName: selectedModelName ?? undefined,
          kind: mediaKind ?? undefined,
          onlyLiked: likedOnly || undefined,
          limit: 600,
        }
      : "skip",
  );

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
          tagIds: selectedTagIds,
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
  const baseGalleryAssets = useMemo(
    () => galleryAssets ?? [],
    [galleryAssets],
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

  // Collection-kind menu pill: behaves like picking the collection in the
  // sidebar — single-select folder filter, click again to clear.
  const handleMenuCollectionToggle = useCallback((folderId: string) => {
    setBrowseProject(null);
    setSelectedFolderId((current) => (current === folderId ? null : folderId));
  }, []);

  const handleClearAll = () => setSelectedTags([]);
  // Clears EVERYTHING hasFilters counts — including the search/semantic mode.
  // (The empty state's "clear all filters" used to leave the search active,
  // so the button appeared broken on zero-result searches.)
  const handleClearFilters = () => {
    setSelectedTags([]);
    setSelectedFolderId(null);
    setBrowseProject(null);
    setSelectedModelName(null);
    setWorkflowsOnly(false);
    setMediaKind(null);
    setLikedOnly(false);
    setAssetSearchQuery("");
    setDebouncedAssetSearchQuery("");
    setSemanticMode(null);
    setSemanticResults(null);
    setSemanticError(undefined);
    setSemanticLoading(false);
  };
  // Content-type filter: Image/Video (asset kind) and Workflows are mutually
  // exclusive — picking one clears the others.
  const handleMediaKindChange = useCallback((next: "image" | "video" | null) => {
    setMediaKind(next);
    if (next) setWorkflowsOnly(false);
  }, []);
  const handleWorkflowsOnlyChange = useCallback((next: boolean) => {
    setWorkflowsOnly(next);
    if (next) {
      setMediaKind(null);
      // Workflows aren't likeable assets — leave the liked-only view.
      setLikedOnly(false);
    }
  }, []);
  const handleLikedOnlyChange = useCallback((next: boolean) => {
    setLikedOnly(next);
    // Liked filters the asset grid, so it can't coexist with the workflow view.
    if (next) setWorkflowsOnly(false);
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
      if (
        selectedTagIds &&
        !asset.tagIds.some((tagId: Id<"tags">) => selectedTagIds.includes(tagId))
      ) {
        return false;
      }
      return true;
    });
  }, [
    activeSmartCollectionFilter,
    effectiveSelectedFolderId,
    galleryScope,
    mediaKind,
    selectedModelName,
    selectedTagIds,
    semanticResults,
  ]);

  const displayGalleryAssets =
    filteredSemanticResults !== null
      ? filteredSemanticResults
      : lexicalFilteredAssets;

  const baseImages = useMemo(() => {
    if (!displayGalleryAssets) return [];
    return buildGalleryEntries({
      assets: displayGalleryAssets,
      hiddenAssetIds,
      loadedAssetIds: loadedImageIdsRef.current,
      sortOrder,
      shuffleSeed,
    });
  }, [
    displayGalleryAssets,
    hiddenAssetIds,
    sortOrder,
    shuffleSeed,
  ]);

  // Workflows are an organizing layer — they mix into the grid as their own
  // card type and open a dedicated modal instead of the side detail panel.
  const workflowCards = useQuery(
    api.workflows.listWorkflows,
    ownerUserId
      ? {
          ownerUserId,
          scope: galleryScope,
          limit: 40,
          previewLimit: 8,
        }
      : "skip",
  );

  const workflowEntries = useMemo(() => {
    if (!workflowCards) return [];
    return workflowCards.map((workflow) => {
      const playable = workflow.previewImages.filter((media) =>
        Boolean(media.url),
      );
      const imageMedia = playable.filter((media) => media.kind === "image");
      const carousel = imageMedia.length > 0 ? imageMedia : playable;
      const previewImages = carousel.map((media) => ({
        id: media.id,
        galleryItemId: media.id,
        galleryItemType: "workflow" as const,
        src: media.thumbUrl ?? media.url ?? "/placeholder.svg",
        fullSrc: media.url ?? "/placeholder.svg",
        prompt: workflow.title,
        width: media.width,
        height: media.height,
        kind: media.kind,
        contentType: media.contentType,
      }));
      const cover = previewImages[0];
      return {
        id: workflow._id,
        galleryItemId: workflow._id,
        galleryItemType: "workflow" as const,
        src: cover?.src ?? "/placeholder.svg",
        fullSrc: cover?.fullSrc ?? "/placeholder.svg",
        prompt: workflow.description?.trim() || workflow.title,
        author: "Workflow",
        likes: 0,
        width: cover?.width,
        height: cover?.height,
        kind: cover?.kind,
        contentType: cover?.contentType,
        modelName: undefined as string | undefined,
        pillar: workflow.pillar ?? undefined,
        tagNames: workflow.tagNames,
        sourceUrl: undefined as string | undefined,
        createdAt: workflow.createdAt,
        folderId: undefined as string | undefined,
        isPublic: workflow.isPublic ?? false,
        isFeatured: workflow.isFeatured ?? false,
        stepCount: workflow.stepCount,
        previewImages,
      };
    });
  }, [workflowCards]);

  // Keep the delete router's workflow-id set in sync with the grid entries.
  useEffect(() => {
    workflowIdsRef.current = new Set(
      workflowEntries.map((entry) => entry.id as string),
    );
  }, [workflowEntries]);

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
    !workflowsOnly &&
    selectedTags.length === 0 &&
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
    if (workflowsOnly) return workflowEntries;
    const stacks = showStorybookStacks ? storybookEntries : [];
    const beats =
      showBeatStacks || showCollectionBeatStacks ? beatEntries : [];
    const childCollections = showChildCollectionStacks
      ? childCollectionEntries
      : [];
    // When filtering by media kind (image/video) or liked-only, keep workflows
    // out of the grid — those filters target likeable assets, not workflows.
    const flatImages = baseImages.filter((image) => {
      if (collectionBeatMemberIds?.has(image.id)) return false;
      if (!childCollectionIds || !("folderIds" in image)) return true;
      return !(image.folderIds ?? []).some((folderId) =>
        childCollectionIds.has(folderId),
      );
    });
    const mixed =
      mediaKind || likedOnly
        ? flatImages
        : workflowEntries.length === 0
          ? flatImages
          : sortOrder === "shuffle"
            ? // Don't re-sort by date — that would undo the shuffle deal.
              [...workflowEntries, ...flatImages]
            : [...workflowEntries, ...flatImages].sort(
                (left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0),
              );
    // Stacks lead the grid — they're shelves, not dated assets. In project
    // browse that's the beats; in the default state, storybooks.
    const leading = [...stacks, ...childCollections, ...beats];
    return leading.length > 0 ? [...leading, ...mixed] : mixed;
  }, [
    workflowsOnly,
    mediaKind,
    likedOnly,
    sortOrder,
    workflowEntries,
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
        // and beat/direction memberships are orthogonal overlays and survive
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

  // Per-card menu targets: plain collections (Move/Add) plus storybooks
  // (always additive). Projects group collections, not assets, so they are
  // never asset-membership targets and are excluded.
  const cardCollections = useMemo(
    () => [
      ...collectionFoldersWithCounts.map((folder) => ({
        id: folder._id as string,
        name: folder.name,
        count: folder.count,
        kind: "collection" as const,
      })),
      ...(storybooks ?? []).map((storybook) => ({
        id: storybook._id as string,
        name: storybook.name,
        count: storybook.count,
        kind: "storybook" as const,
      })),
    ],
    [collectionFoldersWithCounts, storybooks],
  );

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
    },
    [images, selectedAssetIds],
  );

  // Dropping on a collection ADDS membership, exactly like storybooks and
  // directions below — every drop target in the sidebar behaves the same.
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

  // Dropping on a direction (a project's member collection) ADDS membership,
  // same semantics as storybooks — directions layer on top of the asset's home.
  const handleAssetsDropOnDirection = useCallback(
    async (directionId: string, assetIds: string[]) => {
      if (assetIds.length === 0) return;
      try {
        await Promise.all(
          assetIds.map((assetId) =>
            addAssetFoldersMutation({
              ownerUserId,
              assetId: assetId as Id<"assets">,
              folderIds: [directionId as Id<"folders">],
            }),
          ),
        );
        setMoveStatus({
          text: `Added ${assetIds.length} asset${assetIds.length === 1 ? "" : "s"} to ${folderNameById.get(directionId) ?? "direction"}`,
        });
      } catch (error) {
        setMoveStatus({
          text:
            error instanceof Error
              ? error.message
              : "Failed to add to direction.",
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

  // Dropping on a project files assets into its "<Project> — Inbox" direction
  // (created + attached on first drop, idempotent) so a drop never needs a
  // target choice mid-drag; sort into proper directions later.
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

  // A beat click steps into the project workspace — the separate review view
  // over the same linked assets. In collection browse the beat's owning
  // project is looked up from the project summaries.
  const handleCardBeatOpen = useCallback(
    (beatFolderId: string) => {
      const projectId =
        browseProject?.id ??
        (projects ?? []).find((project) =>
          project.collections.some(
            (collection) =>
              collection.folderId === beatFolderId &&
              collection.section === "beats",
          ),
        )?._id;
      if (projectId) {
        setOpenProjectTarget({ projectId, beatFolderId });
      }
    },
    [browseProject?.id, projects],
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

  const runAction = useCallback(
    async (
      intent: keyof typeof INTENT_LABELS,
      referenceAssetId: string,
      promptText?: string,
    ) => {
      setWorkspaceOpen(true);
      setWorkspaceLoading(true);
      setWorkspaceError(undefined);
      setWorkspaceContent("");
      setWorkspaceRunId(undefined);
      setWorkspaceActionLabel(INTENT_LABELS[intent]);

      try {
        const response = await fetch("/api/ai/runs/stream", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            intent,
            referenceAssetId,
            source: "dashboard",
            userInput: { prompt: promptText },
          }),
        });

        if (!response.ok || !response.body) {
          const payload = (await response
            .json()
            .catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(
            payload?.error || "Failed to start AI run.",
          );
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let delimiterIndex = buffer.indexOf("\n");
          while (delimiterIndex >= 0) {
            const line = buffer
              .slice(0, delimiterIndex)
              .trim();
            buffer = buffer.slice(delimiterIndex + 1);
            if (line) {
              const event = JSON.parse(line) as {
                type:
                  | "run_start"
                  | "partial"
                  | "done"
                  | "error"
                  | "canceled";
                runId?: string;
                partial?: unknown;
                output?: unknown;
                error?: string;
                message?: string;
              };
              if (event.runId) setWorkspaceRunId(event.runId);
              if (event.type === "partial" && event.partial)
                setWorkspaceContent(
                  JSON.stringify(event.partial, null, 2),
                );
              if (event.type === "done" && event.output)
                setWorkspaceContent(
                  JSON.stringify(event.output, null, 2),
                );
              if (event.type === "done")
                setWorkspaceLoading(false);
              if (event.type === "error") {
                setWorkspaceError(
                  event.error || "Run failed.",
                );
                setWorkspaceLoading(false);
              }
              if (event.type === "canceled") {
                setWorkspaceError(
                  event.message || "Run canceled.",
                );
                setWorkspaceLoading(false);
              }
            }
            delimiterIndex = buffer.indexOf("\n");
          }
        }
        setWorkspaceLoading(false);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unknown run error.";
        setWorkspaceError(message);
        setWorkspaceLoading(false);
      }
    },
    [],
  );

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
    workflowsOnly ||
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

  const expandedDetailProps = {
    onClose: closeSelectedImage,
    onAction: (
      intent:
        | "transfer_style"
        | "transfer_pose"
        | "replace_character",
      imageId: string,
    ) => {
      void runAction(intent, imageId, selectedImage?.prompt);
    },
    activeRunId: workspaceRunId,
    onOpenRun: () => setWorkspaceOpen(true),
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
    folders: folders ?? [],
    canManageFolder: canManageFoldersInCurrentView,
    onSetFolders: canManageFoldersInCurrentView
      ? (imageId: string, folderIds: string[]) => {
          void setAssetFolders(imageId, folderIds);
        }
      : undefined,
    onCreateFolder: canManageFoldersInCurrentView
      ? async (name: string) => createFolder(name)
      : undefined,
    folderBusy: folderLoadingAssetId === selectedImage?.id,
    folderError:
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
            isPublic: Boolean(selectedImage?.isPublic),
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
    canEditAsset: canEditAssets,
    availableTags: availableUploadTags,
    onSaveAssetEdit: canEditAssets ? saveAssetEdit : undefined,
    editingAsset: editingAssetId === selectedImage?.id,
    editError:
      editingAssetId === selectedImage?.id || editAssetError
        ? editAssetError
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
                  directions: (project.collections ?? []).map(
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
          onAssetsDropOnDirection={
            canManageFoldersInCurrentView
              ? handleAssetsDropOnDirection
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
                selectedFolderId={effectiveSelectedFolderId}
                onCollectionToggle={handleMenuCollectionToggle}
                onClearAllTags={handleClearAll}
                canManageMenuFilters={
                  galleryScope === "mine" && canAccessMyGallery
                }
                ownerUserId={ownerUserId}
                workflowsOnly={workflowsOnly}
                onWorkflowsOnlyChange={handleWorkflowsOnlyChange}
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
                <BrowseBreadcrumb segments={breadcrumbSegments} />
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
              ) : viewMode === "packs" ? (
                galleryScope === "mine" && canAccessMyGallery ? (
                  selectedPackId ? (
                    <PackDetailView
                      ownerUserId={ownerUserId}
                      packId={selectedPackId}
                      selectedAssetId={
                        selectedImage?.packId === selectedPackId
                          ? selectedImage?.id
                          : undefined
                      }
                      compact={Boolean(selectedImage)}
                      onBack={() => { setSelectedPackId(null); setSelectedImage(null); }}
                      onAssetSelect={(asset) => {
                        handleImageSelect({
                          ...asset,
                          thumbSrc: asset.thumbSrc,
                          fullSrc: asset.fullSrc,
                          // Mini masonry handles navigation — no right-side carousel
                          previewImages: [],
                          galleryItemId: asset.id,
                          galleryItemType: "asset",
                        });
                      }}
                    />
                  ) : (
                    <PackGrid
                      ownerUserId={ownerUserId}
                      selectedTagIds={selectedTagIds}
                      selectedModelName={selectedModelName}
                      onPackSelect={setSelectedPackId}
                    />
                  )
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
                      SWITCH TO MY GALLERY TO BROWSE PACKS.
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
                    onStorybookOpen={setOpenStorybookId}
                    onCollectionOpen={handleCardCollectionOpen}
                    onBeatOpen={handleCardBeatOpen}
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
              image={selectedImage}
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
                image={selectedImage}
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
                    onClick={() => {
                      setBulkAddMenuOpen((open) => !open);
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

      <AiWorkspacePanel
        open={workspaceOpen}
        actionLabel={workspaceActionLabel}
        runId={workspaceRunId}
        loading={workspaceLoading}
        content={workspaceContent}
        error={workspaceError}
        onClose={() => setWorkspaceOpen(false)}
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

      <ReviewModal
        key={openProjectId ?? "review-closed"}
        ownerUserId={ownerUserId}
        projectId={openProjectId}
        initialDirectionId={openProjectTarget?.beatFolderId ?? null}
        allCollections={projectCollectionOptions}
        leftOffset={contentMarginLeft}
        onClose={() => setOpenProjectId(null)}
      />
    </div>
    </CoralToastProvider>
  );
}
