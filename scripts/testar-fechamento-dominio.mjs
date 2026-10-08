/**
 * Testes do núcleo de domínio do Fechamento (etapa 4.2).
 *
 * COMO RODAR:
 *
 *   npm run test:fechamento-dominio
 *
 * Sem framework, Node executando os módulos TypeScript direto via
 * `--experimental-strip-types`. O hook `_resolver-ts.mjs` existe porque estes
 * módulos compartilham VALOR entre si (classes de erro, constantes), e import
 * relativo sem extensão não resolve sozinho — o mesmo motivo de
 * `test:admin-usuarios`. Sai com código diferente de zero em qualquer falha.
 *
 * O NÚCLEO É PURO: sem rede, sem banco, sem relógio. Por isso tudo aqui roda
 * sem nada de fora.
 *
 * BLOCOS
 *
 *   A. centavos             B. normalização        C. agregação
 *   D. decomposição         E. margem e horas      F. ordem determinística
 *   G. alertas              H. fixture ouro        I. forma literal
 *
 * A fixture ouro (`scripts/fixtures/fechamento-paridade.json`) traz os totais
 * esperados calculados À MÃO — nunca gerados pelo agregador. O bloco H confere
 * também os totais que `gerar_fatura` gravaria para as mesmas linhas.
 */

import { readFileSync } from "node:fs";

import { agregarFechamento } from "../src/lib/fechamento/agregar.ts";
import { detectarAlertas } from "../src/lib/fechamento/alertas.ts";
import {
  centavosDeNumeric,
  decomporLancamento,
  somarCentavos,
} from "../src/lib/fechamento/centavos.ts";
import { ErroDeDadoDoFechamento, ErroDeDadoFinanceiro } from "../src/lib/fechamento/erros.ts";
import { funcaoDe, normalizarLinha, normalizarLinhas } from "../src/lib/fechamento/normalizar.ts";
import { ehDataCivil } from "../src/lib/fechamento/periodo.ts";
import { VERSAO_DO_FECHAMENTO } from "../src/lib/fechamento/tipos.ts";
import { centesimosDeHora, margemPermil } from "../src/lib/fechamento/valores.ts";

let passou = 0;
const falhas = [];

function verificar(caso, obtido, esperado) {
  if (obtido === esperado) {
    passou++;
    console.log(`  PASS  ${caso}`);
  } else {
    falhas.push(`${caso} — esperado ${String(esperado)}, obtido ${String(obtido)}`);
    console.log(`  FAIL  ${caso} — esperado ${String(esperado)}, obtido ${String(obtido)}`);
  }
}

/** JSON com chaves ordenadas, para comparar estruturas sem depender da ordem das chaves. */
function canonico(valor) {
  if (Array.isArray(valor)) return valor.map(canonico);
  if (valor !== null && typeof valor === "object") {
    return Object.fromEntries(
      Object.keys(valor)
        .sort()
        .map((chave) => [chave, canonico(valor[chave])]),
    );
  }
  return valor;
}

function igual(caso, obtido, esperado) {
  verificar(caso, JSON.stringify(canonico(obtido)), JSON.stringify(canonico(esperado)));
}

/** Executa e devolve o erro, ou `null` se não levantou. */
function erroDe(acao) {
  try {
    acao();
    return null;
  } catch (erro) {
    return erro;
  }
}

const levantaFinanceiro = (acao) => erroDe(acao) instanceof ErroDeDadoFinanceiro;
const levantaDoFechamento = (acao) => erroDe(acao) instanceof ErroDeDadoDoFechamento;

/** Congela em profundidade: qualquer escrita no insumo levanta TypeError. */
function congelar(valor) {
  if (valor !== null && typeof valor === "object" && !Object.isFrozen(valor)) {
    Object.freeze(valor);
    for (const filho of Object.values(valor)) congelar(filho);
  }
  return valor;
}

/** Uma linha bruta (formato da leitura) com padrões razoáveis. */
function bruta(o = {}) {
  const id = o.id ?? "x-1";
  const emp = o.emp ?? "emp-1";
  const op = o.op ?? "op-1";
  return {
    id,
    employee_id: emp,
    status: o.status ?? "present",
    check_in: o.in === undefined ? "06:00:00" : o.in,
    check_out: o.out === undefined ? "15:00:00" : o.out,
    worked_minutes: "worked" in o ? o.worked : 480,
    overtime_minutes: "ot" in o ? o.ot : 0,
    invoice_id: o.inv === undefined ? null : o.inv,
    faturado: "faturado" in o ? o.faturado : "150.00",
    custo: "custo" in o ? o.custo : "90.00",
    taxa_da_diaria: "taxa" in o ? o.taxa : "150.00",
    employees:
      o.employees === undefined
        ? { id: emp, name: o.nome ?? "Fulano", role: o.role === undefined ? "Auxiliar" : o.role }
        : o.employees,
    timesheets:
      o.timesheets === undefined
        ? {
            id: `ts-${id}`,
            work_date: o.data ?? "2026-03-02",
            status: o.folha ?? "closed",
            operation_id: op,
            operations: {
              id: op,
              client_id: o.cliente ?? "cli-1",
              name: o.operacao ?? "Operação 1",
              contract_id: o.contrato === undefined ? "ctr-1" : o.contrato,
            },
            shifts: o.turno === undefined ? { id: "sh-1", name: "Manhã" } : o.turno,
          }
        : o.timesheets,
  };
}

const CONTEXTO = {
  clienteId: "cli-1",
  clienteNome: "Cliente 1",
  inicio: "2026-03-01",
  fim: "2026-03-15",
  geradoEm: "2026-03-16T12:00:00.000Z",
  assinatura: "assinatura-de-teste",
};

const fechar = (brutas, contexto = CONTEXTO) =>
  agregarFechamento(normalizarLinhas(brutas), contexto);

