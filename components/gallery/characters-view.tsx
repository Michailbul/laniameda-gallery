"use client";

import { useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowLeft, Check, Copy, Link2, Pencil, Plus, Search, Unlink, UserRound, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  CHARACTER_LANES, CHARACTER_LINK_ROLES, CHARACTER_STATUSES,
  type CharacterLinkRole, type CharacterStatus,
} from "@/lib/character-codes";

type World = { _id: string; name: string; parentFolderId?: string; kind?: "storybook" };
type Summary = FunctionReturnType<typeof api.characters.listCharacters>[number];
type Detail = FunctionReturnType<typeof api.characters.getCharacter>;
type Character = Summary["character"];
type Link = Detail["links"][number];

const mono: CSSProperties = { fontFamily: "var(--lm-font)" };
const display: CSSProperties = { fontFamily: "var(--lm-font-display)" };
const field = "w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2";
const fieldStyle: CSSProperties = { background: "var(--lm-surface-0)", borderColor: "var(--lm-border)", color: "var(--lm-text-primary)" };
const STATUS_COLOR: Record<CharacterStatus, string> = {
  concept: "var(--lm-text-tertiary)", approved: "var(--lm-coral)", sheeted: "var(--lm-success)", retired: "var(--lm-text-ghost)",
};
const ROLE_LABEL: Record<CharacterLinkRole, string> = {
  concept: "Concept", sheet: "Sheet", face: "Face", costume: "Costume", "appears-in": "Appears in", reference: "Reference",
};
const errorText = (error: unknown, fallback: string) => {
  const data = (error as { data?: unknown })?.data;
  if (typeof data === "string") return data;
  return error instanceof Error ? error.message.replace(/^.*Uncaught ConvexError: /, "").split("\n")[0] : fallback;
};
const assetIdsFrom = (input: string) =>
  [...new Set(input.split(/[\s,]+/).map((id) => id.trim().replace(/^asset:/, "")).filter(Boolean))] as Id<"assets">[];

function Badge({ children, color, title }: { children: ReactNode; color?: string; title?: string }) {
  return <span title={title} className="inline-flex items-center gap-1.5 rounded-[4px] border px-1.5 py-[3px] text-[10px] font-semibold uppercase leading-none tracking-[0.12em]"
    style={{ ...mono, borderColor: "var(--lm-border)", color: color ?? "var(--lm-text-secondary)" }}>{children}</span>;
}

function StatusBadge({ status }: { status: CharacterStatus }) {
  return <Badge color={STATUS_COLOR[status]}><span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLOR[status] }} />{status}</Badge>;
}

// Every code and asset on this page carries a copy button, so it can be pasted to an agent.
function CopyId({ value, label, strong }: { value: string; label?: string; strong?: boolean }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" aria-label={`Copy ${label ?? value}`} title={`Copy ${value}`}
    onClick={async (event) => {
      event.stopPropagation();
      try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { setCopied(false); }
    }}
    className="inline-flex max-w-full items-center gap-1.5 rounded-[4px] px-1.5 py-[3px] text-[10px] font-bold uppercase leading-none tracking-[0.1em] backdrop-blur focus-visible:outline-2 focus-visible:outline-offset-2"
    style={{ ...mono, background: strong ? "var(--lm-ink)" : "color-mix(in srgb, var(--lm-paper) 78%, transparent)", color: strong ? "var(--lm-paper)" : "var(--lm-text-primary)", border: "1px solid var(--lm-border-strong)" }}>
    <span className="truncate">{label ?? value}</span>{copied ? <Check size={11} /> : <Copy size={11} className="opacity-60" />}
  </button>;
}

function Thumb({ src, alt, className, contain }: { src?: string; alt: string; className?: string; contain?: boolean }) {
  // eslint-disable-next-line @next/next/no-img-element -- saved gallery thumbnails
  return src ? <img src={src} alt={alt} loading="lazy" className={`${className ?? ""} h-full w-full ${contain ? "object-contain" : "object-cover"}`} /> : null;
}

