"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Copy, Download, Loader2, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCoralToastSafe } from "@/components/ui/coral-toast";
import {
  PromptSections,
  promptSectionsToText,
  stripLeadingIndex,
  toPromptSections,
} from "./prompt-sections";

interface WorkflowModalProps {
  workflowId: string | null;
  ownerUserId: string;
  onClose: () => void;
}

type WorkflowResult = NonNullable<
  FunctionReturnType<typeof api.workflows.getWorkflow>
>;
type WorkflowStep = WorkflowResult["steps"][number];
type StepMedia = WorkflowStep["media"][number];

const padIndex = (n: number) => String(n).padStart(2, "0");

const stepFinalPrompt = (step: WorkflowStep) =>
  (step.promptSections?.finalPrompt || step.promptText).trim();

const buildWorkflowText = (workflow: WorkflowResult): string => {
  const lines: string[] = [`# ${workflow.title}`];
  if (workflow.description) {
    lines.push("", workflow.description.trim());
  }
  if (workflow.agentInstructions) {
    lines.push("", `> ${workflow.agentInstructions.trim()}`);
  }
  workflow.steps.forEach((step, index) => {
    const label = step.stepLabel?.trim()
      ? stripLeadingIndex(step.stepLabel)
      : `Step ${index + 1}`;
    lines.push("", `## ${padIndex(index + 1)} · ${label}`);
    if (step.modelName) lines.push("", `Model — ${step.modelName}`);
    lines.push("", stepFinalPrompt(step));
    if (step.promptSections?.negativePrompt) {
      lines.push("", `Negative — ${step.promptSections.negativePrompt.trim()}`);
    }
    if (step.promptSections?.generationNotes) {
      lines.push("", `Notes — ${step.promptSections.generationNotes.trim()}`);
    }
    const captioned = step.media.filter((item) => item.description?.trim());
    if (captioned.length > 0) {
      lines.push("");
      captioned.forEach((item, mediaIndex) => {
        lines.push(
          `${item.kind === "video" ? "Video" : "Image"} ${mediaIndex + 1} — ${item.description!.trim()}`,
        );
      });
    }
  });
  return lines.join("\n");
};

function CinematicFigure({
  item,
  alt,
  caption,
  note,
}: {
  item: StepMedia;
  alt: string;
  caption?: string;
  /** The per-file caption from ingest — what this render is within the step. */
  note?: string;
}) {
  if (!item.url) return null;

  return (
    <figure className="md-figure">
      <div className="md-figure-frame">
        {item.kind === "video" ? (
          <video
            src={item.url}
            poster={item.thumbUrl ?? undefined}
            controls
            playsInline
            preload="metadata"
            className="md-figure-media"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.url}
            alt={alt}
            className="md-figure-media"
            loading="lazy"
            decoding="async"
          />
        )}
        <span aria-hidden className="md-figure-bracket md-figure-bracket--tl" />
        <span aria-hidden className="md-figure-bracket md-figure-bracket--tr" />
        <span aria-hidden className="md-figure-bracket md-figure-bracket--bl" />
        <span aria-hidden className="md-figure-bracket md-figure-bracket--br" />
        <span className="md-figure-kind">{item.kind === "video" ? "MOV" : "IMG"}</span>
      </div>
      {note ? <figcaption className="md-figure-note">{note}</figcaption> : null}
      {caption ? <figcaption className="md-figure-caption">{caption}</figcaption> : null}
    </figure>
  );
}

// Every file of the step, stacked, each with its own caption. Sits beside the
// prompt so a render and the words that made it share one line of sight.
function StepMediaColumn({ step }: { step: WorkflowStep }) {
  const media = step.media.filter((item) => item.url);
  if (media.length === 0) {
    return (
      <div className="md-figure-empty">
        <span className="md-figure-kind md-figure-kind--inline">{"// PROMPT ONLY"}</span>
        <span>No media saved for this step.</span>
      </div>
    );
  }
  return (
    <div className="md-step-figures">
      {media.map((item, i) => (
        <CinematicFigure
          key={item.id}
          item={item}
          alt={`${step.stepLabel ?? "Workflow asset"} ${media.length > 1 ? i + 1 : ""}`.trim()}
          note={item.description?.trim() || undefined}
          caption={media.length > 1 ? `${padIndex(i + 1)} / ${padIndex(media.length)}` : undefined}
        />
      ))}
    </div>
  );
}

