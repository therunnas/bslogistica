/**
 * Contratos TypeScript da superfície operacional AAL1.
 *
 * Cada tipo aqui é a transcrição de um `RETURNS TABLE` da migration
 * `20260918160000_013_superficie_operacional_aal1.sql`, com o contrato de
 * `listar_apontamentos_do_operador` estendido por
 * `20261015111816_019_historico_operacional_desalocado.sql` para retornar
 * `employee_name` e `employee_role`. Essas migrations são as fontes canônicas.
 * Nada é mais largo que a assinatura: o que não está no retorno da RPC não
 * existe para quem chama, e esta camada não inventa campo nenhum.
 *
 * A nulabilidade veio das colunas de origem, não de suposição:
 *
 *   - `operations.site` e `operations.operation_date` são anuláveis;
 *   - `employees.role` é anulável;
 *   - `clients.name` não é, e o JOIN de `listar_operacoes_do_operador` é
 *     interno, então `cliente_nome` sempre vem preenchido;
 *   - em `listar_apontamentos_do_operador` o JOIN com as linhas é LEFT, de
 *     propósito: a folha existe antes de ter apontamento. Com folha vazia
 *     chega uma linha com os campos de folha preenchidos e os da linha nulos —
 *     por isso tudo que vem de `timesheet_entries` é anulável aqui;
 *   - **`faturado` é a exceção, e não por acaso.** Ele não vem da linha: é
 *     computado por `public.apontamento_faturado()`, que fecha o retorno com
 *     `coalesce(..., false)`. Na folha vazia a subconsulta não casa com nada e
 *     a resposta é `false`, nunca nulo. Tipar como anulável obrigaria a tela a
 *     tratar um terceiro estado que o banco não produz.
 *
 * Nenhum valor monetário atravessa esta superfície, em nenhuma direção. O que
 * o operador sabe sobre faturamento é o booleano `faturado`, derivado no banco.
 *
 * **Só tipos vivem aqui.** As constantes de tempo de execução — nomes das RPCs
 * e a lista dos seis campos — ficam em `rpc.ts`, para que este módulo suma por
 * inteiro na compilação e os testes possam carregar a camada em Node puro, como
 * as outras suítes do projeto fazem.
 */

import type { AttendanceStatus, OperationType, RecordStatus, TimesheetStatus } from "../types";

/** `listar_operacoes_do_operador()` — sete colunas. */
export interface OperacaoDoOperador {
  id: string;
  name: string;
  site: string | null;
  type: OperationType;
  operation_date: string | null;
  status: RecordStatus;
  cliente_nome: string;
}

/** `listar_turnos_do_operador(uuid)` — seis colunas de jornada. */
export interface TurnoDoOperador {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
  crosses_midnight: boolean;
}

/**
 * `listar_equipe_do_operador(uuid, uuid)` — quatro colunas.
 *
 * `active` vem na resposta e a lista NÃO é filtrada por ele: a tela precisa
 * distinguir "saiu da equipe" de "nunca esteve". Quem exige equipe ativa é a
 * escrita, no banco.
 */
export interface MembroDaEquipeDoOperador {
  employee_id: string;
  employee_name: string;
  employee_role: string | null;
  active: boolean;
}

/** `listar_apontamentos_do_operador(uuid, uuid, date)` — folha + linha. */
export interface ApontamentoDoOperador {
  timesheet_id: string;
  shift_id: string;
  work_date: string;
  folha_status: TimesheetStatus;
  employee_id: string | null;
  status: AttendanceStatus | null;
  check_in: string | null;
  check_out: string | null;
  break_minutes: number | null;
  notes: string | null;
  /** Nunca nulo: o helper do banco fecha com `coalesce(..., false)`. */
  faturado: boolean;
  /** Identidade atual; nula na linha-sentinela de folha sem apontamentos. */
  employee_name: string | null;
  employee_role: string | null;
}

/** Os seis campos que a RPC de escrita aceita por linha. Ver `rpc.ts`. */
export type CampoDaLinha =
  "employee_id" | "status" | "check_in" | "check_out" | "break_minutes" | "notes";

/** Uma linha já normalizada, pronta para virar JSON da RPC de escrita. */
export interface LinhaDoApontamento {
  employee_id: string;
  status: AttendanceStatus;
  check_in: string | null;
  check_out: string | null;
  break_minutes: number | null;
  notes: string | null;
}

/** O que a interface entrega antes da normalização. */
export interface EntradaDaLinha {
  employee_id: string;
  status: AttendanceStatus;
  check_in?: string | null;
  check_out?: string | null;
  break_minutes?: number | null;
  notes?: string | null;
}

/** Parâmetros da escrita. */
export interface EscritaDoApontamento {
  operationId: string;
  shiftId: string;
  workDate: string;
  linhas: EntradaDaLinha[];
}
