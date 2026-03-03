"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, ShieldCheck } from "lucide-react";
import { useTelegramAuth } from "./TelegramAuthProvider";

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

interface TelegramLoginButtonProps {
  size?: "small" | "medium" | "large";
}

export function TelegramLoginButton({
  size = "medium",
}: TelegramLoginButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);
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
          widgetMaxWidth: "188px",
          compact: true,
          scriptSize: "small" as const,
        }
      : size === "large"
        ? {
            title: "text-[16px]",
            subtitle: "text-[12px]",
            helper: "text-[11px]",
            wrapper: "px-5 py-5",
            iconShell: "h-11 w-11",
            widgetMaxWidth: "252px",
            compact: false,
            scriptSize: "large" as const,
          }
        : {
            title: "text-[15px]",
            subtitle: "text-[11px]",
            helper: "text-[11px]",
            wrapper: "px-4 py-4",
            iconShell: "h-10 w-10",
            widgetMaxWidth: "220px",
            compact: false,
            scriptSize: "medium" as const,
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
    if (DEV_AUTH_BYPASS_ENABLED) {
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    if (!BOT_USERNAME) {
      console.error(
        "Missing NEXT_PUBLIC_TELEGRAM_BOT_USERNAME; Telegram login widget is disabled.",
      );
      return;
    }

    const globalWindow = window as unknown as {
      __onTelegramAuth?: (data: Record<string, unknown>) => Promise<void>;
    };

    // Global callback invoked by the Telegram widget script.
    globalWindow.__onTelegramAuth = async (
      data: Record<string, unknown>,
    ) => {
      const response = await fetch("/api/auth/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? "Telegram authentication failed.");
      }

      await refresh();
    };

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.dataset.telegramLogin = BOT_USERNAME;
    script.dataset.size = sizeConfig.scriptSize;
    script.dataset.requestAccess = "write";
    script.dataset.onauth = "__onTelegramAuth(user)";

    container.innerHTML = "";
    container.appendChild(script);

    const detectWidgetError = () => {
      const text = container.textContent?.trim().toLowerCase() ?? "";
      if (!text) return;
      if (text.includes("bot domain invalid")) {
        const host = window.location.host;
        setWidgetError(
          `Telegram widget rejected this domain (${host}). Add it in BotFather using /setdomain for @${BOT_USERNAME}.`,
        );
      }
    };

    const observer = new MutationObserver(detectWidgetError);
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    const timer = window.setTimeout(detectWidgetError, 900);

    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
      container.innerHTML = "";
      delete globalWindow.__onTelegramAuth;
    };
  }, [refresh, sizeConfig.scriptSize]);

  return (
    <div
      className={`relative w-full overflow-hidden rounded-[24px] border ${sizeConfig.wrapper}`}
      style={{
        borderColor: "rgba(32, 23, 16, 0.18)",
        background:
          "linear-gradient(165deg, color-mix(in srgb, var(--surface-1) 92%, #ffffff 8%) 0%, color-mix(in srgb, var(--surface-1) 84%, var(--surface-2) 16%) 100%)",
        boxShadow:
          "0 1px 0 rgba(255, 255, 255, 0.65) inset, 0 14px 30px rgba(38, 18, 6, 0.08)",
      }}
    >
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
            "radial-gradient(circle, rgba(46, 184, 180, 0.11) 0%, rgba(46, 184, 180, 0) 70%)",
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
                boxShadow: "0 1px 0 rgba(255, 255, 255, 0.72) inset",
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
                  : sizeConfig.compact
                    ? "One-tap sign in for your vault."
                    : "Verify identity in one tap with Telegram."}
              </span>
            </div>
          </div>

          <div
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[9px] font-semibold tracking-[0.08em]"
            style={{
              border: "1px solid rgba(32, 23, 16, 0.18)",
              backgroundColor: "rgba(255, 255, 255, 0.45)",
              color: "var(--text-tertiary)",
              boxShadow: "0 1px 0 rgba(255, 255, 255, 0.8) inset",
            }}
          >
            <ShieldCheck className="h-3 w-3" />
            {DEV_AUTH_BYPASS_ENABLED ? "Dev only" : "Encrypted"}
          </div>
        </div>

        {!sizeConfig.compact && (
          <p
            className={`mb-2.5 ${sizeConfig.helper}`}
            style={{ color: "var(--text-ghost)", lineHeight: 1.35 }}
          >
            {DEV_AUTH_BYPASS_ENABLED
              ? "Local route only. Use real auth in production."
              : "Sign in to save assets, prompts, and folders."}
          </p>
        )}

        {DEV_AUTH_BYPASS_ENABLED ? (
          <div
            className={`rounded-2xl border ${sizeConfig.compact ? "px-2.5 py-2.5" : "px-3 py-3"}`}
            style={{
              borderColor: "rgba(32, 23, 16, 0.16)",
              background:
                "linear-gradient(160deg, rgba(255, 255, 255, 0.62) 0%, color-mix(in srgb, var(--paper-muted) 84%, #ffffff 16%) 100%)",
            }}
          >
            <button
              type="button"
              onClick={() => void handleDevLogin()}
              disabled={devLoginLoading}
              className="w-full rounded-xl border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.13em] transition-all disabled:cursor-not-allowed disabled:opacity-60"
              style={{
                borderColor: "rgba(46, 184, 180, 0.42)",
                color: "var(--text-secondary)",
                background:
                  "linear-gradient(140deg, rgba(46, 184, 180, 0.16) 0%, rgba(46, 184, 180, 0.06) 100%)",
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
                style={{ color: "#b44f3a", lineHeight: 1.35 }}
                role="alert"
              >
                {devLoginError}
              </p>
            )}
          </div>
        ) : BOT_USERNAME ? (
          <div
            className={`rounded-2xl border ${sizeConfig.compact ? "px-2.5 py-2.5" : "px-3 py-3"}`}
            style={{
              borderColor: "rgba(32, 23, 16, 0.16)",
              background:
                "linear-gradient(160deg, rgba(255, 255, 255, 0.62) 0%, color-mix(in srgb, var(--paper-muted) 84%, #ffffff 16%) 100%)",
            }}
          >
            <div className="flex justify-start">
              <div
                style={{
                  maxWidth: sizeConfig.widgetMaxWidth,
                  width: "100%",
                }}
              >
                <div ref={containerRef} className="min-h-[34px] overflow-x-auto overflow-y-hidden" />
              </div>
            </div>
            {!widgetError && (
              <p className="mt-2 text-[11px]" style={{ color: "var(--text-ghost)", lineHeight: 1.35 }}>
                {sizeConfig.compact
                  ? "No password needed."
                  : "No password needed. Telegram confirms your identity."}
              </p>
            )}
            {widgetError && (
              <p
                className="mt-2 text-[11px]"
                style={{ color: "#b44f3a", lineHeight: 1.35 }}
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
              borderColor: "rgba(32, 23, 16, 0.22)",
              backgroundColor: "rgba(255, 255, 255, 0.45)",
              color: "var(--text-secondary)",
              lineHeight: 1.4,
            }}
          >
            Set `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` (without `@`) and restart `bun run dev`.
          </div>
        )}
      </div>
    </div>
  );
}
