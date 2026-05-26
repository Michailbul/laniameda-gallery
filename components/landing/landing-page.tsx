"use client";

import { ArrowRight, Bookmark, Download, MessageSquare, Search, Sparkles } from "lucide-react";
import { TelegramLoginButton } from "@/components/telegram-login-button";
import { Button } from "@/components/ui/button";

interface LandingPageProps {
  onContinueAsGuest: () => void;
}

const PILLARS = [
  {
    title: "Save anything",
    description:
      "Prompts, generated images and videos, design references, multi-step workflows. One vault, organized by pillar.",
    icon: Bookmark,
  },
  {
    title: "Find it by vibe",
    description:
      "Semantic search runs across what the asset looks like, not just what it's tagged. Type a mood, get the right image.",
    icon: Search,
  },
  {
    title: "Built for agents",
    description:
      "Install the gallery skill into Claude Code, Codex, Cursor. Your agent reads from and writes to your vault directly.",
    icon: Sparkles,
  },
] as const;

export function LandingPage({ onContinueAsGuest }: LandingPageProps) {
  return (
    <div
      className="min-h-[100dvh] w-full overflow-y-auto"
      style={{ backgroundColor: "var(--lm-surface-0, var(--surface-0))" }}
    >
      <div className="mx-auto flex min-h-[100dvh] max-w-6xl flex-col px-6 py-10 lg:px-12 lg:py-16">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-[var(--coral)]" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--text-secondary)]">
              laniameda.gallery
            </span>
          </div>
          <button
            type="button"
            onClick={onContinueAsGuest}
            className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
          >
            Browse without an account →
          </button>
        </header>

        <main className="mt-16 flex flex-1 flex-col gap-16 lg:mt-24 lg:flex-row lg:items-start lg:gap-20">
          <section className="flex-1">
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.20em] text-[var(--text-secondary)]">
              <Sparkles className="size-3 text-[var(--coral)]" />
              AI creator&apos;s vault
            </span>
            <h1
              className="mt-6 text-balance text-4xl font-semibold leading-[1.05] tracking-tight text-[var(--text-primary)] lg:text-5xl"
              style={{ fontFamily: "var(--font-serif, var(--font-sans, inherit))" }}
            >
              Your prompts, images, and workflows — saved and queryable by any agent.
            </h1>
            <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-[var(--text-secondary)]">
              A personal gallery for the things you make with AI. Save with one tap from a
              browser extension or your agent. Find anything later by typing what it feels
              like. Hand the URL or copied ID back to your agent and pick up where you left off.
            </p>

            <div className="mt-10 flex flex-col gap-4 sm:max-w-md">
              <TelegramLoginButton size="large" />
              <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
                Telegram login is the only sign-in for now. We use it because it&apos;s fast
                and we never see a password. Email and OAuth are on the roadmap.
              </p>
            </div>

            <div className="mt-12 flex items-center gap-4 text-[11px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
              <span>Already have an account?</span>
              <span className="text-[var(--text-secondary)]">
                Same Telegram button — it logs you back in.
              </span>
            </div>
          </section>

          <aside className="flex w-full max-w-md flex-col gap-4 lg:sticky lg:top-12">
            {PILLARS.map((p) => {
              const Icon = p.icon;
              return (
                <div
                  key={p.title}
                  className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-1)] p-5"
                >
                  <div className="flex items-start gap-4">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[var(--coral)]/10 text-[var(--coral)]">
                      <Icon className="size-5" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-semibold text-[var(--text-primary)]">
                        {p.title}
                      </span>
                      <span className="text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
                        {p.description}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}

            <div className="rounded-2xl border border-dashed border-[var(--border-subtle)] bg-transparent p-5">
              <div className="flex items-start gap-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-2)] text-[var(--text-primary)]">
                  <Download className="size-5" />
                </div>
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-semibold text-[var(--text-primary)]">
                    Get the agent skill
                  </span>
                  <span className="text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
                    A small zip with two skill files — drop them into Claude Code, Codex, or
                    any agent that understands skill markdown.
                  </span>
                  <Button asChild size="sm" variant="outline" className="mt-1 w-fit">
                    <a
                      href="/api/skills/laniameda-gallery"
                      download="laniameda-gallery-skill.zip"
                    >
                      Download skill bundle
                      <ArrowRight className="ml-1 size-3.5" />
                    </a>
                  </Button>
                </div>
              </div>
            </div>
          </aside>
        </main>

        <footer className="mt-16 flex items-center justify-between border-t border-[var(--border-subtle)] pt-6 text-[10px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
          <span>laniameda studio · AI-native creative work</span>
          <span className="flex items-center gap-2">
            <MessageSquare className="size-3" />
            Built in public
          </span>
        </footer>
      </div>
    </div>
  );
}
