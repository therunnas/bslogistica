/**
 * Prova assinada de que a sessão nasceu de um link de recuperação de senha.
 *
 * POR QUE ISTO EXISTE
 *
 * O guard anterior exigia `recovery` no AMR da sessão. Não funciona: o
 * `verifyOtp({ type: "recovery" })` vai para `POST /verify` e, depois de
 * validar o tipo, o Supabase Auth cria a sessão como `models.OTP`. O `recovery`
 * é o tipo de verificação que seleciona o evento, não o método registrado no
 * AMR. E aceitar `otp` também não serve — `otp` não identifica recuperação de
 * senha com exclusividade.
 *
 * Então a prova é emitida pela própria aplicação, no servidor, no único ponto
 * onde a recuperação é comprovada: logo após o `verifyOtp` retornar sucesso.
 *
 * O QUE ELA GARANTE
 *
 * - só existe se o token de recuperação foi consumido com sucesso;
 * - é assinada com HMAC-SHA-256 por um segredo que nunca sai do servidor, então
 *   ninguém fabrica uma mandando `Cookie: bs_recovery_proof=...`;
 * - vale 10 minutos;
 * - está amarrada a `sub` e a `session_id`. Colada em outra sessão, não vale.
 *
 * Sem banco, sem migration, sem service_role, sem metadata do usuário e sem
 * armazenamento no navegador. Usa só WebCrypto, que existe tanto no runtime
 * Node quanto no Edge — nenhuma dependência nova.
 */

export const NOME_DO_COOKIE_DE_PROVA = "bs_recovery_proof";

/** 10 minutos. Tempo de escolher uma senha, não de deixar a porta encostada. */
export const VALIDADE_DA_PROVA_EM_SEGUNDOS = 600;

export const VERSAO_DA_PROVA = 1;
export const PROPOSITO_DA_PROVA = "password-recovery";

export interface CargaDaProva {
  version: number;
  purpose: string;
  sub: string;
  session_id: string;
  exp: number;
}

export type ResultadoDaProva =
  | "valida"
  | "sem-segredo"
  | "ausente"
  | "malformada"
  | "assinatura-invalida"
  | "versao-invalida"
  | "proposito-invalido"
  | "expirada"
  | "sub-divergente"
  | "sessao-divergente";

/* ------------------------------------------------------------------ */
/* Base64url sem dependência                                           */
/* ------------------------------------------------------------------ */

function paraBase64Url(bytes: Uint8Array): string {
  let binario = "";
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function deBase64Url(texto: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(texto)) return null;
  const preenchido = texto.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const binario = atob(preenchido + "=".repeat((4 - (preenchido.length % 4)) % 4));
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Comparação em tempo constante.
 *
 * `===` sai no primeiro byte diferente, e essa diferença de tempo vaza,
 * byte a byte, qual assinatura o servidor esperava.
 */
function comparacaoSegura(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) diferenca |= a[i]! ^ b[i]!;
  return diferenca === 0;
}

async function calcularHmac(segredo: string, mensagem: string): Promise<Uint8Array> {
  const chave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(segredo),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const assinatura = await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(mensagem));
  return new Uint8Array(assinatura);
}

/* ------------------------------------------------------------------ */
/* Núcleo: assinar e verificar                                         */
/* ------------------------------------------------------------------ */

/** Assina uma carga já montada. O segredo entra por parâmetro para ser testável. */
export async function assinarProva(carga: CargaDaProva, segredo: string): Promise<string> {
  const corpo = paraBase64Url(new TextEncoder().encode(JSON.stringify(carga)));
  const assinatura = paraBase64Url(await calcularHmac(segredo, corpo));
  return `${corpo}.${assinatura}`;
}

export interface EsperadoNaProva {
  sub: string;
  sessionId: string;
  /** Injetável para o teste de expiração não depender do relógio real. */
  agoraEmSegundos?: number;
}

/**
 * Verifica a prova.
 *
 * Ordem importa: a assinatura é conferida ANTES de qualquer campo da carga. Ler
 * `exp` ou `sub` de um corpo não autenticado seria confiar em texto que o
 * cliente escreveu — decode não é verificação.
 */
