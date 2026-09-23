"use client";

/* eslint-disable @next/next/no-img-element */
import { useCallback, useMemo, useState } from "react";
import {
  ArrowLeft,
  Clapperboard,
  FolderClosed,
  LayoutGrid,
  List as ListIcon,
  MapPin,
  Plus,
  Users,
  X,
} from "lucide-react";
import { hasAssetDragPayload, readAssetDragPayload } from "@/lib/asset-drag";
import { resolveImpliedAssetTypeTag } from "@/lib/collection-sections";

/**
 * "Move to" — the one place assets get sorted.
 *
 * A floating, non-modal panel: the gallery stays scrollable and drag-and-drop
 * keeps working while it's open. Every destination is both a click target
 * (files the current selection) and a drop target. Asset type is exclusive;
 * collection membership is additive and multi-select.
 *
 * Two views:
 *   Folders — big cover tiles, sized for dropping onto. The default.
 *   List    — dense rows, for when you know the name.
 * A collection's folders drill IN (rather than nesting): the corner arrow on a
 * collection tile opens it, where its folders get the same full-size tiles and
 * a New folder tile files the selection straight into a fresh sub-collection.
 */

export type PanelAssetType = "character" | "location" | "scene";

export type PanelPreview = { thumbUrl?: string; url?: string };

export type PanelCollection = {
  id: string;
  name: string;
  description?: string;
  count?: number;
  parentId?: string;
  previews?: PanelPreview[];
  /** How many assets in the current selection already belong here. */
  selectedCount?: number;
};

const ASSET_TYPES: {
  key: PanelAssetType;
  label: string;
  icon: typeof Users;
}[] = [
  { key: "character", label: "Character", icon: Users },
  { key: "location", label: "Location", icon: MapPin },
  { key: "scene", label: "Scene", icon: Clapperboard },
];

type View = "folders" | "list";

