"use client";

import { useEffect, useRef } from "react";
import { useTelegramAuth } from "./TelegramAuthProvider";

const BOT_USERNAME =
  process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "laniamedaaibot";

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

    // Global callback invoked by the Telegram widget script.
    (window as Record<string, unknown>).__onTelegramAuth = async (
      data: Record<string, unknown>,
    ) => {
      await fetch("/api/auth/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
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
      delete (window as Record<string, unknown>).__onTelegramAuth;
    };
  }, [size, refresh]);

  return <div ref={containerRef} />;
}
