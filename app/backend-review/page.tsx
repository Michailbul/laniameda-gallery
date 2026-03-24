import type { Metadata } from "next";
import {
  ArrowRight,
  Bot,
  Database,
  FileCode2,
  Gauge,
  KeyRound,
  Link2,
  Network,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  backendReview,
  type ReviewFinding,
  type ReviewStatus,
  type ReviewTableGroup,
} from "@/lib/backend-review-data";

export const metadata: Metadata = {
  title: "Backend Review | Laniameda Gallery",
  description:
    "Schema, ingest, skill, and security review for the current laniameda.gallery backend.",
};

const severityOrder: Record<ReviewFinding["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  note: 3,
};

const severityStyles: Record<ReviewFinding["severity"], string> = {
  critical:
    "border-red-500/30 bg-red-500/12 text-red-700 dark:text-red-200",
  high:
    "border-orange-500/30 bg-orange-500/12 text-orange-700 dark:text-orange-200",
  medium:
    "border-amber-500/30 bg-amber-500/12 text-amber-700 dark:text-amber-200",
  note:
    "border-sky-500/30 bg-sky-500/12 text-sky-700 dark:text-sky-200",
};

const statusStyles: Record<ReviewStatus, string> = {
  solid:
    "border-emerald-500/30 bg-emerald-500/12 text-emerald-700 dark:text-emerald-200",
  mixed:
    "border-amber-500/30 bg-amber-500/12 text-amber-700 dark:text-amber-200",
  gap:
    "border-red-500/30 bg-red-500/12 text-red-700 dark:text-red-200",
};

const groupLabels: Record<ReviewTableGroup, string> = {
  content: "Content Model",
  search: "Search + Retrieval",
  operations: "Ops + Runtime",
};

const groupIcons: Record<ReviewTableGroup, LucideIcon> = {
  content: Database,
  search: ScanSearch,
  operations: Wrench,
};

const sectionLinks = [
  { href: "#map", label: "System map" },
  { href: "#schema", label: "Schema atlas" },
  { href: "#pillars", label: "Pillar framing" },
  { href: "#skills", label: "Skill chain" },
  { href: "#findings", label: "Risk register" },
  { href: "#plan", label: "Next moves" },
  { href: "#sources", label: "Sources" },
];

const sortedFindings = [...backendReview.findings].sort(
  (left, right) => severityOrder[left.severity] - severityOrder[right.severity],
);

const tablesByGroup = {
  content: backendReview.tables.filter((table) => table.group === "content"),
  search: backendReview.tables.filter((table) => table.group === "search"),
  operations: backendReview.tables.filter((table) => table.group === "operations"),
} satisfies Record<ReviewTableGroup, Array<(typeof backendReview.tables)[number]>>;

const criticalCount = backendReview.findings.filter(
  (finding) => finding.severity === "critical",
).length;
const highRiskCount = backendReview.findings.filter(
  (finding) => finding.severity === "critical" || finding.severity === "high",
).length;
const strengthCount = backendReview.strengths.length;
const preservationBoard = [
  {
    label: "Preserve",
    title: "Idempotent ingest",
    detail: backendReview.strengths[0]?.detail ?? "",
  },
  {
    label: "Preserve",
    title: "Repo-held contract",
    detail: backendReview.strengths[2]?.detail ?? "",
  },
  {
    label: "Expand",
    title: "Model depth by pillar",
    detail:
      "Designs already proves the value of a richer concept table. The question is whether creators and cars should gain their own concept model or share a generalized reference layer.",
  },
];

const pillarLayout: Record<(typeof backendReview.pillars)[number]["pillar"], string> = {
  creators: "xl:col-span-3",
  cars: "xl:col-span-3",
  designs: "xl:col-span-6",
  dump: "xl:col-span-12",
};

