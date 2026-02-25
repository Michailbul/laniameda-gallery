"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { AppSidebar } from "./app-sidebar";
import { TopFilterBar, type SortOrder } from "./top-filter-bar";
import { MasonryGrid } from "./masonry-grid";
import { ExpandedDetail } from "./expanded-detail";
import { UploadModal } from "./upload-modal";
import { AiWorkspacePanel } from "./ai-workspace-panel";
import { MobileBottomNav } from "./mobile-bottom-nav";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

const INTENT_LABELS = {
  transfer_style: "Transfer Style",
  transfer_pose: "Transfer Pose",
  replace_character: "Replace Character",
} as const;

interface GalleryDashboardProps {
  user?: { id?: string | null; email?: string | null; firstName?: string | null } | null;
  onSignOut?: () => void;
}

export function GalleryDashboard({ user, onSignOut }: GalleryDashboardProps) {
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedPillar, setSelectedPillar] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedModelName, setSelectedModelName] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("laniameda-sidebar-collapsed") === "true";
  });

  const [selectedImage, setSelectedImage] = useState<{
    id: string;
    thumbSrc: string;
    fullSrc: string;
    prompt: string;
    width?: number;
    height?: number;
  } | null>(null);
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

  // Escape key closes expanded detail
  useEffect(() => {
    if (!selectedImage) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedImage(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selectedImage]);

  const tags = useQuery(api.tags.listTags, {});
  const folders = useQuery(api.folders.listFolders, {});

  const selectedTagIds = useMemo(() => {
    if (!tags || selectedTags.length === 0) return undefined;
    const idByName = new Map(tags.map((tag) => [tag.name, tag._id]));
    const ids = selectedTags
      .map((name) => idByName.get(name))
      .filter((id): id is NonNullable<typeof id> => Boolean(id));
    return ids.length > 0 ? ids : undefined;
  }, [selectedTags, tags]);

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

  // Separate unfiltered query for sidebar "Recent" section + model name discovery
  const recentAssets = useQuery(api.assets.listGalleryAssets, {
    ownerUserId: user?.id || "__guest__",
    kind: "image",
    limit: 6,
  });

  // Unfiltered query used to discover available model names
  const allAssets = useQuery(api.assets.listGalleryAssets, {
    ownerUserId: user?.id || "__guest__",
    limit: 200,
  });

  const availableModelNames = useMemo(() => {
    if (!allAssets) return [];
    const names = new Set<string>();
    for (const asset of allAssets) {
      if (asset.modelName) names.add(asset.modelName);
    }
    return Array.from(names).sort();
  }, [allAssets]);

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

  const allTags = useMemo(
    () =>
      tags?.map((tag) => ({
        _id: tag._id,
        name: tag.name,
        usageCount: tag.usageCount,
      })) ?? [],
    [tags],
  );

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
      initiallyLoaded: loadedImageIds.has(asset._id),
      modelName: asset.modelName ?? undefined,
      pillar: asset.pillar ?? undefined,
    }));
  }, [galleryAssets, loadedImageIds]);

  const runAction = useCallback(
    async (intent: keyof typeof INTENT_LABELS, referenceAssetId: string) => {
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
            userInput: { prompt: selectedImage?.prompt },
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
    [selectedImage?.prompt],
  );

  const hasImages = images.length > 0;

  const contentMarginLeft = sidebarCollapsed
    ? "var(--sidebar-collapsed-width)"
    : "var(--sidebar-width)";

  return (
    <div
      className="min-h-screen"
      data-pillar={selectedPillar ?? "creators"}
      style={{ backgroundColor: "var(--surface-0)", transition: "background-color 400ms ease, color 400ms ease" }}
    >
      {/* ── Sidebar (desktop only) ── */}
      <div className="hidden md:block">
        <AppSidebar
          tags={allTags}
          selectedTags={selectedTags}
          onTagToggle={handleTagToggle}
          onClearAll={handleClearAll}
          recentAssets={recentAssets ?? []}
          onRecentAssetClick={(assetId) => {
            const asset = (recentAssets ?? []).find((a) => a._id === assetId);
            if (asset) {
              setSelectedImage({
                id: asset._id,
                thumbSrc: asset.thumbUrl ?? asset.url ?? asset.sourceUrl ?? "",
                fullSrc: asset.url ?? asset.sourceUrl ?? "",
                prompt: asset.promptText ?? asset.fileName ?? "",
                width: asset.width ?? undefined,
                height: asset.height ?? undefined,
              });
            }
          }}
          collapsed={sidebarCollapsed}
          onCollapsedChange={setSidebarCollapsed}
          user={user}
          onSignOut={onSignOut}
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

        {/* ── Gallery + Detail flex row ── */}
        <div className="flex flex-1 min-h-0">
          {/* Gallery grid */}
          <main className="relative grain-overlay flex-1 min-w-0 overflow-y-auto">
            {/* Atmospheric ambient orbs — layered for depth */}
            <div
              className="pointer-events-none absolute animate-ember-drift"
              style={{
                top: "-40px",
                left: "10%",
                width: "45%",
                height: "350px",
                background: "radial-gradient(ellipse at center, rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.07) 0%, transparent 65%)",
                filter: "blur(70px)",
              }}
            />
            <div
              className="pointer-events-none absolute animate-ember-drift"
              style={{
                top: "100px",
                right: "5%",
                width: "35%",
                height: "280px",
                background: "radial-gradient(ellipse at center, rgba(255, 69, 0, 0.05) 0%, transparent 60%)",
                filter: "blur(80px)",
                animationDelay: "-7s",
                animationDuration: "25s",
              }}
            />
            <div
              className="pointer-events-none absolute animate-ember-breathe"
              style={{
                bottom: "0",
                left: "30%",
                width: "50%",
                height: "200px",
                background: "radial-gradient(ellipse at center, rgba(184, 104, 52, 0.06) 0%, transparent 55%)",
                filter: "blur(90px)",
              }}
            />

            {hasImages ? (
              <MasonryGrid
                images={images}
                compactColumns={!!selectedImage}
                selectedImageId={selectedImage?.id}
                onImageSelect={setSelectedImage}
                onImageLoad={markImageLoaded}
              />
            ) : (
              <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-6">
                {/* Glowing icon with gradient border ring */}
                <div
                  className="relative flex h-20 w-20 items-center justify-center rounded-3xl animate-float-gentle"
                  style={{
                    background: "linear-gradient(145deg, var(--surface-2), var(--surface-3))",
                    boxShadow: "0 0 40px rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.1), 0 0 80px rgba(var(--pillar-warm-r), var(--pillar-warm-g), var(--pillar-warm-b), 0.05), inset 0 1px 0 rgba(245, 208, 168, 0.06)",
                  }}
                >
                  {/* Gradient border ring */}
                  <div
                    className="absolute inset-[-1px] rounded-3xl"
                    style={{
                      background: "linear-gradient(135deg, rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.3), rgba(var(--pillar-warm-r), var(--pillar-warm-g), var(--pillar-warm-b), 0.1), rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.2))",
                      mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
                      maskComposite: "exclude",
                      WebkitMaskComposite: "xor",
                      padding: "1px",
                      borderRadius: "inherit",
                    }}
                  />
                  <Plus className="h-7 w-7" style={{ color: "var(--amber-9)" }} />
                </div>
                <div className="flex flex-col items-center gap-2">
                  <h2
                    className="font-display text-[42px] font-normal tracking-tight italic"
                    style={{
                      background: "linear-gradient(135deg, var(--text-primary) 0%, var(--amber-11) 60%, var(--amber-9) 100%)",
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
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
                  className="group mt-1 flex items-center gap-2 rounded-full px-7 py-3 text-[13px] font-semibold transition-all active:scale-95"
                  style={{
                    background: "linear-gradient(135deg, var(--amber-9), var(--warm-accent))",
                    color: "var(--amber-contrast)",
                    boxShadow: "0 4px 24px rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.3), 0 1px 3px rgba(0,0,0,0.3)",
                    transitionDuration: "var(--duration-fast)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.boxShadow = "0 8px 40px rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.4), 0 2px 6px rgba(0,0,0,0.4)";
                    e.currentTarget.style.transform = "translateY(-1px)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.boxShadow = "0 4px 24px rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.3), 0 1px 3px rgba(0,0,0,0.3)";
                    e.currentTarget.style.transform = "translateY(0)";
                  }}
                >
                  <Plus className="h-4 w-4" />
                  Add image
                </button>
              </div>
            )}
          </main>

          {/* Expanded detail — inline right column */}
          {selectedImage && (
            <aside
              className="hidden md:block w-[380px] shrink-0 overflow-y-auto"
              style={{
                transition: "width var(--duration-normal) ease-out, opacity var(--duration-normal) ease-out",
              }}
            >
              <ExpandedDetail
                key={selectedImage.id}
                image={selectedImage}
                onClose={() => setSelectedImage(null)}
                onAction={(intent, imageId) => {
                  void runAction(intent, imageId);
                }}
              />
            </aside>
          )}
        </div>
      </div>

      {/* ── Floating add (desktop only, hidden when detail open) ── */}
      <button
        type="button"
        onClick={() => setUploadOpen(true)}
        className={`animate-glow-pulse fixed bottom-6 right-6 z-40 hidden h-13 w-13 items-center justify-center rounded-full transition-transform hover:scale-110 active:scale-95 ${selectedImage ? "!hidden" : "md:flex"}`}
        style={{
          background: "linear-gradient(135deg, var(--amber-9), var(--warm-accent))",
          color: "var(--amber-contrast)",
          transitionDuration: "var(--duration-fast)",
        }}
        aria-label="Add to library"
      >
        <Plus className="h-5 w-5" />
      </button>

      {/* ── Mobile bottom nav ── */}
      <MobileBottomNav onAddClick={() => setUploadOpen(true)} />

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
