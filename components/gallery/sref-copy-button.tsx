"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function SrefCopyButton({ text, label = "Copy sref" }: { text: string; label?: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button type="button" className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs focus-visible:outline-2 focus-visible:outline-offset-2"
      style={{ borderColor: "var(--lm-border-subtle)", color: "var(--lm-text-primary)" }}
      aria-label={`${label}: ${text}`} onBlur={() => setStatus("idle")}
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setStatus("copied"); }
        catch { setStatus("failed"); }
      }}>
      {status === "copied" ? <Check size={13} /> : <Copy size={13} />}
      <span aria-live="polite">{status === "copied" ? "Copied" : status === "failed" ? "Copy failed, select the code" : label}</span>
    </button>
  );
}
