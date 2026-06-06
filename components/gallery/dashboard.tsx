"use client";

import "@/app/tokens.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Eye, EyeOff, Loader2, Plus, Search as SearchIcon, X } from "lucide-react";
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
  isPublic?: boolean;
  isFeatured?: boolean;
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

const buildAssetSearchHaystack = (asset: {
  promptText?: string;
  fileName?: string;
  sourceUrl?: string;
  tagNames?: string[];
  modelName?: string;
  pillar?: string;
}) =>
  [
    asset.promptText,
    asset.fileName,
    asset.sourceUrl,
    asset.modelName,
    asset.pillar,
    ...(asset.tagNames ?? []),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();

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
      setUploadOpen(true);
    }
  }, [selectedPillar]);
  const [detailPanelWidth, setDetailPanelWidth] = useState<number>(380);
  const detailPanelResizing = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("v8.detailPanelWidth");
    const parsed = stored ? Number(stored) : NaN;
    if (Number.isFinite(parsed) && parsed >= 320 && parsed <= 720) {
      setDetailPanelWidth(parsed);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("v8.detailPanelWidth", String(detailPanelWidth));
  }, [detailPanelWidth]);

  const startDetailPanelResize = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      detailPanelResizing.current = {
        startX: event.clientX,
        startWidth: detailPanelWidth,
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (moveEvent: MouseEvent) => {
        const ctx = detailPanelResizing.current;
        if (!ctx) return;
        const delta = ctx.startX - moveEvent.clientX;
        const next = Math.min(720, Math.max(320, ctx.startWidth + delta));
        setDetailPanelWidth(next);
      };
      const onUp = () => {
        detailPanelResizing.current = null;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [detailPanelWidth],
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

  const setAssetFolderMutation = useMutation(
    api.assets.setAssetFolder,
  );
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
  }, []);

  const runBulkCuration = useCallback(
    async (isPublic: boolean) => {
      if (bulkCurationLoading || !canCuratePublic) return;
      const ids = Array.from(selectedAssetIds);
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

  const setAssetFolder = useCallback(
    async (assetId: string, folderId: string | null) => {
      if (!canAccessMyGallery) {
        setFolderError("Sign in to manage folders.");
        return;
      }
      if (folderLoadingAssetId) return;

      setFolderError(undefined);
      setFolderLoadingAssetId(assetId);
      try {
        const result = await setAssetFolderMutation({
          ownerUserId,
          assetId: assetId as Id<"assets">,
          folderId: folderId
            ? (folderId as Id<"folders">)
            : undefined,
        });
        const nextFolderId = result.folderId ?? undefined;
        setSelectedImage((current) =>
          current && current.id === assetId
            ? {
                ...current,
                folderId: nextFolderId,
              }
            : current,
        );

        if (
          galleryScope === "mine" &&
          selectedFolderId &&
          nextFolderId !== selectedFolderId
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
      setAssetFolderMutation,
    ],
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
  const folderNameById = useMemo(
    () =>
      new Map<string, string>(
        (folders ?? []).map((folder) => [folder._id, folder.name]),
      ),
    [folders],
  );
  const knownFolderIds = useMemo(
    () => (folders ? folders.map((folder) => folder._id) : null),
    [folders],
  );
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
          limit: 120,
        }
      : "skip",
  );

  const mineDesignEntries = useQuery(
    api.designInspirations.listDesignGalleryEntries,
    galleryScope === "mine" &&
      canAccessMyGallery &&
      selectedPillar === "designs"
      ? { ownerUserId, pillar: "designs", requireAsset: true, limit: 120 }
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
  };
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
        buildAssetSearchHaystack(asset).includes(search),
      );
    }
    return result;
  }, [assetSearchQuery, baseGalleryAssets]);

  const filteredSemanticResults = useMemo(() => {
    if (!semanticResults) {
      return semanticResults;
    }

    return semanticResults.filter((asset) => {
      if (
        galleryScope === "mine" &&
        effectiveSelectedFolderId &&
        asset.folderId !== effectiveSelectedFolderId
      ) {
        return false;
      }
      if (selectedModelName && asset.modelName !== selectedModelName) {
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
    if (workflowEntries.length === 0) return baseImages;
    return [...workflowEntries, ...baseImages].sort(
      (left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0),
    );
  }, [workflowsOnly, workflowEntries, baseImages]);

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
    onSetFolder: canManageFoldersInCurrentView
      ? (imageId: string, folderId: string | null) => {
          void setAssetFolder(imageId, folderId);
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
      contentRight={selectedImage ? "380px" : "0"}
    >
    <div
      className="lm-brutal lm-grid-bg h-[100dvh] overflow-hidden"
      data-pillar={selectedPillar ?? "creators"}
      style={{ backgroundColor: "var(--lm-surface-0)" }}
    >
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
          folders={folders ?? []}
          selectedFolderId={effectiveSelectedFolderId}
          onFolderSelect={setSelectedFolderId}
          galleryScope={galleryScope}
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
              onWorkflowsOnlyChange={setWorkflowsOnly}
              sortOrder={sortOrder}
              onSortOrderChange={setSortOrder}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
            />

            {/* Search Vault is now in the bottom dock */}

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
                    selectable={canCuratePublic}
                    selectedAssetIds={selectedAssetIds}
                    onToggleAssetSelect={toggleAssetSelection}
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

          {selectedImage && (
            <aside
              className="relative hidden shrink-0 overflow-y-auto overscroll-contain md:block"
              style={{
                width: `${detailPanelWidth}px`,
                backgroundColor: "color-mix(in srgb, var(--lm-surface-1) 75%, transparent)",
                backdropFilter: "blur(16px)",
                WebkitBackdropFilter: "blur(16px)",
              }}
            >
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize gallery"
                onMouseDown={startDetailPanelResize}
                className="group/resizer absolute left-0 top-0 z-30 hidden h-full w-2 -translate-x-1/2 cursor-col-resize md:flex md:items-center md:justify-center"
              >
                <span
                  className="h-12 w-[3px] rounded-full bg-[var(--lm-border-strong)] transition-colors duration-150 group-hover/resizer:bg-[var(--lm-coral)]"
                />
              </div>
              <GalleryDetailPanel
                image={selectedImage}
                carouselImages={carouselImages}
                {...expandedDetailProps}
              />
            </aside>
          )}
        </div>
      </div>

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

      {/* Admin bulk-curation toolbar — visible only when selection is non-empty */}
      {canCuratePublic && selectedAssetIds.size > 0 && (
        <div
          className="fixed z-[55] flex justify-center pointer-events-none"
          style={{
            left: sidebarCollapsed
              ? "var(--lm-sidebar-collapsed)"
              : "var(--lm-sidebar-width)",
            right: selectedImage ? `${detailPanelWidth}px` : "0",
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
              <button
                type="button"
                onClick={clearAssetSelection}
                disabled={bulkCurationLoading}
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
          right: selectedImage ? "380px" : "0",
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
        onClose={() => setUploadOpen(false)}
        availableTags={availableUploadTags}
        folders={folders ?? []}
        ownerUserId={
          canAccessMyGallery ? ownerUserId : undefined
        }
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
