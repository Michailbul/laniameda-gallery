import type { AnTheme } from "@an-dev/react";

/**
 * Claude-like canvas theme adapted to laniameda's warm editorial palette.
 * Spacious, clean, generous whitespace — AI-native conversational feel.
 */
export const galleryAgentTheme: AnTheme = {
  theme: {
    // Typography — clean sans-serif, readable
    "--an-font-family":
      "var(--font-geist-sans, system-ui, -apple-system, sans-serif)",
    "--an-font-weight": "400",
    "--an-font-weight-medium": "500",
    "--an-font-weight-semibold": "600",
    "--an-text-size": "15px",
    "--an-text-size-sm": "13px",
    "--an-text-size-xs": "11px",
    "--an-line-height": "1.7",

    // Geometry — soft, spacious, Claude-like
    "--an-border-radius": "20px",
    "--an-message-border-radius": "20px",
    "--an-input-border-radius": "24px",
    "--an-input-inner-border-radius": "16px",
    "--an-send-button-border-radius": "9999px",
    "--an-stop-button-border-radius": "9999px",
    "--an-mode-selector-border-radius": "12px",
    "--an-tool-border-radius": "12px",
    "--an-code-border-radius": "12px",
    "--an-attachment-border-radius": "12px",
    "--an-message-gap": "16px",
    "--an-user-message-padding": "14px 20px",
    "--an-input-padding": "16px 20px",
    "--an-tool-padding": "12px 16px",
    "--an-code-padding": "20px",

    // Component sizes — generous touch targets
    "--an-send-button-size": "40px",
    "--an-stop-button-size": "40px",
    "--an-scrollbar-width": "6px",

    // Font sizes — clear hierarchy
    "--an-input-font-size": "15px",
    "--an-date-divider-font-size": "11px",
    "--an-model-selector-font-size": "12px",
    "--an-tool-font-size": "13px",
    "--an-code-font-size": "13px",
    "--an-code-font-family":
      "var(--font-geist-mono, ui-monospace, 'SF Mono', Monaco, monospace)",
    "--an-attachment-font-size": "12px",

    // Layout — Claude-like: full-width messages, spacious
    "--an-message-style": "full-width",
    "--an-message-density": "relaxed",
    "--an-input-style": "rounded",
    "--an-send-button-style": "circle-icon",
    "--an-stop-button-style": "circle-square",
    "--an-attachment-button-style": "plus-circle",
    "--an-attachment-preview-style": "thumbnail",
    "--an-tool-call-style": "normal",
    "--an-thinking-display": "collapsed",
    "--an-code-action-display": "minimal",
    "--an-bash-display": "minimal",
    "--an-search-display": "rich-group",

    // Behavior — clean, minimal chrome
    "--an-sticky-user-messages": "false",
    "--an-show-date-divider": "false",
    "--an-show-copy-button": "true",
    "--an-show-tool-icons": "true",
    "--an-attach-button-right": "false",
    "--an-model-selector-left": "false",

    // Text rendering
    "--an-text-contrast": "normal",
    "--an-user-message-font-weight": "400",
    "--an-assistant-message-opacity": "1",

    // Layout — canvas max-width
    "--an-input-placeholder": "Message the design agent...",
    "--an-max-width": "680px",
    "--an-attachment-button-position": "left",
    "--an-model-selector-position": "input-bar",
    "--an-model-selector-side": "right",
    "--an-mode-selector-position": "popover",
  },

  light: {
    // Backgrounds — transparent so page paper shows through
    "--an-background": "transparent",
    "--an-background-secondary": "#f7ede2",
    "--an-background-tertiary": "#fff4ea",

    // Text — ink hierarchy, high contrast
    "--an-foreground": "#201710",
    "--an-foreground-muted": "#4c3a2d",
    "--an-foreground-subtle": "#ab9381",

    // Borders — nearly invisible, canvas feel
    "--an-border-color": "rgba(32, 23, 16, 0.10)",
    "--an-border-color-light": "rgba(32, 23, 16, 0.05)",
    "--an-divider-color": "rgba(32, 23, 16, 0.06)",

    // Messages — subtle user distinction
    "--an-message-shadow": "none",
    "--an-user-message-bg": "#f7ede2",
    "--an-user-message-text": "#201710",
    "--an-date-divider-color": "#ab9381",
    "--an-date-divider-border-color": "rgba(32, 23, 16, 0.06)",

    // Input bar — floating, elevated
    "--an-input-background": "#ffffff",
    "--an-input-border-color": "rgba(32, 23, 16, 0.10)",
    "--an-input-color": "#201710",
    "--an-input-placeholder-color": "#ab9381",
    "--an-input-shadow":
      "0 2px 12px rgba(32, 23, 16, 0.06), 0 0 0 1px rgba(32, 23, 16, 0.04)",

    // Accent — coral, warmth
    "--an-primary-color": "#ff7a64",
    "--an-primary-color-hover": "#ff917d",
    "--an-primary-color-active": "#e8614f",
    "--an-focus-color": "#ff7a64",

    // Send button — warm coral pill
    "--an-send-button-color": "#ffffff",
    "--an-send-button-bg": "#201710",
    "--an-send-button-hover-color": "#ffffff",
    "--an-send-button-hover-bg": "#4c3a2d",
    "--an-send-button-active-bg": "#201710",
    "--an-send-button-shadow": "0 1px 3px rgba(32, 23, 16, 0.12)",

    // Stop button — ink
    "--an-stop-button-color": "#ffffff",
    "--an-stop-button-bg": "#201710",

    // Mode selector
    "--an-mode-selector-background": "#f7ede2",
    "--an-mode-selector-color": "#7d6755",
    "--an-mode-selector-active-color": "#201710",
    "--an-mode-selector-active-background": "#ffffff",

    // Model selector
    "--an-model-selector-color": "#7d6755",
    "--an-model-selector-hover-color": "#201710",

    // Tools — subtle warm surface
    "--an-tool-background": "#fff4ea",
    "--an-tool-border-color": "rgba(32, 23, 16, 0.08)",
    "--an-tool-color": "#4c3a2d",
    "--an-tool-color-muted": "#7d6755",
    "--an-tool-icon-color": "#ab9381",

    // Code — dark panel contrast
    "--an-code-background": "#1c1917",
    "--an-code-color": "#1c1917",

    // Attachments
    "--an-attachment-background": "#fff4ea",
    "--an-attachment-border-color": "rgba(32, 23, 16, 0.08)",
    "--an-attachment-hover-background": "#f7ede2",
    "--an-attachment-color": "#201710",
    "--an-attachment-color-muted": "#7d6755",

    // Scrollbar — near invisible
    "--an-scrollbar-color": "rgba(32, 23, 16, 0.08)",
    "--an-scrollbar-hover-color": "rgba(32, 23, 16, 0.18)",

    // Input focus — warm glow
    "--an-input-focus-border-color": "rgba(255, 122, 100, 0.4)",
    "--an-input-focus-shadow":
      "0 2px 12px rgba(32, 23, 16, 0.06), 0 0 0 2px rgba(255, 122, 100, 0.12)",

    // Diffs
    "--an-diff-added-bg": "rgba(22, 163, 74, 0.08)",
    "--an-diff-added-border": "rgba(22, 163, 74, 0.3)",
    "--an-diff-added-text": "#15803d",
    "--an-diff-removed-bg": "rgba(229, 83, 75, 0.08)",
    "--an-diff-removed-border": "rgba(229, 83, 75, 0.3)",
    "--an-diff-removed-text": "#e5534b",
  },

  dark: {
    "--an-background": "#1c1917",
    "--an-background-secondary": "#231f1c",
    "--an-background-tertiary": "#2a2522",

    "--an-foreground": "#f5eee7",
    "--an-foreground-muted": "#c4b5a5",
    "--an-foreground-subtle": "#7d6755",

    "--an-border-color": "rgba(245, 238, 231, 0.08)",
    "--an-border-color-light": "rgba(245, 238, 231, 0.04)",
    "--an-divider-color": "rgba(245, 238, 231, 0.05)",

    "--an-message-shadow": "none",
    "--an-user-message-bg": "rgba(245, 238, 231, 0.06)",
    "--an-user-message-text": "#f5eee7",
    "--an-date-divider-color": "#7d6755",
    "--an-date-divider-border-color": "rgba(245, 238, 231, 0.05)",

    "--an-input-background": "#231f1c",
    "--an-input-border-color": "rgba(245, 238, 231, 0.08)",
    "--an-input-color": "#f5eee7",
    "--an-input-placeholder-color": "#7d6755",
    "--an-input-shadow":
      "0 2px 12px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(245, 238, 231, 0.06)",

    "--an-primary-color": "#ff7a64",
    "--an-primary-color-hover": "#ff917d",
    "--an-primary-color-active": "#e8614f",
    "--an-focus-color": "#ff7a64",

    "--an-send-button-color": "#1c1917",
    "--an-send-button-bg": "#f5eee7",
    "--an-send-button-hover-color": "#1c1917",
    "--an-send-button-hover-bg": "#ffffff",
    "--an-send-button-active-bg": "#e4d4c4",
    "--an-send-button-shadow": "0 1px 3px rgba(0, 0, 0, 0.3)",

    "--an-stop-button-color": "#1c1917",
    "--an-stop-button-bg": "#f5eee7",

    "--an-mode-selector-background": "#2a2522",
    "--an-mode-selector-color": "#7d6755",
    "--an-mode-selector-active-color": "#f5eee7",
    "--an-mode-selector-active-background": "#231f1c",

    "--an-model-selector-color": "#7d6755",
    "--an-model-selector-hover-color": "#f5eee7",

    "--an-tool-background": "#231f1c",
    "--an-tool-border-color": "rgba(245, 238, 231, 0.06)",
    "--an-tool-color": "#f5eee7",
    "--an-tool-color-muted": "#7d6755",
    "--an-tool-icon-color": "#ab9381",

    "--an-code-background": "#0f0e0d",
    "--an-code-color": "#0f0e0d",

    "--an-attachment-background": "#231f1c",
    "--an-attachment-border-color": "rgba(245, 238, 231, 0.06)",
    "--an-attachment-hover-background": "#2a2522",
    "--an-attachment-color": "#f5eee7",
    "--an-attachment-color-muted": "#7d6755",

    "--an-scrollbar-color": "rgba(245, 238, 231, 0.06)",
    "--an-scrollbar-hover-color": "rgba(245, 238, 231, 0.12)",

    "--an-input-focus-border-color": "rgba(255, 122, 100, 0.4)",
    "--an-input-focus-shadow":
      "0 2px 12px rgba(0, 0, 0, 0.2), 0 0 0 2px rgba(255, 122, 100, 0.15)",

    "--an-diff-added-bg": "rgba(22, 163, 74, 0.12)",
    "--an-diff-added-border": "rgba(22, 163, 74, 0.3)",
    "--an-diff-added-text": "#4ade80",
    "--an-diff-removed-bg": "rgba(229, 83, 75, 0.12)",
    "--an-diff-removed-border": "rgba(229, 83, 75, 0.3)",
    "--an-diff-removed-text": "#ff917d",
  },
};
