import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

/**
 * Baseline de cabeçalhos de segurança.
 *
 * Fonte única: ficam aqui, e não em vercel.json nem em public/_headers, para
 * não existir uma segunda definição competindo com esta.
 *
 * Content-Security-Policy NÃO está aqui — ela precisa de um nonce diferente
 * a cada requisição (para os scripts internos que o Next injeta no streaming
 * do RSC), e esta função roda só no build, não por requisição. Ela é montada
 * em src/proxy.ts, que roda a cada requisição.
 */
const cabecalhosDeSeguranca = [
  // Impede o navegador de adivinhar o tipo de um arquivo e executá-lo como
  // outra coisa — um CSV exportado, por exemplo, sendo tratado como HTML.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Envia a origem para destinos externos, e a URL completa só na própria
  // origem. Sem isso, um caminho como /faturamento poderia vazar em Referer.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Painel administrativo não deve ser embutido em lugar nenhum: fecha
  // clickjacking sobre ações como Gerar fatura e Desalocar.
  { key: "X-Frame-Options", value: "DENY" },
  // A aplicação não usa nenhuma dessas capacidades. Negá-las explicitamente
  // limita o estrago caso um script de terceiro entre na página.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];

const nextConfig: NextConfig = {
  // Exige que todo href aponte para uma rota existente no App Router: link
  // quebrado vira erro de compilação em vez de 404 em produção.
  typedRoutes: true,

  async headers() {
    return [{ source: "/:path*", headers: cabecalhosDeSeguranca }];
  },
};

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "bs-log",

  project: "bs-logistica-admin",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});
