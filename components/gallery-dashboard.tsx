"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { GalleryHeader } from "./gallery-header";
import { MasonryGrid } from "./masonry-grid";
import { FilterSidebar } from "./filter-sidebar";
import { ModeSwitcher } from "./mode-switcher";
import { InfluencersTable } from "./influencers-table";
import { ImageModal } from "./image-modal";
import { UploadModal } from "./upload-modal";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";

export function GalleryDashboard() {
  const [activeTab, setActiveTab] = useState("Hot");
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [activeMode, setActiveMode] = useState<"images" | "influencers">("images");
  const [selectedImage, setSelectedImage] = useState<{
    thumbSrc: string;
    fullSrc: string;
    prompt: string;
    width?: number;
    height?: number;
  } | null>(null);
  const [isUploadOpen, setUploadOpen] = useState(false);

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

  const kindFilter = "image";

  const galleryAssets = useQuery(api.assets.listGalleryAssets, {
    kind: kindFilter,
    tagIds: selectedTagIds,
    limit: 120,
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
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleClearAll = () => {
    setSelectedTags([]);
  };

  const allTags = useMemo(() => {
    return tags?.map((tag) => tag.name) ?? [];
  }, [tags]);

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

  return (
    <div className="min-h-screen bg-background">
      <FilterSidebar
        isOpen={isFilterOpen}
        onClose={() => setIsFilterOpen(false)}
        tags={allTags}
        selectedTags={selectedTags}
        onTagToggle={handleTagToggle}
        onClearAll={handleClearAll}
      />
      <GalleryHeader
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onFilterClick={() => setIsFilterOpen(true)}
        selectedTagsCount={selectedTags.length}
      />
      <ModeSwitcher activeMode={activeMode} setActiveMode={setActiveMode} />
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <p className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground">Manual ingest</p>
        <Button variant="secondary" size="sm" onClick={() => setUploadOpen(true)}>
          Add prompt
        </Button>
      </div>
      <UploadModal
        open={isUploadOpen}
        onClose={() => setUploadOpen(false)}
        availableTags={allTags}
        folders={folders ?? []}
      />
      <main>
        {activeMode === "images" ? (
          <MasonryGrid
            images={images}
            onImageSelect={setSelectedImage}
            onImageLoad={markImageLoaded}
          />
        ) : (
          <InfluencersTable />
        )}
      </main>
      <ImageModal
        key={selectedImage?.fullSrc ?? "empty"}
        open={Boolean(selectedImage)}
        image={selectedImage}
        onClose={() => setSelectedImage(null)}
      />
    </div>
  );
}
