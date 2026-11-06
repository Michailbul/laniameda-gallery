"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CopyChip, Micro, RADIUS, display, mono } from "@/components/inbox/inbox-ui";
import { timeAgo } from "@/components/gallery/world-ui";
import {
  ADAPTATION_STATUS_LABEL, INSPIRATION_URL_PATH, PLATFORM_LABEL, PRESERVATION_LABEL,
} from "@/lib/inspiration";
import { Chip, DecisionButton, HAIR, HonestMedia, RULE, Title, plural, usd, useIntent } from "./parts";

// /inspiration/<source>: one reference and every project take made from it.
// Phone first: the source on top, each take below it with its own version
// timeline, the reviewed version always named on every control. Desktop
// puts source and take side by side. Keys: 1 keep source, 2 drop / restore
// source, C note on the source. Approve, change, promote have no key: they
// are deliberate taps with their consequence written beside them.

type Detail = NonNullable<FunctionReturnType<typeof api.inspiration.getInspiration>>;
type Adaptation = Detail["adaptations"][number];
type Version = Adaptation["versions"][number];

function Section({ children, label, id }: { children: ReactNode; label: string; id?: string }) {
  return <section id={id} aria-label={label} className="pt-5" style={{ borderTop: RULE }}>{children}</section>;
}

function Notice({ text, tone = "ok" }: { text?: string; tone?: "ok" | "error" }) {
  if (!text) return null;
  return <p role="status" className="mt-2 text-[12px] leading-5" style={{ color: tone === "error" ? "var(--lm-status-error)" : "var(--lm-text-secondary)" }}>{text}</p>;
}

function NoteBox({ placeholder, onSave, hint, autoFocusOnHash }: { placeholder: string; onSave: (body: string, key: string) => Promise<unknown>; hint: string; autoFocusOnHash?: boolean }) {
  const [body, setBody] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const intent = useIntent(useCallback((key: string) => onSave(body, key), [body, onSave]));
  useEffect(() => { if (autoFocusOnHash && typeof window !== "undefined" && window.location.hash === "#note") ref.current?.focus(); }, [autoFocusOnHash]);
  return <div>
    <textarea ref={ref} value={body} onChange={(event) => { setBody(event.target.value); if (intent.status !== "pending") intent.reset(); }} rows={3} maxLength={4000}
      placeholder={placeholder} data-note-box
      className="block w-full resize-y px-3 py-2.5 text-[15px] leading-6 outline-none focus-visible:outline-2"
      style={{ borderRadius: RADIUS, border: "1px solid var(--lm-border-strong)", background: "var(--lm-surface-1)", color: "var(--lm-text-primary)" }} />
    <div className="mt-2 flex flex-wrap items-center gap-3">
      <DecisionButton tone="ink" busy={intent.status === "pending"} disabled={!body.trim()} onClick={async () => { if (await intent.run()) setBody(""); }}>Save note</DecisionButton>
      <span className="text-[11px] leading-4" style={{ color: "var(--lm-text-tertiary)" }}>{hint}</span>
    </div>
    {intent.status === "pending" && <Notice text="Saving…" />}
    {intent.status === "done" && <Notice text="Saved. Agents read it before they use this." />}
    <Notice text={intent.error} tone="error" />
  </div>;
}

function NoteList({ notes }: { notes: Array<{ id: string; body: string; author: string; createdAt: number; label?: string }> }) {
  if (notes.length === 0) return null;
  return <ul className="mb-3 flex flex-col gap-2">{notes.map((note) => <li key={note.id} className="px-3 py-2.5" style={{ borderRadius: RADIUS, background: note.author === "owner" ? "var(--lm-surface-1)" : "transparent", border: HAIR }}>
    <p className="whitespace-pre-wrap text-[15px] leading-6">{note.body}</p>
    <div className="mt-1 flex flex-wrap gap-2">
      <Micro>{note.author === "owner" ? "You" : note.author.replace(/^agent:/, "")}</Micro>
      {note.label && <Micro>{note.label}</Micro>}
      <Micro color="var(--lm-text-ghost)">{timeAgo(note.createdAt)}</Micro>
    </div>
  </li>)}</ul>;
}

function Disclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return <details className="group mt-3" style={{ borderTop: HAIR }}>
    <summary className="flex min-h-[40px] cursor-pointer list-none items-center justify-between text-[10px] font-bold uppercase tracking-[0.14em]" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>
      {summary}<span aria-hidden className="transition-transform group-open:rotate-45">+</span>
    </summary>
    <div className="pb-3">{children}</div>
  </details>;
}

/* ── The source ─────────────────────────────────────────────────────────── */

function SourceMedia({ detail }: { detail: Detail }) {
  if (detail.kind === "text") {
    return <blockquote className="px-4 py-4 text-[17px] leading-7" style={{ borderLeft: "3px solid var(--lm-coral)", background: "var(--lm-surface-1)", borderRadius: RADIUS }}>
      <p className="whitespace-pre-wrap">{detail.text ?? detail.story?.body ?? "No text saved."}</p>
      {detail.story && <footer className="mt-2"><Micro>From story · {detail.story.title}</Micro></footer>}
    </blockquote>;
  }
  const total = detail.assets.length + detail.privateMedia.length;
  if (total === 0) return <HonestMedia media={{}} />;
  const width = total === 1 ? "100%" : "min(78vw, 360px)";
  return <div className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0 [scrollbar-width:thin]">
    {detail.assets.map((asset, index) => <figure key={asset.assetId} className="relative shrink-0 snap-start" style={{ width }}>
      <HonestMedia media={asset.missing ? {} : asset} maxHeight="62vh" priority={index === 0} alt={`${detail.title}, ${index + 1} of ${total}`} />
      <figcaption className="pointer-events-none absolute left-1.5 top-1.5 flex gap-1">
        {total > 1 && <Chip onPicture>{index + 1}/{total}</Chip>}
        {asset.missing && <Chip tone="coral">Missing</Chip>}
      </figcaption>
      <span className="absolute bottom-1.5 right-1.5"><CopyChip value={`asset:${asset.assetId}`} label="" /></span>
    </figure>)}
    {/* Private originals load only here, through the signed-in route; never cached. */}
    {detail.privateMedia.map((media, index) => <figure key={media.mediaId} className="relative shrink-0 snap-start" style={{ width }}>
      {media.kind === "audio"
        ? <div className="flex w-full flex-col justify-end gap-3 p-3" style={{ aspectRatio: "4 / 3", borderRadius: RADIUS, background: "var(--lm-surface-1)", border: "1px solid var(--lm-border)" }}>
          <Micro>{media.label ?? "Voice note"}</Micro>
          <audio src={media.url} controls preload="none" className="w-full" aria-label={media.label ?? "Voice note"} />
        </div>
        : <HonestMedia media={{ url: media.url, kind: media.kind, width: media.width, height: media.height }} maxHeight="62vh"
          priority={detail.assets.length === 0 && index === 0} alt={media.label ?? `${detail.title}, private original`} />}
      <figcaption className="pointer-events-none absolute left-1.5 top-1.5 flex gap-1">
        {total > 1 && <Chip onPicture>{detail.assets.length + index + 1}/{total}</Chip>}
        <Chip tone="ink">Private</Chip>
      </figcaption>
      <span className="absolute bottom-1.5 right-1.5"><CopyChip value={`private:${media.mediaId}`} label="" /></span>
    </figure>)}
  </div>;
}

