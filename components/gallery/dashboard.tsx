"use client";

import "@/app/tokens.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useAction,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Download, Eye, EyeOff, FolderInput, FolderPlus, Layers, Loader2, Plus, Search as SearchIcon, Star, Upload, X } from "lucide-react";
import { downloadImagesAsZip } from "@/lib/download-image";
import { CoralToastProvider } from "@/components/ui/coral-toast";
import BottomMenu from "@/components/ui/bottom-menu";
import { GallerySidebar } from "./sidebar";
import {
  GalleryFilterBar,
  type GalleryScope,
  type Pillar,
  type SortOrder,
  type ViewMode,
} from "./filter-bar";
import { CanvasMode } from "./canvas-mode";
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
import { CinemaUploadModal } from "@/components/cinema-upload-modal";
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
  isHiddenFilterTag,
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
  galleryItemType?: "asset" | "pack" | "design" | "workflow" | "storybook";
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
  const [selectedPillar, setSelectedPillar] =
    useState<Pillar | null>(null);
  const [workflowsOnly, setWorkflowsOnly] = useState<boolean>(false);
  const [likedOnly, setLikedOnly] = useState<boolean>(false);
  const [mediaKind, setMediaKind] = useState<"image" | "video" | null>(null);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(
    null,
  );
  const [openStorybookId, setOpenStorybookId] = useState<string | null>(null);
  const [openProjectId, setOpenProjectId] = useState<string | null>(null);
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
  const [isCinemaUploadOpen, setCinemaUploadOpen] = useState(false);
  const [selectedCinemaAsset, setSelectedCinemaAsset] =
    useState<CinemaModalAsset | null>(null);
  const [isSeedanceOpen, setSeedanceOpen] = useState(false);

  // Add button routes to the cinema upload flow when cinema-inspiration is selected;
  // otherwise falls back to the generic upload modal.
  const openAddModal = useCallback(() => {
    if (selectedPillar === "cinema-inspiration") {
      setCinemaUploadOpen(true);
    } else {
      setUploadInitialFiles(undefined);
      setUploadOpen(true);
    }
  }, [selectedPillar]);

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
    !isCinemaUploadOpen &&
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
  const [bulkMoveMenuOpen, setBulkMoveMenuOpen] = useState(false);
  // Feedback chip for collection moves (drag & drop or MOVE TO menu) — the
  // bulk toolbar hides once the selection clears, so it can't host this.
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
  const createFolderMutation = useMutation(
    api.folders.createFolder,
  );
  const addAssetsToProjectMutation = useMutation(
    api.projects.addAssetsToProject,
  );
  const updateFolderMutation = useMutation(api.folders.updateFolder);
  const deleteFolderMutation = useMutation(api.folders.deleteFolder);
  const setFolderShowcasedMutation = useMutation(
    api.folders.setFolderShowcased,
  );
  const setFolderFeaturedMutation = useMutation(api.folders.setFolderFeatured);
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
    setBulkMoveMenuOpen(false);
    setLikedOnly(false);
  }, [galleryScope]);

  useEffect(() => {
    setFolderError(undefined);
    setFolderLoadingAssetId(null);
    setEditAssetError(undefined);
    setEditingAssetId(null);
  }, [selectedImage?.id]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedAssetSearchQuery(assetSearchQuery.trim());
    }, 400);

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
    setBulkMoveMenuOpen(false);
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
    [canAccessMyGallery, createFolderMutation, ownerUserId],
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
  const tagAssetCounts = useQuery(
    api.assets.tagAssetCounts,
    galleryScope === "mine" && canAccessMyGallery
      ? { ownerUserId }
      : galleryScope === "public"
        ? { isPublic: true }
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
        count: folderCountById.get(summary._id) ?? 0,
      })),
    [collectionSummaries, folderCountById],
  );
  const openCollectionFromCard = useCallback(
    (folderId: string) => {
      setOpenProjectId(null);
      setBrowseProject(null);
      setSelectedFolderId(folderId);
      setViewMode("grid");
    },
    [setViewMode],
  );
  const openProjectFromCard = useCallback(
    (projectId: string, name: string) => {
      setOpenProjectId(null);
      setSelectedFolderId(null);
      setBrowseProject({ id: projectId, name });
      setViewMode("grid");
    },
    [setViewMode],
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

  // Curated, public-facing subset of collections (see PUBLIC_COLLECTIONS in
  // convex/assets.ts). Counts are pre-scoped to public assets only.
  const publicCollections = useQuery(
    api.assets.listPublicCollections,
    galleryScope === "public" ? {} : "skip",
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

  const assetCountByTagId = useMemo(() => {
    const map = new Map<Id<"tags">, number>();
    for (const entry of tagAssetCounts ?? []) {
      map.set(entry.tagId, entry.count);
    }
    return map;
  }, [tagAssetCounts]);

  const dedupedTags = useMemo(() => {
    const groups = new Map<
      string,
      {
        _id: string;
        name: string;
        usageCount: number;
        sourceIds: Id<"tags">[];
        sourceIdSet: Set<Id<"tags">>;
        bestCount: number;
      }
    >();

    for (const tag of tags ?? []) {
      // Source/plumbing tags and duplicates of other filters stay on assets
      // but never surface as filter chips.
      if (isHiddenFilterTag(tag.name)) continue;
      const key = canonicalTagKey(tag.name) || tag._id;
      const count = assetCountByTagId.get(tag._id) ?? 0;
      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, {
          _id: key,
          name: tag.name || "untitled",
          usageCount: count,
          sourceIds: [tag._id],
          sourceIdSet: new Set([tag._id]),
          bestCount: count,
        });
        continue;
      }

      existing.usageCount += count;
      if (!existing.sourceIdSet.has(tag._id)) {
        existing.sourceIdSet.add(tag._id);
        existing.sourceIds.push(tag._id);
      }
      if (count > existing.bestCount) {
        existing.bestCount = count;
        existing.name = tag.name;
      }
    }

    return Array.from(groups.values())
      .filter((tag) => tag.usageCount > 0)
      .map(
        ({
          sourceIdSet: _sourceIdSet,
          bestCount: _bestCount,
          ...tag
        }) => tag,
      )
      .sort((a, b) => {
        const usageDiff = b.usageCount - a.usageCount;
        if (usageDiff !== 0) return usageDiff;
        return a.name.localeCompare(b.name);
      });
  }, [tags, assetCountByTagId]);

  const sourceIdsByTagKey = useMemo(() => {
    const map = new Map<string, Id<"tags">[]>();
    for (const tag of dedupedTags) {
      map.set(tag._id, tag.sourceIds);
    }
    return map;
  }, [dedupedTags]);

  const selectedTagIds = useMemo(() => {
    if (selectedTags.length === 0) return undefined;
    const ids = new Set<Id<"tags">>();
    for (const key of selectedTags) {
      for (const id of sourceIdsByTagKey.get(key) ?? []) {
        ids.add(id);
      }
    }
    return ids.size > 0 ? Array.from(ids) : undefined;
  }, [selectedTags, sourceIdsByTagKey]);

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

  const paginationActive =
    sortOrder === "newest" &&
    !effectiveSelectedFolderId &&
    !browseProject &&
    selectedPillar !== "designs";

  const minePagedAssets = usePaginatedQuery(
    api.assets.listGalleryAssetsPage,
    paginationActive && galleryScope === "mine" && canAccessMyGallery
      ? {
          ownerUserId,
          tagIds: selectedTagIds,
          pillar: selectedPillar ?? undefined,
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
          pillar: selectedPillar ?? undefined,
          modelName: selectedModelName ?? undefined,
          kind: mediaKind ?? undefined,
        }
      : "skip",
    { initialNumItems: 60 },
  );
  const activePagedAssets =
    galleryScope === "mine" ? minePagedAssets : publicPagedAssets;
  // The grid calls this repeatedly while its frontier is exposed; loadMore is
  // a no-op unless a next page is actually available.
  const loadNextGalleryPage = useCallback(() => {
    if (!paginationActive) return;
    if (activePagedAssets.status === "CanLoadMore") {
      activePagedAssets.loadMore(60);
    }
  }, [paginationActive, activePagedAssets]);

  const mineGalleryAssets = useQuery(
    api.assets.listGalleryAssets,
    !paginationActive && galleryScope === "mine" && canAccessMyGallery
      ? {
          ownerUserId,
          tagIds: selectedTagIds,
          pillar: selectedPillar ?? undefined,
          folderId: effectiveSelectedFolderId
            ? (effectiveSelectedFolderId as Id<"folders">)
            : undefined,
          projectId: browseProject
            ? (browseProject.id as Id<"folders">)
            : undefined,
          modelName: selectedModelName ?? undefined,
          kind: mediaKind ?? undefined,
          onlyLiked: likedOnly || undefined,
          limit: 600,
        }
      : "skip",
  );

  const publicGalleryAssets = useQuery(
    api.assets.listPublicGalleryAssets,
    !paginationActive && galleryScope === "public"
      ? {
          tagIds: selectedTagIds,
          pillar: selectedPillar ?? undefined,
          folderId: effectiveSelectedFolderId
            ? (effectiveSelectedFolderId as Id<"folders">)
            : undefined,
          modelName: selectedModelName ?? undefined,
          kind: mediaKind ?? undefined,
          limit: 600,
        }
      : "skip",
  );

  const mineDesignEntries = useQuery(
    api.designInspirations.listDesignGalleryEntries,
    galleryScope === "mine" &&
      canAccessMyGallery &&
      selectedPillar === "designs"
      ? {
          ownerUserId,
          pillar: "designs",
          requireAsset: true,
          folderId: effectiveSelectedFolderId
            ? (effectiveSelectedFolderId as Id<"folders">)
            : undefined,
          limit: 2000,
        }
      : "skip",
  );
  const isDesignsPillar = selectedPillar === "designs" && !workflowsOnly;

  const galleryAssets = paginationActive
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
      pillar: selectedPillar ?? undefined,
      folderId:
        galleryScope === "mine" && effectiveSelectedFolderId
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
          error instanceof Error
            ? error.message
            : "Semantic search failed.",
        );
      });
  }, [
    debouncedAssetSearchQuery,
    effectiveSelectedFolderId,
    galleryScope,
    isSimilarMode,
    ownerUserId,
    selectedModelName,
    selectedPillar,
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
    setSelectedTags((prev) =>
      prev.includes(tag)
        ? prev.filter((t) => t !== tag)
        : [...prev, tag],
    );
  };

  const handleClearAll = () => setSelectedTags([]);
  const handleClearFilters = () => {
    setSelectedTags([]);
    setSelectedPillar(null);
    setSelectedFolderId(null);
    setBrowseProject(null);
    setSelectedModelName(null);
    setWorkflowsOnly(false);
    setMediaKind(null);
    setLikedOnly(false);
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

  const allTags = dedupedTags;
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
      if (selectedPillar && asset.pillar !== selectedPillar) {
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
    effectiveSelectedFolderId,
    galleryScope,
    mediaKind,
    selectedModelName,
    selectedPillar,
    selectedTagIds,
    semanticResults,
  ]);

  const displayGalleryAssets =
    filteredSemanticResults !== null
      ? filteredSemanticResults
      : lexicalFilteredAssets;

  const baseImages = useMemo(() => {
    // Design inspirations have their own data source
    if (isDesignsPillar && mineDesignEntries) {
      return mineDesignEntries
        .filter((entry) => !hiddenAssetIds.has(entry._id) && entry.previewUrl)
        .map((entry) => ({
          id: entry._id,
          galleryItemId: entry._id,
          galleryItemType: "design" as const,
          src: entry.previewThumbUrl ?? entry.previewUrl ?? "/placeholder.svg",
          fullSrc: entry.previewUrl ?? "/placeholder.svg",
          prompt: entry.title ?? entry.sourceTitle ?? entry.sourceDomain ?? "Design reference",
          author: "Extension",
          likes: 0,
          width: entry.previewWidth ?? undefined,
          height: entry.previewHeight ?? undefined,
          modelName: undefined as string | undefined,
          pillar: "designs" as string | undefined,
          tagNames: entry.tagNames ?? [],
          sourceUrl: entry.sourceUrl ?? undefined,
          createdAt: entry.createdAt,
          folderId: entry.folderId ?? undefined,
          folderIds: entry.folderId ? [entry.folderId] : [],
          isPublic: false,
          isFeatured: false,
          initiallyLoaded: loadedImageIdsRef.current.has(entry._id),
          isDesignInspiration: true,
          designTitle: entry.title ?? undefined,
          designDescription: entry.description ?? undefined,
          designInspirationId: entry._id,
          sourceDomain: entry.sourceDomain ?? undefined,
          captureKind: entry.captureKind ?? undefined,
          saveIntent: entry.saveIntent ?? undefined,
          inspirationType: entry.inspirationType ?? undefined,
          userNote: entry.userNote ?? undefined,
          previewImages: [
            {
              id: entry._id,
              galleryItemId: entry._id,
              galleryItemType: "design" as const,
              src:
                entry.previewThumbUrl ??
                entry.previewUrl ??
                "/placeholder.svg",
              fullSrc: entry.previewUrl ?? "/placeholder.svg",
              prompt:
                entry.title ??
                entry.sourceTitle ??
                entry.sourceDomain ??
                "Design reference",
              width: entry.previewWidth ?? undefined,
              height: entry.previewHeight ?? undefined,
            },
          ],
        }));
    }

    if (!displayGalleryAssets) return [];
    return buildGalleryEntries({
      assets: displayGalleryAssets,
      hiddenAssetIds,
      loadedAssetIds: loadedImageIdsRef.current,
      sortOrder,
    });
  }, [
    displayGalleryAssets,
    hiddenAssetIds,
    sortOrder,
    isDesignsPillar,
    mineDesignEntries,
  ]);

  // Workflows are an organizing layer — they mix into the grid as their own
  // card type and open a dedicated modal instead of the side detail panel.
  const workflowCards = useQuery(
    api.workflows.listWorkflows,
    ownerUserId
      ? {
          ownerUserId,
          scope: galleryScope,
          pillar: selectedPillar ?? undefined,
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
    !selectedPillar &&
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

  const images = useMemo(() => {
    if (workflowsOnly) return workflowEntries;
    const stacks = showStorybookStacks ? storybookEntries : [];
    // When filtering by media kind (image/video) or liked-only, keep workflows
    // out of the grid — those filters target likeable assets, not workflows.
    const mixed =
      mediaKind || likedOnly
        ? baseImages
        : workflowEntries.length === 0
          ? baseImages
          : [...workflowEntries, ...baseImages].sort(
              (left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0),
            );
    // Storybooks lead the grid — they're narrative shelves, not dated assets.
    return stacks.length > 0 ? [...stacks, ...mixed] : mixed;
  }, [
    workflowsOnly,
    mediaKind,
    likedOnly,
    workflowEntries,
    baseImages,
    showStorybookStacks,
    storybookEntries,
  ]);

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
      setBulkMoveMenuOpen(false);
      setBulkCurationError(undefined);
      setBulkCurationStatus(undefined);
      try {
        let moved = 0;
        for (const assetId of assetIds) {
          // Move = set the asset's collections to just the destination.
          await setAssetFoldersMutation({
            ownerUserId,
            assetId: assetId as Id<"assets">,
            folderIds: [folderId as Id<"folders">],
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
      folderNameById,
      ownerUserId,
      setAssetFoldersMutation,
    ],
  );

  const moveSelectedToFolder = useCallback(
    async (folderId: string) => {
      await moveAssetsToFolder(folderId, Array.from(selectedAssetIds));
    },
    [moveAssetsToFolder, selectedAssetIds],
  );

  // ── Bulk "Add to" picker: file the selection into a collection or project
  // (ADD semantics — existing memberships are kept), or create the target on
  // the spot. Successful adds clear the selection so the next sorting batch
  // can be picked immediately. (Handlers referencing
  // handleAssetsDropOnProject live below its declaration.)
  const [bulkAddMenuOpen, setBulkAddMenuOpen] = useState(false);
  const [bulkAddDraft, setBulkAddDraft] = useState("");
  const [bulkAddBusy, setBulkAddBusy] = useState(false);

  const finishBulkAdd = useCallback(() => {
    setBulkAddMenuOpen(false);
    setBulkAddDraft("");
    setSelectedAssetIds(new Set());
  }, []);

  const addSelectedToFolder = useCallback(
    async (folderId: string, folderNameOverride?: string) => {
      const ids = Array.from(selectedAssetIds);
      if (ids.length === 0 || bulkAddBusy) return;
      setBulkAddBusy(true);
      try {
        await Promise.all(
          ids.map((assetId) =>
            addAssetFoldersMutation({
              ownerUserId,
              assetId: assetId as Id<"assets">,
              folderIds: [folderId as Id<"folders">],
            }),
          ),
        );
        setMoveStatus({
          text: `Added ${ids.length} to ${folderNameOverride ?? folderNameById.get(folderId) ?? "collection"}`,
        });
        finishBulkAdd();
      } catch (error) {
        setMoveStatus({
          text: error instanceof Error ? error.message : "Add failed.",
          error: true,
        });
      } finally {
        setBulkAddBusy(false);
      }
    },
    [
      addAssetFoldersMutation,
      bulkAddBusy,
      finishBulkAdd,
      folderNameById,
      ownerUserId,
      selectedAssetIds,
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

  const handleAssetsDropOnFolder = useCallback(
    (folderId: string, assetIds: string[]) => {
      void moveAssetsToFolder(folderId, assetIds);
    },
    [moveAssetsToFolder],
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

  const addSelectedToProject = useCallback(
    async (projectId: string, projectNameOverride?: string) => {
      const ids = Array.from(selectedAssetIds);
      if (ids.length === 0 || bulkAddBusy) return;
      setBulkAddBusy(true);
      try {
        await handleAssetsDropOnProject(projectId, ids, projectNameOverride);
        finishBulkAdd();
      } finally {
        setBulkAddBusy(false);
      }
    },
    [bulkAddBusy, finishBulkAdd, handleAssetsDropOnProject, selectedAssetIds],
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
          await addSelectedToProject(result.folderId, name);
        } else {
          await addSelectedToFolder(result.folderId, name);
        }
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
      addSelectedToFolder,
      addSelectedToProject,
      bulkAddBusy,
      bulkAddDraft,
      createFolderMutation,
      ownerUserId,
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
    [ownerUserId, deleteFolderMutation, folderNameById],
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
      // Enrich with design-specific fields from mineDesignEntries
      if (isDesignsPillar && mineDesignEntries) {
        const entry = mineDesignEntries.find((e) => e._id === img.id);
        if (entry) {
          setSelectedImage({
            ...img,
            isDesignInspiration: true,
            designTitle: entry.title ?? undefined,
            designDescription: entry.description ?? undefined,
            designInspirationId: entry._id,
            sourceDomain: entry.sourceDomain ?? undefined,
            captureKind: entry.captureKind ?? undefined,
            saveIntent: entry.saveIntent ?? undefined,
            inspirationType: entry.inspirationType ?? undefined,
            userNote: entry.userNote ?? undefined,
          });
          return;
        }
      }
      setSelectedImage(img);
    },
    [isDesignsPillar, mineDesignEntries, images],
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

  // Storybook stacks live in the grid but open a modal, not the detail
  // panel — prev/next navigation steps over them.
  const canGoPrev =
    currentImageIndex > 0 &&
    images
      .slice(0, currentImageIndex)
      .some((entry) => entry.galleryItemType !== "storybook");
  const canGoNext =
    currentImageIndex >= 0 &&
    images
      .slice(currentImageIndex + 1)
      .some((entry) => entry.galleryItemType !== "storybook");

  const goToPrev = useCallback(() => {
    if (!canGoPrev) return;
    for (let index = currentImageIndex - 1; index >= 0; index -= 1) {
      if (images[index].galleryItemType === "storybook") continue;
      selectImageByEntry(images[index]);
      return;
    }
  }, [canGoPrev, currentImageIndex, images, selectImageByEntry]);

  const goToNext = useCallback(() => {
    if (!canGoNext) return;
    for (let index = currentImageIndex + 1; index < images.length; index += 1) {
      if (images[index].galleryItemType === "storybook") continue;
      selectImageByEntry(images[index]);
      return;
    }
  }, [canGoNext, currentImageIndex, images, selectImageByEntry]);

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
    isDesignsPillar && galleryScope === "mine"
      ? canAccessMyGallery && mineDesignEntries === undefined
      : paginationActive
        ? (galleryScope === "public" || canAccessMyGallery) &&
          activePagedAssets.status === "LoadingFirstPage"
        : galleryScope === "mine"
          ? canAccessMyGallery &&
            mineGalleryAssets === undefined
          : publicGalleryAssets === undefined;
  const hasFilters =
    selectedTags.length > 0 ||
    selectedPillar !== null ||
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
    <div
      className="lm-brutal lm-grid-bg h-[100dvh] overflow-hidden"
      data-pillar={selectedPillar ?? "creators"}
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
            backgroundColor: "rgba(10, 8, 5, 0.78)",
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
          hideModelsSection={selectedPillar === "cinema-inspiration"}
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
          onPreviewShowcase={
            canManageFoldersInCurrentView
              ? () => window.open("/?preview=1", "_blank")
              : undefined
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
            className={`min-h-0 min-w-0 flex-1 ${viewMode === "canvas" ? "" : "overflow-y-auto overscroll-contain"}`}

            style={{}}
          >
            {/* Filter Bar — hidden on the Storybooks tab (asset filters don't
                apply to a storybook masonry). */}
            {!storybooksView && (
              <GalleryFilterBar
                galleryScope={galleryScope}
                canAccessMyGallery={canAccessMyGallery}
                onGalleryScopeChange={setGalleryScope}
                tags={allTags}
                selectedTags={selectedTags}
                onTagToggle={handleTagToggle}
                onClearAllTags={handleClearAll}
                workflowsOnly={workflowsOnly}
                onWorkflowsOnlyChange={handleWorkflowsOnlyChange}
                likedOnly={likedOnly}
                onLikedOnlyChange={handleLikedOnlyChange}
                showLiked={canManageFoldersInCurrentView}
                mediaKind={mediaKind}
                onMediaKindChange={handleMediaKindChange}
                sortOrder={sortOrder}
                onSortOrderChange={setSortOrder}
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
              className={`relative min-w-0 ${viewMode === "canvas" ? "min-h-0 flex-1 overflow-hidden" : ""}`}
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
                      selectedPillar={selectedPillar}
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
                viewMode === "canvas" ? (
                  <CanvasMode
                    images={images}
                    selectedImage={selectedImage}
                    onImageSelect={handleImageSelect}
                    loading={isLoading}
                    ownerUserId={ownerUserId}
                    syncEnabled={canAccessMyGallery}
                  />
                ) : (
                  <MasonryGrid
                    images={images}
                    compactColumns={Boolean(selectedImage)}
                    selectedImageId={selectedImage?.id}
                    gapPx={selectedPillar === "cinema-inspiration" ? 14 : undefined}
                    onImageSelect={handleImageSelect}
                    onImageLoad={markImageLoaded}
                    canDelete={canDeleteInCurrentView}
                    deletingImageId={deletingAssetId}
                    exitingImageIds={exitingAssetIds}
                    onDeleteImage={(imageId) => {
                      void deleteAsset(imageId);
                    }}
                    selectable={canCuratePublic || canManageFoldersInCurrentView}
                    selectedAssetIds={selectedAssetIds}
                    onToggleAssetSelect={toggleAssetSelection}
                    onReplaceSelection={replaceAssetSelection}
                    likeable={canManageFoldersInCurrentView}
                    onToggleLike={(imageId, nextLiked) => {
                      void toggleAssetLike(imageId, nextLiked);
                    }}
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
                        ? (projects ?? []).map((project) => ({
                            id: project._id as string,
                            name: project.name,
                          }))
                        : undefined
                    }
                    onAddAssetToProject={
                      canManageFoldersInCurrentView
                        ? (imageId, projectId) =>
                            handleAssetsDropOnProject(projectId, [imageId])
                        : undefined
                    }
                    onStorybookOpen={setOpenStorybookId}
                    showPublicBadge={galleryScope === "mine"}
                    onEndReached={
                      paginationActive ? loadNextGalleryPage : undefined
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
                    {selectedPillar && (
                      <span
                        className="lm-chip"
                        style={{ borderRadius: "12px" }}
                      >
                        {selectedPillar}
                      </span>
                    )}
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
          <div
            className="absolute inset-0 animate-fade-in"
            style={{
              backgroundColor: "rgba(8, 7, 6, 0.992)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
            }}
            onClick={closeSelectedImage}
            aria-hidden="true"
          />
          <div className="relative z-10 h-full w-full animate-fade-in">
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
            className={`absolute inset-0 bg-black/70 ${sheetDismissing ? "animate-fade-out" : "animate-fade-in"}`}
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
                      setBulkMoveMenuOpen(false);
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
                    aria-label="Add selected assets to a collection or project"
                    title="Add to collection or project (keeps existing collections)"
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
                      className="absolute bottom-full left-0 mb-2 flex max-h-80 w-64 flex-col py-1"
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
                              role="menuitem"
                              disabled={bulkAddBusy}
                              onClick={() => {
                                void addSelectedToFolder(folder._id);
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
                              <span
                                style={{
                                  fontSize: "10px",
                                  color: "var(--lm-text-tertiary)",
                                }}
                              >
                                {folder.count}
                              </span>
                            </button>
                            {(bulkAddCollectionTree.childrenByParent.get(folder._id) ?? []).map(
                              (child) => (
                                <button
                                  key={child._id}
                                  type="button"
                                  role="menuitem"
                                  disabled={bulkAddBusy}
                                  onClick={() => {
                                    void addSelectedToFolder(child._id);
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
                                  <span
                                    style={{
                                      fontSize: "10px",
                                      color: "var(--lm-text-tertiary)",
                                    }}
                                  >
                                    {child.count}
                                  </span>
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
                            role="menuitem"
                            disabled={bulkAddBusy}
                            onClick={() => {
                              void addSelectedToProject(project._id);
                            }}
                            className="interactive-ghost flex w-full items-center gap-2 px-3 py-1.5 text-left"
                            style={{
                              fontFamily: "var(--lm-font)",
                              fontSize: "12px",
                              fontWeight: 600,
                              color: "var(--lm-text-primary)",
                              backgroundColor: "transparent",
                              cursor: bulkAddBusy ? "wait" : "pointer",
                            }}
                          >
                            <Layers
                              className="h-3 w-3 flex-shrink-0"
                              style={{ color: "var(--lm-text-ghost)" }}
                            />
                            <span className="truncate">{project.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {canManageFoldersInCurrentView && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setBulkMoveMenuOpen((open) => !open);
                      setBulkAddMenuOpen(false);
                    }}
                    disabled={
                      bulkCurationLoading ||
                      bulkActionLoading ||
                      (folders ?? []).length === 0
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
                        (folders ?? []).length === 0
                          ? 0.55
                          : 1,
                      cursor:
                        bulkCurationLoading ||
                        bulkActionLoading ||
                        (folders ?? []).length === 0
                          ? "not-allowed"
                          : "pointer",
                    }}
                    aria-haspopup="menu"
                    aria-expanded={bulkMoveMenuOpen}
                    aria-label="Move selected assets to a collection"
                    title={
                      (folders ?? []).length === 0
                        ? "Create a collection first"
                        : "Move to collection"
                    }
                  >
                    <FolderInput className="h-3.5 w-3.5" />
                    MOVE TO
                  </button>
                  {bulkMoveMenuOpen && (folders ?? []).length > 0 && (
                    <div
                      role="menu"
                      className="absolute bottom-full left-0 mb-2 max-h-64 w-56 overflow-y-auto py-1"
                      style={{
                        backgroundColor: "var(--lm-surface-1)",
                        border: "2px solid var(--lm-ink)",
                        borderRadius: "12px",
                        boxShadow: "var(--shadow-lg)",
                        zIndex: 60,
                      }}
                    >
                      {foldersWithCounts.map((folder) => (
                        <button
                          key={folder._id}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            void moveSelectedToFolder(folder._id);
                          }}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                          style={{
                            fontFamily: "var(--lm-font)",
                            fontSize: "12px",
                            fontWeight: 600,
                            color: "var(--lm-text-primary)",
                            backgroundColor: "transparent",
                            cursor: "pointer",
                          }}
                        >
                          <span className="truncate">{folder.name}</span>
                          <span
                            style={{
                              fontSize: "10px",
                              color: "var(--lm-text-tertiary)",
                            }}
                          >
                            {folder.count}
                          </span>
                        </button>
                      ))}
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
        ownerUserId={
          canAccessMyGallery ? ownerUserId : undefined
        }
        initialFiles={uploadInitialFiles}
      />

      <SeedanceIngestModal
        open={isSeedanceOpen}
        onClose={() => setSeedanceOpen(false)}
      />

      <CinemaUploadModal
        open={isCinemaUploadOpen}
        onClose={() => setCinemaUploadOpen(false)}
        ownerUserId={ownerUserId}
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
        allCollections={projectCollectionOptions}
        leftOffset={contentMarginLeft}
        onClose={() => setOpenProjectId(null)}
      />
    </div>
    </CoralToastProvider>
  );
}
