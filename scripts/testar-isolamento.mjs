/**
 * Testes do isolamento entre ambientes (etapa 4.6.5).
 *
 * COMO RODAR:
 *
 *   npm run test:isolamento
 *
 * Sem framework, Node executando o TypeScript via `--experimental-strip-types`,
 * com o hook `_resolver-ts.mjs`. Sai com código diferente de zero em qualquer
 * falha. Nada aqui envia evento ao Sentry nem fala com Supabase: o Sentry só é
 * inicializado SEM DSN (ambientes não-Production), e Production é conferido por
 * função pura e por forma literal — o DSN real nunca é usado num teste.
 *
 * BLOCOS
 *
 *   A. identificação do ambiente (só VERCEL_ENV=production é Production)
 *   B. origem do Supabase e gate contra o projeto de Production fora de Production
 *   C. CSP por ambiente (Production preservada, report-uri só em Production)
 *   D. Sentry: configuração real carregada por ambiente (sem DSN fora de Production)
 *   E. next.config: túnel, source maps, telemetria, release e ambiente publicado
 *   F. forma literal: proxy, env, sem host fixo, sem NODE_ENV como critério
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  apontaParaProduction,
  ehProducao,
  ErroDeIsolamentoDeAmbiente,
  origemDoSupabase,
  REFERENCIA_SUPABASE_PRODUCTION,
  sentryHabilitado,
  previewCompartilhadoAutorizado,
  VARIAVEL_PREVIEW_COMPARTILHADO,
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

const PROD = `https://${REFERENCIA_SUPABASE_PRODUCTION}.supabase.co`;
const TESTE = "https://abcdefghijklmnopqrst.supabase.co";
const LOCAL = "http://127.0.0.1:54321";
const INERTE = "https://ci-placeholder.invalid";

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

const barra = (ambiente, url) => lanca(() => verificarDestinoSupabase(ambiente, url));
verificar(
  "B18. Production na Vercel + Supabase de Production: permitido",
  barra("production", PROD),
  null,
);
verificar(
  "B19. Preview + Supabase de Production: BARRADO",
  barra("preview", PROD) instanceof ErroDeIsolamentoDeAmbiente,
  true,
);
verificar(
  "B20. Development da Vercel + Supabase de Production: BARRADO",
  barra("development", PROD) instanceof ErroDeIsolamentoDeAmbiente,
  true,
);
verificar(
  "B21. ambiente desconhecido da Vercel + Production: BARRADO",
  barra("staging", PROD) instanceof ErroDeIsolamentoDeAmbiente,
  true,
);
verificar(
  "B22. 'Production' com caixa errada não vale como Production: BARRADO",
  barra("Production", PROD) instanceof ErroDeIsolamentoDeAmbiente,
  true,
);
verificar(
  "B23. Preview + variação do host de Production: BARRADO",
  barra("preview", `https://x.${REFERENCIA_SUPABASE_PRODUCTION}.supabase.co`) instanceof
    ErroDeIsolamentoDeAmbiente,
  true,
);
verificar("B24. Preview + projeto de teste: permitido", barra("preview", TESTE), null);
verificar("B25. Preview + Supabase local: permitido", barra("preview", LOCAL), null);
verificar(
  "B26. Preview + URL ilegível: BARRADO (fail-closed)",
  barra("preview", "não é url") instanceof ErroDeIsolamentoDeAmbiente,
  true,
);
verificar(
  "B27. Preview + http fora de loopback: BARRADO",
  barra("preview", "http://abc.supabase.co") instanceof ErroDeIsolamentoDeAmbiente,
  true,
);
for (const [nome, ambiente] of [
  ["ausente (local, CI, E2E)", undefined],
  ["vazio", ""],
  ["null", null],
]) {
  verificar(
    `B28. ${nome}: o gate não se aplica (dev local segue livre)`,
    barra(ambiente, PROD),
    null,
  );
}
const erroPreview = barra("preview", PROD);
verificar(
  "B29. a mensagem do gate não cita a URL, o host nem a referência",
  !String(erroPreview?.message).includes(REFERENCIA_SUPABASE_PRODUCTION) &&
    !/supabase\.co|https?:\/\//.test(String(erroPreview?.message)),
  true,
);
verificar(
  "B30. e diz o que fazer",
  /projeto Supabase de teste/.test(String(erroPreview?.message)),
  true,
);

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

// --- E. next.config -----------------------------------------------------------

console.log("\nE. next.config por ambiente");

function configPara(variaveis) {
  const programa = `
    const mod = await import("./next.config.ts");
    const bruta = mod.default;
    const config = typeof bruta === "function" ? await bruta("phase-production-build", { defaultConfig: {} }) : bruta;
    const reescritas = typeof config.rewrites === "function" ? await config.rewrites() : [];
    const lista = Array.isArray(reescritas) ? reescritas : [...(reescritas.beforeFiles ?? []), ...(reescritas.afterFiles ?? []), ...(reescritas.fallback ?? [])];
    console.log(JSON.stringify({
      ambiente: config.env?.NEXT_PUBLIC_AMBIENTE ?? null,
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
    { cwd: raiz, env, encoding: "utf8" },
  );
  return JSON.parse(saida.trim().split("\n").pop());
}

for (const [nome, vars, ambiente, tunel] of [
  ["Production", { VERCEL_ENV: "production" }, "production", true],
  ["Preview", { VERCEL_ENV: "preview" }, "preview", false],
  ["Development da Vercel", { VERCEL_ENV: "development" }, "development", false],
  ["local/CI/E2E (sem VERCEL_ENV)", {}, "", false],
  ["CI", { CI: "true" }, "", false],
]) {
  const c = configPara(vars);
  verificar(`E1. ${nome}: ambiente publicado ao navegador`, c.ambiente, ambiente);
  verificar(`E2. ${nome}: túnel do Sentry ${tunel ? "ativo" : "inexistente"}`, c.tunel, tunel);
  verificar(`E3. ${nome}: typedRoutes continua ligado`, c.typedRoutes, true);
}

// O build é barrado quando um deploy fora de Production herda o Supabase de Production.
function configFalha(variaveis) {
  try {
    configPara(variaveis);
    return { falhou: false, saida: "" };
  } catch (erro) {
    return { falhou: true, saida: `${erro.stderr ?? ""}${erro.stdout ?? ""}${erro.message ?? ""}` };
  }
}
for (const ambiente of ["preview", "development", "staging"]) {
  const r = configFalha({ VERCEL_ENV: ambiente, NEXT_PUBLIC_SUPABASE_URL: PROD });
  verificar(`E12. ${ambiente} + Supabase de Production: o config (build) falha`, r.falhou, true);
  verificar(
    `E13. ${ambiente}: a falha é a explícita do gate e não cita a referência`,
    /não é Production e não pode usar o projeto Supabase de Production/.test(r.saida) &&
      !r.saida.includes(`${REFERENCIA_SUPABASE_PRODUCTION}.supabase.co`),
    true,
  );
}
verificar(
  "E14. Preview + projeto de teste: o config carrega",
  configFalha({ VERCEL_ENV: "preview", NEXT_PUBLIC_SUPABASE_URL: TESTE }).falhou,
  false,
);
verificar(
  "E15. Production + Supabase de Production: o config carrega (Production preservada)",
  configFalha({ VERCEL_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: PROD }).falhou,
  false,
);
verificar(
  "E16. local/CI/E2E (sem VERCEL_ENV) + qualquer URL: o config carrega",
  configFalha({ NEXT_PUBLIC_SUPABASE_URL: PROD }).falhou === false &&
    configFalha({ NEXT_PUBLIC_SUPABASE_URL: INERTE }).falhou === false &&
    configFalha({ NEXT_PUBLIC_SUPABASE_URL: LOCAL }).falhou === false,
  true,
);

{
  const codigo = semComentarios(fonte("next.config.ts"));
  verificar(
    "E17. next.config usa o mesmo gate de src/lib/ambiente.ts (uma só regra)",
    /verificarDestinoSupabase\(\s*process\.env\.VERCEL_ENV,\s*process\.env\.NEXT_PUBLIC_SUPABASE_URL,\s*process\.env\.BS_PREVIEW_SHARED_SUPABASE,?\s*\)/.test(
      codigo,
    ),
    true,
  );
  verificar(
    "E4. só VERCEL_ENV=production liga 'producao'",
    /const producao = ambienteDeImplantacao === "production";/.test(codigo),
    true,
  );
  verificar(
    "E5. o túnel só existe em Production",
    /tunnelRoute: producao \? "\/monitoring" : false/.test(codigo),
    true,
  );
  verificar("E6. telemetria do plugin só em Production", /telemetry: producao,/.test(codigo), true);
  verificar(
    "E7. source maps desabilitados fora de Production (não depende do token)",
    /sourcemaps: \{ disable: !producao \}/.test(codigo),
    true,
  );
  verificar("E8. release só em Production", /release: \{ create: producao \}/.test(codigo), true);
  verificar(
    "E9. monitores de cron da Vercel só em Production",
    /automaticVercelMonitors: producao,/.test(codigo),
    true,
  );
  verificar(
    "E10. nada depende de SENTRY_AUTH_TOKEN para decidir",
    /SENTRY_AUTH_TOKEN/.test(codigo),
    false,
  );
  verificar(
    "E11. os cabeçalhos de segurança estão intactos",
    ["X-Content-Type-Options", "Referrer-Policy", "X-Frame-Options", "Permissions-Policy"].every(
      (h) => codigo.includes(h),
    ),
    true,
  );
}

// --- G. Preview com Supabase compartilhado (exceção temporária) ---------------

console.log("\nG. Exceção temporária: BS_PREVIEW_SHARED_SUPABASE");

{
  const FLAG = "BS_PREVIEW_SHARED_SUPABASE";
  const gate = (ambiente, url, flag) => lanca(() => verificarDestinoSupabase(ambiente, url, flag));
  const barrado = (e) => e instanceof ErroDeIsolamentoDeAmbiente;

  verificar(
    "G0. o nome da variável é exatamente BS_PREVIEW_SHARED_SUPABASE",
    VARIAVEL_PREVIEW_COMPARTILHADO,
    FLAG,
  );
  verificar(
    "G0b. sem prefixo NEXT_PUBLIC_",
    /NEXT_PUBLIC/.test(VARIAVEL_PREVIEW_COMPARTILHADO),
    false,
  );

  // A-D: a matriz pedida.
  verificar(
    "G1. A: Preview + Supabase de Production + flag ausente = BLOQUEADO",
    barrado(gate("preview", PROD, undefined)),
    true,
  );
  verificar(
    "G2. B: Preview + Production + flag 'false' = BLOQUEADO",
    barrado(gate("preview", PROD, "false")),
    true,
  );
  verificar(
    "G3. C: Preview + Production + flag 'true' = PERMITIDO",
    gate("preview", PROD, "true"),
    null,
  );
  verificar(
    "G4. D: Preview + projeto de teste + flag ausente = PERMITIDO",
    gate("preview", TESTE, undefined),
    null,
  );
  verificar(
    "G5. D2: Preview + projeto de teste + flag 'true' = PERMITIDO",
    gate("preview", TESTE, "true"),
    null,
  );

  // Só o valor exato 'true' vale.
  for (const valor of [
    "",
    "False",
    "FALSE",
    "0",
    "1",
    "yes",
    "sim",
    "on",
    "True",
    "TRUE",
    " true",
    "true ",
    "true\n",
    "tru",
    "verdadeiro",
    null,
  ]) {
    verificar(
      `G6. Preview + Production + flag ${JSON.stringify(valor)} = BLOQUEADO`,
      barrado(gate("preview", PROD, valor)),
      true,
    );
  }

  // E: Production não depende da flag.
  verificar(
    "G7. E: Production + Production + sem flag = permitido (original)",
    gate("production", PROD, undefined),
    null,
  );
  verificar(
    "G8. E: Production + Production + flag 'true' = permitido (igual)",
    gate("production", PROD, "true"),
    null,
  );
  verificar(
    "G9. E: Production + flag 'false' = permitido (a flag não é lida)",
    gate("production", PROD, "false"),
    null,
  );

  // F/G: a flag não dá poder a outros ambientes.
  verificar(
    "G10. F: CI/local (sem VERCEL_ENV) + flag 'true': nada muda",
    gate(undefined, PROD, "true"),
    gate(undefined, PROD, undefined),
  );
  verificar(
    "G11. G: development + Production + flag 'true' = BLOQUEADO",
    barrado(gate("development", PROD, "true")),
    true,
  );
  verificar(
    "G12. ambiente desconhecido ('staging') + flag 'true' = BLOQUEADO",
    barrado(gate("staging", PROD, "true")),
    true,
  );
  verificar(
    "G13. 'Preview' com caixa errada + flag 'true' = BLOQUEADO",
    barrado(gate("Preview", PROD, "true")),
    true,
  );
  verificar(
    "G14. 'preview ' com espaço + flag 'true' = BLOQUEADO",
    barrado(gate("preview ", PROD, "true")),
    true,
  );
  verificar(
    "G15. 'PREVIEW' + flag 'true' = BLOQUEADO",
    barrado(gate("PREVIEW", PROD, "true")),
    true,
  );

  // H: a exceção não afrouxa a validação da URL.
  for (const [nome, url] of [
    ["URL ilegível", "não é url"],
    ["http fora de loopback", "http://abc.supabase.co"],
    ["credenciais embutidas", `https://u:p@${REFERENCIA_SUPABASE_PRODUCTION}.supabase.co`],
    ["protocolo estranho", "javascript:alert(1)"],
    ["vazia", ""],
  ]) {
    verificar(
      `G16. H: Preview + ${nome} + flag 'true' = BLOQUEADO`,
      barrado(gate("preview", url, "true")),
      true,
    );
  }
  verificar(
    "G17. com a flag, uma variação do host de Production também é permitida (mesmo destino)",
    gate("preview", `https://x.${REFERENCIA_SUPABASE_PRODUCTION}.supabase.co`, "true"),
    null,
  );
  verificar(
    "G18. a flag não torna válida uma URL com credenciais de um projeto de teste",
    barrado(gate("preview", "https://u:p@abc.supabase.co", "true")),
    true,
  );

  verificar(
    "G19. previewCompartilhadoAutorizado: só preview + 'true'",
    previewCompartilhadoAutorizado("preview", "true"),
    true,
  );
  for (const [a, v] of [
    ["production", "true"],
    ["development", "true"],
    [undefined, "true"],
    ["", "true"],
    ["preview", undefined],
    ["preview", "false"],
    ["preview", "TRUE"],
  ]) {
    verificar(
      `G20. previewCompartilhadoAutorizado(${JSON.stringify(a)}, ${JSON.stringify(v)}) = false`,
      previewCompartilhadoAutorizado(a, v),
      false,
    );
  }

  const msg = String(gate("preview", PROD, undefined)?.message);
  verificar(
    "G21. a mensagem do bloqueio cita a variável, sem URL nem referência",
    msg.includes(FLAG) && !msg.includes(REFERENCIA_SUPABASE_PRODUCTION) && !/https?:\/\//.test(msg),
    true,
  );
  verificar(
    "G22. e continua dizendo que o ideal é um projeto de teste",
    /projeto Supabase de teste/.test(msg),
    true,
  );

  // I/J: o compartilhamento do banco não compartilha o monitoramento (config real carregada).
  for (const arquivo of ["sentry.server.config.ts", "sentry.edge.config.ts"]) {
    const r = inicializarSentry(arquivo, {
      VERCEL_ENV: "preview",
      NODE_ENV: "production",
      [FLAG]: "true",
    });
    verificar(`G23. I: ${arquivo} / Preview + flag: Sentry desabilitado`, r.enabled, false);
    verificar(`G24. I: ${arquivo} / Preview + flag: sem DSN`, r.dsn, null);
    verificar(`G25. I: ${arquivo} / Preview + flag: traces zerados`, r.traces, 0);
  }
  const cfg = configPara({ VERCEL_ENV: "preview", NEXT_PUBLIC_SUPABASE_URL: PROD, [FLAG]: "true" });
  verificar("G26. J: Preview + flag: /monitoring continua inexistente", cfg.tunel, false);
  verificar(
    "G27. Preview + flag: o ambiente publicado ao navegador continua 'preview'",
    cfg.ambiente,
    "preview",
  );
  verificar("G28. Preview + flag: typedRoutes continua ligado", cfg.typedRoutes, true);
  verificar("G29. a flag não é publicada ao navegador", JSON.stringify(cfg).includes(FLAG), false);

  // O config (build) respeita a mesma regra.
  verificar(
    "G30. build: Preview + Production + flag 'true' carrega o config",
    configFalha({ VERCEL_ENV: "preview", NEXT_PUBLIC_SUPABASE_URL: PROD, [FLAG]: "true" }).falhou,
    false,
  );
  for (const valor of ["false", "", "1", "TRUE"]) {
    verificar(
      `G31. build: Preview + Production + flag ${JSON.stringify(valor)} FALHA`,
      configFalha({ VERCEL_ENV: "preview", NEXT_PUBLIC_SUPABASE_URL: PROD, [FLAG]: valor }).falhou,
      true,
    );
  }
  verificar(
    "G32. build: Development + Production + flag 'true' FALHA",
    configFalha({ VERCEL_ENV: "development", NEXT_PUBLIC_SUPABASE_URL: PROD, [FLAG]: "true" })
      .falhou,
    true,
  );
  verificar(
    "G33. build: Preview + URL inválida + flag 'true' FALHA",
    configFalha({
      VERCEL_ENV: "preview",
      NEXT_PUBLIC_SUPABASE_URL: "http://abc.supabase.co",
      [FLAG]: "true",
    }).falhou,
    true,
  );
  verificar(
    "G34. build: Preview + projeto de teste, sem flag, carrega",
    configFalha({ VERCEL_ENV: "preview", NEXT_PUBLIC_SUPABASE_URL: TESTE }).falhou,
    false,
  );

  // Forma literal: sem NEXT_PUBLIC, sem exposição, sem outro uso.
  const amb = semComentarios(fonte("src/lib/ambiente.ts"));
  verificar(
    "G35. ambiente.ts não lê process.env (a flag chega por parâmetro)",
    /process\.env/.test(amb),
    false,
  );
  const nextCfg = semComentarios(fonte("next.config.ts"));
  verificar(
    "G36. next.config não põe a flag em `env` (não vai ao navegador)",
    /env:\s*\{[^}]*BS_PREVIEW/.test(nextCfg),
    false,
  );
  verificar(
    "G37. a flag só é lida em next.config.ts e env.ts",
    [
      "src/proxy.ts",
      "src/instrumentation-client.ts",
      "sentry.server.config.ts",
      "sentry.edge.config.ts",
      "src/lib/csp.ts",
      "src/integrations/supabase/browser.ts",
      "src/integrations/supabase/server.ts",
    ].every((a) => !/BS_PREVIEW_SHARED_SUPABASE/.test(fonte(a))),
    true,
  );
  verificar(
    "G38. nenhum arquivo do código usa NEXT_PUBLIC_BS_PREVIEW",
    arquivosDe(join(raiz, "src"))
      .filter((a) => /\.(ts|tsx)$/.test(a))
      .every((a) => !/NEXT_PUBLIC_BS_PREVIEW/.test(readFileSync(a, "utf8"))),
    true,
  );
  verificar(
    "G39. o build avisa quando o Preview usa o banco compartilhado",
    /apontaParaProduction\(process\.env\.NEXT_PUBLIC_SUPABASE_URL\)/.test(nextCfg) &&
      /AVISO/.test(fonte("next.config.ts")),
    true,
  );
  verificar(
    "G40. nenhuma exceção equivalente para Production, Development ou CI",
    !/previewCompartilhadoAutorizado\([^)]*(production|development)/.test(amb),
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

const env = semComentarios(fonte("src/integrations/supabase/env.ts"));
verificar(
  "F9. lerAmbienteSupabase aplica o gate depois de validar as variáveis",
  env.indexOf(
    'verificarDestinoSupabase(ambiente, url, process.env["BS_PREVIEW_SHARED_SUPABASE"])',
  ) > env.indexOf("if (!url || !chave)"),
  true,
);
verificar(
  "F10. o gate lê só VERCEL_ENV (servidor); no navegador o gate do build é quem decide",
  env.includes('const ambiente = process.env["VERCEL_ENV"];') && !/NEXT_PUBLIC_AMBIENTE/.test(env),
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

function arquivosDe(dir) {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    return statSync(caminho).isDirectory() ? arquivosDe(caminho) : [caminho];
  });
}
const comRefDeProduction = arquivosDe(join(raiz, "src"))
  .filter((a) => /\.(ts|tsx)$/.test(a))
  .filter((a) => readFileSync(a, "utf8").includes(REFERENCIA_SUPABASE_PRODUCTION))
  .map((a) => a.replace(/\\/g, "/").split("/src/")[1]);
verificar(
  "F14. a referência de Production aparece só em src/lib/ambiente.ts",
  comRefDeProduction.join(","),
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
  "F16. a rota do XLSX continua sem service_role",
  /service_role|SERVICE_ROLE/i.test(semComentarios(fonte("src/app/api/fechamento/xlsx/route.ts"))),
  false,
);

const pacote = JSON.parse(fonte("package.json"));
const trava = JSON.parse(fonte("package-lock.json"));
verificar(
  "F17. nenhuma dependência nova nesta etapa (Sentry fixado como antes)",
  pacote.dependencies["@sentry/nextjs"],
  "^10.73.0",
);
verificar(
  "F18. o lockfile continua em @sentry/nextjs 10.73.0",
  trava.packages["node_modules/@sentry/nextjs"]?.version,
  "10.73.0",
);

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);

if (falhas.length > 0) {
  for (const falha of falhas) console.log(`  FALHA  ${falha}`);
  process.exit(1);
}
