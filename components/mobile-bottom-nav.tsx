"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Home, Search, Plus, User, LogOut, X } from "lucide-react";
import { TelegramLoginButton } from "./telegram-login-button";

interface MobileBottomNavUser {
  firstName?: string | null;
  email?: string | null;
  photoUrl?: string | null;
  username?: string | null;
}

interface MobileBottomNavProps {
  onAddClick?: () => void;
  onSearchClick?: () => void;
  user?: MobileBottomNavUser | null;
  onSignOut?: () => void;
}

export function MobileBottomNav({ onAddClick, onSearchClick, user, onSignOut }: MobileBottomNavProps) {
  const pathname = usePathname();
  const [profileOpen, setProfileOpen] = useState(false);

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
    <>
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

        {/* Profile / Login */}
        <button
          type="button"
          onClick={() => setProfileOpen(true)}
          className="relative flex flex-col items-center gap-0.5 px-3 py-1 transition-colors"
          style={{
            color: user ? "var(--amber-9)" : "var(--text-ghost)",
            transitionDuration: "var(--duration-instant)",
          }}
          aria-label={user ? "Profile" : "Sign in"}
        >
          {user?.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.photoUrl}
              alt={user.firstName ?? "User"}
              className="h-5 w-5 rounded-full object-cover"
            />
          ) : (
            <User className="h-5 w-5" />
          )}
          <span className="text-[9px] font-medium tracking-wide">
            {user ? "Profile" : "Sign in"}
          </span>
        </button>
      </nav>

      {/* Profile / Login Sheet */}
      {profileOpen && (
        <div className="fixed inset-0 z-70 md:hidden">
          <div
            className="absolute inset-0 bg-black/55 backdrop-blur-sm animate-fade-in"
            onClick={() => setProfileOpen(false)}
            aria-hidden="true"
          />
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-3xl border-t animate-sheet-slide-up"
            style={{
              background: "linear-gradient(180deg, rgba(17,10,6,0.98) 0%, rgba(8,4,2,0.99) 100%)",
              borderColor: "var(--border-subtle)",
              paddingBottom: "env(safe-area-inset-bottom)",
            }}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div
                className="h-1 w-10 rounded-full"
                style={{ backgroundColor: "rgba(255,255,255,0.3)" }}
              />
            </div>

            <div className="px-5 pb-6 pt-2">
              {/* Header */}
              <div className="mb-4 flex items-center justify-between">
                <h3
                  className="font-display text-lg italic"
                  style={{ color: "var(--text-primary)" }}
                >
                  {user ? "Profile" : "Sign in"}
                </h3>
                <button
                  type="button"
                  onClick={() => setProfileOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-full"
                  style={{ color: "var(--text-ghost)" }}
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {user ? (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-3">
                    {user.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={user.photoUrl}
                        alt={user.firstName ?? "User"}
                        className="h-12 w-12 rounded-full object-cover"
                        style={{ border: "2px solid var(--border-default)" }}
                      />
                    ) : (
                      <div
                        className="flex h-12 w-12 items-center justify-center rounded-full text-sm font-semibold"
                        style={{
                          backgroundColor: "var(--surface-3)",
                          border: "2px solid var(--border-default)",
                          color: "var(--text-secondary)",
                        }}
                      >
                        {(user.firstName?.[0] ?? user.email?.[0] ?? "U").toUpperCase()}
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                        {user.username ? `@${user.username}` : user.firstName ?? user.email ?? "User"}
                      </p>
                      {user.email && (
                        <p className="text-xs" style={{ color: "var(--text-ghost)" }}>
                          {user.email}
                        </p>
                      )}
                    </div>
                  </div>
                  {onSignOut && (
                    <button
                      type="button"
                      onClick={() => {
                        onSignOut();
                        setProfileOpen(false);
                      }}
                      className="flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2.5 text-[11px] font-semibold uppercase tracking-widest transition-colors"
                      style={{
                        fontFamily: "var(--font-mono)",
                        borderColor: "var(--border-strong)",
                        backgroundColor: "transparent",
                        color: "var(--text-secondary)",
                      }}
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      Sign out
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <TelegramLoginButton size="medium" />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
