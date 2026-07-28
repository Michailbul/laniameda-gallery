/**
 * Gallery theme — shared contract.
 *
 * "system" follows the OS `prefers-color-scheme`; "dark"/"light" pin it.
 * The resolved value lands on `<html data-theme="…">`, which is what the
 * token layer in `app/globals.css` + `app/tokens.css` keys off.
 *
 * Dark is the product default, so an unset preference with no OS signal
 * resolves to dark.
 *
 * This module stays hook-free so the root layout (a server component) can
 * import the bootstrap script. The store + hook live in `lib/use-theme.ts`.
 */
export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "lm-theme";
export const THEME_LIGHT_QUERY = "(prefers-color-scheme: light)";
export const DEFAULT_THEME: ResolvedTheme = "dark";

/**
 * Inline bootstrap — runs before first paint so the page never flashes the
 * wrong theme. Deliberately duplicates the resolve logic because it has to be
 * a string literal in a <script>, before any JS bundle loads.
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var p=localStorage.getItem("${THEME_STORAGE_KEY}");var t=p==="light"||p==="dark"?p:(window.matchMedia&&window.matchMedia("${THEME_LIGHT_QUERY}").matches?"light":"dark");var r=document.documentElement;r.dataset.theme=t;r.style.colorScheme=t;}catch(e){var d=document.documentElement;d.dataset.theme="${DEFAULT_THEME}";d.style.colorScheme="${DEFAULT_THEME}";}})();`;

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}
