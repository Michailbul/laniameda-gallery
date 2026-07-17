"use client";

import { ChevronRight } from "lucide-react";

export interface BreadcrumbSegment {
  label: string;
  /** Set on every segment except the last (the current location). */
  onClick?: () => void;
}

/**
 * Path strip above the asset grid when browsing inside a set:
 * PROJECTS / CASSANDRA, or COLLECTIONS / DEAR ANNETE / CHARACTERS.
 * The roots return to the browse (landing) view.
 */
export function BrowseBreadcrumb({
  segments,
}: {
  segments: BreadcrumbSegment[];
}) {
  if (segments.length === 0) return null;
  return (
    <nav
      aria-label="Gallery location"
      className="flex items-center gap-1 px-4 pb-1 pt-2 md:px-6"
      style={{ fontFamily: "var(--lm-font)" }}
    >
      {segments.map((segment, i) => {
        const isLast = i === segments.length - 1;
        return (
          <span key={`${segment.label}-${i}`} className="flex items-center gap-1">
            {i > 0 && (
              <ChevronRight
                className="h-3 w-3"
                style={{ color: "var(--lm-text-ghost)" }}
                aria-hidden
              />
            )}
            {segment.onClick && !isLast ? (
              <button
                type="button"
                onClick={segment.onClick}
                className="cursor-pointer border-none bg-transparent p-0 transition-colors hover:underline"
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  color: "var(--lm-text-tertiary)",
                  fontFamily: "var(--lm-font)",
                }}
              >
                {segment.label}
              </button>
            ) : (
              <span
                aria-current={isLast ? "page" : undefined}
                style={{
                  fontSize: "10px",
                  fontWeight: 800,
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  color: isLast
                    ? "var(--lm-coral)"
                    : "var(--lm-text-tertiary)",
                }}
              >
                {segment.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
