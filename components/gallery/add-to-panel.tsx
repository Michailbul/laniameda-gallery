"use client";

/* eslint-disable @next/next/no-img-element */
import { Fragment, useCallback, useMemo, useState } from "react";
import {
  ChevronRight,
  FolderClosed,
  FolderMinus,
  Orbit,
  Plus,
  Search,
  X,
} from "lucide-react";
import { hasAssetDragPayload, readAssetDragPayload } from "@/lib/asset-drag";
import {
  collectionGroupKey,
  normalizeCollectionGroup,
  orderChildCollections,
} from "@/lib/collection-groups";
import {
  collectionNameMatches,
  compareRootCollections,
} from "@/lib/collection-worlds";

/**
 * "Move to" — the one place assets get sorted.
 *
 * A floating, non-modal panel: the gallery stays scrollable and drag-and-drop
 * keeps working while it's open. It reads as one tree: worlds first, then the
 * shared collections, each root unfolding in place to its folders. Every row
 * is a click target (adds the selection, or takes it out when all of it is
 * already there) and a drop target (adds what was dropped). "Already in"
 * lists where the selection lives now, each with an explicit Remove.
 */

export type PanelPreview = { thumbUrl?: string; url?: string };

export type PanelCollection = {
  id: string;
  name: string;
  description?: string;
  count?: number;
  parentId?: string;
  /** A world root: listed first. */
  isWorld?: boolean;
  pinned?: boolean;
  /** Display group of a child inside its root ("Styles"), and its order. */
  group?: string;
  sortOrder?: number;
  previews?: PanelPreview[];
  /** How many assets in the current selection already belong here. */
  selectedCount?: number;
};

type Busy = string | null;

