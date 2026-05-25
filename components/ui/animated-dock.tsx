"use client";

import * as React from "react";
import { useRef, useState } from "react";
import {
  AnimatePresence,
  MotionValue,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
} from "framer-motion";
import { Search, X } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export interface AnimatedDockProps {
  className?: string;
  items: DockItemData[];
  searchValue?: string;
  onSearchChange?: (query: string) => void;
  onSearchClear?: () => void;
  searchPlaceholder?: string;
  searchLoading?: boolean;
}

export interface DockItemData {
  link: string;
  Icon: React.ReactNode;
  target?: string;
  onClick?: (e: React.MouseEvent) => void;
  isSearch?: boolean;
}

export const AnimatedDock = ({
  className,
  items,
  searchValue = "",
  onSearchChange,
  onSearchClear,
  searchPlaceholder = "SEARCH VAULT...",
  searchLoading = false,
}: AnimatedDockProps) => {
  const mouseX = useMotionValue(Infinity);
  const [searchOpen, setSearchOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isSearchActive = searchOpen || searchValue.length > 0;

  const handleSearchOpen = () => {
    setSearchOpen(true);
    setTimeout(() => inputRef.current?.focus(), 80);
  };

  const handleSearchClose = () => {
    setSearchOpen(false);
    onSearchClear?.();
  };

  return (
    <motion.div
      onMouseMove={(e) => {
        if (!isSearchActive) mouseX.set(e.pageX);
      }}
      onMouseLeave={() => mouseX.set(Infinity)}
      className={cn(
        "mx-auto flex h-16 items-center gap-4 rounded-2xl px-4 lm-island",
        className,
      )}
      style={{
        borderRadius: "16px",
      }}
      layout
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
    >
      <AnimatePresence mode="popLayout">
        {isSearchActive ? (
          <motion.div
            key="search"
            className="flex h-10 items-center gap-3 flex-1"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            style={{ minWidth: 360 }}
          >
            <Search
              className="h-4 w-4 shrink-0 ml-1"
              style={{ color: "var(--text-ghost)" }}
            />
            <input
              ref={inputRef}
              type="text"
              value={searchValue}
              onChange={(e) => onSearchChange?.(e.target.value)}
              placeholder={searchPlaceholder}
              className="flex-1 bg-transparent text-sm font-mono uppercase tracking-wider focus:outline-none min-w-0"
              style={{ color: "var(--text-primary)" }}
              aria-label="Search gallery"
              onKeyDown={(e) => {
                if (e.key === "Escape") handleSearchClose();
              }}
            />
            {searchLoading ? (
              <span
                className="text-xs font-mono uppercase tracking-wider shrink-0 mr-1"
                style={{ color: "var(--text-ghost)" }}
              >
                Searching
              </span>
            ) : (
              <motion.button
                type="button"
                onClick={handleSearchClose}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full cursor-pointer mr-1"
                style={{
                  background: "var(--surface-3)",
                  color: "var(--text-secondary)",
                }}
                aria-label="Close search"
              >
                <X className="h-3.5 w-3.5" />
              </motion.button>
            )}
          </motion.div>
        ) : (
          items.map((item, index) => (
            <motion.div
              key={item.link + index}
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.15, delay: index * 0.03 }}
            >
              <DockItem mouseX={mouseX}>
                {item.isSearch ? (
                  <button
                    type="button"
                    onClick={handleSearchOpen}
                    className="grow flex items-center justify-center w-full h-full text-primary-foreground cursor-pointer"
                  >
                    {item.Icon}
                  </button>
                ) : (
                  <DockLink item={item} />
                )}
              </DockItem>
            </motion.div>
          ))
        )}
      </AnimatePresence>
    </motion.div>
  );
};

function DockLink({ item }: { item: DockItemData }) {
  if (item.onClick) {
    return (
      <button
        type="button"
        onClick={item.onClick}
        className="grow flex items-center justify-center w-full h-full text-primary-foreground cursor-pointer"
      >
        {item.Icon}
      </button>
    );
  }
  return (
    <Link
      href={item.link}
      target={item.target}
      className="grow flex items-center justify-center w-full h-full text-primary-foreground"
    >
      {item.Icon}
    </Link>
  );
}

interface DockItemProps {
  mouseX: MotionValue<number>;
  children: React.ReactNode;
}

export const DockItem = ({ mouseX, children }: DockItemProps) => {
  const ref = useRef<HTMLDivElement>(null);

  const distance = useTransform(mouseX, (val) => {
    const bounds = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 };
    return val - bounds.x - bounds.width / 2;
  });

  const widthSync = useTransform(distance, [-150, 0, 150], [40, 80, 40]);
  const width = useSpring(widthSync, {
    mass: 0.1,
    stiffness: 150,
    damping: 12,
  });

  const iconScale = useTransform(width, [40, 80], [1, 1.5]);
  const iconSpring = useSpring(iconScale, {
    mass: 0.1,
    stiffness: 150,
    damping: 12,
  });

  return (
    <motion.div
      ref={ref}
      style={{
        width,
        background:
          "linear-gradient(135deg, var(--gradient-1), var(--gradient-3), var(--gradient-5))",
      }}
      className="aspect-square w-10 rounded-full flex items-center justify-center"
    >
      <motion.div
        style={{ scale: iconSpring }}
        className="flex items-center justify-center w-full h-full grow"
      >
        {children}
      </motion.div>
    </motion.div>
  );
};
