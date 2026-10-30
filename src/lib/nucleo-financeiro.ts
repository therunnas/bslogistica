/**
 * Núcleo financeiro puro (FIN-PR-01). Espelho TypeScript das funções `public.nucleo_*` da
 * migration 035.
 *
 * NESTA ETAPA NADA USA ESTE MÓDULO. Nenhuma tela, hook, Server Action ou rota o importa, e
 * nenhum gatilho do banco chama as funções SQL equivalentes: o cálculo em vigor continua sendo o
 * de `billing.ts` e o de `derivar_valores_por_vigencia()`. A suíte `test:nucleo-isolamento`
 * prova isso. A ligação ao motor é etapa própria (FIN-PR-02), com autorização própria.
 *
 * DOIS COMPORTAMENTOS, SEPARADOS
 *
 *   - `calcularLegado010`: o motor antigo (`derivar_valores_financeiros`, migration 010), só para
 *     provar que a aritmética do núcleo reproduz o banco (100% da fixture do trigger real,
 *     `scripts/fixtures/paridade-financeira-sql.json`). Nenhuma regra nova entra aqui.
 *   - `calcularComponentesV2`: as regras confirmadas pelo cliente (FIN-DESENHO-01 R2).
 *
 * UNIDADES
 *
 *   - dinheiro: centavos inteiros (`20000` = R$ 200,00);
 *   - tempo: minutos inteiros; horários `HH:MM` (segundos são ignorados, como no banco);
 *   - fatores: centésimos inteiros (`150` = 1,5; `200` = 2);
 *   - a conta é exata, em `BigInt`. Nada passa por ponto flutuante.
 *
 * ARREDONDAMENTO MONETÁRIO: meio centavo para cima, sobre o valor exato (todos os valores são
 * não negativos). O total sem o adicional é arredondado UMA vez; a diária-base é arredondada à
 * parte e a hora extra é a diferença (`total − base`). Assim os componentes sempre somam o total.
 *
 * REGRAS V2 (confirmadas)
 *
 *   - jornada contratual: 8 h (480 min); o divisor da hora é sempre 8 h, também no sábado;
 *   - dia útil: diária proporcional na saída antecipada (com entrada e saída); HE acima de 8 h;
 *   - sábado: referência de 4 h; diária inteira até 4 h; HE acima de 4 h, inclusive no pagamento;
 *   - HE cobrada no modo diário: o excedente só conta se passar da tolerância (limiar de DESCARTE,
 *     nunca subtração) e então é arredondado por fração de hora: < 15 min = 0; 15–44 = 30;
 *     ≥ 45 = 60, preservando as horas inteiras;
 *   - modo acumulado: minutos brutos, sem tolerância e sem arredondar (o fechamento arredonda);
 *   - HE paga: minutos exatos acima da referência, depois da mesma tolerância, a
 *     `custo-hora acordado` ou `custo ÷ 8 h`, sem fator;
 *   - domingo e feriado: sem diária e sem HE; só horas × (diária ÷ 8) × fator especial. Os minutos
 *     cobrados são exatos ou arredondados como a HE (`meia_hora_15_45`); os pagos, sempre exatos;
 *   - adicional diário: soma ao total, fora da base da HE e fora do custo; vale em qualquer dia;
 *   - falta: tudo zero (adicional em falta é recusado);
 *   - presença sem horários: diária inteira no dia útil e no sábado; recusada no domingo/feriado;
 *   - presença com entrada e saída e zero minuto trabalhado: recusada;
 *   - entrada igual à saída: recusada (seria jornada de 24 h);
 *   - o tipo do dia vem de quem chama (data da folha); `cruzaMeiaNoite` só informa.
 *
 * Sem importações em tempo de execução: as suítes Node executam este arquivo direto.
 */

export const JORNADA_MINUTOS = 480;
export const SABADO_REFERENCIA_MINUTOS = 240;
/** Diária ÷ 8 h, em qualquer dia: o divisor da hora em minutos. */
export const DIVISOR_DA_HORA_MINUTOS = 480;

export type StatusDoLancamento = "present" | "replacement" | "absent";
export type TipoDoDiaDoNucleo = "util" | "sabado" | "domingo" | "feriado";
export type ModoDaHoraExtra = "diario" | "acumulado";
export type ArredondamentoEspecial = "minutos" | "meia_hora_15_45";

export type CodigoDeErroDoNucleo =
  | "parametro_invalido"
  | "falta_com_adicional"
  | "especial_sem_horarios"
  | "zero_minuto_com_horarios"
  | "entrada_igual_saida";

export class ErroDoNucleo extends Error {
  readonly codigo: CodigoDeErroDoNucleo;

