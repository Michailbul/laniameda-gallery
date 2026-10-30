"use client";

import { useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { Check, Plus, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";

export type PresetFilters = Doc<"galleryPresets">["filters"];

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

// A preset reads as "on" when the live filters equal it exactly.
export const matchesPreset = (preset: PresetFilters, current: PresetFilters) =>
  sameSet(preset.selectedFilterIds, current.selectedFilterIds) &&
  sameSet(preset.excludedFilterIds, current.excludedFilterIds) &&
  (preset.folderId ?? null) === (current.folderId ?? null) &&
  (preset.mediaKind ?? null) === (current.mediaKind ?? null) &&
  preset.onlyLiked === current.onlyLiked &&
  preset.includeSkills === current.includeSkills &&
  preset.flattenStacks === current.flattenStacks &&
  preset.sortOrder === current.sortOrder;

export type ViewsPanelProps = {
  ownerUserId: string;
  current: PresetFilters;
  onApply: (filters: PresetFilters) => void;
  validFilterIds: Set<string>;
  validFolderIds: Set<string>;
  includeSkills: boolean;
  onIncludeSkillsChange: (next: boolean) => void;
  /** The owner's saved views, when the caller already has them (the toolbar
   *  button names the active one). The panel loads them itself otherwise. */
  presets?: Doc<"galleryPresets">[];
};

/** The saved view the live filters equal exactly, if any. */
export const activeViewName = ({ presets, current }: Pick<ViewsPanelProps, "presets" | "current">) =>
  presets?.find((preset) => matchesPreset(preset.filters, current))?.name ?? null;

/** The owner's saved views, for the toolbar (`useViews`). */
export function useSavedViews(ownerUserId: string) {
  const { isAuthenticated } = useConvexAuth();
  return useQuery(api.galleryPresets.listPresets, isAuthenticated ? { ownerUserId } : "skip");
}

/**
 * The VIEWS popover: one row per saved view (a check marks the one that is
 * on, an x deletes it), the Skills switch, and a line to save the filters that
 * are on right now under a name.
 */
export function ViewsPanel({
  ownerUserId,
  current,
  onApply,
  validFilterIds,
  validFolderIds,
  includeSkills,
  onIncludeSkillsChange,
  presets: givenPresets,
  onApplied,
}: ViewsPanelProps & { onApplied?: () => void }) {
  const { isAuthenticated } = useConvexAuth();
  const loaded = useQuery(
    api.galleryPresets.listPresets,
    givenPresets === undefined && isAuthenticated ? { ownerUserId } : "skip",
  );
  const presets = givenPresets ?? loaded;
  const save = useMutation(api.galleryPresets.savePreset);
  const seed = useMutation(api.galleryPresets.seedPresets);
  const remove = useMutation(api.galleryPresets.deletePreset);
  const [name, setName] = useState("");
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
    onApplied?.();
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
    <div style={{ fontFamily: "var(--lm-font)" }}>
      <div className="flex items-center justify-between gap-3 px-1">
        <span
          style={{
            fontSize: "8px",
            fontWeight: 800,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "var(--lm-text-ghost)",
          }}
        >
          Saved views{presets ? ` · ${presets.length}` : ""}
        </span>
        <SkillsSwitch checked={includeSkills} onChange={onIncludeSkillsChange} />
      </div>

      <ul className="lm-views-list mt-1.5 flex max-h-[46dvh] flex-col gap-0.5 overflow-y-auto" role="list">
        {presets?.map((preset) => {
          const active = matchesPreset(preset.filters, current);
          return (
            <li key={preset._id} className="lm-views-row flex items-stretch">
              <button
                type="button"
                onClick={() => apply(preset.filters)}
                aria-pressed={active}
                className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 text-left transition-colors"
                style={{
                  minHeight: "34px",
                  borderRadius: "12px",
                  fontSize: "10px",
                  fontWeight: active ? 800 : 600,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: active ? "#fff" : "var(--lm-text-primary)",
                  background: active
                    ? "linear-gradient(135deg, var(--gradient-1), var(--gradient-3), var(--gradient-5))"
                    : "transparent",
                }}
              >
                <Check
                  className="h-3 w-3 shrink-0"
                  aria-hidden
                  style={{ opacity: active ? 1 : 0 }}
                />
                <span className="truncate">{preset.name}</span>
              </button>
              <button
                type="button"
                aria-label={`Delete the ${preset.name} view`}
                title={`Delete the ${preset.name} view`}
                disabled={busy}
                onClick={() => void run(() => remove({ ownerUserId, id: preset._id }))}
                className="lm-views-delete flex w-9 shrink-0 items-center justify-center transition-colors"
                style={{ color: "var(--lm-text-ghost)", borderRadius: "12px" }}
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </li>
          );
        })}
        {presets?.length === 0 ? (
          <li>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => seed({ ownerUserId }))}
              className="inline-flex items-center gap-1 px-3 py-1.5"
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
          </li>
        ) : null}
        {presets === undefined ? (
          <li className="px-2.5 py-2" style={{ fontSize: "10px", color: "var(--lm-text-ghost)" }}>
            Loading…
          </li>
        ) : null}
      </ul>

      <form
        className="mt-2 flex items-center gap-2 px-1 pt-2"
        style={{ borderTop: "1px solid var(--lm-border)" }}
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
          placeholder="Save the filters that are on as…"
          maxLength={80}
          className="min-w-0 flex-1 bg-transparent py-1.5 outline-none"
          style={{
            fontSize: "11px",
            fontWeight: 600,
            letterSpacing: "0.08em",
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
            background: "linear-gradient(135deg, var(--gradient-1), var(--gradient-3))",
            borderRadius: "999px",
            opacity: busy || !name.trim() ? 0.45 : 1,
          }}
        >
          <Check className="h-3 w-3" aria-hidden />
          {busy ? "Saving" : "Save view"}
        </button>
      </form>

      {error ? (
        <p
          role="alert"
          className="mt-2 px-1"
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
      title={checked ? "Skill cards show in the grid" : "Skill cards are hidden from the grid"}
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
