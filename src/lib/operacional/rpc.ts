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
export interface RespostaRpc {
  data: unknown;
  error: { message: string } | null;
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
 * silenciosa exatamente onde ela é mais cara.
 */
function exigirSucesso(resposta: RespostaRpc, chamada: string): unknown {
  if (resposta.error) {
    throw new Error(resposta.error.message || `Falha na chamada ${chamada}.`);
  }
  return resposta.data;
}

function comoLista<T>(dados: unknown): T[] {
  return Array.isArray(dados) ? (dados as T[]) : [];
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
  return comoLista<OperacaoDoOperador>(exigirSucesso(resposta, RPC_OPERACIONAL.operacoes));
}

export async function buscarTurnosDoOperador(
  cliente: ClienteOperacional,
  operationId: string,
): Promise<TurnoDoOperador[]> {
  const resposta = await cliente.rpc(RPC_OPERACIONAL.turnos, {
    p_operation_id: exigirTexto(operationId, "operationId"),
  });
  return comoLista<TurnoDoOperador>(exigirSucesso(resposta, RPC_OPERACIONAL.turnos));
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
  return comoLista<MembroDaEquipeDoOperador>(exigirSucesso(resposta, RPC_OPERACIONAL.equipe));
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
  return comoLista<ApontamentoDoOperador>(exigirSucesso(resposta, RPC_OPERACIONAL.apontamentos));
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
  return exigirSucesso(resposta, RPC_OPERACIONAL.salvar) as string;
}
