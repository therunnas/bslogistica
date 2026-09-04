import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // .vercel e .next guardam saída de build. Sem ignorá-las, o
  // eslint-plugin-prettier tenta reformatar os bundles minificados e o lint
  // leva minutos em vez de segundos — o .next sozinho tem quase 100 MB.
  // next-env.d.ts é gerado pelo next dev/build e fica fora do versionamento.
  { ignores: ["dist", ".output", ".vinxi", ".vercel", ".next", "next-env.d.ts"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    // O App Router do Next.js tem convenções que as duas regras abaixo, escritas
    // para a aplicação Vite, tratariam como erro:
    //
    // - layout.tsx e page.tsx precisam exportar `metadata` ao lado do
    //   componente, o que o react-refresh interpreta como export misto;
    // - `server-only` é o pacote oficial do Next para impedir que um módulo de
    //   servidor vaze para o navegador, enquanto no TanStack ele é proibido.
    //
    // Este bloco vale só para src/app; src/routes segue com as regras originais.
    files: ["src/app/**/*.{ts,tsx}"],
    rules: {
      "react-refresh/only-export-components": "off",
      "no-restricted-imports": "off",
    },
  },
  eslintPluginPrettier,
);
