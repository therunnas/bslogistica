/**
 * Testes do isolamento entre ambientes (C10).
 *
 * COMO RODAR:
 *
 *   npm run test:isolamento
 *
 * Sem framework, Node executando o TypeScript via `--experimental-strip-types`,
 * com o hook `_resolver-ts.mjs`. Sai com código diferente de zero em qualquer
 * falha. Nada aqui envia evento ao Sentry nem fala com Supabase: o Sentry só é
 * inicializado SEM DSN (ambientes não-Production), Production é conferido por
 * função pura e por forma literal — o DSN real nunca é usado num teste — e toda
 * URL, chave e JWT é SINTÉTICA (nenhuma credencial real, nenhuma rede).
 *
 * BLOCOS
 *
 *   A. identificação do ambiente (só VERCEL_ENV=production é Production; na Vercel
 *      sem VERCEL_ENV válido, falha)
 *   B. origem do Supabase, chaves e a matriz do gate contra o projeto de Production
 *   C. CSP por ambiente (Production preservada, report-uri só em Production)
 *   D. Sentry: configuração real carregada por ambiente (sem DSN fora de Production)
 *   E. leitura em runtime (lerAmbienteSupabase / criarClienteAdmin) e next.config
 *      (build) por ambiente
 *   F. forma literal: proxy, env, sem host fixo, sem desvio por variável, sem segredo
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { register } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  apontaParaProduction,
  chaveApontaParaProduction,
  classificarAmbiente,
  ehProducao,
  ErroDeIsolamentoDeAmbiente,
  executandoNaVercel,
  origemDoSupabase,
  referenciaDaChaveLegada,
  REFERENCIA_SUPABASE_PRODUCTION,
  sentryHabilitado,
  sinaisDe,
  verificarChaveDeServico,
  verificarDestinoSupabase,
} from "../src/lib/ambiente.ts";
import { construirCsp } from "../src/lib/csp.ts";

let passou = 0;
const falhas = [];

function verificar(caso, obtido, esperado) {
  if (obtido === esperado) {
    passou++;
    console.log(`  PASS  ${caso}`);
  } else {
    falhas.push(`${caso} — esperado ${String(esperado)}, obtido ${String(obtido)}`);
    console.log(`  FAIL  ${caso} — esperado ${String(esperado)}, obtido ${String(obtido)}`);
  }
}

const raiz = fileURLToPath(new URL("..", import.meta.url));
const fonte = (caminho) => readFileSync(join(raiz, caminho), "utf8");
const semComentarios = (texto) => texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

// Para arquivos com URL em string (o "//" de https:// não pode ser tomado por comentário).
const semComentariosDeLinha = (texto) =>
  texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function lanca(acao) {
  try {
    acao();
    return null;
  } catch (erro) {
    return erro;
  }
}

// `env.ts` e `admin.ts` importam por "@/lib/..." (alias do tsconfig), que o Node não
// conhece. Este hook, só da suíte, resolve o alias para src/ e delega o resto ao
// resolvedor compartilhado (`_resolver-ts.mjs`, já carregado por --import).
register(
  `data:text/javascript,${encodeURIComponent(`
    import { existsSync } from "node:fs";
    import { pathToFileURL } from "node:url";
    export async function resolve(especificador, contexto, proximo) {
      if (especificador.startsWith("@/")) {
        const base = ${JSON.stringify(join(raiz, "src"))} + "/" + especificador.slice(2);
        for (const candidato of [base + ".ts", base + ".tsx", base + "/index.ts"]) {
          if (existsSync(candidato)) return proximo(pathToFileURL(candidato).href, contexto);
        }
      }
      return proximo(especificador, contexto);
    }
  `)}`,
);
const { criarClienteAdmin } = await import("../src/integrations/supabase/admin.ts");
const { lerAmbienteSupabase } = await import("../src/integrations/supabase/env.ts");

const PROD = `https://${REFERENCIA_SUPABASE_PRODUCTION}.supabase.co`;
const TESTE = "https://abcdefghijklmnopqrst.supabase.co";
const LOCAL = "http://127.0.0.1:54321";
const INERTE = "https://ci-placeholder.invalid";

// Chaves 100% sintéticas. O JWT legado leva a referência no payload, como o do
// Supabase; a assinatura é lixo. Nada aqui é uma credencial real.
const base64url = (objeto) => Buffer.from(JSON.stringify(objeto)).toString("base64url");
const jwtSintetico = (referencia, papel = "anon") =>
  `${base64url({ alg: "HS256", typ: "JWT" })}.${base64url({ iss: "supabase", ref: referencia, role: papel })}.assinatura-sintetica`;
const CHAVE_PUBLICAVEL = "sb_publishable_sintetica_nao_real";
const CHAVE_LEGADA_PRODUCTION = jwtSintetico(REFERENCIA_SUPABASE_PRODUCTION);
const CHAVE_LEGADA_TESTE = jwtSintetico("abcdefghijklmnopqrst");
const SERVICO_LEGADA_PRODUCTION = jwtSintetico(REFERENCIA_SUPABASE_PRODUCTION, "service_role");
const SERVICO_LEGADA_TESTE = jwtSintetico("abcdefghijklmnopqrst", "service_role");

// Sinais de uma execução real na Vercel, por ambiente.
const NA_VERCEL = {
  production: {
    VERCEL: "1",
    VERCEL_ENV: "production",
    VERCEL_URL: "x.vercel.app",
    VERCEL_REGION: "gru1",
  },
  preview: {
    VERCEL: "1",
    VERCEL_ENV: "preview",
    VERCEL_URL: "x.vercel.app",
    VERCEL_REGION: "gru1",
  },
  development: { VERCEL: "1", VERCEL_ENV: "development" },
};

// --- A. ambiente --------------------------------------------------------------

console.log("\nA. Identificação do ambiente");

verificar("A1. 'production' é Production", ehProducao("production"), true);
for (const valor of [
  "preview",
  "development",
  "",
  "Production",
  "PRODUCTION",
  " production",
  "prod",
  "staging",
]) {
  verificar(`A2. ${JSON.stringify(valor)} NÃO é Production`, ehProducao(valor), false);
}
verificar("A3. ausente (local, CI, E2E) NÃO é Production", ehProducao(undefined), false);
verificar("A4. null NÃO é Production", ehProducao(null), false);
verificar("A5. o Sentry só liga em Production", sentryHabilitado("production"), true);
for (const valor of ["preview", "development", "", undefined, null, "Production", "staging"]) {
  verificar(`A6. Sentry desligado para ${JSON.stringify(valor)}`, sentryHabilitado(valor), false);
}

// Na Vercel, a ausência de VERCEL_ENV não prova ambiente seguro: os outros sinais
// de execução da plataforma obrigam a um VERCEL_ENV válido.
const classifica = (sinais) => lanca(() => classificarAmbiente(sinais));
verificar(
  "A7. sem nenhum sinal da Vercel: fora-da-vercel (local, CI, E2E)",
  classificarAmbiente({}),
  "fora-da-vercel",
);
verificar(
  "A8. sem sinais, mas com variáveis do CI do GitHub: ainda fora-da-vercel",
  classificarAmbiente(sinaisDe({ CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production" })),
  "fora-da-vercel",
);
for (const ambiente of ["production", "preview", "development"]) {
  verificar(
    `A9. Vercel + VERCEL_ENV=${ambiente}: classificado como ${ambiente}`,
    classificarAmbiente(NA_VERCEL[ambiente]),
    ambiente,
  );
}
for (const sinal of [
  "VERCEL",
  "VERCEL_URL",
  "VERCEL_REGION",
  "VERCEL_DEPLOYMENT_ID",
  "VERCEL_PROJECT_ID",
]) {
  verificar(
    `A10. só ${sinal} presente (VERCEL_ENV ausente): é Vercel e LANÇA`,
    executandoNaVercel({ [sinal]: "valor" }) &&
      classifica({ [sinal]: "valor" }) instanceof ErroDeIsolamentoDeAmbiente,
    true,
  );
}
for (const valor of ["", " ", "Production", "PREVIEW", " preview", "preview ", "staging", "prod"]) {
  verificar(
    `A11. na Vercel com VERCEL_ENV=${JSON.stringify(valor)}: LANÇA`,
    classifica({ VERCEL: "1", VERCEL_ENV: valor }) instanceof ErroDeIsolamentoDeAmbiente,
    true,
  );
}
verificar(
  "A12. VERCEL_ENV sozinho e inválido (sem outros sinais) também LANÇA",
  classifica({ VERCEL_ENV: "staging" }) instanceof ErroDeIsolamentoDeAmbiente,
  true,
);
verificar(
  "A13. VERCEL_ENV vazio sozinho conta como sinal e LANÇA (a Vercel nunca o define vazio)",
  classifica({ VERCEL_ENV: "" }) instanceof ErroDeIsolamentoDeAmbiente,
  true,
);
verificar(
  "A14. sinais vazios (VERCEL='') não contam como Vercel",
  classificarAmbiente({ VERCEL: "", VERCEL_URL: "", VERCEL_REGION: "" }),
  "fora-da-vercel",
);
verificar(
  "A15. a mensagem de falha não cita URL nem chave",
  !/supabase|https?:\/\//i.test(String(classifica({ VERCEL: "1" })?.message)),
  true,
);
verificar(
  "A16. sinaisDe recorta só o que o isolamento lê",
  Object.keys(
    sinaisDe({
      VERCEL: "1",
      VERCEL_ENV: "preview",
      SUPABASE_SERVICE_ROLE_KEY: "nao-deve-entrar",
      NEXT_PUBLIC_SUPABASE_URL: "nao-deve-entrar",
    }),
  )
    .sort()
    .join(","),
  "VERCEL,VERCEL_ENV",
);

// --- B. Supabase --------------------------------------------------------------

console.log("\nB. Destino do Supabase");

verificar("B1. origem de uma URL https", origemDoSupabase(TESTE), TESTE);
verificar("B2. caminho e query são descartados", origemDoSupabase(`${TESTE}/rest/v1/?x=1`), TESTE);
verificar("B3. loopback http é aceito (Supabase local do E2E)", origemDoSupabase(LOCAL), LOCAL);
verificar(
  "B4. localhost http é aceito",
  origemDoSupabase("http://localhost:54321"),
  "http://localhost:54321",
);
verificar(
  "B5. http fora de loopback é recusado",
  lanca(() => origemDoSupabase("http://abc.supabase.co")) instanceof ErroDeIsolamentoDeAmbiente,
  true,
);
verificar(
  "B6. protocolo estranho é recusado",
  lanca(() => origemDoSupabase("javascript:alert(1)")) instanceof ErroDeIsolamentoDeAmbiente,
  true,
);
verificar(
  "B7. credenciais embutidas são recusadas",
  lanca(() => origemDoSupabase("https://u:p@abc.supabase.co")) instanceof
    ErroDeIsolamentoDeAmbiente,
  true,
);
verificar(
  "B8. texto que não é URL é recusado",
  lanca(() => origemDoSupabase("não é url")) instanceof ErroDeIsolamentoDeAmbiente,
  true,
);
verificar(
  "B9. a mensagem de erro não reproduz o valor recebido",
  !String(lanca(() => origemDoSupabase("https://u:segredo@abc.supabase.co"))?.message).includes(
    "segredo",
  ),
  true,
);
verificar(
  "B10. a URL inerte do CI é aceita (build do CI continua possível)",
  origemDoSupabase(INERTE),
  INERTE,
);

verificar("B11. a URL de Production é reconhecida", apontaParaProduction(PROD), true);
verificar("B12. em maiúsculas também", apontaParaProduction(PROD.toUpperCase()), true);
verificar("B13. com ponto final no host também", apontaParaProduction(`${PROD}.`), true);
verificar(
  "B14. com subdomínio a mais também",
  apontaParaProduction(`https://x.${REFERENCIA_SUPABASE_PRODUCTION}.supabase.co`),
  true,
);
verificar("B15. com caminho também", apontaParaProduction(`${PROD}/auth/v1`), true);
verificar("B16. um projeto de teste NÃO é Production", apontaParaProduction(TESTE), false);
verificar("B17. o Supabase local NÃO é Production", apontaParaProduction(LOCAL), false);

// --- matriz do gate (verificarDestinoSupabase) --------------------------------

const sinaisProduction = NA_VERCEL.production;
const sinaisPreview = NA_VERCEL.preview;
const gate = (sinais, destino) => lanca(() => verificarDestinoSupabase(sinais, destino));
const bloqueado = (sinais, destino) => gate(sinais, destino) instanceof ErroDeIsolamentoDeAmbiente;
// O ambiente validado que o gate devolve, ou "lançou" se barrou.
const aprovado = (sinais, destino) =>
  gate(sinais, destino) === null ? verificarDestinoSupabase(sinais, destino) : "lançou";

verificar(
  "B18. M1 Production + URL de Production: permitido",
  gate(sinaisProduction, { url: PROD, chave: CHAVE_PUBLICAVEL }),
  null,
);
verificar(
  "B19. M2 Preview + URL de Production: BLOQUEADO",
  bloqueado(sinaisPreview, { url: PROD, chave: CHAVE_PUBLICAVEL }),
  true,
);
verificar(
  "B20. M3 Preview + chave publicável de Production (JWT legado) + URL de teste: BLOQUEADO",
  bloqueado(sinaisPreview, { url: TESTE, chave: CHAVE_LEGADA_PRODUCTION }),
  true,
);
verificar(
  "B21. M3 Preview + chave de Production + URL de Production: BLOQUEADO",
  bloqueado(sinaisPreview, { url: PROD, chave: CHAVE_LEGADA_PRODUCTION }),
  true,
);
verificar(
  "B22. M4 Preview sem URL: BLOQUEADO",
  bloqueado(sinaisPreview, { chave: CHAVE_PUBLICAVEL }),
  true,
);
verificar(
  "B23. M4 Preview com URL vazia: BLOQUEADO",
  bloqueado(sinaisPreview, { url: "", chave: CHAVE_PUBLICAVEL }),
  true,
);
verificar(
  "B24. M5 Preview sem chave publicável: BLOQUEADO",
  bloqueado(sinaisPreview, { url: TESTE }),
  true,
);
verificar(
  "B25. M5 Preview com chave vazia: BLOQUEADO",
  bloqueado(sinaisPreview, { url: TESTE, chave: "" }),
  true,
);
verificar(
  "B26. M6 Preview + URL isolada de teste + chave de teste: permitido",
  aprovado(sinaisPreview, { url: TESTE, chave: CHAVE_PUBLICAVEL }),
  "preview",
);
verificar(
  "B27. M6 Preview + URL de teste + JWT legado do próprio projeto de teste: permitido",
  aprovado(sinaisPreview, { url: TESTE, chave: CHAVE_LEGADA_TESTE }),
  "preview",
);
verificar(
  "B28. Development da Vercel + URL de Production: BLOQUEADO",
  bloqueado(NA_VERCEL.development, { url: PROD, chave: CHAVE_PUBLICAVEL }),
  true,
);
verificar(
  "B29. Development da Vercel + destino de teste: permitido",
  aprovado(NA_VERCEL.development, { url: TESTE, chave: CHAVE_PUBLICAVEL }),
  "development",
);
verificar(
  "B30. M8 Vercel sem VERCEL_ENV + URL de Production: BLOQUEADO (falha segura)",
  bloqueado({ VERCEL: "1", VERCEL_URL: "x.vercel.app" }, { url: PROD, chave: CHAVE_PUBLICAVEL }),
  true,
);
verificar(
  "B31. M8 Vercel sem VERCEL_ENV + destino de teste: BLOQUEADO também (não vira local)",
  bloqueado({ VERCEL: "1" }, { url: TESTE, chave: CHAVE_PUBLICAVEL }),
  true,
);
verificar(
  "B32. M8 Vercel sem VERCEL_ENV + nenhuma variável do Supabase: BLOQUEADO",
  bloqueado({ VERCEL: "1" }, {}),
  true,
);
for (const valor of ["staging", "Production", "PRODUCTION", "prod", " production", ""]) {
  verificar(
    `B33. M9 ambiente desconhecido ${JSON.stringify(valor)} + URL de Production: BLOQUEADO`,
    bloqueado({ VERCEL: "1", VERCEL_ENV: valor }, { url: PROD, chave: CHAVE_PUBLICAVEL }),
    true,
  );
}
verificar(
  "B34. M9 ambiente desconhecido + destino de teste: BLOQUEADO (não vira Production nem local)",
  bloqueado({ VERCEL: "1", VERCEL_ENV: "staging" }, { url: TESTE, chave: CHAVE_PUBLICAVEL }),
  true,
);
for (const [nome, destino] of [
  ["URL de Production", { url: PROD, chave: CHAVE_PUBLICAVEL }],
  ["URL inerte do CI", { url: INERTE, chave: "ci-placeholder-not-a-real-key" }],
  ["Supabase local", { url: LOCAL, chave: CHAVE_PUBLICAVEL }],
  ["sem variáveis", {}],
]) {
  verificar(
    `B35. M10 local/CI/E2E (nenhum sinal) + ${nome}: o gate não se aplica`,
    aprovado({}, destino),
    "fora-da-vercel",
  );
}
verificar(
  "B36. Production sem as variáveis do Supabase: o gate não decide (o erro de variável ausente é de lerAmbienteSupabase)",
  aprovado(sinaisProduction, {}),
  "production",
);

// Variações da URL de Production fora de Production.
for (const [nome, url] of [
  ["variação com subdomínio", `https://x.${REFERENCIA_SUPABASE_PRODUCTION}.supabase.co`],
  ["maiúsculas", PROD.toUpperCase()],
  ["ponto final no host", `${PROD}.`],
  ["com caminho", `${PROD}/auth/v1`],
  ["com porta", `${PROD}:443`],
  ["com query", `${PROD}/?a=b`],
  [
    "host codificado em percent",
    `https://%65${REFERENCIA_SUPABASE_PRODUCTION.slice(1)}.supabase.co`,
  ],
]) {
  verificar(
    `B37. Preview + URL de Production (${nome}): BLOQUEADO`,
    bloqueado(sinaisPreview, { url, chave: CHAVE_PUBLICAVEL }),
    true,
  );
}
for (const [nome, url] of [
  ["URL ilegível", "não é url"],
  ["http fora de loopback", "http://abc.supabase.co"],
  ["http em loopback (na Vercel exige https)", LOCAL],
  ["credenciais embutidas", "https://u:p@abc.supabase.co"],
  ["protocolo estranho", "javascript:alert(1)"],
]) {
  verificar(
    `B38. Preview + ${nome}: BLOQUEADO (fail-closed)`,
    bloqueado(sinaisPreview, { url, chave: CHAVE_PUBLICAVEL }),
    true,
  );
}

// Chave privilegiada.
verificar(
  "B39. Preview + service_role de Production (JWT legado): BLOQUEADO",
  bloqueado(sinaisPreview, {
    url: TESTE,
    chave: CHAVE_PUBLICAVEL,
    chaveDeServico: SERVICO_LEGADA_PRODUCTION,
  }),
  true,
);
verificar(
  "B40. Preview + service_role do projeto de teste: permitido",
  aprovado(sinaisPreview, {
    url: TESTE,
    chave: CHAVE_PUBLICAVEL,
    chaveDeServico: SERVICO_LEGADA_TESTE,
  }),
  "preview",
);
verificar(
  "B41. Production + service_role de Production: permitido (preservado)",
  lanca(() => verificarChaveDeServico(sinaisProduction, SERVICO_LEGADA_PRODUCTION)),
  null,
);
verificar(
  "B42. fora da Vercel + service_role de Production: o gate não se aplica",
  lanca(() => verificarChaveDeServico({}, SERVICO_LEGADA_PRODUCTION)),
  null,
);
verificar(
  "B43. Vercel sem VERCEL_ENV + qualquer service_role: BLOQUEADO",
  lanca(() => verificarChaveDeServico({ VERCEL: "1" }, SERVICO_LEGADA_TESTE)) instanceof
    ErroDeIsolamentoDeAmbiente,
  true,
);

// Leitura da referência numa chave legada.
verificar(
  "B44. a referência é lida do payload do JWT legado",
  referenciaDaChaveLegada(CHAVE_LEGADA_PRODUCTION),
  REFERENCIA_SUPABASE_PRODUCTION,
);
verificar(
  "B45. chave no formato novo não declara projeto",
  referenciaDaChaveLegada(CHAVE_PUBLICAVEL),
  null,
);
for (const lixo of [
  "",
  "a.b",
  "a.b.c",
  "a.!!!.c",
  `a.${Buffer.from("[]").toString("base64url")}.c`,
]) {
  verificar(
    `B46. chave ilegível ${JSON.stringify(lixo)}: sem referência e sem exceção`,
    referenciaDaChaveLegada(lixo),
    null,
  );
}
verificar(
  "B47. chaveApontaParaProduction distingue Production de teste",
  chaveApontaParaProduction(CHAVE_LEGADA_PRODUCTION) &&
    !chaveApontaParaProduction(CHAVE_LEGADA_TESTE),
  true,
);

// Mensagens.
const erroPreview = gate(sinaisPreview, { url: PROD, chave: CHAVE_PUBLICAVEL });
verificar(
  "B48. a mensagem do gate não cita a URL, o host nem a referência",
  !String(erroPreview?.message).includes(REFERENCIA_SUPABASE_PRODUCTION) &&
    !/supabase\.co|https?:\/\//.test(String(erroPreview?.message)),
  true,
);
verificar(
  "B49. e diz o que fazer",
  /projeto Supabase de teste/.test(String(erroPreview?.message)),
  true,
);
for (const [nome, erro] of [
  ["chave de Production", gate(sinaisPreview, { url: TESTE, chave: CHAVE_LEGADA_PRODUCTION })],
  [
    "service_role de Production",
    gate(sinaisPreview, {
      url: TESTE,
      chave: CHAVE_PUBLICAVEL,
      chaveDeServico: SERVICO_LEGADA_PRODUCTION,
    }),
  ],
  ["URL ausente", gate(sinaisPreview, { chave: CHAVE_PUBLICAVEL })],
]) {
  const texto = String(erro?.message);
  verificar(
    `B50. a mensagem (${nome}) não vaza chave nem referência`,
    !texto.includes(REFERENCIA_SUPABASE_PRODUCTION) &&
      !texto.includes("assinatura-sintetica") &&
      !texto.includes(CHAVE_PUBLICAVEL),
    true,
  );
}

// --- C. CSP -------------------------------------------------------------------

console.log("\nC. CSP por ambiente");

const NONCE = "bm9uY2UtZGUtdGVzdGU=";
const REPORT = "https://relatorio.invalid/csp";

// A CSP de Production tem de ser, byte a byte, a que existia antes desta etapa.
const CSP_ANTIGA_DE_PRODUCTION = [
  "default-src 'self'",
  `script-src 'self' 'nonce-${NONCE}'`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src 'self' ${PROD}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
  `report-uri ${REPORT}`,
].join("; ");

verificar(
  "C1. Production: idêntica à CSP anterior (mesma ordem, mesmo host, com report-uri)",
  construirCsp({ nonce: NONCE, supabaseOrigem: origemDoSupabase(PROD), reportUri: REPORT }),
  CSP_ANTIGA_DE_PRODUCTION,
);

const csp = (origem, reportUri) =>
  construirCsp({ nonce: NONCE, supabaseOrigem: origem, reportUri });
const previewCsp = csp(origemDoSupabase(TESTE), null);
verificar("C2. Preview: sem report-uri", /report-uri/.test(previewCsp), false);
verificar(
  "C3. Preview: o host de teste, e só ele",
  /connect-src 'self' https:\/\/abcdefghijklmnopqrst\.supabase\.co(;|$)/.test(previewCsp),
  true,
);
verificar(
  "C4. Preview: o host de Production não aparece",
  previewCsp.includes(REFERENCIA_SUPABASE_PRODUCTION),
  false,
);
const localCsp = csp(origemDoSupabase(LOCAL), null);
verificar(
  "C5. Local/E2E: libera o loopback",
  localCsp.includes(`connect-src 'self' ${LOCAL}`),
  true,
);
verificar("C6. Local/E2E: sem report-uri", /report-uri/.test(localCsp), false);
for (const [nome, valor] of [
  ["Production", CSP_ANTIGA_DE_PRODUCTION],
  ["Preview", previewCsp],
  ["Local", localCsp],
]) {
  verificar(
    `C7. ${nome}: script-src só com 'self' e nonce`,
    /script-src 'self' 'nonce-[^']+'(;|$)/.test(valor),
    true,
  );
  verificar(`C8. ${nome}: sem unsafe-eval`, /unsafe-eval/.test(valor), false);
  verificar(
    `C9. ${nome}: object-src none e frame-ancestors none`,
    valor.includes("object-src 'none'") && valor.includes("frame-ancestors 'none'"),
    true,
  );
  verificar(`C10. ${nome}: sem curinga em connect-src`, /connect-src[^;]*\*/.test(valor), false);
}
verificar(
  "C11. só uma origem de Supabase na CSP",
  (previewCsp.match(/https?:\/\/[^\s;]+/g) ?? []).length,
  1,
);
verificar(
  "C12. a CSP nunca aceita host de parâmetro: a função só recebe a origem já validada",
  /supabaseOrigem: string/.test(fonte("src/lib/csp.ts")),
  true,
);

