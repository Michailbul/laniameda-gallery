"use client";

/* eslint-disable @next/next/no-img-element */
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { FolderOpen, Pencil } from "lucide-react";
import { fitChipsInRows } from "@/lib/chip-rows";
import { compareCollectionSectionNames } from "@/lib/collection-sections";

// A collection card's data: summary from folders.listCollectionSummaries
// merged with the dashboard's live folderAssetCounts.
export interface CollectionCardData {
  _id: string;
  name: string;
  description?: string;
  parentFolderId?: string;
  count: number;
  previewAssets: Array<{
    assetId: string;
    kind: "image" | "video";
    url?: string;
    thumbUrl?: string;
  }>;
}

interface CollectionsGridProps {
  collections: CollectionCardData[];
  /** Opens a collection: filters the asset grid to it. */
  onOpenCollection: (folderId: string) => void;
  /** When set, cards grow a hover pencil for inline renaming. */
  onRenameCollection?: (folderId: string, name: string) => Promise<void> | void;
  loading?: boolean;
}

/**
 * The gallery's "collections" browse view — the vault as an interactive
 * portfolio of folders. Root collections render as stack cards (cover +
 * peeking sheets); sub-collections surface as chips on their parent's card
 * and open directly.
 */
export function CollectionsGrid({
  collections,
  onOpenCollection,
  onRenameCollection,
  loading = false,
}: CollectionsGridProps) {
  const { roots, childrenByParent } = useMemo(() => {
    const ids = new Set(collections.map((c) => c._id));
    const rootList: CollectionCardData[] = [];
    const children = new Map<string, CollectionCardData[]>();
    for (const collection of collections) {
      if (collection.parentFolderId && ids.has(collection.parentFolderId)) {
        const list = children.get(collection.parentFolderId) ?? [];
        list.push(collection);
        children.set(collection.parentFolderId, list);
      } else {
        rootList.push(collection);
      }
    }
    rootList.sort((a, b) => a.name.localeCompare(b.name));
    for (const list of children.values()) {
      list.sort((a, b) => compareCollectionSectionNames(a.name, b.name));
    }
    return { roots: rootList, childrenByParent: children };
  }, [collections]);

  if (loading) {
    return (
      <div
        className="flex min-h-[40vh] items-center justify-center"
        style={{
          fontFamily: "var(--lm-font)",
          fontSize: "10px",
          fontWeight: 700,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--lm-text-ghost)",
        }}
      >
        Loading collections…
      </div>
    );
  }

  if (roots.length === 0) {
    return (
      <div
        className="flex min-h-[40vh] flex-col items-center justify-center gap-3 px-8 text-center"
        style={{ fontFamily: "var(--lm-font)" }}
      >
        <FolderOpen
          className="h-6 w-6"
          style={{ color: "var(--lm-text-ghost)" }}
        />
        <p
          style={{
            fontSize: "11px",
            fontWeight: 600,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--lm-text-tertiary)",
            margin: 0,
          }}
        >
          No collections yet. Create one from the sidebar, or select assets and
          use ADD TO.
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 pb-24 pt-2 md:px-6">
      {roots.length > 0 && (
        <>
          <div
            className="grid gap-6"
            style={{
              gridTemplateColumns:
                "repeat(auto-fill, minmax(min(100%, 300px), 1fr))",
            }}
          >
            {roots.map((collection) => (
              <CollectionCard
                key={collection._id}
                collection={collection}
                childCollections={childrenByParent.get(collection._id) ?? []}
                onOpen={onOpenCollection}
                onRename={
                  onRenameCollection
                    ? (name) => onRenameCollection(collection._id, name)
                    : undefined
                }
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function CollectionCard({
  collection,
  childCollections,
  onOpen,
  onRename,
}: {
  collection: CollectionCardData;
  childCollections: CollectionCardData[];
  onOpen: (folderId: string) => void;
  onRename?: (name: string) => Promise<void> | void;
}) {
  const [cover, ...rest] = collection.previewAssets;
  const coverSrc = cover ? (cover.thumbUrl ?? cover.url) : undefined;
  const layers = rest.slice(0, 2);
  // Inline rename: pencil (hover) swaps the title for an input.
  const [renameDraft, setRenameDraft] = useState<string | null>(null);
  const commitRename = () => {
    const name = (renameDraft ?? "").trim();
    setRenameDraft(null);
    if (!name || name === collection.name || !onRename) return;
    void onRename(name);
  };

  return (
    <div className="group/collection">
      <button
        type="button"
        onClick={() => onOpen(collection._id)}
        className="block w-full cursor-pointer border-none bg-transparent p-0 text-left"
        aria-label={`Open ${collection.name}`}
      >
        <div className="relative pt-2.5">
          {/* Peeking sheets behind the cover. */}
          {layers.map((layer, i) => {
            const src = layer.thumbUrl ?? layer.url;
            return (
              <div
                key={layer.assetId}
                aria-hidden
                className="absolute inset-x-0 top-2.5 bottom-0 overflow-hidden"
                style={{
                  borderRadius: "10px",
                  transform: `rotate(${i === 0 ? -2.2 : 1.8}deg) translateY(${i === 0 ? -7 : -4}px) scale(${i === 0 ? 0.94 : 0.97})`,
                  transformOrigin: "50% 100%",
                  opacity: 0.5,
                  backgroundColor: "var(--lm-surface-2)",
                }}
              >
                {src && (
                  <img
                    src={src}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
            );
          })}
          <div
            className="relative overflow-hidden transition-transform duration-200 group-hover/collection:-translate-y-0.5"
            style={{
              aspectRatio: "4 / 3",
              borderRadius: "10px",
              backgroundColor: "var(--lm-surface-2)",
              border: "1px solid var(--lm-border-strong)",
            }}
          >
            {coverSrc ? (
              <img
                src={coverSrc}
                alt={collection.name}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="grid h-full w-full place-items-center">
                <FolderOpen
                  className="h-6 w-6"
                  style={{ color: "var(--lm-text-ghost)" }}
                />
              </div>
            )}
            {/* Count badge */}
            <span
              className="absolute bottom-2.5 right-2.5 rounded px-2 py-0.5 backdrop-blur-sm"
              style={{
                fontFamily: "var(--lm-font)",
                fontSize: "10px",
                fontWeight: 800,
                letterSpacing: "0.08em",
                backgroundColor: "var(--image-card-badge-bg)",
                color: "var(--image-card-badge-text)",
              }}
            >
              {collection.count}
            </span>
          </div>
        </div>
        <div className="px-0.5 pt-3">
          {renameDraft !== null ? (
            <input
              autoFocus
              value={renameDraft}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setRenameDraft(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitRename();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setRenameDraft(null);
                }
              }}
              onBlur={commitRename}
              className="w-full bg-transparent outline-none"
              style={{
                fontFamily: "var(--lm-font)",
                fontSize: "13px",
                fontWeight: 800,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--lm-text-primary)",
                borderBottom: "1px solid var(--lm-coral)",
                caretColor: "var(--lm-coral)",
              }}
              aria-label={`Rename ${collection.name}`}
            />
          ) : (
            <span className="flex items-center gap-1.5">
              <h3
                style={{
                  fontFamily: "var(--lm-font)",
                  fontSize: "13px",
                  fontWeight: 800,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--lm-text-primary)",
                  margin: 0,
                }}
              >
                {collection.name}
              </h3>
              {onRename && (
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    setRenameDraft(collection.name);
                  }}
                  className="flex h-4 w-4 items-center justify-center opacity-0 transition-opacity group-hover/collection:opacity-100"
                  style={{ color: "var(--lm-text-ghost)" }}
                  aria-label={`Rename ${collection.name}`}
                  title="Rename collection"
                >
                  <Pencil className="h-3 w-3" />
                </span>
              )}
            </span>
          )}
          {collection.description && (
            <p
              className="mt-1 line-clamp-2"
              style={{
                fontFamily: "var(--lm-font)",
                fontSize: "11px",
                lineHeight: 1.5,
                color: "var(--lm-text-tertiary)",
                margin: 0,
              }}
            >
              {collection.description}
            </p>
          )}
        </div>
      </button>
      {/* Sub-collections open directly from the chip row. */}
      {childCollections.length > 0 && (
        <SubCollectionChips
          parentName={collection.name}
          childCollections={childCollections}
          onOpen={onOpen}
        />
      )}
    </div>
  );
}

const CHIP_GAP = 6;
const CHIP_ROWS = 2;

const chipStyle: React.CSSProperties = {
  fontFamily: "var(--lm-font)",
  fontSize: "9px",
  fontWeight: 700,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--lm-text-secondary)",
  border: "1px solid var(--lm-border-strong)",
  backgroundColor: "transparent",
  cursor: "pointer",
  whiteSpace: "nowrap",
  maxWidth: "100%",
};

const chipClass =
  "interactive-ghost inline-flex min-w-0 shrink-0 items-center gap-1 rounded-full px-2.5 py-1";

/**
 * A parent card's sub-collection chips, held to two lines so every card in
 * the grid keeps the same footprint. The rest sit behind a "+N" chip that
 * unfolds them in place.
 */
function SubCollectionChips({
  parentName,
  childCollections,
  onOpen,
}: {
  parentName: string;
  childCollections: CollectionCardData[];
  onOpen: (folderId: string) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(childCollections.length);
  const [expanded, setExpanded] = useState(false);

  // Pack the chips off-screen at their natural widths, then keep as many as
  // fit in two lines. Re-runs when the card resizes or fonts land.
  useLayoutEffect(() => {
    const row = rowRef.current;
    const measure = measureRef.current;
    if (!row || !measure) return;
    const fit = () => {
      const nodes = Array.from(measure.children) as HTMLElement[];
      const more = nodes.pop();
      setVisibleCount(
        fitChipsInRows({
          widths: nodes.map((node) => node.offsetWidth),
          rowWidth: row.clientWidth,
          gap: CHIP_GAP,
          maxRows: CHIP_ROWS,
          moreWidth: more?.offsetWidth ?? 0,
        }),
      );
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(row);
    observer.observe(measure);
    return () => observer.disconnect();
  }, [childCollections]);

  const hidden = childCollections.length - visibleCount;
  const shown = expanded ? childCollections : childCollections.slice(0, visibleCount);

  return (
    <div className="relative mt-2 px-0.5">
      <div
        ref={measureRef}
        aria-hidden
        className="pointer-events-none invisible absolute left-0 top-0 flex"
        style={{ gap: CHIP_GAP }}
      >
        {childCollections.map((child) => (
          <span key={child._id} className={chipClass} style={chipStyle}>
            <ChipLabel child={child} />
          </span>
        ))}
        <span className={chipClass} style={chipStyle}>
          +{childCollections.length}
        </span>
      </div>
      <div ref={rowRef} className="flex flex-wrap" style={{ gap: CHIP_GAP }}>
        {shown.map((child) => (
          <button
            key={child._id}
            type="button"
            onClick={() => onOpen(child._id)}
            className={chipClass}
            style={chipStyle}
            title={child.name}
            aria-label={`Open ${parentName} / ${child.name}`}
          >
            <ChipLabel child={child} />
          </button>
        ))}
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((open) => !open)}
            className={chipClass}
            style={{ ...chipStyle, color: "var(--lm-text-primary)" }}
            aria-expanded={expanded}
            aria-label={
              expanded
                ? `Show fewer ${parentName} sub-collections`
                : `Show ${hidden} more ${parentName} sub-collections`
            }
          >
            {expanded ? "Less" : `+${hidden}`}
          </button>
        )}
      </div>
    </div>
  );
}

function ChipLabel({ child }: { child: CollectionCardData }) {
  return (
    <>
      <span className="truncate">{child.name}</span>
      <span style={{ color: "var(--lm-text-ghost)" }}>{child.count}</span>
    </>
  );
}
