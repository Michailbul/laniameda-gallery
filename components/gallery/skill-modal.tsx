"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  BookOpenText,
  Copy,
  Download,
  Film,
  FolderOpen,
  Hash,
  Loader2,
  Plus,
  X,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCoralToastSafe } from "@/components/ui/coral-toast";
import {
  PromptSections,
  promptSectionsToText,
  stripLeadingIndex,
  toPromptSections,
} from "./prompt-sections";
import { SkillMarkdown, type SkillMediaRef } from "./skill-markdown";
import { SKILL_SECTION_COPY, isCinematographySkill } from "@/lib/cinematography";

interface SkillModalProps {
  skillId: string | null;
  ownerUserId: string;
  onClose: () => void;
}

type SkillResult = NonNullable<FunctionReturnType<typeof api.workflows.getWorkflow>>;
type SkillStep = SkillResult["steps"][number];

const pad = (n: number) => String(n).padStart(2, "0");

const stepTitle = (step: SkillStep, index: number) =>
  step.stepLabel?.trim() ? stripLeadingIndex(step.stepLabel) : `Step ${index + 1}`;

// The whole skill as one markdown document — what "Copy as markdown" puts on
// the clipboard and what an agent would read.
const buildSkillMarkdown = (skill: SkillResult): string => {
  const lines: string[] = [`# ${skill.title}`];
  if (skill.description) lines.push("", skill.description.trim());
  if (skill.tagNames.length > 0) {
    lines.push("", skill.tagNames.map((tag) => `#${tag}`).join(" "));
  }
  if (skill.body) lines.push("", skill.body.trim());
  if (skill.agentInstructions) {
    lines.push("", "## How to run it", "", skill.agentInstructions.trim());
  }
  skill.steps.forEach((step, index) => {
    lines.push("", `## ${pad(index + 1)} · ${stepTitle(step, index)}`);
    if (step.modelName) lines.push("", `Model: ${step.modelName}`);
    const sections = toPromptSections(step.promptText, step.promptSections);
    if (sections) lines.push("", "```", promptSectionsToText(sections), "```");
    step.media
      .filter((item) => item.url)
      .forEach((item) => {
        lines.push("", `![${item.description?.trim() ?? ""}](${item.url})`);
      });
  });
  return lines.join("\n");
};

function StepFigures({
  step,
  onOpen,
}: {
  step: SkillStep;
  onOpen: (media: SkillMediaRef) => void;
}) {
  const media = step.media.filter((item) => item.url || item.thumbUrl);
  if (media.length === 0) return null;
  return (
    <div className="skill-doc-figures" data-count={Math.min(media.length, 3)}>
      {media.map((item, index) => (
        <figure key={item.id} className="skill-doc-figure">
          <button
            type="button"
            className="skill-doc-figure-frame"
            onClick={() => onOpen(item)}
            aria-label={`Open ${item.kind} ${index + 1}`}
          >
            {item.kind === "video" ? (
              <video
                src={item.url}
                poster={item.thumbUrl ?? undefined}
                muted
                loop
                playsInline
                preload="metadata"
                onMouseEnter={(event) => void event.currentTarget.play().catch(() => {})}
                onMouseLeave={(event) => event.currentTarget.pause()}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.thumbUrl ?? item.url}
                alt={item.description ?? ""}
                loading="lazy"
                decoding="async"
              />
            )}
            <span className="skill-doc-figure-kind">
              {item.kind === "video" ? "MOV" : "IMG"}
              {media.length > 1 ? ` ${pad(index + 1)}/${pad(media.length)}` : ""}
            </span>
          </button>
          {item.description?.trim() ? (
            <figcaption>{item.description.trim()}</figcaption>
          ) : null}
        </figure>
      ))}
    </div>
  );
}

