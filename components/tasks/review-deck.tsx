"use client";

import {
  useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode,
} from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  Archive, ArrowRight, Check, ChevronLeft, ChevronRight, Clock, Copy, FileText, Loader2, MessageSquare, Play, RotateCcw, Undo2, X,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CopyChip, Micro, RADIUS, SCRIM, display, errorText, mono } from "@/components/inbox/inbox-ui";
import { useDesktop } from "@/components/inbox/evidence";
import { WorldViewToggle, type WorldViewMode } from "@/components/gallery/world-view-mode";
import { TaskPanel } from "@/components/tasks/task-queue";
import { TASK_LIMITS, gistOf, taskRef, taskToMarkdown, type TaskStatus } from "@/lib/tasks";

// The review deck: Michael's side of the task queue, one card at a time. A
// card is the pictures the task is about, its title and one line of what the
// agent needs; the two or three things he can do are always on screen. Swipe
// right is the primary answer, left discards, every answer has an undo. The
// AGENT view shows the same cards as the markdown an agent receives.

type Card = FunctionReturnType<typeof api.tasks.listTaskCards>[number];
type Sheet = { kind: "comment"; intent: "answer" | "rework" | "note" } | { kind: "details" };
type Toast = { key: number; text: string; detail?: string; tone: "ok" | "error"; undo?: () => Promise<void> };
type Fly = { dx: number; dy: number; rotate: number };

const FLY_MS = 240;
const SWIPE_PX = 96;
const VIEW_KEY = "lm-tasks-view";

const STATUS_WORD: Record<TaskStatus, string> = {
  blocked: "Needs you", done: "Done · accept?", open: "Waiting for an agent", claimed: "In flight", archived: "Archived",
};
const STATUS_TONE: Record<TaskStatus, string> = {
  blocked: "var(--lm-coral)", done: "var(--lm-text-primary)", open: "var(--lm-text-secondary)", claimed: "var(--lm-text-secondary)", archived: "var(--lm-text-ghost)",
};

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

const readView = (): WorldViewMode => {
  try { return window.localStorage.getItem(VIEW_KEY) === "agent" ? "agent" : "human"; } catch { return "human"; }
};

/* ── Pictures ────────────────────────────────────────────────────────────── */

function Pic({ thumb, cover = true }: { thumb: Card["thumbs"][number]; cover?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  return <>
    {!loaded && <div className="absolute inset-0 animate-pulse" style={{ background: "var(--lm-surface-2)" }} />}
    {/* eslint-disable-next-line @next/next/no-img-element -- the gallery's own thumbnail */}
    <img src={thumb.url} alt="" draggable={false} decoding="async" onLoad={() => setLoaded(true)}
      className={`absolute inset-0 h-full w-full ${cover ? "object-cover" : "object-contain"}`} style={{ opacity: loaded ? 1 : 0, transition: "opacity 180ms ease-out" }} />
  </>;
}

// One picture fills the hero; two to four tile it. No picture: the title is
// the picture, set large on the world's own surface.
function Hero({ card, compact }: { card: Card; compact: boolean }) {
  const thumbs = card.thumbs;
  if (thumbs.length === 0) {
    return <div className="relative flex h-full w-full flex-col justify-end overflow-hidden p-5 md:p-7" style={{ background: "var(--lm-surface-2)" }}>
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{ backgroundImage: "repeating-linear-gradient(135deg, var(--lm-ink) 0 1px, transparent 1px 14px)" }} />
      <span aria-hidden className="absolute right-5 top-5 text-[64px] font-black leading-none tracking-tight md:text-[96px]" style={{ ...display, color: "var(--lm-ink)", opacity: 0.08 }}>
        {card.status === "blocked" ? "?" : card.status === "done" ? "✓" : "→"}
      </span>
      <p className="relative max-w-[18ch] text-[clamp(28px,6vw,52px)] font-black uppercase leading-[0.95] tracking-tight" style={{ ...display, textWrap: "balance" }}>{card.title}</p>
    </div>;
  }
  if (thumbs.length === 1) return <div className="relative h-full w-full"><Pic thumb={thumbs[0]!} cover={!compact} /></div>;
  const two = thumbs.length === 2;
  return <div className={`grid h-full w-full gap-[2px] ${two ? "grid-cols-2" : "grid-cols-2 grid-rows-2"}`} style={{ background: "var(--lm-border)" }}>
    {thumbs.map((thumb, index) => <div key={thumb.assetId} className={`relative ${thumbs.length === 3 && index === 0 ? "row-span-2" : ""}`}><Pic thumb={thumb} /></div>)}
  </div>;
}

