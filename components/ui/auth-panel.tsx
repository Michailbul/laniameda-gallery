import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface AuthPanelProps extends HTMLAttributes<HTMLDivElement> {
  paddingClassName?: string;
}

export function AuthPanel({
  className,
  paddingClassName,
  style,
  ...props
}: AuthPanelProps) {
  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-[24px] border",
        paddingClassName,
        className,
      )}
      style={{
        borderColor: "color-mix(in srgb, var(--ink) 22%, transparent)",
        background:
          "linear-gradient(165deg, color-mix(in srgb, var(--surface-1) 90%, var(--paper) 10%) 0%, color-mix(in srgb, var(--surface-1) 80%, var(--surface-2) 20%) 100%)",
        boxShadow:
          "0 1px 0 color-mix(in srgb, var(--paper) 68%, transparent) inset, var(--shadow-lg)",
        ...style,
      }}
      {...props}
    />
  );
}