function SourceBlock({ ownerUserId, detail }: { ownerUserId: string; detail: Detail }) {
  const review = useMutation(api.inspiration.reviewInspirationSource);
  const note = useMutation(api.inspiration.noteInspirationSource);
  const keep = useIntent(useCallback((eventKey: string) => review({
    ownerUserId, sourceId: detail.sourceId, eventKey, action: detail.review === "kept" ? "unkeep" : "keep", expectedRevision: detail.revision,
  }), [detail.review, detail.revision, detail.sourceId, ownerUserId, review]));
  const drop = useIntent(useCallback((eventKey: string) => review({
    ownerUserId, sourceId: detail.sourceId, eventKey, action: detail.review === "dropped" ? "recover" : "drop", expectedRevision: detail.revision,
  }), [detail.review, detail.revision, detail.sourceId, ownerUserId, review]));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey || target?.closest("input, textarea, select, [contenteditable=true]")) return;
      if (event.key === "1") { if (detail.review !== "dropped") void keep.run(); }
      else if (event.key === "2") void drop.run();
      else if (event.key.toLowerCase() === "c") document.querySelector<HTMLTextAreaElement>("#note [data-note-box]")?.focus();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const dropped = detail.review === "dropped";
  const saved = detail.assets.filter((asset) => !asset.missing).length + detail.privateMedia.length;
  const partial = detail.expectedCount !== undefined && saved < detail.expectedCount;
  return <>
    <div style={{ opacity: dropped ? 0.5 : 1, filter: dropped ? "grayscale(1)" : undefined }}><SourceMedia detail={detail} /></div>
    <div className="mt-3 flex flex-wrap gap-1.5">
      <Chip>{PLATFORM_LABEL[detail.platform]}</Chip>
      <Chip tone={detail.preservation === "link_only" || detail.preservation === "unavailable" ? "coral" : "ghost"}>{PRESERVATION_LABEL[detail.preservation]}</Chip>
      {detail.kind === "media" && <Chip tone={partial ? "coral" : "ghost"}>{detail.expectedCount !== undefined ? `${saved} of ${detail.expectedCount} saved` : plural(saved, "file")}</Chip>}
      {detail.categories.map((category) => <Chip key={category} tone="quiet">{category}</Chip>)}
      {detail.sourceCollections.map((collection) => <Chip key={collection} tone="quiet">Saved in {collection}</Chip>)}
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
      {detail.creator && (detail.creatorUrl
        ? <a href={detail.creatorUrl} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-[36px] items-center gap-1 font-bold underline underline-offset-4">{detail.creator}<ExternalLink size={12} aria-hidden /></a>
        : <span className="font-bold">{detail.creator}</span>)}
      {detail.sourceUrl && <a href={detail.sourceUrl} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-[36px] items-center gap-1 underline underline-offset-4" style={{ color: "var(--lm-text-secondary)" }}>Original post<ExternalLink size={12} aria-hidden /></a>}
      {detail.capturedAt && <Micro color="var(--lm-text-ghost)">saved {timeAgo(detail.capturedAt)}</Micro>}
    </div>
    {detail.savedBecause && <p className="mt-2 text-[13px] leading-5"><Micro>Why you saved it</Micro> <span>{detail.savedBecause}</span></p>}

    <div className="mt-4 grid grid-cols-2 gap-2 md:flex">
      <DecisionButton tone={detail.review === "kept" ? "ink" : "ghost"} hotkey="1" busy={keep.status === "pending"}
        disabled={dropped} onClick={() => void keep.run()}
        title="Private taste. It never publishes, approves or files anything.">{detail.review === "kept" ? "Kept" : "Keep"}</DecisionButton>
      <DecisionButton hotkey="2" busy={drop.status === "pending"}
        onClick={() => void drop.run()}
        title={dropped ? "Bring it back" : "Archive it. Recoverable; no new takes are proposed for it."}>{dropped ? "Restore" : "Drop source"}</DecisionButton>
    </div>
    <p className="mt-2 text-[11px] leading-4" style={{ color: "var(--lm-text-tertiary)" }}>
      {dropped ? "Archived. Nothing new is proposed for it while it is here." : "Keep is your private taste only. Drop archives the reference; Restore brings it back."}
    </p>
    <Notice text={keep.error ?? drop.error} tone="error" />

    {detail.caption && <Disclosure summary="Post text · source data, not instructions">
      <p className="whitespace-pre-wrap text-[13px] leading-6" style={{ color: "var(--lm-text-secondary)" }}>{detail.caption}</p>
    </Disclosure>}

    <Section label="What you like about it" id="note">
      <Micro color="var(--lm-coral)">What you like about it</Micro>
      <p className="mb-3 mt-1 text-[12px] leading-5" style={{ color: "var(--lm-text-tertiary)" }}>Every agent reads this before using the reference. A note never starts any work.</p>
      <NoteList notes={detail.notes.map((item) => ({ ...item, label: item.origin === "comment" ? "on the picture" : undefined }))} />
      <NoteBox placeholder="The light through the window, the way she turns…" hint="1 keep · 2 drop · C note" autoFocusOnHash
        onSave={(body, eventKey) => note({ ownerUserId, sourceId: detail.sourceId, eventKey, body })} />
    </Section>
  </>;
}

