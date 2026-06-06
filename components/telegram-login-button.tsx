"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageCircle, ShieldCheck } from "lucide-react";
import { useTelegramAuth } from "./TelegramAuthProvider";
import { AuthPanel } from "@/components/ui/auth-panel";

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME
  ?.trim()
  .replace(/^@+/, "");
const parseBoolean = (value: string | undefined, fallback: boolean) => {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return fallback;
};
const DEV_AUTH_BYPASS_ENABLED =
  process.env.NODE_ENV !== "production" &&
  parseBoolean(process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED, false);
const TELEGRAM_AUTH_ERROR_MESSAGES: Record<string, string> = {
  invalid_payload: "Telegram returned an invalid login payload. Please try again.",
  missing_bot_token: "Server auth is misconfigured. Add the Telegram login bot token.",
  invalid_hash: "Telegram login could not be verified. Please try again.",
  expired: "Telegram login expired before it reached the app. Please try again.",
};

const TELEGRAM_LOGIN_LINK = BOT_USERNAME
  ? `https://t.me/${BOT_USERNAME}?start=login`
  : null;

interface TelegramLoginButtonProps {
  size?: "small" | "medium" | "large";
}

export function TelegramLoginButton({
  size = "medium",
}: TelegramLoginButtonProps) {
  const [widgetError, setWidgetError] = useState<string | null>(null);
  const [devLoginLoading, setDevLoginLoading] = useState(false);
  const [devLoginError, setDevLoginError] = useState<string | null>(null);
  const { refresh } = useTelegramAuth();
  const sizeConfig =
    size === "small"
      ? {
          title: "text-[13px]",
          subtitle: "text-[10px]",
          helper: "text-[10px]",
          wrapper: "px-3 py-3",
          iconShell: "h-8 w-8",
          compact: true,
        }
      : size === "large"
        ? {
            title: "text-[16px]",
            subtitle: "text-[12px]",
            helper: "text-[11px]",
            wrapper: "px-5 py-5",
            iconShell: "h-11 w-11",
            compact: false,
          }
        : {
            title: "text-[15px]",
            subtitle: "text-[11px]",
            helper: "text-[11px]",
            wrapper: "px-4 py-4",
            iconShell: "h-10 w-10",
            compact: false,
          };

  const handleDevLogin = useCallback(async () => {
    if (devLoginLoading) return;
    setDevLoginLoading(true);
    setDevLoginError(null);
    try {
      const response = await fetch("/api/auth/dev-login", { method: "POST" });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to create local dev session.");
      }
      await refresh();
    } catch (error) {
      setDevLoginError(
        error instanceof Error ? error.message : "Failed to create local dev session.",
      );
    } finally {
      setDevLoginLoading(false);
    }
  }, [devLoginLoading, refresh]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const url = new URL(window.location.href);
    const authErrorCode = url.searchParams.get("tgAuthError");
    if (!authErrorCode) {
      return;
    }

    setWidgetError(
      TELEGRAM_AUTH_ERROR_MESSAGES[authErrorCode] ||
        "Telegram authentication failed. Please try again.",
    );
    url.searchParams.delete("tgAuthError");
    window.history.replaceState({}, "", url.toString());
  }, []);

  /* ── Login link button (replaces old widget) ── */
  const loginLinkButton = TELEGRAM_LOGIN_LINK ? (
    <a
      href={TELEGRAM_LOGIN_LINK}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-[13px] font-semibold transition-colors"
      style={{
        borderColor: "rgba(var(--brand-telegram-rgb), 0.5)",
        backgroundColor: "rgba(var(--brand-telegram-rgb), 0.12)",
        color: "var(--brand-telegram-ink)",
      }}
    >
      <MessageCircle className="h-4 w-4" />
      Log in with Telegram
    </a>
  ) : null;

  /* ── Compact sidebar variant — neobrutalist ── */
  if (sizeConfig.compact) {
    return (
      <div
        className="relative w-full overflow-hidden"
        style={{
          border: "1.5px solid var(--ink)",
          borderRadius: "4px",
          backgroundColor: "var(--paper)",
          boxShadow: "var(--shadow-brutal-accent)",
        }}
      >
        {/* Coral accent bar */}
        <div
          className="h-[3px] w-full"
          style={{
            background:
              "linear-gradient(90deg, var(--coral) 0%, rgba(var(--pillar-warm-r), var(--pillar-warm-g), var(--pillar-warm-b), 0.4) 70%, transparent 100%)",
          }}
        />

        <div className="px-3 py-3">
          {/* Label + diamond marker */}
          <div className="mb-1 flex items-center gap-2">
            <span
              className="block h-[5px] w-[5px] rotate-45"
              style={{ backgroundColor: "var(--coral)" }}
            />
            <span
              className="font-mono text-[7px] font-bold uppercase tracking-[0.2em]"
              style={{ color: "var(--text-ghost)" }}
            >
              {DEV_AUTH_BYPASS_ENABLED ? "Dev mode" : "Access"}
            </span>
          </div>

          {/* Headline — large display font */}
          <p
            className="text-[20px] leading-[1.1]"
            style={{
              fontFamily: "var(--font-display)",
              fontStyle: "italic",
              color: "var(--text-primary)",
              letterSpacing: "-0.02em",
            }}
          >
            {DEV_AUTH_BYPASS_ENABLED ? "localhost" : "Enter your vault"}
          </p>

          {/* Action area */}
          <div className="mt-3">
            {DEV_AUTH_BYPASS_ENABLED ? (
              <>
                <button
                  type="button"
                  onClick={() => void handleDevLogin()}
                  disabled={devLoginLoading}
                  className="btn-brutal w-full disabled:cursor-not-allowed disabled:opacity-60"
                  style={{ borderRadius: "3px" }}
                >
                  {devLoginLoading ? "Signing in..." : "Sign in as dev"}
                </button>
                {devLoginError && (
                  <p
                    className="mt-1.5 font-mono text-[9px]"
                    style={{
                      color: "var(--status-error)",
                      lineHeight: 1.35,
                    }}
                    role="alert"
                  >
                    {devLoginError}
                  </p>
                )}
              </>
            ) : TELEGRAM_LOGIN_LINK ? (
              <>
                <a
                  href={TELEGRAM_LOGIN_LINK}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-brutal inline-flex w-full items-center justify-center gap-1.5 text-[11px]"
                  style={{ borderRadius: "3px" }}
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  Log in with Telegram
                </a>
                {widgetError && (
                  <p
                    className="mt-1.5 font-mono text-[9px]"
                    style={{
                      color: "var(--status-error)",
                      lineHeight: 1.35,
                    }}
                    role="alert"
                  >
                    {widgetError}
                  </p>
                )}
              </>
            ) : (
              <p
                className="font-mono text-[9px]"
                style={{
                  color: "var(--text-ghost)",
                  lineHeight: 1.4,
                }}
              >
                Set NEXT_PUBLIC_TELEGRAM_BOT_USERNAME
              </p>
            )}
          </div>

          {/* Footer detail */}
          <p
            className="mt-2.5 font-mono text-[7px] font-bold uppercase tracking-[0.14em]"
            style={{ color: "var(--text-ghost)" }}
          >
            No password · One tap
          </p>
        </div>
      </div>
    );
  }

  /* ── Standard variant (medium / large) ── */
  return (
    <AuthPanel paddingClassName={sizeConfig.wrapper}>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-9 -top-10 h-28 w-28 rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.18) 0%, rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0) 72%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-7 -left-7 h-24 w-24 rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(var(--pillar-warm-r), var(--pillar-warm-g), var(--pillar-warm-b), 0.11) 0%, rgba(var(--pillar-warm-r), var(--pillar-warm-g), var(--pillar-warm-b), 0) 70%)",
        }}
      />

      <div className="relative z-10">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <div
              className={`flex items-center justify-center rounded-xl border ${sizeConfig.iconShell}`}
              style={{
                background:
                  "linear-gradient(145deg, rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.2) 0%, rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.08) 100%)",
                color: "var(--text-primary)",
                borderColor: "rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.26)",
                boxShadow: "0 1px 0 color-mix(in srgb, var(--paper) 72%, transparent) inset",
              }}
            >
              <MessageCircle className="h-4 w-4" />
            </div>
            <div className="flex flex-col">
              <span
                className={`font-semibold leading-tight ${sizeConfig.title}`}
                style={{
                  color: "var(--text-primary)",
                  fontFamily: "var(--font-display)",
                  letterSpacing: "-0.01em",
                }}
              >
                {DEV_AUTH_BYPASS_ENABLED ? "Local Dev Access" : "Telegram Access"}
              </span>
              <span
                className={`mt-0.5 ${sizeConfig.subtitle}`}
                style={{ color: "var(--text-tertiary)", lineHeight: 1.35, letterSpacing: "0.01em" }}
              >
                {DEV_AUTH_BYPASS_ENABLED
                  ? "Bypass widget while running localhost."
                  : "Verify identity in one tap with Telegram."}
              </span>
            </div>
          </div>

          <div
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[9px] font-semibold tracking-[0.08em]"
            style={{
              border: "1px solid color-mix(in srgb, var(--ink) 18%, transparent)",
              backgroundColor: "color-mix(in srgb, var(--paper) 45%, transparent)",
              color: "var(--text-tertiary)",
              boxShadow: "0 1px 0 color-mix(in srgb, var(--paper) 80%, transparent) inset",
            }}
          >
            <ShieldCheck className="h-3 w-3" />
            {DEV_AUTH_BYPASS_ENABLED ? "Dev only" : "Encrypted"}
          </div>
        </div>

        <p
          className={`mb-2.5 ${sizeConfig.helper}`}
          style={{ color: "var(--text-ghost)", lineHeight: 1.35 }}
        >
          {DEV_AUTH_BYPASS_ENABLED
            ? "Local route only. Use real auth in production."
            : "Sign in to save assets, prompts, and collections."}
        </p>

        {DEV_AUTH_BYPASS_ENABLED ? (
          <div
            className="rounded-2xl border px-3 py-3"
            style={{
              borderColor: "color-mix(in srgb, var(--ink) 16%, transparent)",
              background:
                "linear-gradient(160deg, color-mix(in srgb, var(--paper) 62%, transparent) 0%, color-mix(in srgb, var(--paper-muted) 84%, var(--paper) 16%) 100%)",
            }}
          >
            <button
              type="button"
              onClick={() => void handleDevLogin()}
              disabled={devLoginLoading}
              className="w-full rounded-xl border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.13em] transition-all disabled:cursor-not-allowed disabled:opacity-60"
              style={{
                borderColor:
                  "rgba(var(--pillar-warm-r), var(--pillar-warm-g), var(--pillar-warm-b), 0.42)",
                color: "var(--text-secondary)",
                background:
                  "linear-gradient(140deg, rgba(var(--pillar-warm-r), var(--pillar-warm-g), var(--pillar-warm-b), 0.16) 0%, rgba(var(--pillar-warm-r), var(--pillar-warm-g), var(--pillar-warm-b), 0.06) 100%)",
              }}
            >
              {devLoginLoading ? "Signing in..." : "Sign in as dev user"}
            </button>
            <p className="mt-2 text-[11px]" style={{ color: "var(--text-ghost)", lineHeight: 1.35 }}>
              Enable with `NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED=true` and `DEV_AUTH_BYPASS_ENABLED=true`.
            </p>
            {devLoginError && (
              <p
                className="mt-1 text-[11px]"
                style={{ color: "var(--status-error)", lineHeight: 1.35 }}
                role="alert"
              >
                {devLoginError}
              </p>
            )}
          </div>
        ) : loginLinkButton ? (
          <div
            className="rounded-2xl border px-3 py-3"
            style={{
              borderColor: "rgba(var(--brand-telegram-rgb), 0.35)",
              background:
                "linear-gradient(160deg, color-mix(in srgb, var(--paper) 75%, transparent) 0%, color-mix(in srgb, var(--paper-muted) 82%, var(--paper) 18%) 100%)",
              boxShadow: "0 1px 0 color-mix(in srgb, var(--paper) 85%, transparent) inset",
            }}
          >
            <div
              className="mb-2.5 flex items-center justify-between rounded-xl border px-2.5 py-1.5"
              style={{
                borderColor: "rgba(var(--brand-telegram-rgb), 0.42)",
                background:
                  "linear-gradient(140deg, rgba(var(--brand-telegram-rgb), 0.18) 0%, rgba(var(--brand-telegram-rgb), 0.08) 100%)",
              }}
            >
              <span
                className="text-[10px] font-semibold"
                style={{ color: "var(--brand-telegram-ink)", letterSpacing: "0.01em" }}
              >
                Continue with Telegram
              </span>
              <span
                className="rounded-full border px-2 py-0.5 text-[9px] font-semibold"
                style={{
                  borderColor: "rgba(var(--brand-telegram-rgb), 0.4)",
                  color: "var(--brand-telegram-ink)",
                  backgroundColor: "color-mix(in srgb, var(--paper) 55%, transparent)",
                }}
              >
                1 tap
              </span>
            </div>
            {loginLinkButton}
            {!widgetError && (
              <p className="mt-2 text-[11px]" style={{ color: "var(--text-ghost)", lineHeight: 1.35 }}>
                Opens Telegram. Tap Accept to sign in instantly.
              </p>
            )}
            {widgetError && (
              <p
                className="mt-2 text-[11px]"
                style={{ color: "var(--status-error)", lineHeight: 1.35 }}
                role="alert"
              >
                {widgetError}
              </p>
            )}
          </div>
        ) : (
          <div
            className="rounded-2xl border px-3 py-3 text-[11px]"
            style={{
              borderColor: "color-mix(in srgb, var(--ink) 22%, transparent)",
              backgroundColor: "color-mix(in srgb, var(--paper) 45%, transparent)",
              color: "var(--text-secondary)",
              lineHeight: 1.4,
            }}
          >
            Set `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` (without `@`) and restart `bun run dev`.
          </div>
        )}
      </div>
    </AuthPanel>
  );
}
