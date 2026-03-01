"use client";

import { useMemo, useState } from "react";
import {
  Check,
  Hash,
  Home,
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
  User,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TelegramLoginButton } from "./telegram-login-button";
import { DevLoginButton } from "./dev-login-button";

interface ModelTag {
  name: string;
  usageCount: number;
}

interface User {
  email?: string | null;
  firstName?: string | null;
  username?: string | null;
  photoUrl?: string | null;
}

interface AppSidebarProps {
  modelTags: ModelTag[];
  selectedModelName: string | null;
  onModelSelect: (name: string | null) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onUploadClick: () => void;
  user?: User | null;
  onSignOut?: () => void;
  imageCount?: number;
}

const SECTION_LABEL_STYLE: React.CSSProperties = {
  fontSize: "10px",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.22em",
  fontFamily: "var(--font-mono)",
  color: "var(--text-tertiary)",
  lineHeight: 1.4,
};

const MODEL_SHOW_LIMIT = 8;

export function AppSidebar({
  modelTags,
  selectedModelName,
  onModelSelect,
  collapsed,
  onCollapsedChange,
  onUploadClick,
  user,
  onSignOut,
  imageCount,
}: AppSidebarProps) {
  const pathname = usePathname();
  const [showAllModels, setShowAllModels] = useState(false);

  const isGalleryActive = pathname === "/";
  const sidebarWidth = collapsed
    ? "var(--sidebar-collapsed-width)"
    : "var(--sidebar-width)";

  const sortedModels = useMemo(
    () =>
      [...modelTags]
        .sort((a, b) => {
          const usageDiff = b.usageCount - a.usageCount;
          if (usageDiff !== 0) return usageDiff;
          return a.name.localeCompare(b.name);
        }),
    [modelTags],
  );

  const visibleModels = showAllModels
    ? sortedModels
    : sortedModels.slice(0, MODEL_SHOW_LIMIT);

  const focusTopTagSystem = () => {
    if (typeof window === "undefined") return;
    const target = document.getElementById("top-tag-system");
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <aside
      className="fixed left-0 top-0 z-40 flex h-dvh flex-col overflow-hidden border-r"
      style={{
        width: sidebarWidth,
        background:
          "linear-gradient(180deg, var(--paper) 0%, #fff7f0 55%, #fff3ea 100%)",
        borderColor: "var(--border-default)",
        transition: `width var(--duration-normal) cubic-bezier(0.16, 1, 0.3, 1)`,
      }}
    >
      <div
        className="flex flex-shrink-0 items-center border-b"
        style={{
          height: "52px",
          borderColor: "var(--border-subtle)",
          padding: "0 12px",
          justifyContent: collapsed ? "center" : "space-between",
        }}
      >
        {!collapsed && (
          <div className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rotate-45 rounded-[2px]"
              style={{ backgroundColor: "var(--ink)" }}
            />
            <span
              className="select-none"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "17px",
                color: "var(--text-primary)",
                letterSpacing: "-0.01em",
              }}
            >
              laniameda <span style={{ fontStyle: "italic", opacity: 0.8 }}>Gallery</span>
            </span>
          </div>
        )}

        {!collapsed && (
          <button
            type="button"
            onClick={() => onCollapsedChange(true)}
            className="interactive-ghost flex h-7 w-7 items-center justify-center rounded-md"
            style={{ color: "var(--text-ghost)" }}
            aria-label="Collapse sidebar"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}

        {collapsed && (
          <button
            type="button"
            onClick={() => onCollapsedChange(false)}
            className="absolute -right-3 top-[64px] flex h-6 w-6 items-center justify-center rounded-full border hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)]"
            style={{
              backgroundColor: "var(--surface-1)",
              borderColor: "var(--border-default)",
              color: "var(--text-secondary)",
              transitionDuration: "var(--duration-instant)",
              transitionProperty: "background-color, border-color",
              zIndex: 1,
            }}
            aria-label="Expand sidebar"
          >
            <ChevronRight className="h-3 w-3" />
          </button>
        )}
      </div>

      <ScrollArea className="flex-1 overflow-hidden">
        <div className="flex flex-col gap-1 py-3">
          <div className="flex flex-col gap-0.5 px-2">
            <NavItem
              icon={Home}
              label="Home"
              href="/"
              active={isGalleryActive}
              collapsed={collapsed}
            />
            <NavItem
              icon={Search}
              label="Search"
              href="#"
              active={false}
              collapsed={collapsed}
              onClick={focusTopTagSystem}
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

          <div className="mx-3 my-1 h-px" style={{ backgroundColor: "var(--border-subtle)" }} />

          {!collapsed && (
            <>
              <div className="px-3 pb-1">
                <div className="flex items-center justify-between">
                  <p style={SECTION_LABEL_STYLE}>Categories</p>
                  {selectedModelName && (
                    <button
                      type="button"
                      onClick={() => onModelSelect(null)}
                      className="text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors duration-[var(--duration-instant)] hover:text-[var(--text-secondary)]"
                      style={{ color: "var(--text-ghost)", fontFamily: "var(--font-mono)" }}
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              <div className="px-2">
                <div
                  className="flex w-full items-center gap-2 px-2 py-1.5"
                  style={{
                    color: "var(--text-secondary)",
                  }}
                >
                  <Hash className="h-3.5 w-3.5" />
                  <span className="text-[13px] font-medium">Models</span>
                  <span
                    className="ml-auto rounded-md border px-1.5 py-px text-[10px] tabular-nums"
                    style={{
                      borderColor: "var(--border-default)",
                      color: "var(--text-tertiary)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {modelTags.length}
                  </span>
                </div>
              </div>

              <div className="px-2">
                <TagRow
                  label="All models"
                  count={modelTags.length}
                  active={selectedModelName === null}
                  onClick={() => onModelSelect(null)}
                />
                {visibleModels.map((model) => (
                  <TagRow
                    key={model.name}
                    label={model.name}
                    count={model.usageCount}
                    active={selectedModelName === model.name}
                    onClick={() =>
                      onModelSelect(selectedModelName === model.name ? null : model.name)
                    }
                  />
                ))}
                {sortedModels.length > MODEL_SHOW_LIMIT && (
                  <button
                    type="button"
                    onClick={() => setShowAllModels(!showAllModels)}
                    className="interactive-ghost mt-1 flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium"
                    style={{
                      color: "var(--text-ghost)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {showAllModels ? (
                      <>
                        <ChevronLeft className="h-3 w-3 rotate-90" />
                        Show less
                      </>
                    ) : (
                      <>
                        Show {sortedModels.length - MODEL_SHOW_LIMIT} more
                        <ChevronRight className="h-3 w-3 rotate-90" />
                      </>
                    )}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </ScrollArea>

      <div className="border-t px-3 py-3" style={{ borderColor: "var(--border-subtle)" }}>
        {!collapsed && (
          <div
            className="mb-3 border px-3 py-2.5"
            style={{
              borderColor: "var(--border-strong)",
              background: "var(--surface-1)",
            }}
          >
            <p
              className="font-mono text-[9px] font-medium uppercase tracking-[0.2em]"
              style={{ color: "var(--text-tertiary)" }}
            >
              Vault Stats
            </p>
            <div className="mt-1.5 flex items-center gap-3">
              <span className="font-mono text-[11px] tabular-nums" style={{ color: "var(--text-primary)" }}>
                {imageCount != null ? `${imageCount}` : "--"} <span className="text-[9px] uppercase tracking-wider" style={{ color: "var(--text-ghost)" }}>img</span>
              </span>
              <span className="font-mono text-[11px] tabular-nums" style={{ color: "var(--text-primary)" }}>
                {modelTags.length} <span className="text-[9px] uppercase tracking-wider" style={{ color: "var(--text-ghost)" }}>models</span>
              </span>
            </div>
          </div>
        )}

        {user ? (
          <div className="flex items-center gap-2">
            <div className="relative flex-shrink-0">
              {user.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.photoUrl}
                  alt={user.firstName ?? "User"}
                  className="h-8 w-8 rounded-full object-cover"
                  style={{ border: "1px solid var(--border-default)" }}
                />
              ) : (
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-semibold"
                  style={{
                    backgroundColor: "var(--surface-3)",
                    border: "1px solid var(--border-default)",
                    color: "var(--text-secondary)",
                  }}
                >
                  {(user.email?.[0] ?? user.firstName?.[0] ?? "U").toUpperCase()}
                </div>
              )}
              <span
                className="absolute -bottom-0.5 -right-0.5 block h-[6px] w-[6px] rounded-full"
                style={{ backgroundColor: "var(--coral)" }}
              />
            </div>

            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-semibold" style={{ color: "var(--text-primary)" }}>
                  {user.username ? `@${user.username}` : user.email ?? user.firstName ?? "User"}
                </p>
                {onSignOut && (
                  <button
                    type="button"
                    onClick={onSignOut}
                    className="text-[10px] transition-colors duration-[var(--duration-instant)] hover:text-[var(--text-secondary)]"
                    style={{ color: "var(--text-ghost)" }}
                  >
                    Sign out
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <div>
            {collapsed ? (
              <div
                className="flex h-8 w-8 items-center justify-center rounded-full"
                style={{
                  backgroundColor: "var(--surface-3)",
                  border: "1px solid var(--border-default)",
                  color: "var(--text-ghost)",
                }}
              >
                <User className="h-4 w-4" />
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <TelegramLoginButton size="small" />
                <DevLoginButton />
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

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
      {!collapsed && (
        <span
          className="block transition-opacity"
          style={{
            opacity: active ? 1 : 0,
            backgroundColor: "var(--coral)",
            boxShadow: active
              ? "0 0 0 1px rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.25)"
              : "none",
            width: "7px",
            height: "7px",
            borderRadius: "2px",
          }}
        />
      )}
      <div
        className="flex items-center justify-center rounded-[6px] border transition-colors"
        style={{
          width: "26px",
          height: "26px",
          borderRadius: "6px",
          borderColor: active
            ? "rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.35)"
            : "rgba(32, 23, 16, 0.14)",
          backgroundColor: active
            ? "rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.09)"
            : "rgba(255,255,255,0.34)",
        }}
      >
        <Icon className="h-3.5 w-3.5" />
      </div>
      {!collapsed && (
        <span
          className="truncate transition-[letter-spacing,color]"
          style={{
            fontWeight: active ? 600 : 500,
            fontSize: "11px",
            letterSpacing: active ? "0.1em" : "0.08em",
            textTransform: "uppercase",
            fontFamily: "var(--font-mono)",
          }}
        >
          {label}
        </span>
      )}
    </>
  );

  const className = [
    "nav-item flex w-full cursor-pointer items-center rounded-[6px] border px-2 py-1.5",
    "transition-[background-color,color,border-color] duration-[var(--duration-instant)]",
    active
      ? "bg-white/52 border-[rgba(var(--pillar-r),var(--pillar-g),var(--pillar-b),0.3)] text-[var(--text-primary)]"
      : "border-transparent text-[var(--text-secondary)] hover:bg-white/42 hover:text-[var(--text-primary)]",
    collapsed ? "justify-center gap-0" : "justify-start gap-[9px]",
  ].join(" ");

  if (onClick) {
    return (
      <button
        type="button"
        className={className}
        onClick={onClick}
        title={collapsed ? label : undefined}
      >
        {inner}
      </button>
    );
  }

  return (
    <Link
      href={href}
      className={className}
      title={collapsed ? label : undefined}
    >
      {inner}
    </Link>
  );
}

function TagRow({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  const rowClassName = [
    "group mb-0.5 flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left border",
    "transition-[background-color,color,border-color] duration-[var(--duration-instant)] active:scale-[0.98]",
    active
      ? "bg-white/62 border-[rgba(var(--pillar-r),var(--pillar-g),var(--pillar-b),0.32)] text-[var(--text-primary)] hover:bg-white/74"
      : "bg-transparent border-transparent text-[var(--text-secondary)] hover:bg-white/42 hover:border-[rgba(32,23,16,0.18)] hover:text-[var(--text-primary)]",
  ].join(" ");

  return (
    <button
      type="button"
      onClick={onClick}
      className={rowClassName}
    >
      <span
        className="flex items-center justify-center border transition-colors"
        style={{
          width: "14px",
          height: "14px",
          borderRadius: "2px",
          borderColor: active ? "var(--coral)" : "var(--border-default)",
          backgroundColor: active
            ? "rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.94)"
            : "transparent",
        }}
      >
        {active && (
          <Check className="h-[10px] w-[10px]" style={{ color: "#fff" }} />
        )}
      </span>
      <span
        className="truncate"
        style={{
          fontWeight: active ? 600 : 500,
          fontSize: "11px",
          letterSpacing: "0.08em",
          fontFamily: "var(--font-mono)",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      {count !== undefined && (
        <span
          className="ml-auto border px-1.5 py-[1px] text-[10px] tabular-nums"
          style={{
            borderColor: active
              ? "rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.4)"
              : "var(--border-default)",
            backgroundColor: active ? "rgba(255,255,255,0.86)" : "rgba(255,255,255,0.5)",
            color: active ? "var(--text-primary)" : "var(--text-tertiary)",
            fontFamily: "var(--font-mono)",
            borderRadius: "4px",
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}
