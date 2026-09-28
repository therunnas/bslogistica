/**
 * Testes do backend administrativo de usuários (PR D).
 *
 * COMO RODAR:
 *
 *   npm run test:admin-usuarios
 *
 * Mesmo formato das outras suítes: sem framework, Node executando os módulos
 * TypeScript direto via `--experimental-strip-types`. Sai com código diferente
 * de zero em qualquer falha.
 *
 * TRÊS METADES:
 *
 *   - forma literal (bloco A): que `autorizacao.ts` nunca aceita identidade
 *     por parâmetro — a mesma classe de garantia que `009_superficie_operacional`
 *     já mede no lado SQL para `operador_elegivel_aal1()`, e que `admin.ts`
 *     nunca é referenciado por um Client Component;
 *   - domínio puro (bloco B): `dominio.ts`, sem cliente nenhum;
 *   - orquestração (blocos C a G): `servico.ts` e `operacoes.ts` com um
 *     `ClienteAdministrativo`/`ClienteDeOperacoes` FALSO — objeto em memória,
 *     sem rede, sem banco —, incluindo o caminho em que o banco recusaria com
 *     `42501` a remoção do último admin, simulado pelo falso cliente.
 *
 * O que este arquivo NÃO prova: que o trigger `proteger_ultimo_admin` (017)
 * ou as policies de `admin_audit_log` funcionam de verdade no Postgres — isso
 * é `supabase/tests/013_administracao_usuarios.sql`, rodado à parte contra um
 * banco real. Aqui só se prova que `servico.ts` REAGE do jeito certo quando o
 * banco recusa.
 */

import { readFileSync } from "node:fs";

import { ACAO_AUDITORIA } from "../src/lib/admin-usuarios/tipos.ts";
import {
  combinarUsuariosEPapeis,
  DURACAO_BANIMENTO_INDEFINIDO,
  DURACAO_SEM_BANIMENTO,
  estaBanido,
  exigirEmailValido,
  exigirPapelValido,
  exigirUuid,
} from "../src/lib/admin-usuarios/dominio.ts";
import { ErroAdministrativo } from "../src/lib/admin-usuarios/cliente.ts";
import {
  alterarPapel,
  convidarUsuario,
  listarUsuarios,
  reativarUsuario,
  revogarAcesso,
} from "../src/lib/admin-usuarios/servico.ts";
import {
  atribuirOperacao,
  listarOperacoesAtribuidas,
  removerOperacao,
} from "../src/lib/admin-usuarios/operacoes.ts";

let passou = 0;
const falhas = [];

function verificar(caso, obtido, esperado) {
  const bateu = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (bateu) {
    passou++;
    console.log(`  PASS  ${caso}`);
  } else {
    falhas.push(`${caso} — esperado ${JSON.stringify(esperado)}, obtido ${JSON.stringify(obtido)}`);
    console.log(
      `  FAIL  ${caso} — esperado ${JSON.stringify(esperado)}, obtido ${JSON.stringify(obtido)}`,
    );
  }
}

/** Executa e devolve a mensagem do erro, ou `null` se não levantou. */
async function erroDe(acao) {
  try {
    await acao();
    return null;
  } catch (erro) {
    return erro instanceof Error ? erro.message : String(erro);
  }
}

console.log("\nA. Forma literal — identidade nunca vem de parâmetro\n");

const autorizacao = readFileSync(
  new URL("../src/lib/admin-usuarios/autorizacao.ts", import.meta.url),
  "utf8",
);
const admin = readFileSync(
  new URL("../src/integrations/supabase/admin.ts", import.meta.url),
  "utf8",
);
const acoes = readFileSync(
  new URL("../src/app/(painel)/usuarios/_acoes.ts", import.meta.url),
  "utf8",
);
const servicoFonte = readFileSync(
  new URL("../src/lib/admin-usuarios/servico.ts", import.meta.url),
  "utf8",
);

