"use client";

import {
  Component, useCallback, useEffect, useMemo, useRef, useState,
  type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode,
} from "react";
import Link from "next/link";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  ArrowLeft, Check, ChevronLeft, ChevronRight, Layers, LayoutGrid, Loader2, Maximize2, MessageSquare, Mic, Redo2,
  ScrollText, SkipForward, Star, Trash2, Undo2, X,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  INBOX_CARD_LABEL, INBOX_TARGET_KIND_LABEL, formatUsd, inboxProgress, nextOpenIndex, shortAssetId,
  type InboxCardType, type InboxChoice,
} from "@/lib/inbox";
import { deleteAssetSelection } from "@/lib/bulk-delete";
import { ActionButton, CopyChip, Hotkey, Micro, RADIUS, SCRIM, display, errorText, mono } from "./inbox-ui";
import { NoteSheet, type ImageNote } from "./note-sheet";
import { ZoomViewer } from "./zoom-viewer";

type View = FunctionReturnType<typeof api.inbox.getInboxStack>;
type Card = View["cards"][number];
type CardAsset = Card["assets"][number];
type Target = NonNullable<Card["targets"]>[number];
type DecisionRow = FunctionReturnType<typeof api.inbox.listInboxDecisions>[number];
// A decision as the screen sees it: the server row or an unconfirmed answer.
type Live = Partial<Omit<DecisionRow, "cardId">> & { cardId: Id<"inboxCards"> };
type Answer = {
  choice: InboxChoice; targetHotkey?: number; pickedAssetId?: Id<"assets">;
  coverAssetId?: Id<"assets">; deleteAssetIds?: Id<"assets">[];
};
type Step = { cardId: Id<"inboxCards">; before: Answer | null; after: Answer };
type Toast = { key: number; text: string; detail?: string; tone: "ok" | "error" };
type Fly = { dx: number; dy: number; scale: number };
type Zoom = { asset: CardAsset; defect?: { x: number; y: number; w: number; h: number } };
type NoteTarget = { kind: "image"; assetId: Id<"assets"> } | { kind: "card" };

const FLY_MS = 230;
const DRAG_THRESHOLD = 7;

const DEFAULT_QUESTION: Record<InboxCardType, string> = {
  sort: "Where does this go?",
  duplicates: "These images look like the same picture.",
  artifact: "A defect was found in this image.",
  ab: "Which one?",
  choose: "Choose one.",
  rule: "Make this a rule?",
};

const answerOf = (row: Live | undefined): Answer | null => row?.choice ? {
  choice: row.choice, targetHotkey: row.targetHotkey, pickedAssetId: row.pickedAssetId,
  coverAssetId: row.coverAssetId, deleteAssetIds: row.deleteAssetIds,
} : null;

const sameAnswer = (a: Answer | null, b: Answer | null) =>
  a?.choice === b?.choice && a?.targetHotkey === b?.targetHotkey && a?.pickedAssetId === b?.pickedAssetId
  && a?.coverAssetId === b?.coverAssetId && (a?.deleteAssetIds ?? []).join() === (b?.deleteAssetIds ?? []).join();

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

// One short label for an answer, on tiles and in toasts.
const answerLabel = (card: Card, answer: Answer | null) => {
  if (!answer) return undefined;
  const indexOf = (assetId?: string) => card.assets.findIndex((asset) => asset.assetId === assetId);
  switch (answer.choice) {
    case "target": {
      const target = card.targets?.find((entry) => entry.hotkey === answer.targetHotkey);
      return target ? `${target.hotkey} · ${target.label}` : "Target";
    }
    case "skip": return "Later";
    case "keep-all": return "Keep all";
    case "stack": return answer.deleteAssetIds?.length ? `Stacked · deleted ${answer.deleteAssetIds.length}` : "Stacked";
    case "resolve": return `Deleted ${answer.deleteAssetIds?.length ?? 0}`;
    case "fix": return "Fix";
    case "keep": return "Keep as is";
    case "out": return "Out";
    case "winner": return card.labels?.[indexOf(answer.pickedAssetId)] || (indexOf(answer.pickedAssetId) === 0 ? "A" : "B");
    case "neither": return "Neither";
    case "pick": return `Picked ${indexOf(answer.pickedAssetId) + 1}`;
    case "yes": return "Yes";
    case "no": return "No";
    case "not-yet": return "Not yet";
  }
};

class StackBoundary extends Component<{ children: ReactNode; backHref: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="grid min-h-dvh place-items-center px-6 text-center" style={{ background: "var(--lm-paper)", color: "var(--lm-text-primary)" }}>
      <div>
        <p className="text-lg font-black uppercase tracking-tight" style={display}>This stack is no longer here</p>
        <p className="mx-auto mt-2 max-w-xs text-xs leading-5" style={{ color: "var(--lm-text-tertiary)" }}>It was deleted, or it belongs to another account.</p>
        <Link href={this.props.backHref} className="mt-5 inline-block"><ActionButton icon={<ArrowLeft size={13} />}>Back to the Inbox</ActionButton></Link>
      </div>
    </main>;
  }
}

export function InboxStackScreen({ ownerUserId, worldId, stackId }: { ownerUserId: string; worldId: string; stackId: string }) {
  return <StackBoundary backHref={`/inbox/${worldId}`}>
    <StackLoader ownerUserId={ownerUserId} worldId={worldId} stackId={stackId as Id<"inboxStacks">} />
  </StackBoundary>;
}

function StackLoader({ ownerUserId, worldId, stackId }: { ownerUserId: string; worldId: string; stackId: Id<"inboxStacks"> }) {
  const { isAuthenticated } = useConvexAuth();
  const args = isAuthenticated ? { ownerUserId, stackId } : "skip";
  const view = useQuery(api.inbox.getInboxStack, args);
  const rows = useQuery(api.inbox.listInboxDecisions, args);
  const notes = useQuery(api.inbox.listInboxNotes, args);
  if (!view || !rows) {
    return <main className="grid min-h-dvh place-items-center" style={{ background: "var(--lm-paper)" }}>
      <Loader2 className="animate-spin" size={18} style={{ color: "var(--lm-text-ghost)" }} aria-label="Loading stack" />
    </main>;
  }
  return <Stack ownerUserId={ownerUserId} worldId={worldId} view={view} rows={rows} notes={notes ?? []} />;
}

