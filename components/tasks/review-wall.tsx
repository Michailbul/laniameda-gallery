"use client";

import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode,
} from "react";
import Link from "next/link";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowRight, Check, Copy, Loader2, Undo2, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CopyChip, Micro, errorText } from "@/components/inbox/inbox-ui";
import { useDesktop } from "@/components/inbox/evidence";
import { ZoomViewer } from "@/components/inbox/zoom-viewer";
import { WorldDocProse } from "@/components/gallery/world-doc-prose";
import { fullStamp, timeAgo } from "@/components/gallery/world-ui";
import { LinkChip, Timeline } from "@/components/tasks/task-queue";
import { TASK_LIMITS, gistOf, taskRef, taskToMarkdown, type TaskStatus } from "@/lib/tasks";

// The review wall: Michael's side of the task queue as a production wall. One
// row per world, every task a storyboard frame pinned to graph paper. A task
// with pictures is a photograph with a thin mono strip (title, copy-ID); one
// without is a note card on its status tone with the title set to fit. The
// thumb works on the picture itself: hold 480 ms drops the primary stamp (the
// coral bar fills), a sideways swipe discards, a tap lifts the frame into the
// focus sheet. The sheet obeys "show, don't tell": the question in one
// sentence, every related picture large, the answer as choices or as the two
// or three stamps, everything else behind one Details disclosure. The AGENT
// view is the same wall as the markdown an agent receives.

type Card = FunctionReturnType<typeof api.tasks.listTaskCards>[number];
type Stack = FunctionReturnType<typeof api.inbox.listInboxStacks>[number];
type Thumb = Card["thumbs"][number];
type TaskView = NonNullable<FunctionReturnType<typeof api.tasks.getTask>>;
export type WallView = "human" | "agent";
type Tone = "coral" | "ink" | "gray";
type Kind = "answer" | "accept" | "rework" | "go" | "later" | "carry" | "note" | "discard" | "choice";
type Action = { kind: Kind; label: string; done: string; tone: Tone; text?: boolean; placeholder?: string };
type Stamp = { kind: Kind; label: string; tone: Tone; at: number };
type Ghost = { card: Card; until: number };
type HistoryEntry = { id: string; prev: Stamp | null; revert?: () => Promise<unknown> };
type Toast = { key: number; what: string; who: string; tone: "ok" | "error"; undo: boolean };
type Counts = { total: number; needsYou: number; toAccept: number };
type Focus = { id: string; field?: Kind };
type Choice = { letter: string; text: string };

export type WallHeaderContext = { counts: Counts; view: WallView; setView: (view: WallView) => void; viewSwitch: ReactNode; undo: ReactNode };

const HOLD_MS = 480;
const SWIPE_PX = 96;
const TOAST_MS = 6000;
const GHOST_MS = 6000;
const VIEW_KEY = "lm-tasks-view";
const GALLERY = "Gallery";

const RANK: Record<TaskStatus, number> = { blocked: 0, done: 1, open: 2, claimed: 3, archived: 4 };
const STATUS_WORD: Record<TaskStatus, string> = {
  blocked: "Needs you", done: "Accept?", open: "Waiting for an agent", claimed: "With an agent", archived: "Archived",
};
const ACTIONS: Record<TaskStatus, Action[]> = {
  blocked: [
    { kind: "answer", label: "Answer", done: "Answered", tone: "coral", text: true, placeholder: "Your answer. The agent carries on with it." },
    { kind: "later", label: "Later", done: "Later", tone: "ink" },
  ],
  done: [
    { kind: "accept", label: "Accept", done: "Accepted", tone: "coral" },
    { kind: "rework", label: "Rework", done: "Rework", tone: "ink", text: true, placeholder: "What to change. The task goes back to the agent." },
  ],
  open: [
    { kind: "go", label: "Go", done: "Go", tone: "coral" },
    { kind: "later", label: "Later", done: "Later", tone: "ink" },
  ],
  claimed: [
    { kind: "carry", label: "Carry on", done: "Carry on", tone: "coral" },
    { kind: "note", label: "Note", done: "Noted", tone: "ink", text: true, placeholder: "A note for the agent. The task stays with it." },
  ],
  archived: [],
};
const DISCARD: Action = { kind: "discard", label: "Discard", done: "Discarded", tone: "gray" };
const CHOICE: Action = { kind: "choice", label: "Choose", done: "Answered", tone: "coral", text: true };

const actionsFor = (card: Card) => ACTIONS[card.status];
const findAction = (card: Card, kind: Kind) =>
  kind === "discard" ? DISCARD : kind === "choice" ? CHOICE : actionsFor(card).find((action) => action.kind === kind);
/** The action whose words the sheet asks for, by status: Enter opens it. */
const textActionFor = (card: Card) => actionsFor(card).find((action) => action.text);

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
const shortTask = (id: string) => `task:…${id.slice(-5)}`;
const worldKeyOf = (card: { worldFolderId?: Id<"folders"> }) => card.worldFolderId ?? "";
const aspectOf = (thumb: { width?: number; height?: number }) => (thumb.width && thumb.height ? thumb.width / thumb.height : 1.5);

/* ── Text: the one sentence, the choices ────────────────────────────────── */

