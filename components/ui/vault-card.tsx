import type { CSSProperties, HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type VaultCardTone = "default" | "subtle";

const TONE_STYLES: Record<VaultCardTone, CSSProperties> = {
  default: {
    borderColor: "color-mix(in srgb, var(--ink) 18%, transparent)",
    background:
      "linear-gradient(162deg, color-mix(in srgb, var(--surface-1) 90%, var(--paper) 10%) 0%, color-mix(in srgb, var(--surface-2) 84%, var(--paper) 16%) 100%)",
    boxShadow:
      "0 1px 0 color-mix(in srgb, var(--paper) 70%, transparent) inset, 0 12px 24px rgba(30, 14, 5, 0.08)",
  },
  subtle: {
    borderColor: "color-mix(in srgb, var(--ink) 14%, transparent)",
    backgroundColor: "color-mix(in srgb, var(--paper) 72%, transparent)",
    boxShadow: "0 1px 0 color-mix(in srgb, var(--paper) 78%, transparent) inset",
  },
};

interface VaultCardProps extends HTMLAttributes<HTMLDivElement> {
  tone?: VaultCardTone;
}

export function VaultCard({
  tone = "default",
  className,
  style,
  ...props
}: VaultCardProps) {
  return (
    <div
      className={cn("overflow-hidden rounded-[20px] border", className)}
      style={{
        ...TONE_STYLES[tone],
        ...style,
      }}
      {...props}
    />
  );
}
