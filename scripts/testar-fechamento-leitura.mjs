/**
 * Testes da leitura paginada do Fechamento (etapa 4.1).
 *
 * COMO RODAR:
 *
 *   npm run test:fechamento-leitura
 *
 * Mesmo formato das outras suítes: sem framework, Node executando o módulo
 * TypeScript direto via `--experimental-strip-types`. Sai com código diferente
 * de zero em qualquer falha.
 *
 * DUAS METADES:
 *
 *   - forma literal de `leitura.ts` (bloco A): o que não se observa de fora —
 *     que a consulta recorta no banco, pagina por keyset, pede a contagem e
 *     nunca recorre a `fetchAll`, `select("*")`, offset ou `service_role`;
 *   - comportamento (blocos B a D), com uma FONTE FALSA que imita o corte do
 *     PostgREST (`max_rows`): paginação, término pela contagem, cap menor que
 *     o pedido, e todas as falhas de integridade. Nada de rede nem de banco.
 *
 * A consulta aninhada contra um banco real foi validada à parte, no spike da
 * etapa 4.1 (Supabase local); esta suíte não depende de banco.
 */

import { readFileSync } from "node:fs";

import {
  criarFonteSupabase,
  ErroDeLeituraDoFechamento,
  lerFechamento,
  SELECT_DO_FECHAMENTO,
  TAMANHO_DA_PAGINA,
  TETO_DE_LINHAS,
  TETO_DE_REQUISICOES,
} from "../src/lib/fechamento/leitura.ts";

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

/** Executa e devolve o erro em si, ou `null` se não levantou. */
async function erroDe(acao) {
  try {
    await acao();
    return null;
  } catch (erro) {
    return erro;
  }
}

const codigoDe = (erro) => (erro instanceof ErroDeLeituraDoFechamento ? erro.codigo : String(erro));

const textoDe = (arquivo) => readFileSync(new URL(`../${arquivo}`, import.meta.url), "utf8");
const semComentarios = (fonte) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const leitura = semComentarios(textoDe("src/lib/fechamento/leitura.ts"));

/* ------------------------------------------------------------------ */
/* Fonte falsa                                                         */
/* ------------------------------------------------------------------ */

const idDe = (n) => `id-${String(n).padStart(6, "0")}`;
const linhaDe = (id) => ({ id });

/**
 * Imita o PostgREST: ordena por id, aplica `id > cursor`, corta em `cap`
 * (o `max_rows`) e conta o recorte inteiro quando pedido. `falhas` injeta
 * comportamentos defeituosos.
 */
function fonteFalsa({ total, cap = Infinity, ...defeitos }) {
  const ids = Array.from({ length: total }, (_, i) => idDe(i + 1));
  const registro = { paginas: [], contagens: 0 };
  let leituras = 0;

  return {
    registro,
    async lerPagina({ cursor, limite, contar }) {
      leituras += 1;
      registro.paginas.push({ cursor, limite, contar });
      if (defeitos.falharNaPagina === leituras) throw new Error("rede caiu");
      if (defeitos.vazioDepoisDe !== undefined && leituras > defeitos.vazioDepoisDe) {
        return { linhas: [], total: contar ? total : null };
      }
      let candidatos = cursor === null ? ids : ids.filter((id) => id > cursor);
      candidatos = candidatos.slice(0, Math.min(limite, cap));
      let linhas = candidatos.map(linhaDe);
      if (defeitos.repetirPrimeira && leituras >= 2) {
        linhas = [linhaDe(registro.ultimoId), ...linhas.slice(0, -1)];
      }
      if (defeitos.idMenorQueOCursor && leituras >= 2) {
        linhas = [linhaDe("id-000000"), ...linhas.slice(0, -1)];
      }
      if (defeitos.paginaGrande) linhas = linhas.concat(linhas);
      if (defeitos.linhasAMais && leituras === 1) {
        linhas = linhas.concat(
          Array.from({ length: defeitos.linhasAMais }, (_, i) => linhaDe(`z-extra-${i}`)),
        );
      }
      registro.ultimoId = linhas.length ? linhas[linhas.length - 1].id : registro.ultimoId;
      return {
        linhas,
        total: contar ? (defeitos.semContagem ? null : total) : null,
      };
    },
    async contar() {
      registro.contagens += 1;
      if (defeitos.contagensFinais) {
        return defeitos.contagensFinais[
          Math.min(registro.contagens, defeitos.contagensFinais.length) - 1
        ];
      }
      return total;
    },
  };
}

