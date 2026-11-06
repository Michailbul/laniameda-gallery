"use client";

import { useCallback, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { RADIUS, display, errorText, mono } from "@/components/inbox/inbox-ui";

// Pieces shared by the inspiration library and the review page. The gallery's
// own language: Geist bold uppercase titles, mono chips, 2px corners, coral
// for the one thing that needs him.

export const HAIR = "1px solid var(--lm-border)";
export const RULE = "1px solid var(--lm-border-strong)";

export type Tone = "ink" | "coral" | "ghost" | "quiet";

/** A dark label chip that sits on a picture, or a plain chip in a row. */
export function Chip({ children, tone = "ghost", title, onPicture }: { children: ReactNode; tone?: Tone; title?: string; onPicture?: boolean }) {
  const style: CSSProperties = onPicture
    ? { background: "color-mix(in srgb, var(--lm-ink) 72%, transparent)", color: "var(--lm-paper)", border: "1px solid transparent" }
    : tone === "coral"
      ? { background: "var(--lm-accent-dim)", color: "var(--lm-coral)", border: "1px solid color-mix(in srgb, var(--lm-coral) 40%, transparent)" }
      : tone === "ink"
        ? { background: "var(--lm-ink)", color: "var(--lm-paper)", border: "1px solid var(--lm-ink)" }
        : tone === "quiet"
          ? { background: "transparent", color: "var(--lm-text-ghost)", border: HAIR }
          : { background: "var(--lm-surface-1)", color: "var(--lm-text-secondary)", border: HAIR };
  return <span title={title} className={`inline-flex max-w-full items-center gap-1 px-1.5 py-[3px] text-[10px] font-bold uppercase leading-none tracking-[0.1em] ${onPicture ? "backdrop-blur" : ""}`}
    style={{ ...mono, borderRadius: RADIUS, ...style }}><span className="truncate">{children}</span></span>;
}

/** A big tap target for review decisions: at least 44px tall. */
export function DecisionButton({ children, tone = "ghost", busy, disabled, onClick, hotkey, title, className }: {
  children: ReactNode; tone?: "ink" | "coral" | "ghost"; busy?: boolean; disabled?: boolean; onClick: () => void; hotkey?: string; title?: string; className?: string;
}) {
  const style: CSSProperties = tone === "coral"
    ? { background: "var(--lm-coral)", color: "var(--lm-paper)", border: "1px solid var(--lm-coral)" }
    : tone === "ink"
      ? { background: "var(--lm-ink)", color: "var(--lm-paper)", border: "1px solid var(--lm-ink)" }
      : { background: "transparent", color: "var(--lm-text-primary)", border: "1px solid var(--lm-border-strong)" };
  return <button type="button" onClick={onClick} disabled={disabled || busy} title={title}
    className={`inline-flex min-h-[44px] items-center justify-center gap-2 px-4 text-[11px] font-black uppercase tracking-[0.12em] transition-[opacity,transform] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 ${className ?? ""}`}
    style={{ ...mono, borderRadius: RADIUS, ...style }}>
    {busy && <Loader2 size={13} className="animate-spin" aria-hidden />}
    {children}
    {hotkey && <span aria-hidden className="hidden text-[9px] opacity-60 md:inline">{hotkey}</span>}
  </button>;
}

export function Title({ children, size = "md" }: { children: ReactNode; size?: "sm" | "md" | "lg" }) {
  const cls = size === "lg" ? "text-[34px] md:text-[52px] leading-[0.92]" : size === "sm" ? "text-[13px] leading-5" : "text-[18px] leading-6";
  return <h2 className={`font-black uppercase tracking-tight ${cls}`} style={display}>{children}</h2>;
}

type Media = { kind?: "image" | "video"; url?: string; thumbUrl?: string; width?: number; height?: number };

/** A picture or a playable video at its own aspect ratio; never cropped into a square. */
export function HonestMedia({ media, maxHeight, alt = "", priority, className, controls = true }: {
  media: Media; maxHeight?: string; alt?: string; priority?: boolean; className?: string; controls?: boolean;
}) {
  const ratio = media.width && media.height ? `${media.width} / ${media.height}` : undefined;
  const box: CSSProperties = { aspectRatio: ratio ?? "4 / 5", maxHeight, borderRadius: RADIUS, background: "var(--lm-surface-2)" };
  if (!media.url && !media.thumbUrl) {
    return <div className={`grid w-full place-items-center ${className ?? ""}`} style={{ ...box, border: "1px dashed var(--lm-border-strong)" }}>
      <span className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ ...mono, color: "var(--lm-text-ghost)" }}>Media missing</span>
    </div>;
  }
  if (media.kind === "video") {
    return <video src={media.url} poster={media.thumbUrl} controls={controls} playsInline preload="metadata" muted={!controls}
      className={`block w-full object-contain ${className ?? ""}`} style={box} aria-label={alt || "Video"} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- R2 media at its stored size
    <img src={media.url ?? media.thumbUrl} alt={alt} loading={priority ? "eager" : "lazy"} decoding="async"
      className={`block w-full object-contain ${className ?? ""}`} style={box} />
  );
}

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/**
 * One decision, sent once. The idempotency key lives until the server
 * acknowledges it, so a double tap or a retry after a network blip applies
 * once; only a new intent (after success) gets a new key.
 */
export function useIntent<T>(send: (eventKey: string) => Promise<T>) {
  const key = useRef<string | null>(null);
  const [state, setState] = useState<{ status: "idle" | "pending" | "done" | "failed"; error?: string }>({ status: "idle" });
  const run = useCallback(async () => {
    if (state.status === "pending") return undefined;
    key.current ??= newKey();
    setState({ status: "pending" });
    try {
      const result = await send(key.current);
      key.current = null;
      setState({ status: "done" });
      return result;
    } catch (error) {
      const message = errorText(error, "That did not go through.");
      // A refused decision (stale, not allowed) will not succeed on retry: start fresh next time.
      if (!/network|fetch|connection/i.test(message)) key.current = null;
      setState({ status: "failed", error: message });
      return undefined;
    }
  }, [send, state.status]);
  return { run, ...state, reset: () => setState({ status: "idle" }) };
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const usd = (value?: number, exact?: boolean) =>
  value === undefined ? undefined : `${exact === false ? "≈ " : ""}$${value < 0.1 ? value.toFixed(3) : value.toFixed(2)}`;
