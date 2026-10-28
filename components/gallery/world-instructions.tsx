"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { Check, Copy, Pencil } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { buildWorldAgentSections, joinAgentSections, type AgentDocSection, type WorldContext } from "@/lib/world-agent-doc";
import type { WorldRef } from "@/lib/world-doc-markdown";
import { WORLD_DOC_LIMITS, WORLD_DOC_MAIN } from "@/lib/world-docs";
import { CopyChip, Micro, RADIUS, display, mono, plural } from "./moodboards-view";
import { DocEditor, beginDocEdit, useStoredDraftPaths, useWorldDocSave, type DocEdit, type WorldDoc } from "./world-doc-editor";
import { WorldDocLinksProvider, useWorldDocLinks } from "./world-doc-prose";
import { WorldDocFiles } from "./world-docs-tab";
import { ActorBadge, MonoBadge, OpBadge, WorldBoundary, fullStamp, timeAgo } from "./world-ui";
import { WorldViewPanes, WorldViewToggle, useWorldViewMode } from "./world-view-mode";

export type WorldInstructionsJump = "moodboards" | "journal";

type PanelProps = {
  ownerUserId: string;
  worldKey: string;
  worldName: string;
  /** Opens another tab of this world (Moodboards, Journal). */
  onJump?: (tab: WorldInstructionsJump) => void;
  /** Opens a story:, asset: or moodboard: reference from a doc. */
  onOpenRef?: (ref: WorldRef) => void;
};

/**
 * A world's instructions, two ways. HUMAN: the world laid out for reading,
 * with WORLD.md, LEARNINGS.md and docs editable in place. AGENT: exactly what
 * an agent receives from open_world, as one raw markdown document, with each
 * file editable as raw text. M or the floating toggle switches.
 */
export function WorldInstructionsPanel(props: PanelProps) {
  return <WorldBoundary resetKey={props.worldKey} what="World instructions">
    <ConnectedPanel {...props} />
  </WorldBoundary>;
}

function ConnectedPanel(props: PanelProps) {
  const { isAuthenticated } = useConvexAuth();
  const args = isAuthenticated ? { ownerUserId: props.ownerUserId, world: props.worldKey } : "skip";
  // The same query open_world runs, with its default journal length.
  const context = useQuery(api.worlds.getWorldContext, args);
  const docs = useQuery(api.worlds.listWorldDocs, args);
  return <WorldInstructionsView {...props} context={context} docs={docs} />;
}