// --- D. Sentry real -----------------------------------------------------------

console.log("\nD. Sentry: configuração real carregada por ambiente");

function inicializarSentry(arquivo, variaveis) {
  const programa = `
    const Sentry = await import("@sentry/nextjs");
    await import(${JSON.stringify("./" + arquivo)});
    const api = Sentry.getClient ? Sentry : Sentry.default;
    const cliente = api.getClient();
    const o = cliente ? cliente.getOptions() : null;
    console.log(JSON.stringify({
      cliente: Boolean(cliente),
      enabled: o ? o.enabled : null,
      dsn: o ? o.dsn ?? null : null,
      traces: o ? o.tracesSampleRate : null,
      transporte: o ? Boolean(cliente.getTransport && o.dsn) : null,
    }));
  `;
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...variaveis };
  const saida = execFileSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--import",
      "./scripts/_resolver-ts.mjs",
      "--input-type=module",
      "-e",
      programa,
    ],
    { cwd: raiz, env, encoding: "utf8" },
  );
  return JSON.parse(saida.trim().split("\n").pop());
}

for (const arquivo of ["sentry.server.config.ts", "sentry.edge.config.ts"]) {
  for (const [nome, vars] of [
    ["Preview", { VERCEL_ENV: "preview", NODE_ENV: "production" }],
    ["Development da Vercel", { VERCEL_ENV: "development" }],
    ["local (sem VERCEL_ENV)", {}],
    ["CI (sem VERCEL_ENV)", { CI: "true", NODE_ENV: "production" }],
    ["VERCEL_ENV desconhecido", { VERCEL_ENV: "staging", NODE_ENV: "production" }],
    ["Vercel sem VERCEL_ENV (só VERCEL=1)", { VERCEL: "1", NODE_ENV: "production" }],
  ]) {
    const r = inicializarSentry(arquivo, vars);
    verificar(`D1. ${arquivo} / ${nome}: desabilitado`, r.enabled, false);
    verificar(`D2. ${arquivo} / ${nome}: sem DSN`, r.dsn, null);
    verificar(`D3. ${arquivo} / ${nome}: traces zerados`, r.traces, 0);
  }
}

