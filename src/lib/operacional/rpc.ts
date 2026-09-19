/**
 * As cinco chamadas da superfície operacional AAL1.
 *
 * Este módulo é a única porta de dados do caminho operacional, e ele fala
 * **somente** por RPC: nenhuma leitura ou escrita direta de tabela acontece
 * aqui. Não é preferência de estilo — em AAL1 as 11 policies `*_exige_aal2`
 * recusam as tabelas de negócio, e um `from(...)` devolveria zero linha ou erro.
 *
 * Também não importa `../billing` nem `../ledger`, e não conhece contrato,
 * fatura nem qualquer número de dinheiro: o que essa superfície transporta é
 * dado operacional.
 *
 * As funções recebem o cliente por parâmetro em vez de criá-lo. É o que permite
 * exercitar o contrato — nomes das RPCs, parâmetros, recusa de campo não
 * autorizado — sem navegador e sem rede, em `scripts/testar-operacional.mjs`.
 * Quem amarra o cliente real são os hooks de `queries.ts` e `mutations.ts`.
 */

import type {
  ApontamentoDoOperador,
  CampoDaLinha,
  EntradaDaLinha,
  EscritaDoApontamento,
  LinhaDoApontamento,
  MembroDaEquipeDoOperador,
  OperacaoDoOperador,
  TurnoDoOperador,
} from "./tipos";

/** Nomes das cinco RPCs, como o banco as expõe. */
export const RPC_OPERACIONAL = {
  operacoes: "listar_operacoes_do_operador",
  turnos: "listar_turnos_do_operador",
  equipe: "listar_equipe_do_operador",
  apontamentos: "listar_apontamentos_do_operador",
  salvar: "salvar_apontamento_operacional",
} as const;

/**
 * Os SEIS campos que `salvar_apontamento_operacional` aceita por linha.
 *
 * A lista não é conveniência: a RPC recusa **a chamada inteira** com `22023`
 * diante de qualquer outra chave no JSON, e o papel dono das RPCs não tem
 * privilégio de coluna para escrever nada além disto. Acrescentar item aqui
 * sem migration nova só produz erro no banco.
 */
export const CAMPOS_DA_LINHA: readonly CampoDaLinha[] = [
  "employee_id",
  "status",
  "check_in",
  "check_out",
  "break_minutes",
  "notes",
];

/**
 * O mínimo que este módulo precisa de um cliente Supabase.
 *
 * Declarar a forma em vez de importar o tipo gerado é deliberado: o
 * `Database` de `src/integrations/supabase/types.ts` ainda não conhece as cinco
 * funções da migration 013, então o `.rpc()` tipado recusaria os nomes. Ver a
 * nota do PR sobre o gate de tipos.
 */
export interface ErroDaResposta {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}

export interface RespostaRpc {
  data: unknown;
  error: ErroDaResposta | null;
}

export interface ClienteOperacional {
  rpc(nome: string, parametros?: Record<string, unknown>): PromiseLike<RespostaRpc>;
}

/**
 * Adapta o cliente do projeto à forma acima.
 *
 * O molde único desta camada. Enquanto o tipo canônico não conhecer as RPCs da
 * 013, alguém precisa afirmar a compatibilidade; que seja num lugar só, com o
 * motivo escrito, e não espalhado por cada chamada.
 */
export function comoClienteOperacional(cliente: unknown): ClienteOperacional {
  return cliente as ClienteOperacional;
}

/**
 * Erro de uma chamada da superfície, com o SQLSTATE preservado.
 *
 * `supabase-js` devolve `code`, `details` e `hint` junto da mensagem, e jogar
 * tudo fora para ficar só com o texto obrigaria a tela a classificar erro por
 * substring — frágil, e ainda por cima em mensagem traduzível. As RPCs da 013
 * usam os códigos deliberadamente: `42501` é recusa de autorização ou folha
 * fechada, `23514` é turno que não pertence à operação ou colaborador fora da
 * equipe ativa, `22023` é parâmetro ou campo não permitido, `23505` é violação
 * de unicidade. O B2.3 precisa distinguir esses casos.
 */
export class ErroRpcOperacional extends Error {
  readonly code?: string | undefined;
  readonly details?: string | undefined;
  readonly hint?: string | undefined;

  constructor(erro: ErroDaResposta, chamada: string) {
    super(erro.message || `Falha na chamada ${chamada}.`);
    this.name = "ErroRpcOperacional";
    this.code = erro.code;
    this.details = erro.details;
    this.hint = erro.hint;
  }
}

