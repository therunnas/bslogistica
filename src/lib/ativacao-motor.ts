/**
 * Ativação do motor por vigência, pelo administrador (C05-B8.6).
 *
 * É a única escrita da tela de implantação das vigências. Roda no servidor (Server Action), com o
 * cliente da SESSÃO — o JWT do próprio admin em AAL2 —, nunca com `service_role` e sem simular
 * `auth.uid()`: quem decide é a RPC `alterar_motor_vigencia`, que exige admin em AAL2 por dentro e
 * grava a trilha. Este módulo só acrescenta, ANTES da RPC, o que a tela promete: motivo e frase de
 * confirmação válidos, motor comprovadamente desligado e nenhuma pendência nem divergência.
 *
 * Fail-closed: erro de leitura, resposta que não é a esperada ou estado desconhecido recusam. Nunca
 * envia `p_aceitar_pendencias = true` — não existe caminho aqui para aceitar pendência.
 *
 * Funções puras sobre um cliente mínimo de RPC, sem importar nada do Next.js, para a suíte
 * `test:ativacao-motor` exercitar cada ramo sem rede.
 */

/** Mesmos nomes de `RPC_VIGENCIAS.motor`; a suíte confere a igualdade. */
export const RPC_ATIVACAO = {
  estado: "estado_motor_vigencia",
  pendencias: "pendencias_implantacao_vigencias",
  divergencias: "divergencias_implantacao_vigencias",
  alterar: "alterar_motor_vigencia",
} as const;

/**
 * Trava de servidor da ativação (C05-B8.12). O controle de ligar o motor NÃO é permanente: só
 * existe enquanto esta variável, lida no servidor (nunca `NEXT_PUBLIC_*`), valer exatamente
 * "true". Ausente, vazia, com outra caixa ou com qualquer outro valor, a ativação está
 * DESABILITADA — é o padrão em todos os ambientes, Production inclusive. A janela de ativação é
 * aberta de propósito, pela variável do projeto na Vercel, e fechada de novo depois.
 *
 * A variável não substitui nada: o admin com segundo fator, o motivo, a frase e a RPC do banco
 * continuam exigidos. Ela só decide se o servidor aceita o pedido.
 */
export const VARIAVEL_DE_ATIVACAO = "BS_ATIVACAO_MOTOR_HABILITADA";

export function ativacaoHabilitada(valor: string | null | undefined): boolean {
  return valor === "true";
}

export const MENSAGEM_ATIVACAO_DESABILITADA =
  "A ativação do motor está desabilitada neste ambiente. Ela só é aberta, por configuração do servidor, na janela de ativação autorizada.";

/** A frase que o admin digita para confirmar. Exata: protege contra clique acidental. */
export const FRASE_DE_CONFIRMACAO = "LIGAR MOTOR";
export const MOTIVO_MINIMO = 10;
export const MOTIVO_MAXIMO = 1000;

export type CodigoDeRecusa =
  | "nao-autorizado"
  | "desabilitada"
  | "entrada-invalida"
  | "ja-ligado"
  | "ja-desligado"
  | "estado-desconhecido"
  | "nao-conferido"
  | "bloqueios"
  | "recusada-pelo-banco"
  | "resposta-invalida";

export type ResultadoDaAtivacao =
  | { ok: true; ativadaEm: string | null; pendencias: number }
  | { ok: false; codigo: CodigoDeRecusa; mensagem: string };

