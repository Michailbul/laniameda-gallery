"use client";

import {
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ShowcaseMasonry } from "./showcase-masonry";
import type { ShowcaseAsset } from "./types";

const PAGE_SIZE = 72;

type BrowseScope = "published" | "everything";

// Built-in medium pills always lead the row; the owner's curated menu filters
// (Animation, Live action, …) follow. Everything the public can filter by is
// one of these — there is deliberately no tag cloud, model chip, or
// collection tree on the public surface.
type Pill =
  | { id: string; label: string; type: "all" }
  | { id: string; label: string; type: "kind"; kind: "image" | "video" }
  | { id: string; label: string; type: "tag"; tagIds: Id<"tags">[] }
  | { id: string; label: string; type: "collection"; folderId: Id<"folders"> };

// The Browse view. What it walks — the published slice or the whole vault —
// is the owner's setting on the backend (convex/publicSurface.ts). The grid
// only reads it, and re-keys on it so a flip restarts the scroll from the top
// instead of handing the next page a cursor from the other slice.
export function BrowseBand({
  ownerControls = false,
}: {
  /** Signed-in owner: show the scope control. Visitors never get it. */
  ownerControls?: boolean;
}) {
  const settings = useQuery(api.publicSurface.getPublicSurfaceSettings, {});
  const browseScope: BrowseScope = settings?.browseScope ?? "published";

  return (
    <BrowseArchive
      key={browseScope}
      browseScope={browseScope}
      ownerControl={
        ownerControls ? (
          <BrowseScopeControl
            value={browseScope}
            pending={settings === undefined}
          />
        ) : null
      }
    />
  );
}

