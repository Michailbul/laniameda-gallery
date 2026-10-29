"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  FolderOpen,
  Grid3X3,
  Heart,
  Image as ImageIcon,
  Layers,
  Minus,
  SlidersHorizontal,
  Video,
  BookOpenText,
  Bookmark,
  X,
} from "lucide-react";
import { MenuFilterAdmin } from "./menu-filter-admin";

export type MediaKind = "image" | "video";

export type SortOrder = "featured" | "newest" | "shuffle";
export type GalleryScope = "mine" | "public";
export type ViewMode = "grid" | "collections" | "skills";

// A curated menu pill (admin-managed on the backend). "tag" pills toggle the
// tag filter; "collection" pills toggle the folder filter to their collection.
export interface MenuFilterItem {
  _id: string;
  label: string;
  kind: "tag" | "collection";
  tagNames?: string[];
  folderId?: string;
  /** The backing collection was deleted — the pill can never match, so it is
   *  kept out of the menu row and only shown (flagged) in the admin panel. */
  missingFolder?: boolean;
  count: number;
}

interface GalleryFilterBarProps {
  galleryScope: GalleryScope;
  canAccessMyGallery: boolean;
  onGalleryScopeChange: (scope: GalleryScope) => void;
  menuFilters: MenuFilterItem[];
  selectedTags: string[];
  onTagToggle: (tag: string) => void;
  /** Menu-filter ids pushed to the negative side (minus on the pill's edge). */
  excludedFilters?: string[];
  onFilterExcludeToggle?: (filterId: string) => void;
  selectedFolderId?: string | null;
  onCollectionToggle: (folderId: string) => void;
  onClearAllTags: () => void;
  bookmarksOnly?: boolean;
  onBookmarksOnlyChange?: (next: boolean) => void;
  /** Owner may open the manage panel and edit the menu (mine scope only). */
  canManageMenuFilters?: boolean;
  ownerUserId: string;
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
  /** Group similar: clusters of near-identical images, and how close is similar (0 tight … 1 loose). */
  groupSimilar?: boolean;
  onGroupSimilarChange?: (on: boolean) => void;
  similarity?: number;
  onSimilarityChange?: (value: number) => void;
  /** Flatten mode: stacks spread into one tile per asset. Pill hidden when
   *  the handler is omitted. */
  flattenStacks?: boolean;
  onFlattenStacksChange?: (next: boolean) => void;
}

/**
 * A horizontal chip rail that says when it scrolls: `fade` names the edge(s)
 * with more behind them, and the `.lm-chip-rail[data-fade]` rules in
 * globals.css soften that edge. Re-measured when the rail resizes and when
 * `signal` changes (its chips arrived or changed).
 */
