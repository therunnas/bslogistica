/**
 * Tarifas comerciais por contrato + função + período do turno + vigência (FIN-PR-07, migration 041).
 *
 * É a tarifa cobrada do CLIENTE, não o custo pago ao colaborador. A resolução do preço acontece no
 * banco (`derivar_valores_por_vigencia`), só com a resolução LIGADA, a partir dos snapshots de função
 * e período gravados no apontamento. Este módulo só valida o formulário, monta os parâmetros das RPCs
 * e monta o quadro "função × diurno/noturno" da tela; nunca calcula preço.
 *
 * Sem importações em tempo de execução: a suíte Node executa este arquivo.
 */

export const RPC_TARIFAS = {
  registrar: "registrar_tarifa_contrato",
  encerrar: "encerrar_tarifa_contrato",
  corrigir: "corrigir_tarifa_contrato",
  aposentar: "aposentar_tarifa_contrato",
  naData: "tarifa_contrato_na_data",
  resolucao: "alterar_resolucao_tarifas",
  corrigirSnapshots: "corrigir_snapshots_do_apontamento",
} as const;

export type PeriodoDaTarifa = "diurno" | "noturno";
export const PERIODOS_DA_TARIFA: readonly PeriodoDaTarifa[] = ["diurno", "noturno"];

export interface TarifaDoContrato {
  id: string;
  contract_id: string;
  job_function_id: string;
  shift_period: PeriodoDaTarifa;
  valid_from: string;
  valid_to: string | null;
  daily_rate: number | string;
  active: boolean;
  origin?: string;
  reason?: string;
}

/** O banco anuncia a 041? (`tarifas_por_funcao`), no mesmo padrão das capacidades anteriores. */
export function interpretarTarifasPorFuncao(data: unknown, erro: unknown): boolean {
  if (erro !== null && erro !== undefined) return false;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
  return (data as { tarifas_por_funcao?: unknown }).tarifas_por_funcao === true;
}

/** A resolução por função e período está LIGADA? (ligada na chave E motor por vigência ligado). */
export function interpretarResolucaoDeTarifas(data: unknown, erro: unknown): boolean {
  if (erro !== null && erro !== undefined) return false;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
  return (data as { resolucao_tarifas?: unknown }).resolucao_tarifas === true;
}

/** O banco grava os snapshots de função e período por apontamento? (`snapshots_funcao_periodo`, 040). */
export function interpretarSnapshotsDeFuncao(data: unknown, erro: unknown): boolean {
  if (erro !== null && erro !== undefined) return false;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
  return (data as { snapshots_funcao_periodo?: unknown }).snapshots_funcao_periodo === true;
}