const ZERO = {
  diarias: 0,
  minutosExtras: 0,
  diariaCentavos: 0,
  extraCentavos: 0,
  custoCentavos: 0,
  faturadoCentavos: 0,
  resultadoCentavos: 0,
  margemPermil: null,
};

/* ================================================================== */
console.log("\nA. Centavos\n");

for (const [texto, esperado] of [
  ["0", 0],
  ["0.00", 0],
  ["0.10", 10],
  ["0.20", 20],
  ["0.30", 30],
  ["1", 100],
  ["1.2", 120],
  ["1.23", 123],
  ["150.10", 15010],
  ["120", 12000],
  ["-1.25", -125],
  ["-10.50", -1050],
  ["-0.05", -5],
  ["9999999999999.99", 999999999999999],
]) {
  verificar(`A1. "${texto}" → ${esperado}`, centavosDeNumeric(texto), esperado);
}

verificar('A2. "-0" é 0, nunca -0', Object.is(centavosDeNumeric("-0"), 0), true);
verificar('A3. "-0.00" é 0, nunca -0', Object.is(centavosDeNumeric("-0.00"), 0), true);
verificar(
  "A4. 0,10 + 0,20 = 30 centavos, exatos",
  centavosDeNumeric("0.10") + centavosDeNumeric("0.20"),
  centavosDeNumeric("0.30"),
);
verificar(
  "A5. o mesmo cálculo em ponto flutuante NÃO bate (por isso centavos inteiros)",
  0.1 + 0.2 === 0.3,
  false,
);

for (const invalido of [
  "",
  " ",
  " 1",
  "1 ",
  "1.",
  ".5",
  "1.234",
  "1.005",
  "1e3",
  "1E3",
  "NaN",
  "Infinity",
  "+1",
  "--1",
  "-",
  "1,5",
  "01",
  "00.10",
  "0x10",
  "1_000",
  "R$ 1",
  "99999999999999.99",
]) {
  verificar(
    `A6. inválido: ${JSON.stringify(invalido)}`,
    levantaFinanceiro(() => centavosDeNumeric(invalido)),
    true,
  );
}

for (const naoTexto of [1.5, 150, 0, null, undefined, {}, [], true]) {
  verificar(
    `A7. só aceita texto: ${JSON.stringify(naoTexto)} é recusado`,
    levantaFinanceiro(() => centavosDeNumeric(naoTexto)),
    true,
  );
}

verificar(
  "A8. a mensagem de erro nomeia o campo",
  String(erroDe(() => centavosDeNumeric("x", "faturado"))?.message).includes("faturado"),
  true,
);
verificar("A9. soma segura simples", somarCentavos(10, 20), 30);
verificar(
  "A10. soma que sairia do intervalo seguro levanta erro",
  levantaFinanceiro(() => somarCentavos(Number.MAX_SAFE_INTEGER, 1)),
  true,
);

/* ================================================================== */
console.log("\nB. Normalização\n");

{
  const n = normalizarLinha(
    bruta({
      id: "e-02",
      faturado: "206.25",
      custo: "112.56",
      taxa: "150.00",
      ot: 120,
      worked: 600,
    }),
  );
  verificar("B1. faturado em centavos", n.faturadoCentavos, 20625);
  verificar("B2. custo em centavos", n.custoCentavos, 11256);
  verificar("B3. taxa da diária em centavos", n.diariaSnapshotCentavos, 15000);
  verificar("B4. minutos extras inteiros", n.minutosExtras, 120);
  verificar("B5. decomposição aplicada: extra", n.extraCentavos, 5625);
  verificar("B6. decomposição aplicada: diária", n.diariaCentavos, 15000);
  verificar("B7. a data continua texto civil", n.workDate, "2026-03-02");
  verificar("B8. o cliente vem da operação", n.clienteId, "cli-1");
  verificar("B9. não carrega o documento do colaborador", "doc" in n, false);
}

verificar("B10. função nula vira Sem função", funcaoDe(null), "Sem função");
verificar("B11. função indefinida vira Sem função", funcaoDe(undefined), "Sem função");
verificar("B12. função vazia vira Sem função", funcaoDe(""), "Sem função");
verificar("B13. função só com espaços vira Sem função", funcaoDe("   \t "), "Sem função");
verificar("B14. função é aparada", funcaoDe("  Conferente "), "Conferente");
verificar(
  "B15. a função da linha usa employees.role",
  normalizarLinha(bruta({ role: null })).funcao,
  "Sem função",
);
verificar(
  "B16. turno ausente vira Sem turno",
  normalizarLinha(bruta({ turno: null })).turno,
  "Sem turno",
);
verificar("B17. turno com nome", normalizarLinha(bruta()).turno, "Manhã");
verificar(
  "B18. nome em branco vira Sem nome",
  normalizarLinha(bruta({ nome: "  " })).colaborador,
  "Sem nome",
);
verificar("B19. nome é aparado", normalizarLinha(bruta({ nome: "  Ana  " })).colaborador, "Ana");
verificar(
  "B20. contrato ausente é preservado como null",
  normalizarLinha(bruta({ contrato: null })).contractId,
  null,
);
verificar("B21. fatura preservada", normalizarLinha(bruta({ inv: "inv-9" })).invoiceId, "inv-9");
verificar(
  "B22. horário nulo é aceito",
  normalizarLinha(bruta({ in: null, out: null })).checkIn,
  null,
);

{
  const insumo = congelar(bruta({ id: "congelada" }));
  verificar(
    "B23. não escreve na linha de entrada",
    erroDe(() => normalizarLinha(insumo)),
    null,
  );
}

