"use client";

import Image from "next/image";

import { useMemo } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Film,
  FolderOpen,
  Home,
  Plus,
  Search,
  LayoutGrid,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
  count?: number;
}

type GalleryScope = "mine" | "public";

interface GallerySidebarProps {
  modelTags: ModelTag[];
  hideModelsSection?: boolean;
  selectedModelName: string | null;
  onModelSelect: (name: string | null) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onUploadClick: () => void;
  onSeedanceClick?: () => void;
  user?: User | null;
  onSignOut?: () => void;
  imageCount?: number;
  folders?: Folder[];
  selectedFolderId?: string | null;
  onFolderSelect?: (folderId: string | null) => void;
  galleryScope?: GalleryScope;
}

export function GallerySidebar({
  modelTags,
  hideModelsSection = false,
  selectedModelName,
  onModelSelect,
  collapsed,
  onCollapsedChange,
  onUploadClick,
  onSeedanceClick,
  user,
  onSignOut,
  imageCount,
  folders = [],
  selectedFolderId,
  onFolderSelect,
  galleryScope,
}: GallerySidebarProps) {
  const pathname = usePathname();
  const isGalleryActive = pathname === "/";

  const sidebarWidth = collapsed
    ? "var(--lm-sidebar-collapsed)"
    : "var(--lm-sidebar-width)";

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
    const target = document.getElementById("gallery-filter-bar");
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <aside
      className="lm-liquid-glass-sidebar fixed left-0 top-0 z-40 flex h-dvh flex-col overflow-hidden"
      style={{
        width: sidebarWidth,
        transition: `width var(--lm-duration-normal) ease-out`,
        fontFamily: "var(--lm-font)",
      }}
    >
      {/* Header: Logo */}
      <div
        className="flex flex-shrink-0 items-center"
        style={{
          height: "60px",
          padding: collapsed ? "0" : "0 18px",
          justifyContent: collapsed ? "center" : "space-between",
          borderBottom: "1px solid var(--lm-sidebar-divider)",
        }}
      >
        {!collapsed && (
          <div className="flex select-none items-center gap-0">
            <span className="lm-glass-logo-letter">LANIA</span>
            <span
              className="mx-1.5 inline-block"
              style={{
                width: "7px",
                height: "7px",
                background:
                  "linear-gradient(135deg, var(--lm-coral) 0%, rgba(255, 122, 100, 0.65) 100%)",
                transform: "rotate(45deg)",
                flexShrink: 0,
                boxShadow: "0 0 8px rgba(255, 122, 100, 0.45)",
                borderRadius: "1px",
              }}
            />
            <span className="lm-glass-logo-letter">MEDA</span>
          </div>
        )}

        {collapsed && (
          <span
            style={{
              width: "10px",
              height: "10px",
              background:
                "linear-gradient(135deg, var(--lm-coral) 0%, rgba(255, 122, 100, 0.65) 100%)",
              transform: "rotate(45deg)",
              flexShrink: 0,
              boxShadow: "0 0 10px rgba(255, 122, 100, 0.5)",
              borderRadius: "1px",
            }}
          />
        )}

        {!collapsed && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onCollapsedChange(true)}
              className="lm-glass-icon-btn"
              aria-label="Collapse sidebar"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Expand toggle (collapsed) — floating glass chip */}
      {collapsed && (
        <button
          type="button"
          onClick={() => onCollapsedChange(false)}
          className="absolute -right-3.5 top-[64px] flex items-center justify-center z-10 transition-all"
          style={{
            width: "26px",
            height: "26px",
            background:
              "linear-gradient(180deg, rgba(255, 255, 255, 0.95) 0%, rgba(255, 255, 255, 0.78) 100%)",
            border: "1px solid rgba(255, 122, 100, 0.45)",
            borderRadius: "999px",
            color: "var(--lm-coral)",
            backdropFilter: "blur(10px) saturate(180%)",
            WebkitBackdropFilter: "blur(10px) saturate(180%)",
            boxShadow:
              "inset 0 1px 0 rgba(255, 255, 255, 0.9), 0 2px 8px rgba(255, 122, 100, 0.18), 0 4px 16px rgba(32, 23, 16, 0.08)",
          }}
          aria-label="Expand sidebar"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Navigation */}
      <div
        className="flex flex-col py-1"
        style={{ borderBottom: "1px solid var(--lm-sidebar-divider)" }}
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
        {onSeedanceClick && (
          <NavItem
            icon={Film}
            label="Seedance"
            href="#"
            active={false}
            collapsed={collapsed}
            onClick={onSeedanceClick}
          />
        )}
      </div>

      {/* Scrollable content */}
      <ScrollArea className="flex-1">
        {!collapsed && (
          <div className="flex flex-col">
            {/* Folders */}
            {galleryScope === "mine" && folders.length > 0 && onFolderSelect && (
              <div style={{ borderBottom: "1px solid var(--lm-sidebar-divider)" }}>
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span
                    style={{
                      fontSize: "8px",
                      fontWeight: 800,
                      textTransform: "uppercase",
                      letterSpacing: "0.20em",
                      color: "var(--lm-sidebar-text-ghost)",
                    }}
                  >
                    COLLECTIONS
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
                        color: "var(--lm-coral)",
                      }}
                    >
                      CLEAR
                    </button>
                  )}
                </div>
                <FilterRow
                  icon={FolderOpen}
                  label="All collections"
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
                    count={folder.count}
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

            {/* Models — suppressed entirely when hideModelsSection (e.g. cinema pillar) */}
            {!hideModelsSection && sortedModels.length > 0 && (
              <div style={{ borderBottom: "1px solid var(--lm-sidebar-divider)" }}>
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span
                    style={{
                      fontSize: "8px",
                      fontWeight: 800,
                      textTransform: "uppercase",
                      letterSpacing: "0.20em",
                      color: "var(--lm-sidebar-text-ghost)",
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
                        color: "var(--lm-coral)",
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
            style={{ borderTop: "1px solid var(--lm-sidebar-divider)" }}
          >
            <div
              className="px-4 py-3"
              style={{ borderRight: "1px solid var(--lm-sidebar-divider)" }}
            >
              <p
                style={{
                  fontSize: "28px",
                  fontWeight: 900,
                  color: "var(--lm-sidebar-text)",
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
                  color: "var(--lm-sidebar-text-ghost)",
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
                  color: "var(--lm-sidebar-text)",
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
                  color: "var(--lm-sidebar-text-ghost)",
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
            style={{ borderTop: "1px solid var(--lm-sidebar-divider)" }}
          >
            <p
              style={{
                fontSize: "18px",
                fontWeight: 900,
                color: "var(--lm-sidebar-text)",
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
                color: "var(--lm-sidebar-text-ghost)",
              }}
            >
              IMG
            </p>
          </div>
        )}

        {/* Profile */}
        <div
          className="px-3 py-3"
          style={{ borderTop: "1px solid var(--lm-sidebar-divider)" }}
        >
          {user ? (
            collapsed ? (
              <div className="flex justify-center">
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    backgroundColor: "var(--lm-success)",
                    borderRadius: "var(--lm-radius)",
                  }}
                />
              </div>
            ) : (
              <div className="flex items-center gap-2.5">
                {user.photoUrl ? (
                  <Image
                    src={user.photoUrl}
                    alt=""
                    width={28}
                    height={28}
                    unoptimized
                    style={{
                      borderRadius: "999px",
                      objectFit: "cover",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: "28px",
                      height: "28px",
                      backgroundColor: "transparent",
                      border: "1px solid var(--lm-sidebar-glass-border)",
                      borderRadius: "999px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "11px",
                      fontWeight: 900,
                      color: "var(--lm-sidebar-text)",
                    }}
                  >
                    {(user.firstName ?? user.username ?? "U").charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="flex min-w-0 flex-1 flex-col">
                  <span
                    className="truncate"
                    style={{
                      fontSize: "10px",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.10em",
                      color: "var(--lm-sidebar-text)",
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
                      color: "var(--lm-success)",
                    }}
                  >
                    ONLINE
                  </span>
                </div>
                {onSignOut && (
                  <button
                    type="button"
                    onClick={onSignOut}
                    aria-label="Sign out"
                    title="Sign out"
                    className="lm-sidebar-text-link shrink-0"
                  >
                    sign out
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
                  backgroundColor: "var(--lm-sidebar-text-ghost)",
                  borderRadius: "var(--lm-radius)",
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
  const inner = (
    <div
      className="flex w-full items-center"
      style={{
        padding: collapsed ? "12px 0" : "11px 16px",
        justifyContent: collapsed ? "center" : "flex-start",
        gap: collapsed ? "0" : "12px",
      }}
    >
      <Icon
        className="h-4 w-4 flex-shrink-0"
        style={{
          color: active
            ? "var(--lm-coral)"
            : "var(--lm-sidebar-text-ghost)",
          transition: "color var(--lm-duration-fast) ease-out",
        }}
      />
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

  const sharedClass = "lm-glass-nav-item cursor-pointer";

  if (onClick) {
    return (
      <button
        type="button"
        className={sharedClass}
        data-active={active ? "true" : "false"}
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
      className={`${sharedClass} block`}
      data-active={active ? "true" : "false"}
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
      className="lm-glass-filter-row cursor-pointer"
      data-active={active ? "true" : "false"}
    >
      {Icon ? (
        <Icon
          className="h-3 w-3 flex-shrink-0"
          style={{
            color: active
              ? "var(--lm-coral)"
              : "var(--lm-sidebar-text-ghost)",
            transition: "color var(--lm-duration-fast)",
          }}
        />
      ) : null}
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
              ? "var(--lm-coral)"
              : "var(--lm-sidebar-text-ghost)",
            fontWeight: 700,
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}
