import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Durante a migração o repositório tem duas aplicações: a TanStack/Vite em
  // src/routes e a Next.js em src/app. O Next só compila o que src/app importa,
  // então as duas convivem sem interferir uma na outra.
  //
  // typedRoutes fica desligado até a última tela ser migrada: ele exige que
  // todo href aponte para uma rota existente no App Router, e no meio do
  // caminho os links ainda apontam para telas que vivem no TanStack. Ligar ao
  // final transforma link quebrado em erro de compilação.
};

export default nextConfig;
