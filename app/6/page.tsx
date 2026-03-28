"use client";
import { useCurrentUser } from "@/lib/use-current-user";
import { V72Dashboard } from "@/components/v8/dashboard";

export default function Page() {
  const { user, signOut } = useCurrentUser();
  const dashboardUser = user
    ? {
        id: user.ownerUserId,
        email: user.email ?? null,
        firstName: user.name ?? null,
        username: user.telegramUsername ?? null,
        photoUrl: user.avatarUrl ?? null,
      }
    : null;
  return (
    <div className="variation-6">
      <style>{`
        /* ═══════════════════════════════════════════════════════════
           A. CSS Variables on .variation-6
           ═══════════════════════════════════════════════════════════ */
        .variation-6 {
          --v7-font: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
          --v7-font-display: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
          --v7-ink: #09090b;
          --v7-coral: #18181b;
          --v7-paper: #ffffff;
          --v7-paper-muted: #fafafa;
          --v7-sidebar-bg: #fafafa;
          --v7-sidebar-width: 240px;
          --v7-sidebar-text: #09090b;
          --v7-sidebar-text-muted: #71717a;
          --v7-sidebar-text-ghost: #a1a1aa;
          --v7-sidebar-border: #f4f4f5;
          --v7-sidebar-surface: #f4f4f5;
          --v7-sidebar-surface-hover: #f4f4f5;
          --v7-surface-0: #ffffff;
          --v7-surface-1: #fafafa;
          --v7-surface-2: #f4f4f5;
          --v7-surface-3: #e4e4e7;
          --v7-surface-4: #d4d4d8;
          --v7-text-primary: #09090b;
          --v7-text-secondary: #3f3f46;
          --v7-text-tertiary: #71717a;
          --v7-text-ghost: #a1a1aa;
          --v7-border: #e4e4e7;
          --v7-border-strong: #d4d4d8;
          --v7-border-thick: 1px;
          --v7-border-brutal: 1px;
          --v7-accent: #18181b;
          --v7-accent-dim: rgba(24,24,27,0.04);
          --v7-accent-hover: #27272a;
          --v7-pillar-creators: #f59e0b;
          --v7-pillar-cars: #ef4444;
          --v7-pillar-designs: #6366f1;
          --v7-pillar-dump: #14b8a6;
          --v7-shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
          --v7-shadow-md: 0 1px 3px rgba(0,0,0,0.06);
          --v7-shadow-lg: 0 4px 6px rgba(0,0,0,0.05);
          --v7-shadow-accent: 0 0 0 1px #d4d4d8;
          --v7-shadow-dark: 0 4px 12px rgba(0,0,0,0.06);
          --v7-radius: 6px;
          --v7-duration-fast: 100ms;
          --v7-duration-normal: 150ms;
          --v7-scope-pill-shadow: rgba(0,0,0,0.02);
          --v7-filter-height: 44px;
          --v7-success: #22c55e;
          --gradient-1: #18181b;
          --gradient-3: #27272a;
          --gradient-5: #3f3f46;
        }

        /* ═══════════════════════════════════════════════════════════
           B. SIDEBAR ROOT — clean white, hairline right border
           ═══════════════════════════════════════════════════════════ */
        .variation-6 aside.fixed {
          background-color: #fafafa !important;
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
          border-right: 1px solid #e4e4e7 !important;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif !important;
        }

        /* ═══════════════════════════════════════════════════════════
           C. SIDEBAR HEADER — clean, no decorations
           ═══════════════════════════════════════════════════════════ */
        /* Header container */
        .variation-6 aside > div:first-child {
          border-bottom: 1px solid #e4e4e7 !important;
          height: 52px !important;
        }
        /* Logo text — no shadow, no uppercase, smaller tracking */
        .variation-6 aside > div:first-child span[style*="textShadow"],
        .variation-6 aside > div:first-child span[style*="text-shadow"] {
          text-shadow: none !important;
        }
        .variation-6 aside > div:first-child .flex.select-none span {
          font-size: 13px !important;
          font-weight: 600 !important;
          letter-spacing: 0.04em !important;
          text-shadow: none !important;
          color: #09090b !important;
        }
        /* Diamond logo — zinc instead of coral */
        .variation-6 aside span[style*="rotate(45deg)"] {
          background-color: #18181b !important;
          width: 6px !important;
          height: 6px !important;
        }
        /* Collapse button — clean */
        .variation-6 aside > div:first-child button {
          border: 1px solid #e4e4e7 !important;
          border-radius: 6px !important;
          width: 28px !important;
          height: 28px !important;
        }
        /* Expand button */
        .variation-6 aside > button.absolute {
          border: 1px solid #e4e4e7 !important;
          border-radius: 6px !important;
          background-color: #ffffff !important;
          color: #71717a !important;
          box-shadow: 0 1px 3px rgba(0,0,0,0.06) !important;
        }

        /* ═══════════════════════════════════════════════════════════
           D. NAV ITEMS — rounded active background, no left border
           ═══════════════════════════════════════════════════════════ */
        /* GLOBAL sidebar text override — kill ALL uppercase everywhere */
        .variation-6 aside span,
        .variation-6 aside a span,
        .variation-6 aside button span,
        .variation-6 aside p {
          text-transform: none !important;
          letter-spacing: -0.01em !important;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif !important;
        }
        /* Nav section container */
        .variation-6 aside > div:nth-child(2),
        .variation-6 aside > div:nth-child(3) {
          border-bottom: 1px solid #e4e4e7 !important;
          padding: 4px 8px !important;
        }
        /* NavItem link/button — remove left border, add rounded bg */
        .variation-6 aside > div:nth-child(2) > a,
        .variation-6 aside > div:nth-child(2) > button,
        .variation-6 aside > div:nth-child(3) > a,
        .variation-6 aside > div:nth-child(3) > button {
          border-left: 0px solid transparent !important;
          border-radius: 6px !important;
          margin: 1px 0 !important;
        }
        /* NavItem inner content */
        .variation-6 aside > div:nth-child(2) > a > div,
        .variation-6 aside > div:nth-child(2) > button > div,
        .variation-6 aside > div:nth-child(3) > a > div,
        .variation-6 aside > div:nth-child(3) > button > div {
          padding: 8px 10px !important;
          gap: 10px !important;
        }
        /* Nav label text */
        .variation-6 aside > div:nth-child(2) span,
        .variation-6 aside > div:nth-child(3) span {
          font-size: 13px !important;
          font-weight: 500 !important;
        }

        /* ═══════════════════════════════════════════════════════════
           E. SCROLL AREA — section headers & filter rows
           ═══════════════════════════════════════════════════════════ */
        /* Section header text ("MODELS", "FOLDERS") — no uppercase, clean */
        .variation-6 aside .flex.items-center.justify-between.px-4.py-2\\.5 span {
          font-size: 11px !important;
          font-weight: 500 !important;
          text-transform: none !important;
          letter-spacing: -0.01em !important;
          color: #a1a1aa !important;
        }
        /* "CLEAR" button */
        .variation-6 aside .flex.items-center.justify-between.px-4.py-2\\.5 button {
          font-size: 11px !important;
          font-weight: 500 !important;
          text-transform: none !important;
          letter-spacing: -0.01em !important;
        }
        /* Section dividers — thinner */
        .variation-6 aside [style*="borderBottom: 2px"],
        .variation-6 aside [style*="border-bottom: 2px"] {
          border-bottom-width: 1px !important;
          border-bottom-color: #f4f4f5 !important;
        }
        /* FilterRow buttons — rounded hover, more padding */
        .variation-6 aside button.flex.w-full.items-center.gap-2\\.5 {
          border-radius: 6px !important;
          margin: 1px 6px !important;
          padding: 6px 10px !important;
          width: calc(100% - 12px) !important;
        }
        /* FilterRow active state */
        .variation-6 aside button.flex.w-full.items-center.gap-2\\.5[style*="sidebar-surface"] {
          background-color: #f4f4f5 !important;
        }
        /* FilterRow label text — no uppercase */
        .variation-6 aside button.flex.w-full.items-center.gap-2\\.5 span.min-w-0 {
          font-size: 13px !important;
          font-weight: 500 !important;
          text-transform: none !important;
          letter-spacing: -0.01em !important;
        }
        /* Active filter row label */
        .variation-6 aside button.flex.w-full.items-center.gap-2\\.5[style*="sidebar-text"] span.min-w-0 {
          font-weight: 600 !important;
        }
        /* FilterRow count */
        .variation-6 aside button.flex.w-full.items-center.gap-2\\.5 span[style*="tabular-nums"] {
          font-size: 11px !important;
          font-weight: 500 !important;
          color: #a1a1aa !important;
          background: #f4f4f5;
          padding: 1px 6px;
          border-radius: 4px;
        }
        /* FilterRow dots — round, smaller */
        .variation-6 aside button.flex.w-full.items-center.gap-2\\.5 span.flex.h-3 span {
          border-radius: 50% !important;
        }

        /* ═══════════════════════════════════════════════════════════
           F. STATS SECTION — cleaner, smaller
           ═══════════════════════════════════════════════════════════ */
        /* Stats grid */
        .variation-6 aside .grid.grid-cols-2 {
          border-top: 1px solid #e4e4e7 !important;
        }
        .variation-6 aside .grid.grid-cols-2 > div:first-child {
          border-right: 1px solid #e4e4e7 !important;
        }
        /* Stat numbers — smaller, lighter */
        .variation-6 aside .grid.grid-cols-2 p[style*="28px"] {
          font-size: 22px !important;
          font-weight: 700 !important;
          font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif !important;
          color: #09090b !important;
        }
        /* Stat labels — no uppercase */
        .variation-6 aside .grid.grid-cols-2 p[style*="8px"][style*="uppercase"] {
          font-size: 11px !important;
          font-weight: 500 !important;
          text-transform: none !important;
          letter-spacing: -0.01em !important;
          color: #a1a1aa !important;
        }

        /* ═══════════════════════════════════════════════════════════
           G. PROFILE SECTION — clean
           ═══════════════════════════════════════════════════════════ */
        /* Profile container */
        .variation-6 aside .px-3.py-3 {
          border-top: 1px solid #e4e4e7 !important;
        }
        /* Avatar image — circular */
        .variation-6 aside img {
          border-radius: 50% !important;
          border: 1px solid #e4e4e7 !important;
        }
        /* Avatar fallback div — circular */
        .variation-6 aside .px-3.py-3 div[style*="28px"][style*="28px"] {
          border-radius: 50% !important;
          border: 1px solid #e4e4e7 !important;
        }
        /* Username text — no uppercase */
        .variation-6 aside .px-3.py-3 span.truncate {
          font-size: 12px !important;
          font-weight: 500 !important;
          text-transform: none !important;
          letter-spacing: -0.01em !important;
        }
        /* Online status text */
        .variation-6 aside .px-3.py-3 span[style*="success"] {
          font-size: 11px !important;
          font-weight: 500 !important;
          text-transform: none !important;
          letter-spacing: -0.01em !important;
        }
        /* Sign out button */
        .variation-6 aside .px-3.py-3 button.flex.w-full {
          font-size: 12px !important;
          font-weight: 500 !important;
          text-transform: none !important;
          letter-spacing: -0.01em !important;
          border-radius: 6px !important;
          border: 1px solid #e4e4e7 !important;
          padding: 6px 10px !important;
        }

        /* ═══════════════════════════════════════════════════════════
           H. FILTER BAR — clean island
           ═══════════════════════════════════════════════════════════ */
        .variation-6 .v7-island {
          border-radius: 10px !important;
          border: 1px solid #e4e4e7 !important;
          box-shadow: 0 1px 2px rgba(0,0,0,0.04) !important;
          background: #ffffff !important;
        }
        /* Scope pill container */
        .variation-6 .v7-island > div > div > div > div:first-child {
          border: 1px solid #d4d4d8 !important;
          border-radius: 6px !important;
        }
        .variation-6 .v7-island > div > div > div > div:first-child > div {
          background-color: #d4d4d8 !important;
          width: 1px !important;
        }
        /* All buttons inside filter bar — clean */
        .variation-6 .v7-island button {
          font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif !important;
          text-transform: none !important;
          letter-spacing: -0.01em !important;
          font-weight: 500 !important;
          font-size: 13px !important;
        }
        /* Dividers in filter bar */
        .variation-6 .v7-island > div > div > div > div[style*="1px"] {
          background-color: #e4e4e7 !important;
        }
        /* Tag row divider */
        .variation-6 .v7-island > div[style*="1px"][style*="margin"] {
          background-color: #f4f4f5 !important;
        }
        /* Tags — clean chips */
        .variation-6 .v7-island button[style*="10px"][style*="uppercase"] {
          border-radius: 6px !important;
          text-transform: none !important;
          letter-spacing: -0.01em !important;
          font-weight: 500 !important;
          font-size: 12px !important;
          border-width: 1px !important;
        }
        /* Tag count summary */
        .variation-6 .v7-island div[style*="9px"][style*="ghost"] {
          font-size: 12px !important;
          text-transform: none !important;
          letter-spacing: -0.01em !important;
          font-weight: 500 !important;
        }

        /* ═══════════════════════════════════════════════════════════
           I. BUTTONS — shadcn style
           ═══════════════════════════════════════════════════════════ */
        .variation-6 button {
          border-radius: 6px !important;
        }
        .variation-6 .v7-chip {
          border-radius: 6px !important;
          border: 1px solid #e4e4e7 !important;
          text-transform: none !important;
          letter-spacing: -0.01em !important;
          font-weight: 500 !important;
          font-size: 13px !important;
        }
        .variation-6 .v7-chip:hover {
          background-color: #f4f4f5 !important;
          border-color: #d4d4d8 !important;
        }
        .variation-6 .v7-chip[data-active="true"] {
          background-color: #18181b !important;
          border-color: #18181b !important;
          color: #ffffff !important;
          box-shadow: none !important;
        }
        .variation-6 .v7-btn-brutal {
          border-radius: 6px !important;
          box-shadow: none !important;
          border: 1px solid #18181b !important;
          background-color: #18181b !important;
          color: #fafafa !important;
          text-transform: none !important;
          letter-spacing: -0.01em !important;
          font-weight: 500 !important;
          font-size: 13px !important;
          padding: 8px 16px !important;
        }
        .variation-6 .v7-btn-brutal:hover {
          background-color: #27272a !important;
          border-color: #27272a !important;
          color: #fafafa !important;
          box-shadow: none !important;
        }
        .variation-6 .v7-btn-brutal:active {
          transform: none !important;
        }
        .variation-6 .v7-btn-ghost {
          text-transform: none !important;
          letter-spacing: -0.01em !important;
        }
        .variation-6 .v7-label {
          text-transform: none !important;
          letter-spacing: -0.01em !important;
          font-weight: 500 !important;
          font-size: 13px !important;
          color: #71717a !important;
        }
        .variation-6 .v7-value {
          letter-spacing: -0.01em !important;
          font-weight: 400 !important;
        }

        /* ═══════════════════════════════════════════════════════════
           J. CARDS — clean, zinc ring on hover
           ═══════════════════════════════════════════════════════════ */
        .variation-6 .card-base,
        .variation-6 .rounded-xl {
          border-radius: 8px !important;
          border: 1px solid #e4e4e7 !important;
        }
        .variation-6 .card-base:hover {
          box-shadow: 0 0 0 2px #18181b !important;
          border-color: #18181b !important;
        }
        .variation-6 .card-selected {
          box-shadow: 0 0 0 2px #18181b !important;
          border-color: #18181b !important;
        }

        /* ═══════════════════════════════════════════════════════════
           K. GRID & DETAIL PANEL
           ═══════════════════════════════════════════════════════════ */
        .variation-6 .v7-grid-bg {
          background-image: none !important;
          background-color: #ffffff !important;
        }
        .variation-6 .md-sidebar-offset > div > aside {
          border-left: 1px solid #e4e4e7 !important;
          box-shadow: none !important;
          border-radius: 0 !important;
          background-color: #fafafa !important;
          backdrop-filter: none !important;
        }
        /* Mobile sheet */
        .variation-6 > div[role="dialog"] > div:last-child {
          border-top: 1px solid #e4e4e7 !important;
          box-shadow: 0 -4px 12px rgba(0,0,0,0.05) !important;
          border-radius: 12px 12px 0 0 !important;
        }

        /* ═══════════════════════════════════════════════════════════
           L. SCROLLBAR & BOTTOM DOCK
           ═══════════════════════════════════════════════════════════ */
        .variation-6 ::-webkit-scrollbar {
          width: 6px;
        }
        .variation-6 ::-webkit-scrollbar-track {
          background: transparent;
        }
        .variation-6 ::-webkit-scrollbar-thumb {
          background: #d4d4d8;
          border-radius: 3px;
        }
        .variation-6 ::-webkit-scrollbar-thumb:hover {
          background: #a1a1aa;
        }
        /* Bottom dock */
        .variation-6 .v7-island:last-child {
          border-radius: 10px !important;
        }

        /* ═══════════════════════════════════════════════════════════
           M. THEME SWITCH — zinc style
           ═══════════════════════════════════════════════════════════ */
        .variation-6 aside form label {
          border-radius: 999px !important;
        }
      `}</style>
      <V72Dashboard user={dashboardUser} onSignOut={signOut} />
    </div>
  );
}
