"use client";

import "@/app/tokens.css";
import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useConvexAuth, useMutation } from "convex/react";
import { Check, Loader2, MessageSquarePlus, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useCurrentUser } from "@/lib/use-current-user";
import { GALLERY_ORIGIN } from "@/lib/gallery-routes";
import { TASK_LIMITS, titleFromText } from "@/lib/tasks";
import { errorText } from "@/components/inbox/inbox-ui";

// Feedback from any page: Michael writes what to fix or look at, and it files
// a task (source "feedback") with the page and what is on it. The scheduled
// reviewer agent picks these up, delivers, and reports in the newspaper.
// The ` key (under Esc) opens it anywhere.

type Link = { kind: "asset" | "stack" | "url"; id: string; label?: string };
type Context = { where: string; url: string; world?: string; links: Link[]; facts: string[] };

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

const bare = (value: string | null) => value?.trim().replace(/^[a-z]+:/i, "") || undefined;

/** What the page shows, read from its address: the world, the open picture, the pile, the task. */
const readContext = (pathname: string, search: URLSearchParams): Context => {
  const query = search.toString();
  const url = `${GALLERY_ORIGIN}${pathname}${query ? `?${query}` : ""}`;
  const title = typeof document === "undefined" ? "" : document.title.replace(/\s*·\s*Laniameda.*$/i, "").trim();
  const links: Link[] = [{ kind: "url", id: url, label: title || pathname }];
  const facts: string[] = [];
  let world: string | undefined;
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "w" && parts[1]) world = decodeURIComponent(parts[1]);
  if (parts[0] === "inbox" && parts[1]) {
    world = parts[1];
    if (parts[2]) { links.push({ kind: "stack", id: parts[2] }); facts.push(`Decisions pile: stack:${parts[2]}`); }
  }
  const asset = bare(search.get("asset"));
  if (asset) { links.push({ kind: "asset", id: asset }); facts.push(`Open picture: asset:${asset}`); }
  const task = bare(search.get("task"));
  if (task) facts.push(`Open task: task:${task}`);
  const where = title && title !== "Laniameda Gallery" ? title : parts.length ? `/${parts.join("/")}` : "the gallery";
  return { where, url, world, links, facts };
};

export function FeedbackButton() {
  const { user } = useCurrentUser();
  const { isAuthenticated } = useConvexAuth();
  if (!user || !isAuthenticated) return null;
  return <Feedback ownerUserId={user.ownerUserId} />;
}