/* ── Buttons ─────────────────────────────────────────────────────────────── */

type Tone = "ink" | "coral" | "ghost";
const TONE: Record<Tone, CSSProperties> = {
  ink: { background: "var(--lm-ink)", color: "var(--lm-paper)", borderColor: "var(--lm-ink)" },
  coral: { background: "var(--lm-coral)", color: "var(--lm-paper)", borderColor: "var(--lm-coral)" },
  ghost: { background: "var(--lm-surface-1)", color: "var(--lm-text-secondary)", borderColor: "var(--lm-border-strong)" },
};

function Big({ tone = "ghost", icon, hint, children, grow, ...props }: { tone?: Tone; icon: ReactNode; hint?: string; grow?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props}
    className={`relative flex h-14 items-center justify-center gap-2 border px-4 text-[11px] font-black uppercase tracking-[0.14em] transition-[transform,opacity] active:scale-[0.97] disabled:opacity-40 md:h-[60px] ${grow ? "flex-[1.6]" : "flex-1"} ${props.className ?? ""}`}
    style={{ ...mono, borderRadius: RADIUS, ...TONE[tone], boxShadow: tone === "ghost" ? undefined : "var(--lm-shadow-sm)", ...props.style }}>
    {icon}<span>{children}</span>
    {hint && <span aria-hidden className="absolute right-2 top-1.5 hidden text-[9px] font-bold opacity-50 md:block">{hint}</span>}
  </button>;
}

/* ── The deck ────────────────────────────────────────────────────────────── */