// Production: conferido por forma literal e função pura (o DSN real não é usado em teste).
for (const arquivo of [
  "sentry.server.config.ts",
  "sentry.edge.config.ts",
  "src/instrumentation-client.ts",
]) {
  const codigo = semComentariosDeLinha(fonte(arquivo));
  verificar(
    `D4. ${arquivo}: o DSN só é usado quando habilitado`,
    /dsn: habilitado\s*\?\s*"https:\/\/[^"]+"\s*:\s*undefined/.test(codigo),
    true,
  );
  verificar(
    `D5. ${arquivo}: o DSN aparece uma única vez`,
    (codigo.match(/https:\/\/[0-9a-f]+@/g) ?? []).length,
    1,
  );
  verificar(`D6. ${arquivo}: enabled segue o gate`, /enabled: habilitado,/.test(codigo), true);
  verificar(
    `D7. ${arquivo}: Production mantém 10% de traces`,
    /tracesSampleRate: habilitado \? 0\.1 : 0,/.test(codigo),
    true,
  );
  verificar(`D8. ${arquivo}: NODE_ENV não é critério`, /NODE_ENV/.test(codigo), false);
  verificar(
    `D9. ${arquivo}: o gate vem de sentryHabilitado`,
    /sentryHabilitado\(process\.env\["(VERCEL_ENV|NEXT_PUBLIC_AMBIENTE)"\]\)/.test(codigo),
    true,
  );
  verificar(
    `D10. ${arquivo}: a política de coleta de dados foi preservada`,
    /userInfo: false/.test(codigo) &&
      /cookies: false/.test(codigo) &&
      /httpBodies: \[\]/.test(codigo) &&
      /urlQueryParams: false/.test(codigo),
    true,
  );
}
verificar(
  "D11. servidor e edge leem VERCEL_ENV",
  fonte("sentry.server.config.ts").includes('process.env["VERCEL_ENV"]') &&
    fonte("sentry.edge.config.ts").includes('process.env["VERCEL_ENV"]'),
  true,
);
verificar(
  "D12. o navegador lê NEXT_PUBLIC_AMBIENTE (VERCEL_ENV não existe lá)",
  fonte("src/instrumentation-client.ts").includes('process.env["NEXT_PUBLIC_AMBIENTE"]'),
  true,
);
verificar(
  "D13. Replay continua desligado",
  /replaysSessionSampleRate: 0,/.test(fonte("src/instrumentation-client.ts")) &&
    /replaysOnErrorSampleRate: 0,/.test(fonte("src/instrumentation-client.ts")),
  true,
);

