// Each review project can carry its own palette (review.css,
// [data-theme="…"]). Michael tried a CASSANDRA palette from the approved
// frames on 6 Nov 2026 and did not like it: every project uses
// Michael's board tokens. The cassandra theme stays in review.css, unused.
const THEMES: Record<string, string> = {};

export const reviewTheme = (slug: string) => THEMES[slug.trim().toLowerCase()] ?? "board";