function BrowseArchive({
  browseScope,
  ownerControl,
}: {
  browseScope: BrowseScope;
  ownerControl: ReactNode;
}) {
  const [activeId, setActiveId] = useState("all");
  const [zoom, setZoom] = useZoomPreference();

  const menuFilters = useQuery(api.menuFilters.listPublicMenuFilters, {});

  const pills = useMemo<Pill[]>(() => {
    const base: Pill[] = [
      { id: "all", label: "All", type: "all" },
      { id: "kind:video", label: "Video", type: "kind", kind: "video" },
      { id: "kind:image", label: "Stills", type: "kind", kind: "image" },
    ];
    const curated = (menuFilters ?? [])
      // A pill that matches nothing public would dead-end the visitor.
      .filter((entry) => entry.count > 0)
      .map<Pill | null>((entry) =>
        entry.kind === "tag"
          ? {
              id: entry._id,
              label: entry.label,
              type: "tag",
              tagIds: entry.tagIds,
            }
          : entry.folderId
            ? {
                id: entry._id,
                label: entry.label,
                type: "collection",
                folderId: entry.folderId,
              }
            : null,
      )
      .filter((pill): pill is Pill => pill !== null);
    return [...base, ...curated];
  }, [menuFilters]);

  const active = pills.find((pill) => pill.id === activeId) ?? pills[0];

  const paged = usePaginatedQuery(
    api.assets.listPublicGalleryAssetsPage,
    {
      kind: active?.type === "kind" ? active.kind : undefined,
      tagIds: active?.type === "tag" ? active.tagIds : undefined,
      folderId: active?.type === "collection" ? active.folderId : undefined,
    },
    { initialNumItems: PAGE_SIZE },
  );

  const assets = useMemo(
    () => (paged.results ?? []) as ShowcaseAsset[],
    [paged.results],
  );

  // MasonryGrid fires this repeatedly while its frontier is exposed, so the
  // status guard is what stops duplicate page fetches.
  const loadMore = useCallback(() => {
    if (paged.status === "CanLoadMore") paged.loadMore(PAGE_SIZE);
  }, [paged]);

  return (
    // Full-bleed: the grid runs the whole page width, only the gutter is held
    // back. No max-width container here.
    <section style={{ padding: "0 clamp(16px, 3vw, 32px) 40px" }}>
      {/* Filter row: pills on the left, owner control and tile size on the right. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 24,
          margin: "0 0 28px",
          paddingBottom: 16,
          borderBottom: "1px solid var(--lm-border)",
          flexWrap: "wrap",
        }}
      >
        <div
          role="tablist"
          aria-label="Browse filters"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "6px 20px",
          }}
        >
          {pills.map((pill) => {
            const isActive = pill.id === active?.id;
            return (
              <button
                key={pill.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveId(pill.id)}
                style={pillStyle(isActive)}
              >
                {pill.label}
              </button>
            );
          })}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 28,
            flexWrap: "wrap",
          }}
        >
          {ownerControl}
          <TileSizeSlider value={zoom} onChange={setZoom} />
        </div>
      </div>

      {assets.length === 0 && paged.status !== "LoadingFirstPage" ? (
        <p
          style={{
            fontFamily: "var(--lm-font)",
            fontSize: 12,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--lm-text-ghost)",
            padding: "40px 0",
          }}
        >
          {browseScope === "everything"
            ? "Nothing here yet."
            : "Nothing published here yet."}
        </p>
      ) : (
        // The grid owns its own frontier callback, so no sentinel here.
        <ShowcaseMasonry
          key={active?.id}
          assets={assets}
          zoom={zoom}
          loading={paged.status === "LoadingFirstPage"}
          onEndReached={loadMore}
        />
      )}
    </section>
  );
}

// Owner-only: which slice Browse shows. Two words in the pill language, the
// active one coral. Writes go through the app's own server route, which checks
// the session against the curator list before touching the backend.
function BrowseScopeControl({
  value,
  pending,
}: {
  value: BrowseScope;
  pending: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = useCallback(
    async (next: BrowseScope) => {
      if (next === value || busy) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/public-surface", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ browseScope: next }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(body?.error ?? `Request failed (${res.status})`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "That didn't work.");
      } finally {
        setBusy(false);
      }
    },
    [value, busy],
  );

  return (
    <div
      role="group"
      aria-label="What Browse shows"
      title="Owner only — visitors never see this"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 14,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          fontFamily: "var(--lm-font)",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "var(--lm-text-ghost)",
        }}
      >
        Browse shows
      </span>
      {SCOPE_OPTIONS.map((option) => {
        const isActive = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={isActive}
            disabled={busy || pending}
            onClick={() => void choose(option.id)}
            style={{
              ...pillStyle(isActive),
              cursor: busy || pending ? "wait" : "pointer",
            }}
          >
            {option.label}
          </button>
        );
      })}
      {error && (
        <span
          role="alert"
          style={{
            fontFamily: "var(--lm-font)",
            fontSize: 10,
            letterSpacing: "0.06em",
            color: "var(--lm-coral)",
          }}
        >
          {error}
        </span>
      )}
    </div>
  );
}

const SCOPE_OPTIONS: ReadonlyArray<{ id: BrowseScope; label: string }> = [
  { id: "published", label: "Published only" },
  { id: "everything", label: "Everything" },
];

// One text-only control style for pills and the scope toggle: the active word
// is coral on a hairline, the rest sit quiet.
const pillStyle = (isActive: boolean): React.CSSProperties => ({
  background: "none",
  border: "none",
  padding: "4px 0",
  cursor: "pointer",
  fontFamily: "var(--lm-font)",
  fontSize: 11.5,
  fontWeight: isActive ? 700 : 500,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: isActive ? "var(--lm-coral)" : "var(--lm-text-tertiary)",
  borderBottom: isActive
    ? "2px solid var(--lm-coral)"
    : "2px solid transparent",
  transition: "color 150ms ease",
});

// Tile size, mirroring the vault's grid-zoom control (0.4–1) and sharing its
// stored value, so the size you like carries between the two surfaces.
const ZOOM_STORAGE_KEY = "laniameda-grid-zoom";

// Tile size lives in localStorage, shared with the vault's grid-zoom control.
// Read through useSyncExternalStore (the same pattern lib/use-theme.ts uses)
// so the server snapshot hydrates cleanly without a setState-in-effect.
const zoomListeners = new Set<() => void>();
let zoomCache: number | null = null;

const clampZoom = (value: number) => Math.min(1, Math.max(0.4, value));

function readZoom(): number {
  if (zoomCache !== null) return zoomCache;
  try {
    const stored = Number(window.localStorage.getItem(ZOOM_STORAGE_KEY));
    zoomCache = Number.isFinite(stored) && stored > 0 ? clampZoom(stored) : 1;
  } catch {
    zoomCache = 1;
  }
  return zoomCache;
}

function subscribeZoom(onChange: () => void) {
  zoomListeners.add(onChange);
  // Must return the unsubscribe FUNCTION — an arrow returning Set.delete()'s
  // boolean is not what React calls on cleanup.
  return () => {
    zoomListeners.delete(onChange);
  };
}

export function useZoomPreference(): [number, (next: number) => void] {
  const zoom = useSyncExternalStore(subscribeZoom, readZoom, () => 1);

  const setZoom = useCallback((next: number) => {
    zoomCache = clampZoom(next);
    try {
      window.localStorage.setItem(ZOOM_STORAGE_KEY, String(zoomCache));
    } catch {
      // Private mode — the session still gets the size it picked.
    }
    for (const listener of zoomListeners) listener();
  }, []);

  return [zoom, setZoom];
}

export function TileSizeSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (zoom: number) => void;
}) {
  return (
    <label
      title="Tile size"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          fontFamily: "var(--lm-font)",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "var(--lm-text-ghost)",
        }}
      >
        Size
      </span>
      <input
        type="range"
        min={0.4}
        max={1}
        step={0.05}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label="Tile size"
        style={{ width: 110, accentColor: "var(--lm-coral)", cursor: "pointer" }}
      />
    </label>
  );
}
