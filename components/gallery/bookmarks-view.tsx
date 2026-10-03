"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { Search, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { MasonryGrid } from "@/components/masonry-grid";
import { XGlyph } from "@/components/gallery/bookmark-post-card";
import {
  buildGalleryEntries,
  type GalleryAssetRecord,
  type GalleryEntry,
} from "@/lib/gallery-entries";
import { filterBookmarkEntries } from "@/lib/bookmarks";

type FolderLite = { _id: string; name: string; parentFolderId?: string };

type MasonryGridProps = React.ComponentProps<typeof MasonryGrid>;

type BookmarksViewProps = {
  ownerUserId?: string;
  folders: FolderLite[];
  resolveEntryBadges?: (
    entry: GalleryEntry,
  ) => Pick<GalleryEntry, "collectionLabels" | "typeLabel"> | null;
  onImageSelect: MasonryGridProps["onImageSelect"];
  selectedImageId?: string;
  onImageLoad?: MasonryGridProps["onImageLoad"];
};

const headingStyle: React.CSSProperties = {
  fontFamily: "var(--lm-font)",
  fontSize: "13px",
  fontWeight: 800,
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: "var(--lm-text-primary)",
};

const chipStyle = (active: boolean): React.CSSProperties => ({
  fontFamily: "var(--lm-font)",
  fontSize: "11px",
  fontWeight: 650,
  padding: "5px 10px",
  borderRadius: "999px",
  border: `1px solid ${active ? "var(--lm-ink)" : "var(--lm-border-subtle)"}`,
  background: active ? "var(--lm-ink)" : "var(--lm-surface-0)",
  color: active ? "var(--lm-paper)" : "var(--lm-text-secondary)",
  whiteSpace: "nowrap",
});

// The dedicated home for saved X posts: every bookmark as a post card,
// narrowed by collection and searchable by text, author and note.
export function BookmarksView({
  ownerUserId,
  folders,
  resolveEntryBadges,
  onImageSelect,
  selectedImageId,
  onImageLoad,
}: BookmarksViewProps) {
  const [folderId, setFolderId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const rows = useQuery(
    api.bookmarks.listBookmarks,
    ownerUserId ? { ownerUserId, limit: 500 } : "skip",
  );

  const entries = useMemo(() => {
    if (!rows) return [];
    return buildGalleryEntries({
      assets: rows as unknown as GalleryAssetRecord[],
      sortOrder: "newest",
      promoteStarred: false,
      flattenStacks: true,
    }).map((entry) => {
      const badges = resolveEntryBadges?.(entry);
      // This view is about the posts: a media piece linked to its post shows
      // as the post here, not as a bare image.
      return { ...entry, ...(badges ?? {}), postCard: Boolean(entry.bookmark) };
    });
  }, [resolveEntryBadges, rows]);

  // Collections that actually hold bookmarks, with counts. A root collection
  // counts its sub-collections' posts too.
  const { chips, scopeIds } = useMemo(() => {
    const parentById = new Map(folders.map((folder) => [folder._id, folder.parentFolderId]));
    const counts = new Map<string, Set<string>>();
    for (const entry of entries) {
      for (const id of entry.folderIds ?? []) {
        for (const scope of [id, parentById.get(id)]) {
          if (!scope) continue;
          const set = counts.get(scope) ?? new Set<string>();
          set.add(entry.id);
          counts.set(scope, set);
        }
      }
    }
    const nameById = new Map(folders.map((folder) => [folder._id, folder.name]));
    const chipList = [...counts.entries()]
      .filter(([id]) => nameById.has(id))
      .map(([id, ids]) => ({
        id,
        name: nameById.get(id)!,
        count: ids.size,
        isChild: Boolean(parentById.get(id)),
      }))
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
    const scope = folderId
      ? new Set([
          folderId,
          ...folders.filter((folder) => folder.parentFolderId === folderId).map((folder) => folder._id),
        ])
      : null;
    return { chips: chipList, scopeIds: scope };
  }, [entries, folderId, folders]);

  const visible = useMemo(
    () => filterBookmarkEntries(entries, { folderIds: scopeIds, query }),
    [entries, query, scopeIds],
  );

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-2 pt-4">
        <h2 className="flex items-center gap-2" style={headingStyle}>
          <XGlyph className="h-3.5 w-3.5" />
          Bookmarks
          <span
            style={{
              fontSize: "11px",
              fontWeight: 600,
              letterSpacing: "0.08em",
              color: "var(--lm-text-tertiary)",
            }}
          >
            {rows ? visible.length : "…"}
          </span>
        </h2>
        <label
          className="flex min-w-[200px] max-w-[320px] flex-1 items-center gap-2 rounded-full px-3 py-1.5"
          style={{
            border: "1px solid var(--lm-border-subtle)",
            background: "var(--lm-surface-0)",
          }}
        >
          <Search className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--lm-text-ghost)" }} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search posts, authors, notes"
            className="min-w-0 flex-1 bg-transparent outline-none"
            style={{ fontFamily: "var(--lm-font)", fontSize: "12px", color: "var(--lm-text-primary)" }}
          />
          {query ? (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search">
              <X className="h-3.5 w-3.5" style={{ color: "var(--lm-text-ghost)" }} />
            </button>
          ) : null}
        </label>
      </div>

      {chips.length > 0 ? (
        <div className="flex gap-1.5 overflow-x-auto px-4 pb-3">
          <button type="button" style={chipStyle(folderId === null)} onClick={() => setFolderId(null)}>
            All
          </button>
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              style={chipStyle(folderId === chip.id)}
              onClick={() => setFolderId(folderId === chip.id ? null : chip.id)}
            >
              {chip.name}
              <span style={{ marginLeft: 6, opacity: 0.6 }}>{chip.count}</span>
            </button>
          ))}
        </div>
      ) : null}

      {rows === undefined ? (
        <MasonryGrid images={[]} loading compactColumns={false} />
      ) : visible.length > 0 ? (
        <MasonryGrid
          images={visible}
          compactColumns={false}
          onImageSelect={onImageSelect}
          selectedImageId={selectedImageId}
          onImageLoad={onImageLoad}
        />
      ) : (
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 px-8 py-12 text-center lm-animate-fade-in">
          <p
            style={{
              fontFamily: "var(--lm-font)",
              fontSize: "11px",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              color: "var(--lm-text-tertiary)",
            }}
          >
            {entries.length === 0
              ? "No bookmarks yet. Use the Save button on any post on x.com."
              : "No bookmarks match."}
          </p>
        </div>
      )}
    </div>
  );
}
