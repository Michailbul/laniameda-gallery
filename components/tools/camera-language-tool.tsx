"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowRight,
  ArrowUp,
  CircleDot,
  Copy,
  Crosshair,
  ExternalLink,
  Film,
  Focus,
  Search,
  Sparkles,
  Zap,
} from "lucide-react";
import {
  cameraEmotionLabels,
  cameraMoveCategories,
  cameraMoves,
  cameraToolSource,
  getCameraMoveThumbnailPrompt,
  type CameraMove,
  type CameraMoveCategory,
  type CameraMoveEmotion,
} from "@/lib/tools/camera-language";
import { cn } from "@/lib/utils";

const allCategoryId = "all";
const allEmotionId = "all";

const categoryStyles: Record<CameraMoveCategory, { accent: string; soft: string }> = {
  "push-pull": {
    accent: "#ff7a64",
    soft: "rgba(255, 122, 100, 0.16)",
  },
  orbit: {
    accent: "#5d6bfa",
    soft: "rgba(93, 107, 250, 0.16)",
  },
  vertical: {
    accent: "#79b791",
    soft: "rgba(121, 183, 145, 0.16)",
  },
  lateral: {
    accent: "#ff8c42",
    soft: "rgba(255, 140, 66, 0.16)",
  },
  "lens-focus": {
    accent: "#2eb8b4",
    soft: "rgba(46, 184, 180, 0.16)",
  },
  creative: {
    accent: "#f26157",
    soft: "rgba(242, 97, 87, 0.18)",
  },
};

const motionIcons = {
  circle: CircleDot,
  down: ArrowDown,
  dynamic: Zap,
  focus: Focus,
  in: ArrowRight,
  out: ArrowRight,
  side: ArrowLeftRight,
  up: ArrowUp,
} satisfies Record<CameraMove["motion"], typeof ArrowRight>;

const sourceDate = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
}).format(new Date(cameraToolSource.uploadDate));

const buildPromptBlock = (move: CameraMove) => `CAMERA:
${move.prompt}

ACTION:
[one clear subject action]

LIGHT:
[source, direction, quality, temperature]

PHYSICS:
[hair / fabric / water / dust / sparks / debris if visible]

LOCK:
Keep subject identity, wardrobe, color, and environment consistent.`;

function normalizeText(value: string) {
  return value.toLowerCase().trim();
}

function CopyButton({
  value,
  label = "Copy",
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-8 items-center gap-2 border px-3 text-[11px] font-black uppercase tracking-[0.12em] transition",
        "border-[color:var(--tool-border-strong)] bg-[color:var(--tool-surface-1)] text-[color:var(--tool-text)] hover:-translate-y-0.5 hover:bg-[color:var(--tool-coral)] hover:text-[#111110]",
        className,
      )}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
    >
      <Copy className="size-3.5" />
      {copied ? "Copied" : label}
    </button>
  );
}

function MotionDiagram({ move }: { move: CameraMove }) {
  const Icon = motionIcons[move.motion];
  const style = categoryStyles[move.category];

  return (
    <div
      className="relative h-24 overflow-hidden border"
      style={{
        background: `linear-gradient(135deg, ${style.soft}, rgba(255, 244, 234, 0.04))`,
        borderColor: "var(--tool-border)",
      }}
    >
      <div className="absolute inset-x-3 top-3 flex items-center justify-between">
        <span className="h-1.5 w-10 border" style={{ borderColor: style.accent }} />
        <span className="h-1.5 w-5 border" style={{ borderColor: style.accent }} />
        <span className="h-1.5 w-14 border" style={{ borderColor: style.accent }} />
      </div>
      <div className="absolute left-1/2 top-1/2 grid size-12 -translate-x-1/2 -translate-y-1/2 place-items-center border bg-[color:var(--tool-bg)]" style={{ borderColor: style.accent }}>
        <Crosshair className="size-5" style={{ color: style.accent }} />
      </div>
      <div
        className={cn(
          "absolute grid size-9 place-items-center border bg-[color:var(--tool-surface-1)]",
          move.motion === "out" && "rotate-180",
          move.motion === "circle" && "left-5 top-1/2 -translate-y-1/2",
          move.motion === "up" && "bottom-4 left-1/2 -translate-x-1/2",
          move.motion === "down" && "left-1/2 top-4 -translate-x-1/2",
          move.motion === "side" && "bottom-4 right-5",
          move.motion === "focus" && "right-5 top-1/2 -translate-y-1/2",
          move.motion === "dynamic" && "bottom-4 left-5",
          (move.motion === "in" || move.motion === "out") && "right-5 top-1/2 -translate-y-1/2",
        )}
        style={{ borderColor: "var(--tool-border-strong)" }}
      >
        <Icon className="size-4" style={{ color: style.accent }} />
      </div>
      <div
        className="absolute bottom-3 left-3 right-3 h-px"
        style={{ backgroundColor: "var(--tool-border)" }}
      />
    </div>
  );
}

