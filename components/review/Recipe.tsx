"use client";

import { useId, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import { templateWords } from "@/lib/mj-recipe";
import { ChevronDown } from "./icons";

// The owner's Midjourney recipe for the style on screen, kept quiet: one line
// with the style's look (its one-line description, else the prompt template)
// and one copy control for the full prompt. Parameters, moodboards, codes and
// the other recipes ("near:", exceptions) wait behind a closed Details toggle
// (Michael, 15 Nov 2026: the recipe cards cluttered the page). Only the
// owner's page subscribes (styleRecipes.reviewStyleRecipes answers null to
// anyone else), so the director and producer never get it.

export type StyleRecipeRows = NonNullable<FunctionReturnType<typeof api.styleRecipes.reviewStyleRecipes>>;
type Recipe = StyleRecipeRows[number]["recipes"][number];

const withSubject = (value: string) =>
  value.split(/(\[subject\])/i).map((part, index) => /^\[subject\]$/i.test(part) ? <mark key={index}>{part}</mark> : <span key={index}>{part}</span>);

export function ReviewRecipe({ name, line, recipes }: { name: string; line?: string; recipes: Recipe[] }) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const main = recipes[0];
  if (!main) return null;
  const look = line?.trim() || templateWords(main.prompt);
  const fullPrompt = main.prompt ?? main.params;
  return (
    <section className="rv-recipe" aria-label={`Midjourney recipe for ${name}`}>
      <div className="rv-recipe-row">
        <p className="rv-recipe-look" data-empty={look ? undefined : ""}>{look ? withSubject(look) : "No description yet"}</p>
        <CopyText value={fullPrompt} label="Copy prompt" className="rv-recipe-copy" />
        <button type="button" className="rv-recipe-more" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen((value) => !value)}>
          Details <ChevronDown size={11} className="rv-recipe-chev" />
        </button>
      </div>
      {open ? (
        <div id={detailsId} className="rv-recipe-details">
          <p className="rv-recipe-only">Only you see this</p>
          {recipes.map((recipe, index) => (
            <div key={index} className="rv-recipe-set">
              {recipes.length > 1 || recipe.name ? <p className="rv-recipe-name">{recipe.name ?? (index === 0 ? "Main recipe" : `Recipe ${index + 1}`)}</p> : null}
              <Line label="Parameters" value={recipe.params} />
              {recipe.prompt ? <Line label="Prompt" value={recipe.prompt} /> : null}
              {recipe.codes.length ? (
                <ul className="rv-recipe-codes">
                  {recipe.codes.map((code) => (
                    <li key={`${code.flag}-${code.code}`}>
                      {code.thumbs?.length ? (
                        <span className="rv-recipe-pics">
                          {code.thumbs.map((url) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={url} src={url} alt="" loading="lazy" />
                          ))}
                        </span>
                      ) : null}
                      <code>{code.code}</code>
                      <span>{code.kind === "sref" ? "Style reference" : code.kind === "moodboard" ? "Moodboard" : "Profile"}</span>
                      {code.kind !== "sref" ? <b>{code.name ?? "not named yet"}</b> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="rv-recipe-line">
      <span className="k">{label}</span>
      <code>{withSubject(value)}</code>
      <CopyText value={value} label="Copy" />
    </div>
  );
}

export function CopyText({ value, label, className = "rv-recipe-copy" }: { value: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" className={className} data-on={copied || undefined} title={value} data-nodrag=""
      onPointerDown={(event) => event.stopPropagation()}
      onClick={async (event) => {
        event.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        } catch { /* clipboard refused */ }
      }}>
      {copied ? "Copied" : label}
    </button>
  );
}
