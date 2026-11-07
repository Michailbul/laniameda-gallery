"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowLeft, Check, Copy, Loader2, RotateCcw } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { threadIdOf } from "@/lib/mj-queue";
import { mjQueuePath } from "@/lib/gallery-routes";

// The Midjourney queue on the gallery website: the same threads and prompts
// as the extension's MJ Queue tab (same Convex rows, live both ways), for
// running prompts by hand from any device. COPY puts the full command on the
// clipboard; SENT records a prompt Michael ran himself, so the extension and
// the agents see it and nobody sends it twice. Nothing here submits anything
// to Midjourney.
//
// Speed: the rail subscribes to the thread counts only (listQueue with a
// batch no thread has, so no items come back); the open thread subscribes to
// its own items. Nothing loads the whole queue.

type Queue = FunctionReturnType<typeof api.mjQueue.listQueue>;
type Batch = Queue["batches"][number];
type Item = Queue["items"][number];
type Ref = Item["imagePrompts"][number];
type Thread = Batch & { threadId: string; left: number };

/** A batch label no thread can have: listQueue then returns counts and no items. */
const RAIL_ONLY = "\u0001";
const THREAD_PARAM = "thread";
const NO_WORLD = "_none";

const STATUS_LABEL: Record<Item["status"], string> = {
  queued: "To send",
  injected: "In the bar",
  sent: "Sent",
  skipped: "Skipped",
};

const isOpen = (item: Item) => item.status === "queued" || item.status === "injected";

const ago = (at: number, now = Date.now()) => {
  const minutes = Math.max(0, Math.round((now - at) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 14 ? `${days}d ago` : new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

const titleCase = (key: string) => key.split(/[-_]/).filter(Boolean).map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" ");

/** "Dear Annete · the monster's hand · round 2" inside Dear Annete reads "the monster's hand · round 2". */
function threadLabel(batch: string, worldName?: string) {
  const [head, ...rest] = batch.split(" · ");
  if (!rest.length || !worldName) return batch;
  const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  return norm(head!) === norm(worldName) || norm(worldName).startsWith(norm(head!)) ? rest.join(" · ") : batch;
}

async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback(async (key: string, text: string) => {
    if (await writeClipboard(text)) {
      setCopied(key);
      window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1400);
    }
  }, []);
  return { copied, copy };
}

const wideQuery = "(min-width: 820px)";
function useWide() {
  return useSyncExternalStore(
    (notify) => {
      const media = window.matchMedia(wideQuery);
      media.addEventListener("change", notify);
      return () => media.removeEventListener("change", notify);
    },
    () => window.matchMedia(wideQuery).matches,
    () => true,
  );
}

const readThreadParam = () =>
  typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get(THREAD_PARAM)?.toLowerCase() ?? null;

function writeThreadParam(threadId: string | null) {
  const url = new URL(window.location.href);
  if (threadId) url.searchParams.set(THREAD_PARAM, threadId);
  else url.searchParams.delete(THREAD_PARAM);
  if (url.toString() !== window.location.href) window.history.replaceState(null, "", url.toString());
}

