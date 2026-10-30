"use client";

import { useMemo, type ReactNode } from "react";
import { ExternalLink, FileText, Play } from "lucide-react";
import {
  placeFrames,
  splitRefs,
  type ReaderGap,
  type ReaderItem,
  type ReaderModel,
  type ReaderSection,
} from "@/lib/storybook-reader";

/** What the reader needs to know about a piece to draw it. */
export type ReaderAsset = {
  id: string;
  thumbSrc: string | null;
  fullSrc: string | null;
  kind?: "image" | "video";
  width?: number;
  height?: number;
  /** The agent's description, the owner's description and the file name. */
  notes?: string | null;
  tagNames?: string[];
  /** The caption under a frame: the agent's sentence, else the prompt. */
  caption?: string | null;
};

type ReaderProps = {
  model: ReaderModel;
  /** The frames filed on the storybook shelf, in shelf order. */
  frames: ReaderAsset[];
  /** Pieces the record cites that are not on the shelf, by id. */
  lookup: Map<string, ReaderAsset>;
  onOpenAsset: (assetId: string) => void;
};

const READY = "#79B791";
const RADIUS = "10px";
const EYEBROW = "text-[9px] font-mono font-bold uppercase tracking-[0.18em]";

const shortId = (id: string) => `${id.slice(0, 6)}…${id.slice(-4)}`;

/* ── Chips ──────────────────────────────────────────────────────────────── */

function Chip({
  children,
  tone = "neutral",
  as = "span",
  href,
  onClick,
  title,
}: {
  children: ReactNode;
  tone?: "neutral" | "coral" | "ready" | "ghost";
  as?: "span" | "a" | "button";
  href?: string;
  onClick?: () => void;
  title?: string;
}) {
  const color =
    tone === "coral" ? "var(--coral)" : tone === "ready" ? READY : tone === "ghost" ? "var(--lm-text-tertiary)" : "var(--lm-text-secondary)";
  const style = {
    color,
    borderRadius: "999px",
    border: `1px solid ${tone === "coral" ? "color-mix(in srgb, var(--coral) 45%, transparent)" : tone === "ready" ? "color-mix(in srgb, #79B791 45%, transparent)" : "var(--lm-border)"}`,
    backgroundColor: tone === "coral" ? "color-mix(in srgb, var(--coral) 10%, transparent)" : "var(--lm-surface-1)",
  } as const;
  const className = `inline-flex max-w-full items-center gap-1.5 px-2.5 py-1 text-[10px] font-mono font-bold uppercase tracking-[0.12em] leading-none ${
    as !== "span" ? "transition-colors hover:border-[var(--lm-border-strong)] hover:text-[var(--lm-text-primary)]" : ""
  }`;
  if (as === "a") {
    return (
      <a href={href} target={href?.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className={className} style={style} title={title}>
        {children}
      </a>
    );
  }
  if (as === "button") {
    return (
      <button type="button" onClick={onClick} className={className} style={style} title={title}>
        {children}
      </button>
    );
  }
  return (
    <span className={className} style={style} title={title}>
      {children}
    </span>
  );
}

/** A piece cited in text: thumbnail when known, its short id always. */
function AssetChip({ id, lookup, onOpenAsset, label }: { id: string; lookup: Map<string, ReaderAsset>; onOpenAsset: (id: string) => void; label?: string | null }) {
  const asset = lookup.get(id);
  return (
    <button
      type="button"
      onClick={() => onOpenAsset(id)}
      title={`asset:${id}`}
      className="inline-flex max-w-full items-center gap-1.5 align-middle text-[10px] font-mono font-bold uppercase tracking-[0.1em] leading-none transition-colors hover:text-[var(--lm-text-primary)]"
      style={{
        color: "var(--coral)",
        borderRadius: "999px",
        border: "1px solid color-mix(in srgb, var(--coral) 40%, transparent)",
        padding: asset?.thumbSrc ? "2px 9px 2px 2px" : "4px 9px",
        backgroundColor: "color-mix(in srgb, var(--coral) 8%, transparent)",
      }}
    >
      {asset?.thumbSrc && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={asset.thumbSrc} alt="" className="h-5 w-5 shrink-0 rounded-full object-cover" loading="lazy" />
      )}
      <span className="truncate">{label ?? shortId(id)}</span>
    </button>
  );
}

