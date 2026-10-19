/**
 * Isolamento entre ambientes: quem está rodando, e o que ele pode tocar.
 *
 * `NODE_ENV` NÃO identifica o ambiente: um deploy de Preview da Vercel também
 * roda com `NODE_ENV=production`. O ambiente de implantação vem de `VERCEL_ENV`
 * (`production`, `preview` ou `development`), que só a Vercel define.
 *
 * REGRA ÚNICA: **só `VERCEL_ENV=production` conta como Production.** Nada aqui
 * promove um ambiente desconhecido a Production.
 *
 * A AUSÊNCIA DE `VERCEL_ENV` NÃO PROVA AMBIENTE SEGURO. O que distingue "não
 * estou na Vercel" de "estou na Vercel e a variável sumiu" são os outros sinais de
 * execução que a plataforma define (`VERCEL`, `VERCEL_URL`, `VERCEL_REGION`,
 * `VERCEL_DEPLOYMENT_ID`, `VERCEL_PROJECT_ID`). Com qualquer sinal presente, o
 * código está na Vercel, e então `VERCEL_ENV` precisa ser um dos três valores
 * válidos — senão LANÇA. Só a ausência de TODOS os sinais significa máquina local,
 * CI do GitHub ou E2E, onde nada é verificado.
 *
 * Não existe exceção nem desvio configurável por variável: nenhuma variável de
 * ambiente autoriza um Preview a usar o projeto Supabase de Production. Quem
 * precisa de um Preview funcional configura um projeto Supabase de teste.
 *
 * No servidor o ambiente vem de `VERCEL_ENV`. No navegador essa variável não
 * existe; `next.config.ts` a publica como `NEXT_PUBLIC_AMBIENTE` no build, depois
 * de validá-la. Os helpers abaixo recebem os valores em vez de ler `process.env`,
 * para a suíte exercitá-los sem tocar o ambiente real.
 *
 * Tudo aqui é puro, sem Next e sem Supabase, e nunca imprime URL nem chave.
 */

/** Único valor de `VERCEL_ENV` que é Production. */
export const AMBIENTE_PRODUCTION = "production";

/** Valores válidos de `VERCEL_ENV`. Qualquer outro, estando na Vercel, é inválido. */
export const AMBIENTES_DA_VERCEL = ["production", "preview", "development"] as const;

/**
 * Referência (subdomínio) do projeto Supabase de Production. É dado público —
 * o mesmo que está em `supabase/config.toml` — e serve SÓ de termo de
 * comparação para barrar um Preview que herdou as variáveis de Production.
 * Não é credencial.
 */
export const REFERENCIA_SUPABASE_PRODUCTION = "ehkduqokntemtmqzdrbd";

/** Variáveis que a Vercel define em toda execução (build e runtime). */
export const SINAIS_DE_EXECUCAO_NA_VERCEL = [
  "VERCEL",
  "VERCEL_URL",
  "VERCEL_REGION",
  "VERCEL_DEPLOYMENT_ID",
  "VERCEL_PROJECT_ID",
] as const;

/** Os valores lidos do ambiente: os sinais de execução e o próprio `VERCEL_ENV`. */
export type SinaisDeAmbiente = Readonly<
  Partial<Record<"VERCEL_ENV" | (typeof SINAIS_DE_EXECUCAO_NA_VERCEL)[number], string | null>>
>;

/** Onde o código está rodando, depois de validado. */
export type AmbienteDeExecucao = "fora-da-vercel" | (typeof AMBIENTES_DA_VERCEL)[number];

/** Recorta, de qualquer fonte de variáveis (`process.env`), só o que o isolamento lê. */
export function sinaisDe(fonte: Readonly<Record<string, string | undefined>>): SinaisDeAmbiente {
  const recorte: Partial<Record<keyof SinaisDeAmbiente, string>> = {};
  for (const chave of ["VERCEL_ENV", ...SINAIS_DE_EXECUCAO_NA_VERCEL] as const) {
    const valor = fonte[chave];
    if (valor !== undefined) recorte[chave] = valor;
  }
  return recorte;
}

/** `true` só quando o valor é exatamente `production`. */
export function ehProducao(ambiente: string | null | undefined): boolean {
  return ambiente === AMBIENTE_PRODUCTION;
}

/** O Sentry só envia eventos em Production. */
export function sentryHabilitado(ambiente: string | null | undefined): boolean {
  return ehProducao(ambiente);
}

