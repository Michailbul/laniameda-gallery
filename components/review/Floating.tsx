"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

// Menus and popovers render in the page root (fixed, next to their trigger),
// so a scrolling sidebar or a bar with overflow never clips them.

/** [open, setOpen, anchorRef, popRef]: closes on outside click and Esc. */
export function usePopover<T extends HTMLElement = HTMLButtonElement>() {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<T>(null);
  const popRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target) || popRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  return [open, setOpen, anchorRef, popRef] as const;
}

type Placement = "bottom-start" | "bottom-end" | "bottom-center" | "top-start" | "top-center" | "top-end" | "right-end" | "right-start";

type FloatingProps = {
  anchorRef: RefObject<HTMLElement | null>;
  popRef: RefObject<HTMLDivElement | null>;
  placement?: Placement;
  className?: string;
  role?: string;
  label?: string;
  children: ReactNode;
};

const MARGIN = 8;

export function Floating({ anchorRef, popRef, placement = "bottom-end", className = "", role, label, children }: FloatingProps) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // The page root carries the project's colours. Popovers only open after a
  // click, so this runs in the browser.
  const host = typeof document === "undefined" ? null : ((document.querySelector(".rv") as HTMLElement | null) ?? document.body);

  useLayoutEffect(() => {
    if (!host) return;
    const place = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      const pop = popRef.current;
      if (!anchor || !pop) return;
      const width = pop.offsetWidth;
      const height = pop.offsetHeight;
      const [side, align] = placement.split("-") as ["bottom" | "top" | "right", "start" | "end" | "center"];
      let left: number;
      let top: number;
      if (side === "right") {
        left = anchor.right + MARGIN;
        top = align === "end" ? anchor.bottom - height : anchor.top;
      } else {
        left = align === "start" ? anchor.left : align === "end" ? anchor.right - width : anchor.left + anchor.width / 2 - width / 2;
        const below = anchor.bottom + MARGIN;
        const above = anchor.top - MARGIN - height;
        top = side === "bottom" ? (below + height > window.innerHeight - MARGIN && above > MARGIN ? above : below) : above < MARGIN ? below : above;
      }
      left = Math.max(MARGIN, Math.min(left, window.innerWidth - width - MARGIN));
      top = Math.max(MARGIN, Math.min(top, window.innerHeight - height - MARGIN));
      setPos((current) => (current && current.left === left && current.top === top ? current : { left, top }));
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorRef, popRef, placement, host]);

  if (!host) return null;
  return createPortal(
    <div
      ref={popRef}
      className={`rv-pop ${className}`}
      role={role}
      aria-label={label}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, visibility: pos ? "visible" : "hidden" }}
    >
      {children}
    </div>,
    host,
  );
}
