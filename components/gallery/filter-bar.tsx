"use client";

import { useMemo, useRef, useState } from "react";
import {
  FolderOpen,
  Grid3X3,
  Heart,
  Image as ImageIcon,
  Layers,
  Package,
  Search,
  Video,
  Workflow,
  X,
} from "lucide-react";

export type MediaKind = "image" | "video";

export type SortOrder = "featured" | "newest" | "popular" | "largest";
export type GalleryScope = "mine" | "public";
export type ViewMode = "grid" | "collections" | "canvas" | "packs";
export type Pillar = string;
export type PillarOption = {
  label: string;
  value: string;
  color?: string;
  description?: string;
};

interface TagItem {
  _id: string;
  name: string;
  usageCount?: number;
}

interface GalleryFilterBarProps {
  galleryScope: GalleryScope;
  canAccessMyGallery: boolean;
  onGalleryScopeChange: (scope: GalleryScope) => void;
  tags: TagItem[];
  selectedTags: string[];
  onTagToggle: (tag: string) => void;
  onClearAllTags: () => void;
  workflowsOnly: boolean;
  onWorkflowsOnlyChange: (next: boolean) => void;
  likedOnly?: boolean;
  onLikedOnlyChange?: (next: boolean) => void;
  showLiked?: boolean;
  mediaKind: MediaKind | null;
  onMediaKindChange: (kind: MediaKind | null) => void;
  sortOrder: SortOrder;
  onSortOrderChange: (order: SortOrder) => void;
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
}

const SORT_OPTIONS: Array<{ label: string; value: SortOrder }> = [
  { label: "FEATURED", value: "featured" },
  { label: "NEWEST", value: "newest" },
  { label: "POPULAR", value: "popular" },
  { label: "LARGEST", value: "largest" },
];