for (const [caso, linha] of [
  ["faturado com vírgula", bruta({ faturado: "12,3" })],
  ["faturado número em vez de texto", bruta({ faturado: 150 })],
  ["faturado nulo", bruta({ faturado: null })],
  ["faturado negativo", bruta({ faturado: "-1.00" })],
  ["custo negativo", bruta({ custo: "-0.01" })],
  ["taxa negativa", bruta({ taxa: "-5.00" })],
  ["custo com 3 casas", bruta({ custo: "1.234" })],
  ["taxa vazia", bruta({ taxa: "" })],
]) {
  verificar(
    `B24. erro financeiro: ${caso}`,
    levantaFinanceiro(() => normalizarLinha(linha)),
    true,
  );
}

for (const [caso, linha] of [
  ["minutos extras negativos", bruta({ ot: -1 })],
  ["minutos extras fracionados", bruta({ ot: 1.5 })],
  ["minutos extras em texto", bruta({ ot: "30" })],
  ["minutos extras nulos", bruta({ ot: null })],
  ["minutos trabalhados negativos", bruta({ worked: -5 })],
  ["status desconhecido", bruta({ status: "ausente" })],
  ["data que não existe (30/02)", bruta({ data: "2026-02-30" })],
  ["data sem zero (2026-3-1)", bruta({ data: "2026-3-1" })],
  ["data com hora", bruta({ data: "2026-03-01T00:00:00Z" })],
  ["hora de entrada inválida", bruta({ in: "6h" })],
  ["status da folha desconhecido", bruta({ folha: "fechada" })],
  ["colaborador ausente", bruta({ employees: null })],
  ["colaborador em array", bruta({ employees: [] })],
  ["folha ausente", bruta({ timesheets: null })],
  ["id vazio", bruta({ id: "" })],
]) {
  verificar(
    `B25. erro do fechamento: ${caso}`,
    levantaDoFechamento(() => normalizarLinha(linha)),
    true,
  );
}

verificar("B26. 29/02 de ano bissexto existe", ehDataCivil("2028-02-29"), true);
verificar("B27. 29/02 de ano comum não existe", ehDataCivil("2026-02-29"), false);
verificar("B28. 29/02 de 2100 não existe (século)", ehDataCivil("2100-02-29"), false);
verificar("B29. 29/02 de 2000 existe (século bissexto)", ehDataCivil("2000-02-29"), true);
verificar("B30. 31/04 não existe", ehDataCivil("2026-04-31"), false);
verificar("B31. mês 13 não existe", ehDataCivil("2026-13-01"), false);
verificar("B32. dia zero não existe", ehDataCivil("2026-03-00"), false);
verificar("B33. número não é data", ehDataCivil(20260301), false);

/* ================================================================== */
console.log("\nC. Agregação\n");

