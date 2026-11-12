/**
 * Regras de isolamento do E2E. Os testes de ponta a ponta só podem falar com o Supabase LOCAL
 * descartável e com o próprio app em loopback. Qualquer referência ao HML, à Production, a um
 * Supabase hospedado ou à Vercel interrompe a execução antes de qualquer escrita.
 *
 * Funções puras: `testar-guardas.mjs` exercita cada uma com casos negativos.
 */

/** Projetos Supabase reais: HML e Production. Nunca podem aparecer no E2E. */
export const REFERENCIAS_PROIBIDAS = Object.freeze([
  "qbnfcmrxmssnwkhaitgd",
  "ehkduqokntemtmqzdrbd",
]);

/** Domínios externos que indicam ambiente real. */
export const DOMINIOS_PROIBIDOS = Object.freeze([
  "supabase.co",
  "supabase.in",
  "supabase.com",
  "vercel.app",
  "bslogisticas.com.br",
]);

/** Único endereço aceito para o Supabase do E2E. */
export const URL_SUPABASE_LOCAL = "http://127.0.0.1:54321";

/** Prefixo obrigatório do `project_id` local (o workflow troca o do repositório por este). */
export const PREFIXO_PROJETO_LOCAL = "bs-e2e-";

const HOSTS_LOCAIS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** O host é loopback? Aceita só os nomes e endereços locais explícitos. */
export function hostLocal(host) {
  if (typeof host !== "string") return false;
  return HOSTS_LOCAIS.has(host.trim().toLowerCase().replace(/\.$/, ""));
}

/** A URL pode ser acessada pelo navegador ou pelo servidor do E2E? */
export function urlPermitida(texto) {
  let url;
  try {
    url = new URL(texto);
  } catch {
    return false;
  }
  if (url.protocol === "data:" || url.protocol === "blob:" || url.protocol === "about:")
    return true;
  if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "ws:") return false;
  return hostLocal(url.hostname);
}

/** Texto contém referência a ambiente real? Devolve o motivo ou `null`. */
export function referenciaProibida(texto) {
  if (typeof texto !== "string" || texto === "") return null;
  const minusculo = texto.toLowerCase();
  for (const ref of REFERENCIAS_PROIBIDAS) {
    if (minusculo.includes(ref)) return `referência a projeto real (${ref.slice(0, 6)}…)`;
  }
  for (const dominio of DOMINIOS_PROIBIDOS) {
    if (minusculo.includes(dominio)) return `domínio externo proibido (${dominio})`;
  }
  return null;
}

/** Variáveis que o próprio sistema ou o GitHub preenchem e que não são destino de rede. */
const VARIAVEIS_IGNORADAS = new Set([
  "GITHUB_SERVER_URL",
  "GITHUB_API_URL",
  "GITHUB_GRAPHQL_URL",
  "GITHUB_REPOSITORY",
  "GITHUB_WORKFLOW_REF",
  "GITHUB_REF",
  "GITHUB_HEAD_REF",
  "GITHUB_BASE_REF",
  "GITHUB_EVENT_PATH",
  "GITHUB_ACTION_REF",
  "GITHUB_ACTION_REPOSITORY",
  "RUNNER_TRACKING_ID",
]);

/**
 * Confere o ambiente do processo e a configuração do Supabase local. Devolve a lista de problemas
 * (vazia = seguro). `projetoId` é o `project_id` lido do config.toml; `vinculoRemoto` indica se
 * existe `supabase/.temp/project-ref`.
 */
export function problemasDoAmbiente({ env, projetoId, vinculoRemoto }) {
  const problemas = [];
  for (const [nome, valor] of Object.entries(env ?? {})) {
    if (VARIAVEIS_IGNORADAS.has(nome)) continue;
    const motivo = referenciaProibida(String(valor ?? ""));
    if (motivo) problemas.push(`variável ${nome}: ${motivo}`);
  }
  const url = env?.["NEXT_PUBLIC_SUPABASE_URL"];
  if (url !== undefined && url !== URL_SUPABASE_LOCAL) {
    problemas.push(`NEXT_PUBLIC_SUPABASE_URL precisa ser ${URL_SUPABASE_LOCAL}`);
  }
  if (typeof projetoId !== "string" || !projetoId.startsWith(PREFIXO_PROJETO_LOCAL)) {
    problemas.push(`project_id do Supabase precisa começar com "${PREFIXO_PROJETO_LOCAL}"`);
  } else {
    const motivo = referenciaProibida(projetoId);
    if (motivo) problemas.push(`project_id: ${motivo}`);
  }
  if (vinculoRemoto) problemas.push("existe vínculo remoto (supabase/.temp/project-ref)");
  return problemas;
}

/** Lê o `project_id` de um config.toml (texto). */
export function projetoDoConfig(texto) {
  const achado = /^project_id\s*=\s*"([^"]+)"/m.exec(texto ?? "");
  return achado ? achado[1] : null;
}