export function GalleryFilterBar({
  galleryScope,
  canAccessMyGallery,
  onGalleryScopeChange,
  tags,
  selectedTags,
  onTagToggle,
  onClearAllTags,
  workflowsOnly,
  onWorkflowsOnlyChange,
  likedOnly = false,
  onLikedOnlyChange,
  showLiked = false,
  mediaKind,
  onMediaKindChange,
  sortOrder,
  onSortOrderChange,
  viewMode,
  onViewModeChange,
}: GalleryFilterBarProps) {
  const selectedTagSet = useMemo(() => new Set(selectedTags), [selectedTags]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const tagScrollRef = useRef<HTMLDivElement>(null);

  const orderedTags = useMemo(() => {
    const selected: TagItem[] = [];
    const unselected: TagItem[] = [];

    for (const tag of [...tags].sort((a, b) => {
      const usageDiff = (b.usageCount ?? 0) - (a.usageCount ?? 0);
      if (usageDiff !== 0) return usageDiff;
      return a.name.localeCompare(b.name);
    })) {
      if (selectedTagSet.has(tag._id)) {
        selected.push(tag);
      } else {
        unselected.push(tag);
      }
    }

    return [...selected, ...unselected];
  }, [tags, selectedTagSet]);

  const filteredTags = useMemo(() => {
    if (!searchQuery.trim()) return orderedTags;
    const needle = searchQuery.trim().toLowerCase();
    return orderedTags.filter((tag) =>
      tag.name.toLowerCase().includes(needle),
    );
  }, [orderedTags, searchQuery]);

  const openSearch = () => {
    setSearchOpen(true);
    setTimeout(() => searchInputRef.current?.focus(), 50);
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery("");
  };

  const hasTags = orderedTags.length > 0;
  const hasFilteredTags = filteredTags.length > 0;
  const tagSummaryLabel = searchQuery.trim()
    ? `${filteredTags.length} of ${orderedTags.length} tags`
    : `${orderedTags.length} tags`;

  return (
    <div
      id="gallery-filter-bar"
      className="flex justify-center"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 30,
        padding: "12px 16px 0",
        fontFamily: "var(--lm-font)",
      }}
    >
      <div
        className="lm-island"
        style={{
          width: "100%",
          maxWidth: "1180px",
          borderRadius: "28px",
          overflow: "hidden",
          marginBottom: "12px",
        }}
      >
        <div
          style={{ padding: "14px 16px 10px" }}
        >
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 flex-col gap-3 md:flex-1 md:flex-row md:flex-wrap md:items-center">
              <div
                className="flex items-center self-start"
                style={{
                  borderRadius: "14px",
                  border: "2px solid var(--lm-ink)",
                  overflow: "hidden",
                  boxShadow: "0 10px 30px var(--lm-scope-pill-shadow, rgba(44, 24, 12, 0.08))",
                }}
              >
                <ScopePill
                  label="PUBLIC"
                  active={galleryScope === "public"}
                  onClick={() => onGalleryScopeChange("public")}
                />
                <div
                  style={{
                    width: "2px",
                    height: "100%",
                    alignSelf: "stretch",
                    backgroundColor: "var(--lm-ink)",
                  }}
                />
                <ScopePill
                  label="MINE"
                  active={galleryScope === "mine"}
                  onClick={() => onGalleryScopeChange("mine")}
                  disabled={!canAccessMyGallery}
                  accent
                />
              </div>

              <div
                className="hidden md:block"
                style={{
                  width: "1px",
                  height: "24px",
                  backgroundColor: "var(--lm-border-strong)",
                  flexShrink: 0,
                }}
              />

              <div className="hidden min-w-0 md:flex md:items-center md:gap-1">
                <ContentTypePills
                  mediaKind={mediaKind}
                  onMediaKindChange={onMediaKindChange}
                  workflowsOnly={workflowsOnly}
                  onWorkflowsOnlyChange={onWorkflowsOnlyChange}
                  likedOnly={likedOnly}
                  onLikedOnlyChange={onLikedOnlyChange}
                  showLiked={showLiked}
                />
              </div>
            </div>

            <div className="hidden md:flex md:items-center md:gap-2">
              <div
                style={{
                  width: "1px",
                  height: "24px",
                  backgroundColor: "var(--lm-border-strong)",
                  flexShrink: 0,
                }}
              />
              <SortPills
                sortOrder={sortOrder}
                onSortOrderChange={onSortOrderChange}
              />
              {onViewModeChange ? (
                <ViewModeToggle
                  viewMode={viewMode}
                  onViewModeChange={onViewModeChange}
                />
              ) : null}
            </div>
          </div>
        </div>

        <div
          className="flex items-center gap-1 overflow-x-auto px-4 pb-2 md:hidden"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          <ContentTypePills
            mediaKind={mediaKind}
            onMediaKindChange={onMediaKindChange}
            workflowsOnly={workflowsOnly}
            onWorkflowsOnlyChange={onWorkflowsOnlyChange}
            likedOnly={likedOnly}
            onLikedOnlyChange={onLikedOnlyChange}
            showLiked={showLiked}
          />
          <div
            style={{
              width: "1px",
              height: "20px",
              backgroundColor: "var(--lm-border-strong)",
              flexShrink: 0,
              margin: "0 4px",
            }}
          />
          <SortPills sortOrder={sortOrder} onSortOrderChange={onSortOrderChange} />
          {onViewModeChange ? (
            <>
              <div
                style={{
                  width: "1px",
                  height: "20px",
                  backgroundColor: "var(--lm-border-strong)",
                  flexShrink: 0,
                  margin: "0 4px",
                }}
              />
              <ViewModeToggle
                viewMode={viewMode}
                onViewModeChange={onViewModeChange}
                compact
              />
            </>
          ) : null}
        </div>

        {hasTags ? (
          <>
            <div
              style={{
                height: "1px",
                backgroundColor: "var(--lm-border)",
                margin: "0 16px",
              }}
            />
            <div className="flex items-center gap-2 px-3 py-2">
              {/* Inline tag search + clear */}
              <div className="flex items-center gap-1.5 shrink-0">
                {searchOpen ? (
                  <div
                    className="lm-search-input flex items-center gap-1.5 px-2.5"
                    style={{
                      minHeight: "30px",
                      border: "2px solid var(--lm-ink)",
                      borderRadius: "999px",
                      backgroundColor: "var(--lm-surface-1)",
                    }}
                  >
                    <Search className="h-3 w-3 shrink-0" style={{ color: "var(--lm-text-ghost)" }} />
                    <input
                      ref={searchInputRef}
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="FILTER..."
                      className="min-w-0 bg-transparent py-0.5 outline-none"
                      style={{
                        fontFamily: "var(--lm-font)",
                        fontSize: "10px",
                        textTransform: "uppercase",
                        letterSpacing: "0.12em",
                        color: "var(--lm-text-primary)",
                        width: "80px",
                      }}
                      aria-label="Search tags"
                      onKeyDown={(event) => {
                        if (event.key === "Escape") closeSearch();
                      }}
                    />
                    <button
                      type="button"
                      onClick={closeSearch}
                      className="flex items-center justify-center"
                      style={{ color: "var(--lm-text-ghost)" }}
                      aria-label="Close tag search"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={openSearch}
                    className="flex items-center justify-center shrink-0 transition-colors"
                    style={{
                      width: "30px",
                      height: "30px",
                      border: "2px solid var(--lm-border-strong)",
                      borderRadius: "999px",
                      color: "var(--lm-text-ghost)",
                    }}
                    aria-label="Search tags"
                  >
                    <Search className="h-3 w-3" />
                  </button>
                )}
                {selectedTags.length > 0 ? (
                  <button
                    type="button"
                    onClick={onClearAllTags}
                    className="flex items-center gap-1 px-2.5 py-1 transition-colors"
                    style={{
                      background: "linear-gradient(135deg, var(--gradient-1), var(--gradient-3))",
                      color: "#fff",
                      fontSize: "9px",
                      fontWeight: 800,
                      textTransform: "uppercase",
                      letterSpacing: "0.12em",
                      borderRadius: "999px",
                      fontFamily: "var(--lm-font)",
                    }}
                  >
                    <X className="h-2.5 w-2.5" />
                    Clear {selectedTags.length}
                  </button>
                ) : null}
              </div>

              {/* Scrollable tag pills */}
              <div
                ref={tagScrollRef}
                className="flex items-center gap-1.5 overflow-x-auto min-w-0 flex-1"
                style={{
                  scrollbarWidth: "none",
                  msOverflowStyle: "none",
                }}
                onWheel={(event) => {
                  const element = tagScrollRef.current;
                  if (!element || event.deltaY === 0) return;
                  if (element.scrollWidth <= element.clientWidth) return;
                  const atStart = element.scrollLeft <= 0;
                  const atEnd =
                    element.scrollLeft + element.clientWidth >=
                    element.scrollWidth - 1;
                  if ((event.deltaY < 0 && atStart) || (event.deltaY > 0 && atEnd)) {
                    return;
                  }
                  event.preventDefault();
                  element.scrollLeft += event.deltaY;
                }}
              >
                {hasFilteredTags ? (
                  filteredTags.map((tag) => {
                    const isActive = selectedTagSet.has(tag._id);
                    return (
                      <button
                        key={tag._id}
                        type="button"
                        onClick={() => onTagToggle(tag._id)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                          padding: "4px 11px",
                          fontFamily: "var(--lm-font)",
                          fontSize: "10px",
                          fontWeight: isActive ? 700 : 600,
                          textTransform: "uppercase",
                          letterSpacing: "0.10em",
                          border: isActive
                            ? "2px solid var(--gradient-3)"
                            : "2px solid var(--lm-border)",
                          color: isActive
                            ? "#fff"
                            : "var(--lm-text-secondary)",
                          background: isActive
                            ? "linear-gradient(135deg, var(--gradient-1), var(--gradient-3), var(--gradient-5))"
                            : "var(--lm-surface-1)",
                          cursor: "pointer",
                          transition: "all var(--lm-duration-fast)",
                          borderRadius: "999px",
                          boxShadow: isActive
                            ? "0 0 10px rgba(255, 122, 100, 0.2)"
                            : "none",
                          whiteSpace: "nowrap",
                          flexShrink: 0,
                        }}
                      >
                        {tag.name}
                        {tag.usageCount != null && tag.usageCount > 0 ? (
                          <span
                            style={{
                              opacity: 0.5,
                              fontSize: "8px",
                              fontWeight: 800,
                            }}
                          >
                            {tag.usageCount}
                          </span>
                        ) : null}
                      </button>
                    );
                  })
                ) : (
                  <div
                    className="px-3 py-2"
                    style={{
                      color: "var(--lm-text-ghost)",
                      fontFamily: "var(--lm-font)",
                      fontSize: "10px",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.14em",
                    }}
                  >
                    No tags match this search
                  </div>
                )}
              </div>

              {/* Tag count */}
              <div
                className="shrink-0"
                style={{
                  color: "var(--lm-text-ghost)",
                  fontFamily: "var(--lm-font)",
                  fontSize: "9px",
                  fontWeight: 700,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                }}
              >
                {tagSummaryLabel}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function SortPills({
  sortOrder,
  onSortOrderChange,
}: {
  sortOrder: SortOrder;
  onSortOrderChange: (order: SortOrder) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {SORT_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onSortOrderChange(option.value)}
          style={{
            padding: "4px 10px",
            borderRadius: "12px",
            background:
              sortOrder === option.value
                ? "linear-gradient(135deg, var(--gradient-1), var(--gradient-3))"
                : "transparent",
            color:
              sortOrder === option.value
                ? "#fff"
                : "var(--lm-text-ghost)",
            fontSize: "9px",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.14em",
            border:
              sortOrder === option.value
                ? "2px solid var(--gradient-1)"
                : "2px solid transparent",
            transition: "all var(--lm-duration-fast)",
            cursor: "pointer",
            fontFamily: "var(--lm-font)",
            whiteSpace: "nowrap",
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ViewModeToggle({
  viewMode,
  onViewModeChange,
  compact = false,
}: {
  viewMode?: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  compact?: boolean;
}) {
  const buttonPadding = compact ? "4px 8px" : "4px 8px";

  return (
    <div
      className="flex items-center"
      style={{
        borderRadius: "12px",
        border: "2px solid var(--lm-border-strong)",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => onViewModeChange("grid")}
        className="flex items-center justify-center transition-colors"
        style={{
          padding: buttonPadding,
          background:
            viewMode === "grid"
              ? "linear-gradient(135deg, var(--gradient-1), var(--gradient-3))"
              : "transparent",
          color:
            viewMode === "grid"
              ? "#fff"
              : "var(--lm-text-ghost)",
        }}
        aria-label="Grid view"
      >
        <Grid3X3 className="h-3.5 w-3.5" />
      </button>
      <div
        style={{
          width: "1px",
          alignSelf: "stretch",
          backgroundColor: "var(--lm-border-strong)",
        }}
      />
      <button
        type="button"
        onClick={() => onViewModeChange("collections")}
        className="flex items-center justify-center transition-colors"
        style={{
          padding: buttonPadding,
          background:
            viewMode === "collections"
              ? "linear-gradient(135deg, var(--gradient-1), var(--gradient-3))"
              : "transparent",
          color:
            viewMode === "collections"
              ? "#fff"
              : "var(--lm-text-ghost)",
        }}
        aria-label="Collections view"
        title="Browse by collection"
      >
        <FolderOpen className="h-3.5 w-3.5" />
      </button>
      <div
        style={{
          width: "1px",
          alignSelf: "stretch",
          backgroundColor: "var(--lm-border-strong)",
        }}
      />
      <button
        type="button"
        onClick={() => onViewModeChange("canvas")}
        className="flex items-center justify-center transition-colors"
        style={{
          padding: buttonPadding,
          background:
            viewMode === "canvas"
              ? "linear-gradient(135deg, var(--gradient-1), var(--gradient-3))"
              : "transparent",
          color:
            viewMode === "canvas"
              ? "#fff"
              : "var(--lm-text-ghost)",
        }}
        aria-label="Canvas view"
      >
        <Layers className="h-3.5 w-3.5" />
      </button>
      <div
        style={{
          width: "1px",
          alignSelf: "stretch",
          backgroundColor: "var(--lm-border-strong)",
        }}
      />
      <button
        type="button"
        onClick={() => onViewModeChange("packs")}
        className="flex items-center justify-center transition-colors"
        style={{
          padding: buttonPadding,
          background:
            viewMode === "packs"
              ? "linear-gradient(135deg, var(--gradient-1), var(--gradient-3))"
              : "transparent",
          color:
            viewMode === "packs"
              ? "#fff"
              : "var(--lm-text-ghost)",
        }}
        aria-label="Packs view"
      >
        <Package className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function ScopePill({
  label,
  active,
  onClick,
  disabled,
  accent,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  accent?: boolean;
}) {
  const isAccentActive = accent && active;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center px-3 py-1 transition-colors disabled:opacity-30"
      style={{
        background: isAccentActive
          ? "linear-gradient(135deg, var(--gradient-1), var(--gradient-3), var(--gradient-5))"
          : active
            ? "var(--lm-ink)"
            : "transparent",
        color: isAccentActive
          ? "#fff"
          : active
            ? "var(--lm-paper)"
            : "var(--lm-text-ghost)",
        fontSize: "10px",
        fontWeight: 800,
        textTransform: "uppercase",
        letterSpacing: "0.16em",
        fontFamily: "var(--lm-font)",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
      title={
        disabled ? "Sign in to access your private gallery" : undefined
      }
    >
      {label}
    </button>
  );
}

// Content-type filter — Image / Video (asset kind) and Workflows. Single-select:
// clicking the active chip clears it back to "all".
function ContentTypePills({
  mediaKind,
  onMediaKindChange,
  workflowsOnly,
  onWorkflowsOnlyChange,
  likedOnly = false,
  onLikedOnlyChange,
  showLiked = false,
}: {
  mediaKind: MediaKind | null;
  onMediaKindChange: (kind: MediaKind | null) => void;
  workflowsOnly: boolean;
  onWorkflowsOnlyChange: (next: boolean) => void;
  likedOnly?: boolean;
  onLikedOnlyChange?: (next: boolean) => void;
  showLiked?: boolean;
}) {
  const items: Array<{
    key: string;
    label: string;
    icon: typeof Workflow;
    active: boolean;
    onClick: () => void;
  }> = [
    {
      key: "image",
      label: "Image",
      icon: ImageIcon,
      active: !workflowsOnly && mediaKind === "image",
      onClick: () => onMediaKindChange(mediaKind === "image" ? null : "image"),
    },
    {
      key: "video",
      label: "Video",
      icon: Video,
      active: !workflowsOnly && mediaKind === "video",
      onClick: () => onMediaKindChange(mediaKind === "video" ? null : "video"),
    },
    {
      key: "workflows",
      label: "Workflows",
      icon: Workflow,
      active: workflowsOnly,
      onClick: () => onWorkflowsOnlyChange(!workflowsOnly),
    },
    ...(showLiked && onLikedOnlyChange
      ? [
          {
            key: "liked",
            label: "Liked",
            icon: Heart,
            active: likedOnly,
            onClick: () => onLikedOnlyChange(!likedOnly),
          },
        ]
      : []),
  ];

  return (
    <div className="flex items-center gap-1">
      {items.map(({ key, label, icon: Icon, active, onClick }) => (
        <button
          key={key}
          type="button"
          onClick={onClick}
          className="flex items-center gap-1 transition-all"
          style={{
            padding: "4px 10px",
            borderRadius: "12px",
            background: active
              ? "linear-gradient(135deg, var(--gradient-1), var(--gradient-3), var(--gradient-5))"
              : "transparent",
            color: active ? "#fff" : "var(--lm-text-ghost)",
            fontSize: "9px",
            fontWeight: active ? 900 : 600,
            textTransform: "uppercase",
            letterSpacing: "0.14em",
            border: active
              ? "2px solid transparent"
              : "2px solid var(--lm-border-strong)",
            boxShadow: active ? "0 0 12px rgba(255, 122, 100, 0.35)" : "none",
            cursor: "pointer",
            fontFamily: "var(--lm-font)",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
          title={active ? `Showing ${label.toLowerCase()} only` : `Show ${label.toLowerCase()} only`}
        >
          <Icon className="h-3 w-3" />
          {label}
        </button>
      ))}
    </div>
  );
}

