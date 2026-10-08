import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

import {
  apontaParaProduction,
  previewCompartilhadoAutorizado,
  verificarDestinoSupabase,
} from "./src/lib/ambiente";

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

/**
 * Só a Vercel em Production é "produção" para o Sentry. `NODE_ENV` não decide:
 * um deploy de Preview também roda com NODE_ENV=production. Local, CI do GitHub
 * e E2E não têm VERCEL_ENV, e portanto não enviam nada ao Sentry.
 */
const ambienteDeImplantacao = process.env.VERCEL_ENV ?? "";
const producao = ambienteDeImplantacao === "production";

// Proteção no BUILD: um deploy fora de Production na Vercel (Preview, Development)
// não pode ser construído apontando para o projeto Supabase de Production — por
// exemplo, por herdar as variáveis de Production. O build falha com mensagem
// explícita, sem citar URL nem chave. A mesma regra vale de novo em runtime, em
// lerAmbienteSupabase(). Fora da Vercel (local, CI, E2E) a variável não existe e
// nada é verificado.
//
// Exceção temporária: BS_PREVIEW_SHARED_SUPABASE=true (variável do servidor, escopo
// Preview) libera só o Preview a usar o Supabase compartilhado. Quando isso
// acontece o build avisa em voz alta, para o uso não passar despercebido.
if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
  verificarDestinoSupabase(
    process.env.VERCEL_ENV,
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.BS_PREVIEW_SHARED_SUPABASE,
  );

  if (
    previewCompartilhadoAutorizado(
      process.env.VERCEL_ENV,
      process.env.BS_PREVIEW_SHARED_SUPABASE,
    ) &&
    apontaParaProduction(process.env.NEXT_PUBLIC_SUPABASE_URL)
  ) {
    console.warn(
      "[isolamento] AVISO: este Preview usa o Supabase COMPARTILHADO (BS_PREVIEW_SHARED_SUPABASE=true). " +
        "Só é aceitável enquanto o banco tiver apenas dados fictícios.",
    );
  }
}

const nextConfig: NextConfig = {
  // Publica o ambiente de implantação ao navegador (VERCEL_ENV não existe lá).
  // Nome próprio de propósito: não depende de a Vercel expor
  // NEXT_PUBLIC_VERCEL_ENV, e vazio fora da Vercel significa "não é Production".
  env: { NEXT_PUBLIC_AMBIENTE: ambienteDeImplantacao },

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
  // Só em Production. Fora dela a rota não existe (404): um túnel aberto em
  // Preview deixaria qualquer um relayar envelopes ao Sentry real.
  tunnelRoute: producao ? "/monitoring" : false,

  // Fora de Production: nada vai ao Sentry no build — nem telemetria do plugin,
  // nem source maps, nem criação de release —, mesmo que SENTRY_AUTH_TOKEN
  // esteja presente no escopo da variável. Não depende da ausência do token.
  telemetry: producao,
  sourcemaps: { disable: !producao },
  release: { create: producao },

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: producao,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});
