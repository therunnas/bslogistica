/**
 * Diária individual por colaborador + contrato e adicional diário (FIN-PR-08, migration 042).
 *
 * A diária individual é o PREÇO cobrado do cliente por um colaborador específico, com vigência. Quando
 * a resolução de tarifas está ligada ela prevalece sobre a tarifa padrão da função e do período
 * (041). O adicional diário é um valor extra, eventual (acúmulo de função), que fica FORA da base da
 * hora extra. A resolução do preço e a soma do adicional acontecem no banco; este módulo só valida o
 * formulário, monta os parâmetros das RPCs e descreve o dia para a tela. Nunca calcula preço.
 *
 * Sem importações em tempo de execução além de `./tarifas` (regras de data e de valor compartilhadas).
 */

import { dataBr, ehDataIso, lerValorDaTarifa } from "./tarifas";

export const RPC_DIARIA_INDIVIDUAL = {
  registrar: "registrar_diaria_individual",
  encerrar: "encerrar_diaria_individual",
  corrigir: "corrigir_diaria_individual",
  aposentar: "aposentar_diaria_individual",
  naData: "diaria_individual_na_data",
  bonus: "definir_bonus_do_apontamento",
} as const;

export interface DiariaIndividual {
  id: string;
  contract_id: string;
  employee_id: string;
  valid_from: string;
  valid_to: string | null;
  daily_rate: number | string;
  active: boolean;
  origin?: string;
  reason?: string;
}

/** O banco anuncia a diária individual (042)? Só `true` explícito liga. */
export function interpretarDiariaIndividual(data: unknown, erro: unknown): boolean {
  if (erro !== null && erro !== undefined) return false;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
  return (data as { diaria_individual?: unknown }).diaria_individual === true;
}

/** O banco anuncia o adicional diário (042)? Só `true` explícito liga. */
export function interpretarBonusDiario(data: unknown, erro: unknown): boolean {
  if (erro !== null && erro !== undefined) return false;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
  return (data as { bonus_diario?: unknown }).bonus_diario === true;
}

// ---------------------------------------------------------------------------
// Diária individual
// ---------------------------------------------------------------------------

export interface FormularioDeDiaria {
  contratoId: string;
  colaboradorId: string;
  inicio: string;
  /** Texto digitado; aceita vírgula decimal. Vazio NUNCA vira zero. */
  valor: string;
  motivo: string;
}

/** Duas casas decimais no máximo, como o banco (`numeric(12,2)`). */
function temMaisDeDuasCasas(texto: string): boolean {
  const t = texto.trim().replace(",", ".");
  const i = t.indexOf(".");
  return i >= 0 && t.length - i - 1 > 2;
}

/** Mensagens para o usuário; lista vazia = pode enviar. O banco revalida tudo. */
export function validarDiariaIndividual(f: FormularioDeDiaria): string[] {
  const erros: string[] = [];
  if (f.contratoId.trim() === "") erros.push("Selecione o contrato.");
  if (f.colaboradorId.trim() === "") erros.push("Selecione o colaborador.");
  if (!ehDataIso(f.inicio)) erros.push("Informe o início da vigência.");
  const valor = lerValorDaTarifa(f.valor);
  if (valor === null || valor <= 0) erros.push("Informe uma diária maior que zero.");
  else if (temMaisDeDuasCasas(f.valor))
    erros.push("A diária aceita no máximo duas casas decimais.");
  if (f.motivo.trim() === "") erros.push("O motivo é obrigatório.");
  return erros;
}

/**
 * Parâmetros nomeados de `registrar_diaria_individual`. Lança se o formulário for inválido. Mudança
 * comercial é VERSÃO NOVA: encerra a vigente (que começou antes) e abre a nova no mesmo ato.
 */
