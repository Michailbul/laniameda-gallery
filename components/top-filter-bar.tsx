"use client";

import { useMemo, useRef, useState } from "react";

interface Tag {
  _id: string;
  name: string;
  usageCount?: number;
}

interface Folder {
  _id: string;
  name: string;
}

export type SortOrder = "featured" | "newest" | "popular";
export type GalleryScope = "mine" | "public";

const PILLAR_OPTIONS = [
  { label: "Creators", value: "creators" },
  { label: "Cars", value: "cars" },
  { label: "Designs", value: "designs" },
  { label: "Dump", value: "dump" },
] as const;
export type Pillar = (typeof PILLAR_OPTIONS)[number]["value"];

interface TopFilterBarProps {
  galleryScope: GalleryScope;
  canAccessMyGallery: boolean;
  onGalleryScopeChange: (scope: GalleryScope) => void;
  tags: Tag[];
  selectedTags: string[];
  onTagToggle: (tag: string) => void;
  onClearAllTags: () => void;
  folders: Folder[];
  selectedFolderId: string | null;
  onFolderSelect: (folderId: string | null) => void;
  selectedPillar: Pillar | null;
  onPillarSelect: (pillar: Pillar | null) => void;
  availableModelNames: string[];
  selectedModelName: string | null;
  onModelNameSelect: (name: string | null) => void;
  sortOrder: SortOrder;
  onSortOrderChange: (order: SortOrder) => void;
}

const SORT_OPTIONS: { label: string; value: SortOrder }[] = [
  { label: "Featured", value: "featured" },
  { label: "Newest", value: "newest" },
  { label: "Popular", value: "popular" },
];