/**
 * Resposta que não respeita o contrato da RPC.
 *
 * Separado do erro do banco de propósito: aqui o banco não reclamou de nada, e
 * ainda assim veio coisa que o `RETURNS TABLE` não produz.
 */
export class ErroDeContratoOperacional extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDeContratoOperacional";
  }
}

function exigirTexto(valor: string | null | undefined, nome: string): string {
  if (typeof valor !== "string" || valor.trim() === "") {
    throw new Error(`Parâmetro obrigatório ausente: ${nome}.`);
  }
  return valor;
}

const FORMATO_DE_DATA = /^\d{4}-\d{2}-\d{2}$/;

function exigirData(valor: string | null | undefined, nome: string): string {
  const texto = exigirTexto(valor, nome);
  if (!FORMATO_DE_DATA.test(texto)) {
    throw new Error(`Data inválida em ${nome}: use o formato AAAA-MM-DD.`);
  }
  return texto;
}

/**
 * Erro da RPC é erro, sempre.
 *
 * `supabase-js` não lança: devolve `{ data, error }`. Ignorar o `error` faria
 * uma recusa de autorização (`42501`), um turno de outra operação (`23514`) ou
 * um campo não permitido (`22023`) chegarem à tela como lista vazia — falha
 * silenciosa exatamente onde ela é mais cara. O código do erro sobe junto.
 */
function exigirSucesso(resposta: RespostaRpc, chamada: string): unknown {
  if (resposta.error) {
    throw new ErroRpcOperacional(resposta.error, chamada);
  }
  return resposta.data;
}

/**
 * As quatro leituras são `RETURNS TABLE`: ou vem array, ou o contrato quebrou.
 *
 * Lista vazia é resposta legítima — operação sem turno, folha sem linha — e
 * passa direto. O que não passa é `null`, objeto ou texto **sem erro junto**:
 * transformar isso em `[]` esconderia quebra de contrato atrás de uma tela
 * vazia, que é indistinguível de "não há dados". Falhar aqui é o que faz o
 * problema aparecer onde ele é.
 */
function exigirLista<T>(dados: unknown, chamada: string): T[] {
  if (!Array.isArray(dados)) {
    throw new ErroDeContratoOperacional(`Resposta inválida da RPC ${chamada}.`);
  }
  return dados as T[];
}

const FORMATO_DE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A escrita devolve o id da folha, e isso é verificado, não afirmado.
 *
 * Um `as string` convence o TypeScript e não olha o valor. Se a resposta vier
 * nula, vazia ou de outra forma, a mutation não pode ser dada como bem
 * sucedida: a tela invalidaria o cache e mostraria "salvo" sem ter id nenhum.
 */
function exigirIdentificadorDaFolha(dados: unknown, chamada: string): string {
  if (typeof dados !== "string" || !FORMATO_DE_UUID.test(dados)) {
    throw new ErroDeContratoOperacional(
      `A RPC ${chamada} devia devolver o identificador da folha.`,
    );
  }
  return dados;
}

// ---------------------------------------------------------------------------
// Pré-condições de parâmetro
//
// Cada leitura dependente só faz sentido com os identificadores do passo
// anterior em mãos. Os predicados abaixo são o que os hooks usam em `enabled`,
// para que a regra viva num lugar testável em vez de repetida em cada hook.
// ---------------------------------------------------------------------------

export const temIdentificador = (valor: string | null | undefined): boolean =>
  typeof valor === "string" && valor.trim() !== "";

export const podeListarTurnos = (operationId: string | null | undefined): boolean =>
  temIdentificador(operationId);

export const podeListarEquipe = (
  operationId: string | null | undefined,
  shiftId: string | null | undefined,
): boolean => temIdentificador(operationId) && temIdentificador(shiftId);

export const podeListarApontamentos = (
  operationId: string | null | undefined,
  shiftId: string | null | undefined,
  workDate: string | null | undefined,
): boolean =>
  temIdentificador(operationId) &&
  temIdentificador(shiftId) &&
  typeof workDate === "string" &&
  FORMATO_DE_DATA.test(workDate);

// ---------------------------------------------------------------------------
// Leituras
// ---------------------------------------------------------------------------

export async function buscarOperacoesDoOperador(
  cliente: ClienteOperacional,
): Promise<OperacaoDoOperador[]> {
  const resposta = await cliente.rpc(RPC_OPERACIONAL.operacoes);
  return exigirLista<OperacaoDoOperador>(
    exigirSucesso(resposta, RPC_OPERACIONAL.operacoes),
    RPC_OPERACIONAL.operacoes,
  );
}