function Stack({ ownerUserId, worldId, view, rows, notes }: {
  ownerUserId: string; worldId: string; view: View; rows: DecisionRow[];
  notes: FunctionReturnType<typeof api.inbox.listInboxNotes>;
}) {
  const { stack, cards } = view;
  const decide = useMutation(api.inbox.decideInboxCard);
  const clear = useMutation(api.inbox.clearInboxDecision);
  const recordDeletions = useMutation(api.inbox.recordInboxDeletions);
  const open = stack.status === "open";

  const [pending, setPending] = useState<Map<string, Answer | null>>(new Map());
  const decisions = useMemo(() => {
    const map = new Map<string, Live>(rows.map((row) => [row.cardId, row]));
    for (const [cardId, answer] of pending) {
      const base: Live = map.get(cardId) ?? { cardId: cardId as Id<"inboxCards"> };
      map.set(cardId, answer ? { ...base, ...answer } : { ...base, choice: undefined, targetHotkey: undefined, pickedAssetId: undefined, coverAssetId: undefined, deleteAssetIds: undefined });
    }
    return map;
  }, [rows, pending]);
  const notesOf = useMemo(() => new Map<string, ImageNote[]>(notes.map((row) => [row.assetId, row.notes])), [notes]);

  const ids = useMemo(() => cards.map((card) => card._id as string), [cards]);
  const progress = inboxProgress(ids, [...decisions.values()]);
  const [index, setIndex] = useState(() => Math.max(0, nextOpenIndex(ids, decisions, -1)));
  const [reviewing, setReviewing] = useState(false);
  const [gridOpen, setGridOpen] = useState(false);
  const [zoom, setZoom] = useState<Zoom | null>(null);
  const [note, setNote] = useState<NoteTarget | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [undoStack, setUndoStack] = useState<Step[]>([]);
  const [redoStack, setRedoStack] = useState<Step[]>([]);
  const [fly, setFly] = useState<Fly | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const zones = useRef(new Map<number, HTMLElement>());
  const cardRef = useRef<HTMLDivElement>(null);
  const busy = useRef(false);

  const done = progress.pending === 0 && !reviewing;
  const card: Card | undefined = cards[Math.min(index, cards.length - 1)];
  const live = card ? decisions.get(card._id) : undefined;
  const current = answerOf(live);

  // Duplicates: which images are marked to delete, and the stack's cover.
  const [marks, setMarks] = useState<Set<string>>(new Set());
  const [cover, setCover] = useState<string | undefined>();
  const [confirm, setConfirm] = useState<"stack" | "resolve" | null>(null);
  useEffect(() => {
    // Opening a card shows its last answer: the marks and cover it was given.
    setMarks(new Set(live?.deleteAssetIds ?? []));
    setCover(live?.coverAssetId ?? card?.assets.find((asset) => !asset.missing)?.assetId);
    setConfirm(null);
    // Only when the card on screen changes, not on every decision update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?._id]);

  const say = useCallback((next: Omit<Toast, "key">) => setToast({ ...next, key: Date.now() }), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.tone === "error" ? 4200 : 2000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Preload the images of the next two cards.
  useEffect(() => {
    let from = index;
    for (let n = 0; n < 2; n += 1) {
      const next = nextOpenIndex(ids, decisions, from);
      if (next < 0 || next === index) break;
      for (const asset of cards[next]?.assets ?? []) {
        const src = asset.thumbUrl ?? asset.url;
        if (src) { const image = new Image(); image.decoding = "async"; image.src = src; }
      }
      from = next;
    }
  }, [cards, decisions, ids, index]);

  const send = useCallback(async (cardId: Id<"inboxCards">, answer: Answer | null) => {
    setPending((map) => new Map(map).set(cardId, answer));
    try {
      if (!answer) {
        await clear({ ownerUserId, cardId });
        return { effects: ["back to open"], deleted: 0 };
      }
      const result = await decide({ ownerUserId, cardId, ...answer });
      let deleted = 0;
      if (result.deleteAssetIds.length > 0) {
        // Real deletion through the gallery's own admin-checked delete route.
        const outcomes = await deleteAssetSelection(result.deleteAssetIds);
        const gone = outcomes.filter((outcome) => outcome.ok).map((outcome) => outcome.assetId as Id<"assets">);
        if (gone.length) await recordDeletions({ ownerUserId, cardId, deletedAssetIds: gone });
        deleted = gone.length;
        const failed = outcomes.find((outcome) => !outcome.ok);
        if (failed && !failed.ok) throw new Error(`Deleted ${gone.length} of ${outcomes.length}: ${failed.error}`);
      }
      return { effects: result.effects, deleted };
    } finally {
      setPending((map) => { const next = new Map(map); next.delete(cardId); return next; });
    }
  }, [clear, decide, ownerUserId, recordDeletions]);

  // Answer the card on screen, then move to the next open one.
  const commit = useCallback(async (answer: Answer, flyTo?: HTMLElement) => {
    if (!card || !open || busy.current) return;
    if (answer.choice === "target" && card.targets?.find((entry) => entry.hotkey === answer.targetHotkey)?.missing) {
      say({ tone: "error", text: "That target is gone" });
      return;
    }
    const before = current;
    if (sameAnswer(before, answer)) {
      setIndex((at) => { const next = nextOpenIndex(ids, decisions, at); return next < 0 ? at : next; });
      return;
    }
    busy.current = true;
    setConfirm(null);
    const cardRect = cardRef.current?.getBoundingClientRect();
    if (cardRect && flyTo) {
      const rect = flyTo.getBoundingClientRect();
      setFly({ dx: rect.left + rect.width / 2 - (cardRect.left + cardRect.width / 2), dy: rect.top + rect.height / 2 - (cardRect.top + cardRect.height / 2), scale: 0.16 });
    } else if (cardRect) {
      setFly({ dx: answer.choice === "skip" ? -cardRect.width * 1.1 : 0, dy: answer.choice === "skip" ? 0 : -24, scale: answer.choice === "skip" ? 0.9 : 0.97 });
    }
    const request = send(card._id, answer);
    await new Promise((resolve) => setTimeout(resolve, FLY_MS));
    setFly(null);
    setHover(null);
    setUndoStack((stack) => [...stack.slice(-199), { cardId: card._id, before, after: answer }]);
    setRedoStack([]);
    setReviewing(false);
    const after = new Map(decisions).set(card._id, { cardId: card._id, ...answer });
    const nextIndex = nextOpenIndex(ids, after, index);
    if (nextIndex >= 0) setIndex(nextIndex);
    busy.current = false;
    try {
      const result = await request;
      say({ tone: "ok", text: answerLabel(card, answer) ?? "Done", detail: result.deleted ? `${result.deleted} deleted for good` : result.effects.find((effect) => !effect.startsWith("recorded")) });
    } catch (failure) {
      setIndex(ids.indexOf(card._id));
      say({ tone: "error", text: errorText(failure, "That answer was not saved.") });
    }
  }, [card, current, decisions, ids, index, open, say, send]);

  const undo = useCallback(async () => {
    if (!open || busy.current) return;
    let step = undoStack.at(-1);
    if (!step) {
      // After a reload the stack of steps is empty: take back the latest answer.
      const latest = [...decisions.values()].filter((row) => row.choice).sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0))[0];
      const answer = answerOf(latest);
      if (!latest || !answer) { say({ tone: "error", text: "Nothing to undo" }); return; }
      step = { cardId: latest.cardId, before: null, after: answer };
    } else {
      setUndoStack((stack) => stack.slice(0, -1));
    }
    const taken = step;
    setRedoStack((stack) => [...stack, taken]);
    setIndex(ids.indexOf(taken.cardId));
    setReviewing(true);
    const target = cards.find((entry) => entry._id === taken.cardId);
    try {
      await send(taken.cardId, taken.before);
      const deletedForGood = decisions.get(taken.cardId)?.deletedAssetIds?.length ?? 0;
      say({ tone: "ok", text: "Undone", detail: deletedForGood ? `${deletedForGood} deleted image${deletedForGood === 1 ? "" : "s"} stay deleted` : taken.before && target ? answerLabel(target, taken.before) : "Back to open" });
    } catch (failure) {
      say({ tone: "error", text: errorText(failure, "Undo failed.") });
    }
  }, [cards, decisions, ids, open, say, send, undoStack]);

  const redo = useCallback(async () => {
    const step = redoStack.at(-1);
    if (!open || !step || busy.current) return;
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack, step]);
    try {
      await send(step.cardId, step.after);
      const after = new Map(decisions).set(step.cardId, { cardId: step.cardId, ...step.after });
      const next = nextOpenIndex(ids, after, ids.indexOf(step.cardId));
      if (next >= 0) setIndex(next);
      setReviewing(false);
      const target = cards.find((entry) => entry._id === step.cardId);
      say({ tone: "ok", text: "Redone", detail: target ? answerLabel(target, step.after) : undefined });
    } catch (failure) {
      say({ tone: "error", text: errorText(failure, "Redo failed.") });
    }
  }, [cards, decisions, ids, open, redoStack, say, send]);

  const browse = useCallback((delta: number) => {
    if (cards.length === 0) return;
    setIndex((at) => (at + delta + cards.length) % cards.length);
    setReviewing(true);
  }, [cards.length]);

  // Duplicates actions; deleting asks once per group. An image already gone
  // is neither kept nor marked.
  const present = new Set(card?.assets.filter((asset) => !asset.missing).map((asset) => asset.assetId as string) ?? []);
  const activeMarks = new Set([...marks].filter((assetId) => present.has(assetId)));
  const kept = card ? card.assets.filter((asset) => !asset.missing && !activeMarks.has(asset.assetId)) : [];
  const stackCover = cover && present.has(cover) && !activeMarks.has(cover) ? cover : kept[0]?.assetId;
  const dupAnswer = (choice: "stack" | "resolve" | "keep-all"): Answer => ({
    choice, deleteAssetIds: choice === "keep-all" ? undefined : activeMarks.size ? [...activeMarks] as Id<"assets">[] : undefined,
    coverAssetId: choice === "stack" ? stackCover as Id<"assets"> : undefined,
  });
  const runDuplicates = (choice: "stack" | "resolve" | "keep-all") => {
    if (choice === "keep-all") return void commit(dupAnswer("keep-all"));
    if (choice === "stack" && kept.length < 2) return say({ tone: "error", text: "A stack needs two images that stay" });
    if (choice === "resolve" && activeMarks.size === 0) return say({ tone: "error", text: "Mark the images to delete first" });
    if (activeMarks.size > 0 && confirm !== choice) return setConfirm(choice);
    void commit(dupAnswer(choice));
  };
  const toggleMark = (assetId: string) => {
    setConfirm(null);
    setMarks((set) => {
      const next = new Set(set);
      if (next.has(assetId)) next.delete(assetId);
      else if (kept.length > 1) next.add(assetId);
      return next;
    });
  };

  const singleImage = card?.type === "sort" || card?.type === "artifact";
  const openNote = () => {
    if (!card || !open) return;
    if (singleImage && card.assets[0] && !card.assets[0].missing) setNote({ kind: "image", assetId: card.assets[0].assetId });
    else setNote({ kind: "card" });
  };
  const firstImage = card?.assets.find((asset) => !asset.missing);

  // Keys: S / Space skip, Z / ⌘Z undo, ⇧Z redo, Enter comment, F zoom, ←/→
  // browse, and the numbers each card shows on its answers.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (zoom || note || isTyping(event.target) || event.altKey || !card) return;
      const key = event.key.toLowerCase();
      if (key === "z") { event.preventDefault(); void (event.shiftKey ? redo() : undo()); return; }
      if (event.metaKey || event.ctrlKey) return;
      if (key === "escape") { if (confirm) setConfirm(null); else if (gridOpen) setGridOpen(false); return; }
      if (key === "s" || key === " ") { event.preventDefault(); void commit({ choice: "skip" }); return; }
      if (key === "enter") { event.preventDefault(); openNote(); return; }
      if (key === "f" && firstImage) { event.preventDefault(); setZoom({ asset: firstImage, defect: card.evidence?.defect?.box }); return; }
      if (key === "arrowleft") { event.preventDefault(); browse(-1); return; }
      if (key === "arrowright") { event.preventDefault(); browse(1); return; }
      const digit = /^Digit([1-9])$/.exec(event.code)?.[1];
      const n = digit ? Number(digit) : undefined;
      switch (card.type) {
        case "sort":
          if (n && card.targets?.some((entry) => entry.hotkey === n)) { event.preventDefault(); void commit({ choice: "target", targetHotkey: n }, zones.current.get(n)); }
          break;
        case "artifact":
          if (n && n <= 3) { event.preventDefault(); void commit({ choice: (["fix", "keep", "out"] as const)[n - 1] }); }
          break;
        case "rule":
          if (n && n <= 3) { event.preventDefault(); void commit({ choice: (["yes", "no", "not-yet"] as const)[n - 1] }); }
          break;
        case "ab":
          if (n === 1 || n === 2) { event.preventDefault(); const asset = card.assets[n - 1]; if (asset && !asset.missing) void commit({ choice: "winner", pickedAssetId: asset.assetId }); }
          if (n === 3 || key === "n") { event.preventDefault(); void commit({ choice: "neither" }); }
          break;
        case "choose":
          if (n && card.assets[n - 1] && !card.assets[n - 1]!.missing) { event.preventDefault(); void commit({ choice: "pick", pickedAssetId: card.assets[n - 1]!.assetId }); }
          break;
        case "duplicates": {
          const asset = n ? card.assets[n - 1] : undefined;
          if (asset && !asset.missing) { event.preventDefault(); if (event.shiftKey) setCover(asset.assetId); else toggleMark(asset.assetId); }
          else if (key === "k") { event.preventDefault(); runDuplicates("keep-all"); }
          else if (key === "g") { event.preventDefault(); runDuplicates("stack"); }
          else if (key === "d") { event.preventDefault(); runDuplicates("resolve"); }
          break;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const comment = live && (live.commentText || live.audioUrl) ? live : undefined;
  const imageNotes = singleImage && card?.assets[0] ? notesOf.get(card.assets[0].assetId) ?? [] : [];
  const hasNote = singleImage ? imageNotes.some((entry) => entry.author === "owner") : Boolean(comment);
  const position = card ? ids.indexOf(card._id) + 1 : 0;
  const cardStyle: CSSProperties = fly
    ? { transform: `translate(${fly.dx}px, ${fly.dy}px) scale(${fly.scale})`, opacity: 0.15, transition: `transform ${FLY_MS}ms cubic-bezier(.4,0,.2,1), opacity ${FLY_MS}ms ease-in` }
    : { transform: "none", transition: "transform 260ms cubic-bezier(.2,.9,.3,1.25), opacity 160ms ease-out" };

  const tileProps = (asset: CardAsset) => ({
    asset, notes: notesOf.get(asset.assetId),
    onZoom: () => setZoom({ asset }),
    onNote: open ? () => setNote({ kind: "image", assetId: asset.assetId }) : undefined,
  });

  return <main className="flex h-dvh flex-col overflow-hidden" style={{ background: "var(--lm-paper)", color: "var(--lm-text-primary)", overscrollBehavior: "none" }}>
    <header className="shrink-0 px-4 pt-3 md:px-6" style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}>
      <div className="flex items-center gap-3">
        <Link href={`/inbox/${worldId}`} aria-label={`${view.worldName} Inbox`} className="grid h-9 w-9 shrink-0 place-items-center border"
          style={{ borderRadius: RADIUS, borderColor: "var(--lm-border-strong)", color: "var(--lm-text-secondary)" }}>
          <ArrowLeft size={16} aria-hidden />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-black uppercase leading-tight tracking-tight" style={display}>{stack.title}</p>
          <Micro color="var(--lm-text-ghost)" className="block truncate">
            {[view.worldName, card ? INBOX_CARD_LABEL[card.type] : undefined, stack.agent, open ? undefined : "Closed"].filter(Boolean).join(" · ")}
          </Micro>
        </div>
        <button type="button" onClick={() => setGridOpen(true)} aria-label="All cards" title="All cards"
          className="flex h-9 items-center gap-2 border px-2.5" style={{ borderRadius: RADIUS, borderColor: "var(--lm-border-strong)" }}>
          <span className="text-[12px] font-bold tabular-nums" style={mono}>
            {String(progress.decided).padStart(2, "0")}<span style={{ color: "var(--lm-text-ghost)" }}> / {String(progress.total).padStart(2, "0")}</span>
          </span>
          <LayoutGrid size={14} style={{ color: "var(--lm-text-tertiary)" }} aria-hidden />
        </button>
      </div>
      <div className="mt-3 h-[3px] w-full" style={{ background: "var(--lm-border)" }} aria-hidden>
        <div className="h-full transition-[width] duration-300" style={{ width: `${progress.total ? (progress.decided / progress.total) * 100 : 0}%`, background: "var(--lm-coral)" }} />
      </div>
      {!done && card && <>
        <p className="mt-3 text-[17px] font-bold leading-snug md:text-[20px]" style={display}>{card.question ?? DEFAULT_QUESTION[card.type]}</p>
        <Evidence card={card} />
      </>}
      {done && stack.note && <p className="mt-3 text-[12px] leading-5" style={{ color: "var(--lm-text-tertiary)" }}>{stack.note}</p>}
    </header>

    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto] gap-3 px-4 pb-3 pt-3 md:grid-cols-[minmax(0,1fr)_340px] md:grid-rows-1 md:gap-6 md:px-6 md:pb-6"
      style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
      <section className="relative flex min-h-0 flex-col">
        {done ? <DoneView view={view} decisions={decisions} onOpen={(at) => { setIndex(at); setReviewing(true); }} />
          : card && <>
            <div ref={cardRef} key={card._id} className="relative flex min-h-0 flex-1 flex-col" style={cardStyle}
              aria-label={`Card ${position} of ${cards.length}`}>
              {card.type === "sort" && <SortCard asset={card.assets[0]!} answer={current} card={card} open={open} hover={hover} setHover={setHover}
                zones={zones} onZoom={() => setZoom({ asset: card.assets[0]! })} onDrop={(hotkey) => void commit({ choice: "target", targetHotkey: hotkey }, zones.current.get(hotkey))} />}
              {card.type === "artifact" && <ArtifactCard asset={card.assets[0]!} card={card} onZoom={() => setZoom({ asset: card.assets[0]!, defect: card.evidence?.defect?.box })} />}
              {card.type === "ab" && <TileGrid cols={tileColumns(card.assets)}>
                {card.assets.map((asset, at) => <Tile key={asset.assetId} {...tileProps(asset)} badge={card.labels?.[at] || (at === 0 ? "A" : "B")} hotkey={at + 1}
                  chosen={current?.choice === "winner" && current.pickedAssetId === asset.assetId}
                  onPick={open && !asset.missing ? () => void commit({ choice: "winner", pickedAssetId: asset.assetId }) : undefined} tall />)}
              </TileGrid>}
              {card.type === "choose" && <TileGrid cols={tileColumns(card.assets)}>
                {card.assets.map((asset, at) => <Tile key={asset.assetId} {...tileProps(asset)} hotkey={at < 9 ? at + 1 : undefined} badge={at >= 9 ? String(at + 1) : undefined}
                  chosen={current?.choice === "pick" && current.pickedAssetId === asset.assetId}
                  onPick={open && !asset.missing ? () => void commit({ choice: "pick", pickedAssetId: asset.assetId }) : undefined} />)}
              </TileGrid>}
              {card.type === "duplicates" && <TileGrid cols={tileColumns(card.assets)}>
                {card.assets.map((asset, at) => <Tile key={asset.assetId} {...tileProps(asset)} hotkey={at + 1}
                  marked={activeMarks.has(asset.assetId)} isCover={stackCover === asset.assetId}
                  deleted={decisions.get(card._id)?.deletedAssetIds?.includes(asset.assetId)}
                  onToggleMark={open && !asset.missing ? () => toggleMark(asset.assetId) : undefined}
                  onCover={open && !asset.missing && !activeMarks.has(asset.assetId) ? () => setCover(asset.assetId) : undefined} />)}
              </TileGrid>}
              {card.type === "rule" && <RuleCard card={card} tile={(asset) => <Tile key={asset.assetId} {...tileProps(asset)} />} />}
            </div>
            {toast && <div key={toast.key} role="status" aria-live="polite"
              className="pointer-events-none absolute left-1/2 top-3 z-40 flex max-w-[92%] -translate-x-1/2 items-center gap-2 px-3 py-2 animate-fade-in"
              style={{ borderRadius: RADIUS, background: toast.tone === "error" ? "var(--lm-coral)" : "var(--lm-ink)", color: "var(--lm-paper)", boxShadow: "var(--lm-shadow-lg)" }}>
              {toast.tone === "ok" ? <Check size={13} aria-hidden /> : <X size={13} aria-hidden />}
              <span className="truncate text-[11px] font-black uppercase tracking-[0.1em]" style={mono}>{toast.text}</span>
              {toast.detail && <span className="truncate text-[10px] uppercase tracking-[0.1em] opacity-70" style={mono}>{toast.detail}</span>}
            </div>}
          </>}

        {!done && card && <div className="mt-3 grid shrink-0 grid-cols-[auto_1fr_auto] items-center gap-2">
          <div className="flex gap-1.5">
            <ActionButton aria-label="Undo (Z)" title="Undo (Z)" disabled={!open} onClick={() => void undo()} className="h-10 w-11 px-0"><Undo2 size={15} aria-hidden /></ActionButton>
            <span className="hidden md:flex"><ActionButton aria-label="Redo (Shift+Z)" title="Redo (Shift+Z)" disabled={!open || redoStack.length === 0} onClick={() => void redo()} className="h-10 w-11 px-0"><Redo2 size={15} aria-hidden /></ActionButton></span>
          </div>
          <ActionButton tone={hasNote ? "coral" : "ghost"} disabled={!open} onClick={openNote} className="h-10" title="Comment (Enter)"
            icon={comment?.audioUrl && !comment.commentText ? <Mic size={14} aria-hidden /> : <MessageSquare size={14} aria-hidden />}>
            {singleImage ? "Note" : "Comment"}<span className="hidden opacity-60 md:inline">↵</span>
          </ActionButton>
          <div className="flex gap-1.5">
            <span className="hidden gap-1.5 md:flex">
              <ActionButton aria-label="Previous card" title="Previous (←)" onClick={() => browse(-1)} className="h-10 w-10 px-0"><ChevronLeft size={15} aria-hidden /></ActionButton>
              <ActionButton aria-label="Next card" title="Next (→)" onClick={() => browse(1)} className="h-10 w-10 px-0"><ChevronRight size={15} aria-hidden /></ActionButton>
            </span>
            <ActionButton disabled={!open} onClick={() => void commit({ choice: "skip" })} className="h-10" icon={<SkipForward size={14} aria-hidden />} title="Decide later (S or Space)">
              Later<span className="hidden opacity-60 md:inline">S</span>
            </ActionButton>
          </div>
        </div>}
      </section>

      <section aria-label="Answers" className="shrink-0 md:flex md:min-h-0 md:flex-col">
        {!done && card && <Answers card={card} current={current} open={open} hover={hover} zones={zones}
          marks={activeMarks.size} kept={kept.length} confirm={confirm} setConfirm={setConfirm}
          onAnswer={(answer, element) => void commit(answer, element)} onDuplicates={runDuplicates} />}
      </section>
    </div>

    {zoom && !zoom.asset.missing && <ZoomViewer assetId={zoom.asset.assetId} kind={zoom.asset.kind ?? "image"} url={zoom.asset.url} thumbUrl={zoom.asset.thumbUrl}
      width={zoom.asset.width} height={zoom.asset.height} defect={zoom.defect} onClose={() => setZoom(null)} />}
    {note && card && <NoteSheet key={`${card._id}-${note.kind === "image" ? note.assetId : "card"}`} ownerUserId={ownerUserId}
      target={note.kind === "image" ? { kind: "image", assetId: note.assetId, notes: notesOf.get(note.assetId) ?? [] } : { kind: "card", cardId: card._id, comment }}
      onClose={() => setNote(null)} />}
    {gridOpen && <CardGrid view={view} decisions={decisions} active={index}
      onOpen={(at) => { setIndex(at); setReviewing(true); setGridOpen(false); }} onClose={() => setGridOpen(false)} />}
  </main>;
}