  constructor(codigo: CodigoDeErroDoNucleo, mensagem: string) {
    super(`nucleo:${codigo}: ${mensagem}`);
    this.name = "ErroDoNucleo";
    this.codigo = codigo;
  }
}

export interface EntradaV2 {
  status: StatusDoLancamento;
  tipoDoDia: TipoDoDiaDoNucleo;
  entrada: string | null;
  saida: string | null;
  intervaloMinutos: number;
  diariaCentavos: number;
  fatorHeCentesimos: number;
  fatorEspecialCentesimos: number;
  toleranciaMinutos: number;
  modoHe: ModoDaHoraExtra;
  arredondamentoEspecial: ArredondamentoEspecial;
  adicionalCentavos: number;
  custoDiarioCentavos: number;
  /** Valor-hora acordado da HE paga; `null` = custo diário ÷ 8 h. */
  custoHoraHeCentavos: number | null;
}

export interface ComponentesV2 {
  minutosTrabalhados: number;
  cruzaMeiaNoite: boolean;
  heMinutosCobrados: number;
  heMinutosPagos: number;
  especialMinutosCobrados: number;
  baseCentavos: number;
  heCentavos: number;
  especialCentavos: number;
  adicionalCentavos: number;
  totalCentavos: number;
  custoBaseCentavos: number;
  custoHeCentavos: number;
  custoEspecialCentavos: number;
  custoTotalCentavos: number;
}

export interface EntradaLegado010 {
  status: StatusDoLancamento;
  entrada: string | null;
  saida: string | null;
  intervaloMinutos: number;
  /** Jornada líquida do turno da folha; 0 = sem turno (vale a jornada do contrato). */
  previstoMinutos: number;
  diariaCentavos: number;
  custoCentavos: number;
  jornadaCentesimos: number;
  fatorCentesimos: number;
  toleranciaMinutos: number;
}

export interface ResultadoLegado010 {
  minutosTrabalhados: number;
  minutosExtras: number;
  cobradoCentavos: number;
  custoCentavos: number;
}

const DENOMINADOR_V2 = 48_000n; // 480 min × 100 (centésimos de fator)

function invalido(mensagem: string): never {
  throw new ErroDoNucleo("parametro_invalido", mensagem);
}

function inteiro(valor: number, nome: string, minimo = 0): bigint {
  if (!Number.isSafeInteger(valor) || valor < minimo) {
    invalido(`${nome} deve ser inteiro maior ou igual a ${minimo}.`);
  }
  return BigInt(valor);
}

function paraNumero(valor: bigint, nome: string): number {
  const n = Number(valor);
  if (!Number.isSafeInteger(n)) invalido(`${nome} excede o inteiro seguro.`);
  return n;
}

/** Arredondamento de `numerador / denominador` (não negativos) ao inteiro, meio para cima. */
export function arredondarCentavos(numerador: bigint, denominador: bigint): bigint {
  if (numerador < 0n || denominador <= 0n) {
    invalido("arredondamento exige numerador não negativo e denominador positivo.");
  }
  return (2n * numerador + denominador) / (2n * denominador);
}

/** Minutos do dia de um horário `HH:MM` (ou `HH:MM:SS`; os segundos não contam). */
export function minutosDoHorario(horario: string): number {
  const hhmm = horario.slice(0, 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) invalido(`horário inválido: ${horario}.`);
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}

/** Arredondamento da HE do modo diário: frações < 15 min = 0; 15–44 = 30; ≥ 45 = 60. */
export function arredondarHoraExtraDiaria(minutos: number): number {
  inteiro(minutos, "minutos");
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (resto < 15) return horas * 60;
  if (resto < 45) return horas * 60 + 30;
  return (horas + 1) * 60;
}

/** Jornada líquida prevista do turno (espelha o motor antigo); vira o dia quando preciso. */
export function minutosPrevistosDoTurno(
  inicio: string,
  fim: string,
  intervaloMinutos: number,
  cruzaMeiaNoite: boolean,
): number {
  inteiro(intervaloMinutos, "intervalo");
  const i = minutosDoHorario(inicio);
  let f = minutosDoHorario(fim);
  if (cruzaMeiaNoite || f <= i) f += 1440;
  return Math.max(0, f - i - intervaloMinutos);
}

/** Minutos trabalhados (líquidos do intervalo); `null` sem entrada e saída. */
export function minutosTrabalhados(
  entrada: string | null,
  saida: string | null,
  intervaloMinutos: number,
): number | null {
  inteiro(intervaloMinutos, "intervalo");
  if (entrada === null || saida === null) return null;
  const i = minutosDoHorario(entrada);
  let f = minutosDoHorario(saida);
  if (f <= i) f += 1440;
  return Math.max(0, f - i - intervaloMinutos);
}