export async function buscarTurnosDoOperador(
  cliente: ClienteOperacional,
  operationId: string,
): Promise<TurnoDoOperador[]> {
  const resposta = await cliente.rpc(RPC_OPERACIONAL.turnos, {
    p_operation_id: exigirTexto(operationId, "operationId"),
  });
  return exigirLista<TurnoDoOperador>(
    exigirSucesso(resposta, RPC_OPERACIONAL.turnos),
    RPC_OPERACIONAL.turnos,
  );
}

export async function buscarEquipeDoOperador(
  cliente: ClienteOperacional,
  operationId: string,
  shiftId: string,
): Promise<MembroDaEquipeDoOperador[]> {
  const resposta = await cliente.rpc(RPC_OPERACIONAL.equipe, {
    p_operation_id: exigirTexto(operationId, "operationId"),
    p_shift_id: exigirTexto(shiftId, "shiftId"),
  });
  return exigirLista<MembroDaEquipeDoOperador>(
    exigirSucesso(resposta, RPC_OPERACIONAL.equipe),
    RPC_OPERACIONAL.equipe,
  );
}

export async function buscarApontamentosDoOperador(
  cliente: ClienteOperacional,
  operationId: string,
  shiftId: string,
  workDate: string,
): Promise<ApontamentoDoOperador[]> {
  const resposta = await cliente.rpc(RPC_OPERACIONAL.apontamentos, {
    p_operation_id: exigirTexto(operationId, "operationId"),
    p_shift_id: exigirTexto(shiftId, "shiftId"),
    p_work_date: exigirData(workDate, "workDate"),
  });
  return exigirLista<ApontamentoDoOperador>(
    exigirSucesso(resposta, RPC_OPERACIONAL.apontamentos),
    RPC_OPERACIONAL.apontamentos,
  );
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

/**
 * Normaliza as linhas para exatamente os seis campos que a RPC aceita.
 *
 * A conferência acontece aqui **e** no banco, em três camadas independentes: a
 * lista branca da própria RPC, o privilégio por coluna do papel dono e as
 * guardas das migrations 010 e 011. Esta é a primeira e a menos importante das
 * três — serve para a tela falhar cedo e com mensagem legível, nunca como a
 * proteção. Chave estranha recusa a chamada inteira, como no banco; descartar
 * em silêncio faria a interface acreditar que gravou o que mandou.
 *
 * Campo opcional ausente vira `null` explícito: a RPC trata chave ausente e
 * valor nulo do mesmo jeito, e mandar sempre os seis torna previsível o efeito
 * de limpar um horário.
 */
export function montarLinhasDoApontamento(entradas: EntradaDaLinha[]): LinhaDoApontamento[] {
  if (!Array.isArray(entradas) || entradas.length === 0) {
    throw new Error("Nenhuma linha para gravar.");
  }

  return entradas.map((entrada) => {
    if (entrada === null || typeof entrada !== "object") {
      throw new Error("Cada linha do apontamento deve ser um objeto.");
    }

    for (const campo of Object.keys(entrada)) {
      if (!(CAMPOS_DA_LINHA as readonly string[]).includes(campo)) {
        throw new Error(`Campo não permitido no apontamento: ${campo}.`);
      }
    }

    const employeeId = exigirTexto(entrada.employee_id, "employee_id");
    const status = exigirTexto(entrada.status, "status");

    return {
      employee_id: employeeId,
      status: status as LinhaDoApontamento["status"],
      check_in: entrada.check_in ?? null,
      check_out: entrada.check_out ?? null,
      break_minutes: entrada.break_minutes ?? null,
      notes: entrada.notes ?? null,
    };
  });
}

/**
 * Grava o apontamento do par operação/turno numa data.
 *
 * Devolve o id da folha, que é o que a RPC retorna. Não existe exclusão nesta
 * superfície: linha ausente do payload é linha **não tocada**, nunca apagada.
 * Fechar ou reabrir folha também não passa por aqui — é ato administrativo.
 */
export async function salvarApontamentoOperacional(
  cliente: ClienteOperacional,
  { operationId, shiftId, workDate, linhas }: EscritaDoApontamento,
): Promise<string> {
  const resposta = await cliente.rpc(RPC_OPERACIONAL.salvar, {
    p_operation_id: exigirTexto(operationId, "operationId"),
    p_shift_id: exigirTexto(shiftId, "shiftId"),
    p_work_date: exigirData(workDate, "workDate"),
    p_linhas: montarLinhasDoApontamento(linhas),
  });
  return exigirIdentificadorDaFolha(
    exigirSucesso(resposta, RPC_OPERACIONAL.salvar),
    RPC_OPERACIONAL.salvar,
  );
}
