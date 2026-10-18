/**
 * Testes do paginador por cursor (src/lib/paginacao.ts).
 *
 * COMO RODAR:
 *
 *   npm run test:paginacao
 *
 * Mesmo formato dos outros scripts: sem framework, Node executando o módulo
 * TypeScript direto via `--experimental-strip-types`. Sai com código diferente
 * de zero em qualquer falha.
 *
 * Nenhum teste acessa rede, Supabase ou credencial. A Data API é simulada por
 * uma fonte em memória que reproduz o que o PostgREST faz com este paginador:
 * `id > cursor`, `ORDER BY id`, `LIMIT` e um teto remoto (`max_rows`).
 *
 * O que os testes de concorrência afirmam, e o que NÃO afirmam:
 *   - afirmam o que o paginador DETECTA (contagem antes/depois diferente, ou
 *     lido diferente da contagem);
 *   - documentam, em C-lim, um caso que ele NÃO detecta (uma exclusão e uma
 *     inserção que preservam a contagem). Contagem não é snapshot.
 */

import { ErroPaginacao, lerTudoPaginado } from "../src/lib/paginacao.ts";

let passou = 0;
const falhas = [];

function verificar(caso, obtido, esperado) {
  if (obtido === esperado) {
    passou++;
    console.log(`  PASS  ${caso}`);
  } else {
    falhas.push(`${caso} — esperado ${esperado}, obtido ${obtido}`);
    console.log(`  FAIL  ${caso} — esperado ${esperado}, obtido ${obtido}`);
  }
}

/** Executa e devolve o erro lançado (ou null se não lançou). */
async function capturar(fn) {
  try {
    await fn();
    return null;
  } catch (erro) {
    return erro;
  }
}

/** UUID sintético e ordenável: o sufixo cresce com `n`, como o texto do uuid no banco. */
const idDe = (n) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

/** Linhas sintéticas. `criado_em` repetido de propósito: a ordem NÃO pode depender dele. */
function linhas(total, inicio = 1) {
  return Array.from({ length: total }, (_, i) => ({
    id: idDe(inicio + i),
    criado_em: "2026-10-01T12:00:00.000Z",
    valor: inicio + i,
  }));
}

/**
 * Fonte em memória que simula a Data API. `estado.linhas` pode ser alterada
 * entre as páginas por `aoLerPagina`, para simular escrita concorrente.
 */
function criarFonte(inicial, opcoes = {}) {
  const estado = {
    linhas: [...inicial],
    chamadasPagina: 0,
    chamadasContagem: 0,
    tentativa: 1,
    limitesPedidos: [],
  };
  const { limiteRemoto = Infinity, aoLerPagina, falharNaPagina, contagem } = opcoes;

  const lerPagina = async ({ depoisDe, limite }) => {
    estado.chamadasPagina++;
    estado.limitesPedidos.push(limite);
    if (falharNaPagina === estado.chamadasPagina) throw new Error("falha simulada de rede");
    if (aoLerPagina) aoLerPagina(estado);
    const ordenadas = [...estado.linhas].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const candidatas = depoisDe === null ? ordenadas : ordenadas.filter((l) => l.id > depoisDe);
    return { linhas: candidatas.slice(0, Math.min(limite, limiteRemoto)) };
  };

  const contar = async () => {
    estado.chamadasContagem++;
    return contagem ? contagem(estado) : estado.linhas.length;
  };

  return { estado, lerPagina, contar };
}

const semDuplicatas = (lista) => new Set(lista.map((l) => l.id)).size === lista.length;
const ordenadoPorId = (lista) => lista.every((l, i) => i === 0 || lista[i - 1].id < l.id);

console.log("\nA. Tamanhos de conjunto (sem perda, sem duplicata, ordenado por id)\n");

for (const total of [0, 1, 499, 500, 501, 999, 1000, 1001, 2501]) {
  const fonte = criarFonte(linhas(total));
  const r = await lerTudoPaginado({ lerPagina: fonte.lerPagina, contar: fonte.contar });
  verificar(`A-${total}a. lidas = ${total}`, String(r.linhas.length), String(total));
  verificar(`A-${total}b. sem duplicatas`, String(semDuplicatas(r.linhas)), "true");
  verificar(`A-${total}c. ordenado por id`, String(ordenadoPorId(r.linhas)), "true");
  verificar(
    `A-${total}d. nenhuma linha perdida`,
    String(r.linhas.reduce((soma, l) => soma + l.valor, 0)),
    String((total * (total + 1)) / 2),
  );
  verificar(
    `A-${total}e. completude conferida pela contagem`,
    String(r.completudeVerificada),
    "true",
  );
  verificar(`A-${total}f. sem releitura`, String(r.releituras), "0");
  // páginas cheias + uma página vazia que confirma o fim
  verificar(
    `A-${total}g. páginas = ceil(n/500) + página vazia de confirmação`,
    String(r.paginas),
    String(Math.ceil(total / 500) + 1),
  );
}

