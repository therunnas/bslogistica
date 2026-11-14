/**
 * QA-BS-01 · CP-07 — conferência antes de emitir a fatura.
 *
 * Funções PURAS que a confirmação de "Emitir fatura" usa para dizer o que está para ser faturado.
 * Nada aqui decide valor nem bloqueia a emissão: a autoridade é a RPC `gerar_fatura`, que fatura
 * os lançamentos sem fatura do cliente na competência QUALQUER QUE SEJA o estado do dia (aberto ou
 * fechado). A tela só avisa — a política de bloqueio depende de decisão do responsável (D4).
 */

import { mensagemDoErro, ehFalhaDeRede } from "./erros-banco";

/** O mínimo do lançamento consolidado (`LedgerRow`) que a conferência lê. */
export interface LinhaDaConferencia {
  clientId: string;
  date: string;
  invoiceId: string | null;
  timesheetId: string;
  timesheetStatus: "open" | "closed";
  operationName: string;
  shiftName: string;
}

export interface FolhaAberta {
  data: string;
  operacao: string;
  turno: string;
}

export interface ResumoDosDias {
  /** Dias do período (inclusive). */
  doPeriodo: number;
  /** Dias com algum apontamento ainda sem fatura (presença, substituição ou falta). */
  comApontamento: number;
  /** Desses, os que têm todas as folhas fechadas. */
  fechados: number;
  /** Desses, os que têm alguma folha aberta. */
  abertos: number;
  /** Dias cujos apontamentos já estão todos faturados. */
  jaFaturados: number;
  /** Dias sem nenhum apontamento do cliente: não são pendência. */
  semApontamento: number;
  /** Folhas abertas (dia, operação e turno), em ordem. */
  folhasAbertas: FolhaAberta[];
}

/** Datas civis de `inicio` a `fim`, inclusive (sem fuso: aritmética em UTC). */
function diasEntre(inicio: string, fim: string): number {
  const a = Date.UTC(+inicio.slice(0, 4), +inicio.slice(5, 7) - 1, +inicio.slice(8, 10));
  const b = Date.UTC(+fim.slice(0, 4), +fim.slice(5, 7) - 1, +fim.slice(8, 10));
  return Number.isFinite(a) && Number.isFinite(b) && b >= a
    ? Math.round((b - a) / 86_400_000) + 1
    : 0;
}

/**
 * D4: os dias da competência pelo estado do apontamento. "Aberto" é a folha que ninguém fechou
 * em Apontamentos; dia sem apontamento NÃO é pendência. A falta conta como apontamento (a folha
 * pode ser corrigida enquanto estiver aberta), mas só os lançamentos sem fatura entram em
 * "com apontamento".
 */