// --- E. runtime e build -------------------------------------------------------

console.log("\nE. Leitura em runtime e next.config (build) por ambiente");

// --- E.1. runtime: lerAmbienteSupabase e criarClienteAdmin (servidor) --------

const VARIAVEIS_DO_AMBIENTE = [
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_URL",
  "VERCEL_REGION",
  "VERCEL_DEPLOYMENT_ID",
  "VERCEL_PROJECT_ID",
  "NEXT_PUBLIC_AMBIENTE",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "BS_PREVIEW_SHARED_SUPABASE",
];

/** Roda `acao` com EXATAMENTE estas variáveis (as demais do conjunto são removidas). */
function comAmbiente(variaveis, acao) {
  const guardado = {};
  for (const nome of VARIAVEIS_DO_AMBIENTE) {
    guardado[nome] = process.env[nome];
    delete process.env[nome];
  }
  Object.assign(process.env, variaveis);
  try {
    return acao();
  } finally {
    for (const nome of VARIAVEIS_DO_AMBIENTE) {
      if (guardado[nome] === undefined) delete process.env[nome];
      else process.env[nome] = guardado[nome];
    }
  }
}

const SUPABASE_DE_TESTE = {
  NEXT_PUBLIC_SUPABASE_URL: TESTE,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: CHAVE_PUBLICAVEL,
};
const SUPABASE_DE_PRODUCTION = {
  NEXT_PUBLIC_SUPABASE_URL: PROD,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: CHAVE_PUBLICAVEL,
};
const ler = (variaveis) => lanca(() => comAmbiente(variaveis, () => lerAmbienteSupabase()));
const lerValor = (variaveis) => comAmbiente(variaveis, () => lerAmbienteSupabase());
const barrou = (erro) => erro instanceof ErroDeIsolamentoDeAmbiente;

