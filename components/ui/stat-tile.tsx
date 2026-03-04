import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface StatTileProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  value: ReactNode;
}

export function StatTile({
  label,
  value,
  className,
  ...props
}: StatTileProps) {
  return (
    <div
      className={cn("rounded-xl border px-2.5 py-2.5", className)}
      style={{
        borderColor: "color-mix(in srgb, var(--ink) 14%, transparent)",
        backgroundColor: "color-mix(in srgb, var(--paper) 62%, transparent)",
      }}
      {...props}
    >
      <p
        className="font-mono text-[8px] uppercase tracking-[0.14em]"
        style={{ color: "var(--text-ghost)" }}
      >
        {label}
      </p>
      <p
        className="mt-1 text-[18px] leading-none tabular-nums"
        style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)" }}
      >
        {value}
      </p>
    </div>
  );
}
