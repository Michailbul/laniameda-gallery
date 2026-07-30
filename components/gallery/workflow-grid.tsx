"use client";

import { memo, useRef, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Trash2, Workflow } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SkeletonGrid } from "@/components/ui/coral-skeleton";
import { useCoralToastSafe } from "@/components/ui/coral-toast";

/* ── Types ── */

type WorkflowMedia = {
  id: string;
  kind: string;
  url?: string;
  thumbUrl?: string;
  contentType?: string;
  width?: number;
  height?: number;
};

type WorkflowCard = {
  _id: Id<"workflows">;
  title: string;
  description?: string;
  pillar?: string;
  tagNames: string[];
  stepCount: number;
  isPublic?: boolean;
  isFeatured?: boolean;
  createdAt: number;
  updatedAt: number;
  previewImages: WorkflowMedia[];
};

type WorkflowGridProps = {
  ownerUserId: string;
  scope?: "mine" | "public";
  onWorkflowSelect: (workflowId: string) => void;
};

const PILLAR_COLORS: Record<string, string> = {
  creators: "var(--lm-pillar-creators)",
  designs: "var(--lm-pillar-designs)",
  dump: "var(--lm-pillar-dump)",
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

/* ── Workflow Card ── */

const WorkflowCardTile = memo(function WorkflowCardTile({
  workflow,
  onClick,
  onDelete,
  index,
}: {
  workflow: WorkflowCard;
  onClick: () => void;
  onDelete: () => void;
  index: number;
}) {
  const [hovered, setHovered] = useState(false);
  const [activeSlide, setActiveSlide] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const accentColor =
    PILLAR_COLORS[workflow.pillar ?? "creators"] ?? "var(--lm-coral)";

  // A step's video contributes its poster frame, so a reel still gets a tile
  // instead of a dead <Image> pointed at an .mp4.
  const slides = workflow.previewImages
    .map((media) => media.thumbUrl ?? media.url)
    .filter((src): src is string => Boolean(src))
    .filter((src, i, all) => all.indexOf(src) === i)
    .slice(0, 10);
  const hasCarousel = slides.length > 1;

  const cover = workflow.previewImages.find((media) =>
    Boolean(media.thumbUrl ?? media.url),
  );
  const rawRatio =
    cover?.width && cover?.height ? cover.width / cover.height : 4 / 5;
  const heroRatio = clamp(rawRatio, 0.62, 1.78);

  const scrollToSlide = (nextIdx: number) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const clamped = Math.max(0, Math.min(slides.length - 1, nextIdx));
    scroller.scrollTo({
      left: clamped * scroller.clientWidth,
      behavior: "smooth",
    });
    setActiveSlide(clamped);
  };

  const handleScroll = () => {
    const scroller = scrollerRef.current;
    if (!scroller || scroller.clientWidth === 0) return;
    const idx = Math.round(scroller.scrollLeft / scroller.clientWidth);
    if (idx !== activeSlide) setActiveSlide(idx);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setConfirmDelete(false);
      }}
      className="group relative w-full cursor-pointer text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--lm-coral)]"
      style={{
        borderRadius: "16px",
        overflow: "hidden",
        border: "2px solid var(--lm-border)",
        background: "var(--lm-surface-1)",
        boxShadow: hovered
          ? `0 12px 40px rgba(0,0,0,0.12), 0 0 0 1px ${accentColor}44`
          : "0 2px 8px rgba(0,0,0,0.04)",
        transition:
          "box-shadow 250ms ease, transform 250ms ease, border-color 250ms ease",
        transform: hovered ? "translateY(-2px)" : "translateY(0)",
        borderColor: hovered ? accentColor : "var(--lm-border)",
        animationDelay: `${index * 60}ms`,
        animation: "pack-card-enter 400ms cubic-bezier(0.16, 1, 0.3, 1) backwards",
      }}
      aria-label={`Workflow: ${workflow.title}, ${workflow.stepCount} steps`}
    >
      <div
        className="relative overflow-hidden"
        style={{
          aspectRatio: slides.length > 0 ? `${heroRatio}` : "4 / 3",
          backgroundColor: "var(--lm-surface-3)",
        }}
      >
        {slides.length > 0 ? (
          <div
            ref={scrollerRef}
            onScroll={handleScroll}
            className="pack-card-scroller flex h-full w-full overflow-x-auto overflow-y-hidden"
            style={{ scrollbarWidth: "none", scrollSnapType: "x proximity" }}
          >
            {slides.map((url, i) => (
              <div
                key={`${url}-${i}`}
                className="relative h-full w-full shrink-0 snap-center"
              >
                <Image
                  src={url}
                  alt={
                    i === 0
                      ? workflow.title
                      : `${workflow.title} — step ${i + 1}`
                  }
                  fill
                  sizes="(min-width: 1280px) 33vw, (min-width: 768px) 50vw, 100vw"
                  className="object-cover"
                  style={{
                    transition: "transform 600ms ease",
                    transform:
                      hovered && activeSlide === i ? "scale(1.03)" : "scale(1)",
                  }}
                  unoptimized
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <Workflow
              className="h-8 w-8"
              style={{ color: "var(--lm-text-ghost)", opacity: 0.4 }}
            />
          </div>
        )}

        <div
          className="absolute inset-x-0 bottom-0"
          style={{
            height: "60%",
            background:
              "linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.3) 50%, transparent 100%)",
            pointerEvents: "none",
          }}
        />

        {/* Delete — two-step, since unlinking a whole recipe is not undoable.
            The first click arms it, the second commits. */}
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (confirmDelete) {
              onDelete();
              return;
            }
            setConfirmDelete(true);
          }}
          className="absolute left-2.5 top-2.5 z-20 flex items-center justify-center transition-all"
          style={{
            height: "30px",
            width: confirmDelete ? "auto" : "30px",
            padding: confirmDelete ? "0 9px" : 0,
            gap: "5px",
            borderRadius: "8px",
            background: confirmDelete
              ? "var(--lm-coral)"
              : "rgba(0,0,0,0.65)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            border: "1px solid rgba(255,255,255,0.15)",
            color: "#fff",
            fontFamily: "var(--lm-font)",
            fontSize: "9px",
            fontWeight: 800,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            opacity: hovered || confirmDelete ? 1 : 0,
            transform: `scale(${hovered || confirmDelete ? 1 : 0.9})`,
            pointerEvents: hovered || confirmDelete ? "auto" : "none",
          }}
          aria-label={confirmDelete ? "Confirm delete workflow" : "Delete workflow"}
          title={
            confirmDelete
              ? "Click again to delete this workflow"
              : "Delete workflow"
          }
        >
          <Trash2 className="h-3.5 w-3.5" />
          {confirmDelete && <span>Sure?</span>}
        </button>

        {/* Step count — the one number that matters on a workflow card */}
        <div className="absolute inset-x-2.5 top-2.5 flex items-center justify-end gap-2 pointer-events-none">
          <div
            className="flex items-center gap-1 px-2 py-0.5"
            style={{
              background: "rgba(0,0,0,0.65)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
              borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.12)",
              fontSize: "10px",
              fontWeight: 800,
              fontFamily: "var(--lm-font)",
              letterSpacing: "0.08em",
              color: "rgba(255,255,255,0.9)",
            }}
          >
            <Workflow className="h-2.5 w-2.5" />
            {hasCarousel && hovered
              ? `${activeSlide + 1} / ${slides.length}`
              : `${workflow.stepCount} ${workflow.stepCount === 1 ? "STEP" : "STEPS"}`}
          </div>
        </div>

        {hasCarousel && (
          <>
            <CarouselArrow
              side="left"
              visible={hovered && activeSlide > 0}
              onClick={(e) => {
                e.stopPropagation();
                scrollToSlide(activeSlide - 1);
              }}
            />
            <CarouselArrow
              side="right"
              visible={hovered && activeSlide < slides.length - 1}
              onClick={(e) => {
                e.stopPropagation();
                scrollToSlide(activeSlide + 1);
              }}
            />
            <div
              className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1"
              style={{
                bottom: "10px",
                opacity: hovered ? 1 : 0,
                transition: "opacity 200ms ease",
                pointerEvents: "none",
              }}
            >
              {slides.map((_, i) => (
                <span
                  key={i}
                  style={{
                    width: i === activeSlide ? "14px" : "5px",
                    height: "5px",
                    borderRadius: "3px",
                    backgroundColor:
                      i === activeSlide ? "#fff" : "rgba(255,255,255,0.45)",
                    transition:
                      "width 200ms ease, background-color 200ms ease",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.35)",
                  }}
                />
              ))}
            </div>
          </>
        )}

        <div
          className="absolute inset-x-0 bottom-0 px-3.5 pb-3"
          style={{
            pointerEvents: "none",
            opacity: hovered && hasCarousel ? 0 : 1,
            transition: "opacity 180ms ease",
          }}
        >
          <h3
            style={{
              fontFamily: "var(--lm-font)",
              fontSize: "12px",
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: "0.10em",
              color: "#fff",
              lineHeight: 1.3,
              textShadow: "0 1px 4px rgba(0,0,0,0.5)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
          >
            {workflow.title}
          </h3>
        </div>
      </div>

      <div
        className="flex items-center justify-between px-3.5 py-2.5"
        style={{ borderTop: `1px solid var(--lm-border)` }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="shrink-0"
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              backgroundColor: accentColor,
            }}
          />
          {workflow.tagNames.length > 0 && (
            <span
              style={{
                fontFamily: "var(--lm-font)",
                fontSize: "9px",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.10em",
                color: "var(--lm-text-tertiary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {workflow.tagNames.slice(0, 2).join(" · ")}
            </span>
          )}
        </div>
        <span
          style={{
            fontFamily: "var(--lm-font)",
            fontSize: "9px",
            fontWeight: 600,
            letterSpacing: "0.08em",
            color: "var(--lm-text-ghost)",
          }}
        >
          {new Date(workflow.createdAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
        </span>
      </div>
    </div>
  );
});

function CarouselArrow({
  side,
  visible,
  onClick,
}: {
  side: "left" | "right";
  visible: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === "left" ? "Previous step" : "Next step"}
      className="absolute top-1/2 -translate-y-1/2 flex items-center justify-center"
      style={{
        [side]: "8px",
        width: "32px",
        height: "32px",
        borderRadius: "50%",
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        border: "1px solid rgba(255,255,255,0.18)",
        color: "#fff",
        cursor: "pointer",
        opacity: visible ? 1 : 0,
        transform: `translateY(-50%) scale(${visible ? 1 : 0.85})`,
        transition: "opacity 180ms ease, transform 180ms ease",
        pointerEvents: visible ? "auto" : "none",
        boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
      }}
    >
      {side === "left" ? (
        <ChevronLeft className="h-4 w-4" />
      ) : (
        <ChevronRight className="h-4 w-4" />
      )}
    </button>
  );
}

/* ── Main Export ── */

export function WorkflowGrid({
  ownerUserId,
  scope = "mine",
  onWorkflowSelect,
}: WorkflowGridProps) {
  const workflows = useQuery(api.workflows.listWorkflows, {
    ownerUserId,
    scope,
    limit: 60,
    previewLimit: 8,
  });
  const deleteWorkflow = useMutation(api.workflows.deleteWorkflow);
  const coralCtx = useCoralToastSafe();
  const toastFn = coralCtx?.toast;
  // Optimistic removal so the card leaves immediately; the query refetch that
  // follows makes it permanent.
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());

  const handleDelete = async (workflowId: Id<"workflows">, title: string) => {
    setRemovedIds((previous) => new Set(previous).add(workflowId));
    try {
      await deleteWorkflow({ ownerUserId, id: workflowId });
      toastFn?.("Deleted", `${title.toUpperCase()} REMOVED`, "success");
    } catch (error) {
      setRemovedIds((previous) => {
        const next = new Set(previous);
        next.delete(workflowId);
        return next;
      });
      toastFn?.(
        "Failed",
        error instanceof Error
          ? error.message.toUpperCase()
          : "COULD NOT DELETE WORKFLOW",
        "warning",
      );
    }
  };

  if (workflows === undefined) {
    return (
      <div style={{ padding: "12px" }}>
        <SkeletonGrid columnClasses="columns-2 sm:columns-2 md:columns-3 lg:columns-4" />
      </div>
    );
  }

  const visible = workflows.filter(
    (workflow) => !removedIds.has(workflow._id),
  );

  if (visible.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] px-8 py-12 text-center lm-animate-fade-in">
        <div
          className="relative mb-6 h-16 w-16 flex items-center justify-center"
          style={{
            border: "3px solid var(--lm-ink)",
            backgroundColor: "var(--lm-accent-dim)",
            borderRadius: "16px",
            boxShadow: "0 0 20px rgba(255, 122, 100, 0.15)",
          }}
        >
          <Workflow className="h-6 w-6" style={{ color: "var(--lm-coral)" }} />
        </div>
        <h2
          style={{
            fontFamily: "var(--lm-font)",
            fontSize: "16px",
            fontWeight: 900,
            textTransform: "uppercase",
            letterSpacing: "0.18em",
            color: "var(--lm-text-primary)",
          }}
        >
          NO WORKFLOWS YET
        </h2>
        <p
          className="mt-2"
          style={{
            fontFamily: "var(--lm-font)",
            fontSize: "11px",
            textTransform: "uppercase",
            letterSpacing: "0.10em",
            color: "var(--lm-text-tertiary)",
            maxWidth: "360px",
            fontWeight: 500,
          }}
        >
          SAVE A MULTI-STEP RECIPE AND IT LANDS HERE — PROMPTS AND MEDIA
          TOGETHER, OUT OF THE MAIN GRID.
        </p>
      </div>
    );
  }

  return (
    <div
      className="p-3 w-full"
      style={{
        columnWidth: "270px",
        columnGap: "14px",
      }}
    >
      {visible.map((workflow, index) => (
        <div
          key={workflow._id}
          style={{
            breakInside: "avoid",
            marginBottom: "14px",
            display: "block",
          }}
        >
          <WorkflowCardTile
            workflow={workflow}
            onClick={() => onWorkflowSelect(workflow._id)}
            onDelete={() => {
              void handleDelete(workflow._id, workflow.title);
            }}
            index={index}
          />
        </div>
      ))}
    </div>
  );
}