export function MjQueueBoard({ ownerUserId, worldKey, worldName, standalone = false }: {
  ownerUserId: string;
  /** A world's Queue tab: only that world's threads. */
  worldKey?: string;
  worldName?: string;
  /** The /queue page: its own top bar and the world chips. */
  standalone?: boolean;
}) {
  const { isAuthenticated } = useConvexAuth();
  const wide = useWide();
  const rail = useQuery(api.mjQueue.listQueue, isAuthenticated ? { ownerUserId, batch: RAIL_ONLY, ...(worldKey ? { world: worldKey } : {}) } : "skip");
  const worlds = useQuery(api.worlds.listWorlds, isAuthenticated && !worldKey ? { ownerUserId } : "skip");
  const [selected, setSelected] = useState<string | null>(readThreadParam);
  const [scope, setScope] = useState<"open" | "all">("open");
  const [worldFilter, setWorldFilter] = useState<string | null>(null);
  // The page's sticky bar changes height (world chips, wrapping counts): the
  // rail and the thread header stick under its measured height.
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bar = barRef.current;
    const root = rootRef.current;
    if (!bar || !root) return;
    const observer = new ResizeObserver(() => root.style.setProperty("--mjq-top", `${bar.offsetHeight}px`));
    observer.observe(bar);
    return () => observer.disconnect();
  }, [standalone]);

  const worldNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const world of worlds ?? []) names.set(world.key, world.name);
    if (worldKey && worldName) names.set(worldKey, worldName);
    return names;
  }, [worldKey, worldName, worlds]);
  const nameOf = useCallback((key: string | undefined) => (key ? worldNames.get(key) ?? titleCase(key) : "No world"), [worldNames]);

  const threads = useMemo<Thread[]>(() => (rail?.batches ?? []).map((batch) => ({
    ...batch, threadId: threadIdOf(batch.batchKey), left: batch.queued + batch.injected,
  })), [rail]);
  const openCount = threads.filter((thread) => thread.left > 0).length;
  const effectiveScope = scope === "open" && openCount === 0 ? "all" : scope;
  const shown = threads.filter((thread) =>
    (effectiveScope === "all" || thread.left > 0) &&
    (!worldFilter || (thread.worldKey ?? NO_WORLD) === worldFilter));

  const picked = selected ? threads.find((thread) => thread.threadId === selected) : undefined;
  const active = picked ?? (wide ? shown[0] : undefined);

  // The open thread rides in the address (?thread=thr-…) so an agent can link it.
  useEffect(() => {
    if (picked) writeThreadParam(picked.threadId);
  }, [picked]);
  useEffect(() => () => {
    if (!standalone) writeThreadParam(null);
  }, [standalone]);

  const open = (thread: Thread | null) => {
    setSelected(thread?.threadId ?? null);
    if (!thread) writeThreadParam(null);
    if (!wide) window.scrollTo({ top: 0 });
  };

  const totals = threads.reduce((sum, thread) => sum + thread.left, 0);
  const chipWorlds = [...new Set(threads.map((thread) => thread.worldKey ?? NO_WORLD))];

  // Rail groups: by world on the all-worlds page, one flat list in a world.
  const groups: Array<{ key: string; name: string; threads: Thread[] }> = [];
  for (const thread of shown) {
    const key = worldKey ?? thread.worldKey ?? NO_WORLD;
    let group = groups.find((entry) => entry.key === key);
    if (!group) groups.push(group = { key, name: worldKey ? "" : key === NO_WORLD ? "No world" : nameOf(key), threads: [] });
    group.threads.push(thread);
  }

  const showRail = wide || !active;
  const showThread = Boolean(active) && (wide || Boolean(picked));

  const header: ReactNode = standalone ? (
    <div className="mjq-bar" ref={barRef}>
      <div className="mjq-bar-top">
        <Link href="/" className="mjq-ghost" title="Back to the gallery"><ArrowLeft size={13} aria-hidden /> Gallery</Link>
        <h1 className="mjq-wordmark"><i aria-hidden />Midjourney queue</h1>
      </div>
      <p className="mjq-counts">
        {rail === undefined ? <span>Loading</span> : <>
          {totals ? <span className="hot">{totals} to send</span> : <span>Nothing waiting</span>}
          <span>{threads.length} thread{threads.length === 1 ? "" : "s"}</span>
          <span>Same queue as the extension</span>
        </>}
      </p>
      {chipWorlds.length > 1 && <div className="mjq-chips" role="group" aria-label="World">
        <button type="button" className="lm-chip" data-active={worldFilter === null ? "true" : undefined} onClick={() => setWorldFilter(null)}>All worlds</button>
        {chipWorlds.map((key) => <button key={key} type="button" className="lm-chip" data-active={worldFilter === key ? "true" : undefined}
          onClick={() => setWorldFilter(key)}>{key === NO_WORLD ? "No world" : nameOf(key)}</button>)}
      </div>}
    </div>
  ) : (
    <header className="mjq-head">
      <div className="min-w-0">
        <h2 className="mjq-h2">Midjourney queue</h2>
        <p className="mjq-counts">
          {rail === undefined ? <span>Loading</span> : <>
            {totals ? <span className="hot">{totals} to send</span> : <span>Nothing waiting</span>}
            <span>{threads.length} thread{threads.length === 1 ? "" : "s"} in {worldName ?? "this world"}</span>
          </>}
        </p>
      </div>
      <Link href={mjQueuePath({ thread: active?.threadId })} className="mjq-ghost" title="Every world's threads on one page">All worlds</Link>
    </header>
  );

  return (
    <div ref={rootRef} className={`mjq${standalone ? " is-page" : ""}`}>
      <style href="lm-mj-queue" precedence="default">{CSS}</style>
      {header}
      {rail === undefined ? (
        <div className="mjq-state"><Loader2 size={16} className="animate-spin" aria-label="Loading" /></div>
      ) : threads.length === 0 ? (
        <div className="mjq-state"><b>No prompts queued</b>Agents queue Midjourney prompts here; you send them from the extension or by hand.</div>
      ) : (
        <div className={`mjq-body${showThread && !wide ? " is-thread" : ""}`}>
          {showRail && <nav className="mjq-rail" aria-label="Threads">
            <div className="mjq-seg" role="tablist" aria-label="Which threads">
              <button type="button" role="tab" aria-selected={effectiveScope === "open"} disabled={openCount === 0} onClick={() => setScope("open")}>To send {openCount}</button>
              <button type="button" role="tab" aria-selected={effectiveScope === "all"} onClick={() => setScope("all")}>All {threads.length}</button>
            </div>
            {groups.map((group) => <div key={group.key} className="mjq-group">
              {group.name && <div className="mjq-group-name">{group.name}</div>}
              {group.threads.map((thread) => {
                const done = thread.sent + thread.skipped;
                return <button key={thread.batchKey} type="button" className="mjq-thread" aria-current={active?.batchKey === thread.batchKey ? "true" : undefined}
                  onClick={() => open(thread)}>
                  <span className="mjq-thread-name">{threadLabel(thread.batch, nameOf(thread.worldKey))}</span>
                  <span className="mjq-thread-meta">
                    {thread.left ? <span className="hot">{thread.left} to send</span> : <span>All done</span>}
                    <span>{thread.total} total</span>
                    <span>{ago(thread.updatedAt)}</span>
                  </span>
                  <span className="mjq-progress" aria-hidden><i style={{ width: `${thread.total ? (done / thread.total) * 100 : 0}%` }} /></span>
                </button>;
              })}
            </div>)}
            {shown.length === 0 && <p className="mjq-empty">No thread here yet.</p>}
          </nav>}
          {showThread && active && <ThreadView key={active.batchKey} ownerUserId={ownerUserId} thread={active}
            worldName={nameOf(active.worldKey)} showWorld={!worldKey} onBack={wide ? undefined : () => open(null)} />}
        </div>
      )}
    </div>
  );
}

