"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import {
  X,
  ArrowRight,
  Paintbrush,
  Move,
  UserRound,
  Copy,
  Download,
  Check,
} from "lucide-react";

type ModalIntent = "transfer_style" | "transfer_pose" | "replace_character";

type ImageModalProps = {
  open: boolean;
  onClose: () => void;
  image: {
    id: string;
    thumbSrc: string;
    fullSrc: string;
    prompt: string;
    width?: number;
    height?: number;
  } | null;
  onAction: (intent: ModalIntent, imageId: string) => void;
};

const ACTIONS = [
  {
    intent: "transfer_style" as ModalIntent,
    label: "Transfer Style",
    icon: Paintbrush,
  },
  {
    intent: "transfer_pose" as ModalIntent,
    label: "Transfer Pose",
    icon: Move,
  },
  {
    intent: "replace_character" as ModalIntent,
    label: "Replace Character",
    icon: UserRound,
  },
];

export function ImageModal({ open, onClose, image, onAction }: ImageModalProps) {
  const [fullLoaded, setFullLoaded] = useState(false);
  const [copied, setCopied] = useState(false);

  const aspectRatio = useMemo(() => {
    if (!image?.width || !image?.height) return undefined;
    return image.width / image.height;
  }, [image?.height, image?.width]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "c" && !event.metaKey && !event.ctrlKey && image) {
        void navigator.clipboard.writeText(image.prompt);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, onClose, image]);

  useEffect(() => {
    if (!open || !image) return;
    const frame = requestAnimationFrame(() => setFullLoaded(false));
    return () => cancelAnimationFrame(frame);
  }, [image, open]);

  if (!open || !image) return null;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(image.prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-[60] animate-fade-in">
      {/* Backdrop — teal-tinted radial */}
      <div
        className="absolute inset-0"
        style={{
          background: "radial-gradient(ellipse at center, rgba(12, 70, 81, 0.12) 0%, rgba(2, 10, 12, 0.95) 70%)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
        }}
        onClick={onClose}
      />

      {/* Content */}
      <div className="relative z-10 flex h-full w-full flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="text-[13px] font-medium transition-colors"
            style={{
              color: "var(--text-tertiary)",
              transitionDuration: "var(--duration-instant)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--text-primary)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--text-tertiary)";
            }}
          >
            &larr; Back
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
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

        {/* Image area */}
        <div className="flex flex-1 items-center justify-center px-6">
          <div
            className="relative animate-modal-enter"
            style={{
              maxHeight: "70vh",
              maxWidth: aspectRatio
                ? `min(90vw, calc(70vh * ${aspectRatio}))`
                : "90vw",
              width: "100%",
              aspectRatio: aspectRatio ? `${aspectRatio}` : undefined,
            }}
          >
            <Image
              src={image.thumbSrc}
              alt={image.prompt}
              fill
              sizes="(max-width: 1280px) 90vw, 60vw"
              className="rounded-lg object-contain"
              priority
              unoptimized
            />
            <Image
              src={image.fullSrc}
              alt={image.prompt}
              fill
              sizes="(max-width: 1280px) 90vw, 60vw"
              className={`rounded-lg object-contain transition-opacity ${
                fullLoaded ? "opacity-100" : "opacity-0"
              }`}
              style={{ transitionDuration: "500ms" }}
              priority
              onLoadingComplete={() => setFullLoaded(true)}
              onError={() => setFullLoaded(true)}
              unoptimized
            />
            {/* Vignette shadow */}
            <div
              className="pointer-events-none absolute inset-0 rounded-lg"
              style={{
                boxShadow: "inset 0 0 80px rgba(0, 0, 0, 0.15)",
              }}
            />
          </div>
        </div>

        {/* Bottom panel */}
        <div
          className="animate-fade-in-up px-6 py-5"
          style={{
            animationDelay: "100ms",
            animationFillMode: "backwards",
          }}
        >
          <div className="mx-auto max-w-3xl">
            {/* Prompt text — editorial serif */}
            <p
              className="font-display text-[15px] leading-relaxed italic"
              style={{ color: "var(--text-secondary)", letterSpacing: "0.01em" }}
            >
              {image.prompt}
            </p>

            {/* Action cards */}
            <div className="mt-4 flex flex-wrap gap-2">
              {ACTIONS.map(({ intent, label, icon: Icon }) => (
                <button
                  key={intent}
                  type="button"
                  onClick={() => onAction(intent, image.id)}
                  className="group/action flex items-center gap-2.5 rounded-xl px-4 py-2.5 transition-all"
                  style={{
                    backgroundColor: "var(--surface-2)",
                    border: "1px solid var(--border-default)",
                    borderLeft: "3px solid var(--lime-8)",
                    transitionDuration: "var(--duration-fast)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--border-accent)";
                    e.currentTarget.style.borderLeftColor = "var(--lime-9)";
                    e.currentTarget.style.boxShadow =
                      "0 0 16px rgba(230, 255, 42, 0.1), 0 0 8px rgba(230, 255, 42, 0.08)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--border-default)";
                    e.currentTarget.style.borderLeftColor = "var(--lime-8)";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                >
                  <Icon
                    className="h-4 w-4"
                    style={{ color: "var(--text-tertiary)" }}
                  />
                  <span
                    className="text-[13px] font-medium"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {label}
                  </span>
                  <ArrowRight
                    className="h-3.5 w-3.5 transition-transform group-hover/action:translate-x-1"
                    style={{
                      color: "var(--text-ghost)",
                      transitionDuration: "var(--duration-fast)",
                    }}
                  />
                </button>
              ))}
            </div>

            {/* Secondary actions */}
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={() => void handleCopy()}
                className="flex items-center gap-1.5 text-[13px] transition-colors"
                style={{
                  color: "var(--text-tertiary)",
                  transitionDuration: "var(--duration-instant)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "var(--text-primary)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "var(--text-tertiary)";
                }}
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5" style={{ color: "var(--lime-9)" }} />
                    <span style={{ color: "var(--lime-9)" }}>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Copy Prompt
                  </>
                )}
              </button>
              <button
                type="button"
                className="flex items-center gap-1.5 text-[13px] transition-colors"
                style={{
                  color: "var(--text-tertiary)",
                  transitionDuration: "var(--duration-instant)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "var(--text-primary)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "var(--text-tertiary)";
                }}
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