function MoveCard({
  move,
  active,
  onSelect,
}: {
  move: CameraMove;
  active: boolean;
  onSelect: (move: CameraMove) => void;
}) {
  const category = cameraMoveCategories.find((item) => item.id === move.category);
  const style = categoryStyles[move.category];

  return (
    <button
      type="button"
      onClick={() => onSelect(move)}
      className={cn(
        "group flex h-full min-h-[292px] min-w-0 flex-col border p-3 text-left transition",
        "bg-[color:var(--tool-surface-1)] hover:-translate-y-1",
        active && "translate-x-0 translate-y-0",
      )}
      style={{
        borderColor: active ? style.accent : "var(--tool-border)",
        boxShadow: active ? `4px 4px 0 ${style.accent}` : "var(--tool-shadow)",
      }}
    >
      <MotionDiagram move={move} />
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span
          className="border px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em]"
          style={{
            borderColor: style.accent,
            color: style.accent,
            backgroundColor: style.soft,
          }}
        >
          {category?.label}
        </span>
        {move.aliases?.slice(0, 1).map((alias) => (
          <span
            key={alias}
            className="border border-[color:var(--tool-border)] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--tool-muted)]"
          >
            {alias}
          </span>
        ))}
      </div>
      <h2 className="mt-3 text-xl font-black tracking-[-0.01em] text-[color:var(--tool-text)]">
        {move.term}
      </h2>
      <p className="mt-2 text-sm leading-6 text-[color:var(--tool-muted)]">{move.useFor}</p>
      <code className="mt-auto block whitespace-pre-wrap break-words border border-[color:var(--tool-border)] bg-[color:var(--tool-code)] p-3 text-[12px] leading-5 text-[color:var(--tool-text)]">
        {move.prompt}
      </code>
    </button>
  );
}