{
  const d = fechar([bruta({ id: "a", faturado: "206.25", custo: "112.56", ot: 120, worked: 600 })]);
  verificar("C1. versão do modelo", d.versao, VERSAO_DO_FECHAMENTO);
  verificar("C2. uma presença gera uma diária", d.consolidado.diarias, 1);
  verificar("C3. diária em centavos", d.consolidado.diariaCentavos, 15000);
  verificar("C4. extra em centavos", d.consolidado.extraCentavos, 5625);
  verificar("C5. faturado = diária + extra", d.consolidado.faturadoCentavos, 20625);
  verificar("C6. custo previsto", d.consolidado.custoCentavos, 11256);
  verificar("C7. resultado = faturado − custo", d.consolidado.resultadoCentavos, 9369);
  verificar("C8. minutos extras", d.consolidado.minutosExtras, 120);
  verificar("C9. sem fatura é a faturar", d.aFaturar.diarias, 1);
  verificar("C10. e não é já faturado", d.jaFaturado.diarias, 0);
  verificar("C11. detalhe: situação a faturar", d.detalhes[0].situacaoDeFaturamento, "aFaturar");
}
{
  const d = fechar([
    bruta({ id: "a" }),
    bruta({
      id: "b",
      status: "absent",
      in: null,
      out: null,
      worked: 0,
      faturado: "0.00",
      custo: "0.00",
    }),
  ]);
  verificar("C12. falta não gera diária", d.consolidado.diarias, 1);
  verificar("C13. falta não gera faturamento", d.consolidado.faturadoCentavos, 15000);
  verificar("C14. falta não gera custo", d.consolidado.custoCentavos, 9000);
  verificar("C15. falta é contada como informação", d.faltas, 1);
  verificar("C16. falta não vira linha do detalhe", d.detalhes.length, 1);
  verificar("C17. falta conta nas linhas lidas", d.meta.linhasLidas, 2);
  verificar("C18. falta por colaborador", d.colaboradores[0].faltas, 1);
}
{
  const d = fechar([
    bruta({
      id: "a",
      emp: "emp-1",
      nome: "Só falta",
      status: "absent",
      in: null,
      out: null,
      worked: 0,
      faturado: "0.00",
      custo: "0.00",
    }),
  ]);
  verificar("C19. quem só tem falta aparece, com valores zerados", d.colaboradores.length, 1);
  igual("C20. valores zerados, margem nula", d.colaboradores[0].consolidado, ZERO);
  verificar("C21. e a falta contada", d.colaboradores[0].faltas, 1);
  verificar("C22. nenhuma diária simulada no total", d.consolidado.diarias, 0);
}
{
  const d = fechar([
    bruta({ id: "a", emp: "emp-1", nome: "Titular" }),
    bruta({ id: "b", emp: "emp-2", nome: "Substituto", status: "replacement" }),
  ]);
  verificar("C23. substituto conta como diária", d.consolidado.diarias, 2);
  verificar("C24. substituição contada", d.substituicoes, 1);
  verificar(
    "C25. a substituição fica no substituto",
    d.colaboradores.find((c) => c.nome === "Substituto")?.substituicoes,
    1,
  );
  verificar(
    "C26. o titular não ganha substituição",
    d.colaboradores.find((c) => c.nome === "Titular")?.substituicoes,
    0,
  );
  verificar(
    "C27. o detalhe guarda o status do substituto",
    d.detalhes.find((l) => l.employeeId === "emp-2")?.status,
    "replacement",
  );
}
{
  const d = fechar([
    bruta({ id: "a", inv: null, faturado: "100.00", custo: "60.00", taxa: "100.00" }),
    bruta({
      id: "b",
      inv: "inv-1",
      faturado: "50.00",
      custo: "20.00",
      taxa: "50.00",
      data: "2026-03-03",
    }),
  ]);
  verificar("C28. a faturar: faturado", d.aFaturar.faturadoCentavos, 10000);
  verificar("C29. já faturado: faturado", d.jaFaturado.faturadoCentavos, 5000);
  verificar("C30. consolidado = a faturar + já faturado", d.consolidado.faturadoCentavos, 15000);
  verificar("C31. consolidado: custo", d.consolidado.custoCentavos, 8000);
  verificar("C32. consolidado: diárias", d.consolidado.diarias, 2);
  verificar("C33. a faturar: custo", d.aFaturar.custoCentavos, 6000);
  verificar("C34. já faturado: custo", d.jaFaturado.custoCentavos, 2000);
  verificar(
    "C35. colaborador tem os três grupos",
    [
      d.colaboradores[0].consolidado.diarias,
      d.colaboradores[0].aFaturar.diarias,
      d.colaboradores[0].jaFaturado.diarias,
    ].join(","),
    "2,1,1",
  );
  verificar(
    "C36. detalhe já faturado",
    d.detalhes.find((l) => l.entryId === "b")?.situacaoDeFaturamento,
    "jaFaturado",
  );
}
{
  const d = fechar([
    bruta({
      id: "a",
      emp: "emp-1",
      nome: "Ana",
      faturado: "100.00",
      custo: "50.00",
      taxa: "100.00",
    }),
    bruta({
      id: "b",
      emp: "emp-2",
      nome: "Bia",
      faturado: "200.00",
      custo: "80.00",
      taxa: "200.00",
    }),
    bruta({
      id: "c",
      emp: "emp-1",
      nome: "Ana",
      faturado: "100.00",
      custo: "50.00",
      taxa: "100.00",
      data: "2026-03-03",
    }),
  ]);
  verificar("C37. dois colaboradores", d.colaboradores.length, 2);
  verificar("C38. Ana: duas diárias", d.colaboradores[0].consolidado.diarias, 2);
  verificar("C39. Ana: faturado somado", d.colaboradores[0].consolidado.faturadoCentavos, 20000);
  verificar("C40. Bia: uma diária", d.colaboradores[1].consolidado.diarias, 1);
  verificar("C41. total é a soma dos colaboradores", d.consolidado.faturadoCentavos, 40000);
}
{
  const d = fechar([
    bruta({ id: "a", faturado: "0.10", custo: "0.05", taxa: "0.10" }),
    bruta({ id: "b", faturado: "0.20", custo: "0.05", taxa: "0.20", data: "2026-03-03" }),
  ]);
  verificar("C42. 0,10 + 0,20 somam exatos 30 centavos", d.consolidado.faturadoCentavos, 30);
  verificar("C43. e o custo 10 centavos", d.consolidado.custoCentavos, 10);
}
{
  const d = fechar([]);
  igual("C44. sem lançamentos: tudo zerado", d.consolidado, ZERO);
  verificar("C45. sem lançamentos: sem colaboradores", d.colaboradores.length, 0);
  verificar("C46. sem lançamentos: sem alertas", d.alertas.length, 0);
  verificar("C47. sem lançamentos: nenhuma linha lida", d.meta.linhasLidas, 0);
}
{
  const d = fechar([bruta({ id: "a" })]);
  verificar("C48. meta: cliente", d.meta.clienteId, "cli-1");
  verificar("C49. meta: nome do cliente", d.meta.clienteNome, "Cliente 1");
  verificar("C50. meta: início", d.meta.inicio, "2026-03-01");
  verificar("C51. meta: fim", d.meta.fim, "2026-03-15");
  verificar(
    "C52. meta: geradoEm vem do contexto, não do relógio",
    d.meta.geradoEm,
    "2026-03-16T12:00:00.000Z",
  );
  verificar("C52a. meta: a assinatura vem do contexto", d.meta.assinatura, "assinatura-de-teste");
}

verificar(
  "C53. linha de outro cliente falha o carregamento",
  levantaDoFechamento(() => fechar([bruta({ id: "a", cliente: "cli-outro" })])),
  true,
);
verificar(
  "C54. linha antes do período falha",
  levantaDoFechamento(() => fechar([bruta({ id: "a", data: "2026-02-28" })])),
  true,
);
verificar(
  "C55. linha depois do período falha",
  levantaDoFechamento(() => fechar([bruta({ id: "a", data: "2026-03-16" })])),
  true,
);
verificar(
  "C56. as pontas do período são inclusivas",
  erroDe(() =>
    fechar([bruta({ id: "a", data: "2026-03-01" }), bruta({ id: "b", data: "2026-03-15" })]),
  ),
  null,
);
verificar(
  "C57. lançamento repetido na entrada falha",
  levantaDoFechamento(() => fechar([bruta({ id: "a" }), bruta({ id: "a", emp: "emp-2" })])),
  true,
);
verificar(
  "C58. início depois do fim falha",
  levantaDoFechamento(() => fechar([], { ...CONTEXTO, inicio: "2026-03-10", fim: "2026-03-01" })),
  true,
);
verificar(
  "C59. data de contexto inexistente falha",
  levantaDoFechamento(() => fechar([], { ...CONTEXTO, fim: "2026-02-30" })),
  true,
);
verificar(
  "C60. cliente de contexto vazio falha",
  levantaDoFechamento(() => fechar([], { ...CONTEXTO, clienteId: "" })),
  true,
);

