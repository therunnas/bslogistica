/**
 * Testes da paginação administrativa (C03, A4D): lista de contas da Auth Admin
 * API, `user_roles` e operações disponíveis para atribuição.
 *
 * COMO RODAR:
 *
 *   npm run test:admin-paginacao
 *
 * Mesmo molde de `test:admin-usuarios`: Node com `--experimental-strip-types` e o
 * resolvedor `scripts/_resolver-ts.mjs` (imports relativos sem extensão). Sem rede
 * e sem Supabase: o `supabase-js` é um objeto em memória que reproduz o que importa
 * ao paginador — `listUsers({ page, perPage })`, e o construtor
 * `.select().gt().order().limit()` com teto remoto (`max_rows`) e contagem exata.
 *
 * Os módulos testados são os de produção (`cliente.ts`, `operacoes.ts`); só o
 * transporte é simulado.
 */

import {
  CONTAS_POR_PAGINA,
  ErroAdministrativo,
  MAX_PAGINAS_DE_CONTAS,
  criarClienteAdministrativo,
  lerTodasAsContas,
} from "../src/lib/admin-usuarios/cliente.ts";
import { listarOperacoesDisponiveis } from "../src/lib/admin-usuarios/operacoes.ts";
import { listarUsuarios as listarUsuariosDoServico } from "../src/lib/admin-usuarios/servico.ts";

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

async function capturar(fn) {
  try {
    await fn();
    return null;
  } catch (erro) {
    return erro;
  }
}