export function ReviewDeck({ ownerUserId, worldFolderId, showWorld = true, initialTaskId, header }: {
  ownerUserId: string;
  worldFolderId?: Id<"folders">;
  showWorld?: boolean;
  initialTaskId?: string;
  /** Above the deck: the page's own header, given the counts. */
  header?: (counts: { total: number; needsYou: number; done: number }) => ReactNode;
}) {
  const { isAuthenticated } = useConvexAuth();
  const cards = useQuery(api.tasks.listTaskCards, isAuthenticated ? { ownerUserId, worldFolderId, limit: TASK_LIMITS.list } : "skip");
  const update = useMutation(api.tasks.updateTask);
  const comment = useMutation(api.tasks.commentTask);
  const desktop = useDesktop();

  const [view, setView] = useState<WorldViewMode>("human");
  useEffect(() => { setView(readView()); }, []);
  const changeView = (next: WorldViewMode) => { setView(next); try { window.localStorage.setItem(VIEW_KEY, next); } catch { /* storage refused */ } };

  // Cards answered in this sitting leave the deck at once; "Later" sends a
  // card to the back. The server list catches up on its own.
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [later, setLater] = useState<string[]>([]);
  const deck = useMemo(() => {
    const live = (cards ?? []).filter((card) => !gone.has(card._id));
    const back = new Map(later.map((id, at) => [id, at]));
    return [...live.filter((card) => !back.has(card._id)), ...live.filter((card) => back.has(card._id)).sort((a, b) => back.get(a._id)! - back.get(b._id)!)];
  }, [cards, gone, later]);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!initialTaskId || !cards) return;
    const at = deck.findIndex((card) => card._id === initialTaskId);
    if (at >= 0) setIndex(at);
    // Only when the deck first arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards === undefined]);
  const card = deck[Math.min(index, Math.max(0, deck.length - 1))];

  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [fly, setFly] = useState<Fly | null>(null);
  const [drag, setDrag] = useState<{ id: number; x0: number; y0: number; dx: number; dy: number; moved: boolean } | null>(null);
  const busy = useRef(false);
  const say = useCallback((next: Omit<Toast, "key">) => setToast({ ...next, key: Date.now() }), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.tone === "error" ? 4200 : toast.undo ? 5000 : 1800);
    return () => clearTimeout(timer);
  }, [toast]);

  const counts = useMemo(() => ({
    total: cards?.length ?? 0,
    needsYou: cards?.filter((row) => row.status === "blocked").length ?? 0,
    done: cards?.filter((row) => row.status === "done").length ?? 0,
  }), [cards]);

  const leave = useCallback(async (target: Card, dir: "left" | "right" | "down", action: () => Promise<void>, text: string, undo?: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    setFly(dir === "left" ? { dx: -window.innerWidth, dy: 40, rotate: -14 } : dir === "right" ? { dx: window.innerWidth, dy: 40, rotate: 14 } : { dx: 0, dy: window.innerHeight * 0.6, rotate: 0 });
    const request = action();
    await new Promise((resolve) => setTimeout(resolve, FLY_MS));
    setFly(null);
    setDrag(null);
    setGone((set) => new Set(set).add(target._id));
    setIndex((at) => Math.min(at, Math.max(0, deck.length - 2)));
    busy.current = false;
    try {
      await request;
      say({ tone: "ok", text, undo: undo ? async () => { await undo(); setGone((set) => { const next = new Set(set); next.delete(target._id); return next; }); } : undefined });
    } catch (failure) {
      setGone((set) => { const next = new Set(set); next.delete(target._id); return next; });
      say({ tone: "error", text: errorText(failure, "That did not go through.") });
    }
  }, [deck.length, say]);

  const owner = { ownerUserId, actor: "owner" } as const;
  const discard = (target: Card) => leave(target, "left", () => update({ ...owner, taskId: target._id, status: "archived" }).then(() => undefined), "Discarded",
    () => update({ ...owner, taskId: target._id, status: target.status === "claimed" || target.status === "blocked" ? "open" : target.status }).then(() => undefined));
  const accept = (target: Card) => leave(target, "right", () => update({ ...owner, taskId: target._id, status: "archived" }).then(() => undefined), "Accepted",
    () => update({ ...owner, taskId: target._id, status: "done" }).then(() => undefined));
  const go = (target: Card) => leave(target, "right", () => update({ ...owner, taskId: target._id, priority: 1 }).then(() => undefined), "Go · agents take it first",
    () => update({ ...owner, taskId: target._id, priority: target.priority }).then(() => undefined));
  const fine = (target: Card) => leave(target, "right", async () => undefined, "Carry on");
  const postpone = async (target: Card) => {
    if (busy.current || !target) return;
    if (target.status === "open" && target.priority !== 3) void update({ ...owner, taskId: target._id, priority: 3 }).catch(() => undefined);
    busy.current = true;
    setFly({ dx: 0, dy: window.innerHeight * 0.6, rotate: 0 });
    await new Promise((resolve) => setTimeout(resolve, FLY_MS));
    setFly(null);
    setDrag(null);
    setLater((list) => [...list.filter((id) => id !== target._id), target._id]);
    busy.current = false;
    say({ tone: "ok", text: "Later" });
  };
  const primary = (target: Card) => {
    if (target.status === "blocked") setSheet({ kind: "comment", intent: "answer" });
    else if (target.status === "done") void accept(target);
    else if (target.status === "open") void go(target);
    else void fine(target);
  };

  const sendComment = async (body: string) => {
    if (!card) return;
    const target = card;
    await comment({ ownerUserId, taskId: target._id, body, author: "owner" });
    setSheet(null);
    // An answer or a rework sends the card on its way; a note keeps it.
    if (sheet?.kind === "comment" && sheet.intent !== "note") void leave(target, "right", async () => undefined, sheet.intent === "answer" ? "Answered · reopened" : "Sent back for rework");
    else say({ tone: "ok", text: "Note sent" });
  };

  // Swipe: right is the primary answer, left discards, down is later.
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button > 0 || !card || fly) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ id: event.pointerId, x0: event.clientX, y0: event.clientY, dx: 0, dy: 0, moved: false });
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x0, dy = event.clientY - drag.y0;
    setDrag({ ...drag, dx, dy, moved: drag.moved || Math.hypot(dx, dy) > 8 });
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag || drag.id !== event.pointerId || !card) return;
    const { dx, dy, moved } = drag;
    setDrag(null);
    if (!moved) return;
    if (dx > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) primary(card);
    else if (dx < -SWIPE_PX && Math.abs(dx) > Math.abs(dy)) void discard(card);
    else if (dy > SWIPE_PX * 1.2) void postpone(card);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!card || sheet || isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "arrowright") { event.preventDefault(); primary(card); }
      else if (key === "arrowleft") { event.preventDefault(); void discard(card); }
      else if (key === "s" || key === " " || key === "arrowdown") { event.preventDefault(); void postpone(card); }
      else if (key === "enter") { event.preventDefault(); setSheet({ kind: "comment", intent: card.status === "blocked" ? "answer" : card.status === "done" ? "rework" : "note" }); }
      else if (key === "d") { event.preventDefault(); setSheet({ kind: "details" }); }
      else if (key === "z" && toast?.undo) { event.preventDefault(); void toast.undo(); setToast(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* ── Render ── */

  const hint = card ? card.status === "blocked" || card.status === "done" ? gistOf(card.result) || gistOf(card.brief) : gistOf(card.brief) || gistOf(card.result) : "";
  const dragging = drag?.moved ? drag : null;
  const cardStyle: CSSProperties = fly
    ? { transform: `translate(${fly.dx}px, ${fly.dy}px) rotate(${fly.rotate}deg)`, opacity: 0, transition: `transform ${FLY_MS}ms cubic-bezier(.4,0,.2,1), opacity ${FLY_MS}ms ease-in` }
    : dragging
      ? { transform: `translate(${dragging.dx}px, ${dragging.dy}px) rotate(${Math.max(-10, Math.min(10, dragging.dx * 0.04))}deg)`, cursor: "grabbing" }
      : { transform: "none", transition: "transform 280ms cubic-bezier(.2,.9,.3,1.2)" };
  const verdict = dragging ? (dragging.dx > SWIPE_PX ? "right" : dragging.dx < -SWIPE_PX ? "left" : dragging.dy > SWIPE_PX * 1.2 ? "down" : null) : null;
  const primaryLabel = card ? card.status === "blocked" ? "Answer" : card.status === "done" ? "Accept" : card.status === "open" ? "Go" : "Carry on" : "";

  const human = <div className="flex min-h-0 flex-1 flex-col">
    {cards === undefined
      ? <div className="grid flex-1 place-items-center py-32"><Loader2 className="animate-spin" size={18} style={{ color: "var(--lm-text-ghost)" }} aria-label="Loading" /></div>
      : !card
        ? <Empty counts={counts} />
        : <div className="flex min-h-0 flex-1 flex-col md:mx-auto md:w-full md:max-w-[760px]">
          {/* Progress: where in the deck, and the two cards behind the top one. */}
          <div className="flex items-center justify-between px-1 pb-2">
            <Micro color="var(--lm-text-ghost)">{String(index + 1).padStart(2, "0")} <span style={{ color: "var(--lm-text-ghost)" }}>/ {String(deck.length).padStart(2, "0")}</span></Micro>
            <div className="flex items-center gap-1">
              <button type="button" aria-label="Previous" disabled={index === 0} onClick={() => setIndex((at) => Math.max(0, at - 1))} className="grid h-7 w-7 place-items-center disabled:opacity-30" style={{ color: "var(--lm-text-tertiary)" }}><ChevronLeft size={15} /></button>
              <button type="button" aria-label="Next" disabled={index >= deck.length - 1} onClick={() => setIndex((at) => Math.min(deck.length - 1, at + 1))} className="grid h-7 w-7 place-items-center disabled:opacity-30" style={{ color: "var(--lm-text-tertiary)" }}><ChevronRight size={15} /></button>
            </div>
          </div>
          <div className="relative min-h-0 flex-1" style={{ minHeight: desktop ? 520 : 380 }}>
            {deck.slice(index + 1, index + 3).map((behind, depth) => <div key={behind._id} aria-hidden className="absolute inset-0 border"
              style={{ borderRadius: RADIUS, borderColor: "var(--lm-border)", background: "var(--lm-surface-1)", transform: `translateY(${(depth + 1) * 10}px) scale(${1 - (depth + 1) * 0.03})`, opacity: 0.7 - depth * 0.3, zIndex: 2 - depth, transformOrigin: "top center" }} />)}
            <article key={card._id} ref={undefined} aria-label={card.title}
              className="absolute inset-0 z-10 flex touch-none select-none flex-col overflow-hidden border"
              style={{ borderRadius: RADIUS, borderColor: verdict === "right" ? "var(--lm-coral)" : verdict === "left" ? "var(--lm-text-ghost)" : "var(--lm-border-strong)", background: "var(--lm-surface-0)", boxShadow: "var(--lm-shadow-lg)", cursor: "grab", ...cardStyle }}
              onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => setDrag(null)}>
              <div className="relative min-h-0 flex-1" style={{ flexBasis: card.thumbs.length ? "62%" : "46%" }}>
                <Hero card={card} compact={!desktop} />
                <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
                  <span className="pointer-events-auto"><CopyChip value={taskRef(card._id)} label={`task:…${card._id.slice(-5)}`} /></span>
                  <span className="flex items-center gap-1.5">
                    {showWorld && card.worldName && <span className="px-2 py-[5px] text-[10px] font-bold uppercase leading-none tracking-[0.12em] backdrop-blur" style={{ ...mono, borderRadius: RADIUS, background: SCRIM, color: "var(--lm-text-primary)", border: "1px solid var(--lm-border-strong)" }}>{card.worldName}</span>}
                    <span className="px-2 py-[5px] text-[10px] font-black uppercase leading-none tracking-[0.12em]" style={{ ...mono, borderRadius: RADIUS, background: card.status === "blocked" ? "var(--lm-coral)" : "var(--lm-ink)", color: "var(--lm-paper)" }}>{STATUS_WORD[card.status]}</span>
                  </span>
                </div>
                {verdict && <div className="pointer-events-none absolute inset-0 grid place-items-center" style={{ background: verdict === "right" ? "color-mix(in srgb, var(--lm-coral) 28%, transparent)" : "color-mix(in srgb, var(--lm-paper) 55%, transparent)" }}>
                  <span className="border-[3px] px-5 py-2 text-[28px] font-black uppercase tracking-[0.1em]" style={{ ...display, borderRadius: RADIUS, borderColor: verdict === "right" ? "var(--lm-coral)" : "var(--lm-text-primary)", color: verdict === "right" ? "var(--lm-coral)" : "var(--lm-text-primary)", transform: `rotate(${verdict === "right" ? -8 : verdict === "left" ? 8 : 0}deg)` }}>
                    {verdict === "right" ? primaryLabel : verdict === "left" ? "Discard" : "Later"}
                  </span>
                </div>}
              </div>
              <div className="flex min-h-0 flex-col gap-2 px-4 pb-4 pt-3 md:px-6 md:pb-5">
                {card.thumbs.length > 0 && <h2 className="text-[18px] font-black uppercase leading-[1.05] tracking-tight md:text-[22px]" style={{ ...display, textWrap: "balance" }}>{card.title}</h2>}
                {hint && <p className="line-clamp-3 text-[15px] leading-[1.45] md:text-[16px]" style={{ color: card.status === "blocked" ? "var(--lm-text-primary)" : "var(--lm-text-secondary)" }}>{hint}</p>}
                <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => setSheet({ kind: "details" })}
                  className="mt-auto inline-flex w-fit items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] opacity-70 hover:opacity-100" style={{ ...mono, color: STATUS_TONE[card.status] }}>
                  <FileText size={12} aria-hidden /> Read the whole thing <span className="hidden opacity-50 md:inline">D</span>
                </button>
              </div>
            </article>
            {toast && <div key={toast.key} role="status" aria-live="polite" className="absolute left-1/2 top-3 z-30 flex max-w-[94%] -translate-x-1/2 items-center gap-2 px-3 py-2 animate-fade-in"
              style={{ borderRadius: RADIUS, background: toast.tone === "error" ? "var(--lm-coral)" : "var(--lm-ink)", color: "var(--lm-paper)", boxShadow: "var(--lm-shadow-lg)" }}>
              {toast.tone === "ok" ? <Check size={13} aria-hidden /> : <X size={13} aria-hidden />}
              <span className="truncate text-[11px] font-black uppercase tracking-[0.1em]" style={mono}>{toast.text}</span>
              {toast.undo && <button type="button" onClick={() => { void toast.undo?.(); setToast(null); }} className="ml-1 inline-flex items-center gap-1 border-l pl-2 text-[10px] font-bold uppercase tracking-[0.1em]" style={{ ...mono, borderColor: "color-mix(in srgb, var(--lm-paper) 30%, transparent)" }}><Undo2 size={11} aria-hidden /> Undo</button>}
            </div>}
          </div>
          {/* Always on screen: what he can do with this card. */}
          <div className="mt-3 flex gap-2 md:mt-4">
            <Big icon={<X size={15} aria-hidden />} hint="←" onClick={() => void discard(card)} aria-label="Discard">Discard</Big>
            <Big icon={<Clock size={15} aria-hidden />} hint="S" onClick={() => void postpone(card)} aria-label="Later">Later</Big>
            {card.status === "done" && <Big icon={<RotateCcw size={15} aria-hidden />} onClick={() => setSheet({ kind: "comment", intent: "rework" })} aria-label="Send back for rework">Rework</Big>}
            {card.status !== "blocked" && card.status !== "done" && <Big icon={<MessageSquare size={15} aria-hidden />} hint="↵" onClick={() => setSheet({ kind: "comment", intent: "note" })} aria-label="Leave a note">Note</Big>}
            <Big grow tone={card.status === "blocked" ? "coral" : "ink"} hint="→" onClick={() => primary(card)} aria-label={primaryLabel}
              icon={card.status === "blocked" ? <MessageSquare size={15} aria-hidden /> : card.status === "done" ? <Check size={15} aria-hidden /> : card.status === "open" ? <Play size={15} aria-hidden /> : <ArrowRight size={15} aria-hidden />}>
              {primaryLabel}
            </Big>
          </div>
        </div>}
  </div>;

  const agent = <AgentView cards={deck} />;

  return <div className="flex min-h-0 flex-1 flex-col">
    {header?.(counts)}
    {view === "human" ? human : agent}
    <WorldViewToggle mode={view} onChange={changeView} />
    {sheet?.kind === "comment" && card && <CommentSheet key={card._id} intent={sheet.intent} title={card.title} onClose={() => setSheet(null)} onSend={sendComment} />}
    {sheet?.kind === "details" && card && <DetailsSheet ownerUserId={ownerUserId} taskId={card._id} showWorld={showWorld} onClose={() => setSheet(null)} />}
  </div>;
}