/* ------------------------------------------------------------------ */
console.log("\nA. Forma literal de leitura.ts\n");

verificar("A1. página de 500", TAMANHO_DA_PAGINA, 500);
verificar("A2. teto de 20.000 linhas", TETO_DE_LINHAS, 20000);
verificar("A3. teto de 60 requisições", TETO_DE_REQUISICOES, 60);
verificar("A4. nenhum fetchAll", /fetchAll/.test(leitura), false);
verificar('A5. nenhum select("*")', /select\(\s*["'`]\*["'`]/.test(leitura), false);
verificar("A6. nenhum .range(", /\.range\s*\(/.test(leitura), false);
verificar("A7. nenhum .offset(", /\.offset\s*\(/.test(leitura), false);
verificar(
  "A8. nenhum service_role nem cliente administrativo",
  /service_role|integrations\/supabase\/admin|criarClienteAdmin/.test(leitura),
  false,
);
verificar(
  "A9. não importa cálculo financeiro nem ledger",
  /from\s+"[^"]*(billing|ledger|queries)"/.test(leitura),
  false,
);
verificar(
  'A10. pagina por keyset: .gt("id", cursor)',
  /\.gt\(\s*"id"\s*,\s*cursor\s*\)/.test(leitura),
  true,
);
verificar(
  "A11. ordena por id",
  /\.order\(\s*"id"\s*,\s*\{\s*ascending:\s*true\s*\}\s*\)/.test(leitura),
  true,
);
verificar("A12. limita a página com .limit(limite)", /\.limit\(\s*limite\s*\)/.test(leitura), true);
verificar('A13. pede count: "exact"', /count:\s*"exact"/.test(leitura), true);
verificar("A14. contagem final sem trazer linhas (head: true)", /head:\s*true/.test(leitura), true);
verificar(
  "A15. filtra o cliente no banco pelo caminho aninhado",
  /\.eq\(\s*"timesheets\.operations\.client_id"/.test(leitura),
  true,
);
verificar(
  "A16. filtra o início do período no banco",
  /\.gte\(\s*"timesheets\.work_date"/.test(leitura),
  true,
);
verificar(
  "A17. filtra o fim do período no banco",
  /\.lte\(\s*"timesheets\.work_date"/.test(leitura),
  true,
);
verificar(
  "A18. !inner em timesheets e em operations",
  /timesheets!inner\(.*operations!inner\(/.test(SELECT_DO_FECHAMENTO),
  true,
);
verificar(
  "A19. valores monetários saem como texto (::text)",
  ["billed_amount::text", "cost_amount::text", "daily_rate_snapshot::text"].every((c) =>
    SELECT_DO_FECHAMENTO.includes(c),
  ),
  true,
);
verificar(
  "A20. o select não pede coluna do documento do colaborador",
  /\bdoc\b/.test(SELECT_DO_FECHAMENTO),
  false,
);
verificar(
  "A21. sem await em laço sobre a mesma página (leitura sequencial)",
  /Promise\.all/.test(leitura),
  false,
);

/* ------------------------------------------------------------------ */
console.log("\nB. Paginação: o conjunto completo, e só ele\n");

{
  const f = fonteFalsa({ total: 3 });
  const linhas = await lerFechamento(f);
  verificar("B1. uma página: 3 linhas", linhas.length, 3);
  verificar("B2. uma página: uma requisição de página", f.registro.paginas.length, 1);
  verificar("B3. uma página: a contagem final foi conferida", f.registro.contagens, 1);
}
{
  const f = fonteFalsa({ total: 1250 });
  const linhas = await lerFechamento(f);
  verificar("B4. 1250 linhas lidas", linhas.length, 1250);
  verificar("B5. 1250 linhas em 3 páginas (500, 500, 250)", f.registro.paginas.length, 3);
  verificar("B6. ids únicos", new Set(linhas.map((l) => l.id)).size, 1250);
  verificar(
    "B7. ordem crescente de id",
    linhas.every((l, i) => i === 0 || linhas[i - 1].id < l.id),
    true,
  );
  verificar(
    "B8. todo pedido é de 500",
    f.registro.paginas.every((p) => p.limite === 500),
    true,
  );
  verificar(
    "B9. count exato só na primeira página",
    f.registro.paginas.filter((p) => p.contar).length,
    1,
  );
  verificar("B10. a primeira página é a que conta", f.registro.paginas[0].contar, true);
  verificar("B11. a primeira página parte sem cursor", f.registro.paginas[0].cursor, null);
  verificar(
    "B12. a segunda parte do último id da primeira",
    f.registro.paginas[1].cursor,
    idDe(500),
  );
  verificar(
    "B13. a terceira parte do último id da segunda",
    f.registro.paginas[2].cursor,
    idDe(1000),
  );
}
{
  const f = fonteFalsa({ total: 1000 });
  const linhas = await lerFechamento(f);
  verificar("B14. múltiplo exato da página: 1000 linhas", linhas.length, 1000);
  verificar(
    "B15. múltiplo exato: sem página extra à toa (2 requisições)",
    f.registro.paginas.length,
    2,
  );
}
{
  const f = fonteFalsa({ total: 0 });
  const linhas = await lerFechamento(f);
  verificar("B16. recorte vazio: nenhuma linha", linhas.length, 0);
  verificar("B17. recorte vazio: uma só requisição", f.registro.paginas.length, 1);
  verificar("B18. recorte vazio: recontagem conferida", f.registro.contagens, 1);
}

/* ------------------------------------------------------------------ */
console.log("\nC. O servidor corta a página (max_rows menor que o pedido)\n");

{
  const f = fonteFalsa({ total: 1250, cap: 300 });
  const linhas = await lerFechamento(f);
  verificar("C1. cap de 300 com pedido de 500: leitura completa", linhas.length, 1250);
  verificar("C2. cap de 300: avança pelo que veio (5 páginas)", f.registro.paginas.length, 5);
  verificar("C3. cap de 300: ids únicos", new Set(linhas.map((l) => l.id)).size, 1250);
}
{
  const f = fonteFalsa({ total: 2500, cap: 1000 });
  const linhas = await lerFechamento(f, { tetoDeLinhas: 5000 });
  verificar("C4. cap de 1000 (Production) com pedido de 500: 2500 linhas", linhas.length, 2500);
}
{
  const f = fonteFalsa({ total: 40, cap: 1 });
  const erro = await erroDe(() => lerFechamento(f, { tetoDeRequisicoes: 10 }));
  verificar(
    "C5. cap de 1 linha: o teto de requisições interrompe, sem parcial",
    codigoDe(erro),
    "requisicoes-excedidas",
  );
}

/* ------------------------------------------------------------------ */
console.log("\nD. Falhas de integridade: erro explícito, nunca resposta parcial\n");

{
  const erro = await erroDe(() => lerFechamento(fonteFalsa({ total: 1000, vazioDepoisDe: 1 })));
  verificar("D1. página vazia antes do total", codigoDe(erro), "pagina-vazia-prematura");
}
{
  const erro = await erroDe(() =>
    lerFechamento(fonteFalsa({ total: 1000, repetirPrimeira: true })),
  );
  verificar("D2. id repetido", codigoDe(erro), "id-repetido");
}
{
  const erro = await erroDe(() =>
    lerFechamento(fonteFalsa({ total: 1000, idMenorQueOCursor: true })),
  );
  verificar("D3. id fora da ordem do cursor", codigoDe(erro), "ordem-violada");
}
{
  const erro = await erroDe(() => lerFechamento(fonteFalsa({ total: 1000, falharNaPagina: 2 })));
  verificar(
    "D4. erro de consulta no meio propaga",
    erro instanceof Error && erro.message === "rede caiu",
    true,
  );
}
{
  const erro = await erroDe(() => lerFechamento(fonteFalsa({ total: 10, semContagem: true })));
  verificar("D5. banco sem contagem", codigoDe(erro), "contagem-ausente");
}
{
  const f = fonteFalsa({ total: 50_000 });
  const erro = await erroDe(() => lerFechamento(f));
  verificar("D6. período acima do teto de linhas", codigoDe(erro), "periodo-grande");
  verificar(
    "D7. período grande: nada é lido além da primeira página",
    f.registro.paginas.length,
    1,
  );
}
{
  const erro = await erroDe(() =>
    lerFechamento(fonteFalsa({ total: 20, paginaGrande: true }), { tamanhoDaPagina: 5 }),
  );
  verificar("D8. página maior que o pedido", codigoDe(erro), "pagina-maior-que-o-pedido");
}
{
  const erro = await erroDe(() => lerFechamento(fonteFalsa({ total: 5, linhasAMais: 2 })));
  verificar("D9. mais linhas do que a contagem", codigoDe(erro), "excedeu-a-contagem");
}
{
  const f = fonteFalsa({ total: 700, contagensFinais: [701, 701] });
  const erro = await erroDe(() => lerFechamento(f));
  verificar(
    "D10. contagem final diferente, duas vezes: dados-mudaram",
    codigoDe(erro),
    "dados-mudaram",
  );
  verificar("D11. a leitura inteira foi refeita uma vez", f.registro.paginas.length, 4);
}
{
  const f = fonteFalsa({ total: 700, contagensFinais: [701, 700] });
  const linhas = await lerFechamento(f);
  verificar("D12. mudou uma vez e estabilizou: leitura completa", linhas.length, 700);
}
{
  const f = fonteFalsa({ total: 700, contagensFinais: [699] });
  const erro = await erroDe(() => lerFechamento(f, { tentativas: 1 }));
  verificar("D13. sem nova tentativa, a mudança é erro", codigoDe(erro), "dados-mudaram");
}

/* ------------------------------------------------------------------ */
console.log("\nE. A fonte real (cliente Supabase injetado)\n");

/** Builder falso que registra a cadeia de chamadas do PostgREST. */
function clienteSupabaseFalso(respostaPagina, respostaContagem) {
  const chamadas = [];
  const construtor = (tipo) => {
    const b = {
      select(colunas, opcoes) {
        chamadas.push({ tipo, passo: "select", colunas, opcoes });
        return b;
      },
      eq(coluna, valor) {
        chamadas.push({ tipo, passo: "eq", coluna, valor });
        return b;
      },
      gte(coluna, valor) {
        chamadas.push({ tipo, passo: "gte", coluna, valor });
        return b;
      },
      lte(coluna, valor) {
        chamadas.push({ tipo, passo: "lte", coluna, valor });
        return b;
      },
      gt(coluna, valor) {
        chamadas.push({ tipo, passo: "gt", coluna, valor });
        return b;
      },
      order(coluna, opcoes) {
        chamadas.push({ tipo, passo: "order", coluna, opcoes });
        return b;
      },
      limit(n) {
        chamadas.push({ tipo, passo: "limit", n });
        return Promise.resolve(respostaPagina);
      },
      then(resolve, rejeitar) {
        return Promise.resolve(respostaContagem).then(resolve, rejeitar);
      },
    };
    return b;
  };
  return {
    chamadas,
    from(tabela) {
      chamadas.push({ passo: "from", tabela });
      const b = construtor(tabela);
      return { select: (...a) => b.select(...a) };
    },
  };
}

const FILTRO = { clienteId: "cliente-1", inicio: "2026-03-01", fim: "2026-03-15" };

{
  const cliente = clienteSupabaseFalso(
    { data: [{ id: "a" }], error: null, count: 1 },
    { count: 1, error: null },
  );
  const fonte = criarFonteSupabase(cliente, FILTRO);
  const pagina = await fonte.lerPagina({ cursor: null, limite: 500, contar: true });
  verificar("E1. lê a tabela timesheet_entries", cliente.chamadas[0].tabela, "timesheet_entries");
  verificar("E2. a primeira página pede count exact", cliente.chamadas[1].opcoes?.count, "exact");
  verificar(
    "E3. sem cursor não há .gt",
    cliente.chamadas.some((c) => c.passo === "gt"),
    false,
  );
  verificar(
    "E4. recorte de cliente e período vai ao banco",
    cliente.chamadas.some(
      (c) =>
        c.passo === "eq" &&
        c.coluna === "timesheets.operations.client_id" &&
        c.valor === "cliente-1",
    ) &&
      cliente.chamadas.some(
        (c) => c.passo === "gte" && c.coluna === "timesheets.work_date" && c.valor === "2026-03-01",
      ) &&
      cliente.chamadas.some(
        (c) => c.passo === "lte" && c.coluna === "timesheets.work_date" && c.valor === "2026-03-15",
      ),
    true,
  );
  verificar(
    "E5. ordena por id crescente",
    cliente.chamadas.some(
      (c) => c.passo === "order" && c.coluna === "id" && c.opcoes.ascending === true,
    ),
    true,
  );
  verificar("E6. limita a página ao pedido", cliente.chamadas.at(-1).n, 500);
  verificar("E7. devolve o total da primeira página", pagina.total, 1);
}
{
  const cliente = clienteSupabaseFalso(
    { data: [{ id: "b" }], error: null, count: null },
    { count: 1, error: null },
  );
  const fonte = criarFonteSupabase(cliente, FILTRO);
  const pagina = await fonte.lerPagina({ cursor: "a", limite: 500, contar: false });
  verificar(
    "E8. página seguinte usa o cursor (.gt id)",
    cliente.chamadas.some((c) => c.passo === "gt" && c.coluna === "id" && c.valor === "a"),
    true,
  );
  verificar("E9. página seguinte não pede contagem", cliente.chamadas[1].opcoes, undefined);
  verificar("E10. página seguinte não devolve total", pagina.total, null);
}
{
  const cliente = clienteSupabaseFalso(
    { data: null, error: { message: "boom" }, count: null },
    { count: null, error: null },
  );
  const fonte = criarFonteSupabase(cliente, FILTRO);
  const erro = await erroDe(() => fonte.lerPagina({ cursor: null, limite: 500, contar: true }));
  verificar("E11. erro do banco vira erro de leitura", codigoDe(erro), "consulta");
}
{
  const cliente = clienteSupabaseFalso(
    { data: [], error: null, count: 0 },
    { count: 7, error: null },
  );
  const fonte = criarFonteSupabase(cliente, FILTRO);
  verificar("E12. contagem final lê o count do banco", await fonte.contar(), 7);
}
{
  const cliente = clienteSupabaseFalso(
    { data: [], error: null, count: 0 },
    { count: null, error: null },
  );
  const fonte = criarFonteSupabase(cliente, FILTRO);
  const erro = await erroDe(() => fonte.contar());
  verificar("E13. contagem final ausente é erro", codigoDe(erro), "contagem-ausente");
}

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);

if (falhas.length > 0) {
  for (const falha of falhas) console.log(`  FALHA  ${falha}`);
  process.exit(1);
}
