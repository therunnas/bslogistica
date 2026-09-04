import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  server: { host: true, port: 8080 },
  preview: { host: true, port: 8080 },
  // O postcss.config.mjs da raiz existe para o Next.js. Sem este objeto vazio,
  // o Vite o encontraria sozinho e o Tailwind seria processado duas vezes:
  // uma pelo PostCSS e outra pelo plugin @tailwindcss/vite abaixo.
  css: { postcss: {} },
  plugins: [
    tsConfigPaths(),
    tailwindcss(),
    tanstackStart({
      // Aponta o servidor para src/server.ts, nosso wrapper de erro de SSR.
      // O nitro constrói a partir daí.
      server: { entry: "server" },
    }),
    // A aplicação é renderizada no servidor: o build sai no formato da Vercel.
    nitro({ preset: "vercel" }),
    viteReact(),
  ],
  resolve: {
    dedupe: ["react", "react-dom", "@tanstack/react-router", "@tanstack/react-start"],
  },
});
