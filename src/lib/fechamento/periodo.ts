/**
 * Período do Fechamento: calendário civil, sem `Date`.
 *
 * Toda regra de data do Fechamento é sobre DATAS CIVIS (`YYYY-MM-DD`): o dia que
 * a folha registra, não um instante. `new Date("2026-03-01")` é meia-noite UTC,
 * que no fuso do Brasil é 28/02 — e é por isso que nada aqui cria `Date`. O
 * resultado é o mesmo em qualquer fuso do navegador ou do servidor.
 *
 * REGRAS
 *
 *  - 1ª quinzena: dia 1 ao 15;
 *  - 2ª quinzena: dia 16 ao ÚLTIMO dia real do mês (28, 29, 30 ou 31);
 *  - intervalo personalizado: no máximo 31 dias INCLUSIVOS nas duas pontas
 *    (01/01 a 31/01 são 31 dias e passam; 01/01 a 01/02 são 32 e não);
 *  - início posterior ao fim é recusado;
 *  - o formato é estrito: `YYYY-MM-DD`, com zeros, e a data precisa existir.
 *
 * Este módulo também é o dono do calendário: `ehDataCivil`, `ultimoDiaDoMes` e
 * os dias bissextos moram aqui, e `normalizar.ts` e `agregar.ts` os importam.
 */

import { ErroDeDadoDoFechamento } from "./erros";

/** Máximo de dias, contando início e fim, de um intervalo personalizado. */
export const MAXIMO_DE_DIAS_DO_PERIODO = 31;

/** Limites de sanidade do ano, contra erro de digitação (`0026-03-01`). */
export const ANO_MINIMO = 2000;
export const ANO_MAXIMO = 2100;

export interface Periodo {
  /** `YYYY-MM-DD`, inclusivo. */
  inicio: string;
  /** `YYYY-MM-DD`, inclusivo. */
  fim: string;
}

export type CodigoDePeriodoInvalido =
  | "formato-invalido"
  | "data-inexistente"
  | "ano-fora-do-intervalo"
  | "inicio-depois-do-fim"
  | "periodo-longo";

export type ResultadoDoPeriodo =
  | { ok: true; periodo: Periodo; dias: number }
  | { ok: false; codigo: CodigoDePeriodoInvalido; mensagem: string };

const FORMATO_DE_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

function ehBissexto(ano: number): boolean {
  return (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
}

/** Número de dias do mês (`mes` de 1 a 12). */
export function diasDoMes(ano: number, mes: number): number {
  if (mes === 2) return ehBissexto(ano) ? 29 : 28;
  return [4, 6, 9, 11].includes(mes) ? 30 : 31;
}

/** `YYYY-MM-DD` que existe no calendário (sem criar `Date`). */
export function ehDataCivil(texto: unknown): texto is string {
  if (typeof texto !== "string") return false;
  const partes = FORMATO_DE_DATA.exec(texto);
  if (partes === null) return false;
  const ano = Number(partes[1]);
  const mes = Number(partes[2]);
  const dia = Number(partes[3]);
  return mes >= 1 && mes <= 12 && dia >= 1 && dia <= diasDoMes(ano, mes);
}

function doisDigitos(n: number): string {
  return String(n).padStart(2, "0");
}

function montarData(ano: number, mes: number, dia: number): string {
  return `${String(ano).padStart(4, "0")}-${doisDigitos(mes)}-${doisDigitos(dia)}`;
}

function exigirMes(ano: number, mes: number): void {
  if (!Number.isInteger(ano) || ano < ANO_MINIMO || ano > ANO_MAXIMO) {
    throw new ErroDeDadoDoFechamento(`período: ano inválido (${String(ano)}).`);
  }
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
    throw new ErroDeDadoDoFechamento(`período: mês inválido (${String(mes)}).`);
  }
}

/** Último dia real do mês, como número (28 a 31). */
export function ultimoDiaDoMes(ano: number, mes: number): number {
  exigirMes(ano, mes);
  return diasDoMes(ano, mes);
}

/** 1ª quinzena: dia 1 ao 15. */
export function primeiraQuinzena(ano: number, mes: number): Periodo {
  exigirMes(ano, mes);
  return { inicio: montarData(ano, mes, 1), fim: montarData(ano, mes, 15) };
}