/* ================================================================== */
console.log("\nD. Decomposição diária / hora extra\n");

igual(
  "D1. faturado 15000, taxa 12000 → diária 12000, extra 3000",
  decomporLancamento(15000, 12000),
  {
    diariaCentavos: 12000,
    extraCentavos: 3000,
  },
);
igual("D2. faturado = taxa → sem extra", decomporLancamento(12000, 12000), {
  diariaCentavos: 12000,
  extraCentavos: 0,
});
igual(
  "D3. faturado menor que a taxa → sem extra, diária = faturado",
  decomporLancamento(10000, 15000),
  {
    diariaCentavos: 10000,
    extraCentavos: 0,
  },
);
igual("D4. faturado zero", decomporLancamento(0, 15000), { diariaCentavos: 0, extraCentavos: 0 });
igual("D5. taxa zero → tudo é extra", decomporLancamento(500, 0), {
  diariaCentavos: 0,
  extraCentavos: 500,
});
{
  // GREATEST da soma NÃO é a soma dos GREATEST. A regra é por linha.
  const d = fechar([
    bruta({ id: "a", faturado: "1.00", taxa: "1.50", custo: "0.50" }),
    bruta({ id: "b", faturado: "2.00", taxa: "1.50", custo: "0.50", data: "2026-03-03" }),
  ]);
  verificar("D6. extra é a soma dos extras por linha (0 + 50)", d.consolidado.extraCentavos, 50);
  verificar(
    "D7. decompor depois de somar daria outro número (300 − 300 → 0)",
    Math.max(d.consolidado.faturadoCentavos - 300, 0),
    0,
  );
  verificar("D8. diária = faturado − extra, ainda por linha", d.consolidado.diariaCentavos, 250);
}
{
  // ot_hour_rate_snapshot está arredondado a 2 casas; o extra NÃO vem dele.
  const n = normalizarLinha(bruta({ faturado: "171.09", taxa: "150.00", ot: 45 }));
  verificar(
    "D9. extra de 45 min vem da subtração (21,09), não de minutos × taxa",
    n.extraCentavos,
    2109,
  );
}

/* ================================================================== */
console.log("\nE. Margem e horas\n");

verificar("E1. margem positiva: 10000 faturado, 8750 custo → 125‰", margemPermil(10000, 8750), 125);
verificar(
  "E2. margem negativa: 10000 faturado, 12000 custo → −200‰",
  margemPermil(10000, 12000),
  -200,
);
verificar("E3. margem zero: faturado = custo", margemPermil(10000, 10000), 0);
verificar("E4. faturado zero → null, nunca divide por zero", margemPermil(0, 8000), null);
verificar("E5. faturado zero e custo zero → null", margemPermil(0, 0), null);
verificar("E6. custo zero → 1000‰", margemPermil(10000, 0), 1000);
verificar("E7. meio ponto positivo arredonda para cima (+0,5‰ → 1)", margemPermil(2000, 1999), 1);
verificar(
  "E8. meio ponto negativo arredonda para longe de zero (−0,5‰ → −1)",
  margemPermil(2000, 2001),
  -1,
);
verificar("E9. abaixo do meio ponto (1/3 → 333)", margemPermil(3, 2), 333);
verificar("E10. abaixo do meio ponto negativo (−1/3 → −333)", margemPermil(3, 4), -333);
verificar("E11. acima do meio ponto (2/3 → 667)", margemPermil(3, 1), 667);
verificar("E12. valores grandes não perdem precisão", margemPermil(999999999999, 1), 1000);
verificar(
  "E13. prejuízo total: custo é o dobro do faturado → −1000‰",
  margemPermil(5000, 10000),
  -1000,
);
verificar(
  "E14. faturado negativo é erro",
  levantaFinanceiro(() => margemPermil(-1, 0)),
  true,
);
verificar(
  "E15. entrada fracionada é erro",
  levantaFinanceiro(() => margemPermil(1.5, 0)),
  true,
);
{
  const d = fechar([bruta({ id: "a", faturado: "0.00", custo: "80.00", taxa: "0.00" })]);
  verificar("E16. faturado zero com custo: margem nula", d.consolidado.margemPermil, null);
  verificar("E17. e o resultado é o prejuízo", d.consolidado.resultadoCentavos, -8000);
}
{
  const d = fechar([bruta({ id: "a", faturado: "100.00", custo: "120.00", taxa: "100.00" })]);
  verificar("E18. margem negativa no relatório", d.consolidado.margemPermil, -200);
}

for (const [minutos, esperado] of [
  [0, 0],
  [1, 2],
  [2, 3],
  [3, 5],
  [7, 12],
  [30, 50],
  [45, 75],
  [60, 100],
  [90, 150],
  [135, 225],
  [165, 275],
  [600, 1000],
]) {
  verificar(
    `E19. ${minutos} min → ${esperado} centésimos de hora`,
    centesimosDeHora(minutos),
    esperado,
  );
}
verificar("E20. horas: 90 min → 1,50 h", centesimosDeHora(90) / 100, 1.5);
verificar("E21. horas: 135 min → 2,25 h", centesimosDeHora(135) / 100, 2.25);
verificar("E22. horas: 1 min → 0,02 h", centesimosDeHora(1) / 100, 0.02);
verificar(
  "E23. arredondar o total, não cada linha: 1+1 min dá 3, e não 2+2",
  centesimosDeHora(2),
  3,
);
for (const invalido of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "60", null]) {
  verificar(
    `E24. minutos inválidos: ${String(invalido)}`,
    levantaFinanceiro(() => centesimosDeHora(invalido)),
    true,
  );
}

/* ================================================================== */
console.log("\nF. Ordem determinística\n");