console.log("\nB. Cursor, ordem e página\n");

{
  const fonte = criarFonte(linhas(1200));
  await lerTudoPaginado({ lerPagina: fonte.lerPagina, contar: fonte.contar });
  verificar(
    "B1. página padrão de 500 registros",
    fonte.estado.limitesPedidos.every((l) => l === 500) ? "500" : "outro",
    "500",
  );
}
{
  // Linhas entregues fora de ordem pela fonte: o paginador não conserta, recusa.
  const desordenada = async () => ({ linhas: [linhas(1, 2)[0], linhas(1, 1)[0]] });
  const erro = await capturar(() => lerTudoPaginado({ lerPagina: desordenada }));
  verificar("B2. ordem fora de id ASC -> ORDEM_INVALIDA", erro?.codigo, "ORDEM_INVALIDA");
}
{
  // id repetido dentro da página
  const repetida = async () => ({ linhas: [...linhas(1, 1), ...linhas(1, 1)] });
  const erro = await capturar(() => lerTudoPaginado({ lerPagina: repetida }));
  verificar("B3. id repetido na página -> ORDEM_INVALIDA", erro?.codigo, "ORDEM_INVALIDA");
}
{
  // Timestamps repetidos + fonte que ignora o cursor e devolve sempre a mesma página.
  const mesma = async () => ({ linhas: linhas(3) });
  const erro = await capturar(() => lerTudoPaginado({ lerPagina: mesma, tamanhoPagina: 3 }));
  verificar(
    "B4. resposta repetida sem avanço -> CURSOR_SEM_AVANCO",
    erro?.codigo,
    "CURSOR_SEM_AVANCO",
  );
}
{
  const semId = async () => ({ linhas: [{ valor: 1 }] });
  const erro = await capturar(() => lerTudoPaginado({ lerPagina: semId }));
  verificar("B5a. linha sem id -> CURSOR_INVALIDO", erro?.codigo, "CURSOR_INVALIDO");
  const idVazio = async () => ({ linhas: [{ id: "" }] });
  const erro2 = await capturar(() => lerTudoPaginado({ lerPagina: idVazio }));
  verificar("B5b. id vazio -> CURSOR_INVALIDO", erro2?.codigo, "CURSOR_INVALIDO");
  const idNumero = async () => ({ linhas: [{ id: 7 }] });
  const erro3 = await capturar(() => lerTudoPaginado({ lerPagina: idNumero }));
  verificar("B5c. id que não é texto -> CURSOR_INVALIDO", erro3?.codigo, "CURSOR_INVALIDO");
}
{
  // A fonte devolve mais linhas do que o limite pedido
  const excede = async ({ limite }) => ({ linhas: linhas(limite + 1) });
  const erro = await capturar(() => lerTudoPaginado({ lerPagina: excede, tamanhoPagina: 10 }));
  verificar(
    "B6. página maior que o limite -> RESPOSTA_EXCEDE_LIMITE",
    erro?.codigo,
    "RESPOSTA_EXCEDE_LIMITE",
  );
}
{
  const naoLista = async () => ({ linhas: "x" });
  const erro = await capturar(() => lerTudoPaginado({ lerPagina: naoLista }));
  verificar("B7. resposta sem lista -> RESPOSTA_INVALIDA", erro?.codigo, "RESPOSTA_INVALIDA");
}
{
  const fonte = criarFonte(linhas(40));
  const r = await lerTudoPaginado({
    lerPagina: fonte.lerPagina,
    contar: fonte.contar,
    extrairId: (l) => l.id,
    tamanhoPagina: 7,
  });
  verificar("B8. tamanhoPagina e extrairId configuráveis", String(r.linhas.length), "40");
}

console.log("\nC. Limite remoto menor que a página pedida (página curta não encerra a leitura)\n");

