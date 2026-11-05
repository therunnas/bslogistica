import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import {
  conciliarBaseComercial,
  extrairComponentesDoFechamento,
  validarBaseComercial,
} from "../src/lib/fechamento/conciliacao-comercial.ts";
import { gerarXlsxDoCliente } from "../src/lib/fechamento/xlsx-cliente.ts";
import { gerarXlsxDoFechamento } from "../src/lib/fechamento/xlsx.ts";
import { dadosDoOuro, lerPlanilha, lerStringsCompartilhadas } from "./_fechamento-exportacao.mjs";
import { lerZip } from "./_zip.mjs";

const CONTAINER_ID = "5c45d000-0000-4000-8000-000000000013";
const OUTRO_ID = "5c45d000-0000-4000-8000-000000000014";

function fechamentoSintetico() {
  const dados = structuredClone(dadosDoOuro());
  dados.adicionais = [
    {
      id: CONTAINER_ID,
      descricao: "Descarga de dois containers",
      referencia: "SINTETICO-FIN-PR-13",
      operacaoId: null,
      inicio: dados.meta.inicio,
      fim: dados.meta.fim,
      valorCentavos: 4567,
      faturaId: null,
    },
    {
      id: OUTRO_ID,
      descricao: "Serviço avulso sintético",
      referencia: null,
      operacaoId: null,
      inicio: dados.meta.inicio,
      fim: dados.meta.fim,
      valorCentavos: 1234,
      faturaId: null,
    },
  ];
  dados.financeiro.adicionaisCentavos = 5801;
  dados.financeiro.receitaCentavos = 113565;
  dados.financeiro.resultadoCentavos = 34346;
  dados.financeiro.aFaturarCentavos = 66456;
  return dados;
}

const dados = fechamentoSintetico();
const esperado = {
  diariasCentavos: 100030,
  horasExtrasCentavos: 7734,
  domingoFeriadoCentavos: 0,
  adicionalDiarioCentavos: 0,
  outrosAdicionaisCentavos: 1234,
  containersCentavos: 4567,
  ajustesCentavos: 0,
};

assert.deepEqual(extrairComponentesDoFechamento(dados, [CONTAINER_ID]), esperado);

const base = validarBaseComercial({
  fonte: {
    arquivo: "base-comercial-sintetica.json",
    sha256: "a".repeat(64),
  },
  cliente: { id: "cli-ouro", nome: "Cliente Ouro" },
  periodo: { inicio: "2026-03-01", fim: "2026-03-15" },
  quantidadeApontamentos: 12,
  quantidadeColaboradores: 7,
  componentes: esperado,
  totalCentavos: 113565,
});

const conciliacao = conciliarBaseComercial(base, dados, [CONTAINER_ID]);
assert.equal(conciliacao.confere, true);
assert.equal(conciliacao.diferencas.length, 0);
assert.equal(conciliacao.totalFechamentoCentavos, 113565);

const divergente = structuredClone(base);
divergente.componentes.containersCentavos++;
divergente.totalCentavos++;
const diferenca = conciliarBaseComercial(divergente, dados, [CONTAINER_ID]);
assert.equal(diferenca.confere, false);
assert.deepEqual(diferenca.diferencas, [
  {
    campo: "componentes.containersCentavos",
    base: 4568,
    fechamento: 4567,
    diferencaCentavos: -1,
  },
  { campo: "totalCentavos", base: 113566, fechamento: 113565, diferencaCentavos: -1 },
]);

assert.throws(
  () => validarBaseComercial({ ...base, fonte: { ...base.fonte, sha256: "invalido" } }),
  /SHA-256/,
);
assert.throws(
  () => validarBaseComercial({ ...base, totalCentavos: base.totalCentavos + 1 }),
  /soma dos componentes/,
);

const [xlsxInterno, xlsxCliente] = await Promise.all([
  gerarXlsxDoFechamento(dados),
  gerarXlsxDoCliente(dados),
]);
assert.ok(lerZip(xlsxInterno).has("xl/worksheets/sheet3.xml"));
assert.ok(lerZip(xlsxCliente).has("xl/worksheets/sheet2.xml"));
const zipCliente = lerZip(xlsxCliente);
const stringsCliente = lerStringsCompartilhadas(zipCliente.get("xl/sharedStrings.xml"));
const celulasCliente = lerPlanilha(zipCliente.get("xl/worksheets/sheet1.xml"), stringsCliente);
const linhaTotal = [...celulasCliente]
  .find(([, c]) => c.texto === "Total do fechamento")[0]
  .slice(1);
assert.equal(celulasCliente.get(`L${linhaTotal}`).bruto, "1135.65");
const linhaContainer = [...celulasCliente]
  .find(([, c]) => c.texto?.includes("Descarga de dois containers"))[0]
  .match(/\d+$/)[0];
