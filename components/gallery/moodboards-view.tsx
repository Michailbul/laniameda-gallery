"use client";

import {
  Component, useEffect, useMemo, useRef, useState,
  type CSSProperties, type DragEvent, type FormEvent, type ReactNode,
} from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  Archive, ArchiveRestore, ArrowLeft, Bot, Check, ChevronDown, ChevronLeft, ChevronRight, Copy,
  Download, ExternalLink, LayoutGrid, Link2, Loader2, Pencil, Play, Plus, RefreshCw, Star, Trash2, X,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useContentWidth } from "@/components/masonry-grid";
import { useCoralToastSafe } from "@/components/ui/coral-toast";
import { layoutJustified, type LayoutInput } from "@/lib/masonry-layout";
import {
  MOODBOARD_LIMITS, MOODBOARD_STATUS_LABEL, moodboardAgentRequest, moodboardRef, moodboardSyncState,
  profileFlagForCode, profileFlagForMoodboardId, type MoodboardStatus,
} from "@/lib/moodboards";
import { downloadMoodboardImages } from "@/lib/moodboard-export";

type Row = FunctionReturnType<typeof api.moodboards.listMoodboards>[number];
type Detail = FunctionReturnType<typeof api.moodboards.getMoodboard>;
type Board = Detail["moodboard"];
type Item = Detail["items"][number];
type Generation = FunctionReturnType<typeof api.moodboards.listMoodboardGenerations>["assets"][number];

export type MoodboardCollectionOption = {
  _id: string;
  name: string;
  parentFolderId?: string;
  group?: string;
};

/** What the dashboard needs to open the normal asset detail. */
export type MoodboardAssetSummary = {
  assetId: string;
  url?: string;
  thumbUrl?: string;
  width?: number;
  height?: number;
  kind: "image" | "video";
  contentType?: string;
  promptText?: string;
};

export const mono: CSSProperties = { fontFamily: "var(--lm-font)" };
export const display: CSSProperties = { fontFamily: "var(--lm-font-display)" };
export const RADIUS = "var(--lm-radius)";
const STATUS_COLOR: Record<MoodboardStatus, string> = {
  draft: "var(--lm-text-tertiary)",
  "in-midjourney": "var(--lm-coral)",
  archived: "var(--lm-text-ghost)",
};
// Chrome laid over an image reads against any picture and in either theme.
const SCRIM = "color-mix(in srgb, var(--lm-paper) 74%, transparent)";
const fieldClass = "lm-field w-full border px-3 py-2 text-[13px] outline-none transition-colors";
const fieldStyle: CSSProperties = {
  background: "var(--lm-surface-0)", borderColor: "var(--lm-border)", color: "var(--lm-text-primary)", borderRadius: RADIUS,
};

const errorText = (error: unknown, fallback: string) => {
  const data = (error as { data?: unknown })?.data;
  if (typeof data === "string") return data;
  return error instanceof Error ? error.message.replace(/^.*Uncaught ConvexError: /, "").split("\n")[0] : fallback;
};

export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

// "Styles / DA FILM" for a grouped child; the group is left out when it only
// repeats the name.
const collectionLabel = (entry: MoodboardCollectionOption) =>
  entry.parentFolderId && entry.group && entry.group.toLowerCase() !== entry.name.toLowerCase()
    ? `${entry.group} / ${entry.name}`
    : entry.name;

const shortDate = (at: number) => {
  const date = new Date(at);
  return date.toLocaleDateString("en-GB", {
    day: "numeric", month: "short", ...(date.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}),
  });
};

const copyText = async (value: string) => {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
};

/* ── Small pieces ─────────────────────────────────────────────────────────── */

export function Micro({ children, color, className }: { children: ReactNode; color?: string; className?: string }) {
  return <span className={`text-[10px] font-bold uppercase tracking-[0.14em] ${className ?? ""}`}
    style={{ ...mono, color: color ?? "var(--lm-text-tertiary)" }}>{children}</span>;
}

// Midjourney codes are case-sensitive: never let uppercase microcopy touch them.
function Code({ children }: { children: ReactNode }) {
  return <span style={{ textTransform: "none", letterSpacing: "0.02em" }}>{children}</span>;
}

export function Badge({ children, color, title }: { children: ReactNode; color?: string; title?: string }) {
  return <span title={title} className="inline-flex items-center gap-1.5 border px-1.5 py-[3px] text-[10px] font-semibold uppercase leading-none tracking-[0.12em]"
    style={{ ...mono, borderRadius: RADIUS, borderColor: "var(--lm-border)", color: color ?? "var(--lm-text-secondary)" }}>{children}</span>;
}

function StatusPill({ status }: { status: MoodboardStatus }) {
  return <Badge color={STATUS_COLOR[status]}>
    <span aria-hidden className="h-1.5 w-1.5" style={{ background: STATUS_COLOR[status], borderRadius: "999px" }} />
    {MOODBOARD_STATUS_LABEL[status]}
  </Badge>;
}

// Every code and ID here carries a copy button, so it can be pasted into a
// prompt or to an agent.
export function CopyChip({ value, label, strong, title }: { value: string; label?: string; strong?: boolean; title?: string }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" aria-label={`Copy ${value}`} title={title ?? `Copy ${value}`}
    onClick={async (event) => {
      event.stopPropagation();
      if (await copyText(value)) { setCopied(true); setTimeout(() => setCopied(false), 1200); }
    }}
    className="inline-flex max-w-full items-center gap-1.5 px-1.5 py-[3px] text-[10px] font-bold leading-none tracking-[0.06em] backdrop-blur focus-visible:outline-2 focus-visible:outline-offset-2"
    style={{
      ...mono, borderRadius: RADIUS, border: "1px solid var(--lm-border-strong)",
      background: strong ? "var(--lm-ink)" : SCRIM, color: strong ? "var(--lm-paper)" : "var(--lm-text-primary)",
    }}>
    <span className="truncate">{label ?? value}</span>
    {copied ? <Check size={11} aria-hidden /> : <Copy size={11} className="opacity-60" aria-hidden />}
  </button>;
}

type Tone = "ink" | "coral" | "ghost" | "danger";
const TONE: Record<Tone, CSSProperties> = {
  ink: { background: "var(--lm-ink)", color: "var(--lm-paper)", border: "1px solid var(--lm-ink)" },
  coral: { background: "var(--lm-coral)", color: "var(--lm-paper)", border: "1px solid var(--lm-coral)" },
  ghost: { background: "transparent", color: "var(--lm-text-secondary)", border: "1px solid var(--lm-border-strong)" },
  danger: { background: "transparent", color: "var(--lm-coral)", border: "1px solid var(--lm-coral)" },
};

