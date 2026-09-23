"use client";

import { useMemo, useState } from "react";
import { Check, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Destination picker for manual ingest.
 *
 * Replaces a flat portaled `<Select>` that rendered *behind* the upload modal,
 * so picking a collection silently did nothing.
 *
 * This is an inline list instead of a popover: nothing to portal, nothing to
 * stack, and the destinations stay visible while the rest of the form is filled
 * in. Rows are hairline rows rather than tiles — one line per destination, its
 * group as the only chrome. Multi-select, because an asset legitimately belongs
 * to a collection AND one of another collection's folders at the same time.
 */

export type DestinationOption = {
  id: string;
  name: string;
  /** Right-aligned qualifier — the parent collection, or a count. */
  meta?: string;
};

export type DestinationGroup = {
  key: string;
  label: string;
  options: DestinationOption[];
};

export function DestinationField({
  groups,
  selectedIds,
  onToggle,
  onCreate,
  parents = [],
  onCreateInside,
  creating = false,
  disabled = false,
  idPrefix,
}: {
  groups: DestinationGroup[];
  selectedIds: string[];
  onToggle: (folderId: string) => void;
  /** Omit to hide the create affordance (e.g. signed-out). */
  onCreate?: (name: string) => Promise<void> | void;
  /** Root collections a folder can be created inside ("Parent / name"). */
  parents?: { id: string; name: string }[];
  onCreateInside?: (parentId: string, name: string) => Promise<void> | void;
  creating?: boolean;
  disabled?: boolean;
  idPrefix: string;
}) {
  const [query, setQuery] = useState("");

  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of groups) {
      for (const option of group.options) map.set(option.id, option.name);
    }
    return map;
  }, [groups]);

  const needle = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!needle) return groups;
    return groups
      .map((group) => ({
        ...group,
        options: group.options.filter(
          (option) =>
            option.name.toLowerCase().includes(needle) ||
            group.label.toLowerCase().includes(needle),
        ),
      }))
      .filter((group) => group.options.length > 0);
  }, [groups, needle]);

  // "CASSANDRA / Balcony" names a folder inside an existing collection.
  const nested = useMemo(() => {
    if (!onCreateInside) return null;
    const slash = query.indexOf("/");
    if (slash < 0) return null;
    const parentName = query.slice(0, slash).trim().toLowerCase();
    const name = query.slice(slash + 1).trim();
    if (!parentName || !name) return null;
    const parent = parents.find(
      (entry) => entry.name.trim().toLowerCase() === parentName,
    );
    return parent ? { parent, name } : null;
  }, [onCreateInside, parents, query]);

  const exactExists = useMemo(
    () =>
      groups.some((group) =>
        group.options.some(
          (option) => option.name.trim().toLowerCase() === needle,
        ),
      ),
    [groups, needle],
  );

  const submitCreate = () => {
    const name = query.trim();
    if (!name) return;
    if (nested && onCreateInside) {
      void Promise.resolve(onCreateInside(nested.parent.id, nested.name)).then(
        () => setQuery(""),
      );
      return;
    }
    if (!onCreate || exactExists) return;
    void Promise.resolve(onCreate(name)).then(() => setQuery(""));
  };

  const mono = "[font-family:var(--lm-font)]";
  const groupLabel = cn(
    mono,
    "text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--lm-text-ghost)]",
  );

  return (
    <div className="flex flex-col gap-2.5">
      {/* Picked, as removable chips — the answer to "where is this going?" */}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {selectedIds.map((id) => (
            <button
              key={id}
              type="button"
              disabled={disabled}
              onClick={() => onToggle(id)}
              aria-label={`Remove ${nameById.get(id) ?? "destination"}`}
              className={cn(
                mono,
                "group inline-flex items-center gap-1.5 text-[12px] font-semibold tracking-wide text-[var(--lm-coral)] transition-opacity hover:opacity-70 disabled:opacity-40",
              )}
            >
              {nameById.get(id) ?? "Unknown"}
              <span className="text-[var(--lm-text-ghost)] transition-colors group-hover:text-[var(--lm-coral)]">
                ×
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 border-b border-[var(--lm-border)] focus-within:border-[var(--lm-coral)]">
        <Search
          className="h-3.5 w-3.5 shrink-0 text-[var(--lm-text-ghost)]"
          aria-hidden
        />
        <input
          id={`${idPrefix}-destination-search`}
          type="text"
          value={query}
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            submitCreate();
          }}
          placeholder={
            onCreateInside
              ? "Filter, name a new collection, or Parent / folder"
              : "Filter or name a new collection"
          }
          className="h-10 w-full bg-transparent text-[14px] text-[var(--lm-text-primary)] outline-none placeholder:text-[var(--lm-text-ghost)]"
        />
      </div>

      {((onCreate && needle.length > 0 && !exactExists) || nested) && (
        <button
          type="button"
          disabled={creating || disabled}
          onClick={submitCreate}
          className={cn(
            mono,
            "inline-flex items-center gap-1.5 self-start text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--lm-coral)] underline-offset-4 transition-opacity hover:underline disabled:opacity-40 disabled:no-underline",
          )}
        >
          <Plus className="h-3 w-3" aria-hidden />
          {creating
            ? "Creating…"
            : nested
              ? `Create “${nested.name}” inside ${nested.parent.name}`
              : `Create “${query.trim()}”`}
        </button>
      )}

      <div className="max-h-[260px] overflow-y-auto overscroll-contain">
        {filtered.length === 0 ? (
          <p className="py-3 text-[12px] text-[var(--lm-text-ghost)]">
            {groups.length === 0
              ? "No collections yet — type a name above to make one."
              : "Nothing matches that."}
          </p>
        ) : (
          filtered.map((group) => (
            <div key={group.key} className="pb-1.5">
              <div className="flex items-center gap-3 pb-1 pt-2.5">
                <span className={groupLabel}>{group.label}</span>
                <span
                  className="h-px flex-1 bg-[var(--lm-border)]"
                  aria-hidden
                />
              </div>
              {group.options.map((option) => {
                const isOn = selected.has(option.id);
                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={disabled}
                    aria-pressed={isOn}
                    onClick={() => onToggle(option.id)}
                    className={cn(
                      "flex w-full items-center gap-3 py-[7px] text-left transition-colors disabled:opacity-40",
                      isOn
                        ? "text-[var(--lm-coral)]"
                        : "text-[var(--lm-text-secondary)] hover:text-[var(--lm-text-primary)]",
                    )}
                  >
                    <Check
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 transition-opacity",
                        isOn ? "opacity-100" : "opacity-0",
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate text-[13.5px]">
                      {option.name}
                    </span>
                    {option.meta && (
                      <span
                        className={cn(
                          mono,
                          "shrink-0 text-[10px] uppercase tracking-[0.14em] text-[var(--lm-text-ghost)]",
                        )}
                      >
                        {option.meta}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
