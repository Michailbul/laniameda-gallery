"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bookmark,
  BookOpenText,
  ChevronDown,
  Eye,
  FolderOpen,
  Grid3X3,
  Heart,
  Image as ImageIcon,
  Layers,
  LayoutTemplate,
  Minus,
  SlidersHorizontal,
  Video,
  X,
} from "lucide-react";
import { MenuFilterAdmin } from "./menu-filter-admin";
import { ViewsPanel, activeViewName, type ViewsPanelProps } from "./filter-presets";

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
  /** The saved views (VIEWS popover). Omitted when the view has none. */
  views?: ViewsPanelProps;
  /** PUBLISH ALL, under MANAGE: opens the confirmation that counts the view's
   *  private pieces on the server. Omitted when the viewer cannot curate. */
  onPublishAll?: () => void;
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
  views,
  onPublishAll,
}: GalleryFilterBarProps) {
  const selectedTagSet = useMemo(() => new Set(selectedTags), [selectedTags]);
  const excludedFilterSet = useMemo(
    () => new Set(excludedFilters),
    [excludedFilters],
  );
  // What the FILTERS button counts: every chip on either side, the Bookmarks
  // pill, a media kind, Liked and Flatten.
  const activeFilterCount =
    selectedTags.length +
    excludedFilters.length +
    Number(bookmarksOnly) +
    Number(mediaKind !== null) +
    Number(likedOnly) +
    Number(flattenStacks && viewMode === "grid");
  const [adminOpen, setAdminOpen] = useState(false);
  const [openPanel, setOpenPanel] = useState<"filters" | "views" | "manage" | null>(null);
  // Which pill is showing its minus affordance (hover or keyboard focus).
  const [hoveredFilterId, setHoveredFilterId] = useState<string | null>(null);
  const [railRef, railFade] = useChipRail<HTMLDivElement>(`${viewMode}:${Boolean(views)}:${Boolean(onPublishAll)}`);
  const islandRef = useRef<HTMLDivElement>(null);

  // A pill whose collection was deleted matches nothing — showing it would be
  // a dead click. The admin panel below still lists it so the owner can fix it.
  const visibleMenuFilters = useMemo(
    () => menuFilters.filter((entry) => !entry.missingFolder),
    [menuFilters],
  );

  // Menu pills filter assets; the Skills view has its own tag and collection chips.
  const showMenuChips =
    viewMode !== "skills" &&
    (menuFilters.length > 0 || canManageMenuFilters || Boolean(onBookmarksOnlyChange));
  const showManage = canManageMenuFilters || Boolean(onPublishAll);
  const viewName = views ? activeViewName(views) : null;

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
        ref={islandRef}
        className="lm-island lm-toolbar"
        style={{
          position: "relative",
          width: "100%",
          maxWidth: "1180px",
          borderRadius: "28px",
          marginBottom: "12px",
        }}
      >
        {/* One row. It scrolls sideways when the screen is narrower than it
            (phones), fading the edge with more behind it. */}
        <div
          ref={railRef}
          data-fade={railFade}
          className="lm-chip-rail flex items-center gap-1.5 overflow-x-auto"
          style={{ padding: "10px 12px", scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          <div
            className="lm-scope-segment flex shrink-0 items-center"
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

          <Divider />

          <ToolbarPopover
            id="filters"
            anchorRef={islandRef}
            open={openPanel === "filters"}
            onOpenChange={(open) => setOpenPanel(open ? "filters" : null)}
            label="Filters"
            icon={SlidersHorizontal}
            badge={activeFilterCount > 0 ? activeFilterCount : undefined}
            active={activeFilterCount > 0}
            ariaLabel={`Filters${activeFilterCount > 0 ? `, ${activeFilterCount} on` : ""}`}
            width={760}
          >
            <div className="flex items-center justify-between gap-3">
              <PanelHeading>Show</PanelHeading>
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
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              <ContentTypePills
                mediaKind={mediaKind}
                onMediaKindChange={onMediaKindChange}
                likedOnly={likedOnly}
                onLikedOnlyChange={onLikedOnlyChange}
                showLiked={showLiked}
                flattenStacks={flattenStacks}
                onFlattenStacksChange={viewMode === "grid" ? onFlattenStacksChange : undefined}
                outlined
              />
            </div>

            {showMenuChips ? (
              <>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <PanelHeading>Menu</PanelHeading>
                  <span
                    className="hidden md:inline"
                    style={{ fontSize: "9px", color: "var(--lm-text-ghost)", letterSpacing: "0.04em" }}
                  >
                    Click to show · the minus excludes
                  </span>
                  <span
                    className="md:hidden"
                    style={{ fontSize: "9px", color: "var(--lm-text-ghost)", letterSpacing: "0.04em" }}
                  >
                    Tap to show · hold to exclude
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-1.5">
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
                        border: bookmarksOnly ? "2px solid transparent" : "2px solid var(--lm-border)",
                        fontFamily: "var(--lm-font)",
                        fontSize: "10px",
                        fontWeight: 700,
                        letterSpacing: "0.10em",
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
                      className="px-1 py-2"
                      style={{
                        color: "var(--lm-text-ghost)",
                        fontFamily: "var(--lm-font)",
                        fontSize: "10px",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.14em",
                      }}
                    >
                      No menu filters yet{canManageMenuFilters ? " — add one under Manage" : ""}
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </ToolbarPopover>

          {views ? (
            <ToolbarPopover
              id="views"
              anchorRef={islandRef}
              open={openPanel === "views"}
              onOpenChange={(open) => setOpenPanel(open ? "views" : null)}
              label={viewName ? `View · ${viewName}` : "Views"}
              icon={LayoutTemplate}
              active={Boolean(viewName)}
              ariaLabel={viewName ? `Views, ${viewName} is on` : "Saved views"}
              width={420}
            >
              <ViewsPanel {...views} onApplied={() => setOpenPanel(null)} />
            </ToolbarPopover>
          ) : null}

          <Divider />

          <SortPills
            sortOrder={sortOrder}
            onSortOrderChange={onSortOrderChange}
          />
          {onGroupSimilarChange && viewMode === "grid" ? (
            <GroupSimilarControl on={groupSimilar} onChange={onGroupSimilarChange} similarity={similarity} onSimilarityChange={onSimilarityChange} />
          ) : null}
          {onGridZoomChange && viewMode === "grid" ? (
            <div className="hidden md:flex">
              <ZoomSlider value={gridZoom ?? 1} onChange={onGridZoomChange} />
            </div>
          ) : null}
          {onViewModeChange ? (
            <>
              <Divider />
              <ViewModeToggle
                viewMode={viewMode}
                onViewModeChange={onViewModeChange}
              />
            </>
          ) : null}

          {showManage ? (
            <>
              <div className="flex-1" style={{ minWidth: "4px" }} />
              <ToolbarPopover
                id="manage"
                anchorRef={islandRef}
                open={openPanel === "manage"}
                onOpenChange={(open) => setOpenPanel(open ? "manage" : null)}
                label="Manage"
                icon={Eye}
                active={adminOpen}
                ariaLabel="Manage this view"
                width={300}
                align="right"
                role="menu"
              >
                {canManageMenuFilters ? (
                  <MenuItem
                    icon={SlidersHorizontal}
                    title={adminOpen ? "Close the chip editor" : "Edit filter chips"}
                    hint="Add, rename or remove the menu's chips"
                    onClick={() => {
                      setAdminOpen((open) => !open);
                      setOpenPanel(null);
                    }}
                  />
                ) : null}
                {onPublishAll ? (
                  <MenuItem
                    icon={Eye}
                    title="Publish all private in this view…"
                    hint="Counts them on the server first, then asks"
                    onClick={() => {
                      setOpenPanel(null);
                      onPublishAll();
                    }}
                  />
                ) : null}
              </ToolbarPopover>
            </>
          ) : null}
        </div>

        {canManageMenuFilters && adminOpen ? (
          <>
            <div
              style={{
                height: "1px",
                backgroundColor: "var(--lm-border)",
                margin: "0 16px",
              }}
            />
            <MenuFilterAdmin
              ownerUserId={ownerUserId}
              menuFilters={menuFilters}
              onClose={() => setAdminOpen(false)}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

function Divider() {
  return (
    <div
      aria-hidden
      className="shrink-0"
      style={{
        width: "1px",
        height: "22px",
        backgroundColor: "var(--lm-border-strong)",
        margin: "0 4px",
      }}
    />
  );
}

function PanelHeading({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: "8px",
        fontWeight: 800,
        letterSpacing: "0.2em",
        textTransform: "uppercase",
        color: "var(--lm-text-ghost)",
      }}
    >
      {children}
    </span>
  );
}

const PHONE_QUERY = "(max-width: 767px)";

/**
 * A toolbar button that opens a panel under the row (a sheet above the
 * bottom bar on phones, see `.lm-toolbar-popover` in globals.css). The panel
 * is portalled to the body: the island clips its overflow and the chip rail
 * masks its edges, so a panel inside either would be cut. It is placed
 * from the island's rectangle (`anchorRef`) on wide screens; the phone sheet
 * is positioned by CSS alone. The panel stays open while its chips are
 * toggled; a click outside, Esc or the button closes it.
 */
function ToolbarPopover({
  id,
  anchorRef,
  open,
  onOpenChange,
  label,
  icon: Icon,
  badge,
  active = false,
  ariaLabel,
  width,
  align = "left",
  role = "dialog",
  children,
}: {
  id: string;
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  icon: typeof Heart;
  badge?: number;
  active?: boolean;
  ariaLabel?: string;
  width: number;
  align?: "left" | "right";
  role?: "dialog" | "menu";
  children: React.ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = `${useId()}-${id}`;
  const [placement, setPlacement] = useState<React.CSSProperties | null>(null);

  // Where the panel hangs on a wide screen: under the island, inset 12 px,
  // at most `width` wide, from the island's left or right edge. Measured on
  // open and again on resize and scroll (the bar is sticky, so it moves).
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      if (window.matchMedia(PHONE_QUERY).matches) {
        setPlacement(null);
        return;
      }
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const available = Math.max(200, rect.width - 24);
      const panelWidth = Math.min(width, available);
      setPlacement({
        position: "fixed",
        top: rect.bottom - 6,
        width: panelWidth,
        ...(align === "right"
          ? { left: rect.right - 12 - panelWidth }
          : { left: rect.left + 12 }),
      });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, anchorRef, width, align]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      onOpenChange(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  const lit = open || active;
  return (
    <div ref={rootRef} className="shrink-0" style={{ display: "contents" }}>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-haspopup={role}
        aria-controls={open ? panelId : undefined}
        aria-label={ariaLabel}
        data-toolbar-popover={id}
        className="flex shrink-0 items-center gap-1.5 px-3 py-1 transition-colors"
        style={{
          fontSize: "9px",
          fontWeight: 700,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
          color: lit ? "var(--lm-text-primary)" : "var(--lm-text-secondary)",
          border: lit ? "2px solid var(--lm-ink)" : "2px solid var(--lm-border-strong)",
          borderRadius: "999px",
          background: open ? "var(--lm-surface-2, var(--lm-surface-1))" : "var(--lm-surface-1)",
          fontFamily: "var(--lm-font)",
        }}
      >
        <Icon className="h-3 w-3" aria-hidden />
        {label}
        {badge !== undefined ? (
          <span
            aria-hidden
            className="inline-flex items-center justify-center tabular-nums"
            style={{
              minWidth: "16px",
              height: "16px",
              padding: "0 4px",
              borderRadius: "999px",
              fontSize: "9px",
              fontWeight: 800,
              letterSpacing: 0,
              color: "#fff",
              background: "linear-gradient(135deg, var(--gradient-1), var(--gradient-3))",
            }}
          >
            {badge}
          </span>
        ) : null}
        <ChevronDown
          className="h-3 w-3"
          aria-hidden
          style={{
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform var(--lm-duration-fast)",
            opacity: 0.6,
          }}
        />
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={panelRef}
              id={panelId}
              role={role}
              aria-label={ariaLabel ?? label}
              className="lm-toolbar-popover"
              data-align={align}
              style={placement ?? undefined}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  title,
  hint,
  onClick,
}: {
  icon: typeof Heart;
  title: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="lm-toolbar-menu-item flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors"
      style={{ borderRadius: "12px", fontFamily: "var(--lm-font)" }}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: "var(--lm-text-ghost)" }} aria-hidden />
      <span className="min-w-0">
        <span
          className="block"
          style={{
            fontSize: "10px",
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--lm-text-primary)",
          }}
        >
          {title}
        </span>
        {hint ? (
          <span className="block" style={{ fontSize: "10px", color: "var(--lm-text-ghost)", marginTop: "2px" }}>
            {hint}
          </span>
        ) : null}
      </span>
    </button>
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
}: {
  viewMode?: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}) {
  const buttonPadding = "4px 8px";

  return (
    <div
      className="flex shrink-0 items-center"
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
  outlined = false,
}: {
  mediaKind: MediaKind | null;
  onMediaKindChange: (kind: MediaKind | null) => void;
  likedOnly?: boolean;
  onLikedOnlyChange?: (next: boolean) => void;
  showLiked?: boolean;
  flattenStacks?: boolean;
  onFlattenStacksChange?: (next: boolean) => void;
  /** Inside a panel the pills sit on paper, so they get a border at rest. */
  outlined?: boolean;
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
            padding: outlined ? "5px 12px" : "4px 10px",
            background: active
              ? "linear-gradient(135deg, var(--gradient-1), var(--gradient-3))"
              : "transparent",
            color: active ? "#fff" : outlined ? "var(--lm-text-secondary)" : "var(--lm-text-ghost)",
            fontSize: outlined ? "10px" : "9px",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.14em",
            border: active
              ? "2px solid var(--gradient-1)"
              : outlined
                ? "2px solid var(--lm-border)"
                : "2px solid transparent",
            borderRadius: outlined ? "999px" : "12px",
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

