"use client";

import {
  Home,
  Plus,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Github,
  Twitter,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TelegramLoginButton } from "./telegram-login-button";

interface User {
  telegramId: string;
  firstName: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
}

interface AppSidebarProps {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onUploadClick: () => void;
  user?: User | null;
  onSignOut?: () => void;
}

const SECTION_LABEL_STYLE: React.CSSProperties = {
  fontSize: "10px",
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.4em",
  color: "var(--text-tertiary)",
  lineHeight: 1.4,
};

export function AppSidebar({
  collapsed,
  onCollapsedChange,
  onUploadClick,
  user,
  onSignOut,
}: AppSidebarProps) {
  const pathname = usePathname();
  const isGalleryActive = pathname === "/";

  const sidebarWidth = collapsed
    ? "var(--sidebar-collapsed-width)"
    : "var(--sidebar-width)";

  return (
    <aside
      className="fixed left-0 top-0 z-40 flex h-dvh flex-col overflow-hidden border-r"
      style={{
        width: sidebarWidth,
        backgroundColor: "var(--paper)",
        borderColor: "var(--border-default)",
        transition: `width var(--duration-normal) cubic-bezier(0.16, 1, 0.3, 1)`,
      }}
    >
      {/* ── Header ── */}
      <div
        className="flex flex-shrink-0 items-center border-b"
        style={{
          height: "48px",
          borderColor: "var(--border-subtle)",
          padding: "0 12px",
          justifyContent: collapsed ? "center" : "space-between",
        }}
      >
        {/* Wordmark */}
        {!collapsed && (
          <span
            className="select-none"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "16px",
              fontStyle: "italic",
              color: "var(--text-primary)",
              letterSpacing: "-0.02em",
            }}
          >
            laniameda
          </span>
        )}

        {/* Collapse toggle */}
        {!collapsed && (
          <button
            type="button"
            onClick={() => onCollapsedChange(true)}
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md transition-colors"
            style={{
              color: "var(--text-ghost)",
              transitionDuration: "var(--duration-instant)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--text-secondary)";
              e.currentTarget.style.backgroundColor = "var(--surface-3)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--text-ghost)";
              e.currentTarget.style.backgroundColor = "transparent";
            }}
            aria-label="Collapse sidebar"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        )}

        {/* Expand toggle - only when collapsed */}
        {collapsed && (
          <button
            type="button"
            onClick={() => onCollapsedChange(false)}
            className="absolute -right-3 top-[60px] flex h-6 w-6 items-center justify-center rounded-full border transition-colors"
            style={{
              backgroundColor: "var(--surface-3)",
              borderColor: "var(--border-default)",
              color: "var(--text-secondary)",
              transitionDuration: "var(--duration-instant)",
              zIndex: 1,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "var(--surface-3)";
              e.currentTarget.style.borderColor = "var(--border-strong)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "var(--surface-3)";
              e.currentTarget.style.borderColor = "var(--border-default)";
            }}
            aria-label="Expand sidebar"
          >
            <ChevronRight className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* ── Scrollable body ── */}
      <ScrollArea className="flex-1 overflow-hidden">
        <div className="flex flex-col gap-1 py-2">
          {/* ── Nav items ── */}
          <div className="flex flex-col gap-0.5 px-2">
            <NavItem
              icon={Home}
              label="Gallery"
              href="/"
              active={isGalleryActive}
              collapsed={collapsed}
            />
            <NavItem
              icon={Plus}
              label="Upload"
              href="#"
              active={false}
              collapsed={collapsed}
              onClick={onUploadClick}
            />
          </div>

          {/* ── Divider ── */}
          <div
            className="mx-3 my-1 h-px flex-shrink-0"
            style={{ backgroundColor: "var(--border-subtle)" }}
          />

          {/* ── More from us (expanded only) ── */}
          {!collapsed && (
            <>
              <div className="px-3 pb-1">
                <p style={SECTION_LABEL_STYLE}>More</p>
              </div>
              <div className="flex flex-col gap-0.5 px-2">
                <ExternalLinkItem label="Docs" href="#" />
                <ExternalLinkItem label="Discord" href="#" />
              </div>
            </>
          )}
        </div>
      </ScrollArea>

      {/* ── Footer: auth CTA / user + social ── */}
      <div
        className="flex flex-shrink-0 flex-col border-t"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        {/* Social icons */}
        {!collapsed && (
          <div className="flex items-center gap-1 px-3 py-2">
            <SocialIcon icon={Github} href="#" label="GitHub" />
            <SocialIcon icon={Twitter} href="#" label="Twitter" />
          </div>
        )}

        {/* User info / Auth CTA */}
        {user ? (
          <div
            className="flex items-center gap-2 px-3 py-2"
            style={{ justifyContent: collapsed ? "center" : "flex-start" }}
          >
            <div className="relative flex-shrink-0">
              {user.photoUrl ? (
                <img
                  src={user.photoUrl}
                  alt={user.firstName}
                  className="h-7 w-7 rounded-full object-cover"
                  style={{ border: "1px solid var(--border-default)" }}
                />
              ) : (
                <div
                  className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold"
                  style={{
                    backgroundColor: "var(--surface-4)",
                    border: "1px solid var(--border-default)",
                    color: "var(--text-secondary)",
                  }}
                >
                  {user.firstName[0]?.toUpperCase() ?? "U"}
                </div>
              )}
              <span
                className="absolute -bottom-0.5 -right-0.5 block h-[6px] w-[6px] rounded-full"
                style={{ backgroundColor: "var(--coral)" }}
              />
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p
                  className="truncate text-[11px] font-medium"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {user.username ? `@${user.username}` : user.firstName}
                </p>
                <button
                  type="button"
                  onClick={onSignOut}
                  className="text-[10px] transition-colors"
                  style={{
                    color: "var(--text-ghost)",
                    transitionDuration: "var(--duration-instant)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "var(--text-tertiary)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "var(--text-ghost)";
                  }}
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="px-3 py-3">
            {collapsed ? (
              <div
                className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold"
                style={{
                  backgroundColor: "var(--surface-4)",
                  border: "1px solid var(--border-default)",
                  color: "var(--text-ghost)",
                }}
              >
                G
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {/* Telegram widget */}
                <TelegramLoginButton size="small" />
                {/* Secondary OpenClaw link */}
                <button
                  type="button"
                  className="text-center text-[11px] font-medium transition-colors"
                  style={{
                    color: "var(--text-ghost)",
                    transitionDuration: "var(--duration-instant)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "var(--text-secondary)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "var(--text-ghost)";
                  }}
                >
                  or connect via OpenClaw
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function NavItem({
  icon: Icon,
  label,
  href,
  active,
  collapsed,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  href: string;
  active: boolean;
  collapsed: boolean;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <div
        className="flex flex-shrink-0 items-center justify-center"
        style={{ width: "28px", height: "28px" }}
      >
        <Icon className="h-4 w-4" />
      </div>
      {!collapsed && (
        <span className="truncate text-[13px] font-medium">{label}</span>
      )}
    </>
  );

  const baseStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    borderRadius: "8px",
    padding: collapsed ? "6px 8px" : "4px 6px",
    width: "100%",
    justifyContent: collapsed ? "center" : "flex-start",
    color: active ? "var(--text-primary)" : "var(--text-secondary)",
    backgroundColor: active ? "var(--surface-2)" : "transparent",
    transition: `background-color var(--duration-instant), color var(--duration-instant)`,
    cursor: "pointer",
  };

  const handleMouseEnter = (e: React.MouseEvent<HTMLElement>) => {
    if (!active) {
      e.currentTarget.style.backgroundColor = "var(--paper-muted)";
      e.currentTarget.style.color = "var(--text-primary)";
    }
  };
  const handleMouseLeave = (e: React.MouseEvent<HTMLElement>) => {
    if (!active) {
      e.currentTarget.style.backgroundColor = "transparent";
      e.currentTarget.style.color = "var(--text-secondary)";
    }
  };

  if (onClick) {
    return (
      <button
        type="button"
        style={baseStyle}
        onClick={onClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {inner}
      </button>
    );
  }

  return (
    <Link
      href={href}
      style={baseStyle}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {inner}
    </Link>
  );
}

function ExternalLinkItem({ label, href }: { label: string; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] font-medium transition-colors"
      style={{
        color: "var(--text-tertiary)",
        transitionDuration: "var(--duration-instant)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = "var(--text-secondary)";
        e.currentTarget.style.backgroundColor = "var(--surface-2)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "var(--text-tertiary)";
        e.currentTarget.style.backgroundColor = "transparent";
      }}
    >
      {label}
      <ExternalLink className="ml-auto h-3 w-3 opacity-50" />
    </a>
  );
}

function SocialIcon({
  icon: Icon,
  href,
  label,
}: {
  icon: React.ElementType;
  href: string;
  label: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="flex h-7 w-7 items-center justify-center rounded-md transition-colors"
      style={{
        color: "var(--text-ghost)",
        transitionDuration: "var(--duration-instant)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = "var(--text-secondary)";
        e.currentTarget.style.backgroundColor = "var(--surface-3)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "var(--text-ghost)";
        e.currentTarget.style.backgroundColor = "transparent";
      }}
    >
      <Icon className="h-3.5 w-3.5" />
    </a>
  );
}

