"use client";

import { useState } from "react";
import { useTelegramAuth } from "./TelegramAuthProvider";

export function DevLoginButton() {
  const { refresh } = useTelegramAuth();
  const [busy, setBusy] = useState(false);

  if (process.env.NODE_ENV === "production") return null;

  const handleDevLogin = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/auth/dev-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleDevLogin}
      disabled={busy}
      className="flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2 text-[11px] font-semibold uppercase tracking-widest transition-colors"
      style={{
        fontFamily: "var(--font-mono)",
        borderColor: "var(--border-strong)",
        backgroundColor: "var(--surface-1)",
        color: "var(--text-secondary)",
      }}
    >
      {busy ? "Logging in…" : "Dev Login"}
    </button>
  );
}
