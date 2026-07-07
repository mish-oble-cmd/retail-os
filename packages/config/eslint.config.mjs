import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Shared ESLint flat config (base). Apps/packages extend this and may add
 * environment-specific configs (React, Next.js) on top.
 *
 * Convention (07-development/coding-standards.md): `any` requires a
 * `// why:` comment — enforced in review until a lint rule is added.
 */
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    ignores: ["**/dist/**", "**/.next/**", "**/coverage/**", "**/node_modules/**"],
  },
);
