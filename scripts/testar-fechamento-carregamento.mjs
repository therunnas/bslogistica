/**
 * Testes do período, da assinatura, do carregamento e da API do Fechamento
 * (etapa 4.3).
 *
 * COMO RODAR:
 *
 *   npm run test:fechamento-carregamento
 *
 * Sem framework, Node executando o TypeScript via `--experimental-strip-types`,
 * com o hook `_resolver-ts.mjs` (estes módulos compartilham valor entre si).
 * Sai com código diferente de zero em qualquer falha.
 *
 * BLOCOS
 *
 *   P. período (calendário civil, fuso do host)    A. assinatura SHA-256
 *   C. carregamento, com fontes e relógio falsos    H. decisões HTTP e acesso
 *   R. forma literal do Route Handler               S. elo SQL × fixture ouro
 *
 * O Route Handler em si precisa do Next e de sessão; o que ele DECIDE mora em
 * `src/lib/fechamento/http.ts`, exercitado aqui por comportamento. O handler é
 * conferido por forma literal, como as demais telas e rotas do projeto. A
 * consulta contra um banco real foi validada no spike da etapa 4.1, e a paridade
 * com `gerar_fatura` roda na suíte SQL local `014_paridade_fechamento.sql`.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { assinarFechamento, serializarParaAssinatura } from "../src/lib/fechamento/assinatura.ts";
import { carregarFechamento, validarFiltros } from "../src/lib/fechamento/carregar.ts";
import { centavosDeNumeric } from "../src/lib/fechamento/centavos.ts";
import {
  ErroDeClienteInacessivel,
  ErroDeDadoDoFechamento,
  ErroDeDadoFinanceiro,
  ErroDeFiltroDoFechamento,
} from "../src/lib/fechamento/erros.ts";
import { csvDoFechamento } from "../src/lib/fechamento/exportacao.ts";
import {
  conferirAssinatura,
  decidirAcesso,
  descreverErro,
  extrairFiltros,
} from "../src/lib/fechamento/http.ts";
import { ErroDeLeituraDoFechamento } from "../src/lib/fechamento/leitura.ts";
import { normalizarLinhas } from "../src/lib/fechamento/normalizar.ts";
import {
  MAXIMO_DE_DIAS_DO_PERIODO,
  primeiraQuinzena,
  quantidadeDiasInclusivos,
  segundaQuinzena,
  ultimoDiaDoMes,
  validarPeriodo,
} from "../src/lib/fechamento/periodo.ts";

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

const igual = (caso, obtido, esperado) =>
  verificar(caso, JSON.stringify(obtido), JSON.stringify(esperado));

function erroDe(acao) {
  try {
    acao();
    return null;
  } catch (erro) {
    return erro;
  }
}

async function erroAssincrono(acao) {
  try {
    await acao();
    return null;
  } catch (erro) {
    return erro;
  }
}

const textoDe = (arquivo) => readFileSync(new URL(`../${arquivo}`, import.meta.url), "utf8");
const semComentarios = (fonte) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* ================================================================== */
console.log("\nP. Período\n");

igual("P1. 1ª quinzena de março/2026", primeiraQuinzena(2026, 3), {
  inicio: "2026-03-01",
  fim: "2026-03-15",
});
igual("P2. 2ª quinzena de janeiro (31 dias)", segundaQuinzena(2026, 1), {
  inicio: "2026-01-16",
  fim: "2026-01-31",
});
igual("P3. 2ª quinzena de fevereiro/2026 (28 dias)", segundaQuinzena(2026, 2), {
  inicio: "2026-02-16",
  fim: "2026-02-28",
});
igual("P4. 2ª quinzena de fevereiro/2028 (bissexto, 29 dias)", segundaQuinzena(2028, 2), {
  inicio: "2028-02-16",
  fim: "2028-02-29",
});
igual("P5. 2ª quinzena de abril (30 dias)", segundaQuinzena(2026, 4), {
  inicio: "2026-04-16",
  fim: "2026-04-30",
});
igual("P6. 2ª quinzena de dezembro (31 dias)", segundaQuinzena(2026, 12), {
  inicio: "2026-12-16",
  fim: "2026-12-31",
});
igual("P7. 1ª quinzena de fevereiro/2026", primeiraQuinzena(2026, 2), {
  inicio: "2026-02-01",
  fim: "2026-02-15",
});
verificar("P8. fevereiro/2100 não é bissexto (século)", ultimoDiaDoMes(2100, 2), 28);
verificar("P9. fevereiro/2000 é bissexto (século divisível por 400)", ultimoDiaDoMes(2000, 2), 29);
igual(
  "P10. último dia de cada mês de 2026",
  Array.from({ length: 12 }, (_, i) => ultimoDiaDoMes(2026, i + 1)),
  [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31],
);

for (const [ano, mes] of [
  [2026, 0],
  [2026, 13],
  [2026, 1.5],
  [1999, 3],
  [2101, 3],
  [Number.NaN, 3],
]) {
  verificar(
    `P11. preset recusa ano ${ano} / mês ${mes}`,
    erroDe(() => primeiraQuinzena(ano, mes)) instanceof ErroDeDadoDoFechamento,
    true,
  );
}

{
  // Para todo mês de 2000 a 2100: os dois presets são válidos, se encostam sem
  // buraco nem sobreposição e somam exatamente os dias do mês.
  let defeitos = 0;
  for (let ano = 2000; ano <= 2100; ano++) {
    for (let mes = 1; mes <= 12; mes++) {
      const a = primeiraQuinzena(ano, mes);
      const b = segundaQuinzena(ano, mes);
      const va = validarPeriodo(a.inicio, a.fim);
      const vb = validarPeriodo(b.inicio, b.fim);
      const dias = ultimoDiaDoMes(ano, mes);
      if (!va.ok || !vb.ok) defeitos++;
      else if (va.dias !== 15 || vb.dias !== dias - 15 || va.dias + vb.dias !== dias) defeitos++;
      else if (quantidadeDiasInclusivos(a.fim, b.inicio) !== 2) defeitos++;
    }
  }
  verificar("P12. 1.212 meses (2000–2100): presets válidos, contíguos e completos", defeitos, 0);
}

verificar(
  "P13. um dia: 2026-03-01 a 2026-03-01 = 1",
  quantidadeDiasInclusivos("2026-03-01", "2026-03-01"),
  1,
);
verificar(
  "P14. janeiro inteiro = 31 dias inclusivos",
  quantidadeDiasInclusivos("2026-01-01", "2026-01-31"),
  31,
);
verificar("P15. 01/01 a 01/02 = 32 dias", quantidadeDiasInclusivos("2026-01-01", "2026-02-01"), 32);
verificar(
  "P16. virada de ano: 31/12 a 01/01 = 2",
  quantidadeDiasInclusivos("2025-12-31", "2026-01-01"),
  2,
);
verificar(
  "P17. fev/2028 bissexto: 28/02 a 01/03 = 3",
  quantidadeDiasInclusivos("2028-02-28", "2028-03-01"),
  3,
);
verificar(
  "P18. fev/2026 comum: 28/02 a 01/03 = 2",
  quantidadeDiasInclusivos("2026-02-28", "2026-03-01"),
  2,
);
verificar(
  "P19. ano comum inteiro = 365",
  quantidadeDiasInclusivos("2026-01-01", "2026-12-31"),
  365,
);
verificar(
  "P20. ano bissexto inteiro = 366",
  quantidadeDiasInclusivos("2028-01-01", "2028-12-31"),
  366,
);
verificar(
  "P21. ordem invertida dá resultado não positivo",
  quantidadeDiasInclusivos("2026-03-10", "2026-03-01") <= 0,
  true,
);
verificar(
  "P22. data inexistente levanta erro",
  erroDe(() => quantidadeDiasInclusivos("2026-02-30", "2026-03-01")) instanceof
    ErroDeDadoDoFechamento,
  true,
);