export function ActionButton({ tone = "ghost", icon, children, busy, className, ...props }:
  { tone?: Tone; icon?: ReactNode; busy?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props}
    className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] transition-[opacity,background-color,color] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 ${className ?? ""}`}
    style={{ ...mono, borderRadius: RADIUS, ...TONE[tone], ...props.style }}>
    {busy ? <Loader2 size={13} className="animate-spin" aria-hidden /> : icon}{children}
  </button>;
}

function IconButton({ label, onClick, children, disabled, active }: {
  label: string; onClick: () => void; children: ReactNode; disabled?: boolean; active?: boolean;
}) {
  return <button type="button" aria-label={label} title={label} disabled={disabled}
    onClick={(event) => { event.stopPropagation(); onClick(); }}
    className="grid h-7 w-7 place-items-center backdrop-blur transition-opacity disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-offset-1"
    style={{ borderRadius: RADIUS, background: active ? "var(--lm-coral)" : SCRIM, color: active ? "var(--lm-paper)" : "var(--lm-text-primary)", border: "1px solid var(--lm-border-strong)" }}>
    {children}
  </button>;
}

function BackLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick}
    className="mb-5 inline-flex items-center gap-1.5 border-none bg-transparent p-0 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--lm-text-tertiary)] transition-colors hover:text-[var(--lm-text-primary)]"
    style={mono}>
    <ArrowLeft size={13} aria-hidden />{children}
  </button>;
}

function SectionTitle({ label, count, hint, children }: { label: string; count?: number; hint?: ReactNode; children?: ReactNode }) {
  return <div className="mb-3 mt-10 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t pt-4" style={{ borderColor: "var(--lm-border)" }}>
    <h3 className="text-lg font-black uppercase tracking-tight" style={display}>{label}</h3>
    {count !== undefined && <Micro>{count}</Micro>}
    {hint && <Micro color="var(--lm-text-ghost)" className="hidden md:inline">{hint}</Micro>}
    {children && <span className="ml-auto flex items-center gap-2">{children}</span>}
  </div>;
}

function Thumb({ src, alt }: { src?: string; alt: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- saved gallery thumbnails
  return src ? <img src={src} alt={alt} loading="lazy" draggable={false} className="h-full w-full object-cover" /> : null;
}

// A board's face: its cover and next three images. Fewer images take the
// space a real pinboard would give them instead of leaving empty cells.
function Mosaic({ previews, total, name }: { previews: Row["previewItems"]; total: number; name: string }) {
  const cells = previews.slice(0, 4);
  if (cells.length === 0) {
    return <div className="flex h-full w-full flex-col items-center justify-center gap-2" style={{ background: "var(--lm-surface-2)" }}>
      <LayoutGrid size={22} style={{ color: "var(--lm-text-ghost)" }} aria-hidden />
      <Micro color="var(--lm-text-ghost)">No images yet</Micro>
    </div>;
  }
  const grid = cells.length === 1 ? "grid-cols-1" : cells.length === 2 ? "grid-cols-2" : "grid-cols-2 grid-rows-2";
  return <div className={`grid h-full w-full gap-[2px] ${grid}`} style={{ background: "var(--lm-surface-0)" }}>
    {cells.map((cell, index) => <div key={cell.assetId}
      className={`relative overflow-hidden ${cells.length === 3 && index === 0 ? "row-span-2" : ""}`}
      style={{ background: "var(--lm-surface-2)" }}>
      <div className="h-full w-full transition-transform duration-500 group-hover:scale-[1.03]">
        <Thumb src={cell.thumbUrl ?? cell.url} alt={`${name}, image ${index + 1}`} />
      </div>
      {cell.kind === "video" && <span className="absolute bottom-1.5 left-1.5 grid h-5 w-5 place-items-center" style={{ borderRadius: RADIUS, background: SCRIM, color: "var(--lm-text-primary)" }}>
        <Play size={10} fill="currentColor" aria-hidden />
      </span>}
    </div>)}
    {total > 4 && <span className="pointer-events-none absolute bottom-2 right-2 px-1.5 py-[3px] text-[10px] font-bold tracking-[0.08em]"
      style={{ ...mono, borderRadius: RADIUS, background: SCRIM, color: "var(--lm-text-primary)" }}>+{total - 4}</span>}
  </div>;
}

/* ── Error fallback ───────────────────────────────────────────────────────── */

// A board deleted elsewhere (by an agent, in another tab) makes its read
// fail. Say so in place instead of taking the gallery down with it.
export class BoardBoundary extends Component<{ children: ReactNode; onBack: () => void; resetKey: string; backLabel?: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(previous: { resetKey: string }) {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    const backLabel = this.props.backLabel ?? "All moodboards";
    return <section className="px-4 py-14 text-center md:px-6">
      <p className="text-sm font-black uppercase tracking-tight" style={display}>This moodboard is no longer here</p>
      <p className="mx-auto mt-2 max-w-sm text-xs leading-5" style={{ color: "var(--lm-text-tertiary)" }}>It was deleted or moved out of your gallery.</p>
      <ActionButton className="mt-5" icon={<ArrowLeft size={13} />} onClick={this.props.onBack}>{backLabel}</ActionButton>
    </section>;
  }
}

/* ── Header toggle ────────────────────────────────────────────────────────── */

/**
 * `Moodboards · N` in a collection's header. A root counts its children's
 * boards too. Archived boards are not counted.
 */
export function MoodboardsToggle({ ownerUserId, collectionId, includeChildren, active, onToggle }: {
  ownerUserId: string; collectionId: string; includeChildren: boolean; active: boolean; onToggle: () => void;
}) {
  const { isAuthenticated } = useConvexAuth();
  const rows = useQuery(api.moodboards.listMoodboards, isAuthenticated
    ? { ownerUserId, folderId: collectionId as Id<"folders">, includeChildren, previewLimit: 0 }
    : "skip");
  return <button type="button" aria-pressed={active} onClick={onToggle}
    className="lm-quiet-action inline-flex items-center gap-1.5 border-none bg-transparent p-0"
    style={{ ...mono, fontSize: "10px", fontWeight: 750, letterSpacing: "0.12em", textTransform: "uppercase", color: active ? "var(--lm-coral)" : "var(--lm-text-ghost)" }}
    title={active ? "Back to the collection grid" : "Looks to send to Midjourney, made from this collection's images"}>
    <LayoutGrid className="h-3 w-3" aria-hidden />
    Moodboards
    <span aria-hidden style={{ color: "var(--lm-text-ghost)" }}>· {rows === undefined ? "–" : rows.length}</span>
  </button>;
}

/* ── The view ─────────────────────────────────────────────────────────────── */

type ViewProps = {
  ownerUserId: string;
  /** The plain collection the view belongs to. A root shows its children's boards too. */
  collection: MoodboardCollectionOption;
  /** The world this collection belongs to: its root and plain children. */
  collections: MoodboardCollectionOption[];
  onBack: () => void;
  onOpenAsset: (asset: MoodboardAssetSummary) => void;
  /** Opens the gallery in picking mode to add images to this board. */
  onChooseFromGallery?: (board: MoodboardPickTarget) => void;
  /** The board to open on mount, e.g. after returning from picking. */
  initialBoardId?: string;
};

/** The board a "Choose from gallery" round adds to. */
export type MoodboardPickTarget = { id: string; name: string; folderId: string };

export function MoodboardsView(props: ViewProps) {
  const [openId, setOpenId] = useState<Id<"moodboards"> | null>((props.initialBoardId as Id<"moodboards"> | undefined) ?? null);
  return <BoardBoundary onBack={() => setOpenId(null)} resetKey={openId ?? "list"}>
    {openId
      ? <MoodboardDetail ownerUserId={props.ownerUserId} collections={props.collections} onOpenAsset={props.onOpenAsset}
        onChooseFromGallery={props.onChooseFromGallery} moodboardId={openId} onClose={() => setOpenId(null)} />
      : <MoodboardList {...props} onOpenBoard={setOpenId} />}
  </BoardBoundary>;
}

function MoodboardList({ ownerUserId, collection, collections, onBack, onOpenBoard }: ViewProps & { onOpenBoard: (id: Id<"moodboards">) => void }) {
  const { isAuthenticated } = useConvexAuth();
  const isRoot = !collection.parentFolderId;
  const rows = useQuery(api.moodboards.listMoodboards, isAuthenticated
    ? { ownerUserId, folderId: collection._id as Id<"folders">, includeChildren: isRoot, includeArchived: true }
    : "skip");
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const active = useMemo(() => (rows ?? []).filter((row) => row.status !== "archived"), [rows]);
  const archived = useMemo(() => (rows ?? []).filter((row) => row.status === "archived"), [rows]);
  const visible = showArchived ? archived : active;
  const inMidjourney = active.filter((row) => row.status === "in-midjourney").length;

  // A root's boards come first under its own name, then each child's.
  const sections = useMemo(() => {
    const byFolder = new Map<string, Row[]>();
    for (const row of visible) byFolder.set(row.folderId, [...(byFolder.get(row.folderId) ?? []), row]);
    return [...byFolder.entries()].map(([folderId, boards]) => ({
      folderId, boards, name: boards[0]!.folderName, group: boards[0]!.folderGroup, isChild: folderId !== collection._id,
    }));
  }, [visible, collection._id]);

  const owners = isRoot ? collections.filter((entry) => entry._id === collection._id || entry.parentFolderId === collection._id) : [collection];

  return <section className="px-4 pb-16 pt-4 md:px-6" style={{ color: "var(--lm-text-primary)" }}>
    <BackLink onClick={onBack}>Back to {collection.name}</BackLink>

    <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-3xl font-black uppercase leading-none tracking-tight md:text-4xl" style={display}>Moodboards</h2>
        <p className="mt-2 text-[11px] uppercase tracking-[0.14em]" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>
          {rows === undefined ? "Loading boards…" : [collection.name, plural(active.length, "board"), inMidjourney ? `${inMidjourney} in Midjourney` : undefined].filter(Boolean).join(" · ")}
        </p>
      </div>
      {/* An empty collection gets one centred call to action instead. */}
      {(creating || (rows?.length ?? 0) > 0) && <ActionButton tone="ink" disabled={!isAuthenticated} aria-expanded={creating}
        icon={creating ? <X size={13} aria-hidden /> : <Plus size={13} aria-hidden />} onClick={() => setCreating(!creating)}>
        {creating ? "Close" : "New moodboard"}
      </ActionButton>}
    </header>

    {creating && <CreateMoodboard ownerUserId={ownerUserId} owners={owners} defaultFolderId={collection._id}
      onCreated={(id) => { setCreating(false); onOpenBoard(id); }} />}

    {archived.length > 0 && <div className="mb-5 flex flex-wrap items-center gap-2" role="group" aria-label="Board status">
      {[{ label: "Active", count: active.length, on: !showArchived }, { label: "Archived", count: archived.length, on: showArchived }].map((chip) =>
        <button key={chip.label} type="button" aria-pressed={chip.on} onClick={() => setShowArchived(chip.label === "Archived")}
          className="lm-chip" data-active={chip.on ? "true" : undefined} style={{ borderRadius: RADIUS }}>
          {chip.label}<span className="opacity-60">{chip.count}</span>
        </button>)}
    </div>}

    {rows === undefined ? <p role="status" className="py-10 text-[11px] uppercase tracking-[0.14em]" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>Loading boards…</p>
      : visible.length === 0 ? <div className="border border-dashed px-6 py-16 text-center" style={{ borderRadius: RADIUS, borderColor: "var(--lm-border-strong)" }}>
        <LayoutGrid className="mx-auto mb-3" size={22} style={{ color: "var(--lm-text-ghost)" }} aria-hidden />
        <p className="text-sm font-black uppercase tracking-tight" style={display}>{showArchived ? "Nothing archived" : "No moodboards yet"}</p>
        <p className="mx-auto mt-2 max-w-md text-xs leading-5" style={{ color: "var(--lm-text-tertiary)" }}>
          A moodboard is a set of images that defines one look, mirrored to a Midjourney moodboard and its --profile code.
        </p>
        {!showArchived && !creating && rows.length === 0 && <ActionButton tone="coral" className="mt-5" icon={<Plus size={13} aria-hidden />} onClick={() => setCreating(true)}>New moodboard</ActionButton>}
      </div>
      : <div className="grid gap-9">
        {sections.map((section) => <div key={section.folderId}>
          {(isRoot && (sections.length > 1 || section.isChild)) && <div className="mb-3 flex items-center gap-3">
            <Micro color={section.isChild ? "var(--lm-text-secondary)" : "var(--lm-text-primary)"}>
              {section.group && section.group.toLowerCase() !== section.name.toLowerCase() && <span style={{ color: "var(--lm-text-ghost)" }}>{section.group} / </span>}{section.name}
            </Micro>
            <Micro color="var(--lm-text-ghost)">{section.boards.length}</Micro>
            <span aria-hidden className="h-px flex-1" style={{ background: "var(--lm-border)" }} />
          </div>}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {section.boards.map((row) => <BoardCard key={row._id} row={row} onOpen={() => onOpenBoard(row._id)} />)}
          </div>
        </div>)}
      </div>}
  </section>;
}

export type MoodboardRow = Row;

export function BoardCard({ row, onOpen, place }: { row: Row; onOpen: () => void; place?: string }) {
  return <article role="button" tabIndex={0} onClick={onOpen} aria-label={`Moodboard ${row.name}, ${plural(row.itemCount, "image")}`}
    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); } }}
    className="group cursor-pointer overflow-hidden border border-[var(--lm-border-strong)] outline-none transition-[transform,border-color] duration-200 hover:-translate-y-[2px] hover:border-[var(--lm-text-tertiary)] focus-visible:ring-2 focus-visible:ring-[var(--lm-coral)]"
    style={{ borderRadius: RADIUS, background: "var(--lm-surface-1)", opacity: row.status === "archived" ? 0.6 : 1 }}>
    <div className="relative aspect-[4/3] overflow-hidden">
      <Mosaic previews={row.previewItems} total={row.itemCount} name={row.name} />
      {row.mjCode && <div className="absolute left-2 top-2"><CopyChip value={profileFlagForCode(row.mjCode)} label={row.mjCode} strong title={`Copy ${profileFlagForCode(row.mjCode)}`} /></div>}
    </div>
    <div className="grid gap-2 p-3">
      <div className="min-w-0">
        {place && <p className="mb-1 truncate"><Micro color="var(--lm-text-ghost)">{place}</Micro></p>}
        <h3 className="truncate text-[15px] font-black uppercase leading-tight tracking-tight" style={display}>{row.name}</h3>
        {row.description && <p className="mt-1 truncate text-xs" style={{ color: "var(--lm-text-tertiary)" }} title={row.description}>{row.description}</p>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <StatusPill status={row.status} />
        <Badge>{plural(row.itemCount, "image")}</Badge>
        {row.styleTag && <Badge color="var(--lm-text-tertiary)">#{row.styleTag}</Badge>}
      </div>
    </div>
  </article>;
}

export function CreateMoodboard({ ownerUserId, owners, defaultFolderId, onCreated }: {
  ownerUserId: string; owners: MoodboardCollectionOption[]; defaultFolderId: string; onCreated: (id: Id<"moodboards">) => void;
}) {
  const create = useMutation(api.moodboards.createMoodboard);
  const [folderId, setFolderId] = useState(defaultFolderId);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [styleTag, setStyleTag] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !name.trim() || !folderId) return;
    setBusy(true); setError("");
    try {
      const result = await create({
        ownerUserId, folderId: folderId as Id<"folders">, name,
        description: description.trim() || undefined, styleTag: styleTag.trim() || undefined,
      });
      onCreated(result.moodboardId);
    } catch (err) { setError(errorText(err, "Could not create the moodboard.")); } finally { setBusy(false); }
  };
  return <form onSubmit={submit} className="mb-7 grid gap-3 border p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]"
    style={{ borderRadius: RADIUS, borderColor: "var(--lm-border-strong)", background: "var(--lm-surface-1)" }} aria-label="New moodboard">
    <Field label="Name"><input required autoFocus maxLength={MOODBOARD_LIMITS.name} className={fieldClass} style={fieldStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="DA FILM · Golden" /></Field>
    <Field label="Style tag"><input maxLength={MOODBOARD_LIMITS.styleTag} className={fieldClass} style={{ ...fieldStyle, ...mono }} value={styleTag} onChange={(e) => setStyleTag(e.target.value)} placeholder="da-film" /></Field>
    <Field label="Belongs to">
      <select required className={fieldClass} style={fieldStyle} value={folderId} onChange={(e) => setFolderId(e.target.value)} disabled={owners.length < 2}>
        {!folderId && <option value="" disabled>Choose a world or collection</option>}
        {owners.map((owner) => <option key={owner._id} value={owner._id}>{collectionLabel(owner)}</option>)}
      </select>
    </Field>
    <Field label="What it carries" className="sm:col-span-2 lg:col-span-3">
      <textarea rows={2} maxLength={MOODBOARD_LIMITS.description} className={`${fieldClass} resize-y`} style={fieldStyle} value={description} onChange={(e) => setDescription(e.target.value)}
        placeholder="Warm 35mm film look for Dear Annete exteriors: golden hour, halation, soft grain." />
    </Field>
    <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-3">
      <ActionButton type="submit" tone="coral" busy={busy} disabled={busy || !name.trim() || !folderId} icon={<Plus size={13} aria-hidden />}>{busy ? "Creating…" : "Create moodboard"}</ActionButton>
      <Micro color="var(--lm-text-ghost)">Then choose its images from the gallery</Micro>
      {error && <p role="alert" className="text-xs" style={{ color: "var(--lm-coral)" }}>{error}</p>}
    </div>
  </form>;
}

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return <label className={`grid content-start gap-1.5 ${className ?? ""}`}>
    <Micro>{label}</Micro>
    {children}
  </label>;
}

/* ── Justified tiles ──────────────────────────────────────────────────────── */

const TILE_GAP = 6;
// The drop marker sits in the gap between two tiles.
const DROP_OFFSET = -((TILE_GAP + 3) / 2);

// The gallery's justified-rows layout, denser than the main grid.
function useTileLayout(inputs: LayoutInput[]) {
  const [ref, width] = useContentWidth();
  const layout = useMemo(() => {
    if (!width) return null;
    const columns = width >= 1400 ? 6 : width >= 1100 ? 5 : width >= 800 ? 4 : width >= 520 ? 3 : 2;
    return layoutJustified(inputs, {
      containerWidth: width, gap: TILE_GAP,
      targetRowHeight: (width - TILE_GAP * (columns - 1)) / columns,
    });
  }, [inputs, width]);
  return { ref, layout };
}

function TilePlane<T>({ items, inputs, render, keyOf, label }: {
  items: T[]; inputs: LayoutInput[]; render: (item: T, index: number) => ReactNode;
  keyOf: (item: T) => string; label: string;
}) {
  const { ref, layout } = useTileLayout(inputs);
  return <div ref={ref} aria-label={label} className="relative w-full" style={{ height: layout ? layout.totalHeight : 240 }}>
    {layout && items.map((item, index) => {
      const tile = layout.tiles[index];
      if (!tile) return null;
      return <div key={keyOf(item)} className="absolute transition-[top,left,width,height] duration-200 ease-out"
        style={{ top: tile.top, left: tile.left, width: tile.width, height: tile.height }}>
        {render(item, index)}
      </div>;
    })}
  </div>;
}

/* ── Detail ───────────────────────────────────────────────────────────────── */

export type MoodboardDetailProps = {
  ownerUserId: string;
  moodboardId: Id<"moodboards">;
  /** Collections the board may move between in Edit. */
  collections: MoodboardCollectionOption[];
  onClose: () => void;
  onOpenAsset: (asset: MoodboardAssetSummary) => void;
  onChooseFromGallery?: (board: MoodboardPickTarget) => void;
  backLabel?: string;
};

export function MoodboardDetail({ ownerUserId, moodboardId, collections, onClose, onOpenAsset, onChooseFromGallery, backLabel }: MoodboardDetailProps) {
  const { isAuthenticated } = useConvexAuth();
  const [deleting, setDeleting] = useState(false);
  // Skipped once a delete starts, so the read never outlives its board.
  const detail = useQuery(api.moodboards.getMoodboard, isAuthenticated && !deleting ? { ownerUserId, moodboardId } : "skip");
  const update = useMutation(api.moodboards.updateMoodboard);
  const removeItems = useMutation(api.moodboards.removeMoodboardItems);
  const reorder = useMutation(api.moodboards.reorderMoodboardItems);
  const recordSync = useMutation(api.moodboards.setMoodboardMidjourney);
  const deleteBoard = useMutation(api.moodboards.deleteMoodboard);
  const toast = useCoralToastSafe()?.toast;
  const [editing, setEditing] = useState(false);
  const [armedDelete, setArmedDelete] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // Optimistic order and removals, valid only for the revision they were made on.
  const [pending, setPending] = useState<{ revision: number; order?: string[]; removed?: string[] } | null>(null);

  useEffect(() => {
    if (!armedDelete) return;
    const timer = setTimeout(() => setArmedDelete(false), 4000);
    return () => clearTimeout(timer);
  }, [armedDelete]);

  const board = detail?.moodboard;
  const live = board && pending?.revision === board.revision ? pending : null;
  const items = useMemo(() => {
    if (!detail) return [];
    const removed = new Set(live?.removed ?? []);
    const kept = detail.items.filter((item) => !removed.has(item.assetId));
    if (!live?.order) return kept;
    const rank = new Map(live.order.map((id, index) => [id, index]));
    return [...kept].sort((a, b) => (rank.get(a.assetId) ?? 0) - (rank.get(b.assetId) ?? 0));
  }, [detail, live]);

  if (deleting) return <section className="px-4 py-14 md:px-6" role="status"><Micro>Deleting…</Micro></section>;
  if (!detail || !board) return <section className="px-4 py-14 md:px-6" role="status"><Micro>Loading moodboard…</Micro></section>;

  const fail = (err: unknown, fallback: string) => toast?.(fallback, errorText(err, fallback), "warning");
  const commitOrder = async (order: string[]) => {
    setPending({ revision: board.revision, order, removed: live?.removed });
    try {
      await reorder({ ownerUserId, moodboardId, assetIds: order as Id<"assets">[] });
    } catch (err) { setPending(null); fail(err, "Could not reorder the board."); }
  };
  const move = (assetId: string, offset: number) => {
    const order = items.map((item) => item.assetId as string);
    const from = order.indexOf(assetId);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= order.length) return;
    order.splice(to, 0, ...order.splice(from, 1));
    void commitOrder(order);
  };
  const dropOnto = (dragged: string, target: string, after: boolean) => {
    if (dragged === target) return;
    const order = items.map((item) => item.assetId as string).filter((id) => id !== dragged);
    const index = order.indexOf(target);
    if (index < 0) return;
    order.splice(after ? index + 1 : index, 0, dragged);
    void commitOrder(order);
  };
  const remove = async (assetId: string) => {
    setPending({ revision: board.revision, order: live?.order, removed: [...(live?.removed ?? []), assetId] });
    try {
      await removeItems({ ownerUserId, moodboardId, assetIds: [assetId as Id<"assets">] });
    } catch (err) { setPending(null); fail(err, "Could not remove the image."); }
  };
  const makeCover = async (assetId: string) => {
    try { await update({ ownerUserId, moodboardId, coverAssetId: assetId as Id<"assets"> }); } catch (err) { fail(err, "Could not set the cover."); }
  };
  const setStatus = async (status: MoodboardStatus) => {
    setBusy("status");
    try { await update({ ownerUserId, moodboardId, expectedRevision: board.revision, status }); } catch (err) { fail(err, "Could not change the status."); } finally { setBusy(null); }
  };
  const markSynced = async () => {
    setBusy("sync");
    try {
      await recordSync({ ownerUserId, moodboardId, syncedItemCount: board.itemCount, note: "Marked synced in the gallery" });
      toast?.("Marked as synced", `${plural(board.itemCount, "image")} recorded as in Midjourney.`, "success");
    } catch (err) { fail(err, "Could not record the sync."); } finally { setBusy(null); }
  };
  const destroy = async () => {
    setDeleting(true);
    try {
      const result = await deleteBoard({ ownerUserId, moodboardId });
      toast?.(`Deleted ${board.name}`, `${plural(result.removedItems, "image")} left the board; the assets stay in the gallery.`, "success");
      onClose();
    } catch (err) { setDeleting(false); fail(err, "Could not delete the moodboard."); }
  };

  const sync = moodboardSyncState(board, detail.items.map((item) => item.addedAt));
  const pickTarget: MoodboardPickTarget = { id: board._id, name: board.name, folderId: board.folderId };
  const collectionPath = detail.parentFolderName ? `${detail.parentFolderName} / ${detail.folderName}` : detail.folderName;
  const restoreStatus: MoodboardStatus = board.mjCode || board.mjMoodboardId ? "in-midjourney" : "draft";

  return <section className="px-4 pb-16 pt-4 md:px-6" style={{ color: "var(--lm-text-primary)" }}>
    <BackLink onClick={onClose}>{backLabel ?? "All moodboards"}</BackLink>

    <header className="grid items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_auto]">
      <div className="grid min-w-0 gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={board.status} />
          {board.mjCode && <CopyChip value={profileFlagForCode(board.mjCode)} label={board.mjCode} strong title={`Copy ${profileFlagForCode(board.mjCode)}`} />}
          <CopyChip value={moodboardRef(board._id)} label={`ID ${board._id.slice(-6)}`} title={`Copy ${moodboardRef(board._id)} for an agent`} />
          <Badge color="var(--lm-text-tertiary)">Rev {board.revision}</Badge>
        </div>
        <h2 className="break-words text-4xl font-black uppercase leading-[0.92] tracking-tight md:text-5xl" style={display}>{board.name}</h2>
        {board.description && <p className="max-w-3xl whitespace-pre-line text-sm leading-6" style={{ color: "var(--lm-text-secondary)" }}>{board.description}</p>}
        <dl className="flex flex-wrap gap-x-6 gap-y-1.5">
          {[["Collection", collectionPath], ["Style", board.styleTag ? `#${board.styleTag}` : undefined], ["Images", String(board.itemCount)], ["Updated", shortDate(board.updatedAt)]]
            .filter(([, value]) => value).map(([label, value]) => <div key={label} className="flex items-baseline gap-2">
              <dt><Micro color="var(--lm-text-ghost)">{label}</Micro></dt>
              <dd><Micro color="var(--lm-text-secondary)">{value}</Micro></dd>
            </div>)}
        </dl>
      </div>
      <div className="flex flex-wrap items-center gap-2 2xl:max-w-[560px] 2xl:justify-end">
        {onChooseFromGallery && <ActionButton tone="coral" icon={<Plus size={13} aria-hidden />}
          onClick={() => onChooseFromGallery(pickTarget)} title="Open the gallery and pick images to add">Choose from gallery</ActionButton>}
        <SendToMidjourney board={board} items={detail.items} />
        <ActionButton aria-expanded={editing} icon={editing ? <X size={13} aria-hidden /> : <Pencil size={13} aria-hidden />} onClick={() => setEditing(!editing)}>{editing ? "Close" : "Edit"}</ActionButton>
        {board.status === "archived"
          ? <ActionButton busy={busy === "status"} icon={<ArchiveRestore size={13} aria-hidden />} onClick={() => void setStatus(restoreStatus)}>Restore</ActionButton>
          : <ActionButton busy={busy === "status"} icon={<Archive size={13} aria-hidden />} onClick={() => void setStatus("archived")}>Archive</ActionButton>}
        <ActionButton tone={armedDelete ? "coral" : "danger"} icon={<Trash2 size={13} aria-hidden />}
          onClick={() => (armedDelete ? void destroy() : setArmedDelete(true))}
          title={armedDelete ? "Click again to delete; the assets stay in the gallery" : "Delete this moodboard"}>
          {armedDelete ? "Confirm delete" : "Delete"}
        </ActionButton>
      </div>
    </header>

    <MidjourneyStrip board={board} sync={sync} syncing={busy === "sync"} onMarkSynced={() => void markSynced()} onRecord={() => setEditing(true)} />

    {board.notes && <div className="mt-3 grid max-w-4xl gap-1.5 border p-3 pl-4" style={{ borderRadius: RADIUS, borderColor: "var(--lm-border)" }}>
      <Micro color="var(--lm-text-ghost)">Notes</Micro>
      <p className="whitespace-pre-wrap text-xs leading-5" style={{ ...mono, color: "var(--lm-text-secondary)" }}>{board.notes}</p>
    </div>}

    {editing && <EditMoodboard ownerUserId={ownerUserId} board={board} collections={collections} onDone={() => setEditing(false)} />}

    <SectionTitle label="Board" count={board.itemCount} hint={items.length > 1 ? "Drag to reorder · hover to remove · the order is the upload order" : undefined}>
      {detail.missingAssetIds.length > 0 && <Badge color="var(--lm-coral)" title={detail.missingAssetIds.map((id) => `asset:${id}`).join("\n")}>{plural(detail.missingAssetIds.length, "missing asset")}</Badge>}
    </SectionTitle>
    {items.length === 0
      ? <div className="border border-dashed px-6 py-12 text-center" style={{ borderRadius: RADIUS, borderColor: "var(--lm-border-strong)" }}>
        <p className="text-sm font-black uppercase tracking-tight" style={display}>An empty board</p>
        <p className="mx-auto mt-2 max-w-md text-xs leading-5" style={{ color: "var(--lm-text-tertiary)" }}>
          Choose its images from the gallery, with every filter, or use Add to moodboard from a card&rsquo;s collection menu.
        </p>
        {onChooseFromGallery && <ActionButton tone="coral" className="mt-5" icon={<Plus size={13} aria-hidden />}
          onClick={() => onChooseFromGallery(pickTarget)}>Choose from gallery</ActionButton>}
      </div>
      : <BoardItems items={items} coverAssetId={board.coverAssetId} onOpen={(item) => onOpenAsset(item)}
        onMove={move} onDrop={dropOnto} onRemove={(id) => void remove(id)} onMakeCover={(id) => void makeCover(id)} />}

    {(board.mjCode || board.mjMoodboardId) && <Generations ownerUserId={ownerUserId} moodboardId={moodboardId} onOpenAsset={onOpenAsset} />}
  </section>;
}

