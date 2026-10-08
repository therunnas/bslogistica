/**
 * Apresentação do Fechamento: só formatação e texto.
 *
 * Nada aqui calcula dinheiro. Cada função recebe um valor que o núcleo já
 * entregou pronto em `FechamentoData` — centavos, minutos, milésimos — e o
 * transforma em texto para a tela. A conversão de centavos para reais acontece
 * somente na hora de EXIBIR; ninguém soma, subtrai nem arredonda a partir dela.
 *
 * Tudo é puro e testável sem navegador.
 */

import { brl, dateBR, minutesToLabel, num } from "../format";
import { ANO_MAXIMO, ANO_MINIMO, primeiraQuinzena, segundaQuinzena, type Periodo } from "./periodo";
import type { Alerta, FechamentoData, LinhaColaborador, SeveridadeDoAlerta } from "./tipos";

export const NOMES_DOS_MESES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
] as const;

export type PresetDePeriodo = "primeira" | "segunda";
export type ModoDoPeriodo = PresetDePeriodo | "personalizado";

export const ROTULO_DO_MODO: Record<ModoDoPeriodo, string> = {
  primeira: "1ª quinzena",
  segunda: "2ª quinzena",
  personalizado: "Período personalizado",
};

/** As datas de um preset, vindas do calendário civil de `periodo.ts`. */
export function periodoDoPreset(ano: number, mes: number, preset: PresetDePeriodo): Periodo {
  return preset === "primeira" ? primeiraQuinzena(ano, mes) : segundaQuinzena(ano, mes);
}

/**
 * O mês corrente no fuso do Brasil, independentemente do fuso do servidor ou do
 * navegador. Só serve para sugerir o mês inicial dos filtros — nenhuma regra de
 * período depende disto.
 */
export function mesAtualNoBrasil(agora: Date): { ano: number; mes: number } {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
  const [ano, mes] = partes.split("-").map(Number);
  return { ano: ano ?? ANO_MINIMO, mes: mes ?? 1 };
}

/** Anos oferecidos no seletor: cinco para trás e um para frente, dentro do que `periodo.ts` aceita. */
export function anosParaEscolher(anoAtual: number): number[] {
  const primeiro = Math.max(ANO_MINIMO, anoAtual - 5);
  const ultimo = Math.min(ANO_MAXIMO, anoAtual + 1);
  const anos: number[] = [];
  for (let ano = ultimo; ano >= primeiro; ano -= 1) anos.push(ano);
  return anos;
}

/** Centavos do núcleo em "R$ 1.234,56". Só para exibir. */
export function moeda(centavos: number): string {
  return brl(centavos / 100);
}

/** Minutos do núcleo em "2h15". Só para exibir. */
export function horas(minutos: number): string {
  return minutesToLabel(minutos);
}

/** Milésimos do núcleo em "12,5%"; sem faturado, "—". */
export function margem(permil: number | null): string {
  if (permil === null) return "—";
  return `${num(permil / 10, 1)}%`;
}

export function rotuloDoPeriodo(inicio: string, fim: string): string {
  return `${dateBR(inicio)} a ${dateBR(fim)}`;
}

/** "16/03/2026 09:30", no fuso do Brasil, a partir do `geradoEm` da meta. */
export function rotuloDaAtualizacao(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(data);
}

export const ROTULO_DA_SEVERIDADE: Record<SeveridadeDoAlerta, string> = {
  critico: "Crítico",
  atencao: "Atenção",
  informacao: "Informativo",
};

function plural(n: number, singular: string, mais: string): string {
  return `${n} ${n === 1 ? singular : mais}`;
}

/** Texto do alerta. Descreve a ocorrência; nunca promete correção automática. */
export function textoDoAlerta(alerta: Alerta): string {
  const n = alerta.quantidade;
  const lancamentos = plural(n, "lançamento", "lançamentos");

  switch (alerta.codigo) {
    case "duplicidade":
      return `${lancamentos} em duplicidade (mesmo colaborador, operação e data). Os valores entram como estão; confira na origem.`;
    case "folha-aberta":
      return `${lancamentos} em folha ainda aberta. Os valores entram no fechamento, mas o apontamento não foi encerrado.`;
    case "dado-incompleto":
      return `${lancamentos} sem horário de entrada e saída completo ou sem horas trabalhadas.`;
    case "sem-contrato":
      return `${lancamentos} em operação sem contrato. O valor segue a regra de reserva (valor acordado da operação).`;
    case "diaria-zerada":
      return `${lancamentos} com diária de valor zero.`;
    case "falta":
      return `${plural(n, "falta", "faltas")} no período. Faltas não geram diária, custo nem faturamento.`;
  }
}

/** Colaborador cujo único registro no período é falta. */
export function ehSomenteFalta(colaborador: LinhaColaborador): boolean {
  return colaborador.faltas > 0 && colaborador.consolidado.diarias === 0;
}

export type EstadoDoResultado = "vazio" | "somente-faltas" | "com-lancamentos";

/** O que o resultado carregado significa para a tela, sem recalcular nada. */
export function estadoDoResultado(dados: FechamentoData): EstadoDoResultado {
  if (dados.consolidado.diarias > 0) return "com-lancamentos";
  return dados.faltas > 0 ? "somente-faltas" : "vazio";
}