/** Só o que este módulo usa do cliente do Supabase. */
export interface ClienteDeRpc {
  rpc(
    nome: string,
    argumentos?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

function recusa(codigo: CodigoDeRecusa, mensagem: string): ResultadoDaAtivacao {
  return { ok: false, codigo, mensagem };
}

export function validarEntradaDeAtivacao(
  entrada: unknown,
): { ok: true; motivo: string } | { ok: false; mensagem: string } {
  if (typeof entrada !== "object" || entrada === null || Array.isArray(entrada)) {
    return { ok: false, mensagem: "Pedido de ativação inválido." };
  }
  const { motivo, confirmacao } = entrada as { motivo?: unknown; confirmacao?: unknown };
  if (typeof motivo !== "string" || typeof confirmacao !== "string") {
    return { ok: false, mensagem: "Informe o motivo e digite a frase de confirmação." };
  }
  const motivoLimpo = motivo.trim();
  if (motivoLimpo.length < MOTIVO_MINIMO) {
    return {
      ok: false,
      mensagem: `Informe o motivo da ativação (mínimo de ${MOTIVO_MINIMO} caracteres).`,
    };
  }
  if (motivoLimpo.length > MOTIVO_MAXIMO) {
    return { ok: false, mensagem: `O motivo deve ter no máximo ${MOTIVO_MAXIMO} caracteres.` };
  }
  if (confirmacao.trim() !== FRASE_DE_CONFIRMACAO) {
    return { ok: false, mensagem: `Digite exatamente "${FRASE_DE_CONFIRMACAO}" para confirmar.` };
  }
  return { ok: true, motivo: motivoLimpo };
}

function codigoDoErro(erro: unknown): string {
  return typeof erro === "object" && erro !== null && "code" in erro
    ? String((erro as { code: unknown }).code)
    : "";
}

function mensagemDoBanco(erro: unknown): string {
  return typeof erro === "object" && erro !== null && "message" in erro
    ? String((erro as { message: unknown }).message)
    : "";
}

/**
 * O estado do motor tal como o banco o devolve: `ativo` booleano e `consistente === true`.
 * Qualquer outra forma é desconhecida — nunca "desligado".
 */
function lerEstado(data: unknown): "ligado" | "desligado" | "desconhecido" {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return "desconhecido";
  const r = data as { ativo?: unknown; consistente?: unknown };
  if (typeof r.ativo !== "boolean" || r.consistente !== true) return "desconhecido";
  return r.ativo ? "ligado" : "desligado";
}

export async function ligarMotorDeVigencia(
  db: ClienteDeRpc,
  entrada: unknown,
): Promise<ResultadoDaAtivacao> {
  const valida = validarEntradaDeAtivacao(entrada);
  if (!valida.ok) return recusa("entrada-invalida", valida.mensagem);

  // 1. O motor tem de estar comprovadamente desligado.
  const estado = await db.rpc(RPC_ATIVACAO.estado);
  if (estado.error) {
    return recusa("estado-desconhecido", "Não foi possível confirmar o estado do motor.");
  }
  const situacao = lerEstado(estado.data);
  if (situacao === "ligado") return recusa("ja-ligado", "O motor por vigência já está ligado.");
  if (situacao === "desconhecido") {
    return recusa(
      "estado-desconhecido",
      "O estado do motor é desconhecido ou inconsistente. Não é seguro ligar.",
    );
  }

  // 2. Nenhuma pendência nem divergência — lidas de novo, agora, no servidor.
  const [pend, div] = await Promise.all([
    db.rpc(RPC_ATIVACAO.pendencias),
    db.rpc(RPC_ATIVACAO.divergencias),
  ]);
  if (pend.error || div.error || !Array.isArray(pend.data) || !Array.isArray(div.data)) {
    return recusa(
      "nao-conferido",
      "Não foi possível conferir as pendências e divergências. A ausência de resposta não significa que não existam.",
    );
  }
  if (pend.data.length > 0 || div.data.length > 0) {
    return recusa(
      "bloqueios",
      `Há ${pend.data.length} cadastro(s) sem vigência e ${div.data.length} divergência(s). Resolva antes de ligar.`,
    );
  }

  // 3. A RPC oficial, com o JWT da sessão. Nunca aceita pendências.
  const r = await db.rpc(RPC_ATIVACAO.alterar, {
    p_ativar: true,
    p_reason: valida.motivo,
    p_aceitar_pendencias: false,
  });
  if (r.error) {
    const codigo = codigoDoErro(r.error);
    if (codigo === "42501" || codigo === "28000") {
      return recusa(
        "recusada-pelo-banco",
        "Sem permissão: ligar o motor exige administrador com segundo fator.",
      );
    }
    const doBanco = mensagemDoBanco(r.error);
    if ((codigo === "55000" || codigo === "22023") && doBanco) {
      return recusa("recusada-pelo-banco", doBanco);
    }
    return recusa("recusada-pelo-banco", "O banco recusou a ativação. Nada foi alterado.");
  }

  const dados = r.data;
  if (
    typeof dados !== "object" ||
    dados === null ||
    Array.isArray(dados) ||
    (dados as { ativo?: unknown }).ativo !== true
  ) {
    return recusa(
      "resposta-invalida",
      "A resposta da ativação não confirma que o motor foi ligado. Confira o estado do motor.",
    );
  }
  const { ativada_em, pendencias } = dados as { ativada_em?: unknown; pendencias?: unknown };
  return {
    ok: true,
    ativadaEm: typeof ativada_em === "string" ? ativada_em : null,
    pendencias: typeof pendencias === "number" ? pendencias : 0,
  };
}

// ---------------------------------------------------------------------------
// Reversão (RB-01): desligar o motor pela MESMA RPC oficial, com o JWT da sessão.
//
// Espelha a ativação: motivo, frase exata e uma trava de servidor PRÓPRIA (distinta da da
// ativação, para abrir uma janela não abrir a outra). Só desliga se o motor estiver
// comprovadamente LIGADO; estado desconhecido ou inconsistente recusa. Nunca aceita pendência
// (não existe pendência a aceitar ao desligar) e nunca usa `service_role` nem simula identidade:
// `alterar_motor_vigencia` repete admin + AAL2 por dentro e grava a trilha em
// `financial_terms_audit` (`motor_vigencia_desativado`). Depois de desligar, relê o estado e só
// declara sucesso se o banco confirmar `desligado` e consistente.

/** Trava de servidor da reversão. Ausente ou diferente de exatamente "true": desabilitada. */
export const VARIAVEL_DE_REVERSAO = "BS_REVERSAO_MOTOR_HABILITADA";

export function reversaoHabilitada(valor: string | null | undefined): boolean {
  return valor === "true";
}

export const MENSAGEM_REVERSAO_DESABILITADA =
  "Desligar o motor está desabilitado neste ambiente. A reversão só é aberta, por configuração do servidor, quando for autorizada.";

/** A frase que o admin digita para confirmar o desligamento. Exata. */
export const FRASE_DE_REVERSAO = "DESLIGAR MOTOR";

export type ResultadoDaReversao =
  { ok: true; sincronizacao: unknown } | { ok: false; codigo: CodigoDeRecusa; mensagem: string };

function recusaDeReversao(codigo: CodigoDeRecusa, mensagem: string): ResultadoDaReversao {
  return { ok: false, codigo, mensagem };
}

export function validarEntradaDeReversao(
  entrada: unknown,
): { ok: true; motivo: string } | { ok: false; mensagem: string } {
  if (typeof entrada !== "object" || entrada === null || Array.isArray(entrada)) {
    return { ok: false, mensagem: "Pedido de desligamento inválido." };
  }
  const { motivo, confirmacao } = entrada as { motivo?: unknown; confirmacao?: unknown };
  if (typeof motivo !== "string" || typeof confirmacao !== "string") {
    return { ok: false, mensagem: "Informe o motivo e digite a frase de confirmação." };
  }
  const motivoLimpo = motivo.trim();
  if (motivoLimpo.length < MOTIVO_MINIMO) {
    return {
      ok: false,
      mensagem: `Informe o motivo do desligamento (mínimo de ${MOTIVO_MINIMO} caracteres).`,
    };
  }
  if (motivoLimpo.length > MOTIVO_MAXIMO) {
    return { ok: false, mensagem: `O motivo deve ter no máximo ${MOTIVO_MAXIMO} caracteres.` };
  }
  if (confirmacao.trim() !== FRASE_DE_REVERSAO) {
    return { ok: false, mensagem: `Digite exatamente "${FRASE_DE_REVERSAO}" para confirmar.` };
  }
  return { ok: true, motivo: motivoLimpo };
}

export async function desligarMotorDeVigencia(
  db: ClienteDeRpc,
  entrada: unknown,
): Promise<ResultadoDaReversao> {
  const valida = validarEntradaDeReversao(entrada);
  if (!valida.ok) return recusaDeReversao("entrada-invalida", valida.mensagem);

  // 1. O motor tem de estar comprovadamente LIGADO.
  const antes = await db.rpc(RPC_ATIVACAO.estado);
  if (antes.error) {
    return recusaDeReversao("estado-desconhecido", "Não foi possível confirmar o estado do motor.");
  }
  const situacao = lerEstado(antes.data);
  if (situacao === "desligado") {
    return recusaDeReversao("ja-desligado", "O motor por vigência já está desligado.");
  }
  if (situacao === "desconhecido") {
    return recusaDeReversao(
      "estado-desconhecido",
      "O estado do motor é desconhecido ou inconsistente. Não é seguro desligar por aqui.",
    );
  }

  // 2. A RPC oficial, com o JWT da sessão. O banco repete admin + AAL2 e grava a trilha.
  const r = await db.rpc(RPC_ATIVACAO.alterar, {
    p_ativar: false,
    p_reason: valida.motivo,
    p_aceitar_pendencias: false,
  });
  if (r.error) {
    const codigo = codigoDoErro(r.error);
    if (codigo === "42501" || codigo === "28000") {
      return recusaDeReversao(
        "recusada-pelo-banco",
        "Sem permissão: desligar o motor exige administrador com segundo fator.",
      );
    }
    const doBanco = mensagemDoBanco(r.error);
    // 55000 inclui "já está desligado": uma chamada duplicada cai aqui sem alterar nada.
    if ((codigo === "55000" || codigo === "22023") && doBanco) {
      return recusaDeReversao("recusada-pelo-banco", doBanco);
    }
    return recusaDeReversao(
      "recusada-pelo-banco",
      "O banco recusou o desligamento. Nada foi alterado.",
    );
  }

  const dados = r.data;
  if (
    typeof dados !== "object" ||
    dados === null ||
    Array.isArray(dados) ||
    (dados as { ativo?: unknown }).ativo !== false
  ) {
    return recusaDeReversao(
      "resposta-invalida",
      "A resposta do desligamento não confirma que o motor foi desligado. Confira o estado do motor.",
    );
  }

  // 3. Confirma pelo estado oficial: desligado E consistente (gatilhos coerentes com a flag).
  const depois = await db.rpc(RPC_ATIVACAO.estado);
  if (depois.error || lerEstado(depois.data) !== "desligado") {
    return recusaDeReversao(
      "resposta-invalida",
      "O desligamento foi enviado, mas o estado do motor não pôde ser confirmado como desligado e consistente. Confira o estado antes de qualquer nova ação.",
    );
  }
  return { ok: true, sincronizacao: (dados as { sincronizacao?: unknown }).sincronizacao ?? null };
}

/**
 * O aviso "o banco confirmou a ativação" só vale enquanto a consulta ao banco mostrar o motor
 * LIGADO. Carregando, desligado ou desconhecido: nada de sucesso na tela.
 */
export function sucessoDaAtivacaoVisivel(tagDoEstado: string, temResultado: boolean): boolean {
  return temResultado && tagDoEstado === "ligado";
}

/** O sucesso guardado deixa de valer assim que a consulta mostra desligado ou desconhecido. */
export function sucessoDaAtivacaoObsoleto(tagDoEstado: string): boolean {
  return tagDoEstado === "desligado" || tagDoEstado === "desconhecido";
}