/* ── Empty ───────────────────────────────────────────────────────────────── */

function Empty({ counts }: { counts: { total: number; needsYou: number; done: number } }) {
  return <div className="mx-auto my-16 w-full max-w-md border px-6 py-16 text-center md:my-24" style={{ borderRadius: RADIUS, borderColor: "var(--lm-border)", borderStyle: "dashed" }}>
    <Check size={26} className="mx-auto" style={{ color: "var(--lm-coral)" }} aria-hidden />
    <p className="mt-4 text-[22px] font-black uppercase tracking-tight" style={display}>Nothing needs you</p>
    <p className="mx-auto mt-2 max-w-xs text-[13px] leading-5" style={{ color: "var(--lm-text-tertiary)" }}>
      {counts.total === 0 ? "The queue is clear. Comment on a picture or answer a Decision and a card appears here." : "You have been through every card. New ones appear as agents finish or ask."}
    </p>
  </div>;
}

/* ── AGENT view: the markdown each card is ──────────────────────────────── */

function AgentView({ cards }: { cards: Card[] }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (id: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(id); setTimeout(() => setCopied(null), 1200); } catch { /* refused */ }
  };
  const all = cards.map((card) => taskToMarkdown(card)).join("\n\n---\n\n");
  return <div className="mx-auto w-full max-w-[860px] pb-24">
    <div className="mb-3 flex items-center justify-between px-1">
      <Micro color="var(--lm-text-ghost)">{cards.length} tasks · what list_tasks returns, as markdown</Micro>
      <button type="button" onClick={() => void copy("all", all)} className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ ...mono, color: "var(--lm-text-secondary)" }}>
        {copied === "all" ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />} Copy all
      </button>
    </div>
    <div className="flex flex-col gap-3">
      {cards.map((card) => <section key={card._id} className="relative border" style={{ borderRadius: RADIUS, borderColor: "var(--lm-border)", background: "var(--lm-surface-1)" }}>
        <button type="button" onClick={() => void copy(card._id, taskToMarkdown(card))} aria-label="Copy this task as markdown"
          className="absolute right-2 top-2 inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em]" style={{ ...mono, borderRadius: RADIUS, background: "var(--lm-surface-2)", color: "var(--lm-text-secondary)" }}>
          {copied === card._id ? <Check size={11} aria-hidden /> : <Copy size={11} aria-hidden />} Copy
        </button>
        <pre className="overflow-x-auto whitespace-pre-wrap break-words px-4 py-4 text-[12.5px] leading-[1.6]" style={{ ...mono, color: "var(--lm-text-primary)" }}>{taskToMarkdown(card)}</pre>
      </section>)}
      {cards.length === 0 && <p className="px-1 text-[12px]" style={{ ...mono, color: "var(--lm-text-ghost)" }}>No active tasks.</p>}
    </div>
  </div>;
}

