/**
 * O modelo único do Fechamento.
 *
 * `FechamentoData` é a ÚNICA coisa que tela, CSV e XLSX consomem. Nenhum deles
 * soma, subtrai, arredonda nem decide regra: diária, extra, custo, faturado,
 * resultado, margem e contagens saem prontos do núcleo (`agregar.ts`). Este
 * arquivo só descreve a forma — não contém lógica.
 *
 * ESCALAS
 *
 *  - dinheiro: **centavos inteiros** (`15010` = R$ 150,10);
 *  - tempo: **minutos inteiros**;
 *  - margem: **milésimos** (`margemPermil`, `125` = 12,5%), `null` sem faturado;
 *  - datas: `YYYY-MM-DD`, data civil, nunca `Date`.
 *
 * Horas decimais (para exibir "2,25 h") e percentuais são apresentação: saem
 * de `minutosExtras` e `margemPermil` por funções de `valores.ts`, na borda.
 */

export const VERSAO_DO_FECHAMENTO = 2 as const;

/** Tipo do dia congelado no apontamento (`day_kind_snapshot`). `null` = anterior à 030 ou falta. */
export type TipoDoDia = "util" | "sabado" | "feriado";

export const ROTULO_DO_TIPO_DO_DIA: Record<TipoDoDia, string> = {
  util: "Dia comum",
  sabado: "Sábado",
  feriado: "Feriado",
};

export type StatusDoLancamento = "present" | "absent" | "replacement";
export type StatusDaFolha = "open" | "closed";
export type SituacaoDeFaturamento = "aFaturar" | "jaFaturado";

/** Textos fixos do domínio, num lugar só para tela, CSV e XLSX não divergirem. */
export const SEM_FUNCAO = "Sem função";
export const SEM_TURNO = "Sem turno";
export const SEM_NOME = "Sem nome";

export const ROTULO_DO_STATUS: Record<Exclude<StatusDoLancamento, "absent">, string> = {
  present: "Presente",
  replacement: "Substituto",
};

export const ROTULO_DA_SITUACAO_DE_FATURAMENTO: Record<SituacaoDeFaturamento, string> = {
  aFaturar: "A faturar",
  jaFaturado: "Já faturado",
};

export const ROTULO_DA_FOLHA: Record<StatusDaFolha, string> = {
  open: "Aberta",
  closed: "Fechada",
};

/** Uma coluna de agregados financeiros. O mesmo tipo vale para qualquer recorte. */
export interface Valores {
  /** Lançamentos que não são falta: `present` e `replacement`. */
  diarias: number;
  /** Soma de `overtime_minutes`: o excedente exato, base do CUSTO (pagamento). */
  minutosExtras: number;
  /**
   * Soma dos minutos de hora extra COBRADOS (`billed_overtime_minutes`, já arredondados no modo
   * diário; brutos no modo acumulado). Apontamento anterior à 030 (`NULL`) usa `overtime_minutes`,
   * a regra que a cobrança seguia então — a mesma que `gerar_fatura` aplica.
   */
  minutosExtrasCobrados: number;
  /**
   * Soma das diárias, em centavos. V2 (`calc_version = 2`): o componente gravado
   * `billed_base_amount`. Legado: `billed − extra` (ver `componentes-financeiros.ts`).
   */
  diariaCentavos: number;
  /**
   * Soma das horas extras, em centavos. V2: `billed_overtime_amount`. Legado:
   * `GREATEST(billed − daily_rate_snapshot, 0)` por lançamento.
   */
  extraCentavos: number;
  /** Soma das horas especiais de domingo/feriado (V2, PR 09), em centavos. Zero no legado. */
  especialCentavos: number;
  /** Soma do adicional diário (PR 08), em centavos. Zero no legado. Não é `billing_additionals`. */
  adicionalDiarioCentavos: number;
  /** Soma de `cost_amount` (custo previsto = valor devido), em centavos. */
  custoCentavos: number;
  /** Soma de `billed_amount`, em centavos. */
  faturadoCentavos: number;
  /** `faturadoCentavos − custoCentavos`. */
  resultadoCentavos: number;
  /** `(faturado − custo) / faturado`, em milésimos, meio-para-longe-de-zero. `null` se faturado = 0. */
  margemPermil: number | null;
}

export interface LinhaColaborador {
  employeeId: string;
  nome: string;
  /** `employees.role`, ou `SEM_FUNCAO` quando vazia. */
  funcao: string;
  consolidado: Valores;
  aFaturar: Valores;
  jaFaturado: Valores;
  /**
   * Ajuste do arredondamento acumulado ainda sem fatura (previsto), em centavos. Vem de
   * `ajustes_de_arredondamento_acumulado`; `0` fora do modo acumulado. Não entra em `Valores`.
   */
  ajusteAcumuladoCentavos: number;
  /** Lançamentos `absent`. Só informação: não geram valor. */
  faltas: number;
  /** Lançamentos `replacement`. Não afirma quem foi substituído. */
  substituicoes: number;
}