export async function verificarProva(
  token: string | null | undefined,
  segredo: string,
  esperado: EsperadoNaProva,
): Promise<ResultadoDaProva> {
  if (typeof token !== "string" || token === "") return "ausente";

  const partes = token.split(".");
  if (partes.length !== 2) return "malformada";

  const [corpo, assinaturaRecebida] = partes as [string, string];
  const bytesRecebidos = deBase64Url(assinaturaRecebida);
  if (!bytesRecebidos) return "malformada";

  const esperada = await calcularHmac(segredo, corpo);
  if (!comparacaoSegura(bytesRecebidos, esperada)) return "assinatura-invalida";

  const bytesDoCorpo = deBase64Url(corpo);
  if (!bytesDoCorpo) return "malformada";

  let carga: unknown;
  try {
    carga = JSON.parse(new TextDecoder().decode(bytesDoCorpo));
  } catch {
    return "malformada";
  }

  if (!carga || typeof carga !== "object") return "malformada";
  const { version, purpose, sub, session_id, exp } = carga as Partial<CargaDaProva>;

  if (typeof version !== "number" || typeof purpose !== "string") return "malformada";
  if (typeof sub !== "string" || typeof session_id !== "string") return "malformada";
  if (typeof exp !== "number" || !Number.isFinite(exp)) return "malformada";

  if (version !== VERSAO_DA_PROVA) return "versao-invalida";
  if (purpose !== PROPOSITO_DA_PROVA) return "proposito-invalido";

  const agora = esperado.agoraEmSegundos ?? Math.floor(Date.now() / 1000);
  if (exp <= agora) return "expirada";

  if (sub !== esperado.sub) return "sub-divergente";
  if (session_id !== esperado.sessionId) return "sessao-divergente";

  return "valida";
}

/* ------------------------------------------------------------------ */
/* Segredo: leitura em runtime, falha fechada                          */
/* ------------------------------------------------------------------ */

export const NOME_DA_VARIAVEL_DO_SEGREDO = "PASSWORD_RECOVERY_PROOF_SECRET";

/**
 * Lê o segredo no momento do uso, não na carga do módulo.
 *
 * É isso que deixa `npm run build` passar sem a variável: nada é avaliado em
 * tempo de build. Em runtime, ausência ou valor vazio devolve `null`, e quem
 * chama trata como falha — a prova não é emitida e o formulário não abre.
 *
 * Sem prefixo NEXT_PUBLIC_, de propósito: esse prefixo embutiria o valor no
 * bundle do navegador e destruiria a única garantia que a assinatura oferece.
 */
export function lerSegredoDaProva(): string | null {
  const valor = process.env[NOME_DA_VARIAVEL_DO_SEGREDO];
  if (typeof valor !== "string") return null;
  const limpo = valor.trim();
  return limpo === "" ? null : limpo;
}

/**
 * Emite a prova. Devolve `null` se não houver segredo — falha fechada.
 */
export async function criarProvaDeRecuperacao({
  sub,
  sessionId,
}: {
  sub: string;
  sessionId: string;
}): Promise<string | null> {
  const segredo = lerSegredoDaProva();
  if (!segredo) return null;

  const carga: CargaDaProva = {
    version: VERSAO_DA_PROVA,
    purpose: PROPOSITO_DA_PROVA,
    sub,
    session_id: sessionId,
    exp: Math.floor(Date.now() / 1000) + VALIDADE_DA_PROVA_EM_SEGUNDOS,
  };

  return assinarProva(carga, segredo);
}

/** Valida a prova vinda do cookie. Sem segredo, nega. */
export async function validarProvaDeRecuperacao(
  token: string | null | undefined,
  esperado: EsperadoNaProva,
): Promise<ResultadoDaProva> {
  const segredo = lerSegredoDaProva();
  if (!segredo) return "sem-segredo";
  return verificarProva(token, segredo, esperado);
}

/* ------------------------------------------------------------------ */
/* Reemissão após o segundo fator                                      */
/* ------------------------------------------------------------------ */

export type ProvaAutenticada =
  { situacao: "valida"; exp: number } | { situacao: "invalida"; motivo: ResultadoDaProva };

