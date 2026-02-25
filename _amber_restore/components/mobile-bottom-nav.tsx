"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Home, Search, Plus, BookOpen, User } from "lucide-react";

interface MobileBottomNavProps {
  onAddClick?: () => void;
}

const NAV_ITEMS = [
  { icon: Home, label: "Home", href: "/" },
  { icon: Search, label: "Search", href: "/search" },
  { icon: Plus, label: "Add", href: null }, // special: triggers upload
  { icon: BookOpen, label: "Library", href: "/library" },
  { icon: User, label: "Profile", href: "/profile" },
];

export function MobileBottomNav({ onAddClick }: MobileBottomNavProps) {
  const pathname = usePathname();

  return (
    <nav
      className="animate-bottom-nav-slide-up fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-t md:hidden"
      style={{
        height: "var(--mobile-bottom-nav-height)",
        backgroundColor: "rgba(5, 19, 22, 0.85)",
        backdropFilter: "blur(24px) saturate(180%)",
        WebkitBackdropFilter: "blur(24px) saturate(180%)",
        borderColor: "var(--border-subtle)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {NAV_ITEMS.map(({ icon: Icon, label, href }) => {
        const isAdd = href === null;
        const isActive = href
          ? href === "/"
            ? pathname === "/"
            : pathname.startsWith(href)
          : false;

        if (isAdd) {
          return (
            <button
              key="add"
              type="button"
              onClick={onAddClick}
              className="animate-glow-pulse flex h-10 w-10 items-center justify-center rounded-full transition-transform active:scale-90"
              style={{
                backgroundColor: "var(--lime-9)",
                transitionDuration: "var(--duration-fast)",
              }}
              aria-label="Add to library"
            >
              <Icon
                className="h-5 w-5"
                style={{ color: "var(--lime-contrast)" }}
              />
            </button>
          );
        }

        return (
          <Link
            key={href}
            href={href!}
            className="relative flex flex-col items-center gap-0.5 px-3 py-1 transition-colors"
            style={{
              color: isActive ? "var(--lime-9)" : "var(--text-ghost)",
              transitionDuration: "var(--duration-instant)",
            }}
          >
            <Icon className="h-5 w-5" />
            <span className="text-[9px] font-medium tracking-wide">{label}</span>
            {isActive && (
              <span
                className="absolute -bottom-0.5 block h-[3px] w-[3px] rounded-full"
                style={{
                  backgroundColor: "var(--lime-9)",
                  boxShadow: "0 0 6px rgba(230, 255, 42, 0.5)",
                }}
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
