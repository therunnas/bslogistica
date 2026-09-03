import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  server: { host: true, port: 8080 },
  preview: { host: true, port: 8080 },
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
