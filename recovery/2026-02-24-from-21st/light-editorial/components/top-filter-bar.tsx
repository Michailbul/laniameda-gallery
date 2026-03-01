"use client";

import { useRef } from "react";
import { TagPill } from "./tag-pill";

interface Folder {
  _id: string;
  name: string;
}

export type SortOrder = "featured" | "newest" | "popular";

interface TopFilterBarProps {
  folders: Folder[];
  selectedFolderId: string | null;
  onFolderSelect: (folderId: string | null) => void;
  sortOrder: SortOrder;
  onSortOrderChange: (order: SortOrder) => void;
  onCommandPalette?: () => void;
  selectedTags?: string[];
  onTagToggle?: (tag: string) => void;
  onClearAllTags?: () => void;
}

const SORT_OPTIONS: { label: string; value: SortOrder }[] = [
  { label: "Featured", value: "featured" },
  { label: "Newest", value: "newest" },
  { label: "Popular", value: "popular" },
];

export function TopFilterBar({
  folders,
  selectedFolderId,
  onFolderSelect,
  sortOrder,
  onSortOrderChange,
  onCommandPalette: _onCommandPalette,
  selectedTags,
  onTagToggle,
  onClearAllTags,
}: TopFilterBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div
      className="sticky top-0 z-30 border-b"
      style={{
        borderColor: "var(--border-default)",
        backgroundColor: "var(--paper)",
      }}
    >
      <div className="flex h-12 items-center justify-between">
        {/* Left: folder filter tabs */}
        <div
          ref={scrollRef}
          className="flex flex-1 items-center gap-1.5 overflow-x-auto px-4"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          onWheel={(e) => {
            if (scrollRef.current && e.deltaY !== 0) {
              e.preventDefault();
              scrollRef.current.scrollLeft += e.deltaY;
            }
          }}
        >
          {/* All tab */}
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

        {/* Gradient divider */}
        <div
          className="h-6 w-px flex-shrink-0"
          style={{
            background:
              "linear-gradient(180deg, transparent 0%, var(--border-default) 50%, transparent 100%)",
          }}
        />

        {/* Right: sort options */}
        <div className="flex flex-shrink-0 items-center gap-0 px-4">
          {SORT_OPTIONS.map((option, idx) => (
            <span key={option.value} className="flex items-center">
              {idx > 0 && (
                <span
                  className="mx-2 text-[11px]"
                  style={{ color: "var(--text-ghost)" }}
                >
                  ·
                </span>
              )}
              <button
                type="button"
                onClick={() => onSortOrderChange(option.value)}
                className="text-[13px] font-medium transition-colors"
                style={{
                  color:
                    sortOrder === option.value
                      ? "var(--text-primary)"
                      : "var(--text-tertiary)",
                  textDecoration:
                    sortOrder === option.value ? "underline" : "none",
                  textUnderlineOffset: "4px",
                  textDecorationColor:
                    sortOrder === option.value
                      ? "var(--coral)"
                      : "transparent",
                  textDecorationThickness: "1px",
                  transitionDuration: "var(--duration-instant)",
                }}
                onMouseEnter={(e) => {
                  if (sortOrder !== option.value)
                    e.currentTarget.style.color = "var(--text-secondary)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color =
                    sortOrder === option.value
                      ? "var(--text-primary)"
                      : "var(--text-tertiary)";
                }}
              >
                {option.label}
              </button>
            </span>
          ))}
        </div>
      </div>

      {/* Selected tag pills row */}
      {selectedTags && selectedTags.length > 0 && (
        <div
          className="flex items-center gap-1.5 border-b px-4 py-2"
          style={{ borderColor: "var(--border-default)" }}
        >
          {selectedTags.map((tag) => (
            <TagPill
              key={tag}
              label={tag}
              active
              removable
              onRemove={() => onTagToggle?.(tag)}
            />
          ))}
          <button
            type="button"
            onClick={onClearAllTags}
            className="ml-1 font-mono text-[11px] uppercase tracking-wide transition-colors"
            style={{ color: "var(--text-tertiary)" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--text-primary)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--text-tertiary)";
            }}
          >
            Clear all
          </button>
        </div>
      )}
    </div>
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
        background: active ? "var(--ink)" : "transparent",
        border: active
          ? "1px solid var(--ink)"
          : "1px solid transparent",
        color: active ? "var(--paper)" : "var(--text-secondary)",
        fontWeight: active ? 600 : 400,
        boxShadow: "none",
        transitionDuration: "var(--duration-fast)",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background = "var(--paper-muted)";
          e.currentTarget.style.color = "var(--text-primary)";
          e.currentTarget.style.borderColor = "var(--border-default)";
        } else {
          e.currentTarget.style.background = "var(--border-strong)";
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "var(--text-secondary)";
          e.currentTarget.style.borderColor = "transparent";
        } else {
          e.currentTarget.style.background = "var(--ink)";
        }
      }}
    >
      {label}
    </button>
  );
}