export function WorldInstructionsView({ ownerUserId, worldKey, worldName, onJump, onOpenRef, context, docs }: PanelProps & {
  context: WorldContext | undefined;
  docs: WorldDoc[] | undefined;
}) {
  const { mode, setMode } = useWorldViewMode();
  const links = useWorldDocLinks(context, ownerUserId, onOpenRef);
  const main = docs?.find((doc) => doc.path === WORLD_DOC_MAIN);
  const fileCount = docs?.filter((doc) => doc.path.startsWith("docs/")).length;

  return <section className="px-4 pb-28 pt-4 md:px-6 md:pb-32" style={{ color: "var(--lm-text-primary)" }}>
    <header className="mb-6 grid gap-3 border-b pb-6" style={{ borderColor: "var(--lm-border)" }}>
      <div className="flex flex-wrap items-center gap-2">
        <Micro color="var(--lm-coral)">World instructions</Micro>
        <span aria-hidden className="h-px w-6" style={{ background: "var(--lm-border-strong)" }} />
        <Micro>{mode === "human" ? "Human view" : "Agent view · open_world"}</Micro>
      </div>
      <h2 className="text-4xl font-black uppercase leading-[0.92] tracking-tight md:text-6xl" style={display}>{context?.world.name ?? worldName}</h2>
      {context?.world.description && <p className="max-w-2xl text-[14px] leading-6" style={{ color: "var(--lm-text-secondary)" }}>{context.world.description}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        <CopyChip value={worldKey} title="Copy the world key agents pass to open_world" />
        {main
          ? <MonoBadge title={fullStamp(main.updatedAt)}>WORLD.md r{main.revision} · {timeAgo(main.updatedAt)}</MonoBadge>
          : docs && <MonoBadge color="var(--lm-coral)">WORLD.md not written</MonoBadge>}
        {main && <ActorBadge actor={main.updatedBy} />}
        {fileCount !== undefined && <MonoBadge title="docs/*.md files / cap">{fileCount} / {WORLD_DOC_LIMITS.docs} docs</MonoBadge>}
      </div>
    </header>

    <WorldDocLinksProvider value={links}>
      <WorldViewPanes mode={mode}
        human={<HumanView ownerUserId={ownerUserId} worldKey={worldKey} worldName={worldName} context={context} docs={docs} onJump={onJump} />}
        agent={<AgentView ownerUserId={ownerUserId} worldKey={worldKey} worldName={worldName} context={context} docs={docs} />} />
    </WorldDocLinksProvider>

    <WorldViewToggle mode={mode} onChange={setMode} />
  </section>;
}

/* ── HUMAN ──────────────────────────────────────────────────────────────── */

type ViewProps = { ownerUserId: string; worldKey: string; worldName: string; context: WorldContext | undefined; docs: WorldDoc[] | undefined };

function HumanView({ ownerUserId, worldKey, worldName, context, docs, onJump }: ViewProps & { onJump?: (tab: WorldInstructionsJump) => void }) {
  return <div className="pb-6">
    {context && <Stats context={context} />}
    <WorldDocFiles ownerUserId={ownerUserId} worldKey={worldKey} worldName={worldName} rows={docs} />
    {context === undefined ? <div className="mt-14"><Micro>Opening the world…</Micro></div> : <WorldMap context={context} onJump={onJump} />}
  </div>;
}

function Stats({ context }: { context: WorldContext }) {
  const stats: Array<[string, number]> = [
    ["Pieces at root", context.world.rootCount],
    ["Shelves", context.shelves.length],
    ["Storybooks", context.storybooks.length],
    ["Moodboards", context.moodboards.length],
    ["Profiles", context.profiles.length],
    ["Characters", context.characters.length],
  ];
  return <dl className="-mt-6 mb-8 grid grid-cols-3 border-b sm:grid-cols-6" style={{ borderColor: "var(--lm-border)" }}>
    {stats.map(([label, value]) => <div key={label}
      className="border-l px-3 py-3 max-sm:[&:nth-child(3n+1)]:border-l-0 max-sm:[&:nth-child(3n+1)]:pl-0 max-sm:[&:nth-child(n+4)]:border-t sm:first:border-l-0 sm:first:pl-0"
      style={{ borderColor: "var(--lm-border)" }}>
      <dt className="text-[9px] font-bold uppercase tracking-[0.16em]" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>{label}</dt>
      <dd className="mt-1 text-2xl font-black leading-none tracking-tight" style={display}>{value.toLocaleString("en-GB")}</dd>
    </div>)}
  </dl>;
}

function MapSection({ label, count, action, children, wide }: { label: string; count?: number; action?: ReactNode; children: ReactNode; wide?: boolean }) {
  return <section className={`min-w-0 ${wide ? "xl:col-span-2" : ""}`}>
    <div className="mb-3 flex items-baseline gap-2 border-t pt-4" style={{ borderColor: "var(--lm-ink)" }}>
      <h3 className="text-lg font-black uppercase leading-none tracking-tight" style={display}>{label}</h3>
      {count !== undefined && <span className="text-[11px] font-bold" style={{ ...mono, color: "var(--lm-text-ghost)" }}>{count}</span>}
      <span className="ml-auto">{action}</span>
    </div>
    {children}
  </section>;
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-[12px] leading-5" style={{ color: "var(--lm-text-tertiary)" }}>{children}</p>;
}

function JumpLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick}
    className="text-[10px] font-bold uppercase tracking-[0.12em] transition-colors hover:text-[var(--lm-text-primary)]"
    style={{ ...mono, color: "var(--lm-text-tertiary)" }}>{children} →</button>;
}

