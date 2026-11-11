"use client";

import type { SearchStepReading } from "@/lib/search-instructions";

// What each kind of step does to the search, as a short mono tag on its chip.
const KIND_TAG: Record<SearchStepReading["kind"], string> = {
  words: "FIND",
  place: "IN",
  filter: "ONLY",
  exclude: "WITHOUT",
};

const KIND_COLOR: Record<SearchStepReading["kind"], string> = {
  words: "var(--lm-text-tertiary, #8a7b6c)",
  place: "var(--lm-pillar-dump, #2eb8b4)",
  filter: "var(--lm-pillar-designs, #5d6bfa)",
  exclude: "var(--lm-accent, #ff7a64)",
};

/**
 * The steps of a search as chips, in the order they were added. Removing a
 * chip takes that step out and the search runs again without it.
 */
export function SearchStepChips({
  steps,
  onRemove,
  size = "md",
}: {
  steps: SearchStepReading[];
  onRemove?: (index: number) => void;
  size?: "sm" | "md";
}) {
  if (steps.length === 0) return null;
  const small = size === "sm";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {steps.map((step, index) => (
        <span
          key={`${index}:${step.label}`}
          className="inline-flex max-w-full items-center gap-1.5"
          style={{
            padding: small ? "3px 4px 3px 7px" : "4px 5px 4px 9px",
            borderRadius: "var(--lm-radius, 2px)",
            border: "1px solid var(--lm-border-strong, rgba(240,232,224,0.18))",
            backgroundColor: "var(--lm-surface-2, rgba(32,23,16,0.04))",
            fontFamily: "var(--lm-font, inherit)",
          }}
        >
          <span
            style={{
              fontSize: "9px",
              fontWeight: 800,
              letterSpacing: "0.14em",
              color: KIND_COLOR[step.kind],
            }}
          >
            {KIND_TAG[step.kind]}
          </span>
          <span
            className="truncate"
            style={{
              fontSize: small ? "11px" : "12px",
              color: "var(--lm-text-primary, #201710)",
              textDecoration: step.kind === "exclude" ? "line-through" : undefined,
              textDecorationColor: "var(--lm-accent, #ff7a64)",
              maxWidth: small ? "180px" : "320px",
            }}
          >
            {step.kind === "exclude" ? step.label.replace(/\bno /g, "") : step.label}
          </span>
          {onRemove ? (
            <button
              type="button"
              aria-label={`Remove "${step.label}" from the search`}
              onClick={() => onRemove(index)}
              className="grid place-items-center transition-colors hover:text-[var(--lm-text-primary)]"
              style={{
                width: 16,
                height: 16,
                fontSize: "13px",
                lineHeight: 1,
                color: "var(--lm-text-tertiary, #8a7b6c)",
              }}
            >
              ×
            </button>
          ) : null}
        </span>
      ))}
    </div>
  );
}

/** One earlier search on one line: its steps joined by arrows. */
export const searchThreadLine = (steps: string[]) => steps.join("  ›  ");
