import { AnimatePresence, motion } from "framer-motion";
import { Search, X } from "lucide-react";
import { useRef, useState } from "react";

type ExpandingSearchDockProps = {
  value?: string;
  onChange?: (query: string) => void;
  onClear?: () => void;
  placeholder?: string;
  loading?: boolean;
};

export function ExpandingSearchDock({
  value = "",
  onChange,
  onClear,
  placeholder = "Search...",
  loading = false,
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

  // Auto-expand if there's a value (e.g. on mount with existing query)
  const shouldShow = isExpanded || value.length > 0;

  return (
    <div className="relative">
      <AnimatePresence mode="wait">
        {!shouldShow ? (
          <motion.button
            key="icon"
            type="button"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            onClick={handleExpand}
            className="v7-search-dock flex h-10 w-10 items-center justify-center rounded-full"
            style={{
              border: "1px solid var(--v7-border-strong)",
              color: "var(--v7-text-ghost)",
              backgroundColor: "var(--v7-surface-1)",
            }}
          >
            <Search className="h-4 w-4" />
          </motion.button>
        ) : (
          <motion.div
            key="input"
            initial={{ width: 40, opacity: 0 }}
            animate={{ width: 420, opacity: 1 }}
            exit={{ width: 40, opacity: 0 }}
            transition={{
              type: "spring",
              stiffness: 300,
              damping: 30,
            }}
            className="relative"
          >
            <div
              className="v7-island v7-search-dock relative flex items-center gap-2 overflow-hidden"
              style={{ minHeight: "40px" }}
            >
              <div className="ml-4 shrink-0">
                <Search
                  className="h-3.5 w-3.5"
                  style={{ color: "var(--v7-text-ghost)" }}
                />
              </div>
              <input
                ref={inputRef}
                type="text"
                value={value}
                onChange={(e) => onChange?.(e.target.value)}
                placeholder={placeholder}
                className="min-w-0 flex-1 bg-transparent py-2 pr-2 outline-none"
                style={{
                  fontFamily: "var(--v7-font)",
                  fontSize: "10px",
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                  color: "var(--v7-text-primary)",
                }}
                aria-label="Search gallery"
                onKeyDown={(e) => {
                  if (e.key === "Escape") handleCollapse();
                }}
              />
              {loading ? (
                <span
                  className="mr-3 shrink-0"
                  style={{
                    fontSize: "9px",
                    fontWeight: 800,
                    textTransform: "uppercase",
                    letterSpacing: "0.12em",
                    color: "var(--v7-coral)",
                    whiteSpace: "nowrap",
                    fontFamily: "var(--v7-font)",
                  }}
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
                  className="mr-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors"
                  style={{ color: "var(--v7-text-ghost)" }}
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </motion.button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
