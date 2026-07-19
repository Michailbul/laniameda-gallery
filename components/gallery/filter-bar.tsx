"use client";

import { useMemo, useRef, useState } from "react";
import {
  FolderOpen,
  Grid3X3,
  Heart,
  Image as ImageIcon,
  Package,
  SlidersHorizontal,
  Video,
  Workflow,
  X,
} from "lucide-react";
import { MenuFilterAdmin } from "./menu-filter-admin";

export type MediaKind = "image" | "video";

export type SortOrder = "featured" | "newest" | "shuffle";
export type GalleryScope = "mine" | "public";
export type ViewMode = "grid" | "collections" | "packs";
export type Pillar = string;
export type PillarOption = {
  label: string;
  value: string;
  color?: string;
  description?: string;
};

// A curated menu pill (admin-managed on the backend). "tag" pills toggle the
// tag filter; "collection" pills toggle the folder filter to their collection.
export interface MenuFilterItem {
  _id: string;
  label: string;
  kind: "tag" | "collection";
  tagNames?: string[];
  folderId?: string;
  count: number;
}

interface GalleryFilterBarProps {
  galleryScope: GalleryScope;
  canAccessMyGallery: boolean;
  onGalleryScopeChange: (scope: GalleryScope) => void;
  menuFilters: MenuFilterItem[];
  selectedTags: string[];
  onTagToggle: (tag: string) => void;
  selectedFolderId?: string | null;
  onCollectionToggle: (folderId: string) => void;
  onClearAllTags: () => void;
  /** Owner may open the manage panel and edit the menu (mine scope only). */
  canManageMenuFilters?: boolean;
  ownerUserId: string;
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
  /** Grid tile size, 0.4–1 (1 = full size). Slider hidden when omitted. */
  gridZoom?: number;
  onGridZoomChange?: (zoom: number) => void;
}

const SORT_OPTIONS: Array<{ label: string; value: SortOrder }> = [
  { label: "FEATURED", value: "featured" },
  { label: "NEWEST", value: "newest" },
  // Re-clicking SHUFFLE deals a new arrangement (dashboard bumps the seed).
  { label: "SHUFFLE", value: "shuffle" },
];

export function GalleryFilterBar({
  galleryScope,
  canAccessMyGallery,
  onGalleryScopeChange,
  menuFilters,
  selectedTags,
  onTagToggle,
  selectedFolderId,
  onCollectionToggle,
  onClearAllTags,
  canManageMenuFilters = false,
  ownerUserId,
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
  gridZoom,
  onGridZoomChange,
}: GalleryFilterBarProps) {
  const selectedTagSet = useMemo(() => new Set(selectedTags), [selectedTags]);
  const [adminOpen, setAdminOpen] = useState(false);
  const tagScrollRef = useRef<HTMLDivElement>(null);

  const showMenuRow = menuFilters.length > 0 || canManageMenuFilters;

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
              {onGridZoomChange && viewMode === "grid" ? (
                <ZoomSlider value={gridZoom ?? 1} onChange={onGridZoomChange} />
              ) : null}
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
          {onGridZoomChange && viewMode === "grid" ? (
            <ZoomSlider value={gridZoom ?? 1} onChange={onGridZoomChange} />
          ) : null}
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

        {showMenuRow ? (
          <>
            <div
              style={{
                height: "1px",
                backgroundColor: "var(--lm-border)",
                margin: "0 16px",
              }}
            />
            <div className="flex items-center gap-2 px-3 py-2">
              {selectedTags.length > 0 ? (
                <button
                  type="button"
                  onClick={onClearAllTags}
                  className="flex shrink-0 items-center gap-1 px-2.5 py-1 transition-colors"
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

              {/* Curated menu pills */}
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
                {menuFilters.length > 0 ? (
                  menuFilters.map((entry) => {
                    const isActive =
                      entry.kind === "tag"
                        ? selectedTagSet.has(entry._id)
                        : entry.folderId != null &&
                          entry.folderId === selectedFolderId;
                    return (
                      <button
                        key={entry._id}
                        type="button"
                        onClick={() =>
                          entry.kind === "tag"
                            ? onTagToggle(entry._id)
                            : entry.folderId && onCollectionToggle(entry.folderId)
                        }
                        title={
                          entry.kind === "collection"
                            ? `Show the ${entry.label} collection`
                            : undefined
                        }
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
                        {entry.kind === "collection" ? (
                          <FolderOpen className="h-2.5 w-2.5" aria-hidden />
                        ) : null}
                        {entry.label}
                        {entry.count > 0 ? (
                          <span
                            style={{
                              opacity: 0.5,
                              fontSize: "8px",
                              fontWeight: 800,
                            }}
                          >
                            {entry.count}
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
                    No menu filters yet — add one
                  </div>
                )}
              </div>

              {canManageMenuFilters ? (
                <button
                  type="button"
                  onClick={() => setAdminOpen((open) => !open)}
                  className="flex shrink-0 items-center gap-1 px-2.5 py-1 transition-colors"
                  style={{
                    border: adminOpen
                      ? "2px solid var(--lm-ink)"
                      : "2px solid var(--lm-border-strong)",
                    borderRadius: "999px",
                    color: adminOpen
                      ? "var(--lm-text-primary)"
                      : "var(--lm-text-ghost)",
                    fontFamily: "var(--lm-font)",
                    fontSize: "9px",
                    fontWeight: 700,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    background: adminOpen ? "var(--lm-surface-1)" : "transparent",
                  }}
                  aria-expanded={adminOpen}
                  aria-label="Manage menu filters"
                >
                  <SlidersHorizontal className="h-3 w-3" />
                  Edit
                </button>
              ) : null}
            </div>
            {canManageMenuFilters && adminOpen ? (
              <MenuFilterAdmin
                ownerUserId={ownerUserId}
                menuFilters={menuFilters}
                onClose={() => setAdminOpen(false)}
              />
            ) : null}
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

// Tile-size control: drag left for a denser grid, right for full size. The
// range maps straight onto the justified layout's target row height.
function ZoomSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (zoom: number) => void;
}) {
  return (
    <div
      className="flex items-center gap-1.5"
      title="Tile size"
      style={{ flexShrink: 0 }}
    >
      <Grid3X3
        className="h-3 w-3"
        style={{ color: "var(--lm-text-ghost)" }}
        aria-hidden
      />
      <input
        type="range"
        min={0.4}
        max={1}
        step={0.05}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label="Asset tile size"
        style={{
          width: "84px",
          accentColor: "var(--lm-coral)",
          cursor: "pointer",
        }}
      />
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

  // Flat text pills, same visual language as the sort row: no boxes or
  // borders at rest, gradient pill when active. Icons dropped — the labels
  // carry it.
  return (
    <div className="flex items-center gap-1">
      {items.map(({ key, label, active, onClick }) => (
        <button
          key={key}
          type="button"
          onClick={onClick}
          className="transition-all"
          style={{
            padding: "4px 10px",
            borderRadius: "12px",
            background: active
              ? "linear-gradient(135deg, var(--gradient-1), var(--gradient-3))"
              : "transparent",
            color: active ? "#fff" : "var(--lm-text-ghost)",
            fontSize: "9px",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.14em",
            border: active
              ? "2px solid var(--gradient-1)"
              : "2px solid transparent",
            cursor: "pointer",
            fontFamily: "var(--lm-font)",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
          title={active ? `Showing ${label.toLowerCase()} only` : `Show ${label.toLowerCase()} only`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

