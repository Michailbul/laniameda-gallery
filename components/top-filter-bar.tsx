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
  selectedPillar: string | null;
  onPillarSelect: (pillar: string | null) => void;
  availableModelNames: string[];
  selectedModelName: string | null;
  onModelNameSelect: (name: string | null) => void;
  sortOrder: SortOrder;
  onSortOrderChange: (order: SortOrder) => void;
  onCommandPalette?: () => void;
}

const SORT_OPTIONS: { label: string; value: SortOrder }[] = [
  { label: "Featured", value: "featured" },
  { label: "Newest", value: "newest" },
  { label: "Popular", value: "popular" },
];

const PILLAR_OPTIONS = [
  { label: "Creators", value: "creators" },
  { label: "Cars", value: "cars" },
  { label: "Designs", value: "designs" },
  { label: "Dump", value: "dump" },
] as const;

export function TopFilterBar({
  folders,
  selectedFolderId,
  onFolderSelect,
  selectedPillar,
  onPillarSelect,
  availableModelNames,
  selectedModelName,
  onModelNameSelect,
  sortOrder,
  onSortOrderChange,
  onCommandPalette: _onCommandPalette,
}: TopFilterBarProps) {
  const pillarScrollRef = useRef<HTMLDivElement>(null);
  const folderScrollRef = useRef<HTMLDivElement>(null);
  const modelScrollRef = useRef<HTMLDivElement>(null);

  return (
    <div
      className="sticky top-0 z-30 border-b"
      style={{
        background:
          "linear-gradient(90deg, rgba(11, 8, 5, 0.94) 0%, rgba(17, 10, 6, 0.90) 50%, rgba(11, 8, 5, 0.94) 100%)",
        backdropFilter: "blur(20px) saturate(150%)",
        WebkitBackdropFilter: "blur(20px) saturate(150%)",
        borderColor: "var(--border-subtle)",
      }}
    >
      <div
        ref={pillarScrollRef}
        className="flex h-11 items-center gap-1.5 overflow-x-auto px-4"
        style={{
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          borderBottom: "1px solid var(--border-subtle)",
        }}
        onWheel={(e) => {
          if (pillarScrollRef.current && e.deltaY !== 0) {
            e.preventDefault();
            pillarScrollRef.current.scrollLeft += e.deltaY;
          }
        }}
      >
        <FolderTab
          label="All"
          active={selectedPillar === null}
          onClick={() => onPillarSelect(null)}
        />
        {PILLAR_OPTIONS.map((pillar) => (
          <FolderTab
            key={pillar.value}
            label={pillar.label}
            active={selectedPillar === pillar.value}
            onClick={() => onPillarSelect(pillar.value)}
          />
        ))}
      </div>

      <div className="flex h-12 items-center justify-between">
        <div
          ref={folderScrollRef}
          className="flex flex-1 items-center gap-1.5 overflow-x-auto px-4"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
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

        <div
          className="h-6 w-px flex-shrink-0"
          style={{
            background:
              "linear-gradient(180deg, transparent 0%, var(--border-default) 50%, transparent 100%)",
          }}
        />

        <div className="flex flex-shrink-0 items-center gap-0 px-4">
          {SORT_OPTIONS.map((option, idx) => (
            <span key={option.value} className="flex items-center">
              {idx > 0 && (
                <span className="mx-2 text-[11px]" style={{ color: "var(--text-ghost)" }}>
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
                  textDecoration: sortOrder === option.value ? "underline" : "none",
                  textUnderlineOffset: "4px",
                  textDecorationColor:
                    sortOrder === option.value ? "var(--amber-9)" : "transparent",
                  textDecorationThickness: "1px",
                  transitionDuration: "var(--duration-instant)",
                }}
                onMouseEnter={(e) => {
                  if (sortOrder !== option.value) {
                    e.currentTarget.style.color = "var(--text-secondary)";
                  }
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

      {availableModelNames.length > 0 && (
        <div
          ref={modelScrollRef}
          className="flex items-center gap-1.5 overflow-x-auto px-4 pb-2"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          onWheel={(e) => {
            if (modelScrollRef.current && e.deltaY !== 0) {
              e.preventDefault();
              modelScrollRef.current.scrollLeft += e.deltaY;
            }
          }}
        >
          <span
            className="mr-1 flex-shrink-0 text-[11px] font-medium"
            style={{ color: "var(--text-tertiary)" }}
          >
            Model
          </span>
          <ModelNameChip
            label="All"
            active={selectedModelName === null}
            onClick={() => onModelNameSelect(null)}
          />
          {availableModelNames.map((name) => (
            <ModelNameChip
              key={name}
              label={name}
              active={selectedModelName === name}
              onClick={() => onModelNameSelect(selectedModelName === name ? null : name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ModelNameChip({
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
      className="flex-shrink-0 rounded-full px-2.5 py-0.5 text-xs transition-all"
      style={{
        background: active
          ? "linear-gradient(135deg, rgba(255, 140, 66, 0.15), rgba(255, 107, 53, 0.08))"
          : "rgba(245, 208, 168, 0.03)",
        border: active
          ? "1px solid rgba(255, 140, 66, 0.28)"
          : "1px solid var(--border-subtle)",
        color: active ? "var(--amber-9)" : "var(--text-tertiary)",
        fontWeight: active ? 600 : 500,
        transitionDuration: "var(--duration-fast)",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background = "var(--surface-2)";
          e.currentTarget.style.color = "var(--text-secondary)";
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.background = "rgba(245, 208, 168, 0.03)";
          e.currentTarget.style.color = "var(--text-tertiary)";
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
        background: active
          ? "linear-gradient(135deg, rgba(255, 140, 66, 0.15), rgba(255, 107, 53, 0.08))"
          : "transparent",
        border: active
          ? "1px solid rgba(255, 140, 66, 0.25)"
          : "1px solid transparent",
        color: active ? "var(--amber-9)" : "var(--text-secondary)",
        fontWeight: active ? 600 : 400,
        boxShadow: active ? "0 0 12px rgba(255, 140, 66, 0.1)" : "none",
        transitionDuration: "var(--duration-fast)",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background = "var(--surface-2)";
          e.currentTarget.style.color = "var(--text-primary)";
          e.currentTarget.style.borderColor = "var(--border-strong)";
        } else {
          e.currentTarget.style.boxShadow = "0 0 16px rgba(255, 140, 66, 0.18)";
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "var(--text-secondary)";
          e.currentTarget.style.borderColor = "transparent";
        } else {
          e.currentTarget.style.boxShadow = "0 0 12px rgba(255, 140, 66, 0.1)";
        }
      }}
    >
      {label}
    </button>
  );
}