/* ── Sheets ──────────────────────────────────────────────────────────────── */

function SheetFrame({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center" style={{ background: "color-mix(in srgb, var(--lm-paper) 70%, transparent)", backdropFilter: "blur(6px)" }} onClick={onClose}>
    <div role="dialog" aria-label={title} onClick={(event) => event.stopPropagation()}
      className={`flex max-h-[92dvh] w-full flex-col overflow-hidden border md:max-h-[86dvh] ${wide ? "md:max-w-[720px]" : "md:max-w-[560px]"}`}
      style={{ borderRadius: `${RADIUS} ${RADIUS} 0 0`, borderColor: "var(--lm-border-strong)", background: "var(--lm-surface-0)", boxShadow: "var(--lm-shadow-lg)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      {children}
    </div>
  </div>;
}

const INTENT: Record<"answer" | "rework" | "note", { title: string; placeholder: string; button: string }> = {
  answer: { title: "Your answer", placeholder: "Tell the agent. It reopens the task and carries on.", button: "Answer" },
  rework: { title: "Send it back", placeholder: "What is wrong, what to change. The task reopens for rework.", button: "Rework" },
  note: { title: "A note for the agent", placeholder: "Steer the work. The task stays as it is.", button: "Send" },
};

function CommentSheet({ intent, title, onClose, onSend }: { intent: "answer" | "rework" | "note"; title: string; onClose: () => void; onSend: (body: string) => Promise<void> }) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const copy = INTENT[intent];
  const send = async () => {
    if (!draft.trim() || busy) return;
    setBusy(true); setError(undefined);
    try { await onSend(draft.trim()); } catch (failure) { setError(errorText(failure, "Not sent.")); setBusy(false); }
  };
  return <SheetFrame title={copy.title} onClose={onClose}>
    <header className="flex items-start justify-between gap-3 px-5 pt-5">
      <div className="min-w-0">
        <Micro color={intent === "answer" ? "var(--lm-coral)" : undefined}>{copy.title}</Micro>
        <p className="mt-1 truncate text-[14px] font-black uppercase tracking-tight" style={display}>{title}</p>
      </div>
      <button type="button" onClick={onClose} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center" style={{ color: "var(--lm-text-tertiary)" }}><X size={16} aria-hidden /></button>
    </header>
    <div className="px-5 pb-5 pt-4">
      <textarea autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} rows={5} maxLength={TASK_LIMITS.comment} placeholder={copy.placeholder}
        onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send(); } }}
        className="w-full resize-none px-3 py-3 text-[16px] leading-6 outline-none" style={{ ...display, borderRadius: RADIUS, background: "var(--lm-surface-1)", border: "1px solid var(--lm-border-strong)", color: "var(--lm-text-primary)" }} />
      <div className="mt-3 flex items-center gap-2">
        <Micro color="var(--lm-text-ghost)" className="normal-case tracking-normal" style={{ textTransform: "none" }}>⌘↵ sends</Micro>
        <span className="flex-1" />
        <Big tone={intent === "answer" ? "coral" : "ink"} className="!h-12 !flex-none px-6" disabled={!draft.trim() || busy} onClick={() => void send()} icon={busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <ArrowRight size={14} aria-hidden />}>{copy.button}</Big>
      </div>
      {error && <p className="mt-2 text-[12px]" style={{ color: "var(--lm-status-error)" }}>{error}</p>}
    </div>
  </SheetFrame>;
}