export function AddToPanel({
  open,
  onClose,
  selectedAssetIds,
  collections,
  onAddToFolder,
  onToggleFolder,
  onRemoveFromFolder,
  onCreateCollection,
  onCreateSubCollection,
  onUpdateDescription,
  topOffset = 0,
}: {
  open: boolean;
  onClose: () => void;
  selectedAssetIds: string[];
  collections: PanelCollection[];
  onAddToFolder: (folderId: string, assetIds: string[]) => Promise<void> | void;
  onToggleFolder: (folderId: string) => Promise<void> | void;
  /** Takes the selected members out of this collection. */
  onRemoveFromFolder: (folderId: string) => Promise<void> | void;
  onCreateCollection: (name: string, assetIds: string[]) => Promise<void> | void;
  /** Creates a folder inside a root collection and files the ids into it. */
  onCreateSubCollection: (
    parentId: string,
    name: string,
    assetIds: string[],
  ) => Promise<void> | void;
  onUpdateDescription: (
    folderId: string,
    description: string,
  ) => Promise<void> | void;
  topOffset?: number;
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [folderDraftFor, setFolderDraftFor] = useState<string | null>(null);
  const [folderName, setFolderName] = useState("");
  const [describing, setDescribing] = useState<string | null>(null);
  const [collectionDrafting, setCollectionDrafting] = useState(false);
  const [collectionName, setCollectionName] = useState("");
  const [busyKey, setBusyKey] = useState<Busy>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const count = selectedAssetIds.length;

  const run = useCallback(
    async (key: string, message: string, action: () => Promise<void> | void) => {
      setBusyKey(key);
      try {
        await action();
        setFlash(message);
      } catch (error) {
        setFlash(
          error instanceof Error ? error.message : "Could not update selection",
        );
      } finally {
        setBusyKey(null);
      }
    },
    [],
  );

  const toggleExpanded = useCallback((id: string, next?: boolean) => {
    setExpanded((prev) => {
      const isOpen = next ?? !prev.has(id);
      if (isOpen === prev.has(id)) return prev;
      const copy = new Set(prev);
      if (isOpen) copy.add(id);
      else copy.delete(id);
      return copy;
    });
  }, []);

  const { roots, childrenByParent, byId } = useMemo(() => {
    const ids = new Set(collections.map((entry) => entry.id));
    const children = new Map<string, PanelCollection[]>();
    const rootList: PanelCollection[] = [];
    for (const entry of collections) {
      if (entry.parentId && ids.has(entry.parentId)) {
        const list = children.get(entry.parentId) ?? [];
        list.push(entry);
        children.set(entry.parentId, list);
      } else {
        rootList.push(entry);
      }
    }
    for (const [parentId, list] of children) {
      children.set(parentId, orderChildCollections(list));
    }
    const sortable = (entry: PanelCollection) => ({
      name: entry.name,
      // compareRootCollections reads the world flag from these two fields.
      group: entry.isWorld ? "World" : undefined,
      pinnedAt: entry.pinned ? 1 : undefined,
      sortOrder: entry.sortOrder,
    });
    rootList.sort((left, right) =>
      compareRootCollections(sortable(left), sortable(right)),
    );
    return {
      roots: rootList,
      childrenByParent: children,
      byId: new Map(collections.map((entry) => [entry.id, entry])),
    };
  }, [collections]);

  // Search keeps a root when it or a folder matches, and opens it on a
  // folder match.
  const searching = query.trim().length > 0;
  const visibleRoots = useMemo(
    () =>
      roots.flatMap((root) => {
        const children = childrenByParent.get(root.id) ?? [];
        if (!searching) return [{ root, children, forcedOpen: false }];
        const childMatches = children.filter((child) =>
          collectionNameMatches(child.name, query),
        );
        if (!collectionNameMatches(root.name, query) && childMatches.length === 0) {
          return [];
        }
        return [
          {
            root,
            children: childMatches.length > 0 ? childMatches : children,
            forcedOpen: childMatches.length > 0,
          },
        ];
      }),
    [roots, childrenByParent, query, searching],
  );
  const worlds = visibleRoots.filter((entry) => entry.root.isWorld);
  const plain = visibleRoots.filter((entry) => !entry.root.isWorld);

  // Where the selection already lives, worlds first, each root before its
  // folders.
  const memberships = useMemo(() => {
    if (count === 0) return [];
    return roots.flatMap((root) =>
      [root, ...(childrenByParent.get(root.id) ?? [])].filter(
        (entry) => (entry.selectedCount ?? 0) > 0,
      ),
    );
  }, [childrenByParent, count, roots]);

  if (!open) return null;

  const activate = (entry: PanelCollection, dropped?: string[]) => {
    if (dropped && dropped.length > 0) {
      return run(entry.id, `Added to ${entry.name}`, () =>
        onAddToFolder(entry.id, dropped),
      );
    }
    if (count === 0) {
      setFlash("Select pieces first, or drag them onto a row");
      return;
    }
    const all = (entry.selectedCount ?? 0) === count;
    return run(
      entry.id,
      all ? `Removed from ${entry.name}` : `Added to ${entry.name}`,
      () => onToggleFolder(entry.id),
    );
  };

  const renderRoot = ({
    root,
    children,
    forcedOpen,
  }: {
    root: PanelCollection;
    children: PanelCollection[];
    forcedOpen: boolean;
  }) => {
    const isOpen = forcedOpen || expanded.has(root.id);
    const allChildren = childrenByParent.get(root.id) ?? [];
    return (
      <div key={root.id} style={{ marginBottom: 2 }}>
        <Row
          entry={root}
          level="root"
          busy={busyKey === root.id}
          selectionTotal={count}
          folderCount={allChildren.length}
          expanded={allChildren.length > 0 ? isOpen : undefined}
          onToggleExpand={() => toggleExpanded(root.id, !isOpen)}
          onDragHover={() => {
            if (allChildren.length > 0) toggleExpanded(root.id, true);
          }}
          onActivate={(dropped) => activate(root, dropped)}
        />
        {isOpen && (
          <div style={{ position: "relative", padding: "2px 0 8px" }}>
            <span
              aria-hidden
              style={{
                position: "absolute",
                left: 27,
                top: 0,
                bottom: 14,
                width: 1,
                background: "var(--lm-sidebar-divider)",
              }}
            />
            {children.map((child, index) => {
              const groupKey = collectionGroupKey(child.group);
              const previousKey = collectionGroupKey(children[index - 1]?.group);
              const groupLabel =
                groupKey && groupKey !== previousKey
                  ? normalizeCollectionGroup(child.group)
                  : !groupKey && previousKey
                    ? "Other"
                    : undefined;
              return (
                <Fragment key={child.id}>
                  {groupLabel && <p style={groupLabelStyle}>{groupLabel}</p>}
                  <Row
                    entry={child}
                    level="child"
                    busy={busyKey === child.id}
                    selectionTotal={count}
                    onActivate={(dropped) => activate(child, dropped)}
                  />
                </Fragment>
              );
            })}
            <div style={{ display: "flex", gap: 14, padding: "6px 0 0 44px" }}>
              <button
                type="button"
                onClick={() => {
                  setFolderDraftFor(root.id);
                  setFolderName("");
                }}
                style={inlineActionStyle}
              >
                <Plus size={11} /> New folder
              </button>
              <button
                type="button"
                onClick={() =>
                  setDescribing((prev) => (prev === root.id ? null : root.id))
                }
                style={{ ...inlineActionStyle, color: "var(--lm-sidebar-text-muted)" }}
              >
                {describing === root.id ? "Done" : "Description"}
              </button>
            </div>
            {folderDraftFor === root.id && (
              <div style={{ padding: "0 0 0 44px" }}>
                <InlineCreate
                  placeholder={`Folder inside ${root.name}…`}
                  value={folderName}
                  onChange={setFolderName}
                  onCancel={() => setFolderDraftFor(null)}
                  onSubmit={async () => {
                    const name = folderName.trim();
                    if (!name) return;
                    await run(`new-folder:${root.id}`, `Created ${name}`, () =>
                      onCreateSubCollection(root.id, name, selectedAssetIds),
                    );
                    setFolderDraftFor(null);
                    setFolderName("");
                  }}
                />
              </div>
            )}
            {describing === root.id && (
              <div style={{ padding: "0 0 0 44px" }}>
                <DescriptionEditor
                  value={root.description ?? ""}
                  onSave={(text) => onUpdateDescription(root.id, text)}
                />
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label="Move selected assets"
      className="lm-animate-slide-right"
      style={{
        position: "fixed",
        top: `max(${topOffset + 16}px, env(safe-area-inset-top))`,
        right: 16,
        bottom: 16,
        width: "min(420px, calc(100vw - 32px))",
        zIndex: 65,
        display: "flex",
        flexDirection: "column",
        background: "var(--lm-sidebar-bg)",
        border: "2px solid var(--lm-ink)",
        borderRadius: 18,
        overflow: "hidden",
        boxShadow: "-18px 22px 64px -26px rgba(0,0,0,0.72)",
      }}
    >
      <header
        style={{
          padding: "14px 14px 12px 16px",
          borderBottom: "1px solid var(--lm-sidebar-divider)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <p style={kickerStyle}>Move to</p>
            <p
              style={{
                margin: "5px 0 0",
                fontFamily: "var(--lm-font)",
                fontSize: 15,
                fontWeight: 800,
                letterSpacing: "-0.01em",
                color: count > 0 ? "var(--lm-sidebar-text)" : "var(--lm-sidebar-text-muted)",
              }}
            >
              {count > 0
                ? `${count} ${count === 1 ? "piece" : "pieces"} selected`
                : "Nothing selected"}
            </p>
            <p
              aria-live="polite"
              style={{
                margin: "2px 0 0",
                minHeight: 15,
                fontFamily: "var(--lm-font)",
                fontSize: 11.5,
                color: flash ? "var(--lm-coral)" : "var(--lm-sidebar-text-ghost)",
              }}
            >
              {flash ??
                (count > 0
                  ? "Click a row to add. Click a checked row to take them out."
                  : "Select pieces, or drag them onto a row.")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close move-to panel"
            style={iconButtonStyle}
          >
            <X size={16} />
          </button>
        </div>
        <label style={searchStyle}>
          <Search size={13} style={{ color: "var(--lm-sidebar-text-ghost)", flexShrink: 0 }} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setQuery("");
            }}
            placeholder="Find a world, collection or folder"
            aria-label="Find a world, collection or folder"
            style={{
              flex: 1,
              minWidth: 0,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--lm-sidebar-text)",
              fontFamily: "var(--lm-font)",
              fontSize: 12.5,
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              style={{ ...iconButtonStyle, padding: 0 }}
            >
              <X size={12} />
            </button>
          )}
        </label>
      </header>

      <div style={{ overflowY: "auto", flex: 1, padding: "6px 10px 28px" }}>
        {memberships.length > 0 && !searching && (
          <section style={{ marginBottom: 6 }}>
            <SectionTitle label="Already in" count={memberships.length} />
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {memberships.map((entry) => {
                const parent = entry.parentId ? byId.get(entry.parentId) : undefined;
                const members = entry.selectedCount ?? 0;
                return (
                  <div key={entry.id} style={memberRowStyle}>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      {parent && (
                        <span style={memberParentStyle}>{parent.name}</span>
                      )}
                      <span style={memberNameStyle}>{entry.name}</span>
                    </span>
                    <span style={memberCountStyle}>
                      {members === count ? "all" : `${members}/${count}`}
                    </span>
                    <button
                      type="button"
                      disabled={busyKey === `remove:${entry.id}`}
                      onClick={() =>
                        void run(
                          `remove:${entry.id}`,
                          `Removed from ${entry.name}`,
                          () => onRemoveFromFolder(entry.id),
                        )
                      }
                      aria-label={`Remove the selection from ${entry.name}`}
                      title={`Take ${members === 1 ? "it" : "them"} out of ${entry.name}. The pieces stay in the gallery.`}
                      style={removeButtonStyle}
                    >
                      <FolderMinus size={12} /> Remove
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {worlds.length > 0 && (
          <section>
            <SectionTitle icon={Orbit} label="Worlds" count={worlds.length} />
            {worlds.map(renderRoot)}
          </section>
        )}

        {plain.length > 0 && (
          <section>
            <SectionTitle icon={FolderClosed} label="Collections" count={plain.length} />
            {plain.map(renderRoot)}
          </section>
        )}

        {searching && visibleRoots.length === 0 && (
          <Hint>Nothing called &ldquo;{query.trim()}&rdquo;.</Hint>
        )}
        {!searching && roots.length === 0 && <Hint>No collections yet.</Hint>}

        <div style={{ marginTop: 12, paddingLeft: 6 }}>
          {collectionDrafting ? (
            <InlineCreate
              placeholder="Collection name…"
              value={collectionName}
              onChange={setCollectionName}
              onCancel={() => setCollectionDrafting(false)}
              onSubmit={async () => {
                const name = collectionName.trim();
                if (!name) return;
                await run("new-collection", `Created ${name}`, () =>
                  onCreateCollection(name, selectedAssetIds),
                );
                setCollectionDrafting(false);
                setCollectionName("");
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setCollectionDrafting(true);
                setCollectionName("");
              }}
              style={{ ...inlineActionStyle, fontSize: 10.5 }}
            >
              <Plus size={12} /> New collection
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}

/**
 * One destination row. A root carries a cover, its full name (two lines
 * before it clips) and how many pieces and folders it holds; a folder is a
 * lighter row on the root's spine. `onActivate` receives the dropped ids
 * when it was a drop, and nothing when it was a click.
 */
function Row({
  entry,
  level,
  busy,
  selectionTotal,
  folderCount = 0,
  expanded,
  onToggleExpand,
  onDragHover,
  onActivate,
}: {
  entry: PanelCollection;
  level: "root" | "child";
  busy: boolean;
  selectionTotal: number;
  folderCount?: number;
  expanded?: boolean;
  onToggleExpand?: () => void;
  onDragHover?: () => void;
  onActivate: (droppedIds?: string[]) => void;
}) {
  const [over, setOver] = useState(false);
  const root = level === "root";
  const selected = entry.selectedCount ?? 0;
  const complete = selectionTotal > 0 && selected === selectionTotal;
  const marked = selectionTotal > 0 && selected > 0;
  const cover = entry.previews?.[0]?.thumbUrl ?? entry.previews?.[0]?.url;
  const thumb = root ? 38 : 26;

  return (
    <div
      onDragOver={(event) => {
        if (!hasAssetDragPayload(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy"; // every destination ADDS
        if (!over) onDragHover?.();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        if (!hasAssetDragPayload(event.dataTransfer)) return;
        event.preventDefault();
        setOver(false);
        onActivate(readAssetDragPayload(event.dataTransfer));
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        paddingLeft: root ? 0 : 38,
        borderRadius: 10,
        border: "1px solid",
        borderColor: over ? "var(--lm-coral)" : "transparent",
        background: over || complete ? "var(--lm-sidebar-active-fill)" : "transparent",
        transition: "background-color 120ms ease, border-color 120ms ease",
      }}
    >
      {root && (
        <button
          type="button"
          onClick={onToggleExpand}
          disabled={expanded === undefined}
          aria-label={
            expanded === undefined
              ? undefined
              : expanded
                ? `Collapse ${entry.name}`
                : `Show folders in ${entry.name}`
          }
          aria-expanded={expanded}
          style={{
            display: "grid",
            placeItems: "center",
            width: 22,
            height: 38,
            flexShrink: 0,
            border: "none",
            background: "none",
            padding: 0,
            cursor: expanded === undefined ? "default" : "pointer",
            color: "var(--lm-sidebar-text-muted)",
            visibility: expanded === undefined ? "hidden" : "visible",
          }}
        >
          <ChevronRight
            size={14}
            style={{
              transform: expanded ? "rotate(90deg)" : undefined,
              transition: "transform 140ms ease",
            }}
          />
        </button>
      )}
      <button
        type="button"
        role="checkbox"
        aria-checked={complete ? true : marked ? "mixed" : false}
        onClick={() => onActivate()}
        disabled={busy}
        title={
          complete
            ? `In ${entry.name}. Click to take the selection out.`
            : `Add the selection to ${entry.name}`
        }
        className="lm-move-row"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flex: 1,
          minWidth: 0,
          padding: root ? "5px 8px 5px 2px" : "4px 8px 4px 0",
          border: "none",
          borderRadius: 8,
          background: "transparent",
          textAlign: "left",
          cursor: "pointer",
          opacity: busy ? 0.5 : 1,
        }}
      >
        <span
          aria-hidden
          style={{
            width: thumb,
            height: thumb,
            flexShrink: 0,
            borderRadius: root ? 8 : 6,
            overflow: "hidden",
            display: "grid",
            placeItems: "center",
            background: "var(--lm-sidebar-hover-fill)",
            border: "1px solid var(--lm-sidebar-border)",
            color: "var(--lm-sidebar-text-ghost)",
          }}
        >
          {cover ? (
            <img
              src={cover}
              alt=""
              loading="lazy"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <FolderClosed size={root ? 14 : 11} />
          )}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              wordBreak: "break-word",
              fontFamily: "var(--lm-font)",
              color: "var(--lm-sidebar-text)",
              ...(root
                ? {
                    fontSize: 11.5,
                    fontWeight: 800,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase" as const,
                    lineHeight: 1.25,
                  }
                : { fontSize: 12.5, fontWeight: 500, lineHeight: 1.3 }),
            }}
          >
            {entry.name}
          </span>
          {root && (
            <span style={metaStyle}>
              {entry.count ?? 0} pieces
              {folderCount > 0 &&
                ` · ${folderCount} ${folderCount === 1 ? "folder" : "folders"}`}
            </span>
          )}
        </span>
        {!root && entry.count !== undefined && (
          <span style={{ ...metaStyle, marginTop: 0 }}>{entry.count}</span>
        )}
        <SelectionMark count={selected} total={selectionTotal} />
      </button>
    </div>
  );
}

function SelectionMark({ count, total }: { count: number; total: number }) {
  const complete = total > 0 && count === total;
  const mixed = count > 0 && !complete;
  return (
    <span
      aria-hidden
      style={{
        display: "inline-flex",
        minWidth: 20,
        height: 20,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        padding: mixed ? "0 4px" : 0,
        border: `1.5px solid ${
          complete || mixed ? "var(--lm-coral)" : "var(--lm-sidebar-border)"
        }`,
        borderRadius: 6,
        background: complete ? "var(--lm-coral)" : "transparent",
        color: complete ? "#191919" : "var(--lm-coral)",
        fontFamily: "var(--lm-font)",
        fontSize: 9,
        fontWeight: 800,
        fontVariantNumeric: "tabular-nums",
        visibility: total > 0 ? "visible" : "hidden",
      }}
    >
      {complete ? "✓" : mixed ? `${count}/${total}` : ""}
    </span>
  );
}

function SectionTitle({
  icon: Icon,
  label,
  count,
}: {
  icon?: typeof Orbit;
  label: string;
  count: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "14px 6px 8px",
        color: "var(--lm-sidebar-text-ghost)",
      }}
    >
      {Icon && <Icon size={12} aria-hidden />}
      <span style={kickerStyle}>{label}</span>
      <span
        aria-hidden
        style={{ flex: 1, height: 1, background: "var(--lm-sidebar-divider)" }}
      />
      <span style={{ ...kickerStyle, letterSpacing: "0.04em" }}>{count}</span>
    </div>
  );
}

function DescriptionEditor({
  value,
  onSave,
}: {
  value: string;
  onSave: (text: string) => Promise<void> | void;
}) {
  const [draft, setDraft] = useState(value);
  const [dirty, setDirty] = useState(false);

  return (
    <textarea
      autoFocus
      value={dirty ? draft : value}
      onChange={(event) => {
        setDraft(event.target.value);
        setDirty(true);
      }}
      onBlur={() => {
        if (!dirty) return;
        void onSave(draft.trim());
        setDirty(false);
      }}
      rows={3}
      placeholder="Describe this world — this is the logline visitors read…"
      style={{
        width: "100%",
        marginTop: 8,
        resize: "vertical",
        background: "var(--lm-sidebar-hover-fill)",
        border: "1px solid var(--lm-sidebar-border)",
        borderRadius: 8,
        padding: "9px 10px",
        color: "var(--lm-sidebar-text)",
        fontFamily: "var(--lm-font)",
        fontSize: 12,
        lineHeight: 1.55,
      }}
    />
  );
}

function InlineCreate({
  placeholder,
  value,
  onChange,
  onSubmit,
  onCancel,
}: {
  placeholder: string;
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <input
      autoFocus
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") onSubmit();
        if (event.key === "Escape") onCancel();
      }}
      onBlur={onCancel}
      style={{
        width: "100%",
        marginTop: 8,
        background: "var(--lm-sidebar-hover-fill)",
        border: "1px solid var(--lm-coral)",
        borderRadius: 8,
        padding: "8px 10px",
        color: "var(--lm-sidebar-text)",
        fontFamily: "var(--lm-font)",
        fontSize: 12,
      }}
    />
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        margin: "12px 6px",
        fontFamily: "var(--lm-font)",
        fontSize: 11.5,
        color: "var(--lm-sidebar-text-ghost)",
      }}
    >
      {children}
    </p>
  );
}

const kickerStyle = {
  margin: 0,
  fontFamily: "var(--lm-font)",
  fontSize: 9.5,
  fontWeight: 800,
  letterSpacing: "0.18em",
  textTransform: "uppercase" as const,
  color: "var(--lm-sidebar-text-ghost)",
};

const metaStyle = {
  display: "block",
  marginTop: 2,
  fontFamily: "var(--lm-font-mono, var(--lm-font))",
  fontSize: 9.5,
  fontWeight: 600,
  letterSpacing: "0.04em",
  fontVariantNumeric: "tabular-nums" as const,
  color: "var(--lm-sidebar-text-ghost)",
};

const groupLabelStyle = {
  margin: 0,
  padding: "8px 0 3px 44px",
  fontFamily: "var(--lm-font)",
  fontSize: 8.5,
  fontWeight: 800,
  letterSpacing: "0.18em",
  textTransform: "uppercase" as const,
  color: "var(--lm-sidebar-text-ghost)",
};

const searchStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginTop: 12,
  height: 34,
  padding: "0 10px",
  borderRadius: 10,
  border: "1px solid var(--lm-sidebar-border)",
  background: "var(--lm-sidebar-hover-fill)",
};

const iconButtonStyle = {
  border: "none",
  background: "none",
  cursor: "pointer",
  color: "var(--lm-sidebar-text-muted)",
  padding: 4,
  borderRadius: 6,
  lineHeight: 0,
};

const inlineActionStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  border: "none",
  background: "none",
  padding: 0,
  cursor: "pointer",
  fontFamily: "var(--lm-font)",
  fontSize: 9.5,
  fontWeight: 800,
  letterSpacing: "0.14em",
  textTransform: "uppercase" as const,
  color: "var(--lm-coral)",
};

const memberRowStyle = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "7px 8px 7px 10px",
  borderRadius: 10,
  border: "1px solid color-mix(in srgb, var(--lm-coral) 35%, transparent)",
  background: "color-mix(in srgb, var(--lm-coral) 7%, transparent)",
};

const memberParentStyle = {
  display: "block",
  fontFamily: "var(--lm-font)",
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: "0.12em",
  textTransform: "uppercase" as const,
  color: "var(--lm-sidebar-text-ghost)",
  whiteSpace: "nowrap" as const,
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const memberNameStyle = {
  display: "block",
  fontFamily: "var(--lm-font)",
  fontSize: 12.5,
  fontWeight: 600,
  color: "var(--lm-sidebar-text)",
  overflowWrap: "anywhere" as const,
};

const memberCountStyle = {
  flexShrink: 0,
  fontFamily: "var(--lm-font-mono, var(--lm-font))",
  fontSize: 10,
  fontWeight: 700,
  color: "var(--lm-coral)",
};

const removeButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  flexShrink: 0,
  height: 26,
  padding: "0 9px",
  borderRadius: 8,
  border: "1px solid var(--lm-sidebar-border)",
  background: "var(--lm-sidebar-bg)",
  cursor: "pointer",
  fontFamily: "var(--lm-font)",
  fontSize: 9.5,
  fontWeight: 800,
  letterSpacing: "0.1em",
  textTransform: "uppercase" as const,
  color: "var(--lm-sidebar-text)",
};