function MidjourneyStrip({ board, sync, syncing, onMarkSynced, onRecord }: {
  board: Board; sync: ReturnType<typeof moodboardSyncState>; syncing: boolean; onMarkSynced: () => void; onRecord: () => void;
}) {
  const identity = board.mjCode ?? (board.mjMoodboardId ? `m${board.mjMoodboardId}` : undefined);
  const segments: { key: string; text: ReactNode; tone?: "quiet" | "warn" }[] = sync.inMidjourney
    ? [
      { key: "as", text: <>In Midjourney as <Code>{identity}</Code></> },
      { key: "synced", text: sync.synced ? `Synced ${shortDate(board.mjSyncedAt!)}` : "No sync recorded", tone: "quiet" as const },
      ...(sync.addedSince ? [{ key: "added", text: `${plural(sync.addedSince, "image")} added since`, tone: "warn" as const }] : []),
      ...(sync.removedSince ? [{ key: "removed", text: `${sync.removedSince} removed since`, tone: "warn" as const }] : []),
      ...(sync.upToDate ? [{ key: "current", text: "Up to date", tone: "quiet" as const }] : []),
    ]
    : [{ key: "none", text: "Not in Midjourney yet" }];
  const history = [...(board.mjCodeHistory ?? [])].reverse();
  return <div className="mt-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border p-3 pl-4"
    style={{ borderRadius: RADIUS, borderColor: "var(--lm-border-strong)", background: "var(--lm-surface-1)", boxShadow: sync.inMidjourney ? "inset 2px 0 0 var(--lm-coral)" : undefined }}>
    <div className="grid min-w-0 flex-1 basis-[420px] gap-2.5">
      <p className="text-[11px] font-bold uppercase leading-5 tracking-[0.12em]" style={{ ...mono, color: sync.inMidjourney ? "var(--lm-text-primary)" : "var(--lm-text-tertiary)" }}>
        {segments.map((segment, index) => <span key={segment.key}>
          {index > 0 && <span style={{ color: "var(--lm-text-ghost)" }}> · </span>}
          <span style={{ color: segment.tone === "warn" ? "var(--lm-coral)" : segment.tone === "quiet" ? "var(--lm-text-secondary)" : undefined }}>{segment.text}</span>
        </span>)}
      </p>
      {(board.mjCode || board.mjMoodboardId || history.length > 0) && <div className="flex flex-wrap items-center gap-2">
        {board.mjCode && <CopyChip value={profileFlagForCode(board.mjCode)} />}
        {board.mjMoodboardId && <CopyChip value={profileFlagForMoodboardId(board.mjMoodboardId)} />}
        {history.length > 0 && <Micro color="var(--lm-text-ghost)">
          Earlier {history.map((entry, index) => <span key={`${entry.code}-${entry.at}`} title={entry.note}>
            {index > 0 && ", "}<Code>{entry.code}</Code> ({shortDate(entry.at)})
          </span>)}
        </Micro>}
      </div>}
      {!sync.inMidjourney && <p className="max-w-2xl text-xs leading-5" style={{ color: "var(--lm-text-tertiary)" }}>
        Send it with Send to Midjourney. Once Midjourney shows its code, record it here or let the agent call set_moodboard_midjourney.
      </p>}
    </div>
    <div className="flex flex-wrap items-center gap-2">
      {board.mjUrl && <a href={board.mjUrl} target="_blank" rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] transition-opacity hover:opacity-90"
        style={{ ...mono, borderRadius: RADIUS, ...TONE.ghost, color: "var(--lm-text-primary)" }}>
        <ExternalLink size={13} aria-hidden />Open in Midjourney
      </a>}
      {sync.inMidjourney && !sync.upToDate && <ActionButton busy={syncing} icon={<RefreshCw size={13} aria-hidden />} onClick={onMarkSynced}
        title="Record that Midjourney now holds every image on this board">Mark synced</ActionButton>}
      {!sync.inMidjourney && <ActionButton icon={<Pencil size={13} aria-hidden />} onClick={onRecord}>Record code</ActionButton>}
    </div>
  </div>;
}