// Style tags, codes and keys are code: they keep their case.
function Code({ children, color }: { children: ReactNode; color?: string }) {
  return <span className="text-[11px] font-semibold" style={{ ...mono, color: color ?? "var(--lm-text-secondary)" }}>{children}</span>;
}

function WorldMap({ context, onJump }: { context: WorldContext; onJump?: (tab: WorldInstructionsJump) => void }) {
  const shelfGroups = useMemo(() => {
    const groups = new Map<string, WorldContext["shelves"]>();
    for (const shelf of [...context.shelves].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name))) {
      const key = shelf.group ?? "Other";
      groups.set(key, [...(groups.get(key) ?? []), shelf]);
    }
    return [...groups.entries()].sort(([a], [b]) => (a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b)));
  }, [context.shelves]);

  return <div className="mt-14 grid gap-x-10 gap-y-12 xl:grid-cols-2">
    <MapSection label="Styles & locks" count={context.styles.length} wide>
      {context.styles.length === 0 && context.otherLocks.length === 0 ? <Empty>No style has a moodboard yet.</Empty>
        : <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {context.styles.map((style) => <div key={style.styleTag} className="grid content-start gap-2 border p-4" style={{ borderRadius: RADIUS, borderColor: "var(--lm-border-strong)", background: "var(--lm-surface-0)" }}>
            <div className="flex flex-wrap items-center gap-1.5">
              <Code color="var(--lm-text-primary)">{style.styleTag}</Code>
              <MonoBadge>{plural(style.moodboards, "board")}</MonoBadge>
            </div>
            {style.branch && <p className="text-[13px] font-black uppercase tracking-tight" style={display}>{style.branch}</p>}
            {style.locks.length === 0 ? <Micro color="var(--lm-text-ghost)">No lock</Micro>
              : <ul className="grid gap-1">
                {style.locks.map((lock) => <li key={lock.id} className="flex items-baseline gap-2 text-[12px] leading-5">
                  <span aria-hidden className="h-1.5 w-1.5 shrink-0 translate-y-[-1px]" style={{ borderRadius: "999px", background: lock.status === "ready" ? "var(--lm-coral)" : "var(--lm-text-ghost)" }} />
                  <span className="min-w-0 flex-1" style={{ color: "var(--lm-text-secondary)" }}>{lock.title}</span>
                  <Code color="var(--lm-text-ghost)">r{lock.revision}</Code>
                </li>)}
              </ul>}
          </div>)}
          {context.otherLocks.length > 0 && <div className="grid content-start gap-2 border border-dashed p-4 sm:col-span-1 lg:col-span-2" style={{ borderRadius: RADIUS, borderColor: "var(--lm-border)" }}>
            <Micro>Other locks</Micro>
            <ul className="grid gap-1">
              {context.otherLocks.map((lock) => <li key={lock.id} className="text-[12px] leading-5" style={{ color: "var(--lm-text-tertiary)" }}>
                {lock.title} {lock.styleTag && <Code color="var(--lm-text-ghost)">{lock.styleTag}</Code>}
              </li>)}
            </ul>
          </div>}
        </div>}
    </MapSection>

    <MapSection label="Moodboards" count={context.moodboards.length} action={onJump && <JumpLink onClick={() => onJump("moodboards")}>Open boards</JumpLink>}>
      {context.moodboards.length === 0 ? <Empty>No moodboards in this world yet.</Empty>
        : <ul className="grid">
          {context.moodboards.map((board) => {
            const inSync = board.sync === "in sync";
            return <li key={board.id} className="grid gap-1.5 border-b py-3 last:border-b-0" style={{ borderColor: "var(--lm-border)" }}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 truncate text-[14px] font-black uppercase tracking-tight" style={display}>{board.name}</span>
                <MonoBadge>{board.itemCount} items</MonoBadge>
                {board.status === "archived" && <MonoBadge>archived</MonoBadge>}
                <span className="ml-auto">{board.profileFlag ? <CopyChip value={board.profileFlag} strong title="Copy the Midjourney flag" /> : <Micro color="var(--lm-text-ghost)">No code</Micro>}</span>
              </div>
              <p className="flex flex-wrap items-center gap-x-2 text-[11px]" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>
                <span>{board.collection}</span>
                {board.styleTag && <><span aria-hidden>·</span><span style={{ color: "var(--lm-text-secondary)" }}>{board.styleTag}</span></>}
                <span aria-hidden>·</span>
                <span style={{ color: inSync ? "var(--lm-success-text, var(--lm-text-secondary))" : board.sync.startsWith("gallery changed") ? "var(--lm-coral)" : undefined }}>{board.sync}</span>
              </p>
            </li>;
          })}
        </ul>}
    </MapSection>

    <MapSection label="Midjourney profiles" count={context.profiles.length}>
      {context.profiles.length === 0 ? <Empty>No profile is linked to this world. mj_profiles save links one with its role.</Empty>
        : <ul className="grid">
          {context.profiles.map((profile) => <li key={`${profile.id}-${profile.role}`} className="grid gap-1.5 border-b py-3 last:border-b-0" style={{ borderColor: "var(--lm-border)" }}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[14px] font-black uppercase tracking-tight" style={display}>{profile.name}</span>
              <span className="ml-auto"><CopyChip value={profile.flag} strong title="Copy the --profile flag" /></span>
            </div>
            <p className="text-[12px] leading-5" style={{ color: "var(--lm-text-secondary)" }}>
              {profile.role}{profile.styleTag && <> · <Code>{profile.styleTag}</Code></>}
            </p>
          </li>)}
        </ul>}
    </MapSection>

    <MapSection label="Shelves" count={context.shelves.length}>
      {shelfGroups.length === 0 ? <Empty>No shelves yet.</Empty>
        : <div className="grid gap-4">
          {shelfGroups.map(([group, shelves]) => <div key={group}>
            <Micro>{group}</Micro>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {shelves.map((shelf) => <li key={shelf.id} className="inline-flex items-center gap-2 border px-2.5 py-1.5" style={{ borderRadius: RADIUS, borderColor: "var(--lm-border)" }}>
                <span className="text-[12px] font-bold uppercase tracking-tight" style={display}>{shelf.name}</span>
                <Code color="var(--lm-text-ghost)">{shelf.count}</Code>
              </li>)}
            </ul>
          </div>)}
        </div>}
    </MapSection>

    <MapSection label="Storybooks" count={context.storybooks.length}>
      {context.storybooks.length === 0 ? <Empty>No storybooks yet.</Empty>
        : <ul className="grid">
          {context.storybooks.map((book) => <li key={book.id} className="border-b py-3 last:border-b-0" style={{ borderColor: "var(--lm-border)" }}>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-[14px] font-black uppercase tracking-tight" style={display}>{book.name}</span>
              <Code color="var(--lm-text-ghost)">{plural(book.count, "frame")}</Code>
            </div>
            {book.stories.length > 0 && <ul className="mt-1.5 grid gap-0.5">
              {book.stories.map((story) => <li key={story.id} className="flex items-baseline gap-2 text-[12px] leading-5" style={{ color: "var(--lm-text-secondary)" }}>
                <span className="min-w-0 flex-1 truncate">{story.title}</span>
                <Code color="var(--lm-text-ghost)">{story.kind} · {story.status}</Code>
              </li>)}
            </ul>}
          </li>)}
        </ul>}
    </MapSection>

    <MapSection label="Characters" count={context.characters.length}>
      {context.characters.length === 0 ? <Empty>No characters registered in this world.</Empty>
        : <ul className="grid gap-1.5 sm:grid-cols-2">
          {context.characters.map((character) => <li key={character.id} className="flex items-center gap-2">
            <CopyChip value={character.code} />
            <span className="min-w-0 truncate text-[13px] font-bold" style={{ color: character.status === "retired" ? "var(--lm-text-ghost)" : "var(--lm-text-primary)" }}>{character.name}</span>
          </li>)}
        </ul>}
    </MapSection>

    <MapSection label="Recent changes" count={context.recentChanges.length} action={onJump && <JumpLink onClick={() => onJump("journal")}>Full journal</JumpLink>}>
      {context.recentChanges.length === 0 ? <Empty>Nothing journaled yet.</Empty>
        : <ol className="grid">
          {context.recentChanges.map((change) => <li key={change.id} className="grid gap-1 border-b py-2.5 last:border-b-0" style={{ borderColor: "var(--lm-border)" }}>
            <div className="flex flex-wrap items-center gap-1.5">
              <ActorBadge actor={change.actor} />
              <OpBadge op={change.op} />
              {change.revertedBy && <MonoBadge color="var(--lm-coral)">undone</MonoBadge>}
              <span className="ml-auto text-[10px]" title={fullStamp(change.at)} style={{ ...mono, color: "var(--lm-text-ghost)" }}>{timeAgo(change.at)}</span>
            </div>
            <p className="text-[12px] leading-[1.45]" style={{ color: change.revertedBy ? "var(--lm-text-ghost)" : "var(--lm-text-secondary)" }}>{change.summary}</p>
          </li>)}
        </ol>}
    </MapSection>
  </div>;
}