{
  const ok = validarPeriodo("2026-01-01", "2026-01-31");
  verificar("P23. 31 dias inclusivos é aceito", ok.ok, true);
  verificar("P24. e informa os 31 dias", ok.ok && ok.dias, 31);
  igual("P25. e devolve o período", ok.ok && ok.periodo, {
    inicio: "2026-01-01",
    fim: "2026-01-31",
  });
}
verificar("P26. o máximo é 31", MAXIMO_DE_DIAS_DO_PERIODO, 31);
verificar(
  "P27. 32 dias é recusado",
  validarPeriodo("2026-01-01", "2026-02-01").codigo,
  "periodo-longo",
);
verificar("P28. 1 dia é aceito", validarPeriodo("2026-03-01", "2026-03-01").ok, true);
verificar(
  "P29. 01/02 a 03/03/2026 são 31 dias: aceito",
  validarPeriodo("2026-02-01", "2026-03-03").ok,
  true,
);
verificar(
  "P30. 01/02 a 04/03/2026 são 32 dias: recusado",
  validarPeriodo("2026-02-01", "2026-03-04").codigo,
  "periodo-longo",
);
verificar(
  "P31. 01/02 a 02/03/2028 (bissexto) são 31 dias: aceito",
  validarPeriodo("2028-02-01", "2028-03-02").ok,
  true,
);
verificar(
  "P32. 01/02 a 03/03/2028 (bissexto) são 32 dias: recusado",
  validarPeriodo("2028-02-01", "2028-03-03").codigo,
  "periodo-longo",
);
verificar(
  "P33. início depois do fim",
  validarPeriodo("2026-03-10", "2026-03-01").codigo,
  "inicio-depois-do-fim",
);
verificar(
  "P34. data inexistente (30/02)",
  validarPeriodo("2026-02-30", "2026-03-01").codigo,
  "data-inexistente",
);
verificar(
  "P35. data inexistente no fim",
  validarPeriodo("2026-03-01", "2026-04-31").codigo,
  "data-inexistente",
);

for (const [caso, inicio, fim] of [
  ["sem zeros", "2026-3-1", "2026-03-15"],
  ["ano de dois dígitos", "26-03-01", "2026-03-15"],
  ["com barra", "01/03/2026", "15/03/2026"],
  ["com espaço", "2026-03-01 ", "2026-03-15"],
  ["com hora", "2026-03-01T00:00:00Z", "2026-03-15"],
  ["vazio", "", ""],
  ["nulo", null, null],
  ["indefinido", undefined, undefined],
  ["número", 20260301, 20260315],
  ["objeto", {}, {}],
]) {
  verificar(
    `P36. formato inválido: ${caso}`,
    validarPeriodo(inicio, fim).codigo,
    "formato-invalido",
  );
}
verificar(
  "P37. ano 1999 fora do intervalo",
  validarPeriodo("1999-12-01", "1999-12-15").codigo,
  "ano-fora-do-intervalo",
);
verificar(
  "P38. ano 2101 fora do intervalo",
  validarPeriodo("2101-01-01", "2101-01-15").codigo,
  "ano-fora-do-intervalo",
);
verificar(
  "P39. ano 0026 (erro de digitação) fora do intervalo",
  validarPeriodo("0026-03-01", "0026-03-15").codigo,
  "ano-fora-do-intervalo",
);

{
  // O fuso do host NÃO pode mexer no resultado. Roda o mesmo cálculo em
  // processos com TZ diferentes, incluindo extremos (UTC+14 e UTC−11).
  const raiz = fileURLToPath(new URL("..", import.meta.url));
  const resolvedor = pathToFileURL(`${raiz}scripts/_resolver-ts.mjs`).href;
  const periodo = pathToFileURL(`${raiz}src/lib/fechamento/periodo.ts`).href;
  const codigo = `
    import * as p from ${JSON.stringify(periodo)};
    const saida = {
      deslocamento: new Date(2026, 0, 1).getTimezoneOffset(),
      q1: p.primeiraQuinzena(2026, 3),
      q2: p.segundaQuinzena(2026, 2),
      q2b: p.segundaQuinzena(2028, 2),
      dias: p.quantidadeDiasInclusivos("2026-01-01", "2026-01-31"),
      virada: p.quantidadeDiasInclusivos("2026-03-07", "2026-03-09"),
      valido: p.validarPeriodo("2026-02-01", "2026-03-03"),
      longo: p.validarPeriodo("2026-02-01", "2026-03-04").codigo,
    };
    process.stdout.write(JSON.stringify(saida));
  `;
  const zonas = ["UTC", "America/Sao_Paulo", "Pacific/Kiritimati", "Pacific/Pago_Pago"];
  const saidas = zonas.map((TZ) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        ["--experimental-strip-types", "--import", resolvedor, "--input-type=module", "-e", codigo],
        { env: { ...process.env, TZ }, encoding: "utf8", cwd: raiz },
      ),
    ),
  );
  const semDeslocamento = saidas.map(({ deslocamento, ...resto }) => resto);
  verificar(
    "P40. o fuso do host realmente variou entre os processos",
    new Set(saidas.map((s) => s.deslocamento)).size > 1,
    true,
  );
  verificar(
    "P41. o resultado é idêntico em UTC, São Paulo, UTC+14 e UTC−11",
    new Set(semDeslocamento.map((s) => JSON.stringify(s))).size,
    1,
  );
  verificar("P42. e é o resultado esperado", semDeslocamento[0].q1.fim, "2026-03-15");
  verificar(
    "P43. 07/03 a 09/03 (horário de verão não conta): 3 dias",
    semDeslocamento[0].virada,
    3,
  );
}

/* ================================================================== */
console.log("\nA. Assinatura\n");

const CLIENTE = "33333333-3333-4333-8333-333333333333";

/** Uma linha bruta no formato da leitura. */
function bruta(o = {}) {
  const id = o.id ?? "x-1";
  const emp = o.emp ?? "emp-1";
  const op = o.op ?? "op-1";
  return {
    id,
    employee_id: emp,
    status: o.status ?? "present",
    check_in: "check_in" in o ? o.check_in : "06:00:00",
    check_out: "check_out" in o ? o.check_out : "15:00:00",
    worked_minutes: "worked" in o ? o.worked : 480,
    overtime_minutes: "ot" in o ? o.ot : 0,
    invoice_id: "inv" in o ? o.inv : null,
    faturado: "faturado" in o ? o.faturado : "150.00",
    custo: "custo" in o ? o.custo : "90.00",
    taxa_da_diaria: "taxa" in o ? o.taxa : "150.00",
    employees: { id: emp, name: o.nome ?? "Fulano", role: "role" in o ? o.role : "Auxiliar" },
    timesheets: {
      id: `ts-${id}`,
      work_date: o.data ?? "2026-03-02",
      status: o.folha ?? "closed",
      operation_id: op,
      operations: {
        id: op,
        client_id: o.cliente ?? CLIENTE,
        name: o.operacao ?? "Operação 1",
        contract_id: "contrato" in o ? o.contrato : "ctr-1",
      },
      shifts: { id: "sh-1", name: "Manhã" },
    },
  };
}

