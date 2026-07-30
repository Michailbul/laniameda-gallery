"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  ArrowRight,
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
  Star,
} from "lucide-react";
import { useQuery } from "convex/react";
import { downloadImage } from "@/lib/download-image";
import { meaningfulPrompt } from "@/lib/prompt";
import { useCoralToastSafe } from "@/components/ui/coral-toast";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

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

/** One place this asset already lives, as the Manage tab lists it. */
export type AssetMembership = {
  folderId: string;
  label: string;
  /** The world a section or beat belongs to, shown as a quiet prefix. */
  context?: string;
  /** True when this asset is the folder's cover. */
  isCover: boolean;
  /** Worlds hold collections rather than assets — no × on those rows. */
  canRemove: boolean;
};

/** Somewhere this asset could be filed, flattened for one searchable list. */
export type AssetFilingTarget = {
  /** Stable key — a folder id, or `world:section` for on-demand pools. */
  key: string;
  label: string;
  context?: string;
  folderId?: string;
  worldId?: string;
  section?: "beats" | "characters" | "locations" | "stills";
};

interface GalleryDetailPanelProps {
  image: {
    id: string;
    packId?: string;
    galleryItemId?: string;
    galleryItemType?: "asset" | "pack" | "design" | "workflow" | "storybook" | "beat" | "collection";
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
  };
  carouselImages?: CarouselImage[];
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  canGoPrev?: boolean;
  canGoNext?: boolean;
  imagePosition?: string;
  onDelete?: (imageId: string) => void;
  deleting?: boolean;
  deleteError?: string;
  /** Owner-only: star this asset and write the note that rides with it. */
  onToggleStar?: (imageId: string, nextStarred: boolean) => void;
  onSaveStarNote?: (imageId: string, note: string) => Promise<void> | void;
  canCuratePublic?: boolean;
  onSetPublicState?: (imageId: string, isPublic: boolean) => void;
  onSetFeaturedState?: (imageId: string, isFeatured: boolean) => void;
  curationBusy?: boolean;
  curationError?: string;
  /** Filing — where the asset lives, and everywhere it could go. */
  canManageFolder?: boolean;
  memberships?: AssetMembership[];
  filingTargets?: AssetFilingTarget[];
  onAddToTarget?: (
    target: AssetFilingTarget,
    imageId: string,
  ) => Promise<void> | void;
  onRemoveMembership?: (
    imageId: string,
    folderId: string,
  ) => Promise<void> | void;
  /** Make this asset the folder's thumbnail (or clear it with `null`). */
  onSetCover?: (
    folderId: string,
    assetId: string | null,
  ) => Promise<void> | void;
  onCreateCollection?: (
    name: string,
    imageId: string,
  ) => Promise<void> | void;
  filingBusy?: boolean;
  filingError?: string;
  onFindSimilar?: (imageId: string) => void;
  similarBusy?: boolean;
  similarActive?: boolean;
  onReplaceThumbnail?: (imageId: string, file: File) => Promise<void>;
  replacingThumbnail?: boolean;
  /** Inline description/tag editing. Owner-auth, no admin mode needed. */
  canEditDetails?: boolean;
  onSaveDescription?: (
    imageId: string,
    description: string,
  ) => Promise<void> | void;
  onSaveTags?: (imageId: string, tagNames: string[]) => Promise<void> | void;
  availableTags?: string[];
  toast?: (title: string, message?: string, type?: "success" | "warning" | "info" | "default") => void;
  /**
   * Layout variant. "sidebar" (default) stacks the media above the details in
   * a single narrow column. "modal" splits into a wide two-pane layout — large
   * media on the left, scrollable details on the right — for the full-screen
   * expanded view.
   */
  variant?: "sidebar" | "modal";
}

const DETAIL_TABS = ["DETAILS", "MANAGE"] as const;
type DetailTab = (typeof DETAIL_TABS)[number];