/** Erro de configuração de isolamento: a mensagem é fixa e não cita URL nem chave. */
export class ErroDeIsolamentoDeAmbiente extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDeIsolamentoDeAmbiente";
  }
}

/**
 * `true` se há QUALQUER indício de execução na Vercel: algum sinal de execução
 * preenchido ou `VERCEL_ENV` definido (mesmo vazio — a Vercel nunca o define vazio).
 */
export function executandoNaVercel(sinais: SinaisDeAmbiente): boolean {
  if (sinais.VERCEL_ENV !== undefined && sinais.VERCEL_ENV !== null) return true;
  return SINAIS_DE_EXECUCAO_NA_VERCEL.some((chave) => {
    const valor = sinais[chave];
    return typeof valor === "string" && valor !== "";
  });
}

/**
 * Onde o código está rodando.
 *
 * Sem nenhum sinal da Vercel: `fora-da-vercel` (local, CI, E2E). Com algum sinal:
 * `VERCEL_ENV` tem de ser exatamente `production`, `preview` ou `development` —
 * ausente, vazio, com outra caixa, com espaço ou desconhecido LANÇA, e o ambiente
 * não é assumido nem como Production nem como local.
 */
export function classificarAmbiente(sinais: SinaisDeAmbiente): AmbienteDeExecucao {
  if (!executandoNaVercel(sinais)) return "fora-da-vercel";

  const valor = sinais.VERCEL_ENV;
  const valido = AMBIENTES_DA_VERCEL.find((ambiente) => ambiente === valor);
  if (valido === undefined) {
    throw new ErroDeIsolamentoDeAmbiente(
      "Execução na Vercel sem um VERCEL_ENV válido (production, preview ou development). " +
        "Por segurança, o ambiente não é tratado como Production nem como local.",
    );
  }
  return valido;
}

const HOSTS_DE_LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * A origem (`protocolo://host[:porta]`) de uma URL do Supabase, validada.
 *
 * Aceita `https:` em qualquer host e `http:` só em loopback (o Supabase local do
 * E2E); com `somenteHttps`, o loopback http também é recusado. Recusa credenciais
 * embutidas, protocolo diferente e URL ilegível. O que vem depois da origem
 * (caminho, query) é descartado: a CSP só precisa da origem. A mensagem de erro
 * não reproduz o valor recebido.
 */
export function origemDoSupabase(
  urlTexto: string,
  opcoes: { somenteHttps?: boolean } = {},
): string {
  let url: URL;
  try {
    url = new URL(urlTexto);
  } catch {
    throw new ErroDeIsolamentoDeAmbiente("NEXT_PUBLIC_SUPABASE_URL não é uma URL válida.");
  }

  const loopback = HOSTS_DE_LOOPBACK.has(url.hostname.toLowerCase());
  const httpPermitido = loopback && opcoes.somenteHttps !== true;
  const protocoloAceito = url.protocol === "https:" || (url.protocol === "http:" && httpPermitido);
  if (!protocoloAceito) {
    throw new ErroDeIsolamentoDeAmbiente(
      opcoes.somenteHttps === true
        ? "NEXT_PUBLIC_SUPABASE_URL precisa ser https neste ambiente."
        : "NEXT_PUBLIC_SUPABASE_URL precisa ser https (http só em loopback).",
    );
  }
  if (url.username !== "" || url.password !== "") {
    throw new ErroDeIsolamentoDeAmbiente("NEXT_PUBLIC_SUPABASE_URL não pode trazer credenciais.");
  }
  if (url.hostname === "") {
    throw new ErroDeIsolamentoDeAmbiente("NEXT_PUBLIC_SUPABASE_URL sem host.");
  }
  return url.origin;
}

/** `true` se algum rótulo do host é a referência de Production (qualquer variação de subdomínio). */
export function apontaParaProduction(urlTexto: string): boolean {
  let host: string;
  try {
    host = new URL(urlTexto).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return false;
  }
  return host.split(".").includes(REFERENCIA_SUPABASE_PRODUCTION);
}

/**
 * A referência do projeto declarada numa chave LEGADA do Supabase (um JWT cujo
 * payload traz `ref`), ou `null` se a chave não é um JWT legível. O payload de um
 * JWT não é segredo — a assinatura é. Nada aqui valida a assinatura e o valor
 * nunca é impresso. Chaves no formato novo (`sb_publishable_…`, `sb_secret_…`) não
 * carregam a referência: para elas só a URL decide.
 */