/** 2ª quinzena: dia 16 ao último dia real do mês. */
export function segundaQuinzena(ano: number, mes: number): Periodo {
  exigirMes(ano, mes);
  return { inicio: montarData(ano, mes, 16), fim: montarData(ano, mes, diasDoMes(ano, mes)) };
}

/**
 * Dias corridos desde 1970-01-01, em aritmética inteira (algoritmo de calendário
 * proléptico gregoriano). Serve para subtrair duas datas sem `Date`.
 */
function diasDesdeAEpoca(ano: number, mes: number, dia: number): number {
  const y = mes <= 2 ? ano - 1 : ano;
  const era = Math.floor(y / 400);
  const anoDaEra = y - era * 400;
  const mesDesdeMarco = (mes + 9) % 12;
  const diaDoAno = Math.floor((153 * mesDesdeMarco + 2) / 5) + dia - 1;
  const diaDaEra =
    anoDaEra * 365 + Math.floor(anoDaEra / 4) - Math.floor(anoDaEra / 100) + diaDoAno;
  return era * 146097 + diaDaEra - 719468;
}

function desmontar(data: string): [number, number, number] {
  const partes = FORMATO_DE_DATA.exec(data);
  if (partes === null) {
    throw new ErroDeDadoDoFechamento(`período: "${data}" não é uma data civil.`);
  }
  return [Number(partes[1]), Number(partes[2]), Number(partes[3])];
}

/**
 * Quantos dias o intervalo cobre, contando AS DUAS pontas: `2026-01-01` a
 * `2026-01-01` é 1; a `2026-01-31`, 31. Exige datas civis válidas; a ordem não é
 * checada aqui (o resultado fica ≤ 0 se o início vier depois do fim).
 */
export function quantidadeDiasInclusivos(inicio: string, fim: string): number {
  if (!ehDataCivil(inicio) || !ehDataCivil(fim)) {
    throw new ErroDeDadoDoFechamento("período: data civil inválida.");
  }
  const [anoInicio, mesInicio, diaInicio] = desmontar(inicio);
  const [anoFim, mesFim, diaFim] = desmontar(fim);
  return (
    diasDesdeAEpoca(anoFim, mesFim, diaFim) - diasDesdeAEpoca(anoInicio, mesInicio, diaInicio) + 1
  );
}

/**
 * Valida um período vindo de fora (URL, formulário). Devolve o resultado em vez
 * de lançar: quem chama quer a mensagem para mostrar, não uma exceção.
 */
export function validarPeriodo(inicio: unknown, fim: unknown): ResultadoDoPeriodo {
  if (
    typeof inicio !== "string" ||
    typeof fim !== "string" ||
    !FORMATO_DE_DATA.test(inicio) ||
    !FORMATO_DE_DATA.test(fim)
  ) {
    return {
      ok: false,
      codigo: "formato-invalido",
      mensagem: "As datas devem ter o formato AAAA-MM-DD.",
    };
  }

  if (!ehDataCivil(inicio) || !ehDataCivil(fim)) {
    return { ok: false, codigo: "data-inexistente", mensagem: "Uma das datas não existe." };
  }

  const anoDoInicio = Number(inicio.slice(0, 4));
  const anoDoFim = Number(fim.slice(0, 4));
  if (
    anoDoInicio < ANO_MINIMO ||
    anoDoInicio > ANO_MAXIMO ||
    anoDoFim < ANO_MINIMO ||
    anoDoFim > ANO_MAXIMO
  ) {
    return {
      ok: false,
      codigo: "ano-fora-do-intervalo",
      mensagem: `O ano deve estar entre ${ANO_MINIMO} e ${ANO_MAXIMO}.`,
    };
  }

  if (inicio > fim) {
    return {
      ok: false,
      codigo: "inicio-depois-do-fim",
      mensagem: "A data inicial não pode ser posterior à final.",
    };
  }

  const dias = quantidadeDiasInclusivos(inicio, fim);
  if (dias > MAXIMO_DE_DIAS_DO_PERIODO) {
    return {
      ok: false,
      codigo: "periodo-longo",
      mensagem: `O período pode ter no máximo ${MAXIMO_DE_DIAS_DO_PERIODO} dias.`,
    };
  }

  return { ok: true, periodo: { inicio, fim }, dias };
}

/** O mês inteiro, de `1` ao último dia: o período mensal por cliente. */
export function mesInteiro(ano: number, mes: number): Periodo {
  exigirMes(ano, mes);
  return { inicio: montarData(ano, mes, 1), fim: montarData(ano, mes, diasDoMes(ano, mes)) };
}