function SendToMidjourney({ board, items }: { board: Board; items: Item[] }) {
  const toast = useCoralToastSafe()?.toast;
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const images = items.filter((item) => item.kind === "image" && item.url);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, [open]);

  const copy = async (key: string, value: string, done: string) => {
    if (await copyText(value)) {
      setCopied(key); setTimeout(() => setCopied(null), 1400);
      toast?.(done, undefined, "success", 2500);
    } else {
      toast?.("Copy failed", "The browser refused clipboard access.", "warning");
    }
  };
  const download = async () => {
    if (progress) return;
    setProgress({ done: 0, total: images.length });
    try {
      const result = await downloadMoodboardImages(board.name, items, (done, total) => setProgress({ done, total }));
      toast?.(`Downloaded ${plural(result.zipped, "image")}`, result.failed ? `${result.failed} could not be fetched.` : "Numbered in board order.", result.failed ? "warning" : "success");
    } catch (err) {
      toast?.("Download failed", errorText(err, "Could not build the zip."), "warning");
    } finally { setProgress(null); }
  };

  const rows = [
    {
      key: "download", icon: progress ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Download size={14} aria-hidden />,
      title: progress ? `Zipping ${progress.done}/${progress.total}` : "Download images",
      detail: "A zip of the original files, numbered in board order", run: () => void download(), disabled: images.length === 0 || Boolean(progress),
    },
    {
      key: "links", icon: copied === "links" ? <Check size={14} aria-hidden /> : <Link2 size={14} aria-hidden />, title: "Copy image links",
      detail: "One full-size URL per line, in board order", disabled: images.length === 0,
      run: () => void copy("links", images.map((item) => item.url).join("\n"), `Copied ${plural(images.length, "link")}`),
    },
    {
      key: "agent", icon: copied === "agent" ? <Check size={14} aria-hidden /> : <Bot size={14} aria-hidden />, title: "Copy agent request",
      detail: "For an agent with Midjourney access: create or update the board, then record its code", disabled: false,
      run: () => void copy("agent", moodboardAgentRequest({ id: board._id, name: board.name, itemCount: board.itemCount, mjCode: board.mjCode, mjMoodboardId: board.mjMoodboardId }), "Agent request copied"),
    },
  ];

  return <div ref={rootRef} className="relative">
    <ActionButton tone="ink" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}
      icon={progress ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Download size={13} aria-hidden />}>
      Send to Midjourney<ChevronDown size={13} aria-hidden />
    </ActionButton>
    {open && <div role="menu" aria-label="Send to Midjourney" className="absolute left-0 top-[calc(100%+6px)] z-40 grid w-[300px] max-w-[calc(100vw-32px)] border py-1 max-sm:fixed max-sm:inset-x-4 max-sm:bottom-[calc(var(--mobile-bottom-nav-height,64px)+12px)] max-sm:top-auto max-sm:w-auto max-sm:max-w-none 2xl:left-auto 2xl:right-0"
      style={{ borderRadius: RADIUS, borderColor: "var(--lm-border-strong)", background: "var(--lm-surface-1)", boxShadow: "var(--lm-shadow-lg)" }}>
      {rows.map((row) => <button key={row.key} type="button" role="menuitem" disabled={row.disabled} onClick={row.run}
        className="grid grid-cols-[18px_minmax(0,1fr)] items-start gap-x-2.5 px-3 py-2.5 text-left transition-colors hover:bg-[var(--lm-surface-2)] disabled:cursor-not-allowed disabled:opacity-45">
        <span className="mt-[1px]" style={{ color: "var(--lm-coral)" }}>{row.icon}</span>
        <span className="grid gap-1">
          <span className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ ...mono, color: "var(--lm-text-primary)" }}>{row.title}</span>
          <span className="text-[11px] leading-4" style={{ color: "var(--lm-text-tertiary)" }}>{row.detail}</span>
        </span>
      </button>)}
      {items.some((item) => item.kind === "video") && <p className="border-t px-3 pb-1.5 pt-2 text-[10px] uppercase tracking-[0.12em]" style={{ ...mono, borderColor: "var(--lm-border)", color: "var(--lm-text-ghost)" }}>
        Videos stay out: Midjourney moodboards take images
      </p>}
    </div>}
  </div>;
}

