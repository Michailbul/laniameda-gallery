"use client";

import { type FormEvent, useState } from "react";
import { Check, FolderPlus, Layers, Loader2, X } from "lucide-react";

interface CollectionViewActionsProps {
  collectionName: string;
  childCount: number;
  expanded: boolean;
  canCreateFolder: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onCreateFolder: (name: string) => Promise<boolean>;
}

const actionStyle: React.CSSProperties = {
  fontFamily: "var(--lm-font)",
  fontSize: "10px",
  fontWeight: 750,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
};

/**
 * Controls for a root collection's overview. These live beside the breadcrumb
 * because both actions change the hierarchy being viewed: flatten its child
 * folders, or add another child folder to it.
 */
export function CollectionViewActions({
  collectionName,
  childCount,
  expanded,
  canCreateFolder,
  onExpandedChange,
  onCreateFolder,
}: CollectionViewActionsProps) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const closeCreator = () => {
    if (busy) return;
    setCreating(false);
    setDraft("");
    setError(undefined);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = draft.trim();
    if (!name || busy) return;

    setBusy(true);
    setError(undefined);
    try {
      const created = await onCreateFolder(name);
      if (!created) {
        setError("Couldn’t create folder");
        return;
      }
      setCreating(false);
      setDraft("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Couldn’t create folder",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-4 gap-y-2">
      {childCount > 0 && (
        <button
          type="button"
          aria-pressed={expanded}
          onClick={() => onExpandedChange(!expanded)}
          className="lm-quiet-action inline-flex items-center gap-1.5 border-none bg-transparent p-0"
          style={{
            ...actionStyle,
            color: expanded ? "var(--lm-coral)" : "var(--lm-text-ghost)",
          }}
          title={
            expanded
              ? `Return to the folder overview for ${collectionName}`
              : `Show every asset inside ${collectionName}`
          }
        >
          <Layers className="h-3 w-3" aria-hidden />
          {expanded ? "Show folders" : "Expand all"}
          <span aria-hidden style={{ color: "var(--lm-text-ghost)" }}>
            {childCount}
          </span>
        </button>
      )}

      {canCreateFolder && !creating && (
        <button
          type="button"
          onClick={() => {
            setCreating(true);
            setError(undefined);
          }}
          className="lm-quiet-action inline-flex items-center gap-1.5 border-none bg-transparent p-0"
          style={{ ...actionStyle, color: "var(--lm-text-ghost)" }}
          title={`Create a folder inside ${collectionName}`}
        >
          <FolderPlus className="h-3 w-3" aria-hidden />
          New folder
        </button>
      )}

      {canCreateFolder && creating && (
        <form
          onSubmit={submit}
          className="flex min-w-[220px] flex-col items-end gap-1"
          aria-label={`Create a folder inside ${collectionName}`}
        >
          <div
            className="flex w-full items-center gap-2 px-2 py-1"
            style={{
              backgroundColor: "var(--lm-surface-2)",
              border: "1px solid var(--lm-border-strong)",
              borderRadius: "8px",
              boxShadow: "var(--lm-shadow-sm)",
            }}
          >
            <FolderPlus
              className="h-3.5 w-3.5 flex-none"
              style={{ color: "var(--lm-coral)" }}
              aria-hidden
            />
            <input
              autoFocus
              value={draft}
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") closeCreator();
              }}
              placeholder="e.g. Wardrobe or Props"
              aria-label="Folder name"
              className="min-w-0 flex-1 border-none bg-transparent p-0 outline-none"
              style={{
                fontFamily: "var(--lm-font)",
                fontSize: "10px",
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--lm-text-primary)",
                caretColor: "var(--lm-coral)",
              }}
            />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              aria-label="Create folder"
              title="Create folder"
              className="grid h-5 w-5 flex-none place-items-center border-none bg-transparent p-0"
              style={{
                color: "var(--lm-coral)",
                opacity: busy || !draft.trim() ? 0.4 : 1,
              }}
            >
              {busy ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              ) : (
                <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
              )}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={closeCreator}
              aria-label="Cancel new folder"
              title="Cancel"
              className="grid h-5 w-5 flex-none place-items-center border-none bg-transparent p-0"
              style={{ color: "var(--lm-text-ghost)" }}
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </div>
          {error && (
            <span
              role="alert"
              style={{
                fontFamily: "var(--lm-font)",
                fontSize: "9px",
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--lm-coral)",
              }}
            >
              {error}
            </span>
          )}
        </form>
      )}
    </div>
  );
}
