/**
 * Testes da tela /fechamento (etapa 4.4).
 *
 * COMO RODAR:
 *
 *   npm run test:fechamento-tela
 *
 * Sem framework, Node executando o TypeScript via `--experimental-strip-types`,
 * com o hook `_resolver-ts.mjs`. Sai com código diferente de zero em qualquer
 * falha.
 *
 * DUAS METADES, como nas demais telas do projeto (não há navegador na suíte):
 *
 *   - COMPORTAMENTO do que a tela usa e que é puro: o cliente HTTP
 *     (`buscar.ts`), as opções do TanStack Query (`consulta.ts`, exercitadas com
 *     um `QueryClient` de verdade e um `fetch` falso) e a apresentação
 *     (`apresentacao.ts`);
 *   - FORMA LITERAL dos componentes: o que eles NÃO podem fazer (falar com o
 *     Supabase, calcular dinheiro, recriar o calendário) e o que PRECISAM ter
 *     (texto, estados, acessibilidade, menu, guard).
 *
 * BLOCOS
 *
 *   A. cliente HTTP   B. TanStack Query   C. apresentação   D. rota e menu
 *   E. a tela não calcula, não fala com o banco, não recria o calendário
 *   F. texto, estados e acessibilidade
 */

import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { readFileSync } from "node:fs";

import { agregarFechamento } from "../src/lib/fechamento/agregar.ts";
import {
  ErroDaApiDoFechamento,
  buscarFechamento,
  ehFechamentoData,
  mensagemDoErro,
  podeTentarDeNovo,
} from "../src/lib/fechamento/buscar.ts";
import {
  RAIZ_DA_CHAVE_DO_FECHAMENTO,
  chaveDoFechamento,
  opcoesDoFechamento,
} from "../src/lib/fechamento/consulta.ts";
import {
  ROTULO_DA_SEVERIDADE,
  anosParaEscolher,
  ehSomenteFalta,
  estadoDoResultado,
  horas,
  margem,
  mesAtualNoBrasil,
  moeda,
  periodoDoPreset,
  rotuloDaAtualizacao,
  rotuloDoPeriodo,
  textoDoAlerta,
} from "../src/lib/fechamento/apresentacao.ts";
import { normalizarLinhas } from "../src/lib/fechamento/normalizar.ts";
import { primeiraQuinzena, segundaQuinzena } from "../src/lib/fechamento/periodo.ts";

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

async function erroDe(acao) {
  try {
    await acao();
    return null;
  } catch (erro) {
    return erro;
  }
}

const pausa = (ms = 15) => new Promise((resolver) => setTimeout(resolver, ms));
const semEspacoDuro = (texto) => texto.replace(/ /g, " ");
const textoDe = (arquivo) => readFileSync(new URL(`../${arquivo}`, import.meta.url), "utf8");
const semComentarios = (fonte) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const CLIENTE = "33333333-3333-4333-8333-333333333333";
const FILTROS = { clienteId: CLIENTE, inicio: "2026-03-01", fim: "2026-03-15" };

/** Um FechamentoData REAL: a fixture ouro passando pelo núcleo. */
const ouro = JSON.parse(textoDe("scripts/fixtures/fechamento-paridade.json"));
const DADOS = agregarFechamento(normalizarLinhas(structuredClone(ouro.linhas)), ouro.contexto);