function validarV2(e: EntradaV2) {
  if (!["present", "replacement", "absent"].includes(e.status)) invalido("status inválido.");
  if (!["util", "sabado", "domingo", "feriado"].includes(e.tipoDoDia)) {
    invalido("tipo do dia inválido.");
  }
  if (!["diario", "acumulado"].includes(e.modoHe)) invalido("modo da HE inválido.");
  if (!["minutos", "meia_hora_15_45"].includes(e.arredondamentoEspecial)) {
    invalido("arredondamento especial inválido.");
  }
  inteiro(e.intervaloMinutos, "intervalo");
  inteiro(e.diariaCentavos, "diária");
  inteiro(e.fatorHeCentesimos, "fator da HE", 1);
  inteiro(e.fatorEspecialCentesimos, "fator especial", 1);
  inteiro(e.toleranciaMinutos, "tolerância");
  inteiro(e.adicionalCentavos, "adicional");
  inteiro(e.custoDiarioCentavos, "custo diário");
  if (e.custoHoraHeCentavos !== null) inteiro(e.custoHoraHeCentavos, "custo-hora da HE", 1);
  if (e.entrada !== null) minutosDoHorario(e.entrada);
  if (e.saida !== null) minutosDoHorario(e.saida);
}

function zerado(): ComponentesV2 {
  return {
    minutosTrabalhados: 0,
    cruzaMeiaNoite: false,
    heMinutosCobrados: 0,
    heMinutosPagos: 0,
    especialMinutosCobrados: 0,
    baseCentavos: 0,
    heCentavos: 0,
    especialCentavos: 0,
    adicionalCentavos: 0,
    totalCentavos: 0,
    custoBaseCentavos: 0,
    custoHeCentavos: 0,
    custoEspecialCentavos: 0,
    custoTotalCentavos: 0,
  };
}

/** Componentes de cobrança e de custo de um lançamento, pelas regras v2. */
export function calcularComponentesV2(e: EntradaV2): ComponentesV2 {
  validarV2(e);

  if (e.status === "absent") {
    if (e.adicionalCentavos > 0) {
      throw new ErroDoNucleo("falta_com_adicional", "falta não recebe adicional.");
    }
    return zerado();
  }

  const completos = e.entrada !== null && e.saida !== null;
  if (completos && minutosDoHorario(e.entrada!) === minutosDoHorario(e.saida!)) {
    throw new ErroDoNucleo("entrada_igual_saida", "entrada igual à saída (jornada de 24 h).");
  }
  const trabalhados = completos ? minutosTrabalhados(e.entrada, e.saida, e.intervaloMinutos)! : 0;
  const cruza = completos && minutosDoHorario(e.saida!) <= minutosDoHorario(e.entrada!);
  if (completos && trabalhados === 0) {
    throw new ErroDoNucleo(
      "zero_minuto_com_horarios",
      "presença com entrada e saída e nenhum minuto trabalhado.",
    );
  }

  const diaria = BigInt(e.diariaCentavos);
  const custo = BigInt(e.custoDiarioCentavos);
  const adicional = BigInt(e.adicionalCentavos);
  const minutos = BigInt(trabalhados);

  if (e.tipoDoDia === "domingo" || e.tipoDoDia === "feriado") {
    if (!completos) {
      throw new ErroDoNucleo("especial_sem_horarios", "domingo e feriado exigem entrada e saída.");
    }
    const cobrados =
      e.arredondamentoEspecial === "minutos" ? trabalhados : arredondarHoraExtraDiaria(trabalhados);
    const fator = BigInt(e.fatorEspecialCentesimos);
    const especial = arredondarCentavos(diaria * BigInt(cobrados) * fator, DENOMINADOR_V2);
    const custoEspecial = arredondarCentavos(custo * minutos * fator, DENOMINADOR_V2);
    return {
      ...zerado(),
      minutosTrabalhados: trabalhados,
      cruzaMeiaNoite: cruza,
      especialMinutosCobrados: cobrados,
      especialCentavos: paraNumero(especial, "especial"),
      adicionalCentavos: e.adicionalCentavos,
      totalCentavos: paraNumero(especial + adicional, "total"),
      custoEspecialCentavos: paraNumero(custoEspecial, "custo especial"),
      custoTotalCentavos: paraNumero(custoEspecial, "custo total"),
    };
  }

  const referencia = e.tipoDoDia === "sabado" ? SABADO_REFERENCIA_MINUTOS : JORNADA_MINUTOS;
  const proporcional = completos && e.tipoDoDia === "util" && trabalhados < JORNADA_MINUTOS;
  const excesso = completos ? Math.max(trabalhados - referencia, 0) : 0;
  const passaTolerancia = excesso > e.toleranciaMinutos;

  const heCobrados =
    e.modoHe === "acumulado" ? excesso : passaTolerancia ? arredondarHoraExtraDiaria(excesso) : 0;
  const hePagos = passaTolerancia ? excesso : 0;

  // Tudo sobre 48.000 (480 min × 100): base e HE no mesmo denominador.
  const baseNum = proporcional ? diaria * minutos * 100n : diaria * DENOMINADOR_V2;
  const heNum = diaria * BigInt(heCobrados) * BigInt(e.fatorHeCentesimos);
  const totalSemAdicional = arredondarCentavos(baseNum + heNum, DENOMINADOR_V2);
  const base = arredondarCentavos(baseNum, DENOMINADOR_V2);

  const custoBaseNum = proporcional ? custo * minutos * 100n : custo * DENOMINADOR_V2;
  const custoHeNum =
    e.custoHoraHeCentavos !== null
      ? BigInt(hePagos) * BigInt(e.custoHoraHeCentavos) * 800n // ÷ 60 min = × 800 ÷ 48.000
      : BigInt(hePagos) * custo * 100n; // custo ÷ 480 min
  const custoTotal = arredondarCentavos(custoBaseNum + custoHeNum, DENOMINADOR_V2);
  const custoBase = arredondarCentavos(custoBaseNum, DENOMINADOR_V2);

  return {
    minutosTrabalhados: trabalhados,
    cruzaMeiaNoite: cruza,
    heMinutosCobrados: heCobrados,
    heMinutosPagos: hePagos,
    especialMinutosCobrados: 0,
    baseCentavos: paraNumero(base, "base"),
    heCentavos: paraNumero(totalSemAdicional - base, "HE"),
    especialCentavos: 0,
    adicionalCentavos: e.adicionalCentavos,
    totalCentavos: paraNumero(totalSemAdicional + adicional, "total"),
    custoBaseCentavos: paraNumero(custoBase, "custo base"),
    custoHeCentavos: paraNumero(custoTotal - custoBase, "custo da HE"),
    custoEspecialCentavos: 0,
    custoTotalCentavos: paraNumero(custoTotal, "custo total"),
  };
}