const SENTENCE_END = /^(.*?[.!?])(?:["')\]]*)(?:\s|$)/;

/** The first sentence of a plain paragraph; a tiny one ("Done.") takes the next along. */
const firstSentence = (text: string) => {
  const match = SENTENCE_END.exec(text);
  if (!match) return text;
  const first = match[0].trim();
  if (first.length >= 24 || first.length === text.trim().length) return first;
  const rest = text.slice(match[0].length);
  const second = SENTENCE_END.exec(rest);
  return `${first} ${(second ? second[0] : rest).trim()}`.trim();
};

/** A paragraph split into sentences, each kept with its end mark. */
const sentencesOf = (text: string) => {
  const out: string[] = [];
  let rest = text.trim();
  while (rest) {
    const match = SENTENCE_END.exec(rest);
    if (!match) { out.push(rest); break; }
    out.push(match[0].trim());
    rest = rest.slice(match[0].length);
  }
  return out;
};

/**
 * The question a frame asks, one sentence: for a blocked task the sentence
 * that asks (a "?", or the one carrying the A / B options, else the first);
 * for a done task what was done; for an open or claimed task the brief.
 */
export const questionOf = (card: Pick<Card, "status" | "brief" | "result" | "title">) => {
  const asked = card.status === "blocked" || card.status === "done";
  const source = asked ? card.result || card.brief : card.brief || card.result;
  const gist = gistOf(source, 400);
  if (!gist) return card.title;
  if (card.status === "blocked") {
    const sentences = sentencesOf(gist);
    const asking = sentences.find((sentence) => sentence.endsWith("?")) ?? sentences.find((sentence) => parseChoices(sentence));
    if (asking) return asking;
  }
  return firstSentence(gist);
};

// "A keep in ART / B drop", "A … or B …", "(A) … (B) …": lettered options in
// order from A, each a few words. Nothing else counts as a choice.
const CHOICE_MARK = /(?:^|[\s(\[/]|\bor\s+)([A-D])(?:[).:]|\s[—–-]\s|\s)(?=\S)/g;
export const parseChoices = (text: string | undefined): Choice[] | null => {
  if (!text) return null;
  const source = text.replace(/\s+/g, " ").trim();
  const marks: { letter: string; start: number; end: number }[] = [];
  for (const match of source.matchAll(CHOICE_MARK)) {
    const start = match.index + match[0].indexOf(match[1]!);
    marks.push({ letter: match[1]!, start, end: match.index + match[0].length });
  }
  const run: typeof marks = [];
  let expected = "A";
  for (const mark of marks) {
    if (mark.letter !== expected) continue;
    run.push(mark);
    expected = String.fromCharCode(expected.charCodeAt(0) + 1);
  }
  if (run.length < 2) return null;
  const choices = run.map((mark, index) => {
    const next = run[index + 1];
    let body = source.slice(mark.end, next ? next.start : undefined).trim();
    if (!next) body = firstSentence(body);
    body = body.replace(/[\s,;/]*(?:\bor\b)?[\s,;/]*$/i, "").replace(/^[\s:—–-]+/, "").replace(/[.?!]+$/, "").trim();
    return { letter: mark.letter, text: body };
  });
  return choices.every((choice) => choice.text.length >= 2 && choice.text.length <= 140) ? choices : null;
};

/** A note card's starting type size, from how much there is to say. */
const startSize = (title: string) => {
  const n = title.length;
  return n <= 22 ? 31 : n <= 36 ? 27 : n <= 56 ? 23 : n <= 80 ? 20 : n <= 110 ? 17 : 15;
};

/* ── Styles: the wall's own sheet, hoisted once ─────────────────────────── */

const CSS = `
.lmw{--lmw-bar:0px;--lmw-w:282px;--lmw-dur:200ms;position:relative;min-height:100dvh;background:var(--lm-paper);color:var(--lm-text-primary);
  /* The font tokens resolve here from the next/font variables on body; at :root they are invalid and a font: shorthand would drop whole. */
  --lm-font:var(--font-geist-mono,ui-monospace),ui-monospace,"SF Mono",monospace;--lm-font-display:var(--font-geist-sans,system-ui),system-ui,sans-serif;
  font-family:var(--lm-font-display);-webkit-text-size-adjust:100%;text-size-adjust:100%;
  background-image:linear-gradient(var(--lm-grid-line) 1px,transparent 1px),linear-gradient(90deg,var(--lm-grid-line) 1px,transparent 1px);background-size:24px 24px;
  padding-bottom:calc(72px + env(safe-area-inset-bottom))}
.lmw button{-webkit-tap-highlight-color:transparent}
.lmw-bar{position:sticky;top:0;z-index:20;padding:calc(10px + env(safe-area-inset-top)) 16px 0;
  background:linear-gradient(180deg,var(--lm-sidebar-glass-fill-top),var(--lm-sidebar-glass-fill-bottom));
  backdrop-filter:blur(18px) saturate(140%);-webkit-backdrop-filter:blur(18px) saturate(140%);border-bottom:1px solid var(--lm-sidebar-glass-border)}
.lmw-bar.flat{position:static;background:none;backdrop-filter:none;-webkit-backdrop-filter:none;border-bottom:0;padding:0 0 6px}
.lmw-bar-top{display:flex;align-items:center;gap:12px;min-height:36px}
.lmw-wordmark{margin:0;font:900 15px/1 var(--lm-font-display);letter-spacing:.14em;text-transform:uppercase;display:flex;align-items:center;gap:8px}
.lmw-wordmark i{width:7px;height:7px;background:var(--lm-coral);border-radius:1px;display:inline-block}
.lmw-bar-right{margin-left:auto;display:flex;align-items:center;gap:10px}
.lmw-counts{display:flex;gap:12px;flex-wrap:wrap;margin:6px 0 0;font:600 9.5px/1 var(--lm-font);letter-spacing:.14em;text-transform:uppercase;color:var(--lm-text-ghost)}
.lmw-counts .hot{color:var(--lm-coral)} .lmw-counts .warm{color:var(--lm-text-muted)}
.lmw-chips{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin:10px -16px 0;padding:0 16px 10px}
.lmw-chips::-webkit-scrollbar{display:none}
.lmw-chips .lm-chip{white-space:nowrap;flex:0 0 auto;min-height:32px}
.lmw-seg{display:inline-flex;border:1.5px solid var(--lm-border-strong);border-radius:var(--lm-radius);overflow:hidden}
.lmw-seg button{font:700 9.5px/1 var(--lm-font);letter-spacing:.14em;text-transform:uppercase;padding:9px 11px;color:var(--lm-text-tertiary);min-height:32px;background:none;border:0;cursor:pointer}
.lmw-seg button[aria-selected="true"]{background:var(--lm-ink);color:var(--lm-paper)}
.lmw-undo{display:inline-flex;align-items:center;gap:5px;font:700 9.5px/1 var(--lm-font);letter-spacing:.14em;text-transform:uppercase;color:var(--lm-text-tertiary);padding:9px 6px;min-height:32px;background:none;border:0;cursor:pointer}
.lmw-undo:disabled{opacity:.35;cursor:default}

.lmw-wall{max-width:1216px;margin:0 auto;padding-top:2px}
.lmw-row{margin-top:10px}
.lmw-row-head{position:sticky;top:var(--lmw-bar);z-index:10;display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;padding:11px 16px 9px;
  background:linear-gradient(180deg,var(--lm-sidebar-glass-fill-top),var(--lm-sidebar-glass-fill-bottom));
  backdrop-filter:blur(18px) saturate(140%);-webkit-backdrop-filter:blur(18px) saturate(140%);border-bottom:1px solid var(--lm-sidebar-glass-border)}
.lmw-row-title{font:700 10px/1 var(--lm-font);letter-spacing:.18em;text-transform:uppercase;margin:0;color:var(--lm-text-primary)}
.lmw-row-meta{display:flex;gap:14px;font:600 9.5px/1 var(--lm-font);letter-spacing:.12em;text-transform:uppercase;color:var(--lm-text-ghost)}
.lmw-row-meta .hot{color:var(--lm-coral)} .lmw-row-meta .warm{color:var(--lm-text-muted)}
.lmw-strip{display:flex;flex-direction:column;gap:22px;padding:22px 16px 10px}
.lmw-state{padding:48px 16px;text-align:center;font:600 10px/1.8 var(--lm-font);letter-spacing:.14em;text-transform:uppercase;color:var(--lm-text-ghost)}
.lmw-state b{display:block;font:800 22px/1.1 var(--lm-font-display);letter-spacing:-.01em;color:var(--lm-text-secondary);margin-bottom:6px;text-transform:uppercase}

.lmw-frame{position:relative;width:100%;background:var(--lm-surface-1);border:1px solid var(--lm-border-strong);border-radius:var(--lm-radius);box-shadow:var(--lm-shadow-md);
  display:flex;flex-direction:column;transition:transform var(--lmw-dur) cubic-bezier(.2,.8,.2,1),box-shadow var(--lmw-dur);touch-action:pan-y}
.lmw-frame.is-holding{transform:translateY(-3px) scale(1.012);box-shadow:var(--lm-shadow-lg)}
.lmw-frame.is-swiping{transition:none;z-index:5}
.lmw-pin{position:absolute;top:-5px;left:50%;width:9px;height:9px;margin-left:-5px;border-radius:50%;z-index:3;
  background:radial-gradient(circle at 35% 35%,var(--lm-text-primary),var(--lm-text-tertiary) 70%);box-shadow:0 1px 0 rgba(0,0,0,.55),0 3px 4px -1px rgba(0,0,0,.5)}
.lmw-tab{position:absolute;top:-13px;left:10px;height:13px;padding:0 8px;z-index:2;font:700 8px/13px var(--lm-font);letter-spacing:.16em;text-transform:uppercase;border-radius:2px 2px 0 0}
.lmw-tab.need{background:var(--lm-coral);color:var(--lm-paper)}
.lmw-tab.accept{background:var(--lm-ink);color:var(--lm-paper)}
.lmw-pic,.lmw-plate{position:relative;aspect-ratio:16/10;overflow:hidden;-webkit-touch-callout:none;user-select:none;-webkit-user-select:none;touch-action:pan-y;cursor:pointer;outline:none}
.lmw-pic:focus-visible,.lmw-plate:focus-visible{box-shadow:inset 0 0 0 2px var(--lm-coral)}
.lmw-pic{background:var(--lm-surface-2)}
.lmw-pic img{display:block;width:100%;height:100%;object-fit:cover;object-position:50% 22%;background:var(--lm-surface-2)}
.lmw-hold{position:absolute;left:0;right:0;bottom:0;height:3px;background:var(--lm-coral);transform:scaleX(0);transform-origin:left;z-index:3}
.lmw-frame.is-holding .lmw-hold{transform:scaleX(1);transition:transform ${HOLD_MS}ms linear}
.lmw-ovl{position:absolute;left:0;right:0;bottom:0;z-index:2;display:flex;align-items:center;gap:10px;padding:26px 8px 8px 12px;pointer-events:none;
  background:linear-gradient(180deg,rgba(8,7,6,0),rgba(8,7,6,.62) 45%,rgba(8,7,6,.86));color:#fff6ee;font:600 9.5px/1.2 var(--lm-font);letter-spacing:.04em;text-transform:uppercase}
.lmw-ovl .t{flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 1px 0 rgba(0,0,0,.5)}
.lmw-ovl > button{pointer-events:auto;flex:0 0 auto}
.lmw-plate{--pb:var(--lm-bg-inverse);--pi:var(--lm-paper);background:var(--pb);color:var(--pi);padding:11px 12px 9px;display:flex;flex-direction:column;
  background-image:linear-gradient(rgba(0,0,0,.055) 1px,transparent 1px);background-size:100% 23px;background-position:0 6px}
.lmw-plate.tone-blocked{--pb:var(--lm-coral);--pi:var(--lm-paper);background-image:linear-gradient(rgba(0,0,0,.07) 1px,transparent 1px)}
.lmw-plate.tone-open,.lmw-plate.tone-claimed,.lmw-plate.tone-stack{--pb:var(--lm-surface-3);--pi:var(--lm-text-primary);background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px)}
.lmw-plate.tone-claimed{--pb:var(--lm-surface-4)}
.lmw-plate > *{position:relative}
.lmw-pf{display:flex;gap:12px;font:600 9px/1 var(--lm-font);letter-spacing:.14em;text-transform:uppercase;opacity:.6;white-space:nowrap;overflow:hidden}
.lmw-pf span{overflow:hidden;text-overflow:ellipsis}
.lmw-title{flex:1 1 auto;min-height:0;margin:8px 0 6px;font:800 var(--fs,24px)/.96 var(--lm-font-display);letter-spacing:-.025em;text-transform:uppercase;
  display:flex;align-items:center;overflow:hidden;text-wrap:balance;overflow-wrap:anywhere}
.lmw-title span{display:block;max-height:100%}
.lmw-pb{display:flex;align-items:center;justify-content:space-between;gap:10px}
.lmw-plate.tone-blocked .lmw-hold{background:var(--lm-paper)}
.lmw-count{display:flex;align-items:baseline;gap:10px}
.lmw-count b{font:900 44px/.9 var(--lm-font-display);letter-spacing:-.04em}
.lmw-count small{font:700 9px/1 var(--lm-font);letter-spacing:.16em;text-transform:uppercase;opacity:.7}
.lmw-cue{position:absolute;left:50%;top:50%;z-index:6;pointer-events:none;opacity:0;transform:translate(-50%,-50%) rotate(-9deg);
  font:800 19px/1 var(--lm-font);letter-spacing:.2em;text-transform:uppercase;color:var(--lm-text-muted);border:3px double currentColor;padding:7px 9px 6px 12px;border-radius:3px;white-space:nowrap;background:var(--lm-surface-1)}

.lmw-frame.is-stamped .lmw-pic,.lmw-frame.is-stamped .lmw-plate,.lmw-frame.is-stamped .lmw-tab{opacity:.36;animation:lmw-dim .5s both}
.lmw-frame.is-stamped .lmw-pic::after{content:"";position:absolute;inset:0;background:var(--lm-surface-1);opacity:.55;pointer-events:none}
@keyframes lmw-dim{from{opacity:1}to{opacity:.36}}
.lmw-imp{position:absolute;left:50%;top:50%;z-index:4;pointer-events:none;transform:translate(-50%,-50%) rotate(-9deg);font:800 19px/1 var(--lm-font);letter-spacing:.2em;text-transform:uppercase;
  color:var(--lm-coral);border:3px double var(--lm-coral);padding:7px 9px 6px 12px;border-radius:3px;white-space:nowrap;animation:lmw-slam .34s cubic-bezier(.2,.9,.3,1.25) both}
.lmw-imp.ink{color:var(--lm-text-primary);border-color:var(--lm-text-primary)}
.lmw-imp.gray{color:var(--lm-text-muted);border-color:var(--lm-text-muted)}
@keyframes lmw-slam{from{transform:translate(-50%,-50%) rotate(-9deg) scale(2.1);opacity:0}to{transform:translate(-50%,-50%) rotate(-9deg) scale(1);opacity:1}}

.lmw-stack{isolation:isolate}
.lmw-stack::before,.lmw-stack::after{content:"";position:absolute;inset:0;background:var(--lm-surface-1);border:1px solid var(--lm-border-strong);border-radius:var(--lm-radius);z-index:-1;box-shadow:var(--lm-shadow-sm)}
.lmw-stack::before{transform:translate(5px,-6px) rotate(1.8deg)}
.lmw-stack::after{transform:translate(-4px,-4px) rotate(-1.6deg)}
.lmw-stack .lmw-pic .lmw-count{position:absolute;left:12px;bottom:34px;z-index:2;flex-direction:column;align-items:flex-start;gap:5px;color:#fff6ee;text-shadow:0 1px 0 rgba(0,0,0,.6),0 6px 18px rgba(0,0,0,.6)}
.lmw-stack .lmw-pic img{object-position:50% 40%}
.lmw-stack-link{position:absolute;inset:0;z-index:1}

.lmw-doc{display:flex;flex-direction:column;gap:14px;padding:14px 16px 6px}
.lmw-md{background:var(--lm-surface-1);border:1px solid var(--lm-border-strong);border-radius:var(--lm-radius);box-shadow:var(--lm-shadow-md);max-width:820px;position:relative}
.lmw-md.is-stamped pre,.lmw-md.is-stamped .lmw-md-head{opacity:.36}
.lmw-md-head{display:flex;align-items:center;gap:8px;padding:8px 8px 8px 12px;border-bottom:1px solid var(--lm-border)}
.lmw-md-head > :first-child{margin-right:auto}
.lmw-md pre{margin:0;padding:12px 14px;font:400 11.5px/1.5 var(--lm-font);color:var(--lm-text-secondary);white-space:pre-wrap;word-break:break-word;max-height:360px;overflow:auto}
.lmw-md .lmw-imp{top:40%}
.lmw-doc-bar{display:flex;align-items:center;gap:12px;padding:14px 16px 0}
.lmw-ghostbtn{display:inline-flex;align-items:center;gap:6px;font:700 9.5px/1 var(--lm-font);letter-spacing:.12em;text-transform:uppercase;color:var(--lm-text-tertiary);padding:8px 10px;min-height:32px;background:none;border:1.5px solid transparent;border-radius:var(--lm-radius);cursor:pointer}
.lmw-ghostbtn:hover{color:var(--lm-text-primary)}

.lmw-scrim{position:fixed;inset:0;z-index:50;background:var(--lm-scrim-strong);display:flex;align-items:flex-end;justify-content:center;animation:lmw-fade var(--lmw-dur) ease-out}
@keyframes lmw-fade{from{opacity:0}to{opacity:1}}
.lmw-sheet{position:relative;width:100%;max-width:760px;max-height:94dvh;background:var(--lm-surface-1);border-top:3px solid var(--lm-coral);border-radius:16px 16px 0 0;
  display:flex;flex-direction:column;overflow:hidden;box-shadow:0 -4px 24px rgba(0,0,0,.3);animation:lmw-rise 260ms cubic-bezier(.2,.8,.2,1);color:var(--lm-text-primary)}
@keyframes lmw-rise{from{transform:translateY(40px);opacity:.6}to{transform:none;opacity:1}}
.lmw-shead{position:relative;flex:0 0 auto;padding:54px 16px 16px;touch-action:none;-webkit-touch-callout:none;user-select:none;-webkit-user-select:none;cursor:grab}
.lmw-stools{position:absolute;top:10px;right:10px;z-index:3;display:flex;align-items:center;gap:2px}
.lmw-stools button{width:36px;height:36px;display:grid;place-items:center;border:0;background:none;color:inherit;cursor:pointer;border-radius:50%;font:600 22px/1 var(--lm-font-display);opacity:.85}
.lmw-stools button:disabled{opacity:.25;cursor:default}
.lmw-stools .lmw-close{position:static}
.lmw-shead.tone-blocked{background:var(--lm-coral);color:var(--lm-paper)}
.lmw-shead.tone-done{background:var(--lm-bg-inverse);color:var(--lm-paper)}
.lmw-shead.tone-open{background:var(--lm-surface-3)}
.lmw-shead.tone-claimed{background:var(--lm-surface-4)}
.lmw-shead.toned{min-height:34dvh;display:flex;flex-direction:column;padding-bottom:20px;background-image:linear-gradient(rgba(0,0,0,.06) 1px,transparent 1px);background-size:100% 23px;background-position:0 6px}
.lmw-shead.toned .lmw-q{flex:1 1 auto;display:flex;align-items:center;margin-top:14px;-webkit-line-clamp:unset;line-clamp:unset;display:-webkit-box}
.lmw-grip{position:absolute;top:7px;left:50%;width:38px;height:4px;margin-left:-19px;border-radius:2px;background:currentColor;opacity:.3}
.lmw-sfacts{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font:600 9.5px/1 var(--lm-font);letter-spacing:.12em;text-transform:uppercase;opacity:.72}
.lmw-shead:not(.toned) .lmw-sfacts{color:var(--lm-text-ghost);opacity:1}
.lmw-shead:not(.toned) .lmw-sfacts .hot{color:var(--lm-coral)}
.lmw-shead:not(.toned) .lmw-sfacts .warm{color:var(--lm-text-muted)}
.lmw-q{margin:12px 0 0;font:800 clamp(22px,6.2vw,30px)/1.1 var(--lm-font-display);letter-spacing:-.022em;text-wrap:balance;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;line-clamp:3;overflow:hidden;overflow-wrap:anywhere}
.lmw-stitle{margin:8px 0 0;font:600 10px/1.3 var(--lm-font);letter-spacing:.08em;text-transform:uppercase;opacity:.6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lmw-stools .lmw-close{background:rgba(8,7,6,.3);opacity:1}
.lmw-shead:not(.toned) .lmw-stools .lmw-close{background:var(--lm-surface-3);color:var(--lm-text-primary)}
.lmw-sbody{overflow:auto;-webkit-overflow-scrolling:touch;flex:1 1 auto;min-height:0}
.lmw-pics{display:flex;flex-wrap:wrap;gap:3px;background:var(--lm-surface-2)}
.lmw-pics .cell{position:relative;min-width:0;overflow:hidden;background:var(--lm-surface-2);cursor:zoom-in}
.lmw-pics .cell img{display:block;width:100%;height:100%;object-fit:cover}
.lmw-pics.one .cell{flex:1 1 100%;max-height:52dvh}
.lmw-pics.one .cell img{object-fit:contain;max-height:52dvh}
.lmw-pics .fill{flex:999 0 0}
.lmw-pics .chip{position:absolute;left:6px;bottom:6px;z-index:2}
.lmw-choices{display:flex;flex-direction:column;gap:8px;padding:14px 16px 4px}
.lmw-choice{display:flex;align-items:center;gap:14px;text-align:left;padding:12px 14px 12px 12px;min-height:56px;border:1.5px solid var(--lm-border-strong);border-radius:var(--lm-radius);background:var(--lm-surface-2);color:var(--lm-text-primary);cursor:pointer;
  transition:border-color var(--lmw-dur),background var(--lmw-dur),transform 90ms}
.lmw-choice:hover{border-color:var(--lm-coral)} .lmw-choice:active{transform:translate(1px,1px)}
.lmw-choice b{flex:0 0 auto;width:34px;height:34px;display:grid;place-items:center;font:900 16px/1 var(--lm-font-display);background:var(--lm-coral);color:var(--lm-paper);border-radius:var(--lm-radius)}
.lmw-choice span{font:600 14px/1.3 var(--lm-font-display);overflow-wrap:anywhere}
.lmw-details{margin:10px 16px 0;border-top:1px solid var(--lm-border)}
.lmw-details summary{list-style:none;cursor:pointer;padding:12px 0;font:700 9.5px/1 var(--lm-font);letter-spacing:.14em;text-transform:uppercase;color:var(--lm-text-tertiary);display:flex;align-items:center;gap:8px;min-height:40px}
.lmw-details summary::-webkit-details-marker{display:none}
.lmw-details summary::before{content:"";width:5px;height:5px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg);transition:transform var(--lmw-dur)}
.lmw-details[open] summary::before{transform:rotate(45deg)}
.lmw-full{display:flex;flex-direction:column;gap:16px;padding:2px 0 16px;font:400 13.5px/1.55 var(--lm-font-display);color:var(--lm-text-secondary);max-width:68ch}
.lmw-full section{display:flex;flex-direction:column;gap:6px}
.lmw-full .prose{overflow-wrap:anywhere}
.lmw-full .prose img{max-width:100%;border-radius:var(--lm-radius)}
.lmw-full .prose code{font:400 .9em var(--lm-font)}
.lmw-full .links{display:flex;flex-direction:column;gap:6px}
.lmw-sacts{display:flex;gap:8px;padding:12px 16px calc(12px + env(safe-area-inset-bottom));border-top:1px solid var(--lm-border);background:var(--lm-surface-1);flex-wrap:wrap;flex:0 0 auto}
.lmw-stamp{font:700 10.5px/1 var(--lm-font);letter-spacing:.12em;text-transform:uppercase;padding:0 14px;min-height:46px;border:1.5px solid var(--lm-border-strong);border-radius:var(--lm-radius);color:var(--lm-text-secondary);
  white-space:nowrap;background:none;cursor:pointer;flex:1 1 auto;display:inline-flex;align-items:center;justify-content:center;gap:8px;transition:transform 90ms,background var(--lmw-dur),color var(--lmw-dur),border-color var(--lmw-dur)}
.lmw-stamp:hover{border-color:var(--lm-text-tertiary);color:var(--lm-text-primary)}
.lmw-stamp:active{transform:translate(1px,1px)}
.lmw-stamp:disabled{opacity:.4;cursor:default;transform:none}
.lmw-stamp.primary{border-color:var(--lm-coral);background:var(--lm-coral);color:var(--lm-paper);flex-grow:1.6}
.lmw-stamp.primary:hover{background:var(--lm-accent-hover);border-color:var(--lm-accent-hover);color:var(--lm-paper)}
.lmw-stamp.x{flex:0 0 auto;padding:0 14px}
.lmw-stamp.ghost{border-color:transparent;color:var(--lm-text-tertiary);flex:0 0 auto}
.lmw-stamp kbd{font:600 9px/1 var(--lm-font);opacity:.5;letter-spacing:0}
.lmw-field{flex:1 1 100%;width:100%;resize:none;font:400 16px/1.4 var(--lm-font-display);color:var(--lm-text-primary);background:var(--lm-surface-2);border:1px solid var(--lm-border-strong);border-radius:var(--lm-radius);padding:10px 12px;min-height:84px;outline:none}
.lmw-field::placeholder{color:var(--lm-text-ghost)}
.lmw-field:focus{border-color:var(--lm-coral)}
.lmw-stamped-line{flex:1 1 auto;display:flex;align-items:center;gap:10px;min-height:46px;font:700 10.5px/1 var(--lm-font);letter-spacing:.14em;text-transform:uppercase;color:var(--lm-coral)}
.lmw-err{flex:1 1 100%;margin:0;font:500 12px/1.4 var(--lm-font-display);color:var(--lm-status-error)}

.lmw-toast{position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom));transform:translate(-50%,0);z-index:60;display:flex;align-items:center;gap:14px;padding:6px 6px 6px 14px;
  background:var(--lm-surface-3);border:1px solid var(--lm-border-strong);border-radius:var(--lm-radius);box-shadow:var(--lm-shadow-lg);font:600 11px/1 var(--lm-font);letter-spacing:.06em;color:var(--lm-text-primary);
  max-width:calc(100vw - 32px);animation:lmw-toast-in 220ms cubic-bezier(.2,.8,.2,1)}
@keyframes lmw-toast-in{from{transform:translate(-50%,24px);opacity:0}to{transform:translate(-50%,0);opacity:1}}
.lmw-toast .what{color:var(--lm-coral);text-transform:uppercase;letter-spacing:.14em;font-weight:700;white-space:nowrap}
.lmw-toast.error .what{color:var(--lm-status-error)}
.lmw-toast .who{color:var(--lm-text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:46vw}
.lmw-toast .lmw-stamp{min-height:34px;flex:0 0 auto;padding:0 12px}

@media (min-width:900px){
  .lmw{--lmw-w:276px}
  .lmw-bar{padding-left:24px;padding-right:24px}
  .lmw-bar-top{min-height:40px}
  .lmw-chips{margin-left:-24px;margin-right:-24px;padding-left:24px;padding-right:24px}
  .lmw-wall{padding:8px 8px 0}
  .lmw-row{margin-top:30px}
  .lmw-row-head{position:static;padding:0 16px;background:none;backdrop-filter:none;-webkit-backdrop-filter:none;border-bottom:0}
  .lmw-row-title{font:800 13px/1 var(--lm-font-display);letter-spacing:.03em}
  .lmw-strip{flex-direction:row;flex-wrap:wrap;gap:24px 20px;padding:20px 16px 10px}
  .lmw-strip > .lmw-frame{flex:0 0 var(--lmw-w);width:var(--lmw-w)}
  .lmw-doc{padding:16px}
  .lmw-scrim{align-items:center;padding:24px}
  .lmw-sheet{border-top:0;border-left:3px solid var(--lm-coral);border-radius:6px;max-height:88vh}
  .lmw-shead.toned{min-height:30vh}
  .lmw-grip{display:none}
  .lmw-q{font-size:30px}
  .lmw-sacts .lmw-stamp{flex:0 1 auto;padding:0 22px}
  .lmw-sacts .lmw-stamp.primary{flex-grow:0;padding:0 28px}
  .lmw-pics.one .cell,.lmw-pics.one .cell img{max-height:56vh}
}
@media (prefers-reduced-motion:reduce){
  .lmw *,.lmw *::before,.lmw *::after,.lmw-scrim,.lmw-scrim *,.lmw-toast{animation-duration:1ms !important;transition-duration:1ms !important}
}
`;

/* ── Small pieces ────────────────────────────────────────────────────────── */

function Pic({ thumb, eager }: { thumb: Thumb; eager?: boolean }) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;
  // eslint-disable-next-line @next/next/no-img-element -- the gallery's own thumbnail
  return <img src={thumb.url} alt="" draggable={false} decoding="async" loading={eager ? "eager" : "lazy"} onError={() => setBroken(true)} />;
}

/** A note card's title: a size from its length, then shrunk until the words fit the card. */
function FitTitle({ title, scale = 1 }: { title: string; scale?: number }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    let lastWidth = -1;
    const fit = () => {
      const width = node.clientWidth;
      if (width === lastWidth) return;
      lastWidth = width;
      const wide = Math.min(1.6, Math.max(1, width / 252));
      let size = Math.round(startSize(title) * wide * scale);
      node.style.setProperty("--fs", `${size}px`);
      let guard = 40;
      while (node.scrollHeight > node.clientHeight + 1 && size > 11 && guard-- > 0) {
        size -= 1;
        node.style.setProperty("--fs", `${size}px`);
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    void fonts?.ready.then(() => { lastWidth = -1; fit(); }).catch(() => undefined);
    return () => observer.disconnect();
  }, [title, scale]);
  return <h3 ref={ref} className="lmw-title"><span>{title}</span></h3>;
}

const Impression = ({ stamp }: { stamp: Stamp }) =>
  <div className={`lmw-imp ${stamp.tone === "coral" ? "" : stamp.tone}`} aria-label={`Stamped ${stamp.label}`}>{stamp.label}</div>;

/** HUMAN / AGENT: a mono segmented pair. */
export function WallViewSwitch({ view, onChange }: { view: WallView; onChange: (view: WallView) => void }) {
  return <div className="lmw-seg" role="tablist" aria-label="View">
    {(["human", "agent"] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={view === value} onClick={() => onChange(value)}
      title={value === "human" ? "The wall, pictures first" : "The markdown an agent reads"}>{value}</button>)}
  </div>;
}

/* ── Frame: the picture is the control ──────────────────────────────────── */

type Gesture = { id: number; x: number; y: number; t0: number; timer: ReturnType<typeof setTimeout> | null; moved: boolean; swiping: boolean; dx: number; fired: boolean };

function Frame({ card, stamp, eager, onOpen, onPrimary, onDiscard }: {
  card: Card; stamp: Stamp | null; eager: boolean; onOpen: () => void; onPrimary: () => void; onDiscard: () => void;
}) {
  const frame = useRef<HTMLElement>(null);
  const cue = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const canAct = !stamp;

  // A frame that flew out comes back stamped: the inline fly-out is cleared
  // before the row measures it for its slide to the end.
  useLayoutEffect(() => {
    const node = frame.current;
    if (!node) return;
    node.style.transform = "";
    node.style.transition = "";
    node.style.opacity = "";
    if (cue.current) cue.current.style.opacity = "0";
  }, [stamp]);
  useEffect(() => () => { if (gesture.current?.timer) clearTimeout(gesture.current.timer); }, []);

  const stopHold = () => {
    const current = gesture.current;
    if (current?.timer) { clearTimeout(current.timer); current.timer = null; }
    frame.current?.classList.remove("is-holding");
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || gesture.current) return;
    const node = frame.current;
    const current: Gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, t0: performance.now(), timer: null, moved: false, swiping: false, dx: 0, fired: false };
    gesture.current = current;
    if (canAct && node) {
      node.classList.add("is-holding");
      current.timer = setTimeout(() => {
        if (gesture.current !== current || current.moved) return;
        current.fired = true;
        node.classList.remove("is-holding");
        gesture.current = null;
        onPrimary();
      }, HOLD_MS);
    }
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.x, dy = event.clientY - current.y;
    if (!current.swiping) {
      if (Math.hypot(dx, dy) <= 8) return;
      current.moved = true;
      stopHold();
      if (!(canAct && Math.abs(dx) > Math.abs(dy) * 1.3)) { gesture.current = null; return; }
      current.swiping = true;
      frame.current?.classList.add("is-swiping");
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* a mouse without capture still works */ }
    }
    current.dx = dx;
    if (frame.current) frame.current.style.transform = `translateX(${dx}px) rotate(${dx / 40}deg)`;
    if (cue.current) cue.current.style.opacity = String(Math.min(1, Math.max(0, Math.abs(dx) - 30) / 70));
  };
  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    stopHold();
    gesture.current = null;
    const node = frame.current;
    if (current.swiping && node) {
      node.classList.remove("is-swiping");
      if (event.type !== "pointercancel" && Math.abs(current.dx) > SWIPE_PX) {
        const dir = Math.sign(current.dx);
        node.style.transition = "transform 220ms cubic-bezier(.2,.8,.2,1), opacity 220ms";
        node.style.transform = `translateX(${dir * 120}vw) rotate(${dir * 10}deg)`;
        node.style.opacity = ".4";
        setTimeout(onDiscard, 150);
        return;
      }
      node.style.transform = "";
      if (cue.current) cue.current.style.opacity = "0";
      return;
    }
    if (!current.moved && !current.fired && performance.now() - current.t0 < HOLD_MS) onOpen();
  };

  const picture = card.thumbs[0];
  const tab = stamp ? null : card.status === "blocked" ? <span className="lmw-tab need">Needs you</span> : card.status === "done" ? <span className="lmw-tab accept">Accept?</span> : null;
  const chip = <CopyChip value={taskRef(card._id)} label={shortTask(card._id)} />;
  const control = {
    role: "button", tabIndex: 0, "aria-label": `Open ${card.title}`,
    onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd,
    onKeyDown: (event: React.KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); } },
  } as const;

  return <article ref={frame} className={`lmw-frame${stamp ? " is-stamped" : ""}`} data-id={card._id} onContextMenu={(event) => event.preventDefault()}>
    <span className="lmw-pin" aria-hidden />
    {tab}
    {stamp && <Impression stamp={stamp} />}
    {picture
      ? <div className="lmw-pic" {...control}>
        <Pic thumb={picture} eager={eager} />
        <div className="lmw-ovl"><span className="t">{card.title}</span>{chip}</div>
        <div className="lmw-hold" />
      </div>
      : <div className={`lmw-plate tone-${card.status}`} {...control}>
        <div className="lmw-pf"><span>{timeAgo(card.updatedAt)}</span><span>{STATUS_WORD[card.status]}</span></div>
        <FitTitle title={card.title} />
        <div className="lmw-pb">{chip}</div>
        <div className="lmw-hold" />
      </div>}
    <div ref={cue} className="lmw-cue" aria-hidden>Discard</div>
  </article>;
}

