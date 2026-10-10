"use client";

import { useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { Check, Plus, SlidersHorizontal, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";

export type PresetFilters = Doc<"galleryPresets">["filters"];

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

// A preset reads as "on" when the live filters equal it exactly.
const matches = (preset: PresetFilters, current: PresetFilters) =>
  sameSet(preset.selectedFilterIds, current.selectedFilterIds) &&
  sameSet(preset.excludedFilterIds, current.excludedFilterIds) &&
  (preset.folderId ?? null) === (current.folderId ?? null) &&
  (preset.mediaKind ?? null) === (current.mediaKind ?? null) &&
  preset.onlyLiked === current.onlyLiked &&
  preset.includeSkills === current.includeSkills &&
  preset.flattenStacks === current.flattenStacks &&
  preset.sortOrder === current.sortOrder;

export function FilterPresets({
  ownerUserId,
  current,
  onApply,
  validFilterIds,
  validFolderIds,
  includeSkills,
  onIncludeSkillsChange,
}: {
  ownerUserId: string;
  current: PresetFilters;
  onApply: (filters: PresetFilters) => void;
  validFilterIds: Set<string>;
  validFolderIds: Set<string>;
  includeSkills: boolean;
  onIncludeSkillsChange: (next: boolean) => void;
}) {
  const { isAuthenticated } = useConvexAuth();
  const presets = useQuery(
    api.galleryPresets.listPresets,
    isAuthenticated ? { ownerUserId } : "skip",
  );
  const save = useMutation(api.galleryPresets.savePreset);
  const seed = useMutation(api.galleryPresets.seedPresets);
  const remove = useMutation(api.galleryPresets.deletePreset);
  const [name, setName] = useState("");
  const [managing, setManaging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const apply = (filters: PresetFilters) => {
    if (
      [...filters.selectedFilterIds, ...filters.excludedFilterIds].some(
        (id) => !validFilterIds.has(id),
      ) ||
      (filters.folderId && !validFolderIds.has(filters.folderId))
    ) {
      setError(
        "This view refers to a filter or collection that no longer exists. Set the filters you want, then save them under the same name.",
      );
      return;
    }
    setError("");
    onApply(filters);
  };

  const run = async (task: () => Promise<unknown>) => {
    if (busy || !isAuthenticated) return;
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the view.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="px-4 pb-3"
      style={{ fontFamily: "var(--lm-font)" }}
    >
      <div className="mx-auto" style={{ maxWidth: "1180px" }}>
        <div className="flex items-center gap-2">
          <span
            className="shrink-0"
            style={{
              fontSize: "8px",
              fontWeight: 800,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "var(--lm-text-ghost)",
            }}
          >
            Views
          </span>

          <div
            className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto"
            style={{ scrollbarWidth: "none" }}
          >
            {presets?.map((preset) => {
              const active = matches(preset.filters, current);
              return (
                <span
                  key={preset._id}
                  className="inline-flex shrink-0 items-center"
                >
                  <ViewPill active={active} onClick={() => apply(preset.filters)}>
                    {preset.name}
                  </ViewPill>
                  {managing ? (
                    <button
                      type="button"
                      aria-label={`Delete ${preset.name} view`}
                      disabled={busy}
                      onClick={() =>
                        void run(() => remove({ ownerUserId, id: preset._id }))
                      }
                      className="-ml-1 flex h-5 w-5 items-center justify-center"
                      style={{
                        color: "var(--status-error)",
                        borderRadius: "999px",
                      }}
                    >
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  ) : null}
                </span>
              );
            })}
            {presets?.length === 0 ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => seed({ ownerUserId }))}
                className="inline-flex shrink-0 items-center gap-1 px-3 py-1"
                style={{
                  fontSize: "10px",
                  fontWeight: 600,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: "var(--lm-text-secondary)",
                  border: "2px dashed var(--lm-border-strong)",
                  borderRadius: "999px",
                }}
              >
                <Plus className="h-3 w-3" aria-hidden />
                Add starter views
              </button>
            ) : null}
          </div>

          <SkillsSwitch
            checked={includeSkills}
            onChange={onIncludeSkillsChange}
          />

          <button
            type="button"
            onClick={() => setManaging((open) => !open)}
            aria-expanded={managing}
            aria-label="Save or manage views"
            className="flex shrink-0 items-center gap-1 px-2.5 py-1 transition-colors"
            style={{
              fontSize: "9px",
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: managing
                ? "var(--lm-text-primary)"
                : "var(--lm-text-ghost)",
              border: managing
                ? "2px solid var(--lm-ink)"
                : "2px solid var(--lm-border-strong)",
              borderRadius: "999px",
              background: managing ? "var(--lm-surface-1)" : "transparent",
            }}
          >
            <SlidersHorizontal className="h-3 w-3" aria-hidden />
            Edit
          </button>
        </div>

        {managing ? (
          <form
            className="lm-island mt-2 flex items-center gap-2 px-3 py-2"
            style={{ borderRadius: "14px" }}
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await save({ ownerUserId, name, filters: current });
                setName("");
              });
            }}
          >
            <input
              aria-label="View name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Name the filters you have on right now"
              maxLength={80}
              className="min-w-0 flex-1 bg-transparent py-1 outline-none"
              style={{
                fontSize: "11px",
                fontWeight: 600,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "var(--lm-text-primary)",
                borderBottom: "2px solid var(--lm-border-strong)",
                caretColor: "var(--lm-coral)",
              }}
            />
            <button
              type="submit"
              disabled={busy || !name.trim()}
              className="inline-flex shrink-0 items-center gap-1 px-3 py-1.5"
              style={{
                fontSize: "9px",
                fontWeight: 800,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "#fff",
                background:
                  "linear-gradient(135deg, var(--gradient-1), var(--gradient-3))",
                borderRadius: "999px",
                opacity: busy || !name.trim() ? 0.45 : 1,
              }}
            >
              <Check className="h-3 w-3" aria-hidden />
              {busy ? "Saving" : "Save view"}
            </button>
          </form>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="mt-2"
            style={{
              fontSize: "10px",
              fontWeight: 600,
              letterSpacing: "0.08em",
              color: "var(--coral)",
            }}
          >
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ViewPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="inline-flex shrink-0 items-center whitespace-nowrap"
      style={{
        padding: "4px 12px",
        fontSize: "10px",
        fontWeight: active ? 700 : 600,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        borderRadius: "999px",
        border: active
          ? "2px solid var(--gradient-3)"
          : "2px solid var(--lm-border)",
        color: active ? "#fff" : "var(--lm-text-secondary)",
        background: active
          ? "linear-gradient(135deg, var(--gradient-1), var(--gradient-3), var(--gradient-5))"
          : "var(--lm-surface-1)",
        boxShadow: active ? "0 0 10px rgba(255, 122, 100, 0.2)" : "none",
        transition: "all var(--lm-duration-fast)",
      }}
    >
      {children}
    </button>
  );
}

function SkillsSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex shrink-0 items-center gap-2"
      style={{
        fontSize: "9px",
        fontWeight: 700,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: checked ? "var(--lm-text-primary)" : "var(--lm-text-tertiary)",
      }}
    >
      Skills
      <span
        aria-hidden
        className="relative inline-block"
        style={{
          width: "28px",
          height: "16px",
          borderRadius: "999px",
          border: checked
            ? "2px solid var(--gradient-3)"
            : "2px solid var(--lm-border-strong)",
          background: checked
            ? "linear-gradient(135deg, var(--gradient-1), var(--gradient-3))"
            : "var(--lm-surface-1)",
          transition: "all var(--lm-duration-fast)",
        }}
      >
        <span
          className="absolute"
          style={{
            top: "1px",
            left: checked ? "13px" : "1px",
            width: "10px",
            height: "10px",
            borderRadius: "999px",
            background: checked ? "#fff" : "var(--lm-text-tertiary)",
            transition: "left var(--lm-duration-fast)",
          }}
        />
      </span>
    </button>
  );
}