/* ── Evidence: facts only ────────────────────────────────────────────────── */

function Evidence({ card }: { card: Card }) {
  const evidence = card.evidence;
  if (!evidence || (!evidence.text && !evidence.matches?.length && evidence.priceUsd === undefined && !evidence.defect?.note)) return null;
  return <div className="mt-2 flex flex-wrap items-center gap-1.5">
    {evidence.matches?.map((match, index) => <span key={index} className="inline-flex items-center gap-1.5 border px-1.5 py-[3px] text-[10px] font-semibold uppercase leading-none tracking-[0.1em]"
      style={{ ...mono, borderRadius: RADIUS, borderColor: "var(--lm-border-strong)", color: "var(--lm-text-secondary)" }}>
      {match.label}{match.score !== undefined && <span style={{ color: "var(--lm-coral)" }}>{match.score <= 1 ? match.score.toFixed(2) : match.score}</span>}
    </span>)}
    {evidence.defect?.note && <span className="text-[12px]" style={{ color: "var(--lm-text-secondary)" }}>{evidence.defect.note}</span>}
    {evidence.priceUsd !== undefined && <span className="px-1.5 py-[3px] text-[10px] font-bold uppercase leading-none tracking-[0.1em]"
      style={{ ...mono, borderRadius: RADIUS, background: "var(--lm-accent-dim)", color: "var(--lm-coral)" }}>
      Repair {formatUsd(evidence.priceUsd)}{evidence.priceNote ? ` · ${evidence.priceNote}` : ""}
    </span>}
    {evidence.text && <p className="w-full text-[12px] leading-5" style={{ color: "var(--lm-text-tertiary)" }}>{evidence.text}</p>}
  </div>;
}

