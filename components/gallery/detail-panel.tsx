"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  ArrowRight,
  Paintbrush,
  Move,
  UserRound,
  Trash2,
  Copy,
  Download,
  Check,
  ChevronLeft,
  ChevronRight,
  Link as LinkIcon,
  Package,
  Search,
  ImagePlus,
  Loader2,
  ExternalLink,
  Save,
} from "lucide-react";
import { useQuery } from "convex/react";
import { downloadImage } from "@/lib/download-image";
import { meaningfulPrompt } from "@/lib/prompt";
import { useCoralToastSafe } from "@/components/ui/coral-toast";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

type ModalIntent = "transfer_style" | "transfer_pose" | "replace_character";

interface CarouselImage {
  id: string;
  thumbSrc: string;
  fullSrc: string;
  width?: number;
  height?: number;
  prompt?: string;
  kind?: "image" | "video";
  contentType?: string;
}

interface GalleryDetailPanelProps {
  image: {
    id: string;
    packId?: string;
    galleryItemId?: string;
    galleryItemType?: "asset" | "pack" | "design" | "workflow" | "storybook" | "beat";
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
    isDesignInspiration?: boolean;
    designTitle?: string;
    designDescription?: string;
    designInspirationId?: string;
    sourceDomain?: string;
    captureKind?: string;
    saveIntent?: string;
    inspirationType?: string;
    userNote?: string;
  };
  carouselImages?: CarouselImage[];
  onClose: () => void;
  onAction: (intent: ModalIntent, imageId: string) => void;
  activeRunId?: string;
  onOpenRun?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  canGoPrev?: boolean;
  canGoNext?: boolean;
  imagePosition?: string;
  onDelete?: (imageId: string) => void;
  deleting?: boolean;
  deleteError?: string;
  canCuratePublic?: boolean;
  onSetPublicState?: (imageId: string, isPublic: boolean) => void;
  onSetFeaturedState?: (imageId: string, isFeatured: boolean) => void;
  curationBusy?: boolean;
  curationError?: string;
  folders?: Array<{ _id: string; name: string }>;
  canManageFolder?: boolean;
  onSetFolders?: (
    imageId: string,
    folderIds: string[],
  ) => Promise<void> | void;
  onCreateFolder?: (name: string) => Promise<string | null>;
  folderBusy?: boolean;
  folderError?: string;
  onFindSimilar?: (imageId: string) => void;
  similarBusy?: boolean;
  similarActive?: boolean;
  onReplaceThumbnail?: (imageId: string, file: File) => Promise<void>;
  replacingThumbnail?: boolean;
  canEditAsset?: boolean;
  availableTags?: string[];
  onSaveAssetEdit?: (
    imageId: string,
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
  ) => Promise<void>;
  editingAsset?: boolean;
  editError?: string;
  toast?: (title: string, message?: string, type?: "success" | "warning" | "info" | "default") => void;
  /**
   * Layout variant. "sidebar" (default) stacks the media above the details in
   * a single narrow column. "modal" splits into a wide two-pane layout — large
   * media on the left, scrollable details on the right — for the full-screen
   * expanded view.
   */
  variant?: "sidebar" | "modal";
}

const ACTIONS = [
  {
    intent: "transfer_style" as ModalIntent,
    label: "TRANSFER STYLE",
    icon: Paintbrush,
  },
  {
    intent: "transfer_pose" as ModalIntent,
    label: "TRANSFER POSE",
    icon: Move,
  },
  {
    intent: "replace_character" as ModalIntent,
    label: "REPLACE CHARACTER",
    icon: UserRound,
  },
];

const DETAIL_TABS = ["INFO", "ACTIONS", "MANAGE"] as const;
type DetailTab = (typeof DETAIL_TABS)[number];