/** `YYYY-MM-DD` real (sem criar `Date`). */
export function ehDataIso(texto: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (m === null) return false;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (mes < 1 || mes > 12 || dia < 1) return false;
  const bissexto = (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
  const dias = mes === 2 ? (bissexto ? 29 : 28) : [4, 6, 9, 11].includes(mes) ? 30 : 31;
  return dia <= dias;
}

/** Só dígitos com ponto ou vírgula decimal; "1.234,56" não é aceito de propósito. */
export function lerValorDaTarifa(texto: string): number | null {
  const t = texto.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export interface FormularioDeTarifa {
  contratoId: string;
  funcaoId: string;
  periodo: PeriodoDaTarifa | "";
  inicio: string;
  /** Texto digitado; aceita vírgula decimal. Vazio NUNCA vira zero. */
  valor: string;
  motivo: string;
}

/** Mensagens para o usuário; lista vazia = pode enviar. O banco revalida tudo. */
export function validarTarifa(f: FormularioDeTarifa): string[] {
  const erros: string[] = [];
  if (f.contratoId.trim() === "") erros.push("Selecione o contrato.");
  if (f.funcaoId.trim() === "") erros.push("Selecione a função.");
  if (f.periodo !== "diurno" && f.periodo !== "noturno") erros.push("Escolha diurno ou noturno.");
  if (!ehDataIso(f.inicio)) erros.push("Informe o início da vigência.");
  const valor = lerValorDaTarifa(f.valor);
  if (valor === null || valor <= 0) {
    erros.push("Informe uma diária maior que zero.");
  } else {
    const t = f.valor.trim().replace(",", ".");
    const i = t.indexOf(".");
    if (i >= 0 && t.length - i - 1 > 2)
      erros.push("A diária aceita no máximo duas casas decimais.");
  }
  if (f.motivo.trim() === "") erros.push("O motivo é obrigatório.");
  return erros;
}

/**
 * Parâmetros nomeados de `registrar_tarifa_contrato`. Lança se o formulário for inválido. Mudança
 * comercial é VERSÃO NOVA: encerra a vigente (que começou antes) e abre a nova no mesmo ato.
 */
export function montarRegistroDeTarifa(
  f: FormularioDeTarifa,
): Record<string, string | number | boolean> {
  const erros = validarTarifa(f);
  if (erros.length > 0) throw new Error(erros[0]);
  return {
    p_contract_id: f.contratoId,
    p_job_function_id: f.funcaoId,
    p_shift_period: f.periodo,
    p_valid_from: f.inicio,
    p_daily_rate: lerValorDaTarifa(f.valor) as number,
    p_reason: f.motivo.trim(),
    p_encerrar_anterior: true,
  };
}

/** A tarifa vigente de uma combinação numa data (espelho da regra do banco: ativa e [início, fim)). */
export function tarifaNaData(
  tarifas: readonly TarifaDoContrato[],
  funcaoId: string,
  periodo: PeriodoDaTarifa,
  data: string,
): TarifaDoContrato | null {
  const candidatas = tarifas.filter(
    (t) =>
      t.active &&
      t.job_function_id === funcaoId &&
      t.shift_period === periodo &&
      t.valid_from <= data &&
      (t.valid_to === null || data < t.valid_to),
  );
  // O banco impede sobreposição; duas candidatas = dado inconsistente, e a tela não escolhe uma.
  return candidatas.length === 1 ? (candidatas[0] as TarifaDoContrato) : null;
}

export interface CelulaDoQuadro {
  periodo: PeriodoDaTarifa;
  tarifa: TarifaDoContrato | null;
  /** Próxima tarifa já agendada (início depois da data de referência), se houver. */
  proxima: TarifaDoContrato | null;
}
export interface LinhaDoQuadro {
  funcaoId: string;
  celulas: readonly [CelulaDoQuadro, CelulaDoQuadro];
}

/**
 * O quadro "Função | Diurno | Noturno | Vigência" do contrato numa data de referência. Sem tarifa na
 * célula, `tarifa` é nulo e a tela escreve "Não configurada" (nunca zero). Diurno e noturno são
 * independentes: não se presume o mesmo preço.
 */
export function montarQuadroDeTarifas(
  tarifas: readonly TarifaDoContrato[],
  funcoesIds: readonly string[],
  dataDeReferencia: string,
): LinhaDoQuadro[] {
  const futura = (funcaoId: string, periodo: PeriodoDaTarifa) =>
    tarifas
      .filter(
        (t) =>
          t.active &&
          t.job_function_id === funcaoId &&
          t.shift_period === periodo &&
          t.valid_from > dataDeReferencia,
      )
      .sort((a, b) => a.valid_from.localeCompare(b.valid_from))[0] ?? null;
  return funcoesIds.map((funcaoId) => ({
    funcaoId,
    celulas: [
      {
        periodo: "diurno",
        tarifa: tarifaNaData(tarifas, funcaoId, "diurno", dataDeReferencia),
        proxima: futura(funcaoId, "diurno"),
      },
      {
        periodo: "noturno",
        tarifa: tarifaNaData(tarifas, funcaoId, "noturno", dataDeReferencia),
        proxima: futura(funcaoId, "noturno"),
      },
    ],
  }));
}

/**
 * As funções que o quadro mostra: as ativas do catálogo (para a tela evidenciar "Não configurada") e
 * as inativas que ainda têm tarifa vigente ou agendada (para o valor não sumir da tela).
 */
export function funcoesDoQuadro(
  tarifas: readonly TarifaDoContrato[],
  catalogo: readonly { id: string; active: boolean }[],
): string[] {
  const comTarifa = new Set(tarifas.filter((t) => t.active).map((t) => t.job_function_id));
  return catalogo.filter((f) => f.active || comTarifa.has(f.id)).map((f) => f.id);
}

/** `2026-04-01` -> `01/04/2026`. */
export function dataBr(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** Texto da vigência de uma tarifa. */
export function rotuloDaVigencia(t: Pick<TarifaDoContrato, "valid_from" | "valid_to">): string {
  return `desde ${dataBr(t.valid_from)}${t.valid_to ? ` até ${dataBr(t.valid_to)}` : ""}`;
}

export interface SnapshotsDoApontamento {
  job_function_id_snapshot?: string | null;
  shift_period_snapshot?: string | null;
  status?: string;
}

/**
 * O apontamento está pendente de classificação para a tarifa por função? Falta nunca é pendente.
 * Só vale com a resolução ligada: desligada, ninguém depende de função nem de período.
 */
export function pendenteDeClassificacao(
  a: SnapshotsDoApontamento,
  resolucaoLigada: boolean,
): { funcao: boolean; periodo: boolean } {
  if (!resolucaoLigada || a.status === "absent") return { funcao: false, periodo: false };
  return {
    funcao: (a.job_function_id_snapshot ?? null) === null,
    periodo: (a.shift_period_snapshot ?? null) === null,
  };
}
