"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { BookOpenText, Film, FolderOpen, Loader2, Search, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { MasonryGrid } from "@/components/masonry-grid";
import { SkeletonGrid } from "@/components/ui/coral-skeleton";
import { useCoralToastSafe } from "@/components/ui/coral-toast";
import { skillCardToEntry, type SkillCardData } from "@/lib/skill-entries";
import {
  CINEMATOGRAPHY_TAG,
  SKILL_SECTION_COPY,
  type SkillSection,
} from "@/lib/cinematography";

type CollectionOption = {
  _id: string;
  name: string;
  parentFolderId?: string;
};

type SkillsViewProps = {
  ownerUserId: string;
  /** "cinematography" lists only cinematography packs; "skills" lists the rest. */
  section?: SkillSection;
  collections: CollectionOption[];
  onSkillOpen: (skillId: string) => void;
  selectedSkillId?: string | null;
  onImageLoad?: (imageId: string) => void;
};

const TAG_CHIP_LIMIT = 24;

const canonical = (tag: string) =>
  tag.trim().toLowerCase().replace(/^#+/, "").replace(/[_-]+/g, " ");

// The Skills tab: every saved skill as a card, narrowed by meaning (semantic
// search), tags (all must match) and collection. Owner-only. The Cinematography
// tab is the same view over the packs tagged `cinematography`, which the
// Skills tab leaves out.
export function SkillsView({
  ownerUserId,
  section = "skills",
  collections,
  onSkillOpen,
  selectedSkillId,
  onImageLoad,
}: SkillsViewProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [showAllTags, setShowAllTags] = useState(false);
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const copy = SKILL_SECTION_COPY[section];
  const SectionIcon = section === "cinematography" ? Film : BookOpenText;
  // The section's own scope. Cinematography requires its tag and every card
  // carries it, so that chip is not offered as a filter.
  const baseTags = useMemo(
    () => (section === "cinematography" ? [CINEMATOGRAPHY_TAG] : []),
    [section],
  );
  const excludeTagNames = useMemo(
    () => (section === "skills" ? [CINEMATOGRAPHY_TAG] : undefined),
    [section],
  );

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedQuery(query.trim()), 320);
    return () => window.clearTimeout(handle);
  }, [query]);

  // The full set feeds the tag cloud, so the chips never shrink to whatever
  // the current filter left over.
  const allSkills = useQuery(api.workflows.listWorkflows, {
    ownerUserId,
    limit: 200,
    previewLimit: 6,
    tagNames: baseTags,
    excludeTagNames,
  }) as SkillCardData[] | undefined;
  const filteredSkills = useQuery(
    api.workflows.listWorkflows,
    !debouncedQuery && (selectedTags.length > 0 || folderId)
      ? {
          ownerUserId,
          limit: 200,
          previewLimit: 6,
          tagNames: [...baseTags, ...selectedTags],
          excludeTagNames,
          folderId: (folderId ?? undefined) as Id<"folders"> | undefined,
        }
      : "skip",
  ) as SkillCardData[] | undefined;

  const searchSkills = useAction(api.semanticSearch.searchSkills);
  const [searchResults, setSearchResults] = useState<SkillCardData[] | null>(null);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);
  useEffect(() => {
    if (!debouncedQuery) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    searchSkills({
      ownerUserId,
      query: debouncedQuery,
      tagNames:
        baseTags.length + selectedTags.length > 0
          ? [...baseTags, ...selectedTags]
          : undefined,
      excludeTagNames,
      folderId: (folderId ?? undefined) as Id<"folders"> | undefined,
      limit: 60,
    })
      .then((results) => {
        if (seq === searchSeq.current) setSearchResults(results as SkillCardData[]);
      })
      .catch(() => {
        if (seq === searchSeq.current) setSearchResults([]);
      })
      .finally(() => {
        if (seq === searchSeq.current) setSearching(false);
      });
  }, [baseTags, debouncedQuery, excludeTagNames, folderId, ownerUserId, searchSkills, selectedTags]);

  const deleteSkill = useMutation(api.workflows.deleteWorkflow);
  const toast = useCoralToastSafe()?.toast;

  const tagCloud = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const skill of allSkills ?? []) {
      for (const tag of skill.tagNames) {
        const key = canonical(tag);
        if (baseTags.some((base) => canonical(base) === key)) continue;
        const entry = counts.get(key);
        if (entry) entry.count += 1;
        else counts.set(key, { label: tag, count: 1 });
      }
    }
    // A tag every card carries filters nothing, so it earns no chip.
    const total = allSkills?.length ?? 0;
    return [...counts.values()]
      .filter((entry) => total <= 1 || entry.count < total)
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [allSkills, baseTags]);

  // Only collections that hold a skill are worth offering as a filter.
  const skillCollections = useMemo(() => {
    const held = new Map<string, number>();
    for (const skill of allSkills ?? []) {
      for (const id of skill.folderIds ?? []) held.set(id, (held.get(id) ?? 0) + 1);
    }
    return collections
      .filter((collection) => held.has(collection._id))
      .map((collection) => {
        const parent = collection.parentFolderId
          ? collections.find((entry) => entry._id === collection.parentFolderId)
          : undefined;
        return {
          ...collection,
          label: parent ? `${parent.name} › ${collection.name}` : collection.name,
          count: held.get(collection._id) ?? 0,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [allSkills, collections]);

  const source = debouncedQuery
    ? searchResults
    : selectedTags.length > 0 || folderId
      ? filteredSkills
      : allSkills;
  const entries = useMemo(
    () =>
      (source ?? [])
        .filter((skill) => !removedIds.has(skill._id))
        .map(skillCardToEntry),
    [removedIds, source],
  );

  const filtering = Boolean(debouncedQuery || selectedTags.length > 0 || folderId);
  const loading = source === undefined || (debouncedQuery && source === null);
  const visibleTags = showAllTags ? tagCloud : tagCloud.slice(0, TAG_CHIP_LIMIT);

  const toggleTag = (label: string) => {
    const key = canonical(label);
    setSelectedTags((previous) =>
      previous.some((tag) => canonical(tag) === key)
        ? previous.filter((tag) => canonical(tag) !== key)
        : [...previous, label],
    );
  };

  const handleDelete = async (skillId: string) => {
    setDeletingId(skillId);
    try {
      await deleteSkill({ ownerUserId, id: skillId as Id<"workflows"> });
      setRemovedIds((previous) => new Set(previous).add(skillId));
      toast?.("Deleted", copy.deleted, "success");
    } catch (error) {
      toast?.(
        "Failed",
        error instanceof Error
          ? error.message.toUpperCase()
          : `COULD NOT DELETE ${copy.noun.toUpperCase()}`,
        "warning",
      );
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="w-full">
      <div className="skills-toolbar">
        <div className="skills-toolbar-head">
          <div className="skills-toolbar-title">
            <SectionIcon className="h-3.5 w-3.5" style={{ color: "var(--coral)" }} />
            <span>{copy.title}</span>
            <span className="skills-toolbar-count">
              {filtering && source ? `${entries.length} / ` : ""}
              {allSkills?.length ?? "—"}
            </span>
          </div>
          <label className="skills-search">
            {searching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={copy.placeholder}
              aria-label={`Search ${copy.title.toLowerCase()}`}
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear search">
                <X className="h-3 w-3" />
              </button>
            )}
          </label>
        </div>

        {(tagCloud.length > 0 || skillCollections.length > 0) && (
          <div className="skills-chip-row" data-expanded={showAllTags}>
            {skillCollections.map((collection) => {
              const active = folderId === collection._id;
              return (
                <button
                  key={collection._id}
                  type="button"
                  className="skills-chip skills-chip-collection"
                  data-active={active}
                  onClick={() => setFolderId(active ? null : collection._id)}
                  title={`${copy.title} in ${collection.label}`}
                >
                  <FolderOpen className="h-2.5 w-2.5" aria-hidden />
                  {collection.label}
                  <span className="skills-chip-count">{collection.count}</span>
                </button>
              );
            })}
            {skillCollections.length > 0 && tagCloud.length > 0 && (
              <span className="skills-chip-divider" aria-hidden />
            )}
            {visibleTags.map((tag) => {
              const active = selectedTags.some((entry) => canonical(entry) === canonical(tag.label));
              return (
                <button
                  key={tag.label}
                  type="button"
                  className="skills-chip"
                  data-active={active}
                  onClick={() => toggleTag(tag.label)}
                >
                  #{tag.label}
                  <span className="skills-chip-count">{tag.count}</span>
                </button>
              );
            })}
            {tagCloud.length > TAG_CHIP_LIMIT && (
              <button
                type="button"
                className="skills-chip skills-chip-more"
                onClick={() => setShowAllTags((value) => !value)}
              >
                {showAllTags ? "Fewer" : `+${tagCloud.length - TAG_CHIP_LIMIT} more`}
              </button>
            )}
            {filtering && (
              <button
                type="button"
                className="skills-chip skills-chip-clear"
                onClick={() => {
                  setQuery("");
                  setSelectedTags([]);
                  setFolderId(null);
                }}
              >
                <X className="h-2.5 w-2.5" /> Clear
              </button>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ padding: "12px" }}>
          <SkeletonGrid columnClasses="columns-2 sm:columns-2 md:columns-3 lg:columns-4" />
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[40vh] px-8 py-12 text-center lm-animate-fade-in">
          <SectionIcon className="mb-4 h-7 w-7" style={{ color: "var(--coral)" }} />
          <h2 className="skills-empty-title">
            {filtering ? copy.emptyFiltered : copy.emptyTitle}
          </h2>
          <p className="skills-empty-copy">
            {filtering
              ? "Loosen a tag, pick another collection or search in other words."
              : copy.emptyCopy}
          </p>
        </div>
      ) : (
        <MasonryGrid
          images={entries}
          compactColumns={false}
          onImageSelect={(image) => onSkillOpen(image.id)}
          selectedImageId={selectedSkillId ?? undefined}
          canDelete
          deletingImageId={deletingId}
          onDeleteImage={(id) => {
            void handleDelete(id);
          }}
          onImageLoad={onImageLoad}
        />
      )}
    </div>
  );
}
