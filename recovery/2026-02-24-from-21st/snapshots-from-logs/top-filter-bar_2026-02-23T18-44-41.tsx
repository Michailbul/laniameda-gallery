"use client";

import { useRef } from "react";

interface Folder {
  _id: string;
  name: string;
}

interface Tag {
  _id: string;
  name: string;
  usageCount?: number;
}

export type SortOrder = "featured" | "newest" | "popular";
export type ViewMode = "public" | "my";

interface TopFilterBarProps {
  tags: Tag[];
  folders: Folder[];
  selectedFolderId: string | null;
  onFolderSelect: (folderId: string | null) => void;
  sortOrder: SortOrder;
  onSortOrderChange: (order: SortOrder) => void;
  selectedTags?: string[];
  onTagToggle?: (tag: string) => void;
  onClearAllTags?: () => void;
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
  isLoggedIn?: boolean;
}

const SORT_OPTIONS: { label: string; value: SortOrder }[] = [
  { label: "Featured", value: "featured" },
  { label: "Newest", value: "newest" },
  { label: "Popular", value: "popular" },
];

export function TopFilterBar({
  tags,
  folders,
  selectedFolderId,
  onFolderSelect,
  sortOrder,
  onSortOrderChange,
  selectedTags,
  onTagToggle,
  onClearAllTags,
  viewMode = "public",
  onViewModeChange,
  isLoggedIn = false,
}: TopFilterBarProps) {
  const folderScrollRef = useRef<HTMLDivElement>(null);
  const tagScrollRef = useRef<HTMLDivElement>(null);

  return (
    <div
      className="sticky top-0 z-30"
      style={{
        backgroundColor: "var(--paper)",
        borderBottom: "1px solid var(--border-default)",
      }}
    >
      {/* ── Row 1: View mode + Folder tabs + Sort ── */}
      <div className="flex h-12 items-center justify-between">
        {/* Left: view mode segmented control + folder tabs */}
        <div className="flex flex-1 items-center gap-1.5 overflow-hidden">
          {/* Segmented control: Public / Mine */}
          <div
            className="ml-4 flex flex-shrink-0 items-center rounded-lg p-0.5"
            style={{ backgroundColor: "var(--surface-2)" }}
          >
            <SegmentButton
              label="Public"
              active={viewMode === "public"}
              onClick={() => onViewModeChange?.("public")}
            />
            {isLoggedIn && (
              <SegmentButton
                label="Mine"
                active={viewMode === "my"}
                onClick={() => onViewModeChange?.("my")}
              />
            )}
          </div>

          {/* Divider */}
          <div
            className="h-5 w-px flex-shrink-0"
            style={{
              background:
                "linear-gradient(180deg, transparent 0%, var(--border-default) 50%, transparent 100%)",
            }}
          />

          {/* Folder tabs */}
          <div
            ref={folderScrollRef}
            className="flex flex-1 items-center gap-1.5 overflow-x-auto pr-4"
            style={{ scrollbarWidth: "none" }}
            onWheel={(e) => {
              if (folderScrollRef.current && e.deltaY !== 0) {
                e.preventDefault();
                folderScrollRef.current.scrollLeft += e.deltaY;
              }
            }}
          >
            <FolderTab
              label="All"
              active={selectedFolderId === null}
              onClick={() => onFolderSelect(null)}
            />
            {folders.map((folder) => (
              <FolderTab
                key={folder._id}
                label={folder.name}
                active={selectedFolderId === folder._id}
                onClick={() => onFolderSelect(folder._id)}
              />
            ))}
          </div>
        </div>

        {/* Divider */}
        <div
          className="h-6 w-px flex-shrink-0"
          style={{
            background:
              "linear-gradient(180deg, transparent 0%, var(--border-default) 50%, transparent 100%)",
          }}
        />

        {/* Right: sort options */}
        <div className="flex flex-shrink-0 items-center gap-1 px-4">
          {SORT_OPTIONS.map((option) => (
            <SortPill
              key={option.value}
              label={option.label}
              active={sortOrder === option.value}
              onClick={() => onSortOrderChange(option.value)}
            />
          ))}
        </div>
      </div>

      {/* ── Row 2: Horizontal tag strip ── */}
      <div
        ref={tagScrollRef}
        className="flex items-center gap-1.5 overflow-x-auto px-4 py-2"
        style={{
          scrollbarWidth: "none",
          borderTop: "1px solid var(--border-subtle)",
        }}
        onWheel={(e) => {
          if (tagScrollRef.current && e.deltaY !== 0) {
            e.preventDefault();
            tagScrollRef.current.scrollLeft += e.deltaY;
          }
        }}
      >
        <TagChip
          label="All"
          active={!selectedTags?.length}
          onClick={() => onClearAllTags?.()}
        />
        {tags.map((tag) => (
          <TagChip
            key={tag._id}
            label={tag.name}
            count={tag.usageCount}
            active={selectedTags?.includes(tag.name) ?? false}
            onClick={() => onTagToggle?.(tag.name)}
          />
        ))}
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function SegmentButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex-shrink-0 rounded-md px-3 py-1 text-[13px] transition-all"
      style={{
        backgroundColor: active ? "var(--ink)" : "transparent",
        color: active ? "#FFFFFF" : "var(--text-secondary)",
        fontWeight: active ? 600 : 500,
        transitionDuration: "var(--duration-fast)",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.color = "var(--text-primary)";
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.color = "var(--text-secondary)";
        }
      }}
    >
      {label}
    </button>
  );
}

function FolderTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex-shrink-0 rounded-full px-3.5 py-1.5 text-[13px] transition-all"
      style={{
        background: active ? "var(--surface-2)" : "transparent",
        border: active
          ? "1px solid var(--border-default)"
          : "1px solid transparent",
        color: active ? "var(--text-primary)" : "var(--text-secondary)",
        fontWeight: active ? 600 : 400,
        transitionDuration: "var(--duration-fast)",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background = "var(--paper-muted)";
          e.currentTarget.style.color = "var(--text-primary)";
          e.currentTarget.style.borderColor = "var(--border-default)";
        } else {
          e.currentTarget.style.background = "var(--surface-3)";
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "var(--text-secondary)";
          e.currentTarget.style.borderColor = "transparent";
        } else {
          e.currentTarget.style.background = "var(--surface-2)";
        }
      }}
    >
      {label}
    </button>
  );
}

function SortPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-shrink-0 rounded-md px-2.5 py-1 text-[13px] transition-all"
      style={{
        backgroundColor: active ? "var(--surface-3)" : "transparent",
        color: active ? "var(--text-primary)" : "var(--text-tertiary)",
        fontWeight: active ? 600 : 400,
        transitionDuration: "var(--duration-instant)",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.backgroundColor = "var(--surface-2)";
          e.currentTarget.style.color = "var(--text-secondary)";
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.backgroundColor = "transparent";
          e.currentTarget.style.color = "var(--text-tertiary)";
        }
      }}
    >
      {label}
    </button>
  );
}

function TagChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3 py-1 font-mono text-[11px] font-medium uppercase tracking-wide transition-all"
      style={{
        backgroundColor: active ? "var(--ink)" : "var(--surface-2)",
        color: active ? "#FFFFFF" : "var(--text-secondary)",
        border: active
          ? "1px solid var(--ink)"
          : "1px solid var(--border-subtle)",
        transitionDuration: "var(--duration-fast)",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.backgroundColor = "var(--surface-3)";
          e.currentTarget.style.color = "var(--text-primary)";
          e.currentTarget.style.borderColor = "var(--border-default)";
        } else {
          e.currentTarget.style.backgroundColor = "var(--border-strong)";
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.backgroundColor = "var(--surface-2)";
          e.currentTarget.style.color = "var(--text-secondary)";
          e.currentTarget.style.borderColor = "var(--border-subtle)";
        } else {
          e.currentTarget.style.backgroundColor = "var(--ink)";
        }
      }}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span
          style={{
            opacity: active ? 0.6 : 0.4,
            fontSize: "10px",
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

