import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Design handoff reference files (browser-global JSX, not app code).
    "docs/**",
    // Claude Code scratch space: worktrees (with their own built .next),
    // plans, memory — tooling artifacts, never source.
    ".claude/**",
  ]),
]);

export default eslintConfig;