const BASE = [
  bruta({ id: "e-1", emp: "emp-1", data: "2026-03-02" }),
  bruta({
    id: "e-2",
    emp: "emp-2",
    data: "2026-03-03",
    faturado: "206.25",
    custo: "112.56",
    ot: 120,
    worked: 600,
  }),
  bruta({
    id: "e-3",
    emp: "emp-3",
    data: "2026-03-04",
    status: "absent",
    check_in: null,
    check_out: null,
    worked: 0,
    faturado: "0.00",
    custo: "0.00",
  }),
  bruta({ id: "e-4", emp: "emp-4", data: "2026-03-05", inv: "inv-1" }),
];
const ENTRADA = {
  clienteId: CLIENTE,
  clienteNome: "Cliente Ouro",
  inicio: "2026-03-01",
  fim: "2026-03-15",
};
const assinar = (brutas, extra = {}) =>
  assinarFechamento({ ...ENTRADA, ...extra, linhas: normalizarLinhas(brutas) });
const modificar = (indice, mudancas) =>
  BASE.map((b, i) => (i === indice ? bruta({ ...mudancas }) : b));

{
  const referencia = assinar(BASE);
  verificar("A1. é um SHA-256 em hexadecimal minúsculo", /^[0-9a-f]{64}$/.test(referencia), true);
  verificar("A2. determinística: o mesmo insumo, a mesma assinatura", assinar(BASE), referencia);
  verificar("A3. e sobre cópia profunda", assinar(structuredClone(BASE)), referencia);
  verificar("A4. ordem inversa: mesma assinatura", assinar([...BASE].reverse()), referencia);
  verificar(
    "A5. outra ordem: mesma assinatura",
    assinar([BASE[2], BASE[0], BASE[3], BASE[1]]),
    referencia,
  );

  const variacoes = [
    [
      "A6. faturado +1 centavo",
      modificar(1, {
        id: "e-2",
        emp: "emp-2",
        data: "2026-03-03",
        faturado: "206.26",
        custo: "112.56",
        ot: 120,
        worked: 600,
      }),
    ],
    [
      "A7. custo +1 centavo",
      modificar(1, {
        id: "e-2",
        emp: "emp-2",
        data: "2026-03-03",
        faturado: "206.25",
        custo: "112.57",
        ot: 120,
        worked: 600,
      }),
    ],
    [
      "A8. invoice_id preenchido",
      modificar(0, { id: "e-1", emp: "emp-1", data: "2026-03-02", inv: "inv-9" }),
    ],
    [
      "A9. invoice_id trocado",
      modificar(3, { id: "e-4", emp: "emp-4", data: "2026-03-05", inv: "inv-2" }),
    ],
    [
      "A10. invoice_id removido",
      modificar(3, { id: "e-4", emp: "emp-4", data: "2026-03-05", inv: null }),
    ],
    [
      "A11. status: presente vira substituto",
      modificar(0, { id: "e-1", emp: "emp-1", data: "2026-03-02", status: "replacement" }),
    ],
    [
      "A12. status: falta vira presença",
      modificar(2, { id: "e-3", emp: "emp-3", data: "2026-03-04" }),
    ],
    [
      "A13. minutos extras",
      modificar(1, {
        id: "e-2",
        emp: "emp-2",
        data: "2026-03-03",
        faturado: "206.25",
        custo: "112.56",
        ot: 121,
        worked: 600,
      }),
    ],
    [
      "A14. minutos trabalhados",
      modificar(0, { id: "e-1", emp: "emp-1", data: "2026-03-02", worked: 481 }),
    ],
    [
      "A15. taxa da diária (snapshot)",
      modificar(0, { id: "e-1", emp: "emp-1", data: "2026-03-02", taxa: "150.01" }),
    ],
    [
      "A16. colaborador do lançamento",
      modificar(0, { id: "e-1", emp: "emp-9", data: "2026-03-02" }),
    ],
    ["A17. data do lançamento", modificar(0, { id: "e-1", emp: "emp-1", data: "2026-03-06" })],
    [
      "A18. operação do lançamento",
      modificar(0, { id: "e-1", emp: "emp-1", data: "2026-03-02", op: "op-9" }),
    ],
    [
      "A19. status da folha",
      modificar(0, { id: "e-1", emp: "emp-1", data: "2026-03-02", folha: "open" }),
    ],
    [
      "A20. contrato da operação",
      modificar(0, { id: "e-1", emp: "emp-1", data: "2026-03-02", contrato: null }),
    ],
    [
      "A21. horário de saída",
      modificar(0, { id: "e-1", emp: "emp-1", data: "2026-03-02", check_out: null }),
    ],
    [
      "A22. um lançamento a mais",
      [...BASE, bruta({ id: "e-5", emp: "emp-5", data: "2026-03-06" })],
    ],
    ["A23. um lançamento a menos", BASE.slice(1)],
    [
      "A24. lançamento substituído por outro id",
      modificar(0, { id: "e-9", emp: "emp-1", data: "2026-03-02" }),
    ],
  ];
  for (const [caso, brutas] of variacoes) {
    verificar(`${caso} muda a assinatura`, assinar(brutas) !== referencia, true);
  }

  verificar(
    "A25. outro cliente muda a assinatura",
    assinar(BASE, { clienteId: "33333333-3333-4333-8333-333333333399" }) !== referencia,
    true,
  );
  verificar(
    "A26. outro início muda a assinatura",
    assinar(BASE, { inicio: "2026-03-02" }) !== referencia,
    true,
  );
  verificar(
    "A27. outro fim muda a assinatura",
    assinar(BASE, { fim: "2026-03-16" }) !== referencia,
    true,
  );

  // Os textos que a tela e os arquivos mostram ENTRAM (corrigido na v2 da assinatura):
  // renomear invalida o download, porque o arquivo passaria a ser outro.
  const renomeado = BASE.map((b) => ({
    ...b,
    employees: { ...b.employees, name: "Nome Novo", role: "Cargo Novo" },
    timesheets: {
      ...b.timesheets,
      shifts: { id: "sh-1", name: "Turno Novo" },
      operations: { ...b.timesheets.operations, name: "Operação Renomeada" },
    },
  }));
  verificar(
    "A28. renomear colaborador, função, operação e turno MUDA a assinatura (v2)",
    assinar(renomeado) !== referencia,
    true,
  );
  verificar(
    "A28b. e o nome do cliente também",
    assinar(BASE, { clienteNome: "Outro Nome" }) !== referencia,
    true,
  );
}

{
  // Forma canônica: tuplas de posição fixa, versionadas e em ordem de id.
  const minima = [
    bruta({ id: "b", emp: "emp-1", data: "2026-03-02", inv: null }),
    bruta({
      id: "a",
      emp: "emp-2",
      data: "2026-03-03",
      status: "replacement",
      inv: "inv-1",
      ot: 15,
      worked: 495,
    }),
  ];
  const texto = serializarParaAssinatura({ ...ENTRADA, linhas: normalizarLinhas(minima) });
  verificar(
    "A29. serialização canônica exata, em ordem de id",
    texto,
    JSON.stringify([
      "fechamento-v2",
      CLIENTE,
      "Cliente Ouro",
      "2026-03-01",
      "2026-03-15",
      [
        [
          "a",
          "emp-2",
          "op-1",
          "2026-03-03",
          "replacement",
          "closed",
          "inv-1",
          15000,
          9000,
          15000,
          495,
          15,
          "06:00:00",
          "15:00:00",
          "ctr-1",
          "Fulano",
          "Auxiliar",
          "Operação 1",
          "Manhã",
        ],
        [
          "b",
          "emp-1",
          "op-1",
          "2026-03-02",
          "present",
          "closed",
          null,
          15000,
          9000,
          15000,
          480,
          0,
          "06:00:00",
          "15:00:00",
          "ctr-1",
          "Fulano",
          "Auxiliar",
          "Operação 1",
          "Manhã",
        ],
      ],
    ]),
  );
  verificar(
    "A30. a assinatura é o SHA-256 desse texto, calculado de forma independente",
    assinarFechamento({ ...ENTRADA, linhas: normalizarLinhas(minima) }),
    createHash("sha256").update(texto, "utf8").digest("hex"),
  );
  verificar("A31. o texto assinado não traz geradoEm", /geradoEm|gerado/i.test(texto), false);
  verificar(
    "A32. os textos exportados fazem parte do que é assinado (v2), mas só o hash sai do servidor",
    /Fulano/.test(texto) &&
      !/Fulano/.test(assinarFechamento({ ...ENTRADA, linhas: normalizarLinhas(minima) })),
    true,
  );
}

