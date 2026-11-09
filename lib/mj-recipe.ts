// A world style's recipe as text Michael pastes into the Midjourney bar.
// Client-safe and pure: the styles page, the director review (owner view) and
// the agent routes all build the same two strings from one recipe record.
//
// A recipe keeps its codes in several places: the parameter line, the prompt
// template, linked moodboards and profiles, and codes the gallery has no
// record for ("--sref 7613287694", "37vd7r6"). Some records hold a --profile
// only in the template, or a --sref only in unknownCodes. The copy line is
// all of them merged, each code once, in this precedence: parameters, then
// template, then moodboards, profiles and the loose codes.

export type RecipeInput = {
  parameters?: string;
  template?: string;
  moodboardCodes?: ReadonlyArray<string | undefined>;
  profileCodes?: ReadonlyArray<string | undefined>;
  unknownCodes?: ReadonlyArray<string>;
};

export type ComposedRecipe = {
  /** Every parameter, ready for the Midjourney bar: "--chaos 30 --ar 16:9 … --profile a b". */
  params: string;
  /** The template's words with [subject] and the full parameter line, or undefined without a template. */
  prompt?: string;
  /** The --profile codes in the line, in order. */
  profiles: string[];
  /** The --sref codes in the line, in order. */
  srefs: string[];
};

type Flag = { name: string; values: string[] };

const ALIASES: Record<string, string> = { p: "profile", personalize: "profile" };
const MULTI = new Set(["profile", "sref"]);

const tokens = (text: string | undefined) => (text ?? "").replace(/[–—](?=[a-z])/gi, "--").split(/\s+/).filter(Boolean);

/** The flags of a line, in order: "--ar 16:9 --hd" → [{ar,[16:9]},{hd,[]}]. Words before the first flag are skipped. */
export function parseFlags(text: string | undefined): Flag[] {
  const out: Flag[] = [];
  let current: Flag | null = null;
  for (const token of tokens(text)) {
    if (/^--[a-z]/i.test(token)) {
      const raw = token.slice(2).toLowerCase();
      current = { name: ALIASES[raw] ?? raw, values: [] };
      out.push(current);
    } else if (current) {
      current.values.push(token);
    }
  }
  return out;
}

/** The words of a template before its first flag: "[subject] in Mexico City, …". */
export function templateWords(template: string | undefined) {
  const text = (template ?? "").trim();
  const at = text.search(/(^|\s)--[a-z]/i);
  return (at < 0 ? text : text.slice(0, at)).trim();
}

const pushUnique = (list: string[], values: ReadonlyArray<string | undefined>) => {
  for (const value of values) {
    const code = value?.trim();
    if (code && !list.includes(code)) list.push(code);
  }
};

export function composeRecipe(input: RecipeInput): ComposedRecipe {
  const fromParams = parseFlags(input.parameters);
  const fromTemplate = parseFlags(input.template);
  const loose = (input.unknownCodes ?? []).map((code) => code.trim()).filter(Boolean);
  const looseSrefs = loose.flatMap((code) => parseFlags(code).filter((flag) => flag.name === "sref").flatMap((flag) => flag.values));
  const looseProfiles = loose.filter((code) => !code.startsWith("-") && /^[a-z0-9]{5,12}$/i.test(code));

  const valuesOf = (flags: Flag[], name: string) => flags.filter((flag) => flag.name === name).flatMap((flag) => flag.values);
  const profiles: string[] = [];
  pushUnique(profiles, valuesOf(fromParams, "profile"));
  pushUnique(profiles, valuesOf(fromTemplate, "profile"));
  pushUnique(profiles, input.moodboardCodes ?? []);
  pushUnique(profiles, input.profileCodes ?? []);
  pushUnique(profiles, looseProfiles);
  const srefs: string[] = [];
  pushUnique(srefs, valuesOf(fromParams, "sref"));
  pushUnique(srefs, valuesOf(fromTemplate, "sref"));
  pushUnique(srefs, looseSrefs);

  // The parameter line's own order, then the flags only the template carries,
  // then --sref and --profile if neither line placed them.
  const order: Flag[] = [];
  const seen = new Set<string>();
  for (const flag of [...fromParams, ...fromTemplate]) {
    if (seen.has(flag.name)) continue;
    seen.add(flag.name);
    order.push(flag);
  }
  for (const name of ["sref", "profile"]) if (!seen.has(name)) order.push({ name, values: [] });
  const parts: string[] = [];
  for (const flag of order) {
    const values = MULTI.has(flag.name) ? (flag.name === "sref" ? srefs : profiles) : flag.values;
    if (MULTI.has(flag.name) && values.length === 0) continue;
    parts.push([`--${flag.name}`, ...values].join(" "));
  }
  const params = parts.join(" ");
  const words = templateWords(input.template);
  return { params, prompt: words ? `${words} ${params}`.trim() : undefined, profiles, srefs };
}
