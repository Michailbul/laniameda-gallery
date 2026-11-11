"use client";

import Link from "next/link";
import { CopyLinkButton } from "@/components/youtube/copy-link-button";

/**
 * A world's way out to its pitch page, beside its name in the vault. The
 * clean address (/w/<slug>) is the one to send; opened by its signed-in owner
 * it shows this vault, so the page itself is one click away here and the
 * second half copies the address to send.
 */
export function WorldPitchLink({ path }: { path: string }) {
  return (
    <span
      className="ml-2 inline-flex shrink-0 items-stretch overflow-hidden"
      style={{
        borderRadius: "999px",
        border: "1.5px solid var(--lm-ink)",
        fontFamily: "var(--lm-font)",
        fontSize: "10px",
        fontWeight: 800,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      <Link
        href={`${path}?public=1`}
        data-pitch-open
        title="Open this world's pitch page as a visitor sees it. The plain address shows you the vault because you are signed in."
        className="inline-flex items-center gap-1 px-2.5 py-1 transition-opacity hover:opacity-85"
        style={{ background: "var(--lm-ink)", color: "var(--lm-paper)" }}
      >
        Pitch page
        <span aria-hidden style={{ fontSize: "12px", lineHeight: 1 }}>↗</span>
      </Link>
      <CopyLinkButton
        path={path}
        label="Copy pitch link"
        className="lm-pitch-copy inline-flex items-center gap-1 border-none px-2.5 py-1 transition-colors hover:text-[var(--lm-text-primary)]"
        style={{
          background: "var(--lm-surface-2)",
          color: "var(--lm-text-secondary)",
          font: "inherit",
          letterSpacing: "inherit",
          textTransform: "inherit",
          cursor: "pointer",
        }}
      />
    </span>
  );
}