function ThreadView({ ownerUserId, thread, worldName, showWorld, onBack }: {
  ownerUserId: string; thread: Thread; worldName: string; showWorld: boolean; onBack?: () => void;
}) {
  const { isAuthenticated } = useConvexAuth();
  const data = useQuery(api.mjQueue.listQueue, isAuthenticated ? { ownerUserId, batch: thread.batch } : "skip");
  const [filter, setFilter] = useState<"all" | "open" | "done">("all");
  const { copied, copy } = useCopy();
  const items = useMemo(() => (data?.items ?? []).filter((item) => item.batchKey === thread.batchKey), [data, thread.batchKey]);
  const left = items.filter(isOpen);
  const shown = items.filter((item) => filter === "all" || (filter === "open" ? isOpen(item) : !isOpen(item)));

  return <section className="mjq-thread-view" aria-label={thread.batch}>
    <div className="mjq-thread-head">
      {onBack && <button type="button" className="mjq-ghost" onClick={onBack}><ArrowLeft size={13} aria-hidden /> Threads</button>}
      <div className="mjq-thread-title-row">
        <h3 className="mjq-thread-title">{threadLabel(thread.batch, worldName)}</h3>
        <button type="button" className={`mjq-btn${copied === "all" ? " ok" : ""}`} disabled={!left.length}
          title="Every prompt still to send, one per paragraph" onClick={() => void copy("all", left.map((item) => item.command).join("\n\n"))}>
          {copied === "all" ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
          {copied === "all" ? "Copied" : `Copy all ${left.length}`}
        </button>
      </div>
      <p className="mjq-counts">
        {showWorld && <span>{worldName}</span>}
        {thread.left ? <span className="hot">{thread.left} to send</span> : <span>All done</span>}
        {thread.sent ? <span>{thread.sent} sent</span> : null}
        {thread.skipped ? <span>{thread.skipped} skipped</span> : null}
        <IdChip value={thread.threadId} title="Copy the thread id to give an agent" />
      </p>
      <div className="mjq-seg" role="tablist" aria-label="Which prompts">
        <button type="button" role="tab" aria-selected={filter === "all"} onClick={() => setFilter("all")}>All {items.length}</button>
        <button type="button" role="tab" aria-selected={filter === "open"} onClick={() => setFilter("open")}>To send {left.length}</button>
        <button type="button" role="tab" aria-selected={filter === "done"} onClick={() => setFilter("done")}>Done {items.length - left.length}</button>
      </div>
    </div>
    {data === undefined ? (
      <div className="mjq-state"><Loader2 size={16} className="animate-spin" aria-label="Loading" /></div>
    ) : shown.length === 0 ? (
      <p className="mjq-empty">{filter === "open" ? "Everything in this thread is sent." : "Nothing here."}</p>
    ) : (
      <ol className="mjq-items">
        {shown.map((item) => <PromptRow key={item.id} ownerUserId={ownerUserId} item={item} index={items.indexOf(item) + 1}
          copied={copied === item.id} onCopy={() => void copy(item.id, item.command)} />)}
      </ol>
    )}
  </section>;
}

function refTiles(item: Item) {
  const tiles: Array<{ ref: Ref; kind: string }> = [
    ...item.imagePrompts.map((ref) => ({ ref, kind: "Image" })),
    ...item.styleRefs.map((ref) => ({ ref, kind: "Style" })),
    ...(item.omniRef ? [{ ref: item.omniRef, kind: "Omni" }] : []),
    ...(item.characterRef ? [{ ref: item.characterRef, kind: "Character" }] : []),
  ];
  return tiles;
}

function PromptRow({ ownerUserId, item, index, copied, onCopy }: {
  ownerUserId: string; item: Item; index: number; copied: boolean; onCopy: () => void;
}) {
  const update = useMutation(api.mjQueue.updateItem);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = !isOpen(item);
  const tiles = refTiles(item);

  const setSent = async (sent: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await update(sent
        ? { ownerUserId, itemId: item.id, status: "sent", sentCommand: item.command }
        // Undo also clears the recorded command, so nobody reads it as sent.
        : { ownerUserId, itemId: item.id, status: "queued", ...(item.status === "sent" ? { sentCommand: "" } : {}) });
    } catch (caught) {
      const data = (caught as { data?: unknown })?.data;
      setError(typeof data === "string" ? data : "Could not save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return <li className={`mjq-item${done ? " is-done" : ""}`}>
    <div className="mjq-refs">
      {tiles.length ? tiles.map(({ ref, kind }, at) => <figure key={at} className="mjq-ref" title={ref.label ? `${kind}: ${ref.label}` : kind}>
        {ref.thumbUrl || ref.url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={ref.thumbUrl || ref.url} alt={ref.label ?? `${kind} reference`} loading="lazy" decoding="async" />
          : <span className="mjq-ref-code">{ref.code}</span>}
        <figcaption>{kind}</figcaption>
      </figure>) : <div className="mjq-ref is-none">Words only</div>}
    </div>
    <div className="mjq-item-body">
      <div className="mjq-item-top">
        <span className="mjq-n">{String(index).padStart(2, "0")}</span>
        <span className="mjq-item-title">{item.title || "Untitled prompt"}</span>
        <span className={`mjq-status s-${item.status}`}>{STATUS_LABEL[item.status]}</span>
      </div>
      {item.note && <p className="mjq-note">{item.note}</p>}
      {item.warnings.map((warning) => <p key={warning} className="mjq-warn">{warning}</p>)}
      <button type="button" className={`mjq-cmd${expanded ? " is-open" : ""}`} aria-expanded={expanded}
        title={expanded ? "Fold the prompt" : "Read the whole prompt"} onClick={() => setExpanded((value) => !value)}>
        {item.command}
      </button>
      <div className="mjq-actions">
        <button type="button" className={`mjq-btn primary${copied ? " ok" : ""}`} onClick={onCopy} title="Copy the full prompt for the Imagine bar">
          {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}{copied ? "Copied" : "Copy"}
        </button>
        {item.status === "skipped" ? (
          <button type="button" className="mjq-btn" disabled={busy} onClick={() => void setSent(false)} title="Put it back in the thread">
            {busy ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <RotateCcw size={12} aria-hidden />}Put back
          </button>
        ) : item.status === "sent" ? (
          <button type="button" className="mjq-btn" disabled={busy} onClick={() => void setSent(false)} title="Not sent after all: back to to send">
            {busy ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <RotateCcw size={12} aria-hidden />}Undo sent
          </button>
        ) : (
          <button type="button" className="mjq-btn" disabled={busy} onClick={() => void setSent(true)}
            title="You ran it yourself: marks it sent everywhere, so the extension and the agents skip it">
            {busy ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <Check size={12} aria-hidden />}Mark sent
          </button>
        )}
        {item.sentAt && item.status === "sent" && <span className="mjq-when">Sent {ago(item.sentAt)}</span>}
        <span className="mjq-spacer" />
        <IdChip value={`mjq:${item.id}`} label={`mjq:${item.id.slice(-6)}`} title="Copy this prompt's id to give an agent" />
      </div>
      {error && <p className="mjq-warn">{error}</p>}
    </div>
  </li>;
}

function IdChip({ value, label, title }: { value: string; label?: string; title?: string }) {
  const { copied, copy } = useCopy();
  return <button type="button" className="mjq-id" title={title ?? `Copy ${value}`} onClick={() => void copy(value, value)}>
    {label ?? value}{copied ? <Check size={10} aria-hidden /> : <Copy size={10} aria-hidden />}
  </button>;
}

const CSS = `
.mjq{--mjq-rail:300px;--mjq-top:0px;position:relative;color:var(--lm-text-primary);-webkit-text-size-adjust:100%;
  /* Resolved here from the next/font variables (as in the review wall): the :root tokens can be invalid inside the dashboard, and a font: shorthand would then drop whole. */
  --lm-font:var(--font-geist-mono,ui-monospace),ui-monospace,"SF Mono",monospace;--lm-font-display:var(--font-geist-sans,system-ui),system-ui,sans-serif;
  font-family:var(--lm-font-display)}
.mjq.is-page{min-height:100dvh;background:var(--lm-paper);
  background-image:linear-gradient(var(--lm-grid-line) 1px,transparent 1px),linear-gradient(90deg,var(--lm-grid-line) 1px,transparent 1px);background-size:24px 24px;
  padding-bottom:calc(48px + env(safe-area-inset-bottom))}
.mjq button{-webkit-tap-highlight-color:transparent;font-family:inherit}
.mjq-bar{position:sticky;top:0;z-index:20;padding:calc(10px + env(safe-area-inset-top)) 16px 10px;
  background:linear-gradient(180deg,var(--lm-sidebar-glass-fill-top),var(--lm-sidebar-glass-fill-bottom));
  backdrop-filter:blur(18px) saturate(140%);-webkit-backdrop-filter:blur(18px) saturate(140%);border-bottom:1px solid var(--lm-sidebar-glass-border)}
.mjq-bar-top{display:flex;align-items:center;gap:12px;min-height:36px}
.mjq-wordmark{margin:0;font:900 15px/1 var(--lm-font-display);letter-spacing:.14em;text-transform:uppercase;display:flex;align-items:center;gap:8px}
.mjq-wordmark i{width:7px;height:7px;background:var(--lm-coral);border-radius:1px;display:inline-block}
.mjq-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:12px;padding:10px 12px 4px}
@media (min-width:768px){.mjq-head{padding:10px 24px 4px}}
.mjq-h2{margin:0;font:800 24px/1 var(--lm-font-display);letter-spacing:-.01em;text-transform:uppercase}
.mjq-counts{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin:7px 0 0;font:600 9.5px/1 var(--lm-font);letter-spacing:.14em;text-transform:uppercase;color:var(--lm-text-ghost)}
.mjq-counts .hot,.mjq-thread-meta .hot{color:var(--lm-coral)}
.mjq-chips{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin:10px -16px 0;padding:0 16px}
.mjq-chips::-webkit-scrollbar{display:none}
.mjq-chips .lm-chip{white-space:nowrap;flex:0 0 auto;min-height:32px}
.mjq-ghost{display:inline-flex;align-items:center;gap:5px;font:700 9.5px/1 var(--lm-font);letter-spacing:.14em;text-transform:uppercase;color:var(--lm-text-tertiary);
  padding:9px 6px;min-height:32px;background:none;border:0;cursor:pointer;text-decoration:none}
.mjq-ghost:hover{color:var(--lm-text-primary)}
.mjq-state{display:grid;place-items:center;gap:6px;padding:72px 16px;text-align:center;font:600 10px/1.8 var(--lm-font);letter-spacing:.14em;text-transform:uppercase;color:var(--lm-text-ghost)}
.mjq-state b{display:block;font:800 22px/1.1 var(--lm-font-display);letter-spacing:-.01em;color:var(--lm-text-secondary)}
.mjq-empty{padding:28px 4px;font:600 10px/1.6 var(--lm-font);letter-spacing:.14em;text-transform:uppercase;color:var(--lm-text-ghost)}

.mjq-body{display:block;padding:8px 12px 0}
@media (min-width:820px){.mjq-body{display:grid;grid-template-columns:var(--mjq-rail) minmax(0,1fr);gap:24px;padding:12px 24px 0;align-items:start}}
.mjq-rail{display:flex;flex-direction:column;gap:6px}
.mjq-rail > *{flex-shrink:0}
@media (min-width:820px){.mjq-rail{position:sticky;top:calc(var(--mjq-top) + 12px);max-height:calc(100dvh - var(--mjq-top) - 24px);overflow:auto;padding-right:6px;scrollbar-width:thin}}
.mjq-seg{display:inline-flex;align-self:flex-start;border:1.5px solid var(--lm-border-strong);border-radius:var(--lm-radius);overflow:hidden;margin:4px 0 6px}
.mjq-seg button{font:700 9.5px/1 var(--lm-font);letter-spacing:.14em;text-transform:uppercase;padding:9px 11px;color:var(--lm-text-tertiary);min-height:32px;background:none;border:0;cursor:pointer}
.mjq-seg button[aria-selected="true"]{background:var(--lm-ink);color:var(--lm-paper)}
.mjq-seg button:disabled{opacity:.35;cursor:default}
.mjq-group{display:flex;flex-direction:column;gap:2px;margin-top:6px}
.mjq-group-name{font:700 9.5px/1 var(--lm-font);letter-spacing:.18em;text-transform:uppercase;color:var(--lm-text-tertiary);padding:10px 10px 6px}
.mjq-thread{position:relative;display:flex;flex-direction:column;gap:6px;width:100%;text-align:left;padding:10px 10px 12px;border:1px solid transparent;border-radius:var(--lm-radius);
  background:none;color:var(--lm-text-primary);cursor:pointer;transition:background-color 150ms}
.mjq-thread:hover{background:var(--lm-surface-1)}
.mjq-thread[aria-current="true"]{background:var(--lm-surface-2);border-color:var(--lm-border-strong);box-shadow:inset 2px 0 0 var(--lm-coral)}
.mjq-thread-name{font:800 12.5px/1.25 var(--lm-font-display);letter-spacing:.01em;text-transform:uppercase;overflow-wrap:anywhere}
.mjq-thread-meta{display:flex;gap:10px;flex-wrap:wrap;font:600 9px/1 var(--lm-font);letter-spacing:.12em;text-transform:uppercase;color:var(--lm-text-ghost)}
.mjq-progress{position:absolute;left:10px;right:10px;bottom:5px;height:1px;background:var(--lm-border)}
.mjq-progress i{display:block;height:100%;background:var(--lm-text-tertiary)}

.mjq-thread-view{min-width:0}
.mjq-thread-head{position:sticky;top:var(--mjq-top);z-index:5;padding:10px 0 8px;margin-bottom:4px;
  background:linear-gradient(180deg,var(--lm-paper) 70%,color-mix(in srgb,var(--lm-paper) 0%,transparent))}
.mjq-thread-title-row{display:flex;align-items:flex-start;gap:12px}
.mjq-thread-title{flex:1 1 auto;min-width:0;margin:0;font:900 clamp(18px,2.4vw,26px)/1.02 var(--lm-font-display);letter-spacing:-.02em;text-transform:uppercase;overflow-wrap:anywhere;text-wrap:balance}
.mjq-items{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.mjq-item{display:grid;grid-template-columns:92px minmax(0,1fr);gap:14px;padding:16px 0;border-top:1px solid var(--lm-border);transition:opacity 200ms}
@media (min-width:1100px){.mjq-item{grid-template-columns:120px minmax(0,1fr)}}
.mjq-item.is-done{opacity:.38}
.mjq-item.is-done:hover{opacity:.7}
.mjq-refs{display:flex;flex-direction:column;gap:6px}
.mjq-ref{position:relative;margin:0;border-radius:var(--lm-radius);overflow:hidden;background:var(--lm-surface-2);border:1px solid var(--lm-border)}
.mjq-ref img{display:block;width:100%;height:auto;max-height:180px;object-fit:cover;background:var(--lm-surface-2)}
.mjq-ref figcaption{position:absolute;left:4px;bottom:4px;padding:3px 5px;border-radius:2px;background:rgba(10,8,5,.78);color:#fff4ea;
  font:700 8px/1 var(--lm-font);letter-spacing:.14em;text-transform:uppercase}
.mjq-ref-code{display:grid;place-items:center;min-height:56px;padding:18px 6px;font:700 10px/1.2 var(--lm-font);letter-spacing:.04em;color:var(--lm-text-secondary);overflow-wrap:anywhere;text-align:center}
.mjq-ref.is-none{display:grid;place-items:center;min-height:56px;font:600 8.5px/1.3 var(--lm-font);letter-spacing:.14em;text-transform:uppercase;color:var(--lm-text-ghost);text-align:center;padding:6px}
.mjq-item-body{min-width:0;display:flex;flex-direction:column;gap:8px}
.mjq-item-top{display:flex;align-items:baseline;gap:10px}
.mjq-n{font:700 10px/1 var(--lm-font);color:var(--lm-text-ghost);letter-spacing:.06em}
.mjq-item-title{flex:1 1 auto;min-width:0;font:800 14px/1.2 var(--lm-font-display);letter-spacing:.01em;text-transform:uppercase;overflow-wrap:anywhere}
.mjq-status{flex:0 0 auto;padding:3px 6px;border:1px solid var(--lm-border-strong);border-radius:var(--lm-radius);font:700 8.5px/1 var(--lm-font);letter-spacing:.14em;text-transform:uppercase;color:var(--lm-text-tertiary)}
.mjq-status.s-queued{color:var(--lm-coral);border-color:color-mix(in srgb,var(--lm-coral) 55%,transparent)}
.mjq-status.s-injected{background:var(--lm-coral);border-color:var(--lm-coral);color:var(--lm-paper)}
.mjq-note{margin:0;font:500 13px/1.45 var(--lm-font-display);color:var(--lm-text-secondary)}
.mjq-warn{margin:0;font:600 10px/1.45 var(--lm-font);letter-spacing:.04em;color:var(--lm-coral)}
.mjq-cmd{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;width:100%;text-align:left;margin:0;padding:10px 12px;cursor:pointer;
  font:500 11.5px/1.55 var(--lm-font);color:var(--lm-text-primary);white-space:pre-wrap;overflow-wrap:anywhere;
  background:var(--lm-surface-1);border:1px solid var(--lm-border);border-radius:var(--lm-radius)}
.mjq-cmd:hover{border-color:var(--lm-border-strong)}
.mjq-cmd.is-open{display:block;-webkit-line-clamp:unset}
.mjq-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.mjq-spacer{flex:1 1 auto}
.mjq-btn{display:inline-flex;align-items:center;gap:6px;min-height:34px;padding:0 13px;border-radius:999px;cursor:pointer;white-space:nowrap;
  font:800 10px/1 var(--lm-font-display);letter-spacing:.12em;text-transform:uppercase;
  background:var(--lm-surface-2);color:var(--lm-text-primary);border:1.5px solid var(--lm-border-strong);transition:background-color 150ms,color 150ms,transform 120ms}
.mjq-btn:hover{border-color:var(--lm-text-tertiary)}
.mjq-btn:active{transform:scale(.97)}
.mjq-btn:disabled{opacity:.4;cursor:default}
.mjq-btn.primary{background:var(--lm-ink);color:var(--lm-paper);border-color:var(--lm-ink)}
.mjq-btn.ok{background:var(--lm-coral);border-color:var(--lm-coral);color:var(--lm-paper)}
.mjq-when{font:600 9.5px/1 var(--lm-font);letter-spacing:.12em;text-transform:uppercase;color:var(--lm-text-ghost)}
.mjq-id{display:inline-flex;align-items:center;gap:5px;padding:4px 6px;border-radius:var(--lm-radius);border:1px solid var(--lm-border-strong);background:none;cursor:pointer;
  font:700 9.5px/1 var(--lm-font);letter-spacing:.04em;text-transform:none;color:var(--lm-text-tertiary)}
.mjq-id:hover{color:var(--lm-text-primary)}
@media (max-width:819px){.mjq-thread-head{top:var(--mjq-top)}.mjq-btn{min-height:38px}}
`;