/** Text with its asset, story and link references drawn as chips. */
function RefText({ text, lookup, onOpenAsset }: { text: string; lookup: Map<string, ReaderAsset>; onOpenAsset: (id: string) => void }) {
  const parts = useMemo(() => splitRefs(text), [text]);
  return (
    <>
      {parts.map((part, index) => {
        if (part.kind === "text") return <span key={index}>{part.text}</span>;
        if (part.kind === "asset") return <AssetChip key={index} id={part.id} lookup={lookup} onOpenAsset={onOpenAsset} />;
        if (part.kind === "story") {
          return (
            <a key={index} href={`/stories/${part.id}`} className="inline-flex items-center gap-1 align-middle text-[10px] font-mono font-bold uppercase tracking-[0.1em] hover:text-[var(--lm-text-primary)]" style={{ color: "var(--lm-text-secondary)", borderBottom: "1px solid var(--lm-border-strong)" }} title={`story:${part.id}`}>
              <FileText className="h-3 w-3" /> story {shortId(part.id)}
            </a>
          );
        }
        return (
          <a key={index} href={part.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 align-middle text-[11px] font-mono hover:text-[var(--lm-text-primary)]" style={{ color: "var(--lm-text-secondary)", borderBottom: "1px solid var(--lm-border-strong)" }} title={part.url}>
            {part.label} <ExternalLink className="h-2.5 w-2.5" />
          </a>
        );
      })}
    </>
  );
}

/* ── Blocks ─────────────────────────────────────────────────────────────── */

function BlockTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h3 className="text-[11px] font-black uppercase tracking-[0.2em]" style={{ color: "var(--lm-text-primary)" }}>
        {children}
      </h3>
      {aside && <span className={EYEBROW} style={{ color: "var(--lm-text-tertiary)" }}>{aside}</span>}
    </div>
  );
}

function Frame({ asset, onOpenAsset, caption, large = false, eager = false }: { asset: ReaderAsset; onOpenAsset: (id: string) => void; caption?: boolean; large?: boolean; eager?: boolean }) {
  if (!asset.thumbSrc) return null;
  return (
    <figure className="min-w-0">
      <button
        type="button"
        onClick={() => onOpenAsset(asset.id)}
        className="group/frame relative block w-full overflow-hidden text-left transition-opacity hover:opacity-95"
        style={{ borderRadius: RADIUS, border: "1px solid var(--lm-border)", backgroundColor: "var(--lm-surface-2)" }}
        aria-label={asset.caption ?? "Storybook frame"}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset.thumbSrc}
          alt={asset.caption ?? ""}
          className="block w-full"
          loading={eager ? "eager" : "lazy"}
          style={{
            aspectRatio: asset.width && asset.height ? `${asset.width} / ${asset.height}` : large ? "16 / 9" : "4 / 3",
            objectFit: "cover",
            maxHeight: large ? "60vh" : undefined,
          }}
        />
        {asset.kind === "video" && (
          <span className="absolute left-2 top-2 flex h-6 w-6 items-center justify-center" style={{ borderRadius: "8px", backgroundColor: "rgba(0,0,0,0.65)", color: "#FFF4EA" }}>
            <Play className="h-3 w-3" />
          </span>
        )}
        <span className="absolute bottom-2 right-2 px-1.5 py-0.5 text-[9px] font-mono opacity-0 transition-opacity group-hover/frame:opacity-100" style={{ borderRadius: "6px", backgroundColor: "rgba(0,0,0,0.6)", color: "#FFF4EA" }}>
          {shortId(asset.id)}
        </span>
      </button>
      {caption && asset.caption && (
        <figcaption className="mt-1.5 line-clamp-2 text-[11px] leading-snug" style={{ color: "var(--lm-text-tertiary)" }}>
          {asset.caption}
        </figcaption>
      )}
    </figure>
  );
}

function FrameGrid({ frames, onOpenAsset, columns = "grid-cols-2 md:grid-cols-3 min-[900px]:grid-cols-4" }: { frames: ReaderAsset[]; onOpenAsset: (id: string) => void; columns?: string }) {
  return (
    <div className={`grid gap-3 ${columns}`}>
      {frames.map((frame, index) => (
        <Frame key={frame.id} asset={frame} onOpenAsset={onOpenAsset} caption eager={index < 8} />
      ))}
    </div>
  );
}