export function montarRegistroDeDiaria(
  f: FormularioDeDiaria,
): Record<string, string | number | boolean> {
  const erros = validarDiariaIndividual(f);
  if (erros.length > 0) throw new Error(erros[0]);
  return {
    p_contract_id: f.contratoId,
    p_employee_id: f.colaboradorId,
    p_valid_from: f.inicio,
    p_daily_rate: lerValorDaTarifa(f.valor) as number,
    p_reason: f.motivo.trim(),
    p_encerrar_anterior: true,
  };
}

/** A diária vigente de um colaborador numa data (espelho da regra do banco: ativa e [início, fim)). */
export function diariaNaData(
  diarias: readonly DiariaIndividual[],
  colaboradorId: string,
  data: string,
): DiariaIndividual | null {
  const candidatas = diarias.filter(
    (d) =>
      d.active &&
      d.employee_id === colaboradorId &&
      d.valid_from <= data &&
      (d.valid_to === null || data < d.valid_to),
  );
  // O banco impede sobreposição; duas candidatas = dado inconsistente, e a tela não escolhe uma.
  return candidatas.length === 1 ? (candidatas[0] as DiariaIndividual) : null;
}

export interface LinhaDeColaborador {
  colaboradorId: string;
  vigente: DiariaIndividual | null;
  /** Próxima diária já agendada (início depois da data de referência), se houver. */
  proxima: DiariaIndividual | null;
  /** Versões anteriores ou encerradas (ativas que já terminaram e aposentadas). */
  anteriores: number;
}

/**
 * Uma linha por colaborador que tem diária individual no contrato, ordenada pelo id dado (a tela
 * ordena por nome). Colaborador sem diária individual não aparece: vale a tarifa padrão.
 */
export function montarQuadroDeDiarias(
  diarias: readonly DiariaIndividual[],
  dataDeReferencia: string,
): LinhaDeColaborador[] {
  const ids = [...new Set(diarias.map((d) => d.employee_id))];
  return ids.map((colaboradorId) => {
    const doColaborador = diarias.filter((d) => d.employee_id === colaboradorId);
    const proxima =
      doColaborador
        .filter((d) => d.active && d.valid_from > dataDeReferencia)
        .sort((a, b) => a.valid_from.localeCompare(b.valid_from))[0] ?? null;
    const vigente = diariaNaData(diarias, colaboradorId, dataDeReferencia);
    return {
      colaboradorId,
      vigente,
      proxima,
      anteriores: doColaborador.filter((d) => d !== vigente && d !== proxima).length,
    };
  });
}

/** Texto da vigência de uma diária individual. */
export function rotuloDaVigenciaIndividual(
  d: Pick<DiariaIndividual, "valid_from" | "valid_to">,
): string {
  return `desde ${dataBr(d.valid_from)}${d.valid_to ? ` até ${dataBr(d.valid_to)}` : ""}`;
}

// ---------------------------------------------------------------------------
// Fonte do preço e adicional diário no apontamento
// ---------------------------------------------------------------------------

export type FonteDoPreco = "individual" | "funcao_periodo" | null;

export const ROTULO_DA_FONTE: Readonly<Record<"individual" | "funcao_periodo" | "outra", string>> =
  {
    individual: "Diária individual do colaborador",
    funcao_periodo: "Tarifa da função e do período",
    outra: "Diária do contrato ou valor acordado",
  };

/** Nome mostrado para a fonte do preço; nulo/desconhecido = a regra anterior (genérica ou acordada). */
export function rotuloDaFonte(fonte: string | null | undefined): string {
  if (fonte === "individual") return ROTULO_DA_FONTE.individual;
  if (fonte === "funcao_periodo") return ROTULO_DA_FONTE.funcao_periodo;
  return ROTULO_DA_FONTE.outra;
}

export const TEXTO_DO_BONUS =
  "Valor extra deste dia por acúmulo de função. Não aumenta o valor usado para calcular a hora extra.";

export interface ApontamentoParaBonus {
  status?: string | null;
  invoice_id?: string | null;
  calc_version?: number | null;
  additional_amount?: number | string | null;
}