function Monogram({ character }: { character: Character }) {
  return <div className="flex h-full w-full flex-col items-center justify-center gap-1" style={{ background: "var(--lm-surface-2)" }}>
    <span className="text-5xl font-black uppercase tracking-tight" style={{ ...display, color: "var(--lm-text-ghost)" }}>{character.name.slice(0, 2)}</span>
    <span className="text-[9px] uppercase tracking-[0.16em]" style={{ ...mono, color: "var(--lm-text-ghost)" }}>No sheet yet</span>
  </div>;
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} aria-pressed={active}
    className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
    style={{ ...mono, borderColor: active ? "var(--lm-sidebar-active-border)" : "var(--lm-border)", background: active ? "var(--lm-sidebar-active-fill)" : "transparent", color: active ? "var(--lm-sidebar-active-text)" : "var(--lm-text-secondary)" }}>
    {children}
  </button>;
}

export function CharactersView({ ownerUserId, worlds }: { ownerUserId: string; worlds: World[] }) {
  const { isAuthenticated } = useConvexAuth();
  const [worldId, setWorldId] = useState<string>("");
  const [status, setStatus] = useState<CharacterStatus | "">("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const rows = useQuery(api.characters.listCharacters, isAuthenticated ? { ownerUserId, limit: 1000 } : "skip");
  const rootWorlds = useMemo(() => worlds.filter((world) => !world.parentFolderId && !world.kind), [worlds]);
  const castWorlds = useMemo(() => {
    const counts = new Map<string, { name: string; prefix: string; count: number }>();
    for (const row of rows ?? []) {
      const entry = counts.get(row.character.worldFolderId) ?? { name: row.worldName ?? "Unknown world", prefix: row.character.prefix, count: 0 };
      entry.count += 1;
      counts.set(row.character.worldFolderId, entry);
    }
    return [...counts.entries()].sort((a, b) => a[1].prefix.localeCompare(b[1].prefix));
  }, [rows]);
  const visible = useMemo(() => {
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (rows ?? []).filter(({ character }) => (!worldId || character.worldFolderId === worldId) && (!status || character.status === status)
      && terms.every((term) => [character.code, character.name, character.alias, character.role, character.nameTag, ...character.otherNames, ...character.costumes.map((c) => c.name)]
        .some((value) => value?.toLowerCase().includes(term))));
  }, [rows, worldId, status, search]);

  if (open) return <CharacterPage ownerUserId={ownerUserId} code={open} onBack={() => setOpen(null)} />;

  return <section className="px-4 pb-10 pt-5 md:px-6" style={{ color: "var(--lm-text-primary)" }}>
    <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 className="text-3xl font-black uppercase leading-none tracking-tight" style={display}>Characters</h2>
        <p className="mt-2 text-[11px] uppercase tracking-[0.14em]" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>
          {rows === undefined ? "Loading cast…" : `${rows.length} ${rows.length === 1 ? "person" : "people"} · ${castWorlds.length} ${castWorlds.length === 1 ? "world" : "worlds"} · concept → approved → sheeted`}
        </p>
      </div>
      <button type="button" disabled={!isAuthenticated} onClick={() => setCreating(!creating)} aria-expanded={creating}
        className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-bold uppercase tracking-[0.08em] disabled:opacity-50"
        style={{ ...mono, background: "var(--lm-ink)", color: "var(--lm-paper)" }}>
        {creating ? <X size={14} /> : <Plus size={14} />}{creating ? "Close" : "New character"}
      </button>
    </header>

    {creating && <CreateCharacter ownerUserId={ownerUserId} worlds={rootWorlds} defaultWorldId={worldId}
      onCreated={(code) => { setCreating(false); setOpen(code); }} />}

    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Chip active={!worldId} onClick={() => setWorldId("")}>All worlds <span className="opacity-60">{rows?.length ?? 0}</span></Chip>
      {castWorlds.map(([id, world]) => <Chip key={id} active={worldId === id} onClick={() => setWorldId(id)}>
        <span style={{ color: "var(--lm-coral)" }}>{world.prefix}</span>{world.name}<span className="opacity-60">{world.count}</span>
      </Chip>)}
    </div>
    <div className="mb-6 flex flex-wrap items-center gap-2">
      <label className="flex min-w-56 flex-1 items-center gap-2 rounded-md border px-3 py-2 sm:max-w-sm" style={fieldStyle}>
        <Search size={14} aria-hidden />
        <input aria-label="Search characters" value={search} onChange={(event) => setSearch(event.target.value)}
          placeholder="Name, code, alias, costume…" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
      </label>
      <Chip active={!status} onClick={() => setStatus("")}>Any status</Chip>
      {CHARACTER_STATUSES.map((value) => <Chip key={value} active={status === value} onClick={() => setStatus(value)}>
        <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLOR[value] }} />{value}
      </Chip>)}
    </div>

    {rows === undefined ? <p role="status" className="py-10 text-sm">Loading cast…</p>
      : visible.length === 0 ? <div className="rounded-xl border border-dashed px-6 py-14 text-center" style={{ borderColor: "var(--lm-border-strong)" }}>
        <UserRound className="mx-auto mb-3" size={22} style={{ color: "var(--lm-text-ghost)" }} />
        <p className="text-sm font-semibold uppercase tracking-[0.08em]" style={display}>{rows.length ? "Nobody matches" : "No characters yet"}</p>
        <p className="mx-auto mt-2 max-w-md text-xs leading-5" style={{ color: "var(--lm-text-tertiary)" }}>
          {rows.length ? "Clear a filter or search for a code such as DA-CH-001." : "Register a person once their concept is picked. Each gets a code like DA-CH-001, costumes as -C01, and every sheet, face and scene linked to them."}
        </p>
      </div>
      : <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {visible.map((row) => <CharacterCard key={row.character._id} row={row} onOpen={() => setOpen(row.character.code)} />)}
      </div>}
  </section>;
}