/** A Decisions stack: its first picture, the count left to decide, a link to its desk. */
function StackFrame({ stack }: { stack: Stack }) {
  const left = Math.max(0, stack.cards - stack.decided);
  const title = stack.title.replace(/\s*·\s*\d+\s*$/, "");
  const preview = stack.previewItems[0];
  const url = preview?.thumbUrl ?? preview?.url;
  const href = `/inbox/${stack.worldFolderId}/${stack._id}`;
  const count = <span className="lmw-count"><b>{left || stack.cards}</b><small>{left ? "to decide" : "decided"}</small></span>;
  const chip = <CopyChip value={`stack:${stack._id}`} label={`stack:…${stack._id.slice(-5)}`} />;
  return <article className="lmw-frame lmw-stack" data-id={stack._id}>
    <span className="lmw-pin" aria-hidden />
    {left > 0 && <span className="lmw-tab need">Decide</span>}
    {url
      ? <div className="lmw-pic">
        <Link href={href} className="lmw-stack-link" aria-label={`Open ${title}`} />
        {/* eslint-disable-next-line @next/next/no-img-element -- the stack's own preview */}
        <img src={url} alt="" draggable={false} loading="lazy" decoding="async" />
        {count}
        <div className="lmw-ovl"><span className="t">{title}</span>{chip}</div>
      </div>
      : <div className="lmw-plate tone-stack">
        <Link href={href} className="lmw-stack-link" aria-label={`Open ${title}`} />
        <div className="lmw-pf"><span>{stack.worldName}</span><span>decisions</span></div>
        <FitTitle title={title} />
        <div className="lmw-pb" style={{ zIndex: 2 }}>{chip}{count}</div>
      </div>}
  </article>;
}