/* ================================================================== */
console.log("\nC. Carregamento\n");

/** Fonte falsa: ordena por id, aplica o cursor, corta em `cap` e conta. */
function fonteDe(brutas, { cap = Infinity, falharNaPagina = 0, contagemFinal } = {}) {
  const todas = [...brutas].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const registro = { paginas: 0, contagens: 0, filtros: [] };
  return {
    registro,
    async lerPagina({ cursor, limite, contar }) {
      registro.paginas += 1;
      if (falharNaPagina === registro.paginas) throw new Error("rede caiu: SELECT secreto");
      const candidatas = (cursor === null ? todas : todas.filter((l) => l.id > cursor)).slice(
        0,
        Math.min(limite, cap),
      );
      return { linhas: candidatas, total: contar ? todas.length : null };
    },
    async contar() {
      registro.contagens += 1;
      return contagemFinal ?? todas.length;
    },
  };
}

function dependencias(brutas, opcoes = {}) {
  const chamadas = { cliente: [], fonte: [] };
  const fonte = fonteDe(brutas, opcoes);
  return {
    chamadas,
    fonte,
    deps: {
      async buscarCliente(id) {
        chamadas.cliente.push(id);
        if (opcoes.erroNoCliente) throw opcoes.erroNoCliente;
        return "semCliente" in opcoes ? null : { id, name: "Cliente Ouro" };
      },
      criarFonte(filtro) {
        chamadas.fonte.push(filtro);
        return fonte;
      },
      agora: () => new Date(opcoes.agora ?? "2026-03-16T12:00:00.000Z"),
      opcoesDeLeitura: opcoes.leitura,
    },
  };
}

const FILTROS = { clienteId: CLIENTE, inicio: "2026-03-01", fim: "2026-03-15" };

{
  const { deps, chamadas } = dependencias(BASE);
  const d = await carregarFechamento(FILTROS, deps);
  verificar("C1. caminho feliz: versão do modelo", d.versao, 1);
  verificar("C2. nome do cliente vem da busca", d.meta.clienteNome, "Cliente Ouro");
  verificar("C3. cliente da meta", d.meta.clienteId, CLIENTE);
  verificar("C4. período da meta", `${d.meta.inicio}..${d.meta.fim}`, "2026-03-01..2026-03-15");
  verificar("C5. linhasLidas conta tudo o que foi lido, faltas inclusive", d.meta.linhasLidas, 4);
  verificar("C6. geradoEm vem do relógio injetado", d.meta.geradoEm, "2026-03-16T12:00:00.000Z");
  verificar("C7. a assinatura foi gerada", /^[0-9a-f]{64}$/.test(d.meta.assinatura), true);
  verificar("C8. e é a do snapshot lido", d.meta.assinatura, assinar(BASE));
  verificar("C9. diárias (3 presenças, 1 falta)", d.consolidado.diarias, 3);
  verificar("C10. faturado consolidado", d.consolidado.faturadoCentavos, 15000 + 20625 + 15000);
  verificar("C11. já faturado (e-4)", d.jaFaturado.diarias, 1);
  verificar("C12. a faturar (e-1 e e-2)", d.aFaturar.diarias, 2);
  verificar("C13. a falta é só contada", d.faltas, 1);
  verificar("C14. só o cliente pedido foi buscado, uma vez", chamadas.cliente.length, 1);
  igual("C15. a fonte recebeu exatamente cliente e período", chamadas.fonte, [FILTROS]);
}
{
  const a = await carregarFechamento(
    FILTROS,
    dependencias(BASE, { agora: "2026-03-16T12:00:00.000Z" }).deps,
  );
  const b = await carregarFechamento(
    FILTROS,
    dependencias(BASE, { agora: "2030-01-01T00:00:00.000Z" }).deps,
  );
  verificar("C16. geradoEm diferente, mesma assinatura", a.meta.assinatura, b.meta.assinatura);
  verificar("C17. mas o geradoEm é de fato outro", a.meta.geradoEm !== b.meta.geradoEm, true);
  const outra = await carregarFechamento(
    FILTROS,
    dependencias(modificar(0, { id: "e-1", emp: "emp-1", data: "2026-03-02", faturado: "150.01" }))
      .deps,
  );
  verificar(
    "C18. um centavo a mais: outra assinatura",
    outra.meta.assinatura !== a.meta.assinatura,
    true,
  );
}
{
  const { deps, chamadas } = dependencias(BASE);
  const d = await carregarFechamento({ ...FILTROS, clienteId: CLIENTE.toUpperCase() }, deps);
  verificar(
    "C19. cliente em maiúsculas é normalizado antes da busca",
    chamadas.cliente[0],
    CLIENTE,
  );
  verificar("C20. e na meta", d.meta.clienteId, CLIENTE);
}
{
  const { deps, chamadas } = dependencias(BASE, { semCliente: true });
  const erro = await erroAssincrono(() => carregarFechamento(FILTROS, deps));
  verificar(
    "C21. cliente inexistente ou inacessível: ErroDeClienteInacessivel",
    erro instanceof ErroDeClienteInacessivel,
    true,
  );
  verificar("C22. e nenhum lançamento é lido", chamadas.fonte.length, 0);
}
{
  const causa = new Error("falha do banco");
  const { deps } = dependencias(BASE, { erroNoCliente: causa });
  verificar(
    "C23. falha ao buscar o cliente propaga",
    await erroAssincrono(() => carregarFechamento(FILTROS, deps)),
    causa,
  );
}

for (const [caso, filtros, codigo] of [
  [
    "início depois do fim",
    { ...FILTROS, inicio: "2026-03-10", fim: "2026-03-01" },
    "periodo-invalido",
  ],
  ["32 dias", { ...FILTROS, inicio: "2026-01-01", fim: "2026-02-01" }, "periodo-invalido"],
  ["data inexistente", { ...FILTROS, fim: "2026-02-30" }, "periodo-invalido"],
  ["formato errado", { ...FILTROS, inicio: "01/03/2026" }, "periodo-invalido"],
  ["período ausente", { clienteId: CLIENTE }, "periodo-invalido"],
  ["cliente não é UUID", { ...FILTROS, clienteId: "cli-ouro" }, "cliente-invalido"],
  ["cliente numérico", { ...FILTROS, clienteId: 123 }, "cliente-invalido"],
  ["cliente ausente", { inicio: FILTROS.inicio, fim: FILTROS.fim }, "cliente-invalido"],
  ["cliente com injeção", { ...FILTROS, clienteId: `${CLIENTE}' or '1'='1` }, "cliente-invalido"],
]) {
  const { deps, chamadas } = dependencias(BASE);
  const erro = await erroAssincrono(() => carregarFechamento(filtros, deps));
  verificar(
    `C24. filtro inválido (${caso}): ErroDeFiltroDoFechamento ${codigo}`,
    erro instanceof ErroDeFiltroDoFechamento && erro.codigo,
    codigo,
  );
  verificar(
    `C25. filtro inválido (${caso}): nada foi consultado`,
    chamadas.cliente.length + chamadas.fonte.length,
    0,
  );
}
verificar(
  "C26. validarFiltros devolve os filtros limpos",
  JSON.stringify(validarFiltros(FILTROS)),
  JSON.stringify(FILTROS),
);

