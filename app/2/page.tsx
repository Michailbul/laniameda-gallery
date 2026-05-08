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
    <div className="variation-2">
      <style>{`
        /* ===== A. CSS Variables ===== */
        .variation-2 {
          --v7-font: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
          --v7-font-display: Georgia, "Times New Roman", serif;
          --v7-ink: #2d2025;
          --v7-coral: #d4829a;
          --v7-paper: #faf5f2;
          --v7-paper-muted: #f3eae5;
          --v7-sidebar-bg: #f7f0ec;
          --v7-sidebar-width: 250px;
          --v7-sidebar-text: #2d2025;
          --v7-sidebar-text-muted: #7a5c6a;
          --v7-sidebar-text-ghost: #b89aaa;
          --v7-sidebar-border: rgba(212,130,154,0.10);
          --v7-sidebar-surface: rgba(212,130,154,0.06);
          --v7-sidebar-surface-hover: rgba(212,130,154,0.08);
          --v7-surface-0: #faf5f2;
          --v7-surface-1: #f7f0ec;
          --v7-surface-2: #f0e8e2;
          --v7-surface-3: #e8dcd4;
          --v7-surface-4: #dccec4;
          --v7-text-primary: #2d2025;
          --v7-text-secondary: #5c4450;
          --v7-text-tertiary: #7a5c6a;
          --v7-text-ghost: #b89aaa;
          --v7-border: rgba(212,130,154,0.10);
          --v7-border-strong: rgba(212,130,154,0.18);
          --v7-border-thick: 1px;
          --v7-border-brutal: 1px;
          --v7-accent: var(--v7-coral);
          --v7-accent-dim: rgba(212,130,154,0.06);
          --v7-accent-hover: #e09ab2;
          --v7-pillar-creators: #d4829a;
          --v7-pillar-designs: #82b0ce;
          --v7-pillar-dump: #7abfb0;
          --v7-shadow-sm: 0 1px 4px rgba(212,130,154,0.06);
          --v7-shadow-md: 0 4px 16px rgba(212,130,154,0.08);
          --v7-shadow-lg: 0 12px 32px rgba(212,130,154,0.10);
          --v7-shadow-accent: 0 4px 20px rgba(212,130,154,0.15);
          --v7-shadow-dark: 0 8px 24px rgba(0,0,0,0.06);
          --v7-radius: 12px;
          --v7-duration-fast: 150ms;
          --v7-duration-normal: 300ms;
          --v7-scope-pill-shadow: rgba(212,130,154,0.05);
          --v7-filter-height: 48px;
          --v7-success: #7abfb0;
          --gradient-1: #c06878;
          --gradient-3: #d4829a;
          --gradient-5: #e09ab2;
        }

        /* ===== B. SIDEBAR ROOT — floating, rounded right edge, no hard border ===== */
        .variation-2 aside.fixed {
          background-color: rgba(247,240,236,0.92) !important;
          backdrop-filter: blur(20px) !important;
          -webkit-backdrop-filter: blur(20px) !important;
          border-right: none !important;
          box-shadow: 2px 0 20px rgba(212,130,154,0.05) !important;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif !important;
        }

        /* ===== C. SIDEBAR HEADER — elegant, soft ===== */
        .variation-2 aside > div:first-child {
          border-bottom: 1px solid rgba(212,130,154,0.08) !important;
          height: 56px !important;
        }
        /* Logo text — no shadow, elegant */
        .variation-2 aside > div:first-child .flex.select-none span {
          font-size: 13px !important;
          font-weight: 600 !important;
          letter-spacing: 0.06em !important;
          text-shadow: none !important;
          color: #2d2025 !important;
        }
        /* Diamond — rose */
        .variation-2 aside span[style*="rotate(45deg)"] {
          background-color: #d4829a !important;
          width: 7px !important;
          height: 7px !important;
          border-radius: 1px !important;
        }
        /* Collapse button — rounded, soft border */
        .variation-2 aside > div:first-child button {
          border: 1px solid rgba(212,130,154,0.15) !important;
          border-radius: 8px !important;
          width: 28px !important;
          height: 28px !important;
          color: #b89aaa !important;
        }
        .variation-2 aside > button.absolute {
          border: 1px solid rgba(212,130,154,0.20) !important;
          border-radius: 10px !important;
          background-color: #faf5f2 !important;
          color: #d4829a !important;
          box-shadow: 0 2px 8px rgba(212,130,154,0.08) !important;
        }

        /* ===== D. NAV ITEMS — pill-shaped active, rose tint ===== */
        /* GLOBAL sidebar text override — kill uppercase, friendly text */
        .variation-2 aside span,
        .variation-2 aside a span,
        .variation-2 aside button span,
        .variation-2 aside p {
          text-transform: none !important;
          letter-spacing: 0 !important;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif !important;
        }
        /* Nav section container (2nd child when expanded, 3rd when collapsed) */
        .variation-2 aside > div:nth-child(2),
        .variation-2 aside > div:nth-child(3) {
          border-bottom: 1px solid rgba(212,130,154,0.06) !important;
          padding: 6px 10px !important;
        }
        /* NavItem link/button — remove left border, pill on active */
        .variation-2 aside > div:nth-child(2) > a,
        .variation-2 aside > div:nth-child(2) > button,
        .variation-2 aside > div:nth-child(3) > a,
        .variation-2 aside > div:nth-child(3) > button {
          border-left: 0px solid transparent !important;
          border-radius: 10px !important;
          margin: 2px 0 !important;
        }
        /* NavItem inner */
        .variation-2 aside > div:nth-child(2) > a > div,
        .variation-2 aside > div:nth-child(2) > button > div,
        .variation-2 aside > div:nth-child(3) > a > div,
        .variation-2 aside > div:nth-child(3) > button > div {
          padding: 10px 12px !important;
          gap: 10px !important;
        }
        /* NavItem text */
        .variation-2 aside > div:nth-child(2) span,
        .variation-2 aside > div:nth-child(3) span {
          font-size: 13px !important;
          font-weight: 500 !important;
        }

        /* ===== E. SCROLL AREA — section headers & filter rows ===== */
        /* Section headers — elegant small caps feel */
        .variation-2 aside .flex.items-center.justify-between.px-4.py-2\\.5 span {
          font-size: 10px !important;
          font-weight: 600 !important;
          text-transform: uppercase !important;
          letter-spacing: 0.08em !important;
          color: #b89aaa !important;
        }
        /* Clear button */
        .variation-2 aside .flex.items-center.justify-between.px-4.py-2\\.5 button {
          font-size: 10px !important;
          font-weight: 600 !important;
          text-transform: uppercase !important;
          letter-spacing: 0.06em !important;
          color: #d4829a !important;
        }
        /* Section dividers — very subtle */
        .variation-2 aside [style*="borderBottom: 2px"],
        .variation-2 aside [style*="border-bottom: 2px"] {
          border-bottom-width: 1px !important;
          border-bottom-color: rgba(212,130,154,0.06) !important;
        }
        /* FilterRow — pill shape on hover/active */
        .variation-2 aside button.flex.w-full.items-center.gap-2\\.5 {
          border-radius: 10px !important;
          margin: 1px 8px !important;
          padding: 7px 10px !important;
          width: calc(100% - 16px) !important;
        }
        /* Active filter row */
        .variation-2 aside button.flex.w-full.items-center.gap-2\\.5[style*="sidebar-surface"] {
          background-color: rgba(212,130,154,0.08) !important;
        }
        /* FilterRow label — no uppercase, friendly */
        .variation-2 aside button.flex.w-full.items-center.gap-2\\.5 span.min-w-0 {
          font-size: 13px !important;
          font-weight: 500 !important;
          text-transform: none !important;
          letter-spacing: 0 !important;
        }
        /* Active label */
        .variation-2 aside button.flex.w-full.items-center.gap-2\\.5[style*="sidebar-text"] span.min-w-0 {
          font-weight: 600 !important;
          color: #d4829a !important;
        }
        /* FilterRow count — rose pill */
        .variation-2 aside button.flex.w-full.items-center.gap-2\\.5 span[style*="tabular-nums"] {
          font-size: 10px !important;
          font-weight: 600 !important;
          color: #d4829a !important;
          background: rgba(212,130,154,0.08);
          padding: 1px 7px;
          border-radius: 999px;
        }
        /* Dots — circular, rose */
        .variation-2 aside button.flex.w-full.items-center.gap-2\\.5 span.flex.h-3 span {
          border-radius: 50% !important;
        }

        /* ===== F. STATS — elegant, rose-tinted card feel ===== */
        .variation-2 aside .grid.grid-cols-2 {
          border-top: 1px solid rgba(212,130,154,0.08) !important;
          margin: 0 10px !important;
          border-radius: 12px !important;
          overflow: hidden !important;
          background: rgba(212,130,154,0.03) !important;
        }
        .variation-2 aside .grid.grid-cols-2 > div:first-child {
          border-right: 1px solid rgba(212,130,154,0.08) !important;
        }
        /* Numbers — elegant serif */
        .variation-2 aside .grid.grid-cols-2 p[style*="28px"] {
          font-size: 24px !important;
          font-weight: 700 !important;
          font-family: Georgia, serif !important;
          color: #2d2025 !important;
        }
        /* Labels */
        .variation-2 aside .grid.grid-cols-2 p[style*="8px"][style*="uppercase"] {
          font-size: 10px !important;
          font-weight: 500 !important;
          text-transform: none !important;
          letter-spacing: 0 !important;
          color: #b89aaa !important;
        }

        /* ===== G. PROFILE — soft, round ===== */
        .variation-2 aside .px-3.py-3 {
          border-top: 1px solid rgba(212,130,154,0.06) !important;
          padding: 12px !important;
        }
        /* Avatar — circular with rose ring */
        .variation-2 aside img {
          border-radius: 50% !important;
          border: 2px solid rgba(212,130,154,0.20) !important;
        }
        .variation-2 aside .px-3.py-3 div[style*="28px"][style*="28px"] {
          border-radius: 50% !important;
          border: 2px solid rgba(212,130,154,0.20) !important;
        }
        /* Username — no uppercase */
        .variation-2 aside .px-3.py-3 span.truncate {
          font-size: 12px !important;
          font-weight: 500 !important;
          text-transform: none !important;
          letter-spacing: 0 !important;
        }
        /* Status */
        .variation-2 aside .px-3.py-3 span[style*="success"] {
          font-size: 10px !important;
          font-weight: 500 !important;
          text-transform: none !important;
          letter-spacing: 0 !important;
        }
        /* Sign out — pill */
        .variation-2 aside .px-3.py-3 button.flex.w-full {
          font-size: 12px !important;
          font-weight: 500 !important;
          text-transform: none !important;
          letter-spacing: 0 !important;
          border-radius: 10px !important;
          border: 1px solid rgba(212,130,154,0.15) !important;
          padding: 7px 12px !important;
        }

        /* ===== H. FILTER BAR — floating pill ===== */
        .variation-2 .v7-island {
          border-radius: 20px !important;
          border: none !important;
          box-shadow: 0 4px 20px rgba(212,130,154,0.08) !important;
          background: rgba(250,245,242,0.92) !important;
          backdrop-filter: blur(16px) !important;
        }
        /* Scope pill container — very rounded */
        .variation-2 .v7-island > div > div > div > div:first-child {
          border: 1.5px solid rgba(212,130,154,0.20) !important;
          border-radius: 999px !important;
        }
        .variation-2 .v7-island > div > div > div > div:first-child > div {
          background-color: rgba(212,130,154,0.15) !important;
          width: 1px !important;
        }
        /* All filter bar buttons — friendly */
        .variation-2 .v7-island button {
          font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif !important;
          text-transform: none !important;
          letter-spacing: 0 !important;
          font-weight: 500 !important;
          font-size: 13px !important;
          border-radius: 999px !important;
        }
        /* Tag chips — pill shape */
        .variation-2 .v7-island button[style*="10px"][style*="uppercase"] {
          border-radius: 999px !important;
          text-transform: none !important;
          letter-spacing: 0 !important;
          font-weight: 500 !important;
          font-size: 12px !important;
          border-width: 1px !important;
        }
        /* Tag count */
        .variation-2 .v7-island div[style*="9px"][style*="ghost"] {
          font-size: 11px !important;
          text-transform: none !important;
          letter-spacing: 0 !important;
        }

        /* ===== I. BUTTONS ===== */
        .variation-2 button {
          border-radius: 10px !important;
        }
        .variation-2 .v7-chip {
          border-radius: 999px !important;
          border: 1px solid rgba(212,130,154,0.15) !important;
          text-transform: none !important;
          letter-spacing: 0 !important;
          font-weight: 500 !important;
        }
        .variation-2 .v7-chip:hover {
          background-color: rgba(212,130,154,0.06) !important;
          border-color: rgba(212,130,154,0.25) !important;
        }
        .variation-2 .v7-chip[data-active="true"] {
          background-color: #d4829a !important;
          border-color: #d4829a !important;
          color: #ffffff !important;
          box-shadow: 0 2px 8px rgba(212,130,154,0.20) !important;
        }
        .variation-2 .v7-btn-brutal {
          border-radius: 999px !important;
          box-shadow: 0 4px 16px rgba(212,130,154,0.10) !important;
          border: none !important;
          text-transform: none !important;
          letter-spacing: 0 !important;
          font-weight: 500 !important;
          font-size: 13px !important;
          padding: 10px 20px !important;
        }
        .variation-2 .v7-btn-brutal:hover {
          box-shadow: 0 8px 24px rgba(212,130,154,0.18) !important;
          transform: translateY(-1px);
        }
        .variation-2 .v7-btn-brutal:active {
          transform: translateY(0) !important;
        }
        .variation-2 .v7-label {
          text-transform: uppercase !important;
          letter-spacing: 0.06em !important;
          font-weight: 500 !important;
          font-size: 10px !important;
          color: #b89aaa !important;
        }

        /* ===== J. CARDS — super rounded, soft shadow on hover ===== */
        .variation-2 .card-base,
        .variation-2 .rounded-xl {
          border-radius: 16px !important;
          border: none !important;
          overflow: hidden !important;
          box-shadow: 0 1px 4px rgba(212,130,154,0.04) !important;
        }
        .variation-2 .card-base:hover {
          box-shadow: 0 12px 32px rgba(212,130,154,0.12) !important;
          transform: translateY(-2px);
        }
        .variation-2 .card-selected {
          box-shadow: 0 0 0 2px #d4829a, 0 8px 24px rgba(212,130,154,0.12) !important;
        }

        /* ===== K. GRID & PANELS ===== */
        .variation-2 .v7-grid-bg {
          background-image: radial-gradient(rgba(212,130,154,0.06) 1px, transparent 1px) !important;
          background-size: 20px 20px !important;
        }
        .variation-2 .md-sidebar-offset > div > aside {
          border-left: none !important;
          box-shadow: -4px 0 20px rgba(212,130,154,0.05) !important;
          border-radius: 0 !important;
          background-color: rgba(247,240,236,0.92) !important;
          backdrop-filter: blur(16px) !important;
        }
        .variation-2 > div[role="dialog"] > div:last-child {
          border-top: none !important;
          box-shadow: 0 -12px 40px rgba(212,130,154,0.10) !important;
          border-radius: 24px 24px 0 0 !important;
        }

        /* ===== L. SCROLLBAR ===== */
        .variation-2 ::-webkit-scrollbar {
          width: 5px;
        }
        .variation-2 ::-webkit-scrollbar-track {
          background: transparent;
        }
        .variation-2 ::-webkit-scrollbar-thumb {
          background: rgba(212,130,154,0.15);
          border-radius: 3px;
        }
        .variation-2 ::-webkit-scrollbar-thumb:hover {
          background: rgba(212,130,154,0.30);
        }

        /* ===== M. THEME SWITCH ===== */
        .variation-2 aside form label {
          border-radius: 999px !important;
        }
      `}</style>
      <V72Dashboard user={dashboardUser} onSignOut={signOut} />
    </div>
  );
}