/* ── Images ──────────────────────────────────────────────────────────────── */

function Picture({ asset, contain = true }: { asset: CardAsset; contain?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const src = asset.thumbUrl ?? asset.url;
  if (asset.missing) {
    return <div className="absolute inset-0 grid place-items-center" style={{ background: "var(--lm-surface-2)" }}>
      <Micro color="var(--lm-text-ghost)" className="inline-flex items-center gap-1.5"><Trash2 size={12} aria-hidden /> Deleted</Micro>
    </div>;
  }
  return <>
    {!loaded && <div className="absolute inset-0 animate-pulse" style={{ background: "var(--lm-surface-2)" }} />}
    {/* eslint-disable-next-line @next/next/no-img-element -- the gallery's own WebP card thumbnail */}
    {src && <img src={src} alt={asset.caption ?? "Image"} draggable={false} decoding="async"
      onLoad={() => setLoaded(true)} className={`pointer-events-none absolute inset-0 h-full w-full ${contain ? "object-contain" : "object-cover"}`}
      style={{ opacity: loaded ? 1 : 0, transition: "opacity 160ms ease-out" }} />}
  </>;
}

function Caption({ asset }: { asset: CardAsset }) {
  if (!asset.caption) return null;
  return <div className="pointer-events-none absolute inset-x-0 bottom-0 px-3 pb-2.5 pt-8"
    style={{ background: "linear-gradient(to top, color-mix(in srgb, var(--lm-paper) 88%, transparent), transparent)" }}>
    <p className="truncate text-[12px] leading-5" style={{ color: "var(--lm-text-secondary)" }}>{asset.caption}</p>
  </div>;
}

function CornerChips({ asset, label }: { asset: CardAsset; label?: string }) {
  return <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2">
    <span className="pointer-events-auto"><CopyChip value={`asset:${asset.assetId}`} label={shortAssetId(asset.assetId)} /></span>
    <span className="flex items-center gap-1.5">
      {label && <span className="px-1.5 py-[4px] text-[10px] font-bold uppercase leading-none tracking-[0.1em]"
        style={{ ...mono, borderRadius: RADIUS, background: "var(--lm-coral)", color: "var(--lm-paper)" }}>{label}</span>}
      <span className="grid h-[22px] w-[22px] place-items-center" style={{ borderRadius: RADIUS, background: SCRIM, color: "var(--lm-text-secondary)" }}><Maximize2 size={11} aria-hidden /></span>
    </span>
  </div>;
}

// A sort card: drag the image onto a target, or tap it to see it full size.
function SortCard({ asset, card, answer, open, hover, setHover, zones, onZoom, onDrop }: {
  asset: CardAsset; card: Card; answer: Answer | null; open: boolean; hover: number | null; setHover: (hotkey: number | null) => void;
  zones: React.RefObject<Map<number, HTMLElement>>; onZoom: () => void; onDrop: (hotkey: number) => void;
}) {
  const [drag, setDrag] = useState<{ pointerId: number; startX: number; startY: number; dx: number; dy: number; moved: boolean } | null>(null);
  const zoneAt = (x: number, y: number) => {
    for (const [hotkey, element] of zones.current) {
      const rect = element.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom && !card.targets?.find((target) => target.hotkey === hotkey)?.missing) return hotkey;
    }
    return null;
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button > 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, dx: 0, dy: 0, moved: false });
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    const moved = drag.moved || Math.hypot(dx, dy) > DRAG_THRESHOLD;
    if (!open && moved) return;
    setDrag({ ...drag, dx, dy, moved });
    if (moved) setHover(zoneAt(event.clientX, event.clientY));
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const hotkey = drag.moved ? zoneAt(event.clientX, event.clientY) : null;
    if (!drag.moved) onZoom();
    else if (hotkey !== null) onDrop(hotkey);
    setDrag(null);
    if (hotkey === null) setHover(null);
  };
  const style: CSSProperties = drag?.moved
    ? { transform: `translate(${drag.dx}px, ${drag.dy}px) rotate(${Math.max(-8, Math.min(8, drag.dx * 0.035))}deg) scale(${hover ? 0.86 : 0.97})`, zIndex: 30, cursor: "grabbing", boxShadow: "var(--lm-modal-shadow)" }
    : { transition: "transform 260ms cubic-bezier(.2,.9,.3,1.25)" };
  return <div className="relative min-h-0 flex-1 touch-none select-none overflow-hidden border"
    style={{ borderRadius: RADIUS, borderColor: hover ? "var(--lm-coral)" : "var(--lm-border-strong)", background: "var(--lm-surface-1)", boxShadow: "var(--lm-shadow-md)", cursor: open ? "grab" : "zoom-in", ...style }}
    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { setDrag(null); setHover(null); }}
    aria-label="Drag onto a target, or tap to see it full size">
    <Picture asset={asset} />
    <CornerChips asset={asset} label={answerLabel(card, answer)} />
    <Caption asset={asset} />
  </div>;
}

