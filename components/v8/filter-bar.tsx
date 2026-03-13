"use client";

import { useMemo, useRef, useState } from "react";
import { Grid3X3, Layers, Search, X } from "lucide-react";

export type SortOrder = "featured" | "newest" | "popular";
export type GalleryScope = "mine" | "public";
export type ViewMode = "grid" | "canvas";

const PILLAR_OPTIONS = [
  { label: "Creators", value: "creators" },
  { label: "Cars", value: "cars" },
  { label: "Designs", value: "designs" },
  { label: "Dump", value: "dump" },
] as const;

export type Pillar = (typeof PILLAR_OPTIONS)[number]["value"];

interface TagItem {
  _id: string;
  name: string;
  usageCount?: number;
}

interface V72FilterBarProps {
  galleryScope: GalleryScope;
  canAccessMyGallery: boolean;
  onGalleryScopeChange: (scope: GalleryScope) => void;
  assetSearchQuery: string;
  onAssetSearchQueryChange: (query: string) => void;
  semanticSearchLoading?: boolean;
  tags: TagItem[];
  selectedTags: string[];
  onTagToggle: (tag: string) => void;
  onClearAllTags: () => void;
  selectedPillar: Pillar | null;
  onPillarSelect: (pillar: Pillar | null) => void;
  sortOrder: SortOrder;
  onSortOrderChange: (order: SortOrder) => void;
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
}

const SORT_OPTIONS: Array<{ label: string; value: SortOrder }> = [
  { label: "FEATURED", value: "featured" },
  { label: "NEWEST", value: "newest" },
  { label: "POPULAR", value: "popular" },
];

const PILLAR_ACCENT: Record<string, string> = {
  creators: "var(--v7-pillar-creators)",
  cars: "var(--v7-pillar-cars)",
  designs: "var(--v7-pillar-designs)",
  dump: "var(--v7-pillar-dump)",
};