function BoardItems({ items, coverAssetId, onOpen, onMove, onDrop, onRemove, onMakeCover }: {
  items: Item[]; coverAssetId?: string;
  onOpen: (item: Item) => void; onMove: (assetId: string, offset: number) => void;
  onDrop: (dragged: string, target: string, after: boolean) => void;
  onRemove: (assetId: string) => void; onMakeCover: (assetId: string) => void;
}) {
  const [dragged, setDragged] = useState<string | null>(null);
  const [target, setTarget] = useState<{ assetId: string; after: boolean } | null>(null);
  const inputs = useMemo(() => items.map((item) => ({ width: item.width, height: item.height, kind: item.kind, contentType: item.contentType })), [items]);
  const finish = () => { setDragged(null); setTarget(null); };

  return <TilePlane items={items} inputs={inputs} keyOf={(item) => item.assetId} label={`Board, ${plural(items.length, "image")}`} render={(item, index) => {
    const isCover = item.assetId === coverAssetId;
    const marker = target?.assetId === item.assetId && dragged !== item.assetId ? target : null;
    return <div className="relative h-full w-full"
      onDragOver={(event: DragEvent) => {
        if (!dragged) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const rect = event.currentTarget.getBoundingClientRect();
        const after = event.clientX > rect.left + rect.width / 2;
        if (target?.assetId !== item.assetId || target.after !== after) setTarget({ assetId: item.assetId, after });
      }}
      onDrop={(event: DragEvent) => {
        event.preventDefault();
        if (dragged && marker) onDrop(dragged, item.assetId, marker.after);
        finish();
      }}>
      <div draggable onDragStart={(event: DragEvent) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", item.assetId);
        setDragged(item.assetId);
      }} onDragEnd={finish}
        className="group relative h-full w-full overflow-hidden"
        style={{ borderRadius: RADIUS, background: "var(--lm-surface-2)", opacity: dragged === item.assetId ? 0.35 : 1, outline: isCover ? "1px solid var(--lm-coral)" : undefined, outlineOffset: -1 }}>
        <button type="button" onClick={() => onOpen(item)} className="block h-full w-full cursor-zoom-in focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
          aria-label={`Open image ${index + 1}${item.agentDescription ? `: ${item.agentDescription}` : ""}`}>
          <div className="h-full w-full transition-transform duration-500 group-hover:scale-[1.02]">
            <Thumb src={item.thumbUrl ?? item.url} alt={item.agentDescription ?? `Board image ${index + 1}`} />
          </div>
        </button>
        <span className="pointer-events-none absolute left-1.5 top-1.5 px-1.5 py-[3px] text-[10px] font-bold tracking-[0.08em]"
          style={{ ...mono, borderRadius: RADIUS, background: SCRIM, color: "var(--lm-text-primary)" }}>{String(index + 1).padStart(2, "0")}</span>
        {(isCover || item.kind === "video") && <span className="pointer-events-none absolute bottom-1.5 left-1.5 flex gap-1">
          {isCover && <span className="px-1.5 py-[3px] text-[9px] font-bold uppercase tracking-[0.14em]" style={{ ...mono, borderRadius: RADIUS, background: "var(--lm-coral)", color: "var(--lm-paper)" }}>Cover</span>}
          {item.kind === "video" && <span className="grid h-5 w-5 place-items-center" style={{ borderRadius: RADIUS, background: SCRIM, color: "var(--lm-text-primary)" }}><Play size={10} fill="currentColor" aria-hidden /></span>}
        </span>}
        <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
          <IconButton label="Move earlier" disabled={index === 0} onClick={() => onMove(item.assetId, -1)}><ChevronLeft size={13} /></IconButton>
          <IconButton label="Move later" disabled={index === items.length - 1} onClick={() => onMove(item.assetId, 1)}><ChevronRight size={13} /></IconButton>
          {!isCover && <IconButton label="Make cover" onClick={() => onMakeCover(item.assetId)}><Star size={12} /></IconButton>}
          <IconButton label="Remove from board" onClick={() => onRemove(item.assetId)}><X size={13} /></IconButton>
        </div>
        <div className="absolute bottom-1.5 right-1.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
          <CopyChip value={`asset:${item.assetId}`} label={item.assetId.slice(-6)} />
        </div>
      </div>
      {marker && <span aria-hidden className="pointer-events-none absolute inset-y-0 w-[3px]"
        style={{ left: marker.after ? undefined : DROP_OFFSET, right: marker.after ? DROP_OFFSET : undefined, background: "var(--lm-coral)", borderRadius: RADIUS }} />}
    </div>;
  }} />;
}

