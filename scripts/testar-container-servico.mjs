/**
 * FIN-PR-11A — teste puro, sem rede, banco ou dados reais.
 * Rodar com: npm run test:container-servico
 */
import assert from "node:assert/strict";
import {
  dataCivilValida,
  prepararLoteDeContainers,
  reaisEmCentavos,
  validarLoteDeContainers,
} from "../src/lib/container-servico.ts";

let passou = 0;
function caso(nome, executar) {
  executar();
  passou++;
  console.log("  PASS  " + nome);
}
const base = {
  clienteId: "cliente-ficticio",
  operacaoId: null,
  solicitadoEm: "2026-11-03",
  executadoEm: "2026-11-04",
  descricao: "Descarga — produto sintético, container de 40 pés",
  quantidade: 3,
  totalCobrado: "1500,00",
  participantes: [
    { colaboradorId: "colab-1", valorDevido: "450,00" },
    { colaboradorId: "colab-2", valorDevido: "450.00" },
  ],
  modalidadeCusto: "por_pessoa",
};
const erros = (altera) => validarLoteDeContainers({ ...base, ...altera });
function recusa(altera, trecho) {
  assert.ok(
    erros(altera).some((e) => e.includes(trecho)),
    "Esperava erro: " + trecho,
  );
}
console.log("FIN-PR-11A: contrato puro de containers");
caso("1. 0, decimal e inteiro para centavos exatos", () => {
  assert.equal(reaisEmCentavos("0"), 0);
  assert.equal(reaisEmCentavos("0,01"), 1);
  assert.equal(reaisEmCentavos("12,5"), 1250);
  assert.equal(reaisEmCentavos("1500.00"), 150000);
  assert.equal(reaisEmCentavos("9999999999,99"), 999999999999);
});
caso("2. vazio/negativo/3 casas/milhar/valor maior que NUMERIC(12,2) recusados", () => {
  for (const x of ["", "-1", "1,001", "1.234,56", "10000000000", "1e3", "NaN", "Infinity"]) {
    assert.equal(reaisEmCentavos(x), null, x);
  }
});
caso("3. datas reais e ano bissexto", () => {
  assert.equal(dataCivilValida("2028-02-29"), true);
  for (const x of [
    "2026-02-29",
    "2026-02-30",
    "2026-13-01",
    "2026-00-01",
    "2026-01-00",
    "2026-1-1",
    "abc",
  ]) {
    assert.equal(dataCivilValida(x), false, x);
  }
});
caso("4. serviço padrão válido, sem tabela fixa de preços", () => {
  assert.deepEqual(validarLoteDeContainers(base), []);
  const x = prepararLoteDeContainers(base);
  assert.equal(x.quantidade, 3);
  assert.equal(x.receitaCentavos, 150000);
  assert.equal(x.custoTotalCentavos, 90000);
  assert.equal(x.competenciaCobranca, null);
  assert.equal(x.referencia, null);
});
caso("5. cliente obrigatório", () => recusa({ clienteId: " " }, "cliente"));
caso("6. operação é opcional, mas não pode ser vazia", () => {
  assert.deepEqual(erros({ operacaoId: undefined }), []);
  recusa({ operacaoId: "  " }, "operação");
});
caso("7. solicitação com um dia de antecedência é válida", () => {
  assert.deepEqual(erros({ solicitadoEm: "2026-11-03" }), []);
});
caso("8. solicitação no mesmo dia ou posterior é recusada", () => {
  recusa({ solicitadoEm: "2026-11-04" }, "dia anterior");
  recusa({ solicitadoEm: "2026-11-05" }, "dia anterior");
});
caso("9. datas inexistentes são recusadas", () =>
  recusa({ solicitadoEm: "2026-02-30" }, "datas válidas"),
);
caso("10. descrição obrigatória e limitada", () => {
  recusa({ descricao: "   " }, "Descreva");
  recusa({ descricao: "A".repeat(501) }, "500 caracteres");
});
caso("11. quantidade física positiva e inteira", () => {
  for (const quantidade of [0, -1, 1.5, NaN, Infinity]) {
    recusa({ quantidade }, "quantidade inteira");
  }
});
caso("12. preço total negociado válido e positivo", () => {
  for (const totalCobrado of ["", "0", "-1", "100,001"]) {
    recusa({ totalCobrado }, "valor total negociado");
  }
});
caso("13. referência operacional opcional com limite", () =>
  recusa({ referencia: "x".repeat(201) }, "referência"),
);
caso("14. participantes são obrigatórios, sem duplicidade", () => {
  recusa({ participantes: [] }, "participantes");
  recusa(
    {
      participantes: [
        { colaboradorId: "x", valorDevido: "1" },
        { colaboradorId: "x", valorDevido: "1" },
      ],
    },
    "duas vezes",
  );
  recusa({ participantes: [{ colaboradorId: "", valorDevido: "1" }] }, "colaborador");
});
caso("15. custo individual não aceita valor inválido", () => {
  recusa({ participantes: [{ colaboradorId: "x", valorDevido: "10,003" }] }, "custos individuais");
});
caso("16. custo total é soma das partes, sem usar diária nem alterar receita", () => {
  const x = prepararLoteDeContainers({
    ...base,
    participantes: [
      { colaboradorId: "x", valorDevido: "300,10" },
      { colaboradorId: "y", valorDevido: "599,90" },
    ],
  });
  assert.equal(x.custoTotalCentavos, 90000);
  assert.equal(x.receitaCentavos, 150000);
});
caso("17. modo total distribuído exige partes de soma exata, não faz rateio automático", () => {
  const distrib = {
    ...base,
    modalidadeCusto: "total_distribuido",
    totalDistribuido: "900,00",
  };
  assert.deepEqual(validarLoteDeContainers(distrib), []);
  recusa({ ...distrib, totalDistribuido: "899,99" }, "igualar");
  recusa({ ...distrib, totalDistribuido: undefined }, "igualar");
});
caso("18. modo por pessoa recusa total extra que poderia gerar segunda contagem", () => {
  recusa({ totalDistribuido: "900" }, "não deve enviar");
});
caso("19. modalidade desconhecida é recusada", () =>
  recusa({ modalidadeCusto: "outro" }, "desconhecida"),
);
caso("20. competência de cobrança pode diferir da execução", () => {
  const x = prepararLoteDeContainers({
    ...base,
    competenciaCobranca: { inicio: "2026-10-16", fim: "2026-10-31" },
  });
  assert.deepEqual(x.competenciaCobranca, { inicio: "2026-10-16", fim: "2026-10-31" });
});
caso("21. competência inválida é recusada", () => {
  recusa({ competenciaCobranca: { inicio: "2026-11-30", fim: "2026-11-01" } }, "competência");
  recusa({ competenciaCobranca: { inicio: "2026-02-30", fim: "2026-02-28" } }, "competência");
});
caso("22. normalização não cria preço unitário, fatura ou pagamento confirmado", () => {
  const x = prepararLoteDeContainers({
    ...base,
    descricao: "  Descarga sintética  ",
    referencia: "  protocolo-01  ",
  });
  assert.equal(x.descricao, "Descarga sintética");
  assert.equal(x.referencia, "protocolo-01");
  assert.equal(Object.hasOwn(x, "precoUnitario"), false);
  assert.equal(Object.hasOwn(x, "invoice_id"), false);
  assert.equal(Object.hasOwn(x, "pago"), false);
});
caso("23. dados inválidos não são preparados", () => {
  assert.throws(() => prepararLoteDeContainers({ ...base, quantidade: 0 }), /quantidade/);
});
console.log("FIN-PR-11A: " + passou + "/23 cenários aprovados");