/* ── AGENT ──────────────────────────────────────────────────────────────── */

// Raw markdown reads in real mono: --lm-font resolves through a theme variable
// Tailwind inlines away, so it falls back to sans.
const rawMono = { fontFamily: 'var(--font-geist-mono), ui-monospace, "SF Mono", Menlo, monospace' } as const;

const copy = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

function CopyAll({ label, text, title }: { label: string; text: string | null; title: string }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" disabled={text === null} title={title}
    onClick={async () => { if (text !== null && await copy(text)) { setCopied(true); setTimeout(() => setCopied(false), 1400); } }}
    className="inline-flex items-center gap-1.5 border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] transition-colors hover:text-[var(--lm-text-primary)] disabled:opacity-40"
    style={{ ...mono, borderRadius: RADIUS, borderColor: copied ? "var(--lm-coral)" : "var(--lm-border-strong)", color: copied ? "var(--lm-coral)" : "var(--lm-text-tertiary)" }}>
    {copied ? <Check size={11} aria-hidden /> : <Copy size={11} aria-hidden />}{copied ? "Copied" : label}
  </button>;
}

function AgentView({ ownerUserId, worldKey, worldName, context, docs }: ViewProps) {
  const sections = useMemo(() => (context ? buildWorldAgentSections(context, docs ?? []) : null), [context, docs]);
  const markdown = sections ? joinAgentSections(sections) : null;
  // What the open_world tool returns, byte for byte.
  const json = context ? JSON.stringify(context) : null;
  const storedDrafts = useStoredDraftPaths(worldKey);

  return <div className="pb-6">
    <article aria-label={`${worldName} as an agent reads it`}
      className="mx-auto w-full max-w-[960px] border-x px-4 py-6 text-[13px] leading-[1.75] sm:px-8 lg:px-12"
      style={{ ...rawMono, borderColor: "var(--lm-border)" }}>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3 border-b pb-3" style={{ borderColor: "var(--lm-border)" }}>
        <span className="text-[10px] uppercase tracking-[0.22em]" style={{ color: "var(--lm-text-tertiary)" }}>{worldKey}/open_world.md</span>
        <span className="flex flex-wrap items-center gap-1.5">
          {markdown && <span className="mr-1 text-[10px] uppercase tracking-[0.22em]" style={{ color: "var(--lm-text-ghost)" }}>{markdown.length.toLocaleString("en-GB")} chars</span>}
          <CopyAll label="Copy all" text={markdown} title="Copy the whole document as markdown" />
          <CopyAll label="JSON" text={json} title="Copy the raw open_world result" />
        </span>
      </div>

      {sections === null ? <p style={{ color: "var(--lm-text-tertiary)" }}>Loading open_world…</p>
        : sections.map((section, index) => <Fragment key={section.id}>
          {index > 0 && <div aria-hidden className="my-10 select-none" style={{ color: "var(--lm-text-ghost)" }}>---</div>}
          {section.docPath
            ? <AgentDocBlock ownerUserId={ownerUserId} worldKey={worldKey} worldName={worldName} section={section}
              live={docs?.find((doc) => doc.path === section.docPath) ?? null} loading={docs === undefined}
              hasDraft={storedDrafts.includes(section.docPath)} />
            : index === 0 ? <RawMarkdown text={section.text} />
              : <AgentSection text={section.text} />}
        </Fragment>)}

      <p className="mt-10 border-t pt-4 text-[10px] uppercase tracking-[0.22em]" style={{ borderColor: "var(--lm-border)", color: "var(--lm-text-ghost)" }}>
        What an agent receives · press M for human
      </p>
    </article>
  </div>;
}

