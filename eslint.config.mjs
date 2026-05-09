import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    files: [
      "components/telegram-login-button.tsx",
      "components/top-filter-bar.tsx",
      "components/image-card.tsx",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "JSXAttribute[name.name='style'] Property > Literal[value=/#|rgba?\\(\\s*\\d|hsla?\\(\\s*\\d|hsl\\(\\s*\\d/]",
          message:
            "Use design tokens (var(--...)) or color-mix with existing tokens instead of hardcoded color literals in inline styles.",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "web/.next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "design-drop/**",
    "recovery/**",
    ".worktrees/**",
    ".claude/worktrees/**",
    "convex/_generated/**",
  ]),
]);

export default eslintConfig;
