"use client";

import { X } from "lucide-react";

interface TagPillProps {
  label: string;
  active?: boolean;
  removable?: boolean;
  onToggle?: () => void;
  onRemove?: () => void;
}

export function TagPill({
  label,
  active = false,
  removable = false,
  onToggle,
  onRemove,
}: TagPillProps) {
  return (
    <button
      type="button"
      onClick={removable ? onRemove : onToggle}
      className="animate-tag-enter inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-[13px] font-medium transition-all"
      style={{
        backgroundColor: active ? "var(--accent-subtle)" : "transparent",
        border: active
          ? "1px solid rgba(255, 140, 66, 0.35)"
          : "1px solid var(--border-default)",
        color: active ? "var(--amber-9)" : "var(--text-secondary)",
        transitionDuration: "var(--duration-instant)",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.borderColor = "var(--border-strong)";
          e.currentTarget.style.color = "var(--text-primary)";
          e.currentTarget.style.backgroundColor = "var(--surface-2)";
        } else {
          e.currentTarget.style.backgroundColor = "var(--accent-glow)";
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.borderColor = "var(--border-default)";
          e.currentTarget.style.color = "var(--text-secondary)";
          e.currentTarget.style.backgroundColor = "transparent";
        } else {
          e.currentTarget.style.backgroundColor = "var(--accent-subtle)";
        }
      }}
    >
      {label}
      {removable && (
        <X
          className="h-3 w-3 transition-colors"
          style={{ color: "var(--text-tertiary)" }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--amber-9)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--text-tertiary)";
          }}
        />
      )}
    </button>
  );
}
