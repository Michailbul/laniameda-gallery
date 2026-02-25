"use client";

import { useRef } from "react";

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
}: TopFilterBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div
      className="sticky top-0 z-30 flex h-12 items-center justify-between border-b"
      style={{
        backgroundColor: "rgba(5, 19, 22, 0.92)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderColor: "var(--border-subtle)",
      }}
    >
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
          background: "linear-gradient(180deg, transparent 0%, var(--border-default) 50%, transparent 100%)",
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
                color: sortOrder === option.value ? "var(--text-primary)" : "var(--text-tertiary)",
                textDecoration: sortOrder === option.value ? "underline" : "none",
                textUnderlineOffset: "4px",
                textDecorationColor: sortOrder === option.value ? "var(--lime-9)" : "transparent",
                textDecorationThickness: "1px",
                transitionDuration: "var(--duration-instant)",
              }}
              onMouseEnter={(e) => {
                if (sortOrder !== option.value)
                  e.currentTarget.style.color = "var(--text-secondary)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color =
                  sortOrder === option.value ? "var(--text-primary)" : "var(--text-tertiary)";
              }}
            >
              {option.label}
            </button>
          </span>
        ))}
      </div>
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
      className="relative flex-shrink-0 rounded-full px-3 py-1 text-[13px] transition-all"
      style={{
        backgroundColor: active ? "var(--accent-subtle)" : "transparent",
        border: active
          ? "1px solid rgba(230, 255, 42, 0.25)"
          : "1px solid var(--border-default)",
        color: active ? "var(--lime-9)" : "var(--text-secondary)",
        fontWeight: active ? 600 : 400,
        transitionDuration: "var(--duration-instant)",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.backgroundColor = "var(--surface-2)";
          e.currentTarget.style.color = "var(--text-primary)";
          e.currentTarget.style.borderColor = "var(--border-strong)";
        } else {
          e.currentTarget.style.backgroundColor = "var(--accent-glow)";
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.backgroundColor = "transparent";
          e.currentTarget.style.color = "var(--text-secondary)";
          e.currentTarget.style.borderColor = "var(--border-default)";
        } else {
          e.currentTarget.style.backgroundColor = "var(--accent-subtle)";
        }
      }}
    >
      {label}
    </button>
  );
}
