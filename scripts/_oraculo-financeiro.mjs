/**
 * Oráculo financeiro de referência (FIN-PR-01).
 *
 * INDEPENDENTE dos motores: não importa `billing.ts`, nem `nucleo-financeiro.ts`, nem lê o
 * banco. Faz a conta com FRAÇÕES exatas (`BigInt`) em REAIS e em HORAS, como a regra é falada
 * ("diária ÷ 8 × 1,5 × horas"), e só no fim converte para centavos. O núcleo, ao contrário,
 * trabalha em centavos e minutos sobre um denominador fixo; as duas formas de contar precisam
 * dar o mesmo centavo.
 *
 * Dois modos, separados:
 *   - `oraculoLegado010`: o motor antigo (migration 010), validado contra a fixture do trigger
 *     real (`scripts/fixtures/paridade-financeira-sql.json`);
 *   - `oraculoV2`: as regras confirmadas pelo cliente (FIN-DESENHO-01 R2).
 *
 * Erros saem como `{ erro: "<codigo>" }`, com os mesmos códigos do núcleo.
 */

// ---------------------------------------------------------------------------
// Fração exata
// ---------------------------------------------------------------------------

function mdc(a, b) {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

export class Fracao {
  constructor(n, d = 1n) {
    n = BigInt(n);
    d = BigInt(d);
    if (d === 0n) throw new Error("denominador zero");
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = mdc(n, d) || 1n;
    this.n = n / g;
    this.d = d / g;
  }
  static de(valor) {
    return valor instanceof Fracao ? valor : new Fracao(BigInt(valor));
  }
  mais(o) {
    o = Fracao.de(o);
    return new Fracao(this.n * o.d + o.n * this.d, this.d * o.d);
  }
  menos(o) {
    o = Fracao.de(o);
    return new Fracao(this.n * o.d - o.n * this.d, this.d * o.d);
  }
  vezes(o) {
    o = Fracao.de(o);
    return new Fracao(this.n * o.n, this.d * o.d);
  }
  dividido(o) {
    o = Fracao.de(o);
    return new Fracao(this.n * o.d, this.d * o.n);
  }
  compara(o) {
    o = Fracao.de(o);
    const a = this.n * o.d;
    const b = o.n * this.d;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  /** Maior inteiro menor ou igual. */
  piso() {
    const q = this.n / this.d;
    return this.n < 0n && q * this.d !== this.n ? q - 1n : q;
  }
}

const reais = (centavos) => new Fracao(BigInt(centavos), 100n);
const fator = (centesimos) => new Fracao(BigInt(centesimos), 100n);
const horas = (minutos) => new Fracao(BigInt(minutos), 60n);

/** Reais exatos para centavos inteiros, meio centavo para cima (valores não negativos). */
function centavos(valorEmReais) {
  return Number(valorEmReais.vezes(100n).mais(new Fracao(1n, 2n)).piso());
}

// ---------------------------------------------------------------------------
// Horários
// ---------------------------------------------------------------------------

function minutosDoDia(horario) {
  const [h, m] = horario.slice(0, 5).split(":");
  return Number(h) * 60 + Number(m);
}

function duracao(entrada, saida, intervalo) {
  const ini = minutosDoDia(entrada);
  const fim = minutosDoDia(saida);
  const corrido = fim > ini ? fim - ini : fim + 24 * 60 - ini;
  return Math.max(0, corrido - intervalo);
}

// ---------------------------------------------------------------------------
// Arredondamento da HE do modo diário, por TABELA de faixas (não por comparação encadeada)
// ---------------------------------------------------------------------------

const FAIXAS_DA_FRACAO = [
  { de: 0, ate: 14, vale: 0 },
  { de: 15, ate: 44, vale: 30 },
  { de: 45, ate: 59, vale: 60 },
];

export function oraculoArredondarHe(minutos) {
  const inteiras = Math.trunc(minutos / 60);
  const fracao = minutos - inteiras * 60;
  const faixa = FAIXAS_DA_FRACAO.find((f) => fracao >= f.de && fracao <= f.ate);
  return inteiras * 60 + faixa.vale;
}

// ---------------------------------------------------------------------------
// Motor antigo (010)
// ---------------------------------------------------------------------------

/**
 * Entradas como na fixture: valores em centavos, jornada e fator em centésimos, previsto em
 * minutos (0 = sem turno). Devolve `{ trabalhados, extras, cobrado, custo }`.
 */
export function oraculoLegado010(c) {
  if (c.status === "absent") return { trabalhados: 0, extras: 0, cobrado: 0, custo: 0 };

  const jornada = fator(c.jornadaCentesimos > 0 ? c.jornadaCentesimos : 800); // em horas
  const fatorHe = fator(c.fatorCentesimos === 0 ? 100 : c.fatorCentesimos);
  const trabalhados = c.entrada && c.saida ? duracao(c.entrada, c.saida, c.intervalo) : 0;
  const previstoEmMinutos =
    c.previstoMinutos > 0 ? new Fracao(BigInt(c.previstoMinutos)) : jornada.vezes(60n);
  const excesso = new Fracao(BigInt(trabalhados)).menos(previstoEmMinutos);
  const extras = excesso.compara(BigInt(c.tolerancia)) > 0 ? excesso : new Fracao(0n);

  const diaria = reais(c.diaria);
  const custoDiario = reais(c.custo);
  const valorHora = diaria.dividido(jornada).vezes(fatorHe);
  const custoHora = custoDiario.dividido(jornada);
  const horasExtras = extras.dividido(60n);

  return {
    trabalhados,
    extras: Number(extras.mais(new Fracao(1n, 2n)).piso()),
    cobrado: centavos(diaria.mais(horasExtras.vezes(valorHora))),
    custo: centavos(custoDiario.mais(horasExtras.vezes(custoHora))),
  };
}

// ---------------------------------------------------------------------------
// Regras v2
// ---------------------------------------------------------------------------

const DIVISOR_DA_HORA = 8n; // horas: a diária vale 8 h em qualquer dia, também no sábado

/**
 * Entradas com os mesmos nomes do núcleo (`EntradaV2`). Devolve os componentes com os mesmos
 * nomes de `ComponentesV2`, ou `{ erro }`.
 */
export function oraculoV2(e) {
  if (e.status === "absent") {
    if (e.adicionalCentavos > 0) return { erro: "falta_com_adicional" };
    return componentesZerados();
  }

  const completos = Boolean(e.entrada) && Boolean(e.saida);
  if (completos && minutosDoDia(e.entrada) === minutosDoDia(e.saida)) {
    return { erro: "entrada_igual_saida" };
  }
  const trabalhados = completos ? duracao(e.entrada, e.saida, e.intervaloMinutos) : 0;
  if (completos && trabalhados === 0) return { erro: "zero_minuto_com_horarios" };
  const cruza = completos && minutosDoDia(e.saida) <= minutosDoDia(e.entrada);

  const diaria = reais(e.diariaCentavos);
  const custoDiario = reais(e.custoDiarioCentavos);
  const horaDaDiaria = diaria.dividido(DIVISOR_DA_HORA);
  const horaDoCusto = custoDiario.dividido(DIVISOR_DA_HORA);

  if (e.tipoDoDia === "domingo" || e.tipoDoDia === "feriado") {
    if (!completos) return { erro: "especial_sem_horarios" };
    const cobrados =
      e.arredondamentoEspecial === "meia_hora_15_45"
        ? oraculoArredondarHe(trabalhados)
        : trabalhados;
    const fatorEspecial = fator(e.fatorEspecialCentesimos);
    const especial = centavos(horas(cobrados).vezes(horaDaDiaria).vezes(fatorEspecial));
    const custoEspecial = centavos(horas(trabalhados).vezes(horaDoCusto).vezes(fatorEspecial));
    return {
      ...componentesZerados(),
      minutosTrabalhados: trabalhados,
      cruzaMeiaNoite: cruza,
      especialMinutosCobrados: cobrados,
      especialCentavos: especial,
      adicionalCentavos: e.adicionalCentavos,
      totalCentavos: especial + e.adicionalCentavos,
      custoEspecialCentavos: custoEspecial,
      custoTotalCentavos: custoEspecial,
    };
  }

  const referencia = e.tipoDoDia === "sabado" ? 4 * 60 : 8 * 60;
  const excesso = completos ? Math.max(0, trabalhados - referencia) : 0;
  const descartado = excesso <= e.toleranciaMinutos;

  let heCobrados;
  if (e.modoHe === "acumulado") heCobrados = excesso;
  else heCobrados = descartado ? 0 : oraculoArredondarHe(excesso);
  const hePagos = descartado ? 0 : excesso;

  // Proporcional só na saída antecipada do dia útil; o sábado paga e cobra a diária inteira.
  const fracaoDoDia =
    completos && e.tipoDoDia === "util" && trabalhados < 8 * 60
      ? new Fracao(BigInt(trabalhados), 480n)
      : new Fracao(1n);

  const baseExata = diaria.vezes(fracaoDoDia);
  const heExata = horas(heCobrados).vezes(horaDaDiaria).vezes(fator(e.fatorHeCentesimos));
  const totalSemAdicional = centavos(baseExata.mais(heExata));
  const base = centavos(baseExata);

  const custoHoraHe = e.custoHoraHeCentavos === null ? horaDoCusto : reais(e.custoHoraHeCentavos);
  const custoBaseExato = custoDiario.vezes(fracaoDoDia);
  const custoHeExato = horas(hePagos).vezes(custoHoraHe);
  const custoTotal = centavos(custoBaseExato.mais(custoHeExato));
  const custoBase = centavos(custoBaseExato);

  return {
    minutosTrabalhados: trabalhados,
    cruzaMeiaNoite: cruza,
    heMinutosCobrados: heCobrados,
    heMinutosPagos: hePagos,
    especialMinutosCobrados: 0,
    baseCentavos: base,
    heCentavos: totalSemAdicional - base,
    especialCentavos: 0,
    adicionalCentavos: e.adicionalCentavos,
    totalCentavos: totalSemAdicional + e.adicionalCentavos,
    custoBaseCentavos: custoBase,
    custoHeCentavos: custoTotal - custoBase,
    custoEspecialCentavos: 0,
    custoTotalCentavos: custoTotal,
  };
}

function componentesZerados() {
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

/** Nomes dos componentes, na ordem em que os testes e o SQL os comparam. */
export const CAMPOS_V2 = Object.keys(componentesZerados());

// ---------------------------------------------------------------------------
// Grade determinística (mesma em Node e no gerador do SQL)
// ---------------------------------------------------------------------------

function mulberry32(semente) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const doisDigitos = (n) => String(n).padStart(2, "0");
const horario = (m) => `${doisDigitos(Math.floor(m / 60))}:${doisDigitos(m % 60)}`;

/** Casos v2 sintéticos e reprodutíveis, incluindo os que o núcleo deve recusar. */
export function gradeV2(quantidade, semente) {
  const r = mulberry32(semente);
  const escolher = (lista) => lista[Math.floor(r() * lista.length)];
  const inteiroAte = (max) => Math.floor(r() * (max + 1));
  const casos = [];
  for (let i = 0; i < quantidade; i++) {
    const inicio = inteiroAte(1439);
    const semHorario = r() < 0.08;
    const soEntrada = !semHorario && r() < 0.03;
    const igual = !semHorario && !soEntrada && r() < 0.02;
    const fim = igual ? inicio : (inicio + 1 + inteiroAte(900)) % 1440;
    casos.push({
      status: escolher(["present", "present", "present", "present", "replacement", "absent"]),
      tipoDoDia: escolher(["util", "util", "util", "sabado", "domingo", "feriado"]),
      entrada: semHorario ? null : horario(inicio),
      saida: semHorario || soEntrada ? null : horario(fim),
      intervaloMinutos: escolher([0, 60, 120, inteiroAte(180)]),
      diariaCentavos: escolher([20000, 22500, 26000, 33333, inteiroAte(150000)]),
      fatorHeCentesimos: escolher([150, 150, 100, 200, 1 + inteiroAte(300)]),
      fatorEspecialCentesimos: escolher([200, 200, 150, 1 + inteiroAte(300)]),
      toleranciaMinutos: escolher([0, 10, 10, 15, inteiroAte(30)]),
      modoHe: escolher(["diario", "diario", "acumulado"]),
      arredondamentoEspecial: escolher(["minutos", "minutos", "meia_hora_15_45"]),
      adicionalCentavos: escolher([0, 0, 0, 3000, 4000, inteiroAte(10000)]),
      custoDiarioCentavos: escolher([12000, 15000, inteiroAte(80000)]),
      custoHoraHeCentavos: escolher([null, null, 2500, 1 + inteiroAte(9000)]),
    });
  }
  return casos;
}
