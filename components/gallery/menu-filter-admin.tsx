"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ArrowDown, ArrowUp, Check, Trash2, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { MenuFilterItem } from "./filter-bar";

// Admin panel for the curated menu pills. Flat rows with hairline dividers —
// rename, remap (tag names / collection), reorder, delete, add. Only rendered
// for the owner in "mine" scope.

const ROW_TEXT: React.CSSProperties = {
  fontFamily: "var(--lm-font)",
  fontSize: "10px",
  fontWeight: 600,
  letterSpacing: "0.08em",
  color: "var(--lm-text-secondary)",
};

const INPUT_STYLE: React.CSSProperties = {
  fontFamily: "var(--lm-font)",
  fontSize: "10px",
  fontWeight: 600,
  letterSpacing: "0.08em",
  color: "var(--lm-text-primary)",
  background: "transparent",
  border: "none",
  borderBottom: "1px solid var(--lm-border)",
  outline: "none",
  padding: "3px 2px",
};

const GHOST_LABEL: React.CSSProperties = {
  fontFamily: "var(--lm-font)",
  fontSize: "8px",
  fontWeight: 800,
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: "var(--lm-text-ghost)",
};

const parseTagNames = (raw: string) =>
  raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

export function MenuFilterAdmin({
  ownerUserId,
  menuFilters,
  onClose,
}: {
  ownerUserId: string;
  menuFilters: MenuFilterItem[];
  onClose: () => void;
}) {
  const folders = useQuery(api.folders.listFolders, { ownerUserId });
  const createMenuFilter = useMutation(api.menuFilters.createMenuFilter);
  const updateMenuFilter = useMutation(api.menuFilters.updateMenuFilter);
  const deleteMenuFilter = useMutation(api.menuFilters.deleteMenuFilter);
  const reorderMenuFilters = useMutation(api.menuFilters.reorderMenuFilters);

  const [error, setError] = useState<string | null>(null);

  // New-entry draft
  const [draftLabel, setDraftLabel] = useState("");
  const [draftKind, setDraftKind] = useState<"tag" | "collection">("tag");
  const [draftTagNames, setDraftTagNames] = useState("");
  const [draftFolderId, setDraftFolderId] = useState("");
  const [saving, setSaving] = useState(false);

  // Only plain collections and storybooks can back a pill (matches the
  // backend guard — projects and directions are workspace furniture).
  const collectionOptions = useMemo(
    () =>
      (folders ?? [])
        .filter(
          (folder) => !folder.kind || folder.kind === "storybook",
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [folders],
  );

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message.replace(/^.*Error:\s*/, "")
          : "Something went wrong.",
      );
    }
  };

  const handleAdd = () =>
    run(async () => {
      const label = draftLabel.trim();
      if (!label) {
        throw new Error("Give the filter a label.");
      }
      setSaving(true);
      try {
        await createMenuFilter({
          ownerUserId,
          label,
          kind: draftKind,
          tagNames:
            draftKind === "tag"
              ? parseTagNames(draftTagNames.trim() || label)
              : undefined,
          folderId:
            draftKind === "collection" && draftFolderId
              ? (draftFolderId as Id<"folders">)
              : undefined,
        });
        setDraftLabel("");
        setDraftTagNames("");
        setDraftFolderId("");
      } finally {
        setSaving(false);
      }
    });

  const handleMove = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= menuFilters.length) return;
    const orderedIds = menuFilters.map((entry) => entry._id);
    [orderedIds[index], orderedIds[target]] = [
      orderedIds[target],
      orderedIds[index],
    ];
    void run(() =>
      reorderMenuFilters({
        ownerUserId,
        orderedIds: orderedIds as Id<"menuFilters">[],
      }),
    );
  };

  return (
    <div
      style={{
        borderTop: "1px solid var(--lm-border)",
        padding: "10px 16px 14px",
      }}
    >
      <div className="flex items-center justify-between pb-2">
        <span style={GHOST_LABEL}>Menu filters</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close menu filter admin"
          style={{ color: "var(--lm-text-ghost)" }}
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      {menuFilters.map((entry, index) => (
        <MenuFilterRow
          key={entry._id}
          entry={entry}
          isFirst={index === 0}
          isLast={index === menuFilters.length - 1}
          collectionOptions={collectionOptions}
          onRename={(label) =>
            run(() =>
              updateMenuFilter({
                ownerUserId,
                menuFilterId: entry._id as Id<"menuFilters">,
                label,
              }),
            )
          }
          onRemapTags={(tagNames) =>
            run(() =>
              updateMenuFilter({
                ownerUserId,
                menuFilterId: entry._id as Id<"menuFilters">,
                tagNames,
              }),
            )
          }
          onRemapFolder={(folderId) =>
            run(() =>
              updateMenuFilter({
                ownerUserId,
                menuFilterId: entry._id as Id<"menuFilters">,
                folderId: folderId as Id<"folders">,
              }),
            )
          }
          onMoveUp={() => handleMove(index, -1)}
          onMoveDown={() => handleMove(index, 1)}
          onDelete={() =>
            run(() =>
              deleteMenuFilter({
                ownerUserId,
                menuFilterId: entry._id as Id<"menuFilters">,
              }),
            )
          }
        />
      ))}

      {/* Add row */}
      <div
        className="flex flex-wrap items-center gap-2 pt-2"
        style={{
          borderTop:
            menuFilters.length > 0 ? "1px solid var(--lm-border)" : "none",
          marginTop: menuFilters.length > 0 ? "6px" : 0,
        }}
      >
        <input
          value={draftLabel}
          onChange={(event) => setDraftLabel(event.target.value)}
          placeholder="NEW FILTER LABEL"
          aria-label="New filter label"
          style={{ ...INPUT_STYLE, width: "140px", textTransform: "uppercase" }}
        />
        <div className="flex items-center gap-1">
          {(["tag", "collection"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setDraftKind(kind)}
              style={{
                ...GHOST_LABEL,
                padding: "3px 8px",
                borderRadius: "999px",
                border:
                  draftKind === kind
                    ? "1px solid var(--lm-ink)"
                    : "1px solid var(--lm-border)",
                color:
                  draftKind === kind
                    ? "var(--lm-text-primary)"
                    : "var(--lm-text-ghost)",
              }}
            >
              {kind}
            </button>
          ))}
        </div>
        {draftKind === "tag" ? (
          <input
            value={draftTagNames}
            onChange={(event) => setDraftTagNames(event.target.value)}
            placeholder="tag names, comma-separated (defaults to label)"
            aria-label="Tag names"
            style={{ ...INPUT_STYLE, minWidth: "220px", flex: 1 }}
          />
        ) : (
          <select
            value={draftFolderId}
            onChange={(event) => setDraftFolderId(event.target.value)}
            aria-label="Collection"
            style={{
              ...ROW_TEXT,
              background: "var(--lm-surface-1)",
              border: "1px solid var(--lm-border)",
              borderRadius: "8px",
              padding: "3px 6px",
              minWidth: "180px",
            }}
          >
            <option value="">Pick a collection…</option>
            {collectionOptions.map((folder) => (
              <option key={folder._id} value={folder._id}>
                {folder.name}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={handleAdd}
          disabled={saving || !draftLabel.trim()}
          className="flex items-center gap-1 disabled:opacity-30"
          style={{
            ...GHOST_LABEL,
            color: "var(--lm-text-primary)",
            padding: "3px 10px",
            borderRadius: "999px",
            border: "1px solid var(--lm-ink)",
          }}
        >
          <Check className="h-3 w-3" />
          Add
        </button>
      </div>

      {error ? (
        <div
          className="pt-2"
          style={{ ...ROW_TEXT, color: "var(--lm-coral)" }}
          role="alert"
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}

function MenuFilterRow({
  entry,
  isFirst,
  isLast,
  collectionOptions,
  onRename,
  onRemapTags,
  onRemapFolder,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  entry: MenuFilterItem;
  isFirst: boolean;
  isLast: boolean;
  collectionOptions: Array<{ _id: string; name: string }>;
  onRename: (label: string) => void;
  onRemapTags: (tagNames: string[]) => void;
  onRemapFolder: (folderId: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}) {
  const [label, setLabel] = useState(entry.label);
  const [tagNames, setTagNames] = useState((entry.tagNames ?? []).join(", "));

  const commitLabel = () => {
    const next = label.trim();
    if (next && next !== entry.label) {
      onRename(next);
    } else {
      setLabel(entry.label);
    }
  };

  const commitTagNames = () => {
    const next = parseTagNames(tagNames);
    if (
      next.length > 0 &&
      next.join("|") !== (entry.tagNames ?? []).join("|")
    ) {
      onRemapTags(next);
    } else {
      setTagNames((entry.tagNames ?? []).join(", "));
    }
  };

  return (
    <div
      className="flex flex-wrap items-center gap-2 py-1.5"
      style={{ borderTop: isFirst ? "none" : "1px solid var(--lm-border)" }}
    >
      <input
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        onBlur={commitLabel}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        aria-label={`Rename ${entry.label}`}
        style={{ ...INPUT_STYLE, width: "140px", textTransform: "uppercase" }}
      />
      <span style={GHOST_LABEL}>{entry.kind}</span>
      {entry.kind === "tag" ? (
        <input
          value={tagNames}
          onChange={(event) => setTagNames(event.target.value)}
          onBlur={commitTagNames}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          aria-label={`Tags for ${entry.label}`}
          style={{ ...INPUT_STYLE, minWidth: "220px", flex: 1 }}
        />
      ) : (
        <select
          value={entry.folderId ?? ""}
          onChange={(event) => {
            if (event.target.value) onRemapFolder(event.target.value);
          }}
          aria-label={`Collection for ${entry.label}`}
          style={{
            fontFamily: "var(--lm-font)",
            fontSize: "10px",
            fontWeight: 600,
            letterSpacing: "0.08em",
            color: "var(--lm-text-secondary)",
            background: "var(--lm-surface-1)",
            border: "1px solid var(--lm-border)",
            borderRadius: "8px",
            padding: "3px 6px",
            minWidth: "180px",
          }}
        >
          <option value="">Pick a collection…</option>
          {collectionOptions.map((folder) => (
            <option key={folder._id} value={folder._id}>
              {folder.name}
            </option>
          ))}
        </select>
      )}
      <span style={{ ...GHOST_LABEL, marginLeft: "auto" }}>{entry.count}</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onMoveUp}
          disabled={isFirst}
          aria-label={`Move ${entry.label} up`}
          className="disabled:opacity-20"
          style={{ color: "var(--lm-text-ghost)" }}
        >
          <ArrowUp className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={isLast}
          aria-label={`Move ${entry.label} down`}
          className="disabled:opacity-20"
          style={{ color: "var(--lm-text-ghost)" }}
        >
          <ArrowDown className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${entry.label}`}
          style={{ color: "var(--lm-text-ghost)" }}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
