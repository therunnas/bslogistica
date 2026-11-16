/**
 * As cinco chamadas da superfície operacional AAL1.
 *
 * Este módulo é a única porta de dados do caminho operacional, e ele fala
 * **somente** por RPC: nenhuma leitura ou escrita direta de tabela acontece
 * aqui. Não é preferência de estilo — as policies das tabelas de negócio
 * recusam o papel operacional, e um `from(...)` devolveria zero linha ou erro.
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
  ResultadoDaGravacaoOperacional,
  TurnoDoOperador,
} from "./tipos";

/**
 * Nomes das cinco RPCs, como o banco as expõe. A listagem e a gravação de apontamentos são as v2
 * da migration 054 (GATE-FIN-06): com a versão da linha, conferida pelo banco sob trava. As v1
 * continuam no banco para o app antigo durante a expansão; esta camada não as chama, nem como
 * reserva (sem a v2 a chamada falha com PGRST202 e nada é gravado).
 */
export const RPC_OPERACIONAL = {
  operacoes: "listar_operacoes_do_operador",
  turnos: "listar_turnos_do_operador",
  equipe: "listar_equipe_do_operador",
  apontamentos: "listar_apontamentos_do_operador_v2",
  salvar: "salvar_apontamento_operacional_v2",
} as const;

/**
 * Os SETE campos que `salvar_apontamento_operacional_v2` aceita por linha: os seis da 013 e
 * `versao_esperada` (054). `confirmar_virada` NÃO está aqui: confirmar a virada da meia-noite é
 * ato do administrador, e a RPC do operador recusa a chave.
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
  "versao_esperada",
];

/** As colunas de `listar_apontamentos_do_operador_v2`. Coluna a mais é quebra de contrato. */
const COLUNAS_DA_LISTAGEM: readonly string[] = [
  "timesheet_id",
  "shift_id",
  "work_date",
  "folha_status",
  "employee_id",
  "status",
  "check_in",
  "check_out",
  "break_minutes",
  "notes",
  "faturado",
  "versao",
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

const ehVersao = (valor: unknown, minimo: number): valor is number =>
  typeof valor === "number" && Number.isSafeInteger(valor) && valor >= minimo;

/**
 * A listagem v2 é conferida linha a linha: só as colunas do contrato (nenhuma outra chega à tela,
 * financeira ou não) e a versão presente em toda linha de apontamento. Sem versão não há como
 * gravar com segurança, então a falta dela é quebra de contrato, não um "0" presumido.
 */
function exigirApontamentos(dados: unknown, chamada: string): ApontamentoDoOperador[] {
  const lista = exigirLista<Record<string, unknown>>(dados, chamada);
  for (const linha of lista) {
    if (linha === null || typeof linha !== "object") {
      throw new ErroDeContratoOperacional(`Resposta inválida da RPC ${chamada}.`);
    }
    const extra = Object.keys(linha).filter((c) => !COLUNAS_DA_LISTAGEM.includes(c));
    if (extra.length > 0) {
      throw new ErroDeContratoOperacional(
        `Resposta inválida da RPC ${chamada}: coluna fora do contrato.`,
      );
    }
    const temLinha = linha["employee_id"] !== null && linha["employee_id"] !== undefined;
    if (temLinha ? !ehVersao(linha["versao"], 1) : linha["versao"] !== null) {
      throw new ErroDeContratoOperacional(`Resposta inválida da RPC ${chamada}: versão ausente.`);
    }
  }
  return lista as unknown as ApontamentoDoOperador[];
}

const RESULTADOS: readonly string[] = ["inserido", "atualizado", "sem_alteracao"];

/**
 * A escrita v2 devolve `{timesheet_id, linhas: [{employee_id, versao, resultado}]}`, e isso é
 * verificado, não afirmado: a v1 devolvia só o id da folha, e um `as` convenceria o TypeScript sem
 * olhar o valor. Cada colaborador enviado volta exatamente uma vez.
 */
function lerResultadoDaGravacao(
  dados: unknown,
  enviados: readonly string[],
  chamada: string,
): ResultadoDaGravacaoOperacional {
  const falha = (): never => {
    throw new ErroDeContratoOperacional(`A RPC ${chamada} devolveu uma resposta fora do contrato.`);
  };
  if (dados === null || typeof dados !== "object" || Array.isArray(dados)) return falha();
  const { timesheet_id, linhas } = dados as Record<string, unknown>;
  if (typeof timesheet_id !== "string" || !FORMATO_DE_UUID.test(timesheet_id)) falha();
  if (!Array.isArray(linhas)) return falha();
  const lidas = linhas.map((l) => {
    if (l === null || typeof l !== "object") return falha();
    const { employee_id, versao, resultado } = l as Record<string, unknown>;
    if (typeof employee_id !== "string" || !ehVersao(versao, 1)) falha();
    if (typeof resultado !== "string" || !RESULTADOS.includes(resultado)) falha();
    return { employee_id, versao, resultado } as ResultadoDaGravacaoOperacional["linhas"][number];
  });
  const devolvidos = lidas.map((l) => l.employee_id).sort();
  if (JSON.stringify(devolvidos) !== JSON.stringify([...enviados].sort())) falha();
  return { timesheet_id: timesheet_id as string, linhas: lidas };
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
  return exigirApontamentos(
    exigirSucesso(resposta, RPC_OPERACIONAL.apontamentos),
    RPC_OPERACIONAL.apontamentos,
  );
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

/**
 * Normaliza as linhas para exatamente os sete campos que a RPC aceita.
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
    // A versão vem da leitura (0 = linha nova). Ausente ou fora do formato, a linha não sai daqui:
    // a camada não inventa nem presume versão.
    if (!ehVersao(entrada.versao_esperada, 0)) {
      throw new Error(`Versão ausente na linha do apontamento: ${employeeId}.`);
    }

    return {
      employee_id: employeeId,
      status: status as LinhaDoApontamento["status"],
      check_in: entrada.check_in ?? null,
      check_out: entrada.check_out ?? null,
      break_minutes: entrada.break_minutes ?? null,
      notes: entrada.notes ?? null,
      versao_esperada: entrada.versao_esperada,
    };
  });
}

/**
 * Grava o apontamento do par operação/turno numa data.
 *
 * Devolve a folha e, por colaborador, a versão gravada e o resultado (`inserido`, `atualizado` ou
 * `sem_alteracao`). Não existe exclusão nesta superfície: linha ausente do payload é linha **não
 * tocada**, nunca apagada. Fechar ou reabrir folha também não passa por aqui — é ato
 * administrativo. Versão obsoleta com conteúdo diferente chega como `ErroRpcOperacional` 40001 e
 * não é repetida aqui: trocar a versão é decisão da pessoa, na tela.
 */
export async function salvarApontamentoOperacional(
  cliente: ClienteOperacional,
  { operationId, shiftId, workDate, linhas }: EscritaDoApontamento,
): Promise<ResultadoDaGravacaoOperacional> {
  const parametros = {
    p_operation_id: exigirTexto(operationId, "operationId"),
    p_shift_id: exigirTexto(shiftId, "shiftId"),
    p_work_date: exigirData(workDate, "workDate"),
  };
  const p_linhas = montarLinhasDoApontamento(linhas);
  const resposta = await cliente.rpc(RPC_OPERACIONAL.salvar, { ...parametros, p_linhas });
  return lerResultadoDaGravacao(
    exigirSucesso(resposta, RPC_OPERACIONAL.salvar),
    p_linhas.map((l) => l.employee_id),
    RPC_OPERACIONAL.salvar,
  );
}
