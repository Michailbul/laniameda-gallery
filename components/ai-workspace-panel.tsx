"use client";

import { X, Check, Circle, Loader2, Copy } from "lucide-react";
import { useState } from "react";

type AiWorkspacePanelProps = {
  open: boolean;
  actionLabel: string;
  runId?: string;
  loading: boolean;
  content: string;
  error?: string;
  onClose: () => void;
};

export function AiWorkspacePanel({
  open,
  actionLabel,
  runId,
  loading,
  content,
  error,
  onClose,
}: AiWorkspacePanelProps) {
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const handleCopy = async () => {
    if (!content) return;
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isDone = !loading && !error && content && content !== "No output yet.";

  return (
    <aside
      className="fixed right-0 top-0 z-[70] h-screen w-full max-w-[480px] animate-panel-slide-in xl:max-w-[540px] grain-overlay"
      style={{
        background: "linear-gradient(180deg, rgba(17,10,6,0.99) 0%, var(--surface-0) 40%, rgba(8,4,2,0.99) 100%)",
        borderLeft: "1px solid var(--border-subtle)",
        boxShadow: "-20px 0 60px -12px rgba(0, 0, 0, 0.6), -4px 0 20px rgba(255, 140, 66, 0.03)",
      }}
    >
      <div className="flex h-full flex-col">
        {/* Header */}
        <header
          className="flex items-center justify-between px-5 py-4"
          style={{
            borderBottom: "1px solid var(--border-subtle)",
            backgroundColor: isDone ? undefined : "transparent",
            animation: isDone ? "success-flash 400ms ease-out" : "none",
          }}
        >
          <div>
            <p className="text-micro" style={{ color: "var(--text-tertiary)" }}>
              AI Workspace
            </p>
            <h2
              className="mt-0.5 text-[15px] font-medium"
              style={{ color: "var(--text-primary)" }}
            >
              {isDone ? `${actionLabel} Ready` : actionLabel}
            </h2>
            {runId && (
              <p
                className="mt-0.5 font-mono text-[11px]"
                style={{ color: "var(--text-ghost)" }}
              >
                {runId}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
            style={{
              color: "var(--text-tertiary)",
              transitionDuration: "var(--duration-instant)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--text-primary)";
              e.currentTarget.style.backgroundColor = "var(--surface-2)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--text-tertiary)";
              e.currentTarget.style.backgroundColor = "transparent";
            }}
            aria-label="Close panel"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-auto p-5">
          {/* Status steps */}
          {loading && (
            <div className="mb-5 space-y-2.5">
              {[
                { label: "Analyzing reference...", done: true },
                { label: "Building prompt structure...", done: false },
                { label: "Generating output...", done: false },
              ].map((step, i) => (
                <div key={i} className="flex items-center gap-2.5">
                  {step.done ? (
                    <Check
                      className="h-3.5 w-3.5"
                      style={{ color: "var(--status-success)" }}
                    />
                  ) : i === 1 ? (
                    <Loader2
                      className="h-3.5 w-3.5 animate-spin"
                      style={{ color: "var(--status-running)" }}
                    />
                  ) : (
                    <Circle
                      className="h-3.5 w-3.5"
                      style={{ color: "var(--text-ghost)" }}
                    />
                  )}
                  <span
                    className="text-[13px]"
                    style={{
                      color: step.done
                        ? "var(--text-secondary)"
                        : i === 1
                          ? "var(--text-primary)"
                          : "var(--text-ghost)",
                    }}
                  >
                    {step.label}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Error */}
          {error && (
            <div
              className="mb-4 rounded-xl px-4 py-3 text-[13px]"
              style={{
                backgroundColor: "rgba(239, 68, 68, 0.08)",
                border: "1px solid rgba(239, 68, 68, 0.2)",
                borderLeft: "3px solid var(--status-error)",
                color: "var(--status-error)",
              }}
            >
              {error}
            </div>
          )}

          {/* Output */}
          <div
            className="relative rounded-xl p-4"
            style={{
              backgroundColor: "var(--surface-1)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <pre
              className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed"
              style={{ color: "var(--text-primary)" }}
            >
              {content || "No output yet."}
              {loading && (
                <span
                  className="animate-blink-cursor ml-0.5 inline-block h-[14px] w-[2px]"
                  style={{
                    backgroundColor: "var(--amber-9)",
                    verticalAlign: "text-bottom",
                  }}
                />
              )}
            </pre>
          </div>
        </div>

        {/* Footer actions */}
        {isDone && (
          <div
            className="flex items-center gap-2 px-5 py-4"
            style={{ borderTop: "1px solid var(--border-subtle)" }}
          >
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-medium transition-all active:scale-95"
              style={{
                background: "linear-gradient(135deg, var(--amber-9), var(--warm-accent))",
                color: "var(--amber-contrast)",
                boxShadow: "0 4px 16px rgba(255, 140, 66, 0.25)",
                transitionDuration: "var(--duration-fast)",
              }}
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copy Package
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