/** A section's first line as a header strip, so each block reads as its own part. */
function SectionHead({ line, meta, action, sticky }: { line: string; meta?: string; action?: ReactNode; sticky?: boolean }) {
  return <header className={`z-10 -mx-2 mb-4 flex items-start gap-3 border-t px-2 pb-2 pt-3 ${sticky ? "sticky top-0 backdrop-blur-md" : ""}`}
    style={{ borderColor: "var(--lm-ink)", background: sticky ? "color-mix(in srgb, var(--lm-paper) 88%, transparent)" : undefined }}>
    <div className="min-w-0 flex-1">
      <RawLine line={line} />
      {meta && <div className="text-[11px] leading-[1.6]" style={{ color: "var(--lm-text-ghost)" }}>{meta}</div>}
    </div>
    {action}
  </header>;
}

function AgentSection({ text }: { text: string }) {
  const [head, ...rest] = text.split("\n");
  return <section>
    <SectionHead line={head} />
    <RawMarkdown text={rest.join("\n").replace(/^\n+/, "")} />
  </section>;
}

/** One file of the world, raw. Edit opens the same editor HUMAN uses. */
function AgentDocBlock({ ownerUserId, worldKey, worldName, section, live, loading, hasDraft }: {
  ownerUserId: string; worldKey: string; worldName: string; section: AgentDocSection; live: WorldDoc | null; loading: boolean; hasDraft: boolean;
}) {
  const path = section.docPath!;
  const [edit, setEdit] = useState<DocEdit | null>(null);
  const { save, saving, error, setError } = useWorldDocSave(ownerUserId, worldKey);
  const [head, meta, ...rest] = section.text.split("\n");

  const start = () => {
    setError(null);
    setEdit(beginDocEdit({ worldKey, worldName, path, live }));
  };

  return <section>
    <SectionHead line={head} meta={meta} sticky={!edit}
      action={!edit && <span className="mt-[2px] flex shrink-0 items-center gap-1.5">
        {hasDraft && <MonoBadge color="var(--lm-coral)" title="Unsaved draft kept in this browser">draft</MonoBadge>}
        <button type="button" onClick={start} disabled={loading}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] transition-colors hover:bg-[var(--lm-surface-2)] hover:text-[var(--lm-text-primary)] disabled:opacity-40"
          style={{ ...mono, borderRadius: RADIUS, color: "var(--lm-text-tertiary)", border: "1px solid var(--lm-border)" }}
          aria-label={`Edit ${path}`}>
          <Pencil size={10} aria-hidden />{hasDraft ? "Resume" : live ? "Edit" : "Write"}
        </button>
      </span>} />
    {edit
      ? <DocEditor worldKey={worldKey} path={path} mode={edit} setMode={setEdit} live={live} saving={saving} error={error}
        onSave={() => void save(path, edit).then((ok) => { if (ok) setEdit(null); })}
        onCancel={() => { setEdit(null); setError(null); }} />
      : <RawMarkdown text={rest.join("\n").replace(/^\n+/, "")} />}
  </section>;
}

