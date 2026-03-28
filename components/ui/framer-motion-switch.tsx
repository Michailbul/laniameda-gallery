"use client";

import { useId } from "react";
import { motion } from "framer-motion";
import { twMerge } from "tailwind-merge";

export const Switch = ({
  checked,
  setChecked,
  label,
  className,
  labelClassName,
}: {
  checked: boolean;
  setChecked: (checked: boolean) => void;
  label?: string;
  className?: string;
  labelClassName?: string;
}) => {
  const checkboxId = useId();

  return (
    <form className={twMerge("flex items-center gap-3 antialiased", className)}>
      <label
        htmlFor={checkboxId}
        className={twMerge(
          "relative flex h-7 w-[60px] cursor-pointer items-center rounded-full border border-transparent px-1 shadow-[inset_0px_0px_12px_rgba(0,0,0,0.25)] transition duration-200",
          checked ? "" : "border-input bg-muted",
        )}
        style={checked ? { background: "linear-gradient(135deg, var(--gradient-1), var(--gradient-3), var(--gradient-5))" } : undefined}
      >
        <motion.div
          initial={{
            width: "20px",
            x: checked ? 0 : 32,
          }}
          animate={{
            height: ["20px", "10px", "20px"],
            width: ["20px", "30px", "20px", "20px"],
            x: checked ? 32 : 0,
          }}
          transition={{
            duration: 0.3,
            delay: 0.1,
          }}
          key={String(checked)}
          className="z-10 block h-[20px] rounded-full bg-white shadow-md"
        />
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          className="hidden"
          id={checkboxId}
          aria-label={label ?? "Toggle switch"}
        />
      </label>
      {label ? (
        <p className={twMerge("text-sm font-medium text-muted-foreground", labelClassName)}>
          {label}
        </p>
      ) : null}
    </form>
  );
};