/**
 * Motor antigo (migration 010), em aritmética exata. A jornada prevista sem turno é
 * `jornada × 60`, que pode ter fração de minuto: a conta é feita em QUINTOS de minuto
 * (jornada em centésimos de hora × 60 ÷ 100 = × 3 ÷ 5).
 */
export function calcularLegado010(e: EntradaLegado010): ResultadoLegado010 {
  if (!["present", "replacement", "absent"].includes(e.status)) invalido("status inválido.");
  inteiro(e.intervaloMinutos, "intervalo");
  inteiro(e.previstoMinutos, "previsto");
  inteiro(e.diariaCentavos, "diária");
  inteiro(e.custoCentavos, "custo");
  inteiro(e.jornadaCentesimos, "jornada");
  inteiro(e.fatorCentesimos, "fator");
  inteiro(e.toleranciaMinutos, "tolerância");

  if (e.status === "absent") {
    return { minutosTrabalhados: 0, minutosExtras: 0, cobradoCentavos: 0, custoCentavos: 0 };
  }

  const jornada = BigInt(e.jornadaCentesimos > 0 ? e.jornadaCentesimos : 800);
  const fator = BigInt(e.fatorCentesimos === 0 ? 100 : e.fatorCentesimos);
  const trabalhados = minutosTrabalhados(e.entrada, e.saida, e.intervaloMinutos) ?? 0;

  const previstoQuintos = e.previstoMinutos > 0 ? 5n * BigInt(e.previstoMinutos) : 3n * jornada; // jornada × 60 ÷ 100
  const excessoQuintos = 5n * BigInt(trabalhados) - previstoQuintos;
  const extrasQuintos = excessoQuintos > 5n * BigInt(e.toleranciaMinutos) ? excessoQuintos : 0n;

  const diaria = BigInt(e.diariaCentavos);
  const custo = BigInt(e.custoCentavos);
  const denominador = 300n * jornada;
  const cobrado = arredondarCentavos(
    diaria * denominador + extrasQuintos * diaria * fator,
    denominador,
  );
  const custoFinal = arredondarCentavos(
    custo * denominador + extrasQuintos * custo * 100n,
    denominador,
  );

  return {
    minutosTrabalhados: trabalhados,
    // Quintos nunca dão empate em meio minuto: o arredondamento comum basta.
    minutosExtras: paraNumero((2n * extrasQuintos + 5n) / 10n, "minutos extras"),
    cobradoCentavos: paraNumero(cobrado, "cobrado"),
    custoCentavos: paraNumero(custoFinal, "custo"),
  };
}
