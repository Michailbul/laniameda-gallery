"use client";

import { useState } from "react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";

// The owner's Midjourney recipe for the style on screen: the whole parameter
// line and the template with [subject], each with one copy button, and every
// code named. Only the owner's page subscribes (styleRecipes.reviewStyleRecipes
// answers null to anyone else), so the director and producer never get it.

export type StyleRecipeRows = NonNullable<FunctionReturnType<typeof api.styleRecipes.reviewStyleRecipes>>;
type Recipe = StyleRecipeRows[number]["recipes"][number];

export function ReviewRecipe({ name, recipes }: { name: string; recipes: Recipe[] }) {
  if (!recipes.length) return null;
  return (
    <section className="rv-recipe" aria-label={`Midjourney recipe for ${name}`}>
      {recipes.map((recipe, index) => (
        <div key={index} className="rv-recipe-card">
          <div className="rv-recipe-h">
            <span>Midjourney · {name}{recipe.name ? ` · ${recipe.name}` : ""}</span>
            <span className="rv-recipe-only">Only you see this</span>
          </div>
          <Line label="Parameters" value={recipe.params} copy="Copy parameters" />
          {recipe.prompt ? <Line label="Prompt" value={recipe.prompt} copy="Copy prompt" /> : null}
          {recipe.codes.length ? (
            <ul className="rv-recipe-codes">
              {recipe.codes.map((code) => (
                <li key={`${code.flag}-${code.code}`}>
                  <code>{code.code}</code>
                  <span>{code.kind === "sref" ? "Style reference" : code.kind === "moodboard" ? "Moodboard" : "Profile"}</span>
                  {code.kind !== "sref" ? <b>{code.name ?? "not named yet"}</b> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </section>
  );
}

function Line({ label, value, copy }: { label: string; value: string; copy: string }) {
  return (
    <div className="rv-recipe-line">
      <span className="k">{label}</span>
      <code>{value.split(/(\[subject\])/i).map((part, index) => /^\[subject\]$/i.test(part) ? <mark key={index}>{part}</mark> : <span key={index}>{part}</span>)}</code>
      <CopyText value={value} label={copy} />
    </div>
  );
}

export function CopyText({ value, label, className = "rv-btn rv-recipe-copy" }: { value: string; label: string; className?: string }) {
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