export function GalleryDetailPanel({
  image,
  carouselImages,
  onClose,
  onAction,
  activeRunId,
  onOpenRun,
  onPrev,
  onNext,
  canGoPrev,
  canGoNext,
  imagePosition,
  onDelete,
  deleting = false,
  deleteError,
  canCuratePublic = false,
  onSetPublicState,
  onSetFeaturedState,
  curationBusy = false,
  curationError,
  folders = [],
  canManageFolder = false,
  onSetFolders,
  onCreateFolder,
  folderBusy = false,
  folderError,
  onFindSimilar,
  similarBusy = false,
  similarActive = false,
  onReplaceThumbnail,
  replacingThumbnail = false,
  canEditAsset = false,
  availableTags = [],
  onSaveAssetEdit,
  editingAsset = false,
  editError,
  toast: externalToast,
  variant = "sidebar",
}: GalleryDetailPanelProps) {
  const coralCtx = useCoralToastSafe();
  const toastFn = externalToast ?? coralCtx?.toast ?? null;
  const isModal = variant === "modal";
  const { modelName, tagNames } = image;
  const [activeTab, setActiveTab] = useState<DetailTab>("INFO");
  const [copied, setCopied] = useState(false);
  const [copiedLabel, setCopiedLabel] = useState("COPIED");
  const [downloadStarted, setDownloadStarted] = useState(false);
  const [folderDraftName, setFolderDraftName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [copyMenuOpen, setCopyMenuOpen] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastExiting, setToastExiting] = useState(false);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [showLivePreview, setShowLivePreview] = useState(true);
  const [editPrompt, setEditPrompt] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editTagsInput, setEditTagsInput] = useState("");
  const [editModelName, setEditModelName] = useState("");
  const [editPillar, setEditPillar] = useState("");
  const [editKind, setEditKind] = useState<"image" | "video">("image");
  const [editGenerationType, setEditGenerationType] = useState("");
  const [editAssetRole, setEditAssetRole] = useState("");
  const [editIngestSource, setEditIngestSource] = useState("");
  const [editSourceUrl, setEditSourceUrl] = useState("");
  const [editFileName, setEditFileName] = useState("");
  const [editContentType, setEditContentType] = useState("");
  const activeFolderIds = useMemo(
    () => image.folderIds ?? (image.folderId ? [image.folderId] : []),
    [image.folderId, image.folderIds],
  );
  const activeFolderIdSet = useMemo(
    () => new Set(activeFolderIds),
    [activeFolderIds],
  );
  const [fullLoadedMap, setFullLoadedMap] = useState<
    Record<number, boolean>
  >({});
  const panelRef = useRef<HTMLDivElement>(null);
  const copyMenuRef = useRef<HTMLDivElement>(null);
  const thumbInputRef = useRef<HTMLInputElement>(null);

  // Lazy-fetch the linked design inspiration when the asset has one but
  // wasn't opened from the designs pillar (e.g. a bookmark in creators/dump).
  const fetchedInspiration = useQuery(
    api.designInspirations.getDesignInspiration,
    image.designInspirationId && !image.isDesignInspiration
      ? { id: image.designInspirationId as Id<"designInspirations"> }
      : "skip",
  );

  const designView = useMemo(() => {
    if (image.isDesignInspiration) {
      return {
        title: image.designTitle,
        description: image.designDescription,
        sourceUrl: image.sourceUrl,
        sourceDomain: image.sourceDomain,
        captureKind: image.captureKind,
        saveIntent: image.saveIntent,
        inspirationType: image.inspirationType,
        userNote: image.userNote,
      };
    }
    if (fetchedInspiration) {
      return {
        title: fetchedInspiration.title,
        description: fetchedInspiration.description,
        sourceUrl: fetchedInspiration.sourceUrl,
        sourceDomain: fetchedInspiration.sourceDomain,
        captureKind: fetchedInspiration.captureKind,
        saveIntent: fetchedInspiration.saveIntent,
        inspirationType: fetchedInspiration.inspirationType,
        userNote: fetchedInspiration.userNote,
      };
    }
    return null;
  }, [
    image.isDesignInspiration,
    image.designTitle,
    image.designDescription,
    image.sourceUrl,
    image.sourceDomain,
    image.captureKind,
    image.saveIntent,
    image.inspirationType,
    image.userNote,
    fetchedInspiration,
  ]);

  // Render the live iframe view for any web bookmark — both new saves
  // (captureKind === "website") and legacy saves where only inspirationType is set.
  const isWebBookmark = Boolean(
    designView &&
      designView.sourceUrl &&
      (designView.captureKind === "website" ||
        (!designView.captureKind && designView.inspirationType === "website")),
  );
  const isDesignView = Boolean(image.isDesignInspiration || designView);

  const handleReplaceThumbnail = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onReplaceThumbnail) return;
    try {
      await onReplaceThumbnail(image.id, file);
      if (toastFn) {
        toastFn("Thumbnail replaced", undefined, "success");
      }
    } catch {
      if (toastFn) {
        toastFn("Failed to replace thumbnail", undefined, "warning");
      }
    }
    // Reset input so the same file can be re-selected
    if (thumbInputRef.current) {
      thumbInputRef.current.value = "";
    }
  }, [image.id, onReplaceThumbnail, toastFn]);

  const allSlides: CarouselImage[] = useMemo(
    () =>
      carouselImages && carouselImages.length > 0
        ? carouselImages
        : [
            {
              id: image.id,
              thumbSrc: image.thumbSrc,
              fullSrc: image.fullSrc,
              width: image.width,
              height: image.height,
              kind: image.kind,
              contentType: image.contentType,
            },
          ],
    [
      carouselImages,
      image.id,
      image.thumbSrc,
      image.fullSrc,
      image.width,
      image.height,
      image.kind,
      image.contentType,
    ],
  );
  const currentSlide = allSlides[carouselIndex] ?? allSlides[0];
  const currentFullLoaded = fullLoadedMap[carouselIndex] ?? false;

  useEffect(() => {
    setCarouselIndex(0);
    setFullLoadedMap({});
    setCopyMenuOpen(false);
    setToastVisible(false);
    setToastExiting(false);
    setFolderDraftName("");
    setCreatingFolder(false);
    setActiveTab("INFO");
    setShowLivePreview(true);
  }, [image.id]);

  useEffect(() => {
    if (!copyMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        copyMenuRef.current &&
        !copyMenuRef.current.contains(e.target as Node)
      ) {
        setCopyMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [copyMenuOpen]);

  const showToast = useCallback((label: string) => {
    if (toastFn) {
      setCopied(true);
      setCopyMenuOpen(false);
      toastFn("Copied", label, "success");
      setTimeout(() => setCopied(false), 1800);
      return;
    }
    setCopied(true);
    setCopiedLabel(label);
    setCopyMenuOpen(false);
    setToastVisible(true);
    setToastExiting(false);
    setTimeout(() => {
      setToastExiting(true);
      setTimeout(() => {
        setToastVisible(false);
        setToastExiting(false);
        setCopied(false);
      }, 200);
    }, 1800);
  }, [toastFn]);

  const activePrompt = currentSlide.prompt ?? image.prompt;
  // The clean prompt for display/copy — undefined for placeholder fallbacks
  // ("Untitled prompt", a bare file name) so the prompt UI stays hidden.
  const promptForDisplay = meaningfulPrompt(activePrompt);
  const currentAssetId = currentSlide.id ?? image.id;
  const canEditCurrentAsset = Boolean(
    canEditAsset &&
      onSaveAssetEdit &&
      !isDesignView &&
      currentAssetId,
  );
  const tagDatalistId = `asset-tag-suggestions-${currentAssetId}`;

  useEffect(() => {
    setEditPrompt(activePrompt ?? "");
    setEditDescription(image.description ?? "");
    setEditTagsInput((image.tagNames ?? []).join(", "));
    setEditModelName(image.modelName ?? "");
    setEditPillar(image.pillar ?? "");
    setEditKind(image.kind ?? "image");
    setEditGenerationType(image.generationType ?? "");
    setEditAssetRole(image.assetRole ?? "");
    setEditIngestSource(image.ingestSource ?? "");
    setEditSourceUrl(image.sourceUrl ?? "");
    setEditFileName(image.fileName ?? "");
    setEditContentType(image.contentType ?? "");
  }, [
    activePrompt,
    currentAssetId,
    image.description,
    image.modelName,
    image.pillar,
    image.kind,
    image.generationType,
    image.assetRole,
    image.ingestSource,
    image.sourceUrl,
    image.fileName,
    image.contentType,
    image.tagNames,
  ]);

  const handleSaveAssetEdit = async () => {
    if (!canEditCurrentAsset || !onSaveAssetEdit) return;
    const tagNames = editTagsInput
      .split(/[,\n]/)
      .map((tag) => tag.trim())
      .filter(Boolean);
    await onSaveAssetEdit(currentAssetId, {
      description: editDescription.trim() || null,
      promptText: editPrompt.trim() || null,
      tagNames,
      kind: editKind,
      modelName: editModelName.trim() || null,
      pillar: editPillar.trim() || null,
      generationType: editGenerationType.trim() || null,
      assetRole: editAssetRole.trim() || null,
      ingestSource: editIngestSource.trim() || null,
      sourceUrl: editSourceUrl.trim() || null,
      fileName: editFileName.trim() || null,
      contentType: editContentType.trim() || null,
    });
    if (toastFn) {
      toastFn("Asset updated", undefined, "success");
    }
  };

  const handleCopy = async (text?: string) => {
    const content = text ?? activePrompt;
    await navigator.clipboard.writeText(content);
    showToast(text && text !== activePrompt ? "URL COPIED" : "PROMPT COPIED");
  };

  const handleCopyUrl = async () => {
    await navigator.clipboard.writeText(currentSlide.fullSrc);
    showToast("URL COPIED");
  };

  const handleCopyGalleryId = async (
    kind: "asset" | "pack" | "design",
    id: string,
  ) => {
    await navigator.clipboard.writeText(`${kind}:${id}`);
    showToast(`${kind.toUpperCase()} ID COPIED`);
  };

  const handleCopyPackage = async () => {
    const parts = [
      activePrompt,
      image.modelName ? `Model: ${image.modelName}` : "",
      image.tagNames?.length
        ? `Tags: ${image.tagNames.join(", ")}`
        : "",
      `Image: ${currentSlide.fullSrc}`,
      image.sourceUrl ? `Source: ${image.sourceUrl}` : "",
    ].filter(Boolean);
    await navigator.clipboard.writeText(parts.join("\n"));
    showToast("PACKAGE COPIED");
  };

  const handleDownload = async () => {
    setDownloadStarted(true);
    await downloadImage(image.fullSrc, `laniameda-${image.id}`);
    setTimeout(() => setDownloadStarted(false), 1500);
  };

  const handleFolderToggle = (folderId: string, checked: boolean) => {
    if (!onSetFolders) return;
    const nextFolderIds = checked
      ? [...activeFolderIds, folderId]
      : activeFolderIds.filter((id) => id !== folderId);
    void onSetFolders(image.id, Array.from(new Set(nextFolderIds)));
  };

  const handleClearFolders = () => {
    if (!onSetFolders || activeFolderIds.length === 0) return;
    void onSetFolders(image.id, []);
  };

  const handleCreateFolder = async () => {
    if (!onCreateFolder) return;
    const name = folderDraftName.trim();
    if (!name || creatingFolder) return;
    setCreatingFolder(true);
    try {
      const folderId = await onCreateFolder(name);
      if (folderId && onSetFolders) {
        await onSetFolders(
          image.id,
          Array.from(new Set([...activeFolderIds, folderId])),
        );
      }
      setFolderDraftName("");
    } finally {
      setCreatingFolder(false);
    }
  };

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "c") {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) {
          e.preventDefault();
          void handleCopy();
        }
      }
    };
    el.addEventListener("keydown", handler);
    return () => el.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image.prompt]);

  const relativeDate = useMemo(() => {
    if (!image.createdAt) return undefined;
    const diff = Date.now() - image.createdAt;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "JUST NOW";
    if (mins < 60) return `${mins}M AGO`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}H AGO`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}D AGO`;
    return undefined;
  }, [image.createdAt]);

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      className={`flex h-full flex-col ${isModal ? "" : "lm-animate-slide-right"}`}
      key={image.id}
      style={{ fontFamily: "var(--lm-font)" }}
    >
      {/* ── Header Bar ── */}
      <div
        className="flex items-center justify-between px-3"
        style={{
          height: "44px",
          backgroundColor: "transparent",
          borderBottom: isModal ? "none" : "1px solid var(--lm-border)",
          flexShrink: 0,
        }}
      >
        <div className="flex items-center gap-1">
          {onPrev && (
            <button
              type="button"
              onClick={onPrev}
              disabled={!canGoPrev}
              className="flex items-center justify-center transition-colors disabled:opacity-20 hover:bg-black/5"
              style={{
                width: "26px",
                height: "26px",
                color: "var(--lm-text-secondary)",
                borderRadius: "6px",
              }}
              aria-label="Previous image"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
          )}
          {imagePosition && (
            <span
              className="px-1"
              style={{
                fontSize: "11px",
                fontVariantNumeric: "tabular-nums",
                fontWeight: 600,
                color: "var(--lm-text-tertiary)",
              }}
            >
              {imagePosition}
            </span>
          )}
          {onNext && (
            <button
              type="button"
              onClick={onNext}
              disabled={!canGoNext}
              className="flex items-center justify-center transition-colors disabled:opacity-20 hover:bg-black/5"
              style={{
                width: "26px",
                height: "26px",
                color: "var(--lm-text-secondary)",
                borderRadius: "6px",
              }}
              aria-label="Next image"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex items-center justify-center transition-colors hover:bg-black/5"
          style={{
            width: "26px",
            height: "26px",
            color: "var(--lm-text-tertiary)",
            borderRadius: "6px",
          }}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* ── Body ── sidebar: single scrolling column. modal: media left / details right. */}
      <div
        className={
          isModal
            ? "flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row"
            : "flex-1 overflow-y-auto overscroll-contain"
        }
      >
        {/* Media stage — modal lets the image float free on the dark canvas.
            Clicking the empty canvas around it closes the view. */}
        <div
          className={
            isModal
              ? "flex min-h-0 items-center justify-center p-6 md:flex-1 md:p-10"
              : "contents"
          }
          onClick={isModal ? onClose : undefined}
        >
        {/* Image — boxless: shown in its native aspect ratio, no frame */}
        <div
          onClick={isModal ? (event) => event.stopPropagation() : undefined}
          className={
            isModal
              ? "relative mx-auto overflow-hidden"
              : "relative overflow-hidden"
          }
          style={
            isModal
              ? {
                  aspectRatio: `${currentSlide.width ?? 1} / ${currentSlide.height ?? 1}`,
                  // Drive sizing off whichever axis is binding so the media keeps
                  // its native aspect (fill images need one definite dimension).
                  ...((currentSlide.width ?? 1) >= (currentSlide.height ?? 1)
                    ? { width: "100%", maxHeight: "100%" }
                    : { height: "100%", maxWidth: "100%" }),
                }
              : {
                  aspectRatio: `${currentSlide.width ?? 1} / ${currentSlide.height ?? 1}`,
                  border: "none",
                  borderBottom: "1px solid var(--lm-border)",
                }
          }
        >
          {isWebBookmark && designView?.sourceUrl ? (
            <>
              {/* Screenshot underneath — shows through if the iframe is blocked
                  by X-Frame-Options or if the user toggles to screenshot view. */}
              <Image
                src={currentSlide.thumbSrc}
                alt={designView.title ?? image.prompt}
                fill
                sizes="440px"
                className="object-cover"
                style={{ borderRadius: 0 }}
                priority
                unoptimized
              />
              {showLivePreview && (
                <iframe
                  key={designView.sourceUrl}
                  src={designView.sourceUrl}
                  title={designView.title ?? "Live preview"}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
                  className="absolute inset-0 h-full w-full"
                  style={{ border: 0, background: "var(--lm-paper)" }}
                />
              )}
              <div className="absolute right-2 top-2 z-20 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowLivePreview((s) => !s)}
                  style={{
                    padding: "4px 8px",
                    fontSize: "10px",
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    backgroundColor: "rgba(0,0,0,0.75)",
                    color: "var(--lm-paper)",
                    border: "1px solid rgba(255,255,255,0.2)",
                    borderRadius: "var(--lm-radius)",
                    cursor: "pointer",
                  }}
                  aria-pressed={showLivePreview}
                >
                  {showLivePreview ? "Screenshot" : "Live"}
                </button>
                <a
                  href={designView.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1"
                  style={{
                    padding: "4px 8px",
                    fontSize: "10px",
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    backgroundColor: "var(--lm-coral)",
                    color: "var(--lm-paper)",
                    border: "1px solid var(--lm-coral)",
                    borderRadius: "var(--lm-radius)",
                  }}
                  aria-label="Open source URL in a new tab"
                >
                  Open
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
              </div>
            </>
          ) : currentSlide.kind === "video" ? (
            <video
              key={currentSlide.id}
              src={currentSlide.fullSrc}
              poster={
                currentSlide.thumbSrc &&
                currentSlide.thumbSrc !== currentSlide.fullSrc
                  ? currentSlide.thumbSrc
                  : undefined
              }
              controls
              playsInline
              preload="metadata"
              className="h-full w-full object-contain"
              style={{ backgroundColor: "#000", borderRadius: 0 }}
            />
          ) : (
            <>
              <Image
                src={currentSlide.thumbSrc}
                alt={image.prompt}
                fill
                sizes={isModal ? "(max-width: 768px) 100vw, 60vw" : "440px"}
                className={isModal ? "object-contain" : "object-cover"}
                style={{ borderRadius: 0 }}
                priority
                unoptimized
              />
              <Image
                src={currentSlide.fullSrc}
                alt={image.prompt}
                fill
                sizes={isModal ? "(max-width: 768px) 100vw, 60vw" : "440px"}
                className={`${isModal ? "object-contain" : "object-cover"} transition-opacity`}
                style={{
                  borderRadius: 0,
                  opacity: currentFullLoaded ? 1 : 0,
                  transitionDuration: "500ms",
                }}
                priority
                ref={(node) => {
                  // Cached full-res images can be complete before onLoad wires
                  // up — never leave the full layer invisible behind the
                  // compressed thumb.
                  if (node?.complete && node.naturalWidth > 0) {
                    setFullLoadedMap((prev) =>
                      prev[carouselIndex]
                        ? prev
                        : { ...prev, [carouselIndex]: true },
                    );
                  }
                }}
                onLoad={(e) => {
                  if (e.currentTarget.naturalWidth > 0) {
                    setFullLoadedMap((prev) => ({
                      ...prev,
                      [carouselIndex]: true,
                    }));
                  }
                }}
                onError={() => {
                  setFullLoadedMap((prev) => ({
                    ...prev,
                    [carouselIndex]: true,
                  }));
                }}
                unoptimized
              />
            </>
          )}

          {/* Carousel dots */}
          {allSlides.length > 1 && (
            <div className="absolute bottom-2 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1">
              {allSlides.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCarouselIndex(i);
                  }}
                  style={{
                    width: i === carouselIndex ? "16px" : "6px",
                    height: "6px",
                    backgroundColor:
                      i === carouselIndex
                        ? "var(--lm-coral)"
                        : "rgba(255,255,255,0.4)",
                    borderRadius: "var(--lm-radius)",
                    transition: "all 200ms",
                  }}
                  aria-label={`Image ${i + 1} of ${allSlides.length}`}
                />
              ))}
            </div>
          )}

          {/* Carousel arrows */}
          {allSlides.length > 1 && carouselIndex > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setCarouselIndex((i) => i - 1);
              }}
              className="absolute left-2 top-1/2 z-20 flex -translate-y-1/2 items-center justify-center"
              style={{
                width: "28px",
                height: "28px",
                backgroundColor: "rgba(0, 0, 0, 0.8)",
                color: "var(--lm-paper)",
                border: "2px solid rgba(255,255,255,0.2)",
                borderRadius: "var(--lm-radius)",
              }}
              aria-label="Previous carousel image"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          {allSlides.length > 1 &&
            carouselIndex < allSlides.length - 1 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setCarouselIndex((i) => i + 1);
                }}
                className="absolute right-2 top-1/2 z-20 flex -translate-y-1/2 items-center justify-center"
                style={{
                  width: "28px",
                  height: "28px",
                  backgroundColor: "rgba(0, 0, 0, 0.8)",
                  color: "var(--lm-paper)",
                  border: "2px solid rgba(255,255,255,0.2)",
                  borderRadius: "var(--lm-radius)",
                }}
                aria-label="Next carousel image"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
        </div>
        </div>

        {/* ── Details ── right pane in modal, inline column in sidebar ── */}
        <div
          className={
            isModal
              ? "flex min-h-0 w-full flex-col overflow-y-auto overscroll-contain md:w-[420px] md:max-w-[42vw] md:shrink-0"
              : "contents"
          }
        >
        {/* Quick metadata strip + actions */}
        <div
          className="flex flex-wrap items-center gap-1.5 px-3 py-2"
          style={{
            borderBottom: "1px solid var(--lm-border)",
          }}
        >
          {(modelName || (isDesignView && designView?.sourceDomain)) && (
            <span
              style={{
                padding: "2px 8px",
                fontSize: "10px",
                fontWeight: 700,
                backgroundColor: "var(--lm-ink)",
                color: "var(--lm-coral)",
                borderRadius: "4px",
              }}
            >
              {isDesignView ? designView?.sourceDomain : modelName}
            </span>
          )}
          {relativeDate && (
            <span
              style={{
                fontSize: "10px",
                fontWeight: 500,
                color: "var(--lm-text-ghost)",
              }}
            >
              {relativeDate}
            </span>
          )}
          {(() => {
            const idKind: "asset" | "design" = isDesignView ? "design" : "asset";
            const idValue = isDesignView ? image.id : currentAssetId;
            if (!idValue) return null;
            const token = `${idKind}:${idValue}`;
            return (
              <button
                type="button"
                onClick={() => void handleCopyGalleryId(idKind, idValue)}
                className="flex items-center gap-1 transition-all hover:scale-[1.02]"
                aria-label={`Copy ${idKind} ID`}
                title={`Copy ${idKind} ID: ${token}`}
                style={{
                  padding: "2px 7px",
                  fontSize: "10px",
                  fontFamily: "var(--lm-font-mono, ui-monospace, monospace)",
                  fontWeight: 700,
                  color: "var(--lm-coral)",
                  backgroundColor: "color-mix(in srgb, var(--lm-coral) 14%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--lm-coral) 45%, transparent)",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                <Copy className="h-2.5 w-2.5" />
                {`${idKind}:${idValue.slice(0, 6)}…`}
              </button>
            );
          })()}
          {image.packId && !isDesignView && (
            <button
              type="button"
              onClick={() => void handleCopyGalleryId("pack", image.packId!)}
              className="flex items-center gap-1 transition-all hover:scale-[1.02]"
              aria-label="Copy pack ID"
              title={`Copy pack ID: pack:${image.packId}`}
              style={{
                padding: "2px 7px",
                fontSize: "10px",
                fontFamily: "var(--lm-font-mono, ui-monospace, monospace)",
                fontWeight: 700,
                color: "var(--lm-text-secondary)",
                backgroundColor: "var(--lm-surface-2)",
                border: "1px solid var(--lm-border)",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              <Package className="h-2.5 w-2.5" />
              {`pack:${image.packId.slice(0, 6)}…`}
            </button>
          )}
          <div className="ml-auto flex items-center gap-1">
            {onReplaceThumbnail && (
              <>
                <input
                  ref={thumbInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void handleReplaceThumbnail(e)}
                />
                <button
                  type="button"
                  onClick={() => thumbInputRef.current?.click()}
                  disabled={replacingThumbnail}
                  className="flex items-center justify-center transition-colors hover:bg-black/5"
                  aria-label="Replace thumbnail"
                  title="Replace thumbnail"
                  style={{
                    width: "28px",
                    height: "28px",
                    color: "var(--lm-text-tertiary)",
                    borderRadius: "6px",
                    opacity: replacingThumbnail ? 0.5 : 1,
                  }}
                >
                  {replacingThumbnail ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ImagePlus className="h-3.5 w-3.5" />
                  )}
                </button>
              </>
            )}
            <div ref={copyMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setCopyMenuOpen(!copyMenuOpen)}
                className="flex items-center justify-center transition-colors hover:bg-black/5"
                aria-label="Copy options"
                style={{
                  width: "28px",
                  height: "28px",
                  color: "var(--lm-text-tertiary)",
                  borderRadius: "6px",
                }}
              >
                {copied ? (
                  <Check
                    className="h-3.5 w-3.5"
                    style={{ color: "var(--lm-success)" }}
                  />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
              {copyMenuOpen && !copied && (
                <div
                  className="absolute right-0 top-full z-10 mt-1 flex flex-col py-1"
                  style={{
                    backgroundColor: "var(--lm-surface-1)",
                    border: "1px solid var(--lm-border-strong)",
                    boxShadow: "0 14px 36px rgba(0,0,0,0.42)",
                    minWidth: "180px",
                    borderRadius: "8px",
                  }}
                >
                  {(isDesignView || promptForDisplay) && (
                    <CopyMenuItem
                      icon={isDesignView ? LinkIcon : Copy}
                      label={isDesignView ? "Copy source URL" : "Copy prompt"}
                      primary
                      onClick={() =>
                        void handleCopy(
                          isDesignView
                            ? designView?.sourceUrl
                            : undefined,
                        )
                      }
                    />
                  )}
                  <div
                    className="mx-2 my-0.5"
                    style={{
                      height: "1px",
                      backgroundColor: "rgba(255,255,255,0.08)",
                    }}
                  />
                  <CopyMenuItem
                    icon={LinkIcon}
                    label="Copy image URL"
                    onClick={() => void handleCopyUrl()}
                  />
                  <CopyMenuItem
                    icon={Copy}
                    label={`Copy ${isDesignView ? "design" : "asset"} ID`}
                    onClick={() =>
                      void handleCopyGalleryId(
                        isDesignView ? "design" : "asset",
                        isDesignView ? image.id : currentAssetId,
                      )
                    }
                  />
                  {image.packId && (
                    <CopyMenuItem
                      icon={Package}
                      label="Copy pack ID"
                      onClick={() =>
                        void handleCopyGalleryId("pack", image.packId!)
                      }
                    />
                  )}
                  <CopyMenuItem
                    icon={Package}
                    label="Copy full package"
                    onClick={() => void handleCopyPackage()}
                  />
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => void handleDownload()}
              className="flex items-center justify-center transition-colors hover:bg-black/5"
              aria-label="Download image"
              style={{
                width: "28px",
                height: "28px",
                color: "var(--lm-text-tertiary)",
                borderRadius: "6px",
              }}
            >
              {downloadStarted ? (
                <Check
                  className="h-3.5 w-3.5"
                  style={{ color: "var(--lm-success)" }}
                />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>

        {/* ── Tab Headers ── */}
        <div
          className="flex items-center gap-0.5 px-3"
          style={{
            borderBottom: "1px solid var(--lm-border)",
          }}
        >
          {DETAIL_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className="relative flex items-center px-2.5 py-2 transition-colors"
              style={{
                fontSize: "11px",
                fontWeight: activeTab === tab ? 700 : 500,
                color:
                  activeTab === tab
                    ? "var(--lm-text-primary)"
                    : "var(--lm-text-ghost)",
              }}
            >
              {tab.charAt(0) + tab.slice(1).toLowerCase()}
              {activeTab === tab && (
                <span
                  className="absolute bottom-0 left-1 right-1"
                  style={{
                    height: "2px",
                    backgroundColor: "var(--lm-coral)",
                    borderRadius: "1px",
                  }}
                />
              )}
            </button>
          ))}
        </div>

        {/* ── Tab Content ── */}
        <div className="px-3 pb-4">
          {activeTab === "INFO" && (
            <div className="flex flex-col gap-0 pt-2.5">
              {isDesignView && designView ? (
                <>
                  {/* Title */}
                  {designView.title && (
                    <div className="pb-2">
                      <SectionLabel>Title</SectionLabel>
                      <p
                        className="mt-1.5"
                        style={{
                          fontSize: "13px",
                          fontWeight: 600,
                          lineHeight: 1.4,
                          color: "var(--lm-text-primary)",
                          fontFamily: "var(--lm-font)",
                          wordBreak: "break-word",
                        }}
                      >
                        {designView.title}
                      </p>
                    </div>
                  )}

                  {/* Description */}
                  {designView.description && (
                    <div
                      className="pb-2 pt-2.5"
                      style={{
                        borderTop: "1px solid var(--lm-border)",
                      }}
                    >
                      <SectionLabel>Description</SectionLabel>
                      <p
                        className="mt-1.5"
                        style={{
                          fontSize: "12px",
                          fontWeight: 400,
                          lineHeight: 1.55,
                          color: "var(--lm-text-secondary)",
                          fontFamily: "var(--lm-font)",
                          wordBreak: "break-word",
                        }}
                      >
                        {designView.description}
                      </p>
                    </div>
                  )}

                  {/* Source URL */}
                  {designView.sourceUrl && (
                    <div
                      className="pb-2 pt-2.5"
                      style={{
                        borderTop: "1px solid var(--lm-border)",
                      }}
                    >
                      <SectionLabel>Source</SectionLabel>
                      <a
                        href={designView.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1.5 flex items-center gap-1.5"
                        style={{
                          fontSize: "11px",
                          color: "var(--lm-coral)",
                          fontFamily: "var(--lm-font)",
                          wordBreak: "break-all",
                        }}
                      >
                        <LinkIcon className="h-3 w-3 flex-shrink-0" />
                        {designView.sourceDomain ?? designView.sourceUrl}
                      </a>
                    </div>
                  )}

                  {/* User note */}
                  {designView.userNote && (
                    <div
                      className="pb-2 pt-2.5"
                      style={{
                        borderTop: "1px solid var(--lm-border)",
                      }}
                    >
                      <SectionLabel>Note</SectionLabel>
                      <p
                        className="mt-1.5"
                        style={{
                          fontSize: "12px",
                          fontWeight: 400,
                          lineHeight: 1.55,
                          color: "var(--lm-text-secondary)",
                          fontFamily: "var(--lm-font)",
                          wordBreak: "break-word",
                        }}
                      >
                        {designView.userNote}
                      </p>
                    </div>
                  )}

                  {/* Design metadata chips */}
                  <div
                    className="pt-2.5"
                    style={{
                      borderTop: "1px solid var(--lm-border)",
                    }}
                  >
                    <SectionLabel>Details</SectionLabel>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {designView.captureKind && (
                        <span className="lm-chip">{designView.captureKind}</span>
                      )}
                      {designView.saveIntent && (
                        <span className="lm-chip">{designView.saveIntent}</span>
                      )}
                      {designView.inspirationType && (
                        <span className="lm-chip">{designView.inspirationType}</span>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {/* Prompt — only when a real prompt exists (placeholder
                      fallbacks like "Untitled prompt" are suppressed). */}
                  {promptForDisplay && (
                    <div className="pb-2">
                      <SectionLabel>Prompt</SectionLabel>
                      <p
                        className="mt-1.5"
                        style={{
                          fontSize: "12px",
                          fontWeight: 400,
                          lineHeight: 1.55,
                          color: "var(--lm-text-secondary)",
                          fontFamily: "var(--lm-font)",
                          wordBreak: "break-word",
                        }}
                      >
                        {promptForDisplay}
                      </p>
                    </div>
                  )}
                  {image.description && (
                    <div
                      className="pb-2 pt-2.5"
                      style={{
                        borderTop: "1px solid var(--lm-border)",
                      }}
                    >
                      <SectionLabel>Description</SectionLabel>
                      <p
                        className="mt-1.5"
                        style={{
                          fontSize: "12px",
                          fontWeight: 400,
                          lineHeight: 1.55,
                          color: "var(--lm-text-secondary)",
                          fontFamily: "var(--lm-font)",
                          wordBreak: "break-word",
                        }}
                      >
                        {image.description}
                      </p>
                    </div>
                  )}
                </>
              )}

              {/* Tags */}
              <div className="pt-2.5">
                <SectionLabel>Tags</SectionLabel>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {tagNames && tagNames.length > 0 ? (
                    tagNames.map((tag) => (
                      <span key={tag} className="lm-chip">
                        {tag}
                      </span>
                    ))
                  ) : (
                    <span
                      style={{
                        fontSize: "11px",
                        color: "var(--lm-text-ghost)",
                        fontWeight: 500,
                      }}
                    >
                      No tags
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === "ACTIONS" && (
            <div className="flex flex-col gap-0 pt-2.5">
              {/* AI Actions */}
              <div
                className="pb-2.5"
                style={{
                  borderBottom: "1px solid var(--lm-border)",
                }}
              >
                <SectionLabel>AI Actions</SectionLabel>
                <div className="mt-1.5 flex flex-col gap-1">
                  {onFindSimilar ? (
                    <button
                      type="button"
                      onClick={() => onFindSimilar(image.id)}
                      disabled={similarBusy}
                      className="lm-btn-brutal group flex w-full items-center gap-3 justify-start disabled:cursor-wait disabled:opacity-70"
                      aria-label="Find similar"
                    >
                      <Search
                        className="h-3.5 w-3.5 flex-shrink-0"
                        style={{ opacity: 0.7 }}
                      />
                      <span className="flex-1 text-left">
                        {similarBusy
                          ? "FINDING SIMILAR"
                          : similarActive
                            ? "SHOWING SIMILAR"
                            : "FIND SIMILAR"}
                      </span>
                      <ArrowRight
                        className="h-3 w-3"
                        style={{ opacity: 0.4 }}
                      />
                    </button>
                  ) : null}
                  {activeRunId && (
                    <button
                      type="button"
                      onClick={onOpenRun}
                      className="flex items-center justify-between px-3 py-2.5 transition-colors"
                      aria-label="View active run"
                      style={{
                        border: "2px solid var(--lm-success)",
                        backgroundColor: "var(--lm-success-dim)",
                        color: "var(--lm-success)",
                        fontSize: "10px",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.10em",
                        borderRadius: "var(--lm-radius)",
                      }}
                    >
                      <span>RUN ACTIVE: {activeRunId}</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {!isDesignView &&
                    ACTIONS.map(({ intent, label, icon: Icon }) => (
                    <button
                      key={intent}
                      type="button"
                      onClick={() => onAction(intent, image.id)}
                      className="lm-btn-brutal group flex w-full items-center gap-3 justify-start"
                      aria-label={label}
                    >
                      <Icon
                        className="h-3.5 w-3.5 flex-shrink-0"
                        style={{ opacity: 0.7 }}
                      />
                      <span className="flex-1 text-left">
                        {label}
                      </span>
                      <ArrowRight
                        className="h-3 w-3"
                        style={{ opacity: 0.4 }}
                      />
                    </button>
                  ))}
                </div>
              </div>

              {/* Quick Copy/Download */}
              <div className="pt-2.5">
                <SectionLabel>Export</SectionLabel>
                <div className="mt-1.5 flex flex-col gap-1">
                  {isDesignView && designView?.sourceUrl ? (
                    <button
                      type="button"
                      onClick={() => void handleCopy(designView.sourceUrl)}
                      className="lm-btn-ghost flex w-full items-center gap-2 justify-start"
                      style={{
                        border: "2px solid var(--lm-border-strong)",
                      }}
                    >
                      <LinkIcon className="h-3 w-3" />
                      COPY SOURCE URL
                    </button>
                  ) : promptForDisplay ? (
                    <button
                      type="button"
                      onClick={() => void handleCopy()}
                      className="lm-btn-ghost flex w-full items-center gap-2 justify-start"
                      style={{
                        border: "2px solid var(--lm-border-strong)",
                      }}
                    >
                      <Copy className="h-3 w-3" />
                      COPY PROMPT
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void handleCopyPackage()}
                    className="lm-btn-ghost flex w-full items-center gap-2 justify-start"
                    style={{
                      border: "2px solid var(--lm-border-strong)",
                    }}
                  >
                    <Package className="h-3 w-3" />
                    COPY FULL PACKAGE
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDownload()}
                    className="lm-btn-ghost flex w-full items-center gap-2 justify-start"
                    style={{
                      border: "2px solid var(--lm-border-strong)",
                    }}
                  >
                    <Download className="h-3 w-3" />
                    DOWNLOAD IMAGE
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === "MANAGE" && (
            <div className="flex flex-col gap-0 pt-2.5">
              {canEditCurrentAsset && (
                <div
                  className="pb-2.5"
                  style={{
                    borderBottom: "1px solid var(--lm-border)",
                  }}
                >
                  <SectionLabel>Admin edit</SectionLabel>
                  <div className="mt-2 flex flex-col gap-2">
                    <AdminEditTextarea
                      label="Prompt"
                      value={editPrompt}
                      onChange={setEditPrompt}
                      minRows={5}
                    />
                    <AdminEditTextarea
                      label="Description"
                      value={editDescription}
                      onChange={setEditDescription}
                      minRows={3}
                    />
                    <AdminEditInput
                      label="Tags"
                      value={editTagsInput}
                      onChange={setEditTagsInput}
                      listId={tagDatalistId}
                    />
                    <datalist id={tagDatalistId}>
                      {availableTags.map((tag) => (
                        <option key={tag} value={tag} />
                      ))}
                    </datalist>
                    <AdminEditInput
                      label="Model"
                      value={editModelName}
                      onChange={setEditModelName}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <AdminEditSelect
                        label="Media kind"
                        value={editKind}
                        onChange={(value) =>
                          setEditKind(value === "video" ? "video" : "image")
                        }
                        options={[
                          { value: "image", label: "Image" },
                          { value: "video", label: "Video" },
                        ]}
                      />
                      <AdminEditInput
                        label="Content type"
                        value={editContentType}
                        onChange={setEditContentType}
                      />
                    </div>
                    <AdminEditSelect
                      label="Generation type"
                      value={editGenerationType}
                      onChange={setEditGenerationType}
                      options={[
                        { value: "", label: "Unset" },
                        { value: "image_gen", label: "Image gen" },
                        { value: "video_gen", label: "Video gen" },
                        { value: "ui_design", label: "UI design" },
                        { value: "workflow", label: "Workflow" },
                        { value: "other", label: "Other" },
                      ]}
                    />
                    <AdminEditSelect
                      label="Asset role"
                      value={editAssetRole}
                      onChange={setEditAssetRole}
                      options={[
                        { value: "", label: "Unset" },
                        { value: "generated_output", label: "Generated output" },
                        { value: "reference", label: "Reference" },
                        { value: "inspiration_capture", label: "Inspiration capture" },
                        { value: "workflow_asset", label: "Workflow asset" },
                        { value: "cinema_frame", label: "Cinema frame" },
                        { value: "other", label: "Other" },
                      ]}
                    />
                    <AdminEditSelect
                      label="Ingest source"
                      value={editIngestSource}
                      onChange={setEditIngestSource}
                      options={[
                        { value: "", label: "Unset" },
                        { value: "api", label: "API" },
                        { value: "agent", label: "Agent" },
                        { value: "telegram", label: "Telegram" },
                        { value: "manual", label: "Manual" },
                        { value: "import", label: "Import" },
                      ]}
                    />
                    <AdminEditInput
                      label="Source URL"
                      value={editSourceUrl}
                      onChange={setEditSourceUrl}
                    />
                    <AdminEditInput
                      label="File name"
                      value={editFileName}
                      onChange={setEditFileName}
                    />
                    <button
                      type="button"
                      onClick={() => void handleSaveAssetEdit()}
                      disabled={editingAsset}
                      className="flex items-center justify-center gap-2 px-3 py-2.5 transition-colors disabled:opacity-40"
                      style={{
                        border: "2px solid var(--lm-ink)",
                        backgroundColor: "var(--lm-coral)",
                        color: "#000",
                        fontSize: "10px",
                        fontWeight: 800,
                        textTransform: "uppercase",
                        letterSpacing: "0.14em",
                        borderRadius: "var(--lm-radius)",
                      }}
                    >
                      {editingAsset ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Save className="h-3.5 w-3.5" />
                      )}
                      {editingAsset ? "Saving" : "Save edits"}
                    </button>
                    {editError && (
                      <p
                        style={{
                          fontSize: "10px",
                          color: "var(--lm-status-error)",
                          fontWeight: 600,
                        }}
                        role="alert"
                      >
                        {editError}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Collections — file this asset into one or more collections
                  (multi-board membership). Toggling moves/copies the asset. */}
              {canManageFolder && (
                <div
                  className="pb-2.5"
                  style={{
                    borderBottom: "1px solid var(--lm-border)",
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <SectionLabel>Collections</SectionLabel>
                    <button
                      type="button"
                      onClick={handleClearFolders}
                      disabled={folderBusy || activeFolderIds.length === 0}
                      className="disabled:opacity-40"
                      style={{
                        fontFamily: "var(--lm-font)",
                        fontSize: "9px",
                        fontWeight: 800,
                        textTransform: "uppercase",
                        letterSpacing: "0.12em",
                        color: "var(--lm-text-muted)",
                      }}
                    >
                      Clear
                    </button>
                  </div>
                  <div className="mt-2">
                    <div
                      className="max-h-36 overflow-y-auto"
                      style={{
                        border: "2px solid var(--lm-border-strong)",
                        backgroundColor: "var(--lm-surface-2)",
                        borderRadius: "var(--lm-radius)",
                      }}
                    >
                      {folders.length === 0 ? (
                        <div
                          className="px-2 py-2"
                          style={{
                            fontFamily: "var(--lm-font)",
                            fontSize: "10px",
                            textTransform: "uppercase",
                            letterSpacing: "0.10em",
                            color: "var(--lm-text-muted)",
                          }}
                        >
                          No collections
                        </div>
                      ) : (
                        folders.map((folder) => (
                          <label
                            key={folder._id}
                            className="flex h-8 cursor-pointer items-center gap-2 px-2"
                            style={{
                              borderBottom:
                                "1px solid var(--lm-border)",
                              fontFamily: "var(--lm-font)",
                              fontSize: "10px",
                              textTransform: "uppercase",
                              letterSpacing: "0.10em",
                              color: "var(--lm-text-secondary)",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={activeFolderIdSet.has(folder._id)}
                              onChange={(event) =>
                                handleFolderToggle(
                                  folder._id,
                                  event.target.checked,
                                )
                              }
                              disabled={folderBusy}
                              className="h-3.5 w-3.5"
                            />
                            <span className="min-w-0 truncate">
                              {folder.name}
                            </span>
                          </label>
                        ))
                      )}
                    </div>
                    {onCreateFolder && (
                      <div className="mt-2 flex items-center gap-1.5">
                        <input
                          value={folderDraftName}
                          onChange={(event) =>
                            setFolderDraftName(event.target.value)
                          }
                          onKeyDown={(event) => {
                            if (event.key !== "Enter") return;
                            event.preventDefault();
                            void handleCreateFolder();
                          }}
                          placeholder="NEW COLLECTION"
                          className="h-8 flex-1 px-2 outline-none"
                          style={{
                            fontFamily: "var(--lm-font)",
                            fontSize: "10px",
                            textTransform: "uppercase",
                            letterSpacing: "0.10em",
                            border:
                              "2px solid var(--lm-border-strong)",
                            backgroundColor: "var(--lm-surface-2)",
                            color: "var(--lm-text-secondary)",
                            borderRadius: "var(--lm-radius)",
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => void handleCreateFolder()}
                          disabled={
                            creatingFolder ||
                            folderDraftName.trim().length === 0
                          }
                          className="h-8 px-3 disabled:opacity-40"
                          style={{
                            fontFamily: "var(--lm-font)",
                            fontSize: "9px",
                            fontWeight: 800,
                            textTransform: "uppercase",
                            letterSpacing: "0.14em",
                            border:
                              "2px solid var(--lm-ink)",
                            backgroundColor: "var(--lm-ink)",
                            color: "var(--lm-paper)",
                            borderRadius: "var(--lm-radius)",
                          }}
                        >
                          {creatingFolder ? "..." : "CREATE"}
                        </button>
                      </div>
                    )}
                    {folderError && (
                      <p
                        className="mt-1"
                        style={{
                          fontSize: "10px",
                          color: "var(--lm-status-error)",
                          fontWeight: 600,
                        }}
                        role="alert"
                      >
                        {folderError}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Curation */}
              {canCuratePublic && onSetPublicState && (
                <div
                  className="py-2.5"
                  style={{
                    borderBottom: "1px solid var(--lm-border)",
                  }}
                >
                  <SectionLabel>Curation</SectionLabel>
                  <div className="mt-1.5 flex flex-col gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        onSetPublicState(
                          image.id,
                          !Boolean(image.isPublic),
                        )
                      }
                      disabled={curationBusy}
                      className="flex items-center gap-2.5 px-3 py-2.5 transition-colors disabled:opacity-40"
                      style={{
                        border: `2px solid ${image.isPublic ? "var(--lm-success)" : "var(--lm-border-strong)"}`,
                        backgroundColor: image.isPublic
                          ? "var(--lm-success-dim)"
                          : "transparent",
                        color: image.isPublic
                          ? "var(--lm-success)"
                          : "var(--lm-text-secondary)",
                        fontSize: "10px",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.14em",
                        borderRadius: "var(--lm-radius)",
                      }}
                    >
                      <span
                        style={{
                          width: "8px",
                          height: "8px",
                          backgroundColor: image.isPublic
                            ? "var(--lm-success)"
                            : "var(--lm-text-ghost)",
                          borderRadius: "var(--lm-radius)",
                        }}
                      />
                      {curationBusy
                        ? "SAVING..."
                        : image.isPublic
                          ? "REMOVE FROM PUBLIC"
                          : "PUBLISH TO PUBLIC"}
                    </button>
                    {onSetFeaturedState && (
                      <button
                        type="button"
                        onClick={() =>
                          onSetFeaturedState(
                            image.id,
                            !Boolean(image.isFeatured),
                          )
                        }
                        disabled={
                          curationBusy || !image.isPublic
                        }
                        className="flex items-center gap-2.5 px-3 py-2.5 transition-colors disabled:opacity-40"
                        style={{
                          border: `2px solid ${image.isFeatured && image.isPublic ? "var(--lm-coral)" : "var(--lm-border-strong)"}`,
                          backgroundColor:
                            image.isFeatured && image.isPublic
                              ? "var(--lm-accent-dim)"
                              : "transparent",
                          color:
                            image.isFeatured && image.isPublic
                              ? "var(--lm-coral)"
                              : "var(--lm-text-secondary)",
                          fontSize: "10px",
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: "0.14em",
                          borderRadius: "var(--lm-radius)",
                        }}
                      >
                        <span
                          style={{
                            width: "8px",
                            height: "8px",
                            backgroundColor:
                              image.isFeatured && image.isPublic
                                ? "var(--lm-coral)"
                                : "var(--lm-text-ghost)",
                            borderRadius: "var(--lm-radius)",
                          }}
                        />
                        {curationBusy
                          ? "SAVING..."
                          : image.isFeatured
                            ? "UNSET FEATURED"
                            : "SET AS FEATURED"}
                      </button>
                    )}
                    {curationError && (
                      <p
                        style={{
                          fontSize: "10px",
                          color: "var(--lm-status-error)",
                          fontWeight: 600,
                        }}
                        role="alert"
                      >
                        {curationError}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Delete */}
              {onDelete && (
                <div className="py-3">
                  <button
                    type="button"
                    onClick={() => onDelete(image.id)}
                    disabled={deleting}
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 transition-colors disabled:opacity-40"
                    aria-label="Delete asset"
                    style={{
                      border: "3px solid var(--lm-status-error)",
                      backgroundColor: "rgba(220, 38, 38, 0.08)",
                      color: "var(--lm-status-error)",
                      fontSize: "10px",
                      fontWeight: 800,
                      textTransform: "uppercase",
                      letterSpacing: "0.14em",
                      borderRadius: "var(--lm-radius)",
                      boxShadow: "var(--lm-shadow-sm)",
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {deleting ? "DELETING..." : "DELETE ASSET"}
                  </button>
                  {deleteError && (
                    <p
                      className="mt-1"
                      style={{
                        fontSize: "10px",
                        color: "var(--lm-status-error)",
                        fontWeight: 600,
                      }}
                      role="alert"
                    >
                      {deleteError}
                    </p>
                  )}
                </div>
              )}

              {/* If no manage options */}
              {!canManageFolder &&
                !canEditCurrentAsset &&
                !(canCuratePublic && onSetPublicState) &&
                !onDelete && (
                  <div className="py-6 text-center">
                    <span
                      style={{
                        fontSize: "10px",
                        textTransform: "uppercase",
                        letterSpacing: "0.14em",
                        color: "var(--lm-text-ghost)",
                        fontWeight: 600,
                      }}
                    >
                      NO MANAGEMENT OPTIONS AVAILABLE
                    </span>
                  </div>
                )}
            </div>
          )}
        </div>
        </div>
      </div>

      {/* Inline toast fallback — hidden when CoralToast is available */}
      {!toastFn && toastVisible && (
        <div
          className={`pointer-events-none absolute inset-x-4 bottom-4 z-10 flex items-center justify-center ${toastExiting ? "animate-toast-exit-v7" : "animate-toast-enter-v7"}`}
        >
          <div
            className="flex items-center gap-2.5 px-4 py-2.5"
            style={{
              backgroundColor: "var(--lm-ink)",
              border: "3px solid var(--lm-coral)",
              color: "var(--lm-paper)",
              fontSize: "11px",
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: "0.14em",
              boxShadow: "var(--lm-shadow-accent)",
              borderRadius: "var(--lm-radius)",
            }}
          >
            <Check
              className="h-3.5 w-3.5"
              style={{ color: "var(--lm-coral)" }}
            />
            {copiedLabel}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Section Label ── */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: "10px",
        fontWeight: 700,
        letterSpacing: "0.04em",
        color: "var(--lm-text-ghost)",
        textTransform: "uppercase",
      }}
    >
      {children}
    </span>
  );
}

function AdminEditInput({
  label,
  value,
  onChange,
  listId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  listId?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span
        style={{
          fontSize: "9px",
          fontWeight: 800,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--lm-text-ghost)",
        }}
      >
        {label}
      </span>
      <input
        value={value}
        list={listId}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-full px-2 outline-none"
        style={{
          fontFamily: "var(--lm-font)",
          fontSize: "11px",
          border: "2px solid var(--lm-border-strong)",
          backgroundColor: "var(--lm-surface-2)",
          color: "var(--lm-text-secondary)",
          borderRadius: "var(--lm-radius)",
        }}
      />
    </label>
  );
}

function AdminEditSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span
        style={{
          fontSize: "9px",
          fontWeight: 800,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--lm-text-ghost)",
        }}
      >
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-full px-2 outline-none"
        style={{
          fontFamily: "var(--lm-font)",
          fontSize: "11px",
          border: "2px solid var(--lm-border-strong)",
          backgroundColor: "var(--lm-surface-2)",
          color: "var(--lm-text-secondary)",
          borderRadius: "var(--lm-radius)",
        }}
      >
        {options.map((option) => (
          <option key={option.value || "__unset"} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function AdminEditTextarea({
  label,
  value,
  onChange,
  minRows,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  minRows: number;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span
        style={{
          fontSize: "9px",
          fontWeight: 800,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--lm-text-ghost)",
        }}
      >
        {label}
      </span>
      <textarea
        value={value}
        rows={minRows}
        onChange={(event) => onChange(event.target.value)}
        className="w-full resize-y px-2 py-2 outline-none"
        style={{
          minHeight: `${minRows * 24}px`,
          fontFamily: "var(--lm-font)",
          fontSize: "11px",
          lineHeight: 1.45,
          border: "2px solid var(--lm-border-strong)",
          backgroundColor: "var(--lm-surface-2)",
          color: "var(--lm-text-secondary)",
          borderRadius: "var(--lm-radius)",
        }}
      />
    </label>
  );
}

/* ── Copy Menu Item ── */

function CopyMenuItem({
  icon: Icon,
  label,
  primary,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-white/5"
      style={{
        color: primary ? "var(--lm-coral)" : "var(--lm-text-secondary)",
        fontWeight: primary ? 600 : 400,
        fontSize: "12px",
      }}
    >
      <Icon
        className="h-3.5 w-3.5"
        style={{
          color: primary ? "var(--lm-coral)" : "var(--lm-text-tertiary)",
        }}
      />
      <span className="flex-1">{label}</span>
    </button>
  );
}
