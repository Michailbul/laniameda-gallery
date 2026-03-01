"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { Plus, Search as SearchIcon } from "lucide-react";
import { AppSidebar } from "./app-sidebar";
import {
  TopFilterBar,
  type Pillar,
  type SortOrder,
} from "./top-filter-bar";
import { MasonryGrid } from "./masonry-grid";
import { ExpandedDetail } from "./expanded-detail";
import { UploadModal } from "./upload-modal";
import { AiWorkspacePanel } from "./ai-workspace-panel";
import { MobileBottomNav } from "./mobile-bottom-nav";
import { useSwipeGesture } from "@/lib/use-swipe-gesture";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

const INTENT_LABELS = {
  transfer_style: "Transfer Style",
  transfer_pose: "Transfer Pose",
  replace_character: "Replace Character",
} as const;

type SelectedImage = {
  id: string;
  thumbSrc: string;
  fullSrc: string;
  prompt: string;
  width?: number;
  height?: number;
  modelName?: string;
  pillar?: string;
  tagNames?: string[];
  sourceUrl?: string;
  createdAt?: number;
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
  user?: { id?: string | null; email?: string | null; firstName?: string | null } | null;
  onSignOut?: () => void;
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

export function GalleryDashboard({
  user,
  onSignOut,
}: GalleryDashboardProps) {
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedPillar, setSelectedPillar] = useState<Pillar | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedModelName, setSelectedModelName] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("laniameda-sidebar-collapsed") === "true";
  });

  const [selectedImage, setSelectedImage] = useState<SelectedImage | null>(null);
  const [sheetDismissing, setSheetDismissing] = useState(false);
  const [sheetDragY, setSheetDragY] = useState(0);
  const mobileDetailRef = useRef<HTMLDivElement>(null);
  const [isUploadOpen, setUploadOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceRunId, setWorkspaceRunId] = useState<string>();
  const [workspaceActionLabel, setWorkspaceActionLabel] = useState("Prompt Package");
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceContent, setWorkspaceContent] = useState("");
  const [workspaceError, setWorkspaceError] = useState<string>();

  // Persist sidebar state
  useEffect(() => {
    localStorage.setItem("laniameda-sidebar-collapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  const closeSelectedImage = useCallback(() => {
    const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
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

  // ── Image navigation ──
  const tags = useQuery(api.tags.listTags, {});
  const folders = useQuery(api.folders.listFolders, {});

  const dedupedTags = useMemo(() => {
    const groups = new Map<
      string,
      {
        _id: string;
        name: string;
        usageCount: number;
        sourceIds: Id<"tags">[];
        primaryCount: number;
      }
    >();

    for (const tag of tags ?? []) {
      const key = canonicalTagKey(tag.name) || tag._id;
      const usage = tag.usageCount ?? 0;
      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, {
          _id: key,
          name: tag.name,
          usageCount: usage,
          sourceIds: [tag._id],
          primaryCount: usage,
        });
        continue;
      }

      existing.usageCount += usage;
      existing.sourceIds.push(tag._id);
      if (usage > existing.primaryCount) {
        existing.primaryCount = usage;
        existing.name = tag.name;
      }
    }

    return Array.from(groups.values())
      .map(({ primaryCount: _primaryCount, ...tag }) => tag)
      .sort((a, b) => {
        const usageDiff = b.usageCount - a.usageCount;
        if (usageDiff !== 0) return usageDiff;
        return a.name.localeCompare(b.name);
      });
  }, [tags]);

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

  const galleryAssets = useQuery(api.assets.listGalleryAssets, {
    ownerUserId: user?.id || "__guest__",
    kind: "image",
    tagIds: selectedTagIds,
    pillar: selectedPillar ?? undefined,
    folderId: selectedFolderId
      ? (selectedFolderId as Id<"folders">)
      : undefined,
    modelName: selectedModelName ?? undefined,
    limit: 120,
  });

  const allAssets = useQuery(api.assets.listGalleryAssets, {
    ownerUserId: user?.id || "__guest__",
    limit: 200,
  });

  const imageCount = allAssets?.length;

  const modelTags = useMemo(() => {
    const grouped = new Map<string, { name: string; usageCount: number }>();
    for (const asset of allAssets ?? []) {
      if (!asset.modelName) continue;
      const key = asset.modelName.trim().toLowerCase();
      if (!key) continue;
      const existing = grouped.get(key);
      if (!existing) {
        grouped.set(key, { name: asset.modelName, usageCount: 1 });
        continue;
      }
      existing.usageCount += 1;
    }
    return Array.from(grouped.values()).sort((a, b) => {
      const usageDiff = b.usageCount - a.usageCount;
      if (usageDiff !== 0) return usageDiff;
      return a.name.localeCompare(b.name);
    });
  }, [allAssets]);

  const availableModelNames = useMemo(() => {
    return modelTags.map((entry) => entry.name);
  }, [modelTags]);

  const [loadedImageIds, setLoadedImageIds] = useState(() => new Set<string>());
  const markImageLoaded = useCallback((assetId: string) => {
    setLoadedImageIds((previous) => {
      if (previous.has(assetId)) return previous;
      const next = new Set(previous);
      next.add(assetId);
      return next;
    });
  }, []);

  const handleTagToggle = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  const handleClearAll = () => setSelectedTags([]);
  const handleClearFilters = () => {
    setSelectedTags([]);
    setSelectedPillar(null);
    setSelectedFolderId(null);
    setSelectedModelName(null);
  };

  const allTags = dedupedTags;

  const images = useMemo(() => {
    if (!galleryAssets) return [];
    return galleryAssets.map((asset) => ({
      id: asset._id,
      src: asset.thumbUrl ?? asset.url ?? asset.sourceUrl ?? "/placeholder.svg",
      fullSrc: asset.url ?? asset.sourceUrl ?? "/placeholder.svg",
      prompt: asset.promptText ?? asset.fileName ?? "Untitled prompt",
      author: "Agent",
      likes: 0,
      width: asset.thumbWidth ?? asset.width ?? undefined,
      height: asset.thumbHeight ?? asset.height ?? undefined,
      modelName: asset.modelName ?? undefined,
      pillar: asset.pillar ?? undefined,
      tagNames: asset.tagNames ?? [],
      sourceUrl: asset.sourceUrl ?? undefined,
      createdAt: asset.createdAt,
      initiallyLoaded: loadedImageIds.has(asset._id),
    }));
  }, [galleryAssets, loadedImageIds]);

  // Navigation helpers
  const currentImageIndex = useMemo(() => {
    if (!selectedImage) return -1;
    return images.findIndex((img) => img.id === selectedImage.id);
  }, [images, selectedImage]);

  const canGoPrev = currentImageIndex > 0;
  const canGoNext = currentImageIndex >= 0 && currentImageIndex < images.length - 1;

  const goToPrev = useCallback(() => {
    if (!canGoPrev) return;
    const prev = images[currentImageIndex - 1];
    setSelectedImage({
      id: prev.id,
      thumbSrc: prev.src,
      fullSrc: prev.fullSrc,
      prompt: prev.prompt,
      width: prev.width,
      height: prev.height,
      modelName: prev.modelName,
      pillar: prev.pillar,
      tagNames: prev.tagNames,
      sourceUrl: prev.sourceUrl,
      createdAt: prev.createdAt,
    });
  }, [canGoPrev, currentImageIndex, images]);

  const goToNext = useCallback(() => {
    if (!canGoNext) return;
    const next = images[currentImageIndex + 1];
    setSelectedImage({
      id: next.id,
      thumbSrc: next.src,
      fullSrc: next.fullSrc,
      prompt: next.prompt,
      width: next.width,
      height: next.height,
      modelName: next.modelName,
      pillar: next.pillar,
      tagNames: next.tagNames,
      sourceUrl: next.sourceUrl,
      createdAt: next.createdAt,
    });
  }, [canGoNext, currentImageIndex, images]);

  const imagePosition =
    currentImageIndex >= 0 ? `${currentImageIndex + 1}/${images.length}` : undefined;

  // Swipe gestures for mobile detail sheet
  const swipeHandlers = useMemo(() => ({
    onSwipeLeft: goToNext,
    onSwipeRight: goToPrev,
    onSwipeDown: closeSelectedImage,
    onDrag: (_dx: number, dy: number) => {
      if (dy > 0) setSheetDragY(dy);
    },
    onDragCancel: () => setSheetDragY(0),
  }), [goToNext, goToPrev, closeSelectedImage]);
  useSwipeGesture(mobileDetailRef, swipeHandlers);

  // Keyboard: Escape, ArrowLeft/Right for image navigation
  useEffect(() => {
    if (!selectedImage || typeof window === "undefined") return;

    const isMobile = window.matchMedia("(max-width: 767px)").matches;
    const previousOverflow = document.body.style.overflow;
    if (isMobile) {
      document.body.style.overflow = "hidden";
      window.setTimeout(() => {
        const container = mobileDetailRef.current;
        if (!container) return;
        const firstFocusable = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
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
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement as HTMLElement | null;
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
  }, [closeSelectedImage, selectedImage, goToPrev, goToNext]);

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
          const payload = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(payload?.error || "Failed to start AI run.");
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
            const line = buffer.slice(0, delimiterIndex).trim();
            buffer = buffer.slice(delimiterIndex + 1);
            if (line) {
              const event = JSON.parse(line) as {
                type: "run_start" | "partial" | "done" | "error" | "canceled";
                runId?: string;
                partial?: unknown;
                output?: unknown;
                error?: string;
                message?: string;
              };
              if (event.runId) setWorkspaceRunId(event.runId);
              if (event.type === "partial" && event.partial)
                setWorkspaceContent(JSON.stringify(event.partial, null, 2));
              if (event.type === "done" && event.output)
                setWorkspaceContent(JSON.stringify(event.output, null, 2));
              if (event.type === "done") setWorkspaceLoading(false);
              if (event.type === "error") {
                setWorkspaceError(event.error || "Run failed.");
                setWorkspaceLoading(false);
              }
              if (event.type === "canceled") {
                setWorkspaceError(event.message || "Run canceled.");
                setWorkspaceLoading(false);
              }
            }
            delimiterIndex = buffer.indexOf("\n");
          }
        }
        setWorkspaceLoading(false);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown run error.";
        setWorkspaceError(message);
        setWorkspaceLoading(false);
      }
    },
    [],
  );

  // Distinguish loading / empty / no-matches / has-images
  const isLoading = galleryAssets === undefined;
  const hasFilters =
    selectedTags.length > 0 ||
    selectedPillar !== null ||
    selectedFolderId !== null ||
    selectedModelName !== null;
  const hasImages = images.length > 0;
  const isNoMatches = !isLoading && !hasImages && hasFilters;

  const contentMarginLeft = sidebarCollapsed
    ? "var(--sidebar-collapsed-width)"
    : "var(--sidebar-width)";

  const expandedDetailProps = {
    onClose: closeSelectedImage,
    onAction: (intent: "transfer_style" | "transfer_pose" | "replace_character", imageId: string) => {
      void runAction(intent, imageId, selectedImage?.prompt);
    },
    activeRunId: workspaceRunId,
    onOpenRun: () => setWorkspaceOpen(true),
    onPrev: goToPrev,
    onNext: goToNext,
    canGoPrev,
    canGoNext,
    imagePosition,
  };

  return (
    <div
      className="min-h-screen"
      data-pillar={selectedPillar ?? "creators"}
      style={{ backgroundColor: "var(--surface-0)" }}
    >
      {/* Skip link for keyboard/screen reader users */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-[var(--coral)] focus:px-4 focus:py-2 focus:text-[13px] focus:font-medium focus:text-white"
      >
        Skip to gallery
      </a>

      {/* ── Sidebar (desktop only) ── */}
      <div className="hidden md:block">
        <AppSidebar
          modelTags={modelTags}
          selectedModelName={selectedModelName}
          onModelSelect={setSelectedModelName}
          collapsed={sidebarCollapsed}
          onCollapsedChange={setSidebarCollapsed}
          onUploadClick={() => setUploadOpen(true)}
          user={user}
          onSignOut={onSignOut}
          imageCount={imageCount}
        />
      </div>

      {/* ── Main content area (offset by sidebar) ── */}
      <div
        className="flex min-h-screen flex-col md-sidebar-offset"
        style={{
          marginLeft: contentMarginLeft,
          transition: `margin-left var(--duration-normal) cubic-bezier(0.16, 1, 0.3, 1)`,
        }}
      >
        {/* ── Top Filter Bar ── */}
        <TopFilterBar
          tags={allTags}
          selectedTags={selectedTags}
          onTagToggle={handleTagToggle}
          onClearAllTags={handleClearAll}
          folders={folders ?? []}
          selectedFolderId={selectedFolderId}
          onFolderSelect={setSelectedFolderId}
          selectedPillar={selectedPillar}
          onPillarSelect={setSelectedPillar}
          availableModelNames={availableModelNames}
          selectedModelName={selectedModelName}
          onModelNameSelect={setSelectedModelName}
          sortOrder={sortOrder}
          onSortOrderChange={setSortOrder}
        />

        <div className="flex min-h-0 flex-1">
          <main id="main-content" className="relative flex-1 min-w-0 overflow-y-auto">
            {isLoading ? (
              <MasonryGrid
                images={[]}
                loading
                compactColumns={false}
                onImageSelect={setSelectedImage}
                onImageLoad={markImageLoaded}
              />
            ) : hasImages ? (
              <MasonryGrid
                images={images}
                compactColumns={Boolean(selectedImage)}
                selectedImageId={selectedImage?.id}
                onImageSelect={setSelectedImage}
                onImageLoad={markImageLoaded}
              />
            ) : isNoMatches ? (
              <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 animate-fade-in" aria-live="polite">
                <SearchIcon className="h-10 w-10" style={{ color: "var(--text-ghost)" }} />
                <h2
                  className="font-display text-[32px] font-normal tracking-tight italic"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Nothing here yet
                </h2>
                <p
                  className="max-w-[340px] text-center text-[14px]"
                  style={{ color: "var(--text-ghost)", lineHeight: "1.7" }}
                >
                  Try adjusting your filters or search terms.
                </p>
                {/* Active filter summary */}
                <div className="flex flex-wrap items-center justify-center gap-1.5 font-mono text-[9px] uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>
                  <span>Active filters:</span>
                  {selectedPillar && (
                    <span className="border px-2 py-0.5" style={{ borderColor: "var(--border-default)" }}>
                      {selectedPillar}
                    </span>
                  )}
                  {selectedFolderId && (
                    <span className="border px-2 py-0.5" style={{ borderColor: "var(--border-default)" }}>
                      Folder
                    </span>
                  )}
                  {selectedModelName && (
                    <span className="border px-2 py-0.5" style={{ borderColor: "var(--border-default)" }}>
                      {selectedModelName}
                    </span>
                  )}
                  {selectedTags.length > 0 && (
                    <span className="border px-2 py-0.5" style={{ borderColor: "var(--border-default)" }}>
                      {selectedTags.length} tag{selectedTags.length > 1 ? "s" : ""}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleClearFilters}
                  className="btn-brutal-outline mt-1"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-6 animate-fade-in">
                {/* Stacked image frames illustration */}
                <div className="relative h-20 w-20">
                  <div
                    className="absolute inset-2 rounded-lg rotate-[-6deg]"
                    style={{
                      border: "1px solid var(--border-default)",
                      backgroundColor: "var(--surface-1)",
                    }}
                  />
                  <div
                    className="absolute inset-1 rounded-lg rotate-[3deg]"
                    style={{
                      border: "1px solid var(--border-default)",
                      backgroundColor: "var(--surface-2)",
                    }}
                  />
                  <div
                    className="absolute inset-0 flex items-center justify-center rounded-lg"
                    style={{
                      border: "1px solid var(--border-default)",
                      backgroundColor: "var(--paper-muted)",
                    }}
                  >
                    <Plus className="h-6 w-6" style={{ color: "var(--text-ghost)" }} />
                  </div>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <h2
                    className="font-display text-[48px] font-normal tracking-tight italic"
                    style={{
                      color: "var(--text-primary)",
                      letterSpacing: "-0.03em",
                    }}
                  >
                    Start your collection
                  </h2>
                  <p
                    className="max-w-[380px] text-center text-[14px]"
                    style={{ color: "var(--text-tertiary)", lineHeight: "1.7" }}
                  >
                    Add your first reference image to begin building your creative library.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setUploadOpen(true)}
                  className="btn-brutal mt-2"
                >
                  <Plus className="h-4 w-4" />
                  Add image
                </button>
              </div>
            )}
          </main>

          {selectedImage && (
            <aside
              className="hidden w-[380px] shrink-0 overflow-y-auto md:block"
              style={{
                transition:
                  "width var(--duration-normal) ease-out, opacity var(--duration-normal) ease-out",
              }}
            >
              <ExpandedDetail
                image={selectedImage}
                {...expandedDetailProps}
              />
            </aside>
          )}
        </div>
      </div>

      {selectedImage && (
        <div
          className="fixed inset-0 z-[65] md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Selected image details"
        >
          <div
            className={`absolute inset-0 bg-black/55 backdrop-blur-sm ${sheetDismissing ? "animate-fade-out" : "animate-fade-in"}`}
            onClick={closeSelectedImage}
            aria-hidden="true"
          />
          <div
            ref={mobileDetailRef}
            tabIndex={-1}
            className={`absolute inset-x-0 bottom-0 h-[88dvh] rounded-t-3xl border-t ${sheetDismissing ? "animate-sheet-slide-down" : "animate-sheet-slide-up"}`}
            style={{
              background: "linear-gradient(180deg, rgba(17,10,6,0.98) 0%, rgba(8,4,2,0.99) 100%)",
              borderColor: "var(--border-subtle)",
              transform: sheetDragY > 0 ? `translateY(${sheetDragY}px)` : undefined,
              transition: sheetDragY > 0 ? "none" : undefined,
              paddingBottom: "env(safe-area-inset-bottom)",
            }}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div
                className="h-1 w-10 rounded-full"
                style={{ backgroundColor: "rgba(255,255,255,0.3)" }}
              />
            </div>
            <div className="h-[calc(100%-20px)] overflow-y-auto">
              <ExpandedDetail
                image={selectedImage}
                {...expandedDetailProps}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Floating add (desktop only) ── */}
      <button
        type="button"
        onClick={() => setUploadOpen(true)}
        className="btn-brutal fixed bottom-6 right-6 z-40 hidden h-13 w-13 items-center justify-center p-0 md:flex"
        aria-label="Add to library"
      >
        <Plus className="h-5 w-5" />
      </button>

      {/* ── Mobile bottom nav ── */}
      {!selectedImage && <MobileBottomNav onAddClick={() => setUploadOpen(true)} />}

      {/* ── Modals ── */}
      <UploadModal
        open={isUploadOpen}
        onClose={() => setUploadOpen(false)}
        availableTags={allTags.map((t) => t.name)}
        folders={folders ?? []}
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
    </div>
  );
}
