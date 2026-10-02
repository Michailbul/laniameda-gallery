"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { requestJson } from "@/lib/app-api";
import type { AuthMeResponse } from "@/lib/auth-types";

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME?.trim().replace(/^@+/, "");
const POLL_MS = 2500;

// Signing in happens in Telegram, which drops the session cookie from another
// tab. Watch for it and re-render the server page, which then shows consent.
export function OAuthSignIn() {
  const router = useRouter();

  useEffect(() => {
    let stopped = false;
    const check = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      try {
        const me = await requestJson<AuthMeResponse>("/api/auth/me");
        if (me.user && !stopped) {
          stopped = true;
          router.refresh();
        }
      } catch {
        // Still signed out.
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), POLL_MS);
    window.addEventListener("focus", check);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [router]);

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">
        Only the gallery owner can approve an MCP connection. Sign in with Telegram, then come back to
        this tab. It moves on by itself.
      </p>
      {BOT_USERNAME ? (
        <a
          href={`https://t.me/${BOT_USERNAME}?start=login`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-brutal w-full py-3"
        >
          Log in with Telegram
        </a>
      ) : (
        <p className="font-mono text-[11px] text-[var(--status-error)]">
          NEXT_PUBLIC_TELEGRAM_BOT_USERNAME is not set.
        </p>
      )}
      <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-ghost)]">
        <span className="block h-[6px] w-[6px] animate-pulse rounded-full bg-[var(--coral)]" />
        Waiting for sign-in
      </p>
    </div>
  );
}
