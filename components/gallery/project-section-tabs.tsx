"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export interface ProjectSectionTabItem<K extends string = string> {
  key: K;
  label: string;
  /** Member-collection count for this section (beats, characters, …). */
  count: number;
}

/**
 * Section switcher for the project view: All / Beats / Characters / Locations
 * (+ Stills / Unsorted once used). Narrows which layer of the project the grid
 * shows; the top filter bar (image/video/liked/tags) still applies on top.
 *
 * Minimal by design — no track, no rail, no pills, no boxes. Just labels and a
 * single hairline that slides and stretches to the active one, measured from
 * the real DOM so it lands exactly under the word at any font or zoom.
 */
export function ProjectSectionTabs<K extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: ProjectSectionTabItem<K>[];
  active: K;
  onChange: (key: K) => void;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef(new Map<K, HTMLButtonElement>());
  const [marker, setMarker] = useState<{ x: number; w: number } | null>(null);
  // First paint positions the hairline without animating it in from x=0; every
  // change after that glides. State rather than a ref so render can read it.
  const [animate, setAnimate] = useState(false);

  const measure = useCallback(() => {
    const row = rowRef.current;
    const el = itemRefs.current.get(active);
    if (!row || !el) return;
    const rowBox = row.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    setMarker({
      // Relative to the row, and scroll-independent so it stays glued while
      // the row scrolls horizontally on narrow screens.
      x: box.left - rowBox.left + row.scrollLeft,
      w: box.width,
    });
  }, [active]);

  useLayoutEffect(() => {
    measure();
    // Fonts landing after hydration change label widths under the marker.
    const id = requestAnimationFrame(() => {
      measure();
      setAnimate(true);
    });
    return () => cancelAnimationFrame(id);
  }, [measure, tabs.length]);

  useEffect(() => {
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    return () => ro.disconnect();
  }, [measure]);

  // One destination is not a choice — don't draw a switcher for it.
  if (tabs.length < 2) return null;

  return (
    <div
      ref={rowRef}
      role="tablist"
      aria-label="Project sections"
      onScroll={measure}
      className="relative flex items-baseline gap-6 overflow-x-auto px-4 pb-2.5 pt-1 md:px-6"
      style={{ fontFamily: "var(--lm-font)", scrollbarWidth: "none" }}
    >
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            ref={(node) => {
              if (node) itemRefs.current.set(tab.key, node);
              else itemRefs.current.delete(tab.key);
            }}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.key)}
            className="lm-section-tab flex shrink-0 cursor-pointer items-baseline gap-1 border-none bg-transparent p-0"
            data-active={isActive ? "true" : "false"}
          >
            <span
              style={{
                fontSize: "12.5px",
                fontWeight: isActive ? 600 : 450,
                letterSpacing: "-0.005em",
                color: isActive
                  ? "var(--lm-coral)"
                  : "var(--lm-text-tertiary)",
                transition:
                  "color var(--lm-duration-fast), font-weight var(--lm-duration-fast)",
              }}
            >
              {tab.label}
            </span>
            {tab.count > 0 && (
              <span
                style={{
                  fontSize: "9.5px",
                  fontVariantNumeric: "tabular-nums",
                  color: isActive
                    ? "var(--lm-coral)"
                    : "var(--lm-text-ghost)",
                  opacity: isActive ? 0.75 : 1,
                  transition: "color var(--lm-duration-fast)",
                }}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}

      {/* The whole chrome: one hairline that glides between labels. */}
      {marker && (
        <span
          aria-hidden
          className="lm-section-marker"
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            height: "1.5px",
            width: `${marker.w}px`,
            transform: `translateX(${marker.x}px)`,
            backgroundColor: "var(--lm-coral)",
            borderRadius: "1px",
            // Slight overshoot reads as momentum without looking bouncy.
            transition: animate
              ? "transform 380ms cubic-bezier(0.34, 1.42, 0.5, 1), width 380ms cubic-bezier(0.34, 1.42, 0.5, 1)"
              : "none",
          }}
        />
      )}
    </div>
  );
}
