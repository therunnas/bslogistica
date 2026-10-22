/**
 * O que a tela de Apontamentos mostra como valor de cada linha (C05-B4.6, U3).
 *
 * Com o motor DESLIGADO nada muda: a prévia é a de sempre, calculada com as taxas atuais do
 * cadastro. Com o motor LIGADO o banco é a referência definitiva, e a tela nunca recalcula
 * um preço histórico com taxa de hoje:
 *
 *   - linha gravada e não tocada      -> os valores gravados (`banco`);
 *   - linha gravada e editada         -> prévia com o PREÇO CONGELADO do próprio apontamento;
 *   - linha nova (ou falta -> presença)-> prévia com a vigência da data trabalhada;
 *   - falta                           -> zero, sem exigir vigência;
 *   - sem vigência / legado editado   -> `indisponivel`, com o motivo, e o salvamento da linha
 *                                        fica bloqueado (o banco recusaria de qualquer modo);
 *   - motor carregando ou desconhecido-> só o que já está gravado; nunca uma prévia.
 *
 * Sem importações em tempo de execução (a suíte Node executa este arquivo): a fórmula de
 * `calcEntry()` entra por parâmetro, para que a paridade com o SQL continue num lugar só.
 */

import type { EstadoDoMotorUI } from "./vigencias-ui";

export interface RegrasDeCalculo {
  daily_rate: number;
  shift_hours: number;
  ot_factor: number;
  ot_tolerance_min: number;
}

export interface ResultadoDoCalculo {
  billedAmount: number;
  costAmount: number;
  overtimeMinutes: number;
}

export type CalcularLinha = (p: {
  regras: RegrasDeCalculo;
  custoDiario: number;
  plannedMinutes: number;
}) => ResultadoDoCalculo;

/** O que o servidor tem para a linha (colunas da 022/024 incluídas; todas anuláveis). */
export interface GravadoFinanceiro {
  status: "present" | "absent" | "replacement";
  billed_amount: number;
  cost_amount: number;
  overtime_minutes: number;
  daily_rate_snapshot: number | null;
  daily_cost_snapshot: number | null;
  shift_hours_snapshot?: number | null;
  ot_factor_snapshot?: number | null;
  ot_tolerance_snapshot?: number | null;
  planned_minutes_snapshot?: number | null;
  terms_origin?: string | null;
}

/** Condição aplicável à data trabalhada, já resolvida pela tela (ou o motivo de não haver). */
export type CondicaoDoDia =
  | { ok: true; regras: RegrasDeCalculo; custoDiario: number; origem: string }
  | { ok: false; motivo: string };

export type TipoDeValor = "banco" | "previa" | "indisponivel";

export interface ValorDaLinha {
  tipo: TipoDeValor;
  billed: number;
  cost: number;
  overtime: number;
  /** De onde vem o preço, em texto para a tela; nulo quando não se aplica. */
  origem: string | null;
  /** Aviso curto sob o valor. */
  aviso: string | null;
  /** O salvamento desta linha deve ser bloqueado na tela. */
  bloqueiaSalvar: boolean;
}

export interface EntradaDaLinha {
  estado: EstadoDoMotorUI;
  status: "present" | "absent" | "replacement";
  /** A linha existe no banco? */
  gravada: boolean;
  /** O usuário alterou a linha neste rascunho? */
  tocada: boolean;
  gravado: GravadoFinanceiro | null;
  /** Taxas atuais do cadastro e custo atual do colaborador: SÓ para o motor desligado. */
  regrasDoCadastro: RegrasDeCalculo;
  custoDoCadastro: number;
  condicaoDoDia: CondicaoDoDia | null;
  plannedMinutes: number;
  calcular: CalcularLinha;
}

export const ROTULO_DA_ORIGEM_GRAVADA: Readonly<Record<string, string>> = {
  versao: "Vigência do contrato",
  valor_acordado: "Vigência do valor acordado",
  legado: "Legado",
};

export function origemGravada(g: GravadoFinanceiro | null): string | null {
  if (!g) return null;
  if (g.terms_origin && g.terms_origin in ROTULO_DA_ORIGEM_GRAVADA) {
    return ROTULO_DA_ORIGEM_GRAVADA[g.terms_origin] ?? null;
  }
  return g.status === "absent" ? null : "Legado (sem vigência registrada)";
}

const ZERO = (extra: Partial<ValorDaLinha>): ValorDaLinha => ({
  tipo: "previa",
  billed: 0,
  cost: 0,
  overtime: 0,
  origem: null,
  aviso: null,
  bloqueiaSalvar: false,
  ...extra,
});

function doBanco(g: GravadoFinanceiro): ValorDaLinha {
  return {
    tipo: "banco",
    billed: Number(g.billed_amount) || 0,
    cost: Number(g.cost_amount) || 0,
    overtime: Number(g.overtime_minutes) || 0,
    origem: origemGravada(g),
    aviso: null,
    bloqueiaSalvar: false,
  };
}

