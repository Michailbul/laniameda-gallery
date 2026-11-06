// Each review project can carry its own palette (review.css,
// [data-theme="…"]). CASSANDRA's comes from its approved frames: night
// storybook beach, sunlit school and street. Other projects use the
// laniameda board tokens.
const THEMES: Record<string, string> = {
  cassandra: "cassandra",
  "cassandra-test": "cassandra",
};

export const reviewTheme = (slug: string) => THEMES[slug.trim().toLowerCase()] ?? "laniameda";