/** The frames of a row; a frame that changes place slides there. */
function Strip({ className, children }: { className: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const rects = useRef(new Map<string, { left: number; top: number }>());
  useLayoutEffect(() => {
    const node = box.current;
    if (!node) return;
    const origin = node.getBoundingClientRect();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const next = new Map<string, { left: number; top: number }>();
    node.querySelectorAll<HTMLElement>(":scope > [data-id]").forEach((element) => {
      const rect = element.getBoundingClientRect();
      const at = { left: rect.left - origin.left, top: rect.top - origin.top };
      const id = element.dataset.id!;
      next.set(id, at);
      const previous = rects.current.get(id);
      if (!previous || reduce) return;
      const dx = previous.left - at.left, dy = previous.top - at.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      element.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 460, easing: "cubic-bezier(.2,.8,.2,1)" });
    });
    rects.current = next;
  });
  return <div ref={box} className={className}>{children}</div>;
}

/* ── The sheet: show, don't tell ────────────────────────────────────────── */

/** Every picture the task is about, each at its own aspect: one fills the width, more share justified rows. */
function PictureSet({ thumbs, onZoom }: { thumbs: Thumb[]; onZoom: (thumb: Thumb) => void }) {
  const n = thumbs.length;
  if (n === 0) return null;
  const perRow = n === 2 ? 2 : n <= 4 ? 2 : 3;
  const ratios = thumbs.map(aspectOf);
  const average = ratios.reduce((sum, ratio) => sum + ratio, 0) / n;
  return <div className={`lmw-pics${n === 1 ? " one" : ""}`}>
    {thumbs.map((thumb, index) => {
      const ratio = ratios[index]!;
      const style: CSSProperties = n === 1
        ? { aspectRatio: `${ratio}` }
        : { flexGrow: ratio, flexBasis: `${Math.max(18, (ratio / (perRow * average)) * 100 - 1.5)}%`, aspectRatio: `${ratio}` };
      return <div key={thumb.assetId} className="cell" style={style} role="button" tabIndex={0} aria-label="Open full size"
        onClick={() => onZoom(thumb)} onKeyDown={(event) => { if (event.key === "Enter") onZoom(thumb); }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- the gallery's own thumbnail */}
        <img src={thumb.url} alt="" draggable={false} decoding="async" loading={index < 4 ? "eager" : "lazy"} />
        <span className="chip"><CopyChip value={`asset:${thumb.assetId}`} label={thumb.assetId.slice(-6)} /></span>
      </div>;
    })}
    {n > 2 && n % perRow !== 0 && <div className="fill" aria-hidden />}
  </div>;
}

/** Behind "Details": the whole brief and result, the other links, the timeline. */
function Details({ ownerUserId, taskId }: { ownerUserId: string; taskId: Id<"tasks"> }) {
  const { isAuthenticated } = useConvexAuth();
  const view = useQuery(api.tasks.getTask, isAuthenticated ? { ownerUserId, taskId } : "skip") as TaskView | undefined | null;
  if (!view) return <div className="grid place-items-center py-8"><Loader2 className="animate-spin" size={16} style={{ color: "var(--lm-text-ghost)" }} aria-label="Loading" /></div>;
  const { task, links, events } = view;
  const others = links.filter((link) => link.kind !== "asset");
  return <div className="lmw-full">
    {task.result && <section>
      <Micro color={task.status === "blocked" ? "var(--lm-coral)" : undefined}>{task.status === "blocked" ? "The question in full" : "Result"}</Micro>
      <div className="prose" style={{ color: "var(--lm-text-primary)" }}><WorldDocProse body={task.result} inline /></div>
    </section>}
    {task.brief && <section><Micro>Brief</Micro><div className="prose"><WorldDocProse body={task.brief} inline /></div></section>}
    {others.length > 0 && <section><Micro>Links</Micro><div className="links">{others.map((link, index) => <LinkChip key={`${link.kind}-${link.id}-${index}`} link={link} />)}</div></section>}
    <section><Micro>Timeline</Micro><Timeline events={events} /></section>
    <Micro color="var(--lm-text-ghost)" style={{ textTransform: "none", letterSpacing: 0 }}>{fullStamp(task.createdAt)}{task.claimedBy && task.status === "claimed" ? ` · ${task.claimedBy.replace(/^agent:/, "")}` : ""}</Micro>
  </div>;
}

/** The words an action asks for: Answer, Rework or Note. ⌘↵ sends, Esc goes back. */
function ReplyField({ action, onSend, onBack }: { action: Action; onSend: (body: string) => Promise<void> | void; onBack: () => void }) {
  const desktop = useDesktop();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const send = async () => {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true); setError(undefined);
    try { await onSend(body); } catch (failure) { setError(errorText(failure, "Not sent.")); setBusy(false); }
  };
  return <>
    <textarea autoFocus className="lmw-field" value={draft} rows={3} maxLength={TASK_LIMITS.comment} placeholder={action.placeholder ?? ""}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send(); }
        else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onBack(); }
      }} />
    <button type="button" className="lmw-stamp ghost" onClick={onBack}>Back</button>
    <span style={{ flex: "1 1 auto" }} />
    <button type="button" className="lmw-stamp primary" disabled={!draft.trim() || busy} onClick={() => void send()}>
      {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <ArrowRight size={14} aria-hidden />} Send {action.label}{desktop && <kbd>⌘↵</kbd>}
    </button>
    {error && <p className="lmw-err">{error}</p>}
  </>;
}