verificar(
  "A1. exigirAdminAal2 não recebe parâmetro nenhum",
  /export async function exigirAdminAal2\(\)/.test(autorizacao),
  true,
);
verificar(
  "A2. exigirAdminAal2 lê o uid da sessão via getUser, não de argumento",
  /supabase\.auth\.getUser\(\)/.test(autorizacao),
  true,
);
verificar('A3. admin.ts nunca declara "use client"', !/["']use client["']/.test(admin), true);
verificar(
  "A4. toda Server Action de _acoes.ts chama exigirAdminAal2 antes de tudo",
  (acoes.match(/exigirAdminAal2\(\)/g) ?? []).length >= 8,
  true,
);
verificar(
  'A5. _acoes.ts declara "use server" logo no topo',
  acoes.trimStart().startsWith('"use server"'),
  true,
);
verificar(
  "A6. servico.ts não importa o cliente admin diretamente (recebe por parâmetro)",
  !/integrations\/supabase\/admin/.test(servicoFonte),
  true,
);
verificar(
  "A7. o último admin é tratado como recusa do banco (42501), não checado em JS antes de tentar",
  /SQLSTATE_RECUSADO = "42501"/.test(servicoFonte),
  true,
);

console.log("\nB. Domínio puro\n");

verificar("B1. sem banned_until não é banido", estaBanido(null), false);
verificar("B2. banned_until no futuro é banido", estaBanido("2999-01-01T00:00:00Z"), true);
verificar("B3. banned_until no passado não é banido", estaBanido("2000-01-01T00:00:00Z"), false);
verificar(
  "B4. data inválida não é banido (fail closed para o lado errado seria pior)",
  estaBanido("lixo"),
  false,
);

const combinados = combinarUsuariosEPapeis(
  [
    {
      id: "u1",
      email: "a@x.com",
      created_at: "2026-01-01",
      last_sign_in_at: null,
      banned_until: null,
    },
    {
      id: "u2",
      email: "b@x.com",
      created_at: "2026-01-02",
      last_sign_in_at: null,
      banned_until: null,
    },
  ],
  [
    { user_id: "u1", role: "admin" },
    { user_id: "u1", role: "operacional" },
  ],
);
verificar("B5. usuário com dois papéis carrega os dois", combinados[0].papeis, [
  "admin",
  "operacional",
]);
verificar(
  "B6. usuário sem nenhuma linha em user_roles aparece com papeis: []",
  combinados[1].papeis,
  [],
);
verificar("B7. nenhum usuário some da lista por falta de papel", combinados.length, 2);

verificar(
  "B8. e-mail válido normaliza para minúsculas",
  exigirEmailValido("Fulano@Exemplo.com"),
  "fulano@exemplo.com",
);
verificar(
  "B9. e-mail sem @ é rejeitado",
  (await erroDe(() => exigirEmailValido("invalido"))) !== null,
  true,
);
verificar(
  "B10. e-mail vazio é rejeitado",
  (await erroDe(() => exigirEmailValido(""))) !== null,
  true,
);
verificar("B11. papel admin é aceito", exigirPapelValido("admin"), "admin");
verificar("B12. papel operacional é aceito", exigirPapelValido("operacional"), "operacional");
verificar(
  "B13. papel inventado é rejeitado",
  (await erroDe(() => exigirPapelValido("root"))) !== null,
  true,
);
verificar(
  "B14. uuid bem formado passa",
  exigirUuid("11111111-1111-4111-8111-111111111111", "x"),
  "11111111-1111-4111-8111-111111111111",
);
verificar(
  "B15. uuid mal formado é rejeitado",
  (await erroDe(() => exigirUuid("123", "x"))) !== null,
  true,
);
verificar(
  "B16. duração de banimento indefinido não é 'none'",
  DURACAO_BANIMENTO_INDEFINIDO !== DURACAO_SEM_BANIMENTO,
  true,
);

// ---------------------------------------------------------------------------
// Cliente administrativo falso — em memória, sem rede.
// ---------------------------------------------------------------------------

function criarClienteFalso({ ultimoAdminId = null } = {}) {
  const usuarios = new Map();
  const papeis = []; // { user_id, role }
  const banidos = new Set();
  const auditoria = [];
  let proximoId = 1;

  function recusaSeUltimoAdmin(userId, papel) {
    if (papel !== "admin" || userId !== ultimoAdminId) return;
    const erro = new Error("Não é possível remover ou rebaixar o único administrador restante.");
    throw new ErroAdministrativo({ message: erro.message, code: "42501" }, "revogar papel");
  }

  return {
    _estado: { usuarios, papeis, banidos, auditoria },

    async listarUsuarios() {
      return Array.from(usuarios.values());
    },

    async convidarPorEmail(email, nomeCompleto) {
      const id = `10000000-0000-4000-8000-${String(proximoId++).padStart(12, "0")}`;
      usuarios.set(id, {
        id,
        email,
        created_at: new Date().toISOString(),
        last_sign_in_at: null,
        banned_until: null,
      });
      void nomeCompleto;
      return { userId: id };
    },

    async banirUsuario(userId) {
      banidos.add(userId);
      const usuario = usuarios.get(userId);
      if (usuario) usuario.banned_until = "2999-01-01T00:00:00Z";
    },

    async desbanirUsuario(userId) {
      banidos.delete(userId);
      const usuario = usuarios.get(userId);
      if (usuario) usuario.banned_until = null;
    },

    async listarPapeis() {
      return papeis.slice();
    },

    async concederPapel(userId, papel) {
      if (papeis.some((p) => p.user_id === userId && p.role === papel)) return;
      papeis.push({ user_id: userId, role: papel });
    },

    async revogarPapel(userId, papel) {
      recusaSeUltimoAdmin(userId, papel);
      const indice = papeis.findIndex((p) => p.user_id === userId && p.role === papel);
      if (indice !== -1) papeis.splice(indice, 1);
    },

    async revogarTodosOsPapeis(userId) {
      const papeisDoUsuario = papeis.filter((p) => p.user_id === userId);
      for (const p of papeisDoUsuario) recusaSeUltimoAdmin(userId, p.role);
      for (let i = papeis.length - 1; i >= 0; i--) {
        if (papeis[i].user_id === userId) papeis.splice(i, 1);
      }
    },

    async registrarAuditoria(entrada) {
      auditoria.push(entrada);
    },
  };
}

function criarClienteDeOperacoesFalso() {
  const atribuicoes = [];
  return {
    _estado: atribuicoes,
    async listarAtribuidas(userId) {
      return atribuicoes
        .filter((a) => a.userId === userId)
        .map((a) => ({ operationId: a.operationId, criadoEm: a.criadoEm }));
    },
    async atribuir(userId, operationId, criadoPor) {
      if (atribuicoes.some((a) => a.userId === userId && a.operationId === operationId)) return;
      atribuicoes.push({ userId, operationId, criadoPor, criadoEm: new Date().toISOString() });
    },
    async remover(userId, operationId) {
      const indice = atribuicoes.findIndex(
        (a) => a.userId === userId && a.operationId === operationId,
      );
      if (indice !== -1) atribuicoes.splice(indice, 1);
    },
  };
}

const ATOR = { id: "admin-ator" };

console.log("\nC. listarUsuarios — junta identidade e papel\n");

{
  const cliente = criarClienteFalso();
  const { userId } = await cliente.convidarPorEmail("um@x.com", "Um");
  await cliente.concederPapel(userId, "operacional");
  const lista = await listarUsuarios(cliente);
  verificar("C1. usuário convidado aparece na listagem", lista.length, 1);
  verificar("C2. com o papel concedido", lista[0].papeis, ["operacional"]);
}

console.log("\nD. convidarUsuario\n");

{
  const cliente = criarClienteFalso();
  const resultado = await convidarUsuario(
    cliente,
    { email: "novo@x.com", papel: "operacional" },
    ATOR,
  );
  verificar("D1. convite com dados válidos é aceito", resultado.situacao, "convidado");
  verificar("D2. o papel pedido foi concedido", cliente._estado.papeis, [
    { user_id: resultado.userId, role: "operacional" },
  ]);
  verificar(
    "D3. auditoria registrada com a ação certa",
    cliente._estado.auditoria[0]?.action,
    ACAO_AUDITORIA.convite,
  );
  verificar("D4. auditoria carrega o ator", cliente._estado.auditoria[0]?.actorId, ATOR.id);
}

{
  const cliente = criarClienteFalso();
  const resultado = await convidarUsuario(
    cliente,
    { email: "invalido", papel: "operacional" },
    ATOR,
  );
  verificar("D5. e-mail inválido não convida ninguém", resultado.situacao, "erro");
  verificar("D6. e nenhum usuário foi criado", cliente._estado.usuarios.size, 0);
}

{
  const cliente = criarClienteFalso();
  const resultado = await convidarUsuario(cliente, { email: "x@x.com", papel: "superadmin" }, ATOR);
  verificar("D7. papel inválido não convida ninguém", resultado.situacao, "erro");
}

console.log("\nE. alterarPapel — e a proteção do último admin\n");

const U1 = "11111111-1111-4111-8111-111111111111";

{
  const cliente = criarClienteFalso();
  const resultado = await alterarPapel(
    cliente,
    { userId: U1, papel: "operacional", acao: "conceder" },
    ATOR,
  );
  verificar("E1. conceder papel funciona", resultado.situacao, "concedido");
  verificar(
    "E2. auditoria registrada",
    cliente._estado.auditoria[0]?.action,
    ACAO_AUDITORIA.papelConcedido,
  );
}

{
  const cliente = criarClienteFalso();
  await cliente.concederPapel(U1, "admin");
  const resultado = await alterarPapel(
    cliente,
    { userId: U1, papel: "admin", acao: "revogar" },
    ATOR,
  );
  verificar(
    "E3. revogar papel funciona quando não é o último admin",
    resultado.situacao,
    "revogado",
  );
}

{
  const cliente = criarClienteFalso({ ultimoAdminId: U1 });
  await cliente.concederPapel(U1, "admin");
  const resultado = await alterarPapel(
    cliente,
    { userId: U1, papel: "admin", acao: "revogar" },
    ATOR,
  );
  verificar(
    "E4. revogar o último admin é recusado, não uma exceção crua",
    resultado.situacao,
    "ultimo-admin",
  );
  verificar(
    "E5. e o papel continua lá — a recusa do banco realmente impediu a escrita",
    cliente._estado.papeis,
    [{ user_id: U1, role: "admin" }],
  );
  verificar(
    "E6. nenhuma auditoria é gravada para uma ação recusada",
    cliente._estado.auditoria.length,
    0,
  );
}

{
  const cliente = criarClienteFalso();
  const resultado = await alterarPapel(
    cliente,
    { userId: "não-é-uuid", papel: "admin", acao: "conceder" },
    ATOR,
  );
  verificar("E7. userId inválido é rejeitado antes de tocar o cliente", resultado.situacao, "erro");
}

console.log("\nF. revogarAcesso e reativarUsuario\n");

{
  const cliente = criarClienteFalso();
  await cliente.concederPapel(U1, "operacional");
  const resultado = await revogarAcesso(cliente, { userId: U1 }, ATOR);
  verificar("F1. revogar acesso remove o papel", resultado.situacao, "revogado");
  verificar("F2. e bane a conta", cliente._estado.banidos.has(U1), true);
  verificar("F3. nenhum papel sobra", cliente._estado.papeis.length, 0);
}

{
  const cliente = criarClienteFalso({ ultimoAdminId: U1 });
  await cliente.concederPapel(U1, "admin");
  const resultado = await revogarAcesso(cliente, { userId: U1 }, ATOR);
  verificar("F4. revogar acesso do último admin é recusado", resultado.situacao, "ultimo-admin");
  verificar(
    "F5. e a conta NÃO fica banida — revogação não é parcial",
    cliente._estado.banidos.has(U1),
    false,
  );
}

{
  const cliente = criarClienteFalso();
  const { userId } = await cliente.convidarPorEmail("u1@x.com", null);
  await cliente.banirUsuario(userId);
  const resultado = await reativarUsuario(cliente, { userId, papel: "operacional" }, ATOR);
  verificar("F6. reativar desbane a conta", resultado.situacao, "reativado");
  verificar("F7. e a conta não aparece mais banida", cliente._estado.banidos.has(userId), false);
  verificar("F8. e recebe o papel informado", cliente._estado.papeis, [
    { user_id: userId, role: "operacional" },
  ]);
}

console.log("\nG. Atribuição de operações — cliente separado, RLS, não service_role\n");

{
  const operacoesCliente = criarClienteDeOperacoesFalso();
  const registrador = criarClienteFalso();
  const resultado = await atribuirOperacao(
    operacoesCliente,
    registrador,
    {
      userId: "11111111-1111-4111-8111-111111111111",
      operationId: "22222222-2222-4222-8222-222222222222",
    },
    ATOR,
  );
  verificar("G1. atribuir operação funciona", resultado.situacao, "atribuida");
  verificar(
    "G2. e passa a listar",
    (
      await listarOperacoesAtribuidas(operacoesCliente, {
        userId: "11111111-1111-4111-8111-111111111111",
      })
    ).length,
    1,
  );
  verificar(
    "G3. auditoria registrada pelo cliente administrativo, não pelo de operações",
    registrador._estado.auditoria.length,
    1,
  );

  const remocao = await removerOperacao(
    operacoesCliente,
    registrador,
    {
      userId: "11111111-1111-4111-8111-111111111111",
      operationId: "22222222-2222-4222-8222-222222222222",
    },
    ATOR,
  );
  verificar("G4. remover operação funciona", remocao.situacao, "removida");
  verificar(
    "G5. e some da listagem",
    (
      await listarOperacoesAtribuidas(operacoesCliente, {
        userId: "11111111-1111-4111-8111-111111111111",
      })
    ).length,
    0,
  );
}

{
  const operacoesCliente = criarClienteDeOperacoesFalso();
  const registrador = criarClienteFalso();
  const resultado = await atribuirOperacao(
    operacoesCliente,
    registrador,
    { userId: "não-é-uuid", operationId: "também-não" },
    ATOR,
  );
  verificar("G6. uuid inválido não atribui nada", resultado.situacao, "erro");
  verificar("G7. e não grava auditoria", registrador._estado.auditoria.length, 0);
}

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);

if (falhas.length > 0) {
  for (const falha of falhas) console.log(`  FALHA  ${falha}`);
  process.exit(1);
}