/** Uma linha financeira: só lançamentos que não são falta. */
export interface LinhaDetalhe {
  entryId: string;
  workDate: string;
  employeeId: string;
  colaborador: string;
  funcao: string;
  operationId: string;
  operacao: string;
  /** `shifts.name`, ou `SEM_TURNO`. */
  turno: string;
  status: Exclude<StatusDoLancamento, "absent">;
  minutosTrabalhados: number;
  minutosExtras: number;
  minutosExtrasCobrados: number;
  /** Tipo do dia congelado na precificação; `null` em apontamento anterior à 030. */
  tipoDoDia: TipoDoDia | null;
  diariaCentavos: number;
  extraCentavos: number;
  faturadoCentavos: number;
  custoCentavos: number;
  situacaoDeFaturamento: SituacaoDeFaturamento;
  situacaoDaFolha: StatusDaFolha;
}

export type CodigoDeAlerta =
  | "duplicidade"
  | "divergencia-conciliacao"
  | "folha-aberta"
  | "dado-incompleto"
  | "sem-contrato"
  | "diaria-zerada"
  | "hora-extra-acumulada-tardia"
  | "periodo-fora-de-fechamento"
  | "previa-por-quinzena"
  | "feriado-cobranca-pendente"
  | "domingo-regra-pendente"
  | "compensacao-informativa"
  | "falta";

export type SeveridadeDoAlerta = "informacao" | "atencao" | "critico";

/** Alertas só sinalizam. Nunca alteram um valor nem excluem uma linha dos totais. */
export interface Alerta {
  codigo: CodigoDeAlerta;
  severidade: SeveridadeDoAlerta;
  /** Quantidade de lançamentos afetados (ou, nos alertas do conjunto, de itens afetados). */
  quantidade: number;
  /** Ids dos lançamentos afetados, em ordem crescente. Vazio nos alertas do conjunto. */
  entryIds: string[];
}

export interface MetaDoFechamento {
  clienteId: string;
  clienteNome: string;
  /** `YYYY-MM-DD`, inclusivo. */
  inicio: string;
  /** `YYYY-MM-DD`, inclusivo. */
  fim: string;
  /** ISO-8601, injetado por quem carrega (o núcleo não lê o relógio). */
  geradoEm: string;
  /** Todos os lançamentos lidos do recorte, faltas inclusive. */
  linhasLidas: number;
  /** SHA-256 do snapshot financeiro (`assinatura.ts`): conferência de frescor do XLSX. */
  assinatura: string;
}

// ---------------------------------------------------------------------------
// O que vem do BANCO além dos lançamentos (migration 030). Nada abaixo é recalculado em
// TypeScript: são os números das funções oficiais, convertidos para centavos e minutos.

/** Uma linha de `ajustes_de_arredondamento_acumulado`: por colaborador e valor-hora. */
export interface AjusteAcumulado {
  employeeId: string;
  colaborador: string;
  valorHoraCentavos: number;
  minutosBrutos: number;
  minutosArredondados: number;
  valorBrutoCentavos: number;
  valorArredondadoCentavos: number;
  ajusteCentavos: number;
}

/** Item `arredondamento` de uma fatura já emitida dentro do período. */
export interface AjusteFaturado {
  faturaId: string;
  descricao: string;
  valorCentavos: number;
}

/** Adicional de serviço não cancelado, com o período inteiro dentro do filtro. */
export interface AdicionalDoFechamento {
  id: string;
  descricao: string;
  referencia: string | null;
  operacaoId: string | null;
  inicio: string;
  fim: string;
  valorCentavos: number;
  /** `null` = ainda sem fatura. */
  faturaId: string | null;
}

/** Linha de `saldo_de_horas_do_periodo`. INFORMATIVO: não altera nenhum valor. */
export interface SaldoDeHoras {
  employeeId: string;
  colaborador: string;
  apontamentos: number;
  minutosExcedentes: number;
  minutosFaltantes: number;
  saldoMinutos: number;
}

/** A linha de `resumo_financeiro_periodo`, em centavos. */
export interface ResumoDoBanco {
  receitaApontamentosCentavos: number;
  adicionaisCentavos: number;
  ajusteFaturadoCentavos: number;
  ajustePrevistoCentavos: number;
  receitaTotalCentavos: number;
  aFaturarCentavos: number;
  /** Total das faturas com o período inteiro dentro do filtro. */
  faturadoCentavos: number;
  ajusteAplicavel: boolean;
}

/** Tudo que o carregamento lê do banco além dos lançamentos. Entrada de `agregarFechamento`. */
export interface DadosDoBanco {
  resumo: ResumoDoBanco;
  ajustesPrevistos: AjusteAcumulado[];
  ajustesFaturados: AjusteFaturado[];
  adicionais: AdicionalDoFechamento[];
  saldoDeHoras: SaldoDeHoras[];
}

