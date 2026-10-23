/**
 * O que a tela de Apontamentos envia ao banco, e quais linhas ela envia (C05-B4.3A).
 *
 * Duas regras, ambas sobre o salvamento:
 *
 * 1. SÓ COLUNAS EDITÁVEIS. O formulário não digita valor financeiro nenhum: receita, custo,
 *    minutos trabalhados, extras e snapshots saem do cálculo do banco
 *    (`derivar_valores_financeiros`). Mandá-los no upsert era inútil — o banco os
 *    sobrescreve — e perigoso: quando o contrato é reajustado, a prévia da tela passa a
 *    divergir do que está gravado, e reenviar uma linha tocada sem mudança real é recusado
 *    com `42501` ("Valores financeiros ... não podem ser alterados diretamente"), perdendo
 *    todas as outras linhas do mesmo salvamento. Seguem como chaves de contexto só
 *    `operation_id` e `work_date`, que o tipo gerado do Supabase exige no INSERT: o banco os
 *    sobrescreve com os da folha (`sincronizar_chave_da_diaria`), então não decidem nada.
 *
 * 2. SÓ LINHAS ALTERADAS. Uma linha existente só entra no salvamento se o usuário a tocou
 *    E ela difere do que o servidor tem, depois de normalizar (`08:00` = `08:00:00`; nota
 *    nula = nota vazia). Linha nova entra sempre: salvar cria o apontamento do dia.
 *    Linha faturada nunca entra: é imutável no banco.
 *
 * O upsert do PostgREST monta o INSERT com a UNIÃO das chaves de todas as linhas e preenche
 * a chave ausente com NULL. Uma linha nova sem `id` junto de uma existente com `id` falhava
 * com `23502` (id nulo). Por isso TODA linha leva `id`; as novas ganham um uuid gerado aqui,
 * e o `ON CONFLICT (id)` do upsert decide entre inserir e atualizar.
 *
 * Este módulo não importa nada em tempo de execução, para que a suíte Node o execute de
 * verdade.
 */

import type { AttendanceStatus } from "./billing";

/** A linha do rascunho da tela. */
export interface LinhaDoApontamento {
  employeeId: string;
  entryId: string | undefined;
  status: AttendanceStatus;
  checkIn: string;
  checkOut: string;
  breakMinutes: number;
  notes: string;
}

/** O que o servidor tem para a linha: só os campos que esta lógica compara. */
export interface ApontamentoGravado {
  id: string;
  employee_id: string;
  status: AttendanceStatus;
  check_in: string | null;
  check_out: string | null;
  break_minutes: number;
  notes: string | null;
  invoice_id?: string | null;
}

/** Exatamente as colunas enviadas. Nada além disto vai no upsert. */
export interface CargaDeApontamento {
  id: string;
  timesheet_id: string;
  employee_id: string;
  operation_id: string;
  work_date: string;
  status: AttendanceStatus;
  check_in: string | null;
  check_out: string | null;
  break_minutes: number;
  notes: string | null;
}

export const COLUNAS_ENVIADAS = [
  "id",
  "timesheet_id",
  "employee_id",
  "operation_id",
  "work_date",
  "status",
  "check_in",
  "check_out",
  "break_minutes",
  "notes",
] as const;

/** `"08:00"` e `"08:00:00"` são o mesmo horário para quem aponta. */
export const soHoraEMinuto = (valor: string | null | undefined): string =>
  (valor ?? "").slice(0, 5);

const intervaloNormalizado = (valor: number): number => (Number.isFinite(valor) ? valor : 0);

/** Falta não tem horário: o que for digitado nos campos não é gravado. */
function horarioEfetivo(status: AttendanceStatus, valor: string): string {
  return status === "absent" ? "" : soHoraEMinuto(valor);
}

/**
 * A linha difere do que o servidor tem?
 *
 * Compara o que seria GRAVADO (horário de falta é sempre nulo), não o que está digitado.
 */
export function linhaFoiAlterada(linha: LinhaDoApontamento, gravado: ApontamentoGravado): boolean {
  return (
    gravado.status !== linha.status ||
    soHoraEMinuto(gravado.check_in) !== horarioEfetivo(linha.status, linha.checkIn) ||
    soHoraEMinuto(gravado.check_out) !== horarioEfetivo(linha.status, linha.checkOut) ||
    intervaloNormalizado(gravado.break_minutes) !== intervaloNormalizado(linha.breakMinutes) ||
    (gravado.notes ?? "") !== linha.notes
  );
}

/**
 * Uma linha JÁ GRAVADA tem alteração real? É o critério único do salvamento e da prévia de
 * preço: tocar na linha não basta (editar e devolver o valor original deixa a linha em
 * `tocadas`, mas sem diferença), e o que conta é o que seria gravado.
 *
 * Se o servidor não tem mais a linha (leitura velha), vale como alterada: não há como provar
 * que é idêntica. Linha sem `entryId` não é "gravada": a pergunta não se aplica (`false`).
 */
export function linhaGravadaFoiAlterada(
  linha: LinhaDoApontamento,
  tocadas: ReadonlySet<string>,
  gravado: ApontamentoGravado | undefined,
): boolean {
  if (!linha.entryId || !tocadas.has(linha.employeeId)) {
    return false;
  }

  return gravado ? linhaFoiAlterada(linha, gravado) : true;
}

/**
 * As linhas que o salvamento envia, na ordem em que vieram.
 *
 * - sem `entryId`: nova, entra sempre;
 * - com `entryId`: entra se foi tocada (`tocadas`) e difere do gravado; se o servidor não
 *   tem mais a linha (leitura velha), entra, porque não há como provar que é idêntica;
 * - faturada: nunca entra.
 */
export function linhasParaSalvar(
  linhas: readonly LinhaDoApontamento[],
  tocadas: ReadonlySet<string>,
  gravados: readonly ApontamentoGravado[],
): LinhaDoApontamento[] {
  const porColaborador = new Map(gravados.map((g) => [g.employee_id, g]));

  return linhas.filter((linha) => {
    const gravado = porColaborador.get(linha.employeeId);

    if (gravado?.invoice_id) {
      return false;
    }

    if (!linha.entryId) {
      return true;
    }

    return linhaGravadaFoiAlterada(linha, tocadas, gravado);
  });
}

/** Linhas que o banco recusaria por já estarem faturadas. */
export function colaboradoresFaturados(
  gravados: readonly ApontamentoGravado[],
): ReadonlySet<string> {
  return new Set(gravados.filter((g) => g.invoice_id).map((g) => g.employee_id));
}

/**
 * A carga de uma linha. `gerarId` só é chamado para linha nova.
 */
export function montarCarga(
  linha: LinhaDoApontamento,
  contexto: { timesheetId: string; operationId: string; workDate: string },
  gerarId: () => string,
): CargaDeApontamento {
  const ausente = linha.status === "absent";

  return {
    id: linha.entryId ?? gerarId(),
    timesheet_id: contexto.timesheetId,
    employee_id: linha.employeeId,
    operation_id: contexto.operationId,
    work_date: contexto.workDate,
    status: linha.status,
    check_in: ausente || !linha.checkIn ? null : `${soHoraEMinuto(linha.checkIn)}:00`,
    check_out: ausente || !linha.checkOut ? null : `${soHoraEMinuto(linha.checkOut)}:00`,
    break_minutes: intervaloNormalizado(linha.breakMinutes),
    notes: linha.notes || null,
  };
}
