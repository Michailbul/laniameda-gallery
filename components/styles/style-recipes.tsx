"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { composeRecipe } from "@/lib/mj-recipe";

// A style's Midjourney recipes as Michael pastes them: per recipe the whole
// parameter line and the prompt template with [subject], each with one copy
// button, and every code named underneath (moodboard or profile). Owner
// pages only: the styles page, and the director review in the owner view
// (components/review uses its own skin over the same composeRecipe).

export type RecipeRow = {
  name?: string;
  label?: string;
  parameters?: string;
  template?: string;
  frames?: number;
  moodboards: Array<{ name: string; mjCode?: string; previews?: Array<{ thumbUrl?: string }> }>;
  profiles: Array<{ name: string; code: string }>;
  unknownCodes: string[];
};

export type CodeName = { code: string; name?: string; kind: "moodboard" | "profile" | "unknown"; previews?: Array<{ thumbUrl?: string }> };

export function StyleRecipes({ recipes, names }: { recipes: RecipeRow[]; names: CodeName[] }) {
  const usable = recipes.filter((recipe) => recipe.parameters || recipe.template || recipe.moodboards.length || recipe.profiles.length);
  if (!usable.length) return null;
  const named = new Map<string, CodeName>();
  for (const recipe of usable) {
    for (const board of recipe.moodboards) if (board.mjCode) named.set(board.mjCode, { code: board.mjCode, name: board.name, kind: "moodboard", previews: board.previews });
    for (const profile of recipe.profiles) named.set(profile.code, { code: profile.code, name: profile.name, kind: "profile" });
  }
  for (const item of names) {
    const have = named.get(item.code);
    if (item.code && (!have?.name || !have.previews?.length)) named.set(item.code, { ...item, ...(have?.name ? { name: have.name } : {}), previews: have?.previews?.length ? have.previews : item.previews });
  }

  return (
    <section className="lms-recipes" aria-label="Midjourney recipe">
      <style>{RECIPE_CSS}</style>
      {usable.map((recipe, index) => {
        const composed = composeRecipe({
          parameters: recipe.parameters, template: recipe.template,
          moodboardCodes: recipe.moodboards.map((board) => board.mjCode),
          profileCodes: recipe.profiles.map((profile) => profile.code),
          unknownCodes: recipe.unknownCodes,
        });
        const codes = [...composed.srefs.map((code) => ({ code, flag: "sref" })), ...composed.profiles.map((code) => ({ code, flag: "profile" }))];
        return (
          <div key={`${recipe.name ?? ""}-${index}`} className="lms-recipe">
            <div className="lms-recipe-h">
              <span className="lms-kicker">Midjourney{usable.length > 1 ? ` · ${recipe.name ?? `recipe ${index + 1}`}` : recipe.name ? ` · ${recipe.name}` : ""}</span>
              {recipe.frames ? <span className="lms-kicker" style={{ opacity: 0.7 }}>{recipe.frames} frames</span> : null}
            </div>
            <RecipeLine label="Parameters" value={composed.params} copyLabel="Copy parameters" />
            {composed.prompt ? <RecipeLine label="Prompt" value={composed.prompt} copyLabel="Copy prompt" subject /> : null}
            {codes.length ? (
              <ul className="lms-recipe-codes">
                {codes.map(({ code, flag }) => {
                  const known = named.get(code);
                  return (
                    <li key={`${flag}-${code}`}>
                      {known?.previews?.length ? (
                        <span className="lms-recipe-pics">
                          {known.previews.slice(0, 3).map((preview, index) => preview.thumbUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={index} src={preview.thumbUrl} alt="" loading="lazy" />
                          ) : null)}
                        </span>
                      ) : null}
                      <code>{code}</code>
                      <span>{flag === "sref" ? "Style reference" : known?.kind === "moodboard" ? "Moodboard" : "Profile"}</span>
                      <b>{flag === "sref" ? "" : known?.name ?? "not named yet"}</b>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

function RecipeLine({ label, value, copyLabel, subject }: { label: string; value: string; copyLabel: string; subject?: boolean }) {
  const parts = subject ? value.split(/(\[subject\])/i) : [value];
  return (
    <div className="lms-recipe-line">
      <span className="lms-kicker">{label}</span>
      <code className="lms-recipe-code">
        {parts.map((part, index) => /^\[subject\]$/i.test(part) ? <mark key={index}>{part}</mark> : <span key={index}>{part}</span>)}
      </code>
      <CopyButton value={value} label={copyLabel} />
    </div>
  );
}

export function CopyButton({ value, label, className = "lms-copy" }: { value: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" className={className} data-on={copied || undefined} title={value}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={async (event) => {
        event.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        } catch { /* clipboard refused */ }
      }}>
      {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
      <span>{copied ? "Copied" : label}</span>
    </button>
  );
}

const RECIPE_CSS = `
.lms-recipes{display:flex;flex-direction:column;gap:10px;margin:4px 0 18px;max-width:1100px}
.lms-recipe{border:1px solid var(--lm-border-subtle);border-radius:var(--lm-radius,6px);padding:12px 14px;background:var(--lm-surface-1,transparent)}
.lms-recipe-h{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
.lms-recipe-line{display:grid;grid-template-columns:84px minmax(0,1fr) auto;align-items:center;gap:10px;padding:6px 0;border-top:1px solid var(--lm-border-subtle)}
.lms-recipe-line:first-of-type{border-top:0}
.lms-recipe-code{font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:12.5px;line-height:1.5;color:var(--lm-text-primary);word-break:break-word;user-select:all}
.lms-recipe-code mark{background:var(--lm-surface-2);color:var(--lm-text-primary);border-radius:3px;padding:0 3px}
.lms-copy{font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;padding:7px 11px;border-radius:999px;border:1px solid var(--lm-border-strong);color:var(--lm-text-primary);background:transparent;transition:background-color .12s,color .12s}
.lms-copy:hover{background:var(--lm-surface-2)}
.lms-copy[data-on]{background:var(--lm-surface-2);color:var(--lm-text-primary)}
.lms-recipe-codes{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:8px;padding-top:8px;border-top:1px solid var(--lm-border-subtle)}
.lms-recipe-pics{display:inline-flex;gap:1px;align-self:center;border-radius:4px;overflow:hidden}
.lms-recipe-pics img{width:26px;height:26px;object-fit:cover;display:block}
.lms-recipe-codes li{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--lm-text-tertiary)}
.lms-recipe-codes code{font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:11px;color:var(--lm-text-primary)}
.lms-recipe-codes span{font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:9.5px;letter-spacing:.12em;text-transform:uppercase}
.lms-recipe-codes b{font-weight:600;color:var(--lm-text-secondary)}
@media (max-width:640px){.lms-recipe-line{grid-template-columns:minmax(0,1fr) auto}.lms-recipe-line>.lms-kicker{grid-column:1/-1}}
`;
