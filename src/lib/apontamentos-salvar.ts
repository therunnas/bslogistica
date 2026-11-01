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

// ---------------------------------------------------------------------------
// C07 — salvamento do administrador: rascunho, contexto e concorrência
//
// Tudo puro. A tela só chama estas funções; nenhuma regra de "o que está sujo" fica no componente.

/** O que o salvamento leva de UMA linha, em forma comparável (mesma normalização de `montarCarga`). */
export function assinaturaDaLinha(linha: LinhaDoApontamento): string {
  const ausente = linha.status === "absent";
  return JSON.stringify([
    linha.employeeId,
    linha.status,
    ausente ? "" : soHoraEMinuto(linha.checkIn),
    ausente ? "" : soHoraEMinuto(linha.checkOut),
    intervaloNormalizado(linha.breakMinutes),
    linha.notes,
  ]);
}

/** As assinaturas, por colaborador, das linhas que ESTE salvamento levou. */
export function assinaturasSalvas(
  linhas: readonly LinhaDoApontamento[],
): ReadonlyMap<string, string> {
  return new Map(linhas.map((linha) => [linha.employeeId, assinaturaDaLinha(linha)]));
}

/**
 * Carga da RPC `salvar_apontamento_admin`: só as colunas editáveis, sem id, sem folha, sem
 * contexto. A folha e a identidade da linha (colaborador na folha) são do banco.
 */
export function montarCargaDaRpc(
  linhas: readonly LinhaDoApontamento[],
  /**
   * Função trabalhada (FIN-PR-07), por colaborador, só para linhas NOVAS e só quando o banco grava
   * snapshots de função (migration 040). Sem o mapa o payload é o de antes: o banco antigo não tem a
   * coluna e a RPC antiga ignoraria a chave. Linha existente nunca leva a função: corrigir é a RPC
   * própria, com motivo.
   */
  funcoesDoDia?: ReadonlyMap<string, string>,
) {
  return linhas.map((linha) => {
    const ausente = linha.status === "absent";
    const funcao = funcoesDoDia?.get(linha.employeeId);
    return {
      employee_id: linha.employeeId,
      status: linha.status,
      check_in: ausente || !linha.checkIn ? null : `${soHoraEMinuto(linha.checkIn)}:00`,
      check_out: ausente || !linha.checkOut ? null : `${soHoraEMinuto(linha.checkOut)}:00`,
      break_minutes: intervaloNormalizado(linha.breakMinutes),
      notes: linha.notes || null,
      ...(funcao !== undefined && funcao !== "" && !ausente && linha.entryId === undefined
        ? { job_function_id: funcao }
        : {}),
    };
  });
}

/**
 * O resultado de um salvamento só vale para o contexto (operação, turno e data) que o pediu. Um
 * retorno atrasado, depois de a pessoa trocar de contexto, não toca no rascunho de agora.
 */
export function deveAplicarResultado(contextoDaMutacao: string, contextoAtual: string): boolean {
  return contextoDaMutacao === contextoAtual;
}

/**
 * Quem continua "sujo" depois de um salvamento: só sai quem foi salvo E não mudou desde o envio.
 * Uma edição feita enquanto o salvamento corria (assinatura diferente) continua sendo pendência, e
 * a linha que não entrou no lote também.
 */
export function dirtyAposSalvar(
  dirty: ReadonlySet<string>,
  linhasAtuais: readonly LinhaDoApontamento[],
  salvas: ReadonlyMap<string, string>,
): Set<string> {
  const restante = new Set(dirty);
  for (const linha of linhasAtuais) {
    const enviada = salvas.get(linha.employeeId);
    if (enviada !== undefined && enviada === assinaturaDaLinha(linha)) {
      restante.delete(linha.employeeId);
    }
  }
  return restante;
}

/**
 * Depois de uma edição: a linha fica "suja" se difere do que o servidor tem; se a edição foi
 * integralmente desfeita (igual ao gravado), deixa de ser. Linha sem registro no servidor é suja
 * enquanto tiver uma decisão (status), e deixa de ser ao voltar a "não apontado".
 */
export function dirtyAposEdicao(
  dirty: ReadonlySet<string>,
  linha: Omit<LinhaDoApontamento, "status"> & { status: AttendanceStatus | null },
  gravado: ApontamentoGravado | undefined,
): Set<string> {
  const novo = new Set(dirty);
  const igualAoServidor =
    gravado !== undefined
      ? linha.status !== null &&
        linhaFoiAlterada({ ...linha, status: linha.status }, gravado) === false
      : linha.status === null;
  if (igualAoServidor) novo.delete(linha.employeeId);
  else novo.add(linha.employeeId);
  return novo;
}