{
  const base = [
    bruta({ id: "e-1", emp: "emp-b", nome: "Bruno", data: "2026-03-03", operacao: "Beta" }),
    bruta({ id: "e-2", emp: "emp-a", nome: "Ana", data: "2026-03-03", operacao: "Beta" }),
    bruta({ id: "e-3", emp: "emp-a", nome: "Ana", data: "2026-03-02", operacao: "Beta" }),
    bruta({ id: "e-4", emp: "emp-c", nome: "Álvaro", data: "2026-03-03", operacao: "Alfa" }),
    bruta({ id: "e-5", emp: "emp-d", nome: "Ana", data: "2026-03-03", operacao: "Beta" }),
    bruta({
      id: "e-6",
      emp: "emp-a",
      nome: "Ana",
      data: "2026-03-03",
      operacao: "Alfa",
      op: "op-2",
    }),
    bruta({
      id: "e-7",
      emp: "emp-e",
      nome: "ana",
      data: "2026-03-05",
      operacao: "Beta",
      inv: "inv-1",
    }),
  ];
  const referencia = JSON.stringify(canonico(fechar(base)));
  const permutacoes = [
    [...base].reverse(),
    [...base.slice(3), ...base.slice(0, 3)],
    [base[4], base[0], base[6], base[2], base[1], base[5], base[3]],
    [base[6], base[5], base[4], base[3], base[2], base[1], base[0]],
  ];
  permutacoes.forEach((permutacao, i) => {
    verificar(
      `F${i + 1}. a ordem de entrada não muda o resultado (permutação ${i + 1})`,
      JSON.stringify(canonico(fechar(permutacao))),
      referencia,
    );
  });
  // A ordem das LISTAS também é parte do contrato, e não só o conjunto.
  const ordenada = fechar([...base].reverse());
  verificar(
    "F5. colaboradores: nome pt-BR, acento ignorado na comparação, desempate por id",
    ordenada.colaboradores.map((c) => c.employeeId).join(","),
    "emp-c,emp-a,emp-d,emp-e,emp-b",
  );
  verificar(
    "F6. detalhes: data, colaborador, operação, id",
    ordenada.detalhes.map((l) => l.entryId).join(","),
    "e-3,e-4,e-6,e-2,e-5,e-1,e-7",
  );
}

/* ================================================================== */
console.log("\nG. Alertas\n");

{
  const linhas = normalizarLinhas([
    bruta({ id: "a", folha: "open" }),
    bruta({ id: "b", emp: "emp-2", folha: "closed" }),
  ]);
  const a = detectarAlertas(linhas);
  igual("G1. folha aberta", a, [
    { codigo: "folha-aberta", severidade: "atencao", quantidade: 1, entryIds: ["a"] },
  ]);
}
{
  const a = detectarAlertas(
    normalizarLinhas([
      bruta({ id: "a", in: null, out: null, worked: 0 }),
      bruta({ id: "b", emp: "emp-2", in: "06:00:00", out: null, worked: 480 }),
      bruta({ id: "c", emp: "emp-3", worked: 0 }),
      bruta({ id: "d", emp: "emp-4" }),
    ]),
  );
  igual("G2. dado incompleto: sem horário ou sem minutos trabalhados", a, [
    { codigo: "dado-incompleto", severidade: "atencao", quantidade: 3, entryIds: ["a", "b", "c"] },
  ]);
}
{
  const a = detectarAlertas(
    normalizarLinhas([bruta({ id: "a", contrato: null }), bruta({ id: "b", emp: "emp-2" })]),
  );
  igual("G3. operação sem contrato", a, [
    { codigo: "sem-contrato", severidade: "atencao", quantidade: 1, entryIds: ["a"] },
  ]);
}
{
  const a = detectarAlertas(normalizarLinhas([bruta({ id: "a", taxa: "0.00", faturado: "0.00" })]));
  igual("G4. diária zerada", a, [
    { codigo: "diaria-zerada", severidade: "atencao", quantidade: 1, entryIds: ["a"] },
  ]);
}
{
  const a = detectarAlertas(
    normalizarLinhas([
      bruta({
        id: "b",
        status: "absent",
        in: null,
        out: null,
        worked: 0,
        faturado: "0.00",
        custo: "0.00",
      }),
      bruta({
        id: "a",
        emp: "emp-2",
        status: "absent",
        in: null,
        out: null,
        worked: 0,
        faturado: "0.00",
        custo: "0.00",
      }),
    ]),
  );
  igual("G5. falta é só informação, com ids em ordem", a, [
    { codigo: "falta", severidade: "informacao", quantidade: 2, entryIds: ["a", "b"] },
  ]);
}
{
  const a = detectarAlertas(
    normalizarLinhas([
      bruta({ id: "a" }),
      bruta({ id: "b", status: "replacement" }),
      bruta({ id: "c", emp: "emp-2" }),
    ]),
  );
  igual("G6. duplicidade: mesmo colaborador, operação e data (ambas as linhas)", a, [
    { codigo: "duplicidade", severidade: "critico", quantidade: 2, entryIds: ["a", "b"] },
  ]);
}
{
  const a = detectarAlertas(
    normalizarLinhas([
      bruta({ id: "a" }),
      bruta({
        id: "b",
        status: "absent",
        in: null,
        out: null,
        worked: 0,
        faturado: "0.00",
        custo: "0.00",
      }),
    ]),
  );
  verificar(
    "G7. presença e falta no mesmo dia não são duplicidade",
    a.some((x) => x.codigo === "duplicidade"),
    false,
  );
}
{
  const a = detectarAlertas(
    normalizarLinhas([bruta({ id: "a" }), bruta({ id: "b", op: "op-2", operacao: "Outra" })]),
  );
  verificar(
    "G8. mesma pessoa e dia em operações diferentes não é duplicidade",
    a.some((x) => x.codigo === "duplicidade"),
    false,
  );
}
{
  const a = detectarAlertas(
    normalizarLinhas([
      bruta({
        id: "a",
        status: "absent",
        in: null,
        out: null,
        worked: 0,
        faturado: "0.00",
        custo: "0.00",
        folha: "open",
        contrato: null,
        taxa: "0.00",
      }),
    ]),
  );
  igual("G9. falta em folha aberta e sem contrato só gera o alerta de falta", a, [
    { codigo: "falta", severidade: "informacao", quantidade: 1, entryIds: ["a"] },
  ]);
}
{
  const a = detectarAlertas(
    normalizarLinhas([
      bruta({
        id: "z-falta",
        emp: "emp-9",
        status: "absent",
        in: null,
        out: null,
        worked: 0,
        faturado: "0.00",
        custo: "0.00",
      }),
      bruta({ id: "d1", emp: "emp-1" }),
      bruta({ id: "d2", emp: "emp-1" }),
      bruta({
        id: "f",
        emp: "emp-2",
        folha: "open",
        contrato: null,
        in: null,
        out: null,
        worked: 0,
        taxa: "0.00",
        faturado: "0.00",
      }),
    ]),
  );
  verificar(
    "G10. ordem fixa dos alertas",
    a.map((x) => x.codigo).join(","),
    "duplicidade,folha-aberta,dado-incompleto,sem-contrato,diaria-zerada,falta",
  );
}
verificar(
  "G11. linhas limpas não geram alerta",
  detectarAlertas(normalizarLinhas([bruta({ id: "a" })])).length,
  0,
);
{
  // Alertas só sinalizam: os totais são idênticos com e sem condições de alerta.
  const sujo = fechar([
    bruta({ id: "a", folha: "open", contrato: null, in: null, out: null, worked: 0 }),
    bruta({
      id: "b",
      emp: "emp-2",
      status: "absent",
      in: null,
      out: null,
      worked: 0,
      faturado: "0.00",
      custo: "0.00",
    }),
  ]);
  const limpo = fechar([
    bruta({ id: "a" }),
    bruta({
      id: "b",
      emp: "emp-2",
      status: "absent",
      in: null,
      out: null,
      worked: 0,
      faturado: "0.00",
      custo: "0.00",
    }),
  ]);
  igual("G12. alertas não alteram nenhum valor", sujo.consolidado, limpo.consolidado);
  verificar("G13. nem tiram a linha do detalhe", sujo.detalhes.length, limpo.detalhes.length);
}
{
  const entrada = congelar(
    normalizarLinhas([bruta({ id: "a", folha: "open" }), bruta({ id: "b", emp: "emp-2" })]),
  );
  verificar(
    "G14. detectar alertas não escreve nas linhas",
    erroDe(() => detectarAlertas(entrada)),
    null,
  );
}

