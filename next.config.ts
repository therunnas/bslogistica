import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Com as sete telas migradas, typedRoutes passa a valer: ele exige que todo
  // href aponte para uma rota existente no App Router e transforma link
  // quebrado em erro de compilação.
  //
  // Ficou desligado durante a migração porque os links ainda apontavam para
  // telas que viviam na aplicação TanStack. O preço disso apareceu: a landing
  // seguiu apontando para /auth, nome da rota antiga, enquanto a tela nova é
  // /login — e os dois botões levavam a 404 sem nada acusar.
  typedRoutes: true,
};

export default nextConfig;
