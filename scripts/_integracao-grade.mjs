/**
 * Grade sintética da integração do núcleo V2 ao motor (FIN-PR-02).
 *
 * Compartilhada pelo gerador do SQL (`gerar-sql-integracao-v2.mjs`) e pelas suítes Node. Cada caso
 * é um lançamento sintético num dos quatro tipos de dia, numa de seis configurações de contrato,
 * com um padrão de horários. Códigos sintéticos apenas (nenhum nome real).
 */

/** Dia de cada tipo (2026): segunda, sábado, domingo e uma quinta cadastrada como feriado. */
export const DIAS = [
  { dia: "util", data: "2026-03-02" },
  { dia: "sabado", data: "2026-03-07" },
  { dia: "domingo", data: "2026-03-08" },
  { dia: "feriado", data: "2026-03-05" },
];

/** Tipo do dia que o motor grava hoje (domingo é "util" para a 030 e para a 036). */
export const TIPO_GRAVADO = { util: "util", sabado: "sabado", domingo: "util", feriado: "feriado" };

/** Contratos sintéticos: tolerância, modo da HE e jornada de sábado do contrato (030). */
export const CONFIGURACOES = [
  { cfg: "A", tolerancia: 0, modo: "diario", sabado: 4 },
  { cfg: "B", tolerancia: 10, modo: "diario", sabado: 4 },
  { cfg: "C", tolerancia: 15, modo: "diario", sabado: 4 },
  { cfg: "D", tolerancia: 10, modo: "acumulado", sabado: 4 },
  { cfg: "E", tolerancia: 10, modo: "diario", sabado: null },
];

export const DIARIA_CENTAVOS = 13333;
export const CUSTO_CENTAVOS = 11111;
export const CUSTO_HORA_CENTAVOS = 2500;
export const FATOR_HE_CENTESIMOS = 150;
export const FATOR_FERIADO = 2;

const doisDigitos = (n) => String(n).padStart(2, "0");
const hhmm = (m) => `${doisDigitos(Math.floor(m / 60) % 24)}:${doisDigitos(m % 60)}`;

/** Padrões de horário: [código, status, entrada, saída, intervalo]. */
export function padroes() {
  const lista = [];
  const trabalhados = [
    0, 1, 30, 60, 180, 239, 240, 241, 255, 270, 300, 360, 433, 470, 479, 480, 490, 491, 494, 495,
    496, 500, 524, 525, 526, 539, 540, 554, 555, 560, 585, 600, 659, 720,
  ];
  for (const w of trabalhados) {
    // 06:00 + 60 min de intervalo + trabalhado
    lista.push([`w${w}`, "present", "06:00", hhmm(6 * 60 + 60 + w), 60]);
  }
  lista.push(["sem-horarios", "present", null, null, 60]);
  lista.push(["so-entrada", "present", "06:00", null, 60]);
  lista.push(["igual", "present", "06:00", "06:00", 60]);
  lista.push(["noturno-480", "present", "22:00", "07:00", 60]);
  lista.push(["noturno-500", "present", "22:00", "07:20", 60]);
  lista.push(["pausa120-480", "present", "06:00", "16:00", 120]);
  lista.push(["pausa120-495", "present", "06:00", "16:15", 120]);
  lista.push(["pausa0-480", "present", "06:00", "14:00", 0]);
  lista.push(["substituicao-495", "replacement", "06:00", "15:15", 60]);
  lista.push(["falta", "absent", null, null, 0]);
  return lista;
}

/** Todos os casos, numerados de 1 em ordem estável. */
export function gradeDeIntegracao() {
  const casos = [];
  let n = 0;
  for (const c of CONFIGURACOES) {
    // A variante com valor-hora acordado da HE só no contrato B (o custo pago muda, a cobrança não).
    const variantes = c.cfg === "B" ? [false, true] : [false];
    for (const hora of variantes) {
      for (const d of DIAS) {
        for (const [padrao, status, entrada, saida, intervalo] of padroes()) {
          n++;
          casos.push({
            n,
            cfg: c.cfg,
            tolerancia: c.tolerancia,
            modo: c.modo,
            sabado: c.sabado,
            valorHora: hora,
            dia: d.dia,
            data: d.data,
            padrao,
            status,
            entrada,
            saida,
            intervalo,
          });
        }
      }
    }
  }
  return casos;
}

/** Entrada do oráculo/núcleo V2 para um caso (útil ou sábado). */
export function entradaV2(c) {
  return {
    status: c.status,
    tipoDoDia: c.dia,
    entrada: c.entrada,
    saida: c.saida,
    intervaloMinutos: c.intervalo,
    diariaCentavos: DIARIA_CENTAVOS,
    fatorHeCentesimos: FATOR_HE_CENTESIMOS,
    fatorEspecialCentesimos: 200,
    toleranciaMinutos: c.tolerancia,
    modoHe: c.modo,
    arredondamentoEspecial: "minutos",
    adicionalCentavos: 0,
    custoDiarioCentavos: CUSTO_CENTAVOS,
    custoHoraHeCentavos: c.valorHora ? CUSTO_HORA_CENTAVOS : null,
  };
}

export const reais = (centavos) =>
  `${Math.trunc(centavos / 100)}.${String(centavos % 100).padStart(2, "0")}`;

/** Texto do resultado como a função SQL de leitura o monta: billed|cost|worked|ot|botmin|dia. */
export function textoDoResultado(r, diaGravado) {
  return [
    reais(r.totalCentavos),
    reais(r.custoTotalCentavos),
    r.minutosTrabalhados,
    r.heMinutosPagos,
    r.heMinutosCobrados,
    diaGravado,
  ].join("|");
}