// Tags and collections, editable in place. This is how a skill gets filed.
function FilingPanel({
  skill,
  ownerUserId,
}: {
  skill: SkillResult;
  ownerUserId: string;
}) {
  const toast = useCoralToastSafe()?.toast;
  const updateSkill = useMutation(api.workflows.updateSkill);
  const addToCollection = useMutation(api.workflows.addSkillToCollection);
  const removeFromCollection = useMutation(api.workflows.removeSkillFromCollection);
  const folders = useQuery(api.folders.listFolders, { ownerUserId });
  const [tagDraft, setTagDraft] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");

  const fail = (error: unknown) =>
    toast?.(
      "Failed",
      error instanceof Error ? error.message.toUpperCase() : "COULD NOT SAVE",
      "warning",
    );

  const addTag = async () => {
    const names = tagDraft
      .split(",")
      .map((name) => name.trim().replace(/^#+/, ""))
      .filter(Boolean);
    if (names.length === 0) return;
    setTagDraft("");
    try {
      await updateSkill({ ownerUserId, id: skill._id, addTagNames: names });
    } catch (error) {
      fail(error);
    }
  };

  const collectionOptions = useMemo(() => {
    const byId = new Map((folders ?? []).map((folder) => [String(folder._id), folder]));
    const filed = new Set(skill.collections.map((entry) => String(entry._id)));
    const needle = pickerQuery.trim().toLowerCase();
    return (folders ?? [])
      .filter((folder) => folder.kind !== "storybook" && !filed.has(String(folder._id)))
      .map((folder) => {
        const parent = folder.parentFolderId
          ? byId.get(String(folder.parentFolderId))
          : undefined;
        return {
          id: folder._id,
          label: parent ? `${parent.name} › ${folder.name}` : folder.name,
        };
      })
      .filter((option) => !needle || option.label.toLowerCase().includes(needle))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [folders, pickerQuery, skill.collections]);

  const collectionLabel = (entry: SkillResult["collections"][number]) => {
    const parent = entry.parentFolderId
      ? folders?.find((folder) => folder._id === entry.parentFolderId)
      : undefined;
    return parent ? `${parent.name} › ${entry.name}` : entry.name;
  };

  return (
    <section className="skill-doc-filing" aria-label="Filing">
      <div className="skill-doc-filing-row">
        <span className="skill-doc-filing-label">
          <Hash className="h-3 w-3" /> Tags
        </span>
        <div className="skill-doc-filing-chips">
          {skill.tagNames.map((tag) => (
            <span key={tag} className="skill-doc-chip">
              #{tag}
              <button
                type="button"
                aria-label={`Remove tag ${tag}`}
                onClick={() =>
                  void updateSkill({
                    ownerUserId,
                    id: skill._id,
                    removeTagNames: [tag],
                  }).catch(fail)
                }
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
          <form
            className="skill-doc-chip-input"
            onSubmit={(event) => {
              event.preventDefault();
              void addTag();
            }}
          >
            <Plus className="h-2.5 w-2.5" />
            <input
              value={tagDraft}
              onChange={(event) => setTagDraft(event.target.value)}
              placeholder="Add tag"
              aria-label="Add tag"
            />
          </form>
        </div>
      </div>

      <div className="skill-doc-filing-row">
        <span className="skill-doc-filing-label">
          <FolderOpen className="h-3 w-3" /> Collections
        </span>
        <div className="skill-doc-filing-chips">
          {skill.collections.map((entry) => (
            <span key={entry._id} className="skill-doc-chip skill-doc-chip-collection">
              {collectionLabel(entry)}
              <button
                type="button"
                aria-label={`Remove from ${entry.name}`}
                title={`Remove from ${entry.name}`}
                onClick={() =>
                  void removeFromCollection({
                    ownerUserId,
                    id: skill._id,
                    folderId: entry._id,
                  })
                    .then(() =>
                      toast?.("Removed", `OUT OF ${entry.name.toUpperCase()}`, "success"),
                    )
                    .catch(fail)
                }
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
          <div className="skill-doc-picker">
            <button
              type="button"
              className="skill-doc-chip skill-doc-chip-add"
              onClick={() => setPickerOpen((open) => !open)}
              aria-expanded={pickerOpen}
            >
              <Plus className="h-2.5 w-2.5" /> Add to collection
            </button>
            {pickerOpen && (
              <div className="skill-doc-picker-menu" role="listbox">
                <input
                  autoFocus
                  value={pickerQuery}
                  onChange={(event) => setPickerQuery(event.target.value)}
                  placeholder="Find a collection"
                  aria-label="Find a collection"
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.stopPropagation();
                      setPickerOpen(false);
                    }
                  }}
                />
                <div className="skill-doc-picker-list">
                  {folders === undefined ? (
                    <span className="skill-doc-picker-empty">Loading…</span>
                  ) : collectionOptions.length === 0 ? (
                    <span className="skill-doc-picker-empty">No collection left</span>
                  ) : (
                    collectionOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        role="option"
                        aria-selected={false}
                        onClick={() => {
                          setPickerOpen(false);
                          setPickerQuery("");
                          void addToCollection({
                            ownerUserId,
                            id: skill._id,
                            folderId: option.id as Id<"folders">,
                          })
                            .then(() =>
                              toast?.("Filed", `IN ${option.label.toUpperCase()}`, "success"),
                            )
                            .catch(fail);
                        }}
                      >
                        <FolderOpen className="h-3 w-3" />
                        {option.label}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export function SkillModal({ skillId, ownerUserId, onClose }: SkillModalProps) {
  const toast = useCoralToastSafe()?.toast;
  const [downloading, setDownloading] = useState(false);
  const [lightbox, setLightbox] = useState<SkillMediaRef | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const skill = useQuery(
    api.workflows.getWorkflow,
    skillId ? { id: skillId as Id<"workflows">, ownerUserId } : "skip",
  );
  const isOwner = Boolean(skill && ownerUserId);
  // Cinematography packs open in the skill document under their own name.
  const isCinema = isCinematographySkill(skill?.tagNames);
  const sectionCopy = SKILL_SECTION_COPY[isCinema ? "cinematography" : "skills"];
  const KindIcon = isCinema ? Film : BookOpenText;
  const kindLabel = isCinema ? "Cinematography" : "Skill";
  const unitsFor = (count: number) => (count === 1 ? sectionCopy.unit : sectionCopy.units);

  useEffect(() => {
    if (!skillId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (lightbox) setLightbox(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [skillId, onClose, lightbox]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: 0 });
    setLightbox(null);
  }, [skillId]);

  const copyText = useCallback(
    async (text: string, label: string) => {
      await navigator.clipboard.writeText(text);
      toast?.("Copied", label, "success");
    },
    [toast],
  );

  const downloadSkill = useCallback(async () => {
    if (!skillId) return;
    setDownloading(true);
    try {
      const response = await fetch(`/api/workflows/${skillId}/skill`);
      if (!response.ok) throw new Error("Export failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = isCinema
        ? `${skill?.title ?? "cinematography"}.zip`
        : `${skill?.title ?? "skill"}-skill.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast?.("Downloaded", isCinema ? "EXPORTED" : "SKILL EXPORTED", "success");
    } catch {
      toast?.("Error", "EXPORT FAILED", "warning");
    } finally {
      setDownloading(false);
    }
  }, [isCinema, skillId, skill?.title, toast]);

  // Everything the body can embed by id: its own `asset:` refs and step media.
  const mediaById = useMemo(() => {
    const map = new Map<string, SkillMediaRef>();
    if (!skill) return map;
    for (const item of skill.bodyMedia) map.set(item.id, item);
    for (const step of skill.steps) for (const item of step.media) map.set(item.id, item);
    return map;
  }, [skill]);

  const cover = useMemo(() => {
    if (!skill) return undefined;
    for (const step of skill.steps) {
      const item = step.media.find((entry) => entry.kind === "image" && (entry.url || entry.thumbUrl));
      if (item) return item;
    }
    return skill.bodyMedia.find((entry) => entry.kind === "image");
  }, [skill]);

  const scrollToStep = (index: number) => {
    const target = scrollerRef.current?.querySelector(`#skill-step-${index}`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (!skillId) return null;

  return (
    <div
      className="skill-modal-shell"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={skill?.title ?? kindLabel}
    >
      <div className="skill-modal-card" onClick={(event) => event.stopPropagation()}>
        {skill === undefined ? (
          <div className="skill-modal-state">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : skill === null ? (
          <div className="skill-modal-state">
            <p>{kindLabel} not found</p>
            <button type="button" onClick={onClose} className="skill-action skill-action-ghost">
              Close
            </button>
          </div>
        ) : (
          <>
            <div className="skill-action-bar">
              <div className="skill-action-bar-meta">
                <span className="skill-card-badge skill-card-badge-kind">
                  <KindIcon className="h-2.5 w-2.5" strokeWidth={2.75} />
                  {kindLabel}
                </span>
                <span className="skill-action-bar-count">
                  {pad(skill.stepCount)} {unitsFor(skill.stepCount)}
                </span>
              </div>
              <div className="skill-action-bar-actions">
                <button
                  type="button"
                  onClick={() => void copyText(buildSkillMarkdown(skill), "MARKDOWN COPIED")}
                  className="skill-action skill-action-primary"
                >
                  <Copy className="h-3.5 w-3.5" />
                  <span>Copy markdown</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void copyText(
                      `workflow:${skill._id}`,
                      isCinema ? "ID COPIED" : "SKILL ID COPIED",
                    )
                  }
                  className="skill-action skill-action-ghost"
                  title={`Copy the ${sectionCopy.noun} ID an agent can resolve`}
                >
                  <Hash className="h-3.5 w-3.5" />
                  <span>ID</span>
                </button>
                <button
                  type="button"
                  onClick={() => void downloadSkill()}
                  disabled={downloading}
                  className="skill-action skill-action-ghost"
                >
                  {downloading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  <span>{isCinema ? "Export" : "SKILL.md"}</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="skill-action-close"
                  aria-label={`Close ${sectionCopy.noun}`}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div ref={scrollerRef} className="skill-doc-scroller">
              {cover ? (
                <button
                  type="button"
                  className="skill-doc-cover"
                  onClick={() => setLightbox(cover)}
                  aria-label="Open cover image"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={cover.url ?? cover.thumbUrl} alt="" />
                  <span className="skill-doc-cover-scrim" aria-hidden />
                </button>
              ) : null}

              <article className="skill-doc" data-has-cover={Boolean(cover)}>
                <header className="skill-doc-head">
                  <h1 className="skill-doc-title">{skill.title}</h1>
                  <div className="skill-doc-byline">
                    <span>
                      {pad(skill.stepCount)} {sectionCopy.units}
                    </span>
                    {skill.modelNames.length > 0 ? (
                      <>
                        <span aria-hidden>/</span>
                        <span className="skill-doc-byline-models">
                          {skill.modelNames.join(" · ")}
                        </span>
                      </>
                    ) : null}
                    <span aria-hidden>/</span>
                    <span>
                      Updated{" "}
                      {new Date(skill.updatedAt).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                  </div>
                  {skill.description ? (
                    <SkillMarkdown className="skill-doc-lede" onCopy={copyText}>
                      {skill.description}
                    </SkillMarkdown>
                  ) : null}
                </header>

                {isOwner ? <FilingPanel skill={skill} ownerUserId={ownerUserId} /> : null}

                {skill.steps.length >= 3 ? (
                  <nav className="skill-doc-toc" aria-label="Steps">
                    <span className="skill-doc-eyebrow">In this {sectionCopy.noun}</span>
                    <ol>
                      {skill.steps.map((step, index) => (
                        <li key={step.promptId}>
                          <button type="button" onClick={() => scrollToStep(index)}>
                            <span className="skill-doc-toc-num">{pad(index + 1)}</span>
                            {stepTitle(step, index)}
                          </button>
                        </li>
                      ))}
                    </ol>
                  </nav>
                ) : null}

                {skill.body ? (
                  <SkillMarkdown
                    media={mediaById}
                    onOpenMedia={setLightbox}
                    onCopy={copyText}
                    className="skill-doc-body"
                  >
                    {skill.body}
                  </SkillMarkdown>
                ) : null}

                {skill.agentInstructions ? (
                  <aside className="skill-doc-note">
                    <span className="skill-doc-eyebrow">How to run it</span>
                    <SkillMarkdown media={mediaById} onOpenMedia={setLightbox} onCopy={copyText}>
                      {skill.agentInstructions}
                    </SkillMarkdown>
                  </aside>
                ) : null}

                {skill.steps.map((step, index) => {
                  const sections = toPromptSections(step.promptText, step.promptSections);
                  return (
                    <section
                      key={step.promptId}
                      id={`skill-step-${index}`}
                      className="skill-doc-step"
                    >
                      <div className="skill-doc-step-head">
                        <span className="skill-doc-step-num">{pad(index + 1)}</span>
                        <div className="min-w-0">
                          <h2 className="skill-doc-step-title">{stepTitle(step, index)}</h2>
                          {step.modelName ? (
                            <span className="skill-doc-step-model">{step.modelName}</span>
                          ) : null}
                        </div>
                      </div>

                      <StepFigures step={step} onOpen={setLightbox} />

                      {sections ? (
                        <div className="skill-doc-prompt">
                          {/* The sections label themselves; "Copy all" only
                              earns a row when there is more than the prompt. */}
                          {sections.negativePrompt || sections.generationNotes ? (
                          <div className="skill-doc-prompt-head">
                            <span />
                            <button
                              type="button"
                              className="skill-doc-prompt-copy"
                              onClick={() =>
                                void copyText(promptSectionsToText(sections), "PROMPT COPIED")
                              }
                            >
                              <Copy className="h-3 w-3" /> Copy all
                            </button>
                          </div>
                          ) : null}
                          <PromptSections sections={sections} onCopy={copyText} size="doc" />
                        </div>
                      ) : null}
                    </section>
                  );
                })}

                <footer className="skill-doc-end">
                  <span aria-hidden className="skill-doc-end-rule" />
                  <span>
                    End of {sectionCopy.noun} · {pad(skill.stepCount)}{" "}
                    {unitsFor(skill.stepCount)}
                  </span>
                </footer>
              </article>
            </div>
          </>
        )}
      </div>

      {lightbox ? (
        <div
          className="skill-lightbox"
          onClick={(event) => {
            event.stopPropagation();
            setLightbox(null);
          }}
          role="dialog"
          aria-label="Media"
        >
          {lightbox.kind === "video" ? (
            <video
              src={lightbox.url}
              poster={lightbox.thumbUrl}
              controls
              autoPlay
              playsInline
              onClick={(event) => event.stopPropagation()}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={lightbox.url ?? lightbox.thumbUrl} alt={lightbox.description ?? ""} />
          )}
          {lightbox.description ? <p>{lightbox.description}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