function GapList({ gaps, notes, blocking, lookup, onOpenAsset }: { gaps: ReaderGap[]; notes: string[]; blocking: number | null; lookup: Map<string, ReaderAsset>; onOpenAsset: (id: string) => void }) {
  return (
    <section className="p-4 md:p-5" style={{ borderRadius: RADIUS, border: "1px solid color-mix(in srgb, var(--coral) 35%, transparent)", backgroundColor: "color-mix(in srgb, var(--coral) 5%, transparent)" }}>
      <BlockTitle aside={blocking !== null && blocking !== gaps.length ? `${blocking} blocking` : undefined}>
        <span style={{ color: "var(--coral)" }}>{gaps.length === 1 ? "1 gap" : `${gaps.length} gaps`}</span>
      </BlockTitle>
      <ol className="flex flex-col gap-3">
        {gaps.map((gap, index) => (
          <li key={index} className="flex gap-3">
            <span aria-hidden className="mt-[3px] h-3.5 w-3.5 shrink-0" style={{ borderRadius: "3px", border: "1.5px solid color-mix(in srgb, var(--coral) 70%, transparent)" }} />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] leading-[1.5]" style={{ color: "var(--lm-text-primary)" }}>
                {gap.kind && (
                  <span className="mr-2 inline-block align-middle text-[9px] font-mono font-bold uppercase tracking-[0.14em]" style={{ color: "var(--coral)" }}>
                    {gap.kind}
                  </span>
                )}
                <RefText text={gap.summary} lookup={lookup} onOpenAsset={onOpenAsset} />
              </p>
              {gap.detail && (
                <p className="mt-1 text-[12px] leading-[1.55]" style={{ color: "var(--lm-text-tertiary)" }}>
                  <RefText text={gap.detail} lookup={lookup} onOpenAsset={onOpenAsset} />
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
      {notes.length > 0 && (
        <div className="mt-4 flex flex-col gap-1.5 border-t pt-3" style={{ borderColor: "var(--lm-border)" }}>
          {notes.map((note, index) => (
            <p key={index} className="text-[12px] leading-[1.55]" style={{ color: "var(--lm-text-tertiary)" }}>
              <RefText text={note} lookup={lookup} onOpenAsset={onOpenAsset} />
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

/** A cast member, a location or a prop: its pieces, its name, its text. */
function ItemRow({ item, lookup, onOpenAsset, plates }: { item: ReaderItem; lookup: Map<string, ReaderAsset>; onOpenAsset: (id: string) => void; plates?: ReaderAsset[] }) {
  const pieces = item.assetIds.map((id) => lookup.get(id)).filter((asset): asset is ReaderAsset => Boolean(asset?.thumbSrc));
  const lead = pieces[0];
  return (
    <li className="flex gap-3 md:gap-4">
      {lead ? (
        <button type="button" onClick={() => onOpenAsset(lead.id)} className="shrink-0 overflow-hidden transition-opacity hover:opacity-90" style={{ borderRadius: "8px", border: "1px solid var(--lm-border)", width: 64, height: 80, backgroundColor: "var(--lm-surface-2)" }} aria-label={item.label ?? "Open piece"}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lead.thumbSrc ?? ""} alt="" className="h-full w-full object-cover" loading="lazy" />
        </button>
      ) : (
        <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: item.label ? "var(--coral)" : "var(--lm-text-ghost)" }} />
      )}
      <div className="min-w-0 flex-1">
        {(item.label || item.codes.length > 0) && (
          <div className="mb-1 flex flex-wrap items-center gap-2">
            {item.label && (
              <span className="text-[13px] font-black uppercase tracking-[0.06em]" style={{ color: "var(--lm-text-primary)" }}>
                {item.label}
              </span>
            )}
            {item.codes.map((code) => (
              <Chip key={code} tone="ghost">{code}</Chip>
            ))}
            {item.assetIds.length > 0 && !lead && item.assetIds.map((id) => <AssetChip key={id} id={id} lookup={lookup} onOpenAsset={onOpenAsset} />)}
          </div>
        )}
        <p className="text-[14px] leading-[1.6]" style={{ color: item.label ? "var(--lm-text-secondary)" : "var(--lm-text-tertiary)" }}>
          <RefText text={item.text} lookup={lookup} onOpenAsset={onOpenAsset} />
        </p>
        {(pieces.length > 1 || (plates && plates.length > 0)) && (
          <div className="mt-2 flex flex-wrap gap-2">
            {[...pieces.slice(1), ...(plates ?? [])].map((asset) => (
              <button key={asset.id} type="button" onClick={() => onOpenAsset(asset.id)} className="overflow-hidden transition-opacity hover:opacity-90" style={{ borderRadius: "6px", border: "1px solid var(--lm-border)", width: 96, height: 60, backgroundColor: "var(--lm-surface-2)" }} aria-label={asset.caption ?? "Open piece"}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={asset.thumbSrc ?? ""} alt="" className="h-full w-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

function ItemBlock({ title, items, lookup, onOpenAsset, plates }: { title: string; items: ReaderItem[]; lookup: Map<string, ReaderAsset>; onOpenAsset: (id: string) => void; plates?: ReaderAsset[] }) {
  if (items.length === 0 && (!plates || plates.length === 0)) return null;
  return (
    <section>
      <BlockTitle aside={items.length > 1 ? `${items.length}` : undefined}>{title}</BlockTitle>
      <ul className="flex flex-col gap-4">
        {items.map((item, index) => (
          <ItemRow key={index} item={item} lookup={lookup} onOpenAsset={onOpenAsset} plates={index === 0 ? plates : undefined} />
        ))}
      </ul>
      {items.length === 0 && plates && plates.length > 0 && <FrameGrid frames={plates} onOpenAsset={onOpenAsset} columns="grid-cols-2 md:grid-cols-3" />}
    </section>
  );
}

function SectionBlock({ section, lookup, onOpenAsset }: { section: ReaderSection; lookup: Map<string, ReaderAsset>; onOpenAsset: (id: string) => void }) {
  if (section.items.length === 0 && section.paragraphs.length === 0) return null;
  return (
    <section>
      <BlockTitle>{section.title}</BlockTitle>
      {section.items.length > 0 && (
        <ul className="flex flex-col gap-3">
          {section.items.map((item, index) => (
            <li key={index} className="text-[14px] leading-[1.6]" style={{ color: "var(--lm-text-secondary)" }}>
              {item.label && (
                <span className="mr-2 text-[10px] font-mono font-bold uppercase tracking-[0.14em]" style={{ color: "var(--lm-text-tertiary)" }}>
                  {item.label}
                </span>
              )}
              <RefText text={item.text} lookup={lookup} onOpenAsset={onOpenAsset} />
            </li>
          ))}
        </ul>
      )}
      {section.paragraphs.map((paragraph, index) => (
        <p key={index} className="mt-2 text-[14px] leading-[1.6]" style={{ color: "var(--lm-text-secondary)" }}>
          <RefText text={paragraph} lookup={lookup} onOpenAsset={onOpenAsset} />
        </p>
      ))}
    </section>
  );
}

/* ── The reader ─────────────────────────────────────────────────────────── */

/** The status row under the title: readiness, runtime, medium, look, world. */
export function ReaderChips({ model }: { model: ReaderModel }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {model.status === "ready" && <Chip tone="ready">Ready</Chip>}
      {model.status === "not-ready" && (
        <Chip tone="coral">Not ready{model.blockingGaps !== null ? ` · ${model.blockingGaps} blocking` : ""}</Chip>
      )}
      {model.status === "archived" && <Chip tone="ghost">Archived</Chip>}
      {model.status === "unreviewed" && <Chip tone="ghost">Unreviewed</Chip>}
      {model.duration && <Chip>{model.duration}</Chip>}
      {model.medium && <Chip>{model.medium === "animated" ? "Animated" : "Live action"}</Chip>}
      {model.draftKind && <Chip tone="ghost">{model.draftKind}</Chip>}
      {model.look.map((look) => (
        <Chip key={look}>{look}</Chip>
      ))}
    </div>
  );
}

export function StorybookReader({ model, frames, lookup, onOpenAsset }: ReaderProps) {
  const placement = useMemo(() => placeFrames(model, frames), [model, frames]);
  const hasBeats = model.beats.length > 0;
  const beatSeconds = model.beats.filter((beat) => beat.time).length;

  return (
    <div className="flex flex-col gap-10">
      {(model.logline || model.hook) && (
        <section className="flex flex-col gap-2">
          {model.logline && (
            <p className="text-[17px] font-medium leading-[1.5] md:text-[19px]" style={{ color: "var(--lm-text-primary)" }}>
              {model.logline}
            </p>
          )}
          {model.hook && model.hook !== model.logline && (
            <p className="text-[14px] leading-[1.6]" style={{ color: "var(--lm-text-secondary)" }}>
              <span className="mr-2 text-[9px] font-mono font-bold uppercase tracking-[0.18em]" style={{ color: "var(--lm-text-tertiary)" }}>Hook</span>
              {model.hook}
            </p>
          )}
        </section>
      )}

      {model.gaps.length > 0 && <GapList gaps={model.gaps} notes={model.gapNotes} blocking={model.blockingGaps} lookup={lookup} onOpenAsset={onOpenAsset} />}

      {model.prose.length > 0 && (
        <section className="flex flex-col gap-3">
          {model.prose.map((paragraph, index) => (
            <p key={index} className="text-[15px] leading-[1.7]" style={{ color: "var(--lm-text-secondary)" }}>
              <RefText text={paragraph} lookup={lookup} onOpenAsset={onOpenAsset} />
            </p>
          ))}
        </section>
      )}

      {/* A book with no beats is prose and frames: its notes read before the grid. */}
      {!hasBeats && model.sections.map((section, index) => (
        <SectionBlock key={`${section.title}-${index}`} section={section} lookup={lookup} onOpenAsset={onOpenAsset} />
      ))}

      {hasBeats && (
        <section>
          <BlockTitle aside={`${model.beats.length} beats${beatSeconds > 0 && model.duration ? ` · ${model.duration}` : ""}`}>Story</BlockTitle>
          <ol className="flex flex-col gap-3">
            {model.beats.map((beat) => {
              const beatFrames = placement.byBeat.get(beat.number) ?? [];
              const [lead, ...rest] = beatFrames;
              return (
                <li
                  key={beat.number}
                  className={`grid gap-4 p-4 md:p-5 ${lead ? "min-[900px]:grid-cols-[minmax(0,1fr)_minmax(260px,38%)]" : ""}`}
                  style={{ borderRadius: RADIUS, border: "1px solid var(--lm-border)", backgroundColor: "var(--lm-surface-1)" }}
                >
                  <div className="flex min-w-0 gap-3 md:gap-4">
                    <span className="w-7 shrink-0 text-[22px] font-black leading-none tabular-nums md:text-[26px]" style={{ color: "var(--coral)" }}>
                      {beat.number}
                    </span>
                    <div className="min-w-0 flex-1">
                      {beat.time && (
                        <span className={`${EYEBROW} mb-1.5 block`} style={{ color: "var(--lm-text-tertiary)" }}>
                          {beat.time}
                        </span>
                      )}
                      <p className="text-[15px] leading-[1.65]" style={{ color: "var(--lm-text-primary)" }}>
                        <RefText text={beat.text} lookup={lookup} onOpenAsset={onOpenAsset} />
                      </p>
                      {(beat.missing || beat.assetIds.length > 0) && (
                        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                          {beat.assetIds.map((id) => (
                            <AssetChip key={id} id={id} lookup={lookup} onOpenAsset={onOpenAsset} />
                          ))}
                          {beat.missing && (
                            <span className="text-[11px] leading-snug" style={{ color: "var(--coral)" }}>
                              {beat.missing}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  {lead && (
                    <div className="flex flex-col gap-2 min-[900px]:pl-1">
                      <Frame asset={lead} onOpenAsset={onOpenAsset} eager />
                      {rest.length > 0 && (
                        <div className="grid grid-cols-4 gap-1.5">
                          {rest.slice(0, 4).map((frame) => (
                            <Frame key={frame.id} asset={frame} onOpenAsset={onOpenAsset} />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {placement.strip.length > 0 && (
        <section>
          <BlockTitle aside={`${placement.strip.length}`}>{hasBeats ? "More frames on the shelf" : "Frames"}</BlockTitle>
          <FrameGrid frames={placement.strip} onOpenAsset={onOpenAsset} />
        </section>
      )}

      <ItemBlock title="Cast" items={model.cast} lookup={lookup} onOpenAsset={onOpenAsset} />
      <ItemBlock title="Locations" items={model.locations} lookup={lookup} onOpenAsset={onOpenAsset} plates={placement.plates} />
      <ItemBlock title="Props" items={model.props} lookup={lookup} onOpenAsset={onOpenAsset} />

      {hasBeats && model.sections.map((section, index) => (
        <SectionBlock key={`${section.title}-${index}`} section={section} lookup={lookup} onOpenAsset={onOpenAsset} />
      ))}

      {(model.sources.length > 0 || model.storyRefs.length > 0) && (
        <section>
          <BlockTitle aside={`${model.sources.length + model.storyRefs.length}`}>Sources</BlockTitle>
          <div className="flex flex-wrap gap-1.5">
            {model.storyRefs.map((id) => (
              <Chip key={id} as="a" href={`/stories/${id}`} title={`story:${id}`}>
                <FileText className="h-3 w-3" /> story {shortId(id)}
              </Chip>
            ))}
            {model.sources.map((source) => (
              <Chip key={source.url} as="a" href={source.url} title={source.url}>
                <span className="normal-case tracking-normal">{source.label}</span> <ExternalLink className="h-2.5 w-2.5" />
              </Chip>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