function CharacterCard({ row, onOpen }: { row: Summary; onOpen: () => void }) {
  const { character } = row;
  const cover = row.sheetThumbUrl ?? row.faceThumbUrl;
  return <article role="button" tabIndex={0} onClick={onOpen}
    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); } }}
    aria-label={`${character.code} ${character.name}`}
    className="group cursor-pointer overflow-hidden rounded-[14px] border outline-none transition-transform duration-200 hover:-translate-y-[2px] focus-visible:ring-2 focus-visible:ring-[var(--lm-coral)]"
    style={{ borderColor: "var(--lm-border-strong)", background: "var(--lm-surface-1)", opacity: character.status === "retired" ? 0.55 : 1 }}>
    <div className="relative aspect-[16/10] overflow-hidden" style={{ background: "var(--lm-surface-2)" }}>
      {cover ? <Thumb src={cover} alt={`${character.name} sheet`} contain={!row.sheetThumbUrl} className="transition-transform duration-500 group-hover:scale-[1.03]" /> : <Monogram character={character} />}
      {row.sheetThumbUrl && row.faceThumbUrl && <div className="absolute bottom-2 left-2 aspect-square w-[24%] overflow-hidden rounded-md border-2" style={{ borderColor: "var(--lm-paper)", boxShadow: "var(--lm-shadow-md)" }}>
        <Thumb src={row.faceThumbUrl} alt={`${character.name} face`} />
      </div>}
      <div className="absolute left-2 top-2"><CopyId value={character.code} strong /></div>
    </div>
    <div className="grid gap-2 p-3">
      <div className="min-w-0">
        <h3 className="truncate text-[15px] font-black uppercase leading-tight tracking-tight" style={display}>{character.name}</h3>
        <p className="truncate text-xs" style={{ color: "var(--lm-text-tertiary)" }}>{character.alias ?? character.role ?? row.worldName ?? " "}</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <StatusBadge status={character.status} />
        {character.lane && <Badge>{character.lane === "live-action" ? "Live" : "Anim"}</Badge>}
        {character.costumes.length > 0 && <Badge>{character.costumes.length} {character.costumes.length === 1 ? "costume" : "costumes"}</Badge>}
        <Badge>{character.linkCount} linked</Badge>
      </div>
    </div>
  </article>;
}

