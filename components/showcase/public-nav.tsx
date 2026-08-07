"use client";

import Link from "next/link";
import { Moon, Sun } from "lucide-react";
import { OWNER_HANDLE, OWNER_SITE_URL } from "@/lib/routes";
import { PUBLIC_HOME_PATH, PUBLIC_MODES, publicModePath } from "@/lib/public-modes";
import type { PublicMode } from "@/lib/public-modes";
import { useTheme } from "@/lib/use-theme";

// Re-exported so the existing `from "./public-nav"` imports keep working; the
// list itself moved to lib/public-modes.ts, which the route segment also reads.
export { PUBLIC_MODES };
export type { PublicMode };

export function PublicNav({
  mode,
  backHref,
  backLabel,
}: {
  mode?: PublicMode;
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
          href={PUBLIC_HOME_PATH}
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
            // Links, not buttons: each mode is its own URL, so these have to be
            // openable in a new tab and reachable by the back button.
            <div
              aria-label="View"
              style={{ display: "flex", gap: "clamp(14px, 3vw, 30px)" }}
            >
              {PUBLIC_MODES.map((entry) => {
                const active = entry.id === mode;
                return (
                  <Link
                    key={entry.id}
                    href={publicModePath(entry.id)}
                    aria-current={active ? "page" : undefined}
                    style={itemStyle(active)}
                  >
                    {entry.label}
                  </Link>
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