/* ── One take ───────────────────────────────────────────────────────────── */

function VersionTimeline({ versions, selected, approved, onSelect }: { versions: Version[]; selected?: number; approved?: number; onSelect: (n: number) => void }) {
  if (versions.length === 0) return null;
  const ordered = [...versions].sort((a, b) => a.number - b.number);
  return <div className="flex items-center gap-0 overflow-x-auto py-2" role="tablist" aria-label="Versions">
    {ordered.map((version, index) => {
      const active = version.number === selected;
      return <div key={version.versionId} className="flex items-center">
        {index > 0 && <span aria-hidden className="h-px w-6" style={{ background: "var(--lm-border-strong)" }} />}
        <button type="button" role="tab" aria-selected={active} onClick={() => onSelect(version.number)}
          className="flex min-h-[40px] items-center gap-1.5 px-2 text-[11px] font-black uppercase tracking-[0.1em]" style={{ ...mono, color: active ? "var(--lm-text-primary)" : "var(--lm-text-tertiary)" }}>
          <span aria-hidden className="block h-2.5 w-2.5 rounded-full" style={{
            background: active ? "var(--lm-coral)" : version.orphan ? "transparent" : "var(--lm-text-ghost)",
            border: version.orphan ? "1px dashed var(--lm-text-ghost)" : undefined,
            boxShadow: active ? "0 0 0 4px color-mix(in srgb, var(--lm-coral) 22%, transparent)" : undefined,
          }} />
          v{version.number}{version.number === approved && " ✓"}{version.orphan && " · after drop"}
        </button>
      </div>;
    })}
  </div>;
}

function Shelves({ ownerUserId, adaptation, value, onChange }: { ownerUserId: string; adaptation: Adaptation; value?: string; onChange: (id: string) => void }) {
  const shelves = useQuery(api.inspiration.listPromotionShelves, { ownerUserId, adaptationId: adaptation.adaptationId });
  if (!shelves) return <Loader2 size={14} className="animate-spin" aria-label="Loading shelves" />;
  if (shelves.length === 0) return <Notice text="This project has no shelves yet." tone="error" />;
  return <select value={value ?? ""} onChange={(event) => onChange(event.target.value)} aria-label="Shelf"
    className="block min-h-[44px] w-full px-3 text-[14px]" style={{ borderRadius: RADIUS, border: "1px solid var(--lm-border-strong)", background: "var(--lm-surface-1)", color: "var(--lm-text-primary)" }}>
    <option value="" disabled>Choose the shelf…</option>
    {shelves.map((shelf) => <option key={shelf.folderId} value={shelf.folderId}>{shelf.isRoot ? shelf.name : `${shelf.worldName} / ${shelf.name}`}</option>)}
  </select>;
}

