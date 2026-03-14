"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

const gradientButtonVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-colors outline-none select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "text-white",
        outline: "bg-transparent",
      },
      size: {
        sm: "h-8 gap-1.5 rounded-lg px-3 text-xs",
        default: "h-9 gap-2 rounded-xl px-4 text-sm",
        lg: "h-11 gap-2 rounded-xl px-6 text-sm",
        icon: "size-[52px] rounded-2xl",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

interface GradientButtonProps
  extends Omit<React.ComponentProps<"button">, "style">,
    VariantProps<typeof gradientButtonVariants> {
  glow?: boolean;
}

function GradientButton({
  className,
  variant = "default",
  size = "default",
  glow = false,
  children,
  ...props
}: GradientButtonProps) {
  const isOutline = variant === "outline";

  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      className={cn(gradientButtonVariants({ variant, size }), className)}
      style={{
        ...(isOutline
          ? {
              border: "2px solid transparent",
              backgroundImage: `linear-gradient(var(--surface-0), var(--surface-0)), linear-gradient(135deg, var(--gradient-1), var(--gradient-3), var(--gradient-5))`,
              backgroundOrigin: "border-box",
              backgroundClip: "padding-box, border-box",
              color: "var(--gradient-3)",
            }
          : {
              background:
                "linear-gradient(135deg, var(--gradient-1), var(--gradient-2), var(--gradient-3), var(--gradient-4), var(--gradient-5))",
              backgroundSize: "200% 200%",
              backgroundPosition: "0% 50%",
            }),
        ...(glow
          ? {
              boxShadow:
                "0 0 20px color-mix(in srgb, var(--gradient-3) 30%, transparent), 0 4px 16px rgba(0, 0, 0, 0.12)",
            }
          : {}),
      }}
      onMouseEnter={(e) => {
        if (!isOutline) {
          (e.currentTarget as HTMLElement).style.backgroundPosition =
            "100% 50%";
        }
      }}
      onMouseLeave={(e) => {
        if (!isOutline) {
          (e.currentTarget as HTMLElement).style.backgroundPosition = "0% 50%";
        }
      }}
      {...(props as React.ComponentProps<typeof motion.button>)}
    >
      {glow && (
        <span
          className="animate-gradient-pulse pointer-events-none absolute inset-0 rounded-[inherit]"
          style={{
            background:
              "linear-gradient(135deg, var(--gradient-1), var(--gradient-3), var(--gradient-5))",
            opacity: 0.3,
            filter: "blur(12px)",
            zIndex: -1,
          }}
        />
      )}
      {children}
    </motion.button>
  );
}

export { GradientButton, gradientButtonVariants };