/**
 * A composição financeira do Fechamento: PREVISTO (sem fatura), FATURADO (em fatura) e AJUSTES.
 * Cada parcela é uma soma de valores já persistidos ou devolvidos pelo banco.
 */
export interface Financeiro {
  /** Σ cobrado nos lançamentos de presença e substituição. */
  apontamentosCentavos: number;
  adicionaisCentavos: number;
  /** Arredondamento acumulado já dentro de uma fatura emitida. */
  ajusteFaturadoCentavos: number;
  /** Arredondamento acumulado do período, ainda sem fatura (o que a fatura vai trazer). */
  ajustePrevistoCentavos: number;
  /** Ajuste de arredondamento total: faturado + previsto. */
  ajusteCentavos: number;
  /** apontamentos + adicionais + ajustes. */
  receitaCentavos: number;
  /** Custo previsto (valor devido) dos lançamentos. Adicionais e ajustes não têm custo. */
  custoCentavos: number;
  resultadoCentavos: number;
  margemPermil: number | null;
  /** Lançamentos sem fatura + adicionais sem fatura + ajuste previsto. */
  aFaturarCentavos: number;
  /** Lançamentos faturados + adicionais faturados + ajuste faturado. */
  jaFaturadoCentavos: number;
}

export type CodigoDeConciliacao =
  "apontamentos" | "adicionais" | "ajuste-faturado" | "ajuste-previsto" | "a-faturar" | "faturado";

/** Uma comparação entre o Fechamento e `resumo_financeiro_periodo`. Nunca é "corrigida". */
export interface ItemDeConciliacao {
  codigo: CodigoDeConciliacao;
  fechamentoCentavos: number;
  bancoCentavos: number;
  confere: boolean;
}

export interface FechamentoData {
  versao: typeof VERSAO_DO_FECHAMENTO;
  meta: MetaDoFechamento;
  financeiro: Financeiro;
  conciliacao: ItemDeConciliacao[];
  /** Adicionais de serviço do período (não cancelados). */
  adicionais: AdicionalDoFechamento[];
  /** Detalhe do arredondamento acumulado previsto (período exato do Fechamento). */
  ajustesAcumulados: AjusteAcumulado[];
  /** Itens de arredondamento de faturas já emitidas no período. */
  ajustesFaturados: AjusteFaturado[];
  /** Informativo (compensação entre dias): não altera nenhum total. */
  saldoDeHoras: SaldoDeHoras[];
  /** `aFaturar` + `jaFaturado`. */
  consolidado: Valores;
  /** Lançamentos sem fatura (`invoice_id` nulo): o que `gerar_fatura` produziria. */
  aFaturar: Valores;
  /** Lançamentos com fatura. */
  jaFaturado: Valores;
  /** Total de faltas do recorte. */
  faltas: number;
  /** Total de substituições do recorte. */
  substituicoes: number;
  /** Ordem: nome (pt-BR), desempate por `employeeId`. */
  colaboradores: LinhaColaborador[];
  /** Ordem: data, colaborador, operação, `entryId`. */
  detalhes: LinhaDetalhe[];
  alertas: Alerta[];
}

/**
 * Um lançamento depois da normalização: só tipos seguros, dinheiro em centavos,
 * a decomposição diária/extra já aplicada e os textos já resolvidos
 * (`funcao`, `turno`). É a entrada de `agregar.ts` e `alertas.ts`.
 *
 * Não carrega o documento do colaborador.
 */
export interface LinhaNormalizada {
  entryId: string;
  employeeId: string;
  colaborador: string;
  funcao: string;
  clienteId: string;
  operationId: string;
  operacao: string;
  /** `operations.contract_id`; só para sinalizar regra contratual incompleta. */
  contractId: string | null;
  turno: string;
  workDate: string;
  status: StatusDoLancamento;
  situacaoDaFolha: StatusDaFolha;
  checkIn: string | null;
  checkOut: string | null;
  minutosTrabalhados: number;
  minutosExtras: number;
  /** `billed_overtime_minutes`, ou `overtime_minutes` quando o apontamento é anterior à 030. */
  minutosExtrasCobrados: number;
  /** `billed_overtime_minutes` nulo: precificado antes da 030, sem arredondamento de cobrança. */
  anteriorA030: boolean;
  tipoDoDia: TipoDoDia | null;
  faturadoCentavos: number;
  custoCentavos: number;
  diariaSnapshotCentavos: number;
  diariaCentavos: number;
  extraCentavos: number;
  /** Horas especiais de domingo/feriado (V2, PR 09). Zero no legado e até lá. */
  especialCentavos: number;
  /** Adicional diário (PR 08). Zero no legado e até lá. Não é `billing_additionals`. */
  adicionalDiarioCentavos: number;
  /** `calc_version`: 2 = núcleo V2; `null` = legado (030 ou anterior, ou banco sem a 036). */
  versaoDoCalculo: 2 | null;
  invoiceId: string | null;
}