function TakeCard({ ownerUserId, detail, adaptation }: { ownerUserId: string; detail: Detail; adaptation: Adaptation }) {
  // A new version arriving moves the view to it; an older pick holds only
  // while the newest version is the one it was made against.
  const [pick, setPick] = useState<{ number: number; newest: number }>();
  const selected = pick && pick.newest === adaptation.currentVersion ? pick.number : adaptation.currentVersion || undefined;
  const setSelected = (number: number) => setPick({ number, newest: adaptation.currentVersion });
  const version = adaptation.versions.find((row) => row.number === selected);
  const [panel, setPanel] = useState<"none" | "change" | "promote">("none");
  const [changeText, setChangeText] = useState("");
  const [outputKey, setOutputKey] = useState<string>();
  const [shelf, setShelf] = useState<string>();

  const reviewAdaptation = useMutation(api.inspiration.reviewInspirationAdaptation);
  const redo = useMutation(api.inspiration.requestInspirationRedo);
  const promote = useMutation(api.inspiration.promoteInspirationOutput);
  const unpromote = useMutation(api.inspiration.undoInspirationPromotion);
  const noteTake = useMutation(api.inspiration.noteInspirationAdaptation);
  const base = { ownerUserId, adaptationId: adaptation.adaptationId, expectedRevision: adaptation.revision };
  const n = version?.number ?? 0;
  // Each decision names the revision and version on screen when tapped.
  const approve = useIntent((eventKey: string) => reviewAdaptation({ ...base, eventKey, action: "approve", version: n }));
  const drop = useIntent((eventKey: string) => reviewAdaptation({ ...base, eventKey, action: adaptation.status === "dropped" ? "recover" : "drop", version: n }));
  const change = useIntent((eventKey: string) => redo({ ...base, eventKey, version: adaptation.currentVersion, body: changeText }));
  const doPromote = useIntent((eventKey: string) => promote({ ...base, eventKey, version: n, outputKey: outputKey ?? "", folderId: shelf as Id<"folders"> }));
  const undo = useIntent((eventKey: string) => unpromote({ ...base, eventKey }));

  const dropped = adaptation.status === "dropped";
  const isApproved = adaptation.approvedVersion !== undefined && adaptation.approvedVersion === n;
  const viewingOld = version !== undefined && version.number !== adaptation.currentVersion;
  const lead = detail.assets.find((asset) => !asset.missing);
  const notes = adaptation.events.filter((event) => event.action === "note" || event.action === "redo")
    .map((event) => ({ id: event.eventId, body: event.body ?? "", author: event.author, createdAt: event.createdAt, label: `${event.action === "redo" ? "Change request" : "Note"} · ${event.version ? `v${event.version}` : "proposal"}` }))
    .filter((note) => note.body);
  const statusTone = adaptation.status === "ready" ? "coral" : adaptation.status === "approved" ? "ink" : "ghost";
  const singleOutput = version?.outputs.length === 1 ? version.outputs[0]!.key : undefined;

  return <article className="pt-5" style={{ borderTop: RULE, opacity: dropped ? 0.6 : 1 }} aria-label={`Take for ${adaptation.targetLabel}`}>
    <header className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <Micro color="var(--lm-coral)">{adaptation.targetLabel}{adaptation.targetStyle ? ` · ${adaptation.targetStyle}` : ""}</Micro>
        <p className="mt-1 text-[16px] font-bold leading-6">{adaptation.intendedUse}</p>
        {adaptation.routingReason && <p className="mt-1 text-[12px] leading-5" style={{ color: "var(--lm-text-tertiary)" }}>{adaptation.routing === "suggestion" ? "Agent's suggestion: " : ""}{adaptation.routingReason}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip tone={statusTone}>{ADAPTATION_STATUS_LABEL[adaptation.status]}</Chip>
        {adaptation.approvedVersion !== undefined && <Chip tone="ink">Approved v{adaptation.approvedVersion}</Chip>}
        {adaptation.promotion && <Chip tone="ink">Promoted v{adaptation.promotion.version}</Chip>}
        <CopyChip value={`inspirationAdaptation:${adaptation.adaptationId}`} label="" />
      </div>
    </header>
    {adaptation.status === "blocked" && adaptation.blockedReason && <p className="mt-2 px-3 py-2 text-[13px] leading-5" style={{ borderRadius: RADIUS, border: "1px solid var(--lm-border-strong)" }}><Micro>Blocked</Micro> {adaptation.blockedReason}</p>}

    <VersionTimeline versions={adaptation.versions} selected={selected} approved={adaptation.approvedVersion} onSelect={setSelected} />

    {!version
      ? <p className="py-6 text-[13px] leading-5" style={{ color: "var(--lm-text-tertiary)" }}>
        {adaptation.status === "changes_requested" ? "Your change is with an agent. The new version appears here." : "Proposed. No version has been made yet."}
      </p>
      : <>
        {/* Source beside the take: stacked on a phone, side by side from md. */}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="hidden md:block">
            <Micro className="mb-1 block">Source</Micro>
            {lead ? <HonestMedia media={lead} maxHeight="70vh" /> : <SourceMedia detail={detail} />}
          </div>
          <div>
            <Micro className="mb-1 block" color="var(--lm-coral)">v{version.number} take{version.orphan ? " · arrived after you dropped it" : ""}</Micro>
            {version.outputs.length > 0 && <div className="flex flex-col gap-2">
              {version.outputs.map((output) => <figure key={output.key} className="relative">
                <HonestMedia media={output} maxHeight="70vh" alt={output.label ?? `Output ${output.key}`} />
                <figcaption className="pointer-events-none absolute left-1.5 top-1.5 flex gap-1">
                  <Chip onPicture>{output.key}{output.label ? ` · ${output.label}` : ""}</Chip>
                  {adaptation.promotion?.version === version.number && adaptation.promotion.outputKey === output.key && <Chip tone="ink">Promoted</Chip>}
                </figcaption>
              </figure>)}
            </div>}
            {version.text && <div className="mt-2 whitespace-pre-wrap px-4 py-3 text-[15px] leading-7" style={{ borderRadius: RADIUS, background: "var(--lm-surface-1)", border: HAIR }}>{version.text}</div>}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {version.model && <Micro>{version.model}{version.provider ? ` · ${version.provider}` : ""}</Micro>}
          {usd(version.costUsd, version.costExact) && <Micro>{usd(version.costUsd, version.costExact)}{version.costExact === false ? " est." : ""}</Micro>}
          {version.costNote && <Micro style={{ textTransform: "none", letterSpacing: 0 }}>{version.costNote}</Micro>}
          <Micro color="var(--lm-text-ghost)">{timeAgo(version.createdAt)} · {version.createdBy.replace(/^agent:/, "")}</Micro>
        </div>
        {version.references.length > 0 && <p className="mt-1 text-[12px] leading-5" style={{ color: "var(--lm-text-tertiary)" }}>Made with {version.references.join(", ")}</p>}
        {(version.prompt || version.notes) && <Disclosure summary="Prompt and agent notes">
          {version.prompt && <div className="flex items-start gap-2"><p className="min-w-0 flex-1 whitespace-pre-wrap text-[12px] leading-5" style={{ ...mono, color: "var(--lm-text-secondary)", textTransform: "none" }}>{version.prompt}</p><CopyChip value={version.prompt} label="Copy" /></div>}
          {version.notes && <p className="mt-2 whitespace-pre-wrap text-[12px] leading-5" style={{ color: "var(--lm-text-tertiary)" }}>{version.notes}</p>}
        </Disclosure>}
      </>}

    {/* Decisions: each says which version it acts on. */}
    <div className="mt-4 flex flex-col gap-2">
      {viewingOld && <p className="text-[12px] leading-5" style={{ color: "var(--lm-coral)" }}>You are looking at v{n}; the newest is v{adaptation.currentVersion}.</p>}
      <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap">
        {version && !version.orphan && !dropped && <DecisionButton tone={isApproved ? "ink" : "coral"} disabled={isApproved} busy={approve.status === "pending"} onClick={() => void approve.run()}
          title="Accepts this version for the review. It does not file, publish or change canon.">{isApproved ? `v${n} approved` : `Approve v${n}`}</DecisionButton>}
        {!dropped && adaptation.status !== "changes_requested" && <DecisionButton onClick={() => setPanel(panel === "change" ? "none" : "change")}>
          {adaptation.currentVersion > 0 ? `Change v${adaptation.currentVersion}` : "Ask for a first take"}</DecisionButton>}
        {isApproved && !adaptation.promotion && version && version.outputs.length > 0 && <DecisionButton tone="ink" onClick={() => { setPanel(panel === "promote" ? "none" : "promote"); setOutputKey(singleOutput); }}>Promote…</DecisionButton>}
        {adaptation.promotion && <DecisionButton busy={undo.status === "pending"} onClick={() => void undo.run()} title="Takes back only the shelf placement this promotion made.">Undo promotion</DecisionButton>}
        <DecisionButton busy={drop.status === "pending"} onClick={() => void drop.run()} title={dropped ? "Bring this take back" : "Archive this take. Recoverable; nothing new is made for this project from this source unless you ask."}>{dropped ? "Restore take" : "Drop take"}</DecisionButton>
      </div>
      {[approve, drop, undo].map((intent, index) => <Notice key={index} text={intent.error} tone="error" />)}
      {adaptation.status === "changes_requested" && adaptation.redoTaskId && <p className="text-[12px] leading-5" style={{ color: "var(--lm-text-secondary)" }}>
        A change is with an agent: <Link href="/tasks" className="underline underline-offset-4">see it in Tasks</Link>. Add notes below; they ride along.
      </p>}

      {panel === "change" && <div className="mt-1 p-3" style={{ borderRadius: RADIUS, border: "1px solid var(--lm-border-strong)" }}>
        <Micro color="var(--lm-coral)">{adaptation.currentVersion > 0 ? `What should change in v${adaptation.currentVersion}` : "What the first take should be"}</Micro>
        <textarea value={changeText} onChange={(event) => setChangeText(event.target.value)} rows={3} maxLength={4000} autoFocus
          className="mt-2 block w-full resize-y px-3 py-2.5 text-[15px] leading-6 outline-none" style={{ borderRadius: RADIUS, border: HAIR, background: "var(--lm-surface-1)", color: "var(--lm-text-primary)" }} />
        <p className="mt-2 text-[12px] leading-5" style={{ color: "var(--lm-text-tertiary)" }}>Opens one task for an agent. Nothing is generated or paid for until the agent quotes the cost.</p>
        <div className="mt-2 flex gap-2">
          <DecisionButton tone="coral" disabled={!changeText.trim()} busy={change.status === "pending"} onClick={async () => { if (await change.run()) { setChangeText(""); setPanel("none"); } }}>Send change request</DecisionButton>
          <DecisionButton onClick={() => setPanel("none")}>Cancel</DecisionButton>
        </div>
        {change.status === "done" && <Notice text="Sent. One task is open for it." />}
        <Notice text={change.error} tone="error" />
      </div>}

      {panel === "promote" && version && <div className="mt-1 p-3" style={{ borderRadius: RADIUS, border: "1px solid var(--lm-border-strong)" }}>
        <Micro color="var(--lm-coral)">Promote v{n} into the project</Micro>
        {version.outputs.length > 1 && <div className="mt-2 flex flex-wrap gap-2">{version.outputs.map((output) => <button key={output.key} type="button" onClick={() => setOutputKey(output.key)} aria-pressed={outputKey === output.key}
          className="w-[84px] overflow-hidden" style={{ borderRadius: RADIUS, outline: outputKey === output.key ? "2px solid var(--lm-coral)" : "1px solid var(--lm-border)" }}>
          <HonestMedia media={{ ...output, url: output.thumbUrl ?? output.url }} controls={false} />
        </button>)}</div>}
        <div className="mt-2"><Shelves ownerUserId={ownerUserId} adaptation={adaptation} value={shelf} onChange={setShelf} /></div>
        <p className="mt-2 text-[12px] leading-5" style={{ color: "var(--lm-text-tertiary)" }}>Files this one picture onto that shelf. It is not published, starred or made canon; Undo takes it back off the shelf.</p>
        <div className="mt-2 flex gap-2">
          <DecisionButton tone="ink" disabled={!shelf || !outputKey} busy={doPromote.status === "pending"} onClick={async () => { if (await doPromote.run()) setPanel("none"); }}>Promote</DecisionButton>
          <DecisionButton onClick={() => setPanel("none")}>Cancel</DecisionButton>
        </div>
        <Notice text={doPromote.error} tone="error" />
      </div>}
    </div>

    <div className="mt-4">
      <Micro className="mb-2 block">Notes on this take</Micro>
      <NoteList notes={notes} />
      {version && <NoteBox placeholder={`A thought on v${n}…`} hint={`Pinned to v${n}. It does not approve or change anything.`}
        onSave={(body, eventKey) => noteTake({ ownerUserId, adaptationId: adaptation.adaptationId, version: n, eventKey, body })} />}
    </div>
  </article>;
}

/* ── The page ───────────────────────────────────────────────────────────── */

export function InspirationReview({ ownerUserId, sourceId }: { ownerUserId: string; sourceId: string }) {
  const { isAuthenticated } = useConvexAuth();
  const detail = useQuery(api.inspiration.getInspiration, isAuthenticated ? { ownerUserId, sourceId: sourceId as Id<"inspirationSources">, includeDrafts: true } : "skip");
  const takes = useMemo(() => detail?.adaptations ?? [], [detail]);
  const shell = (children: ReactNode) => <main className="min-h-dvh px-4 pb-24 md:px-8" style={{ background: "var(--lm-paper)", color: "var(--lm-text-primary)", paddingTop: "max(16px, env(safe-area-inset-top))" }}>
    <div className="mx-auto max-w-5xl">
      <Link href={INSPIRATION_URL_PATH} className="inline-flex min-h-[40px] items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>
        <ArrowLeft size={12} aria-hidden /> Inspiration
      </Link>
      {children}
    </div>
  </main>;
  if (detail === undefined) return shell(<div className="grid place-items-center py-32"><Loader2 className="animate-spin" size={18} style={{ color: "var(--lm-text-ghost)" }} aria-label="Loading" /></div>);
  if (detail === null) return shell(<p className="py-20 text-center text-sm font-black uppercase tracking-tight" style={display}>This reference is not in your library.</p>);
  return shell(<>
    <header className="mb-4 mt-2 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <Micro color="var(--lm-coral)">{detail.kind === "text" ? "Idea" : "Reference"} · {plural(takes.length, "take")}</Micro>
        <div className="mt-1"><Title size="lg">{detail.title}</Title></div>
      </div>
      <CopyChip value={`inspiration:${detail.sourceId}`} label="" />
    </header>
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-start">
      <div className="md:sticky md:top-4"><SourceBlock ownerUserId={ownerUserId} detail={detail} /></div>
      <div>
        {takes.length === 0
          ? <div className="border px-5 py-10 text-center" style={{ borderRadius: RADIUS, borderColor: "var(--lm-border)", borderStyle: "dashed" }}>
            <p className="text-sm font-black uppercase tracking-tight" style={display}>Library only</p>
            <p className="mx-auto mt-2 max-w-xs text-[12px] leading-5" style={{ color: "var(--lm-text-tertiary)" }}>No project take yet. It stays here as a reference for any project; ask an agent when you want one.</p>
          </div>
          : takes.map((adaptation) => <TakeCard key={adaptation.adaptationId} ownerUserId={ownerUserId} detail={detail} adaptation={adaptation} />)}
      </div>
    </div>
  </>);
}