export function V72FilterBar({
  galleryScope,
  canAccessMyGallery,
  onGalleryScopeChange,
  assetSearchQuery,
  onAssetSearchQueryChange,
  semanticSearchLoading = false,
  tags,
  selectedTags,
  onTagToggle,
  onClearAllTags,
  selectedPillar,
  onPillarSelect,
  sortOrder,
  onSortOrderChange,
  viewMode,
  onViewModeChange,
}: V72FilterBarProps) {
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
      id="v8-filter-bar"
      className="flex justify-center"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 30,
        padding: "12px 16px 0",
        fontFamily: "var(--v7-font)",
      }}
    >
      <div
        className="v7-island"
        style={{
          width: "100%",
          maxWidth: "1180px",
          borderRadius: "28px",
          overflow: "hidden",
          marginBottom: "12px",
        }}
      >
        <div
          className="flex flex-col gap-3"
          style={{ padding: "14px 16px 10px" }}
        >
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 flex-col gap-3 md:flex-1 md:flex-row md:flex-wrap md:items-center">
              <div
                className="flex items-center self-start"
                style={{
                  borderRadius: "14px",
                  border: "2px solid var(--v7-ink)",
                  overflow: "hidden",
                  boxShadow: "0 10px 30px rgba(44, 24, 12, 0.08)",
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
                    backgroundColor: "var(--v7-ink)",
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
                  backgroundColor: "var(--v7-border-strong)",
                  flexShrink: 0,
                }}
              />

              <div className="hidden min-w-0 md:flex md:flex-1 md:flex-wrap md:items-center md:gap-1">
                <PillarPill
                  label="ALL"
                  active={selectedPillar === null}
                  onClick={() => onPillarSelect(null)}
                  accentColor="var(--v7-coral)"
                />
                {PILLAR_OPTIONS.map((pillar) => (
                  <PillarPill
                    key={pillar.value}
                    label={pillar.label.toUpperCase()}
                    active={selectedPillar === pillar.value}
                    onClick={() => onPillarSelect(pillar.value)}
                    accentColor={PILLAR_ACCENT[pillar.value] ?? "var(--v7-coral)"}
                  />
                ))}
              </div>
            </div>

            <div className="hidden md:flex md:items-center md:gap-2">
              <div
                style={{
                  width: "1px",
                  height: "24px",
                  backgroundColor: "var(--v7-border-strong)",
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

          {hasTags ? (
            <div
              className="flex flex-col gap-2 rounded-[18px] px-1 py-1 md:flex-row md:items-center md:justify-between"
              style={{
                background:
                  "linear-gradient(180deg, rgba(255,255,255,0.58), rgba(255,255,255,0.22))",
                border: "1px solid rgba(44, 24, 12, 0.08)",
              }}
            >
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-1.5 md:flex-initial md:min-w-[280px]">
                  <div
                    className="flex min-w-0 flex-1 items-center gap-2 px-3"
                    style={{
                      minHeight: "36px",
                      border: "2px solid var(--v7-ink)",
                      borderRadius: "999px",
                      backgroundColor: "rgba(255, 253, 250, 0.9)",
                    }}
                  >
                    <Search className="h-3.5 w-3.5 shrink-0" />
                    <input
                      value={assetSearchQuery}
                      onChange={(event) =>
                        onAssetSearchQueryChange(event.target.value)
                      }
                      placeholder="SEARCH VAULT..."
                      className="min-w-0 flex-1 bg-transparent py-1 outline-none"
                      style={{
                        fontFamily: "var(--v7-font)",
                        fontSize: "10px",
                        textTransform: "uppercase",
                        letterSpacing: "0.12em",
                        color: "var(--v7-text-primary)",
                      }}
                      aria-label="Search gallery"
                    />
                    {assetSearchQuery ? (
                      <button
                        type="button"
                        onClick={() => onAssetSearchQueryChange("")}
                        className="flex h-5 w-5 items-center justify-center rounded-full transition-colors"
                        style={{ color: "var(--v7-text-ghost)" }}
                        aria-label="Clear gallery search"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    ) : semanticSearchLoading ? (
                      <span
                        style={{
                          fontSize: "9px",
                          fontWeight: 800,
                          textTransform: "uppercase",
                          letterSpacing: "0.12em",
                          color: "var(--v7-coral)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        Searching
                      </span>
                    ) : null}
                  </div>
                </div>

                {searchOpen ? (
                  <div className="flex min-w-0 flex-1 items-center gap-1.5 md:flex-initial">
                    <div
                      className="flex min-w-0 flex-1 items-center gap-2 px-3"
                      style={{
                        minHeight: "36px",
                        border: "2px solid var(--v7-ink)",
                        borderRadius: "999px",
                        backgroundColor: "rgba(255, 253, 250, 0.9)",
                      }}
                    >
                      <Search className="h-3.5 w-3.5 shrink-0" />
                      <input
                        ref={searchInputRef}
                        value={searchQuery}
                        onChange={(event) =>
                          setSearchQuery(event.target.value)
                        }
                        placeholder="FILTER TAGS..."
                        className="min-w-0 flex-1 bg-transparent py-1 outline-none"
                        style={{
                          fontFamily: "var(--v7-font)",
                          fontSize: "10px",
                          textTransform: "uppercase",
                          letterSpacing: "0.12em",
                          color: "var(--v7-text-primary)",
                        }}
                        aria-label="Search tags"
                        onKeyDown={(event) => {
                          if (event.key === "Escape") closeSearch();
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={closeSearch}
                      className="flex h-9 w-9 items-center justify-center transition-colors"
                      style={{
                        color: "var(--v7-text-ghost)",
                        border: "2px solid var(--v7-border-strong)",
                        borderRadius: "999px",
                      }}
                      aria-label="Close search"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={openSearch}
                    className="flex h-9 items-center gap-2 px-4 transition-colors"
                    style={{
                      border: "2px solid var(--v7-border-strong)",
                      borderRadius: "999px",
                      color: "var(--v7-text-ghost)",
                      fontSize: "10px",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.16em",
                      fontFamily: "var(--v7-font)",
                      backgroundColor: "rgba(255, 253, 250, 0.7)",
                    }}
                    aria-label="Search tags"
                  >
                    <Search className="h-3 w-3" />
                    Search tags
                  </button>
                )}

                {selectedTags.length > 0 ? (
                  <button
                    type="button"
                    onClick={onClearAllTags}
                    className="flex items-center gap-1.5 px-3 py-2 transition-colors"
                    style={{
                      backgroundColor: "var(--v7-coral)",
                      color: "#000",
                      fontSize: "9px",
                      fontWeight: 800,
                      textTransform: "uppercase",
                      letterSpacing: "0.12em",
                      borderRadius: "999px",
                      boxShadow: "0 0 12px rgba(255, 122, 100, 0.3)",
                      fontFamily: "var(--v7-font)",
                    }}
                  >
                    <X className="h-2.5 w-2.5" />
                    Clear {selectedTags.length}
                  </button>
                ) : null}
              </div>

              <div
                className="px-2"
                style={{
                  color: "var(--v7-text-ghost)",
                  fontFamily: "var(--v7-font)",
                  fontSize: "9px",
                  fontWeight: 700,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                }}
              >
                {tagSummaryLabel}
              </div>
            </div>
          ) : null}
        </div>

        <div
          className="flex items-center gap-1 overflow-x-auto px-4 pb-2 md:hidden"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          <PillarPill
            label="ALL"
            active={selectedPillar === null}
            onClick={() => onPillarSelect(null)}
            accentColor="var(--v7-coral)"
          />
          {PILLAR_OPTIONS.map((pillar) => (
            <PillarPill
              key={pillar.value}
              label={pillar.label.toUpperCase()}
              active={selectedPillar === pillar.value}
              onClick={() => onPillarSelect(pillar.value)}
              accentColor={PILLAR_ACCENT[pillar.value] ?? "var(--v7-coral)"}
            />
          ))}
          <div
            style={{
              width: "1px",
              height: "20px",
              backgroundColor: "var(--v7-border-strong)",
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
                  backgroundColor: "var(--v7-border-strong)",
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
                backgroundColor: "var(--v7-border)",
                margin: "0 16px",
              }}
            />
            <div
              ref={tagScrollRef}
              className="flex items-center gap-1.5 overflow-x-auto px-4 py-2"
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
                        fontFamily: "var(--v7-font)",
                        fontSize: "10px",
                        fontWeight: isActive ? 700 : 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.10em",
                        border: isActive
                          ? "2px solid var(--v7-coral)"
                          : "2px solid var(--v7-border)",
                        color: isActive
                          ? "var(--v7-coral)"
                          : "var(--v7-text-secondary)",
                        backgroundColor: isActive
                          ? "var(--v7-accent-dim)"
                          : "rgba(255, 255, 255, 0.52)",
                        cursor: "pointer",
                        transition: "all var(--v7-duration-fast)",
                        borderRadius: "999px",
                        boxShadow: isActive
                          ? "0 0 10px rgba(255, 122, 100, 0.2)"
                          : "inset 0 1px 0 rgba(255,255,255,0.55)",
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
                    color: "var(--v7-text-ghost)",
                    fontFamily: "var(--v7-font)",
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
            backgroundColor:
              sortOrder === option.value ? "var(--v7-ink)" : "transparent",
            color:
              sortOrder === option.value
                ? "var(--v7-paper)"
                : "var(--v7-text-ghost)",
            fontSize: "9px",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.14em",
            border:
              sortOrder === option.value
                ? "2px solid var(--v7-ink)"
                : "2px solid transparent",
            transition: "all var(--v7-duration-fast)",
            cursor: "pointer",
            fontFamily: "var(--v7-font)",
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
        border: "2px solid var(--v7-border-strong)",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => onViewModeChange("grid")}
        className="flex items-center justify-center transition-colors"
        style={{
          padding: buttonPadding,
          backgroundColor:
            viewMode === "grid" ? "var(--v7-ink)" : "transparent",
          color:
            viewMode === "grid"
              ? "var(--v7-paper)"
              : "var(--v7-text-ghost)",
        }}
        aria-label="Grid view"
      >
        <Grid3X3 className="h-3.5 w-3.5" />
      </button>
      <div
        style={{
          width: "1px",
          alignSelf: "stretch",
          backgroundColor: "var(--v7-border-strong)",
        }}
      />
      <button
        type="button"
        onClick={() => onViewModeChange("canvas")}
        className="flex items-center justify-center transition-colors"
        style={{
          padding: buttonPadding,
          backgroundColor:
            viewMode === "canvas" ? "var(--v7-ink)" : "transparent",
          color:
            viewMode === "canvas"
              ? "var(--v7-paper)"
              : "var(--v7-text-ghost)",
        }}
        aria-label="Canvas view"
      >
        <Layers className="h-3.5 w-3.5" />
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
        backgroundColor: isAccentActive
          ? "var(--v7-coral)"
          : active
            ? "var(--v7-ink)"
            : "transparent",
        color: isAccentActive
          ? "#000"
          : active
            ? "var(--v7-paper)"
            : "var(--v7-text-ghost)",
        fontSize: "10px",
        fontWeight: 800,
        textTransform: "uppercase",
        letterSpacing: "0.16em",
        fontFamily: "var(--v7-font)",
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

function PillarPill({
  label,
  active,
  onClick,
  accentColor,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  accentColor: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center transition-all"
      style={{
        padding: "4px 10px",
        borderRadius: "12px",
        backgroundColor: active ? accentColor : "transparent",
        color: active ? "#000" : "var(--v7-text-ghost)",
        fontSize: "9px",
        fontWeight: active ? 900 : 600,
        textTransform: "uppercase",
        letterSpacing: "0.14em",
        border: active ? `2px solid ${accentColor}` : "2px solid transparent",
        boxShadow: active ? `0 0 12px ${accentColor}33` : "none",
        cursor: "pointer",
        fontFamily: "var(--v7-font)",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {label}
    </button>
  );
}
