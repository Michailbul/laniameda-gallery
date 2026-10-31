"use client";

import { useState } from "react";
import {
  midjourneySettingFlags,
  type MidjourneyMetadata,
} from "@/lib/midjourney-metadata";

const MONO = "var(--font-mono), ui-monospace, monospace";

// Midjourney codes are case-sensitive, so nothing here is uppercased.
function CopyFlag({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={`Copy ${value}`}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      className="max-w-full cursor-copy break-all border px-1.5 py-[3px] text-left leading-tight"
      style={{
        fontFamily: MONO,
        fontSize: "10.5px",
        borderRadius: "2px",
        borderColor: "var(--lm-border)",
        background: "transparent",
        color: copied ? "var(--lm-coral)" : "var(--lm-text-secondary)",
      }}
    >
      {copied ? "Copied" : (label ?? value)}
    </button>
  );
}

const TYPE_LABEL = {
  moodboard: "Moodboard",
  profile: "Profile",
  unknown: "Code",
} as const;

export function MidjourneyMetadataBlock({ metadata }: { metadata: MidjourneyMetadata }) {
  const flags = midjourneySettingFlags(metadata);
  return (
    <div className="flex flex-col gap-2">
      {metadata.personalization.map((entry) => (
        <div key={entry.code} className="flex items-baseline justify-between gap-3">
          <span className="min-w-0" style={{ fontSize: "12px", color: "var(--lm-text-primary)" }}>
            <span style={{ color: "var(--lm-text-ghost)" }}>{TYPE_LABEL[entry.type]} </span>
            {entry.name}
          </span>
          <span className="flex-shrink-0">
            <CopyFlag value={`--profile ${entry.code}`} label={entry.code} />
          </span>
        </div>
      ))}
      {flags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {flags.map((flag) => <CopyFlag key={flag} value={flag} />)}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5" style={{ fontSize: "11px", color: "var(--lm-text-ghost)" }}>
        <span>Job</span>
        <CopyFlag value={metadata.jobId} label={metadata.jobId.slice(0, 8)} />
        {metadata.tileIndex !== undefined && <span>Tile {metadata.tileIndex + 1}</span>}
      </div>
    </div>
  );
}