{
  const { deps } = dependencias(BASE, { falharNaPagina: 1 });
  const erro = await erroAssincrono(() => carregarFechamento(FILTROS, deps));
  verificar(
    "C27. falha de leitura propaga (nada de lista vazia)",
    erro instanceof Error && erro.message.startsWith("rede caiu"),
    true,
  );
}
{
  const { deps } = dependencias([
    ...BASE,
    bruta({ id: "e-9", emp: "emp-9", data: "2026-03-06", faturado: "abc" }),
  ]);
  const erro = await erroAssincrono(() => carregarFechamento(FILTROS, deps));
  verificar(
    "C28. falha de normalização propaga: ErroDeDadoFinanceiro",
    erro instanceof ErroDeDadoFinanceiro,
    true,
  );
}
{
  const { deps } = dependencias([
    ...BASE,
    bruta({ id: "e-9", emp: "emp-9", data: "2026-03-06", status: "ausente" }),
  ]);
  const erro = await erroAssincrono(() => carregarFechamento(FILTROS, deps));
  verificar(
    "C29. dado inválido propaga: ErroDeDadoDoFechamento",
    erro instanceof ErroDeDadoDoFechamento,
    true,
  );
}
{
  const { deps } = dependencias([
    ...BASE,
    bruta({
      id: "e-9",
      emp: "emp-9",
      data: "2026-03-06",
      cliente: "33333333-3333-4333-8333-333333333399",
    }),
  ]);
  const erro = await erroAssincrono(() => carregarFechamento(FILTROS, deps));
  verificar(
    "C30. linha de outro cliente derruba o carregamento",
    erro instanceof ErroDeDadoDoFechamento,
    true,
  );
}
{
  const { deps } = dependencias([...BASE, bruta({ id: "e-9", emp: "emp-9", data: "2026-03-20" })]);
  const erro = await erroAssincrono(() => carregarFechamento(FILTROS, deps));
  verificar(
    "C31. linha fora do período derruba o carregamento",
    erro instanceof ErroDeDadoDoFechamento,
    true,
  );
}
{
  const { deps } = dependencias(BASE, { contagemFinal: 5 });
  const erro = await erroAssincrono(() => carregarFechamento(FILTROS, deps));
  verificar(
    "C32. dados mudaram durante a leitura: erro de leitura",
    erro instanceof ErroDeLeituraDoFechamento && erro.codigo,
    "dados-mudaram",
  );
}
{
  const { deps } = dependencias(BASE, { leitura: { tetoDeLinhas: 2 } });
  const erro = await erroAssincrono(() => carregarFechamento(FILTROS, deps));
  verificar(
    "C33. período acima do teto de linhas: erro de leitura",
    erro instanceof ErroDeLeituraDoFechamento && erro.codigo,
    "periodo-grande",
  );
}
{
  const { deps, fonte } = dependencias(BASE, { leitura: { tamanhoDaPagina: 2 }, cap: 1 });
  const d = await carregarFechamento(FILTROS, deps);
  verificar("C34. páginas pequenas e servidor que corta: leitura completa", d.meta.linhasLidas, 4);
  verificar("C35. e várias páginas foram lidas", fonte.registro.paginas > 1, true);
}
{
  const { deps } = dependencias([]);
  const d = await carregarFechamento(FILTROS, deps);
  verificar("C36. conjunto vazio: nenhuma linha lida", d.meta.linhasLidas, 0);
  verificar(
    "C37. conjunto vazio: totais zerados",
    d.consolidado.faturadoCentavos + d.consolidado.diarias,
    0,
  );
  verificar("C38. conjunto vazio: margem nula", d.consolidado.margemPermil, null);
  verificar(
    "C39. conjunto vazio: ainda há assinatura",
    /^[0-9a-f]{64}$/.test(d.meta.assinatura),
    true,
  );
  verificar(
    "C40. conjunto vazio: sem colaboradores nem alertas",
    d.colaboradores.length + d.alertas.length,
    0,
  );
}
{
  const soFaltas = [
    bruta({
      id: "f-1",
      emp: "emp-1",
      data: "2026-03-02",
      status: "absent",
      check_in: null,
      check_out: null,
      worked: 0,
      faturado: "0.00",
      custo: "0.00",
    }),
    bruta({
      id: "f-2",
      emp: "emp-2",
      data: "2026-03-03",
      status: "absent",
      check_in: null,
      check_out: null,
      worked: 0,
      faturado: "0.00",
      custo: "0.00",
    }),
  ];
  const d = await carregarFechamento(FILTROS, dependencias(soFaltas).deps);
  verificar("C41. só faltas: linhas lidas", d.meta.linhasLidas, 2);
  verificar("C42. só faltas: nenhuma diária", d.consolidado.diarias, 0);
  verificar(
    "C43. só faltas: nenhum valor",
    d.consolidado.faturadoCentavos + d.consolidado.custoCentavos,
    0,
  );
  verificar("C44. só faltas: as faltas são contadas", d.faltas, 2);
  verificar("C45. só faltas: sem linhas no detalhe", d.detalhes.length, 0);
  verificar(
    "C46. só faltas: alerta informativo de falta",
    d.alertas.map((a) => a.codigo).join(","),
    "falta",
  );
}
{
  // A mesma composição que a tela e o XLSX usarão: o resultado não depende da
  // ordem em que o banco devolve as linhas.
  const a = await carregarFechamento(FILTROS, dependencias([...BASE].reverse()).deps);
  const b = await carregarFechamento(FILTROS, dependencias(BASE).deps);
  verificar("C47. a ordem de leitura não altera o resultado", JSON.stringify(a), JSON.stringify(b));
}

/* ================================================================== */
console.log("\nH. Decisões HTTP\n");

for (const [situacao, admin, status, codigo] of [
  ["sem-sessao", false, 401, "nao-autenticado"],
  ["sem-papel", false, 403, "acesso-negado"],
  ["mfa-ausente", true, 403, "acesso-negado"],
  ["mfa-pendente", true, 403, "acesso-negado"],
  ["mfa-indisponivel", true, 403, "acesso-negado"],
  ["liberado", false, 403, "acesso-negado"],
  ["situacao-desconhecida", true, 403, "acesso-negado"],
  ["", true, 403, "acesso-negado"],
]) {
  const r = decidirAcesso(situacao, admin);
  verificar(`H1. ${situacao || "(vazia)"} / admin=${admin} → ${status}`, r?.status, status);
  verificar(
    `H2. ${situacao || "(vazia)"} / admin=${admin} → código ${codigo}`,
    r?.corpo.erro.codigo,
    codigo,
  );
}
verificar("H3. admin liberado (AAL2) passa", decidirAcesso("liberado", true), null);
verificar("H4. operacional liberado não passa", decidirAcesso("liberado", false)?.status, 403);