function FocusSheet({ ownerUserId, card, stamp, field, showWorld, hasPrev, hasNext, onClose, onPrev, onNext, onAct, onField }: {
  ownerUserId: string; card: Card; stamp: Stamp | null; field: Kind | undefined; showWorld: boolean; hasPrev: boolean; hasNext: boolean;
  onClose: () => void; onPrev: () => void; onNext: () => void;
  onAct: (kind: Kind, text?: string) => Promise<void> | void; onField: (kind: Kind | undefined) => void;
}) {
  const desktop = useDesktop();
  const [zoom, setZoom] = useState<Thumb | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const sheet = useRef<HTMLElement>(null);
  useEffect(() => {
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; };
  }, []);

  const question = questionOf(card);
  const choices = card.status === "blocked" && !stamp ? parseChoices(question) ?? parseChoices(card.result?.slice(0, 300)) : null;
  const actions = actionsFor(card);
  const fieldAction = field ? findAction(card, field) : undefined;
  const pictures = card.thumbs.length > 0;
  const toned = !pictures;

  // Drag the head: down closes, sideways past the threshold stamps (right) or discards (left).
  const drag = useRef<{ id: number; x: number; y: number; dx: number; dy: number } | null>(null);
  const onHeadDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, dy: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (sheet.current) sheet.current.style.transition = "none";
  };
  const onHeadMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId || !sheet.current) return;
    current.dx = event.clientX - current.x; current.dy = event.clientY - current.y;
    if (Math.abs(current.dx) > Math.abs(current.dy)) sheet.current.style.transform = `translateX(${current.dx}px) rotate(${current.dx / 40}deg)`;
    else if (current.dy > 0) sheet.current.style.transform = `translateY(${current.dy}px)`;
  };
  const onHeadEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    drag.current = null;
    const node = sheet.current;
    if (!node) return;
    node.style.transition = "transform 220ms cubic-bezier(.2,.8,.2,1)";
    const sideways = Math.abs(current.dx) > Math.abs(current.dy);
    if (event.type !== "pointercancel" && !stamp && sideways && current.dx > SWIPE_PX) { node.style.transform = "translateX(120vw) rotate(10deg)"; setTimeout(() => void onAct(actions[0]!.kind), 140); return; }
    if (event.type !== "pointercancel" && !stamp && sideways && current.dx < -SWIPE_PX) { node.style.transform = "translateX(-120vw) rotate(-10deg)"; setTimeout(() => void onAct("discard"), 140); return; }
    if (event.type !== "pointercancel" && !sideways && current.dy > 140) { node.style.transform = "translateY(100vh)"; setTimeout(onClose, 160); return; }
    node.style.transform = "";
  };

  const facts = <div className="lmw-sfacts">
    <span className={card.status === "blocked" ? "hot" : card.status === "done" ? "warm" : ""}>{STATUS_WORD[card.status]}</span>
    {showWorld && <span>{card.worldName ?? GALLERY}</span>}
    <span>{timeAgo(card.updatedAt)}</span>
    {stamp && <span className="hot">Stamped {stamp.label}</span>}
  </div>;

  return <><div className="lmw-scrim" onClick={onClose}>
    <section ref={sheet} className="lmw-sheet" role="dialog" aria-modal="true" aria-label={card.title} onClick={(event) => event.stopPropagation()}>
      <div className={`lmw-shead${toned ? ` toned tone-${card.status}` : ""}`} onPointerDown={onHeadDown} onPointerMove={onHeadMove} onPointerUp={onHeadEnd} onPointerCancel={onHeadEnd}>
        <span className="lmw-grip" aria-hidden />
        <div className="lmw-stools">
          <button type="button" aria-label="Previous" disabled={!hasPrev} onClick={onPrev}>‹</button>
          <button type="button" aria-label="Next" disabled={!hasNext} onClick={onNext}>›</button>
          <button type="button" className="lmw-close" onClick={onClose} aria-label="Close"><X size={16} aria-hidden /></button>
        </div>
        {facts}
        <h2 className="lmw-q">{question}</h2>
        {question !== card.title && <p className="lmw-stitle">{card.title}</p>}
        <div style={{ marginTop: 10 }}><CopyChip value={taskRef(card._id)} label={shortTask(card._id)} /></div>
      </div>
      <div className="lmw-sbody">
        {pictures && <PictureSet thumbs={card.thumbs} onZoom={setZoom} />}
        {choices && <div className="lmw-choices">
          {choices.map((choice) => <button key={choice.letter} type="button" className="lmw-choice" disabled={busy}
            onClick={async () => { setBusy(true); setError(undefined); try { await onAct("choice", `${choice.letter}: ${choice.text}`); } catch (failure) { setError(errorText(failure, "Not sent.")); setBusy(false); } }}>
            <b>{choice.letter}</b><span>{choice.text}</span>
          </button>)}
        </div>}
        <details className="lmw-details" onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
          <summary>Details</summary>
          {detailsOpen && <Details ownerUserId={ownerUserId} taskId={card._id} />}
        </details>
      </div>
      <div className="lmw-sacts">
        {stamp
          ? <span className="lmw-stamped-line"><Check size={14} aria-hidden /> Stamped · {stamp.label}</span>
          : fieldAction
            ? <ReplyField key={`${card._id}-${fieldAction.kind}`} action={fieldAction} onSend={(body) => onAct(fieldAction.kind, body)} onBack={() => onField(undefined)} />
            : <>
              {actions.map((action, index) => <button key={action.kind} type="button" className={`lmw-stamp${index === 0 ? " primary" : ""}`} disabled={busy}
                onClick={() => void onAct(action.kind)}>{action.label}{index === 0 && desktop && <kbd>→</kbd>}</button>)}
              <button type="button" className="lmw-stamp x" disabled={busy} onClick={() => void onAct("discard")} aria-label="Discard" title="Discard"><X size={15} aria-hidden /></button>
              {error && <p className="lmw-err">{error}</p>}
            </>}
      </div>
    </section>
  </div>
  {/* Outside the scrim and the sheet: a fixed layer under a transformed ancestor would be clipped, and its clicks must not reach the scrim. */}
  {zoom && <div onClick={(event) => event.stopPropagation()}>
    <ZoomViewer assetId={zoom.assetId} kind="image" url={zoom.url} thumbUrl={zoom.url} width={zoom.width} height={zoom.height} onClose={() => setZoom(null)} />
  </div>}
  </>;
}