assert.equal(celulasCliente.get(`K${linhaContainer}`).bruto, "45.67");

const casos = [];
function caso(nome, executar) {
  try {
    executar();
    console.log(`PASS ${nome}`);
  } catch (erro) {
    casos.push(`${nome}: ${erro.message}`);
  }
}
caso("ajuste negativo legítimo", () => {
  const negativa = structuredClone(base);
  negativa.componentes.ajustesCentavos = -375;
  negativa.totalCentavos -= 375;
  const fechamento = structuredClone(dados);
  fechamento.financeiro.ajusteCentavos = -375;
  fechamento.financeiro.ajusteFaturadoCentavos = -375;
  fechamento.ajustesFaturados = [
    { faturaId: "sintetica", descricao: "Ajuste signed", valorCentavos: -375 },
  ];
  fechamento.financeiro.receitaCentavos -= 375;
  assert.equal(conciliarBaseComercial(negativa, fechamento, [CONTAINER_ID]).confere, true);
});
caso("ajuste sem lastro e contagens impossíveis são recusados", () => {
  const semLastro = structuredClone(dados);
  semLastro.financeiro.ajusteCentavos += 100;
  semLastro.financeiro.receitaCentavos += 100;
  assert.throws(() => extrairComponentesDoFechamento(semLastro, [CONTAINER_ID]));
  assert.throws(() =>
    extrairComponentesDoFechamento({ ...dados, colaboradores: [] }, [CONTAINER_ID]),
  );
  assert.throws(() =>
    extrairComponentesDoFechamento({ ...dados, meta: { ...dados.meta, linhasLidas: 0 } }, [
      CONTAINER_ID,
    ]),
  );
});
caso("centavos fracionários não se anulam na soma", () => {
  const invalido = structuredClone(dados);
  invalido.adicionais[1].valorCentavos += 0.5;
  invalido.adicionais.push({ ...invalido.adicionais[0], id: "fracao", valorCentavos: -0.5 });
  assert.throws(() => extrairComponentesDoFechamento(invalido, [CONTAINER_ID]));
});
caso("vínculo de Container desconhecido é recusado", () => {
  assert.throws(() => extrairComponentesDoFechamento(dados, ["inexistente"]));
});
caso("adicional duplicado é recusado mesmo com total adulterado", () => {
  const invalido = structuredClone(dados);
  invalido.adicionais.push(invalido.adicionais[0]);
  invalido.financeiro.receitaCentavos += 4567;
  assert.throws(() => extrairComponentesDoFechamento(invalido, [CONTAINER_ID]));
});
caso("período impossível ou invertido é recusado", () => {
  for (const periodo of [
    { inicio: "2026-02-30", fim: "2026-03-15" },
    { inicio: "2026-03-16", fim: "2026-03-15" },
  ])
    assert.throws(() => validarBaseComercial({ ...base, periodo }));
});
caso("snapshot de versão incorreta ou conciliação divergente é recusado", () => {
  for (const alteracao of [
    { versao: 666 },
    { conciliacao: [{ confere: false }] },
    { detalhes: [] },
  ]) {
    assert.throws(() => conciliarBaseComercial(base, { ...dados, ...alteracao }, [CONTAINER_ID]));
  }
});
caso("CLI verifica bytes da fonte e códigos de saída", () => {
  const pasta = mkdtempSync(join(tmpdir(), "fin13-cli-"));
  try {
    const fonte = Buffer.from("modelo comercial sintético; não é Dynamis");
    const entrada = structuredClone(base);
    entrada.fonte = {
      arquivo: "fonte.txt",
      sha256: createHash("sha256").update(fonte).digest("hex"),
    };
    writeFileSync(join(pasta, "fonte.txt"), fonte);
    writeFileSync(join(pasta, "base.json"), JSON.stringify(entrada));
    writeFileSync(join(pasta, "fechamento.json"), JSON.stringify(dados));
    writeFileSync(join(pasta, "containers.json"), JSON.stringify([CONTAINER_ID]));
    const rodar = () =>
      spawnSync(
        process.execPath,
        [
          "--experimental-strip-types",
          "--import",
          "./scripts/_resolver-ts.mjs",
          "scripts/conciliar-fin-pr-13.mjs",
          join(pasta, "base.json"),
          join(pasta, "fechamento.json"),
          join(pasta, "containers.json"),
        ],
        { encoding: "utf8" },
      );
    assert.equal(rodar().status, 0);
    entrada.componentes.diariasCentavos++;
    entrada.totalCentavos++;
    writeFileSync(join(pasta, "base.json"), JSON.stringify(entrada));
    assert.equal(rodar().status, 1);
    writeFileSync(join(pasta, "fonte.txt"), "fonte alterada");
    assert.equal(rodar().status, 2);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});
assert.deepEqual(casos, []);
console.log("FIN-PR-13: conciliação, casos negativos, CLI e dois XLSX passaram.");
