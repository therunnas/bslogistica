import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

// O projeto só tem um Supabase, e a URL é pública por natureza (viaja no
// JavaScript da página) — não é segredo, é o mesmo valor de
// NEXT_PUBLIC_SUPABASE_URL, derivado aqui do project_id de
// supabase/config.toml para não duplicar o literal.
const SUPABASE_HOST = "https://ehkduqokntemtmqzdrbd.supabase.co";

// Content-Security-Policy em Report-Only: observa violação sem bloquear
// nada, primeiro passo antes de aplicar a CSP de verdade. Sem nonce: o único
// script inline que existia (tema) foi externalizado para
// public/theme-script.js, então 'self' basta em script-src. style-src
// precisa de 'unsafe-inline' porque Radix/shadcn (popover, dialog, select)
// usam estilo inline para posicionamento — apertar isso é etapa própria.
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src 'self' ${SUPABASE_HOST}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

/**
 * Baseline de cabeçalhos de segurança.
 *
 * Fonte única: ficam aqui, e não em vercel.json nem em public/_headers, para
 * não existir uma segunda definição competindo com esta.
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
  // Report-Only: só registra violação (via Reporting API/console), não
  // bloqueia nada. Promover para Content-Security-Policy é etapa própria,
  // depois de observar pelo menos um ciclo de deploy sem violação inesperada.
  { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
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
