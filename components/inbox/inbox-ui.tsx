"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { Check, Copy, Loader2 } from "lucide-react";
import { useCurrentUser } from "@/lib/use-current-user";
import { TelegramLoginButton } from "@/components/telegram-login-button";

// The Inbox screens speak the gallery's own language: Geist sans for bold
// uppercase titles, Geist Mono for badges and microcopy, 2px corners, coral
// for the one thing that matters on screen.
export const mono: CSSProperties = { fontFamily: "var(--lm-font)" };
export const display: CSSProperties = { fontFamily: "var(--lm-font-display)" };
export const RADIUS = "var(--lm-radius)";
export const SCRIM = "color-mix(in srgb, var(--lm-paper) 74%, transparent)";

export const errorText = (error: unknown, fallback: string) => {
  const data = (error as { data?: unknown })?.data;
  if (typeof data === "string") return data;
  return error instanceof Error ? error.message.replace(/^.*Uncaught ConvexError: /, "").split("\n")[0] : fallback;
};

export function Micro({ children, color, className, style }: { children: ReactNode; color?: string; className?: string; style?: CSSProperties }) {
  return <span className={`text-[10px] font-bold uppercase tracking-[0.14em] ${className ?? ""}`}
    style={{ ...mono, color: color ?? "var(--lm-text-tertiary)", ...style }}>{children}</span>;
}

export function Badge({ children, color, title }: { children: ReactNode; color?: string; title?: string }) {
  return <span title={title} className="inline-flex items-center gap-1.5 border px-1.5 py-[3px] text-[10px] font-semibold uppercase leading-none tracking-[0.12em]"
    style={{ ...mono, borderRadius: RADIUS, borderColor: "var(--lm-border)", color: color ?? "var(--lm-text-secondary)" }}>{children}</span>;
}

export function Hotkey({ n, active, size = 22 }: { n: number | string; active?: boolean; size?: number }) {
  return <span aria-hidden className="grid shrink-0 place-items-center text-[11px] font-black leading-none"
    style={{
      ...mono, width: size, height: size, borderRadius: RADIUS,
      background: active ? "var(--lm-coral)" : "var(--lm-ink)", color: "var(--lm-paper)",
    }}>{n}</span>;
}

// Every card carries its short ID with a copy button; the copy is the full
// asset:<id> an agent can look up.
export function CopyChip({ value, label, title }: { value: string; label?: string; title?: string }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" aria-label={`Copy ${value}`} title={title ?? `Copy ${value}`}
    onPointerDown={(event) => event.stopPropagation()}
    onClick={async (event) => {
      event.stopPropagation();
      try {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      } catch { /* clipboard refused: nothing to show */ }
    }}
    className="inline-flex max-w-full items-center gap-1.5 px-1.5 py-[4px] text-[10px] font-bold leading-none tracking-[0.06em] backdrop-blur focus-visible:outline-2 focus-visible:outline-offset-2"
    style={{ ...mono, borderRadius: RADIUS, border: "1px solid var(--lm-border-strong)", background: SCRIM, color: "var(--lm-text-primary)" }}>
    <span className="truncate">{label ?? value}</span>
    {copied ? <Check size={11} aria-hidden /> : <Copy size={11} className="opacity-60" aria-hidden />}
  </button>;
}

type Tone = "ink" | "coral" | "ghost";
const TONE: Record<Tone, CSSProperties> = {
  ink: { background: "var(--lm-ink)", color: "var(--lm-paper)", border: "1px solid var(--lm-ink)" },
  coral: { background: "var(--lm-coral)", color: "var(--lm-paper)", border: "1px solid var(--lm-coral)" },
  ghost: { background: "transparent", color: "var(--lm-text-secondary)", border: "1px solid var(--lm-border-strong)" },
};

export function ActionButton({ tone = "ghost", icon, children, busy, className, ...props }:
  { tone?: Tone; icon?: ReactNode; busy?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props}
    className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] transition-[opacity,background-color,color,transform] hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 ${className ?? ""}`}
    style={{ ...mono, borderRadius: RADIUS, ...TONE[tone], ...props.style }}>
    {busy ? <Loader2 size={13} className="animate-spin" aria-hidden /> : icon}{children}
  </button>;
}

// Owner-only pages: signed out shows the Telegram login, nothing else.
export function InboxGate({ children }: { children: (ownerUserId: string) => ReactNode }) {
  const { user, isLoading } = useCurrentUser();
  if (isLoading) {
    return <main className="grid min-h-dvh place-items-center" style={{ background: "var(--lm-paper)" }}>
      <Loader2 className="animate-spin" size={18} style={{ color: "var(--lm-text-ghost)" }} aria-label="Loading" />
    </main>;
  }
  if (!user) {
    return <main className="grid min-h-dvh place-items-center px-4" style={{ background: "var(--lm-paper)", color: "var(--lm-text-primary)" }}>
      <div className="w-full max-w-sm text-center">
        <h1 className="mb-2 text-3xl font-black uppercase tracking-tight" style={display}>Decisions</h1>
        <p className="mb-6 text-[11px] uppercase tracking-[0.14em]" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>Sign in to decide</p>
        <TelegramLoginButton size="large" />
        <Link href="/" className="mt-6 block text-[11px] uppercase tracking-[0.14em] underline underline-offset-4" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>Gallery</Link>
      </div>
    </main>;
  }
  return <>{children(user.ownerUserId)}</>;
}
