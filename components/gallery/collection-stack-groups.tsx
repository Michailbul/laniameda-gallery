"use client";

import type { ReactNode } from "react";
import type { GalleryEntry } from "@/lib/gallery-entries";

export type CollectionStackSection = {
  key: string;
  label: string;
  entries: GalleryEntry[];
};

/**
 * A world's grouped child collections: each display group (Styles, Places,
 * Cast…) under a small heading with its count, in group order. Ungrouped
 * children stay in the grid that follows, as before; `separated` draws the
 * hairline between the two.
 */
export function CollectionStackGroups({
  sections,
  separated = false,
  renderGrid,
}: {
  sections: CollectionStackSection[];
  separated?: boolean;
  renderGrid: (entries: GalleryEntry[]) => ReactNode;
}) {
  return (
    <div className="pt-1">
      {sections.map((section) => (
        <section key={section.key} aria-label={`${section.label} collections`}>
          <div
            className="flex items-center gap-3 px-3 pt-3"
            style={{ fontFamily: "var(--lm-font)" }}
          >
            <h3
              className="m-0"
              style={{
                fontSize: "10px",
                fontWeight: 800,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: "var(--lm-text-secondary)",
              }}
            >
              {section.label}
            </h3>
            <span
              style={{
                fontSize: "10px",
                fontWeight: 700,
                letterSpacing: "0.14em",
                color: "var(--lm-text-ghost)",
              }}
            >
              {section.entries.length}
            </span>
            <span
              aria-hidden
              className="h-px flex-1"
              style={{ backgroundColor: "var(--lm-border)" }}
            />
          </div>
          {renderGrid(section.entries)}
        </section>
      ))}
      {separated && (
        <div
          aria-hidden
          className="mx-3 mb-1 mt-2 h-px"
          style={{ backgroundColor: "var(--lm-border)" }}
        />
      )}
    </div>
  );
}
