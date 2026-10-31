/**
 * Componentes do valor cobrado de UM lançamento (FIN-PR-03). Fonte única para os leitores em
 * TypeScript (Fechamento, ledger, Faturamento); o espelho SQL é `componentes_do_lancamento()`
 * (migration 037), usado por `gerar_fatura` e pelo ajuste do acumulado.
 *
 * CONTRATO
 *
 *   calc_version = 2 (núcleo V2, migration 036): os quatro componentes vêm do banco e são a
 *   verdade. Nada é derivado. Componente ausente, negativo, especial junto de diária/HE, ou soma
 *   diferente do cobrado é ERRO (`ErroDeComponentes`), nunca um valor "consertado".
 *
 *   calc_version nulo (legado, 030 ou anterior; também domingo e feriado até o PR 09): a regra de
 *   sempre, `extra = max(cobrado − diária, 0)` e `diária = cobrado − extra`, sem horas especiais.
 *   Um adicional diferente de zero num lançamento legado é erro: o legado não tem adicional.
 *
 *   Falta: tudo zero.
 *
 * Tudo em CENTAVOS inteiros. Sem importações em tempo de execução: as suítes Node executam este
 * arquivo direto.
 */

export class ErroDeComponentes extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDeComponentes";
  }
}

export interface LancamentoParaComponentes {
  /** Identificação para a mensagem de erro. */
  rotulo: string;
  status: string;
  cobradoCentavos: number;
  diariaSnapshotCentavos: number;
  /** `undefined` = banco sem a 036 (a coluna não foi lida); `null` = lançamento legado. */
  calcVersion: number | null | undefined;
  baseCentavos?: number | null | undefined;
  extraCentavos?: number | null | undefined;
  especialCentavos?: number | null | undefined;
  adicionalCentavos?: number | null | undefined;
}

export interface ComponentesEmCentavos {
  diariaCentavos: number;
  extraCentavos: number;
  especialCentavos: number;
  adicionalCentavos: number;
}

const ZERO: ComponentesEmCentavos = {
  diariaCentavos: 0,
  extraCentavos: 0,
  especialCentavos: 0,
  adicionalCentavos: 0,
};

function inteiroNaoNegativo(valor: unknown, campo: string, rotulo: string): number {
  if (typeof valor !== "number" || !Number.isSafeInteger(valor) || valor < 0) {
    throw new ErroDeComponentes(`${rotulo}: ${campo} ausente ou inválido no lançamento V2.`);
  }
  return valor;
}

/** Os componentes do lançamento, pelo contrato acima. */
export function componentesDoLancamento(l: LancamentoParaComponentes): ComponentesEmCentavos {
  if (l.status === "absent") return ZERO;

  if (l.calcVersion === 2) {
    const diaria = inteiroNaoNegativo(l.baseCentavos, "diária-base", l.rotulo);
    const extra = inteiroNaoNegativo(l.extraCentavos, "hora extra", l.rotulo);
    const especial = inteiroNaoNegativo(l.especialCentavos, "horas especiais", l.rotulo);
    const adicional = inteiroNaoNegativo(l.adicionalCentavos, "adicional", l.rotulo);
    if (diaria + extra + especial + adicional !== l.cobradoCentavos) {
      throw new ErroDeComponentes(
        `${l.rotulo}: os componentes (${diaria} + ${extra} + ${especial} + ${adicional}) não somam o cobrado (${l.cobradoCentavos}).`,
      );
    }
    if (especial > 0 && (diaria > 0 || extra > 0)) {
      throw new ErroDeComponentes(
        `${l.rotulo}: horas especiais junto de diária ou hora extra no mesmo lançamento.`,
      );
    }
    return {
      diariaCentavos: diaria,
      extraCentavos: extra,
      especialCentavos: especial,
      adicionalCentavos: adicional,
    };
  }

  if (l.calcVersion !== null && l.calcVersion !== undefined) {
    throw new ErroDeComponentes(`${l.rotulo}: versão de cálculo desconhecida (${l.calcVersion}).`);
  }
  if (
    l.adicionalCentavos !== null &&
    l.adicionalCentavos !== undefined &&
    l.adicionalCentavos !== 0
  ) {
    throw new ErroDeComponentes(`${l.rotulo}: lançamento legado com adicional diário.`);
  }
  const extra = Math.max(l.cobradoCentavos - l.diariaSnapshotCentavos, 0);
  return {
    diariaCentavos: l.cobradoCentavos - extra,
    extraCentavos: extra,
    especialCentavos: 0,
    adicionalCentavos: 0,
  };
}

/** Reais (número do PostgREST) para centavos inteiros; nulo e indefinido passam como estão. */
export function centavosDeReais(
  valor: number | string | null | undefined,
): number | null | undefined {
  if (valor === null || valor === undefined) return valor;
  const n = Number(valor);
  if (!Number.isFinite(n)) return Number.NaN;
  return Math.round(Number((n * 100).toPrecision(15)));
}