export function GalleryDetailPanel({
  image,
  carouselImages,
  onClose,
  onPrev,
  onNext,
  canGoPrev,
  canGoNext,
  imagePosition,
  onDelete,
  deleting = false,
  deleteError,
  canCuratePublic = false,
  onToggleStar,
  onSaveStarNote,
  onSetPublicState,
  onSetFeaturedState,
  curationBusy = false,
  curationError,
  canManageFolder = false,
  memberships = [],
  filingTargets = [],
  onAddToTarget,
  onRemoveMembership,
  onSetCover,
  onCreateCollection,
  filingBusy = false,
  filingError,
  onFindSimilar,
  similarBusy = false,
  similarActive = false,
  onReplaceThumbnail,
  replacingThumbnail = false,
  canEditDetails = false,
  onSaveDescription,
  onSaveTags,
  availableTags = [],
  toast: externalToast,
  variant = "sidebar",
}: GalleryDetailPanelProps) {
  const coralCtx = useCoralToastSafe();
  const toastFn = externalToast ?? coralCtx?.toast ?? null;
  const isModal = variant === "modal";
  const { modelName, tagNames } = image;
  const [activeTab, setActiveTab] = useState<DetailTab>("DETAILS");
  const [copied, setCopied] = useState(false);
  const [copiedLabel, setCopiedLabel] = useState("COPIED");
  const [downloadStarted, setDownloadStarted] = useState(false);
  const [copyMenuOpen, setCopyMenuOpen] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastExiting, setToastExiting] = useState(false);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [showLivePreview, setShowLivePreview] = useState(true);
  // null = not editing. Drafts live per field so a blur can't leak into the other.
  const [descDraft, setDescDraft] = useState<string | null>(null);
  const [tagsDraft, setTagsDraft] = useState<string | null>(null);
  const [savingField, setSavingField] = useState<"description" | "tags" | null>(
    null,
  );
  const [starNoteDraft, setStarNoteDraft] = useState("");
  const [savingStarNote, setSavingStarNote] = useState(false);
  const [filingQuery, setFilingQuery] = useState("");
  const [pendingKey, setPendingKey] = useState<string | null>(null);
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
    setActiveTab("DETAILS");
    setShowLivePreview(true);
    setDescDraft(null);
    setTagsDraft(null);
    setFilingQuery("");
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
  const tagDatalistId = `asset-tag-suggestions-${currentAssetId}`;
  const canEditThis = Boolean(canEditDetails && !isDesignView);

  const isStarred = Boolean(image.starredAt);

  // The note draft follows whichever asset is open. Keyed on the stored note
  // too, so a save (or a star toggle from the card) settles the field instead
  // of leaving a stale draft behind.
  useEffect(() => {
    setStarNoteDraft(image.starNote ?? "");
  }, [currentAssetId, image.starNote]);

  const handleSaveStarNote = async () => {
    if (!onSaveStarNote || savingStarNote) return;
    setSavingStarNote(true);
    try {
      await onSaveStarNote(currentAssetId, starNoteDraft);
      toastFn?.("Note saved", undefined, "success");
    } finally {
      setSavingStarNote(false);
    }
  };

  // Both inline fields commit on blur. The draft is read from the event rather
  // than state so React's batching can't hand the save a stale value.
  const commitDescription = async (next: string) => {
    setDescDraft(null);
    if (!onSaveDescription) return;
    if ((image.description ?? "").trim() === next.trim()) return;
    setSavingField("description");
    try {
      await onSaveDescription(currentAssetId, next);
      toastFn?.("Description saved", undefined, "success");
    } finally {
      setSavingField(null);
    }
  };

  const commitTags = async (next: string) => {
    setTagsDraft(null);
    if (!onSaveTags) return;
    const parsed = next
      .split(/[,\n]/)
      .map((tag) => tag.trim())
      .filter(Boolean);
    const current = tagNames ?? [];
    if (parsed.join(" ") === current.join(" ")) return;
    setSavingField("tags");
    try {
      await onSaveTags(currentAssetId, parsed);
      toastFn?.("Tags saved", undefined, "success");
    } finally {
      setSavingField(null);
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

  // One runner for every filing/cover write so exactly one row shows a spinner.
  const runFiling = async (key: string, task: () => Promise<void> | void) => {
    if (pendingKey) return;
    setPendingKey(key);
    try {
      await task();
    } finally {
      setPendingKey(null);
    }
  };

  const memberFolderIds = useMemo(
    () => new Set(memberships.map((entry) => entry.folderId)),
    [memberships],
  );

  const filteredTargets = useMemo(() => {
    const query = filingQuery.trim().toLowerCase();
    return filingTargets
      .filter((target) => !target.folderId || !memberFolderIds.has(target.folderId))
      .filter((target) =>
        query
          ? `${target.context ?? ""} ${target.label}`
              .toLowerCase()
              .includes(query)
          : true,
      )
      .slice(0, query ? 40 : 12);
  }, [filingQuery, filingTargets, memberFolderIds]);

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

  const hasManageOptions =
    canManageFolder ||
    Boolean(onToggleStar) ||
    Boolean(canCuratePublic && onSetPublicState) ||
    Boolean(onDelete);

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
              style={{ backgroundColor: "var(--media-stage-bg)", borderRadius: 0 }}
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
          className="flex flex-wrap items-center gap-2 px-3 py-2"
          style={{
            borderBottom: "1px solid var(--lm-border-subtle)",
          }}
        >
          {relativeDate && (
            <span
              style={{
                fontSize: "10px",
                fontWeight: 500,
                letterSpacing: "0.08em",
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
                className="flex items-center gap-1"
                aria-label={`Copy ${idKind} ID`}
                title={`Copy ${idKind} ID: ${token}`}
                style={{
                  fontSize: "10px",
                  fontFamily: "var(--lm-font-mono, ui-monospace, monospace)",
                  fontWeight: 600,
                  color: "var(--lm-coral)",
                  background: "none",
                  border: "none",
                  padding: 0,
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
              className="flex items-center gap-1"
              aria-label="Copy pack ID"
              title={`Copy pack ID: pack:${image.packId}`}
              style={{
                fontSize: "10px",
                fontFamily: "var(--lm-font-mono, ui-monospace, monospace)",
                fontWeight: 600,
                color: "var(--lm-text-tertiary)",
                background: "none",
                border: "none",
                padding: 0,
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
                    boxShadow: "var(--shadow-lg)",
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
                      backgroundColor: "var(--lm-border)",
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
            borderBottom: "1px solid var(--lm-border-subtle)",
          }}
        >
          {DETAIL_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className="relative flex items-center px-2.5 py-2 transition-colors"
              style={{
                fontSize: "11.5px",
                fontWeight: activeTab === tab ? 650 : 500,
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
                    height: "1.5px",
                    backgroundColor: "var(--lm-coral)",
                    borderRadius: "1px",
                  }}
                />
              )}
            </button>
          ))}
        </div>

        {/* ── Tab Content ── */}
        <div className="px-3 pb-6">
          {activeTab === "DETAILS" && (
            <div className="flex flex-col pt-3">
              {isDesignView && designView ? (
                <>
                  {designView.title && (
                    <Field label="Title">
                      <p style={bodyStyle}>{designView.title}</p>
                    </Field>
                  )}
                  {designView.description && (
                    <Field label="Description">
                      <p style={bodyStyle}>{designView.description}</p>
                    </Field>
                  )}
                  {designView.sourceUrl && (
                    <Field label="Source">
                      <a
                        href={designView.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5"
                        style={{
                          fontSize: "11.5px",
                          color: "var(--lm-coral)",
                          wordBreak: "break-all",
                        }}
                      >
                        <LinkIcon className="h-3 w-3 flex-shrink-0" />
                        {designView.sourceDomain ?? designView.sourceUrl}
                      </a>
                    </Field>
                  )}
                  {designView.userNote && (
                    <Field label="Note">
                      <p style={bodyStyle}>{designView.userNote}</p>
                    </Field>
                  )}
                </>
              ) : (
                <>
                  {/* Prompt — only when a real prompt exists (placeholder
                      fallbacks like "Untitled prompt" are suppressed). */}
                  {promptForDisplay && (
                    <Field
                      label="Prompt"
                      action={
                        <TextAction
                          label="Copy"
                          onClick={() => void handleCopy()}
                        />
                      }
                    >
                      <p
                        style={{
                          ...bodyStyle,
                          whiteSpace: "pre-wrap",
                          maxHeight: "220px",
                          overflowY: "auto",
                        }}
                      >
                        {promptForDisplay}
                      </p>
                    </Field>
                  )}

                  <Field
                    label="Description"
                    action={
                      savingField === "description" ? (
                        <Loader2
                          className="h-3 w-3 animate-spin"
                          style={{ color: "var(--lm-text-ghost)" }}
                        />
                      ) : undefined
                    }
                  >
                    {descDraft !== null ? (
                      <textarea
                        autoFocus
                        rows={3}
                        value={descDraft}
                        onChange={(event) => setDescDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            setDescDraft(null);
                          } else if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            (event.target as HTMLTextAreaElement).blur();
                          }
                        }}
                        onBlur={(event) =>
                          void commitDescription(event.target.value)
                        }
                        placeholder="Describe this piece…"
                        className="w-full resize-y bg-transparent outline-none"
                        style={{
                          ...bodyStyle,
                          borderBottom: "1px solid var(--lm-coral)",
                          caretColor: "var(--lm-coral)",
                        }}
                      />
                    ) : canEditThis ? (
                      <button
                        type="button"
                        onClick={() => setDescDraft(image.description ?? "")}
                        className="block w-full cursor-text border-none bg-transparent p-0 text-left"
                        style={{
                          ...bodyStyle,
                          color: image.description
                            ? "var(--lm-text-secondary)"
                            : "var(--lm-text-ghost)",
                        }}
                      >
                        {image.description || "Add a description…"}
                      </button>
                    ) : image.description ? (
                      <p style={bodyStyle}>{image.description}</p>
                    ) : (
                      <p style={{ ...bodyStyle, color: "var(--lm-text-ghost)" }}>
                        No description
                      </p>
                    )}
                  </Field>
                </>
              )}

              {/* Tags — one editable line, comma separated. */}
              <Field
                label="Tags"
                action={
                  savingField === "tags" ? (
                    <Loader2
                      className="h-3 w-3 animate-spin"
                      style={{ color: "var(--lm-text-ghost)" }}
                    />
                  ) : undefined
                }
              >
                {tagsDraft !== null ? (
                  <>
                    <input
                      autoFocus
                      value={tagsDraft}
                      list={tagDatalistId}
                      onChange={(event) => setTagsDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setTagsDraft(null);
                        } else if (event.key === "Enter") {
                          event.preventDefault();
                          (event.target as HTMLInputElement).blur();
                        }
                      }}
                      onBlur={(event) => void commitTags(event.target.value)}
                      placeholder="noir, cassandra, reference"
                      className="w-full bg-transparent outline-none"
                      style={{
                        ...bodyStyle,
                        borderBottom: "1px solid var(--lm-coral)",
                        caretColor: "var(--lm-coral)",
                      }}
                    />
                    <datalist id={tagDatalistId}>
                      {availableTags.map((tag) => (
                        <option key={tag} value={tag} />
                      ))}
                    </datalist>
                  </>
                ) : canEditThis ? (
                  <button
                    type="button"
                    onClick={() => setTagsDraft((tagNames ?? []).join(", "))}
                    className="block w-full cursor-text border-none bg-transparent p-0 text-left"
                    style={{
                      ...bodyStyle,
                      color: tagNames?.length
                        ? "var(--lm-text-secondary)"
                        : "var(--lm-text-ghost)",
                    }}
                  >
                    {tagNames?.length ? tagNames.join(" · ") : "Add tags…"}
                  </button>
                ) : (
                  <p
                    style={{
                      ...bodyStyle,
                      color: tagNames?.length
                        ? "var(--lm-text-secondary)"
                        : "var(--lm-text-ghost)",
                    }}
                  >
                    {tagNames?.length ? tagNames.join(" · ") : "No tags"}
                  </p>
                )}
              </Field>

              {(modelName || image.sourceUrl) && !isDesignView && (
                <Field label="Origin">
                  <div className="flex flex-col gap-1">
                    {modelName && (
                      <span style={bodyStyle}>{modelName}</span>
                    )}
                    {image.sourceUrl && (
                      <a
                        href={image.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5"
                        style={{
                          fontSize: "11.5px",
                          color: "var(--lm-coral)",
                          wordBreak: "break-all",
                        }}
                      >
                        <LinkIcon className="h-3 w-3 flex-shrink-0" />
                        {image.sourceUrl}
                      </a>
                    )}
                  </div>
                </Field>
              )}

              {onFindSimilar && !isDesignView && (
                <div className="pt-3">
                  <button
                    type="button"
                    onClick={() => onFindSimilar(image.id)}
                    disabled={similarBusy}
                    className="flex w-full items-center gap-2 border-none bg-transparent p-0 disabled:opacity-50"
                    style={{
                      cursor: similarBusy ? "wait" : "pointer",
                      fontSize: "11.5px",
                      fontWeight: 600,
                      color: similarActive
                        ? "var(--lm-coral)"
                        : "var(--lm-text-secondary)",
                    }}
                  >
                    <Search className="h-3.5 w-3.5" />
                    {similarBusy
                      ? "Finding similar…"
                      : similarActive
                        ? "Showing similar"
                        : "Find similar"}
                    <ArrowRight className="h-3 w-3" style={{ opacity: 0.5 }} />
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === "MANAGE" && (
            <div className="flex flex-col pt-3">
              {/* ── Where it lives ── every membership, with the cover pick and
                  a remove on the rows that own assets directly. */}
              {canManageFolder && (
                <Field label="In">
                  {memberships.length === 0 ? (
                    <p style={{ ...bodyStyle, color: "var(--lm-text-ghost)" }}>
                      Not filed anywhere yet.
                    </p>
                  ) : (
                    <div className="flex flex-col">
                      {memberships.map((entry) => {
                        const coverKey = `cover:${entry.folderId}`;
                        const removeKey = `remove:${entry.folderId}`;
                        return (
                          <div
                            key={entry.folderId}
                            className="flex items-center gap-2 py-1.5"
                            style={{
                              borderBottom: "1px solid var(--lm-border-subtle)",
                            }}
                          >
                            <span className="min-w-0 flex-1 truncate">
                              {entry.context && (
                                <span
                                  style={{
                                    fontSize: "11px",
                                    color: "var(--lm-text-ghost)",
                                  }}
                                >
                                  {entry.context}{" "}
                                  <span style={{ opacity: 0.5 }}>/</span>{" "}
                                </span>
                              )}
                              <span
                                style={{
                                  fontSize: "12px",
                                  fontWeight: 550,
                                  color: "var(--lm-text-primary)",
                                }}
                              >
                                {entry.label}
                              </span>
                            </span>
                            {onSetCover && (
                              <TextAction
                                label={
                                  pendingKey === coverKey
                                    ? "…"
                                    : entry.isCover
                                      ? "Cover ✓"
                                      : "Cover"
                                }
                                active={entry.isCover}
                                title={
                                  entry.isCover
                                    ? "This asset is the thumbnail — click to clear it"
                                    : "Use this asset as the thumbnail"
                                }
                                disabled={Boolean(pendingKey)}
                                onClick={() =>
                                  void runFiling(coverKey, () =>
                                    onSetCover(
                                      entry.folderId,
                                      entry.isCover ? null : currentAssetId,
                                    ),
                                  )
                                }
                              />
                            )}
                            {entry.canRemove && onRemoveMembership && (
                              <button
                                type="button"
                                onClick={() =>
                                  void runFiling(removeKey, () =>
                                    onRemoveMembership(
                                      image.id,
                                      entry.folderId,
                                    ),
                                  )
                                }
                                disabled={Boolean(pendingKey)}
                                aria-label={`Remove from ${entry.label}`}
                                title={`Remove from ${entry.label}`}
                                className="flex h-5 w-5 shrink-0 items-center justify-center border-none bg-transparent"
                                style={{
                                  cursor: pendingKey ? "default" : "pointer",
                                  color: "var(--lm-text-ghost)",
                                }}
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Field>
              )}

              {/* ── Add to ── one search over worlds, sections and collections. */}
              {canManageFolder && (onAddToTarget || onCreateCollection) && (
                <Field label="Add to">
                  <input
                    value={filingQuery}
                    onChange={(event) => setFilingQuery(event.target.value)}
                    placeholder="Search worlds and collections…"
                    className="w-full bg-transparent outline-none"
                    style={{
                      ...bodyStyle,
                      paddingBottom: "4px",
                      borderBottom: "1px solid var(--lm-border)",
                      caretColor: "var(--lm-coral)",
                    }}
                  />
                  <div
                    className="mt-1 flex max-h-52 flex-col overflow-y-auto"
                    role="list"
                  >
                    {filteredTargets.map((target) => (
                      <button
                        key={target.key}
                        type="button"
                        role="listitem"
                        onClick={() =>
                          onAddToTarget
                            ? void runFiling(`add:${target.key}`, async () => {
                                await onAddToTarget(target, image.id);
                                setFilingQuery("");
                              })
                            : undefined
                        }
                        disabled={Boolean(pendingKey)}
                        className="flex items-center gap-2 border-none bg-transparent py-1.5 text-left"
                        style={{
                          cursor: pendingKey ? "default" : "pointer",
                          borderBottom: "1px solid var(--lm-border-subtle)",
                        }}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {target.context && (
                            <span
                              style={{
                                fontSize: "11px",
                                color: "var(--lm-text-ghost)",
                              }}
                            >
                              {target.context}{" "}
                              <span style={{ opacity: 0.5 }}>/</span>{" "}
                            </span>
                          )}
                          <span
                            style={{
                              fontSize: "12px",
                              color: "var(--lm-text-secondary)",
                            }}
                          >
                            {target.label}
                          </span>
                        </span>
                        <span
                          style={{
                            fontSize: "11px",
                            color:
                              pendingKey === `add:${target.key}`
                                ? "var(--lm-coral)"
                                : "var(--lm-text-ghost)",
                          }}
                        >
                          {pendingKey === `add:${target.key}` ? "…" : "Add"}
                        </span>
                      </button>
                    ))}
                    {onCreateCollection && filingQuery.trim().length > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          void runFiling("create", async () => {
                            await onCreateCollection(
                              filingQuery.trim(),
                              image.id,
                            );
                            setFilingQuery("");
                          })
                        }
                        disabled={Boolean(pendingKey)}
                        className="flex items-center gap-2 border-none bg-transparent py-1.5 text-left"
                        style={{
                          cursor: pendingKey ? "default" : "pointer",
                          fontSize: "12px",
                          fontWeight: 600,
                          color: "var(--lm-coral)",
                        }}
                      >
                        {pendingKey === "create"
                          ? "Creating…"
                          : `New collection “${filingQuery.trim()}”`}
                      </button>
                    )}
                    {filteredTargets.length === 0 && !onCreateCollection && (
                      <p
                        className="py-1.5"
                        style={{ ...bodyStyle, color: "var(--lm-text-ghost)" }}
                      >
                        Nothing matches.
                      </p>
                    )}
                  </div>
                  {filingError && <ErrorLine>{filingError}</ErrorLine>}
                  {filingBusy && (
                    <p
                      className="pt-1"
                      style={{ fontSize: "11px", color: "var(--lm-text-ghost)" }}
                    >
                      Filing…
                    </p>
                  )}
                </Field>
              )}

              {/* ── Promote ── star leads every grid, public opens the door,
                  featured leads the public home. */}
              {(onToggleStar || (canCuratePublic && onSetPublicState)) && (
                <Field label="Promote">
                  <div className="flex flex-col">
                    {onToggleStar && (
                      <SwitchRow
                        label="Highlighted"
                        hint="Leads every grid it shows up in"
                        on={isStarred}
                        onClick={() => onToggleStar(image.id, !isStarred)}
                        icon={
                          <Star
                            className="h-3.5 w-3.5"
                            strokeWidth={2}
                            fill={isStarred ? "currentColor" : "none"}
                          />
                        }
                      />
                    )}
                    {canCuratePublic && onSetPublicState && (
                      <SwitchRow
                        label="Public"
                        hint="Visible on the taste profile"
                        on={Boolean(image.isPublic)}
                        busy={curationBusy}
                        onClick={() =>
                          onSetPublicState(image.id, !image.isPublic)
                        }
                      />
                    )}
                    {canCuratePublic && onSetFeaturedState && (
                      <SwitchRow
                        label="Featured"
                        hint={
                          image.isPublic
                            ? "Leads the public home"
                            : "Publish it first"
                        }
                        on={Boolean(image.isFeatured && image.isPublic)}
                        busy={curationBusy}
                        disabled={!image.isPublic}
                        onClick={() =>
                          onSetFeaturedState(image.id, !image.isFeatured)
                        }
                      />
                    )}
                  </div>
                  {curationError && <ErrorLine>{curationError}</ErrorLine>}

                  {isStarred && onSaveStarNote && (
                    <div className="mt-2 flex flex-col gap-1.5">
                      <textarea
                        value={starNoteDraft}
                        onChange={(event) =>
                          setStarNoteDraft(event.target.value)
                        }
                        rows={2}
                        maxLength={500}
                        placeholder="Why this one? (optional)"
                        className="w-full resize-y bg-transparent outline-none"
                        style={{
                          ...bodyStyle,
                          borderBottom: "1px solid var(--lm-border)",
                          caretColor: "var(--lm-coral)",
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => void handleSaveStarNote()}
                        disabled={
                          savingStarNote ||
                          starNoteDraft.trim() === (image.starNote ?? "").trim()
                        }
                        className="self-start border-none bg-transparent p-0 disabled:opacity-40"
                        style={{
                          fontSize: "11px",
                          fontWeight: 600,
                          color: "var(--lm-coral)",
                          cursor: "pointer",
                        }}
                      >
                        {savingStarNote ? "Saving…" : "Save note"}
                      </button>
                    </div>
                  )}
                </Field>
              )}

              {onDelete && (
                <div className="pt-4">
                  <button
                    type="button"
                    onClick={() => onDelete(image.id)}
                    disabled={deleting}
                    className="flex items-center gap-2 border-none bg-transparent p-0 disabled:opacity-40"
                    aria-label="Delete asset"
                    style={{
                      cursor: "pointer",
                      fontSize: "11.5px",
                      fontWeight: 600,
                      color: "var(--lm-status-error)",
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {deleting ? "Deleting…" : "Delete asset"}
                  </button>
                  {deleteError && <ErrorLine>{deleteError}</ErrorLine>}
                </div>
              )}

              {!hasManageOptions && (
                <p
                  className="py-6 text-center"
                  style={{ fontSize: "11.5px", color: "var(--lm-text-ghost)" }}
                >
                  Nothing to manage here.
                </p>
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

/* ── Flat building blocks: a label, a hairline, and content. No boxes. ── */

const bodyStyle: React.CSSProperties = {
  fontFamily: "var(--lm-font)",
  fontSize: "12.5px",
  lineHeight: 1.55,
  color: "var(--lm-text-secondary)",
  wordBreak: "break-word",
};

function Field({
  label,
  action,
  children,
}: {
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="pb-3 pt-2.5 first:pt-0">
      <div className="flex items-center justify-between gap-2 pb-1">
        <SectionLabel>{label}</SectionLabel>
        {action}
      </div>
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: "10px",
        fontWeight: 700,
        letterSpacing: "0.14em",
        color: "var(--lm-text-ghost)",
        textTransform: "uppercase",
      }}
    >
      {children}
    </span>
  );
}

function TextAction({
  label,
  onClick,
  active,
  disabled,
  title,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="shrink-0 border-none bg-transparent p-0"
      style={{
        cursor: disabled ? "default" : "pointer",
        fontFamily: "var(--lm-font)",
        fontSize: "11px",
        fontWeight: active ? 700 : 500,
        letterSpacing: "0.04em",
        color: active ? "var(--lm-coral)" : "var(--lm-text-tertiary)",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );
}

/**
 * A promote toggle. The state reads as a word rather than a switch widget —
 * three of these stacked on hairlines say more than three filled pills.
 */
function SwitchRow({
  label,
  hint,
  on,
  onClick,
  busy,
  disabled,
  icon,
}: {
  label: string;
  hint?: string;
  on: boolean;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      aria-pressed={on}
      className="flex w-full items-center gap-2 border-none bg-transparent py-2 text-left"
      style={{
        cursor: disabled ? "default" : "pointer",
        borderBottom: "1px solid var(--lm-border-subtle)",
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <span
        className="flex items-center gap-2"
        style={{ color: on ? "var(--lm-coral)" : "var(--lm-text-tertiary)" }}
      >
        {icon ?? (
          <span
            aria-hidden
            style={{
              width: "7px",
              height: "7px",
              borderRadius: "50%",
              backgroundColor: on ? "var(--lm-coral)" : "transparent",
              border: on ? "none" : "1.5px solid var(--lm-text-ghost)",
              display: "inline-block",
            }}
          />
        )}
        <span
          style={{
            fontSize: "12px",
            fontWeight: on ? 650 : 500,
            color: on ? "var(--lm-coral)" : "var(--lm-text-primary)",
          }}
        >
          {label}
        </span>
      </span>
      {hint && (
        <span
          className="ml-auto truncate"
          style={{ fontSize: "11px", color: "var(--lm-text-ghost)" }}
        >
          {busy ? "Saving…" : hint}
        </span>
      )}
    </button>
  );
}

function ErrorLine({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="pt-1"
      style={{
        fontSize: "11px",
        fontWeight: 600,
        color: "var(--lm-status-error)",
      }}
      role="alert"
    >
      {children}
    </p>
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
      className="flex items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-[var(--lm-surface-3)]"
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