function CreateCharacter({ ownerUserId, worlds, defaultWorldId, onCreated }: { ownerUserId: string; worlds: World[]; defaultWorldId: string; onCreated: (code: string) => void }) {
  const create = useMutation(api.characters.createCharacter);
  const [worldFolderId, setWorldFolderId] = useState(defaultWorldId || worlds[0]?._id || "");
  const [name, setName] = useState("");
  const [alias, setAlias] = useState("");
  const [role, setRole] = useState("");
  const [lane, setLane] = useState("");
  const [nameTag, setNameTag] = useState("");
  const [prefix, setPrefix] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    try {
      const result = await create({
        ownerUserId, worldFolderId: worldFolderId as Id<"folders">, name, alias: alias || undefined, role: role || undefined,
        lane: (lane || undefined) as Character["lane"], nameTag: nameTag || undefined, prefix: prefix || undefined,
      });
      onCreated(result.code);
    } catch (err) { setError(errorText(err, "Could not create the character.")); } finally { setBusy(false); }
  };
  return <form onSubmit={submit} className="mb-6 grid gap-3 rounded-xl border p-4 sm:grid-cols-2 lg:grid-cols-4" style={{ ...fieldStyle, background: "var(--lm-surface-1)" }}>
    <label className="grid gap-1 text-xs">World<select required className={field} style={fieldStyle} value={worldFolderId} onChange={(e) => setWorldFolderId(e.target.value)}>
      {worlds.map((world) => <option key={world._id} value={world._id}>{world.name}</option>)}</select></label>
    <label className="grid gap-1 text-xs">Name<input required maxLength={80} className={field} style={fieldStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ilka" /></label>
    <label className="grid gap-1 text-xs">Alias<input maxLength={120} className={field} style={fieldStyle} value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="Tram-Stop Flower Seller" /></label>
    <label className="grid gap-1 text-xs">Story role<input maxLength={120} className={field} style={fieldStyle} value={role} onChange={(e) => setRole(e.target.value)} placeholder="Heroine, suitor, minor" /></label>
    <label className="grid gap-1 text-xs">Lane<select className={field} style={fieldStyle} value={lane} onChange={(e) => setLane(e.target.value)}>
      <option value="">Not set</option>{CHARACTER_LANES.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
    <label className="grid gap-1 text-xs">Name tag<input maxLength={80} className={field} style={fieldStyle} value={nameTag} onChange={(e) => setNameTag(e.target.value)} placeholder="ilka" /></label>
    <label className="grid gap-1 text-xs">Code prefix, first character only<input maxLength={4} className={`${field} uppercase`} style={{ ...fieldStyle, ...mono }} value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="From the world name" /></label>
    <div className="flex items-end"><button type="submit" disabled={busy || !name.trim() || !worldFolderId} className="w-full rounded-md px-3 py-2 text-xs font-bold uppercase tracking-[0.08em] disabled:opacity-50" style={{ ...mono, background: "var(--lm-coral)", color: "var(--lm-paper)" }}>{busy ? "Registering…" : "Register as concept"}</button></div>
    {error && <p role="alert" className="text-sm sm:col-span-2 lg:col-span-4" style={{ color: "var(--lm-coral)" }}>{error}</p>}
  </form>;
}

function CharacterPage({ ownerUserId, code, onBack }: { ownerUserId: string; code: string; onBack: () => void }) {
  const { isAuthenticated } = useConvexAuth();
  const detail = useQuery(api.characters.getCharacter, isAuthenticated ? { ownerUserId, character: code } : "skip");
  const [editing, setEditing] = useState(false);
  const [roleFilter, setRoleFilter] = useState<CharacterLinkRole | "">("");
  if (detail === undefined) return <section className="px-6 py-10 text-sm" role="status">Loading {code}…</section>;
  const { character, links, worldName } = detail;
  const byId = new Map(links.map((link) => [link.assetId, link]));
  const sheet = character.sheetAssetId ? byId.get(character.sheetAssetId)?.asset : undefined;
  const face = character.faceAssetId ? byId.get(character.faceAssetId)?.asset : undefined;
  const roleCounts = new Map<CharacterLinkRole, number>();
  for (const link of links) roleCounts.set(link.role, (roleCounts.get(link.role) ?? 0) + 1);
  const shown = links.filter((link) => !roleFilter || link.role === roleFilter);

  return <section className="px-4 pb-12 pt-4 md:px-6" style={{ color: "var(--lm-text-primary)" }}>
    <button type="button" onClick={onBack} className="mb-4 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>
      <ArrowLeft size={13} />All characters
    </button>

    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(300px,1fr)]">
      <div className="relative aspect-[16/9] overflow-hidden rounded-[14px] border-2" style={{ borderColor: "var(--lm-border-strong)", background: "var(--lm-surface-2)" }}>
        {sheet?.url ? <a href={sheet.url} target="_blank" rel="noopener noreferrer" className="block h-full"><Thumb src={sheet.thumbUrl ?? sheet.url} alt={`${character.name} master sheet`} contain /></a>
          : <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <span className="text-7xl font-black uppercase tracking-tight" style={{ ...display, color: "var(--lm-text-ghost)" }}>{character.name.slice(0, 2)}</span>
            <span className="text-[10px] uppercase tracking-[0.16em]" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>No master sheet. Link one below and mark it as the sheet.</span>
          </div>}
        {character.sheetAssetId && <div className="absolute bottom-3 left-3"><CopyId value={`asset:${character.sheetAssetId}`} label="Master sheet" /></div>}
      </div>

      <div className="grid content-start gap-4">
        <div className="flex flex-wrap items-center gap-2"><CopyId value={character.code} strong /><StatusBadge status={character.status} />
          {character.lane && <Badge>{character.lane}</Badge>}<Badge>Rev {character.revision}</Badge></div>
        <div>
          <h2 className="break-words text-4xl font-black uppercase leading-[0.95] tracking-tight md:text-5xl" style={display}>{character.name}</h2>
          {character.alias && <p className="mt-2 text-base" style={{ color: "var(--lm-text-secondary)" }}>{character.alias}</p>}
        </div>
        <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-4">
          <div className="relative aspect-[4/5] overflow-hidden rounded-[10px] border" style={{ borderColor: "var(--lm-border-strong)", background: "var(--lm-surface-2)" }}>
            {face?.thumbUrl ? <Thumb src={face.thumbUrl} alt={`${character.name} face`} /> : <div className="flex h-full items-center justify-center text-[9px] uppercase tracking-[0.14em]" style={{ ...mono, color: "var(--lm-text-ghost)" }}>No face</div>}
          </div>
          <dl className="grid content-start gap-y-1.5 text-xs" style={{ color: "var(--lm-text-secondary)" }}>
            {[["World", worldName ?? "Unknown"], ["Role", character.role], ["Name tag", character.nameTag], ["Also", character.otherNames.join(", ")]]
              .filter(([, value]) => value).map(([label, value]) => <div key={label} className="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
                <dt className="text-[10px] uppercase tracking-[0.14em]" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>{label}</dt><dd className="break-words">{value}</dd>
              </div>)}
          </dl>
        </div>
        {character.notes && <p className="whitespace-pre-wrap rounded-lg border p-3 text-xs leading-5" style={{ borderColor: "var(--lm-border)", color: "var(--lm-text-secondary)" }}>{character.notes}</p>}
        <div><button type="button" onClick={() => setEditing(!editing)} aria-expanded={editing} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em]" style={{ ...mono, ...fieldStyle }}>
          {editing ? <X size={13} /> : <Pencil size={13} />}{editing ? "Close" : "Edit"}</button></div>
      </div>
    </div>
    {editing && <EditCharacter key={character.revision} ownerUserId={ownerUserId} character={character} onDone={() => setEditing(false)} />}

    <SectionTitle label="Costumes" count={character.costumes.length} />
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {character.costumes.map((costume) => {
        const costumeSheet = costume.sheetAssetId ? byId.get(costume.sheetAssetId)?.asset : undefined;
        const costumeFace = costume.faceAssetId ? byId.get(costume.faceAssetId)?.asset : undefined;
        return <article key={costume.code} className="overflow-hidden rounded-[12px] border" style={{ borderColor: "var(--lm-border-strong)", background: "var(--lm-surface-1)" }}>
          <div className="relative aspect-[16/10]" style={{ background: "var(--lm-surface-2)" }}>
            {costumeSheet?.thumbUrl ?? costumeFace?.thumbUrl ? <Thumb src={costumeSheet?.thumbUrl ?? costumeFace?.thumbUrl} alt={`${character.name} ${costume.name}`} contain={!costumeSheet} />
              : <div className="flex h-full items-center justify-center text-[9px] uppercase tracking-[0.14em]" style={{ ...mono, color: "var(--lm-text-ghost)" }}>No costume sheet</div>}
            <div className="absolute left-2 top-2"><CopyId value={`${character.code}-${costume.code}`} label={costume.code} strong /></div>
          </div>
          <div className="grid gap-1.5 p-3"><h4 className="truncate text-sm font-black uppercase tracking-tight" style={display}>{costume.name}</h4><div><StatusBadge status={costume.status} /></div></div>
        </article>;
      })}
      <AddCostume ownerUserId={ownerUserId} code={character.code} />
    </div>

    <SectionTitle label="Linked assets" count={links.length} />
    <div className="mb-4 flex flex-wrap gap-2">
      <Chip active={!roleFilter} onClick={() => setRoleFilter("")}>All <span className="opacity-60">{links.length}</span></Chip>
      {CHARACTER_LINK_ROLES.filter((role) => roleCounts.get(role)).map((role) => <Chip key={role} active={roleFilter === role} onClick={() => setRoleFilter(role)}>
        {ROLE_LABEL[role]} <span className="opacity-60">{roleCounts.get(role)}</span></Chip>)}
    </div>
    {shown.length === 0 ? <p className="mb-4 text-xs" style={{ color: "var(--lm-text-tertiary)" }}>Nothing linked yet. Paste asset IDs below, or ask an agent to run link_character_assets.</p>
      : <div className="mb-6 columns-2 gap-3 md:columns-3 xl:columns-5 2xl:columns-6">
        {shown.map((link) => <LinkTile key={link._id} ownerUserId={ownerUserId} character={character} link={link} />)}
      </div>}
    <LinkAssets ownerUserId={ownerUserId} character={character} />
  </section>;
}