export function useChipRail<T extends HTMLElement>(signal?: unknown) {
  const ref = useRef<T>(null);
  const [fade, setFade] = useState<"none" | "left" | "right" | "both">("none");
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const left = element.scrollLeft > 2;
      const right = element.scrollLeft + element.clientWidth < element.scrollWidth - 2;
      setFade(left && right ? "both" : left ? "left" : right ? "right" : "none");
    };
    // Measured on the next frame, when the rail resizes, when its chips
    // resize (counts and fonts arrive late), on scroll and on window resize.
    // Every path is async, so no render-time state write.
    const frame = requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    element.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    const fonts = typeof document !== "undefined" ? document.fonts?.ready : undefined;
    let live = true;
    void fonts?.then(() => {
      if (live) measure();
    });
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      element.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [signal]);
  return [ref, fade] as const;
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
  excludedFilters = [],
  onFilterExcludeToggle,
  selectedFolderId,
  onCollectionToggle,
  onClearAllTags,
  bookmarksOnly = false,
  onBookmarksOnlyChange,
  canManageMenuFilters = false,
  ownerUserId,
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
  groupSimilar = false,
  onGroupSimilarChange,
  similarity = 0.25,
  onSimilarityChange,
  flattenStacks = false,
  onFlattenStacksChange,
}: GalleryFilterBarProps) {
  const selectedTagSet = useMemo(() => new Set(selectedTags), [selectedTags]);
  const excludedFilterSet = useMemo(
    () => new Set(excludedFilters),
    [excludedFilters],
  );
  const activeFilterCount = selectedTags.length + excludedFilters.length + Number(bookmarksOnly);
  const [adminOpen, setAdminOpen] = useState(false);
  // Which pill is showing its minus affordance (hover or keyboard focus).
  const [hoveredFilterId, setHoveredFilterId] = useState<string | null>(null);
  const [tagScrollRef, menuFade] = useChipRail<HTMLDivElement>(menuFilters.length);
  const [mobileRailRef, mobileFade] = useChipRail<HTMLDivElement>(viewMode);

  // A pill whose collection was deleted matches nothing — showing it would be
  // a dead click. The admin panel below still lists it so the owner can fix it.
  const visibleMenuFilters = useMemo(
    () => menuFilters.filter((entry) => !entry.missingFolder),
    [menuFilters],
  );

  // Menu pills filter assets; the Skills view has its own tag and collection chips.
  const showMenuRow =
    viewMode !== "skills" &&
    (menuFilters.length > 0 || canManageMenuFilters || Boolean(onBookmarksOnlyChange));

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
                className="lm-scope-segment flex items-center self-start"
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
                  likedOnly={likedOnly}
                  onLikedOnlyChange={onLikedOnlyChange}
                  showLiked={showLiked}
                  flattenStacks={flattenStacks}
                  onFlattenStacksChange={
                    viewMode === "grid" ? onFlattenStacksChange : undefined
                  }
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
              {onGroupSimilarChange && viewMode === "grid" ? (
                <GroupSimilarControl on={groupSimilar} onChange={onGroupSimilarChange} similarity={similarity} onSimilarityChange={onSimilarityChange} />
              ) : null}
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
          ref={mobileRailRef}
          data-fade={mobileFade}
          className="lm-chip-rail flex items-center gap-1 overflow-x-auto px-4 pb-2 md:hidden"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          <ContentTypePills
            mediaKind={mediaKind}
            onMediaKindChange={onMediaKindChange}
            likedOnly={likedOnly}
            onLikedOnlyChange={onLikedOnlyChange}
            showLiked={showLiked}
            flattenStacks={flattenStacks}
            onFlattenStacksChange={
              viewMode === "grid" ? onFlattenStacksChange : undefined
            }
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
          {onGroupSimilarChange && viewMode === "grid" ? (
            <GroupSimilarControl on={groupSimilar} onChange={onGroupSimilarChange} similarity={similarity} onSimilarityChange={onSimilarityChange} />
          ) : null}
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
            <div className="lm-chip-row flex items-center gap-2 px-3 py-2">
              {activeFilterCount > 0 ? (
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
                  Clear {activeFilterCount}
                </button>
              ) : null}

              {/* Curated menu pills */}
              <div
                ref={tagScrollRef}
                data-fade={menuFade}
                className="lm-chip-rail flex items-center gap-1.5 overflow-x-auto min-w-0 flex-1"
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
                {onBookmarksOnlyChange ? (
                  <button
                    type="button"
                    onClick={() => onBookmarksOnlyChange(!bookmarksOnly)}
                    aria-pressed={bookmarksOnly}
                    className="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors"
                    style={{
                      background: bookmarksOnly
                        ? "linear-gradient(135deg, var(--gradient-1), var(--gradient-3))"
                        : "var(--lm-surface-1)",
                      color: bookmarksOnly ? "#fff" : "var(--lm-text-secondary)",
                      border: bookmarksOnly ? "1px solid transparent" : "1px solid var(--lm-border-strong)",
                      fontFamily: "var(--lm-font)",
                      fontSize: "9px",
                      fontWeight: 800,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                    }}
                  >
                    <Bookmark className="h-3 w-3" />
                    Bookmarks
                  </button>
                ) : null}
                {visibleMenuFilters.length > 0 ? (
                  visibleMenuFilters.map((entry) => (
                    <MenuFilterPill
                      key={entry._id}
                      entry={entry}
                      isActive={
                        entry.kind === "tag"
                          ? selectedTagSet.has(entry._id)
                          : entry.folderId != null &&
                            entry.folderId === selectedFolderId
                      }
                      isExcluded={excludedFilterSet.has(entry._id)}
                      showMinus={hoveredFilterId === entry._id}
                      onHoverChange={(hovered) =>
                        setHoveredFilterId((current) =>
                          hovered ? entry._id : current === entry._id ? null : current,
                        )
                      }
                      onSelect={() =>
                        entry.kind === "tag"
                          ? onTagToggle(entry._id)
                          : entry.folderId && onCollectionToggle(entry.folderId)
                      }
                      onExclude={
                        onFilterExcludeToggle
                          ? () => onFilterExcludeToggle(entry._id)
                          : undefined
                      }
                    />
                  ))
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

// A curated menu pill, three states: neutral, included (coral gradient) and
// excluded (red, struck through). The minus sits on the pill's left edge and
// fades in on hover/focus — clicking it flips the pill to the negative side,
// clicking it again releases it. Clicking the pill BODY always means "include".
function MenuFilterPill({
  entry,
  isActive,
  isExcluded,
  showMinus,
  onHoverChange,
  onSelect,
  onExclude,
}: {
  entry: MenuFilterItem;
  isActive: boolean;
  isExcluded: boolean;
  showMinus: boolean;
  onHoverChange: (hovered: boolean) => void;
  onSelect: () => void;
  onExclude?: () => void;
}) {
  const minusVisible = Boolean(onExclude) && (showMinus || isExcluded);

  // On a touch screen the minus is hidden (10 px is no target): holding the
  // chip for a moment flips it to the negative side instead, and the tap that
  // ends the hold is not a select.
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const cancelPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };
  const startPress = (event: React.PointerEvent) => {
    if (!onExclude || event.pointerType === "mouse") return;
    longPressed.current = false;
    cancelPress();
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      pressTimer.current = null;
      onExclude();
      if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(12);
    }, 450);
  };

  return (
    <div
      style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      onFocus={() => onHoverChange(true)}
      onBlur={() => onHoverChange(false)}
    >
      <button
        type="button"
        className="lm-menu-pill"
        onClick={() => {
          if (longPressed.current) {
            longPressed.current = false;
            return;
          }
          onSelect();
        }}
        onPointerDown={startPress}
        onPointerUp={cancelPress}
        onPointerCancel={cancelPress}
        onPointerLeave={cancelPress}
        onContextMenu={(event) => {
          if (onExclude) event.preventDefault();
        }}
        title={
          isExcluded
            ? `Excluding ${entry.label} — click to bring it back`
            : entry.kind === "collection"
              ? `Show the ${entry.label} collection${onExclude ? ". Hold to exclude it" : ""}`
              : onExclude
                ? `Show ${entry.label}. Hold to exclude it`
                : undefined
        }
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          padding: "4px 11px",
          paddingLeft: minusVisible ? "16px" : "11px",
          fontFamily: "var(--lm-font)",
          fontSize: "10px",
          fontWeight: isActive ? 700 : 600,
          textTransform: "uppercase",
          letterSpacing: "0.10em",
          border: isExcluded
            ? "2px solid color-mix(in srgb, var(--status-error) 70%, transparent)"
            : isActive
              ? "2px solid var(--gradient-3)"
              : "2px solid var(--lm-border)",
          color: isExcluded
            ? "var(--status-error)"
            : isActive
              ? "#fff"
              : "var(--lm-text-secondary)",
          background: isExcluded
            ? "color-mix(in srgb, var(--status-error) 12%, var(--lm-surface-1))"
            : isActive
              ? "linear-gradient(135deg, var(--gradient-1), var(--gradient-3), var(--gradient-5))"
              : "var(--lm-surface-1)",
          textDecoration: isExcluded ? "line-through" : "none",
          cursor: "pointer",
          transition: "all var(--lm-duration-fast)",
          borderRadius: "999px",
          boxShadow: isExcluded
            ? "0 0 10px color-mix(in srgb, var(--status-error) 22%, transparent)"
            : isActive
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
          <span style={{ opacity: 0.5, fontSize: "8px", fontWeight: 800 }}>
            {entry.count}
          </span>
        ) : null}
      </button>

      {onExclude ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onExclude();
          }}
          aria-label={
            isExcluded ? `Stop excluding ${entry.label}` : `Exclude ${entry.label}`
          }
          aria-pressed={isExcluded}
          title={
            isExcluded ? `Stop excluding ${entry.label}` : `Exclude ${entry.label}`
          }
          className="lm-menu-pill-minus"
          style={{
            position: "absolute",
            left: "-6px",
            top: "50%",
            transform: `translateY(-50%) scale(${minusVisible ? 1 : 0.6})`,
            opacity: minusVisible ? 1 : 0,
            pointerEvents: minusVisible ? "auto" : "none",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "16px",
            height: "16px",
            borderRadius: "999px",
            border: "1.5px solid color-mix(in srgb, var(--status-error) 80%, transparent)",
            background: isExcluded
              ? "var(--status-error)"
              : "color-mix(in srgb, var(--status-error) 18%, var(--lm-surface-1))",
            color: isExcluded
              ? "#fff"
              : "var(--status-error)",
            boxShadow:
              "0 0 8px color-mix(in srgb, var(--status-error) 35%, transparent)",
            transition: "all var(--lm-duration-fast)",
            cursor: "pointer",
            zIndex: 1,
          }}
        >
          <Minus className="h-2.5 w-2.5" strokeWidth={3} aria-hidden />
        </button>
      ) : null}
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

