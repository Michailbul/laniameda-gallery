"use client";

import { useCallback, useState } from "react";
import { Bookmark, Download, Search, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  ChoiceGroup,
  FeatureCarousel,
  Onboarding,
  TipsList,
  useOnboarding,
} from "@/components/ui/onboarding";
import { Button } from "@/components/ui/button";

const FEATURES = [
  {
    key: "save",
    title: "Save anything",
    description:
      "Drop in prompts, generated images, videos, design references, and full multi-step workflows. The gallery normalizes them and keeps the original artifact alongside.",
    icon: Bookmark,
  },
  {
    key: "search",
    title: "Find it later",
    description:
      "Semantic search runs across what your assets look like, not just what you tagged. Type a vibe — \"moody editorial portrait\" — and the model finds the right images.",
    icon: Search,
  },
  {
    key: "agent",
    title: "Agent-ready",
    description:
      "Install the gallery skill into Claude, Codex, or any agent. Ask the agent to save or fetch and it talks to your vault directly.",
    icon: Sparkles,
  },
] as const;

type RoleKey = "creator" | "engineer" | "designer" | "explorer";

const ROLES: Array<{ value: RoleKey; label: string; hint: string }> = [
  { value: "creator", label: "AI creator", hint: "images, video, prompts" },
  { value: "engineer", label: "Engineer", hint: "code + agentic workflows" },
  { value: "designer", label: "Designer", hint: "references, inspiration" },
  { value: "explorer", label: "Just exploring", hint: "no pressure" },
];

interface OnboardingModalProps {
  open: boolean;
  onCompleted: () => void;
  userName: string;
}

function FeaturesStep() {
  const { stepValue, setStepValue } = useOnboarding();
  return (
    <>
      <Onboarding.Header
        title="What it can do"
        description="Three things the gallery is built to make effortless."
      />
      <div className="mt-8">
        <FeatureCarousel
          value={stepValue}
          onValueChange={setStepValue}
          totalItems={FEATURES.length}
        >
          {FEATURES.map((f, i) => (
            <FeatureCarousel.Item key={f.key} index={i}>
              <div className="flex items-center gap-2">
                <f.icon className="size-4" />
                <span>{f.title}</span>
              </div>
            </FeatureCarousel.Item>
          ))}
        </FeatureCarousel>
        <div className="mt-6 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-6">
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
            {FEATURES[Math.min(stepValue, FEATURES.length - 1)].description}
          </p>
        </div>
      </div>
    </>
  );
}