function SectionTitle({ label, count }: { label: string; count: number }) {
  return <div className="mb-3 mt-10 flex items-baseline gap-3 border-t pt-4" style={{ borderColor: "var(--lm-border)" }}>
    <h3 className="text-lg font-black uppercase tracking-tight" style={display}>{label}</h3>
    <span className="text-[11px] uppercase tracking-[0.14em]" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>{count}</span>
  </div>;
}

function LinkTile({ ownerUserId, character, link }: { ownerUserId: string; character: Character; link: Link }) {
  const unlink = useMutation(api.characters.unlinkAssets);
  const update = useMutation(api.characters.updateCharacter);
  const saveCostume = useMutation(api.characters.saveCostume);
  const [error, setError] = useState("");
  const isPointer = [character.sheetAssetId, character.faceAssetId].includes(link.assetId)
    || character.costumes.some((costume) => costume.sheetAssetId === link.assetId || costume.faceAssetId === link.assetId);
  const promote = async () => {
    const pointer = link.role === "face" ? { faceAssetId: link.assetId } : { sheetAssetId: link.assetId };
    try {
      if (link.costumeCode) await saveCostume({ ownerUserId, character: character.code, code: link.costumeCode, ...pointer });
      else await update({ ownerUserId, character: character.code, expectedRevision: character.revision, ...pointer });
    } catch (err) { setError(errorText(err, "Could not update.")); }
  };
  const ratio = link.asset?.width && link.asset.height ? `${link.asset.width} / ${link.asset.height}` : "4 / 5";
  return <figure className="group mb-3 break-inside-avoid overflow-hidden rounded-[10px] border" style={{ borderColor: isPointer ? "var(--lm-coral)" : "var(--lm-border)", background: "var(--lm-surface-1)" }}>
    <div className="relative" style={{ aspectRatio: ratio, background: "var(--lm-surface-2)" }}>
      {link.asset ? <a href={link.asset.url ?? link.asset.thumbUrl} target="_blank" rel="noopener noreferrer" className="block h-full">
        <Thumb src={link.asset.thumbUrl} alt={link.asset.agentDescription ?? link.asset.description ?? `${ROLE_LABEL[link.role]} of ${character.name}`} />
      </a> : <div className="flex h-full items-center justify-center p-2 text-center text-[9px] uppercase tracking-[0.14em]" style={{ ...mono, color: "var(--lm-text-ghost)" }}>Asset missing</div>}
      <div className="absolute left-1.5 top-1.5 flex flex-wrap gap-1">
        <Badge color={isPointer ? "var(--lm-coral)" : "var(--lm-text-primary)"}>{ROLE_LABEL[link.role]}{link.costumeCode ? ` · ${link.costumeCode}` : ""}</Badge>
      </div>
    </div>
    <figcaption className="flex items-center justify-between gap-1 p-1.5">
      <CopyId value={`asset:${link.assetId}`} label={link.assetId.slice(-6)} />
      <span className="flex gap-1 opacity-70 transition-opacity group-hover:opacity-100">
        {(link.role === "sheet" || link.role === "face") && !isPointer && <button type="button" onClick={promote} title={`Make this the ${link.costumeCode ? `${link.costumeCode} ` : "master "}${link.role}`} aria-label={`Make canonical ${link.role}`}
          className="rounded-[4px] border px-1.5 py-[3px] text-[9px] font-bold uppercase tracking-[0.1em]" style={{ ...mono, borderColor: "var(--lm-border)" }}>Make main</button>}
        <button type="button" title="Unlink from this character" aria-label="Unlink from this character"
          onClick={async () => { try { await unlink({ ownerUserId, character: character.code, assetIds: [link.assetId] }); } catch (err) { setError(errorText(err, "Could not unlink.")); } }}
          className="rounded-[4px] border p-1" style={{ borderColor: "var(--lm-border)" }}><Unlink size={11} /></button>
      </span>
    </figcaption>
    {link.note && <p className="px-2 pb-2 text-[11px] leading-4" style={{ color: "var(--lm-text-tertiary)" }}>{link.note}</p>}
    {error && <p role="alert" className="px-2 pb-2 text-[11px]" style={{ color: "var(--lm-coral)" }}>{error}</p>}
  </figure>;
}

