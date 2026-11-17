"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// The first-visit tour for producers and the director (Michael, 17 Nov 2026:
// "onboarding tutorials with navigation explanation ... with focus modes,
// click next, bring focus to other element"). Each step dims the page and
// lights one part of it, with a short card: what it is and what to do there.
// Steps whose part is not on screen for this person (no vote for a guest, no
// folder list on a phone) are left out. "How it works" in the top bar plays
// it again.

export type TourStep = {
  /** CSS selector of the part to light; none = a centred card. */
  target?: string;
  title: string;
  body: string;
  /** Show the hover-only controls of the target's style card while lit. */
  reveal?: boolean;
};

const PAD = 8;
const GAP = 14;
const CARD_W = 340;

// The first match that is really on screen: a selector list names
// fallbacks (the folder list, else the phone's folder button).
const findTarget = (selector?: string): HTMLElement | null => {
  if (!selector) return null;
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < window.innerWidth) return el;
  }
  return null;
};

export const tourSeenKey = (slug: string) => `rv-tour:${slug}:1`;

export function markTourSeen(slug: string) {
  try { window.localStorage.setItem(tourSeenKey(slug), String(Date.now())); } catch { /* private mode */ }
}

export function tourSeen(slug: string) {
  try { return Boolean(window.localStorage.getItem(tourSeenKey(slug))); } catch { return true; }
}

type Box = { top: number; left: number; width: number; height: number };

export function Tour({ steps, onClose }: { steps: TourStep[]; onClose: () => void }) {
  // Which steps can be shown is decided once, when the tour opens.
  const [list, setList] = useState<TourStep[] | null>(null);
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [card, setCard] = useState<{ top: number; left: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const host = typeof document === "undefined" ? null : ((document.querySelector(".rv") as HTMLElement | null) ?? document.body);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setList(steps.filter((step) => !step.target || findTarget(step.target))));
    return () => window.cancelAnimationFrame(frame);
  }, [steps]);

  const step = list?.[index];
  const last = list ? index === list.length - 1 : false;

  const next = useCallback(() => {
    if (!list) return;
    if (index >= list.length - 1) onClose();
    else setIndex(index + 1);
  }, [index, list, onClose]);
  const back = useCallback(() => setIndex((value) => Math.max(0, value - 1)), []);

  // Bring the lit part into view and reveal hover-only controls.
  useEffect(() => {
    if (!step) return;
    const el = findTarget(step.target);
    el?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    const wrap = step.reveal ? el?.closest<HTMLElement>(".rv-style-wrap") ?? el : null;
    wrap?.classList.add("rv-tour-on");
    nextRef.current?.focus({ preventScroll: true });
    return () => wrap?.classList.remove("rv-tour-on");
  }, [step]);

  // Follow the part while the page settles, scrolls or resizes.
  useLayoutEffect(() => {
    if (!step) return;
    let frame = 0;
    let seen = "";
    const put = (nextBox: Box | null, nextCard: { top: number; left: number }) => {
      const key = JSON.stringify([nextBox, nextCard].map((row) => row && Object.values(row).map(Math.round)));
      if (key === seen) return;
      seen = key;
      setBox(nextBox);
      setCard(nextCard);
    };
    const place = () => {
      const el = findTarget(step.target);
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const cardEl = cardRef.current;
      const cw = Math.min(CARD_W, vw - 32);
      const ch = cardEl?.offsetHeight ?? 220;
      if (!el) {
        put(null, { top: Math.max(16, (vh - ch) / 2), left: (vw - cw) / 2 });
      } else {
        const r = el.getBoundingClientRect();
        const lit = { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
        let top: number;
        let left = lit.left;
        if (lit.top + lit.height + GAP + ch <= vh - 16) top = lit.top + lit.height + GAP;
        else if (lit.top - GAP - ch >= 16) top = lit.top - GAP - ch;
        else if (lit.left + lit.width + GAP + cw <= vw - 16) { top = Math.max(16, Math.min(vh - ch - 16, lit.top)); left = lit.left + lit.width + GAP; }
        else top = Math.max(16, vh - ch - 16);
        left = Math.max(16, Math.min(vw - cw - 16, left));
        put(lit, { top, left });
      }
      frame = window.requestAnimationFrame(place);
    };
    place();
    return () => window.cancelAnimationFrame(frame);
  }, [step]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
      else if (event.key === "ArrowRight" || (event.key === "Enter" && !(event.target instanceof HTMLButtonElement))) { event.preventDefault(); event.stopPropagation(); next(); }
      else if (event.key === "ArrowLeft") { event.preventDefault(); event.stopPropagation(); back(); }
      else event.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [next, back, onClose]);

  if (!host || !list || !step) return null;

  return createPortal(
    <div className="rv-tour" role="dialog" aria-modal="true" aria-labelledby="rv-tour-title">
      <div
        className="rv-tour-hole"
        data-none={box ? undefined : ""}
        style={box ? { top: box.top, left: box.left, width: box.width, height: box.height } : undefined}
      />
      <div
        ref={cardRef}
        className="rv-tour-card"
        style={{ top: card?.top ?? -9999, left: card?.left ?? -9999, visibility: card ? "visible" : "hidden" }}
      >
        <div className="k">
          <span>How it works</span>
          <span>{index + 1} / {list.length}</span>
        </div>
        <h4 id="rv-tour-title">{step.title}</h4>
        <p>{step.body}</p>
        <div className="dots" aria-hidden="true">
          {list.map((row, position) => <span key={row.title} data-on={position === index ? "" : undefined} data-done={position < index ? "" : undefined} />)}
        </div>
        <div className="row">
          {last ? <span /> : <button type="button" className="skip" onClick={onClose}>Skip the tour</button>}
          <span className="go">
            {index > 0 ? <button type="button" className="rv-btn ghost" onClick={back}>Back</button> : null}
            <button type="button" ref={nextRef} className="rv-btn accent" onClick={next}>{last ? "Start reviewing" : index === 0 ? "Show me" : "Next"}</button>
          </span>
        </div>
      </div>
    </div>,
    host,
  );
}