export function OnboardingModal({
  open,
  onCompleted,
  userName,
}: OnboardingModalProps) {
  const [role, setRole] = useState<RoleKey | null>(null);
  const [skillDownloaded, setSkillDownloaded] = useState(false);
  const [completing, setCompleting] = useState(false);

  const handleComplete = useCallback(async () => {
    if (completing) return;
    setCompleting(true);
    try {
      await fetch("/api/auth/onboarding/complete", { method: "POST" });
    } catch {
      // non-blocking — onboarding is best-effort persistence
    } finally {
      onCompleted();
    }
  }, [completing, onCompleted]);

  const handleDownloadSkill = useCallback(() => {
    setSkillDownloaded(true);
  }, []);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          void handleComplete();
        }
      }}
    >
      <DialogContent
        className="max-w-2xl gap-0 overflow-hidden border-0 bg-[var(--surface-1)] p-0 text-[var(--text-primary)] sm:rounded-2xl"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Welcome to your gallery</DialogTitle>
        <DialogDescription className="sr-only">
          Quick tour of what laniameda.gallery does and how to use it with your AI agents.
        </DialogDescription>

        <Onboarding totalSteps={4} onComplete={handleComplete}>
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-8 pt-7 pb-5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--text-tertiary)]">
              laniameda.gallery
            </span>
            <Onboarding.StepIndicator variant="pills" />
          </div>

          <div className="min-h-[420px] px-8 py-10">
            <Onboarding.Step step={1}>
              <Onboarding.Header
                title={`Welcome${userName ? `, ${userName.split(" ")[0]}` : ""}.`}
                description="Your personal AI creatorship vault. Prompts, images, videos, workflows — all in one place, always queryable."
              />
              <div className="mt-8 grid gap-3">
                {FEATURES.map((f) => {
                  const Icon = f.icon;
                  return (
                    <div
                      key={f.key}
                      className="flex gap-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4"
                    >
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[var(--coral)]/10 text-[var(--coral)]">
                        <Icon className="size-5" />
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-sm font-semibold">{f.title}</span>
                        <span className="text-xs leading-relaxed text-[var(--text-secondary)]">
                          {f.description}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Onboarding.Step>

            <Onboarding.Step step={2}>
              <FeaturesStep />
            </Onboarding.Step>

            <Onboarding.Step step={3}>
              <Onboarding.Header
                title="Connect your agent"
                description="Download the gallery skill. Drop it into Claude Code, Codex, or any agent that understands skill markdown. Then ask the agent to save anything to your vault."
              />
              <div className="mt-8 flex flex-col gap-6">
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-6">
                  <div className="flex items-start gap-4">
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-[var(--coral)]/10 text-[var(--coral)]">
                      <Download className="size-6" />
                    </div>
                    <div className="flex flex-1 flex-col gap-3">
                      <div className="flex flex-col gap-1">
                        <span className="text-sm font-semibold">
                          laniameda-gallery-skill.zip
                        </span>
                        <span className="text-xs text-[var(--text-secondary)]">
                          Two skill files: <code>ingest</code> for saving,{" "}
                          <code>query</code> for retrieving. Plus a README on install.
                        </span>
                      </div>
                      <Button
                        asChild
                        size="sm"
                        variant={skillDownloaded ? "outline" : "default"}
                        onClick={handleDownloadSkill}
                      >
                        <a
                          href="/api/skills/laniameda-gallery"
                          download="laniameda-gallery-skill.zip"
                        >
                          {skillDownloaded ? "Downloaded — get it again" : "Download skill bundle"}
                        </a>
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-dashed border-[var(--border-subtle)] bg-transparent p-5">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                    Install
                  </p>
                  <pre className="mt-2 overflow-x-auto text-xs leading-relaxed text-[var(--text-secondary)]">
                    {`unzip laniameda-gallery-skill.zip -d ~/.claude/skills/`}
                  </pre>
                </div>
              </div>
            </Onboarding.Step>

            <Onboarding.Step step={4}>
              <Onboarding.Header
                title="You're ready"
                description="A few things worth knowing before you start saving."
              />
              <div className="mt-6 flex flex-col gap-6">
                <div>
                  <span className="text-[11px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                    Mostly here for…
                  </span>
                  <div className="mt-3">
                    <ChoiceGroup
                      name="role"
                      orientation="grid"
                      value={role ?? undefined}
                      onValueChange={(v) => setRole(v as RoleKey)}
                    >
                      {ROLES.map((r) => (
                        <ChoiceGroup.Item key={r.value} value={r.value}>
                          <div className="flex flex-col items-start gap-0.5 text-left">
                            <span className="text-sm font-medium">{r.label}</span>
                            <span className="text-[11px] text-[var(--text-tertiary)]">
                              {r.hint}
                            </span>
                          </div>
                        </ChoiceGroup.Item>
                      ))}
                    </ChoiceGroup>
                  </div>
                </div>

                <TipsList title="Quick tips">
                  <TipsList.Item number={1}>
                    Hover any asset card for a copy button — paste{" "}
                    <code>asset:abc123</code> to your agent to hand off context.
                  </TipsList.Item>
                  <TipsList.Item number={2}>
                    Use the search dock (top bar) to query by vibe, not by tag.
                    Type what the image feels like, not what it&apos;s called.
                  </TipsList.Item>
                  <TipsList.Item number={3}>
                    Tell your agent: &ldquo;Save this for my next creative project.&rdquo;
                    With the skill installed, it&apos;ll know where to put it.
                  </TipsList.Item>
                </TipsList>
              </div>
            </Onboarding.Step>
          </div>

          <div className="border-t border-[var(--border-subtle)] bg-[var(--surface-2)]/40 px-8 py-5">
            <Onboarding.Navigation
              backLabel="Back"
              nextLabel="Next"
              completeLabel="Start saving"
            />
          </div>
        </Onboarding>
      </DialogContent>
    </Dialog>
  );
}