/** `fetch` falso que registra as chamadas. */
function fetchFalso(resposta) {
  const chamadas = [];
  const impl = async (url, init) => {
    chamadas.push({ url, init });
    const { status, corpo, texto } = typeof resposta === "function" ? resposta() : resposta;
    return new Response(texto ?? JSON.stringify(corpo), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { chamadas, impl };
}

/* ================================================================== */
console.log("\nA. Cliente HTTP\n");

{
  const f = fetchFalso({ status: 200, corpo: DADOS });
  const dados = await buscarFechamento(FILTROS, { fetchImpl: f.impl });
  verificar("A1. devolve o FechamentoData da API", dados.meta.clienteNome, DADOS.meta.clienteNome);
  verificar("A2. uma única requisição", f.chamadas.length, 1);

  const url = new URL(f.chamadas[0].url, "http://localhost");
  verificar("A3. chama /api/fechamento", url.pathname, "/api/fechamento");
  verificar("A4. cliente na URL", url.searchParams.get("cliente"), CLIENTE);
  verificar("A5. início na URL", url.searchParams.get("inicio"), "2026-03-01");
  verificar("A6. fim na URL", url.searchParams.get("fim"), "2026-03-15");
  verificar(
    "A7. só esses três parâmetros",
    [...url.searchParams.keys()].sort().join(","),
    "cliente,fim,inicio",
  );
  verificar("A8. método GET", f.chamadas[0].init.method, "GET");
  verificar("A9. sem cache no navegador", f.chamadas[0].init.cache, "no-store");
  verificar("A10. mesma origem (cookie de sessão)", f.chamadas[0].init.credentials, "same-origin");
  verificar("A11. nenhum corpo enviado", "body" in f.chamadas[0].init, false);
  verificar("A12. sem sinal quando ninguém passou um", "signal" in f.chamadas[0].init, false);
}
{
  const controle = new AbortController();
  const f = fetchFalso({ status: 200, corpo: DADOS });
  await buscarFechamento(FILTROS, { fetchImpl: f.impl, signal: controle.signal });
  verificar(
    "A13. o AbortSignal chega ao fetch",
    f.chamadas[0].init.signal === controle.signal,
    true,
  );
}

for (const [status, codigo, mensagemDaApi] of [
  [400, "filtro-invalido", "O período pode ter no máximo 31 dias."],
  [401, "nao-autenticado", "Faça login para continuar."],
  [403, "acesso-negado", "Acesso negado."],
  [404, "cliente-nao-encontrado", "Cliente não encontrado."],
  [409, "dados-mudaram", "mudou"],
  [422, "leitura-incompleta", "x"],
  [422, "dado-inconsistente", "x"],
  [500, "erro-interno", "x"],
]) {
  const f = fetchFalso({ status, corpo: { erro: { codigo, mensagem: mensagemDaApi } } });
  const erro = await erroDe(() => buscarFechamento(FILTROS, { fetchImpl: f.impl }));
  verificar(
    `A14. HTTP ${status}/${codigo} vira ErroDaApiDoFechamento`,
    erro instanceof ErroDaApiDoFechamento,
    true,
  );
  verificar(
    `A15. e guarda status e código (${codigo})`,
    `${erro.status}/${erro.codigo}`,
    `${status}/${codigo}`,
  );
}

{
  const f = fetchFalso({ status: 502, texto: "<html>Bad Gateway SELECT * FROM x</html>" });
  const erro = await erroDe(() => buscarFechamento(FILTROS, { fetchImpl: f.impl }));
  verificar(
    "A16. corpo que não é JSON: ainda é erro, com código desconhecido",
    erro?.codigo,
    "desconhecido",
  );
  verificar(
    "A17. e o corpo cru NÃO vira mensagem",
    /SELECT|Bad Gateway/.test(mensagemDoErro(erro)),
    false,
  );
}
{
  const f = fetchFalso({ status: 200, corpo: { versao: 2, qualquer: "coisa" } });
  const erro = await erroDe(() => buscarFechamento(FILTROS, { fetchImpl: f.impl }));
  verificar(
    "A18. 200 com corpo de forma inesperada é erro, não dado",
    erro?.codigo,
    "resposta-invalida",
  );
}
{
  const f = fetchFalso({ status: 200, texto: "isto não é json" });
  const erro = await erroDe(() => buscarFechamento(FILTROS, { fetchImpl: f.impl }));
  verificar("A19. 200 com corpo ilegível é erro, não dado", erro?.codigo, "resposta-invalida");
}
{
  const erro = await erroDe(() =>
    buscarFechamento(FILTROS, {
      fetchImpl: async () => {
        throw new TypeError("fetch failed: ECONNRESET db.internal:5432");
      },
    }),
  );
  verificar("A20. falha de rede vira erro de rede", erro?.codigo, "rede");
  verificar(
    "A21. e a mensagem técnica não vaza",
    /ECONNRESET|5432|internal/.test(erro?.message ?? ""),
    false,
  );
}
{
  const cancelado = Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
  const erro = await erroDe(() =>
    buscarFechamento(FILTROS, {
      fetchImpl: async () => {
        throw cancelado;
      },
    }),
  );
  verificar("A22. cancelamento passa intacto (não é falha de rede)", erro === cancelado, true);
}

verificar(
  "A23. a forma de um FechamentoData real é aceita",
  ehFechamentoData(JSON.parse(JSON.stringify(DADOS))),
  true,
);
verificar(
  "A24. sem colaboradores em array é recusado",
  ehFechamentoData({ ...DADOS, colaboradores: null }),
  false,
);
verificar(
  "A25. com valor não inteiro é recusado",
  ehFechamentoData({ ...DADOS, consolidado: { ...DADOS.consolidado, faturadoCentavos: 10.5 } }),
  false,
);
verificar("A26. nulo é recusado", ehFechamentoData(null), false);

{
  const casos = [
    ["nao-autenticado", "Sua sessão expirou. Entre novamente para continuar.", false],
    ["acesso-negado", "Você não tem permissão para ver o fechamento.", false],
    ["filtro-invalido", "Confira o cliente e o período informados.", false],
    ["cliente-nao-encontrado", "Cliente não encontrado.", false],
    ["dados-mudaram", "Os dados mudaram durante a leitura. Tente novamente.", true],
    [
      "leitura-incompleta",
      "Não foi possível garantir que todos os lançamentos foram lidos. Tente novamente ou reduza o período.",
      true,
    ],
    [
      "dado-inconsistente",
      "Há um lançamento com dado inconsistente, e o fechamento não pode ser calculado. Avise o suporte.",
      false,
    ],
    ["erro-interno", "Não foi possível carregar o fechamento. Tente novamente.", true],
    ["rede", "Não foi possível carregar o fechamento. Tente novamente.", true],
    ["resposta-invalida", "Não foi possível carregar o fechamento. Tente novamente.", true],
    ["desconhecido", "Não foi possível carregar o fechamento. Tente novamente.", true],
  ];
  for (const [codigo, frase, repetir] of casos) {
    const erro = new ErroDaApiDoFechamento(500, codigo, "");
    verificar(`A27. mensagem de ${codigo}`, mensagemDoErro(erro), frase);
    verificar(`A28. "Tentar novamente" para ${codigo}`, podeTentarDeNovo(erro), repetir);
  }
  verificar(
    "A29. a mensagem de filtro inválido (escrita para o usuário) é reaproveitada",
    mensagemDoErro(
      new ErroDaApiDoFechamento(400, "filtro-invalido", "O período pode ter no máximo 31 dias."),
    ),
    "O período pode ter no máximo 31 dias.",
  );
  verificar(
    "A30. erro desconhecido (não da API) tem mensagem padrão",
    mensagemDoErro(new Error("stack SQL token")),
    "Não foi possível carregar o fechamento. Tente novamente.",
  );
  verificar(
    "A31. texto solto também",
    mensagemDoErro("x"),
    "Não foi possível carregar o fechamento. Tente novamente.",
  );
  verificar(
    "A32. nulo também",
    mensagemDoErro(null),
    "Não foi possível carregar o fechamento. Tente novamente.",
  );
  verificar(
    "A33. erro que não é da API pode tentar de novo",
    podeTentarDeNovo(new Error("x")),
    true,
  );

  const suja = new ErroDaApiDoFechamento(
    500,
    "erro-interno",
    "SECRET-ID-9 SELECT * FROM t eyJhbGciOi.token at Object.<anonymous>",
  );
  verificar(
    "A34. a mensagem exibida nunca carrega o texto do servidor, exceto o de filtro",
    /SECRET|SELECT|eyJ|Object\./.test(mensagemDoErro(suja)),
    false,
  );
}

/* ================================================================== */
console.log("\nB. TanStack Query (QueryClient de verdade, fetch falso)\n");

{
  igual("B1. a chave é [fechamento, cliente, início, fim]", chaveDoFechamento(FILTROS), [
    "fechamento",
    CLIENTE,
    "2026-03-01",
    "2026-03-15",
  ]);
  igual("B2. sem filtros a chave é neutra", chaveDoFechamento(null), [
    "fechamento",
    null,
    null,
    null,
  ]);
  verificar("B3. a raiz da chave", RAIZ_DA_CHAVE_DO_FECHAMENTO, "fechamento");
  verificar(
    "B4. outro cliente é outra chave",
    JSON.stringify(
      chaveDoFechamento({ ...FILTROS, clienteId: "33333333-3333-4333-8333-333333333399" }),
    ) !== JSON.stringify(chaveDoFechamento(FILTROS)),
    true,
  );
  verificar(
    "B5. outro início é outra chave",
    JSON.stringify(chaveDoFechamento({ ...FILTROS, inicio: "2026-03-02" })) !==
      JSON.stringify(chaveDoFechamento(FILTROS)),
    true,
  );
  verificar(
    "B6. outro fim é outra chave",
    JSON.stringify(chaveDoFechamento({ ...FILTROS, fim: "2026-03-16" })) !==
      JSON.stringify(chaveDoFechamento(FILTROS)),
    true,
  );

  const o = opcoesDoFechamento(FILTROS);
  verificar("B7. staleTime é 0", o.staleTime, 0);
  verificar("B8. gcTime é 0: nada fica em cache entre visitas", o.gcTime, 0);
  verificar("B9. habilitada com filtros", o.enabled, true);
  verificar("B10. desabilitada sem filtros", opcoesDoFechamento(null).enabled, false);
  verificar("B11. sem retentativa silenciosa", o.retry, false);
  verificar("B12. sem refetch ao focar a janela", o.refetchOnWindowFocus, false);
  verificar("B13. sem refetch ao reconectar", o.refetchOnReconnect, false);
}
{
  const f = fetchFalso({ status: 200, corpo: DADOS });
  const cliente = new QueryClient();
  const dados = await cliente.fetchQuery(opcoesDoFechamento(FILTROS, { fetchImpl: f.impl }));
  verificar("B14. a consulta devolve o FechamentoData", dados.meta.clienteId, DADOS.meta.clienteId);
  verificar("B15. chamou /api/fechamento", f.chamadas[0].url.startsWith("/api/fechamento?"), true);
  verificar(
    "B16. repassou um AbortSignal de verdade ao fetch",
    f.chamadas[0].init.signal instanceof AbortSignal,
    true,
  );
  cliente.clear();
}
{
  const f = fetchFalso({
    status: 403,
    corpo: { erro: { codigo: "acesso-negado", mensagem: "Acesso negado." } },
  });
  const cliente = new QueryClient();
  const erro = await erroDe(() =>
    cliente.fetchQuery(opcoesDoFechamento(FILTROS, { fetchImpl: f.impl })),
  );
  verificar(
    "B17. HTTP não-2xx REJEITA a consulta (não vira resultado vazio)",
    erro instanceof ErroDaApiDoFechamento,
    true,
  );
  verificar("B18. e não foi repetida em silêncio", f.chamadas.length, 1);
  cliente.clear();
}
{
  const f = fetchFalso({ status: 200, corpo: DADOS });
  const cliente = new QueryClient();
  const observador = new QueryObserver(cliente, opcoesDoFechamento(null, { fetchImpl: f.impl }));
  const cancelar = observador.subscribe(() => {});
  await pausa();
  verificar("B19. sem filtros nenhuma requisição é feita", f.chamadas.length, 0);
  cancelar();
  cliente.clear();
}
{
  // Troca de filtros: a consulta anterior, em voo, é CANCELADA pelo AbortSignal.
  const sinais = [];
  const lento = (url, init) =>
    new Promise((_, rejeitar) => {
      sinais.push(init.signal);
      init.signal.addEventListener("abort", () =>
        rejeitar(Object.assign(new Error("abortado"), { name: "AbortError" })),
      );
    });
  const rapido = fetchFalso({ status: 200, corpo: DADOS });

  const cliente = new QueryClient();
  const observador = new QueryObserver(cliente, opcoesDoFechamento(FILTROS, { fetchImpl: lento }));
  const cancelar = observador.subscribe(() => {});
  await pausa();

  verificar("B20. a primeira consulta está em voo", sinais.length, 1);
  verificar("B21. e ainda não foi cancelada", sinais[0].aborted, false);

  observador.setOptions(
    opcoesDoFechamento({ ...FILTROS, fim: "2026-03-10" }, { fetchImpl: rapido.impl }),
  );
  await pausa(40);

  verificar("B22. trocar os filtros CANCELA a consulta anterior", sinais[0].aborted, true);
  verificar("B23. e a nova consulta foi feita", rapido.chamadas.length, 1);
  verificar(
    "B24. com o novo período",
    new URL(rapido.chamadas[0].url, "http://localhost").searchParams.get("fim"),
    "2026-03-10",
  );
  verificar(
    "B25. o resultado atual é o da nova consulta",
    observador.getCurrentResult().data?.meta.clienteId,
    DADOS.meta.clienteId,
  );
  cancelar();
  cliente.clear();
}

/* ================================================================== */
console.log("\nC. Apresentação\n");

for (const [centavos, esperado] of [
  [0, "R$ 0,00"],
  [10, "R$ 0,10"],
  [30, "R$ 0,30"],
  [15010, "R$ 150,10"],
  [60655, "R$ 606,55"],
  [107764, "R$ 1.077,64"],
  [-2000, "-R$ 20,00"],
  [123456789, "R$ 1.234.567,89"],
]) {
  verificar(`C1. moeda(${centavos}) = ${esperado}`, semEspacoDuro(moeda(centavos)), esperado);
}
verificar("C2. margem nula é traço", margem(null), "—");
verificar("C3. margem 125‰ = 12,5%", margem(125), "12,5%");
verificar("C4. margem negativa", margem(-200), "-20,0%");
verificar("C5. margem zero", margem(0), "0,0%");
verificar("C6. margem 667‰ = 66,7%", margem(667), "66,7%");
verificar("C7. margem 1000‰ = 100,0%", margem(1000), "100,0%");
verificar("C8. horas: 90 min", horas(90), "1h30");
verificar("C9. horas: 0 min", horas(0), "0h00");
verificar("C10. horas: 165 min", horas(165), "2h45");
verificar(
  "C11. rótulo do período",
  rotuloDoPeriodo("2026-03-01", "2026-03-15"),
  "01/03/2026 a 15/03/2026",
);
verificar(
  "C12. a atualização é no fuso do Brasil",
  rotuloDaAtualizacao("2026-03-16T15:30:00.000Z"),
  "16/03/2026, 12:30",
);
verificar("C13. data de atualização inválida é traço", rotuloDaAtualizacao("quando"), "—");

igual(
  "C14. 1ª quinzena do preset = periodo.ts",
  periodoDoPreset(2026, 3, "primeira"),
  primeiraQuinzena(2026, 3),
);
igual(
  "C15. 2ª quinzena do preset = periodo.ts",
  periodoDoPreset(2028, 2, "segunda"),
  segundaQuinzena(2028, 2),
);
igual("C16. 2ª quinzena de fevereiro/2026", periodoDoPreset(2026, 2, "segunda"), {
  inicio: "2026-02-16",
  fim: "2026-02-28",
});
igual("C17. 2ª quinzena de fevereiro/2028 (bissexto)", periodoDoPreset(2028, 2, "segunda"), {
  inicio: "2028-02-16",
  fim: "2028-02-29",
});

// O mês corrente é o do BRASIL, e não o do servidor: 01:00 UTC de 1º/03 ainda é 28/02 em São Paulo.
igual(
  "C18. 01h UTC de 1º/03 ainda é fevereiro no Brasil",
  mesAtualNoBrasil(new Date("2026-03-01T01:00:00Z")),
  { ano: 2026, mes: 2 },
);
igual(
  "C19. 03h UTC de 1º/03 já é março no Brasil",
  mesAtualNoBrasil(new Date("2026-03-01T03:00:00Z")),
  { ano: 2026, mes: 3 },
);
igual("C20. virada de ano no Brasil", mesAtualNoBrasil(new Date("2027-01-01T02:59:00Z")), {
  ano: 2026,
  mes: 12,
});
igual(
  "C21. anos oferecidos: cinco para trás, um para frente",
  anosParaEscolher(2026),
  [2027, 2026, 2025, 2024, 2023, 2022, 2021],
);
verificar("C22. nunca passa do ano máximo do período", anosParaEscolher(2100)[0], 2100);
verificar("C23. nunca passa do ano mínimo do período", anosParaEscolher(2001).at(-1), 2000);

const alerta = (codigo, quantidade, severidade = "atencao") => ({
  codigo,
  severidade,
  quantidade,
  entryIds: [],
});
verificar(
  "C24. duplicidade: texto e quantidade",
  textoDoAlerta(alerta("duplicidade", 2, "critico")).startsWith("2 lançamentos em duplicidade"),
  true,
);
verificar(
  "C25. singular",
  textoDoAlerta(alerta("folha-aberta", 1)).startsWith("1 lançamento em folha"),
  true,
);
verificar(
  "C26. plural",
  textoDoAlerta(alerta("folha-aberta", 3)).startsWith("3 lançamentos em folha"),
  true,
);
verificar(
  "C27. falta no singular",
  textoDoAlerta(alerta("falta", 1, "informacao")).startsWith("1 falta no período"),
  true,
);
verificar(
  "C28. falta no plural",
  textoDoAlerta(alerta("falta", 2, "informacao")).startsWith("2 faltas no período"),
  true,
);
for (const codigo of [
  "duplicidade",
  "folha-aberta",
  "dado-incompleto",
  "sem-contrato",
  "diaria-zerada",
  "falta",
]) {
  const texto = textoDoAlerta(alerta(codigo, 4));
  verificar(`C29. ${codigo}: traz a quantidade`, /^4 /.test(texto), true);
  verificar(
    `C30. ${codigo}: não promete correção automática`,
    /corrig|autom[aá]tic|resolvid/i.test(texto),
    false,
  );
  verificar(`C31. ${codigo}: sem a palavra "pago"`, /\bpag[oa]s?\b/i.test(texto), false);
}
igual("C32. rótulos de severidade", ROTULO_DA_SEVERIDADE, {
  critico: "Crítico",
  atencao: "Atenção",
  informacao: "Informativo",
});

{
  const so = DADOS.colaboradores.find((c) => c.employeeId === "emp-gabi");
  const com = DADOS.colaboradores.find((c) => c.employeeId === "emp-ana");
  verificar("C33. Gabi só tem falta", ehSomenteFalta(so), true);
  verificar("C34. Ana tem falta e diárias: não é só falta", ehSomenteFalta(com), false);
  verificar(
    "C35. a fixture completa: com lançamentos",
    estadoDoResultado(DADOS),
    "com-lancamentos",
  );
  const vazio = { ...DADOS, consolidado: { ...DADOS.consolidado, diarias: 0 }, faltas: 0 };
  verificar("C36. sem diárias e sem faltas: vazio", estadoDoResultado(vazio), "vazio");
  verificar(
    "C37. sem diárias e com faltas: somente faltas",
    estadoDoResultado({ ...vazio, faltas: 2 }),
    "somente-faltas",
  );
}

/* ================================================================== */
console.log("\nD. Rota, guard e menu\n");

const pagina = semComentarios(textoDe("src/app/(painel)/fechamento/page.tsx"));
const shell = textoDe("src/app/(painel)/_components/app-shell.tsx");
const testarPapel = textoDe("scripts/testar-papel.mjs");

verificar("D1. a rota /fechamento existe", pagina.length > 0, true);
verificar("D2. importa o guard central", /from "\.\.\/_exigir-admin"/.test(pagina), true);
verificar(
  "D3. chama exigirAdmin e devolve o bloqueio",
  /const bloqueio = await exigirAdmin\(\);\s*\n\s*if \(bloqueio\) return bloqueio;/.test(pagina),
  true,
);
verificar(
  "D4. o guard vem antes do painel",
  pagina.indexOf("await exigirAdmin()") < pagina.indexOf("<PainelFechamento />"),
  true,
);
verificar("D5. é Server Component (sem use client)", /use client/.test(pagina), false);
verificar(
  "D6. a página não duplica autenticação",
  /lerAcesso|user_roles|papeis|supabase/i.test(pagina),
  false,
);
verificar(
  "D7. o painel é client component",
  /^"use client";/.test(textoDe("src/app/(painel)/fechamento/painel-fechamento.tsx")),
  true,
);

verificar(
  "D8. o menu tem /fechamento",
  /\{ href: "\/fechamento", label: "Fechamento", icon: ClipboardCheck \}/.test(shell),
  true,
);
verificar(
  "D9. e fica entre Faturamento e Relatórios",
  shell.indexOf('href: "/faturamento"') < shell.indexOf('href: "/fechamento"') &&
    shell.indexOf('href: "/fechamento"') < shell.indexOf('href: "/relatorios"'),
  true,
);
verificar(
  "D10. o ícone vem do lucide-react já instalado",
  /ClipboardCheck,/.test(shell) && /from "lucide-react"/.test(shell),
  true,
);
verificar(
  "D11. o menu fica só no bloco do admin",
  /admin: \[[\s\S]*?\{ href: "\/fechamento"[\s\S]*?\],\n  operacional:/.test(shell),
  true,
);
verificar(
  "D12. testar-papel inclui a tela",
  testarPapel.includes('["fechamento", "PainelFechamento"]'),
  true,
);
verificar(
  "D13. testar-papel confere a API do fechamento",
  testarPapel.includes("src/app/api/fechamento/route.ts"),
  true,
);

/* ================================================================== */
console.log("\nE. A tela não calcula, não fala com o banco e não recria o calendário\n");

const ARQUIVOS_DA_TELA = [
  "painel-fechamento.tsx",
  "_resumo.tsx",
  "_alertas.tsx",
  "_tabela-colaboradores.tsx",
  "_detalhe-diario.tsx",
  "_hooks.ts",
  "_estilos.ts",
  "page.tsx",
];
const tela = Object.fromEntries(
  ARQUIVOS_DA_TELA.map((nome) => [
    nome,
    semComentarios(textoDe(`src/app/(painel)/fechamento/${nome}`)),
  ]),
);
const todaATela = Object.values(tela).join("\n");
const apoio = ["apresentacao", "buscar", "consulta"]
  .map((nome) => semComentarios(textoDe(`src/lib/fechamento/${nome}.ts`)))
  .join("\n");
const hooks = tela["_hooks.ts"];
const painel = tela["painel-fechamento.tsx"];

verificar(
  "E1. nenhum import do Supabase na tela",
  /integrations\/supabase|@supabase\//.test(todaATela + apoio),
  false,
);
verificar(
  "E2. nenhum from(...), select(...) ou rpc(...) na tela",
  /(?<!Array)\.from\s*\(|\.select\s*\(|\.rpc\s*\(/.test(todaATela),
  false,
);
verificar(
  "E3. nenhum cliente do navegador nem service_role",
  /criarClienteNavegador|criarClienteAdmin|service_role/.test(todaATela + apoio),
  false,
);
verificar(
  "E4. nenhum fetchAll, useLedger ou useEntries",
  /fetchAll|useLedger|useEntries|useTimesheets|useOperations/.test(todaATela + apoio),
  false,
);
verificar(
  "E5. a única leitura de tabela é a lista de clientes, por useClients",
  (todaATela.match(/from "@\/lib\/queries"/g) ?? []).length === 1 &&
    /import \{ useClients \} from "@\/lib\/queries"/.test(painel),
  true,
);
verificar(
  "E6. o hook usa as opções centrais (consulta.ts) e o useQuery",
  /useQuery\(opcoesDoFechamento\(filtros\)\)/.test(hooks) &&
    /from "@\/lib\/fechamento\/consulta"/.test(hooks),
  true,
);
verificar("E7. o hook chama a API só por buscar.ts", /fetch\s*\(/.test(hooks), false);
verificar("E8. buscar.ts chama /api/fechamento", /\/api\/fechamento\?/.test(apoio), true);
verificar(
  "E9. consulta.ts repassa o AbortSignal",
  /\{ \.\.\.busca, signal \}/.test(apoio) && /\{ signal \}: \{ signal: AbortSignal \}/.test(apoio),
  true,
);
verificar(
  "E10. a consulta só roda com filtros aplicados, não a cada tecla",
  /useFechamento\(aplicados\)/.test(painel) && !/useFechamento\(filtrosDoFormulario\)/.test(painel),
  true,
);
verificar(
  "E11. o formulário gera por submit",
  /<form onSubmit=\{gerar\}/.test(painel) && /type="submit"/.test(painel),
  true,
);
verificar(
  "E12. gerar só dispara com cliente e período válidos",
  /filtrosDoFormulario === null \|\| carregando/.test(painel),
  true,
);

verificar(
  "E13. nenhuma aritmética sobre campos de centavos nos componentes",
  /Centavos\s*[-+*/]|[-+*/]\s*\w*\.\w*Centavos/.test(todaATela),
  false,
);
verificar(
  "E14. nenhuma soma, redução nem acumulador nos componentes",
  /\.reduce\s*\(|\+=|-=|\*=/.test(todaATela),
  false,
);
verificar(
  "E15. nenhum arredondamento nem conversão decimal nos componentes",
  /Math\.(round|floor|ceil|trunc)|toFixed|parseFloat|\/\s*100\b/.test(todaATela),
  false,
);
verificar(
  "E16. nenhuma regra de margem nos componentes (só o campo pronto)",
  /Permil\s*[-+*/]|\/\s*faturado/i.test(todaATela),
  false,
);
verificar(
  "E17. o único Math da tela é a contagem do botão 'Mostrar mais'",
  (todaATela.match(/Math\./g) ?? []).length === 1 &&
    /Math\.min\(TAMANHO_DO_BLOCO, total - exibidos\.length\)/.test(tela["_detalhe-diario.tsx"]),
  true,
);
verificar(
  "E18. dinheiro, horas e margem passam por moeda, horas e margem",
  /moeda\(/.test(todaATela) && /horas\(/.test(todaATela) && /margem\(/.test(todaATela),
  true,
);
verificar(
  "E19. nenhuma formatação de dinheiro própria",
  /Intl\.NumberFormat|toLocaleString|currency/.test(todaATela),
  false,
);
verificar(
  "E20. as datas de preset vêm de periodo.ts, via periodoDoPreset",
  /periodoDoPreset\(ano, mes, modo\)/.test(painel),
  true,
);
verificar("E21. o período é validado por validarPeriodo", /validarPeriodo\(/.test(painel), true);
verificar(
  "E22. a tela não recria o calendário",
  /getDate|getMonth|getFullYear|setDate|setMonth|toISOString|daysInMonth|diasDoMes|ultimoDia|bissexto|% 4\b|% 400/.test(
    todaATela,
  ),
  false,
);
verificar(
  "E23. o único Date da tela é o argumento de mesAtualNoBrasil",
  (todaATela.match(/new Date\(/g) ?? []).length === 3 &&
    (painel.match(/mesAtualNoBrasil\(new Date\(\)\)/g) ?? []).length === 3,
  true,
);
verificar(
  "E24. nenhum storage do navegador",
  /localStorage|sessionStorage|indexedDB/.test(todaATela),
  false,
);
verificar(
  "E25. nenhum HTML injetado",
  /dangerouslySetInnerHTML|innerHTML|eval\(/.test(todaATela),
  false,
);
verificar("E26. o documento pessoal nunca é lido", /\.doc\b|\bdoc:/.test(todaATela), false);
verificar(
  "E27. fora de _exportar.tsx (etapa 4.5) a tela não tem botão de CSV ou Excel",
  /Baixar|Exportar|\.xlsx|\.csv|xlsx|montarCsv/i.test(
    todaATela.replace(/ExportarFechamento|\.\/_exportar/g, ""),
  ),
  false,
);
verificar(
  "E28. nenhum endpoint de exportação foi criado",
  /api\/fechamento\/(xlsx|csv)/.test(todaATela + apoio),
  false,
);
verificar(
  "E29. a falta não aparece no detalhamento financeiro (sem 'absent')",
  /absent/.test(tela["_detalhe-diario.tsx"]),
  false,
);

/* ================================================================== */
console.log("\nF. Texto, estados e acessibilidade\n");

const comoTexto = Object.values(tela).join("\n") + "\n" + apoio;

for (const texto of [
  "Fechamento",
  "Conferência de diárias, horas extras, custos e faturamento por cliente e período.",
  "Gerar fechamento",
  "Atualizar",
  "Tentar novamente",
  "Valores previstos, sem registro de pagamento.",
  "Nenhum lançamento financeiro encontrado para este cliente e período.",
  "Custo previsto",
  "A faturar",
  "Já faturado",
  "Receita total",
  "Resultado",
  "Margem",
  "Diárias",
  "Horas extras cobradas",
  "Por colaborador",
  "Detalhamento diário",
  "Valor das diárias",
  "Valor das horas extras",
  "Situação de faturamento",
  "Situação da folha",
  "Horas trabalhadas",
  "1ª quinzena",
  "2ª quinzena",
  "Mês inteiro",
  "Período personalizado",
  "Mês de referência",
  "Data inicial",
  "Data final",
]) {
  verificar(`F1. a tela contém "${texto}"`, comoTexto.includes(texto), true);
}

verificar(
  'F2. a palavra "pago" não aparece em nenhum texto da tela',
  /\bpag[oa]s?\b/i.test(comoTexto),
  false,
);
verificar(
  "F3. o termo usado para custo é previsto/devido",
  /Custo previsto/.test(comoTexto) && !/Custo pago|Valor pago/i.test(comoTexto),
  true,
);
verificar(
  "F4. as colunas da tabela por colaborador estão todas",
  [
    "Colaborador",
    "Função",
    "Diárias",
    "Valor das diárias",
    "Horas extras cobradas",
    "Valor das horas extras",
    "Ajuste de arredondamento",
    "Custo previsto",
    "Já faturado",
    "A faturar",
    "Total cobrado",
    "Resultado",
    "Margem",
  ].every(
    (c) =>
      tela["_tabela-colaboradores.tsx"].includes(`"${c}"`) ||
      tela["_tabela-colaboradores.tsx"].includes(`>\n                  ${c}\n`) ||
      tela["_tabela-colaboradores.tsx"].includes(c),
  ),
  true,
);
verificar(
  "F5. as colunas do detalhamento estão todas",
  [
    "Data",
    "Colaborador",
    "Função",
    "Operação",
    "Turno",
    "Status",
    "Horas trabalhadas",
    "Horas extras",
    "Diária",
    "Extra",
    "Faturado",
    "Custo previsto",
    "Situação de faturamento",
    "Situação da folha",
  ].every((c) => tela["_detalhe-diario.tsx"].includes(c)),
  true,
);
verificar(
  "F6. o status vem dos rótulos do domínio, não do enum cru",
  /ROTULO_DO_STATUS\[linha\.status\]/.test(tela["_detalhe-diario.tsx"]),
  true,
);
verificar(
  "F7. situação de faturamento e da folha vêm dos rótulos do domínio",
  /ROTULO_DA_SITUACAO_DE_FATURAMENTO\[/.test(tela["_detalhe-diario.tsx"]) &&
    /ROTULO_DA_FOLHA\[/.test(tela["_detalhe-diario.tsx"]),
  true,
);
verificar(
  "F8. a falta é sinalizada na tabela por colaborador",
  /Somente falta/.test(tela["_tabela-colaboradores.tsx"]) &&
    /Falta/.test(tela["_tabela-colaboradores.tsx"]),
  true,
);
verificar(
  "F9. a linha de total vem do consolidado do modelo",
  /dados\.consolidado\.faturadoCentavos/.test(tela["_tabela-colaboradores.tsx"]) &&
    /<TableFooter>/.test(tela["_tabela-colaboradores.tsx"]),
  true,
);
verificar(
  "F10. A faturar e Já faturado são painéis distintos",
  /titulo="A faturar"/.test(tela["_resumo.tsx"]) &&
    /titulo="Já faturado"/.test(tela["_resumo.tsx"]) &&
    /valores=\{dados\.aFaturar\}/.test(tela["_resumo.tsx"]) &&
    /valores=\{dados\.jaFaturado\}/.test(tela["_resumo.tsx"]),
  true,
);
verificar(
  "F11. o resumo lê o consolidado do modelo",
  /dados\.consolidado/.test(tela["_resumo.tsx"]),
  true,
);

// Estados.
verificar(
  "F12. estado inicial (antes de gerar)",
  /function EstadoInicial\(\)/.test(painel) &&
    /aplicados === null \? \(\s*<EstadoInicial/.test(painel),
  true,
);
verificar(
  "F13. estado de carregamento",
  /function Carregando\(\)/.test(painel) && /carregando \? \(\s*<Carregando/.test(painel),
  true,
);
verificar("F14. carregamento usa Skeleton", /Skeleton/.test(painel), true);
verificar(
  "F15. estado de erro com Alert destrutivo",
  /<Alert variant="destructive"/.test(painel) && /mensagemDoErro\(erro\)/.test(painel),
  true,
);
verificar(
  "F16. 'Tentar novamente' só quando repetir faz sentido",
  /podeTentarDeNovo\(erro\)/.test(painel),
  true,
);
verificar("F17. estado vazio", /estado === "vazio"/.test(painel), true);
verificar("F18. estado só com faltas", /estado === "somente-faltas"/.test(painel), true);
verificar(
  "F19. o resumo financeiro não aparece só com faltas",
  /estado === "somente-faltas" \? \(/.test(painel) && /<ResumoDoFechamento/.test(painel),
  true,
);
verificar(
  "F20. o detalhamento só aparece com lançamentos",
  /estado === "com-lancamentos" \? <DetalheDiario/.test(painel),
  true,
);
verificar(
  "F21. o carregamento vem ANTES do erro e dos dados (sem número antigo)",
  painel.indexOf("carregando ? (") < painel.indexOf("consulta.isError") &&
    painel.indexOf("consulta.isError") < painel.indexOf("consulta.data ?"),
  true,
);
verificar(
  "F22. o erro não mostra a resposta bruta",
  /consulta\.error\.(message|stack)|\.stack|JSON\.stringify/.test(painel),
  false,
);
verificar(
  "F23. Atualizar refaz a consulta",
  /onAtualizar=\{\(\) => void consulta\.refetch\(\)\}/.test(painel),
  true,
);
verificar(
  "F24. gerar com os mesmos filtros refaz a consulta em vez de ignorar",
  /mesmosFiltros\(aplicados, filtrosDoFormulario\)\)\s*\{\s*void consulta\.refetch\(\)/.test(
    painel,
  ),
  true,
);
verificar(
  "F25. avisa quando os filtros mudaram depois de gerar",
  /Os filtros foram alterados/.test(painel),
  true,
);

// Acessibilidade.
for (const [id, rotulo] of [
  ["fechamento-cliente", "Cliente"],
  ["fechamento-mes", "Mês de referência"],
  ["fechamento-ano", "Ano"],
  ["fechamento-inicio", "Data inicial"],
  ["fechamento-fim", "Data final"],
]) {
  verificar(
    `F26. "${rotulo}" tem rótulo associado (htmlFor/id ${id})`,
    new RegExp(`htmlFor="${id}"[^>]*>\\s*${rotulo}`).test(painel) &&
      new RegExp(`id="${id}"`).test(painel),
    true,
  );
}
verificar(
  "F27. o tipo de período é um grupo rotulado",
  /role="group" aria-label="Tipo de período"/.test(painel) && /<legend/.test(painel),
  true,
);
verificar(
  "F28. o botão de período marca o selecionado (aria-pressed)",
  /aria-pressed=\{modo === opcao\}/.test(painel),
  true,
);
verificar(
  "F29. as datas do período personalizado sinalizam erro (aria-invalid) e descrição",
  /aria-invalid=\{mostrarErroDoPeriodo\}/.test(painel) &&
    /aria-describedby="fechamento-periodo-info"/.test(painel),
  true,
);
verificar(
  "F30. o erro do período é anunciado (role alert)",
  /role=\{mostrarErroDoPeriodo \? "alert" : undefined\}/.test(painel),
  true,
);
verificar(
  "F31. a área de resultado é região viva e marca ocupado",
  /aria-live="polite" aria-busy=\{carregando\}/.test(painel),
  true,
);
verificar(
  "F32. o carregamento é um status com texto para leitor de tela",
  /role="status" aria-label="Carregando fechamento"/.test(painel) &&
    /sr-only">Carregando fechamento/.test(painel),
  true,
);
verificar(
  "F33. as tabelas têm cabeçalhos de coluna (scope=col)",
  (tela["_tabela-colaboradores.tsx"].match(/scope="col"/g) ?? []).length >= 2 &&
    (tela["_detalhe-diario.tsx"].match(/scope="col"/g) ?? []).length >= 2,
  true,
);
verificar(
  "F34. as tabelas têm legenda para leitor de tela",
  /<TableCaption className="sr-only">/.test(tela["_tabela-colaboradores.tsx"]) &&
    /<TableCaption className="sr-only">/.test(tela["_detalhe-diario.tsx"]),
  true,
);
verificar(
  "F35. o detalhamento recolhível informa expandido e controla a tabela",
  /aria-expanded=\{aberto\}/.test(tela["_detalhe-diario.tsx"]) &&
    /aria-controls="tabela-detalhe-diario"/.test(tela["_detalhe-diario.tsx"]) &&
    /id="tabela-detalhe-diario"/.test(tela["_detalhe-diario.tsx"]),
  true,
);
verificar(
  "F36. a severidade do alerta vem em TEXTO, não só em cor",
  /ROTULO_DA_SEVERIDADE\[alerta\.severidade\]/.test(tela["_alertas.tsx"]),
  true,
);
verificar(
  "F37. e em ícone distinto por severidade",
  /OctagonAlert/.test(tela["_alertas.tsx"]) &&
    /TriangleAlert/.test(tela["_alertas.tsx"]) &&
    /Info/.test(tela["_alertas.tsx"]),
  true,
);
verificar(
  "F38. alerta crítico é anunciado (role alert)",
  /role=\{alerta\.severidade === "critico" \? "alert" : undefined\}/.test(tela["_alertas.tsx"]),
  true,
);
verificar(
  "F39. ícones decorativos escondidos do leitor de tela",
  (todaATela.match(/aria-hidden="true"/g) ?? []).length >= 12,
  true,
);
verificar(
  "F40. badges de situação têm texto, não só cor",
  /ROTULO_DA_SITUACAO_DE_FATURAMENTO\[linha\.situacaoDeFaturamento\]/.test(
    tela["_detalhe-diario.tsx"],
  ),
  true,
);
verificar(
  "F41. focos visíveis vêm dos componentes do sistema (Button, Input, Select)",
  /from "@\/components\/ui\/button"/.test(painel) &&
    /from "@\/components\/ui\/input"/.test(painel) &&
    /from "@\/components\/ui\/select"/.test(painel),
  true,
);

// Responsividade.
verificar(
  "F42. as duas tabelas rolam na horizontal em vez de esmagar colunas",
  (tela["_tabela-colaboradores.tsx"].match(/overflow-x-auto/g) ?? []).length === 1 &&
    (tela["_detalhe-diario.tsx"].match(/overflow-x-auto/g) ?? []).length === 1,
  true,
);
verificar(
  "F43. as tabelas têm largura mínima",
  /min-w-\[80rem\]/.test(tela["_tabela-colaboradores.tsx"]) &&
    /min-w-\[96rem\]/.test(tela["_detalhe-diario.tsx"]),
  true,
);
verificar(
  "F44. cartões e filtros se reorganizam por breakpoint",
  /sm:grid-cols-2 xl:grid-cols-3/.test(tela["_resumo.tsx"]) &&
    /md:grid-cols-3/.test(painel) &&
    /lg:grid-cols-2/.test(tela["_resumo.tsx"]),
  true,
);
verificar(
  "F45. nenhuma coluna financeira foi removida para caber",
  /hidden (sm|md|lg):table-cell|hidden md:/.test(todaATela),
  false,
);
verificar(
  "F46. o detalhamento é mostrado em blocos de 100",
  /TAMANHO_DO_BLOCO = 100/.test(tela["_detalhe-diario.tsx"]),
  true,
);

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);

if (falhas.length > 0) {
  for (const falha of falhas) console.log(`  FALHA  ${falha}`);
  process.exit(1);
}
