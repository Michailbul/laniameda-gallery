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
  Play,
  Star,
} from "lucide-react";
import { useQuery } from "convex/react";
import { PackDeckTabs } from "@/components/gallery/pack-deck";
import { downloadImage } from "@/lib/download-image";
import { meaningfulPrompt } from "@/lib/prompt";
import { useCoralToastSafe } from "@/components/ui/coral-toast";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  PromptSections,
  stripLeadingIndex,
  toPromptSections,
} from "./prompt-sections";

interface CarouselImage {
  id: string;
  thumbSrc: string;
  fullSrc: string;
  /** A still for a video slide — `thumbSrc` can be the video file itself. */
  posterSrc?: string;
  width?: number;
  height?: number;
  prompt?: string;
  promptId?: string;
  kind?: "image" | "video";
  contentType?: string;
}

const padIndex = (n: number) => String(n).padStart(2, "0");

/** One place this asset already lives, as the Manage tab lists it. */
export type AssetMembership = {
  folderId: string;
  label: string;
  /** The parent collection, shown as a quiet prefix. */
  context?: string;
  /** True when this asset is the folder's cover. */
  isCover: boolean;
  /** False hides the × on a row the asset can't be removed from. */
  canRemove: boolean;
};

/** Somewhere this asset could be filed, flattened for one searchable list. */
export type AssetFilingTarget = {
  /** Stable key — the folder id. */
  key: string;
  label: string;
  /** The parent collection, for a folder inside one. */
  context?: string;
  folderId: string;
};

