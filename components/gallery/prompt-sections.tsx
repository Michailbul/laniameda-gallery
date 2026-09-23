"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

// The one way prompts are drawn, wherever they appear — the detail panel, the
// workflow document, a pack. A prompt is a small module of sections (the
// prompt itself, what to keep out, how it was run), each its own copy target.
// Cardless: hairlines and type do the separating.

export type PromptSectionsData = {
  finalPrompt: string;
  negativePrompt?: string;
  generationNotes?: string;
};

/**
 * Normalises whatever a prompt row carries into sections. A flat `text` with
 * no sections becomes the final prompt; empty strings are dropped so a section
 * only renders when it says something.
 */
export function toPromptSections(
  text?: string | null,
  sections?: PromptSectionsData | null,
): PromptSectionsData | null {
  const finalPrompt = sections?.finalPrompt?.trim() || text?.trim();
  if (!finalPrompt) return null;
  return {
    finalPrompt,
    negativePrompt: sections?.negativePrompt?.trim() || undefined,
    generationNotes: sections?.generationNotes?.trim() || undefined,
  };
}

/**
 * Step labels often arrive already numbered ("4 · Vlog"). The UI prints its
 * own index, so the label's copy is dropped rather than shown twice.
 */
export function stripLeadingIndex(label: string): string {
  return label.replace(/^\s*\d{1,2}\s*[·.:\-–—]\s*/, "").trim();
}

/** The whole module as one clipboard payload. */
export function promptSectionsToText(sections: PromptSectionsData): string {
  const parts = [sections.finalPrompt];
  if (sections.negativePrompt) parts.push(`Negative — ${sections.negativePrompt}`);
  if (sections.generationNotes) parts.push(`Notes — ${sections.generationNotes}`);
  return parts.join("\n\n");
}

type Section = {
  key: "prompt" | "negative" | "notes";
  label: string;
  copyLabel: string;
  body: string;
  /** Notes read as prose, not as a prompt to paste. */
  prose?: boolean;
};

const sectionsOf = (data: PromptSectionsData): Section[] => {
  const out: Section[] = [
    { key: "prompt", label: "Prompt", copyLabel: "PROMPT COPIED", body: data.finalPrompt },
  ];
  if (data.negativePrompt) {
    out.push({
      key: "negative",
      label: "Negative",
      copyLabel: "NEGATIVE COPIED",
      body: data.negativePrompt,
    });
  }
  if (data.generationNotes) {
    out.push({
      key: "notes",
      label: "Notes",
      copyLabel: "NOTES COPIED",
      body: data.generationNotes,
      prose: true,
    });
  }
  return out;
};

export function PromptSections({
  sections,
  onCopy,
  size = "panel",
  maxBodyHeight,
}: {
  sections: PromptSectionsData;
  /** Copies `text` and confirms with `label` (a toast, usually). */
  onCopy: (text: string, label: string) => void | Promise<void>;
  /** "panel" is the 12.5px side-panel scale; "doc" is the workflow document. */
  size?: "panel" | "doc";
  /** Scroll the prompt body past this height instead of growing the panel. */
  maxBodyHeight?: number;
}) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const isDoc = size === "doc";

  const copy = async (section: Section) => {
    await onCopy(section.body, section.copyLabel);
    setCopiedKey(section.key);
    setTimeout(() => setCopiedKey((current) => (current === section.key ? null : current)), 1600);
  };

  return (
    <div className="flex flex-col">
      {sectionsOf(sections).map((section, index) => (
        <div
          key={section.key}
          style={{
            paddingTop: index === 0 ? 0 : isDoc ? "1.1rem" : "0.7rem",
            paddingBottom: isDoc ? "1.1rem" : "0.75rem",
            borderTop: index === 0 ? "none" : "1px solid var(--lm-border-subtle)",
          }}
        >
          <div className="flex items-center justify-between gap-2" style={{ paddingBottom: isDoc ? "0.5rem" : "0.25rem" }}>
            <span
              style={{
                fontSize: "10px",
                fontWeight: 700,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color:
                  section.key === "negative"
                    ? "var(--lm-coral)"
                    : "var(--lm-text-ghost)",
              }}
            >
              {section.label}
            </span>
            <button
              type="button"
              onClick={() => void copy(section)}
              className="inline-flex shrink-0 items-center gap-1 border-none bg-transparent p-0"
              title={`Copy ${section.label.toLowerCase()}`}
              style={{
                cursor: "pointer",
                fontFamily: "var(--lm-font)",
                fontSize: "11px",
                fontWeight: copiedKey === section.key ? 700 : 500,
                letterSpacing: "0.04em",
                color:
                  copiedKey === section.key
                    ? "var(--lm-coral)"
                    : "var(--lm-text-tertiary)",
              }}
            >
              {copiedKey === section.key ? (
                <Check className="h-3 w-3" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
              <span>{copiedKey === section.key ? "Copied" : "Copy"}</span>
            </button>
          </div>
          <pre
            style={{
              margin: 0,
              fontFamily: "var(--lm-font)",
              fontSize: isDoc ? "12.5px" : "12.5px",
              lineHeight: isDoc ? 1.65 : 1.55,
              color: section.prose
                ? "var(--lm-text-secondary)"
                : "var(--lm-text-primary)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight:
                section.key === "prompt" && maxBodyHeight
                  ? `${maxBodyHeight}px`
                  : undefined,
              overflowY:
                section.key === "prompt" && maxBodyHeight ? "auto" : undefined,
            }}
          >
            {section.body}
          </pre>
        </div>
      ))}
    </div>
  );
}
