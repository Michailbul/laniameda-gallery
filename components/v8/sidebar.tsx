"use client";

import Image from "next/image";

import { useMemo } from "react";
import {
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Home,
  LogOut,
  Plus,
  Search,
  LayoutGrid,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Switch as FramerMotionSwitch } from "@/components/ui/framer-motion-switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TelegramLoginButton } from "@/components/telegram-login-button";

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

interface Folder {
  _id: string;
  name: string;
}

type GalleryScope = "mine" | "public";

interface V72SidebarProps {
  modelTags: ModelTag[];
  selectedModelName: string | null;
  onModelSelect: (name: string | null) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onUploadClick: () => void;
  user?: User | null;
  onSignOut?: () => void;
  imageCount?: number;
  folders?: Folder[];
  selectedFolderId?: string | null;
  onFolderSelect?: (folderId: string | null) => void;
  galleryScope?: GalleryScope;
  theme?: "light" | "dark" | "system";
  onThemeChange?: (theme: "light" | "dark" | "system") => void;
}

export function V72Sidebar({
  modelTags,
  selectedModelName,
  onModelSelect,
  collapsed,
  onCollapsedChange,
  onUploadClick,
  user,
  onSignOut,
  imageCount,
  folders = [],
  selectedFolderId,
  onFolderSelect,
  galleryScope,
  theme = "system",
  onThemeChange,
}: V72SidebarProps) {
  const pathname = usePathname();
  const isGalleryActive = pathname === "/";

  const sidebarWidth = collapsed
    ? "var(--v7-sidebar-collapsed)"
    : "var(--v7-sidebar-width)";

  const sortedModels = useMemo(
    () =>
      [...modelTags].sort((a, b) => {
        const usageDiff = b.usageCount - a.usageCount;
        if (usageDiff !== 0) return usageDiff;
        return a.name.localeCompare(b.name);
      }),
    [modelTags],
  );

  const focusFilterBar = () => {
    if (typeof window === "undefined") return;
    const target = document.getElementById("v8-filter-bar");
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <aside
      className="fixed left-0 top-0 z-40 flex h-dvh flex-col overflow-hidden"
      style={{
        width: sidebarWidth,
        backgroundColor: "color-mix(in srgb, var(--v7-sidebar-bg) 75%, transparent)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderRight: "3px solid var(--v7-coral)",
        transition: `width var(--v7-duration-normal) ease-out`,
        fontFamily: "var(--v7-font)",
      }}
    >
      {/* Header: Logo */}
      <div
        className="flex flex-shrink-0 items-center"
        style={{
          height: "56px",
          padding: collapsed ? "0" : "0 16px",
          justifyContent: collapsed ? "center" : "space-between",
          borderBottom: "2px solid var(--v7-sidebar-border)",
        }}
      >
        {!collapsed && (
          <div className="flex select-none items-center gap-0">
            <span
              style={{
                fontSize: "14px",
                fontWeight: 900,
                textTransform: "uppercase",
                letterSpacing: "0.18em",
                color: "var(--v7-sidebar-text)",
                textShadow: "2px 2px 0 rgba(255, 122, 100, 0.25)",
              }}
            >
              LANIA
            </span>
            <span
              className="mx-1 inline-block"
              style={{
                width: "8px",
                height: "8px",
                backgroundColor: "var(--v7-coral)",
                transform: "rotate(45deg)",
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: "14px",
                fontWeight: 900,
                textTransform: "uppercase",
                letterSpacing: "0.18em",
                color: "var(--v7-sidebar-text)",
                textShadow: "2px 2px 0 rgba(255, 122, 100, 0.25)",
              }}
            >
              MEDA
            </span>
          </div>
        )}

        {collapsed && (
          <span
            style={{
              width: "10px",
              height: "10px",
              backgroundColor: "var(--v7-coral)",
              transform: "rotate(45deg)",
              flexShrink: 0,
            }}
          />
        )}

        {!collapsed && (
          <div className="flex items-center gap-1.5">
            {onThemeChange && (
              <FramerMotionSwitch
                checked={theme === "dark"}
                setChecked={(checked) => onThemeChange(checked ? "dark" : "light")}
                className="shrink-0"
              />
            )}
            <button
              type="button"
              onClick={() => onCollapsedChange(true)}
              className="flex items-center justify-center transition-colors"
              style={{
                width: "24px",
                height: "24px",
                color: "var(--v7-sidebar-text-ghost)",
                border: "2px solid var(--v7-sidebar-border)",
                borderRadius: "var(--v7-radius)",
              }}
              aria-label="Collapse sidebar"
            >
              <ChevronLeft className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      {/* Expand toggle (collapsed) */}
      {collapsed && (
        <button
          type="button"
          onClick={() => onCollapsedChange(false)}
          className="absolute -right-3 top-[64px] flex items-center justify-center transition-all z-10"
          style={{
            width: "24px",
            height: "24px",
            backgroundColor: "var(--v7-sidebar-bg)",
            border: "2px solid var(--v7-coral)",
            borderRadius: "var(--v7-radius)",
            color: "var(--v7-coral)",
          }}
          aria-label="Expand sidebar"
        >
          <ChevronRight className="h-3 w-3" />
        </button>
      )}

      {/* Navigation */}
      <div
        className="flex flex-col"
        style={{ borderBottom: "2px solid var(--v7-sidebar-border)" }}
      >
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
          active={false}
          collapsed={collapsed}
          onClick={focusFilterBar}
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

      {/* Scrollable content */}
      <ScrollArea className="flex-1">
        {!collapsed && (
          <div className="flex flex-col">
            {/* Folders */}
            {galleryScope === "mine" && folders.length > 0 && onFolderSelect && (
              <div style={{ borderBottom: "2px solid var(--v7-sidebar-border)" }}>
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span
                    style={{
                      fontSize: "8px",
                      fontWeight: 800,
                      textTransform: "uppercase",
                      letterSpacing: "0.20em",
                      color: "var(--v7-sidebar-text-ghost)",
                    }}
                  >
                    FOLDERS
                  </span>
                  {selectedFolderId && (
                    <button
                      type="button"
                      onClick={() => onFolderSelect(null)}
                      style={{
                        fontSize: "8px",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.12em",
                        color: "var(--v7-coral)",
                      }}
                    >
                      CLEAR
                    </button>
                  )}
                </div>
                <FilterRow
                  icon={FolderOpen}
                  label="All folders"
                  active={
                    selectedFolderId === null ||
                    selectedFolderId === undefined
                  }
                  onClick={() => onFolderSelect(null)}
                />
                {folders.map((folder) => (
                  <FilterRow
                    key={folder._id}
                    label={folder.name}
                    active={selectedFolderId === folder._id}
                    onClick={() =>
                      onFolderSelect(
                        selectedFolderId === folder._id ? null : folder._id,
                      )
                    }
                  />
                ))}
              </div>
            )}

            {/* Models */}
            {sortedModels.length > 0 && (
              <div style={{ borderBottom: "2px solid var(--v7-sidebar-border)" }}>
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span
                    style={{
                      fontSize: "8px",
                      fontWeight: 800,
                      textTransform: "uppercase",
                      letterSpacing: "0.20em",
                      color: "var(--v7-sidebar-text-ghost)",
                    }}
                  >
                    MODELS
                  </span>
                  {selectedModelName && (
                    <button
                      type="button"
                      onClick={() => onModelSelect(null)}
                      style={{
                        fontSize: "8px",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.12em",
                        color: "var(--v7-coral)",
                      }}
                    >
                      CLEAR
                    </button>
                  )}
                </div>
                <FilterRow
                  icon={LayoutGrid}
                  label="All models"
                  active={selectedModelName === null}
                  onClick={() => onModelSelect(null)}
                />
                {sortedModels.map((model) => (
                  <FilterRow
                    key={model.name}
                    label={model.name}
                    count={model.usageCount}
                    active={selectedModelName === model.name}
                    onClick={() =>
                      onModelSelect(
                        selectedModelName === model.name ? null : model.name,
                      )
                    }
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      {/* Bottom: Stats + Profile */}
      <div className="flex flex-col mt-auto">
        {/* Stats grid */}
        {!collapsed && (
          <div
            className="grid grid-cols-2"
            style={{ borderTop: "3px solid var(--v7-sidebar-border)" }}
          >
            <div
              className="px-4 py-3"
              style={{ borderRight: "2px solid var(--v7-sidebar-border)" }}
            >
              <p
                style={{
                  fontSize: "28px",
                  fontWeight: 900,
                  color: "var(--v7-sidebar-text)",
                  lineHeight: 1,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {imageCount != null ? imageCount : "--"}
              </p>
              <p
                className="mt-1"
                style={{
                  fontSize: "8px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.20em",
                  color: "var(--v7-sidebar-text-ghost)",
                }}
              >
                IMAGES
              </p>
            </div>
            <div className="px-4 py-3">
              <p
                style={{
                  fontSize: "28px",
                  fontWeight: 900,
                  color: "var(--v7-sidebar-text)",
                  lineHeight: 1,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {modelTags.length}
              </p>
              <p
                className="mt-1"
                style={{
                  fontSize: "8px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.20em",
                  color: "var(--v7-sidebar-text-ghost)",
                }}
              >
                MODELS
              </p>
            </div>
          </div>
        )}

        {/* Collapsed stats */}
        {collapsed && (
          <div
            className="flex flex-col items-center px-1 py-3"
            style={{ borderTop: "3px solid var(--v7-sidebar-border)" }}
          >
            <p
              style={{
                fontSize: "18px",
                fontWeight: 900,
                color: "var(--v7-sidebar-text)",
                lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {imageCount != null ? imageCount : "--"}
            </p>
            <p
              className="mt-0.5"
              style={{
                fontSize: "7px",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.14em",
                color: "var(--v7-sidebar-text-ghost)",
              }}
            >
              IMG
            </p>
          </div>
        )}

        {/* Profile */}
        <div
          className="px-3 py-3"
          style={{ borderTop: "2px solid var(--v7-sidebar-border)" }}
        >
          {user ? (
            collapsed ? (
              <div className="flex justify-center">
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    backgroundColor: "var(--v7-success)",
                    borderRadius: "var(--v7-radius)",
                  }}
                />
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2.5">
                  {user.photoUrl ? (
                    <Image
                      src={user.photoUrl}
                      alt=""
                      width={28}
                      height={28}
                      unoptimized
                      style={{
                        border: "2px solid var(--v7-sidebar-border)",
                        borderRadius: "var(--v7-radius)",
                        objectFit: "cover",
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: "28px",
                        height: "28px",
                        backgroundColor: "var(--v7-sidebar-surface)",
                        border: "2px solid var(--v7-sidebar-border)",
                        borderRadius: "var(--v7-radius)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "10px",
                        fontWeight: 900,
                        color: "var(--v7-coral)",
                      }}
                    >
                      {(user.firstName ?? user.username ?? "U").charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="flex flex-col min-w-0">
                    <span
                      className="truncate"
                      style={{
                        fontSize: "10px",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.10em",
                        color: "var(--v7-sidebar-text)",
                      }}
                    >
                      {user.username
                        ? `@${user.username}`
                        : user.email ?? user.firstName ?? "USER"}
                    </span>
                    <span
                      style={{
                        fontSize: "8px",
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.12em",
                        color: "var(--v7-success)",
                      }}
                    >
                      ONLINE
                    </span>
                  </div>
                </div>
                {onSignOut && (
                  <button
                    type="button"
                    onClick={onSignOut}
                    className="flex w-full items-center gap-2 px-2 py-1.5 transition-colors"
                    style={{
                      fontSize: "9px",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.12em",
                      color: "var(--v7-sidebar-text-ghost)",
                      border: "1px solid var(--v7-sidebar-border)",
                      borderRadius: "var(--v7-radius)",
                    }}
                  >
                    <LogOut className="h-3 w-3" />
                    SIGN OUT
                  </button>
                )}
              </div>
            )
          ) : collapsed ? (
            <div className="flex justify-center">
              <span
                style={{
                  width: "8px",
                  height: "8px",
                  backgroundColor: "var(--v7-sidebar-text-ghost)",
                  borderRadius: "var(--v7-radius)",
                }}
              />
            </div>
          ) : (
            <TelegramLoginButton size="small" />
          )}
        </div>
      </div>
    </aside>
  );
}

/* Nav Item */

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
  const style: React.CSSProperties = {
    borderLeft: active
      ? "4px solid var(--v7-coral)"
      : "4px solid transparent",
    backgroundColor: active
      ? "var(--v7-sidebar-surface)"
      : "transparent",
    color: active
      ? "var(--v7-sidebar-text)"
      : "var(--v7-sidebar-text-muted)",
    transition: "all var(--v7-duration-fast)",
  };

  const inner = (
    <div
      className="flex w-full items-center"
      style={{
        padding: collapsed ? "12px 0" : "12px 16px",
        justifyContent: collapsed ? "center" : "flex-start",
        gap: collapsed ? "0" : "12px",
      }}
    >
      <Icon className="h-4 w-4 flex-shrink-0" />
      {!collapsed && (
        <span
          style={{
            fontSize: "10px",
            fontWeight: active ? 800 : 600,
            textTransform: "uppercase",
            letterSpacing: "0.16em",
          }}
        >
          {label}
        </span>
      )}
    </div>
  );

  const hoverStyle =
    "hover:bg-[var(--v7-sidebar-surface-hover)] hover:text-[var(--v7-sidebar-text)]";

  if (onClick) {
    return (
      <button
        type="button"
        className={`w-full ${hoverStyle}`}
        style={style}
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
      className={`w-full block ${hoverStyle}`}
      style={style}
      title={collapsed ? label : undefined}
    >
      {inner}
    </Link>
  );
}

/* Filter Row */

function FilterRow({
  icon: Icon,
  label,
  count,
  active,
  onClick,
}: {
  icon?: React.ElementType;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-4 py-1.5 transition-colors hover:bg-[var(--v7-sidebar-surface-hover)]"
      style={{
        backgroundColor: active
          ? "var(--v7-sidebar-surface)"
          : "transparent",
        color: active
          ? "var(--v7-sidebar-text)"
          : "var(--v7-sidebar-text-muted)",
      }}
    >
      {Icon ? (
        <Icon
          className="h-3 w-3 flex-shrink-0"
          style={{
            color: active
              ? "var(--v7-coral)"
              : "var(--v7-sidebar-text-ghost)",
          }}
        />
      ) : (
        <span className="flex h-3 w-3 flex-shrink-0 items-center justify-center">
          <span
            style={{
              width: active ? "8px" : "4px",
              height: active ? "8px" : "4px",
              backgroundColor: active
                ? "var(--v7-coral)"
                : "var(--v7-sidebar-text-ghost)",
              borderRadius: "var(--v7-radius)",
              transition: "all var(--v7-duration-fast)",
            }}
          />
        </span>
      )}
      <span
        className="min-w-0 flex-1 truncate text-left"
        style={{
          fontSize: "10px",
          fontWeight: active ? 700 : 500,
          textTransform: "uppercase",
          letterSpacing: "0.10em",
        }}
      >
        {label}
      </span>
      {count !== undefined && (
        <span
          style={{
            fontSize: "9px",
            fontVariantNumeric: "tabular-nums",
            color: active
              ? "var(--v7-sidebar-text-muted)"
              : "var(--v7-sidebar-text-ghost)",
            fontWeight: 700,
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}