export function resumoDosDias(
  linhas: readonly LinhaDaConferencia[],
  clienteId: string,
  inicio: string,
  fim: string,
): ResumoDosDias {
  const doCliente = linhas.filter(
    (l) => l.clientId === clienteId && l.date >= inicio && l.date <= fim,
  );
  const pendentes = doCliente.filter((l) => l.invoiceId === null);

  const diasPendentes = new Map<string, boolean>(); // data → tem folha aberta
  const folhas = new Map<string, FolhaAberta>();
  for (const l of pendentes) {
    const aberta = l.timesheetStatus === "open";
    diasPendentes.set(l.date, (diasPendentes.get(l.date) ?? false) || aberta);
    if (aberta && !folhas.has(l.timesheetId)) {
      folhas.set(l.timesheetId, { data: l.date, operacao: l.operationName, turno: l.shiftName });
    }
  }
  const diasComAlgum = new Set(doCliente.map((l) => l.date));
  const jaFaturados = [...diasComAlgum].filter((d) => !diasPendentes.has(d)).length;
  const abertos = [...diasPendentes.values()].filter(Boolean).length;
  const doPeriodo = diasEntre(inicio, fim);

  return {
    doPeriodo,
    comApontamento: diasPendentes.size,
    fechados: diasPendentes.size - abertos,
    abertos,
    jaFaturados,
    semApontamento: Math.max(doPeriodo - diasComAlgum.size, 0),
    folhasAbertas: [...folhas.values()].sort(
      (a, b) =>
        a.data.localeCompare(b.data) ||
        a.operacao.localeCompare(b.operacao) ||
        a.turno.localeCompare(b.turno),
    ),
  };
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** "7 (6 fechados, 1 aberto)". */
export function rotuloDosDiasComApontamento(r: ResumoDosDias): string {
  if (r.comApontamento === 0) return "0";
  return `${r.comApontamento} (${plural(r.fechados, "fechado", "fechados")}, ${plural(
    r.abertos,
    "aberto",
    "abertos",
  )})`;
}

export interface FaturaEmitida {
  id: string;
  client_id: string;
  period_start: string;
  period_end: string;
  total_amount: number | string;
}

/**
 * Faturas do cliente que já cobrem parte do período. O banco aceita emitir outra para a mesma
 * competência com o que ainda não foi faturado (lançamento atrasado): é uma fatura COMPLEMENTAR,
 * e a tela precisa dizer isso para ninguém tomá-la por cobrança repetida.
 */
export function faturasQueCobremOPeriodo<T extends FaturaEmitida>(
  faturas: readonly T[],
  clienteId: string,
  inicio: string,
  fim: string,
): T[] {
  return faturas
    .filter((f) => f.client_id === clienteId && f.period_start <= fim && f.period_end >= inicio)
    .sort((a, b) => a.period_start.localeCompare(b.period_start));
}

/**
 * Falha de rede ao emitir: o pedido pode ter chegado ao banco (fatura gravada) e só a resposta se
 * perdido. A tela relê tudo e manda conferir a lista antes de tentar de novo.
 */
export const MENSAGEM_EMISSAO_SEM_CONFIRMACAO =
  "Não foi possível confirmar a emissão por falha de conexão. A tela foi atualizada: confira a lista de faturas antes de tentar de novo.";

/** P0002 na emissão: outra aba ou outro usuário faturou antes, ou não há o que faturar. */
export const MENSAGEM_NADA_A_FATURAR =
  "Nada a faturar neste período: os lançamentos já foram faturados (por outra aba ou outro usuário) ou não existem. A tela foi atualizada.";

export function mensagemDaEmissao(erro: unknown): string {
  const e =
    typeof erro === "object" && erro !== null
      ? (erro as { code?: unknown; message?: unknown })
      : {};
  const mensagem = typeof e.message === "string" ? e.message : "";
  if (ehFalhaDeRede(e, mensagem)) return MENSAGEM_EMISSAO_SEM_CONFIRMACAO;
  if (e.code === "P0002" && /nenhum lançamento faturável/i.test(mensagem)) {
    return MENSAGEM_NADA_A_FATURAR;
  }
  return mensagemDoErro(erro);
}

export interface Conferido {
  total: number;
  apontamentos: number;
  adicionais: number;
}

/**
 * O que foi conferido na confirmação × o que o banco emitiu. A fatura leva o que estava a faturar
 * NO MOMENTO da emissão; se alguém lançou, corrigiu ou cancelou algo depois da conferência, os
 * números diferem e a tela precisa dizer — nunca deixar passar em silêncio.
 */
export function divergenciaDaEmissao(
  conferido: Conferido,
  emitido: { total_amount: number | string },
): { conferido: number; emitido: number } | null {
  const emitidoCentavos = Math.round(Number(emitido.total_amount) * 100);
  const conferidoCentavos = Math.round(conferido.total * 100);
  if (!Number.isFinite(emitidoCentavos) || emitidoCentavos === conferidoCentavos) return null;
  return { conferido: conferidoCentavos / 100, emitido: emitidoCentavos / 100 };
}

/** Rótulo da presença no CSV do Faturamento (o enum do banco não vai cru para o arquivo). */
export const ROTULO_DA_PRESENCA: Readonly<Record<string, string>> = {
  present: "Presente",
  absent: "Falta",
  replacement: "Substituição",
};