export default function BackendReviewPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(255,122,100,0.22),transparent_22%),radial-gradient(circle_at_top_right,rgba(93,107,250,0.18),transparent_20%),radial-gradient(circle_at_bottom_left,rgba(46,184,180,0.14),transparent_22%),linear-gradient(180deg,var(--surface-0),var(--surface-1))] text-[var(--text-primary)]">
      <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(to_right,rgba(32,23,16,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(32,23,16,0.06)_1px,transparent_1px)] [background-size:28px_28px]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[linear-gradient(180deg,rgba(255,255,255,0.18),transparent)]" />

      <div className="relative mx-auto max-w-[1500px] px-4 py-5 sm:px-6 md:px-8 lg:px-10">
        <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="space-y-4 lg:sticky lg:top-5 lg:h-fit">
            <section className="overflow-hidden rounded-[2rem] border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--surface-0)_78%,white_22%)] shadow-[var(--shadow-lg)] backdrop-blur-xl">
              <div className="h-1.5 bg-[linear-gradient(90deg,var(--pillar-creators),var(--pillar-designs),var(--pillar-dump))]" />
              <div className="space-y-5 px-5 py-5">
                <div className="flex items-center justify-between gap-3">
                  <Badge
                    variant="outline"
                    className="border-[var(--border-accent)] bg-[var(--accent-subtle)] text-[var(--text-primary)]"
                  >
                    Review rail
                  </Badge>
                  <Badge
                    variant="outline"
                    className={cn(
                      "capitalize",
                      highRiskCount > 0 ? severityStyles.critical : statusStyles.solid,
                    )}
                  >
                    {highRiskCount > 0 ? "needs hardening" : "healthy"}
                  </Badge>
                </div>
                <div className="flex items-end justify-between gap-3 text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--text-tertiary)]">
                  <span>Issue 03</span>
                  <span className="text-[var(--text-ghost)]">/backend-review</span>
                </div>
                <div>
                  <h2 className="font-display text-4xl leading-none text-[var(--text-primary)]">
                    backend
                    <span className="block text-[var(--text-tertiary)]">dossier</span>
                  </h2>
                  <p className="mt-4 text-sm leading-7 text-[var(--text-secondary)]">
                    A reading spine for the current schema, ingest contract, skill surface, and trust boundary.
                  </p>
                </div>
                <div className="grid gap-3">
                  <RailMetric
                    icon={Gauge}
                    label="Critical findings"
                    value={String(criticalCount)}
                    detail="Trust-boundary issues that should block expansion."
                  />
                  <RailMetric
                    icon={Database}
                    label="Schema surfaces"
                    value={String(backendReview.tables.length)}
                    detail="Core content, search, and runtime tables."
                  />
                  <RailMetric
                    icon={Sparkles}
                    label="Strong areas"
                    value={String(strengthCount)}
                    detail="Parts already worth preserving through a redesign."
                  />
                </div>
                <div className="rounded-[1.6rem] border border-[var(--border-default)] bg-[var(--surface-1)] p-4">
                  <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--text-tertiary)]">
                    Review pulse
                  </div>
                  <div className="mt-3 space-y-3">
                    <MeterRow label="Schema breadth" value={78} tone="var(--pillar-designs)" />
                    <MeterRow label="Contract clarity" value={82} tone="var(--pillar-creators)" />
                    <MeterRow label="Security confidence" value={26} tone="#dc2626" />
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-[2rem] border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--surface-0)_82%,white_18%)] p-4 shadow-[var(--shadow-md)]">
              <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--text-tertiary)]">
                Navigate
              </div>
              <nav className="mt-4 grid gap-2">
                {sectionLinks.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    className="group flex items-center justify-between rounded-2xl border border-[var(--border-default)] bg-[var(--surface-0)] px-4 py-3 text-sm font-medium text-[var(--text-primary)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--border-accent)] hover:bg-[var(--surface-1)]"
                  >
                    <span>{link.label}</span>
                    <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                  </a>
                ))}
              </nav>
            </section>

            <section className="rounded-[2rem] border border-[var(--border-default)] bg-[var(--bg-inverse)] p-4 text-[var(--text-inverse)] shadow-[var(--shadow-sharp)]">
              <div className="text-[11px] uppercase tracking-[0.22em] text-white/60">
                Most urgent
              </div>
              <ul className="mt-3 space-y-3 text-sm leading-6 text-white/86">
                {sortedFindings.slice(0, 3).map((finding) => (
                  <li key={finding.title} className="flex gap-2">
                    <span className="mt-2 h-1.5 w-1.5 rounded-full bg-[var(--coral)]" />
                    <span>{finding.title}</span>
                  </li>
                ))}
              </ul>
            </section>
          </aside>

          <div className="space-y-10">
            <section className="relative overflow-hidden rounded-[2.8rem] border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--surface-0)_72%,white_28%)] shadow-[var(--shadow-lg)] backdrop-blur-xl">
              <div className="pointer-events-none absolute inset-y-0 left-[44%] hidden w-px bg-[linear-gradient(180deg,transparent,rgba(32,23,16,0.12),transparent)] xl:block" />
              <div className="pointer-events-none absolute -left-14 top-10 h-52 w-52 rounded-full bg-[color:color-mix(in_srgb,var(--coral)_18%,transparent)] blur-3xl" />
              <div className="pointer-events-none absolute right-0 top-0 h-64 w-64 rounded-full bg-[color:color-mix(in_srgb,var(--pillar-designs)_16%,transparent)] blur-3xl" />
              <div className="pointer-events-none absolute inset-0 opacity-[0.08] [background-image:linear-gradient(90deg,var(--text-primary)_1px,transparent_1px),linear-gradient(var(--text-primary)_1px,transparent_1px)] [background-size:24px_24px]" />

              <div className="relative px-6 py-7 md:px-8 lg:px-10">
                <div className="grid gap-6 xl:grid-cols-[1.18fr_0.82fr] xl:items-start">
                  <div className="grid gap-6">
                    <div className="flex flex-wrap items-center gap-3">
                      <Badge
                        variant="outline"
                        className="border-[var(--border-accent)] bg-[var(--accent-subtle)] text-[var(--text-primary)]"
                      >
                        Repo-backed review
                      </Badge>
                      <Badge
                        variant="outline"
                        className="border-[var(--border-default)] bg-[var(--surface-1)] text-[var(--text-secondary)]"
                      >
                        Reviewed {backendReview.reviewedOn}
                      </Badge>
                    </div>
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.34em] text-[var(--text-tertiary)]">
                        architecture folio / backend clarity pass
                      </div>
                      <h1 className="mt-4 max-w-5xl font-display text-5xl italic leading-[0.9] tracking-[-0.035em] md:text-7xl">
                        {backendReview.title}
                      </h1>
                      <p className="mt-6 max-w-3xl text-base leading-8 text-[var(--text-secondary)] md:text-lg">
                        {backendReview.summary}
                      </p>
                    </div>
                    <ArchitectureRibbon />
                  </div>

                  <div className="grid gap-4">
                    <Card className="rounded-[2rem] border-white/10 bg-[rgba(24,24,27,0.96)] text-[var(--text-inverse)] shadow-[var(--shadow-elevated)]">
                      <CardHeader className="pb-4">
                        <div className="flex items-center justify-between gap-3">
                          <CardTitle className="flex items-center gap-3 text-2xl">
                            <Network className="h-5 w-5 text-[var(--coral)]" />
                            Backend pulse
                          </CardTitle>
                          <Badge
                            variant="outline"
                            className="border-white/12 bg-white/6 text-white/80"
                          >
                            Live repo view
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="grid gap-3 sm:grid-cols-2">
                        <DarkMetric value={String(backendReview.tables.length)} label="schema surfaces" />
                        <DarkMetric value={String(backendReview.pillars.length)} label="pillars" />
                        <DarkMetric value={String(backendReview.skillSurface.length)} label="skill artifacts" />
                        <DarkMetric value={String(criticalCount)} label="critical findings" />
                      </CardContent>
                    </Card>

                    <div className="grid gap-3 md:grid-cols-3">
                      <HeroStrip
                        label="Model"
                        title="16 tables in play"
                        detail="Enough structure to support real work already, especially around ingest, retrieval, and observability."
                      />
                      <HeroStrip
                        label="Gap"
                        title={`${highRiskCount} high-risk issues`}
                        detail="The backend’s weak point is the trust boundary, not lack of stored detail."
                      />
                      <HeroStrip
                        label="Focus"
                        title="Security before expansion"
                        detail="Lock access down first, then decide whether concepts and references deserve richer shared models."
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-6 grid gap-4 xl:grid-cols-[1.04fr_0.96fr]">
                  <Card className="overflow-hidden rounded-[2.2rem] border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--surface-0)_84%,white_16%)] shadow-[var(--shadow-lg)]">
                    <CardHeader className="pb-2">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--text-tertiary)]">
                        Central read
                      </div>
                      <CardTitle className="mt-4 max-w-3xl font-display text-4xl italic leading-[0.96] tracking-[-0.03em]">
                        The schema is already useful. The trust boundary is what needs redesign.
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-3 lg:grid-cols-[1.08fr_0.92fr]">
                      <div className="rounded-[1.8rem] border border-[var(--border-default)] bg-[var(--surface-1)] p-5 shadow-[var(--shadow-md)]">
                        <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--text-tertiary)]">
                          Design principle
                        </div>
                        <p className="mt-4 font-display text-3xl italic leading-[1.02] text-[var(--text-primary)]">
                          Preserve the ingest contract and the indexed model. Move authentication out of caller-selected fields.
                        </p>
                        <p className="mt-4 text-sm leading-7 text-[var(--text-secondary)]">
                          The backend already knows how to store, reindex, and organize useful material. The redesign should make trust explicit before the model grows wider.
                        </p>
                      </div>
                      <div className="grid gap-3">
                        {preservationBoard.map((note) => (
                          <VerdictNote
                            key={note.title}
                            label={note.label}
                            title={note.title}
                            detail={note.detail}
                          />
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="overflow-hidden rounded-[2.2rem] border-[var(--border-default)] bg-[var(--bg-inverse)] text-[var(--text-inverse)] shadow-[var(--shadow-elevated)]">
                    <CardHeader className="pb-4">
                      <CardTitle className="flex items-center gap-3 text-2xl">
                        <ShieldAlert className="h-5 w-5 text-[var(--coral)]" />
                        Fault line
                      </CardTitle>
                      <p className="max-w-xl text-sm leading-7 text-white/72">
                        The browser has a proper Telegram session, but direct public Convex functions still trust caller-supplied ownership fields. That mismatch is the architectural fault line.
                      </p>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {backendReview.authLayers.map((layer, index) => (
                        <BoundaryLayer
                          key={layer.title}
                          index={index}
                          total={backendReview.authLayers.length}
                          title={layer.title}
                          detail={layer.detail}
                          status={layer.status}
                        />
                      ))}
                      <div className="rounded-[1.5rem] border border-white/10 bg-white/6 p-4">
                        <div className="text-[11px] uppercase tracking-[0.22em] text-white/56">
                          Remember
                        </div>
                        <p className="mt-2 text-sm leading-6 text-white/88">
                          If the browser can choose <code className="rounded bg-white/8 px-1 py-0.5">ownerUserId</code>,
                          then the browser is effectively the auth system.
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
              <Card className="overflow-hidden rounded-[2.2rem] border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--surface-0)_74%,white_26%)] shadow-[var(--shadow-lg)]">
                <CardHeader>
                  <CardTitle className="flex items-center gap-3 text-2xl">
                    <Sparkles className="h-5 w-5" />
                    What should survive the hardening pass
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 lg:grid-cols-2">
                  {backendReview.strengths.map((strength) => (
                    <StrengthCard
                      key={strength.title}
                      title={strength.title}
                      detail={strength.detail}
                      source={strength.source}
                    />
                  ))}
                </CardContent>
              </Card>

              <Card className="overflow-hidden rounded-[2.2rem] border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--surface-0)_70%,white_30%)] shadow-[var(--shadow-lg)]">
                <CardHeader>
                  <CardTitle className="flex items-center gap-3 text-2xl">
                    <KeyRound className="h-5 w-5" />
                    Reading stance
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-[1.6rem] border border-[var(--border-default)] bg-[var(--surface-1)] p-5">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--text-tertiary)]">
                      The design thesis
                    </div>
                    <p className="mt-3 font-display text-3xl italic leading-tight text-[var(--text-primary)]">
                      Preserve the ingest contract. Redesign who is allowed to call what.
                    </p>
                  </div>
                  <div className="grid gap-3">
                    <ReadingCard
                      label="Strongest signal"
                      title="The browser route layer is safer than the direct Convex boundary"
                      detail="The Next.js wrappers derive owner identity from the session correctly. The gap appears when the browser bypasses those wrappers and talks to public Convex functions directly."
                    />
                    <ReadingCard
                      label="Schema question"
                      title="Designs already wants concept-level modeling"
                      detail="designInspirations proves that prompts and assets are not always enough. The next design question is whether that richer model should stay pillar-specific or generalize into a broader concept layer."
                    />
                    <ReadingCard
                      label="Operational note"
                      title="Observability exists, but protection is uneven"
                      detail="There are already good failure and runtime tables. Some of them just need stronger access control before they become part of a hardened internal toolchain."
                    />
                  </div>
                </CardContent>
              </Card>
            </section>

            <section id="map" className="scroll-mt-24">
              <SectionLead
                index="01"
                eyebrow="System Map"
                title="The architecture, visualized as a working stack"
                description="Three lanes matter: ingest, route-backed browser management, and retrieval/search. Each is different, and that difference is exactly why the auth model needs cleanup."
              />
              <div className="mt-6 grid gap-4 xl:grid-cols-3">
                {backendReview.flows.map((flow) => (
                  <FlowLane key={flow.title} title={flow.title} summary={flow.summary} steps={flow.steps} />
                ))}
              </div>
              <div className="mt-4 rounded-[2.2rem] border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--surface-0)_76%,white_24%)] p-5 shadow-[var(--shadow-lg)]">
                <div className="grid gap-4 xl:grid-cols-[0.38fr_0.62fr] xl:items-start">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.26em] text-[var(--text-tertiary)]">
                      Cross-lane read
                    </div>
                    <h3 className="mt-3 font-display text-3xl italic leading-[0.98] tracking-[-0.02em]">
                      The ingest lane is the cleanest. The browser lane is where trust becomes ambiguous.
                    </h3>
                    <p className="mt-4 text-sm leading-7 text-[var(--text-secondary)]">
                      That is why the right fix order is not “add more fields.” It is “make the actor boundary explicit, then decide what new content concepts deserve promotion.”
                    </p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    {backendReview.authLayers.map((layer) => (
                      <ReadingCard
                        key={layer.title}
                        label={layer.status}
                        title={layer.title}
                        detail={layer.detail}
                        dark={layer.status === "gap"}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section id="schema" className="scroll-mt-24">
              <SectionLead
                index="02"
                eyebrow="Schema Atlas"
                title="The database model laid out as a designed map"
                description="Grouped by what the rows are for, not just by filename. This makes it easier to discuss whether the current model is enough or whether some concepts deserve promotion."
              />
              <div className="mt-6 space-y-8">
                {(Object.keys(tablesByGroup) as ReviewTableGroup[]).map((group) => {
                  const GroupIcon = groupIcons[group];
                  return (
                    <div
                      key={group}
                      className={cn(
                        "rounded-[2.4rem] border p-5 shadow-[var(--shadow-lg)] md:p-6",
                        group === "content"
                          ? "border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--surface-0)_78%,white_22%)]"
                          : group === "search"
                            ? "border-[color:color-mix(in_srgb,var(--pillar-designs)_18%,var(--border-default))] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--surface-0)_82%,white_18%),color-mix(in_srgb,var(--pillar-designs)_8%,white_92%))]"
                            : "border-[color:color-mix(in_srgb,var(--coral)_16%,var(--border-default))] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--surface-0)_82%,white_18%),color-mix(in_srgb,var(--coral)_8%,white_92%))]",
                      )}
                    >
                      <div className="mb-5 flex items-end justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-12 w-12 items-center justify-center rounded-[1.4rem] bg-[var(--accent-subtle)] text-[var(--text-primary)] shadow-[var(--shadow-md)]">
                            <GroupIcon className="h-5 w-5" />
                          </div>
                          <div>
                            <h2 className="font-display text-3xl leading-none">
                              {groupLabels[group]}
                            </h2>
                            <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                              {group === "content"
                                ? "Saved knowledge itself: prompts, media, tags, folders, and pillar-specific reference structure."
                                : group === "search"
                                  ? "Generated retrieval structures that mirror source rows and carry embedding state."
                                  : "Auth-adjacent state, failure logs, canvas layout, and AI runtime observability."}
                            </p>
                          </div>
                        </div>
                        <Badge
                          variant="outline"
                          className="border-[var(--border-default)] bg-[var(--surface-1)] text-[var(--text-secondary)]"
                        >
                          {tablesByGroup[group].length} entries
                        </Badge>
                      </div>

                      <div className="grid gap-4 xl:grid-cols-2">
                        {tablesByGroup[group].map((table) => (
                          <Card
                            key={table.name}
                            className="overflow-hidden rounded-[2rem] border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--surface-0)_84%,white_16%)] shadow-[var(--shadow-lg)]"
                          >
                            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--surface-1)] px-5 py-4">
                              <div>
                                <div className="text-xs uppercase tracking-[0.22em] text-[var(--text-tertiary)]">
                                  {table.ownership}
                                </div>
                                <div className="mt-1 text-xl font-semibold text-[var(--text-primary)]">
                                  {table.name}
                                </div>
                                <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--text-secondary)]">
                                  {table.purpose}
                                </p>
                              </div>
                              <Badge
                                variant="outline"
                                className="border-[var(--border-default)] bg-[var(--surface-0)] text-[var(--text-secondary)]"
                              >
                                {groupLabels[group]}
                              </Badge>
                            </div>
                            <CardContent className="grid gap-5 px-5 py-5 md:grid-cols-3">
                              <SchemaColumn title="Key fields" items={table.keyFields} />
                              <SchemaColumn title="Indexes" items={table.indexes} />
                              <SchemaColumn title="Relationships" items={table.relationships} />
                            </CardContent>
                            <div className="border-t border-[var(--border-subtle)] px-5 py-3 text-[11px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                              {table.source}
                            </div>
                          </Card>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section id="pillars" className="scroll-mt-24">
              <SectionLead
                index="03"
                eyebrow="Pillar Framing"
                title="What the model can express per pillar today"
                description="This is where the asymmetry becomes visible. Designs already has a richer concept layer. Creators and cars still mostly express themselves through prompt profiles, assets, and tags."
              />
              <div className="mt-6 grid gap-4 xl:grid-cols-12">
                {backendReview.pillars.map((pillar) => (
                  <PillarPoster
                    key={pillar.pillar}
                    pillar={pillar}
                    className={pillarLayout[pillar.pillar]}
                  />
                ))}
              </div>
            </section>

            <section id="skills" className="scroll-mt-24">
              <SectionLead
                index="04"
                eyebrow="Skill Chain"
                title="Why the ingest contract is one of the strongest parts of the system"
                description="The skill is checked into the repo, points back to the canonical schema files, and already supports create, update, and delete. That is the right shape; it just needs a safer backend under it."
              />
              <div className="mt-6 grid gap-4 xl:grid-cols-[1.06fr_0.94fr]">
                <Card className="overflow-hidden rounded-[2.2rem] border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--surface-0)_76%,white_24%)] shadow-[var(--shadow-lg)]">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-3 text-2xl">
                      <Bot className="h-5 w-5" />
                      Contract surfaces
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-3">
                    {backendReview.skillSurface.map((item, index) => (
                      <div key={item.name}>
                        <SkillArtifactCard item={item} index={index} />
                        {index < backendReview.skillSurface.length - 1 ? (
                          <div className="flex items-center justify-center py-2 text-[var(--text-ghost)]">
                            <ArrowRight className="h-4 w-4" />
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card className="overflow-hidden rounded-[2.2rem] border-[var(--border-default)] bg-[rgba(24,24,27,0.98)] text-[var(--text-inverse)] shadow-[var(--shadow-elevated)]">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-3 text-2xl">
                      <Sparkles className="h-5 w-5 text-[var(--coral)]" />
                      Why this structure is worth keeping
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-4">
                    <div className="rounded-[1.6rem] border border-white/10 bg-white/6 p-5">
                      <div className="text-[11px] uppercase tracking-[0.22em] text-white/56">
                        Contract lesson
                      </div>
                      <p className="mt-3 font-display text-3xl italic leading-tight text-white">
                        Keep the agent-facing surface stable, but move trust decisions out of client-controlled args.
                      </p>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {backendReview.strengths.slice(0, 4).map((strength) => (
                        <div
                          key={strength.title}
                          className="rounded-[1.5rem] border border-white/10 bg-white/6 p-4"
                        >
                          <div className="text-sm font-semibold text-white">
                            {strength.title}
                          </div>
                          <p className="mt-3 text-sm leading-6 text-white/72">
                            {strength.detail}
                          </p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </section>

            <section id="findings" className="scroll-mt-24">
              <SectionLead
                index="05"
                eyebrow="Risk Register"
                title="The issues to resolve before calling this backend hardened"
                description="Ordered by severity. The top findings are architectural enough that they should shape the next implementation cycle."
              />
              <div className="mt-6 grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
                <div className="xl:sticky xl:top-24 xl:h-fit">
                  <Card className="overflow-hidden rounded-[2.2rem] border-[var(--border-default)] bg-[var(--bg-inverse)] text-[var(--text-inverse)] shadow-[var(--shadow-elevated)]">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-3 text-2xl">
                        <ShieldAlert className="h-5 w-5 text-[var(--coral)]" />
                        Risk ledger
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="rounded-[1.6rem] border border-white/10 bg-white/6 p-4">
                        <div className="text-[11px] uppercase tracking-[0.22em] text-white/56">
                          Reading note
                        </div>
                        <p className="mt-3 font-display text-3xl italic leading-tight text-white">
                          The first three issues are not bugs around the architecture. They are the architecture.
                        </p>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                        <DarkMetric value={String(criticalCount)} label="critical issues" />
                        <DarkMetric value={String(highRiskCount)} label="high-risk issues" />
                      </div>
                      <div className="rounded-[1.6rem] border border-white/10 bg-white/6 p-4">
                        <div className="text-[11px] uppercase tracking-[0.22em] text-white/56">
                          Fix order
                        </div>
                        <div className="mt-3 space-y-3">
                          <FixOrderCard
                            step="01"
                            text="Remove client-selected ownership from public call paths."
                          />
                          <FixOrderCard
                            step="02"
                            text="Split public-safe reads from private authenticated reads."
                          />
                          <FixOrderCard
                            step="03"
                            text="Only then expand schema breadth or richer concept models."
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
                <div className="space-y-4">
                  {sortedFindings.map((finding, index) => (
                    <FindingPanel key={finding.title} finding={finding} index={index + 1} />
                  ))}
                </div>
              </div>
            </section>

            <section id="plan" className="scroll-mt-24">
              <SectionLead
                index="06"
                eyebrow="Next Moves"
                title="The fix order that makes sense"
                description="Security first, contract cleanup second, schema expansion third. This keeps the next iteration coherent instead of mixing trust-boundary work with content-model changes."
              />
              <div className="mt-6 grid gap-4 lg:grid-cols-3">
                {backendReview.tracks.map((track) => (
                  <Card
                    key={track.phase}
                    className="rounded-[2rem] border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--surface-0)_76%,white_24%)] shadow-[var(--shadow-lg)]"
                  >
                    <CardHeader>
                      <CardTitle className="font-display text-3xl leading-none">
                        {track.phase}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <BulletList items={track.items} />
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="mt-6 grid gap-4 lg:grid-cols-3">
                {backendReview.questions.map((question) => (
                  <Card
                    key={question.title}
                    className="rounded-[2rem] border-[var(--border-default)] bg-[var(--bg-inverse)] text-[var(--text-inverse)] shadow-[var(--shadow-elevated)]"
                  >
                    <CardHeader>
                      <CardTitle className="text-xl text-white">{question.title}</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm leading-7 text-white/76">
                      {question.detail}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>

            <section id="sources" className="scroll-mt-24">
              <SectionLead
                index="07"
                eyebrow="Sources"
                title="The files this review is grounded in"
                description="This page stays useful only if it stays anchored to actual code. These are the repo files it was built from."
              />
              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                {backendReview.sources.map((source) => (
                  <Card
                    key={source.path}
                    className="rounded-[2rem] border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--surface-0)_76%,white_24%)] shadow-[var(--shadow-lg)]"
                  >
                    <CardHeader>
                      <CardTitle className="flex items-center gap-3 text-lg">
                        <Link2 className="h-4 w-4" />
                        <span>{source.path}</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm leading-7 text-[var(--text-secondary)]">
                      {source.purpose}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}

function SectionLead({
  index,
  eyebrow,
  title,
  description,
}: {
  index: string;
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-[88px_minmax(0,1fr)] md:items-start">
      <div className="flex items-end gap-3 md:block">
        <div className="font-display text-5xl italic leading-none text-[color:color-mix(in_srgb,var(--coral)_72%,white_28%)] md:text-6xl">
          {index}
        </div>
        <div className="mb-1 h-px flex-1 bg-[var(--border-default)] md:mt-4 md:w-12 md:flex-none" />
      </div>
      <div className="max-w-3xl">
        <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--text-tertiary)]">
          {eyebrow}
        </div>
        <h2 className="mt-3 font-display text-4xl italic leading-[0.98] tracking-[-0.02em] md:text-5xl">
          {title}
        </h2>
        <p className="mt-4 text-base leading-8 text-[var(--text-secondary)]">
          {description}
        </p>
      </div>
    </div>
  );
}

function ArchitectureRibbon() {
  const nodes = [
    {
      title: "Agent ingest",
      detail: "Telegram, OpenClaw, skill contract, Convex ingest.",
      icon: Bot,
    },
    {
      title: "Browser management",
      detail: "Telegram session cookie, Next.js wrappers, dashboard controls.",
      icon: KeyRound,
    },
    {
      title: "Retrieval and search",
      detail: "Convex reads, public gallery filters, semantic search hydration.",
      icon: ScanSearch,
    },
  ];

  return (
    <div className="rounded-[2.1rem] border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--surface-0)_84%,white_16%)] p-4 shadow-[var(--shadow-md)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--text-tertiary)]">
          Working stack
        </div>
        <Badge
          variant="outline"
          className="border-[color:color-mix(in_srgb,var(--coral)_20%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--coral)_8%,white_92%)] text-[var(--text-primary)]"
        >
          Trust gap sits between browser and public Convex
        </Badge>
      </div>
      <div className="mt-4 grid gap-3 xl:grid-cols-[1fr_auto_1fr_auto_1fr] xl:items-center">
        {nodes.map((node, index) => {
          const Icon = node.icon;
          return (
            <div key={node.title} className="contents">
              <div className="rounded-[1.6rem] border border-[var(--border-default)] bg-[var(--surface-1)] p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-[1rem] bg-[var(--accent-subtle)] text-[var(--text-primary)]">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-[var(--text-primary)]">{node.title}</div>
                    <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">{node.detail}</p>
                  </div>
                </div>
              </div>
              {index < nodes.length - 1 ? (
                <div className="hidden xl:flex xl:items-center xl:justify-center">
                  <ArrowRight className="h-5 w-5 text-[var(--text-ghost)]" />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RailMetric({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-[1.5rem] border border-[var(--border-default)] bg-[var(--surface-1)] p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
            {label}
          </div>
          <div className="mt-2 text-3xl font-semibold leading-none text-[var(--text-primary)]">
            {value}
          </div>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-[1rem] bg-[var(--accent-subtle)] text-[var(--text-primary)]">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
        {detail}
      </p>
    </div>
  );
}

function VerdictNote({
  label,
  title,
  detail,
}: {
  label: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="rounded-[1.6rem] border border-[var(--border-default)] bg-[var(--surface-1)] p-4">
      <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--text-tertiary)]">
        {label}
      </div>
      <div className="mt-2 text-lg font-semibold leading-tight text-[var(--text-primary)]">
        {title}
      </div>
      <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">{detail}</p>
    </div>
  );
}

function FixOrderCard({
  step,
  text,
}: {
  step: string;
  text: string;
}) {
  return (
    <div className="rounded-[1.4rem] border border-white/10 bg-black/18 p-4">
      <div className="text-[11px] uppercase tracking-[0.22em] text-white/52">{step}</div>
      <p className="mt-2 text-sm leading-6 text-white/84">{text}</p>
    </div>
  );
}

function MeterRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3 text-xs uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
        <span>{label}</span>
        <span>{value}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-3)]">
        <div
          className="h-full rounded-full"
          style={{
            width: `${value}%`,
            background: `linear-gradient(90deg, ${tone}, color-mix(in srgb, ${tone} 56%, white 44%))`,
          }}
        />
      </div>
    </div>
  );
}

function BoundaryLayer({
  index,
  total,
  title,
  detail,
  status,
}: {
  index: number;
  total: number;
  title: string;
  detail: string;
  status: ReviewStatus;
}) {
  return (
    <div>
      <div className="rounded-[1.5rem] border border-white/10 bg-white/6 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-white">{title}</div>
          <Badge variant="outline" className={cn("capitalize", statusStyles[status])}>
            {status}
          </Badge>
        </div>
        <p className="mt-3 text-sm leading-6 text-white/74">{detail}</p>
      </div>
      {index < total - 1 ? (
        <div className="flex justify-center py-2 text-white/28">
          <ArrowRight className="h-4 w-4 rotate-90" />
        </div>
      ) : null}
    </div>
  );
}

function HeroStrip({
  label,
  title,
  detail,
}: {
  label: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="rounded-[1.6rem] border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--surface-0)_82%,white_18%)] p-4 shadow-[var(--shadow-md)]">
      <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--text-tertiary)]">
        {label}
      </div>
      <div className="mt-2 text-lg font-semibold leading-tight text-[var(--text-primary)]">
        {title}
      </div>
      <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
        {detail}
      </p>
    </div>
  );
}

function ReadingCard({
  label,
  title,
  detail,
  dark = false,
}: {
  label: string;
  title: string;
  detail: string;
  dark?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-[1.5rem] border p-4 shadow-[var(--shadow-md)]",
        dark
          ? "border-white/10 bg-[var(--bg-inverse)] text-[var(--text-inverse)]"
          : "border-[var(--border-default)] bg-[var(--surface-1)] text-[var(--text-primary)]",
      )}
    >
      <div
        className={cn(
          "text-[11px] uppercase tracking-[0.22em]",
          dark ? "text-white/56" : "text-[var(--text-tertiary)]",
        )}
      >
        {label}
      </div>
      <div className={cn("mt-2 text-lg font-semibold leading-tight", dark ? "text-white" : "text-[var(--text-primary)]")}>
        {title}
      </div>
      <p className={cn("mt-3 text-sm leading-6", dark ? "text-white/74" : "text-[var(--text-secondary)]")}>
        {detail}
      </p>
    </div>
  );
}

function DarkMetric({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  return (
    <div className="rounded-[1.4rem] border border-white/10 bg-white/6 p-4">
      <div className="text-3xl font-semibold leading-none text-white">{value}</div>
      <div className="mt-2 text-[11px] uppercase tracking-[0.22em] text-white/56">
        {label}
      </div>
    </div>
  );
}

function SkillArtifactCard({
  item,
  index,
}: {
  item: (typeof backendReview.skillSurface)[number];
  index: number;
}) {
  return (
    <div className="rounded-[1.6rem] border border-[var(--border-default)] bg-[var(--surface-1)] p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent-subtle)] text-xs font-semibold text-[var(--text-primary)]">
          {index + 1}
        </div>
        <div>
          <div className="text-sm font-semibold text-[var(--text-primary)]">{item.name}</div>
          <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{item.role}</p>
          <div className="mt-3 text-[11px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
            {item.source}
          </div>
        </div>
      </div>
    </div>
  );
}

function StrengthCard({
  title,
  detail,
  source,
}: {
  title: string;
  detail: string;
  source: string;
}) {
  return (
    <div className="rounded-[1.6rem] border border-[var(--border-default)] bg-[var(--surface-1)] p-4">
      <div className="text-sm font-semibold text-[var(--text-primary)]">{title}</div>
      <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">{detail}</p>
      <div className="mt-4 text-[11px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
        {source}
      </div>
    </div>
  );
}

function FlowLane({
  title,
  summary,
  steps,
}: {
  title: string;
  summary: string;
  steps: (typeof backendReview.flows)[number]["steps"];
}) {
  return (
    <div className="rounded-[2.1rem] border border-[var(--border-default)] bg-[rgba(24,24,27,0.98)] p-5 text-[var(--text-inverse)] shadow-[var(--shadow-elevated)]">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[1rem] bg-white/8 text-white">
          {title.includes("agent") ? (
            <Bot className="h-4 w-4 text-[var(--coral)]" />
          ) : title.includes("Browser") ? (
            <KeyRound className="h-4 w-4 text-[var(--coral)]" />
          ) : (
            <ScanSearch className="h-4 w-4 text-[var(--coral)]" />
          )}
        </div>
        <div>
          <div className="text-lg font-semibold text-white">{title}</div>
          <div className="mt-1 text-sm leading-6 text-white/62">{summary}</div>
        </div>
      </div>
      <div className="mt-5 space-y-3">
        {steps.map((step, index) => (
          <div key={`${title}-${step.label}`}>
            <div className="rounded-[1.5rem] border border-white/10 bg-black/18 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-white">
                  {index + 1}
                </div>
                <div className="text-sm font-semibold text-white">{step.label}</div>
              </div>
              <p className="mt-3 text-sm leading-6 text-white/72">{step.detail}</p>
              <div className="mt-3 text-[11px] uppercase tracking-[0.16em] text-white/42">
                {step.source}
              </div>
            </div>
            {index < steps.length - 1 ? (
              <div className="flex justify-center py-2 text-white/30">
                <ArrowRight className="h-4 w-4" />
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function SchemaColumn({
  title,
  items,
}: {
  title: string;
  items: string[];
}) {
  return (
    <div>
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
        {title}
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <Badge
            key={item}
            variant="outline"
            className="h-auto rounded-2xl border-[var(--border-default)] bg-[var(--surface-1)] px-3 py-1.5 text-left text-[11px] leading-5 text-[var(--text-secondary)]"
          >
            {item}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function PillarPoster({
  pillar,
  className,
}: {
  pillar: (typeof backendReview.pillars)[number];
  className?: string;
}) {
  return (
    <Card
      className={cn(
        "relative overflow-hidden rounded-[2.2rem] border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--surface-0)_74%,white_26%)] shadow-[var(--shadow-lg)]",
        className,
      )}
    >
      <div
        className="pointer-events-none absolute -right-10 -top-8 h-32 w-32 rounded-full blur-2xl"
        style={{
          backgroundColor: pillar.accent,
          opacity: 0.22,
        }}
      />
      <div
        className="pointer-events-none absolute left-0 top-0 h-2 w-full"
        style={{
          background: `linear-gradient(90deg, ${pillar.accent}, transparent)`,
        }}
      />
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <Badge
            variant="outline"
            className="border-[var(--border-default)] bg-[var(--surface-1)] text-[var(--text-secondary)]"
          >
            {pillar.primaryRecords.length} record types
          </Badge>
          <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--text-tertiary)]">
            pillar
          </div>
        </div>
        <CardTitle className="mt-2 font-display text-4xl capitalize leading-none">
          {pillar.pillar}
        </CardTitle>
        <p className="text-sm leading-7 text-[var(--text-secondary)]">
          {pillar.summary}
        </p>
      </CardHeader>
      <CardContent
        className={cn(
          "grid gap-4",
          pillar.pillar === "designs" ? "lg:grid-cols-[0.95fr_1.05fr]" : "",
        )}
      >
        <div className="space-y-4">
          <PosterBlock title="Primary records" items={pillar.primaryRecords} />
          <PosterBlock title="promptProfile" items={pillar.promptProfileFields} />
        </div>
        <div className="space-y-4">
          <PosterBlock title="Metadata focus" items={pillar.metadataFocus} />
          <div className="rounded-[1.4rem] border border-[var(--border-default)] bg-[var(--surface-1)] p-4 text-sm leading-6 text-[var(--text-secondary)]">
          {pillar.note}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PosterBlock({
  title,
  items,
}: {
  title: string;
  items: string[];
}) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
        {title}
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <Badge
            key={item}
            variant="outline"
            className="h-auto rounded-2xl border-[var(--border-default)] bg-[var(--surface-1)] px-3 py-1.5 text-[11px] leading-5 text-[var(--text-secondary)]"
          >
            {item}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function FindingPanel({
  finding,
  index,
}: {
  finding: ReviewFinding;
  index: number;
}) {
  return (
    <Card className="overflow-hidden rounded-[2rem] border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--surface-0)_76%,white_24%)] shadow-[var(--shadow-lg)]">
      <div
        className={cn(
          "h-2 w-full",
          finding.severity === "critical"
            ? "bg-[linear-gradient(90deg,#dc2626,transparent)]"
            : finding.severity === "high"
              ? "bg-[linear-gradient(90deg,#f97316,transparent)]"
              : "bg-[linear-gradient(90deg,#f59e0b,transparent)]",
        )}
      />
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="rounded-[1rem] border border-[var(--border-default)] bg-[var(--surface-1)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
            issue {String(index).padStart(2, "0")}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Badge
            variant="outline"
            className={cn("capitalize", severityStyles[finding.severity])}
          >
            {finding.severity}
          </Badge>
          <CardTitle className="text-2xl leading-tight">{finding.title}</CardTitle>
        </div>
        <p className="text-sm leading-7 text-[var(--text-secondary)]">
          {finding.summary}
        </p>
      </CardHeader>
      <CardContent className="grid gap-4 xl:grid-cols-[0.95fr_1.1fr_1fr]">
        <FindingBlock icon={TriangleAlert} title="Impact" text={finding.impact} />
        <div className="rounded-[1.5rem] border border-[var(--border-default)] bg-[var(--surface-1)] p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <FileCode2 className="h-4 w-4" />
            Evidence
          </div>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--text-secondary)]">
            {finding.evidence.map((item) => (
              <li key={item} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 rounded-full bg-[var(--warm-accent)]" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
        <FindingBlock
          icon={finding.severity === "critical" ? ShieldAlert : ShieldCheck}
          title="Recommended fix"
          text={finding.recommendation}
        />
      </CardContent>
    </Card>
  );
}

function FindingBlock({
  icon: Icon,
  title,
  text,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-[1.5rem] border border-[var(--border-default)] bg-[var(--surface-1)] p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
        <Icon className="h-4 w-4" />
        {title}
      </div>
      <p className="mt-3 text-sm leading-7 text-[var(--text-secondary)]">{text}</p>
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2 text-sm leading-6 text-[var(--text-secondary)]">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <span className="mt-2 h-1.5 w-1.5 rounded-full bg-[var(--warm-accent)]" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