export function referenciaDaChaveLegada(chave: string): string | null {
  const partes = chave.split(".");
  if (partes.length !== 3) return null;
  try {
    const base64 = (partes[1] ?? "").replace(/-/g, "+").replace(/_/g, "/");
    const preenchido = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const carga: unknown = JSON.parse(atob(preenchido));
    if (typeof carga !== "object" || carga === null) return null;
    const referencia = (carga as { ref?: unknown }).ref;
    return typeof referencia === "string" ? referencia.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** `true` se a chave (legada) declara ser do projeto de Production. */
export function chaveApontaParaProduction(chave: string): boolean {
  return referenciaDaChaveLegada(chave) === REFERENCIA_SUPABASE_PRODUCTION;
}

/** O que o isolamento inspeciona do Supabase: nenhum valor sai nas mensagens de erro. */
export interface DestinoDoSupabase {
  url?: string | null | undefined;
  chave?: string | null | undefined;
  /** `SUPABASE_SERVICE_ROLE_KEY`; só existe no servidor. */
  chaveDeServico?: string | null | undefined;
}

const MENSAGEM_PRODUCTION_EM_OUTRO_AMBIENTE =
  "Este ambiente não é Production e não pode usar o projeto Supabase de Production. " +
  "Configure um projeto Supabase de teste nas variáveis do escopo Preview " +
  "(URL e chave publicável próprias) ou deixe o escopo Preview sem elas.";

/**
 * Barra a chave privilegiada de Production fora de Production.
 *
 * Fora de Production, uma `SUPABASE_SERVICE_ROLE_KEY` que declara ser do projeto
 * de Production lança. Em Production e fora da Vercel não se aplica. Uma chave no
 * formato novo (`sb_secret_…`) não pode ser atribuída a um projeto por aqui: a
 * contenção depende de o escopo Preview não ter a variável (ver docs/SEGURANCA.md).
 */
export function verificarChaveDeServico(sinais: SinaisDeAmbiente, chave: string): void {
  const ambiente = classificarAmbiente(sinais);
  if (ambiente === "fora-da-vercel" || ambiente === "production") return;

  if (chaveApontaParaProduction(chave)) {
    throw new ErroDeIsolamentoDeAmbiente(
      "Este ambiente não é Production e não pode usar a chave privilegiada de Production.",
    );
  }
}

/**
 * Barra o uso do Supabase de Production fora de Production, e exige destino
 * próprio nos ambientes que não são Production.
 *
 * Roda onde as variáveis são lidas — no build (`next.config.ts`) e em cada
 * requisição (`lerAmbienteSupabase`) —, então a mesma regra vale nas duas pontas.
 * Devolve o ambiente validado.
 *
 *  - fora da Vercel (nenhum sinal): não verifica nada; o desenvolvimento local e a
 *    CI seguem livres para usar o `.env` de quem os roda;
 *  - na Vercel com `VERCEL_ENV` ausente ou inválido: LANÇA;
 *  - Production: não verifica o destino (o comportamento existente é preservado);
 *  - Preview, Development: URL e chave publicável são OBRIGATÓRIAS; a URL tem de
 *    ser https, legível, sem credenciais e NÃO pode ser a de Production; nem a
 *    chave publicável nem a de serviço podem declarar ser de Production.
 *
 * Fail-closed, sem exceção configurável: nenhuma variável de ambiente relaxa essa
 * regra.
 */
export function verificarDestinoSupabase(
  sinais: SinaisDeAmbiente,
  destino: DestinoDoSupabase,
): AmbienteDeExecucao {
  const ambiente = classificarAmbiente(sinais);
  if (ambiente === "fora-da-vercel" || ambiente === "production") return ambiente;

  const faltando = [
    ...(!destino.url ? ["NEXT_PUBLIC_SUPABASE_URL"] : []),
    ...(!destino.chave ? ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] : []),
  ];
  if (!destino.url || !destino.chave) {
    throw new ErroDeIsolamentoDeAmbiente(
      `Este ambiente (${ambiente}) não é Production e exige um destino Supabase próprio. ` +
        `Variáveis ausentes: ${faltando.join(", ")}.`,
    );
  }

  // Fail-closed: uma URL ilegível, sem https ou com credenciais também é recusada.
  origemDoSupabase(destino.url, { somenteHttps: true });

  if (apontaParaProduction(destino.url) || chaveApontaParaProduction(destino.chave)) {
    throw new ErroDeIsolamentoDeAmbiente(MENSAGEM_PRODUCTION_EM_OUTRO_AMBIENTE);
  }

  if (destino.chaveDeServico) verificarChaveDeServico(sinais, destino.chaveDeServico);

  return ambiente;
}