function Feedback({ ownerUserId }: { ownerUserId: string }) {
  const pathname = usePathname() ?? "/";
  const search = useSearchParams();
  const create = useMutation(api.tasks.createTask);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "busy" | "sent" | "error"; message?: string }>({ kind: "idle" });
  const [context, setContext] = useState<Context | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  const show = () => { setContext(readContext(pathname, new URLSearchParams(search?.toString() ?? ""))); setState({ kind: "idle" }); setOpen(true); };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "`" && !isTyping(event.target)) { event.preventDefault(); if (open) setOpen(false); else show(); }
      else if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
  useEffect(() => { if (open) requestAnimationFrame(() => field.current?.focus()); }, [open]);
  useEffect(() => {
    if (state.kind !== "sent") return;
    const timer = setTimeout(() => { setOpen(false); setState({ kind: "idle" }); }, 1400);
    return () => clearTimeout(timer);
  }, [state.kind]);

  const send = async () => {
    const note = text.trim();
    if (!note || !context || state.kind === "busy") return;
    setState({ kind: "busy" });
    const stamp = Date.now();
    const brief = [
      `Feedback from Michael on **${context.where}**.`,
      "",
      `Page: ${context.url}`,
      ...context.facts.map((fact) => `- ${fact}`),
      "",
      "## What he wrote",
      "",
      note,
      "",
      "Act on it, then complete the task with a one-line summary of what he will see now and the frames it changed. Ask (blocked + ask) only if it is a taste call.",
    ].join("\n").slice(0, TASK_LIMITS.brief);
    const base = {
      ownerUserId, title: titleFromText(note, 80) || "Feedback", summary: `From ${context.where}`.slice(0, TASK_LIMITS.summary),
      brief, priority: 2 as const, source: "feedback" as const, sourceRef: context.url.slice(0, 500),
      links: context.links, ingestKey: `feedback:${stamp}`,
    };
    try {
      try {
        await create({ ...base, ...(context.world ? { world: context.world } : {}) });
      } catch (failure) {
        // A path segment that is not a world (a style page, a shelf): file it studio-wide.
        if (!context.world) throw failure;
        await create(base);
      }
      setText("");
      setState({ kind: "sent" });
    } catch (failure) {
      setState({ kind: "error", message: errorText(failure, "Not sent.") });
    }
  };

  return <>
    <style href="lm-feedback" precedence="default">{CSS}</style>
    {!open && <button type="button" className="lmf-pill" onClick={show} title="Feedback for the agent ( ` )" aria-label="Feedback for the agent">
      <MessageSquarePlus size={14} aria-hidden /><span>Feedback</span><kbd>`</kbd>
    </button>}
    {open && context && <div className="lmf-sheet" role="dialog" aria-label="Feedback for the agent">
      <div className="lmf-head">
        <span className="lmf-title">Feedback</span>
        <span className="lmf-where" title={context.url}>{context.where}</span>
        <button type="button" className="lmf-x" onClick={() => setOpen(false)} aria-label="Close"><X size={14} aria-hidden /></button>
      </div>
      {state.kind === "sent"
        ? <p className="lmf-sent"><Check size={14} aria-hidden /> Filed. The agent picks it up on its next round.</p>
        : <>
          <textarea ref={field} value={text} onChange={(event) => setText(event.target.value)} rows={4} maxLength={4000}
            placeholder="What should the agent fix, check or make? It sees this page and what is open on it."
            onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send(); } }} />
          {context.facts.length > 0 && <p className="lmf-ctx">{context.links.filter((link) => link.kind !== "url").map((link) => link.kind === "asset" ? "this picture" : "this pile").join(" · ")} attached</p>}
          <div className="lmf-acts">
            {state.kind === "error" && <span className="lmf-err">{state.message}</span>}
            <span className="lmf-hint">⌘↵ send · esc close</span>
            <button type="button" className="lmf-send" disabled={!text.trim() || state.kind === "busy"} onClick={() => void send()}>
              {state.kind === "busy" ? <Loader2 size={13} className="animate-spin" aria-hidden /> : null} Send to the agent
            </button>
          </div>
        </>}
    </div>}
  </>;
}

const CSS = `
.lmf-pill,.lmf-sheet{--lmf-mono:var(--font-geist-mono),ui-monospace,"SF Mono",monospace;--lmf-sans:var(--font-geist-sans),system-ui,sans-serif}
.lmf-pill{position:fixed;right:16px;bottom:16px;z-index:80;display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 10px 0 11px;border:1px solid var(--lm-border-strong);border-radius:var(--lm-radius);background:color-mix(in srgb,var(--lm-paper) 82%,transparent);backdrop-filter:blur(8px);color:var(--lm-text-secondary);font:700 10px/1 var(--lmf-mono);letter-spacing:.14em;text-transform:uppercase;cursor:pointer;transition:color .15s,border-color .15s}
.lmf-pill:hover{color:var(--lm-text-primary);border-color:var(--lm-coral)}
.lmf-pill kbd{font:600 10px/1 var(--lmf-mono);opacity:.5;border:1px solid var(--lm-border-strong);border-radius:2px;padding:2px 4px}
@media (max-width:767px){.lmf-pill{bottom:calc(var(--mobile-bottom-nav-height,0px) + 12px + env(safe-area-inset-bottom));right:12px}.lmf-pill span,.lmf-pill kbd{display:none}.lmf-pill{padding:0 10px}}
.lmf-sheet{position:fixed;right:16px;bottom:16px;z-index:81;width:min(420px,calc(100vw - 24px));display:flex;flex-direction:column;gap:10px;padding:14px;background:var(--lm-surface-1);border:1px solid var(--lm-border-strong);border-top:3px solid var(--lm-coral);border-radius:var(--lm-radius);box-shadow:var(--lm-shadow-lg);color:var(--lm-text-primary);animation:lmf-in .18s cubic-bezier(.2,.8,.2,1)}
@keyframes lmf-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@media (max-width:767px){.lmf-sheet{right:12px;bottom:calc(var(--mobile-bottom-nav-height,0px) + 12px + env(safe-area-inset-bottom))}}
.lmf-head{display:flex;align-items:baseline;gap:10px;min-width:0}
.lmf-title{font:800 13px/1 var(--lmf-sans);letter-spacing:-.01em;text-transform:uppercase}
.lmf-where{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:700 9.5px/1 var(--lmf-mono);letter-spacing:.14em;text-transform:uppercase;color:var(--lm-text-ghost)}
.lmf-x{display:grid;place-items:center;width:26px;height:26px;border:1px solid var(--lm-border-strong);border-radius:var(--lm-radius);background:none;color:var(--lm-text-secondary);cursor:pointer;align-self:center}
.lmf-sheet textarea{width:100%;resize:vertical;min-height:92px;padding:10px;background:var(--lm-paper);border:1px solid var(--lm-border-strong);border-radius:var(--lm-radius);color:var(--lm-text-primary);font:500 14px/1.45 var(--lmf-sans);outline:none}
.lmf-sheet textarea:focus{border-color:var(--lm-coral)}
.lmf-ctx{margin:0;font:700 9.5px/1 var(--lmf-mono);letter-spacing:.14em;text-transform:uppercase;color:var(--lm-text-tertiary)}
.lmf-acts{display:flex;align-items:center;gap:10px}
.lmf-hint{flex:1 1 auto;font:600 9.5px/1 var(--lmf-mono);letter-spacing:.12em;text-transform:uppercase;color:var(--lm-text-ghost)}
.lmf-err{flex:1 1 100%;font:600 11px/1.4 var(--lmf-mono);color:var(--lm-coral)}
.lmf-acts:has(.lmf-err){flex-wrap:wrap}
.lmf-send{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 14px;border:1px solid var(--lm-coral);border-radius:var(--lm-radius);background:var(--lm-coral);color:var(--lm-paper);font:700 10px/1 var(--lmf-mono);letter-spacing:.14em;text-transform:uppercase;cursor:pointer}
.lmf-send:disabled{opacity:.4;cursor:not-allowed}
.lmf-sent{margin:0;display:flex;align-items:center;gap:8px;min-height:40px;font:700 11px/1.4 var(--lmf-mono);letter-spacing:.12em;text-transform:uppercase;color:var(--lm-coral)}
`;