// An artifact: the image with the defect boxed, and a zoomed crop of it.
function ArtifactCard({ asset, card, onZoom }: { asset: CardAsset; card: Card; onZoom: () => void }) {
  const box = card.evidence?.defect?.box;
  const src = asset.url ?? asset.thumbUrl;
  const aspect = asset.width && asset.height ? asset.width / asset.height : 16 / 9;
  // The crop shows the box at 2.5× its share of the frame, centred.
  const crop = box && src && !asset.missing ? (() => {
    const zoom = Math.min(8, 1 / Math.max(box.w, box.h, 0.08));
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    return { size: `${zoom * 100}% auto`, position: `${Math.min(100, Math.max(0, ((cx * zoom - 0.5) / (zoom - 1 || 1)) * 100))}% ${Math.min(100, Math.max(0, ((cy * zoom - 0.5) / (zoom - 1 || 1)) * 100))}%` };
  })() : undefined;
  return <button type="button" onClick={onZoom} className="relative min-h-0 flex-1 overflow-hidden border text-left"
    style={{ borderRadius: RADIUS, borderColor: "var(--lm-border-strong)", background: "var(--lm-surface-1)", boxShadow: "var(--lm-shadow-md)" }}
    aria-label="See the defect full size">
    {/* The image and its box share one box sized to the image's aspect. */}
    <span className="absolute inset-0 grid place-items-center p-0">
      <span className="relative block max-h-full max-w-full" style={{ aspectRatio: String(aspect), width: "100%", maxHeight: "100%" }}>
        <Picture asset={asset} />
        {box && <span className="absolute" style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%`, border: "2px solid var(--lm-coral)", boxShadow: "0 0 0 9999px rgba(0,0,0,0.22)" }} />}
      </span>
    </span>
    <CornerChips asset={asset} />
    {crop && box && <span className="absolute bottom-2 right-2 block w-[42%] max-w-[260px] border-2"
      style={{
        // The crop keeps the defect's own shape, between square-ish and wide.
        aspectRatio: String(Math.min(2.4, Math.max(0.8, (box.w * aspect) / Math.max(box.h, 0.01)))),
        borderRadius: RADIUS, borderColor: "var(--lm-coral)", backgroundImage: `url(${src})`, backgroundSize: crop.size, backgroundPosition: crop.position,
        backgroundRepeat: "no-repeat", backgroundColor: "var(--lm-surface-2)", boxShadow: "var(--lm-shadow-lg)",
      }}
      aria-label="Zoomed crop of the defect" role="img" />}
  </button>;
}

// Columns for a set of images: wide images stack on a phone so each one is
// as large as the screen allows; tall ones sit side by side.
const tileColumns = (assets: CardAsset[]) => {
  const shown = assets.filter((asset) => asset.width && asset.height);
  const aspect = shown.length ? shown.reduce((sum, asset) => sum + asset.width! / asset.height!, 0) / shown.length : 1;
  const count = assets.length;
  if (aspect > 1.25) return count <= 3 ? "grid-cols-1 md:grid-cols-2" : count <= 6 ? "grid-cols-2 md:grid-cols-3" : "grid-cols-2 md:grid-cols-4";
  if (aspect < 0.8) return count <= 2 ? "grid-cols-2" : count <= 6 ? "grid-cols-3" : "grid-cols-3 md:grid-cols-4";
  return count <= 4 ? "grid-cols-2" : "grid-cols-3 md:grid-cols-4";
};

function TileGrid({ cols, children }: { cols: string; children: ReactNode }) {
  return <div className={`grid min-h-0 flex-1 auto-rows-fr gap-2 overflow-y-auto ${cols}`}>{children}</div>;
}

// One image among several: tap to answer (A/B, choose one), or mark it for
// deletion and pick the cover (duplicates). Zoom and a note on every tile.
function Tile({ asset, notes, hotkey, badge, chosen, marked, isCover, deleted, tall, onPick, onToggleMark, onCover, onZoom, onNote }: {
  asset: CardAsset; notes?: ImageNote[]; hotkey?: number; badge?: string; chosen?: boolean; marked?: boolean; isCover?: boolean; deleted?: boolean; tall?: boolean;
  onPick?: () => void; onToggleMark?: () => void; onCover?: () => void; onZoom: () => void; onNote?: () => void;
}) {
  const ownerNotes = notes?.filter((entry) => entry.author === "owner").length ?? 0;
  const action = onPick ?? onToggleMark ?? onZoom;
  return <div className={`group relative min-h-[96px] overflow-hidden border ${tall ? "md:min-h-[260px]" : ""}`}
    style={{ borderRadius: RADIUS, borderWidth: chosen || marked ? 2 : 1, borderColor: chosen ? "var(--lm-coral)" : marked ? "var(--lm-status-error)" : isCover ? "var(--lm-ink)" : "var(--lm-border-strong)", background: "var(--lm-surface-1)" }}>
    <button type="button" onClick={action} disabled={asset.missing || deleted} className="absolute inset-0 block disabled:cursor-default"
      aria-label={onPick ? `Choose ${badge ?? hotkey ?? ""}` : onToggleMark ? (marked ? "Keep this image" : "Mark to delete") : "See it full size"}>
      <Picture asset={asset} />
    </button>
    {marked && <span className="pointer-events-none absolute inset-0 grid place-items-center" style={{ background: "color-mix(in srgb, var(--lm-paper) 55%, transparent)" }}>
      <span className="inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em]" style={{ ...mono, borderRadius: RADIUS, background: "var(--lm-status-error)", color: "#fff" }}>
        <Trash2 size={11} aria-hidden /> Delete
      </span>
    </span>}
    <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-1.5 p-1.5">
      <span className="flex items-center gap-1">
        {hotkey !== undefined && <Hotkey n={hotkey} active={chosen} size={20} />}
        {badge && <span className="px-1.5 py-[3px] text-[10px] font-black uppercase leading-none tracking-[0.1em]" style={{ ...mono, borderRadius: RADIUS, background: chosen ? "var(--lm-coral)" : "var(--lm-ink)", color: "var(--lm-paper)" }}>{badge}</span>}
        {isCover && !marked && <span className="px-1.5 py-[3px] text-[9px] font-black uppercase leading-none tracking-[0.12em]" style={{ ...mono, borderRadius: RADIUS, background: "var(--lm-ink)", color: "var(--lm-paper)" }}>Cover</span>}
      </span>
      <span className="pointer-events-auto flex gap-1">
        {onNote && !asset.missing && <button type="button" onClick={onNote} aria-label="Note on this image"
          className="relative grid h-7 w-7 place-items-center" style={{ borderRadius: RADIUS, background: ownerNotes ? "var(--lm-coral)" : SCRIM, color: ownerNotes ? "var(--lm-paper)" : "var(--lm-text-primary)", border: "1px solid var(--lm-border-strong)" }}>
          <MessageSquare size={12} aria-hidden />
        </button>}
        {!asset.missing && <button type="button" onClick={onZoom} aria-label="See it full size"
          className="grid h-7 w-7 place-items-center" style={{ borderRadius: RADIUS, background: SCRIM, color: "var(--lm-text-primary)", border: "1px solid var(--lm-border-strong)" }}>
          <Maximize2 size={12} aria-hidden />
        </button>}
      </span>
    </div>
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-1.5 p-1.5">
      <span className="pointer-events-auto"><CopyChip value={`asset:${asset.assetId}`} label={shortAssetId(asset.assetId)} /></span>
      {onCover && !isCover && <button type="button" onClick={onCover} aria-label="Make this the cover" title="Make this the cover (Shift + number)"
        className="pointer-events-auto grid h-7 w-7 place-items-center" style={{ borderRadius: RADIUS, background: SCRIM, color: "var(--lm-text-primary)", border: "1px solid var(--lm-border-strong)" }}>
        <Star size={12} aria-hidden />
      </button>}
    </div>
  </div>;
}

function RuleCard({ card, tile }: { card: Card; tile: (asset: CardAsset) => ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto border p-4"
    style={{ borderRadius: RADIUS, borderColor: "var(--lm-border-strong)", background: "var(--lm-surface-1)", boxShadow: "var(--lm-shadow-md)" }}>
    <Micro className="inline-flex items-center gap-1.5"><ScrollText size={12} aria-hidden /> Proposed rule</Micro>
    <p className="text-[19px] font-black leading-snug md:text-[24px]" style={display}>{card.ruleText}</p>
    {card.assets.length > 0 && <>
      <Micro color="var(--lm-text-ghost)">Evidence · {card.assets.length} {card.assets.length === 1 ? "image" : "images"}</Micro>
      <div className="grid grid-cols-3 gap-1.5 md:grid-cols-4">{card.assets.map((asset) => <div key={asset.assetId} className="aspect-square">{tile(asset)}</div>)}</div>
    </>}
  </div>;
}

/* ── Answers ─────────────────────────────────────────────────────────────── */

function AnswerZone({ hotkey, label, sub, thumb, hot, chosen, disabled, danger, compact, narrow, register, onClick }: {
  hotkey?: number | string; label: string; sub?: string; thumb?: string; hot?: boolean; chosen?: boolean; disabled?: boolean; danger?: boolean; compact?: boolean;
  /** One of three across a phone: the hotkey square hides below md. */
  narrow?: boolean;
  register?: (element: HTMLElement | null) => void; onClick: () => void;
}) {
  return <button type="button" ref={register} onClick={onClick} disabled={disabled} aria-label={`${hotkey ? `${hotkey}: ` : ""}${label}`}
    className="group relative flex min-w-0 items-center gap-2.5 overflow-hidden border text-left transition-[transform,background-color,border-color] duration-100 disabled:cursor-not-allowed md:min-h-[64px] md:shrink-0 md:p-3"
    style={{
      borderRadius: RADIUS, padding: compact ? "8px 9px" : "11px 11px", minHeight: compact ? 48 : 58, borderWidth: hot ? 2 : 1,
      borderColor: hot || chosen ? "var(--lm-coral)" : danger ? "var(--lm-status-error)" : "var(--lm-border)",
      background: hot ? "var(--lm-accent-dim)" : danger ? "color-mix(in srgb, var(--lm-status-error) 14%, var(--lm-surface-1))" : "var(--lm-surface-1)",
      transform: hot ? "scale(1.035)" : "none", opacity: disabled && !chosen ? 0.45 : 1,
    }}>
    {hotkey !== undefined && <span className={narrow ? "hidden md:inline" : undefined}><Hotkey n={hotkey} active={hot || chosen} size={compact ? 20 : 22} /></span>}
    <span className="min-w-0 flex-1">
      <span className={`block truncate font-black uppercase leading-tight tracking-tight ${compact ? "text-[11px]" : "text-[12px] md:text-[13px]"}`} style={display}>{label}</span>
      {sub && <span className="mt-0.5 line-clamp-2 text-[9px] font-semibold uppercase leading-[1.35] tracking-[0.1em]" style={{ ...mono, color: "var(--lm-text-ghost)" }}>{sub}</span>}
    </span>
    {thumb && !compact && <span className="hidden h-10 w-10 shrink-0 overflow-hidden min-[400px]:block md:h-11 md:w-11" style={{ borderRadius: RADIUS, background: "var(--lm-surface-2)" }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- the board's or collection's cover thumbnail */}
      <img src={thumb} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover" />
    </span>}
  </button>;
}

function Answers({ card, current, open, hover, zones, marks, kept, confirm, setConfirm, onAnswer, onDuplicates }: {
  card: Card; current: Answer | null; open: boolean; hover: number | null; zones: React.RefObject<Map<number, HTMLElement>>;
  marks: number; kept: number; confirm: "stack" | "resolve" | null; setConfirm: (value: "stack" | "resolve" | null) => void;
  onAnswer: (answer: Answer, element?: HTMLElement) => void; onDuplicates: (choice: "stack" | "resolve" | "keep-all") => void;
}) {
  const grid = (count: number, children: ReactNode, hint?: string) => <>
    {hint && <Micro color="var(--lm-text-ghost)" className="mb-2 hidden md:block">{hint}</Micro>}
    <div className="grid gap-2 md:flex md:min-h-0 md:flex-col md:overflow-y-auto" style={{ gridTemplateColumns: `repeat(${count <= 2 || count === 4 ? 2 : 3}, minmax(0, 1fr))` }}>{children}</div>
  </>;
  const is = (choice: InboxChoice) => current?.choice === choice;

  if (card.type === "sort") {
    const targets = card.targets ?? [];
    return grid(targets.length, targets.map((target: Target) => <AnswerZone key={target.hotkey} narrow={targets.length !== 2 && targets.length !== 4} hotkey={target.hotkey} label={target.label}
      sub={target.missing ? "Gone" : INBOX_TARGET_KIND_LABEL[target.kind]} thumb={target.previewThumbUrl ?? undefined} compact={targets.length > 6}
      hot={hover === target.hotkey} chosen={current?.choice === "target" && current.targetHotkey === target.hotkey} disabled={!open || target.missing}
      register={(element) => { if (element) zones.current.set(target.hotkey, element); else zones.current.delete(target.hotkey); }}
      onClick={() => onAnswer({ choice: "target", targetHotkey: target.hotkey }, zones.current.get(target.hotkey))} />), "Drop on a target · or press its number");
  }
  if (card.type === "artifact") {
    const price = card.evidence?.priceUsd;
    return grid(3, <>
      <AnswerZone narrow hotkey={1} label="Fix" sub={price !== undefined ? `Repair · ${formatUsd(price)}` : "Repair it"} chosen={is("fix")} disabled={!open} onClick={() => onAnswer({ choice: "fix" })} />
      <AnswerZone narrow hotkey={2} label="Keep as is" sub="Leave it" chosen={is("keep")} disabled={!open} onClick={() => onAnswer({ choice: "keep" })} />
      <AnswerZone narrow hotkey={3} label="Out" sub="Hidden · not deleted" chosen={is("out")} disabled={!open} onClick={() => onAnswer({ choice: "out" })} />
    </>);
  }
  if (card.type === "rule") {
    return grid(3, <>
      <AnswerZone narrow hotkey={1} label="Yes" sub="Make it a rule" chosen={is("yes")} disabled={!open} onClick={() => onAnswer({ choice: "yes" })} />
      <AnswerZone narrow hotkey={2} label="No" sub="Never" chosen={is("no")} disabled={!open} onClick={() => onAnswer({ choice: "no" })} />
      <AnswerZone narrow hotkey={3} label="Not yet" sub="Ask again later" chosen={is("not-yet")} disabled={!open} onClick={() => onAnswer({ choice: "not-yet" })} />
    </>);
  }
  if (card.type === "ab") {
    return grid(3, <>
      {card.assets.map((asset, at) => <AnswerZone narrow key={asset.assetId} hotkey={at + 1} label={card.labels?.[at] || (at === 0 ? "A" : "B")} sub="Winner"
        chosen={current?.choice === "winner" && current.pickedAssetId === asset.assetId} disabled={!open || asset.missing}
        onClick={() => onAnswer({ choice: "winner", pickedAssetId: asset.assetId })} />)}
      <AnswerZone narrow hotkey={3} label="Neither" sub="N" chosen={is("neither")} disabled={!open} onClick={() => onAnswer({ choice: "neither" })} />
    </>);
  }
  if (card.type === "choose") {
    return <Micro color="var(--lm-text-ghost)" className="block py-1 md:py-0">Tap the one you choose · or press its number</Micro>;
  }
  // Duplicates: per image keep or delete (tap), then one group action.
  if (confirm) {
    return <div className="flex flex-col gap-2 border p-3" style={{ borderRadius: RADIUS, borderColor: "var(--lm-status-error)", background: "color-mix(in srgb, var(--lm-status-error) 10%, var(--lm-surface-1))" }} role="alertdialog" aria-label="Confirm deletion">
      <p className="text-[13px] font-black uppercase leading-tight tracking-tight" style={display}>Delete {marks} {marks === 1 ? "image" : "images"} for good?</p>
      <p className="text-[12px] leading-5" style={{ color: "var(--lm-text-secondary)" }}>
        Deleted images can&rsquo;t come back, not even with undo.{confirm === "stack" ? ` The other ${kept} become one stack.` : ` The other ${kept} stay as they are.`}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <ActionButton onClick={() => setConfirm(null)} className="h-11">Cancel</ActionButton>
        <ActionButton tone="coral" onClick={() => onDuplicates(confirm)} className="h-11" style={{ background: "var(--lm-status-error)", borderColor: "var(--lm-status-error)", color: "#fff" }}
          icon={<Trash2 size={13} aria-hidden />}>Delete {marks}</ActionButton>
      </div>
    </div>;
  }
  return grid(3, <>
    <AnswerZone narrow hotkey="G" label="Stack" sub={marks ? `${kept} under a cover · delete ${marks}` : `${kept} under one cover`} chosen={is("stack")} disabled={!open || kept < 2} onClick={() => onDuplicates("stack")} />
    <AnswerZone narrow hotkey="K" label="Keep all" sub="As they are" chosen={is("keep-all")} disabled={!open || marks > 0} onClick={() => onDuplicates("keep-all")} />
    <AnswerZone narrow hotkey="D" label={marks ? `Delete ${marks}` : "Delete"} sub={marks ? "Keep the rest" : "Tap images to mark"} danger={marks > 0} chosen={is("resolve")} disabled={!open || marks === 0} onClick={() => onDuplicates("resolve")} />
  </>, "Tap an image to mark it for deletion · ★ picks the cover");
}

/* ── Overview ────────────────────────────────────────────────────────────── */

type DecisionMap = Map<string, Live>;

function MiniTile({ card, live, active, onClick }: { card: Card; live?: Live; active?: boolean; onClick: () => void }) {
  const first = card.assets.find((asset) => !asset.missing);
  const label = answerLabel(card, answerOf(live));
  return <button type="button" onClick={onClick} className="group relative aspect-square overflow-hidden border text-left"
    style={{ borderRadius: RADIUS, borderColor: active ? "var(--lm-coral)" : "var(--lm-border)", borderWidth: active ? 2 : 1, background: "var(--lm-surface-2)" }}>
    {first ? <>
      {/* eslint-disable-next-line @next/next/no-img-element -- card thumbnail */}
      <img src={first.thumbUrl ?? first.url} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover" style={{ opacity: live?.choice ? 0.55 : 1 }} />
    </> : <span className="grid h-full place-items-center p-2 text-center"><ScrollText size={18} style={{ color: "var(--lm-text-ghost)" }} aria-hidden /></span>}
    <span className="absolute left-1 top-1 px-1 py-[2px] text-[8px] font-bold uppercase leading-none tracking-[0.1em]" style={{ ...mono, borderRadius: RADIUS, background: SCRIM, color: "var(--lm-text-secondary)" }}>
      {INBOX_CARD_LABEL[card.type]}{card.assets.length > 1 ? ` · ${card.assets.length}` : ""}
    </span>
    {label && <span className="absolute inset-x-1 bottom-1 truncate px-1 py-[3px] text-[9px] font-bold uppercase leading-none tracking-[0.08em]"
      style={{ ...mono, borderRadius: RADIUS, background: live?.choice === "skip" ? SCRIM : "var(--lm-ink)", color: live?.choice === "skip" ? "var(--lm-text-secondary)" : "var(--lm-paper)" }}>{label}</span>}
  </button>;
}

function CardGrid({ view, decisions, active, onOpen, onClose }: { view: View; decisions: DecisionMap; active: number; onOpen: (index: number) => void; onClose: () => void }) {
  return <div className="fixed inset-0 z-[70] flex flex-col animate-fade-in" style={{ background: "var(--lm-overlay-canvas)" }} role="dialog" aria-modal="true" aria-label="All cards">
    <div className="flex shrink-0 items-center justify-between px-4 py-3 md:px-6" style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}>
      <p className="text-lg font-black uppercase tracking-tight" style={display}>All cards <Micro className="ml-2">{view.cards.length}</Micro></p>
      <button type="button" onClick={onClose} aria-label="Close" className="grid h-10 w-10 place-items-center border"
        style={{ borderRadius: RADIUS, borderColor: "var(--lm-border-strong)", color: "var(--lm-text-primary)" }}><X size={18} aria-hidden /></button>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 md:px-6">
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
        {view.cards.map((card, index) => <MiniTile key={card._id} card={card} live={decisions.get(card._id)} active={index === active} onClick={() => onOpen(index)} />)}
      </div>
    </div>
  </div>;
}

function DoneView({ view, decisions, onOpen }: { view: View; decisions: DecisionMap; onOpen: (index: number) => void }) {
  const later = view.cards.filter((card) => decisions.get(card._id)?.choice === "skip").length;
  return <div className="min-h-0 flex-1 overflow-y-auto border p-4" style={{ borderRadius: RADIUS, borderColor: "var(--lm-border)", background: "var(--lm-surface-1)" }}>
    <div className="flex items-center gap-2">
      <span className="grid h-6 w-6 place-items-center" style={{ borderRadius: RADIUS, background: "var(--lm-coral)", color: "var(--lm-paper)" }}><Check size={14} aria-hidden /></span>
      <p className="text-xl font-black uppercase tracking-tight" style={display}>Stack decided</p>
    </div>
    <p className="mt-1 text-[12px] leading-5" style={{ color: "var(--lm-text-tertiary)" }}>
      Agents read your answers and notes from here.{later ? ` ${later} left for later.` : ""} Tap any card to change it.
    </p>
    <div className="mt-4 grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-6">
      {view.cards.map((card, index) => <MiniTile key={card._id} card={card} live={decisions.get(card._id)} onClick={() => onOpen(index)} />)}
    </div>
    <Link href={`/inbox/${view.stack.worldFolderId}`} className="mt-5 inline-flex"><ActionButton icon={<Layers size={13} aria-hidden />}>All stacks in {view.worldName}</ActionButton></Link>
  </div>;
}