{
  const ok = extrairFiltros(
    new URLSearchParams(`cliente=${CLIENTE}&inicio=2026-03-01&fim=2026-03-15`),
  );
  igual("H5. extrai cliente, início e fim", ok, {
    clienteId: CLIENTE,
    inicio: "2026-03-01",
    fim: "2026-03-15",
  });
  verificar(
    "H6. a ordem dos parâmetros não importa",
    extrairFiltros(new URLSearchParams(`fim=2026-03-15&cliente=${CLIENTE}&inicio=2026-03-01`))
      .inicio,
    "2026-03-01",
  );
}
for (const [caso, consulta] of [
  [
    "parâmetro de valor financeiro",
    `cliente=${CLIENTE}&inicio=2026-03-01&fim=2026-03-15&faturado=1`,
  ],
  ["parâmetro de colaborador", `cliente=${CLIENTE}&inicio=2026-03-01&fim=2026-03-15&employee_id=x`],
  ["parâmetro desconhecido", `cliente=${CLIENTE}&inicio=2026-03-01&fim=2026-03-15&limite=10`],
  ["cliente repetido", `cliente=${CLIENTE}&cliente=${CLIENTE}&inicio=2026-03-01&fim=2026-03-15`],
  ["cliente ausente", "inicio=2026-03-01&fim=2026-03-15"],
  ["fim ausente", `cliente=${CLIENTE}&inicio=2026-03-01`],
  ["início vazio", `cliente=${CLIENTE}&inicio=&fim=2026-03-15`],
  ["sem parâmetros", ""],
]) {
  const erro = erroDe(() => extrairFiltros(new URLSearchParams(consulta)));
  verificar(
    `H7. recusa: ${caso}`,
    erro instanceof ErroDeFiltroDoFechamento && erro.codigo,
    "parametro-invalido",
  );
}

{
  const casos = [
    [
      new ErroDeFiltroDoFechamento("periodo-invalido", "O período pode ter no máximo 31 dias."),
      400,
      "filtro-invalido",
    ],
    [new ErroDeClienteInacessivel(), 404, "cliente-nao-encontrado"],
    [new ErroDeLeituraDoFechamento("dados-mudaram", "mudou"), 409, "dados-mudaram"],
    [new ErroDeLeituraDoFechamento("pagina-vazia-prematura", "x"), 422, "leitura-incompleta"],
    [new ErroDeLeituraDoFechamento("id-repetido", "x"), 422, "leitura-incompleta"],
    [new ErroDeLeituraDoFechamento("ordem-violada", "x"), 422, "leitura-incompleta"],
    [new ErroDeLeituraDoFechamento("excedeu-a-contagem", "x"), 422, "leitura-incompleta"],
    [new ErroDeLeituraDoFechamento("periodo-grande", "x"), 422, "leitura-incompleta"],
    [new ErroDeLeituraDoFechamento("requisicoes-excedidas", "x"), 422, "leitura-incompleta"],
    [new ErroDeLeituraDoFechamento("contagem-ausente", "x"), 422, "leitura-incompleta"],
    [new ErroDeLeituraDoFechamento("consulta", "x"), 500, "erro-interno"],
    [new ErroDeDadoFinanceiro("x"), 422, "dado-inconsistente"],
    [new ErroDeDadoDoFechamento("x"), 422, "dado-inconsistente"],
    [new Error("qualquer outra coisa"), 500, "erro-interno"],
    ["texto solto", 500, "erro-interno"],
    [null, 500, "erro-interno"],
  ];
  for (const [causa, status, codigo] of casos) {
    const r = descreverErro(causa);
    verificar(
      `H8. ${causa?.name ?? String(causa)}${causa?.codigo ? `/${causa.codigo}` : ""} → ${status}`,
      r.status,
      status,
    );
    verificar(`H9. e o código ${codigo}`, r.corpo.erro.codigo, codigo);
  }

  // Nada interno sai no corpo.
  const segredos = [
    "SECRET-ENTRY-123",
    "billed_amount",
    "SELECT * FROM timesheet_entries",
    "postgres://user:senha@host",
    "eyJhbGciOiJIUzI1NiJ9.token",
    "at Object.<anonymous>",
  ];
  const mensagemSuja = segredos.join(" | ");
  for (const causa of [
    new ErroDeDadoFinanceiro(mensagemSuja),
    new ErroDeDadoDoFechamento(mensagemSuja),
    new ErroDeLeituraDoFechamento("consulta", mensagemSuja),
    new ErroDeLeituraDoFechamento("id-repetido", mensagemSuja),
    new ErroDeLeituraDoFechamento("dados-mudaram", mensagemSuja),
    new Error(mensagemSuja),
    Object.assign(new Error(mensagemSuja), { stack: mensagemSuja }),
  ]) {
    const corpo = JSON.stringify(descreverErro(causa).corpo);
    verificar(
      `H10. o corpo de ${causa.name}${causa.codigo ? `/${causa.codigo}` : ""} não vaza detalhes`,
      segredos.some((s) => corpo.includes(s)),
      false,
    );
  }
  verificar(
    "H11. a mensagem de filtro (feita para o usuário) é preservada",
    descreverErro(casos[0][0]).corpo.erro.mensagem,
    "O período pode ter no máximo 31 dias.",
  );
  verificar(
    "H12. o corpo de erro tem sempre a mesma forma",
    Object.keys(descreverErro(new Error("x")).corpo).join(","),
    "erro",
  );
  verificar(
    "H13. e erro.codigo + erro.mensagem",
    Object.keys(descreverErro(new Error("x")).corpo.erro)
      .sort()
      .join(","),
    "codigo,mensagem",
  );
}

/* ================================================================== */
console.log("\nR. Forma literal do Route Handler\n");

const rota = semComentarios(textoDe("src/app/api/fechamento/route.ts"));
const carregar = semComentarios(textoDe("src/lib/fechamento/carregar.ts"));
const http = semComentarios(textoDe("src/lib/fechamento/http.ts"));
const assinaturaFonte = semComentarios(textoDe("src/lib/fechamento/assinatura.ts"));
const periodoFonte = semComentarios(textoDe("src/lib/fechamento/periodo.ts"));

