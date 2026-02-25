"use client";

import { useEffect, useRef, useState } from "react";
import {
  Home,
  Search,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Github,
  Twitter,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RecentUpdates } from "./recent-updates";

interface Tag {
  _id: string;
  name: string;
  usageCount?: number;
}

interface RecentAsset {
  _id: string;
  thumbUrl?: string;
  url?: string;
  sourceUrl?: string;
  promptText?: string;
}

interface User {
  email?: string | null;
  firstName?: string | null;
}

interface AppSidebarProps {
  tags: Tag[];
  selectedTags: string[];
  onTagToggle: (tag: string) => void;
  onClearAll: () => void;
  recentAssets?: RecentAsset[];
  onRecentAssetClick?: (assetId: string) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  user?: User | null;
  onSignOut?: () => void;
  onSearchFocus?: () => void;
}

const SECTION_LABEL_STYLE: React.CSSProperties = {
  fontSize: "10px",
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.4em",
  color: "var(--text-ghost)",
  lineHeight: 1.4,
};

export function AppSidebar({
  tags,
  selectedTags,
  onTagToggle,
  onClearAll,
  recentAssets = [],
  onRecentAssetClick,
  collapsed,
  onCollapsedChange,
  user,
  onSignOut,
  onSearchFocus,
}: AppSidebarProps) {
  const pathname = usePathname();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const isGalleryActive = pathname === "/";
  const _isLibraryActive = pathname.startsWith("/library");

  // Sort tags by usage, show top 20
  const sortedTags = [...tags]
    .sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0))
    .slice(0, 20);

  const filteredTags = searchQuery
    ? sortedTags.filter((t) =>
        t.name.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : sortedTags;

  useEffect(() => {
    if (searchOpen && searchRef.current) {
      searchRef.current.focus();
    }
  }, [searchOpen]);

  const handleSearchToggle = () => {
    if (collapsed) {
      onCollapsedChange(false);
      setSearchOpen(true);
      onSearchFocus?.();
    } else {
      setSearchOpen((prev) => !prev);
      if (searchOpen) setSearchQuery("");
    }
  };

  const sidebarWidth = collapsed
    ? "var(--sidebar-collapsed-width)"
    : "var(--sidebar-width)";

  return (
    <aside
      className="fixed left-0 top-0 z-40 flex h-dvh flex-col overflow-hidden border-r"
      style={{
        width: sidebarWidth,
        background: "linear-gradient(180deg, var(--surface-1) 0%, rgba(0,0,0,0.95) 100%)",
        borderColor: "var(--border-subtle)",
        transition: `width var(--duration-normal) cubic-bezier(0.16, 1, 0.3, 1)`,
      }}
    >
      {/* ── Logo ── */}
      <div
        className="flex flex-shrink-0 items-center border-b"
        style={{
          height: "48px",
          borderColor: "var(--border-subtle)",
          padding: collapsed ? "0 20px" : "0 16px",
          justifyContent: collapsed ? "center" : "space-between",
        }}
      >
        {/* Logo mark always visible */}
        <div className="flex items-center gap-2 overflow-hidden">
          <div
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md transition-shadow"
            style={{
              background: "linear-gradient(135deg, var(--lime-8), var(--lime-9))",
              boxShadow: "0 0 16px rgba(230, 255, 42, 0.2)",
              transitionDuration: "var(--duration-fast)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = "0 0 24px rgba(230, 255, 42, 0.35)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = "0 0 16px rgba(230, 255, 42, 0.2)";
            }}
          >
            <span
              className="text-[11px] font-semibold leading-none"
              style={{ color: "var(--lime-contrast)" }}
            >
              L
            </span>
          </div>
          {!collapsed && (
            <span
              className="truncate font-display text-[15px] tracking-tight"
              style={{ color: "var(--text-secondary)", letterSpacing: "-0.01em" }}
            >
              Laniameda
            </span>
          )}
        </div>

        {/* Collapse toggle - only when expanded */}
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
              e.currentTarget.style.backgroundColor = "var(--surface-4)";
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
              icon={Search}
              label="Search"
              href="#"
              active={searchOpen}
              collapsed={collapsed}
              onClick={handleSearchToggle}
            />
          </div>

          {/* ── Search input (expanded only) ── */}
          {!collapsed && searchOpen && (
            <div className="px-2">
              <div
                className="flex items-center gap-2 rounded-lg px-3 py-2 transition-shadow"
                style={{
                  backgroundColor: "var(--surface-2)",
                  border: "1px solid var(--border-default)",
                  transitionDuration: "var(--duration-fast)",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "var(--lime-9)";
                  e.currentTarget.style.boxShadow = "0 0 0 1px var(--lime-9), 0 0 8px rgba(230,255,42,0.1)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "var(--border-default)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              >
                <Search className="h-3.5 w-3.5 flex-shrink-0" style={{ color: "var(--text-ghost)" }} />
                <input
                  ref={searchRef}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search tags…"
                  className="flex-1 bg-transparent text-[12px] italic outline-none placeholder:italic"
                  style={{ color: "var(--text-primary)" }}
                />
              </div>
            </div>
          )}

          {/* ── Divider ── */}
          <div
            className="mx-3 my-1 h-px flex-shrink-0"
            style={{ backgroundColor: "var(--border-subtle)" }}
          />

          {/* ── Tags section ── */}
          {!collapsed && (
            <div className="px-3 pb-1">
              <p style={SECTION_LABEL_STYLE}>Tags</p>
            </div>
          )}

          <div className="flex flex-col gap-0.5 px-2">
            {/* All */}
            <TagItem
              label="All"
              count={tags.length}
              active={selectedTags.length === 0}
              collapsed={collapsed}
              onClick={onClearAll}
            />
            {filteredTags.map((tag) => (
              <TagItem
                key={tag._id}
                label={tag.name}
                count={tag.usageCount}
                active={selectedTags.includes(tag.name)}
                collapsed={collapsed}
                onClick={() => onTagToggle(tag.name)}
              />
            ))}
          </div>

          {/* ── Recent Updates (expanded only) ── */}
          {!collapsed && recentAssets.length > 0 && (
            <>
              <div
                className="mx-3 my-2 h-px flex-shrink-0"
                style={{ backgroundColor: "var(--border-subtle)" }}
              />
              <div className="px-3 pb-1">
                <p style={SECTION_LABEL_STYLE}>Recent</p>
              </div>
              <div className="px-3">
                <RecentUpdates
                  assets={recentAssets}
                  onAssetClick={onRecentAssetClick}
                />
              </div>
            </>
          )}

          {/* ── More from us (expanded only) ── */}
          {!collapsed && (
            <>
              <div
                className="mx-3 my-2 h-px flex-shrink-0"
                style={{ backgroundColor: "var(--border-subtle)" }}
              />
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

      {/* ── Footer: user + social ── */}
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

        {/* User info */}
        <div
          className="flex items-center gap-2 px-3 py-2"
          style={{ justifyContent: collapsed ? "center" : "flex-start" }}
        >
          <div className="relative flex-shrink-0">
            <div
              className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold transition-shadow"
              style={{
                backgroundColor: "var(--surface-4)",
                border: "1px solid var(--border-default)",
                color: "var(--text-secondary)",
                transitionDuration: "var(--duration-fast)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = "0 0 0 2px var(--lime-9)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              {user?.email?.[0]?.toUpperCase() ?? user?.firstName?.[0]?.toUpperCase() ?? "G"}
            </div>
            {user && (
              <span
                className="absolute -bottom-0.5 -right-0.5 block h-[6px] w-[6px] rounded-full animate-glow-pulse"
                style={{
                  backgroundColor: "var(--lime-9)",
                  boxShadow: "0 0 6px rgba(230, 255, 42, 0.4)",
                }}
              />
            )}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p
                className="truncate text-[11px] font-medium"
                style={{ color: "var(--text-secondary)" }}
              >
                {user?.email ?? "Guest"}
              </p>
              {user && (
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
              )}
            </div>
          )}
        </div>
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
    color: active ? "var(--lime-9)" : "var(--text-tertiary)",
    backgroundColor: active ? "var(--accent-subtle)" : "transparent",
    transition: `background-color var(--duration-instant), color var(--duration-instant), border-color var(--duration-instant), box-shadow var(--duration-instant)`,
    borderLeft: active ? "3px solid var(--lime-9)" : "3px solid transparent",
    boxShadow: active ? "-4px 0 12px rgba(230, 255, 42, 0.15)" : "none",
    cursor: "pointer",
  };

  const handleMouseEnter = (e: React.MouseEvent<HTMLElement>) => {
    if (!active) {
      e.currentTarget.style.backgroundColor = "var(--surface-2)";
      e.currentTarget.style.color = "var(--text-secondary)";
    }
  };
  const handleMouseLeave = (e: React.MouseEvent<HTMLElement>) => {
    if (!active) {
      e.currentTarget.style.backgroundColor = "transparent";
      e.currentTarget.style.color = "var(--text-tertiary)";
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

function TagItem({
  label,
  count,
  active,
  collapsed,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-lg text-left transition-all"
      style={{
        padding: collapsed ? "5px 8px" : "4px 8px",
        justifyContent: collapsed ? "center" : "space-between",
        color: active ? "var(--lime-9)" : "var(--text-secondary)",
        backgroundColor: active ? "var(--accent-subtle)" : "transparent",
        borderLeft: active ? "2px solid var(--lime-9)" : "2px solid transparent",
        transitionDuration: "var(--duration-fast)",
        minWidth: 0,
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.backgroundColor = "var(--surface-2)";
          e.currentTarget.style.color = "var(--text-primary)";
        } else {
          e.currentTarget.style.backgroundColor = "var(--accent-glow)";
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.backgroundColor = "transparent";
          e.currentTarget.style.color = "var(--text-secondary)";
        } else {
          e.currentTarget.style.backgroundColor = "var(--accent-subtle)";
        }
      }}
      title={collapsed ? label : undefined}
    >
      {collapsed ? (
        <span
          className="flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-semibold"
          style={{
            backgroundColor: active ? "transparent" : "var(--surface-3)",
            color: active ? "var(--lime-9)" : "var(--text-ghost)",
          }}
        >
          {label[0]?.toUpperCase()}
        </span>
      ) : (
        <>
          <span className="truncate text-[12px] font-medium">{label}</span>
          {count !== undefined && (
            <span
              className="ml-auto flex-shrink-0 rounded-full px-1.5 py-px text-[10px] tabular-nums"
              style={{
                backgroundColor: active ? "rgba(230, 255, 42, 0.12)" : "var(--surface-3)",
                color: active ? "var(--lime-11)" : "var(--text-ghost)",
              }}
            >
              {count}
            </span>
          )}
        </>
      )}
    </button>
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