verificar(
  "E1. runtime M1: Production + URL de Production lê e devolve a mesma URL",
  lerValor({ ...NA_VERCEL.production, ...SUPABASE_DE_PRODUCTION }).url,
  PROD,
);
verificar(
  "E2. runtime M2: Preview + URL de Production: BLOQUEADO",
  barrou(ler({ ...NA_VERCEL.preview, ...SUPABASE_DE_PRODUCTION })),
  true,
);
verificar(
  "E3. runtime M3: Preview + chave de Production (JWT legado): BLOQUEADO",
  barrou(
    ler({
      ...NA_VERCEL.preview,
      NEXT_PUBLIC_SUPABASE_URL: TESTE,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: CHAVE_LEGADA_PRODUCTION,
    }),
  ),
  true,
);
verificar(
  "E4. runtime M4: Preview sem URL: BLOQUEADO",
  barrou(ler({ ...NA_VERCEL.preview, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: CHAVE_PUBLICAVEL })),
  true,
);
verificar(
  "E5. runtime M5: Preview sem chave publicável: BLOQUEADO",
  barrou(ler({ ...NA_VERCEL.preview, NEXT_PUBLIC_SUPABASE_URL: TESTE })),
  true,
);
verificar(
  "E6. runtime M4/M5: Preview sem nenhuma das duas: BLOQUEADO",
  barrou(ler({ ...NA_VERCEL.preview })),
  true,
);
verificar(
  "E7. runtime M6: Preview + destino de teste: permitido",
  lerValor({ ...NA_VERCEL.preview, ...SUPABASE_DE_TESTE }).url,
  TESTE,
);

// M7: BS_PREVIEW_SHARED_SUPABASE não é lida em lugar nenhum: nenhum valor abre exceção.
for (const valor of ["true", "TRUE", "1", "yes", "sim", "false", ""]) {
  verificar(
    `E8. runtime M7: Preview + URL de Production + BS_PREVIEW_SHARED_SUPABASE=${JSON.stringify(valor)}: BLOQUEADO`,
    barrou(
      ler({
        ...NA_VERCEL.preview,
        ...SUPABASE_DE_PRODUCTION,
        BS_PREVIEW_SHARED_SUPABASE: valor,
      }),
    ),
    true,
  );
}
verificar(
  "E9. runtime M7: a variável também não afrouxa ambiente indefinido na Vercel",
  barrou(ler({ VERCEL: "1", ...SUPABASE_DE_PRODUCTION, BS_PREVIEW_SHARED_SUPABASE: "true" })),
  true,
);
verificar(
  "E10. runtime M7: nem Development da Vercel",
  barrou(
    ler({
      ...NA_VERCEL.development,
      ...SUPABASE_DE_PRODUCTION,
      BS_PREVIEW_SHARED_SUPABASE: "true",
    }),
  ),
  true,
);
verificar(
  "E11. runtime M7: com a variável e um destino de teste, o resultado é o mesmo de sem ela",
  lerValor({ ...NA_VERCEL.preview, ...SUPABASE_DE_TESTE, BS_PREVIEW_SHARED_SUPABASE: "true" }).url,
  lerValor({ ...NA_VERCEL.preview, ...SUPABASE_DE_TESTE }).url,
);

verificar(
  "E12. runtime M8: Vercel sem VERCEL_ENV (só VERCEL=1) + URL de Production: BLOQUEADO",
  barrou(ler({ VERCEL: "1", ...SUPABASE_DE_PRODUCTION })),
  true,
);
verificar(
  "E13. runtime M8: Vercel sem VERCEL_ENV + destino de teste: BLOQUEADO (não vira local)",
  barrou(ler({ VERCEL_URL: "x.vercel.app", ...SUPABASE_DE_TESTE })),
  true,
);
for (const valor of ["staging", "Production", "preview "]) {
  verificar(
    `E14. runtime M9: VERCEL_ENV=${JSON.stringify(valor)}: BLOQUEADO`,
    barrou(ler({ VERCEL: "1", VERCEL_ENV: valor, ...SUPABASE_DE_TESTE })),
    true,
  );
}
verificar(
  "E15. runtime M10: local (nenhum sinal) + URL de Production: preservado, lê normalmente",
  lerValor({ ...SUPABASE_DE_PRODUCTION }).url,
  PROD,
);
verificar(
  "E16. runtime M10: local + Supabase local (E2E): preservado",
  lerValor({ NEXT_PUBLIC_SUPABASE_URL: LOCAL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "x" }).url,
  LOCAL,
);
verificar(
  "E17. runtime M10: CI com URL inerte: preservado",
  lerValor({
    CI: "true",
    NEXT_PUBLIC_SUPABASE_URL: INERTE,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "ci-placeholder-not-a-real-key",
  }).url,
  INERTE,
);
{
  const faltando = ler({});
  verificar(
    "E18. local sem variáveis: o erro de variável ausente de sempre (não é de isolamento)",
    faltando instanceof Error &&
      !barrou(faltando) &&
      /Variáveis de ambiente do Supabase ausentes/.test(faltando.message),
    true,
  );
  const faltandoEmProduction = ler({ ...NA_VERCEL.production });
  verificar(
    "E19. Production sem variáveis: o mesmo erro de variável ausente (comportamento preservado)",
    faltandoEmProduction instanceof Error &&
      !barrou(faltandoEmProduction) &&
      /Variáveis de ambiente do Supabase ausentes/.test(faltandoEmProduction.message),
    true,
  );
}
verificar(
  "E20. NEXT_PUBLIC_AMBIENTE herdado não afeta o servidor: o servidor lê VERCEL_ENV",
  lerValor({ ...NA_VERCEL.production, ...SUPABASE_DE_PRODUCTION, NEXT_PUBLIC_AMBIENTE: "preview" })
    .url,
  PROD,
);