function DetailsSheet({ ownerUserId, taskId, showWorld, onClose }: { ownerUserId: string; taskId: Id<"tasks">; showWorld: boolean; onClose: () => void }) {
  return <SheetFrame title="Task" onClose={onClose} wide>
    <div className="min-h-0 flex-1 overflow-hidden" style={{ height: "86dvh" }}>
      <TaskPanel ownerUserId={ownerUserId} taskId={taskId} onClose={onClose} showWorld={showWorld} />
    </div>
  </SheetFrame>;
}

/* ── The /tasks page ─────────────────────────────────────────────────────── */

export function TasksDeckHome({ ownerUserId, ArchiveIcon = Archive }: { ownerUserId: string; ArchiveIcon?: typeof Archive }) {
  const { isAuthenticated } = useConvexAuth();
  const [world, setWorld] = useState<Id<"folders"> | null>(null);
  const [initialTaskId] = useState<string | undefined>(() =>
    typeof window === "undefined" ? undefined : new URLSearchParams(window.location.search).get("task")?.replace(/^task:/, "") ?? undefined);
  const counts = useQuery(api.tasks.countOpenTasks, isAuthenticated ? { ownerUserId } : "skip");
  const worlds = (counts ?? []).filter((row) => row.worldFolderId);
  void ArchiveIcon;
  return <main className="flex min-h-dvh flex-col px-4 pb-4 md:px-8" style={{ background: "var(--lm-paper)", color: "var(--lm-text-primary)", paddingTop: "max(12px, env(safe-area-inset-top))" }}>
    <ReviewDeck key={String(world)} ownerUserId={ownerUserId} worldFolderId={world ?? undefined} initialTaskId={initialTaskId} showWorld={world === null}
      header={({ total, needsYou, done }) => <header className="mx-auto mb-3 flex w-full max-w-[760px] flex-wrap items-end justify-between gap-3 md:mb-4">
        <div className="min-w-0">
          <h1 className="text-[28px] font-black uppercase leading-none tracking-tight md:text-[34px]" style={display}>Review</h1>
          <Micro className="mt-1.5 block">
            {needsYou ? <><span style={{ color: "var(--lm-coral)" }}>{needsYou} need you</span> · </> : null}{done ? `${done} to accept · ` : ""}{total} cards
          </Micro>
        </div>
        {worlds.length > 1 && <div className="flex flex-wrap gap-1.5" role="group" aria-label="World">
          <button type="button" className="lm-chip" data-active={world === null ? "true" : undefined} style={{ borderRadius: RADIUS }} onClick={() => setWorld(null)}>All</button>
          {worlds.map((row) => <button key={row.worldFolderId} type="button" className="lm-chip" data-active={world === row.worldFolderId ? "true" : undefined} style={{ borderRadius: RADIUS }} onClick={() => setWorld(row.worldFolderId!)}>
            {row.worldName}{row.blocked ? <span className="ml-1 tabular-nums" style={{ color: "var(--lm-coral)" }}>{row.blocked}</span> : null}
          </button>)}
        </div>}
      </header>} />
  </main>;
}