for (const limiteRemoto of [300, 100, 499]) {
  const fonte = criarFonte(linhas(1001), { limiteRemoto });
  const r = await lerTudoPaginado({
    lerPagina: fonte.lerPagina,
    contar: fonte.contar,
    tamanhoPagina: 500,
  });
  verificar(
    `C-${limiteRemoto}a. limite remoto ${limiteRemoto}: lê as 1001`,
    String(r.linhas.length),
    "1001",
  );
  verificar(
    `C-${limiteRemoto}b. sem duplicatas e em ordem`,
    String(semDuplicatas(r.linhas) && ordenadoPorId(r.linhas)),
    "true",
  );
}
{
  // Fonte que corta o resultado em silêncio (o defeito da C03): lê 1000 e acusa fim.
  const fonte = criarFonte(linhas(1001), { limiteRemoto: Infinity });
  const truncada = async (args) => {
    const r = await fonte.lerPagina(args);
    return { linhas: r.linhas.filter((l) => l.valor <= 1000) };
  };
  const erro = await capturar(() => lerTudoPaginado({ lerPagina: truncada, contar: fonte.contar }));
  verificar(
    "C-trunc. corte silencioso em 1000 contra contagem 1001 -> CONTAGEM_DIVERGENTE",
    erro?.codigo,
    "CONTAGEM_DIVERGENTE",
  );
  verificar(
    "C-trunc2. a causa fica descrita (lidas e contagem)",
    String(erro?.detalhes?.lidas === 1000 && erro?.detalhes?.contagemDepois === 1001),
    "true",
  );
}

console.log("\nD. Erros: nunca devolver resultado parcial\n");

{
  const fonte = criarFonte(linhas(1500), { falharNaPagina: 2 });
  const erro = await capturar(() =>
    lerTudoPaginado({ lerPagina: fonte.lerPagina, contar: fonte.contar }),
  );
  verificar("D1. falha em página intermediária -> PAGINA_FALHOU", erro?.codigo, "PAGINA_FALHOU");
  verificar("D2. é um ErroPaginacao", String(erro instanceof ErroPaginacao), "true");
  verificar("D3. guarda a causa original", erro?.cause?.message, "falha simulada de rede");
  verificar("D4. o erro não carrega linhas parciais", String("linhas" in (erro ?? {})), "false");
  verificar("D5. não tenta de novo uma falha de página", String(fonte.estado.chamadasPagina), "2");
}
{
  const fonte = criarFonte(linhas(10));
  const contarFalha = async () => {
    throw new Error("contagem fora do ar");
  };
  const erro = await capturar(() =>
    lerTudoPaginado({ lerPagina: fonte.lerPagina, contar: contarFalha }),
  );
  verificar("D6. falha na contagem -> CONTAGEM_FALHOU", erro?.codigo, "CONTAGEM_FALHOU");
}
{
  const fonte = criarFonte(linhas(2501));
  const erro = await capturar(() =>
    lerTudoPaginado({ lerPagina: fonte.lerPagina, contar: fonte.contar, maxPaginas: 3 }),
  );
  verificar("D7. limite de páginas atingido -> LIMITE_PAGINAS", erro?.codigo, "LIMITE_PAGINAS");
  verificar("D8. para no limite (sem laço)", String(fonte.estado.chamadasPagina), "3");
}
{
  const fonte = criarFonte(linhas(5));
  for (const [nome, valor] of [
    ["negativa", -1],
    ["NaN", Number.NaN],
    ["infinita", Number.POSITIVE_INFINITY],
    ["fracionária", 1.5],
    ["texto", "5"],
    ["nula", null],
    ["indefinida", undefined],
  ]) {
    const erro = await capturar(() =>
      lerTudoPaginado({ lerPagina: fonte.lerPagina, contar: async () => valor }),
    );
    verificar(
      `D9-${nome}. contagem ${nome} -> CONTAGEM_INVALIDA`,
      erro?.codigo,
      "CONTAGEM_INVALIDA",
    );
  }
}
{
  const fonte = criarFonte(linhas(5));
  for (const [nome, opcoes] of [
    ["tamanhoPagina 0", { tamanhoPagina: 0 }],
    ["tamanhoPagina 1001", { tamanhoPagina: 1001 }],
    ["tamanhoPagina fracionário", { tamanhoPagina: 1.5 }],
    ["maxPaginas 0", { maxPaginas: 0 }],
    ["maxPaginas fracionário", { maxPaginas: 2.5 }],
  ]) {
    const erro = await capturar(() => lerTudoPaginado({ lerPagina: fonte.lerPagina, ...opcoes }));
    verificar(`D10. ${nome} -> PARAMETRO_INVALIDO`, erro?.codigo, "PARAMETRO_INVALIDO");
  }
  const erro = await capturar(() => lerTudoPaginado({ lerPagina: "nao-e-funcao" }));
  verificar("D11. lerPagina ausente -> PARAMETRO_INVALIDO", erro?.codigo, "PARAMETRO_INVALIDO");
}