/* ── AGENT view: the same wall as markdown ──────────────────────────────── */

function AgentDoc({ card, stamp, copied, onCopy }: { card: Card; stamp: Stamp | null; copied: boolean; onCopy: () => void }) {
  return <article className={`lmw-md${stamp ? " is-stamped" : ""}`} data-id={card._id}>
    {stamp && <Impression stamp={stamp} />}
    <div className="lmw-md-head">
      <CopyChip value={taskRef(card._id)} label={shortTask(card._id)} />
      <button type="button" className="lmw-ghostbtn" onClick={onCopy}>{copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />} Copy md</button>
    </div>
    <pre>{taskToMarkdown(card)}</pre>
  </article>;
}

/* ── The wall ────────────────────────────────────────────────────────────── */

type Row = { key: string; worldFolderId?: Id<"folders">; name: string; tasks: Card[]; stacks: Stack[]; needsYou: number; toAccept: number; withAgents: number };

export function ReviewWall({ ownerUserId, worldFolderId, galleryOnly = false, showWorlds, stickyHeader = true, initialTaskId, header }: {
  ownerUserId: string;
  /** Inside a world: only its tasks and stacks. */
  worldFolderId?: Id<"folders">;
  /** Only the tasks that belong to no world. */
  galleryOnly?: boolean;
  /** One row per world with its label; off inside a world's own tab. */
  showWorlds: boolean;
  stickyHeader?: boolean;
  initialTaskId?: string;
  /** The page's header, given the counts, the view and the switch; the wall makes it sticky. */
  header: (context: WallHeaderContext) => ReactNode;
}) {
  const { isAuthenticated } = useConvexAuth();
  const cards = useQuery(api.tasks.listTaskCards, isAuthenticated ? { ownerUserId, worldFolderId, limit: TASK_LIMITS.list } : "skip");
  const stacks = useQuery(api.inbox.listInboxStacks, isAuthenticated && !galleryOnly ? { ownerUserId, worldFolderId, status: "open", previewLimit: 1 } : "skip");
  const update = useMutation(api.tasks.updateTask);
  const comment = useMutation(api.tasks.commentTask);

  const [view, setViewState] = useState<WallView>("human");
  useEffect(() => { try { if (window.localStorage.getItem(VIEW_KEY) === "agent") setViewState("agent"); } catch { /* storage refused */ } }, []);
  const setView = useCallback((next: WallView) => { setViewState(next); try { window.localStorage.setItem(VIEW_KEY, next); } catch { /* storage refused */ } }, []);

  const [stamps, setStamps] = useState<Map<string, Stamp>>(() => new Map());
  const stampsRef = useRef(stamps);
  stampsRef.current = stamps;
  const [ghosts, setGhosts] = useState<Map<string, Ghost>>(() => new Map());
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const historyRef = useRef(history);
  historyRef.current = history;
  const [toast, setToast] = useState<Toast | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const say = useCallback((next: Omit<Toast, "key">) => setToast({ ...next, key: Date.now() }), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);
  // A stamped frame the server already dropped stays on the wall, dimmed, while the undo window is open.
  useEffect(() => {
    if (ghosts.size === 0) return;
    const soonest = Math.min(...[...ghosts.values()].map((ghost) => ghost.until));
    const timer = setTimeout(() => setGhosts((current) => new Map([...current].filter(([, ghost]) => ghost.until > Date.now()))), Math.max(0, soonest - Date.now()) + 20);
    return () => clearTimeout(timer);
  }, [ghosts]);

  const tasks = useMemo(() => {
    const live = (cards ?? []).filter((card) => !galleryOnly || !card.worldFolderId);
    const seen = new Set(live.map((card) => card._id));
    return [...live, ...[...ghosts.values()].filter((ghost) => !seen.has(ghost.card._id)).map((ghost) => ghost.card)];
  }, [cards, ghosts, galleryOnly]);

  const rows = useMemo<Row[]>(() => {
    const byKey = new Map<string, Row>();
    const rowFor = (key: string, id: Id<"folders"> | undefined, name: string) => {
      let row = byKey.get(key);
      if (!row) { row = { key, worldFolderId: id, name, tasks: [], stacks: [], needsYou: 0, toAccept: 0, withAgents: 0 }; byKey.set(key, row); }
      return row;
    };
    for (const card of tasks) {
      const row = showWorlds ? rowFor(worldKeyOf(card), card.worldFolderId, card.worldName ?? GALLERY) : rowFor("all", worldFolderId, "");
      row.tasks.push(card);
      if (!stamps.has(card._id)) { if (card.status === "blocked") row.needsYou += 1; else if (card.status === "done") row.toAccept += 1; else row.withAgents += 1; }
    }
    for (const stack of stacks ?? []) (showWorlds ? rowFor(stack.worldFolderId, stack.worldFolderId, stack.worldName) : rowFor("all", worldFolderId, "")).stacks.push(stack);
    const rank = (card: Card) => RANK[card.status];
    for (const row of byKey.values()) {
      row.tasks.sort((a, b) => {
        const sa = stamps.get(a._id), sb = stamps.get(b._id);
        if (!!sa !== !!sb) return sa ? 1 : -1;
        if (sa && sb) return sa.at - sb.at;
        return rank(a) - rank(b) || a.priority - b.priority || b.updatedAt - a.updatedAt;
      });
    }
    return [...byKey.values()].sort((a, b) => {
      if ((a.key === "") !== (b.key === "")) return a.key === "" ? 1 : -1;
      return b.needsYou - a.needsYou || b.toAccept - a.toAccept || a.name.localeCompare(b.name);
    });
  }, [tasks, stacks, stamps, showWorlds, worldFolderId]);

  const flat = useMemo(() => rows.flatMap((row) => row.tasks), [rows]);
  const counts = useMemo<Counts>(() => ({
    total: tasks.length,
    needsYou: tasks.filter((card) => card.status === "blocked" && !stamps.has(card._id)).length,
    toAccept: tasks.filter((card) => card.status === "done" && !stamps.has(card._id)).length,
  }), [tasks, stamps]);

  // ?task=<id>: that frame opens as soon as the wall arrives.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !initialTaskId || !cards) return;
    opened.current = true;
    if (cards.some((card) => card._id === initialTaskId)) setFocus({ id: initialTaskId });
  }, [cards, initialTaskId]);

  // The header's height feeds the sticky world labels on the phone.
  const bar = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = bar.current;
    if (!node || !stickyHeader) return;
    const measure = () => root.current?.style.setProperty("--lmw-bar", `${node.offsetHeight}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [stickyHeader]);

  const setStamp = useCallback((id: string, stamp: Stamp | null) => {
    setStamps((current) => { const next = new Map(current); if (stamp) next.set(id, stamp); else next.delete(id); return next; });
  }, []);
  const dropGhost = useCallback((id: string) => setGhosts((current) => { if (!current.has(id)) return current; const next = new Map(current); next.delete(id); return next; }), []);

  const act = useCallback(async (card: Card, kind: Kind, text?: string) => {
    const action = findAction(card, kind);
    if (!action) return;
    if (action.text && !text) { setFocus({ id: card._id, field: kind }); return; }
    const id = card._id;
    const owner = { ownerUserId, actor: "owner" } as const;
    let request: Promise<unknown> | null = null;
    let revert: (() => Promise<unknown>) | undefined;
    let archive = false;
    switch (kind) {
      case "discard":
        archive = true;
        request = update({ ...owner, taskId: id, status: "archived" });
        revert = () => update({ ...owner, taskId: id, status: card.status === "done" ? "done" : "open" });
        break;
      case "accept":
        archive = true;
        request = update({ ...owner, taskId: id, status: "archived" });
        revert = () => update({ ...owner, taskId: id, status: "done" });
        break;
      case "go":
        if (card.priority !== 1) { request = update({ ...owner, taskId: id, priority: 1 }); revert = () => update({ ...owner, taskId: id, priority: card.priority }); }
        break;
      case "later":
        if (card.status === "open" && card.priority !== 3) { request = update({ ...owner, taskId: id, priority: 3 }); revert = () => update({ ...owner, taskId: id, priority: card.priority }); }
        break;
      case "answer": case "rework": case "note": case "choice":
        request = comment({ ownerUserId, taskId: id, body: text!, author: "owner" });
        break;
      case "carry":
        break;
    }
    const prev = stampsRef.current.get(id) ?? null;
    const stamp: Stamp = { kind, label: action.done, tone: action.tone, at: Date.now() };
    const undoable = !action.text;
    setStamp(id, stamp);
    if (archive) setGhosts((current) => new Map(current).set(id, { card, until: Date.now() + GHOST_MS }));
    if (undoable) setHistory((current) => [...current, { id, prev, revert }]);
    setFocus((current) => (current?.id === id ? null : current));
    say({ what: action.done, who: card.title, tone: "ok", undo: undoable });
    if (!request) return;
    try {
      await request;
    } catch (failure) {
      setStamp(id, prev);
      dropGhost(id);
      setHistory((current) => current.filter((entry) => !(entry.id === id && entry.revert === revert)));
      say({ what: "Not saved", who: errorText(failure, "That did not go through."), tone: "error", undo: false });
      throw failure;
    }
  }, [ownerUserId, update, comment, say, setStamp, dropGhost]);

  const undo = useCallback(async () => {
    const entry = historyRef.current[historyRef.current.length - 1];
    if (!entry) return;
    setHistory((current) => current.slice(0, -1));
    setStamp(entry.id, entry.prev);
    dropGhost(entry.id);
    setToast(null);
    if (!entry.revert) return;
    try { await entry.revert(); } catch (failure) { say({ what: "Undo failed", who: errorText(failure, "That did not go through."), tone: "error", undo: false }); }
  }, [setStamp, dropGhost, say]);

  const copyText = useCallback(async (key: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 1200); } catch { /* refused */ }
  }, []);

  const focused = focus ? flat.find((card) => card._id === focus.id) ?? null : null;
  const focusIndex = focused ? flat.indexOf(focused) : -1;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === "z") { event.preventDefault(); void undo(); return; }
      if (!focused) return;
      if (event.key === "Escape") { event.preventDefault(); setFocus(null); }
      else if (event.key === "ArrowLeft") { event.preventDefault(); if (focusIndex > 0) setFocus({ id: flat[focusIndex - 1]!._id }); }
      else if (event.key === "ArrowRight") { event.preventDefault(); if (focusIndex < flat.length - 1) setFocus({ id: flat[focusIndex + 1]!._id }); }
      else if (event.key === "Enter") { const action = textActionFor(focused); if (action && !stamps.has(focused._id)) { event.preventDefault(); setFocus({ id: focused._id, field: action.kind }); } }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focused, focusIndex, flat, stamps, undo]);

  const undoButton = <button type="button" className="lmw-undo" disabled={history.length === 0} onClick={() => void undo()} title="Undo the last stamp (Z)">
    <Undo2 size={12} aria-hidden /> Undo
  </button>;
  const viewSwitch = <WallViewSwitch view={view} onChange={setView} />;

  const rowHead = (row: Row) => {
    const parts: ReactNode[] = [];
    if (row.needsYou) parts.push(<span key="n" className="hot">{row.needsYou} need{row.needsYou === 1 ? "s" : ""} you</span>);
    if (row.toAccept) parts.push(<span key="a" className="warm">{row.toAccept} to accept</span>);
    if (row.withAgents) parts.push(<span key="w">{row.withAgents} with agents</span>);
    if (row.stacks.length) parts.push(<span key="s">{row.stacks.length} to decide</span>);
    if (!parts.length) parts.push(<span key="x">all stamped</span>);
    return <div className="lmw-row-head"><h2 className="lmw-row-title">{row.name}</h2><div className="lmw-row-meta">{parts}</div></div>;
  };

  let eagerLeft = 8;
  const wall = cards === undefined
    ? <div className="lmw-state"><Loader2 className="mx-auto animate-spin" size={18} style={{ color: "var(--lm-text-ghost)" }} aria-label="Loading" /></div>
    : rows.length === 0
      ? <div className="lmw-state"><b>Nothing on the wall</b>{galleryOnly || worldFolderId ? "No tasks here. New frames appear as agents finish or ask." : "The queue is clear. A comment on a picture or a Decision puts a frame here."}</div>
      : view === "agent"
        ? <>
          <div className="lmw-doc-bar">
            <Micro color="var(--lm-text-ghost)">{flat.length} tasks · what list_tasks returns, as markdown</Micro>
            <span style={{ flex: 1 }} />
            <button type="button" className="lmw-ghostbtn" onClick={() => void copyText("all", flat.map((card) => taskToMarkdown(card)).join("\n\n---\n\n"))}>
              {copied === "all" ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />} Copy all
            </button>
          </div>
          {rows.filter((row) => row.tasks.length).map((row) => <section key={row.key} className="lmw-row">
            {showWorlds && rowHead(row)}
            <div className="lmw-doc">
              {row.tasks.map((card) => <AgentDoc key={card._id} card={card} stamp={stamps.get(card._id) ?? null} copied={copied === card._id} onCopy={() => void copyText(card._id, taskToMarkdown(card))} />)}
            </div>
          </section>)}
        </>
        : rows.map((row) => <section key={row.key} className="lmw-row">
          {showWorlds && rowHead(row)}
          <Strip className="lmw-strip">
            {row.tasks.map((card) => <Frame key={card._id} card={card} stamp={stamps.get(card._id) ?? null} eager={eagerLeft-- > 0}
              onOpen={() => setFocus({ id: card._id })}
              onPrimary={() => void act(card, actionsFor(card)[0]?.kind ?? "discard").catch(() => undefined)}
              onDiscard={() => void act(card, "discard").catch(() => undefined)} />)}
            {row.stacks.map((stack) => <StackFrame key={stack._id} stack={stack} />)}
          </Strip>
        </section>);

  return <div ref={root} className="lmw">
    <style href="lm-review-wall" precedence="default">{CSS}</style>
    <div ref={bar} className={`lmw-bar${stickyHeader ? "" : " flat"}`}>{header({ counts, view, setView, viewSwitch, undo: undoButton })}</div>
    <main className="lmw-wall">{wall}</main>
    {focused && <FocusSheet key={focused._id} ownerUserId={ownerUserId} card={focused} stamp={stamps.get(focused._id) ?? null} field={focus?.field}
      showWorld={showWorlds} hasPrev={focusIndex > 0} hasNext={focusIndex < flat.length - 1}
      onClose={() => setFocus(null)} onPrev={() => setFocus({ id: flat[focusIndex - 1]!._id })} onNext={() => setFocus({ id: flat[focusIndex + 1]!._id })}
      onAct={(kind, text) => act(focused, kind, text)} onField={(kind) => setFocus({ id: focused._id, field: kind })} />}
    {toast && <div key={toast.key} className={`lmw-toast${toast.tone === "error" ? " error" : ""}`} role="status" aria-live="polite">
      <span className="what">{toast.what}</span><span className="who">{toast.who}</span>
      {toast.undo && <button type="button" className="lmw-stamp" onClick={() => void undo()}><Undo2 size={12} aria-hidden /> Undo</button>}
    </div>}
  </div>;
}

/* ── /tasks: the whole wall with a world filter ─────────────────────────── */

export function ReviewWallHome({ ownerUserId }: { ownerUserId: string }) {
  const { isAuthenticated } = useConvexAuth();
  const [world, setWorld] = useState<Id<"folders"> | "gallery" | null>(null);
  const [initialTaskId] = useState<string | undefined>(() =>
    typeof window === "undefined" ? undefined : new URLSearchParams(window.location.search).get("task")?.replace(/^task:/, "") ?? undefined);
  const worldCounts = useQuery(api.tasks.countOpenTasks, isAuthenticated ? { ownerUserId } : "skip");
  const chips = (worldCounts ?? []).map((row) => ({ key: row.worldFolderId ?? ("gallery" as const), name: row.worldFolderId ? row.worldName : GALLERY, blocked: row.blocked }));
  return <ReviewWall ownerUserId={ownerUserId} worldFolderId={world && world !== "gallery" ? world : undefined} galleryOnly={world === "gallery"} showWorlds={world === null}
    initialTaskId={initialTaskId}
    header={({ counts, viewSwitch, undo }) => <>
      <div className="lmw-bar-top">
        <h1 className="lmw-wordmark"><i aria-hidden />Review</h1>
        <div className="lmw-bar-right">{undo}{viewSwitch}</div>
      </div>
      <p className="lmw-counts">
        {counts.needsYou ? <span className="hot">{counts.needsYou} need{counts.needsYou === 1 ? "s" : ""} you</span> : null}
        {counts.toAccept ? <span className="warm">{counts.toAccept} to accept</span> : null}
        <span>{counts.total} total</span>
      </p>
      {chips.length > 1 && <div className="lmw-chips lm-chip-row" role="group" aria-label="World">
        <button type="button" className="lm-chip" data-active={world === null ? "true" : undefined} onClick={() => setWorld(null)}>All</button>
        {chips.map((chip) => <button key={chip.key} type="button" className="lm-chip" data-active={world === chip.key ? "true" : undefined} onClick={() => setWorld(chip.key)}>
          {chip.name}{chip.blocked ? <span className="ml-1 tabular-nums" style={{ color: "var(--lm-coral)" }}>{chip.blocked}</span> : null}
        </button>)}
      </div>}
    </>} />;
}

