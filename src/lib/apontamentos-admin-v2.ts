/**
 * O salvamento do administrador pelos contratos v2 da migration 054 (GATE-FIN-06).
 *
 * Uma porta só: `salvar_apontamento_admin_v2`. Não existe caminho alternativo — nem a RPC v1, nem o
 * upsert direto de `timesheet_entries`, nem o INSERT de folha que o app anterior à 031 fazia. Se a
 * v2 não existir no banco (PGRST202), a falha é controlada e nada é gravado: o app novo exige a 054.
 *
 * O cliente é recebido por parâmetro (como em `src/lib/operacional/rpc.ts`), o que permite exercitar
 * o contrato em `scripts/testar-frontend-v2.mjs` com um cliente falso, sem rede nem navegador.
 *
 * A versão de cada linha (`versao_esperada`) é a que a tela leu do banco quando a pessoa começou a
 * editar; a RPC a confere sob trava. 40001 sobe como CONFLITO e nunca é repetido aqui com outra
 * versão: trocar a versão é decisão explícita da pessoa, na tela.
 */

import {
  classificarFalhaDoSalvamento,
  lerResultadoDoSalvamentoAdmin,
  montarCargaDaRpcV2,
  type FalhaDoSalvamento,
  type LinhaDoApontamento,
  type ResultadoDoSalvamentoAdmin,
} from "./apontamentos-salvar";

export const RPC_ADMIN_V2 = {
  salvar: "salvar_apontamento_admin_v2",
  situacaoDaVirada: "situacao_da_virada",
  confirmarVirada: "confirmar_virada_do_apontamento",
} as const;

export interface ErroDaResposta {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}

export interface ClienteDoApontamento {
  rpc(
    nome: string,
    parametros: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: ErroDaResposta | null }>;
}

/** O cliente do projeto na forma acima (o `Database` gerado não conhece as RPCs da 054). */
export function comoClienteDoApontamento(cliente: unknown): ClienteDoApontamento {
  return cliente as ClienteDoApontamento;
}

/** Falha do salvamento, com o SQLSTATE preservado e a categoria que a tela usa. */
export class ErroDoSalvamentoAdmin extends Error {
  readonly code?: string | undefined;
  readonly details?: string | undefined;
  readonly hint?: string | undefined;
  readonly falha: FalhaDoSalvamento;

  constructor(origem: unknown, falha: FalhaDoSalvamento) {
    const e = (typeof origem === "object" && origem !== null ? origem : {}) as Partial<
      ErroDaResposta & { message: string }
    >;
    super(e.message || "Não foi possível salvar o apontamento.");
    this.name = "ErroDoSalvamentoAdmin";
    this.code = e.code;
    this.details = e.details;
    this.hint = e.hint;
    this.falha = falha;
  }
}

export interface SalvamentoDoDia {
  operationId: string;
  /** `null` = folha sem turno (a v2 aceita, como a v1). */
  shiftId: string | null;
  workDate: string;
  linhas: readonly LinhaDoApontamento[];
  /** A versão lida do banco para cada colaborador (0 = linha nova; `null` = desconhecida). */
  versaoEsperada: (employeeId: string) => unknown;
  funcoesDoDia?: ReadonlyMap<string, string> | undefined;
  /** Colaboradores cuja virada da meia-noite o ADMINISTRADOR confirmou nesta tela. */
  viradasConfirmadas?: ReadonlySet<string> | undefined;
}

export async function salvarDiaAdminV2(
  cliente: ClienteDoApontamento,
  s: SalvamentoDoDia,
): Promise<ResultadoDoSalvamentoAdmin> {
  let carga;
  try {
    carga = montarCargaDaRpcV2(s.linhas, s.versaoEsperada, s.funcoesDoDia, s.viradasConfirmadas);
  } catch (erro) {
    throw new ErroDoSalvamentoAdmin(erro, classificarFalhaDoSalvamento(erro));
  }
  const { data, error } = await cliente.rpc(RPC_ADMIN_V2.salvar, {
    p_operation_id: s.operationId,
    p_shift_id: s.shiftId,
    p_work_date: s.workDate,
    p_linhas: carga,
  });
  if (error) {
    throw new ErroDoSalvamentoAdmin(error, classificarFalhaDoSalvamento(error));
  }
  try {
    return lerResultadoDoSalvamentoAdmin(
      data,
      carga.map((l) => l.employee_id),
    );
  } catch (erro) {
    throw new ErroDoSalvamentoAdmin(erro, "contrato");
  }
}

export type SituacaoDaVirada = "sem_virada" | "turno_vira_o_dia" | "confirmada" | "pendente";
const SITUACOES: readonly string[] = ["sem_virada", "turno_vira_o_dia", "confirmada", "pendente"];

/** `situacao_da_virada(entry)`: só o administrador consulta (o banco recusa os demais com 42501). */
export async function consultarSituacaoDaVirada(
  cliente: ClienteDoApontamento,
  entryId: string,
): Promise<SituacaoDaVirada> {
  const { data, error } = await cliente.rpc(RPC_ADMIN_V2.situacaoDaVirada, { p_entry_id: entryId });
  if (error) throw new ErroDoSalvamentoAdmin(error, classificarFalhaDoSalvamento(error));
  if (typeof data !== "string" || !SITUACOES.includes(data)) {
    throw new ErroDoSalvamentoAdmin(
      { message: "Resposta inválida de situacao_da_virada." },
      "contrato",
    );
  }
  return data as SituacaoDaVirada;
}

export interface ConfirmacaoRegistrada {
  confirmacao_id: string;
  entry_id: string;
  versao: number;
  situacao: "confirmada";
}

/**
 * `confirmar_virada_do_apontamento(entry, versao)`: registra a confirmação do administrador para o
 * apontamento JÁ GRAVADO, na versão que a tela mostrou. Versão diferente = 40001 (conflito).
 */
export async function confirmarViradaRegistrada(
  cliente: ClienteDoApontamento,
  entryId: string,
  versao: number,
): Promise<ConfirmacaoRegistrada> {
  const { data, error } = await cliente.rpc(RPC_ADMIN_V2.confirmarVirada, {
    p_entry_id: entryId,
    p_versao: versao,
  });
  if (error) throw new ErroDoSalvamentoAdmin(error, classificarFalhaDoSalvamento(error));
  const d = (typeof data === "object" && data !== null ? data : {}) as Record<string, unknown>;
  if (
    typeof d["confirmacao_id"] !== "string" ||
    d["entry_id"] !== entryId ||
    typeof d["versao"] !== "number" ||
    d["situacao"] !== "confirmada"
  ) {
    throw new ErroDoSalvamentoAdmin(
      { message: "Resposta inválida de confirmar_virada_do_apontamento." },
      "contrato",
    );
  }
  return d as unknown as ConfirmacaoRegistrada;
}
