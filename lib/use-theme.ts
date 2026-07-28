"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  DEFAULT_THEME,
  isThemePreference,
  THEME_LIGHT_QUERY,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemePreference,
} from "./theme";

/**
 * Theme state lives in a module store rather than React context: the theme is
 * external (localStorage + matchMedia + a DOM attribute), every surface wants
 * read access without a provider in the tree, and `useSyncExternalStore`
 * hydrates against the server snapshot without a mismatch.
 */

const listeners = new Set<() => void>();

let preference: ThemePreference | null = null;
let mediaQuery: MediaQueryList | null = null;

function lightQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || !window.matchMedia) return null;
  if (!mediaQuery) mediaQuery = window.matchMedia(THEME_LIGHT_QUERY);
  return mediaQuery;
}

function systemTheme(): ResolvedTheme {
  const query = lightQuery();
  if (!query) return DEFAULT_THEME;
  return query.matches ? "light" : "dark";
}

function readStoredPreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemePreference(raw)) return raw;
  } catch {
    // Private mode / storage disabled — fall through to system.
  }
  return "system";
}

/** Read-through cache so the first render doesn't have to wait for subscribe. */
function currentPreference(): ThemePreference {
  if (preference === null) preference = readStoredPreference();
  return preference;
}

function getThemeSnapshot(): ResolvedTheme {
  const pref = currentPreference();
  return pref === "system" ? systemTheme() : pref;
}

function getServerTheme(): ResolvedTheme {
  return DEFAULT_THEME;
}

function getServerPreference(): ThemePreference {
  return "system";
}

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);

  // One OS listener for the whole app, attached on first subscriber. It fires
  // regardless of preference; `getThemeSnapshot` decides whether the OS value
  // is actually in play, so a pinned theme just re-reads the same value.
  if (listeners.size === 1) lightQuery()?.addEventListener("change", emit);

  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) mediaQuery?.removeEventListener("change", emit);
  };
}

/** Persist + broadcast a new preference. Safe to call from anywhere. */
export function setThemePreference(next: ThemePreference) {
  preference = next;
  try {
    if (next === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Non-persistent is still better than not switching at all.
  }
  emit();
}

/**
 * Theme handle. No provider required — works on any client surface, including
 * the public showcase pages that pin their own `data-theme`.
 */
export function useTheme() {
  const theme = useSyncExternalStore(
    subscribe,
    getThemeSnapshot,
    getServerTheme,
  );
  const preferenceValue = useSyncExternalStore(
    subscribe,
    currentPreference,
    getServerPreference,
  );

  // Mirror onto the document. The bootstrap script already did this for the
  // first paint; this keeps it in sync on every later change.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setThemePreference(theme === "dark" ? "light" : "dark");
  }, [theme]);

  return {
    /** What's actually applied right now. */
    theme,
    /** What the user picked — including "system". */
    preference: preferenceValue,
    setPreference: setThemePreference,
    /** Flip light↔dark, pinning the result (never lands on "system"). */
    toggleTheme,
  };
}
