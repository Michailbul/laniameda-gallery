"use client";

import type { Id } from "@/convex/_generated/dataModel";
import type { PromptOnlyGalleryPrompt } from "@/lib/gallery-types";

type PromptOnlyListProps = {
  prompts: PromptOnlyGalleryPrompt[];
  loading?: boolean;
  folderNameById: Map<string, string>;
  tagNameById: Map<Id<"tags">, string>;
};

const formatPromptDate = (createdAt: number) =>
  new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(createdAt));

const resolvePromptBody = (prompt: PromptOnlyGalleryPrompt) =>
  prompt.promptSections?.finalPrompt?.trim() || prompt.text;

export function PromptOnlyList({
  prompts,
  loading = false,
  folderNameById,
  tagNameById,
}: PromptOnlyListProps) {
  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 px-4 py-6">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className="animate-pulse rounded-[20px] border p-5"
            style={{
              borderColor: "var(--v7-border-strong)",
              backgroundColor: "var(--v7-surface-1)",
            }}
          >
            <div
              className="h-3 w-24 rounded-full"
              style={{ backgroundColor: "var(--v7-surface-3)" }}
            />
            <div
              className="mt-4 h-4 w-3/4 rounded-full"
              style={{ backgroundColor: "var(--v7-surface-3)" }}
            />
            <div
              className="mt-2 h-4 w-full rounded-full"
              style={{ backgroundColor: "var(--v7-surface-3)" }}
            />
            <div
              className="mt-2 h-4 w-5/6 rounded-full"
              style={{ backgroundColor: "var(--v7-surface-3)" }}
            />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 px-4 py-6">
      {prompts.map((prompt) => {
        const promptBody = resolvePromptBody(prompt);
        const folderName = prompt.folderId
          ? folderNameById.get(prompt.folderId)
          : undefined;
        const tagNames = prompt.tagIds
          .map((tagId: Id<"tags">) => tagNameById.get(tagId))
          .filter((tagName: string | undefined): tagName is string => Boolean(tagName));

        return (
          <article
            key={prompt._id}
            className="rounded-[20px] border p-5"
            style={{
              borderColor: "var(--v7-border-strong)",
              backgroundColor: "var(--v7-surface-1)",
              boxShadow: "0 10px 24px rgba(0, 0, 0, 0.05)",
            }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="v7-chip">{prompt.pillar ?? "dump"}</span>
              {prompt.promptType ? (
                <span className="v7-chip">{prompt.promptType}</span>
              ) : null}
              {prompt.modelName ? (
                <span className="v7-chip">{prompt.modelName}</span>
              ) : null}
              {folderName ? (
                <span className="v7-chip">{folderName}</span>
              ) : null}
              <span className="v7-chip">{formatPromptDate(prompt.createdAt)}</span>
            </div>

            <p
              className="mt-4 whitespace-pre-wrap"
              style={{
                fontFamily: "var(--v7-font)",
                fontSize: "14px",
                lineHeight: 1.7,
                color: "var(--v7-text-primary)",
              }}
            >
              {promptBody}
            </p>

            {tagNames.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {tagNames.map((tagName: string) => (
                  <span key={`${prompt._id}:${tagName}`} className="v7-chip">
                    {tagName}
                  </span>
                ))}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
