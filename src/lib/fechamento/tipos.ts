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

export const VERSAO_DO_FECHAMENTO = 1 as const;

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
  /** Soma de `overtime_minutes`. */
  minutosExtras: number;
  /** Soma das diárias de cada lançamento (`billed − extra`), em centavos. */
  diariaCentavos: number;
  /** Soma de `GREATEST(billed − daily_rate_snapshot, 0)` por lançamento, em centavos. */
  extraCentavos: number;
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
  diariaCentavos: number;
  extraCentavos: number;
  faturadoCentavos: number;
  custoCentavos: number;
  situacaoDeFaturamento: SituacaoDeFaturamento;
  situacaoDaFolha: StatusDaFolha;
}

export type CodigoDeAlerta =
  "duplicidade" | "folha-aberta" | "dado-incompleto" | "sem-contrato" | "diaria-zerada" | "falta";

export type SeveridadeDoAlerta = "informacao" | "atencao" | "critico";

/** Alertas só sinalizam. Nunca alteram um valor nem excluem uma linha dos totais. */
export interface Alerta {
  codigo: CodigoDeAlerta;
  severidade: SeveridadeDoAlerta;
  /** Quantidade de lançamentos afetados. */
  quantidade: number;
  /** Ids dos lançamentos afetados, em ordem crescente. */
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

export interface FechamentoData {
  versao: typeof VERSAO_DO_FECHAMENTO;
  meta: MetaDoFechamento;
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
  faturadoCentavos: number;
  custoCentavos: number;
  diariaSnapshotCentavos: number;
  diariaCentavos: number;
  extraCentavos: number;
  invoiceId: string | null;
}