// Navegador: não há VERCEL_ENV; vale o ambiente que o build publicou, já validado.
function noNavegador(variaveis, acao) {
  globalThis.window = {};
  try {
    return acao(variaveis);
  } finally {
    delete globalThis.window;
  }
}
const lerNoNavegador = (variaveis) => noNavegador(variaveis, (v) => ler(v));
verificar(
  "E21. navegador: bundle de Preview com a URL de Production: BLOQUEADO",
  barrou(lerNoNavegador({ NEXT_PUBLIC_AMBIENTE: "preview", ...SUPABASE_DE_PRODUCTION })),
  true,
);
verificar(
  "E22. navegador: bundle de Production com a URL de Production: permitido",
  lerNoNavegador({ NEXT_PUBLIC_AMBIENTE: "production", ...SUPABASE_DE_PRODUCTION }),
  null,
);
verificar(
  "E23. navegador: bundle de Preview com destino de teste: permitido",
  lerNoNavegador({ NEXT_PUBLIC_AMBIENTE: "preview", ...SUPABASE_DE_TESTE }),
  null,
);
verificar(
  "E24. navegador: bundle local (ambiente vazio): permitido",
  lerNoNavegador({ NEXT_PUBLIC_AMBIENTE: "", ...SUPABASE_DE_PRODUCTION }),
  null,
);
verificar(
  "E25. navegador: ambiente publicado inválido: BLOQUEADO",
  barrou(lerNoNavegador({ NEXT_PUBLIC_AMBIENTE: "staging", ...SUPABASE_DE_TESTE })),
  true,
);
verificar(
  "E26. navegador: nem a variável do servidor nem os sinais da Vercel são lidos lá",
  barrou(lerNoNavegador({ VERCEL: "1", VERCEL_ENV: "preview", ...SUPABASE_DE_PRODUCTION })),
  false,
);

// Cliente administrativo (service_role): só no servidor, com a chave de Production barrada fora dela.
const criarAdmin = (variaveis) => lanca(() => comAmbiente(variaveis, () => criarClienteAdmin()));
verificar(
  "E27. admin: Production + service_role de Production: cria o cliente",
  criarAdmin({
    ...NA_VERCEL.production,
    ...SUPABASE_DE_PRODUCTION,
    SUPABASE_SERVICE_ROLE_KEY: SERVICO_LEGADA_PRODUCTION,
  }),
  null,
);
verificar(
  "E28. admin: Preview + destino de teste + service_role de Production: BLOQUEADO",
  barrou(
    criarAdmin({
      ...NA_VERCEL.preview,
      ...SUPABASE_DE_TESTE,
      SUPABASE_SERVICE_ROLE_KEY: SERVICO_LEGADA_PRODUCTION,
    }),
  ),
  true,
);
verificar(
  "E29. admin: Preview + destino de teste + service_role do projeto de teste: cria o cliente",
  criarAdmin({
    ...NA_VERCEL.preview,
    ...SUPABASE_DE_TESTE,
    SUPABASE_SERVICE_ROLE_KEY: SERVICO_LEGADA_TESTE,
  }),
  null,
);
verificar(
  "E30. admin: Preview + URL de Production: BLOQUEADO antes de olhar a chave",
  barrou(
    criarAdmin({
      ...NA_VERCEL.preview,
      ...SUPABASE_DE_PRODUCTION,
      SUPABASE_SERVICE_ROLE_KEY: SERVICO_LEGADA_TESTE,
    }),
  ),
  true,
);
verificar(
  "E31. admin: Preview sem service_role: o erro de chave ausente de sempre (nada administrativo funciona)",
  /SUPABASE_SERVICE_ROLE_KEY ausente/.test(
    String(criarAdmin({ ...NA_VERCEL.preview, ...SUPABASE_DE_TESTE })?.message),
  ),
  true,
);
verificar(
  "E32. admin: Vercel sem VERCEL_ENV + service_role: BLOQUEADO",
  barrou(
    criarAdmin({
      VERCEL: "1",
      ...SUPABASE_DE_TESTE,
      SUPABASE_SERVICE_ROLE_KEY: SERVICO_LEGADA_TESTE,
    }),
  ),
  true,
);
verificar(
  "E33. admin: local com service_role de Production: preservado",
  criarAdmin({ ...SUPABASE_DE_PRODUCTION, SUPABASE_SERVICE_ROLE_KEY: SERVICO_LEGADA_PRODUCTION }),
  null,
);

// --- E.2. build: next.config.ts em processo separado --------------------------

function configPara(variaveis) {
  const programa = `
    const mod = await import("./next.config.ts");
    const bruta = mod.default;
    const config = typeof bruta === "function" ? await bruta("phase-production-build", { defaultConfig: {} }) : bruta;
    const reescritas = typeof config.rewrites === "function" ? await config.rewrites() : [];
    const lista = Array.isArray(reescritas) ? reescritas : [...(reescritas.beforeFiles ?? []), ...(reescritas.afterFiles ?? []), ...(reescritas.fallback ?? [])];
    console.log(JSON.stringify({
      ambiente: config.env?.NEXT_PUBLIC_AMBIENTE ?? null,
      publicadas: Object.keys(config.env ?? {}),
      tunel: lista.some((r) => String(r.source).startsWith("/monitoring")),
      typedRoutes: config.typedRoutes ?? config.experimental?.typedRoutes ?? null,
    }));
  `;
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...variaveis };
  const saida = execFileSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--import",
      "./scripts/_resolver-ts.mjs",
      "--input-type=module",
      "-e",
      programa,
    ],
    { cwd: raiz, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return JSON.parse(saida.trim().split("\n").pop());
}

for (const [nome, vars, ambiente, tunel] of [
  ["Production", { ...NA_VERCEL.production, ...SUPABASE_DE_PRODUCTION }, "production", true],
  ["Preview", { ...NA_VERCEL.preview, ...SUPABASE_DE_TESTE }, "preview", false],
  [
    "Development da Vercel",
    { ...NA_VERCEL.development, ...SUPABASE_DE_TESTE },
    "development",
    false,
  ],
  ["local/E2E (nenhum sinal)", {}, "", false],
  ["CI", { CI: "true", NODE_ENV: "production" }, "", false],
]) {
  const c = configPara(vars);
  verificar(`E34. ${nome}: ambiente validado e publicado ao navegador`, c.ambiente, ambiente);
  verificar(`E35. ${nome}: túnel do Sentry ${tunel ? "ativo" : "inexistente"}`, c.tunel, tunel);
  verificar(`E36. ${nome}: typedRoutes continua ligado`, c.typedRoutes, true);
  verificar(
    `E37. ${nome}: nada que pareça segredo é publicado ao navegador pelo config`,
    c.publicadas.includes("NEXT_PUBLIC_AMBIENTE") &&
      !c.publicadas.some((chave) => /SERVICE|SECRET|TOKEN|PASSWORD|PRIVATE/i.test(chave)),
    true,
  );
}