/* ── Raw markdown: every character as written, syntax tinted ─────────────── */

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[[^\]\n]+\]\([^)\s]+\))|(<!--.*?-->)/g;

function Punct({ children }: { children: ReactNode }) {
  return <span style={{ color: "var(--lm-text-ghost)" }}>{children}</span>;
}

function Inline({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    const [token, codeSpan, strong, link, comment] = match;
    if (codeSpan) {
      parts.push(<Fragment key={at}><Punct>`</Punct><span style={{ color: "var(--lm-coral)" }}>{codeSpan.slice(1, -1)}</span><Punct>`</Punct></Fragment>);
    } else if (strong) {
      parts.push(<Fragment key={at}><Punct>**</Punct><span className="font-bold" style={{ color: "var(--lm-text-primary)" }}>{strong.slice(2, -2)}</span><Punct>**</Punct></Fragment>);
    } else if (link) {
      const split = link.indexOf("](");
      parts.push(<Fragment key={at}>
        <Punct>[</Punct><span className="px-0.5" style={{ background: "var(--lm-surface-2)", color: "var(--lm-text-primary)" }}>{link.slice(1, split)}</span><Punct>](</Punct>
        <span style={{ color: "var(--lm-text-tertiary)" }}>{link.slice(split + 2, -1)}</span><Punct>)</Punct>
      </Fragment>);
    } else if (comment) {
      parts.push(<span key={at} style={{ color: "var(--lm-text-ghost)" }}>{comment}</span>);
    } else {
      parts.push(token);
    }
    last = at + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function RawLine({ line }: { line: string }) {
  if (line === "") return <div aria-hidden className="h-[1.7em]" />;
  const heading = /^(#{1,6})(\s+)(.*)$/.exec(line);
  if (heading) {
    const level = heading[1].length;
    return <div className={`font-bold ${level === 1 ? "text-[16px]" : level === 2 ? "text-[14px]" : ""} ${level >= 2 && level <= 3 ? "pt-3 [&:first-child]:pt-0" : ""}`} style={{ color: "var(--lm-text-primary)" }}>
      <span style={{ color: level <= 2 ? "var(--lm-coral)" : "var(--lm-text-ghost)" }}>{heading[1]}</span>{heading[2]}<Inline text={heading[3]} />
    </div>;
  }
  const quote = /^(\s*)(>\s?)(.*)$/.exec(line);
  if (quote) return <div style={{ color: "var(--lm-text-secondary)" }}>{quote[1]}<Punct>{quote[2]}</Punct><Inline text={quote[3]} /></div>;
  const item = /^(\s*)([-*+]|\d+[.)])(\s+)(.*)$/.exec(line);
  if (item) {
    return <div className="flex" style={{ color: "var(--lm-text-secondary)" }}>
      <span className="shrink-0 whitespace-pre">{item[1]}<Punct>{item[2]}</Punct>{item[3]}</span>
      <span className="min-w-0"><Inline text={item[4]} /></span>
    </div>;
  }
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) return <div style={{ color: "var(--lm-text-ghost)" }}>{line}</div>;
  // Table rows wrap with a hanging indent; the pipes stay faint.
  if (/^\s*\|/.test(line)) {
    return <div style={{ color: "var(--lm-text-secondary)", paddingLeft: "2ch", textIndent: "-2ch" }}>
      {line.split(/(\|)/).map((part, at) => (part === "|" ? <Punct key={at}>|</Punct> : <Inline key={at} text={part} />))}
    </div>;
  }
  return <div style={{ color: "var(--lm-text-secondary)" }}><Inline text={line} /></div>;
}

/** Markdown shown as written: visible #, >, -, **, `, [label](url). */
export function RawMarkdown({ text }: { text: string }) {
  const rows: ReactNode[] = [];
  let fenced = false;
  text.split("\n").forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      rows.push(<div key={index} style={{ color: "var(--lm-text-ghost)" }}>{line}</div>);
      return;
    }
    rows.push(fenced
      ? <div key={index} className="whitespace-pre-wrap px-2" style={{ color: "var(--lm-text-primary)", background: "var(--lm-surface-1)" }}>{line || " "}</div>
      : <RawLine key={index} line={line} />);
  });
  return <div className="max-w-[92ch] whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{rows}</div>;
}
