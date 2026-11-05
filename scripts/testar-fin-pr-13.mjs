import assert from "node:assert/strict";

import {
  conciliarBaseComercial,
  extrairComponentesDoFechamento,
  validarBaseComercial,
} from "../src/lib/fechamento/conciliacao-comercial.ts";
import { gerarXlsxDoCliente } from "../src/lib/fechamento/xlsx-cliente.ts";
import { gerarXlsxDoFechamento } from "../src/lib/fechamento/xlsx.ts";
import { dadosDoOuro } from "./_fechamento-exportacao.mjs";
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

console.log("FIN-PR-13: conciliação sintética e as duas exportações XLSX passaram.");