function Generations({ ownerUserId, moodboardId, onOpenAsset }: { ownerUserId: string; moodboardId: Id<"moodboards">; onOpenAsset: (asset: MoodboardAssetSummary) => void }) {
  const { isAuthenticated } = useConvexAuth();
  const result = useQuery(api.moodboards.listMoodboardGenerations, isAuthenticated ? { ownerUserId, moodboardId, limit: 36 } : "skip");
  const add = useMutation(api.moodboards.addMoodboardItems);
  const toast = useCoralToastSafe()?.toast;
  const assets = useMemo(() => result?.assets ?? [], [result]);
  const inputs = useMemo(() => assets.map((asset) => ({ width: asset.width, height: asset.height, kind: asset.kind, contentType: asset.contentType })), [assets]);
  return <>
    <SectionTitle label="Made with this board" count={result?.assets.length}
      hint={result?.terms.length ? <>Prompts carrying {result.terms.map((term, index) => <span key={term}>
        {index > 0 && " or "}<Code>{/^m\d+$/.test(term) ? `--profile ${term}` : term}</Code>
      </span>)}</> : undefined} />
    {result === undefined ? <Micro>Looking for generations…</Micro>
      : assets.length === 0 ? <p className="text-xs leading-5" style={{ color: "var(--lm-text-tertiary)" }}>
        Nothing saved yet with this board&rsquo;s code in its prompt. Save Midjourney results with their full prompt and they appear here.
      </p>
      : <TilePlane items={assets} inputs={inputs} keyOf={(asset) => asset.assetId} label="Generations made with this board" render={(asset: Generation) =>
        <div className="group relative h-full w-full overflow-hidden" style={{ borderRadius: RADIUS, background: "var(--lm-surface-2)" }}>
          <button type="button" onClick={() => onOpenAsset(asset)} className="block h-full w-full cursor-zoom-in" aria-label={`Open generation${asset.promptText ? `: ${asset.promptText.slice(0, 80)}` : ""}`}>
            <Thumb src={asset.thumbUrl ?? asset.url} alt={asset.promptText?.slice(0, 120) ?? "Generation"} />
          </button>
          <span className="pointer-events-none absolute left-1.5 top-1.5 px-1.5 py-[3px] text-[10px] font-bold tracking-[0.06em] opacity-0 transition-opacity group-hover:opacity-100"
            style={{ ...mono, borderRadius: RADIUS, background: SCRIM, color: "var(--lm-text-primary)" }}>{asset.matchedTerm}</span>
          <div className="absolute right-1.5 top-1.5">
            {asset.onBoard
              ? <span className="inline-flex items-center gap-1 px-1.5 py-[3px] text-[9px] font-bold uppercase tracking-[0.14em]" style={{ ...mono, borderRadius: RADIUS, background: SCRIM, color: "var(--lm-text-secondary)" }}><Check size={10} aria-hidden />On board</span>
              : <span className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                <IconButton label="Add to this board" onClick={async () => {
                  try {
                    await add({ ownerUserId, moodboardId, assetIds: [asset.assetId] });
                    toast?.("Added to the board", undefined, "success", 2500);
                  } catch (err) { toast?.("Could not add", errorText(err, "Could not add the image."), "warning"); }
                }}><Plus size={13} /></IconButton>
              </span>}
          </div>
        </div>} />}
  </>;
}

