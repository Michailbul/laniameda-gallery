"use client";

import Image from "next/image";
import { useState } from "react";
import {
  X,
  ArrowRight,
  Paintbrush,
  Move,
  UserRound,
  Copy,
  Download,
  Check,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

type ModalIntent = "transfer_style" | "transfer_pose" | "replace_character";

interface ExpandedDetailProps {
  image: {
    id: string;
    thumbSrc: string;
    fullSrc: string;
    prompt: string;
    width?: number;
    height?: number;
    modelName?: string;
  };
  onClose: () => void;
  onAction: (intent: ModalIntent, imageId: string) => void;
}

const ACTIONS = [
  { intent: "transfer_style" as ModalIntent, label: "Transfer Style", icon: Paintbrush },
  { intent: "transfer_pose" as ModalIntent, label: "Transfer Pose", icon: Move },
  { intent: "replace_character" as ModalIntent, label: "Replace Character", icon: UserRound },
];

export function ExpandedDetail({ image, onClose, onAction }: ExpandedDetailProps) {
  const [fullLoaded, setFullLoaded] = useState(false);
  const { modelName } = image;
  const [copied, setCopied] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(image.prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isLongPrompt = image.prompt.length > 120;

  return (
    <div className="flex flex-col gap-4 p-4 animate-fade-in">
      {/* Close button */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors"
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
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Image — natural aspect ratio with amber glow */}
      <div
        className="relative overflow-hidden rounded-xl animate-fade-in"
        style={{
          aspectRatio: `${image.width ?? 1} / ${image.height ?? 1}`,
          boxShadow:
            "0 0 0 1.5px rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.3), 0 0 30px rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.08)",
        }}
      >
        <Image
          src={image.thumbSrc}
          alt={image.prompt}
          fill
          sizes="380px"
          className="rounded-xl object-cover"
          priority
          unoptimized
        />
        <Image
          src={image.fullSrc}
          alt={image.prompt}
          fill
          sizes="380px"
          className={`rounded-xl object-cover transition-opacity ${
            fullLoaded ? "opacity-100" : "opacity-0"
          }`}
          style={{ transitionDuration: "500ms" }}
          priority
          onLoadingComplete={() => setFullLoaded(true)}
          onError={() => setFullLoaded(true)}
          unoptimized
        />
      </div>

      {/* Prompt */}
      <div className="flex flex-col gap-1.5">
        <span
          className="text-[11px] font-medium uppercase tracking-wider"
          style={{ color: "var(--text-tertiary)" }}
        >
          Prompt
        </span>
        <p
          className="text-[14px] leading-relaxed"
          style={{
            color: "var(--text-secondary)",
            ...(!promptExpanded && isLongPrompt
              ? {
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical" as const,
                  overflow: "hidden",
                }
              : {}),
          }}
        >
          {image.prompt}
        </p>
        {isLongPrompt && (
          <button
            type="button"
            onClick={() => setPromptExpanded(!promptExpanded)}
            className="flex items-center gap-1 self-start text-[12px] transition-colors"
            style={{
              color: "var(--text-tertiary)",
              transitionDuration: "var(--duration-instant)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--amber-9)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--text-tertiary)";
            }}
          >
            {promptExpanded ? (
              <>
                <ChevronUp className="h-3 w-3" /> show less
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3" /> show more
              </>
            )}
          </button>
        )}
      </div>

      {/* Model name */}
      {modelName && (
        <div className="flex items-center gap-2">
          <span
            className="text-[11px] font-medium uppercase tracking-wider"
            style={{ color: "var(--text-tertiary)" }}
          >
            Model
          </span>
          <span
            className="rounded-full px-2.5 py-0.5 text-[11px] font-medium"
            style={{
              backgroundColor: "rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.1)",
              color: "var(--amber-9)",
              border: "1px solid rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.2)",
            }}
          >
            {modelName}
          </span>
        </div>
      )}

      {/* Copy / Download */}
      <div className="flex items-center gap-3">
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
              <Check className="h-3.5 w-3.5" style={{ color: "var(--amber-9)" }} />
              <span style={{ color: "var(--amber-9)" }}>Copied!</span>
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

      {/* Separator */}
      <div
        className="h-px"
        style={{ backgroundColor: "var(--border-subtle)" }}
      />

      {/* Action rows */}
      <div className="flex flex-col gap-1">
        {ACTIONS.map(({ intent, label, icon: Icon }) => (
          <button
            key={intent}
            type="button"
            onClick={() => onAction(intent, image.id)}
            className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 transition-all"
            style={{
              borderLeft: "3px solid var(--amber-8)",
              transitionDuration: "var(--duration-fast)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "var(--surface-2)";
              e.currentTarget.style.borderLeftColor = "var(--amber-9)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
              e.currentTarget.style.borderLeftColor = "var(--amber-8)";
            }}
          >
            <Icon
              className="h-4 w-4"
              style={{ color: "var(--text-tertiary)" }}
            />
            <span
              className="flex-1 text-left text-[13px] font-medium"
              style={{ color: "var(--text-primary)" }}
            >
              {label}
            </span>
            <ArrowRight
              className="h-3.5 w-3.5"
              style={{ color: "var(--text-ghost)" }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