/* ================================================================== */
console.log("\nH. Fixture ouro\n");

const ouro = JSON.parse(
  readFileSync(new URL("./fixtures/fechamento-paridade.json", import.meta.url), "utf8"),
);
const esperado = ouro.esperado;
{
  const entrada = congelar(structuredClone(ouro.linhas));
  const d = agregarFechamento(normalizarLinhas(entrada), ouro.contexto);

  verificar("H1. a fixture tem 12 linhas", ouro.linhas.length, 12);
  verificar("H2. linhas lidas", d.meta.linhasLidas, esperado.linhasLidas);
  verificar("H3. faltas", d.faltas, esperado.faltas);
  verificar("H4. substituições", d.substituicoes, esperado.substituicoes);
  igual("H5. consolidado", d.consolidado, esperado.consolidado);
  igual("H6. a faturar", d.aFaturar, esperado.aFaturar);
  igual("H7. já faturado", d.jaFaturado, esperado.jaFaturado);
  verificar(
    "H8. ordem dos colaboradores",
    d.colaboradores.map((c) => c.employeeId).join(","),
    esperado.ordemDosColaboradores.join(","),
  );
  verificar(
    "H9. ordem do detalhe",
    d.detalhes.map((l) => l.entryId).join(","),
    esperado.ordemDosDetalhes.join(","),
  );
  igual("H10. alertas", d.alertas, esperado.alertas);
  verificar("H11. o detalhe só tem lançamentos que geram valor", d.detalhes.length, 10);

  for (const c of d.colaboradores) {
    const e = esperado.colaboradores[c.employeeId];
    verificar(`H12. ${c.employeeId}: nome`, c.nome, e.nome);
    verificar(`H13. ${c.employeeId}: função`, c.funcao, e.funcao);
    verificar(`H14. ${c.employeeId}: faltas`, c.faltas, e.faltas);
    verificar(`H15. ${c.employeeId}: substituições`, c.substituicoes, e.substituicoes);
    igual(`H16. ${c.employeeId}: consolidado`, c.consolidado, e.consolidado);
    igual(`H17. ${c.employeeId}: a faturar`, c.aFaturar, e.aFaturar);
    igual(`H18. ${c.employeeId}: já faturado`, c.jaFaturado, e.jaFaturado);
  }
  verificar(
    "H19. todos os colaboradores esperados existem",
    Object.keys(esperado.colaboradores).length,
    d.colaboradores.length,
  );

  // Invariantes que valem para QUALQUER entrada.
  const campos = [
    "diarias",
    "minutosExtras",
    "diariaCentavos",
    "extraCentavos",
    "custoCentavos",
    "faturadoCentavos",
    "resultadoCentavos",
  ];
  for (const campo of campos) {
    verificar(
      `H20. consolidado = a faturar + já faturado (${campo})`,
      d.consolidado[campo],
      d.aFaturar[campo] + d.jaFaturado[campo],
    );
    verificar(
      `H21. consolidado = soma dos colaboradores (${campo})`,
      d.consolidado[campo],
      d.colaboradores.reduce((s, c) => s + c.consolidado[campo], 0),
    );
  }
  verificar(
    "H22. faturado = diária + extra",
    d.consolidado.faturadoCentavos,
    d.consolidado.diariaCentavos + d.consolidado.extraCentavos,
  );
  verificar(
    "H23. soma do detalhe = faturado",
    d.detalhes.reduce((s, l) => s + l.faturadoCentavos, 0),
    d.consolidado.faturadoCentavos,
  );
  verificar(
    "H24. soma do detalhe = custo",
    d.detalhes.reduce((s, l) => s + l.custoCentavos, 0),
    d.consolidado.custoCentavos,
  );
  verificar(
    "H25. detalhe a faturar = bloco a faturar",
    d.detalhes
      .filter((l) => l.situacaoDeFaturamento === "aFaturar")
      .reduce((s, l) => s + l.faturadoCentavos, 0),
    d.aFaturar.faturadoCentavos,
  );
  verificar("H26. diárias = linhas do detalhe", d.detalhes.length, d.consolidado.diarias);

  const moeda = JSON.stringify(d);
  verificar("H27. nenhum documento pessoal no modelo", /"doc"/.test(moeda), false);
  verificar(
    "H28. todo valor monetário e de tempo é inteiro seguro",
    [
      d.consolidado,
      d.aFaturar,
      d.jaFaturado,
      ...d.colaboradores.flatMap((c) => [c.consolidado, c.aFaturar, c.jaFaturado]),
    ].every(
      (v) =>
        campos.every((campo) => Number.isSafeInteger(v[campo])) &&
        (v.margemPermil === null || Number.isSafeInteger(v.margemPermil)),
    ),
    true,
  );
  igual(
    "H29. o mesmo insumo dá o mesmo resultado",
    agregarFechamento(normalizarLinhas(structuredClone(ouro.linhas)), ouro.contexto),
    d,
  );
}
{
  // O que gerar_fatura gravaria sobre as linhas elegíveis (migration 009, passo 5).
  const d = agregarFechamento(normalizarLinhas(structuredClone(ouro.linhas)), ouro.contexto);
  const dinheiro = (c) => `${Math.trunc(c / 100)}.${String(c % 100).padStart(2, "0")}`;
  const horas = (m) => {
    const c = centesimosDeHora(m);
    return `${Math.trunc(c / 100)}.${String(c % 100).padStart(2, "0")}`;
  };
  const g = esperado.gerarFatura;
  verificar("H30. total_dailies = diárias a faturar", d.aFaturar.diarias, g.total_dailies);
  verificar(
    "H31. total_overtime = round(sum(overtime_minutes)/60, 2)",
    horas(d.aFaturar.minutosExtras),
    g.total_overtime,
  );
  verificar(
    "H32. total_amount = sum(billed_amount)",
    dinheiro(d.aFaturar.faturadoCentavos),
    g.total_amount,
  );
  verificar("H33. total_cost = sum(cost_amount)", dinheiro(d.aFaturar.custoCentavos), g.total_cost);
  verificar(
    "H34. horas a faturar em centésimos",
    centesimosDeHora(d.aFaturar.minutosExtras),
    esperado.horasExtrasEmCentesimos.aFaturar,
  );
  verificar(
    "H35. horas já faturadas em centésimos",
    centesimosDeHora(d.jaFaturado.minutosExtras),
    esperado.horasExtrasEmCentesimos.jaFaturado,
  );
  verificar(
    "H36. horas consolidadas em centésimos",
    centesimosDeHora(d.consolidado.minutosExtras),
    esperado.horasExtrasEmCentesimos.consolidado,
  );
}

