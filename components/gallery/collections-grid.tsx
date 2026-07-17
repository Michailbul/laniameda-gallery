"use client";

/* eslint-disable @next/next/no-img-element */
import { useMemo } from "react";
import { FolderOpen, Layers } from "lucide-react";

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

// A project card: same visual as a collection card, from listProjects.
export interface ProjectCardData {
  _id: string;
  name: string;
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
  /** Projects lead the browse view; opening one expands its whole pool. */
  projects?: ProjectCardData[];
  onOpenProject?: (projectId: string, name: string) => void;
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
  projects = [],
  onOpenProject,
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
      list.sort((a, b) => a.name.localeCompare(b.name));
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

  if (roots.length === 0 && projects.length === 0) {
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
      {/* Projects lead — they're the packaged, presentable work. */}
      {projects.length > 0 && onOpenProject && (
        <>
          <SectionLabel label="Projects" count={projects.length} />
          <div
            className="grid gap-6"
            style={{
              gridTemplateColumns:
                "repeat(auto-fill, minmax(min(100%, 300px), 1fr))",
            }}
          >
            {projects.map((project) => (
              <ProjectCard
                key={project._id}
                project={project}
                onOpen={onOpenProject}
              />
            ))}
          </div>
        </>
      )}

      {roots.length > 0 && (
        <>
          {projects.length > 0 && (
            <SectionLabel label="Collections" count={roots.length} topGap />
          )}
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
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SectionLabel({
  label,
  count,
  topGap = false,
}: {
  label: string;
  count: number;
  topGap?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline gap-2 pb-3 ${topGap ? "pt-8" : "pt-1"}`}
      style={{ fontFamily: "var(--lm-font)" }}
    >
      <span
        style={{
          fontSize: "10px",
          fontWeight: 800,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: "var(--lm-text-ghost)",
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: "10px", color: "var(--lm-text-ghost)" }}>
        {count}
      </span>
    </div>
  );
}

function ProjectCard({
  project,
  onOpen,
}: {
  project: ProjectCardData;
  onOpen: (projectId: string, name: string) => void;
}) {
  const [cover, ...rest] = project.previewAssets;
  const coverSrc = cover ? (cover.thumbUrl ?? cover.url) : undefined;
  const layers = rest.slice(0, 2);

  return (
    <button
      type="button"
      onClick={() => onOpen(project._id, project.name)}
      className="group/collection block w-full cursor-pointer border-none bg-transparent p-0 text-left"
      aria-label={`Open project ${project.name}`}
    >
      <div className="relative pt-2.5">
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
              alt={project.name}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="grid h-full w-full place-items-center">
              <Layers
                className="h-6 w-6"
                style={{ color: "var(--lm-text-ghost)" }}
              />
            </div>
          )}
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
            {project.count}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1.5 px-0.5 pt-3">
        <Layers
          className="h-3 w-3 flex-shrink-0"
          style={{ color: "var(--lm-coral)" }}
        />
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
          {project.name}
        </h3>
      </div>
    </button>
  );
}

function CollectionCard({
  collection,
  childCollections,
  onOpen,
}: {
  collection: CollectionCardData;
  childCollections: CollectionCardData[];
  onOpen: (folderId: string) => void;
}) {
  const [cover, ...rest] = collection.previewAssets;
  const coverSrc = cover ? (cover.thumbUrl ?? cover.url) : undefined;
  const layers = rest.slice(0, 2);

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
        <div className="mt-2 flex flex-wrap gap-1.5 px-0.5">
          {childCollections.map((child) => (
            <button
              key={child._id}
              type="button"
              onClick={() => onOpen(child._id)}
              className="interactive-ghost inline-flex items-center gap-1 rounded-full px-2.5 py-1"
              style={{
                fontFamily: "var(--lm-font)",
                fontSize: "9px",
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "var(--lm-text-secondary)",
                border: "1px solid var(--lm-border-strong)",
                backgroundColor: "transparent",
                cursor: "pointer",
              }}
              aria-label={`Open ${collection.name} / ${child.name}`}
            >
              {child.name}
              <span style={{ color: "var(--lm-text-ghost)" }}>
                {child.count}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
