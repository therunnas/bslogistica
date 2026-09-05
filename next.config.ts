import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Exige que todo href aponte para uma rota existente no App Router: link
  // quebrado vira erro de compilação em vez de 404 em produção.
  typedRoutes: true,
};

export default nextConfig;