function LinkAssets({ ownerUserId, character }: { ownerUserId: string; character: Character }) {
  const link = useMutation(api.characters.linkAssets);
  const [ids, setIds] = useState("");
  const [role, setRole] = useState<CharacterLinkRole>("appears-in");
  const [costumeCode, setCostumeCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); const assetIds = assetIdsFrom(ids); if (busy || !assetIds.length) return; setBusy(true); setMessage(null);
    try {
      const result = await link({ ownerUserId, character: character.code, links: assetIds.map((assetId) => ({ assetId, role, costumeCode: costumeCode || undefined })) });
      setMessage({ text: `${result.created} linked, ${result.updated} updated, ${result.unchanged} unchanged.` }); setIds("");
    } catch (err) { setMessage({ text: errorText(err, "Could not link."), error: true }); } finally { setBusy(false); }
  };
  return <form onSubmit={submit} className="grid gap-3 rounded-xl border p-4 md:grid-cols-[minmax(0,2fr)_repeat(2,minmax(0,1fr))_auto]" style={{ ...fieldStyle, background: "var(--lm-surface-1)" }}>
    <label className="grid gap-1 text-xs">Asset IDs<textarea rows={1} value={ids} onChange={(e) => setIds(e.target.value)} placeholder="asset:… asset:… (paste from the gallery or an agent)" className={`${field} resize-y`} style={{ ...fieldStyle, ...mono }} /></label>
    <label className="grid gap-1 text-xs">As<select className={field} style={fieldStyle} value={role} onChange={(e) => setRole(e.target.value as CharacterLinkRole)}>
      {CHARACTER_LINK_ROLES.map((value) => <option key={value} value={value}>{ROLE_LABEL[value]}</option>)}</select></label>
    <label className="grid gap-1 text-xs">Costume<select className={field} style={fieldStyle} value={costumeCode} onChange={(e) => setCostumeCode(e.target.value)}>
      <option value="">None</option>{character.costumes.map((costume) => <option key={costume.code} value={costume.code}>{costume.code} · {costume.name}</option>)}</select></label>
    <div className="flex items-end"><button type="submit" disabled={busy || !ids.trim()} className="inline-flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-bold uppercase tracking-[0.08em] disabled:opacity-50" style={{ ...mono, background: "var(--lm-ink)", color: "var(--lm-paper)" }}><Link2 size={13} />{busy ? "Linking…" : "Link"}</button></div>
    {message && <p role={message.error ? "alert" : "status"} className="text-xs md:col-span-4" style={{ color: message.error ? "var(--lm-coral)" : "var(--lm-text-secondary)" }}>{message.text}</p>}
  </form>;
}

