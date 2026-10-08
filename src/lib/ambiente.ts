/**
 * Isolamento entre ambientes: quem está rodando, e o que ele pode tocar.
 *
 * `NODE_ENV` NÃO identifica o ambiente: um deploy de Preview da Vercel também
 * roda com `NODE_ENV=production`. O ambiente de implantação vem de `VERCEL_ENV`
 * (`production`, `preview` ou `development`), que só a Vercel define. Fora dela
 * — máquina local, CI do GitHub, E2E — a variável não existe, e isso significa
 * "não é Production".
 *
 * REGRA ÚNICA: **só `VERCEL_ENV=production` conta como Production.** Variável
 * ausente, vazia, com outro valor ou com caixa diferente é tratada como NÃO
 * Production. Nada aqui promove um ambiente desconhecido a Production.
 *
 * No servidor, o valor lido é `VERCEL_ENV`. No navegador essa variável não
 * existe; `next.config.ts` a publica como `NEXT_PUBLIC_AMBIENTE` no build, e o
 * mesmo valor chega às duas pontas. Os helpers abaixo recebem o valor, em vez de
 * ler `process.env`, para a suíte exercitá-los sem tocar o ambiente real.
 *
 * Tudo aqui é puro, sem Next e sem Supabase, e nunca imprime URL nem chave.
 */

/** Único valor de `VERCEL_ENV` que é Production. */
export const AMBIENTE_PRODUCTION = "production";

/**
 * Referência (subdomínio) do projeto Supabase de Production. É dado público —
 * o mesmo que está em `supabase/config.toml` — e serve SÓ de termo de
 * comparação para barrar um Preview que herdou as variáveis de Production.
 * Não é credencial.
 */
export const REFERENCIA_SUPABASE_PRODUCTION = "ehkduqokntemtmqzdrbd";

/**
 * Exceção TEMPORÁRIA e explícita: permite que o Preview da Vercel use o Supabase
 * compartilhado (o mesmo projeto de Production) enquanto o banco só tiver dados
 * fictícios. É variável do servidor — nunca `NEXT_PUBLIC_` — e só vale com o
 * valor exato `true`, no ambiente exato `preview`. Ver "Preview com Supabase
 * compartilhado" em docs/SEGURANCA.md, incluindo o procedimento para revogá-la.
 */
export const VARIAVEL_PREVIEW_COMPARTILHADO = "BS_PREVIEW_SHARED_SUPABASE";

/** `true` só quando o valor é exatamente `production`. */
export function ehProducao(ambiente: string | null | undefined): boolean {
  return ambiente === AMBIENTE_PRODUCTION;
}

/**
 * A exceção do Supabase compartilhado só vale para `preview` com o valor
 * `true`, ambos exatos (sem caixa alternativa, espaços, `1` ou `yes`).
 * Development, CI, local, Production e qualquer ambiente desconhecido não
 * ganham nada com ela.
 */
export function previewCompartilhadoAutorizado(
  ambiente: string | null | undefined,
  valor: string | null | undefined,
): boolean {
  return ambiente === "preview" && valor === "true";
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

const HOSTS_DE_LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * A origem (`protocolo://host[:porta]`) de uma URL do Supabase, validada.
 *
 * Aceita `https:` em qualquer host e `http:` só em loopback (o Supabase local do
 * E2E). Recusa credenciais embutidas, protocolo diferente e URL ilegível. O que
 * vem depois da origem (caminho, query) é descartado: a CSP só precisa da
 * origem. A mensagem de erro não reproduz o valor recebido.
 */
export function origemDoSupabase(urlTexto: string): string {
  let url: URL;
  try {
    url = new URL(urlTexto);
  } catch {
    throw new ErroDeIsolamentoDeAmbiente("NEXT_PUBLIC_SUPABASE_URL não é uma URL válida.");
  }

  const loopback = HOSTS_DE_LOOPBACK.has(url.hostname.toLowerCase());
  const protocoloAceito = url.protocol === "https:" || (url.protocol === "http:" && loopback);
  if (!protocoloAceito) {
    throw new ErroDeIsolamentoDeAmbiente(
      "NEXT_PUBLIC_SUPABASE_URL precisa ser https (http só em loopback).",
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
 * Barra o uso do Supabase de Production fora de Production.
 *
 * Roda onde as variáveis são lidas (`lerAmbienteSupabase`), então vale no build
 * (que pré-renderiza páginas) e em cada requisição. Aplica-se quando o código
 * está na Vercel (`ambiente` definido) e NÃO é Production: Preview,
 * Development e qualquer valor desconhecido. Fora da Vercel (`ambiente`
 * ausente: máquina local, CI, E2E) não se aplica — o desenvolvimento local
 * continua livre para usar o `.env` de quem o roda.
 *
 * Fail-closed: se o ambiente é da Vercel e não é Production, e a URL aponta
 * para Production — ou não pode ser lida —, lança. Production não é afetado.
 *
 * EXCEÇÃO: `previewCompartilhado` (o valor de BS_PREVIEW_SHARED_SUPABASE) igual a
 * `true` em `preview` libera SÓ o destino compartilhado. A URL continua sendo
 * validada por inteiro (formato, protocolo, credenciais) antes de qualquer
 * liberação: a exceção não afrouxa validação nenhuma, não vale para outro
 * ambiente e não é lida por Production, Development nem CI.
 */
export function verificarDestinoSupabase(
  ambiente: string | null | undefined,
  urlTexto: string,
  previewCompartilhado?: string | null,
): void {
  const naVercel = ambiente !== undefined && ambiente !== null && ambiente !== "";
  if (!naVercel || ehProducao(ambiente)) return;

  // Fail-closed: uma URL ilegível fora de Production também é recusada,
  // inclusive com a exceção ligada.
  origemDoSupabase(urlTexto);

  if (apontaParaProduction(urlTexto)) {
    if (previewCompartilhadoAutorizado(ambiente, previewCompartilhado)) return;

    throw new ErroDeIsolamentoDeAmbiente(
      "Este ambiente não é Production e não pode usar o projeto Supabase de Production. " +
        "Configure um projeto Supabase de teste nas variáveis do escopo Preview " +
        `(ou, enquanto o banco só tiver dados fictícios, autorize o compartilhamento ` +
        `temporário com ${VARIAVEL_PREVIEW_COMPARTILHADO}=true, apenas no escopo Preview).`,
    );
  }
}
