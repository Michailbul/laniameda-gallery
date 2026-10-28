"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { FileText, FolderOpen, Grid3X3, LayoutGrid, ScrollText } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export type CollectionTab = "pieces" | "folders" | "moodboards" | "docs" | "journal";

/**
 * The views of one collection, as tabs under its breadcrumb: its pieces, its
 * folders (a world's children) and its Moodboards panel with the board count.
 * Shown on every world root and style branch, and on any other collection
 * that has boards. Filters and saved views change the pieces, never the tabs.
 * A marked world (folders.worldKey) and every collection inside it also get
 * Instructions (WORLD.md, LEARNINGS.md, docs/ and the open_world context,
 * HUMAN or AGENT) right after Pieces, and Journal (every change, with undo).
 */
export function CollectionTabs({
  ownerUserId,
  collectionId,
  includeChildren,
  active,
  showFolders,
  showWorldTabs = false,
  always,
  onSelect,
}: {
  ownerUserId: string;
  collectionId: string;
  /** A world root counts its children's boards too. */
  includeChildren: boolean;
  active: CollectionTab;
  showFolders: boolean;
  /** Inside a marked world: adds Instructions and Journal. */
  showWorldTabs?: boolean;
  /** World roots and style branches: show even with no boards yet. */
  always: boolean;
  onSelect: (tab: CollectionTab) => void;
}) {
  const { isAuthenticated } = useConvexAuth();
  const boards = useQuery(
    api.moodboards.listMoodboards,
    isAuthenticated
      ? { ownerUserId, folderId: collectionId as Id<"folders">, includeChildren, previewLimit: 0 }
      : "skip",
  );
  const boardCount = boards?.length;
  if (!always && !showWorldTabs && !boardCount && active !== "moodboards") return null;

  const tabs: Array<{ key: CollectionTab; label: string; icon: typeof Grid3X3; count?: number; title: string }> = [
    { key: "pieces", label: "Pieces", icon: Grid3X3, title: "Every piece in this collection" },
    ...(showWorldTabs
      ? [{ key: "docs" as const, label: "Instructions", icon: FileText, title: "The world's WORLD.md, learnings and docs, as you read them or as an agent does (M)" }]
      : []),
    ...(showFolders
      ? [{ key: "folders" as const, label: "Folders", icon: FolderOpen, title: "The folders of this world" }]
      : []),
    {
      key: "moodboards",
      label: "Moodboards",
      icon: LayoutGrid,
      count: boardCount,
      title: "Looks to send to Midjourney, made from this collection's images",
    },
    ...(showWorldTabs
      ? [{ key: "journal" as const, label: "Journal", icon: ScrollText, title: "Every change to this world, with undo" }]
      : []),
  ];

  return (
    <div
      role="tablist"
      aria-label="Collection views"
      className="flex items-center gap-1 overflow-x-auto px-4 pb-1 pt-2 md:gap-1.5 md:px-6"
      style={{ fontFamily: "var(--lm-font)", scrollbarWidth: "none" }}
    >
      {tabs.map(({ key, label, icon: Icon, count, title }) => {
        const selected = key === active;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(key)}
            title={title}
            className="inline-flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 transition-all md:gap-2 md:px-3.5 md:py-[7px]"
            style={{
              borderRadius: "999px",
              background: selected
                ? "linear-gradient(135deg, var(--gradient-1), var(--gradient-3))"
                : "var(--lm-surface-2)",
              border: selected ? "2px solid var(--gradient-1)" : "2px solid var(--lm-border)",
              color: selected ? "#fff" : "var(--lm-text-secondary)",
              fontSize: "10px",
              fontWeight: 800,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            <Icon className="hidden h-3.5 w-3.5 sm:block" aria-hidden />
            {label}
            {key === "moodboards" && (
              <span
                className="font-mono"
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  padding: "1px 6px",
                  borderRadius: "8px",
                  background: selected ? "rgba(255,255,255,0.22)" : "var(--lm-surface-1)",
                  color: selected ? "#fff" : "var(--lm-text-tertiary)",
                }}
              >
                {count === undefined ? "–" : count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