console.log("\nE. Divergência de contagem e releitura controlada (no máximo uma)\n");

{
  // Insere uma linha DEPOIS do cursor na primeira tentativa. Antes != depois: relê.
  const fonte = criarFonte(linhas(1000), {
    aoLerPagina: (e) => {
      if (e.chamadasPagina === 2 && e.linhas.length === 1000) e.linhas.push(...linhas(1, 1001));
    },
  });
  const r = await lerTudoPaginado({ lerPagina: fonte.lerPagina, contar: fonte.contar });
  verificar("E1. inserção entre páginas é detectada e relida", String(r.releituras), "1");
  verificar("E2. a releitura devolve o conjunto completo e atual", String(r.linhas.length), "1001");
  verificar("E3. sem duplicatas após a releitura", String(semDuplicatas(r.linhas)), "true");
}
{
  // Insere uma linha com id MENOR que o cursor: a página corrente não a vê (limite do cursor).
  const fonte = criarFonte(linhas(1000, 10), {
    aoLerPagina: (e) => {
      if (e.chamadasPagina === 2 && e.linhas.length === 1000) e.linhas.push(...linhas(1, 1));
    },
  });
  const r = await lerTudoPaginado({ lerPagina: fonte.lerPagina, contar: fonte.contar });
  verificar(
    "E4. inserção com id menor que o cursor: detectada pela contagem e relida",
    String(r.releituras),
    "1",
  );
  verificar(
    "E5. a releitura inclui a linha que o cursor havia pulado",
    String(r.linhas.length),
    "1001",
  );
}
{
  // Exclusão de linha JÁ lida: lido (1000) != contagem depois (999).
  const fonte = criarFonte(linhas(1000), {
    aoLerPagina: (e) => {
      if (e.chamadasPagina === 2 && e.linhas.length === 1000)
        e.linhas = e.linhas.filter((l) => l.valor !== 3);
    },
  });
  const r = await lerTudoPaginado({ lerPagina: fonte.lerPagina, contar: fonte.contar });
  verificar("E6. exclusão de linha já lida é detectada e relida", String(r.releituras), "1");
  verificar("E7. a releitura reflete a exclusão", String(r.linhas.length), "999");
}
{
  // Exclusão de linha AINDA NÃO lida: lido (999) == contagem depois (999), mas antes (1000) difere.
  const fonte = criarFonte(linhas(1000), {
    aoLerPagina: (e) => {
      if (e.chamadasPagina === 2 && e.linhas.length === 1000)
        e.linhas = e.linhas.filter((l) => l.valor !== 900);
    },
  });
  const r = await lerTudoPaginado({ lerPagina: fonte.lerPagina, contar: fonte.contar });
  verificar("E8. contagem antes != depois também dispara a releitura", String(r.releituras), "1");
  verificar("E9. resultado final coerente com o banco", String(r.linhas.length), "999");
}
{
  // Escrita concorrente em TODA tentativa: persiste, vira erro explícito.
  const fonte = criarFonte(linhas(1000), {
    aoLerPagina: (e) => {
      if (e.chamadasPagina % 2 === 0) e.linhas.push(...linhas(1, 5000 + e.chamadasPagina));
    },
  });
  const erro = await capturar(() =>
    lerTudoPaginado({ lerPagina: fonte.lerPagina, contar: fonte.contar }),
  );
  verificar(
    "E10. divergência que persiste após a releitura -> CONTAGEM_DIVERGENTE",
    erro?.codigo,
    "CONTAGEM_DIVERGENTE",
  );
  verificar(
    "E11. só uma releitura foi feita (duas leituras no total)",
    String(erro?.detalhes?.tentativas),
    "2",
  );
}
{
  // Contagem inválida na SEGUNDA tentativa: não aceita como confirmação.
  let chamadas = 0;
  const fonte = criarFonte(linhas(1000), {
    aoLerPagina: (e) => {
      if (e.chamadasPagina === 2) e.linhas.push(...linhas(1, 1001));
    },
  });
  const contar = async () => {
    chamadas++;
    return chamadas <= 2 ? fonte.estado.linhas.length : -5;
  };
  const erro = await capturar(() => lerTudoPaginado({ lerPagina: fonte.lerPagina, contar }));
  verificar(
    "E12. contagem inválida na releitura -> CONTAGEM_INVALIDA",
    erro?.codigo,
    "CONTAGEM_INVALIDA",
  );
}

console.log("\nF. Limites declarados: o que o paginador NÃO detecta\n");

