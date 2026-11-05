// Stable character identity: one code per person inside a world (DA-CH-001),
// costumes hang off it (DA-CH-001-C01). A new face is a new code; a new
// costume never is. Codes are never reused, even after a delete.

export const CHARACTER_STATUSES = ["concept", "approved", "sheeted", "retired"] as const;
export const CHARACTER_LANES = ["live-action", "animation"] as const;
// What an asset is to a character. A sheet/face with a costumeCode belongs to
// that costume; without one it is the person's master.
export const CHARACTER_LINK_ROLES = ["concept", "sheet", "face", "costume", "appears-in", "reference"] as const;

export type CharacterStatus = (typeof CHARACTER_STATUSES)[number];
export type CharacterLane = (typeof CHARACTER_LANES)[number];
export type CharacterLinkRole = (typeof CHARACTER_LINK_ROLES)[number];

const PREFIX_PATTERN = /^[A-Z][A-Z0-9]{1,3}$/;
const CODE_PATTERN = /^([A-Z][A-Z0-9]{1,3})-CH-(\d{3,})$/;
const COSTUME_PATTERN = /^(?:([A-Z][A-Z0-9]{1,3})-CH-(\d{3,})-)?C(\d{2,})$/;

export const normalizeCharacterPrefix = (input: string) => {
  const prefix = input.trim().toUpperCase();
  if (!PREFIX_PATTERN.test(prefix)) {
    throw new Error("A world prefix is 2 to 4 capital letters or digits, starting with a letter (e.g. DA).");
  }
  return prefix;
};

// "DEAR ANNETE" -> DA, "Dear Annete: Live Action" -> DAL, "DADDY" -> DAD.
export const deriveCharacterPrefix = (worldName: string) => {
  const words = worldName
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return undefined;
  const raw = words.length === 1 ? words[0].slice(0, 3) : words.slice(0, 3).map((word) => word[0]).join("");
  const prefix = raw.toUpperCase();
  return PREFIX_PATTERN.test(prefix) ? prefix : undefined;
};

export const formatCharacterCode = (prefix: string, number: number) =>
  `${prefix}-CH-${String(number).padStart(3, "0")}`;

export const formatCostumeCode = (number: number) => `C${String(number).padStart(2, "0")}`;

export const parseCharacterCode = (input: string) => {
  const match = CODE_PATTERN.exec(input.trim().toUpperCase());
  if (!match) return undefined;
  return { prefix: match[1], number: Number(match[2]), code: formatCharacterCode(match[1], Number(match[2])) };
};

// Accepts "C01", "c1"-style short codes and the full "DA-CH-001-C01".
// Returns the short form stored on the character, or undefined.
export const parseCostumeCode = (input: string, characterCode?: string) => {
  const value = input.trim().toUpperCase();
  const short = /^C(\d{1,})$/.exec(value);
  if (short) return formatCostumeCode(Number(short[1]));
  const match = COSTUME_PATTERN.exec(value);
  if (!match || !match[1]) return undefined;
  if (characterCode && formatCharacterCode(match[1], Number(match[2])) !== characterCode) return undefined;
  return formatCostumeCode(Number(match[3]));
};

export const characterDisplayName = (name: string, alias?: string) =>
  alias?.trim() ? `${name.trim()} — ${alias.trim()}` : name.trim();

// Uniqueness key inside a world: case, spacing and dash style do not matter.
export const normalizeCharacterName = (name: string, alias?: string) =>
  characterDisplayName(name, alias)
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim();

// The searchable caption line CH-SYS asks for on every sheet and face.
export const characterCaptionLine = (input: {
  name: string; alias?: string; code: string; costumeCode?: string; label?: string; worldName?: string;
}) => [
  characterDisplayName(input.name, input.alias),
  input.code,
  [input.costumeCode, input.label].filter(Boolean).join(" ") || undefined,
  input.worldName,
].filter(Boolean).join(" · ");
