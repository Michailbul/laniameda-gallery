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
          title: "text-[11px]",
          subtitle: "text-[10px]",
          wrapper: "px-3 py-3",
          scriptSize: "small" as const,
        }
      : size === "large"
        ? {
            title: "text-[14px]",
            subtitle: "text-[12px]",
            wrapper: "px-4 py-4",
            scriptSize: "large" as const,
          }
        : {
            title: "text-[12px]",
            subtitle: "text-[11px]",
            wrapper: "px-4 py-3.5",
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
      className={`w-full rounded-2xl border ${sizeConfig.wrapper}`}
      style={{
        borderColor: "var(--border-default)",
        background:
          "linear-gradient(160deg, color-mix(in srgb, var(--surface-1) 94%, #ffffff 6%) 0%, var(--surface-1) 100%)",
      }}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{
              backgroundColor: "color-mix(in srgb, var(--coral) 16%, transparent)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-default)",
            }}
          >
            <MessageCircle className="h-4 w-4" />
          </div>
          <div className="flex flex-col">
            <span
              className={`font-mono uppercase tracking-[0.14em] ${sizeConfig.title}`}
              style={{ color: "var(--text-secondary)" }}
            >
              {DEV_AUTH_BYPASS_ENABLED ? "Local Dev Login" : "Telegram Login"}
            </span>
            <span
              className={`${sizeConfig.subtitle}`}
              style={{ color: "var(--text-ghost)", lineHeight: 1.3 }}
            >
              {DEV_AUTH_BYPASS_ENABLED
                ? "Bypass widget while running localhost."
                : "Verify identity in one tap."}
            </span>
          </div>
        </div>

        <div
          className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-medium uppercase tracking-widest"
          style={{
            border: "1px solid var(--border-default)",
            color: "var(--text-tertiary)",
          }}
        >
          <ShieldCheck className="h-3 w-3" />
          {DEV_AUTH_BYPASS_ENABLED ? "Dev only" : "Secure"}
        </div>
      </div>

      {DEV_AUTH_BYPASS_ENABLED ? (
        <div
          className="rounded-xl border px-3 py-2"
          style={{
            borderColor: "var(--border-default)",
            backgroundColor: "var(--paper-muted)",
          }}
        >
          <button
            type="button"
            onClick={() => void handleDevLogin()}
            disabled={devLoginLoading}
            className="w-full rounded-lg border px-3 py-2 text-[11px] font-medium uppercase tracking-wider transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
            style={{
              borderColor: "rgba(46, 184, 180, 0.45)",
              color: "var(--text-secondary)",
              backgroundColor: "rgba(46, 184, 180, 0.08)",
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
          className="rounded-xl border px-3 py-2"
          style={{
            borderColor: "var(--border-default)",
            backgroundColor: "var(--paper-muted)",
          }}
        >
          <div ref={containerRef} className="min-h-[34px]" />
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
          className="rounded-xl border px-3 py-2 text-[11px]"
          style={{
            borderColor: "var(--border-strong)",
            backgroundColor: "var(--surface-2)",
            color: "var(--text-secondary)",
          }}
        >
          Set NEXT_PUBLIC_TELEGRAM_BOT_USERNAME (without @) and restart bun run dev.
        </div>
      )}
    </div>
  );
}
