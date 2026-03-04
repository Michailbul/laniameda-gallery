import type { ButtonHTMLAttributes, CSSProperties } from "react";
import { cn } from "@/lib/utils";

interface FilterChipProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> {
  active?: boolean;
  onClick?: () => void;
  activeClassName?: string;
  inactiveClassName?: string;
  activeStyle?: CSSProperties;
  inactiveStyle?: CSSProperties;
}

export function FilterChip({
  active = false,
  onClick,
  className,
  activeClassName,
  inactiveClassName,
  activeStyle,
  inactiveStyle,
  style,
  children,
  ...props
}: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(className, active ? activeClassName : inactiveClassName)}
      style={{
        ...(active ? activeStyle : inactiveStyle),
        ...style,
      }}
      {...props}
    >
      {children}
    </button>
  );
}