verificar(
  "R1. a rota existe e exporta GET",
  /export\s+async\s+function\s+GET\s*\(/.test(rota),
  true,
);
verificar(
  "R2. só GET: nenhum outro verbo",
  /export\s+(async\s+)?function\s+(POST|PUT|PATCH|DELETE)\b/.test(rota),
  false,
);
verificar('R3. runtime "nodejs"', /export const runtime = "nodejs"/.test(rota), true);
verificar('R4. dynamic "force-dynamic"', /export const dynamic = "force-dynamic"/.test(rota), true);
verificar("R5. Cache-Control: no-store", /"Cache-Control":\s*"no-store"/.test(rota), true);
verificar(
  "R6. TODA resposta carrega o cabeçalho no-store",
  (rota.match(/NextResponse\.json\(/g) ?? []).length ===
    (rota.match(/headers:\s*SEM_CACHE/g) ?? []).length,
  true,
);
verificar(
  "R7. usa a decisão de acesso do projeto: lerAcesso",
  /lerAcesso\(\)/.test(rota) && /from\s+"@\/app\/\(painel\)\/_autorizacao"/.test(rota),
  true,
);
verificar("R8. e o papel admin: ehAdmin", /ehAdmin\(acesso\.papeis\)/.test(rota), true);
verificar(
  "R9. o acesso é decidido ANTES de ler qualquer parâmetro ou dado",
  rota.indexOf("decidirAcesso(") < rota.indexOf("extrairFiltros(") &&
    rota.indexOf("decidirAcesso(") < rota.indexOf("carregarFechamento("),
  true,
);
verificar(
  "R10. o acesso negado retorna antes de carregar",
  /if \(negado\) return responderErro\(negado\);/.test(rota),
  true,
);
verificar("R11. usa o cliente Supabase da SESSÃO", /criarClienteServidor\(\)/.test(rota), true);
verificar(
  "R12. sem service_role nem cliente administrativo",
  /service_role|criarClienteAdmin|integrations\/supabase\/admin|SUPABASE_SERVICE/i.test(
    rota + carregar,
  ),
  false,
);
verificar(
  "R13. sem fetchAll, useLedger nem hooks de dados",
  /fetchAll|useLedger|useEntries|@\/lib\/queries/.test(rota + carregar + http),
  false,
);
verificar(
  "R14. chama a camada central",
  /carregarFechamento\(filtros,\s*dependenciasComSupabase\(supabase\)\)/.test(rota),
  true,
);
verificar(
  "R15. os filtros só passam por extrairFiltros",
  /extrairFiltros\(new URL\(request\.url\)\.searchParams\)/.test(rota) &&
    !/searchParams\.get\(/.test(rota),
  true,
);
verificar(
  "R16. o corpo da requisição nunca é lido",
  /request\.(json|text|formData|body)/.test(rota),
  false,
);
verificar(
  "R17. a rota não tem cálculo financeiro próprio",
  /Centavos|centavos|billed|cost_amount|faturado|margem|reduce\s*\(|resultado|diaria|Permil/.test(
    rota,
  ),
  false,
);
verificar(
  "R18. a rota não monta SQL nem consulta tabela",
  /\.from\s*\(|\.select\s*\(|\.rpc\s*\(/.test(rota),
  false,
);
verificar("R19. os erros passam por descreverErro", /descreverErro\(causa\)/.test(rota), true);
verificar(
  "R20. a mensagem interna só aparece no log do servidor",
  (rota.match(/\.message/g) ?? []).length === 1 &&
    rota.indexOf("console.error(") < rota.indexOf(".message"),
  true,
);
verificar("R21. nunca devolve a pilha", /\.stack/.test(rota + http + carregar), false);
verificar(
  "R22. a resposta de erro vem pronta de descreverErro",
  /responderErro\(resposta\)/.test(rota),
  true,
);
verificar(
  "R23. http.ts só expõe a mensagem do erro de filtro",
  (http.match(/\.message/g) ?? []).length,
  1,
);
verificar(
  "R24. a mensagem exposta é a do ErroDeFiltroDoFechamento",
  /instanceof ErroDeFiltroDoFechamento\)\s*\{\s*return erro\(400,\s*"filtro-invalido",\s*causa\.message\)/.test(
    http,
  ),
  true,
);

verificar(
  "R25. carregar.ts compõe leitura → normalização → assinatura → agregação",
  ["lerFechamento(", "normalizarLinhas(", "assinarFechamento(", "agregarFechamento("].every((c) =>
    carregar.includes(c),
  ),
  true,
);
verificar(
  "R26. carregar.ts não calcula valor",
  /Centavos\s*[-+*/]|reduce\s*\(|Math\./.test(carregar),
  false,
);
verificar(
  "R27. carregar.ts só busca o cliente pedido",
  /\.eq\("id",\s*clienteId\)/.test(carregar) && /\.select\("id, name"\)/.test(carregar),
  true,
);
verificar(
  "R28. e não varre a tabela de clientes",
  /\.from\("clients"\)\s*\.select\("\*"\)/.test(carregar),
  false,
);
verificar(
  "R29. assinatura.ts usa SHA-256 nativo do Node",
  /createHash\("sha256"\)/.test(assinaturaFonte) && /from "node:crypto"/.test(assinaturaFonte),
  true,
);
verificar(
  "R30. e não instala nem importa biblioteca de terceiros",
  /from\s+"(?!node:|\.\/|@\/)[^"]+"/.test(assinaturaFonte + periodoFonte),
  false,
);
verificar(
  "R31. periodo.ts não cria Date",
  /\bnew Date\b|Date\.(now|parse|UTC)/.test(periodoFonte),
  false,
);
verificar("R32. periodo.ts não usa Intl nem toLocale", /Intl\.|toLocale/.test(periodoFonte), false);
verificar(
  "R33. o GET /api/fechamento e o carregamento não conhecem XLSX (o download é rota própria, etapa 4.5)",
  /xlsx|write-excel-file/i.test(rota + carregar),
  false,
);

/* ================================================================== */
console.log("\nG. A assinatura cobre tudo o que a tela e os arquivos mostram (etapa 4.6.2)\n");

{
  // Mesmo FechamentoData que a tela e os arquivos consomem, com relógio e cliente injetáveis.
  const carregar = (brutas, { cliente = "Cliente Ouro", agora } = {}) => {
    const { deps } = dependencias(brutas, agora ? { agora } : {});
    const base = deps.buscarCliente;
    deps.buscarCliente = async (id) => ({ ...(await base(id)), name: cliente });
    return carregarFechamento(FILTROS, deps);
  };
  const exportado = (d) => csvDoFechamento(d, "colaborador") + "\n" + csvDoFechamento(d, "diario");

  const base = await carregar(BASE);
  const referencia = base.meta.assinatura;

  // Cada alteração é de um texto que o usuário VÊ na tela e no arquivo.
  const renomear = (campo, valor) =>
    BASE.map((b, i) => {
      if (i !== 0) return b;
      const c = structuredClone(b);
      if (campo === "colaborador") c.employees.name = valor;
      if (campo === "funcao") c.employees.role = valor;
      if (campo === "operacao") c.timesheets.operations.name = valor;
      if (campo === "turno") c.timesheets.shifts = { id: "sh-1", name: valor };
      return c;
    });

  for (const [campo, valor] of [
    ["colaborador", "Nome Novo"],
    ["funcao", "Cargo Novo"],
    ["operacao", "Operação Renomeada"],
    ["turno", "Turno Novo"],
  ]) {
    const nova = await carregar(renomear(campo, valor));
    verificar(
      `G1.${campo}. o arquivo exportado muda quando o ${campo} muda (a lacuna era real)`,
      exportado(nova) !== exportado(base),
      true,
    );
    verificar(`G2.${campo}. e a assinatura muda junto`, nova.meta.assinatura !== referencia, true);
  }

  const outroCliente = await carregar(BASE, { cliente: "Cliente Renomeado" });
  verificar(
    "G3. o nome do cliente aparece no Resumo e no nome do arquivo",
    outroCliente.meta.clienteNome !== base.meta.clienteNome,
    true,
  );
  verificar(
    "G4. e a assinatura muda quando o nome do cliente muda",
    outroCliente.meta.assinatura !== referencia,
    true,
  );

  verificar(
    "G5. dados idênticos, assinatura idêntica",
    (await carregar(structuredClone(BASE))).meta.assinatura,
    referencia,
  );
  verificar(
    "G6. o relógio não entra: outro 'agora', mesma assinatura",
    (await carregar(BASE, { agora: "2030-01-01T00:00:00.000Z" })).meta.assinatura,
    referencia,
  );
  verificar(
    "G7. a ordem de leitura não entra",
    (await carregar([...BASE].reverse())).meta.assinatura,
    referencia,
  );
  verificar(
    "G8. mudança financeira (+1 centavo) continua mudando a assinatura",
    (
      await carregar(
        modificar(0, { id: "e-1", emp: "emp-1", data: "2026-03-02", faturado: "150.01" }),
      )
    ).meta.assinatura !== referencia,
    true,
  );
  verificar(
    "G9. mudança de status continua mudando a assinatura",
    (
      await carregar(
        modificar(0, { id: "e-1", emp: "emp-1", data: "2026-03-02", status: "replacement" }),
      )
    ).meta.assinatura !== referencia,
    true,
  );

  // Irrelevante: o que normalizar.ts já iguala não é diferença para o arquivo.
  const espacos = BASE.map((b, i) => {
    if (i !== 0) return b;
    const c = structuredClone(b);
    c.employees.name = "  Fulano  ";
    c.timesheets.shifts = { id: "sh-1", name: " Manhã " };
    return c;
  });
  verificar(
    "G10. espaços nas pontas (que o arquivo já apara) não invalidam o download",
    (await carregar(espacos)).meta.assinatura,
    referencia,
  );
  const semFuncao = (valor) =>
    BASE.map((b, i) => {
      if (i !== 0) return b;
      const c = structuredClone(b);
      c.employees.role = valor;
      return c;
    });
  verificar(
    "G11. função nula e função em branco são o mesmo texto exportado ('Sem função')",
    (await carregar(semFuncao(null))).meta.assinatura,
    (await carregar(semFuncao("   "))).meta.assinatura,
  );
  const outroIdDeTurno = BASE.map((b, i) => {
    if (i !== 0) return b;
    const c = structuredClone(b);
    c.timesheets.shifts = { id: "sh-OUTRO-ID", name: "Manhã" }; // mesmo nome, outro id
    return c;
  });
  verificar(
    "G12. id do turno (não exportado) não invalida o download",
    (await carregar(outroIdDeTurno)).meta.assinatura,
    referencia,
  );

  // Texto não pode migrar de um campo para o outro sem mudar a assinatura.
  const par = (nome, role) =>
    BASE.map((b, i) => {
      if (i !== 0) return b;
      const c = structuredClone(b);
      c.employees.name = nome;
      c.employees.role = role;
      return c;
    });
  verificar(
    "G13. a fronteira entre campos conta: 'A'+'BC' difere de 'AB'+'C'",
    (await carregar(par("A", "BC"))).meta.assinatura !==
      (await carregar(par("AB", "C"))).meta.assinatura,
    true,
  );

  // HTTP 409 e nova assinatura, pela decisão real do endpoint.
  const v1 = base.meta.assinatura;
  const v2 = (await carregar(renomear("colaborador", "Nome Novo"))).meta.assinatura;
  verificar(
    "G14. assinatura antiga + dados exportáveis mudaram = 409",
    conferirAssinatura(v1, v2)?.status,
    409,
  );
  verificar("G15. com a assinatura nova a exportação é liberada", conferirAssinatura(v2, v2), null);

  // O que sai para o navegador é só o hash.
  verificar(
    "G16. o navegador recebe só o hash, sem nenhum texto do cadastro",
    /^[0-9a-f]{64}$/.test(base.meta.assinatura),
    true,
  );
}

/* ================================================================== */
console.log("\nS. Elo entre a suíte SQL e a fixture ouro\n");

const sql = textoDe("supabase/tests/014_paridade_fechamento.sql");
const ouro = JSON.parse(textoDe("scripts/fixtures/fechamento-paridade.json"));
const dinheiro = (c) => `${Math.trunc(c / 100)}.${String(c % 100).padStart(2, "0")}`;

for (const linha of ouro.linhas) {
  const numero = linha.id.replace("e-", "");
  const padrao = new RegExp(
    `\\('e-${numero}',\\s*'[0-9a-f-]+',\\s*([0-9.]+),\\s*([0-9.]+),\\s*([0-9.]+),\\s*(\\d+),\\s*(\\d+)\\)`,
  );
  const m = padrao.exec(sql);
  verificar(`S1. a linha ${linha.id} existe na suíte SQL`, m !== null, true);
  if (m === null) continue;
  const [, billed, cost, taxa, trabalhados, extras] = m;
  verificar(
    `S2. ${linha.id}: faturado`,
    centavosDeNumeric(billed),
    centavosDeNumeric(linha.faturado),
  );
  verificar(`S3. ${linha.id}: custo`, centavosDeNumeric(cost), centavosDeNumeric(linha.custo));
  verificar(
    `S4. ${linha.id}: taxa da diária`,
    centavosDeNumeric(taxa),
    centavosDeNumeric(linha.taxa_da_diaria),
  );
  verificar(`S5. ${linha.id}: minutos trabalhados`, Number(trabalhados), linha.worked_minutes);
  verificar(`S6. ${linha.id}: minutos extras`, Number(extras), linha.overtime_minutes);
}

const e = ouro.esperado;
const horas = (centesimos) =>
  `${Math.trunc(centesimos / 100)}.${String(centesimos % 100).padStart(2, "0")}`;
const contem = (caso, literal) => verificar(caso, sql.includes(`'${literal}'`), true);

contem("S7. SQL: total_dailies da fatura 2 = fixture", `${e.gerarFatura.total_dailies}.00`);
contem("S8. SQL: total_overtime da fatura 2 = fixture", e.gerarFatura.total_overtime);
contem("S9. SQL: total_amount da fatura 2 = fixture", e.gerarFatura.total_amount);
contem("S10. SQL: total_cost da fatura 2 = fixture", e.gerarFatura.total_cost);
contem("S11. SQL: dailies da fatura 1 = fixture jaFaturado", `${e.jaFaturado.diarias}.00`);
contem(
  "S12. SQL: horas da fatura 1 = fixture jaFaturado",
  horas(e.horasExtrasEmCentesimos.jaFaturado),
);
contem(
  "S13. SQL: faturado da fatura 1 = fixture jaFaturado",
  dinheiro(e.jaFaturado.faturadoCentavos),
);
contem("S14. SQL: custo da fatura 1 = fixture jaFaturado", dinheiro(e.jaFaturado.custoCentavos));
contem("S15. SQL: diárias do consolidado = fixture", String(e.consolidado.diarias));
contem("S16. SQL: minutos extras do consolidado = fixture", String(e.consolidado.minutosExtras));
contem("S17. SQL: faturado do consolidado = fixture", dinheiro(e.consolidado.faturadoCentavos));
contem("S18. SQL: custo do consolidado = fixture", dinheiro(e.consolidado.custoCentavos));
contem("S19. SQL: extra do consolidado = fixture", dinheiro(e.consolidado.extraCentavos));
contem("S20. SQL: diária do consolidado = fixture", dinheiro(e.consolidado.diariaCentavos));
contem("S21. SQL: extra a faturar = fixture", dinheiro(e.aFaturar.extraCentavos));
contem("S22. SQL: diária a faturar = fixture", dinheiro(e.aFaturar.diariaCentavos));
contem("S23. SQL: diárias a faturar = fixture", String(e.aFaturar.diarias));
contem("S24. SQL: minutos a faturar = fixture", String(e.aFaturar.minutosExtras));
verificar(
  "S25. a suíte SQL não grava billed_amount nem cost_amount à mão",
  /insert into public\.timesheet_entries\s*\([^)]*(billed_amount|cost_amount)/i.test(sql),
  false,
);
verificar(
  "S26. a suíte SQL chama gerar_fatura de verdade",
  (sql.match(/public\.gerar_fatura\(/g) ?? []).length >= 3,
  true,
);
verificar("S27. a suíte SQL termina em rollback", /\nrollback;\s*$/.test(sql), true);
verificar(
  "S28. a suíte SQL é só local: avisa que não roda em Production",
  /NUNCA rode isto em Production/.test(sql),
  true,
);

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);

if (falhas.length > 0) {
  for (const falha of falhas) console.log(`  FALHA  ${falha}`);
  process.exit(1);
}
