"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { AppSidebar } from "./app-sidebar";
import { TopFilterBar, type SortOrder } from "./top-filter-bar";
import { MasonryGrid } from "./masonry-grid";
import { ImageModal } from "./image-modal";
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
  user?: { email?: string | null; firstName?: string | null } | null;
  onSignOut?: () => void;
}

export function GalleryDashboard({ user, onSignOut }: GalleryDashboardProps) {
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
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
    kind: "image",
    tagIds: selectedTagIds,
    folderId: selectedFolderId
      ? (selectedFolderId as Id<"folders">)
      : undefined,
    limit: 120,
  });

  // Separate unfiltered query for sidebar "Recent" section
  const recentAssets = useQuery(api.assets.listGalleryAssets, {
    kind: "image",
    limit: 6,
  });

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
      style={{ backgroundColor: "var(--surface-0)" }}
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
          sortOrder={sortOrder}
          onSortOrderChange={setSortOrder}
        />

        {/* ── Gallery grid ── */}
        <main className="relative">
          {/* Ambient glow behind grid */}
          <div
            className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2"
            style={{
              width: "60%",
              height: "300px",
              background: "radial-gradient(ellipse at center, rgba(230, 255, 42, 0.04) 0%, transparent 70%)",
              filter: "blur(60px)",
            }}
          />

          {hasImages ? (
            <MasonryGrid
              images={images}
              onImageSelect={setSelectedImage}
              onImageLoad={markImageLoaded}
            />
          ) : (
            <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6">
              <div
                className="flex h-14 w-14 items-center justify-center rounded-2xl animate-float-gentle"
                style={{
                  backgroundColor: "var(--surface-2)",
                  border: "1px solid var(--border-subtle)",
                  boxShadow: "0 0 24px rgba(230, 255, 42, 0.06)",
                }}
              >
                <Plus className="h-6 w-6" style={{ color: "var(--lime-8)" }} />
              </div>
              <h2
                className="font-display text-[36px] font-normal tracking-tight italic"
                style={{ color: "var(--text-primary)", letterSpacing: "-0.02em" }}
              >
                Start your collection
              </h2>
              <p
                className="max-w-[360px] text-center text-[14px]"
                style={{ color: "var(--text-tertiary)", lineHeight: "1.6" }}
              >
                Add your first reference image to begin building your creative library.
              </p>
              <button
                type="button"
                onClick={() => setUploadOpen(true)}
                className="mt-3 rounded-full px-6 py-2.5 text-[13px] font-semibold transition-all hover:brightness-90 active:scale-95"
                style={{
                  backgroundColor: "var(--lime-9)",
                  color: "var(--lime-contrast)",
                  boxShadow: "0 4px 20px rgba(230, 255, 42, 0.25)",
                  transitionDuration: "var(--duration-fast)",
                }}
              >
                Add image
              </button>
            </div>
          )}
        </main>
      </div>

      {/* ── Floating add (desktop only) ── */}
      <button
        type="button"
        onClick={() => setUploadOpen(true)}
        className="animate-glow-pulse fixed bottom-6 right-6 z-40 hidden h-12 w-12 items-center justify-center rounded-full transition-transform hover:scale-110 active:scale-95 md:flex"
        style={{
          backgroundColor: "var(--lime-9)",
          color: "var(--lime-contrast)",
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

      <ImageModal
        key={selectedImage?.fullSrc ?? "empty"}
        open={Boolean(selectedImage)}
        image={selectedImage}
        onClose={() => setSelectedImage(null)}
        onAction={(intent, imageId) => {
          void runAction(intent, imageId);
        }}
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