interface GalleryDetailPanelProps {
  image: {
    id: string;
    packId?: string;
    galleryItemId?: string;
    galleryItemType?: "asset" | "pack" | "design" | "workflow" | "storybook" | "collection";
    promptId?: string;
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
  /**
   * The slide on show, when the owner keeps it (the dashboard does, so the
   * keyboard and the live per-file data follow the same slide). Uncontrolled
   * when omitted.
   */
  slideIndex?: number;
  onSlideIndexChange?: (index: number) => void;
  /** Who is looking — scopes the prompt-context read to the owner's rows. */
  ownerUserId?: string;
  /** Opens the workflow document this asset's prompt is a step of. */
  onOpenWorkflow?: (workflowId: string) => void;
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
  slideIndex,
  onSlideIndexChange,
  ownerUserId,
  onOpenWorkflow,
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
  const [internalSlideIndex, setInternalSlideIndex] = useState(0);
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
  // Keyed by slide id, not position: deleting a pack member shifts positions.
  const [fullLoadedMap, setFullLoadedMap] = useState<
    Record<string, boolean>
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
  const isCarousel = allSlides.length > 1;
  const carouselIndex = Math.min(
    Math.max(slideIndex ?? internalSlideIndex, 0),
    allSlides.length - 1,
  );
  const setCarouselIndex = (next: number) => {
    const clamped = Math.min(Math.max(next, 0), allSlides.length - 1);
    if (onSlideIndexChange) {
      onSlideIndexChange(clamped);
    } else {
      setInternalSlideIndex(clamped);
    }
  };
  const currentSlide = allSlides[carouselIndex] ?? allSlides[0];
  const currentFullLoaded = fullLoadedMap[currentSlide.id] ?? false;
  const markFullLoaded = (slideId: string) =>
    setFullLoadedMap((prev) =>
      prev[slideId] ? prev : { ...prev, [slideId]: true },
    );
  // A pack of variations holds more than one prompt; say so, since the
  // prompt below changes with the slide.
  const carouselPromptCount = useMemo(
    () =>
      new Set(allSlides.map((slide) => slide.promptId ?? slide.id)).size,
    [allSlides],
  );

  useEffect(() => {
    setInternalSlideIndex(0);
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

  // The prompt as a module: sections, the files that share it, and the
  // workflow around it. Follows the carousel slide, so a pack's members each
  // resolve their own prompt when they differ.
  const activePromptId = currentSlide.promptId ?? image.promptId;
  const promptContext = useQuery(
    api.prompts.getPromptContext,
    activePromptId && !isDesignView
      ? { id: activePromptId as Id<"prompts">, ownerUserId }
      : "skip",
  );
  const promptSections = useMemo(
    () =>
      promptContext
        ? toPromptSections(promptContext.text, promptContext.promptSections)
        : null,
    [promptContext],
  );

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

  const copySection = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    showToast(label);
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

  const handleReplaceThumbnail = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file || !onReplaceThumbnail) return;
    try {
      await onReplaceThumbnail(currentAssetId, file);
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
  };

  // Downloads the file on show — in a pack, that's the current slide.
  const handleDownload = async () => {
    setDownloadStarted(true);
    await downloadImage(currentSlide.fullSrc, `laniameda-${currentAssetId}`);
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
            Clicking the empty canvas around it closes the view. A pack gets
            arrows at the stage edges and a filmstrip of its frames below. */}
        <div
          className={isModal ? "flex min-h-0 flex-col md:flex-1" : "contents"}
          onClick={isModal ? onClose : undefined}
        >
        <div
          className={
            isModal
              ? `relative flex min-h-0 flex-1 items-center justify-center p-6 ${
                  isCarousel ? "md:px-20 md:pb-3 md:pt-8" : "md:p-10"
                }`
              : "relative"
          }
        >
        {/* Image — boxless: shown in its native aspect ratio, no frame */}
        <div
          key={isCarousel ? currentSlide.id : undefined}
          onClick={isModal ? (event) => event.stopPropagation() : undefined}
          className={`${isModal ? "relative mx-auto overflow-hidden" : "relative overflow-hidden"}${
            isCarousel ? " lm-carousel-slide" : ""
          }`}
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
                  borderBottom: isCarousel ? "none" : "1px solid var(--lm-border)",
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
                currentSlide.posterSrc ??
                (currentSlide.thumbSrc &&
                currentSlide.thumbSrc !== currentSlide.fullSrc
                  ? currentSlide.thumbSrc
                  : undefined)
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
                alt={currentSlide.prompt ?? image.prompt}
                fill
                sizes={isModal ? "(max-width: 768px) 100vw, 60vw" : "440px"}
                className={isModal ? "object-contain" : "object-cover"}
                style={{ borderRadius: 0 }}
                priority
                unoptimized
              />
              <Image
                src={currentSlide.fullSrc}
                alt={currentSlide.prompt ?? image.prompt}
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
                    markFullLoaded(currentSlide.id);
                  }
                }}
                onLoad={(e) => {
                  if (e.currentTarget.naturalWidth > 0) {
                    markFullLoaded(currentSlide.id);
                  }
                }}
                onError={() => markFullLoaded(currentSlide.id)}
                unoptimized
              />
            </>
          )}

          {/* Sidebar: the pack's tabs ride on the image, with small arrows. */}
          {isCarousel && !isModal && (
            <>
              <PackDeckTabs
                count={allSlides.length}
                index={carouselIndex}
                rotating={false}
                durationMs={0}
                onJump={setCarouselIndex}
              />
              <CarouselArrow
                direction="previous"
                compact
                disabled={carouselIndex === 0}
                onClick={() => setCarouselIndex(carouselIndex - 1)}
              />
              <CarouselArrow
                direction="next"
                compact
                disabled={carouselIndex === allSlides.length - 1}
                onClick={() => setCarouselIndex(carouselIndex + 1)}
              />
            </>
          )}
        </div>

        {/* Modal: arrows sit out on the canvas, clear of the image. */}
        {isCarousel && isModal && (
          <>
            <CarouselArrow
              direction="previous"
              disabled={carouselIndex === 0}
              onClick={() => setCarouselIndex(carouselIndex - 1)}
            />
            <CarouselArrow
              direction="next"
              disabled={carouselIndex === allSlides.length - 1}
              onClick={() => setCarouselIndex(carouselIndex + 1)}
            />
          </>
        )}
        </div>

        {isCarousel && (
          <CarouselFilmstrip
            slides={allSlides}
            index={carouselIndex}
            promptCount={carouselPromptCount}
            variant={isModal ? "modal" : "sidebar"}
            onSelect={setCarouselIndex}
          />
        )}
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
                  {/* Prompt — as sections when the prompt row is known, else
                      the flat text. Placeholder fallbacks like "Untitled
                      prompt" stay hidden either way. */}
                  {promptSections ? (
                    <div className="pb-3 pt-2.5 first:pt-0">
                      <PromptSections
                        sections={promptSections}
                        onCopy={copySection}
                        maxBodyHeight={260}
                      />
                    </div>
                  ) : promptForDisplay ? (
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
                  ) : null}

                  {/* Every file generated from this prompt — a still and the
                      cut it came from, the variations of a pack. Clicking one
                      that is in the carousel jumps to it. Left out when the
                      filmstrip above already shows every one of them. */}
                  {promptContext &&
                    promptContext.media.length > 1 &&
                    !promptContext.media.every((file) =>
                      allSlides.some((slide) => slide.id === file.id),
                    ) && (
                    <Field label={`Files with this prompt · ${padIndex(promptContext.media.length)}`}>
                      <div className="flex flex-wrap gap-1.5">
                        {promptContext.media.map((file) => {
                          const slideIndex = allSlides.findIndex(
                            (slide) => slide.id === file.id,
                          );
                          const active = file.id === currentAssetId;
                          return (
                            <button
                              key={file.id}
                              type="button"
                              disabled={slideIndex < 0}
                              onClick={() => {
                                if (slideIndex >= 0) setCarouselIndex(slideIndex);
                              }}
                              title={file.description ?? undefined}
                              className="relative overflow-hidden p-0"
                              style={{
                                width: "48px",
                                height: "48px",
                                borderRadius: "4px",
                                border: active
                                  ? "1.5px solid var(--lm-coral)"
                                  : "1px solid var(--lm-border-subtle)",
                                backgroundColor: "var(--lm-surface-3)",
                                cursor: slideIndex >= 0 ? "pointer" : "default",
                              }}
                            >
                              {file.thumbUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={file.thumbUrl}
                                  alt={file.description ?? ""}
                                  className="h-full w-full object-cover"
                                  loading="lazy"
                                />
                              ) : null}
                              {file.kind === "video" && (
                                <span
                                  className="absolute"
                                  style={{
                                    left: "3px",
                                    bottom: "3px",
                                    padding: "1px 4px",
                                    borderRadius: "3px",
                                    backgroundColor: "rgba(0,0,0,0.7)",
                                    color: "#fff",
                                    fontSize: "8px",
                                    letterSpacing: "0.12em",
                                  }}
                                >
                                  MOV
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </Field>
                  )}

                  {/* The workflow this prompt is a step of, with every
                      sibling step's prompt one tap away — the image prompts
                      that fed a video live right under the video. */}
                  {promptContext?.workflow && (
                    <Field
                      label="Workflow"
                      action={
                        onOpenWorkflow ? (
                          <TextAction
                            label="Open"
                            onClick={() =>
                              onOpenWorkflow(promptContext.workflow!._id)
                            }
                          />
                        ) : undefined
                      }
                    >
                      <p
                        style={{
                          ...bodyStyle,
                          color: "var(--lm-text-primary)",
                          fontWeight: 600,
                        }}
                      >
                        {promptContext.workflow.title}
                      </p>
                      <p
                        style={{
                          fontSize: "11px",
                          color: "var(--lm-text-ghost)",
                          marginTop: "2px",
                        }}
                      >
                        Step {padIndex(promptContext.workflow.stepOrder + 1)} of{" "}
                        {padIndex(promptContext.workflow.stepCount)}
                        {promptContext.workflow.stepLabel
                          ? ` · ${stripLeadingIndex(promptContext.workflow.stepLabel)}`
                          : ""}
                      </p>
                      <div className="mt-2 flex flex-col">
                        {promptContext.workflow.steps.map((step) => {
                          const current = step.promptId === promptContext._id;
                          const label = step.stepLabel?.trim()
                            ? stripLeadingIndex(step.stepLabel)
                            : `Step ${step.stepOrder + 1}`;
                          return (
                            <div
                              key={step.promptId}
                              className="flex items-center gap-2 py-1.5"
                              style={{
                                borderTop: "1px solid var(--lm-border-subtle)",
                              }}
                            >
                              <span
                                style={{
                                  width: "18px",
                                  flexShrink: 0,
                                  fontSize: "10px",
                                  fontWeight: 700,
                                  letterSpacing: "0.08em",
                                  color: current
                                    ? "var(--lm-coral)"
                                    : "var(--lm-text-ghost)",
                                }}
                              >
                                {padIndex(step.stepOrder + 1)}
                              </span>
                              <span
                                className="relative shrink-0 overflow-hidden"
                                style={{
                                  width: "28px",
                                  height: "28px",
                                  borderRadius: "4px",
                                  backgroundColor: "var(--lm-surface-3)",
                                  border: step.coverThumbUrl
                                    ? "none"
                                    : "1px dashed var(--lm-border)",
                                }}
                              >
                                {step.coverThumbUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={step.coverThumbUrl}
                                    alt=""
                                    className="h-full w-full object-cover"
                                    loading="lazy"
                                  />
                                ) : null}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  onOpenWorkflow?.(promptContext.workflow!._id)
                                }
                                className="min-w-0 flex-1 border-none bg-transparent p-0 text-left"
                                style={{
                                  cursor: onOpenWorkflow ? "pointer" : "default",
                                }}
                              >
                                <span
                                  className="block truncate"
                                  style={{
                                    fontSize: "12px",
                                    fontWeight: current ? 650 : 500,
                                    color: current
                                      ? "var(--lm-text-primary)"
                                      : "var(--lm-text-secondary)",
                                  }}
                                >
                                  {label}
                                </span>
                                <span
                                  className="block truncate"
                                  style={{
                                    fontSize: "10.5px",
                                    color: "var(--lm-text-ghost)",
                                  }}
                                >
                                  {[
                                    step.modelName,
                                    step.mediaCount > 1
                                      ? `${step.mediaCount} files`
                                      : undefined,
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </span>
                              </button>
                              <TextAction
                                label="Copy"
                                title={`Copy the ${label} prompt`}
                                onClick={() =>
                                  void copySection(step.finalPrompt, "PROMPT COPIED")
                                }
                              />
                            </div>
                          );
                        })}
                      </div>
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
                    onClick={() => onFindSimilar(currentAssetId)}
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
                                      currentAssetId,
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
                                await onAddToTarget(target, currentAssetId);
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
                              currentAssetId,
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

              {/* ── Promote ── for the curator the star IS featured: it leads
                  every grid here and the featured reel on the taste profile.
                  Public opens the door. */}
              {(onToggleStar || (canCuratePublic && onSetPublicState)) && (
                <Field label="Promote">
                  <div className="flex flex-col">
                    {onToggleStar && (
                      <SwitchRow
                        label={canCuratePublic ? "Featured" : "Highlighted"}
                        hint={
                          canCuratePublic
                            ? "On the taste profile and first in every grid"
                            : "Leads every grid it shows up in"
                        }
                        on={isStarred}
                        onClick={() => onToggleStar(currentAssetId, !isStarred)}
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
                          onSetPublicState(currentAssetId, !image.isPublic)
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
                    onClick={() => onDelete(currentAssetId)}
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

/* ── Carousel: arrows and the filmstrip of a pack's frames ── */

function CarouselArrow({
  direction,
  disabled,
  compact = false,
  onClick,
}: {
  direction: "previous" | "next";
  disabled: boolean;
  /** Over the image (sidebar) rather than out on the canvas (modal). */
  compact?: boolean;
  onClick: () => void;
}) {
  const Icon = direction === "previous" ? ChevronLeft : ChevronRight;
  const size = compact ? 30 : 44;
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      className="lm-carousel-arrow absolute top-1/2 z-20 flex -translate-y-1/2 items-center justify-center rounded-full disabled:pointer-events-none"
      data-compact={compact ? "true" : undefined}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        [direction === "previous" ? "left" : "right"]: compact ? "8px" : "20px",
        opacity: disabled ? (compact ? 0 : 0.22) : 1,
      }}
      aria-label={direction === "previous" ? "Previous in pack" : "Next in pack"}
    >
      <Icon className={compact ? "h-4 w-4" : "h-5 w-5"} strokeWidth={2} />
    </button>
  );
}

function CarouselFilmstrip({
  slides,
  index,
  promptCount,
  variant,
  onSelect,
}: {
  slides: CarouselImage[];
  index: number;
  promptCount: number;
  variant: "modal" | "sidebar";
  onSelect: (index: number) => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const isModal = variant === "modal";
  const thumbHeight = isModal ? 56 : 44;

  // Keep the current frame in view. Scrolls the strip only — scrollIntoView
  // would also drag the sheet around it.
  useEffect(() => {
    const strip = stripRef.current;
    const active = strip?.querySelector<HTMLElement>('[data-active="true"]');
    if (!strip || !active) return;
    const left =
      active.offsetLeft - (strip.clientWidth - active.clientWidth) / 2;
    strip.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [index]);

  return (
    <div
      onClick={(event) => event.stopPropagation()}
      className={isModal ? "shrink-0 px-6 pb-6 pt-2 md:px-10" : "px-3 pb-3 pt-2.5"}
      style={{
        borderBottom: isModal ? "none" : "1px solid var(--lm-border)",
      }}
    >
      <div
        className="flex items-baseline justify-between gap-3 pb-2"
        style={{
          fontSize: "10px",
          fontWeight: 600,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--lm-text-ghost)",
        }}
      >
        <span className="flex items-baseline gap-2">
          <span>Pack</span>
          <span
            style={{
              fontVariantNumeric: "tabular-nums",
              color: "var(--lm-text-primary)",
            }}
          >
            {padIndex(index + 1)}
            <span style={{ color: "var(--lm-text-ghost)" }}>
              {" "}/ {padIndex(slides.length)}
            </span>
          </span>
          {promptCount > 1 && (
            <span style={{ color: "var(--lm-coral)" }}>
              · {promptCount} prompt variations
            </span>
          )}
        </span>
        {isModal && <span>← → to move</span>}
      </div>
      <div
        ref={stripRef}
        className="lm-lightbox-strip relative overflow-x-auto"
        style={{ paddingTop: "3px", paddingBottom: "2px" }}
      >
        <div className="mx-auto flex w-max gap-2">
          {slides.map((slide, slideIndex) => {
            const active = slideIndex === index;
            const aspect =
              slide.width && slide.height ? slide.width / slide.height : 1;
            const width = Math.round(
              Math.min(Math.max(thumbHeight * aspect, thumbHeight * 0.62), thumbHeight * 1.78),
            );
            const isVideo = slide.kind === "video";
            const still = isVideo
              ? slide.posterSrc ??
                (slide.thumbSrc !== slide.fullSrc ? slide.thumbSrc : undefined)
              : slide.thumbSrc;
            return (
              <button
                key={slide.id}
                type="button"
                data-active={active ? "true" : "false"}
                aria-current={active ? "true" : undefined}
                aria-label={`Show ${slideIndex + 1} of ${slides.length}`}
                onClick={() => onSelect(slideIndex)}
                className="relative shrink-0 overflow-hidden p-0"
                style={{
                  width: `${width}px`,
                  height: `${thumbHeight}px`,
                  borderRadius: "6px",
                  cursor: "pointer",
                  backgroundColor: "var(--media-stage-bg)",
                  border: active
                    ? "1.5px solid var(--lm-coral)"
                    : "1.5px solid transparent",
                  boxShadow: active
                    ? "0 6px 18px -6px color-mix(in srgb, var(--lm-coral) 55%, transparent)"
                    : "none",
                  opacity: active ? 1 : 0.5,
                  transform: active ? "translateY(-2px)" : "none",
                  transition:
                    "opacity var(--lm-duration-fast, 150ms), transform var(--lm-duration-fast, 150ms), border-color var(--lm-duration-fast, 150ms)",
                }}
              >
                {still ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={still}
                    alt=""
                    loading="lazy"
                    draggable={false}
                    className="h-full w-full object-cover"
                  />
                ) : null}
                {isVideo && (
                  <span
                    className="absolute inset-0 flex items-center justify-center"
                    aria-hidden
                  >
                    <span
                      className="flex h-5 w-5 items-center justify-center rounded-full"
                      style={{
                        backgroundColor: "rgba(0,0,0,0.6)",
                        color: "#fff",
                      }}
                    >
                      <Play className="ml-px h-2.5 w-2.5" fill="currentColor" />
                    </span>
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
