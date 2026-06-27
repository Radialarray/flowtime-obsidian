import tseslint from "typescript-eslint";
import eslint from "@eslint/js";

/**
 * ESLint config for Flowtime Obsidian plugin.
 *
 * Obsidian's automated plugin review runs proprietary rules (not publicly available).
 * We catch what we can locally and rely on the pre-release checklist in AGENTS.md
 * for rules that require Obsidian's internal ESLint plugin:
 *   - obsidianmd/no-static-styles-assignments  → CSS classes / setCssProps
 *   - obsidianmd/use-active-document           → _doc getter / activeDocument
 *   - obsidianmd/settings-headings             → Setting().setHeading()
 *
 * Rules below catch as many of the generic issues as possible before submission.
 */
export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        console: "readonly",
        window: "readonly",
        AudioContext: "readonly",
        process: "readonly",
        document: "readonly",
        Blob: "readonly",
        // NOT declaring setTimeout/clearTimeout/setInterval/clearInterval
        // as globals — this forces code to use window.setTimeout etc.
        // which satisfies Obsidian's popout-window-compat requirement.
      },
    },
    rules: {
      // ── TypeScript ──
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_"
      }],
      "@typescript-eslint/no-require-imports": "error",
      // no-explicit-any: off for now (21 pre-existing sites).
      // Turn on when types are tightened. See AGENTS.md.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-expressions": ["error", {
        allowTernary: true,
        allowShortCircuit: true,
      }],

      // ── Regex safety ──
      "no-useless-escape": "error",
      "no-control-regex": "error",
      "no-misleading-character-class": "error",

      // ── General ──
      "no-empty": ["error", { allowEmptyCatch: true }],
      "prefer-const": "warn",
      "no-useless-assignment": "warn",

      // ── Catch hardcoded .obsidian paths ──
      // Currently off — 2 pre-existing benign cases (user-facing text, fallback).
      // Rule documented in AGENTS.md pre-release checklist.
      // Enable when all instances are resolved:
      // "no-restricted-syntax": ["error", {
      //   selector: "Literal[value=/^\\.obsidian/]",
      //   message: "Hardcoded '.obsidian' path. Use vault.configDir instead.",
      // }],
    },
  },
);