function AddCostume({ ownerUserId, code }: { ownerUserId: string; code: string }) {
  const save = useMutation(api.characters.saveCostume);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <form onSubmit={async (event) => {
    event.preventDefault(); if (busy || !name.trim()) return; setBusy(true); setError("");
    try { await save({ ownerUserId, character: code, name }); setName(""); } catch (err) { setError(errorText(err, "Could not add the costume.")); } finally { setBusy(false); }
  }} className="flex min-h-40 flex-col justify-center gap-2 rounded-[12px] border border-dashed p-3" style={{ borderColor: "var(--lm-border-strong)" }}>
    <span className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>Next costume code is issued on save</span>
    <input aria-label="New costume name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Black lacquer gown" className={field} style={fieldStyle} />
    <button type="submit" disabled={busy || !name.trim()} className="inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-bold uppercase tracking-[0.08em] disabled:opacity-50" style={{ ...mono, ...fieldStyle }}><Plus size={13} />{busy ? "Adding…" : "Add costume"}</button>
    {error && <p role="alert" className="text-[11px]" style={{ color: "var(--lm-coral)" }}>{error}</p>}
  </form>;
}

function EditCharacter({ ownerUserId, character, onDone }: { ownerUserId: string; character: Character; onDone: () => void }) {
  const update = useMutation(api.characters.updateCharacter);
  const [name, setName] = useState(character.name);
  const [alias, setAlias] = useState(character.alias ?? "");
  const [role, setRole] = useState(character.role ?? "");
  const [lane, setLane] = useState(character.lane ?? "");
  const [status, setStatus] = useState<CharacterStatus>(character.status);
  const [nameTag, setNameTag] = useState(character.nameTag ?? "");
  const [otherNames, setOtherNames] = useState(character.otherNames.join(", "));
  const [notes, setNotes] = useState(character.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    try {
      await update({
        ownerUserId, character: character.code, expectedRevision: character.revision, name, alias: alias || null, role: role || null,
        lane: (lane || null) as Character["lane"] | null, status, nameTag: nameTag || null, notes: notes || null,
        otherNames: otherNames.split(",").map((value) => value.trim()).filter(Boolean),
      });
      onDone();
    } catch (err) { setError(errorText(err, "Could not save.")); } finally { setBusy(false); }
  };
  return <form onSubmit={submit} className="mt-5 grid gap-3 rounded-xl border p-4 sm:grid-cols-2 lg:grid-cols-4" style={{ ...fieldStyle, background: "var(--lm-surface-1)" }}>
    <label className="grid gap-1 text-xs">Name<input required maxLength={80} className={field} style={fieldStyle} value={name} onChange={(e) => setName(e.target.value)} /></label>
    <label className="grid gap-1 text-xs">Alias<input maxLength={120} className={field} style={fieldStyle} value={alias} onChange={(e) => setAlias(e.target.value)} /></label>
    <label className="grid gap-1 text-xs">Story role<input maxLength={120} className={field} style={fieldStyle} value={role} onChange={(e) => setRole(e.target.value)} /></label>
    <label className="grid gap-1 text-xs">Status<select className={field} style={fieldStyle} value={status} onChange={(e) => setStatus(e.target.value as CharacterStatus)}>
      {CHARACTER_STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
    <label className="grid gap-1 text-xs">Lane<select className={field} style={fieldStyle} value={lane} onChange={(e) => setLane(e.target.value)}>
      <option value="">Not set</option>{CHARACTER_LANES.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
    <label className="grid gap-1 text-xs">Name tag<input maxLength={80} className={field} style={fieldStyle} value={nameTag} onChange={(e) => setNameTag(e.target.value)} /></label>
    <label className="grid gap-1 text-xs sm:col-span-2">Other names, comma separated<input className={field} style={fieldStyle} value={otherNames} onChange={(e) => setOtherNames(e.target.value)} /></label>
    <label className="grid gap-1 text-xs sm:col-span-2 lg:col-span-4">Notes<textarea rows={4} maxLength={20000} className={field} style={fieldStyle} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
    <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-4">
      <button type="submit" disabled={busy || !name.trim()} className="rounded-md px-4 py-2 text-xs font-bold uppercase tracking-[0.08em] disabled:opacity-50" style={{ ...mono, background: "var(--lm-coral)", color: "var(--lm-paper)" }}>{busy ? "Saving…" : `Save revision ${character.revision + 1}`}</button>
      {error && <p role="alert" className="text-sm" style={{ color: "var(--lm-coral)" }}>{error}</p>}
    </div>
  </form>;
}
