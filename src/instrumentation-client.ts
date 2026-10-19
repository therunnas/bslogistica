// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

import { sentryHabilitado } from "@/lib/ambiente";

const habilitado = sentryHabilitado(process.env["NEXT_PUBLIC_AMBIENTE"]);

Sentry.init({
  // Só Production envia eventos. Local, CI, E2E e Preview ficam sem DSN: nada
  // sai da máquina nem do deploy. `NODE_ENV` não serve de critério — o Preview
  // da Vercel também roda com NODE_ENV=production.
  dsn: habilitado
    ? "https://61af9cd029eab6da3f484461be2f9d7d@o4512036932419584.ingest.us.sentry.io/4512036953260032"
    : undefined,
  enabled: habilitado,

  // 10% das transações em Production, nenhuma fora dela.
  tracesSampleRate: habilitado ? 0.1 : 0,

  // Session Replay desativado: a integração foi removida e as duas taxas ficam
  // em zero de propósito, como trava explícita. Este painel mostra dados de
  // clientes, colaboradores, contratos e valores faturados o tempo todo, e
  // gravar a tela levaria isso para um serviço externo.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,

  // Política conservadora de coleta. Painel administrativo com dados de
  // clientes, colaboradores, contratos e valores faturados: o Sentry recebe o
  // erro e a pilha, não o conteúdo em volta dele.
  //
  // Tudo abaixo está escrito de propósito, mesmo onde coincide com o padrão do
  // SDK — assim uma atualização de versão não muda a política em silêncio.
  dataCollection: {
    // `user.*` não é preenchido automaticamente. Já é o padrão em 10.73.0.
    userInfo: false,
    // Array vazio desliga corpos HTTP. O padrão coleta os quatro alvos:
    // requisição e resposta, de entrada e de saída.
    httpBodies: [],
    // Nenhum cookie vai nos eventos. O padrão é `true`, e o cookie de sessão
    // do Supabase (sb-*-auth-token) entraria por ele.
    cookies: false,
    // Nem cabeçalhos de requisição nem de resposta. O padrão coleta ambos, e
    // `Authorization` viaja neles. São contexto: desligá-los não afeta a
    // captura do erro nem a pilha.
    httpHeaders: { request: false, response: false },
    // Sem query string. O caminho da URL continua no evento e é o que serve ao
    // diagnóstico; o que vier depois do "?" pode carregar id de cliente,
    // período ou filtro operacional. Note que a opção não-obsoleta é
    // `urlQueryParams` — `queryParams` está marcada como deprecated.
    urlQueryParams: false,
  },
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
