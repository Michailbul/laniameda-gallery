"use client";

import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { mono } from "./moodboards-view";

// HUMAN / AGENT: two ways to read a world's instructions. Ported from the
// portfolio's human/machine switch: a floating segmented toggle, the choice
// kept in localStorage, M toggles it, both panes stay mounted and cross-fade.

export type WorldViewMode = "human" | "agent";

const STORAGE_KEY = "lm-world-view";

// The saved choice is an external store: localStorage, with a memory copy for
// windows that refuse storage, shared by every panel and by other tabs.
let memory: WorldViewMode | null = null;
const listeners = new Set<() => void>();

const readSaved = (): WorldViewMode => {
  if (memory) return memory;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "agent" ? "agent" : "human";
  } catch {
    return "human";
  }
};

const writeMode = (next: WorldViewMode) => {
  memory = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Private windows can refuse storage; the memory copy still switches.
  }
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    memory = null;
    listener();
  };
  listeners.add(listener);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
};

const isTyping = (target: EventTarget | null) => {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.tagName === "SELECT" || element.isContentEditable;
};

/** The saved mode, a setter that persists it, and the M key. */
export function useWorldViewMode() {
  // Human on the server; the saved choice on the client.
  const mode = useSyncExternalStore(subscribe, readSaved, () => "human" as const);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "m" && event.key !== "M") return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat || isTyping(event.target)) return;
      event.preventDefault();
      writeMode(readSaved() === "human" ? "agent" : "human");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return { mode, setMode: writeMode };
}

/* ── Panes ──────────────────────────────────────────────────────────────── */

const PaneActive = createContext(true);
/** False inside the hidden pane: its editors drop their keyboard shortcuts. */
export const usePaneActive = () => useContext(PaneActive);

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/**
 * Both views stay mounted. The visible one sets the height; the hidden one
 * lies over it, clipped, faded, blurred and inert.
 */
export function WorldViewPanes({ mode, human, agent }: { mode: WorldViewMode; human: ReactNode; agent: ReactNode }) {
  return <div className="relative overflow-clip">
    <Pane visible={mode === "human"} label="Human view">{human}</Pane>
    <Pane visible={mode === "agent"} label="Agent view">{agent}</Pane>
  </div>;
}

function Pane({ visible, label, children }: { visible: boolean; label: string; children: ReactNode }) {
  return <div role="region" aria-label={label} aria-hidden={!visible} inert={!visible}
    className={visible ? "relative" : "absolute inset-x-0 top-0"}
    style={{
      opacity: visible ? 1 : 0,
      transform: visible ? "translateY(0)" : "translateY(-6px)",
      filter: visible ? "blur(0px)" : "blur(6px)",
      pointerEvents: visible ? "auto" : "none",
      userSelect: visible ? "auto" : "none",
      transition: `opacity 500ms ${EASE}, transform 500ms ${EASE}, filter 500ms ${EASE}`,
    }}>
    <PaneActive.Provider value={visible}>{children}</PaneActive.Provider>
  </div>;
}

/* ── Toggle ─────────────────────────────────────────────────────────────── */

const MODES: { value: WorldViewMode; label: string; title: string }[] = [
  { value: "human", label: "Human", title: "The world laid out for reading (M)" },
  { value: "agent", label: "Agent", title: "Exactly what an agent receives from open_world (M)" },
];

/**
 * Floating segmented toggle: two static rectangular buttons with ○ / ● dots,
 * mono uppercase, blurred translucent ground. Sticky at the bottom of the
 * scrolling panel, above the dock on desktop and the tab bar on a phone.
 */
export function WorldViewToggle({ mode, onChange }: { mode: WorldViewMode; onChange: (mode: WorldViewMode) => void }) {
  return <div className="pointer-events-none sticky bottom-[calc(var(--mobile-bottom-nav-height,56px)+16px)] z-40 flex justify-center px-4 pb-2 md:bottom-[96px]">
    <div role="radiogroup" aria-label="View" className="pointer-events-auto flex items-stretch overflow-hidden border text-[10px] font-bold uppercase tracking-[0.22em] backdrop-blur-md"
      style={{
        ...mono, borderRadius: "var(--lm-radius)", borderColor: "var(--lm-border-strong)",
        background: "color-mix(in srgb, var(--lm-paper) 82%, transparent)",
        boxShadow: "0 12px 36px -14px rgba(0, 0, 0, 0.55)",
      }}>
      {MODES.map((entry, index) => {
        const active = mode === entry.value;
        return <button key={entry.value} type="button" role="radio" aria-checked={active} title={entry.title}
          onClick={() => onChange(entry.value)}
          className="flex items-center gap-2 px-4 py-2.5 outline-none transition-colors duration-200 focus-visible:bg-[var(--lm-surface-2)]"
          style={{
            borderLeft: index > 0 ? "1px solid var(--lm-border)" : undefined,
            color: active ? "var(--lm-text-primary)" : "var(--lm-text-tertiary)",
            background: active ? "transparent" : STRIPES,
          }}>
          <span aria-hidden className="inline-block h-[7px] w-[7px] border transition-all duration-200"
            style={{
              borderRadius: "999px",
              borderColor: active ? "var(--lm-coral)" : "var(--lm-text-ghost)",
              background: active ? "var(--lm-coral)" : "transparent",
            }} />
          {entry.label}
        </button>;
      })}
      <span aria-hidden className="hidden items-center border-l px-3 text-[9px] tracking-[0.18em] sm:flex"
        style={{ borderColor: "var(--lm-border)", color: "var(--lm-text-ghost)" }}>M</span>
    </div>
  </div>;
}

// The unselected half reads as recessed: fine diagonal hatching.
const STRIPES = "repeating-linear-gradient(135deg, transparent 0 4px, color-mix(in srgb, var(--lm-text-primary) 5%, transparent) 4px 5px)";