/* ================================================================== */
console.log("\nI. Forma literal do núcleo\n");

const semComentarios = (fonte) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const fontes = Object.fromEntries(
  ["centavos", "valores", "normalizar", "agregar", "alertas", "tipos", "erros", "periodo"].map(
    (nome) => [
      nome,
      semComentarios(
        readFileSync(new URL(`../src/lib/fechamento/${nome}.ts`, import.meta.url), "utf8"),
      ),
    ],
  ),
);
const nucleo = Object.values(fontes).join("\n");

verificar("I1. sem parseFloat no núcleo", /parseFloat/.test(nucleo), false);
verificar("I2. sem toFixed no núcleo", /\.toFixed\s*\(/.test(nucleo), false);
verificar("I3. sem Math.round no núcleo", /Math\.round\s*\(/.test(nucleo), false);
verificar(
  "I4. sem Date no núcleo (data civil é texto)",
  /\bnew Date\b|Date\.now|Date\.parse/.test(nucleo),
  false,
);
verificar(
  "I5. sem rede, banco ou cliente Supabase",
  /fetch\s*\(|supabase|createClient|process\.env/i.test(nucleo),
  false,
);
verificar(
  "I6. não importa o cálculo financeiro antigo",
  /from\s+"[^"]*(billing|ledger|queries|mutations)"/.test(nucleo),
  false,
);
verificar(
  "I7. não carrega documento pessoal",
  /\bdoc\b/.test(fontes.tipos) || /\bdoc\b/.test(fontes.normalizar),
  false,
);
verificar("I8. nenhum from(...) do Supabase no núcleo", /\.from\s*\(/.test(nucleo), false);
verificar("I9. nenhum Math.random no núcleo", /Math\.random/.test(nucleo), false);
verificar(
  "I10. a margem usa BigInt, não ponto flutuante",
  /BigInt/.test(fontes.valores) && !/\/\s*faturado/.test(fontes.valores),
  true,
);

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);

if (falhas.length > 0) {
  for (const falha of falhas) console.log(`  FALHA  ${falha}`);
  process.exit(1);
}