// O build é barrado.
function configFalha(variaveis) {
  try {
    configPara(variaveis);
    return { falhou: false, saida: "" };
  } catch (erro) {
    return { falhou: true, saida: `${erro.stderr ?? ""}${erro.stdout ?? ""}${erro.message ?? ""}` };
  }
}
const sinalDeFalhaDoGate = /Este ambiente|Execução na Vercel sem um VERCEL_ENV válido/;
for (const [nome, vars] of [
  ["M2 Preview + URL de Production", { ...NA_VERCEL.preview, ...SUPABASE_DE_PRODUCTION }],
  [
    "M3 Preview + chave de Production",
    {
      ...NA_VERCEL.preview,
      NEXT_PUBLIC_SUPABASE_URL: TESTE,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: CHAVE_LEGADA_PRODUCTION,
    },
  ],
  [
    "M4 Preview sem URL",
    { ...NA_VERCEL.preview, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: CHAVE_PUBLICAVEL },
  ],
  ["M5 Preview sem chave publicável", { ...NA_VERCEL.preview, NEXT_PUBLIC_SUPABASE_URL: TESTE }],
  ["Preview sem nenhuma variável do Supabase", { ...NA_VERCEL.preview }],
  [
    "M7 Preview + URL de Production + BS_PREVIEW_SHARED_SUPABASE=true",
    { ...NA_VERCEL.preview, ...SUPABASE_DE_PRODUCTION, BS_PREVIEW_SHARED_SUPABASE: "true" },
  ],
  [
    "Development da Vercel + URL de Production",
    { ...NA_VERCEL.development, ...SUPABASE_DE_PRODUCTION },
  ],
  [
    "Preview + destino de teste + service_role de Production",
    {
      ...NA_VERCEL.preview,
      ...SUPABASE_DE_TESTE,
      SUPABASE_SERVICE_ROLE_KEY: SERVICO_LEGADA_PRODUCTION,
    },
  ],
  ["M8 Vercel sem VERCEL_ENV (VERCEL=1)", { VERCEL: "1", ...SUPABASE_DE_TESTE }],
  [
    "M8 Vercel sem VERCEL_ENV (só VERCEL_URL)",
    { VERCEL_URL: "x.vercel.app", ...SUPABASE_DE_TESTE },
  ],
  ["M8 Vercel sem VERCEL_ENV + URL de Production", { VERCEL: "1", ...SUPABASE_DE_PRODUCTION }],
  ["M9 VERCEL_ENV=staging", { VERCEL: "1", VERCEL_ENV: "staging", ...SUPABASE_DE_PRODUCTION }],
  [
    "M9 VERCEL_ENV=Production (caixa)",
    { VERCEL: "1", VERCEL_ENV: "Production", ...SUPABASE_DE_PRODUCTION },
  ],
]) {
  const r = configFalha(vars);
  verificar(`E38. build: ${nome}: o config FALHA`, r.falhou, true);
  verificar(
    `E39. build: ${nome}: a falha é a explícita do gate e não cita referência nem chave`,
    sinalDeFalhaDoGate.test(r.saida) &&
      !r.saida.includes(`${REFERENCIA_SUPABASE_PRODUCTION}.supabase.co`) &&
      !r.saida.includes("assinatura-sintetica"),
    true,
  );
}
verificar(
  "E40. build: Production + Production carrega (Production preservada)",
  configFalha({ ...NA_VERCEL.production, ...SUPABASE_DE_PRODUCTION }).falhou,
  false,
);
verificar(
  "E41. build: Production com service_role de Production carrega",
  configFalha({
    ...NA_VERCEL.production,
    ...SUPABASE_DE_PRODUCTION,
    SUPABASE_SERVICE_ROLE_KEY: SERVICO_LEGADA_PRODUCTION,
  }).falhou,
  false,
);
verificar(
  "E42. build: Preview + destino de teste carrega",
  configFalha({ ...NA_VERCEL.preview, ...SUPABASE_DE_TESTE }).falhou,
  false,
);
verificar(
  "E43. build: local/CI/E2E (nenhum sinal) + qualquer URL carrega",
  configFalha({ NEXT_PUBLIC_SUPABASE_URL: PROD }).falhou === false &&
    configFalha({ NEXT_PUBLIC_SUPABASE_URL: INERTE }).falhou === false &&
    configFalha({ NEXT_PUBLIC_SUPABASE_URL: LOCAL }).falhou === false &&
    configFalha({}).falhou === false,
  true,
);