function PromptBlock({
  step,
  onCopy,
}: {
  step: WorkflowStep;
  onCopy: (text: string, label: string) => void;
}) {
  const sections = toPromptSections(step.promptText, step.promptSections);
  if (!sections) return null;
  const mediaCount = step.media.filter((item) => item.url).length;

  return (
    <div className="md-prompt-module">
      <div className="md-prompt-header">
        <span className="md-prompt-eyebrow">{"// GENERATION"}</span>
        <span aria-hidden className="md-prompt-divider" />
        <span className="md-prompt-model">{step.modelName ?? "Model unspecified"}</span>
        {mediaCount > 1 ? (
          <span className="md-prompt-count">{padIndex(mediaCount)} files</span>
        ) : null}
        <button
          type="button"
          onClick={() => onCopy(promptSectionsToText(sections), "PROMPT COPIED")}
          className="md-prompt-copy"
          title="Copy the whole prompt module"
        >
          <Copy className="h-3 w-3" />
          <span>Copy all</span>
        </button>
      </div>
      <div className="md-prompt-sections">
        <PromptSections sections={sections} onCopy={onCopy} size="doc" />
      </div>
    </div>
  );
}

export function WorkflowModal({
  workflowId,
  ownerUserId,
  onClose,
}: WorkflowModalProps) {
  const toast = useCoralToastSafe()?.toast;
  const [downloading, setDownloading] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const workflow = useQuery(
    api.workflows.getWorkflow,
    workflowId
      ? { id: workflowId as Id<"workflows">, ownerUserId }
      : "skip",
  );

  useEffect(() => {
    if (!workflowId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [workflowId, onClose]);

  // Reset scroll when switching workflows
  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: 0 });
  }, [workflowId]);

  const copyWorkflow = useCallback(async () => {
    if (!workflow) return;
    await navigator.clipboard.writeText(buildWorkflowText(workflow));
    toast?.("Copied", "WORKFLOW COPIED", "success");
  }, [workflow, toast]);

  const copyStepText = useCallback(
    async (text: string, label: string) => {
      await navigator.clipboard.writeText(text);
      toast?.("Copied", label, "success");
    },
    [toast],
  );

  const downloadSkill = useCallback(async () => {
    if (!workflowId) return;
    setDownloading(true);
    try {
      const response = await fetch(`/api/workflows/${workflowId}/skill`);
      if (!response.ok) throw new Error("Export failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${workflow?.title ?? "workflow"}-skill.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast?.("Downloaded", "SKILL EXPORTED", "success");
    } catch {
      toast?.("Error", "EXPORT FAILED", "warning");
    } finally {
      setDownloading(false);
    }
  }, [workflowId, workflow?.title, toast]);

  const modelChips = useMemo(() => {
    if (!workflow) return [] as string[];
    const seen = new Set<string>();
    const names: string[] = [];
    for (const step of workflow.steps) {
      const name = step.modelName?.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(name);
    }
    return names;
  }, [workflow]);

  if (!workflowId) return null;

  return (
    <div
      className="md-modal-shell"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={workflow?.title ?? "Workflow"}
    >
      <div className="md-modal-card" onClick={(e) => e.stopPropagation()}>
        {workflow === undefined ? (
          <div className="md-modal-state">
            <Loader2 className="h-6 w-6 animate-spin md-modal-state-icon" />
          </div>
        ) : workflow === null ? (
          <div className="md-modal-state">
            <p className="md-modal-state-text">Workflow not found</p>
            <button type="button" onClick={onClose} className="md-action md-action--ghost">
              Close
            </button>
          </div>
        ) : (
          <>
            {/* Sticky action bar */}
            <div className="md-action-bar">
              <div className="md-action-bar-meta">
                <span className="md-action-bar-eyebrow">{"// WORKFLOW"}</span>
                <span aria-hidden className="md-action-bar-sep" />
                <span className="md-action-bar-count">
                  {padIndex(workflow.stepCount)} {workflow.stepCount === 1 ? "step" : "steps"}
                </span>
              </div>

              <div className="md-action-bar-actions">
                <button
                  type="button"
                  onClick={() => void copyWorkflow()}
                  className="md-action md-action--primary"
                >
                  <Copy className="h-3.5 w-3.5" />
                  <span>Copy as markdown</span>
                </button>
                <button
                  type="button"
                  onClick={() => void downloadSkill()}
                  disabled={downloading}
                  className="md-action md-action--ghost"
                >
                  {downloading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  <span>Download skill</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="md-action-close"
                  aria-label="Close workflow"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Editorial document body */}
            <div ref={scrollerRef} className="md-doc-scroller">
              <article className="md-doc">
                {/* Hero */}
                <header className="md-hero">
                  <div className="md-hero-eyebrow">
                    <span aria-hidden className="md-hero-pulse">
                      <span className="md-hero-pulse-ring" />
                      <span className="md-hero-pulse-core" />
                    </span>
                    <span>{"// WORKFLOW"}</span>
                  </div>

                  <h1 className="md-h1">{workflow.title}</h1>

                  {workflow.description ? (
                    <p className="md-lede">{workflow.description}</p>
                  ) : null}

                  {modelChips.length > 0 ? (
                    <p className="md-tools">
                      <span className="md-tools-label">Tools used</span>
                      <span aria-hidden className="md-tools-slash">/</span>
                      <span className="md-tools-list">{modelChips.join(" · ")}</span>
                    </p>
                  ) : null}

                  <div className="md-meta">
                    <Meta label="Steps" value={padIndex(workflow.stepCount)} />
                    <MetaSep />
                    <Meta label="Models" value={padIndex(modelChips.length)} />
                    {workflow.tagNames.length > 0 ? (
                      <>
                        <MetaSep />
                        <Meta
                          label="Tags"
                          value={workflow.tagNames.slice(0, 3).join(" · ")}
                        />
                      </>
                    ) : null}
                    {workflow.isPublic ? (
                      <>
                        <MetaSep />
                        <Meta label="Visibility" value="Public" highlight />
                      </>
                    ) : null}
                  </div>
                </header>

                {/* Agent instructions callout */}
                {workflow.agentInstructions ? (
                  <aside className="md-callout">
                    <span aria-hidden className="md-callout-dot" />
                    <div>
                      <span className="md-callout-eyebrow">{"// AGENT NOTE"}</span>
                      <p className="md-callout-body">{workflow.agentInstructions}</p>
                    </div>
                  </aside>
                ) : null}

                {/* Steps */}
                {workflow.steps.map((step, index) => {
                  const label = step.stepLabel?.trim()
                    ? stripLeadingIndex(step.stepLabel)
                    : `Step ${index + 1}`;
                  const idx = padIndex(index + 1);
                  return (
                    <section key={step.promptId} className="md-section">
                      <div className="md-section-head">
                        <span aria-hidden className="md-section-numeral">{idx}</span>
                        <div className="md-section-titleblock">
                          <div className="md-section-eyebrow-row">
                            <span className="md-section-eyebrow md-section-eyebrow--mobile">
                              {`// ${idx}`}
                            </span>
                            <span aria-hidden className="md-section-rule" />
                            <span className="md-section-eyebrow">STEP</span>
                            {step.modelName ? (
                              <>
                                <span aria-hidden className="md-section-dot">·</span>
                                <span className="md-section-model">{step.modelName}</span>
                              </>
                            ) : null}
                          </div>
                          <h2 className="md-h2">{label}</h2>
                        </div>
                      </div>

                      <div className="md-step-body">
                        <div className="md-step-media">
                          <StepMediaColumn step={step} />
                        </div>
                        <div className="md-step-prompt">
                          <PromptBlock step={step} onCopy={copyStepText} />
                        </div>
                      </div>
                    </section>
                  );
                })}

                {/* Footer rule */}
                <div className="md-doc-end">
                  <span aria-hidden className="md-doc-end-rule" />
                  <p className="md-doc-end-text">End of workflow · {padIndex(workflow.stepCount)} steps</p>
                </div>
              </article>
            </div>
          </>
        )}
      </div>

      <style jsx global>{`
        .md-modal-shell {
          position: fixed;
          inset: 0;
          z-index: 60;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          overflow-y: auto;
          padding: 1rem;
          background: var(--lm-scrim);
          backdrop-filter: blur(8px);
        }
        @media (min-width: 640px) {
          .md-modal-shell { padding: 2rem; }
        }

        .md-modal-card {
          position: relative;
          margin: auto 0;
          width: 100%;
          max-width: 1280px;
          overflow: hidden;
          border-radius: 18px;
          background: var(--surface-0);
          border: 1px solid var(--border-default);
          box-shadow: var(--lm-modal-shadow);
        }

        .md-modal-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.85rem;
          padding: 4.5rem 1.5rem;
        }
        .md-modal-state-icon { color: var(--text-ghost); }
        .md-modal-state-text {
          font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: 11px;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          color: var(--text-tertiary);
        }

        /* === STICKY ACTION BAR ============================================= */
        .md-action-bar {
          position: sticky;
          top: 0;
          z-index: 20;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          padding: 0.85rem 1.25rem;
          background: color-mix(in srgb, var(--surface-0) 88%, transparent);
          backdrop-filter: blur(14px);
          border-bottom: 1px solid var(--border-subtle);
        }
        @media (min-width: 640px) {
          .md-action-bar { padding: 1rem 1.75rem; }
        }
        .md-action-bar-meta {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          min-width: 0;
        }
        .md-action-bar-eyebrow {
          font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.28em;
          text-transform: uppercase;
          color: var(--coral);
        }
        .md-action-bar-sep {
          width: 1px;
          height: 12px;
          background: color-mix(in srgb, var(--text-primary) 15%, transparent);
          display: inline-block;
        }
        .md-action-bar-count {
          font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: 10px;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          color: var(--text-tertiary);
        }
        .md-action-bar-actions {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .md-action {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem 0.9rem;
          border-radius: 999px;
          font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          border: 1px solid transparent;
          cursor: pointer;
          transition:
            background-color 180ms ease,
            color 180ms ease,
            border-color 180ms ease,
            transform 120ms ease;
          white-space: nowrap;
        }
        .md-action:active { transform: scale(0.97); }
        .md-action:disabled { opacity: 0.6; cursor: not-allowed; }

        .md-action--primary {
          background: var(--coral);
          color: var(--primary-foreground, #fff);
          border-color: transparent;
          box-shadow: 0 0 18px color-mix(in srgb, var(--coral) 35%, transparent);
        }
        .md-action--primary:hover {
          background: color-mix(in srgb, var(--coral) 88%, white 12%);
        }
        .md-action--ghost {
          background: color-mix(in srgb, var(--text-primary) 4%, transparent);
          color: var(--text-secondary);
          border-color: var(--border-subtle);
        }
        .md-action--ghost:hover {
          background: color-mix(in srgb, var(--text-primary) 8%, transparent);
          color: var(--text-primary);
        }

        .md-action-close {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 34px;
          height: 34px;
          border-radius: 999px;
          background: transparent;
          color: var(--text-tertiary);
          border: 1px solid var(--border-subtle);
          cursor: pointer;
          transition: background-color 180ms ease, color 180ms ease;
        }
        .md-action-close:hover {
          background: color-mix(in srgb, var(--text-primary) 6%, transparent);
          color: var(--text-primary);
        }

        /* Hide some action labels on narrow screens to keep the bar tidy */
        @media (max-width: 560px) {
          .md-action span { display: none; }
        }

        /* === DOC SCROLLER ================================================== */
        .md-doc-scroller {
          max-height: calc(100vh - 6rem);
          overflow-y: auto;
        }

        .md-doc {
          max-width: 1160px;
          margin: 0 auto;
          padding: 3rem 1.5rem 4.5rem;
          color: var(--text-primary);
        }
        @media (min-width: 640px) {
          .md-doc { padding: 4rem 2.5rem 6rem; }
        }

        /* === HERO ========================================================== */
        .md-hero {
          max-width: 760px;
          padding-bottom: 2.25rem;
          border-bottom: 1px solid var(--border-subtle);
          margin-bottom: 3rem;
        }
        .md-hero-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 0.65rem;
          margin-bottom: 1.5rem;
          font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.28em;
          text-transform: uppercase;
          color: var(--coral);
        }
        .md-hero-pulse {
          position: relative;
          display: inline-block;
          width: 6px;
          height: 6px;
        }
        .md-hero-pulse-ring {
          position: absolute;
          inset: 0;
          border-radius: 999px;
          background: color-mix(in srgb, var(--coral) 60%, transparent);
          animation: md-ping 1.8s cubic-bezier(0, 0, 0.2, 1) infinite;
        }
        .md-hero-pulse-core {
          position: relative;
          display: inline-block;
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: var(--coral);
        }
        @keyframes md-ping {
          75%, 100% { transform: scale(2); opacity: 0; }
        }

        .md-h1 {
          font-size: clamp(1.9rem, 3.6vw, 2.85rem);
          font-weight: 600;
          line-height: 1.05;
          letter-spacing: -0.018em;
          color: var(--text-primary);
          margin: 0;
        }

        .md-lede {
          margin-top: 1.4rem;
          max-width: 56ch;
          font-size: clamp(0.98rem, 1.2vw, 1.08rem);
          line-height: 1.62;
          color: var(--text-secondary);
        }

        .md-tools {
          margin-top: 1.5rem;
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          gap: 0.4rem 0.85rem;
          font-size: 13px;
          line-height: 1.55;
          color: var(--text-secondary);
        }
        .md-tools-label {
          font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: 10px;
          letter-spacing: 0.28em;
          text-transform: uppercase;
          color: color-mix(in srgb, var(--coral) 80%, transparent);
        }
        .md-tools-slash { color: var(--text-ghost); }
        .md-tools-list { font-weight: 300; color: var(--text-primary); }

        .md-meta {
          margin-top: 2.25rem;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.5rem 0;
          padding-top: 1.4rem;
          border-top: 1px solid var(--border-subtle);
          font-size: 13px;
        }

        /* === CALLOUT ======================================================= */
        .md-callout {
          display: flex;
          gap: 1rem;
          align-items: flex-start;
          max-width: 760px;
          margin: 0 0 2.5rem;
          padding: 1.05rem 1.2rem;
          border-radius: 12px;
          background: color-mix(in srgb, var(--coral) 6%, transparent);
          border: 1px solid color-mix(in srgb, var(--coral) 22%, transparent);
        }
        .md-callout-dot {
          margin-top: 0.55rem;
          width: 6px;
          height: 6px;
          flex-shrink: 0;
          border-radius: 999px;
          background: var(--coral);
        }
        .md-callout-eyebrow {
          display: block;
          margin-bottom: 0.4rem;
          font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.28em;
          text-transform: uppercase;
          color: var(--coral);
        }
        .md-callout-body {
          font-size: 14px;
          line-height: 1.6;
          color: var(--text-primary);
          margin: 0;
        }

        /* === SECTION (per step) ============================================ */
        .md-section {
          padding-top: 3.5rem;
          scroll-margin-top: 6rem;
        }
        .md-section + .md-section { padding-top: 4rem; }

        .md-section-head {
          display: flex;
          align-items: flex-end;
          gap: 1.25rem;
          padding-bottom: 1.4rem;
          margin-bottom: 2rem;
          border-bottom: 1px solid var(--border-subtle);
        }
        @media (min-width: 640px) {
          .md-section-head { gap: 1.65rem; }
        }
        .md-section-numeral {
          display: none;
          font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: clamp(2.4rem, 3.6vw, 3.4rem);
          line-height: 1;
          letter-spacing: -0.04em;
          color: color-mix(in srgb, var(--coral) 45%, transparent);
          text-shadow: 0 0 28px color-mix(in srgb, var(--coral) 25%, transparent);
          font-variant-numeric: tabular-nums;
          flex-shrink: 0;
        }
        @media (min-width: 640px) {
          .md-section-numeral { display: block; }
        }
        .md-section-titleblock { min-width: 0; flex: 1; }
        .md-section-eyebrow-row {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          margin-bottom: 0.65rem;
          flex-wrap: wrap;
        }
        .md-section-eyebrow {
          font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.26em;
          text-transform: uppercase;
          color: var(--text-tertiary);
        }
        .md-section-eyebrow--mobile { color: var(--coral); }
        @media (min-width: 640px) {
          .md-section-eyebrow--mobile { display: none; }
        }
        .md-section-rule {
          display: none;
          width: 18px;
          height: 1px;
          background: color-mix(in srgb, var(--coral) 55%, transparent);
        }
        @media (min-width: 640px) {
          .md-section-rule { display: inline-block; }
        }
        .md-section-dot { color: var(--text-ghost); }
        .md-section-model {
          font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: 10px;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: var(--text-secondary);
        }
        .md-h2 {
          font-size: clamp(1.35rem, 2.4vw, 1.9rem);
          font-weight: 600;
          line-height: 1.12;
          letter-spacing: -0.012em;
          color: var(--text-primary);
          margin: 0;
        }

        /* === STEP BODY — media beside its prompt =========================== */
        .md-step-body {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 1.75rem;
          align-items: start;
        }
        @media (min-width: 960px) {
          .md-step-body {
            grid-template-columns: minmax(0, 11fr) minmax(360px, 9fr);
            gap: 2.5rem;
          }
          .md-step-media {
            position: sticky;
            top: 5rem;
            /* A step with several tall files scrolls inside its own column
               rather than pinning its bottom half out of reach. */
            max-height: calc(100vh - 8rem);
            overflow-y: auto;
            scrollbar-width: thin;
          }
        }
        .md-step-figures {
          display: flex;
          flex-direction: column;
          gap: 1.1rem;
        }
        .md-step-figures .md-figure { margin: 0; }
        .md-figure-note {
          margin-top: 0.55rem;
          font-size: 12px;
          line-height: 1.5;
          color: var(--text-secondary);
        }

        /* === FIGURES ======================================================= */
        .md-figure {
          margin: 0 0 2rem;
        }
        .md-figure-grid {
          display: grid;
          gap: 0.9rem;
          grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
          margin-bottom: 2rem;
        }
        .md-figure-grid .md-figure { margin: 0; }

        .md-figure-frame {
          position: relative;
          overflow: hidden;
          border-radius: 14px;
          background: var(--surface-1);
          border: 1px solid var(--border-subtle);
        }
        .md-figure-media {
          display: block;
          width: 100%;
          height: auto;
          max-height: 620px;
          object-fit: contain;
          background: var(--surface-1);
        }
        .md-figure-bracket {
          position: absolute;
          width: 14px;
          height: 14px;
          pointer-events: none;
          border-color: color-mix(in srgb, white 35%, transparent);
        }
        .md-figure-bracket--tl {
          top: 10px; left: 10px;
          border-top: 1px solid; border-left: 1px solid;
        }
        .md-figure-bracket--tr {
          top: 10px; right: 10px;
          border-top: 1px solid; border-right: 1px solid;
        }
        .md-figure-bracket--bl {
          bottom: 10px; left: 10px;
          border-bottom: 1px solid; border-left: 1px solid;
        }
        .md-figure-bracket--br {
          bottom: 10px; right: 10px;
          border-bottom: 1px solid; border-right: 1px solid;
        }
        .md-figure-kind {
          position: absolute;
          left: 10px;
          bottom: 10px;
          padding: 3px 7px;
          border-radius: 6px;
          background: rgba(0, 0, 0, 0.7);
          color: #fff;
          font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: 9px;
          letter-spacing: 0.22em;
          text-transform: uppercase;
        }
        .md-figure-kind--inline {
          position: static;
          color: var(--coral);
          background: transparent;
          padding: 0;
        }
        .md-figure-caption {
          margin-top: 0.6rem;
          text-align: center;
          font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: 10px;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          color: var(--text-ghost);
        }
        .md-figure-empty {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 0.4rem;
          padding: 1.2rem 1.4rem;
          margin-bottom: 2rem;
          border-radius: 12px;
          background: color-mix(in srgb, var(--text-primary) 3%, transparent);
          border: 1px dashed var(--border-subtle);
          font-size: 12px;
          color: var(--text-tertiary);
        }

        /* === PROMPT MODULE ================================================= */
        .md-prompt-module {
          margin: 0 0 1.25rem;
        }
        .md-prompt-header {
          display: flex;
          align-items: center;
          gap: 0.65rem;
          padding: 0 0 0.8rem;
          border-bottom: 1px solid var(--border-subtle);
          margin-bottom: 1rem;
        }
        .md-prompt-count {
          font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: 10px;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          color: var(--text-ghost);
          white-space: nowrap;
        }
        .md-prompt-sections { min-width: 0; }
        .md-prompt-eyebrow {
          font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.28em;
          text-transform: uppercase;
          color: color-mix(in srgb, var(--coral) 85%, transparent);
        }
        .md-prompt-eyebrow--coral { color: var(--coral); }
        .md-prompt-divider {
          width: 1px;
          height: 12px;
          background: color-mix(in srgb, var(--text-primary) 15%, transparent);
        }
        .md-prompt-model {
          flex: 1;
          font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: 10px;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          color: var(--text-secondary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .md-prompt-copy {
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          padding: 0.35rem 0.7rem;
          border-radius: 999px;
          border: 1px solid var(--border-subtle);
          background: transparent;
          color: var(--text-secondary);
          font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: 9.5px;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          cursor: pointer;
          transition: background-color 180ms ease, color 180ms ease;
          white-space: nowrap;
        }
        .md-prompt-copy:hover {
          background: color-mix(in srgb, var(--text-primary) 6%, transparent);
          color: var(--text-primary);
        }
        /* === DOC END ======================================================= */
        .md-doc-end {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.85rem;
          padding-top: 4rem;
        }
        .md-doc-end-rule {
          width: 60px;
          height: 1px;
          background: linear-gradient(
            90deg,
            transparent,
            color-mix(in srgb, var(--text-primary) 18%, transparent),
            transparent
          );
        }
        .md-doc-end-text {
          margin: 0;
          font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: 10px;
          letter-spacing: 0.26em;
          text-transform: uppercase;
          color: var(--text-ghost);
        }
      `}</style>
    </div>
  );
}

function Meta({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <span className="md-meta-pair">
      <span className="md-meta-label">{label}</span>
      <span className={`md-meta-value${highlight ? " md-meta-value--hi" : ""}`}>{value}</span>
      <style jsx global>{`
        .md-meta-pair {
          display: inline-flex;
          align-items: baseline;
          gap: 0.45rem;
        }
        .md-meta-label {
          font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: 10px;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          color: var(--text-ghost);
        }
        .md-meta-value {
          font-size: 13px;
          font-weight: 300;
          color: var(--text-primary);
        }
        .md-meta-value--hi { color: var(--coral); }
      `}</style>
    </span>
  );
}

function MetaSep() {
  return (
    <>
      <span aria-hidden className="md-meta-sep" />
      <style jsx global>{`
        .md-meta-sep {
          display: inline-block;
          width: 1px;
          height: 12px;
          margin: 0 1.1rem;
          background: color-mix(in srgb, var(--text-primary) 10%, transparent);
          align-self: center;
        }
      `}</style>
    </>
  );
}