function EditMoodboard({ ownerUserId, board, collections, onDone }: {
  ownerUserId: string; board: Board; collections: MoodboardCollectionOption[]; onDone: () => void;
}) {
  const update = useMutation(api.moodboards.updateMoodboard);
  // What the form opened with. Only fields changed from it are sent, so an
  // item reorder or an agent's edit to another field meanwhile is kept.
  const [initial] = useState(() => ({
    name: board.name, description: board.description ?? "", styleTag: board.styleTag ?? "", notes: board.notes ?? "",
    mjCode: board.mjCode ?? "", mjMoodboardId: board.mjMoodboardId ?? "", mjUrl: board.mjUrl ?? "", folderId: board.folderId as string,
  }));
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [styleTag, setStyleTag] = useState(initial.styleTag);
  const [notes, setNotes] = useState(initial.notes);
  const [mjCode, setMjCode] = useState(initial.mjCode);
  const [mjMoodboardId, setMjMoodboardId] = useState(initial.mjMoodboardId);
  const [mjUrl, setMjUrl] = useState(initial.mjUrl);
  const [folderId, setFolderId] = useState(initial.folderId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const owners: MoodboardCollectionOption[] = collections.some((entry) => entry._id === board.folderId)
    ? collections
    : [{ _id: board.folderId, name: "Current collection" }, ...collections];
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    // A changed text field is sent trimmed; emptied, it clears (null).
    const text = (value: string, before: string) => (value.trim() === before.trim() ? undefined : value.trim() || null);
    const patch = {
      name: name.trim() === initial.name ? undefined : name,
      description: text(description, initial.description), styleTag: text(styleTag, initial.styleTag), notes: text(notes, initial.notes),
      mjCode: text(mjCode, initial.mjCode), mjMoodboardId: text(mjMoodboardId, initial.mjMoodboardId), mjUrl: text(mjUrl, initial.mjUrl),
      folderId: folderId === initial.folderId ? undefined : folderId as Id<"folders">,
    };
    if (Object.values(patch).every((value) => value === undefined)) { onDone(); return; }
    setBusy(true); setError("");
    try {
      await update({ ownerUserId, moodboardId: board._id, ...patch });
      onDone();
    } catch (err) { setError(errorText(err, "Could not save.")); } finally { setBusy(false); }
  };
  return <form onSubmit={submit} className="mt-5 grid gap-3 border p-4 sm:grid-cols-2 lg:grid-cols-4"
    style={{ borderRadius: RADIUS, borderColor: "var(--lm-border-strong)", background: "var(--lm-surface-1)" }} aria-label={`Edit ${board.name}`}>
    <Field label="Name" className="sm:col-span-2"><input required maxLength={MOODBOARD_LIMITS.name} className={fieldClass} style={fieldStyle} value={name} onChange={(e) => setName(e.target.value)} /></Field>
    <Field label="Style tag"><input maxLength={MOODBOARD_LIMITS.styleTag} className={fieldClass} style={{ ...fieldStyle, ...mono }} value={styleTag} onChange={(e) => setStyleTag(e.target.value)} placeholder="da-film" /></Field>
    <Field label="Belongs to">
      <select className={fieldClass} style={fieldStyle} value={folderId} onChange={(e) => setFolderId(e.target.value)} disabled={owners.length < 2}>
        {owners.map((owner) => <option key={owner._id} value={owner._id}>{collectionLabel(owner)}</option>)}
      </select>
    </Field>
    <Field label="What it carries" className="sm:col-span-2 lg:col-span-4"><textarea rows={2} maxLength={MOODBOARD_LIMITS.description} className={`${fieldClass} resize-y`} style={fieldStyle} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
    <Field label="Midjourney code"><input maxLength={80} className={fieldClass} style={{ ...fieldStyle, ...mono }} value={mjCode} onChange={(e) => setMjCode(e.target.value)} placeholder="88ji6bg" /></Field>
    <Field label="Midjourney moodboard id"><input maxLength={80} className={fieldClass} style={{ ...fieldStyle, ...mono }} value={mjMoodboardId} onChange={(e) => setMjMoodboardId(e.target.value)} placeholder="7510337594627371941" /></Field>
    <Field label="Midjourney link" className="sm:col-span-2"><input type="url" maxLength={MOODBOARD_LIMITS.mjUrl} className={fieldClass} style={fieldStyle} value={mjUrl} onChange={(e) => setMjUrl(e.target.value)} placeholder="https://www.midjourney.com/…" /></Field>
    <Field label="Notes" className="sm:col-span-2 lg:col-span-4"><textarea rows={3} maxLength={MOODBOARD_LIMITS.notes} className={`${fieldClass} resize-y`} style={{ ...fieldStyle, ...mono, fontSize: "12px" }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Like rate, recipe partners (+ DARI h2eu2z6), what to avoid" /></Field>
    <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
      <ActionButton type="submit" tone="coral" busy={busy} disabled={busy || !name.trim()}>{busy ? "Saving…" : "Save changes"}</ActionButton>
      <Micro color="var(--lm-text-ghost)">A changed code keeps the old one in history; Mark synced records a sync</Micro>
      {error && <p role="alert" className="text-xs" style={{ color: "var(--lm-coral)" }}>{error}</p>}
    </div>
  </form>;
}