{
  const codigo = semComentarios(fonte("next.config.ts"));
  verificar(
    "E44. next.config usa o mesmo gate de src/lib/ambiente.ts (uma só regra)",
    /verificarDestinoSupabase\(sinaisDe\(process\.env\), \{/.test(codigo) &&
      /chaveDeServico: process\.env\.SUPABASE_SERVICE_ROLE_KEY/.test(codigo),
    true,
  );
  verificar(
    "E45. só o ambiente validado como production liga 'producao'",
    /const producao = ambienteDeExecucao === "production";/.test(codigo),
    true,
  );
  verificar(
    "E46. o túnel só existe em Production",
    /tunnelRoute: producao \? "\/monitoring" : false/.test(codigo),
    true,
  );
  verificar(
    "E47. telemetria do plugin só em Production",
    /telemetry: producao,/.test(codigo),
    true,
  );
  verificar(
    "E48. source maps desabilitados fora de Production (não depende do token)",
    /sourcemaps: \{ disable: !producao \}/.test(codigo),
    true,
  );
  verificar("E49. release só em Production", /release: \{ create: producao \}/.test(codigo), true);
  verificar(
    "E50. monitores de cron da Vercel só em Production",
    /automaticVercelMonitors: producao,/.test(codigo),
    true,
  );
  verificar(
    "E51. nada depende de SENTRY_AUTH_TOKEN para decidir",
    /SENTRY_AUTH_TOKEN/.test(codigo),
    false,
  );
  verificar(
    "E52. os cabeçalhos de segurança estão intactos",
    ["X-Content-Type-Options", "Referrer-Policy", "X-Frame-Options", "Permissions-Policy"].every(
      (h) => codigo.includes(h),
    ),
    true,
  );
}

// --- F. forma literal ---------------------------------------------------------

console.log("\nF. Forma do código");

const proxy = semComentarios(fonte("src/proxy.ts"));
verificar("F1. o proxy não tem host de Supabase fixo", /supabase\.co/.test(proxy), false);
verificar(
  "F2. a origem do Supabase vem de NEXT_PUBLIC_SUPABASE_URL validada",
  /supabaseOrigem: origemDoSupabase\(url\)/.test(proxy),
  true,
);
verificar(
  "F3. o report-uri só vai em Production",
  /reportUri: ehProducao\(process\.env\["VERCEL_ENV"\]\) \? SENTRY_CSP_REPORT_URI : null/.test(
    proxy,
  ),
  true,
);
verificar(
  "F4. a CSP vem de construirCsp (src/lib/csp.ts)",
  /from "@\/lib\/csp"/.test(proxy) && !/function construirCsp/.test(proxy),
  true,
);
verificar(
  "F5. nenhum host vem da requisição",
  /request\.(headers|nextUrl|url)[^;]*(host|origin)/i.test(proxy),
  false,
);
verificar(
  "F6. a CSP continua sendo enviada na resposta e na requisição",
  proxy.includes('requestHeaders.set("Content-Security-Policy", csp)') &&
    proxy.includes('resposta.headers.set("Content-Security-Policy", csp)'),
  true,
);
verificar(
  "F7. a renovação de sessão continua (getUser)",
  proxy.includes("await supabase.auth.getUser()"),
  true,
);
verificar(
  "F8. o matcher continua excluindo a rota do túnel",
  fonte("src/proxy.ts").includes("monitoring|branding"),
  true,
);
verificar(
  "F8b. o proxy valida o ambiente (lerAmbienteSupabase) ANTES de montar a CSP",
  proxy.indexOf("lerAmbienteSupabase()") !== -1 &&
    proxy.indexOf("lerAmbienteSupabase()") < proxy.indexOf("construirCsp({"),
  true,
);
verificar(
  "F8c. o nonce por requisição continua (randomUUID por chamada)",
  /const nonce = Buffer\.from\(crypto\.randomUUID\(\)\)\.toString\("base64"\)/.test(proxy),
  true,
);

const env = semComentarios(fonte("src/integrations/supabase/env.ts"));
verificar(
  "F9. lerAmbienteSupabase aplica o gate ANTES do erro de variável ausente",
  env.indexOf("verificarDestinoSupabase(sinaisDoAmbiente(), { url, chave })") !== -1 &&
    env.indexOf("verificarDestinoSupabase(sinaisDoAmbiente(), { url, chave })") <
      env.indexOf("if (!url || !chave)"),
  true,
);
verificar(
  "F10. servidor lê os sinais da Vercel um a um; navegador só NEXT_PUBLIC_AMBIENTE",
  [
    "VERCEL_ENV",
    "VERCEL",
    "VERCEL_URL",
    "VERCEL_REGION",
    "VERCEL_DEPLOYMENT_ID",
    "VERCEL_PROJECT_ID",
  ].every((nome) => env.includes(`process.env["${nome}"]`)) &&
    env.includes('process.env["NEXT_PUBLIC_AMBIENTE"]'),
  true,
);
verificar(
  "F11. nenhum fallback para a URL de Production",
  /supabase\.co|REFERENCIA_SUPABASE_PRODUCTION/.test(env),
  false,
);

const ambiente = fonte("src/lib/ambiente.ts");
verificar(
  "F12. ambiente.ts é puro: não lê process.env",
  /process\.env/.test(semComentarios(ambiente)),
  false,
);
verificar(
  "F13. ambiente.ts não importa Next, Supabase nem Node",
  /from "(next|@supabase|node:)/.test(ambiente),
  false,
);
verificar(
  "F13b. ambiente.ts não usa NODE_ENV como critério",
  /NODE_ENV/.test(semComentarios(ambiente)),
  false,
);

function arquivosDe(dir) {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    return statSync(caminho).isDirectory() ? arquivosDe(caminho) : [caminho];
  });
}
const arquivosDoSrc = arquivosDe(join(raiz, "src")).filter((a) => /\.(ts|tsx)$/.test(a));
const relativoAoSrc = (a) => a.replace(/\\/g, "/").split("/src/")[1];

verificar(
  "F14. a referência de Production aparece só em src/lib/ambiente.ts",
  arquivosDoSrc
    .filter((a) => readFileSync(a, "utf8").includes(REFERENCIA_SUPABASE_PRODUCTION))
    .map(relativoAoSrc)
    .join(","),
  "lib/ambiente.ts",
);

for (const arquivo of [
  "src/lib/ambiente.ts",
  "src/lib/csp.ts",
  "src/proxy.ts",
  "src/integrations/supabase/env.ts",
]) {
  verificar(
    `F15. ${arquivo}: sem service_role`,
    /service_role|SERVICE_ROLE/.test(semComentarios(fonte(arquivo))),
    false,
  );
}
verificar(
  "F16. SUPABASE_SERVICE_ROLE_KEY só é lida em src/integrations/supabase/admin.ts (servidor)",
  arquivosDoSrc
    .filter((a) => semComentarios(readFileSync(a, "utf8")).includes("SUPABASE_SERVICE_ROLE_KEY"))
    .map(relativoAoSrc)
    .join(","),
  "integrations/supabase/admin.ts",
);
verificar(
  "F16b. admin.ts aplica o gate da chave privilegiada",
  /verificarChaveDeServico\(/.test(semComentarios(fonte("src/integrations/supabase/admin.ts"))),
  true,
);
verificar(
  "F16c. nenhuma variável NEXT_PUBLIC_ carrega segredo no nome",
  arquivosDoSrc.some((a) =>
    /NEXT_PUBLIC_[A-Z_]*(SECRET|SERVICE|PRIVATE|TOKEN|PASSWORD)/.test(readFileSync(a, "utf8")),
  ),
  false,
);

// Nenhum desvio: BS_PREVIEW_SHARED_SUPABASE não existe no código de execução.
{
  const arquivosDeExecucao = [
    ...arquivosDoSrc,
    ...["next.config.ts", "sentry.server.config.ts", "sentry.edge.config.ts"].map((a) =>
      join(raiz, a),
    ),
  ];
  verificar(
    "F19. BS_PREVIEW_SHARED_SUPABASE não aparece em nenhum arquivo de execução (nem em comentário)",
    arquivosDeExecucao.filter((a) => readFileSync(a, "utf8").includes("BS_PREVIEW_SHARED")).length,
    0,
  );
  verificar(
    "F20. nenhum arquivo de execução cria exceção por variável (sem 'compartilhado' / 'autorizado')",
    arquivosDeExecucao.filter((a) =>
      /previewCompartilhado|compartilhado|VARIAVEL_PREVIEW/i.test(
        semComentarios(readFileSync(a, "utf8")),
      ),
    ).length,
    0,
  );
  verificar(
    "F21. nenhum NEXT_PUBLIC_ relaxa o gate (só NEXT_PUBLIC_AMBIENTE, que apenas reflete o build)",
    [
      ...new Set(
        arquivosDeExecucao.flatMap(
          (a) => semComentarios(readFileSync(a, "utf8")).match(/NEXT_PUBLIC_[A-Z0-9_]+/g) ?? [],
        ),
      ),
    ]
      .sort()
      .join(","),
    "NEXT_PUBLIC_AMBIENTE,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,NEXT_PUBLIC_SUPABASE_URL",
  );
}

// Integração: CI e scripts.
verificar(
  "F22. o CI roda test:isolamento",
  /npm run test:isolamento/.test(fonte(".github/workflows/ci.yml")),
  true,
);
verificar(
  "F23. o script test:isolamento existe e usa o resolvedor",
  JSON.parse(fonte("package.json")).scripts["test:isolamento"],
  "node --experimental-strip-types --import ./scripts/_resolver-ts.mjs scripts/testar-isolamento.mjs",
);

const pacote = JSON.parse(fonte("package.json"));
const trava = JSON.parse(fonte("package-lock.json"));
verificar(
  "F17. Sentry na faixa corrigida do GHSA-mchm-gjx6-7h55 (SEC-DEP-01)",
  pacote.dependencies["@sentry/nextjs"],
  "^10.75.2",
);
verificar(
  "F18. o lockfile resolve @sentry/nextjs 10.75.2 (versão corrigida)",
  trava.packages["node_modules/@sentry/nextjs"]?.version,
  "10.75.2",
);

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);

if (falhas.length > 0) {
  for (const falha of falhas) console.log(`  FALHA  ${falha}`);
  process.exit(1);
}