{
  // C-lim: uma linha já lida é excluída e outra, com id MENOR que o cursor, é inserida.
  // Contagem antes = depois = lido = 1000. Contagem não é snapshot: passa sem aviso.
  const fonte = criarFonte(linhas(1000), {
    aoLerPagina: (e) => {
      if (e.chamadasPagina === 2 && e.linhas.length === 1000) {
        e.linhas = e.linhas.filter((l) => l.valor !== 3);
        e.linhas.push(...linhas(1, 0)); // id MENOR que o cursor: a leitura corrente não a alcança
      }
    },
  });
  const r = await lerTudoPaginado({ lerPagina: fonte.lerPagina, contar: fonte.contar });
  verificar(
    "F1. troca que preserva a contagem NÃO é detectada pela contagem",
    String(r.releituras),
    "0",
  );
  verificar(
    "F2. o resultado mistura o antes e o depois (linha 3 excluída ainda presente)",
    String(r.linhas.some((l) => l.valor === 3)),
    "true",
  );
  verificar(
    "F3. e NÃO traz a linha inserida (o cursor já passou dela)",
    String(r.linhas.some((l) => l.valor === 0)),
    "false",
  );
  verificar(
    "F4. por isso 'completudeVerificada' NÃO é 'consistência de snapshot'",
    String(r.completudeVerificada),
    "true",
  );
}
{
  // Com um marcador opcional informado pelo chamador, a mesma troca passa a ser detectada.
  let versao = 0;
  const fonte = criarFonte(linhas(1000), {
    aoLerPagina: (e) => {
      if (e.chamadasPagina === 2 && e.linhas.length === 1000) {
        e.linhas = e.linhas.filter((l) => l.valor !== 3);
        e.linhas.push(...linhas(1, 0)); // id MENOR que o cursor: a leitura corrente não a alcança
        versao++;
      }
    },
  });
  const r = await lerTudoPaginado({
    lerPagina: fonte.lerPagina,
    contar: fonte.contar,
    marcador: async () => `v${versao}`,
  });
  verificar(
    "F5. marcador opcional detecta a troca e dispara a releitura",
    String(r.releituras),
    "1",
  );
  verificar(
    "F6. a releitura devolve o conjunto atual (sem a linha 3, com a nova)",
    String(!r.linhas.some((l) => l.valor === 3) && r.linhas.some((l) => l.valor === 0)),
    "true",
  );
}
{
  // Marcador que muda sempre: persiste e vira erro. Falha do marcador também.
  let n = 0;
  const fonte = criarFonte(linhas(10));
  const erro = await capturar(() =>
    lerTudoPaginado({
      lerPagina: fonte.lerPagina,
      contar: fonte.contar,
      marcador: async () => `m${n++}`,
    }),
  );
  verificar(
    "F7. marcador que nunca estabiliza -> MARCADOR_DIVERGENTE",
    erro?.codigo,
    "MARCADOR_DIVERGENTE",
  );
  const erro2 = await capturar(() =>
    lerTudoPaginado({
      lerPagina: fonte.lerPagina,
      contar: fonte.contar,
      marcador: async () => {
        throw new Error("x");
      },
    }),
  );
  verificar("F8. falha ao ler o marcador -> MARCADOR_FALHOU", erro2?.codigo, "MARCADOR_FALHOU");
}
{
  // Sem função de contagem: lê tudo, mas NÃO afirma completude.
  const fonte = criarFonte(linhas(1001));
  const r = await lerTudoPaginado({ lerPagina: fonte.lerPagina });
  verificar("F9. sem contar(): lê tudo", String(r.linhas.length), "1001");
  verificar(
    "F10. sem contar(): completudeVerificada = false (sem falsa garantia)",
    String(r.completudeVerificada),
    "false",
  );
  verificar("F11. sem contar(): contagem = null", String(r.contagem), "null");
}

console.log("\nG. Pureza do módulo\n");

import { readFileSync } from "node:fs";
const fonteDoModulo = readFileSync(new URL("../src/lib/paginacao.ts", import.meta.url), "utf8");
verificar(
  "G1. não importa nada (independe de React, React Query e Supabase)",
  String(/^\s*import\s/m.test(fonteDoModulo)),
  "false",
);
verificar(
  "G2. sem acesso a rede nem a ambiente",
  String(/\bfetch\(|process\.env|XMLHttpRequest/.test(fonteDoModulo)),
  "false",
);
verificar("G3. sem console", String(/console\./.test(fonteDoModulo)), "false");

console.log(`\n${passou} passaram, ${falhas.length} falharam\n`);

if (falhas.length > 0) {
  for (const f of falhas) console.error(`FALHA: ${f}`);
  process.exit(1);
}
