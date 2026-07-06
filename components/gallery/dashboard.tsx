"use client";

import "@/app/tokens.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Download, Eye, EyeOff, FolderInput, Loader2, Plus, Search as SearchIcon, Upload, X } from "lucide-react";
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
import { GalleryDetailPanel } from "./detail-panel";
import { WorkflowModal } from "./workflow-modal";
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
  galleryItemType?: "asset" | "pack" | "design" | "workflow";
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

  // Don't hijack drags while a modal already owns its own dropzone.
  const canAcceptShellDrop =
    canAccessMyGallery && !isUploadOpen && !isCinemaUploadOpen;

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
  const setAssetLikedMutation = useMutation(api.assets.setAssetLiked);
  const createFolderMutation = useMutation(
    api.folders.createFolder,
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

  const clearAssetSelection = useCallback(() => {
    setSelectedAssetIds((current) => (current.size === 0 ? current : new Set()));
    setBulkCurationError(undefined);
    setBulkCurationStatus(undefined);
    setBulkMoveMenuOpen(false);
  }, []);

  const runBulkCuration = useCallback(
    async (isPublic: boolean, overrideIds?: string[]) => {
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
          body: JSON.stringify({ assetIds: ids, isPublic }),
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
        const verb = isPublic ? "made public" : "made private";
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
    galleryScope === "public" ? publicFoldersWithCounts : foldersWithCounts;

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

  const mineGalleryAssets = useQuery(
    api.assets.listGalleryAssets,
    galleryScope === "mine" && canAccessMyGallery
      ? {
          ownerUserId,
          tagIds: selectedTagIds,
          pillar: selectedPillar ?? undefined,
          folderId: effectiveSelectedFolderId
            ? (effectiveSelectedFolderId as Id<"folders">)
            : undefined,
          modelName: selectedModelName ?? undefined,
          kind: mediaKind ?? undefined,
          onlyLiked: likedOnly || undefined,
          limit: 120,
        }
      : "skip",
  );

  const publicGalleryAssets = useQuery(
    api.assets.listPublicGalleryAssets,
    galleryScope === "public"
      ? {
          tagIds: selectedTagIds,
          pillar: selectedPillar ?? undefined,
          folderId: effectiveSelectedFolderId
            ? (effectiveSelectedFolderId as Id<"folders">)
            : undefined,
          modelName: selectedModelName ?? undefined,
          kind: mediaKind ?? undefined,
          limit: 120,
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
          limit: 120,
        }
      : "skip",
  );
  const isDesignsPillar = selectedPillar === "designs" && !workflowsOnly;

  const galleryAssets =
    galleryScope === "mine"
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

  const images = useMemo(() => {
    if (workflowsOnly) return workflowEntries;
    // When filtering by media kind (image/video) or liked-only, keep workflows
    // out of the grid — those filters target likeable assets, not workflows.
    if (mediaKind || likedOnly) return baseImages;
    if (workflowEntries.length === 0) return baseImages;
    return [...workflowEntries, ...baseImages].sort(
      (left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0),
    );
  }, [workflowsOnly, mediaKind, likedOnly, workflowEntries, baseImages]);

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

  const canGoPrev = currentImageIndex > 0;
  const canGoNext =
    currentImageIndex >= 0 &&
    currentImageIndex < images.length - 1;

  const goToPrev = useCallback(() => {
    if (!canGoPrev) return;
    selectImageByEntry(images[currentImageIndex - 1]);
  }, [canGoPrev, currentImageIndex, images, selectImageByEntry]);

  const goToNext = useCallback(() => {
    if (!canGoNext) return;
    selectImageByEntry(images[currentImageIndex + 1]);
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
          onModelSelect={setSelectedModelName}
          collapsed={sidebarCollapsed}
          onCollapsedChange={setSidebarCollapsed}
          onUploadClick={openAddModal}
          onSeedanceClick={() => setSeedanceOpen(true)}
          user={user}
          onSignOut={onSignOut}
          imageCount={imageCount}
          folders={sidebarFolders}
          selectedFolderId={effectiveSelectedFolderId}
          onFolderSelect={setSelectedFolderId}
          onAssetsDropOnFolder={
            canManageFoldersInCurrentView ? handleAssetsDropOnFolder : undefined
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
            {/* Filter Bar */}
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
            />

            {/* Search Vault is now in the bottom dock */}

            {canCuratePublic && galleryScope === "mine" && publishAllAssetIds.length > 0 && (
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

            {(semanticMode?.kind === "similar" || semanticError) && (
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
              {viewMode === "packs" ? (
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
                    likeable={canManageFoldersInCurrentView}
                    onToggleLike={(imageId, nextLiked) => {
                      void toggleAssetLike(imageId, nextLiked);
                    }}
                    draggableAssets={canManageFoldersInCurrentView}
                    onAssetDragStart={handleAssetDragStart}
                    showPublicBadge={galleryScope === "mine"}
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
                      setBulkMoveMenuOpen((open) => !open);
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
    </div>
    </CoralToastProvider>
  );
}
