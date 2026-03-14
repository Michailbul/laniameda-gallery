"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Search, X } from "lucide-react";
import { useRef, useState } from "react";

type ExpandingSearchDockProps = {
  value?: string;
  onChange?: (query: string) => void;
  onClear?: () => void;
  placeholder?: string;
  loading?: boolean;
  /** Render as a dock-sized icon button when collapsed */
  dockMode?: boolean;
};

export function ExpandingSearchDock({
  value = "",
  onChange,
  onClear,
  placeholder = "Search...",
  loading = false,
  dockMode = false,
}: ExpandingSearchDockProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleExpand = () => {
    setIsExpanded(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleCollapse = () => {
    setIsExpanded(false);
    onClear?.();
  };

  const shouldShow = isExpanded || value.length > 0;

  if (dockMode) {
    return (
      <AnimatePresence mode="wait">
        {!shouldShow ? (
          <motion.button
            key="collapsed"
            type="button"
            initial={false}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.12 }}
            onClick={handleExpand}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground cursor-pointer"
          >
            <Search className="h-5 w-5" />
          </motion.button>
        ) : (
          <motion.div
            key="expanded"
            initial={{ width: 40, opacity: 0.5 }}
            animate={{ width: 420, opacity: 1 }}
            exit={{ width: 40, opacity: 0 }}
            transition={{
              type: "spring",
              stiffness: 300,
              damping: 28,
            }}
            className="absolute left-1/2 -translate-x-1/2 overflow-hidden rounded-full z-10"
            style={{
              background: "var(--paper)",
              border: "2px solid var(--ink)",
            }}
          >
            <div className="flex h-10 items-center gap-2">
              <Search
                className="ml-3 h-4 w-4 shrink-0"
                style={{ color: "var(--text-ghost)" }}
              />
              <input
                ref={inputRef}
                type="text"
                value={value}
                onChange={(e) => onChange?.(e.target.value)}
                placeholder={placeholder}
                className="flex-1 bg-transparent text-sm font-mono uppercase tracking-wider focus:outline-none"
                style={{ color: "var(--text-primary)" }}
                aria-label="Search gallery"
                onKeyDown={(e) => {
                  if (e.key === "Escape") handleCollapse();
                }}
              />
              {loading ? (
                <span
                  className="mr-3 text-xs font-mono uppercase tracking-wider shrink-0"
                  style={{ color: "var(--text-ghost)" }}
                >
                  Searching
                </span>
              ) : (
                <motion.button
                  type="button"
                  onClick={handleCollapse}
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  className="mr-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full cursor-pointer"
                  style={{
                    background: "var(--surface-3)",
                    color: "var(--text-secondary)",
                  }}
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </motion.button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  // Original non-dock mode (unchanged)
  return (
    <AnimatePresence mode="wait">
      {!shouldShow ? (
        <motion.button
          key="collapsed"
          type="button"
          initial={false}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onClick={handleExpand}
          className="v7-search-dock-btn"
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span>{placeholder}</span>
        </motion.button>
      ) : (
        <motion.div
          key="expanded"
          initial={{ width: 200, opacity: 0.5 }}
          animate={{ width: 480, opacity: 1 }}
          exit={{ width: 200, opacity: 0 }}
          transition={{
            type: "spring",
            stiffness: 300,
            damping: 30,
          }}
        >
          <div className="v7-search-dock-expanded">
            <Search
              className="ml-4 h-3.5 w-3.5 shrink-0"
              style={{ color: "var(--v7-text-tertiary)" }}
            />
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => onChange?.(e.target.value)}
              placeholder={placeholder}
              className="v7-search-dock-input"
              aria-label="Search gallery"
              onKeyDown={(e) => {
                if (e.key === "Escape") handleCollapse();
              }}
            />
            {loading ? (
              <span className="v7-search-dock-loading">Searching</span>
            ) : (
              <motion.button
                type="button"
                onClick={handleCollapse}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                className="v7-search-dock-close"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </motion.button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