const idDe = (prefixo, n) => `${prefixo}000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

// ---------------------------------------------------------------------------
// Supabase falso
// ---------------------------------------------------------------------------

function criarSupabaseFalso({
  usuarios = [],
  tabelas = {},
  maxRows = 1000,
  aoListarUsuarios,
  aoConsultar,
  totalDeUsuarios,
  metadadosMentirosos = false,
} = {}) {
  const registro = { listUsers: [], consultas: [] };

  const supabase = {
    auth: {
      admin: {
        async listUsers({ page, perPage }) {
          registro.listUsers.push({ page, perPage });
          if (aoListarUsuarios) {
            const desvio = aoListarUsuarios(page, registro.listUsers.length);
            if (desvio) return desvio;
          }
          const fatia = usuarios.slice((page - 1) * perPage, page * perPage);
          const total = totalDeUsuarios ? totalDeUsuarios() : usuarios.length;
          // supabase-js: `total` só vem preenchido quando há cabeçalho Link (0 se não há)
          return {
            data: {
              users: fatia,
              aud: "authenticated",
              total,
              nextPage: metadadosMentirosos ? 1 : page + 1,
              lastPage: metadadosMentirosos ? 1 : Math.ceil(usuarios.length / perPage),
            },
            error: null,
          };
        },
      },
    },
    from(tabela) {
      return {
        select(colunas, opcoes = {}) {
          const consulta = {
            tabela,
            colunas,
            head: Boolean(opcoes.head),
            gt: null,
            ordem: null,
            limite: null,
          };
          registro.consultas.push(consulta);
          const construtor = {
            gt(coluna, valor) {
              consulta.gt = { coluna, valor };
              return construtor;
            },
            order(coluna, o) {
              consulta.ordem = { coluna, ascending: o.ascending };
              return construtor;
            },
            limit(n) {
              consulta.limite = n;
              return construtor;
            },
            then(resolver, rejeitar) {
              return executar().then(resolver, rejeitar);
            },
          };
          async function executar() {
            if (aoConsultar) {
              const desvio = aoConsultar(consulta, registro.consultas.length);
              if (desvio) return desvio;
            }
            const linhas = tabelas[tabela] ?? [];
            if (consulta.head) return { data: null, error: null, count: linhas.length };
            let resultado = [...linhas].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
            if (consulta.gt)
              resultado = resultado.filter((l) => l[consulta.gt.coluna] > consulta.gt.valor);
            resultado = resultado.slice(0, Math.min(consulta.limite ?? Infinity, maxRows));
            const campos = colunas.split(",").map((c) => c.trim());
            return {
              data: resultado.map((l) => Object.fromEntries(campos.map((c) => [c, l[c]]))),
              error: null,
            };
          }
          return construtor;
        },
      };
    },
  };
  return { supabase, registro };
}

const contas = (n, inicio = 1) =>
  Array.from({ length: n }, (_, i) => ({
    id: idDe("a0", inicio + i),
    email: `conta${inicio + i}@exemplo.test`,
    created_at: "2026-10-01T12:00:00Z",
    last_sign_in_at: null,
    banned_until: null,
    app_metadata: { ignorado: true },
  }));

// ---------------------------------------------------------------------------
console.log("\nA. Contas da Auth Admin API (listarUsuarios)\n");

for (const n of [0, 1, 199, 200, 201, 400, 401, 450]) {
  const { supabase, registro } = criarSupabaseFalso({ usuarios: contas(n) });
  const cliente = criarClienteAdministrativo(supabase);
  const lista = await cliente.listarUsuarios();
  verificar(`A-${n}a. lê as ${n} contas`, String(lista.length), String(n));
  verificar(`A-${n}b. sem repetição`, String(new Set(lista.map((u) => u.id)).size === n), "true");
  verificar(
    `A-${n}c. ordem da API preservada`,
    String(lista.every((u, i) => u.id === idDe("a0", i + 1))),
    "true",
  );
  verificar(
    `A-${n}d. requisições = páginas cheias + a vazia que prova o fim`,
    String(registro.listUsers.length),
    String(Math.ceil(n / CONTAS_POR_PAGINA) + 1),
  );
  verificar(
    `A-${n}e. 200 por página e páginas consecutivas a partir da 1`,
    String(registro.listUsers.every((r, i) => r.perPage === 200 && r.page === i + 1)),
    "true",
  );
  if (n > 0) {
    verificar(
      `A-${n}f. estrutura UsuarioBruto preservada (só 5 campos, sem o resto da conta)`,
      JSON.stringify(Object.keys(lista[0])),
      JSON.stringify(["id", "email", "created_at", "last_sign_in_at", "banned_until"]),
    );
  }
}
{
  // página exatamente cheia: 200 contas pedem uma segunda página (vazia) para provar o fim
  const { supabase, registro } = criarSupabaseFalso({ usuarios: contas(200) });
  await criarClienteAdministrativo(supabase).listarUsuarios();
  verificar(
    "A-cheia. 200 contas: 2ª página (vazia) é consultada",
    String(registro.listUsers.length),
    "2",
  );
}
{
  // Os metadados nextPage/lastPage do supabase-js mentem a partir da página 10: são ignorados.
  const { supabase } = criarSupabaseFalso({ usuarios: contas(450), metadadosMentirosos: true });
  const lista = await criarClienteAdministrativo(supabase).listarUsuarios();
  verificar(
    "A-meta. metadados nextPage/lastPage errados não afetam a leitura",
    String(lista.length),
    "450",
  );
}
{
  // 2.001 contas: passa da página 10, onde o supabase-js erra o número da página
  const { supabase } = criarSupabaseFalso({ usuarios: contas(2001) });
  const lista = await criarClienteAdministrativo(supabase).listarUsuarios();
  verificar("A-grande. 2001 contas (11 páginas) lidas por inteiro", String(lista.length), "2001");
}
{
  // erro em página intermediária
  const { supabase } = criarSupabaseFalso({
    usuarios: contas(450),
    aoListarUsuarios: (pagina) =>
      pagina === 2
        ? { data: { users: [] }, error: { message: "auth indisponível", code: "503" } }
        : null,
  });
  const erro = await capturar(() => criarClienteAdministrativo(supabase).listarUsuarios());
  verificar(
    "A-erro1. erro na página 2 -> ErroAdministrativo",
    String(erro instanceof ErroAdministrativo),
    "true",
  );
  verificar(
    "A-erro2. mantém a mensagem e o código da API",
    `${erro?.message}/${erro?.code}`,
    "auth indisponível/503",
  );
}
for (const [nome, resposta] of [
  ["data nulo", { data: null, error: null }],
  ["users não é lista", { data: { users: "x" }, error: null }],
  ["mais contas que o per_page", { data: { users: contas(201) }, error: null }],
  ["conta sem id", { data: { users: [{ email: "a@b.c" }] }, error: null }],
  ["conta com id vazio", { data: { users: [{ id: "" }] }, error: null }],
]) {
  const { supabase } = criarSupabaseFalso({
    usuarios: contas(10),
    aoListarUsuarios: () => resposta,
  });
  const erro = await capturar(() => criarClienteAdministrativo(supabase).listarUsuarios());
  verificar(
    `A-invalida-${nome}. resposta inválida -> RESPOSTA_INVALIDA`,
    erro?.code,
    "RESPOSTA_INVALIDA",
  );
}
{
  // Deslocamento transitório: na 1ª leitura a página 2 repete uma conta da página 1
  const base = contas(450);
  let leitura = 1;
  const { supabase, registro } = criarSupabaseFalso({
    usuarios: base,
    aoListarUsuarios: (pagina) => {
      if (pagina === 1) leitura = registro.listUsers.filter((r) => r.page === 1).length;
      if (leitura === 1 && pagina === 2) {
        return { data: { users: [base[199], ...base.slice(200, 399)], total: 450 }, error: null };
      }
      return null;
    },
  });
  const lista = await criarClienteAdministrativo(supabase).listarUsuarios();
  verificar(
    "A-dup1. conta repetida entre páginas dispara 1 releitura",
    String(registro.listUsers.filter((r) => r.page === 1).length),
    "2",
  );
  verificar(
    "A-dup2. e a lista final tem as 450, sem repetição",
    `${lista.length}/${new Set(lista.map((u) => u.id)).size}`,
    "450/450",
  );
}
{
  // Repetição persistente: erro explícito, sem lista parcial
  const base = contas(450);
  const { supabase, registro } = criarSupabaseFalso({
    usuarios: base,
    aoListarUsuarios: (pagina) =>
      pagina === 2
        ? { data: { users: [base[199], ...base.slice(200, 399)], total: 450 }, error: null }
        : null,
  });
  const erro = await capturar(() => criarClienteAdministrativo(supabase).listarUsuarios());
  verificar(
    "A-dup3. repetição persistente -> LEITURA_INCOMPLETA",
    erro?.code,
    "LEITURA_INCOMPLETA",
  );
  verificar(
    "A-dup4. só uma releitura (2 leituras no total)",
    String(registro.listUsers.filter((r) => r.page === 1).length),
    "2",
  );
}
{
  // Total informado maior que o lido (conta criada durante a leitura): releitura; persistindo, erro
  const { supabase } = criarSupabaseFalso({ usuarios: contas(450), totalDeUsuarios: () => 460 });
  const erro = await capturar(() => criarClienteAdministrativo(supabase).listarUsuarios());
  verificar(
    "A-total1. total da API != lido, persistente -> LEITURA_INCOMPLETA",
    erro?.code,
    "LEITURA_INCOMPLETA",
  );
  let chamadas = 0;
  const { supabase: s2 } = criarSupabaseFalso({
    usuarios: contas(450),
    totalDeUsuarios: () => (++chamadas <= 3 ? 460 : 450),
  });
  const lista = await criarClienteAdministrativo(s2).listarUsuarios();
  verificar(
    "A-total2. total divergente só na 1ª leitura -> relê e conclui",
    String(lista.length),
    "450",
  );
}
{
  // total ausente (0): lê sem a conferência
  const { supabase } = criarSupabaseFalso({ usuarios: contas(250), totalDeUsuarios: () => 0 });
  const lista = await criarClienteAdministrativo(supabase).listarUsuarios();
  verificar(
    "A-total3. sem total informado a leitura segue (sem conferência)",
    String(lista.length),
    "250",
  );
}
{
  // teto de páginas
  const { supabase, registro } = criarSupabaseFalso({
    usuarios: [],
    aoListarUsuarios: (pagina) => ({
      data: { users: contas(200, pagina * 1000), total: 0 },
      error: null,
    }),
  });
  const erro = await capturar(() => criarClienteAdministrativo(supabase).listarUsuarios());
  verificar("A-teto1. fonte que nunca esvazia -> LIMITE_PAGINAS", erro?.code, "LIMITE_PAGINAS");
  verificar(
    "A-teto2. para exatamente no teto padrão (sem laço)",
    String(registro.listUsers.length),
    String(MAX_PAGINAS_DE_CONTAS),
  );
  const pequeno = await capturar(() =>
    lerTodasAsContas(async (p) => ({ data: { users: contas(200, p * 1000) }, error: null }), {
      maxPaginas: 3,
    }),
  );
  verificar("A-teto3. teto configurável", pequeno?.code, "LIMITE_PAGINAS");
}

// ---------------------------------------------------------------------------
console.log("\nB. user_roles (listarPapeis)\n");

const papeis = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: idDe("b0", i + 1),
    user_id: idDe("a0", (i % 450) + 1),
    role: i % 7 === 0 ? "admin" : "operacional",
    created_at: "2026-10-01T12:00:00Z",
  }));

for (const n of [0, 1, 999, 1000, 1001, 2501]) {
  const { supabase, registro } = criarSupabaseFalso({ tabelas: { user_roles: papeis(n) } });
  const lista = await criarClienteAdministrativo(supabase).listarPapeis();
  verificar(
    `B-${n}a. lê os ${n} papéis (acima do max_rows de 1000)`,
    String(lista.length),
    String(n),
  );
  verificar(
    `B-${n}b. cada item é só { user_id, role } (PapelBruto)`,
    String(lista.every((l) => JSON.stringify(Object.keys(l)) === '["user_id","role"]')),
    "true",
  );
  const dados = registro.consultas.filter((c) => !c.head);
  const contagens = registro.consultas.filter((c) => c.head);
  verificar(
    `B-${n}c. projeta id, user_id e role, e mais nada`,
    String(dados.every((c) => c.colunas === "id, user_id, role")),
    "true",
  );
  verificar(
    `B-${n}d. cursor por id: order id asc, limit 500, sem filtro na 1ª página`,
    String(
      dados.every((c) => c.ordem?.coluna === "id" && c.ordem.ascending && c.limite === 500) &&
        dados[0].gt === null,
    ),
    "true",
  );
  verificar(`B-${n}e. contagem exata antes e depois`, String(contagens.length), "2");
  verificar(
    `B-${n}f. integridade: papéis e usuários batem com a origem`,
    JSON.stringify(lista.map((l) => `${l.user_id}:${l.role}`)),
    JSON.stringify(papeis(n).map((l) => `${l.user_id}:${l.role}`)),
  );
}
{
  const { supabase } = criarSupabaseFalso({
    tabelas: { user_roles: papeis(2501) },
    aoConsultar: (c, n) =>
      !c.head && c.gt && n >= 5
        ? { data: null, error: { message: "queda no meio", code: "08006" } }
        : null,
  });
  const erro = await capturar(() => criarClienteAdministrativo(supabase).listarPapeis());
  verificar(
    "B-erro1. falha em página intermediária -> ErroAdministrativo",
    String(erro instanceof ErroAdministrativo),
    "true",
  );
  verificar(
    "B-erro2. mensagem e código do PostgREST preservados",
    `${erro?.message}/${erro?.code}`,
    "queda no meio/08006",
  );
}
{
  const { supabase } = criarSupabaseFalso({
    tabelas: { user_roles: papeis(10) },
    aoConsultar: (c) =>
      c.head ? { data: null, error: { message: "sem permissão", code: "42501" } } : null,
  });
  const erro = await capturar(() => criarClienteAdministrativo(supabase).listarPapeis());
  verificar(
    "B-erro3. falha na contagem -> erro, sem lista",
    `${erro instanceof ErroAdministrativo}/${erro?.code}`,
    "true/42501",
  );
}
{
  // contagem que não fecha (linhas somem do total): divergência persistente
  const { supabase } = criarSupabaseFalso({
    tabelas: { user_roles: papeis(1500) },
    aoConsultar: (c) => (c.head ? { data: null, error: null, count: 1600 } : null),
  });
  const erro = await capturar(() => criarClienteAdministrativo(supabase).listarPapeis());
  verificar(
    "B-erro4. contagem 1600 contra 1500 lidas -> CONTAGEM_DIVERGENTE",
    erro?.code,
    "CONTAGEM_DIVERGENTE",
  );
}
{
  const { supabase } = criarSupabaseFalso({
    tabelas: { user_roles: papeis(1500) },
    aoConsultar: (c) => (c.head ? { data: null, error: null, count: null } : null),
  });
  const erro = await capturar(() => criarClienteAdministrativo(supabase).listarPapeis());
  verificar(
    "B-erro5. contagem ausente não é sucesso -> CONTAGEM_INVALIDA",
    erro?.code,
    "CONTAGEM_INVALIDA",
  );
}
{
  // servidor que repete a mesma página (ids repetidos)
  const { supabase } = criarSupabaseFalso({
    tabelas: { user_roles: papeis(1500) },
    aoConsultar: (c) => (!c.head && c.gt ? { data: papeis(500), error: null } : null),
  });
  const erro = await capturar(() => criarClienteAdministrativo(supabase).listarPapeis());
  verificar(
    "B-erro6. ids repetidos entre páginas -> CURSOR_SEM_AVANCO",
    erro?.code,
    "CURSOR_SEM_AVANCO",
  );
}
{
  // max_rows reduzido: a página curta não encerra a leitura
  const { supabase } = criarSupabaseFalso({ tabelas: { user_roles: papeis(1001) }, maxRows: 300 });
  const lista = await criarClienteAdministrativo(supabase).listarPapeis();
  verificar("B-limite. teto remoto de 300: lê as 1001", String(lista.length), "1001");
}
{
  // ponta a ponta no serviço: 450 contas + 2501 papéis -> usuários com seus papéis
  const { supabase } = criarSupabaseFalso({
    usuarios: contas(450),
    tabelas: { user_roles: papeis(2501) },
  });
  const combinados = await listarUsuariosDoServico(criarClienteAdministrativo(supabase));
  const comPapel = combinados.filter((u) => u.papeis.length > 0).length;
  verificar("B-servico1. o serviço devolve as 450 contas", String(combinados.length), "450");
  verificar(
    "B-servico2. todas com papel (2501 papéis cobrem as 450 contas)",
    String(comPapel),
    "450",
  );
  verificar(
    "B-servico3. nenhum papel perdido na junção",
    String(combinados.reduce((s, u) => s + u.papeis.length, 0)),
    "2501",
  );
}

// ---------------------------------------------------------------------------
console.log("\nC. Operações disponíveis (listarOperacoesDisponiveis)\n");

// created_at fora da ordem dos ids, com microssegundos e empates
const operacoes = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: idDe("c0", i + 1),
    name: `Operação ${i + 1}`,
    created_at: `2026-10-${String(((i * 7) % 28) + 1).padStart(2, "0")}T12:00:00.${String(i % 1000).padStart(3, "0")}000+00:00`,
    agreed_amount: 999, // coluna financeira: nunca pode aparecer
    client_id: idDe("d0", 1),
  }));

const ordemEsperada = (lista) =>
  [...lista]
    .sort((a, b) =>
      a.created_at === b.created_at
        ? a.id < b.id
          ? -1
          : 1
        : Date.parse(a.created_at) === Date.parse(b.created_at)
          ? 0
          : Date.parse(b.created_at) - Date.parse(a.created_at),
    )
    .map((o) => o.id);

for (const n of [0, 1, 999, 1000, 1001, 2501]) {
  const dados = operacoes(n);
  const { supabase, registro } = criarSupabaseFalso({ tabelas: { operations: dados } });
  const lista = await listarOperacoesDisponiveis(supabase);
  verificar(`C-${n}a. lê as ${n} operações`, String(lista.length), String(n));
  verificar(
    `C-${n}b. formato OperacaoResumo: só { id, name }`,
    String(lista.every((o) => JSON.stringify(Object.keys(o)) === '["id","name"]')),
    "true",
  );
  verificar(
    `C-${n}c. nenhuma coluna financeira ou de vínculo foi pedida`,
    String(
      registro.consultas.filter((c) => !c.head).every((c) => c.colunas === "id, name, created_at"),
    ),
    "true",
  );
  verificar(
    `C-${n}d. ordem da lista: mais recentes primeiro (created_at desc), empate por id`,
    String(JSON.stringify(lista.map((o) => o.id)) === JSON.stringify(ordemEsperada(dados))),
    "true",
  );
  verificar(`C-${n}e. sem repetição`, String(new Set(lista.map((o) => o.id)).size === n), "true");
  verificar(
    `C-${n}f. cursor por id, 500 por página, contagem antes e depois`,
    String(
      registro.consultas
        .filter((c) => !c.head)
        .every((c) => c.ordem?.coluna === "id" && c.limite === 500) &&
        registro.consultas.filter((c) => c.head).length === 2,
    ),
    "true",
  );
}
{
  const { supabase } = criarSupabaseFalso({
    tabelas: { operations: operacoes(2501) },
    aoConsultar: (c, n) =>
      !c.head && c.gt && n >= 5 ? { data: null, error: { message: "queda", code: "57P01" } } : null,
  });
  const erro = await capturar(() => listarOperacoesDisponiveis(supabase));
  verificar(
    "C-erro1. falha intermediária -> ErroAdministrativo com a causa, sem lista parcial",
    `${erro instanceof ErroAdministrativo}/${erro?.code}`,
    "true/57P01",
  );
}
{
  const { supabase } = criarSupabaseFalso({
    tabelas: { operations: operacoes(1500) },
    aoConsultar: (c) => (c.head ? { data: null, error: null, count: 1501 } : null),
  });
  const erro = await capturar(() => listarOperacoesDisponiveis(supabase));
  verificar(
    "C-erro2. contagem divergente -> CONTAGEM_DIVERGENTE",
    erro?.code,
    "CONTAGEM_DIVERGENTE",
  );
}
{
  const { supabase } = criarSupabaseFalso({
    tabelas: { operations: operacoes(1001) },
    maxRows: 100,
  });
  const lista = await listarOperacoesDisponiveis(supabase);
  verificar("C-limite. teto remoto de 100: lê as 1001", String(lista.length), "1001");
}

console.log("\nD. Escopo preservado\n");

import { readFileSync } from "node:fs";
const ler = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
{
  const cliente = ler("src/lib/admin-usuarios/cliente.ts");
  verificar(
    "D1. a lista de contas não depende dos metadados nextPage/lastPage",
    String(/nextPage|lastPage/.test(cliente.replace(/\/\*[\s\S]*?\*\//g, ""))),
    "false",
  );
  verificar(
    "D2. convite, banimento e papéis continuam como estavam (mesmas chamadas)",
    String(
      /inviteUserByEmail/.test(cliente) &&
        /ban_duration: "876000h"/.test(cliente) &&
        /ban_duration: "none"/.test(cliente),
    ),
    "true",
  );
  verificar(
    "D3. service_role não aparece neste módulo",
    String(/service_role/i.test(cliente.replace(/\/\*[\s\S]*?\*\//g, ""))),
    "false",
  );
  verificar(
    "D4. reutiliza o paginador da C03 sem copiá-lo",
    String(/from "\.\.\/paginacao"/.test(cliente) && !/function lerTudoPaginado/.test(cliente)),
    "true",
  );
}

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);

if (falhas.length > 0) {
  for (const f of falhas) console.error(`FALHA: ${f}`);
  process.exit(1);
}
