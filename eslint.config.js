import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // .next e .vercel guardam saída de build: são quase 100 MB de bundle
  // minificado que o eslint-plugin-prettier tentaria reformatar, travando o
  // lint. next-env.d.ts é gerado e fica fora do versionamento.
  // e2e-results: relatório local do Playwright (traz o visualizador de traces minificado; lint
  // e Prettier levavam mais de 19 min nele — CP-10). Não é código do projeto.
  { ignores: [".next", ".vercel", "next-env.d.ts", "e2e-results"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  eslintPluginPrettier,
);