const INDISPONIVEL = (aviso: string, bloqueiaSalvar: boolean): ValorDaLinha => ({
  tipo: "indisponivel",
  billed: 0,
  cost: 0,
  overtime: 0,
  origem: null,
  aviso,
  bloqueiaSalvar,
});

function congelado(
  g: GravadoFinanceiro,
): { regras: RegrasDeCalculo; custo: number; planned: number } | null {
  const origemOk = g.terms_origin === "versao" || g.terms_origin === "valor_acordado";
  const campos = [
    g.daily_rate_snapshot,
    g.shift_hours_snapshot,
    g.ot_factor_snapshot,
    g.ot_tolerance_snapshot,
    g.planned_minutes_snapshot,
    g.daily_cost_snapshot,
  ];
  if (!origemOk || campos.some((c) => c === null || c === undefined)) return null;
  return {
    regras: {
      daily_rate: Number(g.daily_rate_snapshot),
      shift_hours: Number(g.shift_hours_snapshot),
      ot_factor: Number(g.ot_factor_snapshot),
      ot_tolerance_min: Number(g.ot_tolerance_snapshot),
    },
    custo: Number(g.daily_cost_snapshot),
    planned: Number(g.planned_minutes_snapshot),
  };
}

export function valorDaLinha(e: EntradaDaLinha): ValorDaLinha {
  const { estado } = e;

  // Motor comprovadamente desligado: o comportamento de sempre.
  if (estado.tag === "desligado") {
    const r = e.calcular({
      regras: e.regrasDoCadastro,
      custoDiario: e.custoDoCadastro,
      plannedMinutes: e.plannedMinutes,
    });
    return {
      tipo: "previa",
      billed: r.billedAmount,
      cost: r.costAmount,
      overtime: r.overtimeMinutes,
      origem: null,
      aviso: null,
      bloqueiaSalvar: false,
    };
  }

  const semMudanca = e.gravada && !e.tocada && e.gravado !== null;

  // Estado não confirmado: só o que o banco já tem. Nunca uma prévia.
  if (estado.tag !== "ligado") {
    if (semMudanca && e.gravado) return doBanco(e.gravado);
    return INDISPONIVEL(
      estado.tag === "carregando"
        ? "Prévia indisponível: verificando o motor financeiro."
        : "Prévia indisponível: o estado do motor financeiro é desconhecido.",
      false,
    );
  }

  // Motor ligado.
  if (semMudanca && e.gravado) return doBanco(e.gravado);

  if (e.status === "absent") {
    return ZERO({ origem: origemGravada(e.gravado), aviso: "Falta: sem cobrança." });
  }

  const g = e.gravado;
  // Linha gravada e editada, ainda presença/reposição: o preço é o congelado, nunca o de hoje.
  if (e.gravada && g && g.status !== "absent") {
    const c = congelado(g);
    if (!c) {
      return INDISPONIVEL(
        "Apontamento anterior ao histórico de vigências: horário, intervalo e status só mudam depois da regularização por um administrador.",
        true,
      );
    }
    const r = e.calcular({ regras: c.regras, custoDiario: c.custo, plannedMinutes: c.planned });
    return {
      tipo: "previa",
      billed: r.billedAmount,
      cost: r.costAmount,
      overtime: r.overtimeMinutes,
      origem: origemGravada(g),
      aviso: "Prévia com o preço congelado deste apontamento.",
      bloqueiaSalvar: false,
    };
  }

  // Linha nova ou falta -> presença: vigência da data trabalhada.
  const cond = e.condicaoDoDia;
  if (!cond) return INDISPONIVEL("Consultando a vigência da data trabalhada…", true);
  if (!cond.ok) return INDISPONIVEL(cond.motivo, true);
  const r = e.calcular({
    regras: cond.regras,
    custoDiario: cond.custoDiario,
    plannedMinutes: e.plannedMinutes,
  });
  return {
    tipo: "previa",
    billed: r.billedAmount,
    cost: r.costAmount,
    overtime: r.overtimeMinutes,
    origem: cond.origem,
    aviso:
      g && g.status === "absent" ? "Voltar a presença reprecifica pela vigência da data." : null,
    bloqueiaSalvar: false,
  };
}

export function somarLinhas(valores: readonly ValorDaLinha[]) {
  return valores.reduce(
    (acc, v) => ({
      billed: acc.billed + (v.tipo === "indisponivel" ? 0 : v.billed),
      cost: acc.cost + (v.tipo === "indisponivel" ? 0 : v.cost),
      overtime: acc.overtime + (v.tipo === "indisponivel" ? 0 : v.overtime),
      indisponiveis: acc.indisponiveis + (v.tipo === "indisponivel" ? 1 : 0),
    }),
    { billed: 0, cost: 0, overtime: 0, indisponiveis: 0 },
  );
}
