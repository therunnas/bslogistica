/**
 * Content-Security-Policy da aplicação, montada por requisição em `src/proxy.ts`.
 *
 * Função pura: recebe o nonce, a origem do Supabase do AMBIENTE ATUAL e, só em
 * Production, a URL de relatório do Sentry. Nada é lido de `process.env` aqui.
 *
 *  - `connect-src` libera `'self'` e UMA origem de Supabase: a validada a partir
 *    de `NEXT_PUBLIC_SUPABASE_URL` (`origemDoSupabase`). Nunca um host vindo da
 *    requisição.
 *  - `report-uri` só existe em Production (`reportUri` não nulo): Preview, local
 *    e E2E não relatam violações ao Sentry real.
 *  - `script-src` continua com nonce e sem `unsafe-eval`.
 */

export interface OpcoesDaCsp {
  nonce: string;
  /** Origem validada do Supabase (`protocolo://host[:porta]`). */
  supabaseOrigem: string;
  /** Endpoint de relatório da CSP; `null` fora de Production. */
  reportUri: string | null;
}

export function construirCsp({ nonce, supabaseOrigem, reportUri }: OpcoesDaCsp): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${supabaseOrigem}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
    ...(reportUri === null ? [] : [`report-uri ${reportUri}`]),
  ].join("; ");
}
