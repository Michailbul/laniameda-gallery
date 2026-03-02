"use client";

import { useEffect, useRef } from "react";
import { useTelegramAuth } from "./TelegramAuthProvider";

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;

interface TelegramLoginButtonProps {
  size?: "small" | "medium" | "large";
}

export function TelegramLoginButton({
  size = "medium",
}: TelegramLoginButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { refresh } = useTelegramAuth();

  useEffect(() => {
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
    script.dataset.size = size;
    script.dataset.requestAccess = "write";
    script.dataset.onauth = "__onTelegramAuth(user)";

    container.innerHTML = "";
    container.appendChild(script);

    return () => {
      container.innerHTML = "";
      delete globalWindow.__onTelegramAuth;
    };
  }, [size, refresh]);

  return <div ref={containerRef} />;
}
