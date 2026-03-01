"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Home, Search, Plus } from "lucide-react";

interface MobileBottomNavProps {
  onAddClick?: () => void;
  onSearchClick?: () => void;
}

export function MobileBottomNav({ onAddClick, onSearchClick }: MobileBottomNavProps) {
  const pathname = usePathname();

  const handleSearch = () => {
    if (onSearchClick) {
      onSearchClick();
      return;
    }
    const target = document.getElementById("top-tag-system");
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <nav
      className="animate-bottom-nav-slide-up fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-t md:hidden"
      style={{
        height: "var(--mobile-bottom-nav-height)",
        background:
          "linear-gradient(180deg, rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.06) 0%, rgba(8, 4, 2, 0.95) 100%)",
        backdropFilter: "blur(24px) saturate(180%)",
        WebkitBackdropFilter: "blur(24px) saturate(180%)",
        borderColor: "var(--border-subtle)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {/* Home */}
      <Link
        href="/"
        className="relative flex flex-col items-center gap-0.5 px-3 py-1 transition-colors"
        style={{
          color: pathname === "/" ? "var(--amber-9)" : "var(--text-ghost)",
          transitionDuration: "var(--duration-instant)",
        }}
      >
        <Home className="h-5 w-5" />
        <span className="text-[9px] font-medium tracking-wide">Home</span>
        {pathname === "/" && (
          <span
            className="absolute -bottom-0.5 block h-[3px] w-[3px] rounded-full"
            style={{
              backgroundColor: "var(--amber-9)",
              boxShadow: "0 0 6px rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.55)",
            }}
          />
        )}
      </Link>

      {/* Search — scroll to tag system */}
      <button
        type="button"
        onClick={handleSearch}
        className="relative flex flex-col items-center gap-0.5 px-3 py-1 transition-colors"
        style={{
          color: "var(--text-ghost)",
          transitionDuration: "var(--duration-instant)",
        }}
      >
        <Search className="h-5 w-5" />
        <span className="text-[9px] font-medium tracking-wide">Search</span>
      </button>

      {/* Add */}
      <button
        type="button"
        onClick={onAddClick}
        className="flex h-11 w-11 items-center justify-center rounded-full transition-transform active:scale-90"
        style={{
          background: "linear-gradient(135deg, var(--amber-9), var(--warm-accent))",
          boxShadow: "0 4px 16px rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.3)",
          transitionDuration: "var(--duration-fast)",
        }}
        aria-label="Add to library"
      >
        <Plus
          className="h-5 w-5"
          style={{ color: "var(--amber-contrast)" }}
        />
      </button>
    </nav>
  );
}