export function TopFilterBar({
  galleryScope,
  canAccessMyGallery,
  onGalleryScopeChange,
  tags,
  selectedTags,
  onTagToggle,
  onClearAllTags,
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
}: TopFilterBarProps) {
  const [tagQuery, setTagQuery] = useState("");
  const pillarScrollRef = useRef<HTMLDivElement>(null);
  const folderScrollRef = useRef<HTMLDivElement>(null);
  const modelScrollRef = useRef<HTMLDivElement>(null);

  const orderedTags = useMemo(() => {
    return [...tags].sort((a, b) => {
      const usageDiff = (b.usageCount ?? 0) - (a.usageCount ?? 0);
      if (usageDiff !== 0) return usageDiff;
      return a.name.localeCompare(b.name);
    });
  }, [tags]);

  const filteredTags = useMemo(() => {
    const needle = tagQuery.trim().toLowerCase();
    if (!needle) return orderedTags;
    return orderedTags.filter((tag) => tag.name.toLowerCase().includes(needle));
  }, [orderedTags, tagQuery]);

  const selectedTagSet = useMemo(() => new Set(selectedTags), [selectedTags]);

  const handleWheel = (
    ref: React.RefObject<HTMLDivElement | null>,
    e: React.WheelEvent,
  ) => {
    const el = ref.current;
    if (!el || e.deltaY === 0) return;
    const canScroll = el.scrollWidth > el.clientWidth;
    if (!canScroll) return;
    const atStart = el.scrollLeft <= 0;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
    if ((e.deltaY < 0 && atStart) || (e.deltaY > 0 && atEnd)) return;
    e.preventDefault();
    el.scrollLeft += e.deltaY;
  };

  return (
    <div
      className="sticky top-0 z-30"
      style={{
        backgroundColor: "var(--paper)",
        borderBottom: "1px solid var(--border-default)",
      }}
    >
      <div
        className="flex items-center justify-between gap-3 border-b px-4 py-2"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <p
          className="text-[10px] font-semibold uppercase tracking-[0.2em]"
          style={{ color: "var(--text-tertiary)" }}
        >
          Gallery View
        </p>
        <div className="inline-flex items-center overflow-hidden border" style={{ borderColor: "var(--border-default)" }}>
          <button
            type="button"
            onClick={() => onGalleryScopeChange("public")}
            className="px-3 py-1.5 font-mono text-[10px] font-medium uppercase tracking-wider transition-colors"
            style={{
              backgroundColor: galleryScope === "public" ? "var(--bg-inverse)" : "transparent",
              color: galleryScope === "public" ? "var(--text-inverse)" : "var(--text-secondary)",
            }}
          >
            Public
          </button>
          <button
            type="button"
            onClick={() => onGalleryScopeChange("mine")}
            disabled={!canAccessMyGallery}
            className="border-l px-3 py-1.5 font-mono text-[10px] font-medium uppercase tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              borderColor: "var(--border-default)",
              backgroundColor: galleryScope === "mine" ? "var(--coral)" : "transparent",
              color: galleryScope === "mine" ? "#ffffff" : "var(--text-secondary)",
            }}
            title={canAccessMyGallery ? "View your private gallery" : "Sign in to access your private gallery"}
          >
            My Gallery
          </button>
        </div>
      </div>

      <div
        ref={pillarScrollRef}
        className="flex h-11 items-center gap-1.5 overflow-x-auto px-4"
        style={{
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          borderBottom: "1px solid var(--border-subtle)",
        }}
        onWheel={(e) => handleWheel(pillarScrollRef, e)}
      >
        <FilterTab
          label="All Pillars"
          active={selectedPillar === null}
          onClick={() => onPillarSelect(null)}
          tone="coral"
        />
        {PILLAR_OPTIONS.map((pillar) => (
          <FilterTab
            key={pillar.value}
            label={pillar.label}
            active={selectedPillar === pillar.value}
            onClick={() => onPillarSelect(pillar.value)}
            tone="coral"
          />
        ))}
      </div>

      <div className="flex h-12 items-center justify-between">
        <div
          ref={folderScrollRef}
          className="flex flex-1 items-center gap-1.5 overflow-x-auto px-4"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          onWheel={(e) => handleWheel(folderScrollRef, e)}
        >
          <FilterTab
            label="All Folders"
            active={selectedFolderId === null}
            onClick={() => onFolderSelect(null)}
            tone="ink"
          />
          {folders.map((folder) => (
            <FilterTab
              key={folder._id}
              label={folder.name}
              active={selectedFolderId === folder._id}
              onClick={() => onFolderSelect(folder._id)}
              tone="ink"
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
                <span className="mx-1.5 text-[10px] font-mono" style={{ color: "var(--text-ghost)" }}>
                  /
                </span>
              )}
              <button
                type="button"
                onClick={() => onSortOrderChange(option.value)}
                className="font-mono text-[10px] font-medium uppercase tracking-wider transition-colors"
                style={{
                  color:
                    sortOrder === option.value
                      ? "var(--text-primary)"
                      : "var(--text-tertiary)",
                  textDecoration: sortOrder === option.value ? "underline" : "none",
                  textUnderlineOffset: "4px",
                  textDecorationColor:
                    sortOrder === option.value ? "var(--coral)" : "transparent",
                  textDecorationThickness: "1.5px",
                  transitionDuration: "var(--duration-instant)",
                }}
              >
                {option.label}
              </button>
            </span>
          ))}
        </div>
      </div>

      <TopTagSystem
        tagQuery={tagQuery}
        onTagQueryChange={setTagQuery}
        tags={filteredTags}
        selectedTags={selectedTagSet}
        onTagToggle={onTagToggle}
        onClearAllTags={onClearAllTags}
      />

      {availableModelNames.length > 0 && (
        <div
          ref={modelScrollRef}
          className="flex items-center gap-1.5 overflow-x-auto px-4 pb-2"
          style={{
            scrollbarWidth: "none",
            msOverflowStyle: "none",
            borderTop: "1px solid var(--border-subtle)",
          }}
          onWheel={(e) => handleWheel(modelScrollRef, e)}
        >
          <span
            className="mr-1 flex-shrink-0 text-[11px] font-medium uppercase tracking-wide"
            style={{ color: "var(--text-tertiary)" }}
          >
            Model
          </span>
          <ModelChip
            label="All"
            active={selectedModelName === null}
            onClick={() => onModelNameSelect(null)}
          />
          {availableModelNames.map((name) => (
            <ModelChip
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

function TopTagSystem({
  tagQuery,
  onTagQueryChange,
  tags,
  selectedTags,
  onTagToggle,
  onClearAllTags,
}: {
  tagQuery: string;
  onTagQueryChange: (value: string) => void;
  tags: Tag[];
  selectedTags: Set<string>;
  onTagToggle: (tagId: string) => void;
  onClearAllTags: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div
      id="top-tag-system"
      className="border-t px-4 py-2"
      style={{ borderColor: "var(--border-subtle)" }}
    >
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: "var(--text-tertiary)" }}>
          Tags
        </p>
        <div className="flex items-center gap-2">
          <input
            value={tagQuery}
            onChange={(e) => onTagQueryChange(e.target.value)}
            placeholder="Filter tags"
            aria-label="Search tags"
            className="h-7 w-full rounded-md border bg-transparent px-2 text-[12px] outline-none"
            style={{
              borderColor: "var(--border-default)",
              color: "var(--text-primary)",
              maxWidth: "220px",
            }}
          />
          {selectedTags.size > 0 && (
            <button
              type="button"
              onClick={onClearAllTags}
              className="btn-brutal-outline h-7"
            >
              Clear {selectedTags.size}
            </button>
          )}
        </div>
      </div>
      <div
        ref={scrollRef}
        className="flex items-center gap-1.5 overflow-x-auto"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        onWheel={(e) => {
          const el = scrollRef.current;
          if (!el || e.deltaY === 0) return;
          const canScroll = el.scrollWidth > el.clientWidth;
          if (!canScroll) return;
          const atStart = el.scrollLeft <= 0;
          const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
          if ((e.deltaY < 0 && atStart) || (e.deltaY > 0 && atEnd)) return;
          e.preventDefault();
          el.scrollLeft += e.deltaY;
        }}
      >
        <TagButton label="All Tags" active={selectedTags.size === 0} onClick={onClearAllTags} />
        {tags.map((tag) => (
          <TagButton
            key={tag._id}
            label={tag.name}
            count={tag.usageCount}
            active={selectedTags.has(tag._id)}
            onClick={() => onTagToggle(tag._id)}
          />
        ))}
      </div>
    </div>
  );
}

function FilterTab({
  label,
  active,
  onClick,
  tone,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  tone: "ink" | "coral";
}) {
  const activeBackground = tone === "coral" ? "var(--coral)" : "var(--bg-inverse)";
  const activeColor = tone === "coral" ? "#FFFFFF" : "var(--text-inverse)";

  const className = [
    "relative flex-shrink-0 px-3.5 py-1.5 text-[11px] font-mono font-medium uppercase tracking-wider border",
    "transition-[background-color,color,border-color,box-shadow,transform] duration-[var(--duration-fast)]",
    "active:translate-x-0 active:translate-y-0 active:shadow-none",
    active
      ? ""
      : "hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)]",
  ].join(" ");

  return (
    <button
      type="button"
      onClick={onClick}
      className={className}
      style={{
        background: active ? activeBackground : "transparent",
        borderColor: active ? activeBackground : "var(--border-subtle)",
        color: active ? activeColor : "var(--text-secondary)",
        fontWeight: 500,
        boxShadow: active ? "var(--shadow-brutal-sm)" : "none",
        transform: active ? "translate(-1px, -1px)" : undefined,
      }}
    >
      {label}
    </button>
  );
}

function TagButton({
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
  const className = [
    "inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap border px-2.5 py-1 text-[10px] font-mono font-medium uppercase tracking-wider",
    "transition-[background-color,color,border-color,box-shadow,transform] duration-[var(--duration-fast)]",
    "active:translate-x-0 active:translate-y-0 active:shadow-none",
    active
      ? "bg-[var(--bg-inverse)] border-[var(--bg-inverse)] text-[var(--text-inverse)]"
      : "bg-transparent border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]",
  ].join(" ");

  return (
    <button
      type="button"
      onClick={onClick}
      className={className}
      style={{
        boxShadow: active ? "var(--shadow-brutal-sm)" : "none",
        transform: active ? "translate(-1px, -1px)" : undefined,
      }}
    >
      {label}
      {count !== undefined && (
        <span
          className="px-1 py-px text-[9px] font-mono tabular-nums"
          style={{
            backgroundColor: active ? "rgba(255,255,255,0.18)" : "var(--surface-3)",
            color: active ? "#FFFFFF" : "var(--text-ghost)",
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function ModelChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  const className = [
    "flex-shrink-0 border px-2.5 py-0.5 text-[10px] font-mono font-medium uppercase tracking-wider",
    "transition-[background-color,color,border-color] duration-[var(--duration-fast)]",
    active
      ? ""
      : "hover:bg-[var(--surface-3)] hover:text-[var(--text-secondary)] hover:border-[var(--border-strong)]",
  ].join(" ");

  return (
    <button
      type="button"
      onClick={onClick}
      className={className}
      style={{
        background: active
          ? "rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.12)"
          : "transparent",
        borderColor: active
          ? "rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.30)"
          : "var(--border-default)",
        color: active ? "var(--coral)" : "var(--text-tertiary)",
        fontWeight: 500,
      }}
    >
      {label}
    </button>
  );
}
