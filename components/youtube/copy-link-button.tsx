"use client";

import { useEffect, useState } from "react";
import { Check, Link2 } from "lucide-react";

// Copies an absolute link. `path` is read at click time, so a list view can
// hand over its live query string.
export function CopyLinkButton({
  path,
  label,
  className,
  iconOnly,
}: {
  path: string | (() => string);
  label: string;
  className?: string;
  iconOnly?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    const target = typeof path === "function" ? path() : path;
    const url = new URL(target, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard blocked (insecure origin): select-and-copy fallback.
      const field = document.createElement("textarea");
      field.value = url;
      document.body.appendChild(field);
      field.select();
      document.execCommand("copy");
      field.remove();
    }
    setCopied(true);
  };

  return (
    <button
      type="button"
      className={className ?? "yt-button"}
      onClick={copy}
      aria-label={label}
      title={label}
      data-copied={copied || undefined}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
      {iconOnly ? null : <span>{copied ? "Link copied" : label}</span>}
    </button>
  );
}