export function AddToPanel({
  open,
  onClose,
  selectedAssetIds,
  assetTypeCounts,
  collections,
  onAssignAssetType,
  onAddToFolder,
  onToggleFolder,
  onCreateCollection,
  onCreateSubCollection,
  onUpdateDescription,
  topOffset = 0,
}: {
  open: boolean;
  onClose: () => void;
  selectedAssetIds: string[];
  assetTypeCounts: Record<PanelAssetType, number>;
  collections: PanelCollection[];
  onAssignAssetType: (
    assetType: PanelAssetType,
    assetIds: string[],
  ) => Promise<void> | void;
  onAddToFolder: (folderId: string, assetIds: string[]) => Promise<void> | void;
  onToggleFolder: (folderId: string) => Promise<void> | void;
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
  const [view, setView] = useState<View>("folders");
  const [drillId, setDrillId] = useState<string | null>(null);
  const [folderDrafting, setFolderDrafting] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [collectionDrafting, setCollectionDrafting] = useState(false);
  const [collectionName, setCollectionName] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // A target acts on whatever was dropped on it; failing that, on the selection.
  const resolveIds = useCallback(
    (dropped?: string[]) =>
      dropped && dropped.length > 0 ? dropped : selectedAssetIds,
    [selectedAssetIds],
  );

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

  const drilled = useMemo(
    () =>
      collections.find((entry) => entry.id === drillId && !entry.parentId) ??
      null,
    [collections, drillId],
  );

  const rootCollections = useMemo(
    () => collections.filter((entry) => !entry.parentId),
    [collections],
  );
  const childrenByParent = useMemo(() => {
    const map = new Map<string, PanelCollection[]>();
    for (const entry of collections) {
      if (!entry.parentId) continue;
      const list = map.get(entry.parentId) ?? [];
      list.push(entry);
      map.set(entry.parentId, list);
    }
    return map;
  }, [collections]);
  const impliedAssetTypeTag = useMemo(() => {
    if (selectedAssetIds.length === 0) return null;
    return resolveImpliedAssetTypeTag(
      collections
        .filter(
          (entry) => entry.selectedCount === selectedAssetIds.length,
        )
        .map((entry) => entry.name),
    );
  }, [collections, selectedAssetIds.length]);

  if (!open) return null;

  const count = selectedAssetIds.length;

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
        width: "min(440px, calc(100vw - 32px))",
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
          padding: "14px 16px 12px",
          borderBottom: "1px solid var(--lm-sidebar-divider)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div>
            <p style={kickerStyle}>Move to</p>
            <p
              style={{
                margin: "4px 0 0",
                fontFamily: "var(--lm-font)",
                fontSize: 11.5,
                color:
                  count > 0 ? "var(--lm-coral)" : "var(--lm-sidebar-text-ghost)",
              }}
            >
              {flash ??
                (count > 0
                  ? `${count} selected`
                  : "Select assets, or drag them into a bin")}
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <ViewToggle view={view} onChange={setView} />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close move-to panel"
              style={iconButtonStyle}
            >
              <X size={15} />
            </button>
          </div>
        </div>
      </header>

      <div style={{ overflowY: "auto", flex: 1, padding: "12px 14px 32px" }}>
        {drilled ? (
          <>
            <button
              type="button"
              onClick={() => {
                setDrillId(null);
                setFolderDrafting(false);
              }}
              style={backButtonStyle}
            >
              <ArrowLeft size={13} /> All destinations
            </button>
            <h3 style={groupTitleStyle}>{drilled.name}</h3>
            <DescriptionEditor
              value={drilled.description ?? ""}
              onSave={(text) => onUpdateDescription(drilled.id, text)}
            />

            <p style={{ ...kickerStyle, margin: "14px 0 8px" }}>Folders</p>
            <Grid view={view}>
              {(childrenByParent.get(drilled.id) ?? []).map((child) => (
                <Target
                  key={child.id}
                  view={view}
                  icon={FolderClosed}
                  label={child.name}
                  count={child.count}
                  previews={child.previews}
                  busy={busyKey === child.id}
                  selectedCount={child.selectedCount}
                  selectionTotal={count}
                  selectionKind="checkbox"
                  onActivate={(ids) => {
                    if (ids && ids.length > 0) {
                      return run(child.id, `Added to ${child.name}`, () =>
                        onAddToFolder(child.id, ids),
                      );
                    }
                    if (count === 0) return;
                    return run(child.id, `Updated ${child.name}`, () =>
                      onToggleFolder(child.id),
                    );
                  }}
                />
              ))}
              <Target
                view={view}
                icon={Plus}
                label="New folder"
                accent
                onActivate={() => {
                  setFolderDrafting(true);
                  setFolderName("");
                }}
              />
            </Grid>
            {folderDrafting && (
              <InlineCreate
                placeholder={`Folder in ${drilled.name}…`}
                value={folderName}
                onChange={setFolderName}
                onCancel={() => setFolderDrafting(false)}
                onSubmit={async () => {
                  const name = folderName.trim();
                  if (!name) return;
                  await run(`new-folder:${drilled.id}`, `Created ${name}`, () =>
                    onCreateSubCollection(drilled.id, name, selectedAssetIds),
                  );
                  setFolderDrafting(false);
                  setFolderName("");
                }}
              />
            )}
          </>
        ) : (
          <>
            {!impliedAssetTypeTag && (
              <>
                <p style={{ ...kickerStyle, margin: "0 0 8px" }}>Asset type</p>
                <p style={helperStyle}>
                  Only needed for general collections. Characters, Locations
                  and Scenes destinations classify automatically.
                </p>
                <Grid view={view} compact>
                  {ASSET_TYPES.map((assetType) => (
                    <Target
                      key={assetType.key}
                      view={view}
                      icon={assetType.icon}
                      label={assetType.label}
                      busy={busyKey === `type:${assetType.key}`}
                      selectedCount={assetTypeCounts[assetType.key]}
                      selectionTotal={count}
                      selectionKind="checkbox"
                      hint="Assign type"
                      onActivate={(ids) => {
                        const assetIds = resolveIds(ids);
                        if (assetIds.length === 0) return;
                        void run(
                          `type:${assetType.key}`,
                          `Filed ${assetIds.length} as ${assetType.label}`,
                          () => onAssignAssetType(assetType.key, assetIds),
                        );
                      }}
                    />
                  ))}
                </Grid>
              </>
            )}

            <p
              style={{
                ...kickerStyle,
                margin: impliedAssetTypeTag ? "0 0 8px" : "18px 0 8px",
              }}
            >
              Collections
            </p>
            {rootCollections.length === 0 && <Hint>No collections yet.</Hint>}
            <Grid view={view}>
              {rootCollections.map((entry) => (
                <Target
                  key={entry.id}
                  view={view}
                  icon={FolderClosed}
                  label={entry.name}
                  count={entry.count}
                  previews={entry.previews}
                  busy={busyKey === entry.id}
                  selectedCount={entry.selectedCount}
                  selectionTotal={count}
                  selectionKind="checkbox"
                  openLabel={
                    childrenByParent.has(entry.id)
                      ? `${childrenByParent.get(entry.id)!.length} folders`
                      : "Folders"
                  }
                  onOpen={() => setDrillId(entry.id)}
                  onActivate={(ids) => {
                    if (ids && ids.length > 0) {
                      return run(entry.id, `Added to ${entry.name}`, () =>
                        onAddToFolder(entry.id, ids),
                      );
                    }
                    if (count === 0) return;
                    return run(entry.id, `Updated ${entry.name}`, () =>
                      onToggleFolder(entry.id),
                    );
                  }}
                />
              ))}
              <Target
                view={view}
                icon={Plus}
                label="New collection"
                accent
                onActivate={() => {
                  setCollectionDrafting(true);
                  setCollectionName("");
                }}
              />
            </Grid>
            {collectionDrafting && (
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
            )}
          </>
        )}
      </div>
    </aside>
  );
}