export type MotivoSemBonus =
  "capacidade" | "resolucao_desligada" | "faturado" | "falta" | "regra_anterior";

/**
 * Pode definir o adicional diário neste apontamento? A ordem das recusas espelha o banco. `null` =
 * pode. Só uma pré-checagem: o banco decide.
 */
export function motivoSemBonus(
  a: ApontamentoParaBonus,
  capacidade: boolean,
  resolucaoLigada: boolean | null,
): MotivoSemBonus | null {
  if (!capacidade) return "capacidade";
  if (resolucaoLigada !== true) return "resolucao_desligada";
  if (a.invoice_id) return "faturado";
  if (a.status === "absent") return "falta";
  if (a.calc_version !== 2) return "regra_anterior";
  return null;
}

export const TEXTO_SEM_BONUS: Readonly<Record<MotivoSemBonus, string>> = {
  capacidade: "O banco ainda não tem o adicional diário.",
  resolucao_desligada:
    "O adicional diário só vale com o preço por função e período ligado (em Contratos).",
  faturado: "Apontamento já faturado não muda.",
  falta: "Falta não tem adicional.",
  regra_anterior: "Este dia segue a regra anterior (domingo, feriado ou lançamento antigo).",
};

export interface FormularioDeBonus {
  entryId: string;
  /** Texto digitado; aceita vírgula decimal. Vazio NUNCA vira zero. */
  valor: string;
  motivo: string;
}

/** Valor do adicional: zero ou mais, no máximo duas casas decimais. `0` remove o adicional. */
export function lerValorDoBonus(texto: string): number | null {
  const n = lerValorDaTarifa(texto);
  if (n === null || temMaisDeDuasCasas(texto)) return null;
  return n;
}

export function validarBonus(f: FormularioDeBonus): string[] {
  const erros: string[] = [];
  if (f.entryId.trim() === "") erros.push("Selecione o apontamento.");
  if (lerValorDoBonus(f.valor) === null)
    erros.push("Informe o valor do adicional (zero ou mais, até duas casas decimais).");
  if (f.motivo.trim() === "") erros.push("O motivo é obrigatório.");
  return erros;
}

/**
 * Parâmetros nomeados de `definir_bonus_do_apontamento`. `substituir` só vai `true` quando a pessoa
 * confirmou trocar um adicional que já existe (evita cobrar duas vezes).
 */
export function montarBonus(
  f: FormularioDeBonus,
  substituir: boolean,
): Record<string, string | number | boolean> {
  const erros = validarBonus(f);
  if (erros.length > 0) throw new Error(erros[0]);
  return {
    p_entry_id: f.entryId,
    p_amount: lerValorDoBonus(f.valor) as number,
    p_reason: f.motivo.trim(),
    p_substituir: substituir,
  };
}

export interface ApontamentoParaResumo {
  billed_special_amount?: number | string | null;
  daily_rate_snapshot?: number | string | null;
  billed_overtime_amount?: number | string | null;
  additional_amount?: number | string | null;
  billed_amount?: number | string | null;
  price_source?: string | null;
}

export interface ResumoDoDia {
  /** Diária usada como base da hora extra (a resolvida pelo banco). */
  diaria: number;
  horaExtra: number;
  especial: number;
  adicional: number;
  total: number;
  fonte: string;
}

const num = (v: number | string | null | undefined): number => Number(v ?? 0);

/** Os componentes do dia como o banco os gravou, sem recalcular nada. */
export function resumoDoDia(a: ApontamentoParaResumo): ResumoDoDia {
  return {
    diaria: num(a.daily_rate_snapshot),
    horaExtra: num(a.billed_overtime_amount),
    especial: num(a.billed_special_amount),
    adicional: num(a.additional_amount),
    total: num(a.billed_amount),
    fonte: rotuloDaFonte(a.price_source),
  };
}
