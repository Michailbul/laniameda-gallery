"use client";

import Link from "next/link";
import { Moon, Sun } from "lucide-react";
import { OWNER_HANDLE, OWNER_SITE_URL } from "@/lib/routes";
import { useTheme } from "@/lib/use-theme";

// The public surface has exactly three modes. This toggle IS the navigation —
// no sidebar, no filter bar, nothing else to learn.
export const PUBLIC_MODES = [
  {
    id: "featured",
    label: "Featured work",
    title: "Start here.",
    blurb: "The pieces I'd show you first.",
  },
  {
    id: "worlds",
    label: "Worlds",
    title: "Explore the worlds I'm building.",
    blurb:
      "Each world is a story universe — its scenes, its characters, its locations.",
  },
  {
    id: "browse",
    label: "Browse",
    title: "Everything else.",
    blurb: "The working archive. Filter it, or just scroll.",
  },
] as const;

export type PublicMode = (typeof PUBLIC_MODES)[number]["id"];

export function PublicNav({
  mode,
  onModeChange,
  backHref,
  backLabel,
}: {
  mode?: PublicMode;
  onModeChange?: (mode: PublicMode) => void;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <nav
      style={{
        position: "sticky",
        top: 0,
        zIndex: 40,
        background: "color-mix(in srgb, var(--lm-paper) 88%, transparent)",
        backdropFilter: "blur(14px) saturate(140%)",
        borderBottom: "1px solid var(--lm-border)",
      }}
    >
      <div
        style={{
          maxWidth: 1400,
          margin: "0 auto",
          padding: "0 clamp(16px, 4vw, 40px)",
          minHeight: 58,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 20,
          flexWrap: "wrap",
        }}
      >
        <Link
          href="/"
          style={{
            fontFamily: "var(--lm-font)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--lm-text-primary)",
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ color: "var(--lm-coral)" }}>●</span> LANIAMEDA
        </Link>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "clamp(14px, 3vw, 30px)",
            flexWrap: "wrap",
          }}
        >
          {backHref ? (
            <Link href={backHref} style={itemStyle(false)}>
              ← {backLabel ?? "Back"}
            </Link>
          ) : (
            <div
              role="tablist"
              aria-label="View"
              style={{ display: "flex", gap: "clamp(14px, 3vw, 30px)" }}
            >
              {PUBLIC_MODES.map((entry) => {
                const active = entry.id === mode;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => onModeChange?.(entry.id)}
                    // No `border` shorthand here — itemStyle already sets
                    // borderBottom, and mixing the two warns in React.
                    style={{
                      ...itemStyle(active),
                      background: "none",
                      borderTop: "none",
                      borderLeft: "none",
                      borderRight: "none",
                      cursor: "pointer",
                    }}
                  >
                    {entry.label}
                  </button>
                );
              })}
            </div>
          )}
          {/* The handle is the way out to the person behind the work. */}
          <a
            href={OWNER_SITE_URL}
            target="_blank"
            rel="noopener noreferrer me"
            title="mishabuloichyk.com"
            className="lm-owner-handle-link"
            style={{
              fontFamily: "var(--lm-font)",
              fontSize: 11,
              letterSpacing: "0.08em",
              color: "var(--lm-text-ghost)",
              whiteSpace: "nowrap",
              textDecoration: "none",
            }}
          >
            @{OWNER_HANDLE}
          </a>
          <ThemeToggle />
        </div>
      </div>
    </nav>
  );
}

// Light↔dark for visitors. Shares the vault's store (localStorage + the
// data-theme attribute), so the owner's pick carries across both surfaces.
function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const Icon = theme === "dark" ? Sun : Moon;
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      className="lm-theme-toggle"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 30,
        height: 30,
        padding: 0,
        borderRadius: 999,
        border: "1px solid var(--lm-border)",
        background: "transparent",
        color: "var(--lm-text-secondary)",
        cursor: "pointer",
      }}
    >
      <Icon size={14} strokeWidth={2} />
    </button>
  );
}

const itemStyle = (active: boolean) => ({
  fontFamily: "var(--lm-font)",
  fontSize: 11,
  fontWeight: active ? 700 : 500,
  letterSpacing: "0.14em",
  textTransform: "uppercase" as const,
  color: active ? "var(--lm-coral)" : "var(--lm-text-secondary)",
  textDecoration: "none",
  padding: "4px 0",
  borderBottom: active ? "1px solid var(--lm-coral)" : "1px solid transparent",
  transition: "color 150ms ease",
  whiteSpace: "nowrap" as const,
});