function Grid({
  view,
  compact = false,
  children,
}: {
  view: View;
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={
        view === "folders"
          ? {
              display: "grid",
              gridTemplateColumns: `repeat(auto-fill, minmax(${compact ? 104 : 140}px, 1fr))`,
              gap: 10,
            }
          : { display: "flex", flexDirection: "column", gap: 2 }
      }
    >
      {children}
    </div>
  );
}

/**
 * One destination. In folder view it's a tall cover tile — a big, forgiving
 * drop target; in list view a dense row. `onActivate` receives the dropped
 * ids when it was a drop, and nothing when it was a click.
 */
function Target({
  view,
  icon: Icon,
  label,
  count,
  previews,
  onActivate,
  accent = false,
  emphasis = false,
  busy = false,
  hint,
  selectedCount = 0,
  selectionTotal = 0,
  selectionKind,
  onOpen,
  openLabel,
}: {
  view: View;
  icon?: typeof Users;
  label: string;
  count?: number;
  previews?: PanelPreview[];
  onActivate: (droppedIds?: string[]) => void;
  accent?: boolean;
  emphasis?: boolean;
  busy?: boolean;
  hint?: string;
  selectedCount?: number;
  selectionTotal?: number;
  selectionKind?: "checkbox" | "radio";
  /** Secondary action: drill into this destination's folders. */
  onOpen?: () => void;
  openLabel?: string;
}) {
  const [over, setOver] = useState(false);
  const openControl = onOpen ? (
    <span
      role="button"
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          onOpen();
        }
      }}
      aria-label={`Open ${label}`}
      title={`Open ${label} — its folders`}
      style={openControlStyle}
    >
      {openLabel ?? "Open"} ›
    </span>
  ) : null;
  const cover = previews?.[0]?.thumbUrl ?? previews?.[0]?.url;
  const selectionMarked = selectionTotal > 0 && selectedCount > 0;
  const selectionComplete =
    selectionTotal > 0 && selectedCount === selectionTotal;
  const selectionState = selectionComplete
    ? true
    : selectionMarked
      ? "mixed"
      : false;

  const dropProps = {
    onDragOver: (event: React.DragEvent) => {
      if (!hasAssetDragPayload(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy"; // every destination ADDS
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (event: React.DragEvent) => {
      if (!hasAssetDragPayload(event.dataTransfer)) return;
      event.preventDefault();
      setOver(false);
      onActivate(readAssetDragPayload(event.dataTransfer));
    },
  };

  if (view === "list") {
    return (
      <button
        type="button"
        role={selectionKind ?? undefined}
        aria-checked={selectionKind ? selectionState : undefined}
        onClick={() => onActivate()}
        disabled={busy}
        {...dropProps}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          width: "100%",
          textAlign: "left",
          padding: "8px 10px",
          border: "1px solid",
          borderColor:
            over || selectionMarked ? "var(--lm-coral)" : "transparent",
          borderRadius: 8,
          background: over ? "var(--lm-sidebar-active-fill)" : "transparent",
          color: accent ? "var(--lm-coral)" : "var(--lm-sidebar-text)",
          fontFamily: "var(--lm-font)",
          fontSize: 12.5,
          fontWeight: emphasis ? 700 : 500,
          cursor: "pointer",
          opacity: busy ? 0.5 : 1,
        }}
      >
        {Icon && <Icon size={14} style={{ flexShrink: 0 }} aria-hidden />}
        <span style={ellipsis}>{label}</span>
        {openControl}
        {count !== undefined && <span style={countStyle}>{count}</span>}
        {selectionKind && (
          <SelectionMark count={selectedCount} total={selectionTotal} />
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      role={selectionKind ?? undefined}
      aria-checked={selectionKind ? selectionState : undefined}
      onClick={() => onActivate()}
      disabled={busy}
      {...dropProps}
      title={label}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        alignItems: "stretch",
        height: 118,
        padding: 0,
        overflow: "hidden",
        border: "2px solid",
        borderColor: over || selectionMarked
          ? "var(--lm-coral)"
          : accent
            ? "color-mix(in srgb, var(--lm-coral) 45%, transparent)"
            : "var(--lm-sidebar-border)",
        borderRadius: 10,
        background: over || selectionComplete
          ? "var(--lm-sidebar-active-fill)"
          : "var(--lm-sidebar-hover-fill)",
        cursor: "pointer",
        opacity: busy ? 0.5 : 1,
        transition: "border-color 120ms ease, transform 120ms ease",
        transform: over ? "scale(1.015)" : "none",
        textAlign: "left",
      }}
    >
      {cover && (
        <img
          src={cover}
          alt=""
          loading="lazy"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: 0.5,
          }}
        />
      )}
      {/* Keeps the label readable over any cover. */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background: cover
            ? "linear-gradient(to top, rgba(0,0,0,0.86) 0%, rgba(0,0,0,0.28) 62%, rgba(0,0,0,0.1) 100%)"
            : "none",
        }}
      />
      {Icon && (
        <Icon
          size={15}
          aria-hidden
          style={{
            position: "absolute",
            top: 9,
            left: 10,
            color: accent ? "var(--lm-coral)" : "var(--lm-sidebar-text-muted)",
          }}
        />
      )}
      {selectionKind ? (
        <span style={{ position: "absolute", top: 8, right: 9, zIndex: 2 }}>
          <SelectionMark count={selectedCount} total={selectionTotal} />
        </span>
      ) : count !== undefined ? (
        <span
          style={{
            position: "absolute",
            top: 8,
            right: 9,
            ...countStyle,
          }}
        >
          {count}
        </span>
      ) : null}
      <span
        style={{
          position: "relative",
          padding: "8px 10px 9px",
          fontFamily: "var(--lm-font)",
          fontSize: 11.5,
          fontWeight: emphasis ? 800 : 600,
          lineHeight: 1.25,
          // Light only when it sits on a cover's dark gradient; a coverless
          // tile is just the panel surface, so it takes the panel's own text
          // colour (light-on-light was invisible in the light theme).
          color: accent
            ? "var(--lm-coral)"
            : cover
              ? "#f0e8e0"
              : "var(--lm-sidebar-text)",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {label}
        {hint && (
          <span
            style={{
              display: "block",
              marginTop: 2,
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--lm-coral)",
            }}
          >
            {hint} →
          </span>
        )}
      </span>
      {openControl && (
        <span style={{ position: "absolute", top: 7, left: Icon ? 30 : 8, zIndex: 2 }}>
          {openControl}
        </span>
      )}
    </button>
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
        minWidth: 22,
        height: 22,
        alignItems: "center",
        justifyContent: "center",
        border: `1.5px solid ${
          complete || mixed ? "var(--lm-coral)" : "var(--lm-sidebar-border)"
        }`,
        borderRadius: 7,
        background: complete ? "var(--lm-coral)" : "rgba(0,0,0,0.42)",
        color: complete ? "#000" : "var(--lm-coral)",
        fontFamily: "var(--lm-font)",
        fontSize: 9,
        fontWeight: 800,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {complete ? "✓" : mixed ? `${count}/${total}` : ""}
    </span>
  );
}