/** Dia da semana de uma data civil: 0 = domingo … 6 = sábado. Sem `Date`, sem fuso. */
export function diaDaSemana(data: string): number {
  if (!ehDataCivil(data)) {
    throw new ErroDeDadoDoFechamento(`período: "${data}" não é uma data civil.`);
  }
  const [ano, mes, dia] = desmontar(data);
  // 1970-01-01 (dia 0 da época) foi uma quinta-feira.
  return (((diasDesdeAEpoca(ano, mes, dia) + 4) % 7) + 7) % 7;
}

/**
 * Se o período é um período de fechamento INTEIRO: 1–15, 16–último dia ou o mês.
 * É a mesma condição que `validar_fechamento_acumulado` exige para faturar hora
 * extra com arredondamento acumulado — aqui só para avisar antes da fatura. Com a
 * migration 038, a fatura exige a competência da frequência (`ehCompetencia`).
 */
export function ehPeriodoDeFechamento(inicio: string, fim: string): boolean {
  if (!ehDataCivil(inicio) || !ehDataCivil(fim) || inicio > fim) return false;
  const [anoI, mesI, diaI] = desmontar(inicio);
  const [anoF, mesF, diaF] = desmontar(fim);
  if (anoI !== anoF || mesI !== mesF) return false;
  const ultimo = diasDoMes(anoI, mesI);
  return (
    (diaI === 1 && diaF === 15) ||
    (diaI === 16 && diaF === ultimo) ||
    (diaI === 1 && diaF === ultimo)
  );
}

/** Se o período é o mês inteiro (do dia 1 ao último dia). */
export function ehMesInteiro(inicio: string, fim: string): boolean {
  if (!ehDataCivil(inicio) || !ehDataCivil(fim) || inicio > fim) return false;
  const [anoI, mesI, diaI] = desmontar(inicio);
  const [anoF, mesF, diaF] = desmontar(fim);
  return anoI === anoF && mesI === mesF && diaI === 1 && diaF === diasDoMes(anoI, mesI);
}

/**
 * Frequência de fechamento do contrato (migration 038, `contract_terms.closing_period`). Define a
 * competência de cobrança: quinzenal = 1–15 e 16–último dia; mensal = 1–último dia.
 */
export type FrequenciaDeFechamento = "quinzenal" | "mensal";

export function ehFrequenciaDeFechamento(valor: unknown): valor is FrequenciaDeFechamento {
  return valor === "quinzenal" || valor === "mensal";
}

/**
 * O período é UMA competência inteira da frequência? Espelho de `janela_de_cobranca_valida`
 * (migration 038): é o que `gerar_fatura` aceita.
 */
export function ehCompetencia(
  frequencia: FrequenciaDeFechamento,
  inicio: string,
  fim: string,
): boolean {
  if (!ehDataCivil(inicio) || !ehDataCivil(fim) || inicio > fim) return false;
  const [anoI, mesI, diaI] = desmontar(inicio);
  const [anoF, mesF, diaF] = desmontar(fim);
  if (anoI !== anoF || mesI !== mesF) return false;
  const ultimo = diasDoMes(anoI, mesI);
  if (frequencia === "mensal") return diaI === 1 && diaF === ultimo;
  return (diaI === 1 && diaF === 15) || (diaI === 16 && diaF === ultimo);
}

/** A competência da frequência que contém a data (a mesma de `competencia_de_cobranca`). */
export function competenciaQueContem(frequencia: FrequenciaDeFechamento, data: string): Periodo {
  if (!ehDataCivil(data)) {
    throw new ErroDeDadoDoFechamento(`período: "${data}" não é uma data civil.`);
  }
  const [ano, mes, dia] = desmontar(data);
  if (frequencia === "mensal") return mesInteiro(ano, mes);
  return dia <= 15 ? primeiraQuinzena(ano, mes) : segundaQuinzena(ano, mes);
}

/** As competências do mês, em ordem: duas quinzenas ou o mês. */
export function competenciasDoMes(
  frequencia: FrequenciaDeFechamento,
  ano: number,
  mes: number,
): Periodo[] {
  return frequencia === "mensal"
    ? [mesInteiro(ano, mes)]
    : [primeiraQuinzena(ano, mes), segundaQuinzena(ano, mes)];
}