export function CameraLanguageTool() {
  const [selectedCategory, setSelectedCategory] = useState<CameraMoveCategory | typeof allCategoryId>(allCategoryId);
  const [selectedEmotion, setSelectedEmotion] = useState<CameraMoveEmotion | typeof allEmotionId>(allEmotionId);
  const [query, setQuery] = useState("");
  const [activeMoveSlug, setActiveMoveSlug] = useState(cameraMoves[0]?.slug ?? "");

  const emotionOptions = useMemo(() => {
    const seen = new Set<CameraMoveEmotion>();
    for (const move of cameraMoves) {
      for (const emotion of move.emotion) {
        seen.add(emotion);
      }
    }
    return Array.from(seen).sort((left, right) =>
      cameraEmotionLabels[left].localeCompare(cameraEmotionLabels[right]),
    );
  }, []);

  const filteredMoves = useMemo(() => {
    const search = normalizeText(query);
    return cameraMoves.filter((move) => {
      if (selectedCategory !== allCategoryId && move.category !== selectedCategory) return false;
      if (selectedEmotion !== allEmotionId && !move.emotion.includes(selectedEmotion)) return false;
      if (!search) return true;
      return [
        move.term,
        move.meaning,
        move.useFor,
        move.prompt,
        move.aiNote,
        getCameraMoveThumbnailPrompt(move),
        ...(move.aliases ?? []),
      ]
        .join(" ")
        .toLowerCase()
        .includes(search);
    });
  }, [query, selectedCategory, selectedEmotion]);

  const activeMove =
    cameraMoves.find((move) => move.slug === activeMoveSlug) ?? cameraMoves[0]!;
  const activeCategory = cameraMoveCategories.find(
    (category) => category.id === activeMove.category,
  );
  const activeStyle = categoryStyles[activeMove.category];

  const promptBlock = buildPromptBlock(activeMove);
  const activeThumbnailPrompt = getCameraMoveThumbnailPrompt(activeMove);

  return (
    <div
      className="min-h-screen bg-[color:var(--tool-bg)] text-[color:var(--tool-text)]"
      style={{
        "--tool-bg": "#111110",
        "--tool-surface-1": "#1a1918",
        "--tool-surface-2": "#242320",
        "--tool-code": "#0d0d0c",
        "--tool-text": "#f0e8e0",
        "--tool-muted": "#bfb0a0",
        "--tool-ghost": "#837567",
        "--tool-border": "rgba(240, 232, 224, 0.14)",
        "--tool-border-strong": "rgba(240, 232, 224, 0.28)",
        "--tool-coral": "#ff7a64",
        "--tool-teal": "#79b791",
        "--tool-shadow": "3px 3px 0 rgba(0, 0, 0, 0.45)",
      } as React.CSSProperties}
    >
      <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-8 px-4 py-4 sm:px-6 lg:px-8">
        <section className="grid min-h-[calc(100vh-32px)] min-w-0 gap-6 lg:grid-cols-[minmax(0,0.94fr)_minmax(360px,0.52fr)]">
          <div className="flex min-h-0 min-w-0 flex-col gap-5">
            <header className="min-w-0 border border-[color:var(--tool-border-strong)] bg-[color:var(--tool-surface-1)] p-4 shadow-[var(--tool-shadow)] sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Link
                  href="/"
                  className="inline-flex items-center gap-2 border border-[color:var(--tool-border)] px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-[color:var(--tool-muted)] transition hover:border-[color:var(--tool-coral)] hover:text-[color:var(--tool-coral)]"
                >
                  <Film className="size-3.5" />
                  Gallery
                </Link>
                <a
                  href={cameraToolSource.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 border border-[color:var(--tool-border)] px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-[color:var(--tool-muted)] transition hover:border-[color:var(--tool-coral)] hover:text-[color:var(--tool-coral)]"
                >
                  Source
                  <ExternalLink className="size-3.5" />
                </a>
              </div>

              <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-end">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-[color:var(--tool-coral)]">
                    AI Video Prompting
                  </p>
                  <h1 className="mt-3 max-w-4xl break-words text-4xl font-black leading-[0.98] tracking-[-0.03em] sm:text-6xl lg:text-7xl">
                    Camera language tool
                  </h1>
                  <p className="mt-5 max-w-2xl text-base leading-7 text-[color:var(--tool-muted)]">
                    Thirty movement terms from Yannis Ashay&apos;s camera movement guide, rebuilt as prompt vocabulary for Seedance, Kling, Runway, and other video models.
                  </p>
                </div>

                <div className="grid grid-cols-3 border border-[color:var(--tool-border-strong)]">
                  {[
                    ["30", "Moves"],
                    ["6", "Families"],
                    [sourceDate, "Source"],
                  ].map(([value, label]) => (
                    <div
                      key={label}
                      className="border-r border-[color:var(--tool-border)] p-3 last:border-r-0"
                    >
                      <div className="text-xl font-black text-[color:var(--tool-text)]">{value}</div>
                      <div className="mt-1 text-[10px] font-black uppercase tracking-[0.14em] text-[color:var(--tool-ghost)]">
                        {label}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </header>

            <div className="sticky top-0 z-20 min-w-0 overflow-hidden border border-[color:var(--tool-border-strong)] bg-[color:var(--tool-bg)]/95 p-3 backdrop-blur">
              <div className="grid gap-3 xl:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.2fr)]">
                <label className="flex h-11 items-center gap-2 border border-[color:var(--tool-border)] bg-[color:var(--tool-surface-1)] px-3">
                  <Search className="size-4 text-[color:var(--tool-ghost)]" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search term, mood, prompt..."
                    className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[color:var(--tool-ghost)]"
                  />
                </label>

                <div className="flex gap-2 overflow-x-auto">
                  <button
                    type="button"
                    onClick={() => setSelectedCategory(allCategoryId)}
                    className={cn(
                      "h-11 shrink-0 border px-3 text-[11px] font-black uppercase tracking-[0.12em]",
                      selectedCategory === allCategoryId
                        ? "border-[color:var(--tool-coral)] bg-[color:var(--tool-coral)] text-[#111110]"
                        : "border-[color:var(--tool-border)] text-[color:var(--tool-muted)]",
                    )}
                  >
                    All
                  </button>
                  {cameraMoveCategories.map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => setSelectedCategory(category.id)}
                      className={cn(
                        "h-11 shrink-0 border px-3 text-[11px] font-black uppercase tracking-[0.12em]",
                        selectedCategory === category.id
                          ? "text-[#111110]"
                          : "border-[color:var(--tool-border)] text-[color:var(--tool-muted)]",
                      )}
                      style={
                        selectedCategory === category.id
                          ? {
                              borderColor: categoryStyles[category.id].accent,
                              backgroundColor: categoryStyles[category.id].accent,
                            }
                          : undefined
                      }
                    >
                      {category.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-3 flex gap-2 overflow-x-auto">
                <button
                  type="button"
                  onClick={() => setSelectedEmotion(allEmotionId)}
                  className={cn(
                    "h-8 shrink-0 border px-3 text-[10px] font-black uppercase tracking-[0.12em]",
                    selectedEmotion === allEmotionId
                      ? "border-[color:var(--tool-teal)] bg-[color:var(--tool-teal)] text-[#111110]"
                      : "border-[color:var(--tool-border)] text-[color:var(--tool-muted)]",
                  )}
                >
                  All moods
                </button>
                {emotionOptions.map((emotion) => (
                  <button
                    key={emotion}
                    type="button"
                    onClick={() => setSelectedEmotion(emotion)}
                    className={cn(
                      "h-8 shrink-0 border px-3 text-[10px] font-black uppercase tracking-[0.12em]",
                      selectedEmotion === emotion
                        ? "border-[color:var(--tool-teal)] bg-[color:var(--tool-teal)] text-[#111110]"
                        : "border-[color:var(--tool-border)] text-[color:var(--tool-muted)]",
                    )}
                  >
                    {cameraEmotionLabels[emotion]}
                  </button>
                ))}
              </div>
            </div>

            <section className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filteredMoves.map((move) => (
                <MoveCard
                  key={move.slug}
                  move={move}
                  active={activeMove.slug === move.slug}
                  onSelect={(selectedMove) => setActiveMoveSlug(selectedMove.slug)}
                />
              ))}
            </section>
          </div>

          <aside className="min-w-0 lg:sticky lg:top-4 lg:h-[calc(100vh-32px)]">
            <div className="flex h-full flex-col border border-[color:var(--tool-border-strong)] bg-[color:var(--tool-surface-1)] shadow-[var(--tool-shadow)]">
              <div className="border-b border-[color:var(--tool-border-strong)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p
                      className="text-[11px] font-black uppercase tracking-[0.18em]"
                      style={{ color: activeStyle.accent }}
                    >
                      {activeCategory?.label}
                    </p>
                    <h2 className="mt-2 text-3xl font-black leading-none tracking-[-0.02em]">
                      {activeMove.term}
                    </h2>
                  </div>
                  <div
                    className="grid size-11 shrink-0 place-items-center border"
                    style={{
                      borderColor: activeStyle.accent,
                      backgroundColor: activeStyle.soft,
                    }}
                  >
                    <Sparkles className="size-5" style={{ color: activeStyle.accent }} />
                  </div>
                </div>
                {activeMove.aliases?.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {activeMove.aliases.map((alias) => (
                      <span
                        key={alias}
                        className="border border-[color:var(--tool-border)] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--tool-muted)]"
                      >
                        {alias}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <MotionDiagram move={activeMove} />

                <dl className="mt-4 grid gap-3">
                  {[
                    ["Meaning", activeMove.meaning],
                    ["Use for", activeMove.useFor],
                    ["AI note", activeMove.aiNote],
                    ["Category rule", activeCategory?.principle ?? ""],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="border border-[color:var(--tool-border)] bg-[color:var(--tool-bg)] p-3"
                    >
                      <dt className="text-[10px] font-black uppercase tracking-[0.14em] text-[color:var(--tool-ghost)]">
                        {label}
                      </dt>
                      <dd className="mt-2 text-sm leading-6 text-[color:var(--tool-muted)]">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>

                <div className="mt-4 border border-[color:var(--tool-border-strong)] bg-[color:var(--tool-code)] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[color:var(--tool-ghost)]">
                      Nano Banana still prompt
                    </p>
                    <CopyButton value={activeThumbnailPrompt} label="Copy image prompt" />
                  </div>
                  <pre className="mt-3 whitespace-pre-wrap break-words text-[12px] leading-6 text-[color:var(--tool-text)]">
                    {activeThumbnailPrompt}
                  </pre>
                </div>

                <div className="mt-4 border border-[color:var(--tool-border-strong)] bg-[color:var(--tool-code)] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[color:var(--tool-ghost)]">
                      Seedance camera block
                    </p>
                    <CopyButton value={promptBlock} label="Copy block" />
                  </div>
                  <pre className="mt-3 whitespace-pre-wrap break-words text-[12px] leading-6 text-[color:var(--tool-text)]">
                    {promptBlock}
                  </pre>
                </div>
              </div>
            </div>
          </aside>
        </section>

        <section className="min-w-0 border border-[color:var(--tool-border-strong)] bg-[color:var(--tool-surface-1)] p-4 shadow-[var(--tool-shadow)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-[color:var(--tool-coral)]">
                Full table
              </p>
              <h2 className="mt-2 text-3xl font-black tracking-[-0.02em]">Camera movement terms</h2>
            </div>
            <CopyButton
              value={cameraMoves
                .map((move) => `${move.term}: ${move.prompt}`)
                .join("\n")}
              label="Copy prompts"
            />
          </div>

          <div className="mt-5 overflow-x-auto border border-[color:var(--tool-border)]">
            <table className="w-full min-w-[920px] border-collapse text-left text-sm">
              <thead className="bg-[color:var(--tool-bg)] text-[10px] uppercase tracking-[0.14em] text-[color:var(--tool-ghost)]">
                <tr>
                  <th className="border-b border-r border-[color:var(--tool-border)] px-3 py-3">Category</th>
                  <th className="border-b border-r border-[color:var(--tool-border)] px-3 py-3">Term</th>
                  <th className="border-b border-r border-[color:var(--tool-border)] px-3 py-3">Use</th>
                  <th className="border-b border-r border-[color:var(--tool-border)] px-3 py-3">Prompt language</th>
                  <th className="border-b border-[color:var(--tool-border)] px-3 py-3">Moods</th>
                </tr>
              </thead>
              <tbody>
                {cameraMoves.map((move) => {
                  const category = cameraMoveCategories.find((item) => item.id === move.category);
                  return (
                    <tr key={move.slug} className="align-top">
                      <td className="border-b border-r border-[color:var(--tool-border)] px-3 py-3 text-[color:var(--tool-muted)]">
                        {category?.label}
                      </td>
                      <td className="border-b border-r border-[color:var(--tool-border)] px-3 py-3 font-black">
                        {move.term}
                        {move.aliases?.length ? (
                          <span className="mt-1 block text-[11px] font-medium text-[color:var(--tool-ghost)]">
                            {move.aliases.join(" / ")}
                          </span>
                        ) : null}
                      </td>
                      <td className="border-b border-r border-[color:var(--tool-border)] px-3 py-3 text-[color:var(--tool-muted)]">
                        {move.useFor}
                      </td>
                      <td className="border-b border-r border-[color:var(--tool-border)] px-3 py-3">
                        <code className="text-[12px] text-[color:var(--tool-text)]">{move.prompt}</code>
                      </td>
                      <td className="border-b border-[color:var(--tool-border)] px-3 py-3 text-[color:var(--tool-muted)]">
                        {move.emotion.map((emotion) => cameraEmotionLabels[emotion]).join(", ")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
