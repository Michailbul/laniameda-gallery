"use client";

import {
  AutoConversationsIcon,
  Camera01Icon,
  ComputerIcon,
  FilterHorizontalIcon,
  Mic01Icon,
  Moon02Icon,
  Notification03Icon,
  PencilEdit02Icon,
  PlusSignIcon,
  Search01Icon,
  Sun03Icon,
  UserEdit01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import useMeasure from "react-use-measure";
import { TelegramLoginButton } from "@/components/telegram-login-button";
import { cn } from "@/lib/utils";

type MenuView =
  | "default"
  | "home"
  | "search"
  | "notifications"
  | "profile"
  | "theme";

type ThemeOption = "light" | "dark" | "system";

interface BottomMenuUser {
  firstName?: string | null;
  email?: string | null;
  photoUrl?: string | null;
  username?: string | null;
}

interface BottomMenuProps {
  className?: string;
  user?: BottomMenuUser | null;
  onAddClick?: () => void;
  onHomeClick?: () => void;
  onResetClick?: () => void;
  onSignOut?: () => void;
  searchValue?: string;
  onSearchChange?: (query: string) => void;
  onSearchClear?: () => void;
  searchPlaceholder?: string;
  searchLoading?: boolean;
  theme?: ThemeOption;
  onThemeChange?: (theme: ThemeOption) => void;
  notificationTypes?: string[];
}

const MAIN_NAV = [
  { icon: PlusSignIcon, name: "home" },
  { icon: Search01Icon, name: "search" },
  { icon: Notification03Icon, name: "notifications" },
  { icon: UserEdit01Icon, name: "profile" },
  { icon: Sun03Icon, name: "theme" },
] as const satisfies ReadonlyArray<{
  icon: typeof PlusSignIcon;
  name: Exclude<MenuView, "default">;
}>;

const THEME_OPTIONS = [
  { key: "light", icon: Sun03Icon, text: "Light" },
  { key: "dark", icon: Moon02Icon, text: "Dark" },
  { key: "system", icon: ComputerIcon, text: "System" },
] as const satisfies ReadonlyArray<{
  key: ThemeOption;
  icon: typeof Sun03Icon;
  text: string;
}>;

const DEFAULT_NOTIFICATIONS = ["Messages", "System Alerts"];

export default function BottomMenu({
  className,
  user,
  onAddClick,
  onHomeClick,
  onResetClick,
  onSignOut,
  searchValue = "",
  onSearchChange,
  onSearchClear,
  searchPlaceholder = "Search...",
  searchLoading = false,
  theme = "system",
  onThemeChange,
  notificationTypes = DEFAULT_NOTIFICATIONS,
}: BottomMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hiddenRef, hiddenBounds] = useMeasure();
  const [view, setView] = useState<MenuView>("default");

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setView("default");
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const sharedHover =
    "group w-full rounded-[12px] px-3 py-2 text-left text-[14px] transition-all duration-75 dock-item";

  const actionItems = useMemo(
    () =>
      [
        {
          icon: PencilEdit02Icon,
          text: "Add image",
          onClick: onAddClick,
        },
        {
          icon: Camera01Icon,
          text: "Reset filters",
          onClick: onResetClick,
        },
        {
          icon: Mic01Icon,
          text: "Jump to top",
          onClick: onHomeClick,
        },
      ].filter((item) => Boolean(item.onClick)),
    [onAddClick, onHomeClick, onResetClick],
  );

  const profileName =
    user?.username?.trim()
      ? `@${user.username.trim()}`
      : user?.firstName?.trim() || user?.email?.trim() || "Guest";

  const submenu = useMemo(() => {
    switch (view) {
      case "default":
        return { content: null, measurementContent: null };

      case "home": {
        const items =
          actionItems.length > 0 ? (
            actionItems.map(({ icon, text, onClick }) => (
              <button
                key={text}
                type="button"
                className={cn(sharedHover, "flex items-center gap-3")}
                onClick={() => {
                  onClick?.();
                  setView("default");
                }}
              >
                <HugeiconsIcon
                  icon={icon}
                  size={20}
                  style={{ color: "var(--v7-text-ghost, rgba(32,23,16,0.3))", transition: "color 75ms" }}
                />
                <span className="transition-all duration-75">{text}</span>
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-[14px] text-muted-foreground">
              No quick actions available.
            </div>
          );

        const content = (
          <div className="min-w-[210px] space-y-0.5 p-[6px] py-0.5">
            {items}
          </div>
        );

        return { content, measurementContent: content };
      }

      case "search": {
        const content = (
          <div className="min-w-[270px] space-y-2 p-[8px] py-1">
            <div className="relative">
              <HugeiconsIcon
                icon={Search01Icon}
                size={17}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="text"
                value={searchValue}
                onChange={(event) => onSearchChange?.(event.target.value)}
                placeholder={searchPlaceholder}
                className="w-full rounded-[12px] py-[6px] pl-9 pr-3 text-[14px] focus:outline-none"
                style={{
                  backgroundColor: "var(--v7-surface-2, rgba(32,23,16,0.04))",
                  border: "1px solid var(--v7-border, rgba(32,23,16,0.08))",
                  color: "var(--v7-text-primary, #201710)",
                  fontFamily: "var(--v7-font, inherit)",
                }}
              />
            </div>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => {
                  onResetClick?.();
                  setView("default");
                }}
                className={cn(
                  sharedHover,
                  "flex flex-1 items-center justify-center gap-1.5",
                )}
                style={{ backgroundColor: "var(--v7-surface-2, rgba(32,23,16,0.04))" }}
                disabled={!onResetClick}
              >
                <HugeiconsIcon
                  icon={FilterHorizontalIcon}
                  size={14}
                  strokeWidth={2}
                  style={{ color: "var(--v7-text-ghost, rgba(32,23,16,0.3))" }}
                />
                <span className="transition-all duration-75">Reset</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onSearchClear?.();
                  setView("default");
                }}
                className={cn(
                  sharedHover,
                  "flex flex-1 items-center justify-center gap-1.5",
                )}
                style={{ backgroundColor: "var(--v7-surface-2, rgba(32,23,16,0.04))" }}
              >
                <HugeiconsIcon
                  icon={AutoConversationsIcon}
                  size={14}
                  strokeWidth={2}
                  style={{ color: "var(--v7-text-ghost, rgba(32,23,16,0.3))" }}
                />
                <span className="transition-all duration-75">
                  {searchLoading ? "Searching" : "Clear"}
                </span>
              </button>
            </div>
          </div>
        );

        return { content, measurementContent: content };
      }

      case "notifications": {
        const content = (
          <div className="min-w-[210px] space-y-0.5 p-[6px] py-0.5">
            {notificationTypes.map((notification) => (
              <div key={notification} className={sharedHover}>
                <span className="transition-all duration-75">
                  {notification}
                </span>
              </div>
            ))}
          </div>
        );

        return { content, measurementContent: content };
      }

      case "profile": {
        const content = user ? (
          <div className="min-w-[260px] space-y-2 p-[8px] py-1">
            <div
              className="rounded-[14px] px-3 py-3"
              style={{
                backgroundColor: "var(--v7-surface-2, rgba(32,23,16,0.04))",
                border: "1px solid var(--v7-border, rgba(32,23,16,0.08))",
              }}
            >
              <div className="flex items-center gap-3">
                {user.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={user.photoUrl}
                    alt={profileName}
                    className="h-10 w-10 rounded-full object-cover"
                  />
                ) : (
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold"
                    style={{
                      backgroundColor: "var(--v7-surface-3, rgba(32,23,16,0.06))",
                      color: "var(--v7-text-primary, #201710)",
                    }}
                  >
                    {profileName.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <p
                    className="truncate text-[14px] font-medium"
                    style={{ color: "var(--v7-text-primary, #201710)" }}
                  >
                    {profileName}
                  </p>
                  {user.email ? (
                    <p
                      className="truncate text-[12px]"
                      style={{ color: "var(--v7-text-ghost, rgba(32,23,16,0.3))" }}
                    >
                      {user.email}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
            {onSignOut ? (
              <button
                type="button"
                onClick={() => {
                  onSignOut();
                  setView("default");
                }}
                className="w-full rounded-[12px] px-3 py-2 text-left text-[14px] transition-all duration-75"
                style={{ color: "var(--v7-status-error, #dc2626)" }}
              >
                Logout
              </button>
            ) : null}
          </div>
        ) : (
          <div className="min-w-[280px] space-y-3 p-[10px]">
            <div className="px-1">
              <p className="text-[14px] font-medium" style={{ color: "var(--v7-text-primary, #201710)" }}>
                Sign in to manage your vault
              </p>
              <p className="mt-1 text-[12px]" style={{ color: "var(--v7-text-ghost, rgba(32,23,16,0.3))" }}>
                Telegram auth unlocks uploads, folders, and edits.
              </p>
            </div>
            <TelegramLoginButton size="medium" />
          </div>
        );

        const measurementContent = user ? (
          content
        ) : (
          <div className="min-w-[280px] space-y-3 p-[10px]">
            <div className="rounded-[14px] border border-border bg-muted/40 px-3 py-3">
              <div className="space-y-2">
                <div className="h-4 w-40 rounded bg-muted" />
                <div className="h-3 w-52 rounded bg-muted" />
                <div className="h-10 w-full rounded-[12px] bg-muted" />
              </div>
            </div>
          </div>
        );

        return { content, measurementContent };
      }

      case "theme": {
        const content = (
          <div className="flex min-w-[270px] items-center justify-between gap-1.5 p-[6px] py-0.5">
            {THEME_OPTIONS.map(({ key, icon, text }) => (
              <button
                key={key}
                type="button"
                onClick={() => onThemeChange?.(key)}
                className="flex items-center justify-center gap-2 rounded-[12px] px-3 py-2 transition-all duration-100"
                style={{
                  backgroundColor: theme === key ? "var(--v7-surface-2, rgba(32,23,16,0.06))" : "transparent",
                  color: theme === key ? "var(--v7-text-primary, #201710)" : "var(--v7-text-ghost, rgba(32,23,16,0.3))",
                }}
              >
                <HugeiconsIcon
                  icon={icon}
                  size={18}
                  style={{
                    color: theme === key ? "var(--v7-text-primary, #201710)" : "var(--v7-text-ghost, rgba(32,23,16,0.3))",
                    transition: "color 75ms",
                  }}
                />
                <span>{text}</span>
              </button>
            ))}
          </div>
        );

        return { content, measurementContent: content };
      }
    }
  }, [
    actionItems,
    notificationTypes,
    onResetClick,
    onSearchChange,
    onSearchClear,
    onSignOut,
    onThemeChange,
    profileName,
    searchLoading,
    searchPlaceholder,
    searchValue,
    sharedHover,
    theme,
    user,
    view,
  ]);

  const { content, measurementContent } = submenu;

  return (
    <div
      ref={containerRef}
      className={cn("relative flex flex-col items-center", className)}
    >
      <div
        ref={hiddenRef}
        className="pointer-events-none invisible absolute left-[-9999px] top-[-9999px]"
      >
        <div className="rounded-[18px] py-1" style={{ backgroundColor: "var(--v7-paper, #fffaf5)", border: "1px solid var(--v7-border, rgba(32,23,16,0.08))" }}>
          {measurementContent}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {view !== "default" && content ? (
          <motion.div
            key="submenu"
            initial={{
              opacity: 0,
              scaleY: 0.9,
              scaleX: 0.95,
              height: 0,
              width: 0,
              originY: 1,
              originX: 0.5,
            }}
            animate={{
              opacity: 1,
              scaleY: 1,
              scaleX: 1,
              height: hiddenBounds.height || "auto",
              width: hiddenBounds.width || "auto",
              originY: 1,
              originX: 0.5,
            }}
            exit={{
              opacity: 0,
              scaleY: 0.9,
              scaleX: 0.95,
              height: 0,
              width: 0,
              originY: 1,
              originX: 0.5,
            }}
            transition={{
              duration: 0.3,
              ease: [0.45, 0, 0.25, 1],
            }}
            style={{ transformOrigin: "bottom center" }}
            className="absolute bottom-[70px] overflow-hidden"
          >
            <div
              className="rounded-[18px] backdrop-blur-xl"
              style={{
                backgroundColor: "color-mix(in srgb, var(--v7-paper, #fffaf5) 95%, transparent)",
                border: "1px solid var(--v7-border, rgba(32,23,16,0.08))",
                boxShadow: "0 4px 20px rgba(32,23,16,0.1)",
              }}
            >
              <AnimatePresence initial={false} mode="popLayout">
                <motion.div
                  key={view}
                  initial={{
                    opacity: 0,
                    scale: 0.96,
                    filter: "blur(10px)",
                  }}
                  animate={{
                    opacity: 1,
                    scale: 1,
                    filter: "blur(0px)",
                  }}
                  exit={{
                    opacity: 0,
                    scale: 0.95,
                    filter: "blur(12px)",
                  }}
                  transition={{
                    duration: 0.25,
                    ease: [0.42, 0, 0.58, 1],
                  }}
                  className="py-1"
                >
                  {content}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div
        className="z-10 mt-3 flex items-center gap-1 rounded-[18px] p-1 backdrop-blur-xl"
        style={{
          backgroundColor: "color-mix(in srgb, var(--v7-paper, #fffaf5) 92%, transparent)",
          border: "1px solid var(--v7-border, rgba(32,23,16,0.08))",
          boxShadow: "0 2px 12px rgba(32,23,16,0.08)",
        }}
      >
        {MAIN_NAV.map(({ icon, name }) => (
          <button
            key={name}
            type="button"
            className="rounded-[16px] p-3 transition-all"
            style={{
              backgroundColor: view === name ? "var(--v7-surface-2, rgba(32,23,16,0.04))" : "transparent",
            }}
            onMouseEnter={(e) => { if (view !== name) e.currentTarget.style.backgroundColor = "var(--v7-surface-2, rgba(32,23,16,0.04))"; }}
            onMouseLeave={(e) => { if (view !== name) e.currentTarget.style.backgroundColor = "transparent"; }}
            onClick={() =>
              setView((currentView) =>
                currentView === name ? "default" : name,
              )
            }
            aria-label={name}
          >
            <HugeiconsIcon
              icon={icon}
              size={22}
              style={{
                color: view === name ? "var(--v7-text-primary, #201710)" : "var(--v7-text-ghost, rgba(32,23,16,0.3))",
                transition: "color 150ms",
              }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