/**
 * Valida a prova e devolve o `exp` AUTENTICADO.
 *
 * Existe porque a reemissão precisa herdar o prazo original, e ler esse prazo
 * de um corpo não verificado seria confiar em texto que o navegador enviou.
 * Aqui o `exp` só é devolvido depois de `verificarProva` aprovar a assinatura,
 * a versão, o propósito, o prazo, o `sub` e o `session_id` — nesta ordem. Não é
 * um decodificador: se qualquer etapa falhar, nada sai.
 */
export async function lerExpAutenticadoCom(
  token: string | null | undefined,
  segredo: string,
  esperado: EsperadoNaProva,
): Promise<ProvaAutenticada> {
  const resultado = await verificarProva(token, segredo, esperado);
  if (resultado !== "valida") return { situacao: "invalida", motivo: resultado };

  // Chegou aqui: assinatura conferida e todos os campos validados. Só agora o
  // corpo pode ser lido como fonte de verdade.
  const corpo = (token as string).split(".")[0] as string;
  const bytes = deBase64Url(corpo);
  if (!bytes) return { situacao: "invalida", motivo: "malformada" };

  const { exp } = JSON.parse(new TextDecoder().decode(bytes)) as CargaDaProva;
  return { situacao: "valida", exp };
}

/** Mesma coisa, lendo o segredo do ambiente. Sem segredo, nega. */
export async function lerExpAutenticado(
  token: string | null | undefined,
  esperado: EsperadoNaProva,
): Promise<ProvaAutenticada> {
  const segredo = lerSegredoDaProva();
  if (!segredo) return { situacao: "invalida", motivo: "sem-segredo" };
  return lerExpAutenticadoCom(token, segredo, esperado);
}

export type Reemissao =
  | { situacao: "reemitida"; prova: string; segundosRestantes: number }
  | { situacao: "sem-tempo" }
  | { situacao: "sem-segredo" };

/**
 * Reemite a prova para a sessão de agora, herdando o prazo da anterior.
 *
 * POR QUE REEMITIR
 *
 * O segundo fator troca o access token. Se o `session_id` mudar nessa troca, a
 * prova antiga — amarrada ao `session_id` de antes — deixaria de validar e o
 * usuário seria barrado depois de acertar o TOTP. Reemitir cobre os dois
 * cenários: se o id não mudou, a reemissão é inócua; se mudou, a prova
 * acompanha.
 *
 * POR QUE O `exp` É HERDADO, NUNCA RECALCULADO
 *
 * Recalcular daria mais 10 minutos a cada reemissão, e a janela deixaria de
 * existir na prática. O prazo aqui é o que sobrou do original — por isso o
 * chamador precisa passar um `exp` que já veio de `lerExpAutenticado`, e não um
 * valor qualquer.
 *
 * Sem tempo restante, não reemite: prova expirada não se renova.
 */
export async function reemitirProvaCom(
  {
    sub,
    sessionId,
    expOriginal,
    agoraEmSegundos,
  }: {
    sub: string;
    sessionId: string;
    expOriginal: number;
    agoraEmSegundos?: number;
  },
  segredo: string,
): Promise<Reemissao> {
  const agora = agoraEmSegundos ?? Math.floor(Date.now() / 1000);
  const segundosRestantes = expOriginal - agora;
  if (segundosRestantes <= 0) return { situacao: "sem-tempo" };

  const prova = await assinarProva(
    {
      version: VERSAO_DA_PROVA,
      purpose: PROPOSITO_DA_PROVA,
      sub,
      session_id: sessionId,
      exp: expOriginal,
    },
    segredo,
  );

  return { situacao: "reemitida", prova, segundosRestantes };
}

/** Mesma coisa, lendo o segredo do ambiente. Sem segredo, não reemite. */
export async function reemitirProvaDeRecuperacao(params: {
  sub: string;
  sessionId: string;
  expOriginal: number;
  agoraEmSegundos?: number;
}): Promise<Reemissao> {
  const segredo = lerSegredoDaProva();
  if (!segredo) return { situacao: "sem-segredo" };
  return reemitirProvaCom(params, segredo);
}