// Group similar: one pill, and while it is on a slider from tight (near
// duplicates) to loose (same subject).
function GroupSimilarControl({ on, onChange, similarity, onSimilarityChange }: {
  on: boolean; onChange: (on: boolean) => void; similarity: number; onSimilarityChange?: (value: number) => void;
}) {
  return (
    <div className="flex items-center gap-1.5" style={{ flexShrink: 0 }}>
      <button
        type="button"
        aria-pressed={on}
        onClick={() => onChange(!on)}
        title="Group similar: near-identical images side by side, in clusters"
        style={{
          padding: "4px 10px",
          borderRadius: "12px",
          background: on ? "linear-gradient(135deg, var(--gradient-1), var(--gradient-3))" : "transparent",
          color: on ? "#fff" : "var(--lm-text-ghost)",
          fontSize: "9px",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.14em",
          border: on ? "2px solid var(--gradient-1)" : "2px solid var(--lm-border-strong)",
          transition: "all var(--lm-duration-fast)",
          cursor: "pointer",
          fontFamily: "var(--lm-font)",
          whiteSpace: "nowrap",
        }}
      >
        SIMILAR
      </button>
      {on && onSimilarityChange ? (
        <label className="flex items-center gap-1" title="How close is similar: tight finds near-duplicates, loose the same subject">
          <span style={{ fontFamily: "var(--lm-font)", fontSize: "8px", fontWeight: 700, letterSpacing: "0.14em", color: "var(--lm-text-ghost)" }}>TIGHT</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={similarity}
            onChange={(event) => onSimilarityChange(Number(event.target.value))}
            aria-label="Similarity, tight to loose"
            style={{ width: "72px", accentColor: "var(--lm-coral)", cursor: "pointer" }}
          />
          <span style={{ fontFamily: "var(--lm-font)", fontSize: "8px", fontWeight: 700, letterSpacing: "0.14em", color: "var(--lm-text-ghost)" }}>LOOSE</span>
        </label>
      ) : null}
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
        onClick={() => onViewModeChange("skills")}
        className="flex items-center justify-center transition-colors"
        style={{
          padding: buttonPadding,
          background:
            viewMode === "skills"
              ? "linear-gradient(135deg, var(--gradient-1), var(--gradient-3))"
              : "transparent",
          color:
            viewMode === "skills"
              ? "#fff"
              : "var(--lm-text-ghost)",
        }}
        aria-label="Skills view"
        title="Browse skills"
      >
        <BookOpenText className="h-3.5 w-3.5" />
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

// Content-type filter — Image / Video (asset kind). Single-select: clicking the
// active chip clears it back to "all". Workflows are not a content type here;
// they have their own view mode, which is the only place they render.
function ContentTypePills({
  mediaKind,
  onMediaKindChange,
  likedOnly = false,
  onLikedOnlyChange,
  showLiked = false,
  flattenStacks = false,
  onFlattenStacksChange,
}: {
  mediaKind: MediaKind | null;
  onMediaKindChange: (kind: MediaKind | null) => void;
  likedOnly?: boolean;
  onLikedOnlyChange?: (next: boolean) => void;
  showLiked?: boolean;
  flattenStacks?: boolean;
  onFlattenStacksChange?: (next: boolean) => void;
}) {
  const items: Array<{
    key: string;
    label: string;
    icon: typeof Heart;
    active: boolean;
    onClick: () => void;
  }> = [
    {
      key: "image",
      label: "Image",
      icon: ImageIcon,
      active: mediaKind === "image",
      onClick: () => onMediaKindChange(mediaKind === "image" ? null : "image"),
    },
    {
      key: "video",
      label: "Video",
      icon: Video,
      active: mediaKind === "video",
      onClick: () => onMediaKindChange(mediaKind === "video" ? null : "video"),
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
    ...(onFlattenStacksChange
      ? [
          {
            key: "flatten",
            label: "Flatten",
            icon: Layers,
            active: flattenStacks,
            onClick: () => onFlattenStacksChange(!flattenStacks),
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
          title={
            key === "flatten"
              ? active
                ? "Stacks are spread out. Click to group them again."
                : "Spread every stack into one tile per image"
              : active
                ? `Showing ${label.toLowerCase()} only`
                : `Show ${label.toLowerCase()} only`
          }
        >
          {label}
        </button>
      ))}
    </div>
  );
}

