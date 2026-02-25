"use client";

import Image from "next/image";
import { useEffect, useState, useCallback, useRef } from "react";
import {
  X,
  Copy,
  Download,
  Check,
  ArrowRight,
  Paintbrush,
  Move,
  UserRound,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { TagPill } from "./tag-pill";

type ModalIntent = "transfer_style" | "transfer_pose" | "replace_character";

interface CarouselImage {
  thumbSrc: string;
  fullSrc: string;
  width?: number;
  height?: number;
}

interface DetailPanelProps {
  open: boolean;
  onClose: () => void;
  image: {
    id: string;
    thumbSrc: string;
    fullSrc: string;
    prompt: string;
    width?: number;
    height?: number;
    tagNames?: string[];
    modelName?: string;
    images?: CarouselImage[];
  } | null;
  onAction: (intent: ModalIntent, imageId: string) => void;
  selectedTags?: string[];
  onTagToggle?: (tag: string) => void;
}

const ACTIONS: {
  intent: ModalIntent;
  label: string;
  icon: typeof Paintbrush;
}[] = [
  { intent: "transfer_style", label: "Transfer Style", icon: Paintbrush },
  { intent: "transfer_pose", label: "Transfer Pose", icon: Move },
  { intent: "replace_character", label: "Replace Character", icon: UserRound },
];

export function DetailPanel({
  open,
  onClose,
  image,
  onAction,
  selectedTags,
  onTagToggle,
}: DetailPanelProps) {
  const [copied, setCopied] = useState(false);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [imageHovered, setImageHovered] = useState(false);
  const [contentVisible, setContentVisible] = useState(false);
  const panelRef = useRef<HTMLElement>(null);

  // Build carousel image array (single image fallback)
  const carouselImages: CarouselImage[] = image?.images?.length
    ? image.images
    : image
      ? [{ thumbSrc: image.thumbSrc, fullSrc: image.fullSrc, width: image.width, height: image.height }]
      : [];

  const currentImage = carouselImages[carouselIndex] ?? carouselImages[0];
  const hasMultipleImages = carouselImages.length > 1;

  const handleCopy = useCallback(async () => {
    if (!image) return;
    await navigator.clipboard.writeText(image.prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [image]);

  const handleDownload = useCallback(() => {
    if (!currentImage) return;
    const link = document.createElement("a");
    link.href = currentImage.fullSrc;
    link.download = `${image?.id ?? "image"}.png`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [currentImage, image?.id]);

  const goToPrev = useCallback(() => {
    setCarouselIndex((i) => (i > 0 ? i - 1 : carouselImages.length - 1));
  }, [carouselImages.length]);

  const goToNext = useCallback(() => {
    setCarouselIndex((i) => (i < carouselImages.length - 1 ? i + 1 : 0));
  }, [carouselImages.length]);

  /* ── Keyboard handling ── */
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "c" && !e.metaKey && !e.ctrlKey && !e.altKey && image) {
        void handleCopy();
      }
      if (hasMultipleImages) {
        if (e.key === "ArrowLeft") goToPrev();
        if (e.key === "ArrowRight") goToNext();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, image, handleCopy, hasMultipleImages, goToPrev, goToNext]);

  /* ── Reset carousel + copied state when image changes ── */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCopied(false);
    setCarouselIndex(0);
  }, [image?.id]);

  /* ── Delayed content reveal (avoids squeezed content during width transition) ── */
  useEffect(() => {
    if (open && image) {
      const timer = setTimeout(() => {
        setContentVisible(true);
      }, 80);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setContentVisible(false);
  }, [open, image]);

  /* ── Mobile body scroll lock ── */
  useEffect(() => {
    if (!open) return;
    const isMobile = window.innerWidth < 768;
    if (isMobile) document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const showPanel = open && image;

  return (
    <>
      {/* ── Mobile backdrop (md and below only) ── */}
      {showPanel && (
        <div
          className="fixed inset-0 z-40 md:hidden"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.25)" }}
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* ── Panel container ── */}
      <aside
        ref={panelRef}
        role="dialog"
        aria-label="Asset detail"
        className={[
          // Mobile: full-screen overlay
          showPanel ? "fixed inset-0 z-50 md:relative md:inset-auto md:z-auto" : "hidden md:block",
          // Desktop: inline flex sibling
          "flex flex-col md:flex-row md:h-full",
        ].join(" ")}
        style={{
          // Desktop sizing with smooth transition
          width: showPanel ? undefined : 0,
          minWidth: showPanel ? undefined : 0,
          maxWidth: showPanel ? undefined : 0,
          backgroundColor: "var(--paper)",
          borderLeft: showPanel ? "1px solid var(--border-default)" : "none",
          overflow: "hidden",
          transition: `width var(--duration-normal) cubic-bezier(0.16, 1, 0.3, 1),
                       min-width var(--duration-normal) cubic-bezier(0.16, 1, 0.3, 1),
                       max-width var(--duration-normal) cubic-bezier(0.16, 1, 0.3, 1)`,
        }}
      >
        {showPanel && (
          <>
            {/* ══════════════════════════════════════════════════ */}
            {/* ── MOBILE LAYOUT (< md): vertical stack ── */}
            {/* ══════════════════════════════════════════════════ */}
            <div className="flex h-full flex-col md:hidden">
              {/* Mobile header */}
              <div
                className="flex shrink-0 items-center justify-between px-4 py-3"
                style={{ borderBottom: "1px solid var(--border-default)" }}
              >
                <span
                  className="text-[11px] font-medium uppercase tracking-wider"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  Detail
                </span>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-7 w-7 items-center justify-center rounded-md"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Mobile image */}
              <div
                className="relative shrink-0"
                style={{
                  height: "40vh",
                  backgroundColor: "var(--surface-2)",
                }}
              >
                {currentImage && (
                  <Image
                    src={currentImage.fullSrc}
                    alt={image.prompt}
                    fill
                    className="object-contain p-3"
                    sizes="100vw"
                    priority
                    unoptimized
                  />
                )}
                {hasMultipleImages && (
                  <CarouselDots
                    count={carouselImages.length}
                    active={carouselIndex}
                    onSelect={setCarouselIndex}
                  />
                )}
              </div>

              {/* Mobile metadata */}
              <div className="flex-1 overflow-y-auto">
                <MetadataPane
                  image={image}
                  copied={copied}
                  onCopy={handleCopy}
                  onDownload={handleDownload}
                  onAction={onAction}
                  selectedTags={selectedTags}
                  onTagToggle={onTagToggle}
                />
              </div>
            </div>

            {/* ══════════════════════════════════════════════════ */}
            {/* ── DESKTOP LAYOUT (>= md): horizontal split ── */}
            {/* ══════════════════════════════════════════════════ */}
            <div
              className="hidden md:flex h-full"
              style={{
                width: "clamp(480px, 50vw, 720px)",
                opacity: contentVisible ? 1 : 0,
                transition: `opacity var(--duration-fast) ease`,
              }}
            >
              {/* ── Left: Image pane (55%) ── */}
              <div
                className="relative flex items-center justify-center shrink-0"
                style={{
                  width: "55%",
                  backgroundColor: "var(--surface-2)",
                  borderRight: "1px solid var(--border-subtle)",
                }}
                onMouseEnter={() => setImageHovered(true)}
                onMouseLeave={() => setImageHovered(false)}
              >
                {currentImage && (
                  <Image
                    src={currentImage.fullSrc}
                    alt={image.prompt}
                    fill
                    className="object-contain"
                    style={{ padding: "16px" }}
                    sizes="(max-width: 768px) 100vw, 28vw"
                    priority
                    unoptimized
                  />
                )}

                {/* Carousel nav arrows */}
                {hasMultipleImages && (
                  <>
                    <button
                      type="button"
                      onClick={goToPrev}
                      className="absolute left-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full transition-opacity"
                      style={{
                        backgroundColor: "rgba(0, 0, 0, 0.4)",
                        color: "#FFFFFF",
                        opacity: imageHovered ? 1 : 0,
                        transitionDuration: "var(--duration-fast)",
                      }}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={goToNext}
                      className="absolute right-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full transition-opacity"
                      style={{
                        backgroundColor: "rgba(0, 0, 0, 0.4)",
                        color: "#FFFFFF",
                        opacity: imageHovered ? 1 : 0,
                        transitionDuration: "var(--duration-fast)",
                      }}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </>
                )}

                {/* Carousel dots */}
                {hasMultipleImages && (
                  <CarouselDots
                    count={carouselImages.length}
                    active={carouselIndex}
                    onSelect={setCarouselIndex}
                  />
                )}
              </div>

              {/* ── Right: Metadata pane (45%) ── */}
              <div className="flex flex-1 flex-col min-w-0">
                {/* Header with close button */}
                <div
                  className="flex shrink-0 items-center justify-end px-4 py-3"
                  style={{ borderBottom: "1px solid var(--border-subtle)" }}
                >
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex h-7 w-7 items-center justify-center rounded-md transition-colors"
                    style={{
                      color: "var(--text-tertiary)",
                      transitionDuration: "var(--duration-instant)",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = "var(--text-primary)";
                      e.currentTarget.style.backgroundColor = "var(--surface-3)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = "var(--text-tertiary)";
                      e.currentTarget.style.backgroundColor = "transparent";
                    }}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Scrollable metadata */}
                <div className="flex-1 overflow-y-auto" style={{ scrollbarGutter: "stable" }}>
                  <MetadataPane
                    image={image}
                    copied={copied}
                    onCopy={handleCopy}
                    onDownload={handleDownload}
                    onAction={onAction}
                    selectedTags={selectedTags}
                    onTagToggle={onTagToggle}
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </aside>
    </>
  );
}

/* ─────────────────────────────────────────────── */
/*  Carousel Dots                                  */
/* ─────────────────────────────────────────────── */

function CarouselDots({
  count,
  active,
  onSelect,
}: {
  count: number;
  active: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onSelect(i)}
          className="rounded-full transition-all"
          style={{
            width: i === active ? 16 : 6,
            height: 6,
            backgroundColor: i === active ? "var(--coral)" : "rgba(0, 0, 0, 0.25)",
            transitionDuration: "var(--duration-fast)",
          }}
        />
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────── */
/*  Metadata Pane (shared between mobile/desktop)  */
/* ─────────────────────────────────────────────── */

function MetadataPane({
  image,
  copied,
  onCopy,
  onDownload,
  onAction,
  selectedTags,
  onTagToggle,
}: {
  image: NonNullable<DetailPanelProps["image"]>;
  copied: boolean;
  onCopy: () => void;
  onDownload: () => void;
  onAction: (intent: ModalIntent, imageId: string) => void;
  selectedTags?: string[];
  onTagToggle?: (tag: string) => void;
}) {
  return (
    <div className="flex flex-col">
      {/* ── Prompt ── */}
      <div className="px-4 pt-4 pb-3">
        <p
          className="mb-1 text-[11px] font-medium uppercase tracking-wider"
          style={{ color: "var(--text-tertiary)" }}
        >
          Prompt
        </p>
        <p
          className="text-[14px] leading-relaxed"
          style={{ color: "var(--text-primary)" }}
        >
          {image.prompt}
        </p>

        {/* Copy + Download */}
        <div className="mt-3 flex items-center gap-1">
          <ActionButton
            onClick={() => void onCopy()}
            icon={copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            label={copied ? "Copied" : "Copy"}
            highlight={copied}
          />
          <ActionButton
            onClick={onDownload}
            icon={<Download className="h-3.5 w-3.5" />}
            label="Download"
          />
        </div>
      </div>

      {/* ── Model Name ── */}
      {image.modelName && (
        <div
          className="px-4 py-3"
          style={{ borderTop: "1px solid var(--border-subtle)" }}
        >
          <p
            className="mb-2 text-[11px] font-medium uppercase tracking-wider"
            style={{ color: "var(--text-tertiary)" }}
          >
            Model
          </p>
          <span
            className="inline-flex items-center rounded-full px-2.5 py-1 font-mono text-[11px] font-medium uppercase tracking-wide"
            style={{
              backgroundColor: "var(--surface-2)",
              border: "1px solid var(--border-subtle)",
              color: "var(--text-secondary)",
            }}
          >
            {image.modelName}
          </span>
        </div>
      )}

      {/* ── Tags ── */}
      {image.tagNames && image.tagNames.length > 0 && (
        <div
          className="px-4 py-3"
          style={{ borderTop: "1px solid var(--border-subtle)" }}
        >
          <p
            className="mb-2 text-[11px] font-medium uppercase tracking-wider"
            style={{ color: "var(--text-tertiary)" }}
          >
            Tags
          </p>
          <div className="flex flex-wrap gap-1.5">
            {image.tagNames.map((tag) => (
              <TagPill
                key={tag}
                label={tag}
                active={selectedTags?.includes(tag) ?? false}
                onToggle={() => onTagToggle?.(tag)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Actions ── */}
      <div
        className="px-4 py-3"
        style={{ borderTop: "1px solid var(--border-subtle)" }}
      >
        <p
          className="mb-2 text-[11px] font-medium uppercase tracking-wider"
          style={{ color: "var(--text-tertiary)" }}
        >
          Actions
        </p>
        <div className="flex flex-col gap-1.5">
          {ACTIONS.map(({ intent, label, icon: Icon }) => (
            <button
              key={intent}
              type="button"
              onClick={() => onAction(intent, image.id)}
              className="group/action flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-[13px] transition-colors"
              style={{
                border: "1px solid var(--border-subtle)",
                backgroundColor: "transparent",
                transitionDuration: "var(--duration-fast)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "var(--surface-2)";
                e.currentTarget.style.borderColor = "var(--border-default)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
                e.currentTarget.style.borderColor = "var(--border-subtle)";
              }}
            >
              <Icon
                className="h-4 w-4 shrink-0"
                style={{ color: "var(--text-tertiary)" }}
              />
              <span
                className="flex-1 text-left font-medium"
                style={{ color: "var(--text-primary)" }}
              >
                {label}
              </span>
              <ArrowRight
                className="h-3.5 w-3.5 shrink-0 transition-transform group-hover/action:translate-x-0.5"
                style={{
                  color: "var(--text-ghost)",
                  transitionDuration: "var(--duration-fast)",
                }}
              />
            </button>
          ))}
        </div>
      </div>

      {/* Bottom spacer */}
      <div className="h-4" />
    </div>
  );
}

/* ─────────────────────────────────────────────── */
/*  Small inline action button (Copy, Download)    */
/* ─────────────────────────────────────────────── */

function ActionButton({
  onClick,
  icon,
  label,
  highlight = false,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  highlight?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors"
      style={{
        color: highlight ? "var(--coral)" : "var(--text-tertiary)",
        backgroundColor: "transparent",
        transitionDuration: "var(--duration-instant)",
      }}
      onMouseEnter={(e) => {
        if (!highlight) {
          e.currentTarget.style.color = "var(--text-primary)";
          e.currentTarget.style.backgroundColor = "var(--surface-2)";
        }
      }}
      onMouseLeave={(e) => {
        if (!highlight) {
          e.currentTarget.style.color = "var(--text-tertiary)";
          e.currentTarget.style.backgroundColor = "transparent";
        }
      }}
    >
      {icon}
      {label}
    </button>
  );
}