function ViewToggle({
  view,
  onChange,
}: {
  view: View;
  onChange: (next: View) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Destination view"
      style={{
        display: "inline-flex",
        border: "1px solid var(--lm-sidebar-border)",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      {([
        { key: "folders" as const, icon: LayoutGrid, label: "Folders" },
        { key: "list" as const, icon: ListIcon, label: "List" },
      ]).map((option) => {
        const active = view === option.key;
        const Icon = option.icon;
        return (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.label}
            title={option.label}
            onClick={() => onChange(option.key)}
            style={{
              display: "grid",
              placeItems: "center",
              width: 30,
              height: 26,
              border: "none",
              cursor: "pointer",
              background: active
                ? "var(--lm-sidebar-active-fill)"
                : "transparent",
              color: active
                ? "var(--lm-coral)"
                : "var(--lm-sidebar-text-muted)",
            }}
          >
            <Icon size={13} />
          </button>
        );
      })}
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
        margin: "0 0 8px",
        fontFamily: "var(--lm-font)",
        fontSize: 11.5,
        color: "var(--lm-sidebar-text-ghost)",
      }}
    >
      {children}
    </p>
  );
}

const ellipsis = {
  flex: 1,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap" as const,
};

const countStyle = {
  fontFamily: "var(--lm-font)",
  fontSize: 10,
  fontWeight: 700,
  color: "#f0e8e0",
  background: "rgba(0,0,0,0.5)",
  padding: "2px 6px",
  borderRadius: 4,
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

const groupTitleStyle = {
  margin: "10px 0 0",
  fontFamily: "var(--lm-font-display)",
  fontSize: 20,
  fontWeight: 800,
  letterSpacing: "-0.02em",
  color: "var(--lm-sidebar-text)",
};

const backButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  border: "none",
  background: "none",
  padding: 0,
  cursor: "pointer",
  fontFamily: "var(--lm-font)",
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase" as const,
  color: "var(--lm-sidebar-text-muted)",
};

const kickerStyle = {
  margin: 0,
  fontFamily: "var(--lm-font)",
  fontSize: 9.5,
  fontWeight: 800,
  letterSpacing: "0.18em",
  textTransform: "uppercase" as const,
  color: "var(--lm-sidebar-text-ghost)",
};

const helperStyle = {
  margin: "0 0 10px",
  fontFamily: "var(--lm-font)",
  fontSize: 11,
  lineHeight: 1.45,
  color: "var(--lm-sidebar-text-muted)",
};

const openControlStyle = {
  flexShrink: 0,
  padding: "1px 6px",
  borderRadius: 6,
  fontFamily: "var(--lm-font)",
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: "0.12em",
  textTransform: "uppercase" as const,
  color: "var(--lm-coral)",
  background: "color-mix(in srgb, var(--lm-sidebar-bg) 72%, transparent)",
  cursor: "pointer",
};
